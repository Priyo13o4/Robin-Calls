-- 0096: add peak_liquidity_usd and zero_liquidity_readings to launch_state for liquidity pulled detection.
alter table launch_state add column if not exists peak_liquidity_usd numeric;
alter table launch_state add column if not exists zero_liquidity_readings integer not null default 0;
