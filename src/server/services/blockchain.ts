import "server-only";
import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
  NoEntityFoundError,
  type PublicArkivClient,
} from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { eq } from "@arkiv-network/sdk/query";
import { http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ARKIV_CHAIN_ID, ARKIV_EXPLORER, commitmentExpiry, findActiveGrant, verifyHashOnArkiv } from "@/lib/arkiv/read";
import { Commitment, Consent, ShareGrant, key, str, u64, type ConsentAction } from "@/lib/arkiv/schemas";
import type { VerificationResult } from "@/lib/types";
import { env, features } from "@/server/env";
import { errorCode, log } from "@/server/log";

/**
 * BlockchainVerificationService — the trust layer, implemented on Arkiv (Rabdi testnet).
 *
 * Stores only: a document fingerprint (SHA-256), coarse category, language, timestamps, consent
 * actions and share-grant ids. Never personal data. A matching hash proves the file is unchanged
 * since approval — it does not prove the information in it is true.
 */
export interface BlockchainVerificationService {
  readonly configured: boolean;
  readonly writerAddress: Hex | null;
  recordApproval(input: {
    docHash: string;
    category: string;
    lang: string;
    approvedAt: Date;
    retentionUntil: Date;
    method: string;
  }): Promise<{ commitmentKey: Hex; consentKey: Hex; txHash: Hex; expiresAtBlock: string }>;
  recordShare(input: {
    commitmentKey: Hex;
    docHash: string;
    grantId: string;
    expiresAt: Date;
    retentionUntil: Date;
  }): Promise<{ grantKey: Hex; txHash: Hex }>;
  revokeShare(input: { grantKey: Hex | null; commitmentKey: Hex; docHash: string; grantId: string; retentionUntil: Date }): Promise<{ txHash: Hex }>;
  /** Owner-requested erasure: deletes every live Saathi entity for this fingerprint. */
  erase(docHash: string): Promise<{ txHash: Hex | null; deleted: number }>;
  verify(docHash: string): Promise<VerificationResult>;
  isGrantActive(grantId: string): Promise<{ active: boolean; docHash?: string; expiresAtEstimate?: string | null }>;
  commitmentExpiry(entityKey: Hex): Promise<{ expiresAtBlock: string; expiresAtEstimate: string | null } | null>;
  explorerTxUrl(txHash: string): string;
}

const nowSeconds = (d = new Date()) => BigInt(Math.floor(d.getTime() / 1000));

