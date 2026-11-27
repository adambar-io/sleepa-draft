// node --test tests/   (Node 18+, no dependencies)
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine.js');
const FX = require('./fixture_draft.json'); // a real 12-team keeper league's 2025 and 2026 drafts (roster ids only)

test('snake order with traded picks matches a real Sleeper draft, pick for pick', function(){
  ['2025', '2026'].forEach(function(season){
    const d = FX[season];
    const picks = E.pickOrder(d);
    assert.strictEqual(picks.length, d.picks.length);
    d.picks.forEach(function(row, i){
      const p = picks[i];
      assert.deepStrictEqual([p.no, p.round, p.slot, p.owner], row, season + ' pick ' + row[0]);
    });
  });
});

test('every real keeper sits on a pick its team owns in its round', function(){
  const d = FX['2026'];
  const picks = E.pickOrder(d);
  const keepers = d.keepers.map(function(k){ return { roster: k[2], pid: k[3], round: k[1] }; });
  const res = E.placeKeepers(picks, keepers);
  assert.strictEqual(Object.keys(res.byPick).length, keepers.length);
  Object.keys(res.byPick).forEach(function(no){
    const p = picks[no - 1], k = res.byPick[no];
    assert.strictEqual(p.owner, k.roster);
    assert.strictEqual(p.round, keepers.find(function(x){ return x.pid === k.pid; }).round);
  });
  // pinned to the real pick numbers, it reproduces Sleeper exactly
  const pinned = E.placeKeepers(picks, d.keepers.map(function(k){ return { roster: k[2], pid: k[3], round: k[1], pick: k[0] }; }));
  d.keepers.forEach(function(k){ assert.strictEqual(pinned.byPick[k[0]].pid, k[3]); });
  assert.deepStrictEqual(pinned.notes, []);
});

test('third-round reversal and linear orders', function(){
  const base = { teams: 4, rounds: 5, slotToRoster: { 1: 1, 2: 2, 3: 3, 4: 4 } };
  const slots = function(o){ return E.pickOrder(Object.assign({}, base, o)).map(function(p){ return p.slot; }).join(''); };
  assert.strictEqual(slots({ type: 'snake' }), '12344321123443211234');
  assert.strictEqual(slots({ type: 'snake', reversalRound: 3 }), '12344321432112344321');
  assert.strictEqual(slots({ type: 'linear' }), '12341234123412341234');
});

test('keeper whose cost-round pick was traded moves earlier, never later when an earlier pick exists', function(){
  const picks = E.pickOrder({ teams: 2, rounds: 4, type: 'snake', slotToRoster: { 1: 1, 2: 2 },
    traded: [{ round: 3, roster_id: 1, owner_id: 2 }] });
  const r = E.placeKeepers(picks, [{ roster: 1, pid: 'a', round: 3 }]);
  const no = Number(Object.keys(r.byPick)[0]);
  assert.strictEqual(picks[no - 1].round, 2);
  assert.match(r.notes[0].msg, /moved to round 2/);
  // two keepers in the same round: second one moves up a round
  const r2 = E.placeKeepers(E.pickOrder({ teams: 2, rounds: 4, type: 'snake', slotToRoster: { 1: 1, 2: 2 } }),
    [{ roster: 1, pid: 'a', round: 4 }, { roster: 1, pid: 'b', round: 4 }]);
  const rounds = Object.keys(r2.byPick).map(function(no){ return Math.ceil(no / 2); }).sort();
  assert.deepStrictEqual(rounds, [3, 4]);
});

function pool(){
  const out = [], pos = ['RB', 'WR', 'WR', 'RB', 'QB', 'TE', 'WR', 'RB'];
  for(let i = 1; i <= 200; i++) out.push({ pid: 'p' + i, pos: pos[i % pos.length], rk: i });
  for(let i = 1; i <= 20; i++){ out.push({ pid: 'k' + i, pos: 'K', rk: 150 + i }); out.push({ pid: 'd' + i, pos: 'DEF', rk: 140 + i }); }
  return out;
}
const SLOTS = E.slotsOf(['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN', 'BN']);

