# Token Radar: pre-token protocols ranked by implied value

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/mucikcepet/makefun-token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/mucikcepet/makefun-token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar for make.fun's "Build the best token launch radar" bounty ($1,325 in USDC).
It reads a sealed DefiLlama snapshot of 758 protocols (as of 2026-11-14), finds the ones that
record no token yet, ranks them by an implied launch value, and gives each one a concrete farm
plan. This is not a trading bot and it places no trades: it is a read-only ranking dashboard.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

`main.ts` (Node 22, standard library only) writes `out/board.json` (198 ranked rows),
`out/data.js`, `out/dashboard/` (the static page) and `out/dossier.json`, and copies
`screenshots/` to `out/screenshots/`. Open `out/dashboard/index.html` in a browser; it
renders with no network.

## The model (radar-2)

Every row is scored by one function of the snapshot's own figures; no protocol name is
special-cased.

```
implied = round( tvl_usd x category_multiple
                 x (1 + clamp(change_7d, -60, 120) / 100 x 0.5)
                 x (0.6 + min(age_days, 1095) / 1095 x 0.4)
                 x (1 + 0.05 x min(chains - 1, 4)) )
```

- **Category multiple**: the median market-cap / TVL of the snapshot's live-token protocols in
  the same category (at least 5 peers), else the global median (0.241), clamped to [0.05, 1.00].
  It is computed from the snapshot at run time, never written in by hand. On this snapshot:
  Basis Trading 0.654, Dexs 0.342, RWA 0.275, Yield 0.191, Lending 0.132.
- **Growth**: the protocol's 7-day TVL change, clamped to [-60%, +120%].
- **Maturity**: how long it has run with no token (age since first listed, unknown age = 365 days).
- **Breadth**: a small lift for protocols live on more chains (at most 1.20x).

## What the board covers

- All 40 protocols on the snapshot's watchlist (TVL >= $50M, no token on record).
- All 158 other rankable pre-token protocols below the floor — 198 rows in total.
- Excluded, by the watchlist's own rule applied to every row: bridges, canonical bridges,
  liquid staking / restaking, CEX, versioned pools (a name ending in V2 / 2.0), and wrapped or
  staked products of tokens that already trade (WBTC, Binance staked ETH, USDT0 and the like).
  A protocol is called pre-token only because its DefiLlama record carries no token; the record
  is not proof it has none.
- The 24 largest live-token protocols are set aside in a separate "Live token" view with their
  market caps shown as facts, never mixed into the ranking.

## Farm plans

Each row carries 6 steps, derived from the protocol's own category, chains, TVL and age: the
action, the capital ($50–$250), the gas cost on its first chain (Ethereum ~$8, Bitcoin ~$4,
other chains ~$1), a weekly qualifying action, and a hold period of 30–60 days.

## Layout

- `main.ts` — the program: reads the snapshot, scores the board, writes the outputs.
- `lib/model.ts` — the radar-2 model, the board builder and the farm-plan derivation.
- `vendor/makefun-board.ts` — make.fun's dossier library, unchanged.
- `dashboard/` — the static page: sortable, filterable board (search, category, chain,
  minimum TVL, watchlist-only), a detail view per protocol with the model's breakdown, and
  the live-token view.
- `screenshots/` — 1-board.png (the board), 2-detail.png (a detail view), 3-filtered.png
  (a filtered view).

---

<sub>Entered on [make.fun](https://make.fun/?ref=0vawvfxh&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
