/**
 * Chain Epoch Service — Task #12
 *
 * Business logic for opening, closing, verifying, and generating Merkle
 * inclusion proofs for chain epochs.  All write operations are transactional;
 * none accept computed values (merkleRoot, endEntryId, entryCount, epochId)
 * from callers — those are always server-derived.
 */
import { db, chainEpochsTable, chainEpochEventsTable, ledgerEntriesTable } from "@workspace/db";
import { eq, and, asc, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  computeRawHash,
  computeChainHash,
  computeMerkleRoot,
  buildMerkleProofWithDirection,
} from "./crypto.js";

export type ChainEpoch = typeof chainEpochsTable.$inferSelect;

// Supported hash algorithms and canonicalization versions for epoch creation.
const SUPPORTED_ALGORITHMS = ["SHA-256"] as const;
const SUPPORTED_VERSIONS = ["v1"] as const;

type EpochCode =
  | "EPOCH_ALREADY_OPEN"
  | "EPOCH_NOT_FOUND"
  | "EPOCH_ALREADY_CLOSED"
  | "EPOCH_CONCURRENT_CLOSE"
  | "EPOCH_EMPTY"
  | "EPOCH_INVALID_LEAF"
  | "EPOCH_HASH_TAMPERED"
  | "EPOCH_CHAIN_BROKEN"
  | "EPOCH_NOT_CLOSED"
  | "EPOCH_NO_ROOT"
  | "ENTRY_NOT_IN_EPOCH"
  | "UNSUPPORTED_ALGORITHM"
  | "UNSUPPORTED_VERSION";

function epochError(message: string, code: EpochCode): Error & { code: EpochCode } {
  return Object.assign(new Error(message), { code });
}

// ─── Open epoch ───────────────────────────────────────────────────────────────

/**
 * Open a new chain epoch for a vessel.
 *
 * Requirements:
 *  - Only SHA-256 / v1 are supported.
 *  - At most one OPEN epoch per vessel (enforced by DB partial unique index and
 *    a SELECT FOR UPDATE guard inside the transaction).
 *  - previousEpochRoot is set automatically from the most-recent CLOSED SHA-256
 *    epoch for the vessel; legacy MD5 data is never used as a trusted root.
 */
export async function openEpoch(
  vesselId: number,
  algorithm: string,
  canonicalizationVersion: string,
  actor: string,
): Promise<ChainEpoch> {
  if (!SUPPORTED_ALGORITHMS.includes(algorithm as "SHA-256")) {
    throw epochError(
      `Unsupported algorithm "${algorithm}". Supported: ${SUPPORTED_ALGORITHMS.join(", ")}`,
      "UNSUPPORTED_ALGORITHM",
    );
  }
  if (!SUPPORTED_VERSIONS.includes(canonicalizationVersion as "v1")) {
    throw epochError(
      `Unsupported canonicalization version "${canonicalizationVersion}". Supported: ${SUPPORTED_VERSIONS.join(", ")}`,
      "UNSUPPORTED_VERSION",
    );
  }

  return db.transaction(async (tx) => {
    // SELECT FOR UPDATE — prevents two concurrent opens from both passing the check.
    const existing = await tx.execute(
      sql`SELECT epoch_id FROM chain_epochs WHERE vessel_id = ${vesselId} AND status = 'OPEN' FOR UPDATE LIMIT 1`,
    );
    if (existing.rows.length > 0) {
      throw epochError(
        `Vessel ${vesselId} already has an OPEN epoch`,
        "EPOCH_ALREADY_OPEN",
      );
    }

    // Epoch-to-epoch chain: reference the most-recent CLOSED SHA-256 epoch's root.
    // Explicitly exclude MD5-era epochs (algorithm != 'SHA-256').
    const prevClosed = await tx.execute(
      sql`SELECT merkle_root FROM chain_epochs WHERE vessel_id = ${vesselId} AND status = 'CLOSED' AND algorithm = 'SHA-256' ORDER BY closed_at DESC LIMIT 1`,
    );
    const previousEpochRoot: string | null =
      (prevClosed.rows[0] as { merkle_root?: string | null } | undefined)
        ?.merkle_root ?? null;

    // Deterministic start boundary: next expected global ledger entry ID.
    const maxId = await tx.execute(
      sql`SELECT COALESCE(MAX(id), 0) + 1 AS next_id FROM ledger_entries`,
    );
    const startEntryId = Number(
      (maxId.rows[0] as { next_id: string | number }).next_id,
    );

    const epochId = randomUUID();
    const now = new Date();

    const [epoch] = await tx
      .insert(chainEpochsTable)
      .values({
        epochId,
        vesselId,
        algorithm,
        canonicalizationVersion,
        status: "OPEN",
        startEntryId,
        entryCount: 0,
        previousEpochRoot,
        openedAt: now,
      })
      .returning();

    await tx.insert(chainEpochEventsTable).values({
      epochId,
      eventType: "EPOCH_OPENED",
      eventTimestamp: now,
      metadata: JSON.stringify({
        vesselId,
        algorithm,
        canonicalizationVersion,
        actor,
        startEntryId,
        previousEpochRoot,
      }),
    });

    return epoch;
  });
}

