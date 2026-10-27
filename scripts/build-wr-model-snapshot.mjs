// ══════════════════════════════════════════════════════════════════
// scripts/build-wr-model-snapshot.mjs
//
// DHQ's own WR model (owner ruling 2026-10-27: our number must stand on
// its own, no Sleeper projection in it). A gradient-boosted model of a
// receiver's TYPICAL game (median, half-PPR) from
// 18 free inputs: his share of the team's targets among the receivers
// active this week, snaps, the Vegas team total and spread, the depth
// chart, the injury report, career scoring, draft slot and age. Trained
// on every WR who played 2020-25 (scripts/models/wr-median.json; QB project notes, 2026-10-27). Out of sample vs Sleeper:
// 2025 57.3% (miss 3.48 vs 3.65), 2026 weeks 1-7 56.9% (3.44 vs 3.57).
//
// Runs in GitHub Actions (wr-model-snapshot.yml): nflverse's release
// files cannot be fetched from a browser, so this script downloads them,
// scores every active WR for the coming week and writes
// data/wr-model-snapshot.js, which the engine reads (matchup-inputs.js,
// wrModel). Nothing here comes from Sleeper; the Sleeper id is attached
// only so the app can find each player (DynastyProcess id map).
//
// Usage:  node scripts/build-wr-model-snapshot.mjs [season] [week]
//         (default: the season and week of the next unplayed game)
// ══════════════════════════════════════════════════════════════════
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const CACHE = path.join(ROOT, 'scripts/.wr-cache');
const OUT = process.env.WR_OUT || path.join(ROOT, 'data/wr-model-snapshot.js');   // WR_OUT / WR_MODEL: backtests only
const REL = 'https://github.com/nflverse/nflverse-data/releases/download';

// ── downloads (cached for the run) ─────────────────────────────────
fs.mkdirSync(CACHE, { recursive: true });
async function file(name, url, { optional = false } = {}) {
    const p = path.join(CACHE, name);
    if (fs.existsSync(p) && fs.statSync(p).size > 0) return p;
    for (let i = 1; i <= 3; i++) {
        try {
            const r = await fetch(url, { headers: { 'User-Agent': 'dhq-wr-model' } });
            if (r.status === 404 && optional) return null;
            if (!r.ok) throw new Error('HTTP ' + r.status);
            fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
            return p;
        } catch (e) {
            if (i === 3) { if (optional) return null; throw new Error(name + ': ' + e.message); }
            await new Promise(res => setTimeout(res, 2000 * i));
        }
    }
}

