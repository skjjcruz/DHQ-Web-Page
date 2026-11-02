// DHQ stand-alone QB model "qb-rush" (no Sleeper input): rushing-first stat-line components + calibrated median.
// Reference implementation (Node 18+, no dependencies) of the Python model in qb2/qb-rush (feat.py + model.py, variant
// base-mmppg-lite). Computes every input from free nflverse files, scores the exported coefficients and prints, for each
// starting QB of --season/--week: the shown typical number (pred = median), pred_mean, pred_p25/p75 and the expected stat
// line (E_pass_yd, E_pass_td, E_int, E_sack, E_rush_yd, E_rush_td, E_fum, E_pass_fd, E_rush_fd, + attempts, designed runs,
// scrambles) so any league's scoring can be applied.
//
// node qb-rush-features.mjs --season=2026 --week=9 --model=qb-rush.json [--rows=rows.csv] [--out=f.json]
//   (DHQ QB stack component "qb-rush", QB project, qb2/qb-rush; model qb-rush.json = variant base-mmppg-lite.)
//   MODEL_DATA folder (nflverse names):
//     play_by_play_<yr>.csv.gz (or .csv) for season-14..season (env QB_RUSH_HIST; 6 is ~0.1 pt off)   <- NEW file vs the WR/RB set:
//        https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_<yr>.csv.gz
//     stats_player_week_<yr>.csv for the same seasons, players.csv, games.csv, injuries_<season>.csv
//   Starters: games.csv home_qb_id / away_qb_id (posted starter), or --rows=csv with season,week,gsis,team,opp.
//   Completed seasons' play-by-play is summarised once into MODEL_DATA/qb-rush-cache/qbg_<yr>.json (re-used later; the
//   weekly job keeps that folder in the Actions cache and downloads only the seasons it lacks). A season with neither
//   weekly stats nor play-by-play is skipped (the Python fit's history starts in 2012).
import fs from 'fs';
import zlib from 'zlib';

const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const Y = +ARG.season, W = +ARG.week, TT = Y * 100 + W;
const D = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
const HIST = +(process.env.QB_RUSH_HIST || 14);   // seasons of history (decay makes older seasons negligible; 14 = exact Python parity)
const M = JSON.parse(fs.readFileSync(ARG.model || 'qb_rush_model.json', 'utf8'));
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const num = v => (v === '' || v === undefined || v === 'NA' || v === 'NaN') ? 0 : +v;
const isNum = v => !(v === '' || v === undefined || v === 'NA' || v === 'NaN');

// ---------------------------------------------------------------- CSV reader (quotes, embedded newlines), keeps chosen columns
function parseCSV(s, keep, onRow) {
  let hdr = null, idx = null, row = [], i = 0, start = 0, q = false, buf = null; const n = s.length;
  const endField = (end) => { row.push(buf !== null ? buf + s.slice(start, end) : s.slice(start, end)); buf = null; };
  const endRow = () => {
    if (!hdr) { hdr = row.map(x => x.replace(/^"|"$/g, '')); idx = keep.map(k => hdr.indexOf(k)); }
    else if (row.length > 1) { const o = {}; for (let j = 0; j < keep.length; j++) o[keep[j]] = idx[j] >= 0 ? row[idx[j]] : ''; onRow(o); }
    row = [];
  };
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    if (q) {
      if (c === 34) {
        if (s.charCodeAt(i + 1) === 34) { buf = (buf || '') + s.slice(start, i + 1); i++; start = i + 1; }
        else { buf = (buf || '') + s.slice(start, i); q = false; start = i + 1; }
      }
    } else if (c === 34) { buf = (buf || '') + s.slice(start, i); q = true; start = i + 1; }
    else if (c === 44) { endField(i); start = i + 1; }
    else if (c === 10) { endField(s.charCodeAt(i - 1) === 13 ? i - 1 : i); endRow(); start = i + 1; }
  }
  if (start < n || row.length) { endField(n); endRow(); }
}
const readText = p => p.endsWith('.gz') ? zlib.gunzipSync(fs.readFileSync(p)).toString('utf8') : fs.readFileSync(p, 'utf8');
const readRows = (p, keep) => { const out = []; parseCSV(readText(p), keep, o => out.push(o)); return out; };
const exists = p => fs.existsSync(p);

