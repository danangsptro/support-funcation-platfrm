#!/bin/sh
# Dijalankan sekali oleh image postgres saat volume data masih kosong.
# app_owner  : pemilik database/skema, dipakai migration & seed.
# app_runtime: dipakai API; hak DML diberikan oleh migration, bukan owner/superuser.
set -eu
: "${APP_OWNER_PASSWORD:?APP_OWNER_PASSWORD wajib}"
: "${APP_RUNTIME_PASSWORD:?APP_RUNTIME_PASSWORD wajib}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v owner_pw="$APP_OWNER_PASSWORD" -v runtime_pw="$APP_RUNTIME_PASSWORD" <<'SQL'
CREATE ROLE app_owner LOGIN PASSWORD :'owner_pw' NOSUPERUSER NOCREATEROLE NOREPLICATION CREATEDB;
CREATE ROLE app_runtime LOGIN PASSWORD :'runtime_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE support OWNER app_owner;
CREATE DATABASE support_test OWNER app_owner;
REVOKE ALL ON DATABASE support FROM PUBLIC;
REVOKE ALL ON DATABASE support_test FROM PUBLIC;
GRANT CONNECT ON DATABASE support TO app_runtime;
GRANT CONNECT ON DATABASE support_test TO app_runtime;
SQL
