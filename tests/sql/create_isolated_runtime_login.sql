-- ONLY FOR GITHUB ACTIONS / FRESH FICTIONAL DATABASE.
-- Use psql -v app_password=... ; never create real credentials this way.
\set ON_ERROR_STOP on
CREATE ROLE ms_isolated_api LOGIN INHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE ms_isolated_api PASSWORD :'app_password';
GRANT ms_lowrisk_runtime TO ms_isolated_api;
-- LOGIN is not owner of any business table and cannot CREATE schema objects.
DO $checks$
BEGIN
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='ms_isolated_api'
    AND (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole)) THEN
    RAISE EXCEPTION 'Isolated API login has forbidden elevated flags';
  END IF;
  IF NOT pg_has_role('ms_isolated_api','ms_lowrisk_runtime','member') THEN
    RAISE EXCEPTION 'Isolated API login lacks explicit low-risk role membership';
  END IF;
END $checks$;