// ── tiny CSV reader (quotes, embedded newlines) ────────────────────
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
const num = v => (v === '' || v === undefined || v === 'NA') ? 0 : +v;
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const nm = s => String(s).toLowerCase().replace(/[.']/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z]/g, '');
const blend = (cn, cd, ln, ld, K, K2, lg) => (cn + K * ((ln + K2 * lg) / (ld + K2))) / (cd + K);
// nflverse team codes → the app's (Sleeper-style) codes
const TO_APP = { LA: 'LAR' };

// The exported trees (scripts/models/*.json): sum of leaf values, NaN takes the learned missing branch.
function treePredict(model, x) {
    const v = model.features.map(f => (x[f] === null || x[f] === undefined || Number.isNaN(+x[f])) ? NaN : +x[f]);
    let s = model.base;
    for (const t of model.trees) {
        let n = 0;
        while (!t.leaf[n]) { const xv = v[t.f[n]]; n = Number.isNaN(xv) ? (t.m[n] ? t.l[n] : t.r[n]) : (xv <= t.t[n] ? t.l[n] : t.r[n]); }
        s += t.v[n];
    }
    return Math.max(model.clip_min ?? -Infinity, s);
}

async function main() {
    const games = await file('games.csv', 'https://raw.githubusercontent.com/nflverse/nfldata/master/data/games.csv');
    const G0 = readCSV(games, ['season', 'game_type', 'week', 'gameday', 'home_team', 'away_team', 'spread_line', 'total_line', 'result']).filter(r => r.game_type === 'REG');
    let Y = Number(process.argv[2]) || 0, W = Number(process.argv[3]) || 0;
    if (!Y) Y = Math.max(...G0.map(r => +r.season));
    if (!W) { const open = G0.filter(r => +r.season === Y && (r.result === '' || r.result === 'NA')).map(r => +r.week); W = open.length ? Math.min(...open) : 0; }
    if (!W) { console.log('season ' + Y + ': no unplayed regular-season game, nothing to build'); return; }
    console.log('WR model snapshot · season ' + Y + ' · week ' + W);

    const F = { stats: {}, snaps: {} };
    for (let y = 2013; y <= Y; y++) F.stats[y] = await file('stats_player_week_' + y + '.csv', REL + '/stats_player/stats_player_week_' + y + '.csv', { optional: y === Y });
    for (const y of [Y - 1, Y]) F.snaps[y] = await file('snap_counts_' + y + '.csv', REL + '/snap_counts/snap_counts_' + y + '.csv', { optional: y === Y });
    F.players = await file('players.csv', REL + '/players/players.csv');
    F.injuries = await file('injuries_' + Y + '.csv', REL + '/injuries/injuries_' + Y + '.csv', { optional: true });
    F.depth = await file('depth_charts_' + Y + '.csv', REL + '/depth_charts/depth_charts_' + Y + '.csv', { optional: true });
    F.roster = await file('roster_weekly_' + Y + '.csv', REL + '/weekly_rosters/roster_weekly_' + Y + '.csv');
    F.ids = await file('db_playerids.csv', 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv', { optional: true });

    // ── players
    const P = {}, pfr2g = {};
    for (const r of readCSV(F.players, ['gsis_id', 'display_name', 'position', 'birth_date', 'draft_pick', 'pfr_id'])) {
        if (!r.gsis_id) continue;
        P[r.gsis_id] = { name: r.display_name, pos: r.position === 'FB' ? 'RB' : r.position, birth: r.birth_date, pick: r.draft_pick === '' || r.draft_pick === 'NA' ? 300 : Math.min(300, +r.draft_pick) };
        if (r.pfr_id) pfr2g[r.pfr_id] = r.gsis_id;
    }
    const SID = {};
    if (F.ids) for (const r of readCSV(F.ids, ['gsis_id', 'sleeper_id'])) if (r.gsis_id && r.sleeper_id && r.sleeper_id !== 'NA') SID[r.gsis_id] = r.sleeper_id;

    // ── weekly stats: fp, targets, team targets, career (games before week W only)
    const SC = ['receptions', 'receiving_yards', 'receiving_tds', 'rushing_yards', 'rushing_tds', 'receiving_fumbles_lost',
        'rushing_fumbles_lost', 'sack_fumbles_lost', 'receiving_2pt_conversions', 'rushing_2pt_conversions', 'passing_2pt_conversions',
        'passing_yards', 'passing_tds', 'passing_interceptions'];
    const halfPPR = r => num(r.receptions) * .5 + num(r.receiving_yards) * .1 + num(r.receiving_tds) * 6 + num(r.rushing_yards) * .1 +
        num(r.rushing_tds) * 6 - 2 * (num(r.receiving_fumbles_lost) + num(r.rushing_fumbles_lost) + num(r.sack_fumbles_lost)) +
        2 * (num(r.receiving_2pt_conversions) + num(r.rushing_2pt_conversions) + num(r.passing_2pt_conversions)) +
        num(r.passing_yards) * .04 + num(r.passing_tds) * 4 - num(r.passing_interceptions);
    const ST = {}, TT = {}, CAR = {}, name2g = {};
    for (let y = 2013; y <= Y; y++) {
        if (!F.stats[y]) continue;
        for (const r of readCSV(F.stats[y], ['player_id', 'player_display_name', 'season', 'week', 'season_type', 'team', 'targets', ...SC])) {
            if (r.season_type !== 'REG' || !r.player_id) continue;
            const w = +r.week, t = fx(r.team), fp = halfPPR(r), tg = num(r.targets);
            if (y < Y) { const c = CAR[r.player_id] || (CAR[r.player_id] = { fp: 0, g: 0 }); c.fp += fp; c.g += 1; }
            if (y >= Y - 1 && !(y === Y && w >= W)) {
                ST[r.player_id + '|' + y + '|' + w] = { tgt: tg, fp };
                TT[t + '|' + y + '|' + w] = (TT[t + '|' + y + '|' + w] || 0) + tg;
            }
            if (y >= Y - 1) name2g[nm(r.player_display_name) + '|' + t + '|' + y + '|' + w] = r.player_id;
        }
    }
    // ── snap counts = games played (any snap) + offense share
    const GP = {};
    for (const y of [Y - 1, Y]) {
        if (!F.snaps[y]) continue;
        for (const r of readCSV(F.snaps[y], ['season', 'game_type', 'week', 'player', 'pfr_player_id', 'position', 'team', 'offense_snaps', 'offense_pct', 'st_snaps'])) {
            if (r.game_type !== 'REG' || !(num(r.offense_snaps) > 0 || num(r.st_snaps) > 0)) continue;
            const w = +r.week, t = fx(r.team);
            if (y === Y && w >= W) continue;
            const g = pfr2g[r.pfr_player_id] || name2g[nm(r.player) + '|' + t + '|' + y + '|' + w];
            if (!g) continue;
            const s = ST[g + '|' + y + '|' + w] || { tgt: 0, fp: 0 };
            (GP[g] || (GP[g] = [])).push({ y, w, team: t, pct: num(r.offense_pct), tgt: s.tgt, tmt: TT[t + '|' + y + '|' + w] || 0, fp: s.fp });
        }
    }
    for (const g in GP) { const seen = new Set(); GP[g] = GP[g].filter(x => { const k = x.y + '|' + x.w; if (seen.has(k)) return false; seen.add(k); return true; }).sort((a, b) => a.y - b.y || a.w - b.w); }
    const TG = {};
    for (const k in TT) { const [t, y] = k.split('|'); (TG[t] || (TG[t] = { cn: 0, cd: 0, ln: 0, ld: 0 })); if (+y === Y) { TG[t].cn += TT[k]; TG[t].cd += 1; } else { TG[t].ln += TT[k]; TG[t].ld += 1; } }
    function usage(g) {
        const L = GP[g] || [], cur = L.filter(x => x.y === Y), last = L.filter(x => x.y === Y - 1);
        const S = (a, k) => a.reduce((s, x) => s + x[k], 0);
        const c = { g: cur.length, tgt: S(cur, 'tgt'), tmt: S(cur, 'tmt'), fp: S(cur, 'fp') };
        const l = { g: last.length, tgt: S(last, 'tgt'), tmt: S(last, 'tmt'), fp: S(last, 'fp') };
        const pct = cur.map(x => x.pct);
        return {
            g_cur: c.g,
            ppg: blend(c.fp, c.g, l.fp, l.g, 3, 4, 6.0), tpg: blend(c.tgt, c.g, l.tgt, l.g, 3, 4, 4.0),
            tshare: blend(c.tgt, c.tmt, l.tgt, l.tmt, 60, 90, 0.11), sh: blend(c.tgt, c.tmt, l.tgt, l.tmt, 60, 90, 0.06),
            snap_l1: pct.length ? pct[pct.length - 1] : null,
            snap_l3: pct.length ? pct.slice(-3).reduce((a, b) => a + b, 0) / pct.slice(-3).length : null,
        };
    }
    // ── this week's games: date, implied team total, spread (negative = favored)
    const GM = {};
    for (const r of G0) {
        if (+r.season !== Y || +r.week !== W) continue;
        const tot = +r.total_line, spr = +r.spread_line, h = fx(r.home_team), a = fx(r.away_team);
        const ok = r.total_line !== '' && r.total_line !== 'NA' && r.spread_line !== '' && r.spread_line !== 'NA';
        GM[h] = { day: r.gameday, itt: ok ? (tot + spr) / 2 : null, spread: ok ? -spr : null, opp: a };
        GM[a] = { day: r.gameday, itt: ok ? (tot - spr) / 2 : null, spread: ok ? spr : null, opp: h };
    }
    // ── this week's injury report
    const INJ = {};
    if (F.injuries) for (const r of readCSV(F.injuries, ['season', 'week', 'gsis_id', 'report_status', 'practice_status', 'report_primary_injury', 'practice_primary_injury'])) {
        if (+r.season !== Y || +r.week !== W || !r.gsis_id) continue;
        const st = { Questionable: 1, Doubtful: 2, Out: 3 }[r.report_status] || 0;
        const ps = r.practice_status.toLowerCase(), pr = ps.includes('did not') ? 2 : ps.includes('limited') ? 1 : 0;
        const rest = /not injury|resting/.test((r.report_primary_injury + ' ' + r.practice_primary_injury).toLowerCase()) ? 1 : 0;
        INJ[r.gsis_id] = { st, pr, rest };
    }
    // ── who is active: the 53-man roster (ACT/INA) minus Out/Doubtful. Rosters
    // are published per week and list only the teams that played it, so each
    // team's own latest roster at or before this week stands (a team coming
    // off its bye was missing whole: BUF, JAX, WAS and LAC in week 8 2026).
    const RO = readCSV(F.roster, ['season', 'week', 'game_type', 'team', 'gsis_id', 'position', 'status']).filter(r => r.game_type === 'REG' && +r.season === Y && +r.week <= W);
    const teamWeek = {};
    for (const r of RO) { const t = fx(r.team); teamWeek[t] = Math.max(teamWeek[t] || 0, +r.week); }
    const rW = Object.keys(teamWeek).length ? Math.max(...Object.values(teamWeek)) : null;
    if (rW == null) throw new Error('no weekly roster for season ' + Y + ' at or before week ' + W);
    const ACTIVE = RO.filter(r => +r.week === teamWeek[fx(r.team)] && (r.status === 'ACT' || r.status === 'INA') && r.gsis_id && ['WR', 'TE', 'RB', 'FB'].includes(r.position))
        .filter(r => !((INJ[r.gsis_id] || {}).st >= 2))
        .map(r => ({ g: r.gsis_id, team: fx(r.team), pos: r.position === 'FB' ? 'RB' : r.position }));
    const byTeam = {};
    for (const a of ACTIVE) { a.u = usage(a.g); (byTeam[a.team] || (byTeam[a.team] = [])).push(a); }
    // ── depth chart: the last ESPN snapshot before gameday
    const DC = {};
    if (F.depth) {
        const rows = readCSV(F.depth, ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank']).filter(r => r.pos_abb === 'WR');
        const byDayTeam = {}, days = new Set();
        for (const r of rows) { const d = String(r.dt).slice(0, 10), t = fx(r.team); days.add(d); (byDayTeam[d + '|' + t] || (byDayTeam[d + '|' + t] = [])).push(r); }
        const D = [...days].sort();
        for (const t in GM) {
            let k = D.filter(d => d < GM[t].day).length - 1, s = null;
            while (k >= 0 && !s) { s = byDayTeam[D[k] + '|' + t] || null; k--; }
            if (!s) continue;
            const seen = new Set(), shOf = {}; (byTeam[t] || []).forEach(a => { shOf[a.g] = a.u.sh; });
            const L = s.filter(r => r.gsis_id && !seen.has(r.gsis_id) && seen.add(r.gsis_id))
                .map(r => ({ g: r.gsis_id, tier: Math.min(3, Math.ceil(+r.pos_rank / 3)), sh: shOf[r.gsis_id] || 0 }))
                .sort((a, b) => a.tier - b.tier || b.sh - a.sh);
            L.forEach((x, i) => { DC[x.g + '|' + t] = i + 1; });
        }
    }
    // ── the 18 inputs for every active WR, scored by both models
    const MED = JSON.parse(fs.readFileSync(process.env.WR_MODEL || path.join(ROOT, 'scripts/models/wr-median.json'), 'utf8'));
    const players = {};
    for (const t in byTeam) {
        const team = byTeam[t], gm = GM[t]; if (!gm) continue;   // bye
        const tg = TG[t] || { cn: 0, cd: 0, ln: 0, ld: 0 };
        const team_tgt_pg = blend(tg.cn, tg.cd, tg.ln, tg.ld, 3, 4, 33.0);
        const actSum = team.reduce((s, a) => s + a.u.sh, 0);
        const wrs = team.filter(a => a.pos === 'WR'), actWr = wrs.reduce((s, a) => s + a.u.sh, 0);
        const order = wrs.map((a, i) => [a.u.sh, i]).sort((p, q) => q[0] - p[0] || p[1] - q[1]);
        const hurtOf = a => { const j = INJ[a.g]; return j && !j.rest && (j.st > 0 || j.pr >= 1) ? 1 : 0; };
        const hurtSum = team.reduce((s, a) => s + a.u.sh * hurtOf(a), 0);
        wrs.forEach((a, i) => {
            const u = a.u, j = INJ[a.g] || { st: 0, pr: 0, rest: 0 }, p = P[a.g] || {};
            const listed = (!j.rest && (j.st > 0 || j.pr > 0)) ? 1 : 0;
            const norm_tgt = (u.sh / actSum) * 0.92 * team_tgt_pg;
            const c = CAR[a.g];
            const x = {
                norm_pts: norm_tgt * u.ppg / u.tpg, norm_tgt, sh_rank: order.findIndex(o => o[1] === i) + 1,
                snap_l1: u.snap_l1, snap_l3: u.snap_l3, itt_x_ppg: gm.itt != null ? gm.itt * u.ppg / 22.5 : null,
                exp_pts: u.tshare * team_tgt_pg * u.ppg / u.tpg, ppg: u.ppg, dc_rank: Math.min(7, DC[a.g + '|' + t] || 7),
                draft_pick_f: p.pick ?? 300, car_ppg: c && c.g > 0 ? c.fp / c.g : null, act_sh_wr: actWr, tpg: u.tpg,
                age: p.birth ? Math.floor((Date.parse(gm.day) - Date.parse(p.birth)) / 864e5) / 365.25 : null,
                inj_score: (j.st + j.pr) * (1 - j.rest), tm_hurt_sh: hurtSum - u.sh * listed, g_cur: u.g_cur, spread: gm.spread,
            };
            const r1 = (v, d) => v == null || !Number.isFinite(v) ? null : +v.toFixed(d);
            // [sleeper id, name, team, typical game (median, half-PPR), (reserved), targets, last snaps, team total]
            players[a.g] = [SID[a.g] || null, p.name || '', TO_APP[t] || t, r1(treePredict(MED, x), 2), null, r1(norm_tgt, 1), r1(u.snap_l1, 2), r1(gm.itt, 1)];
        });
    }
    // ── RBs and TEs: the same recipe, one model each (scripts/models/rb-features.mjs,
    // te-features.mjs: their own inputs, the same downloads and active roster).
    // RB 2025 56.4% / 2026 59.9% vs Sleeper, TE 58.5% / 59.0% (out of sample,
    // posted-roster path); the engine was RB 53.0 / 56.3, TE 52.8 / 55.3.
    const byPos = {};
    for (const [pos, env] of [['RB', 'RB_MODEL'], ['TE', 'TE_MODEL']]) {
        const lc = pos.toLowerCase(), tmp = path.join(CACHE, lc + '-rows.json');
        try {
            execFileSync(process.execPath, [path.join(ROOT, 'scripts/models/' + lc + '-features.mjs'), '--season=' + Y, '--week=' + W,
                '--model=' + (process.env[env] || path.join(ROOT, 'scripts/models/' + lc + '-median.json')), '--active=roster', '--out=' + tmp],
                { env: Object.assign({}, process.env, { MODEL_DATA: CACHE }), stdio: ['ignore', 'pipe', 'inherit'] });
            const rows = JSON.parse(fs.readFileSync(tmp, 'utf8')), m = {};
            const r1 = (v, d) => v == null || !Number.isFinite(v) ? null : +v.toFixed(d);
            for (const r of rows) {
                const p = P[r.gsis] || {}, gm = GM[r.team] || {}, x = r.x || {};
                // [sleeper id, name, team, typical game (median, half-PPR), (reserved), carries (RB) / targets (TE), last snaps, team total, targets (RB)]
                m[r.gsis] = [SID[r.gsis] || null, p.name || '', TO_APP[r.team] || r.team, r1(r.pred, 2), null,
                    r1(pos === 'RB' ? x.norm_car_v : x.norm_tgt, 1), r1(x.snap_l1, 2), r1(gm.itt, 1), pos === 'RB' ? r1(x.norm_tgt, 1) : null];
            }
            byPos[pos] = m;
            console.log(pos + ': ' + rows.length + ' scored');
        } catch (e) { console.log(pos + ' model skipped: ' + (e.message || e).toString().slice(0, 200)); }
    }
    // ── Defenders (DL, LB, DB): nine per-stat models (solo and assisted
    // tackles, TFL, sacks, QB hits, passes defended, INT, forced fumbles,
    // recoveries; scripts/models/idp/) give his expected IDP stat line; the
    // engine scores it with each league's own rules and maps it to the
    // typical game (idpMap). Out of sample vs Sleeper: 2025 60.3% std /
    // 62.5% in a big-play league, 2026 60.6% / 60.9%; the engine was lower
    // in every position, season and scoring.
    let idpMap = null;
    try {
        const md = process.env.IDP_MODELS || path.join(ROOT, 'scripts/models/idp'), tmp = path.join(CACHE, 'idp-rows.json');
        execFileSync(process.execPath, [path.join(ROOT, 'scripts/models/idp/idp-features.mjs'), '--season=' + Y, '--week=' + W, '--models=' + md, '--active=roster', '--out=' + tmp],
            { env: Object.assign({}, process.env, { MODEL_DATA: CACHE }), stdio: ['ignore', 'pipe', 'inherit'] });
        const map = JSON.parse(fs.readFileSync(path.join(md, 'idp-median-map.json'), 'utf8'));
        idpMap = { b0: map.b0, b_tackles: map.b_tackles, b_mid: map.b_mid, b_rare: map.b_rare, b_rare_p: map.b_rare_p, groups: map.groups };
        const rows = JSON.parse(fs.readFileSync(tmp, 'utf8'));
        const r1 = (v, d) => v == null || !Number.isFinite(v) ? null : +v.toFixed(d);
        // the expected line travels as an array in idpMap.keys order (a third of the size of objects)
        idpMap.keys = [...new Set([].concat(map.groups.tackles, map.groups.mid, map.groups.rare))];
        for (const r of rows) {
            const grp = ['DL', 'LB', 'DB'].includes(r.grp) ? r.grp : null; if (!grp) continue;
            const p = P[r.gsis] || {}, gm = GM[r.team] || {}, x = r.x || {}, l = r.line || {};
            // [sleeper id, name, team, typical game (standard IDP scoring), (reserved), tackles expected, last snaps, team total, (reserved), expected IDP stat line (idpMap.keys order)]
            (byPos[grp] || (byPos[grp] = {}))[r.gsis] = [SID[r.gsis] || null, p.name || '', TO_APP[r.team] || r.team, r1(r.typical && r.typical.std, 2), null,
                r1((l.idp_tkl_solo || 0) + (l.idp_tkl_ast || 0), 1), r1(x.snap_l1, 2), r1(gm.itt, 1), null, idpMap.keys.map(k => +(+(l[k] || 0)).toFixed(3))];
        }
        console.log('IDP: ' + rows.length + ' scored');
    } catch (e) { console.log('IDP models skipped: ' + (e.message || e).toString().slice(0, 200)); }
    const snapshot = {
        season: Y, week: W, built: new Date().toISOString(), source: 'nflverse (free) · DHQ WR, RB, TE and IDP models',
        model: { median: MED.name, trained: MED.trained_on, inputs: MED.features }, rosterWeek: rW,
        cols: ['sid', 'name', 'team', 'median', null, 'targets', 'snaps', 'teamTotal'], players,
        // RB and TE rows: [sid, name, team, median, null, carries (RB) / targets (TE), snaps, teamTotal, targets (RB)]
        // DL/LB/DB rows: [sid, name, team, typical (std), null, tackles, snaps, teamTotal, null, expected idp_* line in idpMap.keys order]
        byPos, idpMap,
    };
    const js = '// Generated by scripts/build-wr-model-snapshot.mjs — do not edit by hand.\n'
        + '// DHQ WR model (no Sleeper projection in it). Built ' + snapshot.built + '.\n'
        + '(function (root) { root.DhqWrModel = ' + JSON.stringify(snapshot) + ';\n'
        + 'if (typeof module !== "undefined" && module.exports) module.exports = root.DhqWrModel;\n'
        + '})(typeof window !== "undefined" ? window : globalThis);\n';
    fs.writeFileSync(OUT, js);
    const n = Object.keys(players).length, withSid = Object.values(players).filter(p => p[0]).length;
    console.log('wrote ' + path.relative(ROOT, OUT) + ' · ' + n + ' WRs (' + withSid + ' with a Sleeper id) · ' + Object.entries(byPos).map(([k, v]) => Object.keys(v).length + ' ' + k + 's').join(' · ') + ' · roster week ' + rW + ' · ' + Math.round(js.length / 1024) + ' KB');
    if (n < 60) throw new Error('only ' + n + ' WRs scored; refusing to publish a thin snapshot');
}
main().catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
