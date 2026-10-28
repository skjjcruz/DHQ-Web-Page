// Reference implementation (Node, no dependencies) of DHQ's stand-alone team-defense (D/ST) projection: the inputs, computed only
// from free nflverse files (point-in-time: games before week W of season Y, plus season Y-1 and the opposing QB's career), the
// expected Sleeper D/ST stat line (points-allowed bucket probabilities, yards-allowed buckets, sacks, INT, fumble recoveries, forced
// fumbles, defensive TDs, return TDs, safeties, blocked kicks, forced punts, TFL, 3-and-outs, ...) from compact formulas
// (threshold logits + Poisson GLMs + rates; model/dst_prod.json), and the league-independent typical-week (median) mapping.
// Same download set as scripts/build-wr-model-snapshot.mjs (only stats_player_week_<yr>.csv 2013..season and games.csv are read).
//
// node dst-features.mjs --season=2026 --week=8 [--models=<dir with dst_prod.json, dst-median-map.json, dst-norms.json>] [--model=dst_prod.json] [--out=f.json]
//   MODEL_DATA = folder with the nflverse files (stats_player_week_<yr>.csv, games.csv), as in the weekly GitHub Action.
// Output rows: { team (Sleeper code, e.g. LAR), opp, x: {inputs}, line: {Sleeper D/ST keys: expected value / bucket probability},
//   points: {dhq|fg8|ctb: {average, typical}} for the three reference scorings stored in dst-median-map.json }.
// Any other league: dstPoints(line, league.scoring_settings) -> {typical, average} (exported below).
import fs from 'fs';
import path from 'path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ARGS = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const MD = (ARGS.models || HERE).replace(/\/?$/, '/');
const MODEL = JSON.parse(fs.readFileSync(MD + (ARGS.model || 'dst_prod.json')));
const MAP = JSON.parse(fs.readFileSync(MD + (ARGS.map || 'dst-median-map.json')));
const NORM = JSON.parse(fs.readFileSync(MD + 'dst-norms.json'));

// ---------------------------------------------------------------- scoring (any Sleeper league's scoring_settings)
// average = sum over the expected line of value x league points (bucket keys carry probabilities); typical = the median mapping.
export function dstAverage(line, scoring) {
  let s = 0;
  for (const k in line) { const w = +(scoring[k] || 0); if (w) s += w * (line[k] || 0); }
  return s;
}
export function dstPoints(line, scoring, map = MAP) {
  const average = dstAverage(line, scoring);
  return { typical: map.b0 + map.b[0] * average, average };
}

// ---------------------------------------------------------------- the model: expected Sleeper D/ST line from the inputs x
const PA_B = ['pts_allow_0', 'pts_allow_1_6', 'pts_allow_7_13', 'pts_allow_14_20', 'pts_allow_21_27', 'pts_allow_28_34', 'pts_allow_35p'];
const PA_MID = [0, 3.5, 10, 17, 24, 31, 40];
const YD_B = ['yds_allow_0_100', 'yds_allow_100_199', 'yds_allow_200_299', 'yds_allow_300_349', 'yds_allow_350_399', 'yds_allow_400_449',
  'yds_allow_450_499', 'yds_allow_500_549', 'yds_allow_550p'];
