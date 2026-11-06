/**
 * Arkiv entity schemas (shared by the server writer and the browser verifier).
 *
 * Privacy rule: these entities hold ONLY a SHA-256 document fingerprint, coarse metadata and
 * timestamps. Never names, numbers, answers, transcripts or document content.
 *
 * See /arkiv/schema.md for ownership and expiry rationale.
 */
import { defineSchema, key, str, u64 } from "@arkiv-network/sdk/schema";

/** One approved document. Created read-only: nobody — not even Saathi — can rewrite the hash. */
export const Commitment = defineSchema("saathi.commitment.v1", {
  docHash: str().indexed(), // lowercase hex SHA-256 of the approved PDF bytes
  hashAlg: str().default("sha-256"),
  category: str().indexed(), // coarse: bank | government | pension | … | other
  lang: str().indexed(), // conversation language, e.g. "hi"
  approvedAt: u64().indexed(), // unix seconds — when the person approved the final document
  app: str().default("saathi/0.1"),
});

/** A consent / audit event about a commitment (approve, store, share, revoke_share). Read-only. */
export const Consent = defineSchema("saathi.consent.v1", {
  commitment: key().indexed(),
  docHash: str().indexed(),
  action: str().indexed(),
  occurredAt: u64().indexed(), // unix seconds
  method: str(), // how consent was given, e.g. "voice+tap" or "tap"
  ref: str().optional(), // share grant id for share / revoke_share events
});

/**
 * A live share link. Its Arkiv expiry IS the link's lifetime: when the entity expires the link stops
 * working. Revoking deletes the entity. Not read-only, so the owner wallet can delete it.
 */
export const ShareGrant = defineSchema("saathi.share.v1", {
  commitment: key().indexed(),
  docHash: str().indexed(),
  grantId: str().indexed(), // sha-256 of the bearer token; the token itself never leaves the link
  issuedAt: u64(),
});

export const CONSENT_ACTIONS = ["approve", "store", "share", "revoke_share"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

export { key, str, u64 };
