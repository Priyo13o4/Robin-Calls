# ─────────────────────────────────────────────────────────────
# Plain Postgres 18 + pg_cron. That's it.
#
# Earlier revision of this file also compiled pg_net (Rust/pgrx) and
# pgsodium/supabase_vault from source to reproduce Supabase's HTTP-call-from-
# cron trick. Dropped: those are Supabase's own bespoke, barely-packaged
# extensions (unlike e.g. pgvector, which ships official prebuilt packages
# and images) — pgrx's CLI didn't even recognize PG18 yet when tested
# 2026-07-20, and chasing a matching pgrx/pg_net version pin is exactly the
# unofficial-combination risk that isn't worth it for what this buys.
#
# What pg_net/vault actually did here: let a pg_cron job POST to a Next.js
# job route. Postgres can do that on its own via `COPY ... TO PROGRAM
# 'curl ...'` (superuser/COPY-PROGRAM privilege, no extension needed) — see
# supabase/migrations/0002_cron.sql's call_robincalls_job(). The 2 secrets
# vault "encrypted" (site URL, job secret) now live in a plain settings
# table instead — the job secret is already sitting in the app's own env var
# unencrypted anyway, so a second encrypted copy inside Postgres wasn't
# buying real protection.
FROM postgres:18-bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN . /etc/os-release \
    && apt-get update && apt-get install -y --no-install-recommends \
       curl ca-certificates \
    && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
       -o /usr/share/keyrings/pgdg.asc \
    && echo "deb [signed-by=/usr/share/keyrings/pgdg.asc] http://apt.postgresql.org/pub/repos/apt ${VERSION_CODENAME}-pgdg main" \
       > /etc/apt/sources.list.d/pgdg.list \
    && apt-get update \
    && apt-get install -y --no-install-recommends postgresql-18-cron \
    && rm -rf /var/lib/apt/lists/*
