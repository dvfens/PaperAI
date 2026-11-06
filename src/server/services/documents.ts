import "server-only";
import { isCosignRole, SIGN_FRESH_FOR_PDF_S, SIGNATURE_MAX_AGE_S, signatureValid, signedAtOk, type SignatureProof } from "@/lib/signing";
import { randomUUID } from "node:crypto";
import { and, desc, eq, isNull, lt, sql } from "drizzle-orm";
import type { Hex } from "viem";
import type { CommitmentReceipt, RetentionChoice, SavedForm } from "@/lib/types";
import { generationToken, hmacHex, randomToken, safeEqualHex, sha256Hex } from "@/server/crypto";
import { db } from "@/server/db/client";
import { auditEvents, documents, shareLinks, type DocumentRow } from "@/server/db/schema";
import { HttpError } from "@/server/http";
import { errorCode, log } from "@/server/log";
import { blockchain } from "./blockchain";
import { isPdf } from "./image";
import { secureStorage } from "./storage";

const DAY = 86_400_000;

async function audit(documentId: string | null, event: string, meta: Record<string, string | number | boolean | null> = {}) {
  const d = await db();
  await d.insert(auditEvents).values({ documentId, event, meta });
}

function receiptFrom(row: DocumentRow): CommitmentReceipt {
  const arkiv: CommitmentReceipt["arkiv"] =
    row.arkivStatus === "recorded" && row.arkivCommitmentKey && row.arkivTxHash
      ? {
          status: "recorded",
          commitmentKey: row.arkivCommitmentKey,
          consentKey: row.arkivConsentKey ?? "",
          txHash: row.arkivTxHash,
          expiresAtBlock: row.arkivExpiresBlock ?? "",
          explorerTxUrl: blockchain().explorerTxUrl(row.arkivTxHash),
        }
      : row.arkivStatus === "not_configured"
        ? { status: "not_configured" }
        : { status: "failed", reason: row.arkivError ?? "unknown" };
  return {
    documentId: row.id,
    sha256: row.sha256,
    approvedAt: row.approvedAt.toISOString(),
    retentionUntil: row.retentionUntil.toISOString(),
    stored: row.status === "stored",
    ...(row.signer && row.signedAt
      ? { signature: { signer: row.signer, signedAt: row.signedAt.toISOString(), arkivKey: row.arkivSignatureKey } }
      : {}),
    arkiv,
  };
}

/**
 * Called only after the person has explicitly approved the final document and consented to
 * storage. Verifies the PDF is exactly the one Saathi generated, encrypts it, stores it, and
 * records the commitment + consent event on Arkiv.
 */
export async function approveAndStore(input: {
  ownerHash: string;
  pdf: Buffer;
  token: string;
  category: string;
  language: string;
  pageCount: number;
  fieldCount: number;
  retentionDays: RetentionChoice;
  consentMethod: string;
  /** The person's signature over this PDF, made with their phone's key. */
  signature?: SignatureProof;
}): Promise<CommitmentReceipt> {
  if (!isPdf(input.pdf)) throw new HttpError(400, "not_pdf", "Expected a PDF.");
  const sha = sha256Hex(input.pdf);
  if (!safeEqualHex(generationToken(sha, input.signature?.signer), input.token)) {
    throw new HttpError(400, "unknown_document", "This PDF was not produced by Saathi or was modified.");
  }
  // Checked here and again by anyone on /verify: the signature must come from the key printed in this
  // PDF and cover exactly these bytes.
  const sig = input.signature;
  if (sig && (!signedAtOk(sig.signedAt, SIGNATURE_MAX_AGE_S) || !(await signatureValid(sha, sig)))) {
    throw new HttpError(400, "bad_signature", "The signature does not match this document.");
  }
  const id = randomUUID();
  const approvedAt = new Date();
  const retentionUntil = new Date(approvedAt.getTime() + input.retentionDays * DAY);
  const { storageKey, wrappedKey } = await secureStorage().put(id, input.pdf);
  const d = await db();
  const chain = blockchain();

  await d.insert(documents).values({
    id,
    ownerHash: input.ownerHash,
    status: "stored",
    category: input.category,
    language: input.language,
    pageCount: input.pageCount,
    fieldCount: input.fieldCount,
    sha256: sha,
    sizeBytes: input.pdf.length,
    storageKey,
    wrappedKey,
    approvedAt,
    retentionUntil,
    arkivStatus: chain.configured ? "pending" : "not_configured",
    signer: sig ? sig.signer.toLowerCase() : null,
    signedAt: sig ? new Date(sig.signedAt * 1000) : null,
  });
  await audit(id, "approved", { retentionDays: input.retentionDays, method: input.consentMethod });

  if (chain.configured) {
    try {
      const rec = await chain.recordApproval({
        docHash: sha,
        category: input.category,
        lang: input.language,
        approvedAt,
        retentionUntil,
        method: input.consentMethod,
        signature: sig,
      });
      await d
        .update(documents)
        .set({
          arkivStatus: "recorded",
          arkivCommitmentKey: rec.commitmentKey,
          arkivConsentKey: rec.consentKey,
          arkivTxHash: rec.txHash,
          arkivExpiresBlock: rec.expiresAtBlock,
          arkivSignatureKey: rec.signatureKey,
        })
        .where(eq(documents.id, id));
      await audit(id, "arkiv_recorded", { txHash: rec.txHash, entityKey: rec.commitmentKey });
    } catch (err) {
      const reason = errorCode(err);
      log.error("arkiv.approval_failed", { documentId: id, code: reason });
      await d.update(documents).set({ arkivStatus: "failed", arkivError: reason }).where(eq(documents.id, id));
      await audit(id, "arkiv_failed", { reason });
    }
  }
  const [row] = await d.select().from(documents).where(eq(documents.id, id));
  return receiptFrom(row);
}

