// Reference implementation (Node, no dependencies) of the DHQ stand-alone QB COMPONENT model ("qb-stat", LITE inputs):
// a chain of GLMs for each piece of the stat line (pass attempts -> sacks -> pass yards -> pass TDs -> INTs -> rush attempts
// -> rush yards -> rush TDs -> fumbles -> 2-pt -> first downs), then a joint simulation (Gaussian copula over pass yards,
// pass TDs, INTs, rush yards, rush TDs, fumbles; 4000 stored draws) whose calibrated median is the shown number.
// No Sleeper input anywhere. Everything comes from the weekly job's nflverse download folder - no play-by-play needed.
//
// node qb-stat-features.mjs --season=2026 --week=8 --model=qb-stat.json --active=snaps|roster [--rows=starters.csv] [--out=f.json]
//   env MODEL_DATA = download folder with stats_player_week_<yr>.csv (2013..season; --from=<year> to read older years),
//   games.csv (Vegas lines, roof, wind/temp, posted starting QBs home_qb_id/away_qb_id), players.csv (birth_date),
//   injuries_<season>.csv, depth_charts_<season>.csv (ESPN daily format; live only) and roster_weekly_<season>.csv (live only).
//   --active=snaps  (backtest): the starter is games.csv's posted QB.
//   --active=roster (live):     games.csv's QB unless he is Out/Doubtful or off the active roster, then the top active QB
//                               on the depth chart.
//   --rows=CSV season,week,gsis,team: the starter of each team, as picked by scripts/models/qb/qb-features.mjs.
//   (DHQ QB stack component "qb-stat", QB project, qb2/qb-stat; model qb-stat.json = qbstat_<season>.json.)
//   --score='{"pyd":0.04,"ptd":6,...}' re-scores the simulated games for another league (sacks/first downs: use E_* columns).
import fs from 'fs';

