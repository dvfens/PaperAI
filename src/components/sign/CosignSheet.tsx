"use client";

import { Signature } from "lucide-react";
import { useEffect, useState } from "react";
import { api, ApiError, errorKey } from "@/lib/client/api";
import { signDocument } from "@/lib/client/signer";
import type { StringKey } from "@/lib/i18n";
import { COSIGN_ROLES, type CosignRole } from "@/lib/signing";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice, SpeakButton } from "@/components/common/Chrome";
import { useApp } from "@/components/app/AppContext";

export const ROLE_LABEL: Record<CosignRole, StringKey> = {
  witness: "roleWitness",
  guarantor: "roleGuarantor",
  family: "roleFamily",
  official: "roleOfficial",
};

export type CosignResult = Awaited<ReturnType<typeof api.cosign>>;

/**
 * Co-sign a document someone shared: pick who you are signing as, then one tap. This phone's key
 * signs the exact document shown; Saathi records the signature on Arkiv — never a name.
 */
export function CosignSheet({
  open,
  onOpenChange,
  token,
  docHash,
  onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  /** SHA-256 of the file this person was shown (checked against the link's record before signing). */
  docHash: string;
  onDone: (result: CosignResult) => void;
}) {
  const { t, speak, stopSpeaking } = useApp();
  const [role, setRole] = useState<CosignRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const spoken = `${t("cosignLine")} ${t("cosignWhat")}`;

  useEffect(() => {
    if (!open) return;
    setError(null);
    void speak(spoken);
    return () => stopSpeaking();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const cosign = async () => {
    if (!role) return;
    setBusy(true);
    setError(null);
    stopSpeaking();
    try {
      const proof = await signDocument(docHash, Math.floor(Date.now() / 1000), "tap", role);
      onDone(await api.cosign(token, proof));
    } catch (err) {
      setError(
        err instanceof ApiError && err.code === "already_signed"
          ? "cosignAlready"
          : err instanceof ApiError && err.code === "link_expired"
            ? "sharedExpired"
            : errorKey(err),
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)} title={t("cosignTitle")} closeLabel={t("close")}>
      <div className="flex flex-col gap-4">
        <div className="flex items-start gap-3">
          <p className="min-w-0 flex-1 pt-2 text-[15px] text-slate-700">{t("cosignLine")}</p>
          <SpeakButton text={spoken} />
        </div>

        <fieldset>
          <legend className="mb-1.5 px-1 text-[13px] font-semibold text-slate-600">{t("cosignAs")}</legend>
          <div className="grid grid-cols-2 gap-2">
            {COSIGN_ROLES.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={role === r}
                onClick={() => setRole(r)}
                className={cn(
                  "min-h-12 rounded-xl border-2 px-3 py-2 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-300",
                  role === r ? "border-blue-600 bg-blue-50 text-blue-800" : "border-slate-200 bg-white text-slate-800 hover:border-blue-300",
                )}
              >
                {t(ROLE_LABEL[r])}
              </button>
            ))}
          </div>
        </fieldset>

        <p className="text-[13px] text-slate-600">{t("cosignWhat")}</p>

        {error && <Notice tone="error">{t(error)}</Notice>}

        <Button block disabled={!role || busy} onClick={cosign}>
          <Signature aria-hidden /> {busy ? t("cosigning") : t("cosignButton")}
        </Button>
      </div>
    </Dialog>
  );
}