// ─── Close epoch ──────────────────────────────────────────────────────────────

/**
 * Close an epoch: independently verify all assigned evidence, compute a
 * deterministic Merkle root, and persist the anchor atomically.
 *
 * The operation fails closed: any verification failure leaves the epoch OPEN
 * and the ledger unmodified.
 */
export async function closeEpoch(epochId: string, actor: string): Promise<ChainEpoch> {
  return db.transaction(async (tx) => {
    // Lock the epoch row — prevents concurrent closes and blocks concurrent
    // evidence assignment while we read the entry set.
    const epochRows = await tx.execute(
      sql`SELECT * FROM chain_epochs WHERE epoch_id = ${epochId} FOR UPDATE LIMIT 1`,
    );
    if (epochRows.rows.length === 0) {
      throw epochError(`Epoch ${epochId} not found`, "EPOCH_NOT_FOUND");
    }
    const epochRow = epochRows.rows[0] as Record<string, unknown>;
    if (epochRow.status === "CLOSED") {
      throw epochError(`Epoch ${epochId} is already CLOSED`, "EPOCH_ALREADY_CLOSED");
    }

    // Load all entries assigned to this epoch in deterministic ascending ID order.
    const entries = await tx
      .select({
        id: ledgerEntriesTable.id,
        vesselId: ledgerEntriesTable.vesselId,
        eventType: ledgerEntriesTable.eventType,
        timestampGnss: ledgerEntriesTable.timestampGnss,
        fuelType: ledgerEntriesTable.fuelType,
        fuelMassKg: ledgerEntriesTable.fuelMassKg,
        engineLoadPct: ledgerEntriesTable.engineLoadPct,
        rawHash: ledgerEntriesTable.rawHash,
        prevHash: ledgerEntriesTable.prevHash,
        chainHash: ledgerEntriesTable.chainHash,
      })
      .from(ledgerEntriesTable)
      .where(eq(ledgerEntriesTable.chainEpochId, epochId))
      .orderBy(asc(ledgerEntriesTable.id));

    if (entries.length === 0) {
      throw epochError(
        "Cannot close an empty epoch: no ledger entries have been assigned",
        "EPOCH_EMPTY",
      );
    }

    // ── Evidence verification ──────────────────────────────────────────────
    // Recompute rawHash and chainHash for every entry independently.
    // Reject the closure if any entry fails — fail closed.
    for (const entry of entries) {
      // Each Merkle leaf must be a valid 64-character SHA-256 hex string.
      if (!/^[0-9a-f]{64}$/.test(entry.chainHash)) {
        throw epochError(
          `Entry ${entry.id} has invalid chainHash (expected 64-char SHA-256 hex): "${entry.chainHash.slice(0, 16)}…"`,
          "EPOCH_INVALID_LEAF",
        );
      }

      const expectedRawHash = computeRawHash({
        vesselId: entry.vesselId,
        eventType: entry.eventType,
        timestampGnss: entry.timestampGnss.toISOString(),
        fuelType: entry.fuelType,
        fuelMassKg: entry.fuelMassKg,
        engineLoadPct: entry.engineLoadPct,
      });

      if (expectedRawHash !== entry.rawHash) {
        throw epochError(
          `Entry ${entry.id}: rawHash mismatch — evidence may have been tampered. ` +
            `Stored: ${entry.rawHash.slice(0, 16)}…  Recomputed: ${expectedRawHash.slice(0, 16)}…`,
          "EPOCH_HASH_TAMPERED",
        );
      }

      const expectedChainHash = computeChainHash(expectedRawHash, entry.prevHash);
      if (expectedChainHash !== entry.chainHash) {
        throw epochError(
          `Entry ${entry.id}: chainHash mismatch — internal chain linkage broken`,
          "EPOCH_CHAIN_BROKEN",
        );
      }
    }

    // ── Merkle root ────────────────────────────────────────────────────────
    // Leaves = chainHash values in ascending ledger entry ID order.
    const merkleRoot = computeMerkleRoot(entries as { chainHash: string }[])!;

    const endEntryId = entries[entries.length - 1].id;
    const entryCount = entries.length;
    const now = new Date();

    // Atomic update — the WHERE status = 'OPEN' guard catches any concurrent
    // close that slipped through the FOR UPDATE.
    const [closedEpoch] = await tx
      .update(chainEpochsTable)
      .set({ status: "CLOSED", endEntryId, entryCount, merkleRoot, closedAt: now })
      .where(
        and(
          eq(chainEpochsTable.epochId, epochId),
          eq(chainEpochsTable.status, "OPEN"),
        ),
      )
      .returning();

    if (!closedEpoch) {
      throw epochError(
        "Epoch closure conflict: epoch was concurrently modified",
        "EPOCH_CONCURRENT_CLOSE",
      );
    }

    await tx.insert(chainEpochEventsTable).values({
      epochId,
      eventType: "EPOCH_CLOSED",
      eventTimestamp: now,
      metadata: JSON.stringify({ endEntryId, entryCount, merkleRoot, actor }),
    });

    return closedEpoch;
  });
}

