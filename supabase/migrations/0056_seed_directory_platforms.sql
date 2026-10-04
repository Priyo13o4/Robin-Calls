-- Seed the directory with the platforms we already track elsewhere in the
-- schema (public.launchpads, 0014/0016) plus Robinhood itself, so the
-- directory isn't empty while waiting on public submissions. These are
-- curated by us, not third-party submissions, so they land as 'published'
-- directly rather than going through the 'pending' review queue.
--
-- Facts below came from crawling each site 2026-08-17; anything not stated
-- on the page is left out of category_details rather than guessed. Onboarding
-- (curve_address / token tracking) is unaffected — that's driven by
-- public.launchpads, not this table.
--
-- No unique constraint exists on directory_platforms.url (unlike launchpads.slug),
-- so each row is guarded with `where not exists` to keep a re-run additive-safe.

insert into public.directory_platforms
  (name, url, description, category, has_mcp, has_agent, status, category_details)
select * from (values
  (
    'robin.fun',
    'https://robinfun.live',
    'Fair-launch bonding-curve launchpad on Robinhood Chain — no presale, no team allocation. Tokens start around $4K market cap and graduate around $44K into a Uniswap pool with 100% of the LP burned.',
    'LAUNCHPAD',
    false,
    false,
    'published',
    jsonb_build_object(
      'launch_model', 'Bonding curve → DEX graduation',
      'graduation_target', '~$44,000 market cap (starts ~$4,000)',
      'graduation_dex', 'Uniswap (100% of LP burned)',
      'token_url_template', 'https://robinfun.live/token/{token}'
    )
  ),
  (
    'hood.fun',
    'https://hood.fun',
    'Token launchpad on Robinhood Chain. LP is locked forever on graduation.',
    'LAUNCHPAD',
    false,
    false,
    'published',
    jsonb_build_object(
      'launch_model', 'Bonding curve → DEX graduation',
      'token_url_template', 'https://hood.fun/coin/{token}'
    )
  ),
  (
    'Flap',
    'https://flap.sh',
    'Programmable token launchpad on Robinhood Chain — bonding-curve launches where each creator sets their own buy/sell tax.',
    'LAUNCHPAD',
    false,
    false,
    'published',
    jsonb_build_object(
      'launch_model', 'Bonding curve → DEX graduation',
      'fees', 'Configurable per-token buy/sell tax, set by the creator at launch'
    )
  ),
  (
    'Pons',
    'https://ponsfamily.com/launchpad',
    'Direct launchpad on Robinhood Chain for fixed-supply tokens. Non-custodial — every transaction is submitted through your own wallet; graduation is gated by on-chain progress.',
    'LAUNCHPAD',
    false,
    false,
    'published',
    jsonb_build_object(
      'launch_model', 'Direct launch (instant DEX pool)',
      'graduation_dex', 'Uniswap V3'
    )
  ),
  (
    'Stoxes.fun',
    'https://stoxes.fun',
    'Launchpad for RWA dividend tokens: a trade tax buys real tokenized-stock ("xStock") shares and auto-distributes them to holders. Bonding-curve tokens graduate into a token/xStock pool; also deployed on Robinhood Chain.',
    'LAUNCHPAD',
    false,
    false,
    'published',
    jsonb_build_object(
      'launch_model', 'Bonding curve → DEX graduation',
      'fees', 'Creator earns 0.70%-1% of every trade; RWA tiers add up to a 4% dividend tax',
      'graduation_dex', 'token/xStock pool'
    )
  ),
  (
    'Robinhood',
    'https://robinhood.com',
    'The brokerage Robinhood Chain is named for. Stocks, options, futures, and 24/7 crypto trading, plus dedicated "Agentic Trading" accounts and an agentic credit card built for AI agents to trade with monitoring.',
    'TRADING',
    false,
    true,
    'published',
    -- No TRADING_TYPE select option fits a centralized brokerage (the taxonomy
    -- was built for on-chain venues) — leaving it unset beats picking a wrong one.
    jsonb_build_object(
      'agent_docs_url', 'https://docs.robinhood.com/crypto/trading'
    )
  ),
  (
    'Karma',
    'https://trykarma.app',
    'Self-custodial crypto "super app" wallet — trade across multiple chains, spend via a crypto card, and receive fiat (EUR/USD/GBP) into a stablecoin balance. $KARMA is live on Robinhood Chain.',
    'WALLET',
    false,
    true,
    'published',
    jsonb_build_object(
      'wallet_features', jsonb_build_array('In-app swap', 'Fiat on-ramp', 'Multi-chain'),
      'agent_docs_url', 'https://docs.karmapay.xyz'
    )
  ),
  (
    'Kibi',
    'https://kibi.bot',
    'AI agent platform for token launches — watches chosen X accounts 24/7 and auto-launches a token the instant they post, plus an "Alpha Chat" AI copilot for crypto/memecoin/stock analysis. Its network switcher deploys launches via RH.fun, Flap.sh and Doppler on Robinhood Chain (also BNB Chain, via Flap, B.Fun and Four.meme). Up to 90% of trading fees flow to the token''s creator.',
    'AI',
    false,
    true,
    'published',
    jsonb_build_object(
      'ai_type', 'Agent platform / framework',
      'integrations', 'X (Twitter); RH.fun, Flap.sh, Doppler on Robinhood Chain',
      'pricing_model', 'Freemium',
      'agent_docs_url', 'https://kibi.bot/docs/agent'
    )
  ),
  (
    'AlphaWire',
    'https://alphawire.xyz',
    'Crypto news and market-intelligence outlet — weekly builder insights, deep dives, and podcasts ("Pulse", "Hardwired") across BTC/ETH/SOL/XRP, stablecoins, AI agents, prediction markets, DeFi and tokenized equities. Read by 47,000+ builders, operators and investors. General crypto coverage, not Robinhood-Chain-specific.',
    'ANALYTICS',
    false,
    false,
    'published',
    jsonb_build_object(
      'analytics_focus', jsonb_build_array('Market intelligence')
    )
  ),
  (
    'YOINK',
    'https://yoinkai.fun',
    'Agentic launch terminal on Robinhood Chain — pre-launch ("nothing here is live to trade yet"). Its Genesis Key NFT (free mint at mint.yoinkai.fun, 1,776 max supply, verified launchpad/renderer/LP-locker contracts on Robinhood Chain 4663) grants a tiered share of creator fees by $YOINK holdings, from 70% at the base tier up to 80% at the Sovereign (10M $YOINK) tier. Not affiliated with Robinhood.',
    'LAUNCHPAD',
    false,
    false,
    'published',
    jsonb_build_object(
      'fees', 'Genesis Key holders share 70-80% of launch fees by $YOINK tier (Base 70% → Sovereign 10M $YOINK 80%)'
    )
  ),
  (
    'Arrow Finance',
    'https://www.arrowfinance.io',
    'DeFi protocol purpose-built for Robinhood Chain: an overcollateralized CDP protocol minting the aUSD stablecoin against WETH, USDG, tokenized ETFs (SPY/QQQ/SGOV/SLV) and stock tokens, a swap aggregator, and the ArrowPad launchpad. Swap, Borrow and Launch are live; Earn and a trading Terminal are coming. Governed via veARROW vote-escrow locking.',
    'DEFI',
    false,
    false,
    'published',
    jsonb_build_object(
      'defi_type', 'Lending / borrowing',
      'native_token', 'ARROW (governance) + aUSD (CDP debt stablecoin)'
    )
  ),
  (
    'LaunchHood',
    'https://launchhood.com',
    'Memecoin launchpad on Robinhood Chain. A prior version remains live at v3.launchhood.com.',
    'LAUNCHPAD',
    false,
    false,
    'published',
    '{}'::jsonb
  ),
  (
    'GMGN.AI',
    'https://gmgn.ai/?chain=robinhood',
    'Multi-chain meme trading terminal — tracks Robinhood Chain in its own "Trenches" view (New / Almost Bonded / Migrated) alongside every bonding-curve pad it indexes. Known for charting, wallet tracking and rug-check signals.',
    'ANALYTICS',
    false,
    false,
    'published',
    jsonb_build_object(
      'analytics_focus', jsonb_build_array('Charts / screener', 'Wallet tracking', 'Security / rug checks')
    )
  ),
  (
    'WAGENT',
    'https://wagent.fun',
    '$WAGENT — a memecoin on Robinhood Chain (4663) run by four autonomous on-chain agents instead of a team: TREASURY-01 buys back on a 30%+ drawdown, TIPPER-02 rewards X/Farcaster mentions, BURNER-03 burns supply at volume/holder milestones, DROPPER-04 airdrops new Robinhood Chain developers. 0% transfer tax, liquidity burned at launch.',
    'AI',
    false,
    false,
    'published',
    jsonb_build_object(
      'ai_type', 'Trading agent'
    )
  ),
  (
    'Axol / Raxol',
    'https://axol.io',
    'Raxol — an open-source agent runtime for private on-chain commerce, paired with the Xochi dark-pool settlement layer and ZK compliance proofs. Operates across 19+ networks; live trading currently runs through Virtuals Protocol.',
    'AI',
    false,
    true,
    'published',
    jsonb_build_object(
      'ai_type', 'Agent platform / framework',
      'integrations', 'Virtuals Protocol, Xochi dark pool'
    )
  ),
  (
    'OneToken',
    'https://onetokenhub.xyz',
    'Permissionless token launchpad on Uniswap V4 — tokens deploy on a one-sided AMM curve with zero upfront capital and are immediately routable across DEX aggregators (1inch, Matcha, CoW Swap, ParaSwap, 0x, KyberSwap, Odos). Liquidity is 100% onchain and locked, with no price cap. Live on Base and Robinhood; Arc Mainnet is next.',
    'LAUNCHPAD',
    false,
    false,
    'published',
    jsonb_build_object(
      'launch_model', 'Direct launch (instant DEX pool)',
      'graduation_dex', 'Uniswap V4 (routable via 1inch, Matcha, CoW Swap, ParaSwap, 0x, KyberSwap, Odos)'
    )
  ),
  (
    'real.fun',
    'https://real.fun',
    'Launchpad for dividend-paying memecoins on Robinhood Chain. Every trade skims a fee, converts it to real USDG, and streams it to holders pro-rata; every buy also locks real dollars into the curve so the floor can only rise. Each coin launches with a locked Uniswap pool, tradable from block one with liquidity that can never be pulled.',
    'LAUNCHPAD',
    false,
    false,
    'published',
    jsonb_build_object(
      'launch_model', 'Direct launch (instant DEX pool)',
      'fees', 'Trade fee converted to USDG and streamed to holders pro-rata',
      'graduation_dex', 'Uniswap (liquidity locked at launch)'
    )
  ),
  (
    'Virtuals Protocol',
    'https://app.virtuals.io',
    'AI-agent tokenization platform ("Society of AI Agents") — Capital Market, Agentic Commerce, veVIRTUAL governance, and self-serve token/agent launch. Best known on Base; per the operator, Robinhood Chain is also supported.',
    'AI',
    false,
    true,
    'published',
    jsonb_build_object(
      'ai_type', 'Agent platform / framework'
    )
  ),
  (
    'Dart Finance',
    'https://darthood.com',
    '"The Terminal for Robinhood Chain" — a trading terminal for the chain.',
    'TRADING',
    false,
    false,
    'published',
    jsonb_build_object(
      'trading_type', 'Trading bot / terminal'
    )
  ),
  (
    'ROBINTHEHOODINI',
    'https://robinthehoodini.xyz',
    '$HOODINI — described by its own site as "the first token ever launched on Robinhood Chain" (via BankrBot), paired with the 1,169-piece Hoodini PFP collection (OpenSea-verified, 25+ ETH traded). No intrinsic value or expectation of return, per its own disclaimer; 1% fee split between the team and Net Protocol.',
    'NFT',
    false,
    false,
    'published',
    jsonb_build_object(
      'nft_type', 'Collection'
    )
  )
) as seed(name, url, description, category, has_mcp, has_agent, status, category_details)
where not exists (
  select 1 from public.directory_platforms dp where dp.url = seed.url
);
