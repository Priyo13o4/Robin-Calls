import { pgTable, index, foreignKey, unique, pgPolicy, bigint, text, boolean, timestamp, check, numeric, integer, jsonb, uniqueIndex, smallint, uuid, date, primaryKey } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"



export const tokens = pgTable("tokens", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "tokens_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	address: text().notNull(),
	name: text(),
	symbol: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	deployerId: bigint("deployer_id", { mode: "number" }),
	launchpad: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	deployBlock: bigint("deploy_block", { mode: "number" }),
	deployTx: text("deploy_tx"),
	isDead: boolean("is_dead").default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	bytecodeHash: text("bytecode_hash"),
}, (table) => [
	index("tokens_bytecode_hash_idx").using("btree", table.bytecodeHash.asc().nullsLast().op("text_ops")),
	index("tokens_deployer_id_idx").using("btree", table.deployerId.asc().nullsLast().op("int8_ops")),
	index("tokens_launchpad_idx").using("btree", table.launchpad.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.deployerId],
			foreignColumns: [deployers.id],
			name: "tokens_deployer_id_fkey"
		}),
	unique("tokens_address_key").on(table.address),
	pgPolicy("tokens_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
]);

export const deployers = pgTable("deployers", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "deployers_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	address: text().notNull(),
	funderAddress: text("funder_address"),
	launchesTotal: integer("launches_total").default(0).notNull(),
	launchesDead: integer("launches_dead").default(0).notNull(),
	confirmedRugs: integer("confirmed_rugs").default(0).notNull(),
	extractedUsd: numeric("extracted_usd", { precision: 18, scale:  2 }).default('0').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	firstSeenBlock: bigint("first_seen_block", { mode: "number" }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	lastSeenBlock: bigint("last_seen_block", { mode: "number" }),
	notes: text(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("deployers_confirmed_rugs_idx").using("btree", table.confirmedRugs.desc().nullsFirst().op("int4_ops")),
	index("deployers_funder_address_idx").using("btree", table.funderAddress.asc().nullsLast().op("text_ops")),
	unique("deployers_address_key").on(table.address),
	pgPolicy("deployers_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
]);

export const rugs = pgTable("rugs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "rugs_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	deployerId: bigint("deployer_id", { mode: "number" }).notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	tokenId: bigint("token_id", { mode: "number" }),
	criteriaVersion: text("criteria_version").notNull(),
	extractedUsd: numeric("extracted_usd", { precision: 18, scale:  2 }),
	evidence: jsonb().notNull(),
	ruggedAt: timestamp("rugged_at", { withTimezone: true, mode: 'string' }),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	ruggedBlock: bigint("rugged_block", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("rugs_deployer_id_idx").using("btree", table.deployerId.asc().nullsLast().op("int8_ops")),
	index("rugs_token_id_idx").using("btree", table.tokenId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.deployerId],
			foreignColumns: [deployers.id],
			name: "rugs_deployer_id_fkey"
		}),
	foreignKey({
			columns: [table.tokenId],
			foreignColumns: [tokens.id],
			name: "rugs_token_id_fkey"
		}),
	pgPolicy("rugs_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
]);

export const compareStats = pgTable("compare_stats", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "compare_stats_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	key: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	value: bigint({ mode: "number" }).default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("compare_stats_key_key").on(table.key),
	pgPolicy("compare_stats_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
]);

export const anchors = pgTable("anchors", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "anchors_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	headHash: text("head_hash").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	upToVerdictId: bigint("up_to_verdict_id", { mode: "number" }).notNull(),
	txHash: text("tx_hash").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	blockNumber: bigint("block_number", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("anchors_up_to_verdict_id_idx").using("btree", table.upToVerdictId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.upToVerdictId],
			foreignColumns: [verdicts.id],
			name: "anchors_up_to_verdict_id_fkey"
		}),
	unique("anchors_tx_hash_key").on(table.txHash),
	pgPolicy("anchors_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
]);

