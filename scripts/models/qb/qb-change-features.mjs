// qb-change: Node reference implementation (no dependencies) of the QB "update-speed" layer.
// pred = base + adj, base = the round-1 QB number (average of the team/opp/stat/rush models' typical number),
// adj = sum_j coef_j * (x_j - mu_j) / sd_j over two point-in-time inputs (games before week W only):
//   trend   = (ppg_cur - ppg_ly) * g_cur / (g_cur + k_games)        (0 if either is missing, clip +-10)
//   qepa_tr = (epa_cur - epa_ly) * db_cur / (db_cur + k_db)          (0 if either is missing, clip +-0.5)
// ppg = half-PPR mean over the QB's qualifying games (attempts >= 15, or most attempts on his team), this season before W /
// all of last season (any team); epa = sum passing_epa / sum(attempts + sacks_suffered) over the same games. REG season only.
// Files (MODEL_DATA = nflverse download folder, same names as nflverse): stats_player_week_<yr>.csv for season-1 and season.
//
// node qb-change-features.mjs --season=2026 --week=8 --model=qb-change.json [--rows=rows.csv] [--out=f.json]
//   (DHQ QB stack component "qb-change", QB project, qb2/qb-change; one fit per season, fits[season] = seasons before it.)
//   --rows: optional CSV with season,week,gsis[,base] — compute exactly those rows (base -> also returns pred);
//   default: every QB with a qualifying game this season or last season, for --week.
import fs from 'fs';

const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const D = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
const M = JSON.parse(fs.readFileSync(A.model || new URL('./qb-change.json', import.meta.url), 'utf8'));

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
const num = v => (v === '' || v === undefined || v === 'NA') ? 0 : +v;
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const FPC = ['receptions', 'receiving_yards', 'receiving_tds', 'rushing_yards', 'rushing_tds', 'receiving_fumbles_lost', 'rushing_fumbles_lost',
  'sack_fumbles_lost', 'receiving_2pt_conversions', 'rushing_2pt_conversions', 'passing_2pt_conversions', 'passing_yards', 'passing_tds',
  'passing_interceptions'];
const KEEP = ['player_id', 'position', 'season', 'week', 'season_type', 'team', 'attempts', 'sacks_suffered', 'passing_epa', ...FPC];

// qualifying QB games of a season: {gsis -> [{week, fp, epa, db}]}
function qbGames(y) {
  const path = D + `stats_player_week_${y}.csv`; if (!fs.existsSync(path)) return {};
  const R = readCSV(path, KEEP).filter(r => r.season_type === 'REG');
  const tmMax = {};
  for (const r of R) if (r.position === 'QB') { const k = fx(r.team) + '|' + r.week; tmMax[k] = Math.max(tmMax[k] ?? 0, num(r.attempts)); }
  const out = {};
  for (const r of R) {
    if (r.position !== 'QB') continue;
    const att = num(r.attempts), mx = tmMax[fx(r.team) + '|' + r.week] ?? 0;
    if (!(att >= 15 || (att === mx && att > 0))) continue;
    const z = c => num(r[c]);
    const fp = z('receptions') * .5 + z('receiving_yards') * .1 + z('receiving_tds') * 6 + z('rushing_yards') * .1 + z('rushing_tds') * 6
      - 2 * (z('receiving_fumbles_lost') + z('rushing_fumbles_lost') + z('sack_fumbles_lost'))
      + 2 * (z('receiving_2pt_conversions') + z('rushing_2pt_conversions') + z('passing_2pt_conversions'))
      + z('passing_yards') * .04 + z('passing_tds') * 4 - z('passing_interceptions');
    (out[r.player_id] ||= []).push({ week: +r.week, fp, epa: z('passing_epa'), db: att + z('sacks_suffered') });
  }
  for (const k in out) { const seen = new Set(); out[k] = out[k].filter(g => !seen.has(g.week) && seen.add(g.week)); }
  return out;
}

const cache = {};
const G = y => (cache[y] ||= qbGames(y));

function features(gsis, season, week) {
  const cur = (G(season)[gsis] || []).filter(g => g.week < week), ly = G(season - 1)[gsis] || [];
  const sum = (a, k) => a.reduce((s, x) => s + x[k], 0);
  const g_cur = cur.length, db_cur = sum(cur, 'db');
  const ppg_cur = g_cur ? sum(cur, 'fp') / g_cur : NaN, ppg_ly = ly.length ? sum(ly, 'fp') / ly.length : NaN;
  const epa_cur = db_cur > 0 ? sum(cur, 'epa') / db_cur : NaN, dbl = sum(ly, 'db'), epa_ly = dbl > 0 ? sum(ly, 'epa') / dbl : NaN;
  const clip = (v, a) => Math.max(-a, Math.min(a, v));
  const trend = Number.isFinite(ppg_cur - ppg_ly) ? clip((ppg_cur - ppg_ly) * g_cur / (g_cur + M.k_games), 10) : 0;
  const qepa_tr = Number.isFinite(epa_cur - epa_ly) ? clip((epa_cur - epa_ly) * db_cur / (db_cur + M.k_db), 0.5) : 0;
  const fit = M.fits[String(season)] || M.fits[String(Math.max(...Object.keys(M.fits).map(Number)))];
  const x = { trend, qepa_tr };
  const adj = M.features.reduce((s, f, j) => s + fit.coef[j] * (x[f] - fit.mu[j]) / fit.sd[j], 0);
  return { gsis, season, week, trend, qepa_tr, adj, g_cur, ppg_cur, ppg_ly, epa_cur, epa_ly, db_cur };
}

let rows;
if (A.rows) rows = readCSV(A.rows, ['season', 'week', 'gsis', 'base']).map(r => ({ season: +r.season, week: +r.week, gsis: r.gsis, base: r.base === '' ? null : +r.base }));
else {
  const Y = +A.season, W = +A.week;
  const ids = new Set([...Object.keys(G(Y)), ...Object.keys(G(Y - 1))]);
  rows = [...ids].map(g => ({ season: Y, week: W, gsis: g, base: null }));
}
const out = rows.map(r => { const f = features(r.gsis, r.season, r.week); if (r.base != null) f.pred = r.base + f.adj; return f; });
const js = JSON.stringify(out, (k, v) => (typeof v === 'number' && !Number.isFinite(v)) ? null : v);
if (A.out) fs.writeFileSync(A.out, js); else process.stdout.write(js + '\n');
