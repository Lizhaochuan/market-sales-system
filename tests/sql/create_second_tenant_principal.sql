-- CI ONLY: 2 fictional organizations mapped to 2 separate nonowner logins.
-- Run AFTER 010 and 001-009 seed, using psql -v app_password_b=...
\set ON_ERROR_STOP on
BEGIN;
INSERT INTO ms.organizations (id,name)
VALUES ('20000000-0000-4000-8000-000000000002','虚构第二教学机构');
INSERT INTO ms.staff_users(id,organization_id,display_name,status)
VALUES ('20000000-0000-4000-8000-000000000021',
  '20000000-0000-4000-8000-000000000002','虚构B机构销售','active');
INSERT INTO ms.database_principal_tenants(principal_name,organization_id) VALUES
 ('ms_isolated_api','20000000-0000-4000-8000-000000000001'),
 ('ms_isolated_api_b','20000000-0000-4000-8000-000000000002');
COMMIT;

CREATE ROLE ms_isolated_api_b LOGIN INHERIT NOSUPERUSER NOCREATEDB
  NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_isolated_api_b PASSWORD :'app_password_b';
GRANT ms_lowrisk_runtime TO ms_isolated_api_b;
-- Role creation/mapping changes must be performed by migration owner,
-- never using an application LOGIN.
DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles
             WHERE rolname='ms_isolated_api_b'
               AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'B test runtime is overprivileged';
  END IF;
END $verify$;
