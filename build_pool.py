"""Builds pool.json, the draftable player pool for sleepa draft. Python 3 standard library only.

    python build_pool.py

Sources (all public, no keys):
  * Sleeper season projections (unofficial endpoint api.sleeper.app/projections/nfl/<season>): every player's
    Sleeper ADP for each format (adp_ppr, adp_half_ppr, adp_std, adp_2qb, adp_dynasty_*, adp_rookie) and
    season-long projected points. The script takes the newest season whose ADP is real (2027 has none until
    Sleeper's 2027 drafts start; until then it uses 2026). 999 = "no ADP" in Sleeper's data, dropped here.
  * FantasyPros expert consensus rankings as mirrored by DynastyProcess (db_fpecr_latest.csv, weekly): overall
    pages for ROS PPR, superflex, dynasty, dynasty superflex, and the preseason draft cheat sheets when FantasyPros
    has them. Data (c) FantasyPros. Matched to Sleeper ids through DynastyProcess db_playerids.csv, which also gives
    birthdates (for age).

Output: {generated, adp: {season, n}, ecr: {key: {page, scraped, n}}, players: {sleeper_id: {...}}}
  player: n name, p position, t team, x years in the league, b birthdate, a {format: Sleeper ADP},
          pts {ppr, half, std} Sleeper season projection, e {key: FantasyPros overall rank}
Skips rewriting when only `generated` would change.
"""
import csv, datetime, io, json, sys, urllib.request

UA = {'User-Agent': 'Mozilla/5.0 (compatible; sleepa-draft/1.0; +https://github.com/adambar-io/sleepa-draft)'}
DP = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/'
POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF']
ADP_KEYS = {'adp_ppr': 'ppr', 'adp_half_ppr': 'half', 'adp_std': 'std', 'adp_2qb': 'sf', 'adp_dynasty_ppr': 'dppr',
            'adp_dynasty_half_ppr': 'dhalf', 'adp_dynasty_std': 'dstd', 'adp_dynasty_2qb': 'dsf', 'adp_rookie': 'rook'}
ECR_PAGES = {  # key -> FantasyPros page (overall pages only; positional pages add nothing for a draft board)
    'draft': '/nfl/rankings/ppr-cheatsheets.php', 'draft_half': '/nfl/rankings/half-point-ppr-cheatsheets.php',
    'draft_std': '/nfl/rankings/consensus-cheatsheets.php', 'sf': '/nfl/rankings/ppr-superflex.php',
    'ros': '/nfl/rankings/ros-ppr-overall.php', 'dyn': '/nfl/rankings/dynasty-overall.php',
    'dynsf': '/nfl/rankings/dynasty-superflex.php', 'rook': '/nfl/rankings/rookies.php'}
OUT = 'pool.json'


def get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read()


def sleeper_season(season):
    q = '&'.join('position[]=' + p for p in POS)
    return json.loads(get(f'https://api.sleeper.app/projections/nfl/{season}?season_type=regular&{q}&order_by=adp_ppr'))


def real_adp(rows):
    return sum(1 for e in rows if ((e.get('stats') or {}).get('adp_ppr') or 999) < 999)


