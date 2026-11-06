/**
 * Document signatures, like an e-signature service but with no account: the signer's phone holds a
 * digital key (created silently on first use, never shown) and signs the finished PDF's SHA-256
 * fingerprint as EIP-712 typed data. Saathi records the signature on Arkiv next to the approval.
 *
 * Isomorphic: the server checks a signature before recording it, and /verify checks it again in the
 * viewer's own browser, so nobody has to trust Saathi's server that the signature is genuine.
 *
 * What a valid signature shows: the key on that phone signed exactly this file at that time. It is
 * not an Aadhaar eSign and does not prove who holds the phone, or that the contents are true.
 */
import { recoverTypedDataAddress, type Hex } from "viem";

/** Arkiv Rabdi testnet — scopes the signature (nothing is sent to that chain by the signer). */
const SIGN_CHAIN_ID = 7794095;

export const SIGN_DOMAIN = { name: "Saathi", version: "1", chainId: SIGN_CHAIN_ID } as const;

export const SIGN_TYPES = {
  DocumentSignature: [
    { name: "document", type: "bytes32" },
    { name: "signedAt", type: "uint64" },
    { name: "method", type: "string" },
    { name: "role", type: "string" },
  ],
} as const;

/**
 * How the signature was given: drawn with a finger (and also said "yes" aloud), or — for a co-signer
 * on a share link — a deliberate tap on "Co-sign".
 */
export const SIGN_METHODS = ["finger", "finger+voice", "tap"] as const;
export type SignMethod = (typeof SIGN_METHODS)[number];

/** Co-signers, invited through a share link: they sign the same document with their own phone's key. */
export const COSIGN_ROLES = ["witness", "guarantor", "family", "official"] as const;
export type CosignRole = (typeof COSIGN_ROLES)[number];

/** "signer": the person whose form it is. The others co-sign. */
export const SIGN_ROLES = ["signer", ...COSIGN_ROLES] as const;
export type SignRole = (typeof SIGN_ROLES)[number];

/** At most this many signatures per document (a leaked link cannot flood the record). */
export const MAX_SIGNATURES = 10;

export interface SignatureProof {
  signer: Hex;
  /** Unix seconds. */
  signedAt: number;
  method: SignMethod;
  role: SignRole;
  /** 65-byte secp256k1 signature, 0x hex. */
  signature: Hex;
}

/** A signature's time must be at most this old when its PDF is made… */
export const SIGN_FRESH_FOR_PDF_S = 15 * 60;
/** …and when the signed PDF is saved (the person may pause before saving). */
export const SIGNATURE_MAX_AGE_S = 24 * 3600;
/** Allowed clock difference between the phone and the server. */
export const SIGN_CLOCK_SKEW_S = 5 * 60;

/** The signature time is in the allowed window (unix seconds). */
export function signedAtOk(signedAt: number, maxAge: number, now = Date.now() / 1000): boolean {
  return Number.isInteger(signedAt) && signedAt >= now - maxAge && signedAt <= now + SIGN_CLOCK_SKEW_S;
}

export const isAddress = (s: unknown): s is Hex => typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
export const isSignatureHex = (s: unknown): s is Hex => typeof s === "string" && /^0x[0-9a-fA-F]{130}$/.test(s);
export const isSignMethod = (s: unknown): s is SignMethod => SIGN_METHODS.includes(s as SignMethod);
export const isSignRole = (s: unknown): s is SignRole => SIGN_ROLES.includes(s as SignRole);
export const isCosignRole = (s: unknown): s is CosignRole => COSIGN_ROLES.includes(s as CosignRole);

/** The EIP-712 payload for one signature over a document fingerprint (lowercase hex SHA-256). */
export function signaturePayload(docHash: string, signedAt: number, method: SignMethod, role: SignRole) {
  return {
    domain: SIGN_DOMAIN,
    types: SIGN_TYPES,
    primaryType: "DocumentSignature" as const,
    message: { document: `0x${docHash.toLowerCase()}` as Hex, signedAt: BigInt(signedAt), method, role },
  };
}

/** True when `proof.signature` was made by `proof.signer` over exactly this document and these details. */
export async function signatureValid(docHash: string, proof: Omit<SignatureProof, "signature"> & { signature: string }): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/i.test(docHash) || !isAddress(proof.signer) || !isSignatureHex(proof.signature)) return false;
  try {
    const recovered = await recoverTypedDataAddress({
      ...signaturePayload(docHash, proof.signedAt, proof.method, proof.role),
      signature: proof.signature,
    });
    return recovered.toLowerCase() === proof.signer.toLowerCase();
  } catch {
    return false;
  }
}

/** "0x1234…abcd" — how a signer key is shown to people. */
export function shortKey(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
