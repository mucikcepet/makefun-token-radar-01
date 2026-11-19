// Radar-2, rewritten: how the token radar turns one sealed snapshot into a
// ranked board, and what each number in the board means.
//
// Coverage first. The board must carry every slug on the snapshot's watchlist
// — that list is a floor, never a ceiling — plus every other protocol the
// radar is allowed to rank. Allowed means pre-token and not a wrapped, staked
// or bridged product of a token that already trades. A protocol counts as
// pre-token when its index entry records no token at all: no market cap, no
// CoinGecko id, no symbol. The snapshot's live-token protocols are kept
// apart and shown with the market's own values, never mixed into the ranking.
//
// The score itself comes only from the snapshot's own figures, and no
// protocol name is ever special-cased: one function scores every row.
//
//   peer multiple   = the median market-cap / TVL of the snapshot's live-token
//                     protocols in the protocol's own category (at least 5
//                     peers), else the median over every live-token protocol;
//                     clamped to [0.05, 1.00]. It is worked out from the
//                     snapshot while the program runs, never written in by
//                     hand: a category the market already prices richly lifts
//                     its pre-token peers, and one it prices cheaply lowers
//                     them. Wrapped, staked and bridged products stay out of
//                     the peer set, as they stay out of the board.
//   base            = tvl_usd x peer multiple
//   growth          = change_7d clamped to [-60, 120] per cent
//   growth factor   = 1 + (growth / 100) x GROWTH_WEIGHT
//   maturity        = 0.6 + min(age_days, 1095) / 1095 x 0.4   (age_days unknown: 365)
//   breadth         = 1 + 0.05 x min(chains - 1, 4), at most 1.20: a protocol
//                     live on more chains has more distribution to launch into.
//   implied         = max(1, round(base x growth factor x maturity x breadth))
//
// The dashboard recomputes every row from these same figures, so the page's
// numbers and board.json agree with each other.

/** The model's constants, as the dashboard states them and the sandbox may change them. */
export interface ModelConstants {
  growth_weight: number; growth_floor: number; growth_cap: number;
  maturity_floor: number; maturity_range: number; maturity_days: number;
  unknown_age_days: number; multiple_floor: number; multiple_cap: number;
  multiple_min_peers: number; breadth_step: number; breadth_max_chains: number;
}

/** One protocol entry from the snapshot: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string; name: string;
  category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number; slug: string; name: string;
  category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null;
  implied_value_usd: number;
  model: {
    category_multiple: number; category_multiple_source: string;
    growth_pct: number; growth_multiplier: number;
    maturity_multiplier: number; breadth_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number; slug: string; name: string;
  category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null;
  mcap_usd: number | null; listed_at: string | null;
  age_days: number | null; implied_value_usd: number;
  category_multiple: number; growth_multiplier: number;
  maturity_multiplier: number; breadth_multiplier: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string; name: string; category: string | null;
  chains: string[]; tvl_usd: number;
  mcap_usd: number | null; change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, and the model it runs. */
export interface RadarData {
  as_of: string; source: string; floor_usd: number;
  model: ModelConstants; model_version: string;
  watchlist_size: number; board_size: number;
  early_size: number; live_size: number;
  category_multiples: Record<string, number>; global_multiple: number;
  watchlist: string[]; rows: RadarRow[]; live: LiveRow[];
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string; cost: string; time: string;
}

/** The headline sentence's figures: how many watchlist slugs, how many rows, how many live protocols. */
export interface BoardSummary {
  watchlist_size: number; board_size: number;
  early_size: number; live_size: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.5, growth_floor: -60, growth_cap: 120,
  maturity_floor: 0.6, maturity_range: 0.4, maturity_days: 1095,
  unknown_age_days: 365, multiple_floor: 0.05, multiple_cap: 1.0,
  multiple_min_peers: 5, breadth_step: 0.05, breadth_max_chains: 4,
};

/** The model's version label: the dashboard names it and the rules quote it. */
export const MODEL_VERSION = "radar-2";

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS: number = 24;

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

/** A finite number, else `fallback`. */
function numOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function daysSince(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const startMs = Date.parse(asOf + 'T00:00:00Z');
  const listedMs = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(startMs) || !Number.isFinite(listedMs)) return null;
  return Math.max(0, Math.floor((startMs - listedMs) / DAY_MS));
}

