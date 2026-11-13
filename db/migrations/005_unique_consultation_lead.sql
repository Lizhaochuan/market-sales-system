-- V3.2-02: one actual consultation should not create duplicate independent leads.
-- A lead may link many students, preserving student-first sales opportunities.
-- Execute ONLY on a new isolated demo database after 004_contact_event_owner_scope.sql.
BEGIN;
CREATE UNIQUE INDEX uq_lead_original_contact_event
  ON ms.leads(source_event_id) WHERE source_event_id IS NOT NULL;
COMMIT;
