// ══════════════════════════════════════════════════════════════════
// scripts/pff-history.mjs — research only (QB project 2026-10-26)
//
// Pulls PFF Developer API player reports week by week so the engine can
// be replayed on past weeks with the grades PFF had BEFORE each game.
// Runs only in GitHub Actions (PFF_API_KEY secret); never in a browser.
//
//   node scripts/pff-history.mjs probe            # which reports and params work
//   node scripts/pff-history.mjs pull 2025 [2024] # every report, every week
// Output: data/pff-history/<season>-w<week>.json (pull), probe.json (probe)
// ══════════════════════════════════════════════════════════════════
import { writeFile, mkdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const BASE = 'https://api.pff.com';
const KEY = process.env.PFF_API_KEY;
if (!KEY) { console.error('PFF_API_KEY is not set'); process.exit(2); }
const OUT = 'data/pff-history';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(pathname, params = {}) {
    const url = new URL(BASE + pathname);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    for (let attempt = 1; attempt <= 4; attempt++) {
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + KEY, Accept: 'application/json', 'User-Agent': 'dhq-pff-history' } });
        if (res.ok) return { status: res.status, body: await res.json() };
        if (res.status === 429 || res.status >= 500) { await sleep(attempt * 4000); continue; }
        return { status: res.status, body: null, text: (await res.text()).slice(0, 300) };
    }
    return { status: 429, body: null, text: 'gave up after retries' };
}

// Report names PFF's premium stat pages use; the probe says which exist.
const REPORTS = ['passing', 'passing-pressure', 'passing-depth', 'passing-concept', 'time-in-pocket', 'passing-allowed-pressure',
    'rushing', 'receiving', 'receiving-depth', 'receiving-scheme', 'receiving-concept',
    'offense-blocking', 'offense-pass-blocking', 'offense-run-blocking', 'pass-blocking', 'run-blocking',
    'defense', 'pass-rush', 'pass-rush-productivity', 'run-defense', 'defense-coverage', 'coverage', 'defense-coverage-scheme', 'slot-coverage',
    'special-teams', 'field-goals'];

async function probe() {
    const out = { who: null, reports: {} };
    const who = await get('/v1/auth/whoami'); out.who = who.body; console.log('whoami', who.status, JSON.stringify(who.body));
    for (const rep of REPORTS) {
        const r = {};
        // season to date, one week alone, and a week list
        for (const [label, params] of [['reg', { season: 2025, weekGroup: 'REG' }], ['week5', { season: 2025, week: 5 }], ['weeks1-4', { season: 2025, week: '1,2,3,4' }], ['week5grp', { season: 2025, weekGroup: 'REG', week: 5 }]]) {
            const g = await get('/v2/nfl/positions/reports/' + rep, params);
            const rows = g.body && (g.body.rows || []);
            r[label] = { status: g.status, rows: rows ? rows.length : null, err: g.text || null };
            if (rows && rows.length && !r.columns) { r.columns = Object.keys(rows[0]); r.sample = rows[0]; }
            if (rows && rows.length) {
                // tell a one-week pull from a season pull: a QB's attempts / a player's games
                const s = rows.find(x => /QB/.test(x.position || '')) || rows[0];
                r[label].probe = { player: s.player, games: s.player_game_count ?? s.playerGameCount ?? s.games ?? null, att: s.attempts ?? null, snaps: s.snapCounts ?? s.snap_counts_offense ?? null };
            }
            await sleep(250);
        }
        out.reports[rep] = r;
        console.log(rep.padEnd(26), Object.entries(r).filter(([k]) => !['columns', 'sample'].includes(k)).map(([k, v]) => k + ':' + v.status + '/' + v.rows + (v.probe ? '(' + JSON.stringify(v.probe) + ')' : '')).join('  '));
        if (r.columns) console.log('   columns (' + r.columns.length + '): ' + r.columns.join(','));
    }
    await mkdir(OUT, { recursive: true });
    await writeFile(OUT + '/probe.json', JSON.stringify(out, null, 1));
}

async function pull(seasons) {
    const ok = JSON.parse(await (await import('node:fs/promises')).readFile(OUT + '/probe.json', 'utf8').catch(() => '{"reports":{}}'));
    const reps = Object.entries(ok.reports || {}).filter(([, r]) => r.week5 && r.week5.status === 200 && r.week5.rows > 0).map(([k]) => k);
    const use = reps.length ? reps : ['passing', 'rushing', 'receiving', 'defense'];
    console.log('reports: ' + use.join(', '));
    await mkdir(OUT, { recursive: true });
    for (const season of seasons) {
        for (let week = 1; week <= 18; week++) {
            const wk = {};
            let any = 0;
            for (const rep of use) {
                const g = await get('/v2/nfl/positions/reports/' + rep, { season, week });
                const rows = (g.body && g.body.rows) || [];
                wk[rep] = rows; any += rows.length;
                await sleep(200);
            }
            if (!any) { console.log(season + ' w' + week + ': nothing (not played yet?)'); continue; }
            await writeFile(OUT + '/' + season + '-w' + week + '.json.gz', gzipSync(JSON.stringify({ season, week, pulled: new Date().toISOString(), reports: wk })));
            console.log(season + ' w' + week + ': ' + Object.entries(wk).map(([k, v]) => k + ' ' + v.length).join(' · '));
        }
    }
}

const [mode, ...rest] = process.argv.slice(2);
if (mode === 'probe') await probe();
else if (mode === 'pull') await pull(rest.map(Number).filter(Boolean));
else { console.error('usage: probe | pull <season...>'); process.exit(2); }