/** The median of a sorted list of numbers. */
function middleValue(sorted: number[]): number {
  const count = sorted.length;
  if (count === 0) return 0;
  const mid = Math.floor(count / 2);
  return count % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The categories the watchlist rule throws out: wrapped, staked or bridged products of a token that trades. */
const BLOCKED_CATEGORIES = new Set([
  'Bridge', 'Canonical Bridge', 'Liquid Staking',
  'Liquid Restaking', 'Restaked BTC', 'CEX',
]);

/** Venue names a protocol may not start with: its product belongs to that venue, not to its own launch. */
const VENUE_PREFIXES = [
  'binance', 'coinbase', 'bybit', 'kraken',
  'bitget', 'okx', 'bitfinex', 'gemini',
];

/** DefiLlama's release-marker rule: a name that ends in a release is another protocol's pool. */
const VERSION_TAGGED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A name carrying a whole word wrapped, staked or staking, or starting with a venue's name. */
const WRAPPED_TERM = /\bwrapped\b|\bstaked\b|\bstaking\b/i;

/** True when a protocol's record carries no token at all. */
export function hasNoToken(p: SnapshotProtocol): boolean {
  const noCap = p.mcap_usd === null;
  const noGecko = p.gecko_id === null;
  const noSymbol = p.symbol === null;
  return noCap && noGecko && noSymbol;
}

/**
 * Whether the board may rank a protocol: pre-token, not a venue's product, not a versioned pool,
 * and not a wrapped, staked or bridged product of a token that already trades. This is the
 * watchlist's own rule, applied to every row rather than only to the floor.
 */
export function canRank(p: SnapshotProtocol): boolean {
  if (!hasNoToken(p)) return false;
  const blocked = p.category !== null && BLOCKED_CATEGORIES.has(p.category);
  if (blocked) return false;
  if (VERSION_TAGGED.test(p.name)) return false;
  if (WRAPPED_TERM.test(p.name)) return false;
  const lowered = p.name.toLowerCase();
  for (const venue of VENUE_PREFIXES) {
    if (lowered.startsWith(venue)) return false;
  }
  return true;
}

/**
 * The market-cap / TVL multiples implied by the snapshot's own live-token protocols, by category.
 * A category with at least `minPeers` live peers takes its own median; any other category takes
 * the median over all live-token protocols. Both are clamped to [floor, cap].
 */
export function peerMultiples(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { byCategory: Record<string, number>; global: number } {
  const perCategory = new Map<string, number[]>();
  const everyRatio: number[] = [];
  for (const entry of snapshot.protocols) {
    if (hasNoToken(entry) || entry.mcap_usd === null || entry.tvl_usd <= 0) continue;
    if (entry.category !== null && BLOCKED_CATEGORIES.has(entry.category)) continue;
    const ratio = entry.mcap_usd / entry.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    everyRatio.push(ratio);
    const bucket = entry.category ?? 'Other';
    const members = perCategory.get(bucket) ?? [];
    members.push(ratio);
    perCategory.set(bucket, members);
  }
  everyRatio.sort((a, b) => a - b);
  const limit = (v: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, v));
  const global = limit(middleValue(everyRatio));
  const byCategory: Record<string, number> = {};
  const keys = [...perCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [key, members] of keys) {
    members.sort((a, b) => a - b);
    byCategory[key] = members.length >= model.multiple_min_peers ? limit(middleValue(members)) : global;
  }
  return { byCategory, global };
}

/** The multipliers, and the implied value, one protocol gets under `model`. */
export function scoreProtocol(
  protocol: SnapshotProtocol,
  asOf: string,
  model: ModelConstants,
  multiples: { byCategory: Record<string, number>; global: number },
): {
  implied: number; categoryMultiple: number;
  categorySource: string; growthPct: number;
  growthMult: number; maturityMult: number;
  breadthMult: number; age: number | null;
} {
  const age = daysSince(asOf, protocol.listed_at);
  const rawChange = numOr(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawChange));
  const growthMult = 1 + ((growthPct / 100) * model.growth_weight);
  const modelAge = age ?? model.unknown_age_days;
  const maturityMult =
    model.maturity_floor +
    (Math.min(Math.max(modelAge, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const spareChains = Math.min(Math.max(protocol.chains.length - 1, 0), model.breadth_max_chains);
  const breadthMult = 1 + model.breadth_step * spareChains;
  const bucket = protocol.category ?? 'Other';
  const own = multiples.byCategory[bucket];
  const categoryMultiple = own === undefined ? multiples.global : own;
  const categorySource =
    own !== undefined && own !== multiples.global
      ? 'category median (' + bucket + ')'
      : 'global median';
  const base = categoryMultiple * protocol.tvl_usd;
  const implied = Math.max(1, Math.round(((base * growthMult) * maturityMult) * breadthMult));
  return {
    implied, categoryMultiple, categorySource, growthPct,
    growthMult, maturityMult, breadthMult, age,
  };
}

/** Look a protocol up by its slug. */
function indexBySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  const table = new Map<string, SnapshotProtocol>();
  for (const entry of protocols) table.set(entry.slug, entry);
  return table;
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const multiples = peerMultiples(snapshot, model);
  const index = indexBySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no longer carries (it cannot,
  // but the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const found = index.get(slug);
    if (found !== undefined) chosen.set(slug, found);
  }
  // The early radar adds every other rankable protocol, below the floor or not; one already chosen stays chosen.
  for (const entry of snapshot.protocols) {
    if (!chosen.has(entry.slug) && canRank(entry)) chosen.set(entry.slug, entry);
  }

  const scored = [...chosen.values()].map((entry) => {
    const value = scoreProtocol(entry, snapshot.as_of, model, multiples);
    return { entry, ...value };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.entry.slug < b.entry.slug ? -1 : a.entry.slug > b.entry.slug ? 1 : 0));
  return scored.map((row, i) => ({
    rank: i + 1, slug: row.entry.slug, name: row.entry.name,
    category: row.entry.category, chains: row.entry.chains,
    tvl_usd: row.entry.tvl_usd, change_7d: row.entry.change_7d,
    mcap_usd: row.entry.mcap_usd, listed_at: row.entry.listed_at,
    gecko_id: row.entry.gecko_id, symbol: row.entry.symbol,
    token_status: 'pre-token', age_days: row.age,
    implied_value_usd: row.implied,
    model: {
      category_multiple: round4dp(row.categoryMultiple),
      category_multiple_source: row.categorySource,
      growth_pct: row.growthPct,
      growth_multiplier: round4dp(row.growthMult),
      maturity_multiplier: round4dp(row.maturityMult),
      breadth_multiplier: round4dp(row.breadthMult),
      age_days: row.age,
    },
    farm_steps: planSteps(row.entry, row.age).map(stepLine),
  }));
}

const round4dp = (n: number): number => Math.round(n * 1e4) / 1e4;

/** One step as a single string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepLine(step: FarmStep): string {
  let joined = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
  if (joined.length > 600) joined = joined.slice(0, 596) + '...';
  if (joined.length < 20) joined = joined + " Hold the position and check the protocol's own page.";
  return joined;
}

/** The protocol's first chain, or a neutral phrase when it names none. */
function firstChain(p: SnapshotProtocol): string {
  if (p.chains.length === 0) return 'its main chain';
  return p.chains[0]!;
}

/** One transaction's gas cost on a chain, in whole dollars. */
function gasPrice(chain: string): number {
  const priceByChain: Record<string, number> = { Ethereum: 8, Bitcoin: 4 };
  const price = priceByChain[chain];
  return price === undefined ? 1 : price;
}

/** The capital one farm position needs, from the protocol's own TVL. */
function stakeFor(p: SnapshotProtocol): number {
  const tvl = p.tvl_usd;
  if (tvl >= 5_000_000_000) return 250;
  if (tvl >= 1_000_000_000) return 150;
  if (tvl >= 100_000_000) return 100;
  return 50;
}

/** The hold length, from the protocol's age: younger ones get a longer qualifying window. */
function holdFor(age: number | null): number {
  if (age === null || age >= 365) return 30;
  if (age < 180) return 60;
  return 45;
}

/** One action for the category, in words a farmer can follow. */
function actionText(p: SnapshotProtocol, capital: number, chain: string): string {
  const cat = (p.category ?? '').toLowerCase();
  const name = p.name;
  let action: string;
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) action = 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ' and keep the position open.';
  else if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) action = 'Provide $' + capital + ' of liquidity to ' + name + "'s main pool on " + chain + ' and keep the position open.';
  else if (cat.includes('bridge')) action = 'Bridge $' + capital + ' of USDC to ' + chain + ' through ' + name + ' and use the bridged funds in its app.';
  else if (cat.includes('staking') || cat.includes('restak')) action = 'Stake $' + capital + " of the chain's staking asset through " + name + ' and keep the receipt.';
  else if (cat.includes('perpetual') || cat.includes('derivative')) action = 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedge.';
  else if (cat.includes('prediction')) action = 'Fund $' + capital + ' and place one market position on ' + name + '.';
  else if (cat.includes('curator') || cat.includes('allocator')) action = 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the shares.';
  else if (cat.includes('stable')) action = 'Mint or deposit $' + capital + ' of the stable asset through ' + name + ' on ' + chain + '.';
  else if (cat.includes('rwa')) action = 'Mint $' + capital + " of the protocol's yield asset on " + chain + ' and hold it.';
  else if (cat.includes('insurance')) action = 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy.';
  else action = 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  return action;
}

