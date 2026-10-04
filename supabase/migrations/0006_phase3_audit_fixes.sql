-- Phase 3 audit follow-up. Migration 0005 may already be applied.
-- This migration tightens stain identity, adds missing FK indexes, and makes
-- mark create/re-fire/re-arm/lift transitions atomic and auditable.

-- Backfill any legacy orphan stains to the newest rug for their origin wallet.
with newest_rug as (
  select distinct on (d.address)
    d.address,
    r.id as rug_id
  from public.deployers d
  join public.rugs r on r.deployer_id = d.id
  order by d.address, r.created_at desc, r.id desc
)
update public.wallet_stains ws
set origin_rug_id = nr.rug_id
from newest_rug nr
where ws.origin_rug_id is null
  and lower(ws.origin_deployer) = lower(nr.address);

-- A stain without a rug receipt is not re-verifiable and must not remain active.
delete from public.wallet_stains where origin_rug_id is null;

alter table public.wallet_stains
  alter column origin_rug_id set not null;

create index if not exists token_marks_source_verdict_idx
  on public.token_marks (source_verdict_id);
create index if not exists mark_events_verdict_idx
  on public.mark_events (verdict_id);
create index if not exists wallet_stains_origin_rug_idx
  on public.wallet_stains (origin_rug_id);

-- Serialize transitions for one token. This prevents concurrent scans from
-- losing fired_count increments or racing an admin pardon.
create or replace function public.record_honeypot_mark(
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
  if v_token !~ '^0x[0-9a-f]{40}$' then
    raise exception 'invalid token address';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_token || ':honeypot', 0));

  select * into v_mark
  from public.token_marks
  where token_address = v_token and kind = 'honeypot'
  for update;

  if not found then
    insert into public.token_marks (
      token_address, kind, source_verdict_id, evidence, liquidity_usd_at_mark
    ) values (
      v_token, 'honeypot', p_verdict_id, coalesce(p_evidence, '{}'::jsonb), p_liquidity_usd
    );
    v_action := 'created';
  else
    v_action := case when v_mark.lifted_at is null then 're-fired' else 're-armed' end;
    update public.token_marks
    set fired_count = fired_count + 1,
        updated_at = now(),
        lifted_at = null,
        lifted_reason = null,
        lifted_by = null
    where id = v_mark.id;
  end if;

  insert into public.mark_events (
    token_address, kind, action, actor, reason, verdict_id
  ) values (
    v_token, 'honeypot', v_action, 'system', null, p_verdict_id
  );

  return v_action;
end;
$$;

create or replace function public.lift_honeypot_mark(
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
  if v_token !~ '^0x[0-9a-f]{40}$' or length(trim(p_reason)) < 8 then
    raise exception 'invalid pardon request';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_token || ':honeypot', 0));

  update public.token_marks
  set lifted_at = now(),
      lifted_reason = trim(p_reason),
      lifted_by = p_actor,
      updated_at = now()
  where token_address = v_token and kind = 'honeypot';

  if not found then raise exception 'honeypot mark not found'; end if;

  insert into public.mark_events (
    token_address, kind, action, actor, reason, verdict_id
  ) values (
    v_token, 'honeypot', 'lifted', p_actor, trim(p_reason), null
  );
end;
$$;

revoke all on function public.record_honeypot_mark(text, bigint, jsonb, numeric)
  from public;
revoke all on function public.lift_honeypot_mark(text, text, text)
  from public;

-- mark_events is append-only, including for privileged application code.
create or replace function public.reject_mark_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'mark_events is append-only';
end;
$$;

drop trigger if exists mark_events_append_only on public.mark_events;
create trigger mark_events_append_only
before update or delete on public.mark_events
for each row execute function public.reject_mark_event_mutation();
