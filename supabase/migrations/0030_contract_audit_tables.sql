-- ─────────────────────────────────────────────────────────────
-- Full Contract and Authority Audit (docs/ways-of-work/plan/contract-audit/
-- full-contract-authority-audit/implementation-plan.md) — schema only, no
-- scoring change. Four tables:
--
-- 1. contract_audit_artifact: immutable static analysis, cached per
--    (chain_id, runtime_code_hash, rule_version). Multiple proxy instances
--    sharing one implementation's bytecode share one artifact row.
-- 2. contract_audit_instance: per-address, per-block analysis (proxy graph,
--    resolved authorities, findings) — cached per (address, block_hash,
--    rule_version), references the artifact it resolved to.
-- 3. trust_review_candidate: discovered infrastructure/relationships awaiting
--    admin review. Never auto-promoted — see trust_assertion.
-- 4. trust_assertion: claim-scoped, admin-approved trust. Deliberately
--    separate from trusted_address (0027): that table's (address, chain_id)
--    uniqueness allows only one role per address, but a proxy's beacon,
--    admin, and implementation can each need their own scoped claim on the
--    same or related addresses (trust_scope distinguishes AUTHENTICITY from
--    CODE_TEMPLATE from UPGRADE_AUTHORITY from CUSTODY_LOCK, etc.). Never
--    infer CUSTODY_LOCK from any other scope — a beacon being canonical does
--    not make a vault's liquidity locked.
--
-- These tables are reachable only through the private application DB
-- connection and are not public-facing;
-- the verdict's contractAudit evidence block is what the client sees, not the
-- raw tables.
-- ─────────────────────────────────────────────────────────────

create table if not exists public.contract_audit_artifact (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 4663,
  -- Exact, un-stripped runtime code hash — the cache identity. Two deployments
  -- that differ only in embedded CBOR metadata get separate artifact rows on
  -- purpose: their verified source/ABI can genuinely differ even when their
  -- executable bytecode is equivalent.
  runtime_code_hash text not null check (runtime_code_hash ~ '^0x[0-9a-f]{64}$'),
  -- CBOR-metadata-stripped hash (lib/scanner/clone.ts::computeBytecodeHash),
  -- stored for clone-family grouping ONLY — never used as cache identity, so a
  -- stripped-bytecode match alone can never serve one contract's ABI/source
  -- evidence for another.
  template_hash text,
  rule_version text not null,
  abi_hash text,
  source_hash text,
  capabilities jsonb not null default '[]'::jsonb,
  completeness text not null check (completeness in ('complete', 'partial', 'unresolved')),
  source_bytes integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chain_id, runtime_code_hash, rule_version)
);

create index if not exists contract_audit_artifact_template_idx
  on public.contract_audit_artifact (template_hash) where template_hash is not null;

create table if not exists public.contract_audit_instance (
  id uuid primary key default gen_random_uuid(),
  address text not null check (address = lower(address) and address ~ '^0x[0-9a-f]{40}$'),
  block_hash text not null,
  rule_version text not null,
  artifact_id uuid not null references public.contract_audit_artifact (id),
  proxy_graph jsonb not null default '{}'::jsonb,
  authorities jsonb not null default '{}'::jsonb,
  findings jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  unique (address, block_hash, rule_version)
);

create index if not exists contract_audit_instance_artifact_idx
  on public.contract_audit_instance (artifact_id);
create index if not exists contract_audit_instance_address_idx
  on public.contract_audit_instance (address, created_at desc);

