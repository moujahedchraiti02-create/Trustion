import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { vesselsTable } from "./vessels";

/**
 * One chain epoch groups an ordered, contiguous set of SHA-256 ledger entries
 * for a vessel and records a deterministic Merkle root over them on closure.
 *
 * Invariants:
 *  - At most ONE OPEN epoch per vessel (enforced by partial unique index).
 *  - A CLOSED epoch is immutable — no re-opening, no root changes.
 *  - epoch-to-epoch: previousEpochRoot links CLOSED epochs into a verifiable chain.
 *  - Legacy MD5-era entries (IDs 1–19) are NOT absorbed; they remain unassigned.
 */
export const chainEpochsTable = pgTable(
  "chain_epochs",
  {
    id: serial("id").primaryKey(),
    /** Stable external identifier for this epoch. UUID-format string. */
    epochId: text("epoch_id").notNull().unique(),
    vesselId: integer("vessel_id")
      .notNull()
      .references(() => vesselsTable.id),
    /** Hash algorithm used for rawHash, chainHash, and Merkle tree nodes. */
    algorithm: text("algorithm").notNull().default("SHA-256"),
    /**
     * Canonicalization version for rawHash field selection.
     * v1 = { vesselId, eventType, timestampGnss, fuelType, fuelMassKg, engineLoadPct }
     */
    canonicalizationVersion: text("canonicalization_version").notNull().default("v1"),
    status: text("status", { enum: ["OPEN", "CLOSED"] })
      .notNull()
      .default("OPEN"),
    /**
     * Anticipated first ledger entry ID in this epoch.
     * Set at open time as (max global id + 1).  Informational — actual
     * membership is determined by ledger_entries.chain_epoch_id.
     */
    startEntryId: integer("start_entry_id").notNull(),
    /** ID of the last entry assigned to this epoch.  Null while OPEN. */
    endEntryId: integer("end_entry_id"),
    /** Count of entries verified and anchored at closure.  0 while OPEN. */
    entryCount: integer("entry_count").notNull().default(0),
    /**
     * SHA-256 Merkle root over all assigned entries' chainHash values,
     * in ascending ledger entry ID order.  Null while OPEN.
     * Never computed from client input — always derived by the server.
     */
    merkleRoot: text("merkle_root"),
    /**
     * Merkle root of the immediately preceding CLOSED SHA-256 epoch for this vessel.
     * Null for the first trusted epoch (represents the SHA-256 trust boundary).
     * Never references MD5-era legacy data.
     */
    previousEpochRoot: text("previous_epoch_root"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /**
     * At most one OPEN epoch per vessel.
     * Partial unique index — only rows where status = 'OPEN' participate,
     * so multiple CLOSED epochs for the same vessel are allowed.
     */
    uniqueIndex("chain_epochs_one_open_per_vessel_idx")
      .on(t.vesselId)
      .where(sql`status = 'OPEN'`),
  ],
);

export type ChainEpoch = typeof chainEpochsTable.$inferSelect;
export type ChainEpochStatus = "OPEN" | "CLOSED";
