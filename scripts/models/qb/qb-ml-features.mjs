// Reference implementation (Node, no dependencies) of the 31 inputs of the DHQ stand-alone QB model "qb-ml compact"
// (component LightGBM: pass yd / pass TD / INT / rush yd / rush TD / fumbles / 2pt / receiving + sacks / first downs),
// computed only from free nflverse files, then scored with qb-ml-eval.js. No Sleeper input anywhere.
// Extends the QB project's qb-own/model/qb-features.mjs (same definitions for the shared inputs).
//
// node qb-ml-features.mjs --season=2026 --week=8 --model=qb-ml.json --active=snaps|roster [--rows=starters.csv] [--out=f.json]
//   MODEL_DATA = nflverse download folder (as scripts/build-wr-model-snapshot.mjs): stats_player_week_<yr>.csv for
//   season-7..season, snap_counts_<yr>.csv for season-1 and season, players.csv, games.csv (Vegas lines, roof, wind, temp,
//   posted starting QBs), injuries_<season>.csv, depth_charts_<season>.csv (ESPN daily format; only to replace a posted
//   starter who is Out/Doubtful or off the roster), roster_weekly_<season>.csv (only for --active=roster).
//   (DHQ QB stack component "qb-ml", QB project, qb2/qb-ml; model qb-ml.json = qb_ml_compact_<season>.json.)
//   --active=snaps  (backtest): active receivers = the ones who played; the starter is games.csv's QB.
//   --active=roster (live):     53-man roster (ACT/INA) minus Out/Doubtful; starter = games.csv's QB unless Out/Doubtful/off
//                               the roster, then the top active QB on the depth chart.
//   --rows=CSV season,week,gsis,team: the candidate starters of each team (one or more), as picked by qb-features.mjs.
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { qbMlPredict } = require('./qb-ml-eval.js');

