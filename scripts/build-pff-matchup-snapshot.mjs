// ══════════════════════════════════════════════════════════════════
// scripts/build-pff-matchup-snapshot.mjs
//
// Builds data/pff-matchup-snapshot.js from the PFF Developer API
// (https://developer.pff.com, base https://api.pff.com). Runs on a
// GitHub Actions schedule several times a day with the PFF_API_KEY
// repo secret; the key never reaches the browser. The app reads the
// generated file to feed the DHQ matchup engine:
//
//   teams   — season-to-date unit grades per team (offense, pass block,
//             run block, defense, pass rush, coverage, run defense) plus
//             the offensive line's pass-blocking efficiency. These are
//             the "trench edge" and part of "opponent vs position".
//   depth   — every team's depth chart with depth order, snap share and
//             unit grade. This is the "role & opportunity" factor.
//   players — season grades by facet (passing, rushing, receiving,
//             defense, pass rush, coverage, kicking), keyed by name.
//
// The API says which columns come back depends on the subscription, so
// this script never hard-codes grade column names: it keeps every
// numeric column whose key looks like a grade or efficiency figure and
// prints the column list it saw, so the first run tells us exactly what
// the account can see.
//
// Usage:  PFF_API_KEY=ak_... node scripts/build-pff-matchup-snapshot.mjs [season]
// ══════════════════════════════════════════════════════════════════
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const BASE = 'https://api.pff.com';
const KEY = process.env.PFF_API_KEY;
const OUT = path.resolve('data/pff-matchup-snapshot.js');

if (!KEY) {
    console.error('PFF_API_KEY is not set. Add it under Settings → Secrets and variables → Actions in this repo (a key from www.pff.com/account/api-keys).');
    process.exit(2);
}

// PFF's team codes vs Sleeper's. Everything not listed is the same.
const PFF_TO_SLEEPER = { ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU', LA: 'LAR', LAR: 'LAR', LAC: 'LAC', JAX: 'JAX', WSH: 'WAS', WAS: 'WAS', SD: 'LAC', OAK: 'LV', STL: 'LAR' };
const DEPTH_POSITIONS = new Set(['QB', 'HB', 'RB', 'FB', 'WR', 'TE', 'DI', 'ED', 'DL', 'DE', 'DT', 'LB', 'CB', 'S', 'K']);
const sleeperCode = (abbr) => PFF_TO_SLEEPER[String(abbr || '').toUpperCase()] || String(abbr || '').toUpperCase();

function currentSeason() {
    const now = new Date();
    // The NFL season is named for the year it starts; before August we are
    // still looking at last season's data.
    return now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}
const SEASON = Number(process.argv[2]) || currentSeason();

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function get(pathname, params = {}) {
    const url = new URL(BASE + pathname);
    for (const [k, v] of Object.entries(params)) if (v != null && v !== '') url.searchParams.set(k, String(v));
    for (let attempt = 1; attempt <= 3; attempt++) {
        const res = await fetch(url, { headers: { Authorization: 'Bearer ' + KEY, Accept: 'application/json', 'User-Agent': 'dhq-matchup-snapshot' } });
        if (res.ok) {
            const body = await res.json();
            if (Array.isArray(body.restricted) && body.restricted.length) console.log('  restricted columns on ' + pathname + ': ' + body.restricted.join(', '));
            return body;
        }
        const text = await res.text().catch(() => '');
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
            console.log('  ' + res.status + ' on ' + pathname + ', retrying in ' + (attempt * 3) + 's');
            await sleep(attempt * 3000);
            continue;
        }
        throw new Error('GET ' + url.pathname + url.search + ' → ' + res.status + ' ' + text.slice(0, 300));
    }
}

