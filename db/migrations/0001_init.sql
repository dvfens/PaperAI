-- Saathi application metadata schema (PostgreSQL 15+ / PGlite).
-- No personal data: no names, answers, transcripts or document text are stored in these tables.

CREATE TABLE IF NOT EXISTS documents (
  id                   text PRIMARY KEY,
  owner_hash           text NOT NULL,
  status               text NOT NULL,
  category             text NOT NULL,
  language             text NOT NULL,
  page_count           integer NOT NULL,
  field_count          integer NOT NULL,
  sha256               text NOT NULL,
  size_bytes           integer NOT NULL,
  storage_key          text,
  wrapped_key          text,
  created_at           timestamptz NOT NULL DEFAULT now(),
  approved_at          timestamptz NOT NULL,
  retention_until      timestamptz NOT NULL,
  erased_at            timestamptz,
  arkiv_status         text NOT NULL,
  arkiv_commitment_key text,
  arkiv_consent_key    text,
  arkiv_tx_hash        text,
  arkiv_expires_block  text,
  arkiv_error          text
);
CREATE INDEX IF NOT EXISTS documents_sha256_idx ON documents (sha256);
CREATE INDEX IF NOT EXISTS documents_owner_idx ON documents (owner_hash);

CREATE TABLE IF NOT EXISTS share_links (
  id              text PRIMARY KEY,
  document_id     text NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  grant_id        text NOT NULL,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  arkiv_status    text NOT NULL,
  arkiv_grant_key text,
  arkiv_tx_hash   text,
  access_count    integer NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS share_links_document_idx ON share_links (document_id);

CREATE TABLE IF NOT EXISTS audit_events (
  id          bigserial PRIMARY KEY,
  document_id text,
  event       text NOT NULL,
  at          timestamptz NOT NULL DEFAULT now(),
  meta        jsonb
);
CREATE INDEX IF NOT EXISTS audit_events_document_idx ON audit_events (document_id);
