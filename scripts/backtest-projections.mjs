// Backtest the DHQ projection engine against what actually happened.
//
//   node scripts/backtest-projections.mjs                  # weeks 1..(current-1), default tune
//   node scripts/backtest-projections.mjs --weeks 3-5
//   DHQ_TUNE='{"medTdRb":0}' node scripts/backtest-projections.mjs --name rb-nocut
//   DHQ_NORM='{"RB":{"K":30}}' node scripts/backtest-projections.mjs --name rb-k30
//
// Replays a past week the way build-projections-lock.mjs --reconstruct does
// (season stats from earlier weeks only, the same public feeds), runs the
// engine once for the half-PPR default scoring, and writes one row per
// graded player: what DHQ said (typical and average week), what Sleeper
// said, and what he scored. Every fetch is cached on disk under
// scripts/.backtest-cache so two runs with different tunes see identical
// inputs; depth charts and injury tags are today's, which is the one thing
// a replay cannot recover, so compare variants to each other, not to the
// locks. Output: scripts/.backtest-out/<name>/w<week>.json. Reads
// scripts/compare-backtests.mjs for the scorecard. Never touches data/locks.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const R = (p) => require(path.join(ROOT, p));

const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const NAME = flag('--name', 'base');
const CACHE = path.join(ROOT, 'scripts/.backtest-cache');
const OUT = path.join(ROOT, 'scripts/.backtest-out', NAME);

// ── disk cache around fetch: identical inputs for every variant ────
const realFetch = globalThis.fetch;
await mkdir(CACHE, { recursive: true });
globalThis.fetch = async (url, init) => {
    const method = (init && init.method) || 'GET';
    if (method !== 'GET') return realFetch(url, init);
    const key = createHash('sha1').update(String(url)).digest('hex');
    const file = path.join(CACHE, key + '.json');
    try {
        const rec = JSON.parse(await readFile(file, 'utf8'));
        return new Response(rec.body, { status: rec.status, headers: { 'content-type': rec.type || 'application/json' } });
    } catch (e) { /* miss */ }
    const r = await realFetch(url, init);
    const body = await r.text();
    await writeFile(file, JSON.stringify({ url: String(url), status: r.status, type: r.headers.get('content-type'), body }));
    return new Response(body, { status: r.status, headers: { 'content-type': r.headers.get('content-type') || 'application/json' } });
};

