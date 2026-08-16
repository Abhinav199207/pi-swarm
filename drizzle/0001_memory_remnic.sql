CREATE TABLE IF NOT EXISTS memory_scope_grants (
  id UUID PRIMARY KEY,
  grantee_type TEXT NOT NULL CHECK (grantee_type IN ('persona', 'run', 'service')),
  grantee_id UUID NOT NULL,
  scope_pattern TEXT NOT NULL,
  can_read BOOLEAN NOT NULL DEFAULT TRUE,
  can_propose_write BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ NULL,
  UNIQUE (grantee_type, grantee_id, scope_pattern)
);

CREATE TABLE IF NOT EXISTS memory_candidates (
  id UUID PRIMARY KEY,
  trace_id UUID NULL,
  source_persona_id UUID NULL REFERENCES personas(id),
  source_run_id UUID NULL,
  scope TEXT NOT NULL,
  kind TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  statement TEXT NOT NULL,
  rationale TEXT NULL,
  provenance JSONB NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  disposition TEXT NOT NULL,
  remnic_memory_id TEXT NULL UNIQUE,
  expires_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reviewed_at TIMESTAMPTZ NULL,
  reviewed_by TEXT NULL
);

CREATE INDEX IF NOT EXISTS memory_candidates_scope_idx ON memory_candidates(scope);
CREATE INDEX IF NOT EXISTS memory_candidates_disposition_idx ON memory_candidates(disposition);
CREATE INDEX IF NOT EXISTS memory_candidates_trace_idx ON memory_candidates(trace_id);

CREATE TABLE IF NOT EXISTS memory_recall_audit (
  id UUID PRIMARY KEY,
  request_id UUID NOT NULL,
  persona_id UUID NOT NULL REFERENCES personas(id),
  run_id UUID NULL,
  query_hash CHAR(64) NOT NULL,
  allowed_scopes JSONB NOT NULL,
  retrieved_memory_ids JSONB NOT NULL,
  rendered_char_count INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS memory_recall_audit_persona_idx ON memory_recall_audit(persona_id, created_at DESC);
