#!/bin/sh
# Runs once when the Postgres volume is first initialised.
# Creates the schema owner (used only by migrations/seeds) and LOGIN users for
# the API and worker that inherit from the NOLOGIN group roles the migrations
# grant privileges to. None of them is a superuser or has BYPASSRLS.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<SQL
CREATE ROLE tc_api NOLOGIN NOBYPASSRLS;
CREATE ROLE tc_worker NOLOGIN NOBYPASSRLS;
CREATE ROLE tc_auth NOLOGIN NOBYPASSRLS;

CREATE ROLE tc_migrator LOGIN PASSWORD '${TC_MIGRATOR_PASSWORD}' NOSUPERUSER NOBYPASSRLS CREATEROLE;
CREATE ROLE tc_api_login LOGIN PASSWORD '${TC_API_PASSWORD}' NOSUPERUSER NOBYPASSRLS IN ROLE tc_api;
CREATE ROLE tc_worker_login LOGIN PASSWORD '${TC_WORKER_PASSWORD}' NOSUPERUSER NOBYPASSRLS IN ROLE tc_worker;
CREATE ROLE tc_auth_login LOGIN PASSWORD '${TC_AUTH_PASSWORD}' NOSUPERUSER NOBYPASSRLS IN ROLE tc_auth;

ALTER DATABASE "$POSTGRES_DB" OWNER TO tc_migrator;
ALTER SCHEMA public OWNER TO tc_migrator;
-- Extensions need elevated rights; install them here so migrations can run as tc_migrator.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL
