// Reference implementation (Node, no dependencies) of the 22 inputs of the DHQ stand-alone RB median model,
// computed only from free nflverse files, then scored with the exported trees (same evaluator as the WR model).
// Same download set as scripts/build-wr-model-snapshot.mjs — nothing else is needed.
//
// node rb-features.mjs --season=2026 --week=7 --model=rb_median_prod.json --active=snaps|roster [--out=f.json]
//   files (paths below): stats_player_week_<yr>.csv for 2013..season, snap_counts_<yr>.csv for season-1 and season,
//   players.csv, games.csv, injuries_<season>.csv, depth_charts_<season>.csv (ESPN daily format, 2025+),
//   roster_weekly_<season>.csv (only for --active=roster).
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { wrTreePredict } = require('./tree-eval.js');

const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const Y = +A.season, W = +A.week;
// Files: the weekly job's download folder (scripts/build-wr-model-snapshot.mjs), same names as nflverse's.
const D = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
const F = {
  stats: y => D + `stats_player_week_${y}.csv`, snaps: y => D + `snap_counts_${y}.csv`,
  players: D + 'players.csv', games: D + 'games.csv',
  injuries: y => D + `injuries_${y}.csv`, depth: y => D + `depth_charts_${y}.csv`, roster: y => D + `roster_weekly_${y}.csv`,
};

