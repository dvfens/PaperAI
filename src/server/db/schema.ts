import { bigserial, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Application metadata only. Answers, transcripts, OCR text and names are never stored here.
 * The completed PDF itself lives encrypted in SecureStorage; this table holds its wrapped data key.
 */
export const documents = pgTable(
  "documents",
  {
    id: text("id").primaryKey(),
    ownerHash: text("owner_hash").notNull(),
    status: text("status").notNull(), // stored | erased
    category: text("category").notNull(),
    language: text("language").notNull(),
    pageCount: integer("page_count").notNull(),
    fieldCount: integer("field_count").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key"),
    wrappedKey: text("wrapped_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }).notNull(),
    retentionUntil: timestamp("retention_until", { withTimezone: true }).notNull(),
    erasedAt: timestamp("erased_at", { withTimezone: true }),
    arkivStatus: text("arkiv_status").notNull(), // recorded | not_configured | failed
    arkivCommitmentKey: text("arkiv_commitment_key"),
    arkivConsentKey: text("arkiv_consent_key"),
    arkivTxHash: text("arkiv_tx_hash"),
    arkivExpiresBlock: text("arkiv_expires_block"),
    arkivError: text("arkiv_error"),
  },
  (t) => [index("documents_sha256_idx").on(t.sha256), index("documents_owner_idx").on(t.ownerHash)],
);

export const shareLinks = pgTable(
  "share_links",
  {
    id: text("id").primaryKey(),
    documentId: text("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    /** HMAC of the bearer token — the token itself is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    /** Public grant id (sha256 of the token) — the value recorded on Arkiv. */
    grantId: text("grant_id").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    arkivStatus: text("arkiv_status").notNull(),
    arkivGrantKey: text("arkiv_grant_key"),
    arkivTxHash: text("arkiv_tx_hash"),
    accessCount: integer("access_count").notNull().default(0),
  },
  (t) => [index("share_links_document_idx").on(t.documentId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    documentId: text("document_id"),
    event: text("event").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    /** Non-personal metadata only (entity keys, tx hashes, durations). */
    meta: jsonb("meta").$type<Record<string, string | number | boolean | null>>(),
  },
  (t) => [index("audit_events_document_idx").on(t.documentId)],
);

export type DocumentRow = typeof documents.$inferSelect;
export type ShareLinkRow = typeof shareLinks.$inferSelect;