const YD_EDGE = [0, 100, 200, 300, 350, 400, 450, 500, 550, 1e9];
const val = (x, f, fill) => (x[f] === null || x[f] === undefined || Number.isNaN(+x[f])) ? fill : +x[f];
const lin = (g, x) => g.feats.reduce((s, f, i) => s + g.coef[i] * val(x, f, g.fill[i]), g.b0);
function erf(z) {   // Abramowitz-Stegun 7.1.26 (|error| < 1.5e-7)
  const t = 1 / (1 + 0.3275911 * Math.abs(z));
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z);
  return z >= 0 ? y : -y;
}
const ncdf = z => 0.5 * (1 + erf(z / Math.SQRT2));
export function dstLine(x, M = MODEL) {
  const L = {};
  // points allowed: P(pts_allow >= edge) from threshold logits, made non-increasing, bucket probabilities = differences
  let prev = 1; const C = [];
  for (const t of M.pa) {
    const z = M.pa_feats.reduce((s, f, i) => s + t.coef[i] * val(x, f, M.pa_fill[i]), t.b0);
    const p = Math.min(prev, 1 / (1 + Math.exp(-z))); C.push(p); prev = p;
  }
  const full = [1, ...C, 0];
  PA_B.forEach((b, j) => { L[b] = full[j] - full[j + 1]; });
  L.pts_allow = PA_B.reduce((s, b, j) => s + L[b] * PA_MID[j], 0);
  const E = {};
  for (const k in M.glm) E[k] = Math.exp(lin(M.glm[k], x));
  for (const k in M.const) E[k] = M.const[k];
  for (const k in M.keys) L[M.keys[k]] = E[k];
  L.sack_yd = M.ratio.sack_yd * E.sack; L.int_ret_yd = M.ratio.int_ret_yd * E.int; L.fum_ret_yd = M.ratio.fum_ret_yd * E.fr;
  L.def_3_and_out = E.tao !== undefined ? E.tao : M.tao_ratio * E.punts;
  for (const k in M.minor) L[k] = M.minor[k];
  const y = M.yds, mu = lin(y, x) - y.sleeper_offset;
  L.yds_allow = mu;
  YD_B.forEach((b, j) => { L[b] = ncdf((YD_EDGE[j + 1] - 0.5 - mu) / y.sd) - ncdf((YD_EDGE[j] - 0.5 - mu) / y.sd); });
  return L;
}

