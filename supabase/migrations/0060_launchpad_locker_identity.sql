-- Name the launchpad factories and LP custodians the review queue has been
-- reporting as unidentified. IDENTITY ONLY — no row here grants LOCKED credit
-- or any other all-clear.
--
-- Same rule as 0059, and it is the whole design of this file: **an lp-locker
-- row is an absolute safety claim, an identity row is not.** `lib/config/
-- lockers.ts::primeTrustedLockers` turns any `lp-locker` row with
-- verify_status='ok' into "the lock is permanent, so that liquidity can never
-- be withdrawn". Nothing below earns that, including the two contracts that
-- look most like real lockers.
--
-- Sourced from `scan_uncertainties` (codes contract-creator-holds-lp and
-- contract-custodian-unclassified), then identified against TWO independent
-- sources: Blockscout (/addresses, /smart-contracts) and the Open Labels
-- Initiative attestation pool, which does carry chain 4663 labels
-- (https://www.openlabelsinitiative.org/api/labels?address=…&chain_id=eip155:4663).
-- Where the two disagree or only one answers, that is recorded per row in
-- `metadata.identifiedVia` rather than smoothed over.
--
-- ═══ LpLockerV3 0xa496a35a9fa24b388fe4affa013c106a3ae54bd9 ═════════════════
--
--   Holds 91.0% of WIZARD's V3 pool (prod verdict #123, 2026-08-20), which is
--   99.5% of that token's readable liquidity. We published WARN −9: "This
--   contract is not a trusted locker, so this liquidity is not considered
--   locked. Its controller or contract logic may still transfer or withdraw
--   it." That sentence is probably a false accusation against locked
--   liquidity — the exact polarity §9 warns about when a coverage fix lands
--   before the registry fix.
--
--   Its ENTIRE write surface, read from the verified ABI 2026-08-21:
--     lock(...)          — takes custody
--     collectFees(...)   — fees only
--   No withdraw, release, unlock, decreaseLiquidity, transfer, or ownership
--   entry point. That is the shape 0059's StonkUpLockerCL was NOT
--   (releasePosition + decreaseLockedLiquidity, vesting linearly).
--
--   ── Why it is STILL not registered as an lp-locker ──
--
--   `is_fully_verified: false`, `is_partially_verified: true`. The source
--   compiles to this runtime bytecode but is not provably THIS address's — it
--   was matched out of a shared bytecode database from a different address
--   (contract-tracing skill, trap #3). An absolute claim about withdrawal may
--   not rest on a source we cannot bind to the address, and §8 #16 is exactly
--   this failure one layer up: a surface READ but not proven to be the
--   surface that is deployed.
--
--   What would earn it the row, and nothing less:
--     1. an L1 round-trip of its bindings (positionManager()/factory()/owner())
--        against the registered Uniswap V3 NPM 0x73991a25…e0d3, as 0059 did;
--     2. a dispatcher enumeration proving no selector outside that 2-function
--        ABI (partial verification is precisely where ABI and code diverge);
--     3. confirmation there is no proxy/upgrade path (proxy_type is null, but
--        that is Blockscout's read, not ours).
--   Until then WIZARD keeps its WARN. A WARN that is too harsh is a cost we
--   can pay; a false "can never be withdrawn" is not.
--
-- ═══ noxa-fun Launch Factory 0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb ════
--
--   0059 deliberately left this one out: "UNVERIFIED on the explorer and
--   matching no known pad shape … inventing a label for it converts a gap into
--   a false identification." Still unverified — but it is no longer unnamed.
--
--     OLI: contract_name="Launch Factory", owner_project="noxa-fun",
--          usage_category="developer_tools" (chain_id eip155:4663)
--     L1:  it is the `creator_address_hash` of FOX 0x2103faa9…9bf1 and
--          IF 0x232cdfc4…30d1, and the `to` of both creation transactions.
--
--   Two independent sources agreeing on "a factory that launches tokens" is
--   the bar 0059 set, so it clears it — as IDENTITY. It is recorded as
--   explorer-unverified so the next reader does not mistake an attestation for
--   a bytecode audit.
--
-- ═══ Governance Safe 0x0eea30aba3f07abfa20e4b544f55e0f917d9dfd8 ════════════
--
--   Blockscout: SafeProxy → SafeL2. OLI: "Governance Safe", owner_project
--   "up33". This is the UP team multisig named in CLAUDE.md §8 #13/#14 — 8.23%
--   held directly plus 41.2% inside the VotingEscrow.
--
--   Registered as identity ONLY, and the category matters: a multisig is a
--   PARTY, not infrastructure. §8 #13 — every exclusion is an all-clear, and a
--   Safe can dump like any other holder. This row exists so the prose can say
--   "a 3-of-N governance multisig" instead of "an unidentified contract"; it
--   must never remove the address from a float or a concentration count.
--
--   A second SafeProxy→SafeL2 custodian (0x2f08437c…10e0) is deliberately NOT
--   listed. Enumerating Safes one address at a time does not scale, and the
--   right fix is a RECOGNISER — SafeProxy's singleton lives at storage slot 0,
--   and getOwners()/getThreshold()/VERSION() are three eth_calls that classify
--   any Safe on any chain without a registry row at all.
--
-- ═══ Deliberately NOT registered ═══════════════════════════════════════════
--
--   Unnamed by BOTH Blockscout and OLI. §9: an unrecognised contract is a
--   registry GAP until a source says otherwise, and these rows staying open is
--   what the review queue is for.
--     0x31ca5e101941a93a7dd6d0497928700625cf54b5 — holds 100% of POPCAT's V3
--       pool (verdict #122). The single highest-value unknown on the board.
--     0x904dccb96d877e6db365282251fa3dd156476660 — LP custodian, unverified.
--     0x0c37a24f5d23a486fa692d1500881d698b1f77a4 — POPCAT's creator.
--     0xc6cc8979e6e4f74d2da3ff2e514ff3f336cb1e73 — creator, unverified.
--     0xc70e510e14710ea535cab7b2414860af63feab79 — creator, unverified.

insert into trusted_address (
  address, chain_id, category, subtype, label, dex_id, metadata,
  enabled, verify_status, verified_at, created_by
) values
(
  '0x000000e200088d55c39a11f609e5f667729ad49b',
  4663,
  'dex-infra',
  'launchpad-factory',
  'UERC20 Token Factory',
  null,
  '{"role":"launchpad-factory","contractName":"UERC20Factory","writeFunctions":["createToken"],"sourceMatch":"partial","identifiedVia":["blockscout-name","oli-attestation"],"oliOwnerProject":"uniswap","launchpadsRow":false,"grantsLockedCredit":false,"tokensSeen":["0x298348d5b2e45c774e3ee4f1a0924071dfbdc8c7","0x18e674231a58c239dc7daedcffe15ec3a24cff5c","0xbfb70ea2f4737d9a0c02e86f02f4ae7c3798cb92"],"auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0x3dcf2ee1020a1f51b922807ccb07fc16b7682242',
  4663,
  'dex-infra',
  'launchpad-factory',
  'Liquidity Launcher V3',
  null,
  '{"role":"launchpad-factory","contractName":"LiquidityLauncherV3","writeFunctions":["launch"],"sourceMatch":"full","identifiedVia":["blockscout-verified"],"launchpadsRow":false,"grantsLockedCredit":false,"tokensSeen":["0x0f666ce4653860d0c873bff39919a77d07928243"],"auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0xa1e3bfdfee0c19f7bbff52d14e007da5e705660b',
  4663,
  'dex-infra',
  'launchpad-curve',
  'Banger Factory V6',
  null,
  '{"role":"launchpad-curve","contractName":"BangerFactoryV6","venueModel":"BONDING_CURVE","writeFunctions":["launchToken","graduateToken","setGraduationThreshold","setGraduationParams","setLaunchFee","setGraduationFee","restoreCurveFromEmergency","setSunset","pause","unpause","claimEth","proposeTreasuryChange","executeTreasuryChange","cancelTreasuryChange","transferOwnership","acceptOwnership"],"sourceMatch":"partial","identifiedVia":["blockscout-name"],"launchpadsRow":false,"adapterNeeded":"banger-v6","grantsLockedCredit":false,"note":"owner-controlled graduation and an emergency curve restore; identity only, and the authority surface is a reason to audit it, not to trust it","tokensSeen":["0x0b9606fb048a14d8381e9b97d00a78b4f4c66241"],"auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb',
  4663,
  'dex-infra',
  'launchpad-factory',
  'Noxa Fun Launch Factory',
  null,
  '{"role":"launchpad-factory","contractName":null,"sourceMatch":"unverified","identifiedVia":["oli-attestation","l1-creator-of-scanned-tokens"],"oliOwnerProject":"noxa-fun","oliContractName":"Launch Factory","explorerVerified":false,"launchpadsRow":false,"grantsLockedCredit":false,"note":"held back by 0059 as unidentified; named here by OLI plus L1 creation-tx evidence. Explorer still has no source, so this is a NAME, never a bytecode audit.","tokensSeen":["0x2103faa9d1762e27a716c61718b3acf3ec1f9bf1","0x232cdfc415d10b673845d83dc02ba2eabe7e30d1"],"auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0x626c3d09b65bf5d1d40e0d5f25e19fa49783b3d4',
  4663,
  'dex-infra',
  'launchpad-factory',
  'Party Factory',
  null,
  '{"role":"launchpad-factory","contractName":"PartyFactory","sourceMatch":"unknown","identifiedVia":["blockscout-name"],"locker":"0x35e41f84d3fd61d4648f0c8b41a1e7d301bcd75e","launchpadsRow":false,"grantsLockedCredit":false,"auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0x662003bf6049e36b4e887d47b8df8718ffbbc6c2',
  4663,
  'dex-infra',
  'launchpad-deployer',
  'Collection Token Deployer',
  null,
  '{"role":"launchpad-deployer","contractName":"CollectionTokenDeployer","sourceMatch":"unknown","identifiedVia":["blockscout-name"],"launchpadsRow":false,"grantsLockedCredit":false,"auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0xd97f767a2b2dd162bf7740ed47c7525e747276ca',
  4663,
  'dex-infra',
  'launchpad-factory',
  'Launcher',
  null,
  '{"role":"launchpad-factory","contractName":"Launcher","sourceMatch":"unknown","identifiedVia":["blockscout-name"],"launchpadsRow":false,"grantsLockedCredit":false,"note":"generic name; identity is weak evidence here and the row exists only to stop the queue reporting it as unknown","auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0x5bd1fbe78a78fe8236fa00cf48fbeba74ae34661',
  4663,
  'dex-infra',
  'launchpad-factory',
  'CashCat Factory (vNext)',
  null,
  '{"role":"launchpad-factory","contractName":"ERC1967Proxy","implementationName":"CashCatFactoryVNext","proxy":"erc1967","sourceMatch":"unknown","identifiedVia":["blockscout-name","blockscout-implementation"],"launchpadsRow":false,"grantsLockedCredit":false,"note":"UPGRADEABLE (ERC1967) — the implementation named here can be swapped by its admin, so this identity is not a statement about behaviour","auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0xd0a93885a387e3a8a14dd82776cf9104a3676b3a',
  4663,
  'dex-infra',
  'launchpad-factory',
  'Sentry Launch Factory V4',
  null,
  '{"role":"launchpad-factory","contractName":"TransparentUpgradeableProxy","implementationName":"SentryLaunchFactoryV4","proxy":"transparent","sourceMatch":"unknown","identifiedVia":["blockscout-name","blockscout-implementation"],"launchpadsRow":false,"grantsLockedCredit":false,"note":"UPGRADEABLE (transparent proxy) — same caveat as CashCat above","auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0xa496a35a9fa24b388fe4affa013c106a3ae54bd9',
  4663,
  'dex-infra',
  'lp-locker-candidate',
  'LP Locker V3 (unverified custody)',
  'uniswap',
  '{"role":"lp-locker-candidate","contractName":"LpLockerV3","writeFunctions":["lock","collectFees"],"noWithdrawPathInAbi":true,"sourceMatch":"partial","identifiedVia":["blockscout-name"],"grantsLockedCredit":false,"whyNotTrusted":"partially verified only — source matched from a sibling address, so the 2-function ABI is not provably this address deployed surface (contract-tracing trap #3, CLAUDE.md 8.16). Bindings not round-tripped on L1 and no dispatcher enumeration run.","earnsLpLockerRowWhen":["L1 round-trip of positionManager/factory/owner against Uniswap V3 NPM 0x73991a25c818bf1f1128deaab1492d45638de0d3","dispatcher enumeration shows no selector outside the declared ABI","no proxy or upgrade path confirmed independently of blockscout proxy_type"],"holdsPoolShare":{"token":"0x0f666ce4653860d0c873bff39919a77d07928243","verdict":123,"poolSharePct":91.0,"publishedStatus":"WARN"},"auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0x35e41f84d3fd61d4648f0c8b41a1e7d301bcd75e',
  4663,
  'dex-infra',
  'lp-locker-candidate',
  'Party Locker (unverified custody)',
  null,
  '{"role":"lp-locker-candidate","contractName":"PartyLocker","sourceMatch":"unknown","identifiedVia":["blockscout-name"],"factory":"0x626c3d09b65bf5d1d40e0d5f25e19fa49783b3d4","grantsLockedCredit":false,"whyNotTrusted":"named only; write surface never enumerated","auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0x382a6e2f7feb67b7347c29a8f4a01264bd85055d',
  4663,
  'dex-infra',
  'lp-locker-candidate',
  'Liquidity Lock (unverified custody)',
  null,
  '{"role":"lp-locker-candidate","contractName":"LiquidityLock","sourceMatch":"unknown","identifiedVia":["blockscout-name"],"grantsLockedCredit":false,"whyNotTrusted":"named only; write surface never enumerated","auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0x2ac03e14cfe755426daaee0a4994184ce81482f8',
  4663,
  'dex-infra',
  'fee-collector',
  'Uniswap TokenJar',
  'uniswap',
  '{"role":"fee-collector","contractName":"TokenJar","sourceMatch":"unknown","identifiedVia":["blockscout-name","oli-attestation"],"oliOwnerProject":"uniswap","oliUsageCategory":"payments","grantsLockedCredit":false,"note":"venue plumbing, not a holder — see the L11 invariant in scripts/invariant-sweep.sql before letting this top a folded holder list","auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
),
(
  '0x0eea30aba3f07abfa20e4b544f55e0f917d9dfd8',
  4663,
  'dex-infra',
  'governance-multisig',
  'UP Governance Safe',
  null,
  '{"role":"governance-multisig","contractName":"SafeProxy","implementationName":"SafeL2","sourceMatch":"unknown","identifiedVia":["blockscout-name","blockscout-implementation","oli-attestation"],"oliOwnerProject":"up33","oliContractName":"Governance Safe","grantsLockedCredit":false,"isParty":true,"note":"A PARTY, not infrastructure. CLAUDE.md 8.13/8.14: this address holds 8.23% of UP directly AND 41.2% through the VotingEscrow, and the merge is the finding. This row renames the subject and must never exclude it from a float or a concentration count.","auditedAt":"2026-08-21"}'::jsonb,
  true, 'ok', now(), 'migration-0060'
)
on conflict (address, chain_id) do update set
  category      = excluded.category,
  subtype       = excluded.subtype,
  label         = excluded.label,
  dex_id        = excluded.dex_id,
  metadata      = excluded.metadata,
  enabled       = true,
  verify_status = 'ok',
  verified_at   = now();

-- Close only the review rows for addresses actually named above. The five
-- unidentified ones listed in the header stay OPEN on purpose.
update scan_uncertainties
set reviewed_at = now(),
    reviewed_by = 'migration-0060',
    resolution  = 'Identified in migration 0060 (identity only — no LOCKED credit, no launchpads row). Locker candidates still publish WARN until their write surface is proven.'
where reviewed_at is null
  and code in ('contract-creator-holds-lp', 'contract-custodian-unclassified')
  and lower(subject) in (
    '0x000000e200088d55c39a11f609e5f667729ad49b',
    '0x3dcf2ee1020a1f51b922807ccb07fc16b7682242',
    '0xa1e3bfdfee0c19f7bbff52d14e007da5e705660b',
    '0xd9ec2db5f3d1b236843925949fe5bd8a3836fccb',
    '0x626c3d09b65bf5d1d40e0d5f25e19fa49783b3d4',
    '0x662003bf6049e36b4e887d47b8df8718ffbbc6c2',
    '0xd97f767a2b2dd162bf7740ed47c7525e747276ca',
    '0x5bd1fbe78a78fe8236fa00cf48fbeba74ae34661',
    '0xd0a93885a387e3a8a14dd82776cf9104a3676b3a',
    '0xa496a35a9fa24b388fe4affa013c106a3ae54bd9',
    '0x35e41f84d3fd61d4648f0c8b41a1e7d301bcd75e',
    '0x382a6e2f7feb67b7347c29a8f4a01264bd85055d',
    '0x2ac03e14cfe755426daaee0a4994184ce81482f8',
    '0x0eea30aba3f07abfa20e4b544f55e0f917d9dfd8'
  );