const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const Y = +A.season, W = +A.week;
const MD = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
const first = (...ps) => ps.find(p => p && fs.existsSync(p));
const F = {
  stats: y => first(MD + `stats_player_week_${y}.csv`), snaps: y => first(MD + `snap_counts_${y}.csv`),
  players: MD + 'players.csv', games: MD + 'games.csv', injuries: y => first(MD + `injuries_${y}.csv`),
  depth: y => MD + `depth_charts_${y}.csv`, roster: y => MD + `roster_weekly_${y}.csv`,
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
const has = v => !(v === '' || v === undefined || v === 'NA');
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const nm = s => String(s).toLowerCase().replace(/[.']/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z]/g, '');
// season-to-date rate shrunk toward last season's rate (K units), last season shrunk toward lg (K2 units)
const blend = (cn, cd, ln, ld, K, K2, lg) => (cn + K * ((ln + K2 * lg) / (ld + K2))) / (cd + K);
const clip = (x, a, b) => Math.max(a, Math.min(b, x));
const SUM = (a, f) => a.reduce((s, x) => s + f(x), 0);

// ---------------------------------------------------------------- players
const P = {}, pfr2g = {};
for (const r of readCSV(F.players, ['gsis_id', 'display_name', 'position', 'pfr_id'])) {
  if (!r.gsis_id) continue;
  P[r.gsis_id] = { name: r.display_name, pos: r.position === 'FB' ? 'RB' : r.position };
  if (r.pfr_id) pfr2g[r.pfr_id] = r.gsis_id;
}
// ---------------------------------------------------------------- weekly stats (games before week W only)
const SC = ['receptions', 'receiving_yards', 'receiving_tds', 'rushing_yards', 'rushing_tds', 'receiving_fumbles_lost',
  'rushing_fumbles_lost', 'sack_fumbles_lost', 'receiving_2pt_conversions', 'rushing_2pt_conversions', 'passing_2pt_conversions',
  'passing_yards', 'passing_tds', 'passing_interceptions'];
const halfPPR = r => num(r.receptions) * .5 + num(r.receiving_yards) * .1 + num(r.receiving_tds) * 6 + num(r.rushing_yards) * .1 +
  num(r.rushing_tds) * 6 - 2 * (num(r.receiving_fumbles_lost) + num(r.rushing_fumbles_lost) + num(r.sack_fumbles_lost)) +
  2 * (num(r.receiving_2pt_conversions) + num(r.rushing_2pt_conversions) + num(r.passing_2pt_conversions)) +
  num(r.passing_yards) * .04 + num(r.passing_tds) * 4 - num(r.passing_interceptions);
const TW = {};        // team|y|w -> team totals (all players): targets, passing yards, TDs
const QROWS = [];     // QB rows, one per player-week
const TGT = {}, name2g = {}, name2gY = {};   // name|team|y|w -> gsis (games before W); name|team|y -> gsis (any week: ID lookup only)
for (let y = Y - 7; y <= Y; y++) {
  const f = F.stats(y); if (!f) continue;
  const seen = new Set();
  for (const r of readCSV(f, ['player_id', 'player_display_name', 'position', 'season', 'week', 'season_type', 'team', 'opponent_team',
    'attempts', 'carries', 'targets', 'sacks_suffered', ...SC])) {
    if (r.season_type !== 'REG' || !r.player_id) continue;
    const w = +r.week, t = fx(r.team);
    if (y === Y) name2gY[`${nm(r.player_display_name)}|${t}|${y}`] = r.player_id;   // identity only, no stats used
    if (y === Y && w >= W) continue;
    const k = `${t}|${y}|${w}`;
    if (y >= Y - 1) {
      const T = TW[k] || (TW[k] = { y, w, team: t, tgt: 0, pyd: 0, ptd: 0, rtd: 0 });
      T.tgt += num(r.targets); T.pyd += num(r.passing_yards); T.ptd += num(r.passing_tds); T.rtd += num(r.rushing_tds);
      TGT[`${r.player_id}|${y}|${w}`] = { tgt: num(r.targets) };
      name2g[`${nm(r.player_display_name)}|${t}|${y}|${w}`] = r.player_id;
    }
    if (r.position !== 'QB' || seen.has(r.player_id + '|' + w)) continue;
    seen.add(r.player_id + '|' + w);
    QROWS.push({ g: r.player_id, y, w, team: t, opp: fx(r.opponent_team), att: num(r.attempts), pyd: num(r.passing_yards),
      ptd: num(r.passing_tds), int: num(r.passing_interceptions), sk: num(r.sacks_suffered), car: num(r.carries), ryd: num(r.rushing_yards),
      rtd: num(r.rushing_tds), fp: halfPPR(r) });
  }
}
// main passer of each team-week: 15+ attempts, or the most attempts among the team's QBs (and > 0)
const maxAtt = {};
for (const q of QROWS) { const k = `${q.team}|${q.y}|${q.w}`; maxAtt[k] = Math.max(maxAtt[k] || 0, q.att); }
for (const q of QROWS) { q.qg = (q.att >= 15 || (q.att === maxAtt[`${q.team}|${q.y}|${q.w}`] && q.att > 0)) ? 1 : 0; q.db = q.att + q.sk; }
const QB_ = {}; for (const q of QROWS) (QB_[q.g] || (QB_[q.g] = [])).push(q);
const tmTD = x => { const T = TW[`${x.team}|${x.y}|${x.w}`]; return T ? T.ptd + T.rtd : 0; };
function qbUsage(g) {
  const L = QB_[g] || [];
  const cur = L.filter(x => x.y === Y), last = L.filter(x => x.y === Y - 1);
  const c = k => SUM(cur, x => x[k]), l = k => SUM(last, x => x[k]), cq = k => SUM(cur, x => x[k] * x.qg), lq = k => SUM(last, x => x[k] * x.qg);
  const car = L.filter(x => x.y < Y && x.y >= Y - 7), cg = SUM(car, x => x.qg), cf = SUM(car, x => x.fp * x.qg);
  return {
    att_pg: blend(cq('att'), c('qg'), lq('att'), l('qg'), 3, 4, 32.0),
    ypa: blend(c('pyd'), c('att'), l('pyd'), l('att'), 150, 250, 6.9),
    td_rate: blend(c('ptd'), c('att'), l('ptd'), l('att'), 200, 300, 0.043),
    int_rate: blend(c('int'), c('att'), l('int'), l('att'), 200, 300, 0.024),
    sack_rate: blend(c('sk'), c('db'), l('sk'), l('db'), 150, 250, 0.068),
    rush_pg: blend(cq('car'), c('qg'), lq('car'), l('qg'), 3, 4, 3.5),
    ryd_pg: blend(cq('ryd'), c('qg'), lq('ryd'), l('qg'), 3, 4, 15.0),
    rtd_pg: blend(cq('rtd'), c('qg'), lq('rtd'), l('qg'), 6, 8, 0.12),
    ppg: blend(cq('fp'), c('qg'), lq('fp'), l('qg'), 3, 4, 15.5),
    pypg: blend(cq('pyd'), c('qg'), lq('pyd'), l('qg'), 3, 4, 215.0),
    td_resp: blend(SUM(cur, x => x.qg * (x.ptd + x.rtd)), SUM(cur, x => x.qg * tmTD(x)), SUM(last, x => x.qg * (x.ptd + x.rtd)), SUM(last, x => x.qg * tmTD(x)), 15, 25, 0.75),
    car_ppg: cg > 0 ? cf / cg : null,
  };
}
function teamPyd(t) {   // team passing yards per game (all players), this season before W + last season
  let cn = 0, cd = 0, ln = 0, ld = 0;
  for (const k in TW) { const T = TW[k]; if (T.team !== t) continue; if (T.y === Y) { cn += T.pyd; cd++; } else if (T.y === Y - 1) { ln += T.pyd; ld++; } }
  return blend(cn, cd, ln, ld, 3, 4, 215.0);
}
// what QBs did against each defense: INTs per attempt and half-PPR points per game
const OPP = {}, OPPG = {};
for (const q of QROWS) {
  if (q.y < Y - 1) continue;
  const o = OPP[q.opp] || (OPP[q.opp] = { ci: 0, ca: 0, li: 0, la: 0, cf: 0, lf: 0 });
  if (q.y === Y) { o.ci += q.int; o.ca += q.att; o.cf += q.fp; } else { o.li += q.int; o.la += q.att; o.lf += q.fp; }
  OPPG[`${q.opp}|${q.y}|${q.w}`] = 1;
}
const oppGames = (t, y) => Object.keys(OPPG).filter(k => k.startsWith(t + '|' + y + '|')).length;
const oppInt = t => { const o = OPP[t] || { ci: 0, ca: 0, li: 0, la: 0 }; return blend(o.ci, o.ca, o.li, o.la, 200, 300, 0.024); };
const oppFpa = t => { const o = OPP[t] || { cf: 0, lf: 0 }; return blend(o.cf, oppGames(t, Y), o.lf, oppGames(t, Y - 1), 4, 6, 16.5); };

// ---------------------------------------------------------------- games: lines, roof, weather, posted starting QBs
const GALL = readCSV(F.games, ['season', 'game_type', 'week', 'gameday', 'home_team', 'away_team', 'spread_line', 'total_line', 'roof',
  'wind', 'temp', 'home_qb_id', 'away_qb_id']).filter(r => r.game_type === 'REG');
const roofOf = {};
for (const r of GALL) if (r.roof && r.roof !== 'NA' && (+r.season < Y || (+r.season === Y && +r.week <= W))) roofOf[fx(r.home_team)] = r.roof;
const GM = {}, START = {};
for (const r of GALL) {
  const y = +r.season, w = +r.week, h = fx(r.home_team), a = fx(r.away_team);
  if (y === Y || y === Y - 1) for (const [t, qb] of [[h, r.home_qb_id], [a, r.away_qb_id]]) if (has(qb)) (START[t + '|' + y] || (START[t + '|' + y] = [])).push({ w, qb });
  if (y !== Y || w !== W) continue;
  const tot = +r.total_line, spr = +r.spread_line, ok = has(r.total_line) && has(r.spread_line);
  const roof = (r.roof && r.roof !== 'NA') ? r.roof : roofOf[h];
  const dome = roof === 'dome' || roof === 'closed' ? 1 : 0;
  const wx = { dome, wind_f: dome ? 0 : (has(r.wind) ? +r.wind : null), temp_f: dome ? 70 : (has(r.temp) ? +r.temp : null) };
  GM[h] = { day: r.gameday, itt: ok ? (tot + spr) / 2 : null, spread: ok ? -spr : null, total: ok ? tot : null, home: 1, opp: a, ...wx, qb: has(r.home_qb_id) ? r.home_qb_id : null };
  GM[a] = { day: r.gameday, itt: ok ? (tot - spr) / 2 : null, spread: ok ? spr : null, total: ok ? tot : null, home: 0, opp: h, ...wx, qb: has(r.away_qb_id) ? r.away_qb_id : null };
}
for (const k in START) START[k].sort((p, q) => p.w - q.w);
function starterStatus(g, t) {
  const cur = START[t + '|' + Y] || [], last = START[t + '|' + (Y - 1)] || [];
  const wk1 = cur.length ? cur[0].qb : null;
  const cnt = {}, w0 = {};
  for (const s of last) { cnt[s.qb] = (cnt[s.qb] || 0) + 1; if (!(s.qb in w0)) w0[s.qb] = s.w; }
  const lyMain = Object.keys(cnt).sort((p, q) => cnt[q] - cnt[p] || w0[p] - w0[q])[0] || null;
  const stCur = cur.filter(s => s.w < W && s.qb === g).length, stLy = last.filter(s => s.qb === g).length;
  const is_wk1_qb = wk1 === g ? 1 : 0, is_ly_main = lyMain === g ? 1 : 0;
  return { is_wk1_qb, backup_start: (!is_wk1_qb && !is_ly_main && stCur + stLy < 4) ? 1 : 0 };
}

// ---------------------------------------------------------------- injury report for week W (last row per player wins)
const INJ = {};
const fInj = F.injuries(Y);
if (fInj) for (const r of readCSV(fInj, ['season', 'week', 'game_type', 'gsis_id', 'report_status', 'practice_status', 'report_primary_injury', 'practice_primary_injury'])) {
  if (+r.season !== Y || +r.week !== W || !r.gsis_id || (r.game_type && r.game_type !== 'REG')) continue;
  const st = { Questionable: 1, Doubtful: 2, Out: 3 }[r.report_status] || 0;
  const ps = r.practice_status.toLowerCase(), pr = ps.includes('did not') ? 2 : ps.includes('limited') ? 1 : 0;
  const rest = /not injury|resting/.test((r.report_primary_injury + ' ' + r.practice_primary_injury).toLowerCase()) ? 1 : 0;
  INJ[r.gsis_id] = { st, pr, rest };
}

// ---------------------------------------------------------------- receivers: games played (snaps) + target share
const G = {}, snapW = [];
for (const y of [Y - 1, Y]) {
  const f = F.snaps(y); if (!f) continue;
  const seen = new Set();
  for (const r of readCSV(f, ['season', 'game_type', 'week', 'player', 'pfr_player_id', 'position', 'team', 'offense_snaps', 'st_snaps'])) {
    if (r.game_type !== 'REG' || !(num(r.offense_snaps) > 0 || num(r.st_snaps) > 0)) continue;
    const w = +r.week, t = fx(r.team);
    const g = pfr2g[r.pfr_player_id] || name2g[`${nm(r.player)}|${t}|${y}|${w}`] || (y === Y && w === W ? name2gY[`${nm(r.player)}|${t}|${y}`] : undefined);
    if (!g || seen.has(g + '|' + w)) continue;
    seen.add(g + '|' + w);
    const pos = (P[g] && P[g].pos) || (r.position === 'FB' ? 'RB' : r.position);
    if (y === Y && w === W) { snapW.push({ g, team: t, pos }); continue; }
    if (y === Y && w > W) continue;
    const s = TGT[`${g}|${y}|${w}`] || { tgt: 0 }, T = TW[`${t}|${y}|${w}`];
    (G[g] || (G[g] = [])).push({ y, w, team: t, pos, tgt: s.tgt, tmt: T ? T.tgt : 0 });
  }
}
function share(g) {
  const L = G[g] || [], cur = L.filter(x => x.y === Y), last = L.filter(x => x.y === Y - 1);
  return blend(SUM(cur, x => x.tgt), SUM(cur, x => x.tmt), SUM(last, x => x.tgt), SUM(last, x => x.tmt), 60, 90, 0.06);
}
let ACTIVE, ROSTER = null;
if (A.active === 'roster') {
  const RO = readCSV(F.roster(Y), ['season', 'week', 'game_type', 'team', 'gsis_id', 'position', 'status']).filter(r => r.game_type === 'REG' && +r.season === Y && +r.week <= W);
  const rW = {}; for (const r of RO) rW[fx(r.team)] = Math.max(rW[fx(r.team)] || 0, +r.week);
  ROSTER = RO.filter(r => +r.week === rW[fx(r.team)] && (r.status === 'ACT' || r.status === 'INA') && r.gsis_id && !((INJ[r.gsis_id] || {}).st >= 2));
  ACTIVE = ROSTER.filter(r => ['WR', 'TE', 'RB', 'FB'].includes(r.position)).map(r => ({ g: r.gsis_id, team: fx(r.team), pos: r.position === 'FB' ? 'RB' : r.position }));
} else ACTIVE = snapW;
// wpn_hurt: target share of active WR/TE/RB on the injury report (questionable+ or limited/DNP, not rest days)
const hurt = {};
for (const a of ACTIVE) {
  if (!['WR', 'TE', 'RB'].includes(a.pos)) continue;
  hurt[a.team] = hurt[a.team] || 0;
  const j = INJ[a.g]; const h = j && !j.rest && (j.st > 0 || j.pr >= 1) ? 1 : 0;
  hurt[a.team] = (hurt[a.team] || 0) + share(a.g) * h;
}
// wpn_lost: this season's main receivers (target share >= 8% in the games they played, last team = this team) not active now
const activeSet = new Set(ACTIVE.map(a => a.g));
const lost = {};
if (W > 1) {
  const agg = {};
  for (const g in G) for (const x of G[g]) {
    if (x.y !== Y || x.w >= W || !['WR', 'TE', 'RB'].includes(x.pos)) continue;
    const a = agg[g] || (agg[g] = { tgt: 0, tmt: 0, w: -1, team: null });
    a.tgt += x.tgt; a.tmt += x.tmt; if (x.w > a.w) { a.w = x.w; a.team = x.team; }
  }
  for (const g in agg) {
    const a = agg[g], sh = a.tmt > 0 ? a.tgt / a.tmt : NaN;
    if (!(sh >= 0.08) || activeSet.has(g)) continue;
    lost[a.team] = (lost[a.team] || 0) + sh;
  }
}

// ---------------------------------------------------------------- the starter
function depthQB(t) {
  if (!fs.existsSync(F.depth(Y))) return [];
  const rows = readCSV(F.depth(Y), ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank']).filter(r => r.pos_abb === 'QB' && fx(r.team) === t && r.dt.slice(0, 10) < GM[t].day);
  if (!rows.length) return [];
  const d = rows.map(r => r.dt.slice(0, 10)).sort().pop();
  return rows.filter(r => r.dt.slice(0, 10) === d).sort((p, q) => +p.pos_rank - +q.pos_rank).map(r => r.gsis_id);
}
const onRoster = g => !ROSTER || ROSTER.some(r => r.gsis_id === g && r.position === 'QB');
const ROWS = A.rows ? {} : null;   // team -> [gsis, ...] (several candidates per team allowed)
if (A.rows) for (const r of readCSV(A.rows, ['season', 'week', 'gsis', 'team'])) if (+r.season === Y && +r.week === W && r.gsis) (ROWS[fx(r.team)] || (ROWS[fx(r.team)] = [])).push(r.gsis);
function startersFor(t) { if (ROWS) return (ROWS[t] || []).map(g => ({ g, src: 'rows' })); const s = starterFor(t); return s ? [s] : []; }
function starterFor(t) {
  const gm = GM[t], ok = g => g && !((INJ[g] || {}).st >= 2) && onRoster(g);
  if (A.active !== 'roster') return gm.qb ? { g: gm.qb, src: 'games.csv' } : null;
  if (ok(gm.qb)) return { g: gm.qb, src: 'games.csv' };
  const d = depthQB(t).find(ok);
  return d ? { g: d, src: 'depth chart' } : null;
}

// ---------------------------------------------------------------- assemble the 31 inputs for every team's starter and score
const M = JSON.parse(fs.readFileSync(A.model));
const out = [];
for (const t in GM) for (const s of startersFor(t)) {   // each candidate of the team
  const gm = GM[t]; if (gm.itt == null) continue;
  const u = qbUsage(s.g), st = starterStatus(s.g, t);
  const vtd = clip(0.045 * (1 + 0.06 * clip(gm.itt - 22.5, -10, 10)), 0.01, 0.09);
  const x = {
    itt: gm.itt, spread: gm.spread, total: gm.total, home: gm.home, dome: gm.dome, wind_f: gm.wind_f, temp_f: gm.temp_f,
    att_pg: u.att_pg, ypa: u.ypa, td_rate: u.td_rate, int_rate: u.int_rate, sack_rate: u.sack_rate, rush_pg: u.rush_pg,
    ryd_pg: u.ryd_pg, rtd_pg: u.rtd_pg, ppg: u.ppg, pypg: u.pypg, td_resp: u.td_resp, car_ppg: u.car_ppg,
    exp_td: gm.itt / 7.0 * u.td_resp, itt_x_ppg: gm.itt * u.ppg / 22.5,
    line_pts_v: u.att_pg * (u.ypa * .04 + vtd * 4 - u.int_rate) + u.ryd_pg * .1 + u.rtd_pg * 6 * gm.itt / 22.5,
    wpn_hurt: t in hurt ? hurt[t] : null /* null = no active receiver known (as in training) */, wpn_lost: lost[t] || 0, backup_start: st.backup_start, is_wk1_qb: st.is_wk1_qb,
    inj_status: (INJ[s.g] || {}).st || 0, team_pyd_pg: teamPyd(t), opp_int_rate: oppInt(gm.opp), opp_qb_fpa: oppFpa(gm.opp), week: W,
  };
  const o = qbMlPredict(M, x);
  out.push({ gsis: s.g, name: (P[s.g] || {}).name, team: t, opp: gm.opp, src: s.src, x, pred: o.pred, pred_mean: o.pred_mean, ...o.stat });
}
if (A.out) fs.writeFileSync(A.out, JSON.stringify(out));
console.log(`season ${Y} week ${W}: ${out.length} starting QBs`);