/** The weekly qualifying action for the category, in words a farmer can follow. */
function weeklyText(p: SnapshotProtocol): string {
  const cat = (p.category ?? '').toLowerCase();
  let weekly = 'a deposit, a swap or a vote';
  if (cat.includes('lend') || cat.includes('cdp') || cat.includes('collateral')) weekly = 'a supply, a borrow or a repayment';
  else if (cat.includes('dex') || cat.includes('yield') || cat.includes('leveraged farm')) weekly = 'a swap or a liquidity change';
  else if (cat.includes('perpetual') || cat.includes('derivative')) weekly = 'a small trade or a margin change';
  else if (cat.includes('prediction')) weekly = 'a market position or a settlement';
  else if (cat.includes('curator') || cat.includes('allocator')) weekly = 'a deposit, a withdrawal or a vault vote';
  else if (cat.includes('rwa') || cat.includes('stable')) weekly = 'a mint, a deposit or a redemption';
  else if (cat.includes('staking') || cat.includes('restak')) weekly = 'a stake, a restake or a claim';
  return weekly;
}

/**
 * One protocol's farm plan: six steps, each an action with a cost and a time. The plan comes from
 * the protocol's own record (category, chains, TVL, age), never from a hand-written list of names.
 */
export function planSteps(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = firstChain(p);
  const capital = stakeFor(p);
  const hold = holdFor(age);
  const gas = gasPrice(chain);
  const action = actionText(p, capital, chain);
  const weekly = weeklyText(p);
  const steps: FarmStep[] = [];
  steps.push({
    text: 'Use a fresh wallet that holds only the funds you plan to farm, ' + 'and keep its seed phrase offline.',
    cost: 'about $' + gas + ' of gas for the first transaction on ' + chain, time: '5 minutes',
  });
  steps.push({
    text: action,
    cost: '$' + capital + ' of capital and about $' + gas + ' of gas', time: '15 minutes to set up',
  });
  steps.push({
    text: 'Make one qualifying action each week, such as ' + weekly + '.',
    cost: 'about $' + gas + ' of gas a week', time: '10 minutes a week',
  });
  steps.push({
    text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.',
    cost: 'the $' + capital + ' stays in the position', time: hold + ' days',
  });
  steps.push({
    text: "Before you withdraw, open the protocol's own points or rewards page " + 'and claim only from the link it publishes.',
    cost: 'no fee to check, and never pay to claim', time: '10 minutes',
  });
  steps.push({
    text: 'Write the wallet, the dates and every transaction in a farm log ' + 'so you can repeat the position or unwind it.',
    cost: 'nothing but the log', time: '5 minutes',
  });
  return steps;
}

