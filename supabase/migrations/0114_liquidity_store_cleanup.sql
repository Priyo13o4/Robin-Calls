-- Delete retired blob-cache keys superseded by durable pool liquidity history store.
delete from public.pool_log_index where split_part(cache_key, ':', 1) in ('v3pull2','v3add2','v3mint','v4mod2','v3pull','v3add','v2pull','v4mod','v4pull');
