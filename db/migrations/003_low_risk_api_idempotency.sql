-- V3.2-01 dedicated idempotency receipts for isolated low-risk writes
BEGIN;
CREATE TABLE ms.api_write_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES ms.organizations(id),
  actor_user_id UUID NOT NULL REFERENCES ms.staff_users(id),
  request_key TEXT NOT NULL CHECK (length(request_key) BETWEEN 16 AND 128),
  operation_name TEXT NOT NULL,
  request_digest TEXT NOT NULL,
  response_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id,actor_user_id,request_key)
);
CREATE INDEX ix_api_write_receipts_created ON ms.api_write_receipts(created_at);
COMMIT;