def main():
    state = json.loads(get('https://api.sleeper.app/v1/state/nfl'))
    base = int(state.get('league_create_season') or state['season'])
    nfl = int(state.get('season') or base)
    rows, season = None, None
    # newest first; around the rollover league_create_season moves ahead of the season with real ADP
    for s in sorted({base + 1, base, nfl, nfl - 1}, reverse=True):
        r = sleeper_season(s)
        if real_adp(r) >= 100:
            rows, season = r, s
            break
    if rows is None:
        sys.exit('No season with Sleeper ADP found')

    players = {}
    for e in rows:
        pl, st, pid = e.get('player') or {}, e.get('stats') or {}, str(e.get('player_id') or '')
        pos = pl.get('position')
        if not pid or pos not in POS:
            continue
        adp = {short: round(float(st[k]), 1) for k, short in ADP_KEYS.items()
               if isinstance(st.get(k), (int, float)) and st[k] < 999}
        pts = {k: round(float(st['pts_' + v]), 1) for k, v in (('ppr', 'ppr'), ('half', 'half_ppr'), ('std', 'std'))
               if isinstance(st.get('pts_' + v), (int, float))}
        if not adp and not any(pts.values()):
            continue
        name = (pl.get('first_name', '') + ' ' + pl.get('last_name', '')).strip()
        p = {'n': name, 'p': pos, 't': pl.get('team') or e.get('team') or 'FA'}
        if pl.get('years_exp') is not None:
            p['x'] = pl['years_exp']
        if adp:
            p['a'] = adp
        if any(pts.values()):
            p['pts'] = pts
        players[pid] = p

    # FantasyPros ECR via DynastyProcess, matched by fantasypros_id -> sleeper_id
    ids = list(csv.DictReader(io.StringIO(get(DP + 'db_playerids.csv').decode('utf-8'))))
    fp2s, birth = {}, {}
    for r in ids:
        sid = (r.get('sleeper_id') or '').strip()
        if sid in ('', 'NA'):
            continue
        if r.get('fantasypros_id') not in (None, '', 'NA'):
            fp2s[r['fantasypros_id']] = sid
        if r.get('birthdate') not in (None, '', 'NA'):
            birth[sid] = r['birthdate']
    ecr_rows = list(csv.DictReader(io.StringIO(get(DP + 'db_fpecr_latest.csv').decode('utf-8'))))
    ecr_meta, unmatched = {}, 0
    for key, page in ECR_PAGES.items():
        rows_p = [r for r in ecr_rows if r['fp_page'] == page]
        if not rows_p:
            continue
        n = 0
        for r in rows_p:
            sid = fp2s.get(r['id'])
            if r.get('pos') == 'DST' and r.get('team'):
                sid = {'JAC': 'JAX', 'LA': 'LAR', 'WSH': 'WAS'}.get(r['team'], r['team'])
            if not sid or sid not in players:
                unmatched += 1
                continue
            try:
                players[sid].setdefault('e', {})[key] = round(float(r['ecr']), 1)
                n += 1
            except ValueError:
                pass
        ecr_meta[key] = {'page': page, 'scraped': max(r['scrape_date'] for r in rows_p), 'n': n}
    # draftable only: a real ADP inside ~25 rounds of any format, a FantasyPros rank inside 300, or a meaningful
    # projection. Everyone else is noise on a draft board.
    players = {sid: p for sid, p in players.items()
               if min(p.get('a', {}).values(), default=999) <= 300 or min(p.get('e', {}).values(), default=999) <= 300
               or p.get('pts', {}).get('ppr', 0) >= 25}
    for sid, p in players.items():
        if sid in birth:
            p['b'] = birth[sid]

    out = {'generated': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%MZ'),
           'adp': {'season': season, 'source': 'Sleeper', 'n': sum(1 for p in players.values() if 'a' in p)},
           'ecr': ecr_meta, 'players': dict(sorted(players.items(), key=lambda kv: (kv[1].get('a', {}).get('ppr', 999), kv[0])))}
    try:
        old = json.load(open(OUT, encoding='utf-8'))
        if {k: v for k, v in old.items() if k != 'generated'} == {k: v for k, v in out.items() if k != 'generated'}:
            print('pool.json unchanged')
            return
    except (OSError, ValueError):
        pass
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, separators=(',', ':'), ensure_ascii=False)
    print(f"pool.json: {len(players)} players, ADP season {season} ({out['adp']['n']} with ADP), "
          f"ECR {', '.join(f'{k}={v['n']}' for k, v in ecr_meta.items())}, {unmatched} ECR rows unmatched")


if __name__ == '__main__':
    main()
