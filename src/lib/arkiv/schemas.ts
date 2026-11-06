/**
 * Arkiv entity schemas (shared by the server writer and the browser verifier).
 *
 * Privacy rule: these entities hold ONLY a SHA-256 document fingerprint, coarse metadata and
 * timestamps. Never names, numbers, answers, transcripts or document content.
 *
 * See /arkiv/schema.md for ownership and expiry rationale.
 */
import { addr, bytes, defineSchema, key, str, u64 } from "@arkiv-network/sdk/schema";

// The "saathi." tags are Paper AI's working name; they stay so records already on Arkiv keep matching.

/** One approved document. Created read-only: nobody — not even Paper AI — can rewrite the hash. */
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

/**
 * A signature on an approved document: EIP-712 typed data over `docHash`, made by a key on the
 * signer's phone (see src/lib/signing.ts). Anyone can recover `signer` from `signature` and check it.
 * The key is a random per-phone key, not tied to a name; the drawn signature image is never stored
 * here — it exists only inside the (encrypted) PDF. Read-only.
 */
export const Signature = defineSchema("saathi.signature.v1", {
  commitment: key().indexed(),
  docHash: str().indexed(),
  signer: addr().indexed(), // the phone key's public address
  signature: bytes(), // 65-byte secp256k1 signature
  signedAt: u64().indexed(), // unix seconds, part of the signed message
  method: str(), // "finger" | "finger+voice" — part of the signed message
  role: str().indexed(), // "signer" — part of the signed message
});

export const CONSENT_ACTIONS = ["approve", "store", "share", "revoke_share"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

export { addr, bytes, key, str, u64 };
