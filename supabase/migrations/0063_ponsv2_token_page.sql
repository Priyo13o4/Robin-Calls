-- Pons V2's token-page URL, and the reason this row was empty.
--
-- Migration 0062 created the `ponsv2` and `stonksafe` pads with `config = {}`.
-- `launchpadUrl` (app/components/site/WatchlistTabs.tsx) then fell through to
-- `https://${slug}` — so every Pons V2 card on the watchlist linked to
-- **`https://ponsv2`**, which is not a domain. That fallback is gone; a pad
-- with no configured page now renders no link at all. This row is the other
-- half: giving the pad a real one.
--
-- VERIFIED, not inferred from the v1 row. Pons V1 stores
-- `https://www.ponsfamily.com/launchpad/{token}` and v2 is a different factory
-- with a different event signature, so sharing a front end is an assumption
-- until checked. Fetched 2026-08-23:
-- `ponsfamily.com/launchpad` carries v1/v2 filter tabs, and
-- `/launchpad/0xb9fa688cec9e4a788e20efa8332ec2c93a337dd2` — a pons-V2 token —
-- renders that token's own page (Kwoka Meme / KWOKA, bonding curve active).
-- Same pattern, both versions.
--
-- `stonksafe` is deliberately left with an empty config: it is disabled, and
-- its front end has not been verified. With the fallback removed, an empty
-- config is now safe — it costs a link, not a wrong one. Fill it in when the
-- pad is enabled.

update launchpads
set config = jsonb_build_object(
      'website', 'https://ponsfamily.com/launchpad',
      'tokenUrlTemplate', 'https://www.ponsfamily.com/launchpad/{token}'
    ),
    updated_at = now()
where slug = 'ponsv2'
  -- Idempotent, and never clobbers an operator's later edit.
  and coalesce(config->>'tokenUrlTemplate', '') = '';
