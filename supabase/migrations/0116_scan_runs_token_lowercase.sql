-- Lowercase existing checksummed token addresses in scan_runs to match query filters (KNOWN-PROBLEMS L233).
update public.scan_runs set token_address = lower(token_address) where token_address <> lower(token_address);