/**
 * Enforce retention on every read, not only when the purge job runs: a stored document past its
 * retention date is destroyed now and reported as erased.
 */
async function expireIfDue(row: DocumentRow): Promise<DocumentRow> {
  if (row.status !== "stored" || row.retentionUntil.getTime() > Date.now()) return row;
  await destroyDocument(row, "retention_expired");
  return { ...row, status: "erased", storageKey: null, wrappedKey: null };
}

export async function getOwnedDocument(id: string, ownerHash: string): Promise<DocumentRow> {
  const d = await db();
  const [row] = await d
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.ownerHash, ownerHash)));
  if (!row) throw new HttpError(404, "not_found", "Document not found.");
  return expireIfDue(row);
}

export async function documentReceipt(id: string, ownerHash: string) {
  const row = await getOwnedDocument(id, ownerHash);
  const receipt = receiptFrom(row);
  // The retention date shown to the person is read back from Arkiv when available.
  let arkivExpiry: string | null = null;
  if (receipt.arkiv.status === "recorded") {
    try {
      arkivExpiry = (await blockchain().commitmentExpiry(receipt.arkiv.commitmentKey as Hex))?.expiresAtEstimate ?? null;
    } catch {
      arkivExpiry = null;
    }
  }
  return { ...receipt, arkivExpiry, erased: row.status === "erased" };
}

/**
 * The forms this device saved and can still open ("My forms"), newest first. Only stored documents;
 * anything past its retention date is destroyed on the way (same rule as a single read).
 */
export async function listOwnedDocuments(ownerHash: string): Promise<SavedForm[]> {
  const d = await db();
  const rows = await d
    .select()
    .from(documents)
    .where(and(eq(documents.ownerHash, ownerHash), eq(documents.status, "stored")))
    .orderBy(desc(documents.approvedAt))
    .limit(50);
  const live = (await Promise.all(rows.map(expireIfDue))).filter((r) => r.status === "stored");
  return live.map((row) => ({
    ...receiptFrom(row),
    category: row.category as SavedForm["category"],
    language: row.language,
    pageCount: row.pageCount,
  }));
}

export async function readOwnedPdf(id: string, ownerHash: string): Promise<Buffer> {
  const row = await getOwnedDocument(id, ownerHash);
  if (row.status !== "stored" || !row.storageKey || !row.wrappedKey) throw new HttpError(410, "erased", "This document was deleted.");
  await audit(id, "owner_download");
  return secureStorage().get(row.id, row.storageKey, row.wrappedKey);
}