test('a full CPU draft is deterministic per seed and every team ends with sensible rosters', function(){
  function run(seed){
    const rand = E.rng(seed), picks = E.pickOrder({ teams: 10, rounds: 16, type: 'snake', slotToRoster: { 1: 1, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10 } });
    let avail = pool(); const made = {}, teams = {};
    picks.forEach(function(p){
      const mine = teams[p.owner] || (teams[p.owner] = []);
      const c = E.cpuPick({ available: avail, mine: mine, slots: SLOTS, round: p.round, rounds: 16, rand: rand });
      made[p.no] = { pid: c.pid, roster: p.owner }; mine.push(c); avail = avail.filter(function(x){ return x !== c; });
    });
    return { made: made, teams: teams };
  }
  const a = run(7), b = run(7), c = run(8);
  assert.deepStrictEqual(a.made, b.made);
  assert.notDeepStrictEqual(a.made, c.made);
  Object.values(a.teams).forEach(function(t){
    const n = function(pos){ return t.filter(function(p){ return p.pos === pos; }).length; };
    assert.strictEqual(t.length, 16);
    assert.strictEqual(n('K'), 1); assert.strictEqual(n('DEF'), 1);
    assert.ok(n('QB') >= 1 && n('QB') <= 2, 'QBs ' + n('QB'));
    assert.ok(n('TE') >= 1 && n('TE') <= 2, 'TEs ' + n('TE'));
    assert.ok(t.slice(0, 13).every(function(p){ return p.pos !== 'K' && p.pos !== 'DEF'; }), 'no K/DEF before round 14');
  });
  // the first round goes close to the ranking
  const r1 = Object.keys(a.made).slice(0, 10).map(function(no){ return Number(a.made[no].pid.slice(1)); });
  assert.ok(Math.max.apply(null, r1) <= 16, 'round 1 ranks ' + r1);
});

test('a team whose last-round picks went to keepers still drafts its K and DEF', function(){
  // 16 rounds, but this team's last two picks are keepers: its real last picks are rounds 13 and 14
  const rand = E.rng(3); let avail = pool(); const mine = [{ pos: 'RB' }, { pos: 'RB' }];
  for(let r = 1; r <= 14; r++){
    const c = E.cpuPick({ available: avail, mine: mine, slots: SLOTS, round: r, rounds: 16, left: 14 - r + 1, rand: rand });
    mine.push(c); avail = avail.filter(function(x){ return x !== c; });
  }
  const n = function(pos){ return mine.filter(function(p){ return p.pos === pos; }).length; };
  assert.strictEqual(n('K'), 1); assert.strictEqual(n('DEF'), 1);
});

test('suggestKeepers prefers the biggest bargain and skips bad deals', function(){
  const s = E.suggestKeepers([
    { pid: 'star', rk: 3, round: 1 },      // fair
    { pid: 'steal', rk: 20, round: 9 },     // big bargain
    { pid: 'bust', rk: 150, round: 2 },     // costs a 2nd, ranks 150th
    { pid: 'cheap', rk: 60, round: 16 }
  ], 2, 12);
  assert.deepStrictEqual(s.map(function(x){ return x.pid; }), ['cheap', 'steal']);
});

test('lineup fills starters then flex then bench', function(){
  const l = E.lineup([{ pid: 'q', pos: 'QB', rk: 30 }, { pid: 'r1', pos: 'RB', rk: 1 }, { pid: 'r2', pos: 'RB', rk: 5 }, { pid: 'r3', pos: 'RB', rk: 9 },
    { pid: 'w1', pos: 'WR', rk: 2 }, { pid: 'q2', pos: 'QB', rk: 90 }], SLOTS);
  const at = function(slot){ return l.slots.filter(function(s){ return s.slot === slot; }).map(function(s){ return s.pid; }); };
  assert.deepStrictEqual(at('RB'), ['r1', 'r2']);
  assert.deepStrictEqual(at('FLEX'), ['r3', null]);
  assert.deepStrictEqual(l.bench, ['q2']);
});
