import {
  pgTable,
  text,
  serial,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

/**
 * Append-only audit log for chain epoch lifecycle events.
 * Records are never updated or deleted.
 */
export const chainEpochEventsTable = pgTable(
  "chain_epoch_events",
  {
    id: serial("id").primaryKey(),
    /** References chain_epochs.epoch_id. */
    epochId: text("epoch_id").notNull(),
    eventType: text("event_type", {
      enum: ["EPOCH_OPENED", "EPOCH_CLOSED"],
    }).notNull(),
    eventTimestamp: timestamp("event_timestamp", { withTimezone: true })
      .notNull()
      .defaultNow(),
    /** JSON-encoded metadata for the event.  Never contains private key material. */
    metadata: text("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("chain_epoch_events_epoch_id_idx").on(t.epochId)],
);

export type ChainEpochEvent = typeof chainEpochEventsTable.$inferSelect;
