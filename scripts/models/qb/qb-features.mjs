// ══════════════════════════════════════════════════════════════════
// scripts/models/qb/qb-features.mjs — DHQ's stand-alone QB projection
//
// Owner ruling (2026-11-02): DHQ's QB number must not use Sleeper's
// projection (it used to be anchored on Sleeper's line, "Market check").
// Six component models built by the QB project (notes: qb2/), each
// a Node builder + model JSON in this folder, all from free nflverse data:
//   qb-team    Vegas team total -> team TDs / yards -> the QB's share
//   qb-stat    GLM chain for every stat + a joint simulation
//   qb-ml      component LightGBM (pass yd/TD, INT, rush yd/TD, ...)
//   qb-rush    rushing-first stat line (designed runs, scrambles, goal line;
//              needs nflverse play-by-play)
//   qb-young   a young / low-history QB model and how much to trust it
//   qb-change  this season vs last season (points a game, EPA a dropback)
// The stack (chosen on 2021-24 by the lowest average miss; QB project
// notes, qb2/om/final.py, "ship4 mean, young ship, + change"):
//   b       = mean(qb-team typical, qb-stat average, qb-ml average, qb-rush average)
//   typical = b + w x (S - b) + adj      (qb-young S and w; qb-change adj)
// Out of sample vs Sleeper (half-PPR, starters Sleeper projects 10+):
// 2023-24 52.8% (miss 5.525 vs 5.678), 2025-26 53.8% (5.778 vs 5.883).
// The stat line (for each league's scoring) is the mean of qb-stat's and
// qb-ml's calibrated expected stats, its yardage / TD / first-down parts
// scaled so the half-PPR total equals the typical number.
//
// node qb-features.mjs --season=2026 --week=9 [--models=dir] [--active=roster] [--out=rows.json]
//   MODEL_DATA = the weekly job's nflverse folder (scripts/build-wr-model-snapshot.mjs): games.csv, players.csv,
//   stats_player_week_<yr>.csv (2012..season), snap_counts_<season-1, season>.csv, injuries_<season>.csv,
//   depth_charts_<season>.csv, roster_weekly_<season>.csv, play_by_play_<yr>.csv.gz (qb-rush; completed seasons
//   may be summarised in qb-rush-cache/ instead), combine.csv (qb-young).
//   --models: folder holding qb-team.json, qb-stat.json, qb-ml.json, qb-rush.json, qb-young.json, qb-change.json and
//   cfb_qb.json (default: this folder; backtests point it at the fits of an earlier season).
// The starter of each team (one per team playing): games.csv's posted QB unless he is Out/Doubtful on the week's
// injury report or off the team's latest posted roster (ACT/INA) at or before the week, then the top such QB on the
// ESPN depth chart before game day. Every component scores that same QB.
// ══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const Y = +A.season, W = +A.week;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const MDIR = path.resolve(A.models || HERE);
const D = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');

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
const has = v => !(v === '' || v === undefined || v === null || v === 'NA');
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const fin = v => typeof v === 'number' && Number.isFinite(v);

// ── this week's games
const GM = {};
for (const r of readCSV(D + 'games.csv', ['season', 'game_type', 'week', 'gameday', 'home_team', 'away_team', 'spread_line', 'total_line', 'home_qb_id', 'away_qb_id'])) {
    if (r.game_type !== 'REG' || +r.season !== Y || +r.week !== W) continue;
    const h = fx(r.home_team), a = fx(r.away_team), ok = has(r.total_line) && has(r.spread_line), tot = +r.total_line, spr = +r.spread_line;
    GM[h] = { day: r.gameday, opp: a, itt: ok ? (tot + spr) / 2 : null, qb: has(r.home_qb_id) ? r.home_qb_id : null };
    GM[a] = { day: r.gameday, opp: h, itt: ok ? (tot - spr) / 2 : null, qb: has(r.away_qb_id) ? r.away_qb_id : null };
}
// ── injury report (Out / Doubtful), latest posted roster, depth chart
const INJ = {};
if (fs.existsSync(D + `injuries_${Y}.csv`)) for (const r of readCSV(D + `injuries_${Y}.csv`, ['season', 'week', 'gsis_id', 'report_status'])) {
    if (+r.season !== Y || +r.week !== W || !r.gsis_id) continue;
    INJ[r.gsis_id] = { Questionable: 1, Doubtful: 2, Out: 3 }[r.report_status] || 0;
}
let onRoster = () => true;
if (A.active !== 'snaps' && fs.existsSync(D + `roster_weekly_${Y}.csv`)) {
    const RO = readCSV(D + `roster_weekly_${Y}.csv`, ['season', 'week', 'game_type', 'team', 'gsis_id', 'position', 'status']).filter(r => r.game_type === 'REG' && +r.season === Y && +r.week <= W);
    const rW = {}; for (const r of RO) rW[fx(r.team)] = Math.max(rW[fx(r.team)] || 0, +r.week);
    const S = new Set(RO.filter(r => +r.week === rW[fx(r.team)] && (r.status === 'ACT' || r.status === 'INA') && r.position === 'QB' && r.gsis_id).map(r => r.gsis_id));
    onRoster = g => S.has(g);
}
let DEPTH = null;
function depthQBs(t) {
    if (!DEPTH) {
        DEPTH = {};
        if (fs.existsSync(D + `depth_charts_${Y}.csv`)) for (const r of readCSV(D + `depth_charts_${Y}.csv`, ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank'])) {
            if (r.pos_abb !== 'QB' || !r.gsis_id) continue;
            (DEPTH[fx(r.team)] || (DEPTH[fx(r.team)] = [])).push({ d: String(r.dt).slice(0, 10), g: r.gsis_id, k: +r.pos_rank });
        }
    }
    const rows = (DEPTH[t] || []).filter(r => r.d < GM[t].day); if (!rows.length) return [];
    const d = rows.map(r => r.d).sort().pop();
    return rows.filter(r => r.d === d).sort((p, q) => p.k - q.k).map(r => r.g);
}
const ok = g => g && !(INJ[g] >= 2) && onRoster(g);
const START = {};
for (const t of Object.keys(GM).sort()) {
    if (ok(GM[t].qb)) { START[t] = { g: GM[t].qb, src: 'games.csv' }; continue; }
    const d = depthQBs(t).find(ok);
    if (d) START[t] = { g: d, src: 'depth chart' };
}
const PL = {};
for (const r of readCSV(D + 'players.csv', ['gsis_id', 'display_name'])) if (r.gsis_id) PL[r.gsis_id] = r.display_name;

// ── the six components, each scoring the same starters
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dhq-qb-'));
const rowsCsv = path.join(TMP, 'starters.csv');
fs.writeFileSync(rowsCsv, 'season,week,gsis,team\n' + Object.entries(START).map(([t, s]) => [Y, W, s.g, t].join(',')).join('\n') + '\n');
const M = f => path.join(MDIR, f), common = ['--season=' + Y, '--week=' + W, '--rows=' + rowsCsv];
const JOBS = {
    team: ['qb-team-features.mjs', '--model=' + M('qb-team.json')],
    stat: ['qb-stat-features.mjs', '--model=' + M('qb-stat.json'), '--active=roster'],
    ml: ['qb-ml-features.mjs', '--model=' + M('qb-ml.json'), '--active=roster'],
    rush: ['qb-rush-features.mjs', '--model=' + M('qb-rush.json')],
    young: ['qb-young-features.mjs', '--model=' + M('qb-young.json'), '--cfb=' + M('cfb_qb.json')],
    change: ['qb-change-features.mjs', '--model=' + M('qb-change.json')],
};
const R = {};
await Promise.all(Object.entries(JOBS).map(async ([k, [file, ...args]]) => {
    const out = path.join(TMP, k + '.json');
    try {
        await run(process.execPath, ['--max-old-space-size=4096', path.join(HERE, file), ...common, ...args, '--out=' + out],
            { env: Object.assign({}, process.env, { MODEL_DATA: D }), maxBuffer: 64 << 20 });
        const j = JSON.parse(fs.readFileSync(out, 'utf8'));
        R[k] = {}; for (const r of (Array.isArray(j) ? j : j.rows)) R[k][r.gsis] = r;
    } catch (e) { console.error('qb ' + k + ' skipped: ' + String(e.stderr || e.message || e).slice(0, 300)); R[k] = {}; }
}));
fs.rmSync(TMP, { recursive: true, force: true });

// ── the stack and the stat line
// line keys are Sleeper scoring keys; volumes (attempts) ride along unscaled
const LINE = { pass_yd: 'E_pass_yd', pass_td: 'E_pass_td', pass_int: 'E_int', pass_sack: 'E_sack', rush_yd: 'E_rush_yd', rush_td: 'E_rush_td',
    fum_lost: 'E_fum', pass_fd: 'E_pass_fd', rush_fd: 'E_rush_fd', pass_2pt: 'E_2pt' };
const SCALE = ['pass_yd', 'pass_td', 'rush_yd', 'rush_td', 'pass_fd', 'rush_fd'];
const half = l => .04 * l.pass_yd + 4 * l.pass_td - l.pass_int + .1 * l.rush_yd + 6 * l.rush_td - 2 * l.fum_lost + 2 * l.pass_2pt;
const mean = a => { const v = a.filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
const out = [];
for (const [t, s] of Object.entries(START)) {
    const g = s.g, c = { team: R.team[g], stat: R.stat[g], ml: R.ml[g], rush: R.rush[g], young: R.young[g], change: R.change[g] };
    const parts = { team: c.team && c.team.pred, stat: c.stat && c.stat.pred_mean, ml: c.ml && c.ml.pred_mean, rush: c.rush && c.rush.pred_mean };
    const b = mean(Object.values(parts));
    if (b == null) continue;
    const S = c.young && fin(c.young.S) ? c.young.S : null, w = c.young && fin(c.young.w) ? c.young.w : 0;
    const adj = c.change && fin(c.change.adj) ? c.change.adj : 0;
    const typical = b + (S != null ? w * (S - b) : 0) + adj;
    // stat line: qb-stat and qb-ml (both calibrated); either alone if the other is missing, else qb-rush / qb-team
    const src = [c.stat, c.ml].filter(Boolean).length ? [c.stat, c.ml].filter(Boolean) : [c.rush, c.team].filter(Boolean);
    const line = {};
    for (const [k, e] of Object.entries(LINE)) line[k] = mean(src.map(r => r[e])) ?? 0;
    const pts = .04 * line.pass_yd + 4 * line.pass_td + .1 * line.rush_yd + 6 * line.rush_td, fixed = half(line) - pts;
    const k = pts > 0 ? Math.min(2, Math.max(0.3, (typical - fixed) / pts)) : 1;
    for (const key of SCALE) line[key] *= k;
    if (c.stat && fin(c.stat.E_pass_att)) line.pass_att = c.stat.E_pass_att;
    if (c.stat && fin(c.stat.E_rush_att)) line.rush_att = c.stat.E_rush_att;
    const r3 = v => fin(v) ? +v.toFixed(3) : null;
    out.push({ season: Y, week: W, gsis: g, name: PL[g] || (c.stat && c.stat.name) || '', team: t, opp: GM[t].opp, src: s.src, itt: r3(GM[t].itt),
        typical: r3(typical), mean: r3(half(line)), line: Object.fromEntries(Object.entries(line).map(([kk, v]) => [kk, r3(v)])),
        parts: { team: r3(parts.team), stat: r3(parts.stat), ml: r3(parts.ml), rush: r3(parts.rush), b: r3(b), S: r3(S), w, adj: r3(adj) } });
}
const js = JSON.stringify(out);
if (A.out) fs.writeFileSync(A.out, js); else process.stdout.write(js + '\n');
console.error(`qb ${Y} wk${W}: ${out.length} starters (${Object.keys(START).length} teams; ` + Object.entries(R).map(([k, v]) => k + ' ' + Object.keys(v).length).join(', ') + ')');