// ---------------------------------------------------------------- players: QB set
const QBS = new Set();
for (const r of readRows(D + 'players.csv', ['gsis_id', 'position'])) if (r.position === 'QB' && r.gsis_id) QBS.add(r.gsis_id);

// ---------------------------------------------------------------- play-by-play -> per QB-game and per team-game sums (REG, no 2-pt tries)
const PBP_COLS = ['game_id', 'season', 'week', 'season_type', 'posteam', 'defteam', 'passer_id', 'rusher_id', 'qb_dropback',
  'qb_scramble', 'qb_kneel', 'sack', 'qb_hit', 'ydstogo', 'yardline_100', 'rush_attempt', 'two_point_attempt', 'yards_gained',
  'rush_touchdown', 'first_down_rush'];
const QC = ['db', 'sk', 'hit', 'scr', 'scr_yd', 'scr_td', 'scr_fd', 'run', 'snk', 'run_yd', 'run_td', 'run_fd', 'gl', 'gl_td', 'kn'];
function aggSeason(y) {
  const cdir = D + 'qb-rush-cache/', cf = cdir + `qbg_${y}.json`;
  if (y < Y && exists(cf)) return JSON.parse(fs.readFileSync(cf, 'utf8'));
  const p = exists(D + `play_by_play_${y}.csv.gz`) ? D + `play_by_play_${y}.csv.gz` : D + `play_by_play_${y}.csv`;
  if (!exists(p)) { if (y === Y) return { team: [], qb: [] }; throw new Error('qb-rush: no play-by-play for ' + y + ' (' + p + ')'); }
  const team = {}, qb = {};
  parseCSV(readText(p), PBP_COLS, r => {
    if (r.season_type !== 'REG' || num(r.two_point_attempt) === 1) return;
    const db = num(r.qb_dropback) === 1, scr = num(r.qb_scramble) === 1, kn = num(r.qb_kneel) === 1, ru = num(r.rush_attempt) === 1;
    const pt = fx(r.posteam), dt = fx(r.defteam), yl = isNum(r.yardline_100) ? +r.yardline_100 : 999, ytg = num(r.ydstogo);
    const tk = `${r.game_id}|${pt}|${dt}`;
    const T = team[tk] || (team[tk] = { season: +r.season, week: +r.week, game_id: r.game_id, team: pt, opp: dt, t_db: 0, t_play: 0, t_gl_run: 0 });
    T.t_db += db ? 1 : 0; T.t_play += (ru || db) ? 1 : 0; T.t_gl_run += (ru && !kn && !scr && yl <= 5) ? 1 : 0;
    const id = db ? (r.passer_id || r.rusher_id) : (ru ? r.rusher_id : '');
    if (!id || id === 'NA' || !QBS.has(id)) return;
    const k = `${id}|${r.game_id}|${pt}|${dt}`;
    const Q = qb[k] || (qb[k] = Object.assign({ gsis: id, season: +r.season, week: +r.week, game_id: r.game_id, team: pt, opp: dt }, Object.fromEntries(QC.map(c => [c, 0]))));
    const des = ru && !scr && !kn, yg = num(r.yards_gained), rtd = num(r.rush_touchdown) === 1, fd = num(r.first_down_rush) === 1;
    if (db) { Q.db++; if (num(r.sack) === 1) Q.sk++; if (num(r.qb_hit) === 1 || num(r.sack) === 1) Q.hit++; }
    if (ru && scr) { Q.scr++; Q.scr_yd += yg; if (rtd) Q.scr_td++; if (fd) Q.scr_fd++; }
    if (des) {
      Q.run++; Q.run_yd += yg; if (rtd) Q.run_td++; if (fd) Q.run_fd++; if (ytg <= 1) Q.snk++;
      if (yl <= 5) { Q.gl++; if (rtd) Q.gl_td++; }
    }
    if (ru && kn) Q.kn++;
  });
  const out = { team: Object.values(team), qb: Object.values(qb) };
  if (y < Y) { fs.mkdirSync(cdir, { recursive: true }); fs.writeFileSync(cf, JSON.stringify(out)); }
  return out;
}