class ArkivVerificationService implements BlockchainVerificationService {
  readonly configured = true;
  readonly writerAddress: Hex;
  private readonly wallet;
  private readonly reader: PublicArkivClient;
  /** Writes are serialised: predicted entity keys and tx nonces both assume one in-flight batch. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(privateKey: Hex, accessKey: string) {
    const chain = rabdi({ accessKey });
    const account = privateKeyToAccount(privateKey);
    this.writerAddress = account.address;
    this.wallet = createWalletClient({ chain, transport: http(), account });
    this.reader = createPublicClient({ chain, transport: http() });
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  explorerTxUrl(txHash: string) {
    return `${ARKIV_EXPLORER}/tx/${txHash}`;
  }

  private consent(commitmentKey: Hex, docHash: string, action: ConsentAction, method: string, retentionUntil: Date, ref?: string) {
    return {
      schema: Consent,
      values: {
        commitment: key(commitmentKey),
        docHash: str(docHash),
        action: str(action),
        occurredAt: u64(nowSeconds()),
        method: str(method),
        ...(ref ? { ref: str(ref) } : {}),
      },
      expiration: ExpirationTime.atDate(retentionUntil, { atLeast: ExpirationTime.fromHours(1) }),
      flags: { readonly: true },
    };
  }

  recordApproval(input: Parameters<BlockchainVerificationService["recordApproval"]>[0]) {
    return this.serial(async () => {
      // Commitment + consent land atomically in one transaction; the consent references the
      // commitment's key, which is predicted before sending.
      const [c, k] = await this.reader.predictEntityKeys({ owner: this.writerAddress, count: 2 });
      const expiration = ExpirationTime.atDate(input.retentionUntil, { atLeast: ExpirationTime.fromHours(1) });
      const res = await this.wallet.executeBatch({
        creates: [
          {
            schema: Commitment,
            values: {
              docHash: str(input.docHash),
              category: str(input.category),
              lang: str(input.lang),
              approvedAt: u64(nowSeconds(input.approvedAt)),
            },
            expiration,
            salt: c.salt,
            flags: { readonly: true },
          },
          {
            schema: Consent,
            values: {
              commitment: key(c.key),
              docHash: str(input.docHash),
              action: str("approve"),
              occurredAt: u64(nowSeconds(input.approvedAt)),
              method: str(input.method),
            },
            expiration,
            salt: k.salt,
            flags: { readonly: true },
          },
        ],
      });
      const [commitmentKey, consentKey] = res.createdEntities;
      if (commitmentKey !== c.key) log.warn("arkiv.key_prediction_mismatch", { txHash: res.txHash });
      const expiry = await commitmentExpiry(this.reader, commitmentKey).catch(() => null);
      log.info("arkiv.approval_recorded", { entityKey: commitmentKey, txHash: res.txHash });
      return {
        commitmentKey,
        consentKey,
        txHash: res.txHash,
        expiresAtBlock: expiry ? expiry.expiresAtBlock.toString() : "",
      };
    });
  }

  recordShare(input: Parameters<BlockchainVerificationService["recordShare"]>[0]) {
    return this.serial(async () => {
      const res = await this.wallet.executeBatch({
        creates: [
          {
            schema: ShareGrant,
            values: {
              commitment: key(input.commitmentKey),
              docHash: str(input.docHash),
              grantId: str(input.grantId),
              issuedAt: u64(nowSeconds()),
            },
            // The link's lifetime is enforced by Arkiv: when this entity expires, the link stops working.
            expiration: ExpirationTime.atDate(input.expiresAt),
          },
          this.consent(input.commitmentKey, input.docHash, "share", "tap", input.retentionUntil, input.grantId),
        ],
      });
      log.info("arkiv.share_recorded", { entityKey: res.createdEntities[0], txHash: res.txHash });
      return { grantKey: res.createdEntities[0], txHash: res.txHash };
    });
  }

  revokeShare(input: Parameters<BlockchainVerificationService["revokeShare"]>[0]) {
    return this.serial(async () => {
      let alive = false;
      if (input.grantKey) {
        try {
          await this.reader.getEntity(input.grantKey);
          alive = true;
        } catch (err) {
          if (!(err instanceof NoEntityFoundError)) throw err;
        }
      }
      const res = await this.wallet.executeBatch({
        deletes: alive && input.grantKey ? [{ entityKey: input.grantKey }] : [],
        creates: [this.consent(input.commitmentKey, input.docHash, "revoke_share", "tap", input.retentionUntil, input.grantId)],
      });
      log.info("arkiv.share_revoked", { txHash: res.txHash });
      return { txHash: res.txHash };
    });
  }

  erase(docHash: string) {
    return this.serial(async () => {
      const keys: Hex[] = [];
      for (const schema of [Commitment, Consent, ShareGrant]) {
        const page = await this.reader
          .select({ $key: true })
          .from(schema)
          .where(eq("docHash", str(docHash)))
          .createdBy(this.writerAddress)
          .limit(100)
          .fetch();
        keys.push(...page.entities.map((e) => e.$key));
      }
      if (!keys.length) return { txHash: null, deleted: 0 };
      const res = await this.wallet.executeBatch({ deletes: keys.map((entityKey) => ({ entityKey })) });
      log.info("arkiv.erased", { txHash: res.txHash });
      return { txHash: res.txHash, deleted: keys.length };
    });
  }

  verify(docHash: string) {
    return verifyHashOnArkiv(this.reader, docHash, this.writerAddress);
  }

  async isGrantActive(grantId: string) {
    const grant = await findActiveGrant(this.reader, grantId, this.writerAddress);
    return grant ? { active: true, docHash: grant.docHash, expiresAtEstimate: grant.expiresAtEstimate } : { active: false };
  }

  async commitmentExpiry(entityKey: Hex) {
    try {
      const e = await commitmentExpiry(this.reader, entityKey);
      return { expiresAtBlock: e.expiresAtBlock.toString(), expiresAtEstimate: e.expiresAtEstimate };
    } catch (err) {
      if (err instanceof NoEntityFoundError) return null;
      log.warn("arkiv.read_failed", { code: errorCode(err) });
      throw err;
    }
  }
}

class NotConfigured implements BlockchainVerificationService {
  readonly configured = false;
  readonly writerAddress = null;
  private fail(): never {
    throw new Error("Arkiv is not configured");
  }
  recordApproval = async () => this.fail();
  recordShare = async () => this.fail();
  revokeShare = async () => this.fail();
  erase = async () => ({ txHash: null, deleted: 0 });
  verify = async (docHash: string): Promise<VerificationResult> => ({
    sha256: docHash,
    status: "unavailable",
    history: [],
    checkedAgainst: "none",
    message: "Arkiv is not configured on this server.",
  });
  isGrantActive = async () => ({ active: false });
  commitmentExpiry = async () => null;
  explorerTxUrl = (txHash: string) => `${ARKIV_EXPLORER}/tx/${txHash}`;
}

let instance: BlockchainVerificationService | null = null;
export function blockchain(): BlockchainVerificationService {
  instance ??= features.arkiv()
    ? new ArkivVerificationService(env.arkivPrivateKey as Hex, env.arkivAccessKey)
    : new NotConfigured();
  return instance;
}

export const arkivInfo = () => ({
  configured: blockchain().configured,
  writerAddress: blockchain().writerAddress,
  chainId: ARKIV_CHAIN_ID,
  explorerUrl: ARKIV_EXPLORER,
});