create table if not exists public.trust_review_candidate (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 4663,
  subject_address text not null check (subject_address = lower(subject_address) and subject_address ~ '^0x[0-9a-f]{40}$'),
  candidate_type text not null check (candidate_type in (
    'PROXY_IMPLEMENTATION_CANDIDATE', 'BEACON_CANDIDATE', 'PROXY_ADMIN_CANDIDATE',
    'TIMELOCK_CONTROLLER_CANDIDATE', 'MULTISIG_CONTROLLER_CANDIDATE', 'ACCESS_CONTROLLER_CANDIDATE',
    'PROTOCOL_FACTORY_CANDIDATE', 'PROTOCOL_VAULT_CANDIDATE', 'PROTOCOL_FARM_STRATEGY_CANDIDATE',
    'LP_LOCKER_CANDIDATE', 'MULTISIG_CUSTODIAN_CANDIDATE', 'DEX_INFRA_CANDIDATE',
    'TRUST_ASSERTION_DRIFT', 'CUSTOM_PROXY_UNRESOLVED'
  )),
  -- Disambiguates repeats of the same (subject, type) under a different
  -- parent/relationship, e.g. the same implementation reached via two
  -- different beacons. Empty string when there is only one relationship.
  relation_hash text not null default '',
  status text not null default 'open' check (status in ('open', 'rejected', 'informational', 'approved', 'suspended')),
  evidence jsonb not null default '{}'::jsonb,
  times_seen integer not null default 1,
  first_token text,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  resolution text,
  unique (chain_id, subject_address, candidate_type, relation_hash)
);

create index if not exists trust_review_candidate_open_idx
  on public.trust_review_candidate (last_seen_at desc)
  where status = 'open';
create index if not exists trust_review_candidate_subject_idx
  on public.trust_review_candidate (subject_address);

create table if not exists public.trust_assertion (
  id uuid primary key default gen_random_uuid(),
  chain_id integer not null default 4663,
  subject_address text not null check (subject_address = lower(subject_address) and subject_address ~ '^0x[0-9a-f]{40}$'),
  category text not null check (category in (
    'dex-factory', 'dex-router', 'dex-quoter', 'dex-position-manager',
    'dex-pool-manager', 'dex-state-view', 'permit2', 'lp-locker',
    'burn-address', 'infra-asset', 'rwa-beacon', 'rwa-impl', 'rwa-factory',
    'rwa-vault', 'rwa-operator', 'bridge-system-owner',
    'protocol-factory', 'protocol-beacon', 'protocol-implementation',
    'protocol-vault', 'protocol-strategy', 'multisig-controller',
    'timelock-controller', 'access-controller'
  )),
  trust_scope text not null check (trust_scope in (
    'AUTHENTICITY', 'CODE_TEMPLATE', 'UPGRADE_AUTHORITY', 'CUSTODY_LOCK', 'DEX_PLUMBING', 'SYSTEM_INFRA'
  )),
  parent_address text check (parent_address is null or (parent_address = lower(parent_address) and parent_address ~ '^0x[0-9a-f]{40}$')),
  expected_code_hash text,
  expected_state jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending', 'approved', 'suspended', 'revoked')),
  reviewer text,
  notes text,
  evidence_hash text,
  verified_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A plain table-level `unique` constraint only accepts column references, not
-- expressions — `coalesce(parent_address, '')` needs a unique index instead.
-- This also makes the null-parent case coalesce to one group (a table-level
-- unique constraint would otherwise treat every null parent_address as
-- distinct, per standard SQL null semantics, allowing unwanted duplicates).
create unique index if not exists trust_assertion_claim_key
  on public.trust_assertion (chain_id, subject_address, category, trust_scope, coalesce(parent_address, ''));

create index if not exists trust_assertion_approved_idx
  on public.trust_assertion (category, trust_scope)
  where status = 'approved';
create index if not exists trust_assertion_subject_idx
  on public.trust_assertion (subject_address);

create or replace function public.set_contract_audit_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists contract_audit_artifact_updated_at on public.contract_audit_artifact;
create trigger contract_audit_artifact_updated_at before update on public.contract_audit_artifact
  for each row execute function public.set_contract_audit_updated_at();

drop trigger if exists trust_assertion_updated_at on public.trust_assertion;
create trigger trust_assertion_updated_at before update on public.trust_assertion
  for each row execute function public.set_contract_audit_updated_at();
