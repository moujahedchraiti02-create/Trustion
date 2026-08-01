import { db, ledgerEntriesTable } from "@workspace/db";
import { computeRawHash, computeChainHash } from "../lib/crypto";

export async function getLedgerChainStatusData() {
  const entries = await db.select({
    id: ledgerEntriesTable.id,
    chainHash: ledgerEntriesTable.chainHash,
    prevHash: ledgerEntriesTable.prevHash,
    rawHash: ledgerEntriesTable.rawHash,
    vesselId: ledgerEntriesTable.vesselId,
    eventType: ledgerEntriesTable.eventType,
    timestampGnss: ledgerEntriesTable.timestampGnss,
    fuelType: ledgerEntriesTable.fuelType,
    fuelMassKg: ledgerEntriesTable.fuelMassKg,
    engineLoadPct: ledgerEntriesTable.engineLoadPct,
  }).from(ledgerEntriesTable).orderBy(ledgerEntriesTable.id);

  let integrityStatus: "INTACT" | "BROKEN" | "UNKNOWN" = "UNKNOWN";
  let brokenAtEntry: number | null = null;

  if (entries.length === 0) {
    integrityStatus = "INTACT";
  } else {
    integrityStatus = "INTACT";
    for (const entry of entries) {
      const rawHash = computeRawHash({
        vesselId: entry.vesselId,
        eventType: entry.eventType,
        timestampGnss: entry.timestampGnss.toISOString(),
        fuelType: entry.fuelType,
        fuelMassKg: entry.fuelMassKg,
        engineLoadPct: entry.engineLoadPct,
      });
      const expectedChain = computeChainHash(rawHash, entry.prevHash);
      if (expectedChain !== entry.chainHash) {
        integrityStatus = "BROKEN";
        brokenAtEntry = entry.id;
        break;
      }
    }
  }

  const lastEntry = entries[entries.length - 1];
  return {
    totalEntries: entries.length,
    lastHash: lastEntry?.chainHash ?? null,
    integrityStatus,
    brokenAtEntry,
    checkedAt: new Date().toISOString(),
  };
}