export const directoryPlatforms = pgTable("directory_platforms", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "directory_platforms_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	name: text().notNull(),
	// URL segment for /ecosystem/<slug> (migration 0066). Stable across name
	// edits on purpose: deriving it from `name` at render time would repoint
	// the URL whenever an admin fixed a typo, 404ing every inbound link.
	slug: text().notNull(),
	url: text().notNull(),
	description: text(),
	category: text().notNull(),
	hasMcp: boolean("has_mcp").default(false).notNull(),
	hasAgent: boolean("has_agent").default(false).notNull(),
	status: text().default('pending').notNull(),
	contact: text(),
	submittedFrom: text("submitted_from"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	categoryDetails: jsonb("category_details").default({}).notNull(),
	bannerUrl: text("banner_url"),
}, (table) => [
	index("directory_status_category_idx").using("btree", table.status.asc().nullsLast().op("text_ops"), table.category.asc().nullsLast().op("text_ops")),
	unique("directory_platforms_slug_key").on(table.slug),
	pgPolicy("directory_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`(status = 'published'::text)` }),
	check("directory_platforms_category_check", sql`category = ANY (ARRAY['LAUNCHPAD'::text, 'TRADING'::text, 'WALLET'::text, 'DEFI'::text, 'AI'::text, 'NFT'::text, 'GAMING'::text, 'ANALYTICS'::text, 'DEVTOOLS'::text, 'INFRASTRUCTURE'::text, 'PAYMENTS'::text, 'SECURITY'::text, 'SOCIAL'::text])`),
	check("directory_platforms_status_check", sql`status = ANY (ARRAY['pending'::text, 'published'::text, 'rejected'::text])`),
	check("directory_platforms_slug_check", sql`slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
]);

export const registry = pgTable("registry", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "registry_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	assetName: text("asset_name").notNull(),
	assetSymbol: text("asset_symbol").notNull(),
	address: text().notNull(),
	category: text(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	verifyStatus: text("verify_status").default('unchecked').notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("registry_symbol_idx").using("btree", table.assetSymbol.asc().nullsLast().op("text_ops")),
	unique("registry_address_key").on(table.address),
	pgPolicy("registry_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("registry_verify_status_check", sql`verify_status = ANY (ARRAY['ok'::text, 'failed'::text, 'unchecked'::text, 'unprobeable'::text])`),
]);

export const verdicts = pgTable("verdicts", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "verdicts_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	tokenAddress: text("token_address").notNull(),
	tokenName: text("token_name"),
	tokenSymbol: text("token_symbol"),
	score: integer().notNull(),
	tier: text().notNull(),
	criticalOverride: text("critical_override"),
	scoreVersion: text("score_version").notNull(),
	checks: jsonb().notNull(),
	marketSnapshot: jsonb("market_snapshot"),
	entryHash: text("entry_hash").notNull(),
	prevHash: text("prev_hash").notNull(),
	anchorTx: text("anchor_tx"),
	anchoredAt: timestamp("anchored_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	resultFingerprint: text("result_fingerprint"),
	completeness: text(),
	receiptPolicyVersion: text("receipt_policy_version"),
	dexProtocols: text("dex_protocols").array().default([]).notNull(),
	primaryPoolAddress: text("primary_pool_address"),
	scanStartedAt: timestamp("scan_started_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("verdicts_created_at_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	uniqueIndex("verdicts_prev_hash_unique_idx").using("btree", table.prevHash.asc().nullsLast().op("text_ops")),
	index("verdicts_tier_idx").using("btree", table.tier.asc().nullsLast().op("text_ops")),
	index("verdicts_token_address_idx").using("btree", table.tokenAddress.asc().nullsLast().op("text_ops")),
	index("verdicts_primary_pool_address_lower_idx").using("btree", sql`lower(primary_pool_address)`),
	index("verdicts_token_address_trgm_idx").using("gin", table.tokenAddress.asc().nullsLast().op("gin_trgm_ops")),
	index("verdicts_token_created_idx").using("btree", table.tokenAddress.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("verdicts_token_fingerprint_idx").using("btree", table.tokenAddress.asc().nullsLast().op("text_ops"), table.resultFingerprint.asc().nullsLast().op("timestamptz_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("verdicts_token_name_trgm_idx").using("gin", table.tokenName.asc().nullsLast().op("gin_trgm_ops")),
	index("verdicts_token_symbol_trgm_idx").using("gin", table.tokenSymbol.asc().nullsLast().op("gin_trgm_ops")),
	unique("verdicts_entry_hash_key").on(table.entryHash),
	pgPolicy("verdicts_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("verdicts_completeness_check", sql`(completeness IS NULL) OR (completeness = ANY (ARRAY['complete'::text, 'partial'::text, 'legacy'::text]))`),
	check("verdicts_score_check", sql`(score >= 0) AND (score <= 100)`),
	check("verdicts_tier_check", sql`tier = ANY (ARRAY['CLEAR'::text, 'CAUTION'::text, 'DANGER'::text, 'CRITICAL'::text])`),
]);

export const user = pgTable("user", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	email: text().notNull(),
	emailVerified: boolean().default(false).notNull(),
	image: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	username: text(),
	displayUsername: text(),
	role: text(),
	banned: boolean().default(false),
	banReason: text(),
	banExpires: timestamp({ withTimezone: true, mode: 'string' }),
}, (table) => [
	unique("user_email_key").on(table.email),
	unique("user_username_key").on(table.username),
]);

export const session = pgTable("session", {
	id: text().primaryKey().notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	token: text().notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	ipAddress: text(),
	userAgent: text(),
	userId: text().notNull(),
	impersonatedBy: text(),
}, (table) => [
	index("session_token_idx").using("btree", table.token.asc().nullsLast().op("text_ops")),
	index("session_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "session_userId_fkey"
		}).onDelete("cascade"),
	unique("session_token_key").on(table.token),
]);

export const account = pgTable("account", {
	id: text().primaryKey().notNull(),
	accountId: text().notNull(),
	providerId: text().notNull(),
	userId: text().notNull(),
	accessToken: text(),
	refreshToken: text(),
	idToken: text(),
	accessTokenExpiresAt: timestamp({ withTimezone: true, mode: 'string' }),
	refreshTokenExpiresAt: timestamp({ withTimezone: true, mode: 'string' }),
	scope: text(),
	password: text(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	issuer: text().notNull(),
}, (table) => [
	index("account_userId_idx").using("btree", table.userId.asc().nullsLast().op("text_ops")),
	uniqueIndex("account_issuer_accountId_uidx").using("btree", table.issuer.asc().nullsLast().op("text_ops"), table.accountId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "account_userId_fkey"
		}).onDelete("cascade"),
]);

export const verification = pgTable("verification", {
	id: text().primaryKey().notNull(),
	identifier: text().notNull(),
	value: text().notNull(),
	expiresAt: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("verification_identifier_idx").using("btree", table.identifier.asc().nullsLast().op("text_ops")),
]);

export const whitelistEvents = pgTable("whitelist_events", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "whitelist_events_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	walletAddress: text("wallet_address"),
	eventType: text("event_type").notNull(),
	payloadJson: jsonb("payload_json"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("whitelist_events_created_idx").using("btree", table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("whitelist_events_type_idx").using("btree", table.eventType.asc().nullsLast().op("text_ops")),
	index("whitelist_events_wallet_idx").using("btree", table.walletAddress.asc().nullsLast().op("text_ops")).where(sql`(wallet_address IS NOT NULL)`),
]);

export const tokenMarks = pgTable("token_marks", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "token_marks_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	tokenAddress: text("token_address").notNull(),
	kind: text().default('honeypot').notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	sourceVerdictId: bigint("source_verdict_id", { mode: "number" }),
	evidence: jsonb().default({}).notNull(),
	liquidityUsdAtMark: numeric("liquidity_usd_at_mark"),
	firedCount: integer("fired_count").default(1).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	liftedAt: timestamp("lifted_at", { withTimezone: true, mode: 'string' }),
	liftedReason: text("lifted_reason"),
	liftedBy: text("lifted_by"),
}, (table) => [
	index("token_marks_active_idx").using("btree", table.tokenAddress.asc().nullsLast().op("text_ops")).where(sql`(lifted_at IS NULL)`),
	index("token_marks_source_verdict_idx").using("btree", table.sourceVerdictId.asc().nullsLast().op("int8_ops")),
	index("token_marks_token_idx").using("btree", table.tokenAddress.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.sourceVerdictId],
			foreignColumns: [verdicts.id],
			name: "token_marks_source_verdict_id_fkey"
		}),
	unique("token_marks_token_address_kind_key").on(table.tokenAddress, table.kind),
	pgPolicy("token_marks_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("token_marks_kind_check", sql`kind = ANY (ARRAY['honeypot'::text, 'pump_dump'::text])`),
]);

export const markEvents = pgTable("mark_events", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "mark_events_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	tokenAddress: text("token_address").notNull(),
	kind: text().notNull(),
	action: text().notNull(),
	actor: text().default('system').notNull(),
	reason: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	verdictId: bigint("verdict_id", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("mark_events_token_idx").using("btree", table.tokenAddress.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("mark_events_verdict_idx").using("btree", table.verdictId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.verdictId],
			foreignColumns: [verdicts.id],
			name: "mark_events_verdict_id_fkey"
		}),
	pgPolicy("mark_events_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("mark_events_action_check", sql`action = ANY (ARRAY['created'::text, 're-fired'::text, 'lifted'::text, 're-armed'::text])`),
]);

export const walletEdges = pgTable("wallet_edges", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "wallet_edges_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	funder: text().notNull(),
	fundee: text().notNull(),
	txHash: text("tx_hash").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	blockNumber: bigint("block_number", { mode: "number" }),
	valueWei: numeric("value_wei"),
	kind: text().default('first_fund').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("wallet_edges_fundee_idx").using("btree", table.fundee.asc().nullsLast().op("text_ops")),
	index("wallet_edges_funder_idx").using("btree", table.funder.asc().nullsLast().op("text_ops")),
	unique("wallet_edges_funder_fundee_tx_hash_key").on(table.funder, table.fundee, table.txHash),
	pgPolicy("wallet_edges_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("wallet_edges_kind_check", sql`kind = ANY (ARRAY['first_fund'::text, 'fund'::text, 'payout'::text])`),
]);

export const walletHubs = pgTable("wallet_hubs", {
	address: text().primaryKey().notNull(),
	label: text(),
	source: text().default('auto-fanout').notNull(),
	fanoutCount: integer("fanout_count"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	pgPolicy("wallet_hubs_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("wallet_hubs_source_check", sql`source = ANY (ARRAY['auto-fanout'::text, 'manual'::text])`),
]);

export const walletStains = pgTable("wallet_stains", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "wallet_stains_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	address: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	originRugId: bigint("origin_rug_id", { mode: "number" }).notNull(),
	originDeployer: text("origin_deployer").notNull(),
	hops: smallint().notNull(),
	direction: text().notNull(),
	path: jsonb().default([]).notNull(),
	active: boolean().default(true).notNull(),
	liftedReason: text("lifted_reason"),
	liftedAt: timestamp("lifted_at", { withTimezone: true, mode: 'string' }),
	liftedBy: text("lifted_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("wallet_stains_address_active_idx").using("btree", table.address.asc().nullsLast().op("text_ops")).where(sql`active`),
	index("wallet_stains_origin_idx").using("btree", table.originDeployer.asc().nullsLast().op("text_ops")),
	index("wallet_stains_origin_rug_idx").using("btree", table.originRugId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.originRugId],
			foreignColumns: [rugs.id],
			name: "wallet_stains_origin_rug_id_fkey"
		}),
	unique("wallet_stains_address_origin_rug_id_key").on(table.address, table.originRugId),
	pgPolicy("wallet_stains_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("wallet_stains_direction_check", sql`direction = ANY (ARRAY['upstream'::text, 'downstream'::text])`),
	check("wallet_stains_hops_check", sql`(hops >= 1) AND (hops <= 2)`),
]);

export const bytecodeTemplates = pgTable("bytecode_templates", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "bytecode_templates_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	bytecodeHash: text("bytecode_hash").notNull(),
	label: text(),
	classification: text().default('unknown').notNull(),
	seenCount: integer("seen_count").default(1).notNull(),
	firstSeenToken: text("first_seen_token"),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("bytecode_templates_bytecode_hash_key").on(table.bytecodeHash),
	pgPolicy("bytecode_templates_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("bytecode_templates_classification_check", sql`classification = ANY (ARRAY['legit-template'::text, 'scam-template'::text, 'unknown'::text])`),
]);

export const slowRugWatch = pgTable("slow_rug_watch", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "slow_rug_watch_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	tokenAddress: text("token_address").notNull(),
	reason: text().notNull(),
	peakLiquidityUsd: numeric("peak_liquidity_usd"),
	currentLiquidityUsd: numeric("current_liquidity_usd"),
	drainPct: numeric("drain_pct"),
	devClusterShareDelta: numeric("dev_cluster_share_delta"),
	evidence: jsonb().default({}).notNull(),
	cleared: boolean().default(false).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	pinnedPoolAddress: text("pinned_pool_address"),
	rescanAttempts: integer("rescan_attempts").default(0).notNull(),
	rescanLastAttemptAt: timestamp("rescan_last_attempt_at", { withTimezone: true, mode: 'string' }),
	rescanDoneAt: timestamp("rescan_done_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("slow_rug_watch_active_idx").using("btree", table.tokenAddress.asc().nullsLast().op("text_ops")).where(sql`(cleared = false)`),
	index("slow_rug_watch_token_idx").using("btree", table.tokenAddress.asc().nullsLast().op("text_ops")),
	unique("slow_rug_watch_token_address_reason_key").on(table.tokenAddress, table.reason),
	pgPolicy("slow_rug_watch_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
]);

export const marketSnapshots = pgTable("market_snapshots", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "market_snapshots_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	tokenAddress: text("token_address").notNull(),
	priceUsd: numeric("price_usd"),
	liquidityUsd: numeric("liquidity_usd"),
	volume24HUsd: numeric("volume_24h_usd"),
	buys24H: integer("buys_24h"),
	sells24H: integer("sells_24h"),
	fdvUsd: numeric("fdv_usd"),
	poolAddress: text("pool_address"),
	poolCreatedAt: timestamp("pool_created_at", { withTimezone: true, mode: 'string' }),
	ts: timestamp({ withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	bucketAt: timestamp("bucket_at", { withTimezone: true, mode: 'string' }),
	provider: text(),
	observationStatus: text("observation_status"),
	buyers24H: integer("buyers_24h"),
	sellers24H: integer("sellers_24h"),
}, (table) => [
	uniqueIndex("market_snapshots_token_bucket_idx").using("btree", table.tokenAddress.asc().nullsLast().op("text_ops"), table.bucketAt.asc().nullsLast().op("timestamptz_ops")).where(sql`(bucket_at IS NOT NULL)`),
	index("market_snapshots_token_ts_idx").using("btree", table.tokenAddress.asc().nullsLast().op("timestamptz_ops"), table.ts.desc().nullsFirst().op("text_ops")),
	pgPolicy("market_snapshots_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
]);

export const appErrorEvents = pgTable("app_error_events", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "app_error_events_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	severity: text().notNull(),
	category: text().notNull(),
	code: text().notNull(),
	message: text().notNull(),
	fingerprint: text().notNull(),
	release: text(),
	runtime: text(),
	route: text(),
	operation: text(),
	requestId: text("request_id"),
	scanId: text("scan_id"),
	tokenAddress: text("token_address"),
	providerId: text("provider_id"),
	dexAdapter: text("dex_adapter"),
	httpStatus: integer("http_status"),
	retryable: boolean(),
	requestOutcome: text("request_outcome"),
	stack: text(),
	details: jsonb(),
	acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: 'string' }),
	acknowledgedBy: text("acknowledged_by"),
	resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: 'string' }),
	resolvedBy: text("resolved_by"),
}, (table) => [
	index("app_error_events_cursor_idx").using("btree", table.occurredAt.desc().nullsFirst().op("int8_ops"), table.id.desc().nullsFirst().op("int8_ops")),
	index("app_error_events_fingerprint_idx").using("btree", table.fingerprint.asc().nullsLast().op("text_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
	index("app_error_events_severity_idx").using("btree", table.severity.asc().nullsLast().op("timestamptz_ops"), table.occurredAt.desc().nullsFirst().op("text_ops")),
	index("app_error_events_unresolved_idx").using("btree", table.occurredAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`((resolved_at IS NULL) AND (severity = ANY (ARRAY['ERROR'::text, 'FATAL'::text])))`),
	check("app_error_events_severity_check", sql`severity = ANY (ARRAY['WARN'::text, 'ERROR'::text, 'FATAL'::text])`),
]);

export const tokenScanState = pgTable("token_scan_state", {
	tokenAddress: text("token_address").primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	latestVerdictId: bigint("latest_verdict_id", { mode: "number" }),
	resultFingerprint: text("result_fingerprint"),
	lastCompleteScanAt: timestamp("last_complete_scan_at", { withTimezone: true, mode: 'string' }),
	lastReceiptAt: timestamp("last_receipt_at", { withTimezone: true, mode: 'string' }),
	dexProtocols: text("dex_protocols").array().default([]).notNull(),
	primaryPoolAddress: text("primary_pool_address"),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("token_scan_state_last_scan_idx").using("btree", table.lastCompleteScanAt.asc().nullsLast().op("timestamptz_ops")),
	index("token_scan_state_latest_verdict_idx").using("btree", table.latestVerdictId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.latestVerdictId],
			foreignColumns: [verdicts.id],
			name: "token_scan_state_latest_verdict_id_fkey"
		}),
	pgPolicy("token_scan_state_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
]);

export const factoryCursor = pgTable("factory_cursor", {
	factoryAddress: text("factory_address").primaryKey().notNull(),
	protocol: text().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	lastProcessedBlock: bigint("last_processed_block", { mode: "number" }).default(0).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("factory_cursor_protocol_check", sql`protocol = ANY (ARRAY['uniswap-v2'::text, 'uniswap-v3'::text, 'slipstream-cl'::text])`),
]);

export const curveTokens = pgTable("curve_tokens", {
	tokenAddress: text("token_address").primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	launchpadId: bigint("launchpad_id", { mode: "number" }).notNull(),
	name: text(),
	symbol: text(),
	metadataUri: text("metadata_uri"),
	creatorAddress: text("creator_address"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdBlock: bigint("created_block", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	raisedWei: numeric("raised_wei").default('0').notNull(),
	targetWei: numeric("target_wei"),
	progressBps: integer("progress_bps").default(0).notNull(),
	peakProgressBps: integer("peak_progress_bps").default(0).notNull(),
	buys: integer().default(0).notNull(),
	sells: integer().default(0).notNull(),
	creatorBuyWei: numeric("creator_buy_wei").default('0').notNull(),
	lastTradeAt: timestamp("last_trade_at", { withTimezone: true, mode: 'string' }),
	status: text().default('CURVING').notNull(),
	dexPoolAddress: text("dex_pool_address"),
	graduatedAt: timestamp("graduated_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	// When a qualifying drop from peak was FIRST seen (migration 0051). The
	// accusation is withheld until it has survived the confirmation window, so
	// a graduation — which drains the curve exactly like a rug does — has time
	// for its pool to be indexed. NULL = nothing currently suspected.
	rugSuspectedAt: timestamp("rug_suspected_at", { withTimezone: true, mode: 'string' }),
	// Rotation clock for the pool-appearance sweep only (migration 0049).
	// Deliberately NOT `updated_at`: that column feeds recordStalledCurves'
	// coalesce, and keeping it fresh would make some rows unstallable.
	// NULL = never swept, and sorts first.
	lastPoolCheckAt: timestamp("last_pool_check_at", { withTimezone: true, mode: 'string' }),
	/** Consecutive no-pool checks; drives the sweep backoff (migration 0086). */
	poolCheckAttempts: integer("pool_check_attempts").default(0).notNull(),
	// L33 (migration 0065). The raise's denomination, per token — pons-v2 picks
	// it per launch. NULL quoteToken = native ETH; a non-null quoteToken with a
	// NULL quoteSymbol means symbol() was unreadable, so render the address
	// rather than falling back to "ETH".
	quoteToken: text("quote_token"),
	quoteSymbol: text("quote_symbol"),
	quoteDecimals: smallint("quote_decimals"),
	// 0089 — pons-v2's per-token bonding curve, emitted once by TokenLaunched.
	// NULL means "not yet learned", never "no curve": the adapter backfills
	// pre-0089 rows on a rotation, and a log whose curve we cannot name is a
	// LOST trade, not an absent one (§4).
	curveAddress: text("curve_address"),
}, (table) => [
	index("curve_tokens_creator_idx").using("btree", table.creatorAddress.asc().nullsLast().op("text_ops")).where(sql`(creator_address IS NOT NULL)`),
	index("curve_tokens_feed_idx").using("btree", table.status.asc().nullsLast().op("int4_ops"), table.progressBps.desc().nullsFirst().op("int4_ops")),
	index("curve_tokens_ts_backfill_idx").using("btree", table.progressBps.desc().nullsFirst().op("int4_ops")).where(sql`(created_at IS NULL AND created_block IS NOT NULL)`),
	index("curve_tokens_pad_idx").using("btree", table.launchpadId.asc().nullsLast().op("int8_ops"), table.status.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.launchpadId],
			foreignColumns: [launchpads.id],
			name: "curve_tokens_launchpad_id_fkey"
		}).onDelete("cascade"),
	check("curve_tokens_progress_bps_check", sql`(progress_bps >= 0) AND (progress_bps <= 10000)`),
	check("curve_tokens_peak_progress_bps_check", sql`(peak_progress_bps >= 0) AND (peak_progress_bps <= 10000)`),
	check("curve_tokens_status_check", sql`status = ANY (ARRAY['CURVING'::text, 'GRADUATED'::text, 'STALLED'::text, 'RUGGED'::text])`),
	check("curve_tokens_token_address_check", sql`token_address = lower(token_address)`),
	check("curve_tokens_quote_token_check", sql`quote_token IS NULL OR quote_token = lower(quote_token)`),
	check("curve_tokens_quote_decimals_check", sql`quote_decimals IS NULL OR (quote_decimals >= 0 AND quote_decimals <= 36)`),
	check("curve_tokens_curve_address_check", sql`curve_address IS NULL OR curve_address = lower(curve_address)`),
	index("curve_tokens_curve_address_idx").using("btree", table.curveAddress.asc().nullsLast().op("text_ops")).where(sql`(curve_address IS NOT NULL)`),
	index("curve_tokens_curve_backfill_idx").using("btree", table.launchpadId.asc().nullsLast().op("int8_ops")).where(sql`(curve_address IS NULL AND status = 'CURVING'::text)`),
]);

/**
 * Attribution archive for pruned `curve_tokens` rows (migration 0062 part 3,
 * KNOWN-PROBLEMS L26). `readCurveTokenProvenance` falls back here on a miss, so
 * retention never demotes a launch origin from *attributable* to *unknown* —
 * `creator_address` is the only input that makes `attributable: true` possible
 * (lib/scanner/launch-origin.ts).
 *
 * `raised_wei` / `creator_buy_wei` are archived, not synthesised: the provenance
 * check computes creator-share from them, and zeros would publish "0% of the
 * raise" as "an unknown share". Defaults pinned against the migration — §3.
 */
export const curveLaunchOrigins = pgTable("curve_launch_origins", {
	tokenAddress: text("token_address").primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	launchpadId: bigint("launchpad_id", { mode: "number" }).notNull(),
	creatorAddress: text("creator_address").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	createdBlock: bigint("created_block", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	raisedWei: numeric("raised_wei").default('0').notNull(),
	creatorBuyWei: numeric("creator_buy_wei").default('0').notNull(),
	status: text().notNull(),
	prunedAt: timestamp("pruned_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	// 0082 — L106's relayer count reads this table on every pad-launched scan.
	// Without it the count is a seq scan that grows with the archive.
	index("curve_launch_origins_creator_idx").using("btree", table.creatorAddress.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.launchpadId],
			foreignColumns: [launchpads.id],
			name: "curve_launch_origins_launchpad_id_fkey"
		}).onDelete("cascade"),
	check("curve_launch_origins_token_address_check", sql`token_address = lower(token_address)`),
	// Restated from the migration: only STALLED is archivable, because only a
	// STALLED row's dropped columns are provably zero. Widening the job's status
	// filter must fail here, not archive a row the fallback cannot replay.
	check("curve_launch_origins_status_check", sql`status = 'STALLED'::text`),
]);

export const siteConfig = pgTable("site_config", {
	key: text().primaryKey().notNull(),
	value: text().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedBy: text("updated_by"),
});

export const whitelistMembers = pgTable("whitelist_members", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "whitelist_members_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	walletAddress: text("wallet_address").notNull(),
	twitterUsername: text("twitter_username"),
	twitterUserId: text("twitter_user_id"),
	twitterConnectedAt: timestamp("twitter_connected_at", { withTimezone: true, mode: 'string' }),
	twitterOauthProvider: text("twitter_oauth_provider"),
	socialStepsPolicyVersion: text("social_steps_policy_version").default('2.0-oauth').notNull(),
	whitelistStatus: text("whitelist_status").default('pending').notNull(),
	step1Status: text("step_1_status").default('not_started').notNull(),
	step2Status: text("step_2_status").default('not_started').notNull(),
	step3Status: text("step_3_status").default('not_started').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	approvedAt: timestamp("approved_at", { withTimezone: true, mode: 'string' }),
	xFollowed: boolean("x_followed").default(false).notNull(),
	xLiked: boolean("x_liked").default(false).notNull(),
	xPosted: boolean("x_posted").default(false).notNull(),
	xPostedTweetId: text("x_posted_tweet_id"),
	telegramUserId: text("telegram_user_id"),
	telegramUsername: text("telegram_username"),
	telegramFirstName: text("telegram_first_name"),
	telegramConnectedAt: timestamp("telegram_connected_at", { withTimezone: true, mode: 'string' }),
	telegramChatMember: boolean("telegram_chat_member").default(false).notNull(),
	telegramMembershipCheckedAt: timestamp("telegram_membership_checked_at", { withTimezone: true, mode: 'string' }),
	eligible: boolean().generatedAlwaysAs(sql`(twitter_user_id IS NOT NULL)`),
}, (table) => [
	index("whitelist_members_eligible_idx").using("btree", table.eligible.asc().nullsLast().op("bool_ops")),
	index("whitelist_members_status_idx").using("btree", table.whitelistStatus.asc().nullsLast().op("text_ops")),
	uniqueIndex("whitelist_members_telegram_user_id_key").using("btree", table.telegramUserId.asc().nullsLast().op("text_ops")).where(sql`(telegram_user_id IS NOT NULL)`),
	index("whitelist_members_twitter_idx").using("btree", table.twitterUsername.asc().nullsLast().op("text_ops")).where(sql`(twitter_username IS NOT NULL)`),
	uniqueIndex("whitelist_members_twitter_user_id_key").using("btree", table.twitterUserId.asc().nullsLast().op("text_ops")).where(sql`(twitter_user_id IS NOT NULL)`),
	index("whitelist_members_wallet_idx").using("btree", table.walletAddress.asc().nullsLast().op("text_ops")),
	unique("whitelist_members_wallet_address_key").on(table.walletAddress),
	check("whitelist_members_step_1_status_check", sql`step_1_status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text, 'failed'::text])`),
	check("whitelist_members_step_2_status_check", sql`step_2_status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text, 'failed'::text])`),
	check("whitelist_members_step_3_status_check", sql`step_3_status = ANY (ARRAY['not_started'::text, 'in_progress'::text, 'completed'::text, 'failed'::text])`),
	check("whitelist_members_twitter_username_check", sql`(twitter_username IS NULL) OR (twitter_username ~ '^[A-Za-z0-9_]{1,15}$'::text)`),
	check("whitelist_members_wallet_address_check", sql`wallet_address = lower(wallet_address)`),
	check("whitelist_members_whitelist_status_check", sql`whitelist_status = ANY (ARRAY['pending'::text, 'approved'::text, 'rejected'::text, 'revoked'::text])`),
]);

export const trustedLockers = pgTable("trusted_lockers", {
	address: text().primaryKey().notNull(),
	label: text().notNull(),
	kind: text().default('timelock').notNull(),
	enabled: boolean().default(true).notNull(),
	notes: text(),
	addedBy: text("added_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("trusted_lockers_kind_check", sql`kind = ANY (ARRAY['permanent'::text, 'timelock'::text])`),
]);

// A1 (KNOWN-PROBLEMS L58) — seeded dispatch table, migration 0072. Distinct
// from `trustedLockers` above: this names WHICH ABI a locker answers, not
// whether it's exempted from whale detection. A row here with no working
// adapter in lib/dex/lock-terms.ts still resolves "unreadable", never a
// silent success — see the migration header.
export const lockerAdapters = pgTable("locker_adapters", {
	address: text().primaryKey().notNull(),
	chainId: bigint("chain_id", { mode: "number" }).default(4663).notNull(),
	family: text().notNull(),
	label: text().notNull(),
	enabled: boolean().default(true).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("locker_adapters_address_check", sql`(address = lower(address)) AND (address ~ '^0x[0-9a-f]{40}$'::text)`),
]);

// A2 (KNOWN-PROBLEMS L58) — seeded dispatch table, migration 0073. Same shape
// as lockerAdapters above but for launch factories whose TokenLaunched/DevBuy
// event ABI is chain-verified — not a generic reader over every contract
// named "LaunchFactory" (50+ on this chain, mostly private one-shot clones).
export const launchFactories = pgTable("launch_factories", {
	address: text().primaryKey().notNull(),
	chainId: bigint("chain_id", { mode: "number" }).default(4663).notNull(),
	label: text().notNull(),
	enabled: boolean().default(true).notNull(),
	notes: text(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("launch_factories_address_check", sql`(address = lower(address)) AND (address ~ '^0x[0-9a-f]{40}$'::text)`),
]);

export const scanUncertainties = pgTable("scan_uncertainties", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "scan_uncertainties_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	tokenAddress: text("token_address").notNull(),
	checkId: text("check_id").notNull(),
	code: text().notNull(),
	subject: text().default('').notNull(),
	summary: text().notNull(),
	detail: jsonb(),
	firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastScanId: text("last_scan_id"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	lastVerdictId: bigint("last_verdict_id", { mode: "number" }),
	timesSeen: integer("times_seen").default(1).notNull(),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	reviewedBy: text("reviewed_by"),
	resolution: text(),
}, (table) => [
	index("scan_uncertainties_open_idx").using("btree", table.lastSeenAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(reviewed_at IS NULL)`),
	index("scan_uncertainties_token_idx").using("btree", table.tokenAddress.asc().nullsLast().op("text_ops"), table.lastSeenAt.desc().nullsFirst().op("text_ops")),
	unique("scan_uncertainties_key").on(table.tokenAddress, table.checkId, table.code, table.subject),
]);

