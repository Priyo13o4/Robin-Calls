-- 0095: add price_change_h1 to launch_state for DexScreener 1h price change.
alter table launch_state add column if not exists price_change_h1 numeric;