// ---------------------------------------------------------------- weekly stats (official) for QBs
const SC = ['attempts', 'completions', 'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered', 'sack_fumbles_lost',
  'rushing_fumbles_lost', 'rushing_yards', 'rushing_tds', 'passing_first_downs', 'rushing_first_downs', 'passing_2pt_conversions', 'rushing_2pt_conversions'];
const STAT = {};
const TEAMG = [], G = [];
for (let y = Y - HIST; y <= Y; y++) {
  if (!exists(D + `stats_player_week_${y}.csv`)) continue;
  for (const r of readRows(D + `stats_player_week_${y}.csv`, ['player_id', 'season', 'week', 'season_type', ...SC])) {
    if (r.season_type !== 'REG' || !QBS.has(r.player_id)) continue;
    const k = `${r.player_id}|${r.season}|${r.week}`, s = STAT[k] || (STAT[k] = Object.fromEntries(SC.map(c => [c, 0])));
    for (const c of SC) s[c] += num(r[c]);
  }
  const a = aggSeason(y); TEAMG.push(...a.team); G.push(...a.qb);
}
const tIdx = {}; for (const t of TEAMG) tIdx[`${t.game_id}|${t.team}|${t.opp}`] = t;
for (const g of G) {
  const t = tIdx[`${g.game_id}|${g.team}|${g.opp}`] || { t_db: 0, t_play: 0, t_gl_run: 0 };
  const s = STAT[`${g.gsis}|${g.season}|${g.week}`] || Object.fromEntries(SC.map(c => [c, 0]));
  Object.assign(g, s);
  g.t = g.season * 100 + g.week;
  g.share = Math.min(1, Math.max(0, g.db / Math.max(t.t_db, 1)));
  g.fuml = g.sack_fumbles_lost + g.rushing_fumbles_lost;
  g.fp = g.passing_yards * .04 + g.passing_tds * 4 - g.passing_interceptions + g.rushing_yards * .1 + g.rushing_tds * 6 - 2 * g.fuml +
    2 * (g.passing_2pt_conversions + g.rushing_2pt_conversions);
  g.qrun_yd = g.run_yd + g.scr_yd; g.plays = g.db + g.run; g.t_gl_on = t.t_gl_run * g.share;
  g.full = g.share >= 0.6 ? 1 : 0; g.fp_full = g.fp * g.full; g.fp2_full = g.fp * g.fp * g.full; g.main = g.share >= 0.5 ? 1 : 0;
}
const byTime = (a, b) => a.season - b.season || a.week - b.week;
const group = (rows, key) => { const m = {}; for (const r of rows) (m[r[key]] || (m[r[key]] = [])).push(r); for (const k in m) m[k].sort(byTime); return m; };

// decayed state of `rows` (sorted) strictly before time tt, carried to season ty (one more game step + season boundaries)
function stateAt(rows, cols, lam, seas, tt, ty) {
  const S = Object.fromEntries(cols.map(c => [c, 0])); let prev = null;
  for (const r of rows || []) {
    if (r.t >= tt) break;
    if (prev !== null) { const f = lam * seas ** (r.season - prev); for (const c of cols) S[c] *= f; }
    for (const c of cols) S[c] += r[c]; prev = r.season;
  }
  if (prev !== null) { const f = lam * seas ** (ty - prev); for (const c of cols) S[c] *= f; }
  return S;
}
const LAM = 0.93, SEAS = 0.75;
const SUMS = ['share', 'full', 'db', 'sk', 'hit', 'scr', 'scr_yd', 'scr_td', 'scr_fd', 'run', 'snk', 'run_yd', 'run_td', 'run_fd', 'gl', 'gl_td',
  'attempts', 'completions', 'passing_yards', 'passing_tds', 'passing_interceptions', 'fuml', 'passing_first_downs', 't_gl_on', 'plays', 'fp_full', 'fp2_full'];
const LSUMS = ['share', 'run', 'scr', 'db', 'gl', 't_gl_on'];
const GQ = group(G, 'gsis');
const rr = (S, n, d, K, p) => (S[n] + K * p) / (S[d] + K);

