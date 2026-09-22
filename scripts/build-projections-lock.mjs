// Locks the DHQ projection for every graded player before his game kicks
// off, so each week has a score sheet of what we said at the time.
//
//   node scripts/build-projections-lock.mjs            # current NFL week
//   node scripts/build-projections-lock.mjs 3          # a given week
//   node scripts/build-projections-lock.mjs 1 --reconstruct
//       a week already played: written once with today's formula and no
//       peeking (season stats from earlier weeks only), labelled so.
//
// Output: data/locks/{season}-w{week}.json. On a live week the job reruns
// hourly; a player's numbers keep updating until his game has started,
// then they are kept as they were. Runs the same engine the Lab page
// runs, in Node, with the same public feeds; no keys.
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const R = (p) => require(path.join(ROOT, p));

// ── the browser bits the shared modules expect ─────────────────────
global.window = globalThis;
const store = {}; globalThis.sessionStorage = { getItem: k => store[k] ?? null, setItem: (k, v) => { store[k] = v; }, removeItem: k => { delete store[k]; } };
globalThis.App = globalThis.App || {};
App.POS_GROUPS = { QB: ['QB'], RB: ['RB', 'FB'], WR: ['WR'], TE: ['TE'], K: ['K'], DEF: ['DEF'], DL: ['DE', 'DT', 'NT', 'DL'], LB: ['LB', 'OLB', 'ILB', 'MLB'], DB: ['CB', 'S', 'SS', 'FS', 'DB'] };
App.normPos = (p) => { for (const [g, l] of Object.entries(App.POS_GROUPS)) if (l.includes(p)) return g; return p; };
App.calcRawPts = (line, sc) => { let t = 0; for (const [k, v] of Object.entries(sc || {})) if (line && Number.isFinite(line[k])) t += line[k] * v; return t; };
globalThis.calcFantasyPts = (line, sc) => App.calcRawPts(line, sc);
App.calcPPG = (st, sc) => st && st.gp > 0 ? App.calcRawPts(st, sc) / st.gp : 0;
R('js/shared/startsit-engine.js'); R('js/shared/weekly-proj.js'); R('js/utils/sos-engine.js'); try { R('js/shared/nfl-context.js'); } catch (e) { /* optional */ }
R('js/shared/matchup-engine.js'); R('js/shared/dhq-baseline.js'); R('js/shared/matchup-feeds-espn.js'); R('js/shared/matchup-inputs.js');
globalThis.DhqPffMatchup = R('data/pff-matchup-snapshot.js');
globalThis.DhqUsage = R('data/usage-snapshot.js');

