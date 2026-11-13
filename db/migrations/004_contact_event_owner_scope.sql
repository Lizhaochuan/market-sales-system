-- V3.2-01 supplemental permissions: claim ownership of unlinked contacts/events.
-- Existing legacy rows are intentionally UNOWNED and require manager review.
BEGIN;
ALTER TABLE ms.contacts
  ADD COLUMN created_by UUID REFERENCES ms.staff_users(id);
ALTER TABLE ms.contact_events
  ADD COLUMN recorded_by UUID REFERENCES ms.staff_users(id);
CREATE INDEX ix_contacts_creator ON ms.contacts(organization_id,created_by)
  WHERE created_by IS NOT NULL AND archived_at IS NULL;
CREATE INDEX ix_contact_events_recorder ON ms.contact_events(organization_id,recorded_by)
  WHERE recorded_by IS NOT NULL;
COMMIT;
