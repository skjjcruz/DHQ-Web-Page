// DHQ QB "qb-young" correction (no Sleeper input): a young / low-history QB model S and the weight rule
//   pred = base + w * (S - base),  w = 1 for QBs with <= 10 career starts, 0.25 for other new-team / backup / rookie starters, else 0
// where base = the round-1 QB average (team, opp, stat, rush models). Node 18+, no dependencies.
// Reference implementation of qb2/qb-young/build_young.py + final.py (ship model). Parity: parity.py.
//
// node qb-young-features.mjs --season=2026 --week=9 [--model=qb-young.json] [--cfb=cfb_qb.json] [--rows=rows.csv] [--base=base.csv] [--out=f.json]
//   (DHQ QB stack component "qb-young", QB project, qb2/qb-young; model qb-young.json = qb_young_model_<season>.json.)
//   MODEL_DATA folder:
//     games.csv, players.csv, stats_player_week_<yr>.csv for season-12..season      (the usual nflverse set)
//     combine.csv   NEW: https://github.com/nflverse/nflverse-data/releases/download/combine/combine.csv
//     cfb_qb.json   (--cfb, default MODEL_DATA/cfb_qb.json; the repo keeps it in scripts/models/qb/) college QB seasons (ESPN ids) built once a year by cfb_agg.py + cfb_export.py from
//                   https://github.com/sportsdataverse/cfbfastR-data  player_stats/parquet/player_stats_<yr>.parquet (or csv/)
//   rows: --rows csv (season,week,gsis,team) or the posted starters in games.csv (home_qb_id / away_qb_id) for season/week.
//   --base csv (season,week,gsis,base): when given, also prints pred = base + w*(S-base).
import fs from 'fs';

const ARG = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const Y = +ARG.season, W = +ARG.week;
const D = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
const M = JSON.parse(fs.readFileSync(ARG.model || `qb_young_model_${Y}.json`, 'utf8'));
const HIST = M.hist_seasons, LG = M.league, CO = M.vegas_coef;
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const isNum = v => !(v === '' || v === undefined || v === null || v === 'NA' || v === 'NaN');
const nz = v => isNum(v) ? +v : 0;            // pandas fillna(0)
const nn = v => isNum(v) ? +v : NaN;

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
const readRows = (p, keep) => { const out = []; parseCSV(fs.readFileSync(p, 'utf8'), keep, o => out.push(o)); return out; };

// ---------------------------------------------------------------- games.csv -> team-games (REG)
const TG = new Map();                 // `${season}|${week}|${team}` -> team-game
const starts = [];                    // posted starters {qb, team, season, week, ord}
for (const g of readRows(D + 'games.csv', ['season', 'week', 'game_type', 'home_team', 'away_team', 'total_line', 'spread_line', 'roof', 'wind', 'temp', 'home_qb_id', 'away_qb_id'])) {
  if (g.game_type !== 'REG') continue;
  const s = +g.season, w = +g.week, tot = nn(g.total_line), sp = nn(g.spread_line);
  const dome = (g.roof === 'dome' || g.roof === 'closed') ? 1 : 0;
  for (const home of [1, 0]) {
    const team = fx(home ? g.home_team : g.away_team), opp = fx(home ? g.away_team : g.home_team);
    const sl = home ? sp : -sp;
    const qb = home ? g.home_qb_id : g.away_qb_id;
    TG.set(`${s}|${w}|${team}`, { season: s, week: w, team, opp, home, itt: (tot + sl) / 2, spread: -sl, total: tot, dome,
      wind_f: dome ? 0 : nn(g.wind), temp_f: dome ? 70 : nn(g.temp), qb_id: qb });
    if (isNum(qb)) starts.push({ qb, team, season: s, week: w, ord: s * 100 + w });
  }
}

// ---------------------------------------------------------------- rows
let ROWS = [];
if (ARG.rows) ROWS = readRows(ARG.rows, ['season', 'week', 'gsis', 'team']).map(r => ({ season: +r.season, week: +r.week, gsis: r.gsis, team: fx(r.team) })).filter(r => r.season === Y && (!W || r.week === W));
else for (const t of TG.values()) if (t.season === Y && t.week === W && isNum(t.qb_id)) ROWS.push({ season: Y, week: W, gsis: t.qb_id, team: t.team });

// ---------------------------------------------------------------- starter status (posted starters, all seasons in games.csv)
const wk1 = new Map(), cnt = new Map();
for (const s of [...starts].sort((a, b) => a.ord - b.ord)) {
  const k = `${s.team}|${s.season}`; if (!wk1.has(k)) wk1.set(k, s.qb);
  const kk = `${k}|${s.qb}`; const c = cnt.get(kk) || { n: 0, w0: 99, qb: s.qb, k }; c.n++; c.w0 = Math.min(c.w0, s.week); cnt.set(kk, c);
}
const lyMain = new Map();
for (const c of cnt.values()) { const b = lyMain.get(c.k); if (!b || c.n > b.n || (c.n === b.n && c.w0 < b.w0)) lyMain.set(c.k, c); }
function starter(r) {
  const ord = r.season * 100 + r.week; let car = 0, cur = 0, ly = 0;
  for (const s of starts) {
    if (s.qb !== r.gsis) continue;
    if (s.ord < ord) car++;
    if (s.team === r.team && s.season === r.season && s.ord < ord) cur++;
    if (s.team === r.team && s.season === r.season - 1) ly++;
  }
  const isWk1 = wk1.get(`${r.team}|${r.season}`) === r.gsis;
  const m = lyMain.get(`${r.team}|${r.season - 1}`); const isLy = !!m && m.qb === r.gsis;
  return { car_starts: car, starts_team_cur: cur, backup_start: (!isWk1 && !isLy && cur + ly < 4) ? 1 : 0 };
}

// ---------------------------------------------------------------- QB weekly stats, seasons Y-HIST..Y
const SC = ['completions', 'attempts', 'passing_yards', 'passing_tds', 'passing_interceptions', 'sacks_suffered', 'carries', 'rushing_yards', 'rushing_tds', 'fantasy_points'];
const byQB = new Map();
for (let y = Y - HIST; y <= Y; y++) {
  const f = D + `stats_player_week_${y}.csv`; if (!fs.existsSync(f)) continue;
  for (const r of readRows(f, ['player_id', 'position', 'season', 'week', 'season_type', 'team', ...SC])) {
    if (r.season_type !== 'REG' || r.position !== 'QB') continue;
    const o = { season: +r.season, week: +r.week, team: fx(r.team) }; o.ord = o.season * 100 + o.week;
    for (const c of SC) o[c] = nz(r[c]);
    if (!byQB.has(r.player_id)) byQB.set(r.player_id, []); byQB.get(r.player_id).push(o);
  }
}
function history(r) {
  const ord = r.season * 100 + r.week, L = byQB.get(r.gsis) || [];
  const a = { qg: 0, relief: 0, att: 0, pyd: 0, ptd: 0, int: 0, sk: 0, att_q: 0, car_q: 0, ryd_q: 0, rtd_q: 0, fp_q: 0, o_q: 0 };
  let lastLy = null, hadPrev = 0;
  for (const g of L) {
    if (g.season < r.season) hadPrev = 1;
    if (g.season === r.season - 1 && (!lastLy || g.ord > lastLy.ord)) lastLy = g;
    if (g.ord >= ord) continue;
    const qg = g.attempts >= 15 ? 1 : 0;
    a.qg += qg; a.relief += (g.attempts > 0 && g.attempts < 15) ? 1 : 0;
    a.att += g.attempts; a.pyd += g.passing_yards; a.ptd += g.passing_tds; a.int += g.passing_interceptions; a.sk += g.sacks_suffered;
    if (qg) {
      a.att_q += g.attempts; a.car_q += g.carries; a.ryd_q += g.rushing_yards; a.rtd_q += g.rushing_tds; a.fp_q += g.fantasy_points;
      const t = TG.get(`${g.season}|${g.week}|${g.team}`);
      const e = t ? CO[0] + CO[1] * t.itt + CO[2] * t.spread + CO[3] * t.total : NaN;
      const o = g.fantasy_points - e; a.o_q += Number.isFinite(o) ? o : 0;
    }
  }
  return {
    n_qg: a.qg, n_relief: a.relief,
    l_ypa: (a.pyd + 250 * LG.ypa) / (a.att + 250), l_tdr: (a.ptd + 300 * LG.tdr) / (a.att + 300), l_intr: (a.int + 300 * LG.intr) / (a.att + 300),
    l_skr: (a.sk + 150 * LG.skr) / (a.att + a.sk + 150), l_rypg: (a.ryd_q + 4 * LG.rypg) / (a.qg + 4), l_rapg: (a.car_q + 4 * LG.rapg) / (a.qg + 4),
    l_rtdpg: (a.rtd_q + 8 * LG.rtdpg) / (a.qg + 8), l_fppg: (a.fp_q + 4 * LG.fppg) / (a.qg + 4), l_attpg: (a.att_q + 4 * LG.attpg) / (a.qg + 4),
    own_k8: a.o_q / (a.qg + 8), team_ly: lastLy ? lastLy.team : null, had_prev: hadPrev,
  };
}

