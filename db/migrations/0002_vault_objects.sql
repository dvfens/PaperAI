-- Encrypted document store for deployments without a persistent filesystem (e.g. Vercel).
-- Each row is AES-256-GCM ciphertext; its per-document data key is wrapped with the master key and
-- stored in documents.wrapped_key. Erasing a document deletes the wrapped key and this row from the
-- live database. Copies can survive in the database provider's backups / point-in-time-restore
-- history (e.g. Neon's restore window) until that window passes: keep it short, and rotate
-- DOCUMENT_ENCRYPTION_KEY if erased documents must become unrecoverable sooner.

CREATE TABLE IF NOT EXISTS vault_objects (
  storage_key text PRIMARY KEY,
  ciphertext  bytea NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
