/* sleepa draft — the draft engine. Pure functions, no DOM, no network: index.html renders, this decides.
   Loaded by index.html as a plain script (window.DraftEngine) and by tests/engine.test.js under Node. */
(function(root){
  'use strict';

  // ---------- seeded randomness (mulberry32), so a mock can be replayed and tested ----------
  function rng(seed){
    let a = (seed >>> 0) || 1;
    const next = function(){
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
    next.gauss = function(){ // Box-Muller
      let u = 0, v = 0;
      while(u === 0) u = next();
      while(v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    };
    return next;
  }

  // ---------- pick order ----------
  // Sleeper semantics: snake flips every round; reversal_round R (e.g. 3 = "third-round reversal") makes round R
  // run the same way as round R-1, and the snake carries on from there. Linear: every round runs 1..n.
  function forward(round, type, reversalRound){
    if(type === 'linear') return true;
    const odd = round % 2 === 1;
    return reversalRound > 0 && round >= reversalRound ? !odd : odd;
  }

  // slotToRoster: {slot: rosterId}. traded: [{round, roster_id (original owner), owner_id (owns it now)}] for the
  // draft's season only. Returns [{no, round, slot, orig, owner}] in pick order.
  function pickOrder(o){
    const teams = o.teams, rounds = o.rounds, picks = [];
    const own = {};
    (o.traded || []).forEach(function(t){ own[t.round + ':' + t.roster_id] = t.owner_id; });
    let no = 0;
    for(let r = 1; r <= rounds; r++){
      const fwd = forward(r, o.type, o.reversalRound || 0);
      for(let i = 0; i < teams; i++){
        const slot = fwd ? i + 1 : teams - i;
        const orig = Number(o.slotToRoster[slot]);
        const owner = own[r + ':' + orig] != null ? Number(own[r + ':' + orig]) : orig;
        picks.push({ no: ++no, round: r, slot: slot, orig: orig, owner: owner });
      }
    }
    return picks;
  }

  // ---------- keepers ----------
  // keepers: [{roster, pid, round, pick?}]. Each keeper takes a pick its team owns: the pinned pick if given and
  // valid, else its own pick in the cost round, else the nearest EARLIER round it owns (a keeper never gets
  // cheaper by moving), else the nearest later one. Returns {byPick: {no: {pid, roster, keeper:true}}, notes}.
  function placeKeepers(picks, keepers){
    const byPick = {}, notes = [];
    const ordered = keepers.slice().sort(function(a, b){ return (a.pick ? 0 : 1) - (b.pick ? 0 : 1) || a.round - b.round; });
    ordered.forEach(function(k){
      const mine = picks.filter(function(p){ return p.owner === k.roster && !byPick[p.no]; });
      let p = k.pick ? mine.find(function(x){ return x.no === k.pick; }) : null;
      if(k.pick && !p) notes.push({ pid: k.pid, roster: k.roster, msg: 'pinned pick ' + k.pick + ' is not this team\'s or is taken' });
      if(!p) p = mine.find(function(x){ return x.round === k.round; });
      if(!p){
        const earlier = mine.filter(function(x){ return x.round < k.round; });
        p = earlier.length ? earlier[earlier.length - 1] : mine.find(function(x){ return x.round > k.round; });
        if(p) notes.push({ pid: k.pid, roster: k.roster, msg: 'no round ' + k.round + ' pick left, moved to round ' + p.round });
      }
      if(!p){ notes.push({ pid: k.pid, roster: k.roster, msg: 'no pick left for this keeper' }); return; }
      byPick[p.no] = { pid: k.pid, roster: k.roster, keeper: true };
    });
    return { byPick: byPick, notes: notes };
  }

  // Which of a team's candidates to keep: biggest gap between where the cost round's pick falls and where the
  // player ranks. cands: [{pid, rk, round}] (rk = overall rank, lower is better). Keeps up to max players whose
  // value isn't clearly worse than the pick they cost.
  function suggestKeepers(cands, max, teams){
    return cands.map(function(c){ return Object.assign({ surplus: ((c.round - 0.5) * teams) - c.rk }, c); })
      .filter(function(c){ return c.rk < 900 && c.surplus > -teams; })
      .sort(function(a, b){ return b.surplus - a.surplus; })
      .slice(0, max);
  }

  // ---------- rosters & needs ----------
  const FLEX_OK = {
    FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['RB', 'WR'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE']
  };
  // slots from a Sleeper league's roster_positions: {QB:1, RB:2, WR:2, TE:1, FLEX:2, K:1, DEF:1, BN:6, ...}
  function slotsOf(rosterPositions){
    const s = {};
    (rosterPositions || []).forEach(function(p){ s[p] = (s[p] || 0) + 1; });
    return s;
  }

  // Greedy lineup fill: players (best rank first) into starting slots, then flex, then bench.
  // players: [{pid, pos, rk}]. Returns {slots: [{slot, pid|null}], bench: [pid]}.
  function lineup(players, slots){
    const left = players.slice().sort(function(a, b){ return a.rk - b.rk; });
    const out = [], order = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'WRRB_FLEX', 'REC_FLEX', 'FLEX', 'SUPER_FLEX'];
    order.forEach(function(slot){
      for(let i = 0; i < (slots[slot] || 0); i++){
        const ok = FLEX_OK[slot] || [slot];
        const j = left.findIndex(function(p){ return ok.indexOf(p.pos) >= 0; });
        out.push({ slot: slot, pid: j >= 0 ? left.splice(j, 1)[0].pid : null });
      }
    });
    return { slots: out, bench: left.map(function(p){ return p.pid; }) };
  }

  // ---------- CPU pick ----------
  // A CPU drafts close to the ranking with noise that grows deeper in the draft, and with roster sense:
  // no K/DEF until the last rounds (but always one by the end if the league starts them), no second QB/TE early
  // in 1-QB leagues, nothing beyond sensible position caps, and an empty starting spot nudges that position up.
  // o: {available: [{pid,pos,rk}] (any order), mine: [{pos}], slots, round, rounds, rand (rng), noise (1 = normal),
  //     left: picks this team still makes counting this one (keepers and traded picks make this differ from
  //     rounds - round + 1, so pass it; the round-based guess is only a fallback)}
  const STYLES = { tight: 0.5, normal: 1, wild: 1.9 };
  function cpuPick(o){
    const slots = o.slots, round = o.round, rounds = o.rounds, rand = o.rand, noise = o.noise == null ? 1 : o.noise;
    const have = {};
    o.mine.forEach(function(p){ have[p.pos] = (have[p.pos] || 0) + 1; });
    const n = function(p){ return have[p] || 0; };
    const sf = (slots.SUPER_FLEX || 0) > 0;
    const left = o.left != null ? o.left : rounds - round + 1;
    const mustK = (slots.K || 0) - n('K'), mustD = (slots.DEF || 0) - n('DEF');
    const must = Math.max(0, mustK) + Math.max(0, mustD);
    const pool = o.available.slice().sort(function(a, b){ return a.rk - b.rk; });

    // out of picks to waste: take the K/DEF the lineup needs
    if(must > 0 && left <= must){
      const need = pool.find(function(p){ return (p.pos === 'K' && mustK > 0) || (p.pos === 'DEF' && mustD > 0); });
      if(need) return need;
    }
    const late = left <= Math.max(2, must + 1);
    const caps = {
      QB: (slots.QB || 0) + (sf ? 2 : 1), RB: 99, WR: 99, TE: (slots.TE || 0) + 1,
      K: Math.max(slots.K || 0, 0), DEF: Math.max(slots.DEF || 0, 0)
    };
    const starters = { QB: (slots.QB || 0) + (sf ? 1 : 0), RB: slots.RB || 0, WR: slots.WR || 0, TE: slots.TE || 0 };
    let best = null, bestScore = Infinity;
    const top = pool.filter(function(p){
      if(caps[p.pos] == null) return false;            // IDP / unsupported positions: not drafted by CPUs in v1
      if(n(p.pos) >= caps[p.pos]) return false;
      if((p.pos === 'K' || p.pos === 'DEF') && !late) return false;
      return true;
    }).slice(0, 30);
    top.forEach(function(p){
      const sd = noise * (1.2 + p.rk * 0.055);
      let s = p.rk + rand.gauss() * sd;
      if(p.pos === 'QB' && !sf && n('QB') >= starters.QB && round < rounds * 0.6) s += 40 + p.rk * 0.4;
      if(p.pos === 'QB' && sf && n('QB') >= starters.QB + 1 && round < rounds * 0.5) s += 25;
      if(p.pos === 'TE' && n('TE') >= starters.TE && round < rounds * 0.55) s += 25 + p.rk * 0.3;
      if(starters[p.pos] && n(p.pos) < starters[p.pos] && round > 3) s -= 4 + p.rk * 0.06;
      if(s < bestScore){ bestScore = s; best = p; }
    });
    return best || pool[0] || null;
  }

  // ---------- running a draft ----------
  // made: {no: {pid, roster, keeper?}}. Next pick number without a player, at or after `from`.
  function nextOpen(picks, made, from){
    for(let i = (from || 1) - 1; i < picks.length; i++) if(!made[picks[i].no]) return picks[i].no;
    return null;
  }
  function teamPids(roster, made){
    return Object.keys(made).map(Number).sort(function(a, b){ return a - b; })
      .filter(function(no){ return made[no].roster === roster; }).map(function(no){ return made[no].pid; });
  }

  const api = { rng: rng, forward: forward, pickOrder: pickOrder, placeKeepers: placeKeepers, suggestKeepers: suggestKeepers,
    slotsOf: slotsOf, lineup: lineup, cpuPick: cpuPick, STYLES: STYLES, nextOpen: nextOpen, teamPids: teamPids, FLEX_OK: FLEX_OK };
  if(typeof module !== 'undefined' && module.exports) module.exports = api; else root.DraftEngine = api;
})(this);