const isGradeKey = (k) => /grade|efficiency|pbe|rating|epa|success/i.test(k) && !/rank_?of|RankOf$/i.test(k);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const norm = (name) => String(name || '').toLowerCase().replace(/[.'’]/g, '').replace(/\s+(jr|sr|ii|iii|iv)$/i, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

// Keep the numeric grade-looking columns of a row, rounded to one decimal.
function gradeColumns(row, seen) {
    const out = {};
    for (const [k, v] of Object.entries(row)) {
        if (!isGradeKey(k)) continue;
        const n = num(v);
        if (n == null) continue;
        out[k] = Math.round(n * 10) / 10;
        if (seen) seen.add(k);
    }
    return out;
}

async function main() {
    console.log('PFF matchup snapshot · season ' + SEASON);

    // 1. Who are we, and are we entitled?
    const who = await get('/v1/auth/whoami');
    console.log('account tier: ' + who.tier + ' · entitled: ' + who.entitled + (who.entitlement_reason ? ' (' + who.entitlement_reason + ')' : ''));
    if (who.entitled === false) {
        console.error('This PFF account is not entitled to the Developer API. Reason: ' + (who.entitlement_reason || 'unknown'));
        process.exit(3);
    }

    // 2. Team directory.
    const dir = await get('/v2/nfl/teams', { season: SEASON });
    const teams = (dir.rows || []).map(t => ({ id: t.franchiseId, slug: t.slug, abbr: String(t.abbreviation || '').toUpperCase(), sleeper: sleeperCode(t.abbreviation), name: t.name }));
    console.log('teams: ' + teams.length);
    if (teams.length < 30) throw new Error('Team directory came back short (' + teams.length + '); refusing to build a partial snapshot.');
    const byId = new Map(teams.map(t => [t.id, t]));

    // 3. Season-to-date team overview (unit grades).
    const seenTeamCols = new Set();
    const overview = await get('/v1/teams/overview', { league: 'nfl', season: SEASON });
    const teamRows = overview.team_overview || [];
    const teamsOut = {};
    for (const row of teamRows) {
        const t = byId.get(row.franchise_id) || { sleeper: sleeperCode(row.abbreviation), abbr: row.abbreviation };
        teamsOut[t.sleeper] = Object.assign({ pffAbbr: t.abbr, franchiseId: row.franchise_id, games: num(row.player_game_count ?? row.games) }, gradeColumns(row, seenTeamCols));
    }
    console.log('team overview rows: ' + teamRows.length);
    console.log('team overview columns seen: ' + Object.keys(teamRows[0] || {}).join(', '));
    console.log('team grade columns kept: ' + [...seenTeamCols].join(', '));

    // 4. Offensive-line pass-blocking efficiency, season to date.
    //    The signature endpoint needs an explicit week list; ask for every
    //    regular-season week and let PFF ignore the ones not played yet.
    let weeks = 0;
    try {
        const sched = await get('/v2/nfl/teams/' + teams[0].slug + '/schedule', { season: SEASON });
        weeks = (sched.rows || []).filter(r => !r.isBye && r.result).length;
    } catch (e) { console.log('  schedule probe failed (' + e.message.slice(0, 120) + '), using week list 1-18'); }
    const weekList = Array.from({ length: Math.max(1, weeks || 18) }, (_, i) => i + 1).join(',');
    try {
        const pbe = await get('/v1/facet/signature/pass-blocking/efficiency/line', { league: 'nfl', season: String(SEASON), week: weekList });
        const rows = pbe.pbes || [];
        const seen = new Set();
        for (const row of rows) {
            const t = byId.get(row.franchise_id);
            if (!t) continue;
            teamsOut[t.sleeper] = teamsOut[t.sleeper] || { pffAbbr: t.abbr, franchiseId: t.id };
            teamsOut[t.sleeper].line = gradeColumns(row, seen);
        }
        console.log('pass-blocking efficiency rows: ' + rows.length + ' · columns: ' + Object.keys(rows[0] || {}).join(', '));
    } catch (e) { console.log('  pass-blocking efficiency unavailable: ' + e.message.slice(0, 160)); }

    // 5. Depth charts with snap share and unit grade.
    const depth = {};
    let depthCols = null;
    for (const t of teams) {
        try {
            const r = await get('/v2/nfl/teams/' + t.slug + '/roster', { season: SEASON });
            if (!depthCols && r.rows && r.rows[0]) depthCols = Object.keys(r.rows[0]);
            depth[t.sleeper] = (r.rows || []).map(p => ({
                id: p.playerId, n: p.name, pos: p.position, al: p.alignment, u: p.unit, d: num(p.depthOrder),
                g: num(p.grade), gr: num(p.gradeRank) || null, of: num(p.gradeRankOf) || null, sn: num(p.snapCounts), sp: num(p.snapPct), st: p.status || '',
            })).filter(p => p.n && DEPTH_POSITIONS.has(String(p.pos).toUpperCase()) && (p.d == null || p.d <= 3));
        } catch (e) { console.log('  roster failed for ' + t.abbr + ': ' + e.message.slice(0, 140)); }
        await sleep(150);
    }
    console.log('depth charts: ' + Object.keys(depth).length + ' teams · columns: ' + (depthCols || []).join(', '));

    // 6. Player grades by facet, season to date.
    //    Each report contributes a few named grades to one flat row per
    //    player: off (overall offense), pass, run, route, drop, elusive,
    //    def (overall defense), rdef, prush, cov, tkl, fg. That is what the
    //    engine's role, team-context and skill inputs read.
    const REPORTS = {
        passing:   { off: 'gradesOffense', pass: 'gradesPass', run: 'gradesRun', qbr: 'qbRating' },
        rushing:   { off: 'gradesOffense', run: 'gradesRun', elusive: 'elusiveRating', route: 'gradesPassRoute' },
        receiving: { off: 'gradesOffense', route: 'gradesPassRoute', drop: 'gradesHandsDrop' },
        defense:   { def: 'gradesDefense', rdef: 'gradesRunDefense', prush: 'gradesPassRushDefense', cov: 'gradesCoverageDefense', tkl: 'gradesTackle' },
        'field-goals': { fg: 'gradesFgepKicker' },
    };
    const players = {};
    const reportCols = {};
    for (const [rep, pick] of Object.entries(REPORTS)) {
        try {
            const r = await get('/v2/nfl/positions/reports/' + rep, { season: SEASON, weekGroup: 'REG' });
            const rows = r.rows || [];
            const seen = new Set();
            for (const row of rows) {
                const key = norm(row.player);
                if (!key) continue;
                const p = players[key] = players[key] || { id: row.playerId, pos: row.position, team: sleeperCode(row.team || row.teamAbbr || row.abbreviation) };
                for (const [short, col] of Object.entries(pick)) {
                    const n = num(row[col]);
                    if (n == null) continue;
                    if (p[short] == null || n > 0) p[short] = Math.round(n * 10) / 10;
                    seen.add(col);
                }
            }
            reportCols[rep] = [...seen];
            console.log('report ' + rep + ': ' + rows.length + ' rows · kept ' + [...seen].join(', '));
        } catch (e) { console.log('  report ' + rep + ' unavailable: ' + e.message.slice(0, 160)); }
        await sleep(150);
    }

    const snapshot = {
        season: SEASON,
        built: new Date().toISOString(),
        source: 'PFF Developer API',
        teams: teamsOut,
        depth,
        players,
        columns: { team: [...seenTeamCols], depth: depthCols || [], reports: reportCols },
    };
    const js = '// Generated by scripts/build-pff-matchup-snapshot.mjs — do not edit by hand.\n'
        + '// PFF Developer API snapshot for the DHQ matchup engine. Built ' + snapshot.built + '.\n'
        + '(function (root) { root.DhqPffMatchup = ' + JSON.stringify(snapshot) + ';\n'
        + 'if (typeof module !== "undefined" && module.exports) module.exports = root.DhqPffMatchup;\n'
        + '})(typeof window !== "undefined" ? window : globalThis);\n';
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, js);
    console.log('wrote ' + path.relative(process.cwd(), OUT) + ' (' + Math.round(js.length / 1024) + ' KB) · teams ' + Object.keys(teamsOut).length + ' · players ' + Object.keys(players).length);
}

main().catch(err => { console.error(err.message || err); process.exit(1); });
