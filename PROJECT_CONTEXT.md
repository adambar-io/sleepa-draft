# sleepa draft: project context

A sibling of Sleepa (adambar-io/sleepa): same look (tokens copied from Sleepa's index.html), separate repo, no shared
code. Mock drafts with your real Sleeper league, built Nov 26 2026. Hosted (once pushed) on GitHub Pages at
adambar-io.github.io/sleepa-draft/. Local preview: launch config `sleepa-draft` (port 8792) in sleepa's
`.claude/launch.json`.

## Files

- `index.html`: the app (vanilla JS, no build step, no framework). Screens: home (username → leagues, finished
  mocks), setup (draft settings, order, keepers), draft room, recap.
- `engine.js`: the draft engine as pure functions (no DOM, no network), loaded as `window.DraftEngine` and by the
  tests: seeded RNG, pick order (snake / linear / third-round reversal, traded picks), keeper placement, keeper
  suggestions, lineup fill, the CPU pick.
- `build_pool.py` → `pool.json` (~170 KB): the draftable player pool. Daily Action `update-pool.yml`.
- `tests/engine.test.js` + `tests/fixture_draft.json`: `node --test tests/engine.test.js`. The fixture is a real
  12-team keeper league's 2025 and 2026 Sleeper drafts (roster ids, rounds, slots, keeper picks; no user ids or names); the
  engine reproduces both drafts' order pick for pick, traded picks included.

## Which draft a league mocks

`loadLeague` (index.html):
- **League for the draft's season exists and hasn't drafted** (`status` pre_draft / drafting): mock that draft. Order
  from its `slot_to_roster_id` when set ("Set in Sleeper"), traded picks from `/draft/<id>/traded_picks`, keepers from
  its picks with `is_keeper` (locked) once the commissioner sets them. Keeper costs come from the previous league's
  draft (`previous_league_id`).
- Leagues listed: the NFL season, `league_create_season` and the one after, minus any league renewed into a newer
  one, so the old league stays listed through the rollover until it's renewed. `build_pool.py` falls back the same way.
- **Otherwise** (the offseason, today): mock NEXT season's draft from this league. Today's rosters are the keeper
  candidates, this season's draft sets their cost, and `/league/<id>/traded_picks` rows for next season set who owns
  which pick. Sleeper's `/state/nfl` `league_create_season` says when next season's leagues exist (2026 on Nov 26
  2026: no 2027 leagues yet).
- Auction drafts: not supported; the setup says so and offers a snake mock instead.
- Dynasty (`settings.type` 2): every rostered player stays; the mock drafts everyone else.

## Sleeper facts checked on the owner's 12-team keeper league (Nov 26 2026)

- `league.settings.draft_rounds` is NOT the draft's length (it said 3 for a 16-round draft). Use the draft's
  `settings.rounds`.
- `rosters[].keepers` is null even in a keeper league. The keepers live only on the draft's picks (`is_keeper: true`),
  set by the commissioner before the draft.
- `settings.max_keepers` is set on redraft leagues too (Sleeper default 2); only `type: 1` means keeper league, so
  keepers default off elsewhere (a checkbox turns them on).
- `traded_picks` rows: `roster_id` = the original owner, `owner_id` = who has it now, per `season` and `round`.
  Next season's rows already exist during this season.
- Snake with `reversal_round` R: round R runs the same way as round R−1, then the snake continues.
- A keeper can sit on a pick its team traded for (seen in the 2026 draft: a 1st-round keeper on another team's 1st-rounder).

## Keeper cost (the owner's league rule)

Cost = the round the player went in last season's draft; a keeper stays at the round it was kept in, year after
year (Bijan Robinson R1 → R1 → R1; Puka Nacua R16 → R16). Undrafted players cost the last round (round 16).
Players dropped after the draft and picked up again also cost the last round (Josh Jacobs: drafted R2 in 2026 by
another team, dropped week 4, claimed week 6 → R16), read from `/league/<id>/transactions/<week>` (weeks 0–18).
Trades keep the cost (Terry McLaurin, traded, still R7).
Configurable per league in the setup: rounds earlier than drafted (0 = same round), the undrafted round, and the
dropped-and-re-added rule. Any single keeper's round can be set by hand.

The owner stated only "same round as drafted"; the other two parts were read from the data. Backtest (Nov 26
2026) of this exact rule against every real keeper in the league's 2025 and 2026 drafts, with each prior season's
transactions: **43 of 44 match**. Pickups confirmed by Jaxon Smith-Njigba (R10, dropped, re-added → kept R16) and
Baker Mayfield (undrafted → R16); trades keeping cost by Terry McLaurin, Christian McCaffrey and Derrick Henry.
The one miss: Caleb Williams went R13 in 2025, was traded in week 6, and was kept in 2026 at R16. Either the
commissioner moved him, or traded-for players reset in some cases. Ask the owner before changing the rule.

Placement (`placeKeepers`): the pinned pick if any, else the team's own pick in the cost round, else the nearest
EARLIER round it owns (a keeper never gets cheaper by moving), else the nearest later one. Two keepers in one round:
the second moves up a round. Moves are listed above the board ("N keepers moved off their cost round").

Suggested keepers: per team, the players who save the most picks: (cost round − 0.5) × teams − rank, up to
`max_keepers`, skipping anyone more than a round's worth worse than the pick they cost.

## Rankings (`pool.json`)

- **Sleeper ADP** from the unofficial season projections endpoint
  `api.sleeper.app/projections/nfl/<season>?season_type=regular&position[]=…` (CORS *, no key; ~7 MB for every
  position, so the Action trims it). Per player `adp_ppr / adp_half_ppr / adp_std / adp_2qb / adp_dynasty_* /
  adp_rookie / adp_idp`; **999 = no ADP**. The build takes the newest season with real ADP (2027 returns
  `stats: {}` until 2027 drafts start, so 2026 for now). Also `pts_ppr / pts_half_ppr / pts_std` season projections.
- **FantasyPros ECR** via DynastyProcess `db_fpecr_latest.csv` (weekly), overall pages only: ROS PPR, superflex,
  dynasty, dynasty superflex, rookies, and the preseason draft cheat sheets when FantasyPros publishes them. Matched
  by `fantasypros_id` → `sleeper_id` in DynastyProcess `db_playerids.csv` (which also gives birthdates); defenses
  by team code.
- Kept: real ADP inside 300 in any format, a FantasyPros rank inside 300, or ≥ 25 projected PPR points (863
  players on Nov 26 2026).
- App sources (`sourcesFor`): Sleeper ADP in the league's format (PPR / half / standard, superflex when the league
  has SUPER_FLEX or 2+ QB slots, dynasty variants for dynasty leagues), each FantasyPros page, and a **blend**
  (average of the ADP rank and the FantasyPros dynasty rank). Default: ADP once it exists for the draft's season,
  the blend before that (last summer's ADP alone is stale in the offseason).

## CPU drafters (`cpuPick`)

Noisy ranking: score = rank + gaussian × noise × (1.2 + 0.055 × rank), lowest score wins among the top 30 eligible.
Noise per style: tight 0.5, "like real people" 1, chaos 1.9. Roster sense: no K/DEF until the team's last picks
(counted from its actual remaining picks, since keepers and trades take some), but always one of each by the end
when the league starts them; no second QB before 60 % of the draft in 1-QB leagues; no second TE before 55 %; caps
(QB starters + 1, or + 2 in superflex; TE starters + 1); an empty starting spot nudges that position up after round
3. Each pick's randomness is seeded by (mock seed, pick number), so a saved mock resumes and undoes
deterministically. IDP positions aren't drafted by CPUs yet.

## Saving

localStorage, all keys prefixed `sd-`: `sd-user`, `sd-theme`, `sd-cfg-<league id>` (setup choices and keepers),
`sd-current-<league id>` (the mock in progress: resume from home or setup), `sd-mocks` (last 12 finished mocks).

## Recap

Projected starter points (Sleeper's season projection in the league's format, best lineup), place among the
teams, and "picks of value vs the league average": per pick, the non-keeper picks made before it minus the
player's rank among non-kept players (keepers are good players on late picks, so raw pick − rank makes everything
look like a reach), summed over your picks with K/DEF left out, minus the league's average team total. The raw
totals run negative for every team (CPUs pass on well-ranked backup QBs / second TEs, so the drafted pool ranks
worse than the pick numbers: about −66 per team in a 20-draft simulation), hence the comparison with the league.
Also best values and biggest reaches, and every team's starters.

## Not tested yet

The pre-draft path (the draft's season league exists, keepers set in Sleeper, Sleeper's order) has not run against
real data: no league was in that state on Nov 26 2026. Check it when 2027 leagues are renewed.

## Next (not built)

1. **Leaguemate tendencies**: walk `previous_league_id` back through past drafts and make each CPU draft like that
   manager (when they take their first QB / TE, RB-heavy starts, reaches for rookies).
2. **Live draft assistant**: when the real Sleeper draft starts, poll `/draft/<id>/picks` and recommend picks.
3. **Pick trades inside a mock**, and IDP drafting.
4. 2027 projections for the recap once Sleeper publishes them (it uses 2026's until then).