export async function createShareLink(id: string, ownerHash: string, hours: 1 | 24 | 168, baseUrl: string) {
  const row = await getOwnedDocument(id, ownerHash);
  if (row.status !== "stored") throw new HttpError(410, "erased", "This document was deleted.");
  const token = randomToken(32);
  const grantId = sha256Hex(token);
  const requested = Date.now() + hours * 3_600_000;
  const expiresAt = new Date(Math.min(requested, row.retentionUntil.getTime()));
  const shareId = randomUUID();
  const d = await db();
  const chain = blockchain();
  let arkivStatus = chain.configured && row.arkivCommitmentKey ? "pending" : "not_configured";
  let grantKey: string | null = null;
  let txHash: string | null = null;

  if (arkivStatus === "pending") {
    try {
      const rec = await chain.recordShare({
        commitmentKey: row.arkivCommitmentKey as Hex,
        docHash: row.sha256,
        grantId,
        expiresAt,
        retentionUntil: row.retentionUntil,
      });
      arkivStatus = "recorded";
      grantKey = rec.grantKey;
      txHash = rec.txHash;
    } catch (err) {
      log.error("arkiv.share_failed", { documentId: id, code: errorCode(err) });
      // Fail closed: a share whose grant could not be recorded is not created.
      throw new HttpError(502, "share_record_failed", "Could not create the link right now.");
    }
  }

  await d.insert(shareLinks).values({
    id: shareId,
    documentId: id,
    tokenHash: hmacHex(`share:${token}`),
    grantId,
    expiresAt,
    arkivStatus,
    arkivGrantKey: grantKey,
    arkivTxHash: txHash,
  });
  await audit(id, "share_created", { hours, txHash });
  return {
    shareId,
    url: `${baseUrl.replace(/\/$/, "")}/s/${token}`,
    expiresAt: expiresAt.toISOString(),
    arkiv: arkivStatus === "recorded" ? { grantKey, txHash, explorerTxUrl: txHash ? chain.explorerTxUrl(txHash) : null } : null,
  };
}

export async function listShareLinks(id: string, ownerHash: string) {
  await getOwnedDocument(id, ownerHash);
  const d = await db();
  const rows = await d.select().from(shareLinks).where(eq(shareLinks.documentId, id)).orderBy(desc(shareLinks.createdAt));
  return rows.map((r) => ({
    shareId: r.id,
    expiresAt: r.expiresAt.toISOString(),
    revoked: Boolean(r.revokedAt),
    expired: r.expiresAt.getTime() < Date.now(),
    accessCount: r.accessCount,
    arkivTxHash: r.arkivTxHash,
  }));
}

export async function revokeShareLink(id: string, shareId: string, ownerHash: string) {
  const row = await getOwnedDocument(id, ownerHash);
  const d = await db();
  const [share] = await d
    .select()
    .from(shareLinks)
    .where(and(eq(shareLinks.id, shareId), eq(shareLinks.documentId, id)));
  if (!share) throw new HttpError(404, "not_found", "Link not found.");
  if (share.revokedAt) return { revoked: true };
  await d.update(shareLinks).set({ revokedAt: new Date() }).where(eq(shareLinks.id, shareId));
  if (share.arkivStatus === "recorded" && row.arkivCommitmentKey) {
    try {
      await blockchain().revokeShare({
        grantKey: share.arkivGrantKey as Hex | null,
        commitmentKey: row.arkivCommitmentKey as Hex,
        docHash: row.sha256,
        grantId: share.grantId,
        retentionUntil: row.retentionUntil,
      });
    } catch (err) {
      // The database revocation already blocks the link; the Arkiv grant still expires on its own.
      log.error("arkiv.revoke_failed", { documentId: id, code: errorCode(err) });
    }
  }
  await audit(id, "share_revoked");
  return { revoked: true };
}

async function destroyDocument(row: DocumentRow, reason: "owner_request" | "retention_expired") {
  const d = await db();
  // Destroy the wrapped data key first (crypto-shredding) and revoke links, atomically; then remove
  // the ciphertext itself. If the second step fails, what is left can no longer be decrypted.
  await d.transaction(async (tx) => {
    await tx
      .update(documents)
      .set({ status: "erased", storageKey: null, wrappedKey: null, erasedAt: new Date() })
      .where(eq(documents.id, row.id));
    await tx.update(shareLinks).set({ revokedAt: new Date() }).where(and(eq(shareLinks.documentId, row.id), isNull(shareLinks.revokedAt)));
  });
  if (row.storageKey) await secureStorage().destroy(row.storageKey);
  await audit(row.id, "erased", { reason });
}

