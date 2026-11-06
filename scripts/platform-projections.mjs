// ESPN's and CBS's weekly projections as Sleeper stat lines, keyed by
// Sleeper player id, so the score sheet can grade DHQ against them with
// each league's own scoring (App.calcRawPts).
//
//   import { fetchPlatformProjections } from './platform-projections.mjs';
//   const r = await fetchPlatformProjections({ season, week, players });
//   r.espn / r.cbs: { sleeperId: { pass_yd: 231.2, ... } } or null if that
//   source failed (logged, never thrown); r.fetched: { espn: iso, cbs: iso };
//   r.report: rows, matched, how they matched, the biggest misses.
//
//   node scripts/platform-projections.mjs 2026 9     # prints the report
//
// NFL.com's own fantasy game is shut down (ESPN is now the NFL's official
// game), so it is ESPN and CBS only. No keys; both are public pages.
//
// ── ESPN ──────────────────────────────────────────────────────────
// lm-api-reads.fantasy.espn.com .../seasons/Y/segments/0/leaguedefaults/3
// ?scoringPeriodId=W&view=kona_player_info. The weekly projection is the
// player.stats[] entry with statSourceId 1 (projected), statSplitTypeId 1
// (one week), seasonId Y, scoringPeriodId W (its id is "11" + Y + W; the
// filter below asks for only that entry, ~8 MB instead of 24 MB). Its raw
// `stats` dict (ESPN stat ids) is mapped to Sleeper keys with ESPN_MAP.
// Checked 2026 week 9: the mapped line scored with ESPN's PPR rules matches
// the entry's appliedTotal within 0.05 for all 677 lines (K and D/ST checked
// on the raw ids with ESPN's default K / D/ST rules); leaguedefaults/3 is
// PPR, /1 standard.
// D/ST ids are -16000 - proTeamId.
//
// ESPN stat id → Sleeper key (one week, expected values):
//   passing   0 att, 1 cmp, 3 yd, 4 td, 19 2pt, 20 int, 64 sacked, 211 first downs,
//             17 300-399 yd game, 18 400+ yd game
//   rushing   23 att, 24 yd, 25 td, 26 2pt, 212 first downs, 37 100-199 game, 38 200+ game
//   receiving 58 tgt, 53 rec, 42 yd, 43 td, 44 2pt, 213 first downs, 56 100-199 game, 57 200+ game
//   fumbles   68 fum, 72 fum_lost; returns 101+102 st_td, 114 kr_yd, 115 pr_yd
//   kicking   80/81/82 made/att/missed under 40 (split to 0-19/20-29/30-39 by
//             U40_SHARE, ESPN has no finer split), 77/78/79 40-49, 74/75/76 50+,
//             198/199/200 50-59 (60+ = 50+ minus 50-59), 83/84/85 all FG,
//             86/87/88 XP made/att/missed, 214 made FG yards
//   D/ST      99 sack, 95 int, 96 fum_rec, 106 ff, 98 safe, 97 blk_kick,
//             93+103+104 def_td (blocked-kick, INT and fumble return TDs),
//             101+102 def_st_td (kick and punt return TDs), 120 pts_allow,
//             127 yds_allow, 114/115 kick/punt return yards,
//             points-allowed odds 89 (0), 90 (1-6), 91 (7-13), 92 (14-17),
//             121 (18-21: 3/4 to 14-20, 1/4 to 21-27), 122 (22-27), 123 (28-34),
//             124+125 (35+); yards-allowed odds 128-136 (same bins as Sleeper's)
//   TE        bonus_rec_te = rec (the TE-premium key Sleeper's box scores carry)
//
// ── CBS ───────────────────────────────────────────────────────────
// www.cbssports.com/fantasy/football/stats/POS/Y/W/projections/ppr/ for QB,
// RB, WR, TE, K, DST. One page each, no pagination: CBS publishes its top
// 60 QB, 100 RB/WR/TE, every K and D/ST on a slate (other sort orders and
// ?page= return the same set). CBS serves only the CURRENT week (an older
// week's URL silently shows this week), so the page title ("Week 9 Proj")
// must name week W or the source is skipped. Columns are read by their
// sortcol names (passing_yds, receiving_rec, fg_40-49a, ...); D/ST points
// and yards allowed are one expected number each, put in the matching
// Sleeper bin (as Sleeper's own D/ST projections do). Kicker FG yards are
// estimated from the distance bins (18/25/35/45/53 yards).
//
// ── ids ───────────────────────────────────────────────────────────
// DynastyProcess db_playerids.csv (espn_id, cbs_id → sleeper_id), then
// Sleeper's own espn_id, then normalized name + team, then name + position
// when only one active player has it. D/ST → the team code (Sleeper's DEF id).
import path from 'node:path';