// ─── Query helpers ────────────────────────────────────────────────────────────

/** List all epochs for a vessel ordered by open time ascending. */
export async function getEpochsByVessel(vesselId: number): Promise<ChainEpoch[]> {
  return db
    .select()
    .from(chainEpochsTable)
    .where(eq(chainEpochsTable.vesselId, vesselId))
    .orderBy(asc(chainEpochsTable.openedAt));
}

/** Look up a single epoch by its stable epochId. Returns null if not found. */
export async function getEpochById(epochId: string): Promise<ChainEpoch | null> {
  const [epoch] = await db
    .select()
    .from(chainEpochsTable)
    .where(eq(chainEpochsTable.epochId, epochId));
  return epoch ?? null;
}

// ─── Independent verification ─────────────────────────────────────────────────

/**
 * Independently recompute and verify epoch integrity.
 * Does NOT trust the stored merkleRoot — always recomputes from raw evidence.
 */
export async function verifyEpoch(epochId: string): Promise<{
  epochId: string;
  status: string;
  algorithm: string;
  canonicalizationVersion: string;
  entryCount: number;
  storedMerkleRoot: string | null;
  computedMerkleRoot: string | null;
  rawHashesValid: boolean;
  chainValid: boolean;
  merkleRootValid: boolean;
  previousEpochRoot: string | null;
  valid: boolean;
  startEntryId: number;
  endEntryId: number | null;
}> {
  const [epoch] = await db
    .select()
    .from(chainEpochsTable)
    .where(eq(chainEpochsTable.epochId, epochId));
  if (!epoch) throw epochError(`Epoch ${epochId} not found`, "EPOCH_NOT_FOUND");

  const entries = await db
    .select({
      id: ledgerEntriesTable.id,
      vesselId: ledgerEntriesTable.vesselId,
      eventType: ledgerEntriesTable.eventType,
      timestampGnss: ledgerEntriesTable.timestampGnss,
      fuelType: ledgerEntriesTable.fuelType,
      fuelMassKg: ledgerEntriesTable.fuelMassKg,
      engineLoadPct: ledgerEntriesTable.engineLoadPct,
      rawHash: ledgerEntriesTable.rawHash,
      prevHash: ledgerEntriesTable.prevHash,
      chainHash: ledgerEntriesTable.chainHash,
    })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.chainEpochId, epochId))
    .orderBy(asc(ledgerEntriesTable.id));

  let rawHashesValid = true;
  let chainValid = true;

  for (const entry of entries) {
    if (!/^[0-9a-f]{64}$/.test(entry.chainHash)) {
      rawHashesValid = false;
      chainValid = false;
      break;
    }
    const expectedRaw = computeRawHash({
      vesselId: entry.vesselId,
      eventType: entry.eventType,
      timestampGnss: entry.timestampGnss.toISOString(),
      fuelType: entry.fuelType,
      fuelMassKg: entry.fuelMassKg,
      engineLoadPct: entry.engineLoadPct,
    });
    if (expectedRaw !== entry.rawHash) rawHashesValid = false;
    if (computeChainHash(expectedRaw, entry.prevHash) !== entry.chainHash) chainValid = false;
  }

  const computedMerkleRoot =
    entries.length > 0
      ? computeMerkleRoot(entries as { chainHash: string }[])
      : null;

  const merkleRootValid =
    epoch.status === "CLOSED" &&
    computedMerkleRoot !== null &&
    computedMerkleRoot === epoch.merkleRoot;

  return {
    epochId: epoch.epochId,
    status: epoch.status,
    algorithm: epoch.algorithm,
    canonicalizationVersion: epoch.canonicalizationVersion,
    entryCount: entries.length,
    storedMerkleRoot: epoch.merkleRoot ?? null,
    computedMerkleRoot,
    rawHashesValid,
    chainValid,
    merkleRootValid,
    previousEpochRoot: epoch.previousEpochRoot ?? null,
    valid: rawHashesValid && chainValid && merkleRootValid,
    startEntryId: epoch.startEntryId,
    endEntryId: epoch.endEntryId ?? null,
  };
}