export const launchpads = pgTable("launchpads", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "launchpads_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	slug: text().notNull(),
	name: text().notNull(),
	curveAddress: text("curve_address").notNull(),
	adapter: text().notNull(),
	config: jsonb().default({}).notNull(),
	enabled: boolean().default(false).notNull(),
	notes: text(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	lastProcessedBlock: bigint("last_processed_block", { mode: "number" }).default(0).notNull(),
	lastProbe: jsonb("last_probe"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	venueModel: text("venue_model").notNull(),
}, (table) => [
	unique("launchpads_slug_key").on(table.slug),
	unique("launchpads_curve_address_key").on(table.curveAddress),
	check("launchpads_adapter_check", sql`adapter = ANY (ARRAY['curve-events-v1'::text, 'flap-v1'::text, 'pons-v1'::text, 'pons-v2'::text, 'stonk-v1'::text, 'stoxes-v1'::text, 'party-v1'::text, 'cashcat-v1'::text])`),
	check("launchpads_curve_address_check", sql`(curve_address = lower(curve_address)) AND (curve_address ~ '^0x[0-9a-f]{40}$'::text)`),
	check("launchpads_slug_check", sql`slug = lower(slug)`),
	check("launchpads_venue_model_check", sql`venue_model = ANY (ARRAY['BONDING_CURVE'::text, 'DEX_RESTRICTED'::text])`),
]);

export const launchCandidates = pgTable("launch_candidates", {
	tokenAddress: text("token_address").primaryKey().notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	launchpadId: bigint("launchpad_id", { mode: "number" }),
	sourceKind: text("source_kind").notNull(),
	venueModel: text("venue_model"),
	lifecycleState: text("lifecycle_state").default('CANDIDATE').notNull(),
	poolAddress: text("pool_address"),
	tokenName: text("token_name"),
	tokenSymbol: text("token_symbol"),
	liquidityUsd: numeric("liquidity_usd"),
	volume24HUsd: numeric("volume_24h_usd"),
	// Naming matches volume24HUsd's own digit-boundary capitalization
	// (CLAUDE.md §3 rule 5) so a future drizzle-kit introspection re-derives
	// the SAME name instead of renaming it out from under this file.
	buys24H: integer("buys_24h"),
	sells24H: integer("sells_24h"),
	progressBps: integer("progress_bps"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).notNull(),
	surfacedAt: timestamp("surfaced_at", { withTimezone: true, mode: 'string' }),
	graduatedAt: timestamp("graduated_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("launch_candidates_feed_idx").using("btree", table.venueModel.asc().nullsLast().op("text_ops"), table.lifecycleState.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("timestamptz_ops")),
	index("launch_candidates_expires_idx").using("btree", table.expiresAt.asc().nullsLast().op("timestamptz_ops")),
	foreignKey({
			columns: [table.launchpadId],
			foreignColumns: [launchpads.id],
			name: "launch_candidates_launchpad_id_fkey"
		}).onDelete("set null"),
	check("launch_candidates_token_address_check", sql`token_address = lower(token_address)`),
	check("launch_candidates_pool_address_check", sql`(pool_address IS NULL) OR (pool_address = lower(pool_address))`),
	check("launch_candidates_source_kind_check", sql`source_kind = ANY (ARRAY['DIRECT_DEX'::text, 'LAUNCHPAD'::text])`),
	check("launch_candidates_venue_model_check", sql`(venue_model IS NULL) OR (venue_model = ANY (ARRAY['BONDING_CURVE'::text, 'DEX_RESTRICTED'::text]))`),
	check("launch_candidates_lifecycle_state_check", sql`lifecycle_state = ANY (ARRAY['CANDIDATE'::text, 'SURFACED'::text, 'GRADUATED'::text, 'EXPIRED'::text])`),
	check("launch_candidates_progress_bps_check", sql`(progress_bps IS NULL) OR ((progress_bps >= 0) AND (progress_bps <= 10000))`),
	check("launch_candidates_expires_at_check", sql`expires_at = (created_at + '7 days'::interval)`),
]);

export const launchTombstones = pgTable("launch_tombstones", {
	tokenAddress: text("token_address").primaryKey().notNull(),
	sourceKind: text("source_kind").notNull(),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	launchpadId: bigint("launchpad_id", { mode: "number" }),
	originalCreatedAt: timestamp("original_created_at", { withTimezone: true, mode: 'string' }).notNull(),
	expiredAt: timestamp("expired_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("launch_tombstones_token_address_check", sql`token_address = lower(token_address)`),
]);

export const trustedAddress = pgTable("trusted_address", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	address: text().notNull(),
	chainId: integer("chain_id").default(4663).notNull(),
	category: text().notNull(),
	subtype: text(),
	label: text().notNull(),
	dexId: text("dex_id"),
	metadata: jsonb().default({}).notNull(),
	enabled: boolean().default(true).notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	verifyStatus: text("verify_status").default('unchecked').notNull(),
	createdBy: text("created_by"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("trusted_address_enabled_category_idx").using("btree", table.category.asc().nullsLast().op("text_ops"), table.dexId.asc().nullsLast().op("text_ops")).where(sql`enabled`),
	unique("trusted_address_address_chain_id_key").on(table.address, table.chainId),
	pgPolicy("trusted_address_public_read", { as: "permissive", for: "select", to: ["anon", "authenticated"], using: sql`true` }),
	check("trusted_address_address_check", sql`(address = lower(address)) AND (address ~ '^0x[0-9a-f]{40}$'::text)`),
	check("trusted_address_category_check", sql`category = ANY (ARRAY['dex-factory'::text, 'dex-router'::text, 'dex-quoter'::text, 'dex-position-manager'::text, 'dex-pool-manager'::text, 'dex-state-view'::text, 'permit2'::text, 'lp-locker'::text, 'burn-address'::text, 'infra-asset'::text, 'rwa-beacon'::text, 'rwa-impl'::text, 'rwa-factory'::text, 'rwa-vault'::text, 'rwa-operator'::text, 'bridge-system-owner'::text, 'trusted-proxy'::text, 'dex-infra'::text])`),
	check("trusted_address_label_check", sql`length(TRIM(BOTH FROM label)) >= 2`),
	check("trusted_address_verify_status_check", sql`verify_status = ANY (ARRAY['ok'::text, 'failed'::text, 'unchecked'::text, 'unprobeable'::text])`),
]);

export const contractAuditArtifact = pgTable("contract_audit_artifact", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	chainId: integer("chain_id").default(4663).notNull(),
	runtimeCodeHash: text("runtime_code_hash").notNull(),
	templateHash: text("template_hash"),
	ruleVersion: text("rule_version").notNull(),
	abiHash: text("abi_hash"),
	sourceHash: text("source_hash"),
	capabilities: jsonb().default([]).notNull(),
	// 0050. Default matches the migration's `default '{}'::jsonb` exactly —
	// drizzle-kit has rendered a jsonb default wrong here before (CLAUDE.md §3).
	identity: jsonb().default({}).notNull(),
	completeness: text().notNull(),
	sourceBytes: integer("source_bytes"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("contract_audit_artifact_template_idx").using("btree", table.templateHash.asc().nullsLast().op("text_ops")).where(sql`(template_hash IS NOT NULL)`),
	unique("contract_audit_artifact_chain_id_runtime_code_hash_rule_ver_key").on(table.chainId, table.runtimeCodeHash, table.ruleVersion),
	check("contract_audit_artifact_completeness_check", sql`completeness = ANY (ARRAY['complete'::text, 'partial'::text, 'unresolved'::text])`),
	check("contract_audit_artifact_runtime_code_hash_check", sql`runtime_code_hash ~ '^0x[0-9a-f]{64}$'::text`),
]);

export const contractAuditInstance = pgTable("contract_audit_instance", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	address: text().notNull(),
	blockHash: text("block_hash").notNull(),
	ruleVersion: text("rule_version").notNull(),
	artifactId: uuid("artifact_id").notNull(),
	proxyGraph: jsonb("proxy_graph").default({}).notNull(),
	authorities: jsonb().default({}).notNull(),
	findings: jsonb().default([]).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("contract_audit_instance_address_idx").using("btree", table.address.asc().nullsLast().op("text_ops"), table.createdAt.desc().nullsFirst().op("text_ops")),
	index("contract_audit_instance_artifact_idx").using("btree", table.artifactId.asc().nullsLast().op("uuid_ops")),
	foreignKey({
			columns: [table.artifactId],
			foreignColumns: [contractAuditArtifact.id],
			name: "contract_audit_instance_artifact_id_fkey"
		}),
	unique("contract_audit_instance_address_block_hash_rule_version_key").on(table.address, table.blockHash, table.ruleVersion),
	check("contract_audit_instance_address_check", sql`(address = lower(address)) AND (address ~ '^0x[0-9a-f]{40}$'::text)`),
]);

export const trustReviewCandidate = pgTable("trust_review_candidate", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	chainId: integer("chain_id").default(4663).notNull(),
	subjectAddress: text("subject_address").notNull(),
	candidateType: text("candidate_type").notNull(),
	relationHash: text("relation_hash").default('').notNull(),
	status: text().default('open').notNull(),
	evidence: jsonb().default({}).notNull(),
	timesSeen: integer("times_seen").default(1).notNull(),
	firstToken: text("first_token"),
	firstSeenAt: timestamp("first_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: 'string' }),
	reviewedBy: text("reviewed_by"),
	resolution: text(),
}, (table) => [
	index("trust_review_candidate_open_idx").using("btree", table.lastSeenAt.desc().nullsFirst().op("timestamptz_ops")).where(sql`(status = 'open'::text)`),
	index("trust_review_candidate_subject_idx").using("btree", table.subjectAddress.asc().nullsLast().op("text_ops")),
	unique("trust_review_candidate_chain_id_subject_address_candidate_t_key").on(table.chainId, table.subjectAddress, table.candidateType, table.relationHash),
	check("trust_review_candidate_candidate_type_check", sql`candidate_type = ANY (ARRAY['PROXY_IMPLEMENTATION_CANDIDATE'::text, 'BEACON_CANDIDATE'::text, 'PROXY_ADMIN_CANDIDATE'::text, 'TIMELOCK_CONTROLLER_CANDIDATE'::text, 'MULTISIG_CONTROLLER_CANDIDATE'::text, 'ACCESS_CONTROLLER_CANDIDATE'::text, 'PROTOCOL_FACTORY_CANDIDATE'::text, 'PROTOCOL_VAULT_CANDIDATE'::text, 'PROTOCOL_FARM_STRATEGY_CANDIDATE'::text, 'LP_LOCKER_CANDIDATE'::text, 'MULTISIG_CUSTODIAN_CANDIDATE'::text, 'DEX_INFRA_CANDIDATE'::text, 'TRUST_ASSERTION_DRIFT'::text, 'CUSTOM_PROXY_UNRESOLVED'::text])`),
	check("trust_review_candidate_status_check", sql`status = ANY (ARRAY['open'::text, 'rejected'::text, 'informational'::text, 'approved'::text, 'suspended'::text])`),
	check("trust_review_candidate_subject_address_check", sql`(subject_address = lower(subject_address)) AND (subject_address ~ '^0x[0-9a-f]{40}$'::text)`),
]);

export const trustAssertion = pgTable("trust_assertion", {
	id: uuid().defaultRandom().primaryKey().notNull(),
	chainId: integer("chain_id").default(4663).notNull(),
	subjectAddress: text("subject_address").notNull(),
	category: text().notNull(),
	trustScope: text("trust_scope").notNull(),
	parentAddress: text("parent_address"),
	expectedCodeHash: text("expected_code_hash"),
	expectedState: jsonb("expected_state").default({}).notNull(),
	status: text().default('pending').notNull(),
	reviewer: text(),
	notes: text(),
	evidenceHash: text("evidence_hash"),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("trust_assertion_approved_idx").using("btree", table.category.asc().nullsLast().op("text_ops"), table.trustScope.asc().nullsLast().op("text_ops")).where(sql`(status = 'approved'::text)`),
	uniqueIndex("trust_assertion_claim_key").using("btree", sql`chain_id`, sql`subject_address`, sql`category`, sql`trust_scope`, sql`COALESCE(parent_address, ''::text)`),
	index("trust_assertion_subject_idx").using("btree", table.subjectAddress.asc().nullsLast().op("text_ops")),
	check("trust_assertion_category_check", sql`category = ANY (ARRAY['dex-factory'::text, 'dex-router'::text, 'dex-quoter'::text, 'dex-position-manager'::text, 'dex-pool-manager'::text, 'dex-state-view'::text, 'permit2'::text, 'lp-locker'::text, 'burn-address'::text, 'infra-asset'::text, 'rwa-beacon'::text, 'rwa-impl'::text, 'rwa-factory'::text, 'rwa-vault'::text, 'rwa-operator'::text, 'bridge-system-owner'::text, 'protocol-factory'::text, 'protocol-beacon'::text, 'protocol-implementation'::text, 'protocol-vault'::text, 'protocol-strategy'::text, 'multisig-controller'::text, 'timelock-controller'::text, 'access-controller'::text])`),
	check("trust_assertion_parent_address_check", sql`(parent_address IS NULL) OR ((parent_address = lower(parent_address)) AND (parent_address ~ '^0x[0-9a-f]{40}$'::text))`),
	check("trust_assertion_status_check", sql`status = ANY (ARRAY['pending'::text, 'approved'::text, 'suspended'::text, 'revoked'::text])`),
	check("trust_assertion_subject_address_check", sql`(subject_address = lower(subject_address)) AND (subject_address ~ '^0x[0-9a-f]{40}$'::text)`),
	check("trust_assertion_trust_scope_check", sql`trust_scope = ANY (ARRAY['AUTHENTICITY'::text, 'CODE_TEMPLATE'::text, 'UPGRADE_AUTHORITY'::text, 'CUSTODY_LOCK'::text, 'DEX_PLUMBING'::text, 'SYSTEM_INFRA'::text])`),
]);

export const scanRuns = pgTable("scan_runs", {
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "scan_runs_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	scanId: text("scan_id").notNull(),
	requestId: text("request_id"),
	tokenAddress: text("token_address").notNull(),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	durationMs: integer("duration_ms"),
	outcome: text(),
	source: text(),
	receiptAction: text("receipt_action"),
	// You can use { mode: "bigint" } if numbers are exceeding js number limitations
	verdictId: bigint("verdict_id", { mode: "number" }),
	score: integer(),
	tier: text(),
	dexProtocols: text("dex_protocols").array().default([]).notNull(),
	adapterOutcomes: jsonb("adapter_outcomes"),
	providerStates: jsonb("provider_states"),
	rpcLogicalCalls: integer("rpc_logical_calls").default(0).notNull(),
	rpcPhysicalAttempts: integer("rpc_physical_attempts").default(0).notNull(),
	rpcExpectedReverts: integer("rpc_expected_reverts").default(0).notNull(),
	rpcProviderSwitches: integer("rpc_provider_switches").default(0).notNull(),
	rpcMethodCounts: jsonb("rpc_method_counts"),
	rpcTotalLatencyMs: integer("rpc_total_latency_ms"),
	rpcBudgetExceeded: boolean("rpc_budget_exceeded").default(false).notNull(),
	errorCode: text("error_code"),
	evidenceBytes: integer("evidence_bytes"),
	auditCpuMs: integer("audit_cpu_ms"),
	auditExtraRpcCalls: integer("audit_extra_rpc_calls"),
	auditExplorerCalls: integer("audit_explorer_calls"),
	auditCacheStatus: text("audit_cache_status"),
	auditTargetsAnalyzed: integer("audit_targets_analyzed"),
	auditTruncationReason: text("audit_truncation_reason"),
	// migration 0032: terminal-cause + upstream phase timing
	terminalCause: text("terminal_cause"),
	explorerWallMs: integer("explorer_wall_ms"),
	marketWallMs: integer("market_wall_ms"),
	dbWallMs: integer("db_wall_ms"),
	upstashWallMs: integer("upstash_wall_ms"),
	// migration 0033: Multicall3 batch observability (docs/KNOWN-PROBLEMS.md C5)
	multicallBatches: integer("multicall_batches"),
	multicallBatchedCalls: integer("multicall_batched_calls"),
	multicallSubcallFailures: integer("multicall_subcall_failures"),
	multicallFallbackCount: integer("multicall_fallback_count"),
	// migration 0045: explorer latency breakdown. explorer_wall_ms alone
	// conflates our own queue wait with real upstream time and double-counts it
	// across concurrent calls — these explain it rather than replace it.
	explorerQueueMs: integer("explorer_queue_ms"),
	explorerCalls: integer("explorer_calls"),
	explorerEndpointCounts: jsonb("explorer_endpoint_counts"),
	// migration 0046: explorer reads served with no network call (in-flight join
	// or per-scan memo). Read against explorer_calls to size the dedupe's value.
	explorerDeduped: integer("explorer_deduped"),
	// migration 0067: WHO served each call. Complement of provider_states,
	// which records only denials — never read one for the other (L40).
	providerCalls: jsonb("provider_calls"),
}, (table) => [
	index("scan_runs_budget_idx").using("btree", table.rpcBudgetExceeded.asc().nullsLast().op("timestamptz_ops"), table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
	index("scan_runs_cursor_idx").using("btree", table.startedAt.desc().nullsFirst().op("int8_ops"), table.id.desc().nullsFirst().op("int8_ops")),
	index("scan_runs_outcome_idx").using("btree", table.outcome.asc().nullsLast().op("text_ops"), table.startedAt.desc().nullsFirst().op("text_ops")),
	index("scan_runs_token_idx").using("btree", table.tokenAddress.asc().nullsLast().op("timestamptz_ops"), table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
	index("scan_runs_verdict_idx").using("btree", table.verdictId.asc().nullsLast().op("int8_ops")),
	foreignKey({
			columns: [table.verdictId],
			foreignColumns: [verdicts.id],
			name: "scan_runs_verdict_id_fkey"
		}),
	unique("scan_runs_scan_id_key").on(table.scanId),
]);

// migration 0044: durable store for the full-history log index (log-index
// rework §7 step 2). Replaces the 7-day Valkey TTL — event history is
// append-only and immutable, so expiring it was a category error and was the
// direct cause of multi-million-block "incremental" top-ups.
// migration 0047. Read-through cache of the explorer's /addresses/:id — the
// longest single read in the scan's opening gather (3.0-5.6s measured).
// Successful reads only; a fault is never stored. See the migration for why
// is_scam/public_tags are allowed to be one TTL stale.
export const explorerAddressInfoCache = pgTable("explorer_address_info_cache", {
	address: text().primaryKey().notNull(),
	payload: jsonb().notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("explorer_address_info_cache_fetched_at_idx").using("btree", table.fetchedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const poolLogIndex = pgTable("pool_log_index", {
	cacheKey: text("cache_key").primaryKey().notNull(),
	lastBlock: numeric("last_block").notNull(),
	rows: jsonb().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("pool_log_index_updated_at_idx").using("btree", table.updatedAt.asc().nullsLast().op("timestamptz_ops")),
]);

export const poolLiquidityHistoryCursors = pgTable("pool_liquidity_history_cursors", {
	protocol: text().notNull(),
	pool: text().notNull(),
	indexedFromBlock: bigint("indexed_from_block", { mode: "number" }).notNull(),
	indexedToBlock: bigint("indexed_to_block", { mode: "number" }).notNull(),
	indexedToHash: text("indexed_to_hash").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.protocol, table.pool] }),
	check("pool_liquidity_history_cursors_from_block_check", sql`indexed_from_block >= 0`),
	check("pool_liquidity_history_cursors_to_block_check", sql`indexed_to_block >= -1`),
]);

export const poolLiquidityHistoryEvents = pgTable("pool_liquidity_history_events", {
	protocol: text().notNull(),
	pool: text().notNull(),
	blockNumber: bigint("block_number", { mode: "number" }).notNull(),
	logIndex: integer("log_index").notNull(),
	txHash: text("tx_hash").notNull(),
	eventName: text("event_name").notNull(),
	payload: jsonb().notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.protocol, table.pool, table.blockNumber, table.logIndex], name: "pool_liquidity_history_events_pkey" }),
	check("pool_liquidity_history_events_block_number_check", sql`block_number >= 0`),
	check("pool_liquidity_history_events_log_index_check", sql`log_index >= 0`),
	check("pool_liquidity_history_events_protocol_check", sql`protocol in ('uniswap-v2', 'uniswap-v3', 'slipstream-cl', 'uniswap-v4')`),
	check("pool_liquidity_history_events_event_name_check", sql`event_name in ('Mint', 'Burn', 'Collect', 'ModifyLiquidity')`),
]);

export const poolLiquidityHistoryQueue = pgTable("pool_liquidity_history_queue", {
	tokenAddress: text("token_address").primaryKey().notNull(),
	pools: jsonb().notNull(),
	priorityAmount: numeric("priority_amount").default('0').notNull(),
	queuedAt: timestamp("queued_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	leaseUntil: timestamp("lease_until", { withTimezone: true, mode: 'string' }),
	leaseToken: text("lease_token"),
	revision: bigint({ mode: "number" }).default(1).notNull(),
	attempts: integer().default(0).notNull(),
	rescanRequested: boolean("rescan_requested").default(false).notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("pool_liquidity_history_queue_priority_idx").using("btree", table.priorityAmount.desc().nullsLast().op("numeric_ops"), table.queuedAt.asc().nullsLast().op("timestamptz_ops")),
]);

/**
 * RPC provider pool (migration 0061). Authoritative once it has rows; an empty
 * table means "not configured yet" and the pool falls back to the
 * RPC_ENDPOINTS_JSON seed — never to an empty pool (CLAUDE.md §4).
 *
 * `url` is a SECRET (Alchemy key in the path, Goldsky `?secret=`). Only
 * lib/data/rpc-endpoints.ts may select it; everything else takes `id`.
 * Defaults here are pinned against migration 0061 — §3, drizzle-kit renders
 * `default '{}'` as `.default([""])` if you let it introspect.
 */
export const rpcEndpoints = pgTable("rpc_endpoints", {
	id: text().primaryKey().notNull(),
	url: text().notNull(),
	enabled: boolean().default(true).notNull(),
	sortOrder: integer("sort_order").default(100).notNull(),
	maxCuPerSecond: integer("max_cu_per_second"),
	maxRequestsPerSecond: integer("max_requests_per_second"),
	maxConcurrentRequests: integer("max_concurrent_requests"),
	preferMethods: text("prefer_methods").array().default([]).notNull(),
	maxLogSpan: integer("max_log_span"),
	denyMethods: text("deny_methods").array().default([]).notNull(),
	allowMethods: text("allow_methods").array().default([]).notNull(),
	note: text(),
	disabledAt: timestamp("disabled_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedBy: text("updated_by"),
	pool: text().default("shared").notNull(),
});

// ── First-party analytics (migration 0070) ─────────────────────────────────
// Defaults are pinned against the migration. §3: drizzle-kit has rendered
// jsonb/numeric defaults wrong here before — when editing, open the migration
// and confirm the default matches.

/** Single-row cursor tracker for the nginx log ingest job. */
export const analyticsIngestState = pgTable("analytics_ingest_state", {
	id: integer().primaryKey().default(1),
	fileInode: bigint("file_inode", { mode: "number" }).notNull(),
	byteOffset: bigint("byte_offset", { mode: "number" }).notNull().default(0),
	lastIngestedAt: timestamp("last_ingested_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	check("single_row", sql`id = 1`),
]);

/** Hourly timeseries rollups — the dashboard's primary query target. */
export const analyticsRollupsHourly = pgTable("analytics_rollups_hourly", {
	bucketHour: timestamp("bucket_hour", { withTimezone: true, mode: 'string' }).primaryKey(),
	pageviews: integer().notNull().default(0),
	uniqueVisitors: integer("unique_visitors").notNull().default(0),
	bytesTransferred: bigint("bytes_transferred", { mode: "number" }).notNull().default(0),
	avgLatencyMs: numeric("avg_latency_ms", { precision: 8, scale: 2 }).notNull().default('0'),
	p95LatencyMs: numeric("p95_latency_ms", { precision: 8, scale: 2 }).notNull().default('0'),
	status2xx: integer("status_2xx").notNull().default(0),
	status3xx: integer("status_3xx").notNull().default(0),
	status4xx: integer("status_4xx").notNull().default(0),
	status5xx: integer("status_5xx").notNull().default(0),
}, (table) => [
	index("idx_analytics_rollups_hour").using("btree", table.bucketHour.desc().nullsFirst()),
]);

/**
 * Daily top pages / API endpoints.
 * bucket_date is a `date` column in 0070 (not timestamp) and the migration's
 * PK is composite (bucket_date, normalized_path) — both were missing here,
 * which lets `drizzle-kit generate` propose a destructive column-type/PK
 * change (§3). Keep this declaration in lockstep with the SQL.
 */
export const analyticsPagesDaily = pgTable("analytics_pages_daily", {
	bucketDate: date("bucket_date", { mode: 'string' }).notNull(),
	normalizedPath: text("normalized_path").notNull(),
	pageviews: integer().notNull().default(0),
	uniqueVisitors: integer("unique_visitors").notNull().default(0),
	/** Migration 0097. Weighted by latencySamples, NOT pageviews: pageviews
	 *  exclude bots and these count every served request. */
	avgLatencyMs: numeric("avg_latency_ms", { precision: 8, scale: 2 }).default('0').notNull(),
	p95LatencyMs: numeric("p95_latency_ms", { precision: 8, scale: 2 }).default('0').notNull(),
	latencySamples: integer("latency_samples").default(0).notNull(),
}, (table) => [
	index("idx_analytics_pages_date").using("btree", table.bucketDate.desc().nullsFirst(), table.pageviews.desc().nullsFirst()),
	primaryKey({ columns: [table.bucketDate, table.normalizedPath] }),
]);

/** Daily referrer domains. PK is composite per 0070 — see analyticsPagesDaily comment. */
export const analyticsReferrersDaily = pgTable("analytics_referrers_daily", {
	bucketDate: date("bucket_date", { mode: 'string' }).notNull(),
	referrerDomain: text("referrer_domain").notNull(),
	hits: integer().notNull().default(0),
}, (table) => [
	primaryKey({ columns: [table.bucketDate, table.referrerDomain] }),
]);

/** Daily geographic distribution by country code. PK is composite per 0070 — see analyticsPagesDaily comment. */
export const analyticsCountriesDaily = pgTable("analytics_countries_daily", {
	bucketDate: date("bucket_date", { mode: 'string' }).notNull(),
	countryCode: text("country_code").notNull(),
	pageviews: integer().notNull().default(0),
	uniqueVisitors: integer("unique_visitors").notNull().default(0),
}, (table) => [
	primaryKey({ columns: [table.bucketDate, table.countryCode] }),
]);

/** Daily device, browser, and OS breakdown. PK is composite per 0070 — see analyticsPagesDaily comment. */
export const analyticsDevicesDaily = pgTable("analytics_devices_daily", {
	bucketDate: date("bucket_date", { mode: 'string' }).notNull(),
	deviceType: text("device_type").notNull(),
	browser: text().notNull(),
	os: text().notNull(),
	hits: integer().notNull().default(0),
}, (table) => [
	primaryKey({ columns: [table.bucketDate, table.deviceType, table.browser, table.os] }),
]);

/** Presence rows for TRUE distinct-visitor counting. One row per (bucket_hour, hash) ever seen — see migration 0074 and lib/data/analytics.ts's upsert* functions, which recompute unique_visitors as count(*) from this table instead of summing per-tick Set sizes. */
export const analyticsVisitorHours = pgTable("analytics_visitor_hours", {
	bucketHour: timestamp("bucket_hour", { withTimezone: true, mode: 'string' }).notNull(),
	visitorHash: text("visitor_hash").notNull(),
}, (table) => [
	primaryKey({ columns: [table.bucketHour, table.visitorHash] }),
]);

/** Presence rows for TRUE distinct-visitor counting, per page. See analyticsVisitorHours comment. */
export const analyticsVisitorPages = pgTable("analytics_visitor_pages", {
	bucketDate: date("bucket_date", { mode: 'string' }).notNull(),
	normalizedPath: text("normalized_path").notNull(),
	visitorHash: text("visitor_hash").notNull(),
}, (table) => [
	primaryKey({ columns: [table.bucketDate, table.normalizedPath, table.visitorHash] }),
]);

/** Presence rows for TRUE distinct-visitor counting, per country. See analyticsVisitorHours comment. */
export const analyticsVisitorCountries = pgTable("analytics_visitor_countries", {
	bucketDate: date("bucket_date", { mode: 'string' }).notNull(),
	countryCode: text("country_code").notNull(),
	visitorHash: text("visitor_hash").notNull(),
}, (table) => [
	primaryKey({ columns: [table.bucketDate, table.countryCode, table.visitorHash] }),
]);

/** Per-tick execution history and RPC provider usage for the background curve-poll job (migration 0075, plan doc §4). */
export const curvePollRuns = pgTable("curve_poll_runs", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "curve_poll_runs_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	durationMs: integer("duration_ms"),
	ok: boolean().default(true).notNull(),
	providerCalls: jsonb("provider_calls"),
	rpcProviderSwitches: integer("rpc_provider_switches").default(0),
	multicallBatches: integer("multicall_batches").default(0),
	multicallBatchedCalls: integer("multicall_batched_calls").default(0),
	multicallSubcallFailures: integer("multicall_subcall_failures").default(0),
	multicallFallbackCount: integer("multicall_fallback_count").default(0),
	logicalCalls: integer("logical_calls").default(0),
	physicalAttempts: integer("physical_attempts").default(0),
	totalLatencyMs: integer("total_latency_ms").default(0),
	methodCounts: jsonb("method_counts"),
	padSummaries: jsonb("pad_summaries"),
	reconciledGraduations: integer("reconciled_graduations").default(0),
	poolGraduations: integer("pool_graduations").default(0),
	confirmedRugs: integer("confirmed_rugs").default(0),
	stalled: integer("stalled").default(0),
	degraded: text().array().default([]),
	/** Per-phase RPC spend, keyed by the same names as `degraded` (migration 0085). */
	phaseCalls: jsonb("phase_calls"),
}, (table) => [
	index("curve_poll_runs_started_at_idx").using("btree", table.startedAt.desc().nullsFirst().op("timestamptz_ops")),
]);

/* ==================================================================
 *  Sale referrals + airdrop eligibility (migration 0087)
 *  Access goes through lib/data/sale-referrals.ts only. See docs/prds/REFERRALS.md.
 * ================================================================== */

export const saleParticipants = pgTable("sale_participants", {
	walletAddress: text("wallet_address").primaryKey().notNull(),
	nickname: text(),
	emoji: text(),
	/** [{provider,url}], max 3. Cleaned by lib/referrals/socials.ts (migration 0106). */
	socials: jsonb().default([]).notNull(),
	/** This wallet's own code. Null until its first contribution is indexed. */
	referralCode: text("referral_code"),
	referralCodeIssuedAt: timestamp("referral_code_issued_at", { withTimezone: true, mode: 'string' }),
	/** The code this wallet used. Both halves are read — see the migration. */
	referredByCode: text("referred_by_code"),
	referredByWallet: text("referred_by_wallet"),
	referralBoundAt: timestamp("referral_bound_at", { withTimezone: true, mode: 'string' }),
	/** none | pending | credited | missed. Four states because "not yet decided"
	 *  is not "no" (§8 #9). Only `credited` earns a spin in the 2% draw. */
	referralStatus: text("referral_status").default('none').notNull(),
	firstContributionBlock: bigint("first_contribution_block", { mode: "number" }),
	firstContributionAt: timestamp("first_contribution_at", { withTimezone: true, mode: 'string' }),
	firstContributionTx: text("first_contribution_tx"),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	unique("sale_participants_referral_code_key").on(table.referralCode),
	index("sale_participants_referrer_idx").using("btree", table.referredByWallet.asc().nullsLast().op("text_ops")).where(sql`(referred_by_wallet IS NOT NULL)`),
	index("sale_participants_status_idx").using("btree", table.referralStatus.asc().nullsLast().op("text_ops")),
	check("sale_participants_wallet_lower", sql`wallet_address = lower(wallet_address)`),
	check("sale_participants_referrer_lower", sql`(referred_by_wallet IS NULL) OR (referred_by_wallet = lower(referred_by_wallet))`),
	check("sale_participants_no_self_referral", sql`(referred_by_wallet IS NULL) OR (referred_by_wallet <> wallet_address)`),
	check("sale_participants_code_shape", sql`(referral_code IS NULL) OR (referral_code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$'::text)`),
	check("sale_participants_referred_code_shape", sql`(referred_by_code IS NULL) OR (referred_by_code ~ '^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{8}$'::text)`),
	check("sale_participants_binding_paired", sql`(referred_by_code IS NULL) = (referred_by_wallet IS NULL)`),
	check("sale_participants_status_values", sql`referral_status = ANY (ARRAY['none'::text, 'pending'::text, 'credited'::text, 'missed'::text])`),
	check("sale_participants_credited_needs_binding", sql`(referral_status <> 'credited'::text) OR (referred_by_wallet IS NOT NULL)`),
	check("sale_participants_nickname_len", sql`(nickname IS NULL) OR (char_length(nickname) >= 1 AND char_length(nickname) <= 24)`),
	check("sale_participants_emoji_len", sql`(emoji IS NULL) OR (char_length(emoji) >= 1 AND char_length(emoji) <= 8)`),
	check("sale_participants_socials_shape", sql`(jsonb_typeof(socials) = 'array'::text) AND (jsonb_array_length(socials) <= 3)`),
]);

export const saleContributions = pgTable("sale_contributions", {
	txHash: text("tx_hash").notNull(),
	logIndex: integer("log_index").notNull(),
	walletAddress: text("wallet_address").notNull(),
	amountWei: numeric("amount_wei", { precision: 78, scale: 0 }).notNull(),
	/** The contract's running total at this log. Reconciliation handle only —
	 *  never summed, never displayed. */
	totalRaisedWei: numeric("total_raised_wei", { precision: 78, scale: 0 }),
	blockNumber: bigint("block_number", { mode: "number" }).notNull(),
	blockTime: timestamp("block_time", { withTimezone: true, mode: 'string' }).notNull(),
	indexedAt: timestamp("indexed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.txHash, table.logIndex], name: "sale_contributions_pkey" }),
	index("sale_contributions_wallet_idx").using("btree", table.walletAddress.asc().nullsLast().op("text_ops")),
	index("sale_contributions_block_idx").using("btree", table.blockNumber.asc().nullsLast().op("int8_ops")),
	check("sale_contributions_wallet_lower", sql`wallet_address = lower(wallet_address)`),
	check("sale_contributions_amount_positive", sql`amount_wei > (0)::numeric`),
]);

/** One row per browser-submitted tx hash. The verdict's three states are the
 *  whole design: pending is the only state an RPC failure may produce. */
export const saleContributionClaims = pgTable("sale_contribution_claims", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
	txHash: text("tx_hash").notNull(),
	walletAddress: text("wallet_address").notNull(),
	verdict: text().default('pending').notNull(),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	refusedBecause: text("refused_because"),
	attempts: integer().default(0).notNull(),
	lastAttemptAt: timestamp("last_attempt_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	uniqueIndex("sale_contribution_claims_tx_unique").using("btree", table.txHash.asc().nullsLast()),
	check("sale_contribution_claims_wallet_lower", sql`wallet_address = lower(wallet_address)`),
	check("sale_contribution_claims_tx_shape", sql`tx_hash ~ '^0x[0-9a-f]{64}$'`),
	check("sale_contribution_claims_verdict_values", sql`verdict in ('pending', 'verified', 'refused')`),
	check("sale_contribution_claims_verdict_paired", sql`((verdict = 'pending') = (verified_at is null))`),
	check("sale_contribution_claims_refusal_paired", sql`((verdict = 'refused') = (refused_because is not null))`),
]);

/** The contract's own census, per wallet: `contributed(wallet)` as the
 *  reconciler last read it. The AMOUNT authority for boards, totals and
 *  snapshots; `sale_contributions` keeps the per-transaction facts. */
export const saleWalletTotals = pgTable("sale_wallet_totals", {
	walletAddress: text("wallet_address").primaryKey().notNull(),
	contributedWei: numeric("contributed_wei", { precision: 78, scale: 0 }).notNull(),
	/** The census array slot; push order == first-contribution order. */
	censusIndex: bigint("census_index", { mode: "number" }).notNull(),
	/** The head of the pass that first saw this wallet in the census. */
	firstObservedBlock: bigint("first_observed_block", { mode: "number" }).notNull(),
	observedAt: timestamp("observed_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	/** Three states: null = the `refunded(w)` read has not answered yet. */
	refunded: boolean("refunded"),
}, (table) => [
	check("sale_wallet_totals_wallet_lower", sql`wallet_address = lower(wallet_address)`),
	check("sale_wallet_totals_positive", sql`contributed_wei > 0`),
	index("sale_wallet_totals_amount_idx").using("btree", table.contributedWei.desc()),
	index("sale_wallet_totals_board_idx").using("btree", table.contributedWei.desc(), table.censusIndex.asc()),
]);

export const saleAirdropSnapshots = pgTable("sale_airdrop_snapshots", {
	id: text().primaryKey().notNull(),
	takenAt: timestamp("taken_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	isFinal: boolean("is_final").default(false).notNull(),
	saleAddress: text("sale_address").notNull(),
	saleState: integer("sale_state"),
	indexedThroughBlock: bigint("indexed_through_block", { mode: "number" }).notNull(),
	/** The contract's own totalRaised, read live. The authority. Null means the
	 *  read faulted — never our own total substituted in. */
	totalRaisedWei: numeric("total_raised_wei", { precision: 78, scale: 0 }),
	/** What our mirror sums to. Equal to `totalRaisedWei` is the completeness
	 *  proof; a final snapshot is refused while they disagree. */
	mirroredWei: numeric("mirrored_wei", { precision: 78, scale: 0 }).notNull(),
	contributorCount: integer("contributor_count").notNull(),
	/** Wallets that applied a code before paying, so they earn the 2% bonus.
	 *  Renamed from draw_entrant_count in 0095; same predicate, true name. */
	buyerBonusCount: integer("buyer_bonus_count").notNull(),
	qualifiedReferrerCount: integer("qualified_referrer_count").notNull(),
	/** ETH the qualifying referrers brought in. Was the pro-rata denominator;
	 *  under a commission it is simply the base the ETH rebates are 4% of. */
	qualifiedReferredWei: numeric("qualified_referred_wei", { precision: 78, scale: 0 }).notNull(),
	/** Tokens the sale is selling, read live alongside totalRaisedWei. Null
	 *  means the read faulted — never SALE_TOKENS substituted in (§8 #11). */
	tokensForSale: numeric("tokens_for_sale", { precision: 78, scale: 0 }),
	/** What this run says is owed in total, per leg. Written by the snapshot and
	 *  never recomputed on read, so payout reconciliation compares two
	 *  independently stored numbers rather than a number against itself. */
	owedBuyerTokens: numeric("owed_buyer_tokens", { precision: 78, scale: 0 }).default('0').notNull(),
	owedReferrerTokens: numeric("owed_referrer_tokens", { precision: 78, scale: 0 }).default('0').notNull(),
	owedReferrerWei: numeric("owed_referrer_wei", { precision: 78, scale: 0 }).default('0').notNull(),
	/** The thresholds this run used, so an old snapshot stays readable after
	 *  the dials move. */
	rules: jsonb().notNull(),
	notes: text(),
	/** Rehearsal gate failures, kept so a blocked run names why it stopped. */
	blockers: jsonb().notNull(),
	/** Whether the caller asked for a final snapshot (as opposed to a draft). */
	finalRequested: boolean("final_requested").notNull(),
}, (table) => [
	uniqueIndex("sale_airdrop_snapshots_one_final").using("btree", table.isFinal.asc().nullsLast().op("bool_ops")).where(sql`is_final`),
	check("sale_airdrop_snapshots_address_lower", sql`sale_address = lower(sale_address)`),
]);

export const saleAirdropSnapshotRows = pgTable("sale_airdrop_snapshot_rows", {
	snapshotId: text("snapshot_id").notNull(),
	walletAddress: text("wallet_address").notNull(),
	contributedWei: numeric("contributed_wei", { precision: 78, scale: 0 }).default('0').notNull(),
	referredByWallet: text("referred_by_wallet"),
	referralStatus: text("referral_status").notNull(),
	/** This wallet's own allocation, computed as the contract computes it:
	 *  tokensForSale * contributed / totalRaised. Stored, not derived on read:
	 *  recomputing it later needs a totalRaised that only existed at the close. */
	saleAllocationTokens: numeric("sale_allocation_tokens", { precision: 78, scale: 0 }).default('0').notNull(),
	/** Applied a code before paying. Independent of whether the referrer
	 *  qualified: the buyer cannot see or influence that fact. */
	buyerBonusEligible: boolean("buyer_bonus_eligible").default(false).notNull(),
	/** 2% of saleAllocationTokens. Zero is a fact, not an absence (§8 #3). */
	buyerBonusTokens: numeric("buyer_bonus_tokens", { precision: 78, scale: 0 }).default('0').notNull(),
	referredCount: integer("referred_count").default(0).notNull(),
	referredWei: numeric("referred_wei", { precision: 78, scale: 0 }).default('0').notNull(),
	/** Summed allocations of the buyers this wallet brought in. The base of the
	 *  referrer commission, and what makes it auditable without a price. */
	referredAllocationTokens: numeric("referred_allocation_tokens", { precision: 78, scale: 0 }).default('0').notNull(),
	referrerQualified: boolean("referrer_qualified").default(false).notNull(),
	/** 4% of referredAllocationTokens. Zero unless both gates were cleared. */
	referrerCommissionTokens: numeric("referrer_commission_tokens", { precision: 78, scale: 0 }).default('0').notNull(),
	/** 4% of referredWei, in wei. Zero unless both gates were cleared. */
	referrerRebateWei: numeric("referrer_rebate_wei", { precision: 78, scale: 0 }).default('0').notNull(),
	/** Plain-words explanation, written for a person disputing their row. */
	reason: text().notNull(),
}, (table) => [
	primaryKey({ columns: [table.snapshotId, table.walletAddress], name: "sale_airdrop_snapshot_rows_pkey" }),
	foreignKey({ columns: [table.snapshotId], foreignColumns: [saleAirdropSnapshots.id], name: "sale_airdrop_snapshot_rows_snapshot_id_fkey" }).onDelete("cascade"),
	index("sale_airdrop_snapshot_rows_qualified_idx").using("btree", table.snapshotId.asc().nullsLast().op("text_ops"), table.referrerQualified.asc().nullsLast().op("bool_ops")).where(sql`referrer_qualified`),
	index("sale_airdrop_snapshot_rows_buyer_bonus_idx").using("btree", table.snapshotId.asc().nullsLast().op("text_ops"), table.buyerBonusEligible.asc().nullsLast().op("bool_ops")).where(sql`buyer_bonus_eligible`),
	check("sale_airdrop_snapshot_rows_wallet_lower", sql`wallet_address = lower(wallet_address)`),
]);

/**
 * What was actually SENT. `sale_airdrop_snapshot_rows` records what is owed.
 *
 * Payouts are manual from a plain wallet (docs/prds/TOKEN-SALE-INTENT.md §10.9), so
 * nothing reverts and nothing retries. The two failure modes are paying a wallet
 * twice and never paying it at all, and neither is visible anywhere else.
 *
 * `txHash` is deliberately NOT unique: the efficient way to pay N referrers is
 * one batched transfer, so one hash legitimately covers many rows.
 */
export const saleReferralPayments = pgTable("sale_referral_payments", {
	snapshotId: text("snapshot_id").notNull(),
	walletAddress: text("wallet_address").notNull(),
	/** referrer_eth (wei) | referrer_tokens (base units) | buyer_tokens (base units) */
	kind: text().notNull(),
	/** Base units, always. The exact integer pasted into the wallet, never a
	 *  rounded human figure. */
	amount: numeric({ precision: 78, scale: 0 }).notNull(),
	txHash: text("tx_hash"),
	/** THREE states (§4). null = we have not looked, or the RPC could not
	 *  answer. An unread node must never render as an unpaid wallet. */
	chainVerified: boolean("chain_verified"),
	verifiedAt: timestamp("verified_at", { withTimezone: true, mode: 'string' }),
	blockNumber: bigint("block_number", { mode: "number" }),
	note: text(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	recordedBy: text("recorded_by"),
}, (table) => [
	primaryKey({ columns: [table.snapshotId, table.walletAddress, table.kind], name: "sale_referral_payments_pkey" }),
	/** RESTRICT, not cascade: re-running a snapshot id deletes and re-inserts it
	 *  (issue 6), and under cascade that would erase the only record that money
	 *  left the wallet. */
	foreignKey({ columns: [table.snapshotId], foreignColumns: [saleAirdropSnapshots.id], name: "sale_referral_payments_snapshot_id_fkey" }).onDelete("restrict"),
	index("sale_referral_payments_unverified_idx").using("btree", table.snapshotId.asc().nullsLast().op("text_ops"), table.kind.asc().nullsLast().op("text_ops")).where(sql`tx_hash is not null and chain_verified is null`),
	index("sale_referral_payments_wallet_idx").using("btree", table.walletAddress.asc().nullsLast().op("text_ops")),
	check("sale_referral_payments_wallet_lower", sql`wallet_address = lower(wallet_address)`),
	check("sale_referral_payments_tx_lower", sql`tx_hash is null or tx_hash = lower(tx_hash)`),
	check("sale_referral_payments_kind", sql`kind in ('referrer_eth', 'referrer_tokens', 'buyer_tokens')`),
	check("sale_referral_payments_amount_nonneg", sql`amount >= (0)::numeric`),
	check("sale_referral_payments_verdict_needs_tx", sql`chain_verified is null or tx_hash is not null`),
	check("sale_referral_payments_verdict_timed", sql`(chain_verified is null) = (verified_at is null)`),
]);

// ── Launch registry (migration 0093, ARCHITECTURE.md §6) ──────────────────────
export const launches = pgTable("launches", {
	tokenAddress: text("token_address").primaryKey().notNull(),
	launchpadId: bigint("launchpad_id", { mode: "number" }),
	family: text().notNull(),
	creatorAddress: text("creator_address"),
	createdBlock: bigint("created_block", { mode: "number" }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }),
	launchTxHash: text("launch_tx_hash"),
	venueKind: text("venue_kind").notNull(),
	curveAddress: text("curve_address"),
	poolRef: text("pool_ref"),
	quoteToken: text("quote_token"),
	quoteSymbol: text("quote_symbol"),
	quoteDecimals: smallint("quote_decimals"),
	targetQuote: numeric("target_quote"),
	name: text(),
	symbol: text(),
	metadataUri: text("metadata_uri"),
	devBuyQuote: numeric("dev_buy_quote"),
	detail: jsonb(),
	source: text().default('ingest').notNull(),
	legacyRaisedQuote: numeric("legacy_raised_quote"),
	legacyCreatorBuyQuote: numeric("legacy_creator_buy_quote"),
	legacyBuys: integer("legacy_buys"),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("launches_created_idx").using("btree", table.createdAt.desc(), table.tokenAddress.desc()),
	index("launches_creator_idx").using("btree", table.creatorAddress.asc()).where(sql`(creator_address IS NOT NULL)`),
	index("launches_curve_idx").using("btree", table.curveAddress.asc()).where(sql`(curve_address IS NOT NULL)`),
	index("launches_pool_ref_idx").using("btree", table.poolRef.asc()).where(sql`(pool_ref IS NOT NULL)`),
	index("launches_pad_created_idx").using("btree", table.launchpadId.asc(), table.createdAt.desc()),
	index("launches_recorded_idx").using("btree", table.recordedAt.asc(), table.tokenAddress.asc()),
	foreignKey({ columns: [table.launchpadId], foreignColumns: [launchpads.id], name: "launches_launchpad_id_fkey" }).onDelete("restrict"),
	check("launches_venue_kind_check", sql`venue_kind = ANY (ARRAY['CURVE'::text, 'HOOK_CURVE'::text, 'POOL'::text])`),
	check("launches_source_check", sql`source = ANY (ARRAY['ingest'::text, 'migrated'::text])`),
]);

export const launchEvents = pgTable("launch_events", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "launch_events_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	tokenAddress: text("token_address").notNull(),
	kind: text().notNull(),
	blockNumber: bigint("block_number", { mode: "number" }),
	logIndex: integer("log_index"),
	txHash: text("tx_hash"),
	occurredAt: timestamp("occurred_at", { withTimezone: true, mode: 'string' }),
	poolRef: text("pool_ref"),
	amount: numeric(),
	detail: jsonb(),
	source: text().default('ingest').notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("launch_events_token_kind_idx").using("btree", table.tokenAddress.asc(), table.kind.asc()),
	index("launch_events_pool_ref_idx").using("btree", table.poolRef.asc()).where(sql`(pool_ref IS NOT NULL)`),
	index("launch_events_kind_occurred_idx").using("btree", table.kind.asc(), table.occurredAt.asc()),
	index("launch_events_recorded_idx").using("btree", table.recordedAt.asc(), table.id.asc()),
	check("launch_events_kind_check", sql`kind = ANY (ARRAY['GRADUATED'::text, 'LOCKED'::text, 'MIGRATED'::text, 'FEE_RECIPIENT_CHANGED'::text, 'CREATOR_BUY'::text])`),
]);

export const v4Pools = pgTable("v4_pools", {
	poolId: text("pool_id").primaryKey().notNull(),
	currency0: text().notNull(),
	currency1: text().notNull(),
	fee: integer().notNull(),
	tickSpacing: integer("tick_spacing").notNull(),
	hooks: text().notNull(),
	initBlock: bigint("init_block", { mode: "number" }).notNull(),
	initTx: text("init_tx"),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("v4_pools_currency0_idx").using("btree", table.currency0.asc()),
	index("v4_pools_pair_idx").using("btree", table.currency0.asc(), table.currency1.asc()),
	index("v4_pools_currency1_idx").using("btree", table.currency1.asc()),
	index("v4_pools_hooks_idx").using("btree", table.hooks.asc()),
	index("v4_pools_recorded_idx").using("btree", table.recordedAt.asc(), table.poolId.asc()),
]);

export const launchTradeHourly = pgTable("launch_trade_hourly", {
	tokenAddress: text("token_address").notNull(),
	hour: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
	buys: integer().default(0).notNull(),
	sells: integer().default(0).notNull(),
	quoteIn: numeric("quote_in").default('0').notNull(),
	quoteOut: numeric("quote_out").default('0').notNull(),
	creatorQuoteIn: numeric("creator_quote_in").default('0').notNull(),
	lastTradeBlock: bigint("last_trade_block", { mode: "number" }),
}, (table) => [
	primaryKey({ columns: [table.tokenAddress, table.hour], name: "launch_trade_hourly_pkey" }),
	index("launch_trade_hourly_hour_idx").using("btree", table.hour.asc()),
]);

export const launchState = pgTable("launch_state", {
	tokenAddress: text("token_address").primaryKey().notNull(),
	fillBps: integer("fill_bps"),
	quoteBalance: numeric("quote_balance"),
	stateBlock: bigint("state_block", { mode: "number" }),
	stateReadAt: timestamp("state_read_at", { withTimezone: true, mode: 'string' }),
	liquidityUsd: numeric("liquidity_usd"),
	volume24HUsd: numeric("volume_24h_usd"),
	buys24H: integer("buys_24h"),
	sells24H: integer("sells_24h"),
	marketPoolAddress: text("market_pool_address"),
	priceChangeH1: numeric("price_change_h1"),
	marketReadAt: timestamp("market_read_at", { withTimezone: true, mode: 'string' }),
	peakLiquidityUsd: numeric("peak_liquidity_usd"),
	zeroLiquidityReadings: integer("zero_liquidity_readings").default(0).notNull(),
}, (table) => [
	index("launch_state_fill_idx").using("btree", table.fillBps.asc()).where(sql`(fill_bps >= 3300)`),
	index("launch_state_read_idx").using("btree", table.stateReadAt.asc().nullsFirst()),
	index("launch_state_market_pool_idx").using("btree", table.marketPoolAddress.asc()).where(sql`(market_pool_address IS NOT NULL)`),
	index("launch_state_touched_idx").using("btree", sql`greatest(state_read_at, market_read_at)`, table.tokenAddress.asc()),
	check("launch_state_fill_bps_check", sql`(fill_bps IS NULL) OR ((fill_bps >= 0) AND (fill_bps <= 10000))`),
]);

export const blockTimes = pgTable("block_times", {
	blockNumber: bigint("block_number", { mode: "number" }).primaryKey().notNull(),
	blockTime: timestamp("block_time", { withTimezone: true, mode: 'string' }).notNull(),
});

export const ingestCursors = pgTable("ingest_cursors", {
	stream: text().primaryKey().notNull(),
	nextBlock: bigint("next_block", { mode: "number" }).notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const ingestWindows = pgTable("ingest_windows", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "ingest_windows_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	stream: text().notNull(),
	fromBlock: bigint("from_block", { mode: "number" }).notNull(),
	toBlock: bigint("to_block", { mode: "number" }).notNull(),
	logCount: integer("log_count").notNull(),
	rpcCalls: integer("rpc_calls").default(0).notNull(),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("ingest_windows_stream_idx").using("btree", table.stream.asc(), table.fromBlock.asc()),
]);

export const swapPlanRuns = pgTable("swap_plan_runs", {
	id: bigint({ mode: "number" }).primaryKey().generatedAlwaysAsIdentity({ name: "swap_plan_runs_id_seq", startWith: 1, increment: 1, minValue: 1, maxValue: 9223372036854775807, cache: 1 }),
	requestId: text("request_id").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	account: text().notNull(),
	tokenIn: text("token_in").notNull(),
	tokenOut: text("token_out").notNull(),
	amountIn: text("amount_in").notNull(),
	status: text().notNull(),
	stage: text(),
	code: text(),
	durationMs: integer("duration_ms").notNull(),
	metadata: jsonb(),
}, (table) => [
	index("swap_plan_runs_created_at_idx").using("btree", table.createdAt.desc().nullsFirst(), table.id.desc().nullsFirst()),
	index("swap_plan_runs_account_idx").using("btree", table.account.asc(), table.createdAt.desc().nullsFirst()),
	index("swap_plan_runs_token_in_idx").using("btree", table.tokenIn.asc(), table.createdAt.desc().nullsFirst()),
	index("swap_plan_runs_token_out_idx").using("btree", table.tokenOut.asc(), table.createdAt.desc().nullsFirst()),
	unique("swap_plan_runs_request_id_key").on(table.requestId),
]);


// Durable sequencer ingestion queue, per-stream checkpoints and bounded telemetry.
export const sequencerWork = pgTable("sequencer_work", {
  id: text().primaryKey().notNull(),
  kind: text().notNull(),
  payload: jsonb().notNull(),
  attempts: integer().default(0).notNull(),
  availableAt: timestamp("available_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
  lastError: text("last_error"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [index("sequencer_work_ready_idx").using("btree", table.availableAt.asc(), table.createdAt.asc()), check("sequencer_work_kind_check", sql`kind = ANY (ARRAY['tx'::text, 'gap'::text, 'pons'::text])`)]);

export const sequencerCheckpoints = pgTable("sequencer_checkpoints", {
  stream: text().primaryKey().notNull(),
  value: jsonb().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});

export const sequencerMetrics = pgTable("sequencer_metrics", {
  hour: timestamp({ withTimezone: true, mode: 'string' }).notNull(),
  provider: text().notNull(),
  event: text().notNull(),
  reason: text().notNull().default(''),
  count: bigint({ mode: "number" }).default(0).notNull(),
  credits: bigint({ mode: "number" }).default(0).notNull(),
  latencyMs: bigint("latency_ms", { mode: "number" }).default(0).notNull(),
}, (table) => [primaryKey({ columns: [table.hour, table.provider, table.event, table.reason], name: "sequencer_metrics_pkey" }), index("sequencer_metrics_hour_idx").using("btree", table.hour.asc())]);

export const sequencerBudgets = pgTable("sequencer_budgets", {
  day: date().notNull(),
  accountId: text("account_id").notNull(),
  credits: bigint({ mode: "number" }).default(0).notNull(),
}, (table) => [primaryKey({ columns: [table.day, table.accountId], name: "sequencer_budgets_pkey" }), index("sequencer_budgets_day_idx").using("btree", table.day.asc())]);

export const sequencerExplorerSpend = pgTable("sequencer_explorer_spend", {
  day: date().notNull(),
  accountId: text("account_id").notNull(),
  credits: bigint({ mode: "number" }).default(0).notNull(),
}, (table) => [primaryKey({ columns: [table.day, table.accountId], name: "sequencer_explorer_spend_pkey" }), index("sequencer_explorer_spend_day_idx").using("btree", table.day.asc())]);

// Mirrors supabase/migrations/0102_sequencer_sync_lockers_hooks.sql. Reference text only; never a verdict input.
export const uniswapHooks = pgTable("uniswap_hooks", {
	chainId: integer("chain_id").notNull(),
	address: text().notNull(),
	name: text().notNull(),
	description: text().default('').notNull(),
	deployer: text().default('').notNull(),
	verifiedSource: boolean("verified_source"),
	auditUrl: text("audit_url").default('').notNull(),
	flags: jsonb().default({}).notNull(),
	properties: jsonb().default({}).notNull(),
	fetchedAt: timestamp("fetched_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	primaryKey({ columns: [table.chainId, table.address], name: "uniswap_hooks_pkey" }),
]);

// Route graph pools and depth cache (migration 0104). V4 stays in v4_pools.
export const swapPools = pgTable("swap_pools", {
	pool: text("pool").primaryKey().notNull(),
	protocol: text().notNull(),
	dex: text().notNull(),
	factory: text().notNull(),
	token0: text().notNull(),
	token1: text().notNull(),
	fee: integer(),
	tickSpacing: integer("tick_spacing"),
	createdBlock: bigint("created_block", { mode: "number" }),
	recordedAt: timestamp("recorded_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("swap_pools_token0_idx").using("btree", table.token0.asc()),
	index("swap_pools_token1_idx").using("btree", table.token1.asc()),
	index("swap_pools_recorded_idx").using("btree", table.recordedAt.asc(), table.pool.asc()),
	check("swap_pools_protocol_check", sql`protocol in ('v2', 'v3')`),
	check("swap_pools_pool_lower", sql`pool = lower(pool)`),
	check("swap_pools_factory_lower", sql`factory = lower(factory)`),
	check("swap_pools_token0_lower", sql`token0 = lower(token0)`),
	check("swap_pools_token1_lower", sql`token1 = lower(token1)`),
]);

export const poolDepth = pgTable("pool_depth", {
	poolId: text("pool_id").primaryKey().notNull(),
	protocol: text().notNull(),
	liquidity: numeric(),
	reserve0: numeric(),
	reserve1: numeric(),
	sqrtPriceX96: numeric("sqrt_price_x96"),
	out0: numeric(),
	out1: numeric(),
	depth0Usd: numeric("depth0_usd"),
	depth1Usd: numeric("depth1_usd"),
	depthUsd: numeric("depth_usd"),
	readAt: timestamp("read_at", { withTimezone: true, mode: 'string' }),
	deadAt: timestamp("dead_at", { withTimezone: true, mode: 'string' }),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("pool_depth_depth_usd_idx").using("btree", table.depthUsd.asc()).where(sql`(dead_at is null)`),
	check("pool_depth_protocol_check", sql`protocol in ('v2', 'v3', 'v4')`),
	check("pool_depth_pool_id_lower", sql`pool_id = lower(pool_id)`),
]);

export const lpTrackedPools = pgTable("lp_tracked_pools", {
	pool: text("pool").primaryKey().notNull(),
	protocol: text().notNull(),
	epoch: bigint({ mode: "number" }).notNull(),
	hydratedThrough: bigint("hydrated_through", { mode: "number" }).notNull(),
	reason: text().notNull(),
	lastVisitedAt: timestamp("last_visited_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	lowDepthSince: timestamp("low_depth_since", { withTimezone: true, mode: 'string' }),
	pruneCheckedAt: timestamp("prune_checked_at", { withTimezone: true, mode: 'string' }),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, (table) => [
	index("lp_tracked_pools_visited_idx").using("btree", table.lastVisitedAt.asc()),
	index("lp_tracked_pools_prune_checked_idx").using("btree", table.pruneCheckedAt.asc().nullsFirst(), table.pool.asc()),
	check("lp_tracked_pools_protocol_check", sql`protocol in ('v3','v4')`),
]);

export const lpPositions = pgTable("lp_positions", {
	pool: text().notNull(),
	positionKey: text("position_key").notNull(),
	protocol: text().notNull(),
	manager: text(),
	tokenId: numeric("token_id"),
	holder: text(),
	tickLower: integer("tick_lower").notNull(),
	tickUpper: integer("tick_upper").notNull(),
	liquidity: numeric().notNull(),
	updatedBlock: bigint("updated_block", { mode: "number" }).notNull(),
}, (table) => [
	primaryKey({ columns: [table.pool, table.positionKey], name: "lp_positions_pkey" }),
	index("lp_positions_pool_liq_idx").using("btree", table.pool.asc(), table.liquidity.desc()),
	check("lp_positions_protocol_check", sql`protocol in ('v3','v4')`),
	check("lp_positions_liquidity_check", sql`liquidity > 0`),
]);

export type LpTrackedPool = typeof lpTrackedPools.$inferSelect;
export type LpTrackedPoolInsert = typeof lpTrackedPools.$inferInsert;
export type LpPosition = typeof lpPositions.$inferSelect;
export type LpPositionInsert = typeof lpPositions.$inferInsert;

export const positionNftCursors = pgTable("position_nft_cursors", {
	manager: text().primaryKey().notNull(),
	indexedToBlock: bigint("indexed_to_block", { mode: "number" }).notNull(),
	indexedToHash: text("indexed_to_hash").notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
}, () => [
	check("position_nft_cursors_manager_check", sql`manager = lower(manager)`),
	check("position_nft_cursors_indexed_to_block_check", sql`indexed_to_block >= 0`),
]);

export const positionNftOwners = pgTable("position_nft_owners", {
	manager: text().notNull(),
	tokenId: numeric("token_id", { precision: 78, scale: 0 }).notNull(),
	owner: text().notNull(),
	blockNumber: bigint("block_number", { mode: "number" }).notNull(),
}, (table) => [
	primaryKey({ columns: [table.manager, table.tokenId], name: "position_nft_owners_pkey" }),
	index("position_nft_owners_owner_idx").using("btree", table.owner.asc().nullsLast().op("text_ops")),
	check("position_nft_owners_manager_check", sql`manager = lower(manager)`),
	check("position_nft_owners_token_id_check", sql`token_id >= (0)::numeric`),
	check("position_nft_owners_owner_check", sql`owner = lower(owner)`),
	check("position_nft_owners_block_number_check", sql`block_number >= 0`),
]);