/** The live-token protocols, biggest market cap first, for the dashboard's Live token view. */
export function liveSet(snapshot: Snapshot): LiveRow[] {
  const trading = snapshot.protocols.filter((entry) => !hasNoToken(entry) && entry.category !== 'CEX');
  trading.sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd);
  return trading.slice(0, LIVE_ROWS).map((entry) => ({
    slug: entry.slug, name: entry.name, category: entry.category,
    chains: entry.chains, tvl_usd: entry.tvl_usd,
    mcap_usd: entry.mcap_usd, change_7d: entry.change_7d,
  }));
}

/** A board row squeezed for data.js, its farm plan generated in the page. */
export function compactRow(entry: BoardRow): RadarRow {
  return {
    rank: entry.rank, slug: entry.slug, name: entry.name,
    category: entry.category, chains: entry.chains,
    tvl_usd: entry.tvl_usd, change_7d: entry.change_7d,
    mcap_usd: entry.mcap_usd, listed_at: entry.listed_at,
    age_days: entry.age_days, implied_value_usd: entry.implied_value_usd,
    category_multiple: entry.model.category_multiple,
    growth_multiplier: entry.model.growth_multiplier,
    maturity_multiplier: entry.model.maturity_multiplier,
    breadth_multiplier: entry.model.breadth_multiplier,
  };
}

