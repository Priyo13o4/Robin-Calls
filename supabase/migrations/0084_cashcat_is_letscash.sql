-- 0084 — the `cashcat` pad is letscash.fun
--
-- KNOWN-PROBLEMS asked whether "CashCat Factory (vNext)" was a stale label and
-- said it "cannot be confirmed from chain data". It can, two ways, measured
-- 2026-09-05:
--
--   1. HOOD10, OURO, 9TO5 and TOADY — the tokens on letscash.fun's own front
--      page — resolve to curve_tokens rows under launchpad slug 'cashcat'.
--   2. 2,084 of 2,084 cashcat tokens carry the `cc` vanity suffix, and every
--      token address letscash.fun links to ends in `cc`. Party's 104 tokens: 0.
--
-- Display name only. The SLUG stays `cashcat`: it is the key the adapter
-- registry, CURVE_POLL config and every curve_tokens row join on, and renaming
-- it would be a silent re-partition of 2,084 rows for a cosmetic gain.
update launchpads
set name = 'letscash.fun',
    notes = notes || ' | 2026-09-05: product is branded letscash.fun — confirmed by '
                  || 'front-page token match (HOOD10/OURO/9TO5/TOADY) and a 2084/2084 '
                  || '`cc` address-suffix census. Slug stays `cashcat` (join key).',
    updated_at = now()
where slug = 'cashcat';