// ---------------------------------------------------------------- opponent residuals: every historical QB game vs that QB's pre-game expectation
const DEF = {};
for (const id in GQ) {
  const rows = GQ[id]; const S = Object.fromEntries(SUMS.map(c => [c, 0])); let prev = null;
  for (const g of rows) {
    const P = {}; const f = prev === null ? 0 : LAM * SEAS ** (g.season - prev);
    for (const c of SUMS) P[c] = S[c] * f;
    const e_run = rr(P, 'run', 'share', 2, 1.6) * g.share, e_scr = rr(P, 'scr', 'db', 120, 0.045) * g.db;
    const e_ryd = e_run * rr(P, 'run_yd', 'run', 25, 3.6) + e_scr * rr(P, 'scr_yd', 'scr', 20, 7.0);
    const k = `${g.opp}|${g.season}|${g.week}`;
    const d = DEF[k] || (DEF[k] = { opp: g.opp, season: g.season, week: g.week, t: g.t, d_run: 0, d_scr: 0, d_ryd: 0, d_hit: 0, d_db: 0, d_scrx: 0, d_pyd: 0, d_ptd: 0, d_int: 0, d_att: 0, g: 0 });
    d.d_run += g.run - e_run; d.d_scr += g.scr - e_scr; d.d_ryd += g.qrun_yd - e_ryd; d.d_hit += g.hit - rr(P, 'hit', 'db', 150, 0.15) * g.db;
    d.d_db += g.db; d.d_scrx += e_scr; d.d_pyd += g.passing_yards - rr(P, 'passing_yards', 'attempts', 150, 6.8) * g.attempts;
    d.d_ptd += g.passing_tds - rr(P, 'passing_tds', 'attempts', 300, 0.043) * g.attempts;
    d.d_int += g.passing_interceptions - rr(P, 'passing_interceptions', 'attempts', 400, 0.025) * g.attempts; d.d_att += g.attempts; d.g += 1;
    for (const c of SUMS) S[c] = S[c] * f + g[c]; prev = g.season;
  }
}
const GD = group(Object.values(DEF), 'opp');
const DCOLS = ['d_run', 'd_scr', 'd_ryd', 'd_hit', 'd_db', 'd_scrx', 'd_pyd', 'd_ptd', 'd_int', 'd_att', 'g'];
// team volume / protection and defence pass rush (sacks per dropback)
const skT = {}; for (const g of G) { const k = `${g.team}|${g.season}|${g.week}`; skT[k] = (skT[k] || 0) + g.sk; }
const TGR = TEAMG.map(t => ({ ...t, t: t.season * 100 + t.week, sk: skT[`${t.team}|${t.season}|${t.week}`] || 0, g: 1 }));
const GT = group(TGR, 'team');
const TDm = {}; for (const t of TGR) { const k = `${t.opp}|${t.season}|${t.week}`; const d = TDm[k] || (TDm[k] = { opp: t.opp, season: t.season, week: t.week, t: t.t, t_db: 0, sk: 0, g: 0 }); d.t_db += t.t_db; d.sk += t.sk; d.g += t.g; }
const GTD = group(Object.values(TDm), 'opp');

