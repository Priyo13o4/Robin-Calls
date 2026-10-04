-- Keep the trigger helper's object lookup deterministic under every caller role.
create or replace function public.set_trusted_address_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;
