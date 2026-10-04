-- ─────────────────────────────────────────────────────────────
-- 0025 — flap.sh + pons adapters (docs/prds/launchpad-aggregator-prd.md)
--
-- Two new adapter presets, decoded on-chain 2026-07-19:
--   flap-v1  flap.sh bonding curve behind a TransparentUpgradeableProxy.
--            Event-sourced: TokenCreated (IPFS-CID meta) / TokenBought /
--            TokenSold / FlapTokenProgressChanged (WAD ratio = authoritative
--            fill). lib/tracker/curves/adapters/flap-v1.ts.
--   pons-v1  PonsLaunchFactory — a DIRECT V3 launcher with a graduation gate,
--            NOT a bonding curve. TokenLaunched births the pool; the view
--            graduationStatus(token) → (raised, threshold, graduated) drives
--            progress + graduation. lib/tracker/curves/adapters/pons-v1.ts.
--
-- Pons also MOVED launch contracts (ponsfamily.com/launchpad): the registry's
-- old address (0x0c37a24f…, an earlier deploy of the same factory) is repointed
-- to the current one (0xa5aab3f0…). No curve_tokens referenced the old row
-- (curve-events-v1 never matched pons events, cursor was 0), so nothing to
-- clean up — but launchpad_id, not the address, is the FK, so the repoint is
-- transparent regardless.
--
-- Both rows reset last_processed_block to 0 so the next poll bootstraps them
-- (each adapter walks only a recent window at cursor 0, never genesis).
-- ─────────────────────────────────────────────────────────────

-- ── widen the adapter check to the four presets ──
alter table public.launchpads drop constraint if exists launchpads_adapter_check;
alter table public.launchpads
  add constraint launchpads_adapter_check
  check (adapter in ('curve-events-v1', 'hood-v1', 'flap-v1', 'pons-v1'));

-- ── flap.sh → flap-v1 (address unchanged; only the adapter was a placeholder) ──
update public.launchpads
set adapter = 'flap-v1',
    last_processed_block = 0,
    last_probe = null,
    notes = 'flap.sh bonding curve behind a TransparentUpgradeableProxy. Events decoded on-chain 2026-07-19: TokenCreated/Bought/Sold + FlapTokenProgressChanged (WAD ratio). Re-probe from the admin panel to refresh verification.',
    updated_at = now()
where slug = 'flapsh';

-- ── pons → new PonsLaunchFactory + pons-v1 (direct launcher) ──
update public.launchpads
set curve_address = '0xa5aab3f0c6eeadf30ef1d3eb997108e976351feb',
    adapter = 'pons-v1',
    name = 'Pons',
    last_processed_block = 0,
    last_probe = null,
    notes = 'PonsLaunchFactory (ponsfamily.com/launchpad), verified on-chain 2026-07-19. Direct V3 launcher with a graduation gate: graduationStatus(token) drives progress. Moved from the earlier deploy 0x0c37a24f…. Re-probe from the admin panel to refresh verification.',
    updated_at = now()
where slug = 'pons';