// ---------------------------------------------------------------- games (Vegas, roof, weather, posted starters) and injuries
const GAMES = readRows(D + 'games.csv', ['season', 'week', 'game_type', 'home_team', 'away_team', 'spread_line', 'total_line', 'roof', 'temp', 'wind', 'home_qb_id', 'away_qb_id']);
const GV = {};
for (const g of GAMES) {
  if (g.game_type !== 'REG' || +g.season !== Y) continue;
  const dome = ['dome', 'closed'].includes(g.roof) ? 1 : 0, total = num(g.total_line), sp = num(g.spread_line);
  const base = { dome, total, wind: isNum(g.wind) ? +g.wind : null, temp: isNum(g.temp) ? +g.temp : null, week: +g.week };
  GV[`${fx(g.home_team)}|${g.week}`] = { ...base, spread: -sp, opp: fx(g.away_team), qb: g.home_qb_id };
  GV[`${fx(g.away_team)}|${g.week}`] = { ...base, spread: sp, opp: fx(g.home_team), qb: g.away_qb_id };
}
const INJ = {};
if (exists(D + `injuries_${Y}.csv`)) {
  for (const r of readRows(D + `injuries_${Y}.csv`, ['season', 'week', 'gsis_id', 'report_status', 'report_primary_injury', 'practice_primary_injury'])) {
    if (+r.week !== W && !ARG.rows) continue;
    const t = ((r.report_primary_injury === 'NA' ? '' : r.report_primary_injury) + ' ' + (r.practice_primary_injury === 'NA' ? '' : r.practice_primary_injury)).toLowerCase();
    const rest = /not injury|resting|personal|illness/.test(t) ? 1 : 0;
    const o = {
      low_body: rest ? 0 : +/ankle|knee|hamstring|foot|toe|calf|groin|hip|quad|achilles|leg|thigh|heel|acl|mcl|shin/.test(t),
      ribs: rest ? 0 : +/rib|chest|oblique|abdom|back|core/.test(t), listed: 1 - rest,
      inj_q: ['Questionable', 'Doubtful'].includes(r.report_status) ? 1 : 0,
    };
    const k = `${r.gsis_id}|${r.week}`, p = INJ[k] || (INJ[k] = { low_body: 0, ribs: 0, listed: 0, inj_q: 0 });
    for (const c in o) p[c] = Math.max(p[c], o[c]);
  }
}

// ---------------------------------------------------------------- features for one QB-game
const L = x => Math.log(Math.max(x, 1e-3));
function features(gsis, team, week) {
  const tt = Y * 100 + week, gv = GV[`${team}|${week}`];
  if (!gv) return null;
  const opp = gv.opp, S = stateAt(GQ[gsis], SUMS, LAM, SEAS, tt, Y), Lg = stateAt(GQ[gsis], LSUMS, 0.97, 0.9, tt, Y);
  const MN = stateAt(GQ[gsis], ['main'], 1, 1, tt, Y);
  const f = {};
  f.h_games = S.share;
  f.run_pg = rr(S, 'run', 'share', 2, 1.6); f.run_pg_L = (Lg.run + 2 * 1.6) / (Lg.share + 2); f.snk_pg = rr(S, 'snk', 'share', 3, 0.35);
  f.scr_rate = rr(S, 'scr', 'db', 120, 0.045); f.scr_rate_L = (Lg.scr + 120 * 0.045) / (Lg.db + 120);
  f.run_ypc = rr(S, 'run_yd', 'run', 25, 3.6); f.scr_ypc = rr(S, 'scr_yd', 'scr', 20, 7.0);
  f.gl_sh = rr(S, 'gl', 't_gl_on', 8, 0.12); f.gl_sh_L = (Lg.gl + 8 * 0.12) / (Lg.t_gl_on + 8);
  f.run_td_ngl = (S.run_td - S.gl_td + 30 * 0.02) / (S.run - S.gl + 30); f.scr_td_rate = rr(S, 'scr_td', 'scr', 40, 0.03);
  f.run_fd_rate = rr(S, 'run_fd', 'run', 20, 0.35); f.scr_fd_rate = rr(S, 'scr_fd', 'scr', 20, 0.40);
  f.db_pg = rr(S, 'db', 'share', 3, 36); f.sk_rate = rr(S, 'sk', 'db', 150, 0.065);
  f.ypa = rr(S, 'passing_yards', 'attempts', 150, 6.8); f.ptd_rate = rr(S, 'passing_tds', 'attempts', 300, 0.043);
  f.int_rate = rr(S, 'passing_interceptions', 'attempts', 400, 0.025); f.pfd_rate = rr(S, 'passing_first_downs', 'attempts', 150, 0.33);
  f.fum_rate = rr(S, 'fuml', 'plays', 300, 0.008); f.ppg_full = rr(S, 'fp_full', 'full', 3, 15.0);
  f.fp_sd = Math.sqrt(Math.max(9, (S.fp2_full + 3 * (15 ** 2 + 50)) / (S.full + 3) - f.ppg_full ** 2));
  const HD = stateAt(GD[opp], DCOLS, 0.92, 0.5, tt, Y);
  f.opp_run_res = HD.d_run / (HD.g + 6); f.opp_scr_mult = 1 + HD.d_scr / (HD.d_scrx + 8); f.opp_ryd_res = HD.d_ryd / (HD.g + 6);
  f.opp_hit_res = HD.d_hit / (HD.d_db + 150); f.opp_ypa_res = HD.d_pyd / (HD.d_att + 200); f.opp_ptd_res = HD.d_ptd / (HD.d_att + 400);
  f.opp_int_res = HD.d_int / (HD.d_att + 400);
  const ST = stateAt(GT[team], ['t_db', 't_play', 'sk', 'g'], 0.9, 0.5, tt, Y);
  f.team_db_pg = (ST.t_db + 4 * 36.5) / (ST.g + 4); f.team_pass_rate = (ST.t_db + 60 * 0.6) / (ST.t_play + 100);
  f.ol_sack_rate = (ST.sk + 150 * 0.068) / (ST.t_db + 150);
  const SD = stateAt(GTD[opp], ['t_db', 'sk', 'g'], 0.9, 0.5, tt, Y);
  f.opp_sack_rate = (SD.sk + 150 * 0.068) / (SD.t_db + 150);
  f.first_start = MN.main < 0.5 ? 1 : 0;
  const inj = INJ[`${gsis}|${week}`] || { low_body: 0, ribs: 0, listed: 0, inj_q: 0 };
  Object.assign(f, inj);
  f.spread = gv.spread; f.itt = (gv.total - gv.spread) / 2; f.dome = gv.dome;
  f.wind = gv.dome ? 0 : (gv.wind === null ? 6 : gv.wind);
  f.cold = gv.dome ? 0 : Math.max(0, 45 - (gv.temp === null ? 60 : gv.temp)) / 10;
  f.opp = opp;
  return f;
}

