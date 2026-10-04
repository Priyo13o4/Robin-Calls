-- 0008 — Detection pack (scan-capacity PRD §15.4–§15.6, amended 2026-07-14)
--
--   * market_snapshots: unique-trader counts feeding the wash-trading check
--   * token_marks: second permanent mark kind — 'pump_dump' (postmortem)
--   * record_token_mark / lift_token_mark: kind-generic mark lifecycle,
--     sharing the exact semantics of record_honeypot_mark (0006): advisory
--     lock per token:kind, created / re-fired / re-armed, audited pardons.
--
-- Apply AFTER 0007. The legacy honeypot-specific functions stay in place and
-- keep working; new mark kinds use the generic pair.

-- ── 1. market_snapshots: unique traders (§16.3a) ──
-- GeckoTerminal supplies buyers/sellers per window; DexScreener does not —
-- rows from DexScreener leave these null and the wash check says so.
alter table public.market_snapshots
  add column if not exists buyers_24h integer,
  add column if not exists sellers_24h integer;

-- ── 2. token_marks: allow the pump_dump kind ──
alter table public.token_marks
  drop constraint if exists token_marks_kind_check;
alter table public.token_marks
  add constraint token_marks_kind_check check (kind in ('honeypot', 'pump_dump'));

-- ── 3. kind-generic mark recording ──
-- Serialize transitions per (token, kind) so concurrent jobs can't lose
-- fired_count increments or race an admin pardon.
create or replace function public.record_token_mark(
  p_kind text,
  p_token_address text,
  p_verdict_id bigint,
  p_evidence jsonb,
  p_liquidity_usd numeric
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := lower(p_token_address);
  v_mark public.token_marks%rowtype;
  v_action text;
begin
  if p_kind not in ('honeypot', 'pump_dump') then
    raise exception 'unknown mark kind %', p_kind;
  end if;
  if v_token !~ '^0x[0-9a-f]{40}$' then
    raise exception 'invalid token address';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_token || ':' || p_kind, 0));

  select * into v_mark
  from public.token_marks
  where token_address = v_token and kind = p_kind
  for update;

  if not found then
    insert into public.token_marks (
      token_address, kind, source_verdict_id, evidence, liquidity_usd_at_mark
    ) values (
      v_token, p_kind, p_verdict_id, coalesce(p_evidence, '{}'::jsonb), p_liquidity_usd
    );
    v_action := 'created';
  else
    v_action := case when v_mark.lifted_at is null then 're-fired' else 're-armed' end;
    update public.token_marks
    set fired_count = fired_count + 1,
        evidence = coalesce(p_evidence, v_mark.evidence),
        updated_at = now(),
        lifted_at = null,
        lifted_reason = null,
        lifted_by = null
    where id = v_mark.id;
  end if;

  insert into public.mark_events (
    token_address, kind, action, actor, reason, verdict_id
  ) values (
    v_token, p_kind, v_action, 'system', null, p_verdict_id
  );

  return v_action;
end;
$$;

create or replace function public.lift_token_mark(
  p_kind text,
  p_token_address text,
  p_reason text,
  p_actor text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := lower(p_token_address);
begin
  if p_kind not in ('honeypot', 'pump_dump') then
    raise exception 'unknown mark kind %', p_kind;
  end if;
  if v_token !~ '^0x[0-9a-f]{40}$' or length(trim(p_reason)) < 8 then
    raise exception 'invalid pardon request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_token || ':' || p_kind, 0));

  update public.token_marks
  set lifted_at = now(),
      lifted_reason = trim(p_reason),
      lifted_by = p_actor,
      updated_at = now()
  where token_address = v_token and kind = p_kind;

  if not found then raise exception '% mark not found', p_kind; end if;

  insert into public.mark_events (
    token_address, kind, action, actor, reason, verdict_id
  ) values (
    v_token, p_kind, 'lifted', p_actor, trim(p_reason), null
  );
end;
$$;

revoke all on function public.record_token_mark(text, text, bigint, jsonb, numeric)
  from public;
revoke all on function public.lift_token_mark(text, text, text, text)
  from public;
