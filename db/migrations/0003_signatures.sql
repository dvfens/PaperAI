-- Finger signatures: the signer's phone key (a public address, not a name), when they signed, and the
-- Arkiv entity that holds the signature. The drawn signature itself exists only inside the encrypted PDF.

ALTER TABLE documents ADD COLUMN IF NOT EXISTS signer text;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS signed_at timestamptz;
ALTER TABLE documents ADD COLUMN IF NOT EXISTS arkiv_signature_key text;