const ESPN_URL = (y, w) => 'https://lm-api-reads.fantasy.espn.com/apis/v3/games/ffl/seasons/' + y + '/segments/0/leaguedefaults/3?scoringPeriodId=' + w + '&view=kona_player_info';
const CBS_URL = (pos, y, w) => 'https://www.cbssports.com/fantasy/football/stats/' + pos + '/' + y + '/' + w + '/projections/ppr/';
const IDS_URL = 'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv';
const SLEEPER_PLAYERS = 'https://api.sleeper.app/v1/players/nfl';
const BROWSER = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36', Accept: 'text/html,application/json' };

const ESPN_TEAMS = { 1: 'ATL', 2: 'BUF', 3: 'CHI', 4: 'CIN', 5: 'CLE', 6: 'DAL', 7: 'DEN', 8: 'DET', 9: 'GB', 10: 'TEN', 11: 'IND', 12: 'KC', 13: 'LV', 14: 'LAR', 15: 'MIA', 16: 'MIN', 17: 'NE', 18: 'NO', 19: 'NYG', 20: 'NYJ', 21: 'PHI', 22: 'ARI', 23: 'PIT', 24: 'LAC', 25: 'SF', 26: 'SEA', 27: 'TB', 28: 'WAS', 29: 'CAR', 30: 'JAX', 33: 'BAL', 34: 'HOU' };
const ESPN_POS = { 1: 'QB', 2: 'RB', 3: 'WR', 4: 'TE', 5: 'K', 16: 'DEF' };
const TEAM_FIX = { JAC: 'JAX', WSH: 'WAS', LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
const team = (t) => { t = String(t || '').trim().toUpperCase(); return TEAM_FIX[t] || t; };
// Field goals under 40 yards split by distance (ESPN has one bin); NFL makes
// run about 1% / 47% / 52% inside 20, 20s, 30s; misses sit mostly in the 30s.
const U40_SHARE = { made: [0.01, 0.47, 0.52], miss: [0, 0.25, 0.75] };

const nm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.']/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z]/g, '');
const POS_GROUP = (p) => { p = String(p || '').toUpperCase(); return p === 'FB' ? 'RB' : p === 'DST' || p === 'D/ST' ? 'DEF' : p; };

// Compact: two decimals, zeros dropped.
function compact(line) {
    const o = {};
    for (const [k, v] of Object.entries(line)) { const r = Math.round(v * 100) / 100; if (Number.isFinite(r) && r !== 0) o[k] = r; }
    return o;
}

// ── ESPN stat dict → Sleeper keys ─────────────────────────────────
export function espnLine(s, pos) {
    const r = (id) => Number(s[id]) || 0;
    if (pos === 'DEF') {
        return compact({
            sack: r(99), int: r(95), fum_rec: r(96), ff: r(106), safe: r(98), blk_kick: r(97),
            def_td: r(93) + r(103) + r(104), def_st_td: r(101) + r(102), pts_allow: r(120), yds_allow: r(127), def_kr_yd: r(114), def_pr_yd: r(115),
            pts_allow_0: r(89), pts_allow_1_6: r(90), pts_allow_7_13: r(91), pts_allow_14_20: r(92) + 0.75 * r(121), pts_allow_21_27: 0.25 * r(121) + r(122), pts_allow_28_34: r(123), pts_allow_35p: r(124) + r(125),
            yds_allow_0_100: r(128), yds_allow_100_199: r(129), yds_allow_200_299: r(130), yds_allow_300_349: r(131), yds_allow_350_399: r(132), yds_allow_400_449: r(133), yds_allow_450_499: r(134), yds_allow_500_549: r(135), yds_allow_550p: r(136)
        });
    }
    if (pos === 'K') {
        const [a, b, c] = U40_SHARE.made, [x, y, z] = U40_SHARE.miss;
        return compact({
            fgm: r(83), fga: r(84), fgmiss: r(85), xpm: r(86), xpa: r(87), xpmiss: r(88), fgm_yds: r(214),
            fgm_0_19: a * r(80), fgm_20_29: b * r(80), fgm_30_39: c * r(80), fgm_40_49: r(77), fgm_50p: r(74), fgm_50_59: r(198), fgm_60p: Math.max(0, r(74) - r(198)),
            fgmiss_0_19: x * r(82), fgmiss_20_29: y * r(82), fgmiss_30_39: z * r(82), fgmiss_40_49: r(79), fgmiss_50p: r(76), fgmiss_50_59: r(200)
        });
    }
    const line = {
        pass_att: r(0), pass_cmp: r(1), pass_yd: r(3), pass_td: r(4), pass_2pt: r(19), pass_int: r(20), pass_sack: r(64), pass_fd: r(211),
        bonus_pass_yd_300: r(17), bonus_pass_yd_400: r(18),
        rush_att: r(23), rush_yd: r(24), rush_td: r(25), rush_2pt: r(26), rush_fd: r(212), bonus_rush_yd_100: r(37), bonus_rush_yd_200: r(38),
        rec_tgt: r(58), rec: r(53), rec_yd: r(42), rec_td: r(43), rec_2pt: r(44), rec_fd: r(213), bonus_rec_yd_100: r(56), bonus_rec_yd_200: r(57),
        fum: r(68), fum_lost: r(72), st_td: r(101) + r(102), kr_yd: r(114), pr_yd: r(115)
    };
    if (pos === 'TE') line.bonus_rec_te = line.rec;
    return compact(line);
}

// ── CBS row (column name → number) → Sleeper keys ─────────────────
const PA_BINS = [[0, 'pts_allow_0'], [6, 'pts_allow_1_6'], [13, 'pts_allow_7_13'], [20, 'pts_allow_14_20'], [27, 'pts_allow_21_27'], [34, 'pts_allow_28_34'], [Infinity, 'pts_allow_35p']];
const YA_BINS = [[99, 'yds_allow_0_100'], [199, 'yds_allow_100_199'], [299, 'yds_allow_200_299'], [349, 'yds_allow_300_349'], [399, 'yds_allow_350_399'], [449, 'yds_allow_400_449'], [499, 'yds_allow_450_499'], [549, 'yds_allow_500_549'], [Infinity, 'yds_allow_550p']];
const bin = (bins, v) => bins.find(([hi]) => v <= hi)[1];
export function cbsLine(c, pos) {
    const r = (k) => Number(c[k]) || 0;
    if (pos === 'DEF') {
        const pa = Math.round(r('pts')), ya = Math.round(r('yards+allowed_total'));
        const line = { sack: r('sck'), int: r('int'), fum_rec: r('frec'), ff: r('fum'), safe: r('sfty'), def_td: r('dtd'), pts_allow: r('pts'), yds_allow: r('yards+allowed_total') };
        if ('pts' in c) line[bin(PA_BINS, pa)] = 1;
        if ('yards+allowed_total' in c) line[bin(YA_BINS, ya)] = 1;
        return compact(line);
    }
    if (pos === 'K') {
        const m = (b) => r('fg_' + b), miss = (b) => Math.max(0, r('fg_' + b + 'a') - r('fg_' + b));
        return compact({
            fgm: r('fg_fgm'), fga: r('fg_fga'), fgmiss: Math.max(0, r('fg_fga') - r('fg_fgm')), xpm: r('xp_xpm'), xpa: r('xp_xpa'), xpmiss: Math.max(0, r('xp_xpa') - r('xp_xpm')),
            fgm_0_19: m('1-19'), fgm_20_29: m('20-29'), fgm_30_39: m('30-39'), fgm_40_49: m('40-49'), fgm_50p: m('50+'), fgm_50_59: m('50+'),
            fgmiss_0_19: miss('1-19'), fgmiss_20_29: miss('20-29'), fgmiss_30_39: miss('30-39'), fgmiss_40_49: miss('40-49'), fgmiss_50p: miss('50+'), fgmiss_50_59: miss('50+'),
            fgm_yds: 18 * m('1-19') + 25 * m('20-29') + 35 * m('30-39') + 45 * m('40-49') + 53 * m('50+')
        });
    }
    const line = {
        pass_att: r('passing_att'), pass_cmp: r('passing_cmp'), pass_yd: r('passing_yds'), pass_td: r('passing_td'), pass_int: r('passing_int'),
        rush_att: r('rushing_att'), rush_yd: r('rushing_yds'), rush_td: r('rushing_td'),
        rec_tgt: r('receiving_tgt'), rec: r('receiving_rec'), rec_yd: r('receiving_yds'), rec_td: r('receiving_td'), fum_lost: r('misc_fl')
    };
    if (pos === 'TE') line.bonus_rec_te = line.rec;
    return compact(line);
}

// ── fetch helpers ─────────────────────────────────────────────────
// Each try is raced against a plain (ref'd) timer as well as aborted: a
// stalled response with no live socket otherwise leaves an await that never
// settles, and Node would exit 0 mid-run without writing the lock (seen once
// in testing on a CBS page).
async function get(url, { headers = {}, as = 'json', tries = 3, timeout = 60000 } = {}) {
    let last;
    for (let i = 1; i <= tries; i++) {
        const ctl = new AbortController(); let timer;
        try {
            const work = (async () => {
                const r = await fetch(url, { headers: { ...BROWSER, ...headers }, signal: ctl.signal });
                if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
                return as === 'json' ? await r.json() : await r.text();
            })();
            work.catch(() => {});   // settles after a timeout too; not an unhandled rejection
            const stop = new Promise((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(new Error('timed out after ' + Math.round(timeout / 1000) + 's: ' + url)); }, timeout); });
            return await Promise.race([work, stop]);
        } catch (e) { last = e; if (i < tries) await new Promise(res => setTimeout(res, 1000 * i)); }
        finally { clearTimeout(timer); }
    }
    throw last;
}
function parseCSV(s, keep) {
    const out = []; let field = '', row = [], q = false, idx = null;
    const push = () => {
        if (!idx) idx = keep.map(k => row.indexOf(k));
        else if (row.length > 1) { const o = {}; keep.forEach((k, j) => { const v = idx[j] >= 0 ? row[idx[j]] : ''; o[k] = v === 'NA' ? '' : v; }); out.push(o); }
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
    return out;
}
const decode = (s) => String(s).replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// ── id matching ───────────────────────────────────────────────────
function buildMatcher(players, idRows) {
    const byEspn = {}, byCbs = {}, slEspn = {}, byNameTeam = {}, byNamePos = {};
    for (const r of idRows || []) {
        if (!r.sleeper_id || !players[r.sleeper_id]) continue;
        if (r.espn_id) byEspn[r.espn_id] = r.sleeper_id;
        if (r.cbs_id) byCbs[r.cbs_id] = r.sleeper_id;
    }
    for (const [pid, p] of Object.entries(players)) {
        if (!p || String(p.position) === 'DEF') continue;
        if (p.espn_id) slEspn[String(p.espn_id)] = pid;
        const n = nm(p.full_name || ((p.first_name || '') + ' ' + (p.last_name || '')));
        if (!n) continue;
        if (p.team) (byNameTeam[n + '|' + team(p.team)] = byNameTeam[n + '|' + team(p.team)] || []).push(pid);
        if (p.active !== false) { const k = n + '|' + POS_GROUP(p.position); (byNamePos[k] = byNamePos[k] || []).push(pid); }
    }
    const one = (a) => (a && a.length === 1 ? a[0] : null);
    return function match(src, { id, name, tm, pos }) {
        if (pos === 'DEF') { const T = team(tm); return players[T] ? [T, 'team'] : [null, 'none']; }
        const dp = src === 'espn' ? byEspn[id] : byCbs[id];
        if (dp) return [dp, 'id map'];
        if (src === 'espn' && slEspn[id]) return [slEspn[id], 'sleeper espn_id'];
        const n = nm(name);
        const t = one(byNameTeam[n + '|' + team(tm)]); if (t) return [t, 'name+team'];
        const p = one(byNamePos[n + '|' + pos]); if (p) return [p, 'name+pos'];
        return [null, 'none'];
    };
}

// ── sources ───────────────────────────────────────────────────────
async function espnRows(season, week) {
    const want = '11' + season + week;   // statSourceId 1 + statSplitTypeId 1 + season + week
    const filter = { players: { limit: 2000, sortPercOwned: { sortPriority: 1, sortAsc: false }, filterStatsForTopScoringPeriodIds: { value: 1, additionalValue: [want] } } };
    const d = await get(ESPN_URL(season, week), { headers: { 'X-Fantasy-Filter': JSON.stringify(filter), Accept: 'application/json' }, tries: 2, timeout: 90000 });
    if (!d || !Array.isArray(d.players)) throw new Error('ESPN: no players array');
    const rows = [];
    for (const e of d.players) {
        const pl = e.player || {}, pos = ESPN_POS[pl.defaultPositionId]; if (!pos) continue;
        const st = (pl.stats || []).find(s => s.statSourceId === 1 && s.statSplitTypeId === 1 && Number(s.scoringPeriodId) === week && Number(s.seasonId) === season);
        if (!st) continue;
        rows.push({ id: String(pl.id), name: pl.fullName, tm: ESPN_TEAMS[pl.proTeamId] || '', pos, line: espnLine(st.stats || {}, pos), applied: st.appliedTotal, raw: st.stats || {} });
    }
    if (!rows.length) throw new Error('ESPN: no week ' + week + ' projections in the response');
    return rows;
}
async function cbsRows(season, week) {
    const rows = []; const pages = { QB: 'QB', RB: 'RB', WR: 'WR', TE: 'TE', K: 'K', DST: 'DEF' };
    for (const [P, pos] of Object.entries(pages)) {
        const h = await get(CBS_URL(P, season, week), { as: 'text', tries: 2, timeout: 30000 });
        const wk = (h.match(/<title>\s*Week\s+(\d+)\s+Proj/i) || [])[1];
        if (Number(wk) !== week) throw new Error('CBS ' + P + ' page shows week ' + (wk || '?') + ', not week ' + week + ' (CBS serves only the current week)');
        const t0 = h.indexOf('<table class="TableBase-table"'); if (t0 < 0) throw new Error('CBS ' + P + ': no stats table');
        const t = h.slice(t0, h.indexOf('</table>', t0));
        const head = t.slice(0, t.indexOf('</thead>'));
        const cols = [...head.matchAll(/<th[^>]*class="TableBase-headTh[\s\S]*?<\/th>/g)].map(m => decodeURIComponent((m[0].match(/sortcol=([^&"]+)/) || [])[1] || ''));
        if (!cols.length || cols[0] !== (pos === 'DEF' ? 'team' : 'player')) throw new Error('CBS ' + P + ': unexpected columns ' + cols.slice(0, 4).join(','));
        const body = t.slice(t.indexOf('<tbody'));
        let n = 0;
        for (const m of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)) {
            const tds = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(x => x[1]);
            if (tds.length !== cols.length) continue;
            const c = {}; cols.forEach((k, i) => { if (i) { const v = parseFloat(decode(tds[i])); if (Number.isFinite(v)) c[k] = v; } });
            let id = null, name = '', tm = '';
            if (pos === 'DEF') { tm = (tds[0].match(/\/nfl\/teams\/([A-Z]+)\//) || [])[1] || ''; name = decode(tds[0]); }
            else {
                const long = tds[0].match(/CellPlayerName--long[\s\S]*?<a href="\/nfl\/players\/(\d+)\/[^"]*"[^>]*>([^<]*)<\/a>[\s\S]*?CellPlayerName-team">([^<]*)</);
                if (!long) continue;
                id = long[1]; name = decode(long[2]); tm = decode(long[3]);
            }
            rows.push({ id, name, tm, pos, line: cbsLine(c, pos), applied: c.misc_fpts != null ? c.misc_fpts : c.fpts });
            n++;
        }
        if (!n) throw new Error('CBS ' + P + ': no rows parsed');
    }
    return rows;
}

