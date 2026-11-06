"use client";

import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { signaturePayload, type SignatureProof, type SignMethod, type SignRole } from "@/lib/signing";

/**
 * This phone's signing key. Created silently the first time the person signs and kept in this
 * browser's storage — no wallet, no seed phrase, no sign-in. It never leaves the phone; only the
 * signatures it makes (and its public address) do.
 */
const STORAGE_KEY = "saathi.signerKey.v1";
let account: PrivateKeyAccount | null = null;

function load(): PrivateKeyAccount {
  if (account) return account;
  let key: Hex | null = null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && /^0x[0-9a-f]{64}$/i.test(stored)) key = stored as Hex;
  } catch {
    // Storage blocked (private window): the key lives for this visit only; signing still works.
  }
  if (!key) {
    key = generatePrivateKey();
    try {
      localStorage.setItem(STORAGE_KEY, key);
    } catch {
      // see above
    }
  }
  account = privateKeyToAccount(key);
  return account;
}

/** The public address of this phone's key (printed on the signature page and recorded on Arkiv). */
export function signerAddress(): Hex {
  return load().address;
}

/** Sign a finished document's fingerprint with this phone's key. */
export async function signDocument(docHash: string, signedAt: number, method: SignMethod, role: SignRole = "signer"): Promise<SignatureProof> {
  const acct = load();
  const signature = await acct.signTypedData(signaturePayload(docHash, signedAt, method, role));
  return { signer: acct.address, signedAt, method, role, signature };
}