// ─── Merkle inclusion proof ───────────────────────────────────────────────────

/**
 * Generate a Merkle inclusion proof for a ledger entry within a CLOSED epoch.
 * Returns enough public information for an independent verifier to reproduce
 * the verification without access to this system.
 */
export async function getInclusionProof(
  epochId: string,
  ledgerEntryId: number,
): Promise<{
  epochId: string;
  ledgerEntryId: number;
  leaf: string;
  leafIndex: number;
  merkleRoot: string;
  algorithm: string;
  canonicalizationVersion: string;
  entryCount: number;
  proofPath: { sibling: string; direction: "left" | "right" }[];
}> {
  const [epoch] = await db
    .select()
    .from(chainEpochsTable)
    .where(eq(chainEpochsTable.epochId, epochId));
  if (!epoch) throw epochError(`Epoch ${epochId} not found`, "EPOCH_NOT_FOUND");
  if (epoch.status !== "CLOSED") {
    throw epochError(
      `Epoch ${epochId} is ${epoch.status} — inclusion proofs require a CLOSED epoch`,
      "EPOCH_NOT_CLOSED",
    );
  }
  if (!epoch.merkleRoot) {
    throw epochError(`Epoch ${epochId} has no stored Merkle root`, "EPOCH_NO_ROOT");
  }

  const entries = await db
    .select({ id: ledgerEntriesTable.id, chainHash: ledgerEntriesTable.chainHash })
    .from(ledgerEntriesTable)
    .where(eq(ledgerEntriesTable.chainEpochId, epochId))
    .orderBy(asc(ledgerEntriesTable.id));

  const leafIndex = entries.findIndex((e) => e.id === ledgerEntryId);
  if (leafIndex === -1) {
    throw epochError(
      `Entry ${ledgerEntryId} is not a member of epoch ${epochId}`,
      "ENTRY_NOT_IN_EPOCH",
    );
  }

  const proofPath = buildMerkleProofWithDirection(
    entries as { chainHash: string }[],
    leafIndex,
  );

  return {
    epochId,
    ledgerEntryId,
    leaf: entries[leafIndex].chainHash,
    leafIndex,
    merkleRoot: epoch.merkleRoot,
    algorithm: epoch.algorithm,
    canonicalizationVersion: epoch.canonicalizationVersion,
    entryCount: entries.length,
    proofPath,
  };
}