// ---------------------------------------------------------------- tiny CSV reader (quotes, embedded newlines)
function readCSV(path, keep) {
  const s = fs.readFileSync(path, 'utf8'); const rows = []; let i = 0, field = '', row = [], q = false, hdr = null, idx = null;
  const push = () => {
    if (!hdr) { hdr = row; idx = keep.map(k => hdr.indexOf(k)); }
    else if (row.length > 1) { const o = {}; keep.forEach((k, j) => { o[k] = idx[j] >= 0 ? row[idx[j]] : ''; }); rows.push(o); }
    row = [];
  };
  for (; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); field = ''; push(); }
    else if (c !== '\r') field += c;
  }
  if (field !== '' || row.length) { row.push(field); push(); }
  return rows;
}
const num = v => (v === '' || v === undefined || v === 'NA') ? 0 : +v;
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const nm = s => String(s).toLowerCase().replace(/[.']/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z]/g, '');
const blend = (cn, cd, ln, ld, K, K2, lg) => (cn + K * ((ln + K2 * lg) / (ld + K2))) / (cd + K);
const S = (a, k) => a.reduce((s, x) => s + x[k], 0);
const SKILL = ['QB', 'WR', 'TE', 'RB'];

// ---------------------------------------------------------------- players
const P = {}, pfr2g = {};
for (const r of readCSV(F.players, ['gsis_id', 'position', 'birth_date', 'draft_pick', 'pfr_id'])) {
  if (!r.gsis_id) continue;
  P[r.gsis_id] = { pos: r.position === 'FB' ? 'RB' : r.position, birth: r.birth_date, pick: r.draft_pick === '' || r.draft_pick === 'NA' ? 300 : Math.min(300, +r.draft_pick) };
  if (r.pfr_id) pfr2g[r.pfr_id] = r.gsis_id;
}
// ---------------------------------------------------------------- weekly stats: fp, carries, targets, team totals, career, defence
const SC = ['receptions', 'receiving_yards', 'receiving_tds', 'rushing_yards', 'rushing_tds', 'receiving_fumbles_lost',
  'rushing_fumbles_lost', 'sack_fumbles_lost', 'receiving_2pt_conversions', 'rushing_2pt_conversions', 'passing_2pt_conversions',
  'passing_yards', 'passing_tds', 'passing_interceptions'];
const halfPPR = r => num(r.receptions) * .5 + num(r.receiving_yards) * .1 + num(r.receiving_tds) * 6 + num(r.rushing_yards) * .1 +
  num(r.rushing_tds) * 6 - 2 * (num(r.receiving_fumbles_lost) + num(r.rushing_fumbles_lost) + num(r.sack_fumbles_lost)) +
  2 * (num(r.receiving_2pt_conversions) + num(r.rushing_2pt_conversions) + num(r.passing_2pt_conversions)) +
  num(r.passing_yards) * .04 + num(r.passing_tds) * 4 - num(r.passing_interceptions);
const ST = {}, TT = {}, CAR = {}, SEA = {}, DEF = {}, name2g = {};
for (let y = 2013; y <= Y; y++) {
  for (const r of readCSV(F.stats(y), ['player_id', 'player_display_name', 'season', 'week', 'season_type', 'team', 'opponent_team', 'carries', 'targets', ...SC])) {
    if (r.season_type !== 'REG' || !r.player_id) continue;
    const w = +r.week, t = fx(r.team), fp = halfPPR(r), car = num(r.carries), tg = num(r.targets);
    if (y < Y) {
      const c = CAR[r.player_id] || (CAR[r.player_id] = { fp: 0, g: 0 }); c.fp += fp; c.g += 1;
      if (y >= Y - 2) { const k = r.player_id + '|' + y, s = SEA[k] || (SEA[k] = { fp: 0, g: 0 }); s.fp += fp; s.g += 1; }
    }
    if (y >= Y - 1 && !(y === Y && w >= W)) {
      ST[`${r.player_id}|${y}|${w}`] = { car, tgt: tg, fp, ryd: num(r.rushing_yards),
        rfp: num(r.rushing_yards) * .1 + num(r.rushing_tds) * 6, cfp: num(r.receptions) * .5 + num(r.receiving_yards) * .1 + num(r.receiving_tds) * 6 };
      const k = `${t}|${y}|${w}`, T = TT[k] || (TT[k] = { car: 0, tgt: 0 }); T.car += car; T.tgt += tg;
      const d = `${fx(r.opponent_team)}|${y}|${w}`, D = DEF[d] || (DEF[d] = { car: 0, ryd: 0 }); D.car += car; D.ryd += num(r.rushing_yards);
    }
    if (y >= Y - 1) name2g[`${nm(r.player_display_name)}|${t}|${y}|${w}`] = r.player_id;
  }
}
// ---------------------------------------------------------------- snap counts = games played (any snap) + offense %
const G = {};          // gsis -> [{y,w,team,pct,car,tgt,tmc,tmt,fp,rfp,cfp,ryd}]
const snapW = [];      // rows of the target week (active set in --active=snaps mode)
const seenW = new Set();
for (const y of [Y - 1, Y]) {
  for (const r of readCSV(F.snaps(y), ['season', 'game_type', 'week', 'player', 'pfr_player_id', 'position', 'team', 'offense_snaps', 'offense_pct', 'st_snaps'])) {
    if (r.game_type !== 'REG' || !(num(r.offense_snaps) > 0 || num(r.st_snaps) > 0)) continue;
    const w = +r.week, t = fx(r.team);
    const g = pfr2g[r.pfr_player_id] || name2g[`${nm(r.player)}|${t}|${y}|${w}`];
    if (!g) continue;
    if (y === Y && w === W) { if (!seenW.has(g)) { seenW.add(g); snapW.push({ g, team: t, pos: (P[g] && P[g].pos) || (r.position === 'FB' ? 'RB' : r.position) }); } continue; }
    if (y === Y && w > W) continue;
    const s = ST[`${g}|${y}|${w}`] || { car: 0, tgt: 0, fp: 0, rfp: 0, cfp: 0, ryd: 0 }, T = TT[`${t}|${y}|${w}`] || { car: 0, tgt: 0 };
    (G[g] || (G[g] = [])).push({ y, w, team: t, pct: num(r.offense_pct), ...s, tmc: T.car, tmt: T.tgt });
  }
}
for (const g in G) { const seen = new Set(); G[g] = G[g].filter(x => { const k = x.y + '|' + x.w; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.y - b.y || a.w - b.w); }
// team games (carries / targets per game): every team-week with stats, before week W this season / all last season
const TG = {};
for (const k in TT) { const [t, y] = k.split('|'); const o = TG[t] || (TG[t] = { cc: 0, ct: 0, cd: 0, lc: 0, lt: 0, ld: 0 });
  if (+y === Y) { o.cc += TT[k].car; o.ct += TT[k].tgt; o.cd += 1; } else { o.lc += TT[k].car; o.lt += TT[k].tgt; o.ld += 1; } }
// defence: rushing yards per carry allowed (all rushers), this season before week W / last season
const DG = {};
for (const k in DEF) { const [t, y] = k.split('|'); const o = DG[t] || (DG[t] = { cc: 0, cy: 0, lc: 0, ly: 0 });
  if (+y === Y) { o.cc += DEF[k].car; o.cy += DEF[k].ryd; } else { o.lc += DEF[k].car; o.ly += DEF[k].ryd; } }
function usage(g) {
  const L = G[g] || [], cur = L.filter(x => x.y === Y), last = L.filter(x => x.y === Y - 1);
  const c = { g: cur.length, car: S(cur, 'car'), tgt: S(cur, 'tgt'), tmc: S(cur, 'tmc'), tmt: S(cur, 'tmt'), fp: S(cur, 'fp'), rfp: S(cur, 'rfp'), cfp: S(cur, 'cfp'), ryd: S(cur, 'ryd') };
  const l = { g: last.length, car: S(last, 'car'), tgt: S(last, 'tgt'), tmc: S(last, 'tmc'), tmt: S(last, 'tmt'), fp: S(last, 'fp'), rfp: S(last, 'rfp'), cfp: S(last, 'cfp'), ryd: S(last, 'ryd') };
  const pct = cur.map(x => x.pct), withCar = cur.filter(x => x.tmc > 0);
  return {
    g_cur: c.g,
    ppg: blend(c.fp, c.g, l.fp, l.g, 3, 4, 4.0),
    rppc: blend(c.rfp, c.car, l.rfp, l.car, 40, 80, 0.60), rppt: blend(c.cfp, c.tgt, l.cfp, l.tgt, 25, 40, 1.15),
    ypc: blend(c.ryd, c.car, l.ryd, l.car, 40, 80, 4.2),
    csh: blend(c.car, c.tmc, l.car, l.tmc, 60, 90, 0.03), tsh: blend(c.tgt, c.tmt, l.tgt, l.tmt, 60, 90, 0.04),   // competition shares
    snap_l1: pct.length ? pct[pct.length - 1] : null,
    snap_l3: pct.length ? pct.slice(-3).reduce((a, b) => a + b, 0) / pct.slice(-3).length : null,
    csh_l1: withCar.length ? withCar[withCar.length - 1].car / withCar[withCar.length - 1].tmc : null,
  };
}
// ---------------------------------------------------------------- game: date, implied total, spread, opponent
const GM = {};
for (const r of readCSV(F.games, ['season', 'game_type', 'week', 'gameday', 'home_team', 'away_team', 'spread_line', 'total_line'])) {
  if (+r.season !== Y || +r.week !== W || r.game_type !== 'REG') continue;
  const ok = r.total_line !== '' && r.total_line !== 'NA' && r.spread_line !== '' && r.spread_line !== 'NA';
  const tot = +r.total_line, spr = +r.spread_line, h = fx(r.home_team), a = fx(r.away_team);
  GM[h] = { day: r.gameday, itt: ok ? (tot + spr) / 2 : null, spread: ok ? -spr : null, opp: a };
  GM[a] = { day: r.gameday, itt: ok ? (tot - spr) / 2 : null, spread: ok ? spr : null, opp: h };
}
// ---------------------------------------------------------------- injury report for week W
const INJ = {};
for (const r of readCSV(F.injuries(Y), ['season', 'week', 'gsis_id', 'report_status', 'practice_status', 'report_primary_injury', 'practice_primary_injury'])) {
  if (+r.season !== Y || +r.week !== W || !r.gsis_id) continue;
  const st = { Questionable: 1, Doubtful: 2, Out: 3 }[r.report_status] || 0;
  const ps = r.practice_status.toLowerCase(), pr = ps.includes('did not') ? 2 : ps.includes('limited') ? 1 : 0;
  const rest = /not injury|resting/.test((r.report_primary_injury + ' ' + r.practice_primary_injury).toLowerCase()) ? 1 : 0;
  INJ[r.gsis_id] = { st, pr, rest };
}
const hurtOf = g => { const j = INJ[g]; return j && !j.rest && (j.st > 0 || j.pr >= 1) ? 1 : 0; };
// ---------------------------------------------------------------- who is active (QB/RB/WR/TE)
let ACTIVE;
if (A.active === 'roster') {   // live: 53-man roster (ACT/INA) minus Out/Doubtful; latest posted roster week <= W
  const RO = readCSV(F.roster(Y), ['season', 'week', 'game_type', 'team', 'gsis_id', 'position', 'status']).filter(r => r.game_type === 'REG' && +r.season === Y);
  const tw = {}; for (const r of RO) { const w = +r.week; if (w <= W) tw[fx(r.team)] = Math.max(tw[fx(r.team)] || 0, w); }   // each team's own latest roster <= W (teams off a bye)
  ACTIVE = RO.filter(r => +r.week === tw[fx(r.team)] && (r.status === 'ACT' || r.status === 'INA') && r.gsis_id && ['QB', 'WR', 'TE', 'RB', 'FB'].includes(r.position))
    .filter(r => !((INJ[r.gsis_id] || {}).st >= 2))
    .map(r => ({ g: r.gsis_id, team: fx(r.team), pos: r.position === 'FB' ? 'RB' : r.position }));
} else ACTIVE = snapW;          // backtest: actually played
const byTeam = {};
for (const a of ACTIVE) { if (!SKILL.includes(a.pos)) continue; a.u = usage(a.g); (byTeam[a.team] || (byTeam[a.team] = [])).push(a); }
// ---------------------------------------------------------------- depth chart (ESPN daily snapshot, last day before gameday): RB slot
const DC = {};
if (Y >= 2025 && fs.existsSync(F.depth(Y))) {
  const rows = readCSV(F.depth(Y), ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank']).filter(r => r.pos_abb === 'RB');
  const byDayTeam = {}, days = new Set();
  for (const r of rows) { const d = r.dt.slice(0, 10), t = fx(r.team); days.add(d); ((byDayTeam[d + '|' + t]) || (byDayTeam[d + '|' + t] = [])).push(r); }
  const D = [...days].sort();
  for (const t in GM) {
    let k = D.filter(d => d < GM[t].day).length - 1, s = null;
    while (k >= 0 && !s) { s = byDayTeam[D[k] + '|' + t] || null; k--; }
    if (!s) continue;
    const seen = new Set(), oOf = {}; (byTeam[t] || []).forEach(a => { oOf[a.g] = a.u.csh + (a.pos === 'QB' ? 0 : a.u.tsh); });
    const L = s.filter(r => r.gsis_id && !seen.has(r.gsis_id) && seen.add(r.gsis_id))
      .map(r => ({ g: r.gsis_id, tier: Math.min(3, +r.pos_rank), o: oOf[r.gsis_id] || 0 }))
      .sort((a, b) => a.tier - b.tier || b.o - a.o);
    L.forEach((x, i) => { DC[x.g + '|' + t] = i + 1; });
  }
}
// ---------------------------------------------------------------- assemble the 22 inputs for every active RB
const M = JSON.parse(fs.readFileSync(A.model));
const out = [];
for (const t in byTeam) {
  const team = byTeam[t], gm = GM[t]; if (!gm) continue;   // bye
  const tg = TG[t] || { cc: 0, ct: 0, cd: 0, lc: 0, lt: 0, ld: 0 }, dg = DG[gm.opp] || { cc: 0, cy: 0, lc: 0, ly: 0 };
  const team_car_pg = blend(tg.cc, tg.cd, tg.lc, tg.ld, 3, 4, 26.0), team_tgt_pg = blend(tg.ct, tg.cd, tg.lt, tg.ld, 3, 4, 33.0);
  const opp_ypc = blend(dg.cy, dg.cc, dg.ly, dg.lc, 100, 150, 4.3);
  const tshOf = a => a.pos === 'QB' ? 0 : a.u.tsh;
  const actCsh = team.reduce((s, a) => s + a.u.csh, 0), actTsh = team.reduce((s, a) => s + tshOf(a), 0);
  const rbs = team.filter(a => a.pos === 'RB'), actCshRb = rbs.reduce((s, a) => s + a.u.csh, 0);
  const order = rbs.map(a => [a.u.csh + a.u.tsh, a.g]).sort((p, q) => q[0] - p[0] || (p[1] < q[1] ? -1 : p[1] > q[1] ? 1 : 0));
  const hurtCsh = rbs.reduce((s, a) => s + a.u.csh * hurtOf(a.g), 0);
  for (const a of rbs) {
    const u = a.u, j = INJ[a.g] || { st: 0, pr: 0, rest: 0 }, p = P[a.g] || {};
    const listed = (!j.rest && (j.st > 0 || j.pr > 0)) ? 1 : 0;
    const norm_car = (u.csh / actCsh) * team_car_pg, norm_tgt = (u.tsh / actTsh) * 0.92 * team_tgt_pg;
    const norm_pts = norm_car * u.rppc + norm_tgt * u.rppt;
    const c = CAR[a.g], s1 = SEA[a.g + '|' + (Y - 1)];
    const x = {
      norm_pts, itt_x_norm: gm.itt != null ? gm.itt * norm_pts / 22.5 : null, pos_sh_of_active: u.csh / actCshRb,
      snap_l1: u.snap_l1, snap_l3: u.snap_l3, sh_rank: order.findIndex(o => o[1] === a.g) + 1,
      car_ppg: c && c.g > 0 ? c.fp / c.g : null, itt_x_ppg: gm.itt != null ? gm.itt * u.ppg / 22.5 : null,
      norm_car_v: norm_car * (1 - 0.02 * (gm.spread ?? 0)), ypc: u.ypc, draft_pick_f: p.pick ?? 300,
      opp_adj_rush: norm_car * opp_ypc / 4.3, ppg_y1: s1 && s1.g > 0 ? s1.fp / s1.g : null, csh_l1: u.csh_l1,
      dc_rank: Math.min(5, DC[a.g + '|' + t] || 5), act_csh_rb: actCshRb, spread: gm.spread,
      inj_score: (j.st + j.pr) * (1 - j.rest), tm_hurt_csh: hurtCsh - u.csh * listed, g_cur: u.g_cur,
      age: p.birth ? Math.floor((Date.parse(gm.day) - Date.parse(p.birth)) / 864e5) / 365.25 : null, norm_tgt,
    };
    out.push({ gsis: a.g, team: t, x, pred: wrTreePredict(M, x) });
  }
}
if (A.out) fs.writeFileSync(A.out, JSON.stringify(out));
console.log(`season ${Y} week ${W}: ${out.length} RBs`);