const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const Y = +A.season, W = +A.week;
const D = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
const F = {
  stats: y => D + `stats_player_week_${y}.csv`, players: D + 'players.csv', games: D + 'games.csv',
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
const has = v => !(v === '' || v === undefined || v === 'NA');
const num = v => has(v) && isFinite(+v) ? +v : 0;
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const clip = (x, a, b) => Math.max(a, Math.min(b, x));
const LN = x => Math.log(Math.max(x, 1e-6));

// ---------------------------------------------------------------- constants (mirror build_lite.py / model.py)
const QL = .985, QM = .80, RL = .85, RM = .60, TL = .90, TM = .45;
const LGC = { ypa: 7.0, cmp: .635, tdr: .043, intr: .024, skr: .065, att_g: 33.0, fumr: .0055, pfdr: .34, rfdr: .32, ypc: 4.2 };
const TLG = { play: 63.5, db: 37.5, td: 2.45, pts: 22.5, ypa: 6.95, skr: .065, intr: .024, ptdr: .043, epa: 0.0, ptdsh: .62, pfdr: .34, prate: .59 };

// ---------------------------------------------------------------- players
const P = {};
for (const r of readCSV(F.players, ['gsis_id', 'display_name', 'birth_date'])) if (r.gsis_id) P[r.gsis_id] = { name: r.display_name, birth: r.birth_date };

// ---------------------------------------------------------------- weekly stats strictly before week W of season Y
const NUMC = ['completions', 'attempts', 'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered', 'sack_fumbles_lost',
  'passing_first_downs', 'passing_2pt_conversions', 'carries', 'rushing_yards', 'rushing_tds', 'rushing_fumbles_lost',
  'rushing_first_downs', 'rushing_2pt_conversions', 'receiving_fumbles_lost', 'receiving_yards', 'receiving_tds', 'receptions',
  'passing_epa', 'receiving_2pt_conversions'];
const TT = {};            // team|y|w -> team totals over all players (+ first opponent seen)
const QROWS = [], seenQ = new Set();
for (let y = +(A.from || 2013); y <= Y; y++) {   // history from 2013, as the model's Node parity check
  if (!fs.existsSync(F.stats(y))) continue;
  for (const r of readCSV(F.stats(y), ['player_id', 'position', 'season', 'week', 'season_type', 'team', 'opponent_team', ...NUMC])) {
    if (r.season_type !== 'REG') continue;
    const w = +r.week; if (y === Y && w >= W) continue;
    const t = fx(r.team), k = `${t}|${y}|${w}`, x = {}; for (const c of NUMC) x[c] = num(r[c]);
    const T = TT[k] || (TT[k] = { team: t, y, w, opp: fx(r.opponent_team), att: 0, pyd: 0, int: 0, sk: 0, car: 0, ptd: 0, rtd: 0, pfd: 0, epa: 0 });
    T.att += x.attempts; T.pyd += x.passing_yards; T.int += x.passing_interceptions; T.sk += x.sacks_suffered; T.car += x.carries;
    T.ptd += x.passing_tds; T.rtd += x.rushing_tds; T.pfd += x.passing_first_downs; T.epa += x.passing_epa;
    if (r.position !== 'QB' || !r.player_id) continue;
    const qk = `${r.player_id}|${y}|${w}`; if (seenQ.has(qk)) continue; seenQ.add(qk);
    const fum = x.sack_fumbles_lost + x.rushing_fumbles_lost + x.receiving_fumbles_lost;
    const two = x.passing_2pt_conversions + x.rushing_2pt_conversions + x.receiving_2pt_conversions;
    const fp = x.passing_yards * .04 + x.passing_tds * 4 - x.passing_interceptions + x.rushing_yards * .1 + x.rushing_tds * 6 - 2 * fum + 2 * two +
      x.receiving_yards * .1 + x.receiving_tds * 6 + x.receptions * .5;
    QROWS.push({ g: r.player_id, y, w, team: t, opp: fx(r.opponent_team), ...x, fum, two, fp, dbk: x.attempts + x.sacks_suffered });
  }
}
for (const k in TT) { const T = TT[k]; T.db = T.att + T.sk; T.play = T.db + T.car; T.td = T.ptd + T.rtd; T.g = 1; }
const maxAtt = {};
for (const q of QROWS) { const k = `${q.team}|${q.y}|${q.w}`; maxAtt[k] = Math.max(maxAtt[k] ?? -1, q.attempts); }
const QB_ = {};
for (const q of QROWS) {
  q.qg = (q.attempts >= 15 || (q.attempts === maxAtt[`${q.team}|${q.y}|${q.w}`] && q.attempts > 0)) ? 1 : 0;
  const T = TT[`${q.team}|${q.y}|${q.w}`] || { db: 0, td: 0 };
  q.g1 = 1; q.attempts_g = q.attempts * q.qg; q.dbk_g = q.dbk * q.qg; q.carries_g = q.carries * q.qg; q.rushing_yards_g = q.rushing_yards * q.qg;
  q.rushing_tds_g = q.rushing_tds * q.qg; q.fp_g = q.fp * q.qg; q.tdq = (q.passing_tds + q.rushing_tds) * q.qg; q.ttd_q = T.td * q.qg;
  q.dbk_q = q.dbk * q.qg; q.tdb_q = T.db * q.qg;
  (QB_[q.g] || (QB_[q.g] = [])).push(q);
}
const byYW = (a, b) => a.y - b.y || a.w - b.w;
for (const g in QB_) QB_[g].sort(byYW);
// decayed sums: weight of a past game = lam^(games since, counting itself) * mu^(seasons since)
function ew(rows, cols, lam, mu) {
  const o = Object.fromEntries(cols.map(c => [c, 0])), N = rows.length;
  rows.forEach((r, i) => { const wt = Math.pow(lam, N - i) * Math.pow(mu, Y - r.y); for (const c of cols) o[c] += r[c] * wt; });
  return o;
}
const QC = ['attempts', 'completions', 'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered', 'dbk', 'carries', 'rushing_yards',
  'rushing_tds', 'fum', 'passing_first_downs', 'rushing_first_downs', 'passing_epa', 'two', 'g1', 'qg', 'attempts_g', 'dbk_g', 'carries_g',
  'rushing_yards_g', 'rushing_tds_g', 'fp_g', 'tdq', 'ttd_q', 'dbk_q', 'tdb_q'];
function qbFeatures(g) {
  const L = QB_[g] || [], m = ew(L, QC, QL, QM), f = {};
  const sh = (n, d, K, lg) => (m[n] + K * lg) / (m[d] + K);
  f.q_n = m.qg;
  f.q_ypa = sh('passing_yards', 'attempts', 150, LGC.ypa * .93); f.q_cmp = sh('completions', 'attempts', 150, LGC.cmp * .97);
  f.q_tdr = sh('passing_tds', 'attempts', 300, LGC.tdr * .85); f.q_intr = sh('passing_interceptions', 'attempts', 400, LGC.intr * 1.1);
  f.q_skr = sh('sacks_suffered', 'dbk', 200, LGC.skr * 1.1); f.q_epa = sh('passing_epa', 'dbk', 250, -0.05);
  f.q_fumr = (m.fum + 400 * LGC.fumr) / (m.dbk + m.carries + 400);
  f.q_pfdr = sh('passing_first_downs', 'attempts', 200, LGC.pfdr * .95); f.q_rfdr = sh('rushing_first_downs', 'carries', 40, LGC.rfdr);
  f.q_ypc = sh('rushing_yards', 'carries', 40, LGC.ypc); f.q_att_g = sh('attempts_g', 'qg', 3, LGC.att_g);
  f.q_car_g = sh('carries_g', 'qg', 3, 3.5); f.q_ryd_g = sh('rushing_yards_g', 'qg', 3, 13.0); f.q_rtd_g = sh('rushing_tds_g', 'qg', 8, 0.12);
  f.q_fp_g = sh('fp_g', 'qg', 3, 14.0); f.q_td_resp = sh('tdq', 'ttd_q', 15, 0.72); f.q_db_sh = sh('dbk_q', 'tdb_q', 60, 0.95);
  f.q_two_g = sh('two', 'g1', 10, 0.05);
  const r = ew(L, QC, RL, RM);
  f.r_n = r.qg;
  f.r_att_g = (r.attempts_g + 2 * f.q_att_g) / (r.qg + 2); f.r_ypa = (r.passing_yards + 60 * f.q_ypa) / (r.attempts + 60);
  f.r_epa = (r.passing_epa + 80 * f.q_epa) / (r.dbk + 80); f.r_car_g = (r.carries_g + 2 * f.q_car_g) / (r.qg + 2);
  f.r_ryd_g = (r.rushing_yards_g + 2 * f.q_ryd_g) / (r.qg + 2);
  return f;
}
// opposing defence: what offences did against it (team totals keyed by opponent), and QB rushing / fantasy allowed
const DEF = {}, DQB = {};
for (const k in TT) { const T = TT[k]; (DEF[T.opp] || (DEF[T.opp] = [])).push(T); }
for (const q of QROWS) {
  if (!q.qg) continue;
  const k = `${q.opp}|${q.y}|${q.w}`, o = DQB[k] || (DQB[k] = { opp: q.opp, y: q.y, w: q.w, ryd: 0, car: 0, fp: 0, g: 0 });
  o.ryd += q.rushing_yards; o.car += q.carries; o.fp += q.fp; o.g += 1;
}
const DQ = {}; for (const k in DQB) (DQ[DQB[k].opp] || (DQ[DQB[k].opp] = [])).push(DQB[k]);
for (const t in DEF) DEF[t].sort(byYW);
for (const t in DQ) DQ[t].sort(byYW);
function defFeatures(t) {
  const m = ew(DEF[t] || [], ['play', 'db', 'att', 'pyd', 'int', 'sk', 'ptd', 'td', 'pfd', 'epa', 'g'], TL, TM), f = {};
  const rt = (n, d, Kd, lg) => (m[n] + Kd * lg) / (m[d] + Kd);
  f.d_db_g = (m.db + 4 * TLG.db) / (m.g + 4); f.d_prate = rt('db', 'play', 300, TLG.prate); f.d_ypa = rt('pyd', 'att', 150, TLG.ypa);
  f.d_skr = rt('sk', 'db', 200, TLG.skr); f.d_intr = rt('int', 'att', 300, TLG.intr); f.d_ptdr = rt('ptd', 'att', 300, TLG.ptdr);
  f.d_epa = rt('epa', 'db', 200, TLG.epa); f.d_ptd_sh = rt('ptd', 'td', 12, TLG.ptdsh); f.d_pfdr = rt('pfd', 'att', 200, TLG.pfdr);
  const q = ew(DQ[t] || [], ['ryd', 'car', 'fp', 'g'], TL, TM);
  f.d_qb_ryd = (q.ryd + 5 * 14.0) / (q.g + 5);
  return f;
}

// ---------------------------------------------------------------- games: lines, roof, weather, posted starters, career starts
const GALL = readCSV(F.games, ['season', 'game_type', 'week', 'gameday', 'home_team', 'away_team', 'spread_line', 'total_line', 'roof', 'wind',
  'temp', 'home_qb_id', 'away_qb_id']).filter(r => r.game_type === 'REG');
const GM = {}, START = {}, CAREER = {};
for (const r of GALL) {
  const y = +r.season, w = +r.week, h = fx(r.home_team), a = fx(r.away_team);
  for (const [t, qb] of [[h, r.home_qb_id], [a, r.away_qb_id]]) {
    if (!has(qb)) continue;
    if (y < Y || (y === Y && w < W)) CAREER[qb] = (CAREER[qb] || 0) + 1;          // games.csv starts before this game
    if (y === Y || y === Y - 1) (START[t + '|' + y] || (START[t + '|' + y] = [])).push({ w, qb });
  }
  if (y !== Y || w !== W) continue;
  const tot = +r.total_line, spr = +r.spread_line, ok = has(r.total_line) && has(r.spread_line);
  const dome = r.roof === 'dome' || r.roof === 'closed' ? 1 : 0;
  const wx = { dome, wind_f: dome ? 0 : (has(r.wind) ? +r.wind : 8), temp_f: dome ? 70 : (has(r.temp) ? +r.temp : 60) };
  GM[h] = { day: r.gameday, itt: ok ? (tot + spr) / 2 : null, spread: ok ? -spr : null, total: ok ? tot : null, home: 1, opp: a, ...wx, qb: has(r.home_qb_id) ? r.home_qb_id : null };
  GM[a] = { day: r.gameday, itt: ok ? (tot - spr) / 2 : null, spread: ok ? spr : null, total: ok ? tot : null, home: 0, opp: h, ...wx, qb: has(r.away_qb_id) ? r.away_qb_id : null };
}
for (const k in START) START[k].sort((p, q) => p.w - q.w);
function backupStart(g, t) {
  const cur = START[t + '|' + Y] || [], last = START[t + '|' + (Y - 1)] || [];
  const wk1 = cur.length ? cur[0].qb : null;
  const cnt = {}, w0 = {};
  for (const s of last) { cnt[s.qb] = (cnt[s.qb] || 0) + 1; if (!(s.qb in w0)) w0[s.qb] = s.w; }
  const lyMain = Object.keys(cnt).sort((p, q) => cnt[q] - cnt[p] || w0[p] - w0[q])[0] || null;
  const stCur = cur.filter(s => s.w < W && s.qb === g).length, stLy = last.filter(s => s.qb === g).length;
  return (wk1 !== g && lyMain !== g && stCur + stLy < 4) ? 1 : 0;
}

// ---------------------------------------------------------------- injury report for week W (last row per player wins)
const INJ = {};
if (fs.existsSync(F.injuries(Y))) for (const r of readCSV(F.injuries(Y), ['season', 'week', 'gsis_id', 'report_status', 'practice_status', 'report_primary_injury', 'practice_primary_injury'])) {
  if (+r.season !== Y || +r.week !== W || !r.gsis_id) continue;
  const st = { Questionable: 1, Doubtful: 2, Out: 3 }[r.report_status] || 0;
  const ps = r.practice_status.toLowerCase(), pr = ps.includes('did not') ? 2 : ps.includes('limited') ? 1 : 0;
  const rest = /not injury|resting/.test((r.report_primary_injury + ' ' + r.practice_primary_injury).toLowerCase()) ? 1 : 0;
  INJ[r.gsis_id] = { st, pr, rest };
}

// ---------------------------------------------------------------- the starter
let ROSTER = null;
if (A.active === 'roster') {   // each team's latest posted weekly roster (ACT/INA) at or before W, minus Out/Doubtful
  const RO = readCSV(F.roster(Y), ['season', 'week', 'game_type', 'team', 'gsis_id', 'position', 'status']).filter(r => r.game_type === 'REG' && +r.season === Y && +r.week <= W);
  const rW = {}; for (const r of RO) rW[fx(r.team)] = Math.max(rW[fx(r.team)] || 0, +r.week);
  ROSTER = RO.filter(r => +r.week === rW[fx(r.team)] && (r.status === 'ACT' || r.status === 'INA') && r.gsis_id && !((INJ[r.gsis_id] || {}).st >= 2));
}
function depthQB(t) {   // ESPN: last snapshot strictly before gameday, QBs by rank
  if (!fs.existsSync(F.depth(Y))) return [];
  const rows = readCSV(F.depth(Y), ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank']).filter(r => r.pos_abb === 'QB' && fx(r.team) === t && r.dt.slice(0, 10) < GM[t].day);
  if (!rows.length) return [];
  const d = rows.map(r => r.dt.slice(0, 10)).sort().pop();
  return rows.filter(r => r.dt.slice(0, 10) === d).sort((p, q) => +p.pos_rank - +q.pos_rank).map(r => r.gsis_id);
}
const onRoster = g => !ROSTER || ROSTER.some(r => r.gsis_id === g && r.position === 'QB');
const ROWS = A.rows ? Object.fromEntries(readCSV(A.rows, ['season', 'week', 'gsis', 'team']).filter(r => +r.season === Y && +r.week === W).map(r => [fx(r.team), r.gsis])) : null;
function starterFor(t) {
  if (ROWS) return ROWS[t] ? { g: ROWS[t], src: 'rows' } : null;
  const gm = GM[t], ok = g => g && !((INJ[g] || {}).st >= 2) && onRoster(g);
  if (A.active !== 'roster') return gm.qb ? { g: gm.qb, src: 'games.csv' } : null;
  if (ok(gm.qb)) return { g: gm.qb, src: 'games.csv' };
  const d = depthQB(t).find(ok);
  return d ? { g: d, src: 'depth chart' } : null;
}

// ---------------------------------------------------------------- design (mirror of model.design_lite)
function design(d, E) {
  const X = {};
  X.spread = clip(d.spread, -17, 17) / 7; X.ln_itt = LN(clip(d.itt, 10, 35) / 22); X.ln_total = LN(clip(d.total, 30, 60) / 45);
  X.home = d.home; X.dome = d.dome; X.wind = (clip(d.wind_f, 0, 30) - 8) / 10; X.cold = clip(50 - d.temp_f, 0, 40) / 20;
  X.inj_q = d.inj_status === 1 ? 1 : 0; X.inj_prac = d.inj_prac * (1 - d.inj_rest); X.first_start = d.first_start; X.backup = d.backup_start;
  X.ln_n = Math.log1p(d.q_n); X.ln_rn = Math.log1p(d.r_n); X.age = clip(((d.age ?? 27) - 28) / 5, -2, 3);
  X.ln_q_att = LN(d.q_att_g / 33); X.ln_r_att = LN(d.r_att_g / 33); X.ln_d_db = LN(d.d_db_g / 38); X.ln_d_prate = LN(d.d_prate / .59);
  X.ln_q_dbsh = LN(d.q_db_sh); X.ln_q_skr = LN(d.q_skr / .065); X.ln_d_skr = LN(d.d_skr / .065);
  X.ln_q_ypa = LN(d.q_ypa / 7); X.ln_r_ypa = LN(d.r_ypa / 7); X.q_cmp = (d.q_cmp - .63) * 10;
  X.q_epa = d.q_epa * 5; X.r_epa = d.r_epa * 5; X.d_epa = d.d_epa * 5; X.ln_d_ypa = LN(d.d_ypa / 7);
  X.ln_q_tdr = LN(d.q_tdr / .043); X.ln_d_ptdr = LN(d.d_ptdr / .043); X.ln_d_ptdsh = LN(d.d_ptd_sh / .64); X.ln_q_tdresp = LN(d.q_td_resp / .7);
  X.ln_q_intr = LN(d.q_intr / .024); X.ln_d_intr = LN(d.d_intr / .024);
  X.ln_q_car = LN(d.q_car_g / 3.5); X.ln_r_car = LN(Math.max(d.r_car_g, .3) / 3.5); X.ln_d_qbryd = LN(d.d_qb_ryd / 14.7);
  X.q_ryd = d.q_ryd_g; X.r_ryd = d.r_ryd_g; X.car_ypc = d.q_car_g * d.q_ypc; X.qbryd_x = d.q_ryd_g * (d.d_qb_ryd / 14.7 - 1);
  X.kn_fav = clip(-d.spread, 0, 14) / 7; X.inj_any = ((d.inj_status >= 1 || d.inj_prac >= 1) ? 1 : 0) * d.q_ryd_g; X.first_start_ryd = d.first_start;
  X.ln_q_rtd = LN(d.q_rtd_g / .15); X.ln_q_fumr = LN(d.q_fumr / .0054); X.ln_q_two = LN(d.q_two_g / .065);
  X.ln_q_pfdr = LN(d.q_pfdr / .34); X.ln_d_pfdr = LN(d.d_pfdr / .34); X.ln_q_rfdr = LN(d.q_rfdr / .32); X.ln_q_ypc = LN(Math.max(d.q_ypc, 1) / 4.2);
  for (const k in E) X['ln_E_' + k] = LN(k === 'ryd' ? Math.max(E[k], 1) : Math.max(E[k], .05));
  if ('att' in E && 'sack' in E && 'car' in E) X.ln_touch = LN(E.att + E.sack + E.car);
  return X;
}

// ---------------------------------------------------------------- model: GLM chain + joint simulation
const M = JSON.parse(fs.readFileSync(A.model));
const SCORE = { ...M.scoring_half_ppr, ...(A.score ? JSON.parse(A.score) : {}) };
const NQ = M.qgrid[2], QG = Array.from({ length: NQ }, (_, i) => M.qgrid[0] + i * (M.qgrid[1] - M.qgrid[0]) / (NQ - 1));
function interp(tab, u) {               // numpy.interp on the quantile grid
  if (u <= QG[0]) return tab[0]; if (u >= QG[NQ - 1]) return tab[NQ - 1];
  let lo = 0, hi = NQ - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (QG[m] <= u) lo = m; else hi = m; }
  return tab[lo] + (u - QG[lo]) * (tab[hi] - tab[lo]) / (QG[hi] - QG[lo]);
}
function nbCdf(mu, a, K = 16) {         // NB2 (Var = mu + a mu^2), Poisson when a ~ 0: cdf at 0..K-1
  const out = []; let p, s = 0;
  if (a < 1e-6) { p = Math.exp(-mu); for (let k = 0; k < K; k++) { s += p; out.push(s); p *= mu / (k + 1); } }
  else { const n = 1 / a, q = n / (n + mu); p = Math.pow(q, n); for (let k = 0; k < K; k++) { s += p; out.push(s); p *= (k + n) / (k + 1) * (1 - q); } }
  return out;
}
const quant = (s, t) => { const pos = t * (s.length - 1), lo = Math.floor(pos); return lo + 1 < s.length ? s[lo] + (pos - lo) * (s[lo + 1] - s[lo]) : s[lo]; };
function predict(d) {
  const E = {};
  for (const k of M.order) {
    const m = M.models[k], X = design(d, E);
    let eta = m.coef[0]; m.cols.forEach((c, j) => { eta += m.coef[j + 1] * X[c]; });
    E[k] = m.fam === 'gauss' ? eta : Math.exp(clip(eta, -20, 8));
  }
  const j = Object.fromEntries(M.sims.map((k, i) => [k, i]));
  const ryd_s = M.marg.ryd.sc[0] * clip(E.ryd, 0, 80) + M.marg.ryd.sc[1];
  const cdf = {}; for (const k of ['ptd', 'int', 'rtd', 'fum']) cdf[k] = nbCdf(Math.max(E[k], 1e-4), M.marg[k].a);
  const cnt = (k, u) => { let c = 0; for (const v of cdf[k]) if (u > v) c++; return c; };
  const pts = M.U.map(u => {
    const pyd = Math.max(E.pyd, 1) * interp(M.marg.pyd.q, u[j.pyd]);
    const ryd = E.ryd + ryd_s * interp(M.marg.ryd.q, u[j.ryd]);
    return SCORE.pyd * pyd + SCORE.ptd * cnt('ptd', u[j.ptd]) + SCORE.int * cnt('int', u[j.int]) + SCORE.ryd * ryd + SCORE.rtd * cnt('rtd', u[j.rtd]) +
      SCORE.fum * cnt('fum', u[j.fum]) + SCORE.two * E.two;
  });
  const s = [...pts].sort((a, b) => a - b);
  return { E, pred: quant(s, M.tau), pred_mean: pts.reduce((a, b) => a + b, 0) / pts.length, p10: quant(s, .1), p90: quant(s, .9) };
}

// ---------------------------------------------------------------- every team's starter this week
const out = [];
for (const t in GM) {
  const gm = GM[t], s = starterFor(t); if (!s || gm.itt == null) continue;
  const j = INJ[s.g] || { st: 0, pr: 0, rest: 0 }, p = P[s.g] || {};
  const age = has(p.birth) ? Math.round((Date.parse(gm.day) - Date.parse(p.birth)) / 864e5) / 365.25 : null;
  const d = { ...gm, ...qbFeatures(s.g), ...defFeatures(gm.opp), inj_status: j.st, inj_prac: j.pr, inj_rest: j.rest,
    first_start: (CAREER[s.g] || 0) === 0 ? 1 : 0, backup_start: backupStart(s.g, t), age };
  const r = predict(d), E = r.E, rd = v => Math.round(v * 1000) / 1000;
  out.push({ gsis: s.g, name: p.name, team: t, opp: gm.opp, src: s.src, x: design(d, {}),
    pred: rd(r.pred), pred_mean: rd(r.pred_mean), p10: rd(r.p10), p90: rd(r.p90),
    E_pass_att: rd(E.att), E_pass_yd: rd(E.pyd), E_pass_td: rd(E.ptd), E_int: rd(E.int), E_sack: rd(E.sack), E_rush_att: rd(E.car),
    E_rush_yd: rd(E.ryd), E_rush_td: rd(E.rtd), E_fum: rd(E.fum), E_2pt: rd(E.two), E_pass_fd: rd(E.pfd), E_rush_fd: rd(E.rfd), raw: r });
}
if (A.out) fs.writeFileSync(A.out, JSON.stringify(out));
console.log(`season ${Y} week ${W}: ${out.length} starting QBs`);