// ---------------------------------------------------------------- the inputs (only when run as a script)
const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const Y = +ARGS.season, W = +ARGS.week;
  const D = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
  const F = { stats: y => D + `stats_player_week_${y}.csv`, games: D + 'games.csv' };
  // tiny CSV reader (quotes, embedded newlines)
  function readCSV(p, keep) {
    const s = fs.readFileSync(p, 'utf8'); const rows = []; let field = '', row = [], q = false, hdr = null, idx = null;
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
  const num = v => isNA(v) || Number.isNaN(+v) ? 0 : +v;
  const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
  const TO_APP = { LA: 'LAR' }; const app = t => TO_APP[t] || t;
  const blend = (cn, cd, ln, ld, K, K2, lg) => (cn + K * ((ln + K2 * lg) / (ld + K2))) / (cd + K);
  const roundHalfEven = v => { const f = Math.floor(v), d = v - f; return d > 0.5 ? f + 1 : d < 0.5 ? f : (f % 2 === 0 ? f : f + 1); };

  // ---- weekly stats -> team-game sums (offence and defence of the same team) + QB game logs
  const OFF = { att: 'attempts', sk: 'sacks_suffered', sky: 'sack_yards_lost', py: 'passing_yards', ry: 'rushing_yards', car: 'carries', intt: 'passing_interceptions',
    pepa: 'passing_epa', repa: 'rushing_epa', punts: 'pt_att', fl1: 'sack_fumbles_lost', fl2: 'rushing_fumbles_lost', fl3: 'receiving_fumbles_lost',
    ptd: 'passing_tds', rtd: 'rushing_tds', pat: 'pat_made', fg: 'fg_made', r2: 'rushing_2pt_conversions', c2: 'receiving_2pt_conversions' };
  const DEF = { int: 'def_interceptions', ff: 'def_fumbles_forced', dtd: 'def_tds', sttd: 'special_teams_tds', pblk: 'def_punt_blocks', patb: 'def_pat_blocks',
    fgb: 'def_fg_blocks', tfl: 'def_tackles_for_loss', d2pt: 'def_2pt_made', frtd: 'fumble_recovery_tds', qbh: 'def_qb_hits' };
  const COLS = [...new Set([...Object.values(OFF), ...Object.values(DEF)])];
  const TS = {};            // season|week|team -> sums
  const QG = {};            // QB id -> [{y, w, team, db, att, sk, int, epa}]
  const TOPQB = {};         // season|week|team -> id of the most dropbacks (ties: lowest id)
  for (let y = 2013; y <= Y; y++) {
    if (!fs.existsSync(F.stats(y))) continue;
    for (const r of readCSV(F.stats(y), ['player_id', 'season', 'week', 'season_type', 'team', 'position_group', ...COLS])) {
      if (r.season_type !== 'REG') continue;
      const w = +r.week, t = fx(r.team), k = `${y}|${w}|${t}`;
      const o = TS[k] || (TS[k] = Object.fromEntries([...Object.keys(OFF), ...Object.keys(DEF), 'frtdd'].map(c => [c, 0])));
      for (const c in OFF) o[c] += num(r[OFF[c]]);
      for (const c in DEF) o[c] += num(r[DEF[c]]);
      if (['DL', 'LB', 'DB'].includes(r.position_group)) o.frtdd += num(r.fumble_recovery_tds);
      const att = num(r.attempts), sk = num(r.sacks_suffered);
      if (att + sk > 0 && r.player_id) {
        (QG[r.player_id] || (QG[r.player_id] = [])).push({ y, w, team: t, db: att + sk, att, sk, int: num(r.passing_interceptions), epa: num(r.passing_epa) });
        const cur = TOPQB[k];
        if (!cur || att + sk > cur.db || (att + sk === cur.db && r.player_id < cur.id)) TOPQB[k] = { id: r.player_id, db: att + sk };
      }
    }
  }
  for (const k in TS) { const o = TS[k]; o.fl = o.fl1 + o.fl2 + o.fl3; o.db = o.att + o.sk; o.plays = o.att + o.sk + o.car; o.yds = o.py - o.sky + o.ry;
    o.epa = o.pepa + o.repa; o.blk = o.pblk + o.patb + o.fgb; }
  // ---- games: scores, Vegas, opponents, QB ids (nflverse fills the projected starter for upcoming games)
  const GR = readCSV(F.games, ['season', 'game_type', 'week', 'gameday', 'home_team', 'away_team', 'home_score', 'away_score', 'spread_line', 'total_line',
    'roof', 'div_game', 'home_rest', 'away_rest', 'home_qb_id', 'away_qb_id']).filter(r => r.game_type === 'REG' && +r.season >= 2013 && +r.season <= Y);
  const SIDE = [];          // one row per team-game
  for (const r of GR) {
    for (const [sd, ot] of [['home', 'away'], ['away', 'home']]) {
      const sp = isNA(r.spread_line) ? null : +r.spread_line, tot = isNA(r.total_line) ? null : +r.total_line;
      const spread = sp === null ? null : (sd === 'home' ? -sp : sp);
      SIDE.push({ y: +r.season, w: +r.week, team: fx(r[sd + '_team']), opp: fx(r[ot + '_team']), day: r.gameday, home: sd === 'home' ? 1 : 0,
        score: isNA(r[sd + '_score']) ? null : +r[sd + '_score'], oscore: isNA(r[ot + '_score']) ? null : +r[ot + '_score'], total: tot, spread,
        itt: tot !== null && spread !== null ? (tot - spread) / 2 : null, opp_itt: tot !== null && spread !== null ? (tot + spread) / 2 : null,
        roof: r.roof, div: isNA(r.div_game) ? null : +r.div_game, rest: isNA(r[sd + '_rest']) ? null : +r[sd + '_rest'],
        orest: isNA(r[ot + '_rest']) ? null : +r[ot + '_rest'], oqb: isNA(r[ot + '_qb_id']) ? null : r[ot + '_qb_id'] });
    }
  }
  // safeties each team scored (all kinds, incl. team safeties no defender is credited with) = score residual
  const SAFE = {};
  for (const g of SIDE) {
    const s = TS[`${g.y}|${g.w}|${g.team}`];
    if (g.score === null || !s) continue;
    SAFE[`${g.y}|${g.w}|${g.team}`] = roundHalfEven((g.score - 6 * (s.ptd + s.rtd + s.dtd + s.frtd + s.sttd) - s.pat - 3 * s.fg - 2 * (s.r2 + s.c2) - 2 * s.d2pt) / 2);
  }
  // per team: its played games in order, with defence (what it allowed / did) and offence (what it did / gave up) numbers
  const REC = {};
  const Z = () => Object.fromEntries(['pa', 'sk', 'db', 'att', 'intc', 'fl', 'ff', 'dtd', 'sttd', 'blk', 'safe', 'punts', 'tfl', 'epa', 'plays', 'yds', 'qbh',
    'opts', 'osk', 'odb', 'oatt', 'oint', 'ofl', 'oplays', 'oepa', 'opunts', 'oyds', 'otda', 'osttda', 'oblka', 'osafea', 'offa'].map(c => [c, 0]));
  const SORTED = SIDE.filter(g => g.score !== null && g.oscore !== null).sort((a, b) => a.y - b.y || a.w - b.w || (a.team < b.team ? -1 : a.team > b.team ? 1 : 0));
  for (const g of SORTED) {
    const me = TS[`${g.y}|${g.w}|${g.team}`], op = TS[`${g.y}|${g.w}|${g.opp}`];
    const sMe = SAFE[`${g.y}|${g.w}|${g.team}`], sOp = SAFE[`${g.y}|${g.w}|${g.opp}`];
    const e = Z(); e.y = g.y; e.w = g.w;
    if (op) {   // the opponent's defensive TDs and safeties are not points allowed by our defence (Sleeper's definition)
      e.pa = sOp === undefined ? 0 : g.oscore - 6 * (op.dtd + op.frtdd) - 2 * Math.max(0, sOp);
      e.sk = op.sk; e.db = op.db; e.att = op.att; e.fl = op.fl; e.punts = op.punts; e.epa = op.epa; e.plays = op.plays; e.yds = op.yds;
      e.otda = op.dtd + op.frtdd; e.osttda = op.sttd; e.oblka = op.blk; e.osafea = sOp === undefined ? 0 : sOp; e.offa = op.ff;
    }
    if (me) {
      e.intc = me.int; e.ff = me.ff; e.dtd = me.dtd + me.frtdd; e.sttd = me.sttd; e.blk = me.blk; e.safe = sMe === undefined ? 0 : sMe; e.tfl = me.tfl; e.qbh = me.qbh;
      e.opts = sMe === undefined ? 0 : g.score - 6 * (me.dtd + me.frtdd) - 2 * Math.max(0, sMe);
      e.osk = me.sk; e.odb = me.db; e.oatt = me.att; e.oint = me.intt; e.ofl = me.fl; e.oplays = me.plays; e.oepa = me.epa; e.opunts = me.punts; e.oyds = me.yds;
    }
    (REC[g.team] || (REC[g.team] = [])).push(e);
  }
  const N = NORM;
  function teamFeats(t, side) {
    const L = REC[t] || [], cur = L.filter(e => e.y === Y && e.w < W), last = L.filter(e => e.y === Y - 1);
    const S = (a, k) => a.reduce((s, e) => s + e[k], 0);
    const pg = (k, K, K2, lg) => blend(S(cur, k), cur.length, S(last, k), last.length, K, K2, lg);
    const rate = (k, d, K, K2, lg) => blend(S(cur, k), S(cur, d), S(last, k), S(last, d), K, K2, lg);
    const l3 = k => cur.length ? cur.slice(-3).reduce((s, e) => s + e[k], 0) / cur.slice(-3).length : null;
    if (side === 'd') return { d_pa: pg('pa', 4, 8, N.pa), d_skr: rate('sk', 'db', 150, 300, N.skr), d_intr: rate('intc', 'att', 150, 300, N.intr),
      d_fl: pg('fl', 4, 8, N.fl), d_ff: pg('ff', 4, 8, N.ff), d_td: pg('dtd', 8, 16, N.dtd), d_sttd: pg('sttd', 8, 16, N.sttd), d_blk: pg('blk', 8, 16, N.blk),
      d_safe: pg('safe', 8, 16, N.safe), d_punts: pg('punts', 4, 8, N.punts), d_tfl: pg('tfl', 4, 8, N.tfl), d_epa: rate('epa', 'plays', 150, 400, N.epa),
      d_ypp: rate('yds', 'plays', 150, 400, N.ypp), d_qbhr: rate('qbh', 'db', 150, 300, N.qbhr), d_pa_l3: l3('pa'), d_g: cur.length };
    return { o_pts: pg('opts', 4, 8, N.pa), o_skr: rate('osk', 'odb', 150, 300, N.skr), o_intr: rate('oint', 'oatt', 150, 300, N.intr), o_fl: pg('ofl', 4, 8, N.fl),
      o_db: pg('odb', 4, 8, N.db), o_plays: pg('oplays', 4, 8, N.plays), o_epa: rate('oepa', 'oplays', 150, 400, N.epa), o_punts: pg('opunts', 4, 8, N.punts),
      o_ypp: rate('oyds', 'oplays', 150, 400, N.ypp), o_tda: pg('otda', 8, 16, N.dtd), o_sttda: pg('osttda', 8, 16, N.sttd), o_blka: pg('oblka', 8, 16, N.blk),
      o_safea: pg('osafea', 8, 16, N.safe), o_ffa: pg('offa', 4, 8, N.ffa), o_pts_l3: l3('opts') };
  }
  function qbFeats(q, ot) {
    const G = q ? QG[q] : undefined, h = G ? G.filter(e => e.y < Y || (e.y === Y && e.w < W)) : [];
    const S = k => h.reduce((s, e) => s + e[k], 0);
    const db = S('db'), att = S('att');
    const o = { q_db: db, q_db_log: Math.log1p(db), q_skr: (S('sk') + 200 * N.skr) / (db + 200), q_intr: (S('int') + 300 * N.intr) / (att + 300),
      q_epa: S('epa') / (db + 200), q_known: G ? 1 : 0 };
    const cur = (REC[ot] || []).filter(e => e.y === Y && e.w < W);
    const tdb = cur.reduce((s, e) => s + e.odb, 0), mine = h.filter(e => e.y === Y && e.team === ot).reduce((s, e) => s + e.db, 0);
    o.q_share = tdb > 0 ? mine / tdb : null;
    if (cur.length) { const k = cur[cur.length - 1], top = TOPQB[`${k.y}|${k.w}|${ot}`]; o.q_new = top && top.id === q ? 0 : 1; } else o.q_new = null;
    return o;
  }
  const out = [];
  for (const g of SIDE.filter(g => g.y === Y && g.w === W)) {
    const x = { ...teamFeats(g.team, 'd'), ...teamFeats(g.opp, 'o'), ...qbFeats(g.oqb, g.opp),
      opp_itt: g.opp_itt, itt: g.itt, spread: g.spread, total: g.total, home: g.home, dome: ['dome', 'closed'].includes(g.roof) ? 1 : 0, div_game: g.div,
      rest_diff: g.rest !== null && g.orest !== null ? g.rest - g.orest : null, wk: W };
    x.exp_pa = x.d_pa * x.o_pts / N.pa;
    x.exp_sack = x.o_db * x.d_skr * x.o_skr / N.skr;
    x.exp_sack_q = x.o_db * x.d_skr * x.q_skr / N.skr;
    x.exp_int = x.o_db * (1 - x.o_skr) * x.d_intr * x.o_intr / N.intr;
    x.exp_int_q = x.o_db * (1 - x.o_skr) * x.d_intr * x.q_intr / N.intr;
    x.exp_fl = x.d_fl * x.o_fl / N.fl;
    x.exp_td = x.d_td * x.o_tda / N.dtd;
    x.exp_punts = x.d_punts * x.o_punts / N.punts;
    const line = dstLine(x), r6 = v => +(+v).toFixed(6);
    const points = {};
    for (const [ln, sc] of Object.entries(MAP.scorings || {})) { const p = dstPoints(line, sc); points[ln] = { average: r6(p.average), typical: r6(p.typical) }; }
    out.push({ team: app(g.team), opp: app(g.opp), gameday: g.day, x, line: Object.fromEntries(Object.entries(line).map(([k, v]) => [k, r6(v)])), points });
  }
  if (ARGS.out) fs.writeFileSync(ARGS.out, JSON.stringify(out));
  const top = [...out].sort((a, b) => (b.points.dhq || {}).typical - (a.points.dhq || {}).typical).slice(0, 5)
    .map(r => `${r.team} v ${r.opp} ${(r.points.dhq || {}).typical?.toFixed(1)}`).join(', ');
  console.log(`season ${Y} week ${W}: ${out.length} team defenses · top (DHQ league, typical): ${top}`);
}