// ---------------------------------------------------------------- players, combine, college
const nmz = s => (s || '').toLowerCase().replace(/[^a-z]/g, '');
const PL = new Map();
for (const p of readRows(D + 'players.csv', ['gsis_id', 'display_name', 'espn_id', 'pfr_id', 'draft_year', 'rookie_season'])) if (!PL.has(p.gsis_id)) PL.set(p.gsis_id, p);
const byPfr = new Map(), byNm = new Map();
for (const c of readRows(D + 'combine.csv', ['season', 'pfr_id', 'player_name', 'pos', 'ht', 'wt', 'forty'])) {
  if (c.pos !== 'QB') continue;
  const m = /^(\d+)-(\d+)$/.exec(c.ht || ''); const v = { forty: nn(c.forty), wt: nn(c.wt), cb_ht: m ? +m[1] * 12 + +m[2] : NaN };
  if (isNum(c.pfr_id) && !byPfr.has(c.pfr_id)) byPfr.set(c.pfr_id, v);
  const k = `${nmz(c.player_name)}|${+c.season}`; if (!byNm.has(k)) byNm.set(k, v);
}
function combine(p) {
  if (!p) return { forty: NaN, wt: NaN, cb_ht: NaN };
  if (isNum(p.pfr_id) && byPfr.has(p.pfr_id)) return byPfr.get(p.pfr_id);
  for (const yy of [p.draft_year, p.rookie_season]) if (isNum(yy)) { const k = `${nmz(p.display_name)}|${Math.trunc(+yy)}`; if (byNm.has(k)) return byNm.get(k); }
  return { forty: NaN, wt: NaN, cb_ht: NaN };
}
const CFB = JSON.parse(fs.readFileSync(ARG.cfb || D + 'cfb_qb.json', 'utf8')).players;
function college(p, y) {
  const none = { cc_ypa: NaN, cl_rypg: NaN, cl_rapg: NaN, cc_att: NaN, cl_fppg: NaN, cl_intr: NaN };
  if (!p || !isNum(p.espn_id)) return none;
  const s = (CFB[String(Math.trunc(+p.espn_id))] || []).filter(x => x[0] < y); if (!s.length) return none;
  const c = s.reduce((a, x) => a.map((v, i) => v + x[i]), new Array(11).fill(0)), l = s[s.length - 1];
  return { cc_ypa: c[4] / c[2], cc_att: c[2], cl_rypg: l[8] / l[1], cl_rapg: l[7] / l[1],
    cl_fppg: (0.04 * l[4] + 4 * l[5] - 2 * l[6] + 0.1 * l[8] + 6 * l[9]) / l[1], cl_intr: l[6] / l[2] };
}

// ---------------------------------------------------------------- LightGBM ensemble (compact trees)
function tree(n, x) {
  while (Array.isArray(n)) {
    const [f, thr, mt, dl, L, R] = n; let v = x[f];
    if (mt === 1 && Number.isNaN(v)) { n = dl ? L : R; continue; }
    if (Number.isNaN(v)) v = 0;
    if (mt === 2 && v === 0) { n = dl ? L : R; continue; }
    n = v <= thr ? L : R;
  }
  return n;
}
const predictS = x => M.ensemble.reduce((s, trees) => s + trees.reduce((t, tr) => t + tree(tr, x), 0), 0) / M.ensemble.length;

// ---------------------------------------------------------------- assemble
const BASE = new Map();
if (ARG.base) for (const b of readRows(ARG.base, ['season', 'week', 'gsis', 'base'])) BASE.set(`${b.season}|${b.week}|${b.gsis}`, +b.base);
const out = [];
for (const r of ROWS) {
  const t = TG.get(`${r.season}|${r.week}|${r.team}`) || {};
  const h = history(r), st = starter(r), p = PL.get(r.gsis), cb = combine(p), co = college(p, r.season);
  const rs = p && isNum(p.rookie_season) ? +p.rookie_season : (p && isNum(p.draft_year) ? +p.draft_year : NaN);
  const rookie = Number.isNaN(rs) ? (h.had_prev ? 0 : 1) : (r.season - rs <= 0 ? 1 : 0);
  const new_team = h.team_ly && h.team_ly !== r.team ? 1 : 0;
  const f = { itt: t.itt, spread: t.spread, total: t.total, home: t.home, dome: t.dome, wind_f: t.wind_f, temp_f: t.temp_f,
    ...h, ...st, ...cb, ...co, new_team, rookie };
  const x = M.features.map(k => (f[k] === undefined || f[k] === null) ? NaN : +f[k]);
  const S = predictS(x);
  const w = f.car_starts <= 10 ? M.weights.car_starts_le10 : ((new_team || f.backup_start || rookie) ? M.weights.other_new_team_backup_rookie : M.weights.else);
  const o = { season: r.season, week: r.week, gsis: r.gsis, team: r.team, S: +S.toFixed(4), w };
  const b = BASE.get(`${r.season}|${r.week}|${r.gsis}`);
  if (b !== undefined) o.pred = +(b + w * (S - b)).toFixed(4);
  M.features.forEach((k, i) => { o[k] = x[i]; });
  out.push(o);
}
if (ARG.out) fs.writeFileSync(ARG.out, JSON.stringify(out));
else for (const o of out) console.log([o.gsis, o.team, 'S', o.S, 'w', o.w, o.pred !== undefined ? 'pred ' + o.pred : ''].join(' '));
console.error(`qb-young ${Y} wk${W}: ${out.length} rows`);