export async function eraseDocument(id: string, ownerHash: string) {
  const row = await getOwnedDocument(id, ownerHash);
  await destroyDocument(row, "owner_request");
  let arkivTx: string | null = null;
  if (row.arkivStatus === "recorded") {
    try {
      arkivTx = (await blockchain().erase(row.sha256)).txHash;
    } catch (err) {
      log.error("arkiv.erase_failed", { documentId: id, code: errorCode(err) });
    }
  }
  return { erased: true, arkivTxHash: arkivTx };
}

/** Resolve a share token. Valid only if the DB link is live AND (when recorded) its Arkiv grant is alive. */
export async function resolveShare(token: string, countAccess: boolean) {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(token)) return { valid: false as const };
  const d = await db();
  const [share] = await d.select().from(shareLinks).where(eq(shareLinks.tokenHash, hmacHex(`share:${token}`)));
  if (!share || share.revokedAt || share.expiresAt.getTime() < Date.now()) return { valid: false as const };
  const [found] = await d.select().from(documents).where(eq(documents.id, share.documentId));
  const row = found ? await expireIfDue(found) : undefined;
  if (!row || row.status !== "stored" || !row.storageKey || !row.wrappedKey) return { valid: false as const };

  let arkivChecked = false;
  if (share.arkivStatus === "recorded") {
    const grant = await blockchain().isGrantActive(share.grantId);
    if (!grant.active || grant.docHash !== row.sha256) return { valid: false as const };
    arkivChecked = true;
  }
  if (countAccess) {
    await d.update(shareLinks).set({ accessCount: sql`${shareLinks.accessCount} + 1` }).where(eq(shareLinks.id, share.id));
    await audit(row.id, "share_accessed");
  }
  return {
    valid: true as const,
    row,
    expiresAt: share.expiresAt.toISOString(),
    arkivChecked,
    read: () => secureStorage().get(row.id, row.storageKey!, row.wrappedKey!),
  };
}

// --- Retention: delete documents whose retention period has ended ----------------------------------
let lastPurge = 0;
export async function purgeExpired(force = false): Promise<number> {
  if (!force && Date.now() - lastPurge < 10 * 60_000) return 0;
  lastPurge = Date.now();
  const d = await db();
  const expired = await d
    .select()
    .from(documents)
    .where(and(eq(documents.status, "stored"), lt(documents.retentionUntil, new Date())));
  for (const row of expired) await destroyDocument(row, "retention_expired");
  if (expired.length) log.info("retention.purged", { status: expired.length });
  return expired.length;
}

/**
 * Co-sign a shared document: the person who received the link (a witness, guarantor, family member or
 * official) signs the same fingerprint with their own phone's key. Saathi checks the link is still
 * alive on Arkiv and the signature is genuine, then records it next to the owner's.
 */
export async function cosignShared(token: string, proof: SignatureProof) {
  const share = await resolveShare(token, false);
  if (!share.valid) throw new HttpError(410, "link_expired", "This link has expired or was stopped.");
  const row = share.row;
  if (row.arkivStatus !== "recorded" || !row.arkivCommitmentKey) {
    throw new HttpError(409, "not_recorded", "This document has no Arkiv record to co-sign.");
  }
  if (!isCosignRole(proof.role) || proof.method !== "tap") throw new HttpError(400, "bad_signature", "Invalid co-signature.");
  if (row.signer && row.signer === proof.signer.toLowerCase()) {
    throw new HttpError(409, "already_signed", "This phone has already signed this document.");
  }
  if (!signedAtOk(proof.signedAt, SIGN_FRESH_FOR_PDF_S) || !(await signatureValid(row.sha256, proof))) {
    throw new HttpError(400, "bad_signature", "The signature does not match this document.");
  }
  const rec = await blockchain().recordCosign({
    commitmentKey: row.arkivCommitmentKey as `0x${string}`,
    docHash: row.sha256,
    signature: proof,
    retentionUntil: row.retentionUntil,
  });
  await audit(row.id, "cosigned", { role: proof.role, txHash: rec.txHash });
  return {
    role: proof.role,
    signedAt: new Date(proof.signedAt * 1000).toISOString(),
    txHash: rec.txHash,
    explorerTxUrl: blockchain().explorerTxUrl(rec.txHash),
  };
}
