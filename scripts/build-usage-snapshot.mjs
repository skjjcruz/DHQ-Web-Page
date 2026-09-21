// Builds data/usage-snapshot.js: how each coaching staff spreads targets
// across its receivers and tight ends, by usage rank, season by season,
// plus which past seasons were under the team's current head coach.
//
//   node scripts/build-usage-snapshot.mjs [season]
//
// Sources (no keys needed):
//   Sleeper weekly rows (api.sleeper.com/stats/nfl/{season}/{week}?position[]=WR)
//     carry the team a player was on THAT WEEK, so trades are handled.
//   Sleeper season TEAM_ rows for team target totals and games.
//   ESPN core API for each team's head coach by season.
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const SEASON = Number(process.argv[2]) || (() => { const d = new Date(); return d.getUTCMonth() >= 2 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; })();
const BACK = 3;                                   // seasons of history to keep
const POS = { WR: 6, TE: 4 };                     // ranks kept per group
const OUT = path.resolve('data/usage-snapshot.js');
const UA = { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' };
const ESPN_TO_SLEEPER = { WSH: 'WAS', LA: 'LAR', JAC: 'JAX', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
const code = (a) => { a = String(a || '').toUpperCase(); return ESPN_TO_SLEEPER[a] || a; };

async function getJson(url, tries = 3) {
    for (let i = 1; i <= tries; i++) {
        try {
            const r = await fetch(url, { headers: UA });
            if (r.status === 404) return null;
            if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
            return await r.json();
        } catch (e) { if (i === tries) throw e; await new Promise(res => setTimeout(res, 600 * i)); }
    }
}

async function teams(season) {
    const d = await getJson('https://site.api.espn.com/apis/v2/sports/football/nfl/standings?season=' + season + '&level=3');
    const out = {};
    const walk = (node) => {
        for (const e of (node.standings && node.standings.entries) || []) if (e.team && e.team.id) out[code(e.team.abbreviation)] = { id: String(e.team.id), espn: e.team.abbreviation, name: e.team.displayName || e.team.name };
        for (const c of node.children || []) walk(c);
    };
    walk(d || {});
    return out;
}
async function headCoach(season, teamId) {
    const list = await getJson('https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/' + season + '/teams/' + teamId + '/coaches?lang=en&region=us');
    const ref = list && list.items && list.items[0] && list.items[0].$ref;
    if (!ref) return null;
    const doc = await getJson(ref);
    const person = doc && doc.person && doc.person.$ref ? await getJson(doc.person.$ref) : doc;
    if (!person) return null;
    return { id: String(person.id || doc.id || ''), name: ((person.firstName || '') + ' ' + (person.lastName || '')).trim() };
}

// One season of usage for every team: rank players by season targets.
async function usage(season) {
    const teamRows = await getJson('https://api.sleeper.app/v1/stats/nfl/regular/' + season) || {};
    const out = {};   // team -> grp -> { players: {pid: {tgt, games, name}} , weeks }
    for (const grp of Object.keys(POS)) {
        for (let w = 1; w <= 18; w++) {
            const rows = await getJson('https://api.sleeper.com/stats/nfl/' + season + '/' + w + '?season_type=regular&position%5B%5D=' + grp);
            if (!Array.isArray(rows) || !rows.length) break;
            for (const r of rows) {
                if (!r.team || !r.stats || !(r.stats.gp >= 1)) continue;
                const T = code(r.team);
                const t = out[T] = out[T] || {};
                const g = t[grp] = t[grp] || { players: {}, weeks: new Set() };
                g.weeks.add(w);
                const p = g.players[r.player_id] = g.players[r.player_id] || { name: r.player ? (r.player.first_name + ' ' + r.player.last_name) : r.player_id, tgt: 0, games: 0 };
                p.tgt += r.stats.rec_tgt || 0; p.games++;
            }
        }
    }
    const result = {};
    for (const T of Object.keys(out)) {
        const row = teamRows['TEAM_' + T] || {};
        const teamTgt = row.rec_tgt || 0, teamGp = row.gp || 0;
        result[T] = { games: teamGp, teamTargets: teamTgt, perGame: teamGp ? +(teamTgt / teamGp).toFixed(1) : null };
        for (const grp of Object.keys(POS)) {
            const g = out[T][grp]; if (!g) continue;
            const list = Object.values(g.players).sort((a, b) => b.tgt - a.tgt);
            const roomTgt = list.reduce((s, p) => s + p.tgt, 0);
            result[T][grp] = {
                share: list.slice(0, POS[grp]).map(p => teamTgt ? +(p.tgt / teamTgt).toFixed(4) : null),
                perGamePlayed: list.slice(0, POS[grp]).map(p => p.games ? +(p.tgt / p.games).toFixed(2) : null),
                names: list.slice(0, POS[grp]).map(p => p.name),
                room: teamTgt ? +(roomTgt / teamTgt).toFixed(4) : null,
            };
        }
    }
    return result;
}

async function main() {
    const seasons = []; for (let s = SEASON; s >= SEASON - BACK; s--) seasons.push(s);
    const T = await teams(SEASON);
    if (Object.keys(T).length < 30) throw new Error('only ' + Object.keys(T).length + ' teams from ESPN standings');
    console.log('teams ' + Object.keys(T).length + ' · seasons ' + seasons.join(', '));

    // head coach now, then which past seasons his own season records put
    // him on this team (ESPN's per-season coach list returns today's coach
    // for every year, but a coach's season document only carries a team in
    // the seasons he actually coached one).
    const hc = {};   // team -> { now, under: [seasons] }
    const codes = Object.keys(T);
    for (let i = 0; i < codes.length; i += 3) {
        await Promise.all(codes.slice(i, i + 3).map(async c => {
            let now = null; try { now = await headCoach(SEASON, T[c].id); } catch (e) { now = null; }
            const under = [];
            if (now && now.id) {
                for (const s of seasons.slice(1)) {
                    let doc = null; try { doc = await getJson('https://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/' + s + '/coaches/' + now.id + '?lang=en&region=us'); } catch (e) { doc = null; }
                    const ref = doc && doc.team && doc.team.$ref ? String(doc.team.$ref) : '';
                    if (ref && new RegExp('/teams/' + T[c].id + '(\\?|$)').test(ref)) under.push(s); else break;
                }
            }
            hc[c] = { now, under };
        }));
    }
    console.log('head coaches: ' + codes.filter(c => hc[c].now).length + ' of ' + codes.length + ' · new this season: ' + codes.filter(c => hc[c].now && !hc[c].under.length).join(', '));
    // usage by season
    const use = {};
    for (const s of seasons) { use[s] = await usage(s); console.log('usage ' + s + ': ' + Object.keys(use[s]).length + ' teams'); }

    const teamsOut = {};
    for (const c of Object.keys(T)) {
        const now = hc[c].now, under = hc[c].under;
        const bySeason = {};
        for (const s of seasons) if (use[s] && use[s][c]) bySeason[s] = use[s][c];
        const prior = {};
        for (const grp of Object.keys(POS)) {
            const rows = under.map(s => bySeason[s] && bySeason[s][grp]).filter(Boolean);
            if (!rows.length) continue;
            const share = [];
            for (let i = 0; i < POS[grp]; i++) { const v = rows.map(r => r.share[i]).filter(x => x != null); share.push(v.length ? +(v.reduce((a, b) => a + b, 0) / v.length).toFixed(4) : null); }
            const rooms = rows.map(r => r.room).filter(x => x != null);
            prior[grp] = { share, room: rooms.length ? +(rooms.reduce((a, b) => a + b, 0) / rooms.length).toFixed(4) : null, seasons: rows.length };
        }
        teamsOut[c] = { name: T[c].name, hc: now ? { name: now.name, seasonsBefore: under.length, since: under.length ? Math.min.apply(null, under) : SEASON } : null, under, prior, bySeason };
    }
    const snapshot = { season: SEASON, built: new Date().toISOString(), source: 'Sleeper weekly stats + ESPN coaches', ranks: POS, teams: teamsOut };
    const js = '// Generated by scripts/build-usage-snapshot.mjs — do not edit by hand.\n'
        + '// How each coaching staff spreads targets across its receivers and tight ends, by usage rank. Built ' + snapshot.built + '.\n'
        + '(function (root) { root.DhqUsage = ' + JSON.stringify(snapshot) + ';\n'
        + 'if (typeof module !== "undefined" && module.exports) module.exports = root.DhqUsage;\n'
        + '})(typeof window !== "undefined" ? window : globalThis);\n';
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, js);
    const newHc = Object.keys(teamsOut).filter(c => teamsOut[c].hc && teamsOut[c].hc.seasonsBefore === 0);
    console.log('wrote ' + path.relative(process.cwd(), OUT) + ' (' + Math.round(js.length / 1024) + ' KB) · new head coaches this season: ' + newHc.join(', '));
}
main().catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
