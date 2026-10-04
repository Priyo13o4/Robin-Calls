-- ─────────────────────────────────────────────────────────────
-- 0026 — flap.sh + pons launchpad websites
--
-- The feed's "PONS ↗" / "FLAP.SH ↗" chip links to config.website (see
-- lib/data/curves.ts launchpadWebsite). Both rows had an empty config, so pons
-- fell back to https://Pons (its display name isn't a domain) — a dead link.
-- Seed the real sites. No per-token URL template: neither pad's token-page URL
-- scheme is confirmed, and a wrong {token} template 404s, so the chip lands on
-- the launchpad homepage instead (the deliberate fallback).
-- ─────────────────────────────────────────────────────────────

update public.launchpads
set config = config || '{"website": "https://ponsfamily.com/launchpad"}'::jsonb,
    updated_at = now()
where slug = 'pons';

update public.launchpads
set config = config || '{"website": "https://flap.sh"}'::jsonb,
    updated_at = now()
where slug = 'flapsh';