/** Everything the dashboard renders, built from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveSet(snapshot);
  const multiples = peerMultiples(snapshot, model);
  const early = board.filter((row) => !snapshot.watchlist.includes(row.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model, model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length, board_size: board.length,
    early_size: early, live_size: live.length,
    category_multiples: multiples.byCategory, global_multiple: multiples.global,
    watchlist: snapshot.watchlist, rows: board.map(compactRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  const refuse = (why: string): never => {
    throw new SnapshotError(why);
  };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    refuse('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) refuse('snapshot.json is not a JSON object');
  const doc = raw as Record<string, unknown>;
  if (typeof doc.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(doc.as_of)) refuse('snapshot.json has no as_of date');
  if (typeof doc.source !== 'string') refuse('snapshot.json has no source');
  if (typeof doc.floor_usd !== 'number' || !Number.isSafeInteger(doc.floor_usd) || doc.floor_usd <= 0) refuse('snapshot.json has no floor_usd');
  if (!Array.isArray(doc.protocols)) refuse('snapshot.json has no protocols array');
  if (!Array.isArray(doc.watchlist) || doc.watchlist.some((s) => typeof s !== 'string')) refuse('snapshot.json has no watchlist of slugs');
  const protocols = doc.protocols.map((item, i) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) refuse("snapshot.json's protocol " + i + ' is not an object');
    const rec = item as Record<string, unknown>;
    if (typeof rec.slug !== 'string' || typeof rec.name !== 'string' || typeof rec.tvl_usd !== 'number' || !Number.isFinite(rec.tvl_usd)) {
      refuse("snapshot.json's protocol " + i + ' lacks a slug, a name or a TVL');
    }
    return {
      slug: rec.slug, name: rec.name,
      category: typeof rec.category === 'string' ? rec.category : null,
      chains: Array.isArray(rec.chains) ? rec.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: rec.tvl_usd,
      change_7d: typeof rec.change_7d === 'number' && Number.isFinite(rec.change_7d) ? rec.change_7d : null,
      mcap_usd: typeof rec.mcap_usd === 'number' && Number.isFinite(rec.mcap_usd) ? rec.mcap_usd : null,
      listed_at: typeof rec.listed_at === 'string' ? rec.listed_at : null,
      gecko_id: typeof rec.gecko_id === 'string' ? rec.gecko_id : null,
      symbol: typeof rec.symbol === 'string' ? rec.symbol : null,
    };
  });
  return {
    as_of: doc.as_of, source: doc.source, floor_usd: doc.floor_usd,
    protocols, watchlist: doc.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((row) => row.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return 'the board misses ' + missing.length + ' watchlist slug' + (missing.length === 1 ? '' : 's') + ': ' + missing.slice(0, 5).join(', ');
  const ranks = board.map((row) => row.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return 'rank ' + (i + 1) + ' is ' + ranks[i];
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return 'row ' + (i + 1) + ' outranks row ' + i + ' on implied value';
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all ' + board.length + ' rows share the same implied value $' + board[0]!.implied_value_usd + ': a board that ranks nothing by value is not a ranking';
  }
  for (const row of board) {
    const steps = row.farm_steps;
    if (steps.length < 3 || steps.length > 12) return row.slug + ' has ' + steps.length + ' farm steps';
    for (const step of steps) if (step.length < 20 || step.length > 600) return row.slug + ' has a farm step of ' + step.length + ' characters';
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0) return row.slug + ' has implied value ' + row.implied_value_usd;
  }
  return null;
}

/** data.js, compact: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return 'window.RADAR=' + JSON.stringify(radar) + ';\n';
}

/** Earlier names for the helpers above, kept so existing imports keep working. */
export const ageDays = daysSince;
export const isPreToken = hasNoToken;
export const isRankable = canRank;
export const categoryMultiples = peerMultiples;
export const impliedValue = scoreProtocol;
export const farmSteps = planSteps;
export const stepText = stepLine;
export const liveRows = liveSet;
export const radarRow = compactRow;