// ── the browser bits the shared modules expect (as the lock script) ──
global.window = globalThis;
const store = {}; globalThis.sessionStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
globalThis.App = globalThis.App || {};
App.POS_GROUPS = { QB: ['QB'], RB: ['RB', 'FB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], DL: ['DE', 'DT', 'NT', 'DL'], LB: ['LB', 'OLB', 'ILB', 'MLB'], DB: ['CB', 'S', 'SS', 'FS', 'DB'] };
App.normPos = (p) => { for (const [g, l] of Object.entries(App.POS_GROUPS)) if (l.includes(p)) return g; return p; };
App.calcRawPts = (line, sc) => { let t = 0; for (const [k, v] of Object.entries(sc || {})) if (line && Number.isFinite(line[k])) t += line[k] * v; return t; };
globalThis.calcFantasyPts = (line, sc) => App.calcRawPts(line, sc);
App.calcPPG = (st, sc) => st && st.gp > 0 ? App.calcRawPts(st, sc) / st.gp : 0;
// tunes are read when matchup-inputs.js loads
if (process.env.DHQ_TUNE) globalThis.__DHQ_TUNE = JSON.parse(process.env.DHQ_TUNE);
R('js/shared/startsit-engine.js'); R('js/shared/weekly-proj.js'); R('js/utils/sos-engine.js'); try { R('js/shared/nfl-context.js'); } catch (e) { /* optional */ }
R('js/shared/matchup-engine.js'); R('js/shared/dhq-baseline.js'); R('js/shared/matchup-feeds-espn.js'); R('js/shared/matchup-inputs.js');
globalThis.DhqPffMatchup = R('data/pff-matchup-snapshot.js');
globalThis.DhqUsage = R('data/usage-snapshot.js');
// baseline norms are a live object: deep-merge overrides into it
if (process.env.DHQ_NORM) {
    const merge = (dst, src) => { for (const [k, v] of Object.entries(src)) { if (v && typeof v === 'object' && !Array.isArray(v) && dst[k] && typeof dst[k] === 'object') merge(dst[k], v); else dst[k] = v; } };
    merge(App.DhqBaseline.NORM, JSON.parse(process.env.DHQ_NORM));
}

const UA = { headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' } };
async function J(u, tries = 3) { for (let i = 1; i <= tries; i++) { try { const r = await fetch(u, UA); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return await r.json(); } catch (e) { if (i === tries) throw e; await new Promise(res => setTimeout(res, 800 * i)); } } }
const SL = 'https://api.sleeper.app/v1';
const ESPN_TO_SLEEPER = { WSH: 'WAS', LA: 'LAR', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
const code = (a) => { a = String(a || '').toUpperCase(); return ESPN_TO_SLEEPER[a] || a; };
const DEFAULT_SCORING = { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2,
    fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, fgmiss: -1, xpm: 1, xpmiss: -1,
    idp_tkl_solo: 1, idp_tkl_ast: 0.5, idp_tkl_loss: 1, idp_sack: 2, idp_qb_hit: 1, idp_int: 3, idp_pass_def: 1, idp_ff: 2, idp_fum_rec: 2, idp_def_td: 6, idp_safe: 2, idp_blk_kick: 2 };
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'];

async function runWeek(season, week, players, prior, roles) {
    const [proj, seasonFull, box] = await Promise.all([
        J(SL + '/projections/nfl/regular/' + season + '/' + week), J(SL + '/stats/nfl/regular/' + season), J(SL + '/stats/nfl/regular/' + season + '/' + week)]);
    const weekly = []; for (let w = 1; w < week; w++) weekly.push(await J(SL + '/stats/nfl/regular/' + season + '/' + w) || {});
    const statsCur = {};
    for (const wk of weekly) for (const [pid, row] of Object.entries(wk)) { const acc = statsCur[pid] = statsCur[pid] || {}; for (const [k, v] of Object.entries(row)) if (typeof v === 'number') acc[k] = (acc[k] || 0) + v; }
    for (const [k, row] of Object.entries(seasonFull || {})) if (k.startsWith('TEAM_') && row.gp === weekly.length) statsCur[k] = row;
    // players are a shared object across weeks: reset the injury tag each week
    for (const p of Object.values(players)) { if (p.__inj !== undefined) p.injury_status = p.__inj; else p.__inj = p.injury_status || null; }
    for (const [pid, st] of Object.entries(box || {})) { const p = players[pid]; if (p && st && st.gp >= 1 && p.injury_status) p.injury_status = null; }
    globalThis.S = { season, nflState: { season: String(season), week }, weeklyPlayerPoints: {}, players };
    for (let w = 1; w < week; w++) { S.weeklyPlayerPoints[w] = {}; for (const [pid, s] of Object.entries(weekly[w - 1])) S.weeklyPlayerPoints[w][pid] = +App.calcRawPts(s, DEFAULT_SCORING).toFixed(2); }
    App.WeeklyProj.setProjections(week, proj || {});
    try {
        const sb = await J('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=' + week + '&seasontype=2&dates=' + season);
        if (App.NflContext && App.NflContext.parse) App.WeeklyProj.setContext({ byTeamWeek: App.NflContext.parse(sb, week) });
    } catch (e) { console.warn('scoreboard unavailable: ' + e.message); }
    const espnName = (n) => String(n || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\.?$/g, '').replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const nameOf = (p) => (p.full_name || ((p.first_name || '') + ' ' + (p.last_name || ''))).trim();
    const pids = Object.keys(players).filter(pid => {
        const p = players[pid];
        if (!p || !p.team || !POS.includes(App.MatchupInputs.posGroup(p))) return false;
        if (App.WeeklyProj.projLine(pid, week)) return true;
        const st = statsCur[pid]; if (st && st.gp >= 1) return true;
        const r = roles[String(p.team).toUpperCase() + '|' + espnName(nameOf(p))];
        return !!(r && r.rank <= 3);
    });
    const opts = { playersData: players, statsData: statsCur, priorData: prior || {}, scoring: DEFAULT_SCORING, season, baselineMode: 'dhq' };
    const res = await App.MatchupInputs.projectRoster(pids, week, opts);
    const rows = [];
    for (const pid of pids) {
        const p = res.projections[pid]; if (!p) continue;
        const st = box && box[pid];
        const actual = st ? +App.calcRawPts(st, DEFAULT_SCORING).toFixed(2) : null;
        const played = !!(st && ((st.gp || 0) > 0 || (st.off_snp || 0) > 0 || actual));
        rows.push({ pid, name: nameOf(players[pid]), pos: p.position, team: p.team, opp: p.opponentAbbr || null,
            median: p.points.median, mean: p.points.mean != null ? p.points.mean : p.points.median, typical: p.points.typical != null ? p.points.typical : p.points.median, sleeper: p.sleeper != null ? +p.sleeper.toFixed(2) : null,
            actual, played, line: (p.input && p.input.baseline && p.input.baseline.line) || null, why: p.baseline && p.baseline.why ? p.baseline.why : null,
            role: p.input && p.input.role ? p.input.role : null });
    }
    return rows;
}

async function main() {
    const state = await J(SL + '/state/nfl');
    const season = Number(state.season) || new Date().getUTCFullYear();
    const nflWeek = Number(state.week) || 1;
    const range = flag('--weeks', '1-' + (nflWeek - 1)).split('-').map(Number);
    const weeks = []; for (let w = range[0]; w <= (range[1] || range[0]); w++) weeks.push(w);
    const [players, prior] = await Promise.all([J(SL + '/players/nfl'), J(SL + '/stats/nfl/regular/' + (season - 1))]);
    await App.SOS.initialize(String(season), players);
    const roles = (await App.MatchupInputs.depthCharts().catch(() => null)) || {};
    await mkdir(OUT, { recursive: true });
    for (const week of weeks) {
        const t0 = Date.now();
        const rows = await runWeek(season, week, players, prior, roles);
        await writeFile(path.join(OUT, 'w' + week + '.json'), JSON.stringify({ season, week, name: NAME, tune: process.env.DHQ_TUNE || null, norm: process.env.DHQ_NORM || null, rows }));
        console.log(NAME + ' · week ' + week + ' · ' + rows.length + ' players · ' + Math.round((Date.now() - t0) / 1000) + 's');
    }
}
main().catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