// ── the whole thing ───────────────────────────────────────────────
export async function fetchPlatformProjections({ season, week, players = null, log = console.log, sources = ['espn', 'cbs'], keepRows = false } = {}) {
    season = Number(season); week = Number(week);
    const out = { espn: null, cbs: null, fetched: {}, errors: {}, report: {} };
    try { if (!players) players = await get(SLEEPER_PLAYERS); }
    catch (e) { log('platforms: Sleeper players unavailable (' + e.message + '); skipping ESPN and CBS'); out.errors.players = e.message; return out; }
    let idRows = [];
    try { idRows = parseCSV(await get(IDS_URL, { as: 'text' }), ['sleeper_id', 'espn_id', 'cbs_id']); }
    catch (e) { log('platforms: DynastyProcess id map unavailable (' + e.message + '); matching by Sleeper espn_id and name'); }
    const match = buildMatcher(players, idRows);
    const fetchers = { espn: espnRows, cbs: cbsRows };
    for (const src of sources) {
        try {
            const rows = await fetchers[src](season, week);
            const lines = {}, how = {}, missed = [];
            for (const r of rows) {
                const [sid, via] = match(src, r);
                how[via] = (how[via] || 0) + 1;
                if (!sid) { missed.push(r); continue; }
                if (lines[sid]) continue;   // first (highest-owned / highest-ranked) row wins
                lines[sid] = r.line;
                r.sid = sid;
            }
            out[src] = lines;
            out.fetched[src] = new Date().toISOString();
            missed.sort((a, b) => (b.applied || 0) - (a.applied || 0));
            out.report[src] = { rows: rows.length, matched: rows.length - missed.length, how, unmatched: missed.slice(0, 12).map(r => r.name + ' (' + r.pos + ' ' + (r.tm || '?') + ', ' + (+(r.applied || 0)).toFixed(1) + ')') };
            if (keepRows) out.report[src].list = rows;
            log('platforms: ' + src.toUpperCase() + ' ' + rows.length + ' week-' + week + ' lines, ' + (rows.length - missed.length) + ' matched to Sleeper (' + Object.entries(how).map(([k, v]) => v + ' ' + k).join(', ') + ')');
        } catch (e) {
            out.errors[src] = e.message || String(e);
            log('platforms: ' + src.toUpperCase() + ' unavailable, skipped: ' + out.errors[src]);
        }
    }
    return out;
}

// ── CLI: node scripts/platform-projections.mjs 2026 9 ─────────────
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
    const [y, w] = process.argv.slice(2).map(Number);
    if (!y || !w) { console.error('usage: node scripts/platform-projections.mjs <season> <week>'); process.exit(2); }
    const r = await fetchPlatformProjections({ season: y, week: w });
    console.log(JSON.stringify({ report: r.report, errors: r.errors, fetched: r.fetched, counts: { espn: r.espn && Object.keys(r.espn).length, cbs: r.cbs && Object.keys(r.cbs).length } }, null, 1));
}
