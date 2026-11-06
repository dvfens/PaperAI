/**
 * Read-side Arkiv queries. Isomorphic: the /verify page runs these directly in the browser against
 * Arkiv's public RPC, so a recipient does not have to trust Saathi's server to check a document.
 *
 * Every query is restricted with `createdBy(writer)`: anyone can write an entity that matches our
 * schema tag, but only entities created by Saathi's writer wallet count. ($creator is immutable,
 * unlike $owner, which can be transferred.)
 */
import { createPublicClient, type PublicArkivClient } from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { asc, eq } from "@arkiv-network/sdk/query";
import { http, type Hex } from "viem";
import { isSignMethod, isSignRole, signatureValid } from "@/lib/signing";
import type { VerificationEvent, VerificationResult, VerificationSignature } from "@/lib/types";
import { Commitment, Consent, ShareGrant, Signature, str } from "./schemas";

export const ARKIV_CHAIN_ID = 7794095;
export const ARKIV_EXPLORER = "https://rabdi.explorer.arkiv.network";

export function arkivReader(accessKey: string): PublicArkivClient {
  return createPublicClient({ chain: rabdi({ accessKey }), transport: http() });
}

export function isHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

async function estimateDate(client: PublicArkivClient, block: bigint): Promise<string | null> {
  try {
    const timing = await client.getBlockTiming();
    const seconds = timing.currentBlockTime + Number(block - timing.currentBlock) * timing.blockDuration;
    return new Date(seconds * 1000).toISOString();
  } catch {
    return null;
  }
}

const EVENT_KIND: Record<string, VerificationEvent["kind"]> = {
  approve: "approved",
  store: "stored",
  share: "shared",
  revoke_share: "share_revoked",
};

export async function verifyHashOnArkiv(
  client: PublicArkivClient,
  docHash: string,
  writer: Hex,
): Promise<VerificationResult> {
  const hash = docHash.toLowerCase();
  const found = await client
    .select({
      $key: true,
      $creator: true,
      $expiresAt: true,
      $creationFlags: true,
      category: true,
      lang: true,
      approvedAt: true,
    })
    .from(Commitment)
    .where(eq("docHash", str(hash)))
    .createdBy(writer)
    .limit(5)
    .fetch();

  const row = found.entities[0];
  if (!row) return { sha256: hash, status: "no_match", history: [], checkedAgainst: "arkiv" };

  const events = await client
    .select({ $key: true, action: true, occurredAt: true, ref: true })
    .from(Consent)
    .where(eq("docHash", str(hash)))
    .createdBy(writer)
    .orderBy(asc("occurredAt"))
    .limit(100)
    .fetch();

  const history: VerificationEvent[] = events.entities.map((e) => ({
    kind: EVENT_KIND[e.action.value] ?? "other",
    at: Number(e.occurredAt.value),
    entityKey: e.$key,
    detail: e.action.value,
  }));

  // Signatures: each one is checked here (recover the signer from the signature), not taken on trust.
  const signed = await client
    .select({ $key: true, signer: true, signature: true, signedAt: true, method: true, role: true })
    .from(Signature)
    .where(eq("docHash", str(hash)))
    .createdBy(writer)
    .orderBy(asc("signedAt"))
    .limit(20)
    .fetch();
  const signatures: VerificationSignature[] = await Promise.all(
    signed.entities.map(async (e) => {
      const method = e.method.value;
      const role = e.role.value;
      const signedAt = Number(e.signedAt.value);
      const valid =
        isSignMethod(method) &&
        isSignRole(role) &&
        (await signatureValid(hash, { signer: e.signer.value, signedAt, method, role, signature: e.signature.value }));
      return { entityKey: e.$key, signer: e.signer.value, signedAt, method, role, valid };
    }),
  );
  for (const s of signatures) history.push({ kind: s.role === "signer" ? "signed" : "cosigned", at: s.signedAt, entityKey: s.entityKey, detail: s.role });
  history.sort((a, b) => a.at - b.at);

  return {
    sha256: hash,
    status: "match",
    commitment: {
      entityKey: row.$key,
      approvedAt: Number(row.approvedAt.value),
      category: row.category.value,
      language: row.lang.value,
      expiresAtBlock: row.$expiresAt.toString(),
      expiresAtEstimate: await estimateDate(client, row.$expiresAt),
      readonly: row.$creationFlags.readonly,
      creator: row.$creator,
    },
    history,
    signatures,
    checkedAgainst: "arkiv",
  };
}

/** A share link is valid only while its grant entity is alive on Arkiv (not expired, not deleted). */
export async function findActiveGrant(client: PublicArkivClient, grantId: string, writer: Hex) {
  const res = await client
    .select({ $key: true, $expiresAt: true, docHash: true })
    .from(ShareGrant)
    .where(eq("grantId", str(grantId)))
    .createdBy(writer)
    .limit(1)
    .fetch();
  const row = res.entities[0];
  if (!row) return null;
  return {
    entityKey: row.$key,
    docHash: row.docHash.value,
    expiresAtBlock: row.$expiresAt,
    expiresAtEstimate: await estimateDate(client, row.$expiresAt),
  };
}

export async function commitmentExpiry(client: PublicArkivClient, entityKey: Hex) {
  const e = await client.getEntity(entityKey, Commitment);
  return { expiresAtBlock: e.$expiresAt, expiresAtEstimate: await estimateDate(client, e.$expiresAt) };
}