// ---------------------------------------------------------------- model: chained GLM components, then quantile maps
const C = M.components;
const lin = (name, x) => { const c = C[name]; let s = c._b; for (const k in c) if (k !== '_b') s += c[k] * (Number.isFinite(x[k]) ? x[k] : 0); return s; };
const pois = (name, x) => Math.exp(lin(name, x));
function predict(f) {
  const x = { ...f };
  x.fav = Math.max(0, -f.spread) / 7; x.dog = Math.max(0, f.spread) / 7; x.lh = Math.log1p(f.h_games);
  x.l_run = L(f.run_pg); x.l_run_L = L(f.run_pg_L); x.l_snk = L(f.snk_pg); x.l_scr = L(f.scr_rate); x.l_scr_L = L(f.scr_rate_L);
  x.l_osm = Math.log(Math.min(2, Math.max(0.5, f.opp_scr_mult))); x.l_gl = L(f.gl_sh); x.l_gl_L = L(f.gl_sh_L); x.l_itt = L(f.itt);
  x.l_ptd = L(f.ptd_rate); x.l_int = L(f.int_rate); x.l_sk = L(f.sk_rate); x.l_db = L(f.db_pg); x.l_tdb = L(f.team_db_pg);
  x.l_osk = L(f.opp_sack_rate); x.l_olsk = L(f.ol_sack_rate); x.l_rtdn = L(f.run_td_ngl); x.l_stdr = L(f.scr_td_rate);
  x.l_oint = L(Math.max(0.005, 0.023 + f.opp_int_res)); x.l_optd = L(Math.max(0.01, 0.044 + f.opp_ptd_res));
  x.opp_run_res_c = Math.min(2, Math.max(-2, f.opp_run_res)); x.opp_ryd_res_c = Math.min(10, Math.max(-10, f.opp_ryd_res));
  const E = {};
  E.E_db = pois('E_db', x); E.E_run = pois('E_run', x); x.E_db = E.E_db; x.E_run = E.E_run; x.l_Edb = Math.log(Math.max(E.E_db, 1));
  E.E_scr = pois('E_scr', x); x.E_scr = E.E_scr; E.E_sk = pois('E_sk', x);
  x.E_att0 = Math.max(5, E.E_db - E.E_sk - E.E_scr); x.l_Eatt = Math.log(x.E_att0);
  x.run_yx = E.E_run * f.run_ypc; x.scr_yx = E.E_scr * f.scr_ypc; x.run_yx_lb = x.run_yx * f.low_body;
  x.att_ypa = x.E_att0 * f.ypa; x.att_oypa = x.E_att0 * f.opp_ypa_res; x.att_wpn = 0; x.att_wind = x.E_att0 * f.wind;
  x.ryd_opp = x.opp_ryd_res_c * (E.E_run + E.E_scr) / 4;
  E.E_att = lin('E_att', x); E.E_qryd = lin('E_qryd', x); E.E_kn = lin('E_kn', x); E.E_pyd = lin('E_pyd', x); x.E_pyd = E.E_pyd;
  x.l_Erun = Math.log(Math.max(E.E_run, 0.05)); x.l_Escr = Math.log(Math.max(E.E_scr, 0.05));
  E.E_rtd = pois('E_rtd', x); x.gl_steal = f.gl_sh * f.itt / 10; E.E_ptd = pois('E_ptd', x); E.E_int = pois('E_int', x);
  x.fumx = f.fum_rate * (E.E_db + E.E_run); E.E_fum = lin('E_fum', x);
  x.pfdx = x.E_att0 * f.pfd_rate; x.rfdx = E.E_run * f.run_fd_rate + E.E_scr * f.scr_fd_rate;
  E.E_pass_fd = lin('E_pass_fd', x); E.E_rush_fd = lin('E_rush_fd', x);
  E.E_rush_yd = E.E_qryd + E.E_kn;
  E.E_mean = E.E_pyd * .04 + E.E_ptd * 4 - E.E_int + E.E_rush_yd * .1 + E.E_rtd * 6 - 2 * E.E_fum + 0.12;
  const m = { pp_pyd: E.E_pyd * .04, pp_ptd: E.E_ptd * 4, pp_int: -E.E_int, pp_ryd: E.E_rush_yd * .1, pp_rtd: E.E_rtd * 6, pp_fum: -2 * E.E_fum,
    vol: f.fp_sd - 7, ppg_gap: f.ppg_full - E.E_mean, E_mean: E.E_mean };
  m.rush_sh = m.pp_ryd + m.pp_rtd;
  const map = mm => { let s = mm._b; for (const k in mm) if (k !== '_b') s += mm[k] * m[k]; return s; };
  return { pred: map(M.maps.median), pred_mean: map(M.maps.mean), pred_p25: map(M.maps.p25), pred_p75: map(M.maps.p75),
    E_pass_yd: E.E_pyd, E_pass_td: E.E_ptd, E_int: E.E_int, E_sack: E.E_sk, E_rush_yd: E.E_rush_yd, E_rush_td: E.E_rtd, E_fum: E.E_fum,
    E_pass_fd: E.E_pass_fd, E_rush_fd: E.E_rush_fd, E_att: E.E_att, E_db: E.E_db, E_run: E.E_run, E_scr: E.E_scr, E_mean: E.E_mean };
}

// ---------------------------------------------------------------- targets
let targets = [];
if (ARG.rows) targets = readRows(ARG.rows, ['season', 'week', 'gsis', 'team']).filter(r => +r.season === Y).map(r => ({ gsis: r.gsis, team: r.team, week: +r.week }));
else for (const k in GV) { const [team, wk] = k.split('|'); if (+wk === W && GV[k].qb && GV[k].qb !== 'NA') targets.push({ gsis: GV[k].qb, team, week: W }); }
const out = [];
for (const t of targets) {
  const f = features(t.gsis, t.team, t.week);
  if (!f) continue;
  out.push({ season: Y, week: t.week, gsis: t.gsis, team: t.team, opp: f.opp, ...predict(f), features: f });
}
const js = JSON.stringify(out, null, ARG.out ? 0 : 1);
if (ARG.out) fs.writeFileSync(ARG.out, js); else console.log(js);
console.error(`qb-rush: ${out.length} QBs scored for ${Y}${ARG.rows ? ' (rows file)' : ' week ' + W}`);
