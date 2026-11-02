// DHQ stand-alone QB model, TOP-DOWN form (no Sleeper input, no play-by-play): Vegas implied total -> team expected
// offensive TDs (pass / rush split) and pass yards / dropbacks -> the QB's responsibility share -> expected stat line ->
// half-PPR mean and typical-game median. Reference implementation (Node, no dependencies) of features_ship.py + lib.py.
//
// node qb-team-features.mjs --season=2026 --week=8 --model=qb-team.json [--rows=starters.csv] [--out=f.json]
//   files (MODEL_DATA folder, nflverse names): stats_player_week_<yr>.csv for season-3..season, games.csv,
//   injuries_<season>.csv, depth_charts_<season>.csv (ESPN daily format; only read when games.csv has no starter id).
//   --rows: CSV season,week,gsis,team = the starter of each team (scripts/models/qb/qb-features.mjs picks them);
//   without it, games.csv's posted starter (or the depth chart's QB1).
// (DHQ QB stack component "qb-team", QB project, qb2/qb-team; model qb-team.json = qb_team_ship_<season>.json.)
import fs from 'fs';

const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const Y = +A.season, W = +A.week;
const D = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
const MODEL = JSON.parse(fs.readFileSync(A.model, 'utf8'));

function readCSV(path, keep) {
  const s = fs.readFileSync(path, 'utf8'); const rows = []; let field = '', row = [], q = false, hdr = null, idx = null;
  const push = () => {
    if (!hdr) { hdr = row; idx = keep.map(k => hdr.indexOf(k)); }
    else if (row.length > 1) { const o = {}; keep.forEach((k, j) => { o[k] = idx[j] >= 0 ? row[idx[j]] : ''; }); rows.push(o); }
    row = [];
  };
  for (let i = 0; i < s.length; i++) {
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
const isNA = v => v === '' || v === undefined || v === 'NA';
const num = v => isNA(v) ? 0 : +v;
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const bl = (cn, cd, ln, ld, K, K2, lg) => (cn + K * ((ln + K2 * lg) / (ld + K2))) / (cd + K);
const clip = (x, a, b) => Math.min(b, Math.max(a, x));
const lgt = p => { p = clip(p, 1e-3, 1 - 1e-3); return Math.log(p / (1 - p)); };

// ---------------------------------------------------------------- stats_player_week: team-weeks and QB-weeks
const NUM = ['attempts', 'completions', 'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered', 'passing_epa', 'carries',
  'rushing_yards', 'rushing_tds', 'sack_fumbles_lost', 'rushing_fumbles_lost', 'passing_first_downs', 'rushing_first_downs', 'fg_made'];
const TW = {};      // team|season|week -> offense totals (+ opp)
const QW = [];      // QB rows (season-1, season; weeks before W)
for (let y = Y - 3; y <= Y; y++) {
  for (const r of readCSV(D + `stats_player_week_${y}.csv`, ['player_id', 'position', 'season', 'week', 'season_type', 'team', 'opponent_team', 'passing_cpoe', ...NUM])) {
    if (r.season_type !== 'REG') continue;
    const w = +r.week; if (y === Y && w >= W) continue;               // strictly before the target week
    const t = fx(r.team), k = `${t}|${y}|${w}`;
    const T = TW[k] || (TW[k] = { team: t, season: y, week: w, opp: fx(r.opponent_team), ptd: 0, rtd: 0, pyd: 0, db: 0, car: 0, sk: 0, ints: 0, fgm: 0 });
    const v = Object.fromEntries(NUM.map(c => [c, num(r[c])]));
    T.ptd += v.passing_tds; T.rtd += v.rushing_tds; T.pyd += v.passing_yards; T.db += v.attempts + v.sacks_suffered; T.car += v.carries;
    T.sk += v.sacks_suffered; T.ints += v.passing_interceptions; T.fgm += v.fg_made;
    if (r.position === 'QB' && y >= Y - 1 && r.player_id) QW.push({ gsis: r.player_id, team: t, season: y, week: w, v, cpoe: isNA(r.passing_cpoe) ? null : +r.passing_cpoe });
  }
}
for (const T of Object.values(TW)) { T.otd = T.ptd + T.rtd; T.plays = T.db + T.car; T.sc = T.otd + T.fgm; T.g = 1; }
const TC = ['ptd', 'otd', 'pyd', 'db', 'plays', 'sk', 'ints', 'fgm', 'sc', 'g'];
function pitTeam(team, byOpp) {        // cur = this season before W, last = last season (offense, or what the defense allowed)
  const z = () => Object.fromEntries(TC.map(c => [c, 0])); const cur = z(), last = z();
  for (const T of Object.values(TW)) {
    if ((byOpp ? T.opp : T.team) !== team) continue;
    const tgt = T.season === Y ? cur : T.season === Y - 1 ? last : null; if (!tgt) continue;
    for (const c of TC) tgt[c] += T[c];
  }
  return (n, d, K, K2, lg) => bl(cur[n], cur[d], last[n], last[d], K, K2, lg);
}
function teamFeats(team, opp) {
  const f = pitTeam(team, false), o = pitTeam(opp, true);
  return {
    t_ptd_sh: f('ptd', 'otd', 15, 25, .64), t_tdfg: f('otd', 'sc', 25, 40, .59), t_pyd_db: f('pyd', 'db', 150, 250, 6.3),
    t_pass_rate: f('db', 'plays', 150, 250, .58), t_plays_pg: f('plays', 'g', 4, 6, 64.0), t_sk_rate: f('sk', 'db', 150, 250, .065),
    o_ptd_sh: o('ptd', 'otd', 15, 25, .64), o_tdfg: o('otd', 'sc', 25, 40, .59), o_pyd_db: o('pyd', 'db', 150, 250, 6.3),
    o_pass_rate: o('db', 'plays', 150, 250, .58), o_plays_pg: o('plays', 'g', 4, 6, 64.0), o_sk_rate: o('sk', 'db', 150, 250, .065),
    o_int_rate: o('ints', 'db', 200, 300, .022),
  };
}
function qbFeats(gsis) {
  const C = ['attempts', 'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered', 'db', 'passing_epa', 'cp_n', 'cp_s', 'carries',
    'rushing_yards', 'fum', 'passing_first_downs', 'rushing_first_downs', 'qg', 'ptd_q', 'rtd_q', 'db_q', 'tptd_q', 'trtd_q', 'tdb_q', 'ryd_q', 'car_q'];
  const z = () => Object.fromEntries(C.map(c => [c, 0])); const cur = z(), last = z();
  for (const q of QW) {
    if (q.gsis !== gsis) continue;
    const tgt = q.season === Y ? cur : last, v = q.v, T = TW[`${q.team}|${q.season}|${q.week}`];
    const qg = v.attempts >= 10 ? 1 : 0, cpn = q.cpoe === null ? 0 : v.attempts;
    const add = { attempts: v.attempts, passing_yards: v.passing_yards, passing_tds: v.passing_tds, passing_interceptions: v.passing_interceptions,
      sacks_suffered: v.sacks_suffered, db: v.attempts + v.sacks_suffered, passing_epa: v.passing_epa, cp_n: cpn, cp_s: (q.cpoe || 0) * cpn,
      carries: v.carries, rushing_yards: v.rushing_yards, fum: v.sack_fumbles_lost + v.rushing_fumbles_lost, passing_first_downs: v.passing_first_downs,
      rushing_first_downs: v.rushing_first_downs, qg, ptd_q: v.passing_tds * qg, rtd_q: v.rushing_tds * qg, db_q: (v.attempts + v.sacks_suffered) * qg,
      tptd_q: T.ptd * qg, trtd_q: T.rtd * qg, tdb_q: T.db * qg, ryd_q: v.rushing_yards * qg, car_q: v.carries * qg };
    for (const c of C) tgt[c] += add[c];
  }
  const f = (n, d, K, K2, lg) => bl(cur[n], cur[d], last[n], last[d], K, K2, lg);
  return {
    ypa: f('passing_yards', 'attempts', 150, 250, 6.9), td_rate: f('passing_tds', 'attempts', 200, 300, .043),
    int_rate: f('passing_interceptions', 'attempts', 200, 300, .024), sack_rate: f('sacks_suffered', 'db', 150, 250, .068),
    epa_db: f('passing_epa', 'db', 200, 300, -.02), cpoe: f('cp_s', 'cp_n', 200, 300, -1.0), fum_rate: f('fum', 'attempts', 300, 500, .006),
    pfd_per_yd: f('passing_first_downs', 'passing_yards', 1500, 2500, .048), rfd_per_car: f('rushing_first_downs', 'carries', 30, 50, .25),
    ypc: f('rushing_yards', 'carries', 40, 60, 4.5), ryd_pg: f('ryd_q', 'qg', 3, 4, 15.0), car_pg: f('car_q', 'qg', 3, 4, 3.5),
    rtd_pg: f('rtd_q', 'qg', 6, 8, .12), q_ptd_sh: f('ptd_q', 'tptd_q', 15, 20, .93), q_rtd_sh: f('rtd_q', 'trtd_q', 8, 12, .12),
    q_db_sh: f('db_q', 'tdb_q', 100, 150, .95),
  };
}

// ---------------------------------------------------------------- games.csv: targets, coach pass-TD share (3 prior seasons), career starts
const G = readCSV(D + 'games.csv', ['season', 'game_type', 'week', 'gameday', 'home_team', 'away_team', 'total_line', 'spread_line', 'roof', 'temp', 'wind',
  'home_coach', 'away_coach', 'home_qb_id', 'away_qb_id']).filter(r => r.game_type === 'REG');
const coachOf = {}, starts = {};
for (const g of G) {
  const s = +g.season, w = +g.week;
  for (const [t, c, q] of [[fx(g.home_team), g.home_coach, g.home_qb_id], [fx(g.away_team), g.away_coach, g.away_qb_id]]) {
    const k = `${t}|${s}|${w}`; if (!(k in coachOf)) coachOf[k] = isNA(c) ? null : c;
    if (!isNA(q)) (starts[q] || (starts[q] = [])).push(s * 100 + w);
  }
}
const CS = {};
for (const T of Object.values(TW)) {
  if (T.season < Y - 3 || T.season > Y - 1) continue;
  const c = coachOf[`${T.team}|${T.season}|${T.week}`]; if (!c) continue;
  const o = CS[c] || (CS[c] = { ptd: 0, otd: 0 }); o.ptd += T.ptd; o.otd += T.otd;
}
const cPtd = c => (c && CS[c]) ? (CS[c].ptd + 30 * .64) / (CS[c].otd + 30) : .64;

// ---------------------------------------------------------------- injury report (last row per player-week, REG)
const INJ = {};
try {
  for (const r of readCSV(D + `injuries_${Y}.csv`, ['season', 'game_type', 'week', 'gsis_id', 'report_status', 'practice_status', 'report_primary_injury', 'practice_primary_injury'])) {
    if (r.game_type && r.game_type !== 'REG') continue;
    if (+r.week !== W || !r.gsis_id) continue;
    const st = { Questionable: 1, Doubtful: 2, Out: 3 }[r.report_status] || 0, ps = (isNA(r.practice_status) ? '' : r.practice_status).toLowerCase();
    const pr = ps.includes('did not') ? 2 : ps.includes('limited') ? 1 : 0;
    const txt = ((isNA(r.report_primary_injury) ? '' : r.report_primary_injury) + ' ' + (isNA(r.practice_primary_injury) ? '' : r.practice_primary_injury)).toLowerCase();
    INJ[r.gsis_id] = (st + pr) * ((txt.includes('not injury') || txt.includes('resting')) ? 0 : 1);
  }
} catch (e) { /* no injury file yet: treat as healthy */ }

// starter fallback: ESPN daily depth chart, latest snapshot before the game day, QB rank 1
let DEPTH = null;
function depthStarter(team, gameday) {
  if (!DEPTH) {
    DEPTH = {};
    for (const r of readCSV(D + `depth_charts_${Y}.csv`, ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank'])) {
      if (r.pos_abb !== 'QB' || +r.pos_rank !== 1 || !r.gsis_id) continue;
      const t = fx(r.team), d = r.dt.slice(0, 10); (DEPTH[t] || (DEPTH[t] = [])).push([d, r.gsis_id]);
    }
  }
  const c = (DEPTH[team] || []).filter(([d]) => d < gameday).sort((a, b) => a[0] < b[0] ? -1 : 1);
  return c.length ? c[c.length - 1][1] : null;
}

// ---------------------------------------------------------------- the model
const lin = (coef, x) => Object.entries(coef).reduce((s, [k, b]) => s + b * (k === 'const' ? 1 : x[k]), 0);
function predict(x) {
  const S = MODEL.sub, e = {};
  e.E_totd = Math.exp(lin(S.otd.coef, x)); e.E_tptd = Math.exp(lin(S.ptd.coef, x)); e.E_trtd = Math.exp(lin(S.rtd.coef, x));
  e.E_tpyd = lin(S.pyd.coef, x); e.E_tdb = lin(S.db.coef, x);
  e.E_pass_td = Math.exp(Math.log(e.E_tptd) + lin(S.qptd.coef, x));
  e.E_rush_td = Math.exp(Math.log(e.E_trtd) + lin(S.qrtd.coef, x));
  const px = { E_tpyd: e.E_tpyd }; for (const [c, mu] of Object.entries(MODEL.px_means)) px['px_' + c] = e.E_tpyd * (x[c] - mu);
  e.E_pass_yd = lin(S.qpyd.coef, px);
  e.E_rush_yd = lin(S.qryd.coef, x);
  e.E_db = e.E_tdb * clip(x.q_db_sh, .5, 1.0); const ledb = Math.log(clip(e.E_db, 10, 60));
  e.E_int = Math.exp(ledb + lin(S.qint.coef, x)); e.E_sack = Math.exp(ledb + lin(S.qsk.coef, x)); e.E_fum = Math.exp(ledb + lin(S.qfum.coef, x));
  e.E_att = e.E_db - e.E_sack;
  e.E_pass_fd = lin(S.qpfd.coef, { pfd_x: e.E_pass_yd * x.pfd_per_yd });
  e.E_rush_fd = lin(S.qrfd.coef, { rfd_x: e.E_rush_yd * 0.06, rfd_per_car: x.rfd_per_car });
  e.E_2pt = .03 * e.E_pass_td + .02 * e.E_rush_td;
  e.E_rush_yd = Math.max(-2, e.E_rush_yd); e.E_pass_yd = Math.max(0, e.E_pass_yd);
  const mean = .04 * e.E_pass_yd + 4 * e.E_pass_td - e.E_int + .1 * e.E_rush_yd + 6 * e.E_rush_td - 2 * e.E_fum + 2 * e.E_2pt;
  return { pred: mean + MODEL.med_off, pred_mean: mean, p25: MODEL.p25.a + MODEL.p25.b * mean, p75: MODEL.p75.a + MODEL.p75.b * mean, ...e };
}

// ---------------------------------------------------------------- rows: each team's posted starter this week
const ROWS = A.rows ? Object.fromEntries(readCSV(A.rows, ['season', 'week', 'gsis', 'team']).filter(r => +r.season === Y && +r.week === W).map(r => [fx(r.team), r.gsis])) : null;
const out = [];
const wk = G.filter(g => +g.season === Y && +g.week === W);
const tl = wk.map(g => +g.total_line).filter(v => !isNaN(v) && v > 0), meanTot = tl.reduce((a, b) => a + b, 0) / Math.max(1, tl.length);
for (const g of wk) {
  for (const h of [1, 0]) {
    const team = fx(h ? g.home_team : g.away_team), opp = fx(h ? g.away_team : g.home_team);
    let gsis = ROWS ? ROWS[team] : (h ? g.home_qb_id : g.away_qb_id); if (!ROWS && isNA(gsis)) gsis = depthStarter(team, g.gameday); if (!gsis) continue;
    const tot = isNA(g.total_line) ? meanTot : +g.total_line, spr = isNA(g.spread_line) ? 0 : +g.spread_line;
    const itt = h ? (tot + spr) / 2 : (tot - spr) / 2, spread = h ? -spr : spr;
    const dome = (g.roof === 'dome' || g.roof === 'closed') ? 1 : 0;
    const wind = dome ? 0 : (isNA(g.wind) ? 0 : +g.wind), temp = dome ? 70 : (isNA(g.temp) ? 60 : +g.temp);
    const tf = teamFeats(team, opp), qf = qbFeats(gsis);
    const cs = (starts[gsis] || []).filter(o => o < Y * 100 + W).length, inj = INJ[gsis] || 0, c_ptd_sh = cPtd(coachOf[`${team}|${Y}|${W}`]);
    const x = { ...tf, ...qf, c_ptd_sh, itt, total: tot, fav: -spread, dome, inj, car_starts: cs,
      l_itt: Math.log(clip(itt, 8, 40) / 22.5), l_tot: Math.log(clip(tot, 28, 65) / 45.0),
      wind10: Math.max(0, clip(wind, 0, 30) - 10), cold: Math.max(0, 40 - clip(temp, -10, 100)),
      lg_t_ptd: lgt(tf.t_ptd_sh) - lgt(.64), lg_o_ptd: lgt(tf.o_ptd_sh) - lgt(.64), lg_c_ptd: lgt(c_ptd_sh) - lgt(.64),
      lg_t_tdfg: lgt(tf.t_tdfg) - lgt(.59), lg_o_tdfg: lgt(tf.o_tdfg) - lgt(.59),
      lg_rtdsh: lgt(qf.q_rtd_sh) - lgt(.12), lg_qptd: lgt(qf.q_ptd_sh) - lgt(.93), lg_dbsh: lgt(qf.q_db_sh) - lgt(.95),
      lg_int: Math.log(qf.int_rate / .024), lg_oint: Math.log(tf.o_int_rate / .022), lg_sk: Math.log(qf.sack_rate / .068),
      lg_osk: Math.log(tf.o_sk_rate / .065), lg_tsk: Math.log(tf.t_sk_rate / .065), lg_tdr: Math.log(qf.td_rate / .043),
      lg_rtd: Math.log(clip(qf.rtd_pg, .01, 1.5) / .12), lg_fum: Math.log(qf.fum_rate / .006),
      lowexp: cs < 4 ? 1 : 0, l_starts: Math.log1p(cs) };
    out.push({ season: Y, week: W, gsis, team, opp, ...predict(x), itt, total: tot, spread, x });
  }
}
const res = JSON.stringify({ model: MODEL.name, season: Y, week: W, rows: out });
if (A.out) fs.writeFileSync(A.out, res); else process.stdout.write(res + '\n');