const UA = { headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' } };
async function J(u, tries = 3) { for (let i = 1; i <= tries; i++) { try { const r = await fetch(u, UA); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return await r.json(); } catch (e) { if (i === tries) throw e; await new Promise(res => setTimeout(res, 800 * i)); } } }
const SL = 'https://api.sleeper.app/v1';
const ESPN_TO_SLEEPER = { WSH: 'WAS', LA: 'LAR', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
const code = (a) => { a = String(a || '').toUpperCase(); return ESPN_TO_SLEEPER[a] || a; };
const DEFAULT_SCORING = { pass_yd: 0.04, pass_td: 4, pass_int: -1, pass_2pt: 2, rush_yd: 0.1, rush_td: 6, rush_2pt: 2, rec: 0.5, rec_yd: 0.1, rec_td: 6, rec_2pt: 2, fum_lost: -2,
    fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 4, fgm_50p: 5, fgmiss: -1, xpm: 1, xpmiss: -1,
    idp_tkl_solo: 1, idp_tkl_ast: 0.5, idp_tkl_loss: 1, idp_sack: 2, idp_qb_hit: 1, idp_int: 3, idp_pass_def: 1, idp_ff: 2, idp_fum_rec: 2, idp_def_td: 6, idp_safe: 2, idp_blk_kick: 2 };
const POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'];
const LOCK_USER = process.env.LOCK_USER || 'skjjcruz';

const args = process.argv.slice(2);
const reconstruct = args.includes('--reconstruct');
const force = args.includes('--force');
const weekArg = Number(args.find(a => /^\d+$/.test(a)));

async function main() {
    const state = await J(SL + '/state/nfl');
    const season = Number(state.season) || new Date().getUTCFullYear();
    const nflWeek = Number(state.week) || 1;
    const week = weekArg || nflWeek;
    const OUT = path.join(ROOT, 'data/locks/' + season + '-w' + week + '.json');
    let existing = null; try { existing = JSON.parse(await readFile(OUT, 'utf8')); } catch (e) { existing = null; }
    if (existing && existing.reconstructed && !force) { console.log('week ' + week + ' is a reconstructed lock; leaving it alone (use --force to rewrite).'); return; }
    if (reconstruct && week >= nflWeek && !force) throw new Error('--reconstruct is for weeks already played (current week is ' + nflWeek + ')');
    const now = new Date();

    // ── data, with no peeking: season stats from the weeks before this one
    const [players, prior, proj, seasonFull, box] = await Promise.all([
        J(SL + '/players/nfl'), J(SL + '/stats/nfl/regular/' + (season - 1)), J(SL + '/projections/nfl/regular/' + season + '/' + week),
        J(SL + '/stats/nfl/regular/' + season), J(SL + '/stats/nfl/regular/' + season + '/' + week)]);
    const weekly = []; for (let w = 1; w < week; w++) weekly.push(await J(SL + '/stats/nfl/regular/' + season + '/' + w) || {});
    const statsCur = {};
    for (const wk of weekly) for (const [pid, row] of Object.entries(wk)) { const acc = statsCur[pid] = statsCur[pid] || {}; for (const [k, v] of Object.entries(row)) if (typeof v === 'number') acc[k] = (acc[k] || 0) + v; }
    for (const [k, row] of Object.entries(seasonFull || {})) if (k.startsWith('TEAM_') && row.gp === weekly.length) statsCur[k] = row;
    // a player with a box score this week has played: his current injury tag is for next week
    for (const [pid, st] of Object.entries(box || {})) { const p = players[pid]; if (p && st && st.gp >= 1 && p.injury_status) { p.injury_status_after = p.injury_status; p.injury_status = null; } }
    globalThis.S = { season, nflState: state, weeklyPlayerPoints: {}, players };
    for (let w = 1; w < week; w++) { S.weeklyPlayerPoints[w] = {}; for (const [pid, s] of Object.entries(weekly[w - 1])) S.weeklyPlayerPoints[w][pid] = +App.calcRawPts(s, DEFAULT_SCORING).toFixed(2); }
    await App.SOS.initialize(String(season), players);
    App.WeeklyProj.setProjections(week, proj || {});
    // kickoffs and game state from the ESPN scoreboard
    const kickoffs = {}, started = {};
    try {
        const sb = await J('https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?week=' + week + '&seasontype=2&dates=' + season);
        if (App.NflContext && App.NflContext.parse) App.WeeklyProj.setContext({ byTeamWeek: App.NflContext.parse(sb, week) });
        for (const ev of (sb && sb.events) || []) {
            const c = ev.competitions && ev.competitions[0]; if (!c) continue;
            const st = c.status && c.status.type && c.status.type.state;
            for (const t of c.competitors || []) { const T = code(t.team && t.team.abbreviation); kickoffs[T] = ev.date; started[T] = st !== 'pre' || new Date(ev.date) <= now; }
        }
    } catch (e) { console.warn('scoreboard unavailable: ' + e.message); }

    // ── scorings: the half-PPR default plus the owner's leagues
    const scorings = { half: { name: 'Sleeper half-PPR defaults', scoring: DEFAULT_SCORING } };
    try {
        const u = await J(SL + '/user/' + LOCK_USER);
        const leagues = u ? await J(SL + '/user/' + u.user_id + '/leagues/nfl/' + season) : [];
        for (const lg of leagues || []) if (lg.scoring_settings) scorings['league_' + lg.league_id] = { name: lg.name, scoring: lg.scoring_settings };
    } catch (e) { console.warn('leagues unavailable: ' + e.message); }

    // ── who gets graded: a Sleeper line, stats this season, or a top-three slot
    const roles = (await App.MatchupInputs.depthCharts().catch(() => null)) || {};
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
    console.log('week ' + week + ' · ' + pids.length + ' players · ' + Object.keys(scorings).length + ' scorings · ' + Object.keys(kickoffs).length + ' teams on the slate' + (reconstruct ? ' · RECONSTRUCTED' : ''));

    // ── run the engine once per scoring
    const out = { season, week, built: now.toISOString(), reconstructed: !!reconstruct, formula: null, kickoffs, players: {}, scorings: {} };
    let kept = 0, written = 0;
    for (const [key, sc] of Object.entries(scorings)) {
        const opts = { playersData: players, statsData: statsCur, priorData: prior || {}, scoring: sc.scoring, season, baselineMode: 'dhq' };
        const res = await App.MatchupInputs.projectRoster(pids, week, opts);
        const rows = {};
        for (const pid of pids) {
            const p = res.projections[pid]; if (!p) continue;
            const T = String(p.team || '').toUpperCase();
            const prev = existing && !existing.reconstructed && existing.scorings[key] && existing.scorings[key].players[pid];
            if (prev && started[T] && existing.players[pid]) { rows[pid] = prev; if (key === 'half') { out.players[pid] = existing.players[pid]; kept++; } continue; }
            rows[pid] = [p.points.median, p.sleeper != null ? +p.sleeper.toFixed(2) : null];
            if (key === 'half') {
                const why = (p.baseline && p.baseline.why ? 'Baseline: ' + p.baseline.why + ' · ' : '') + (p.why || []).slice(0, 3).map(w => w.label + ' ' + (w.impactPct > 0 ? '+' : '') + w.impactPct + '%: ' + w.note).join(' · ');
                out.players[pid] = { pos: p.position, team: T, opp: p.opponentAbbr || null, grade: p.grade, verdict: p.verdict, why: why.slice(0, 320), t: now.toISOString() };
                written++;
            }
        }
        out.scorings[key] = { name: sc.name, scoring: sc.scoring, players: rows };
        console.log('  ' + key + ' (' + sc.name + '): ' + Object.keys(rows).length + ' players');
    }
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(out));
    console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + Math.round(JSON.stringify(out).length / 1024) + ' KB) · updated ' + written + ' · kept locked ' + kept);
}
main().catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
