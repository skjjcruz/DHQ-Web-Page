// Reference implementation (Node, no dependencies) of DHQ's stand-alone defender (IDP: DL, LB, DB) projection:
// the 44 inputs of the per-stat models, computed only from free nflverse files, scored with the exported trees (same
// format and evaluator as the WR model; Poisson models, so each stat = exp(sum of leaves)), the full expected IDP stat
// line, and the league-independent typical-game (median) mapping applied to the two reference scorings.
// Same download set as scripts/build-wr-model-snapshot.mjs — nothing else is needed.
//
// node idp-features.mjs --season=2026 --week=8 [--models=<dir with idp_<stat>_prod.json, idp-median-map.json, idp-norms.json>]
//                       [--active=roster|snaps] [--out=f.json]
//   files (MODEL_DATA, nflverse names): stats_player_week_<yr>.csv for 2013..season, snap_counts_<yr>.csv for season-1
//   and season, players.csv, games.csv, injuries_<season>.csv, depth_charts_<season>.csv (ESPN daily format, 2025+),
//   roster_weekly_<season>.csv.
// Output rows: { gsis, team, grp (DL/LB/DB from nflverse players.csv), pos, x: {inputs}, line: {idp_* expected stats},
//   parts: {std: [tackle pts, TFL/QB-hit/PD pts, big-play pts], psy: [...]}, typical: {std, psy} }.
// Any other league: typical = idpTypical(line, league scoring_settings, map) (exported below).
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const HERE = path.dirname(new URL(import.meta.url).pathname);
const { wrTreePredict } = require(fs.existsSync(path.join(HERE, 'tree-eval.js')) ? path.join(HERE, 'tree-eval.js') : path.join(HERE, 'wr-tree-eval.js'));

const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
const Y = +A.season, W = +A.week;
const MD = (A.models || HERE).replace(/\/?$/, '/');
// Files: the weekly job's download folder (scripts/build-wr-model-snapshot.mjs), same names as nflverse's.
const D = (process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
const F = {
  stats: y => D + `stats_player_week_${y}.csv`, snaps: y => D + `snap_counts_${y}.csv`,
  players: D + 'players.csv', games: D + 'games.csv',
  injuries: y => D + `injuries_${y}.csv`, depth: y => D + `depth_charts_${y}.csv`, roster: y => D + `roster_weekly_${y}.csv`,
};

// ---------------------------------------------------------------- tiny CSV reader (quotes, embedded newlines)
function readCSV(p, keep) {
  const s = fs.readFileSync(p, 'utf8'); const rows = []; let i = 0, field = '', row = [], q = false, hdr = null, idx = null;
  const push = () => {
    if (!hdr) { hdr = row; idx = keep.map(k => hdr.indexOf(k)); }
    else if (row.length > 1) { const o = {}; keep.forEach((k, j) => { o[k] = idx[j] >= 0 ? row[idx[j]] : ''; }); rows.push(o); }
    row = [];
  };
  for (; i < s.length; i++) {
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
const isNA = v => v === '' || v === undefined || v === 'NA';
const FIX = { LAR: 'LA', OAK: 'LV', SD: 'LAC', STL: 'LA' }; const fx = t => FIX[t] || t;
const nm = s => String(s).toLowerCase().replace(/[.']/g, '').replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '').replace(/[^a-z]/g, '');
const blend = (cn, cd, ln, ld, K, K2, lg) => (cn + K * ((ln + K2 * lg) / (ld + K2))) / (cd + K);
const S = (a, k) => a.reduce((s, x) => s + x[k], 0);
const GRP = { DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', LB: 'LB', OLB: 'LB', ILB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DB: 'DB', SAF: 'DB' };
const GNUM = { DL: 0, LB: 1, DB: 2 };
const ROLE = { DE: 1, OLB: 3, LB: 4, ILB: 4, MLB: 4, DT: 2, NT: 2, DL: 1.5, CB: 5, DB: 5.5, S: 6, SS: 6, FS: 6, SAF: 6 };
const ROLE_G = { DL: 1.5, LB: 4, DB: 5.5 };
const NORM = JSON.parse(fs.readFileSync(MD + 'idp-norms.json'));
const LGT = NORM._league.tm_tkl_pg, LGD = NORM._league.tm_dsn_pg;
const STATS = ['solo', 'ast', 'tfl', 'sack', 'qbh', 'pd', 'int', 'ff', 'fr'];

// ---------------------------------------------------------------- players
const P = {}, pfr2g = {};
for (const r of readCSV(F.players, ['gsis_id', 'position', 'birth_date', 'draft_pick', 'pfr_id'])) {
  if (r.pfr_id && !isNA(r.pfr_id)) pfr2g[r.pfr_id] = r.gsis_id;
  if (!r.gsis_id) continue;
  P[r.gsis_id] = { pos: isNA(r.position) ? '' : r.position, birth: isNA(r.birth_date) ? '' : r.birth_date, pick: isNA(r.draft_pick) ? 300 : Math.min(300, +r.draft_pick) };
}
// ---------------------------------------------------------------- games (Vegas, opponents)
const GL = {}, GM = {};
for (const r of readCSV(F.games, ['season', 'game_type', 'week', 'gameday', 'home_team', 'away_team', 'spread_line', 'total_line'])) {
  if (r.game_type !== 'REG') continue;
  const y = +r.season, w = +r.week, h = fx(r.home_team), a = fx(r.away_team);
  GL[`${h}|${y}|${w}`] = a; GL[`${a}|${y}|${w}`] = h;
  if (y !== Y || w !== W) continue;
  const okS = !isNA(r.spread_line), okT = !isNA(r.total_line), spr = +r.spread_line;
  GM[h] = { day: r.gameday, opp: a, spread: okS ? -spr : null, total: okT ? +r.total_line : null };
  GM[a] = { day: r.gameday, opp: h, spread: okS ? spr : null, total: okT ? +r.total_line : null };
}
// ---------------------------------------------------------------- weekly stats: defence stats, team totals, career
const DCOL = ['def_tackles_solo', 'def_tackles_with_assist', 'def_tackle_assists', 'def_tackles_for_loss', 'def_sacks', 'def_qb_hits', 'def_pass_defended',
  'def_interceptions', 'def_fumbles_forced', 'fumble_recovery_opp', 'def_tds'];
const defOf = r => ({ solo: num(r.def_tackles_solo) + num(r.def_tackles_with_assist), ast: num(r.def_tackle_assists), tfl: num(r.def_tackles_for_loss),
  sack: num(r.def_sacks), qbh: num(r.def_qb_hits), pd: num(r.def_pass_defended), int: num(r.def_interceptions), ff: num(r.def_fumbles_forced),
  fr: num(r.fumble_recovery_opp), td: num(r.def_tds) });
const ST = {}, TT = {}, CAR = {}, name2g = {};
for (let y = 2013; y <= Y; y++) {
  if (!fs.existsSync(F.stats(y))) continue;
  for (const r of readCSV(F.stats(y), ['player_id', 'player_display_name', 'season', 'week', 'season_type', 'team', ...DCOL])) {
    if (r.season_type !== 'REG' || !r.player_id) continue;
    const w = +r.week, t = fx(r.team), d = defOf(r);
    if (y < Y) {
      const c = CAR[r.player_id] || (CAR[r.player_id] = { g: 0, tkl: 0, sack: 0, pd: 0, int: 0, std: 0 });
      c.g += 1; c.tkl += d.solo + d.ast; c.sack += d.sack; c.pd += d.pd; c.int += d.int;
      c.std += d.solo + .5 * d.ast + d.tfl + 2 * d.sack + d.qbh + 3 * d.int + d.pd + 2 * d.ff + 2 * d.fr + 6 * d.td;
    }
    if (y >= Y - 1 && !(y === Y && w >= W)) {
      const k = `${r.player_id}|${y}|${w}`;
      if (!ST[k]) ST[k] = d;   // first row per player-week (Python drops later duplicates)
      const tk = `${t}|${y}|${w}`, T = TT[tk] || (TT[tk] = { tkl: 0, sack: 0, pd: 0, qbh: 0 });
      T.tkl += d.solo + d.ast; T.sack += d.sack; T.pd += d.pd; T.qbh += d.qbh;
    }
    if (y >= Y - 1) name2g[`${nm(r.player_display_name)}|${t}|${y}|${w}`] = r.player_id;
  }
}
// ---------------------------------------------------------------- snap counts: team plays, defender games
const PLAYS = {};     // team|y|w -> {dsn: max defence snaps, osn: max offence snaps}
const G = {};         // gsis -> [{y,w,team,grp,dsn,dpct,st,...stats,tm_tkl,tm_sack}]
const seen = new Set();
for (const y of [Y - 1, Y]) {
  if (!fs.existsSync(F.snaps(y))) continue;
  for (const r of readCSV(F.snaps(y), ['season', 'game_type', 'week', 'player', 'pfr_player_id', 'position', 'team', 'offense_snaps', 'defense_snaps', 'defense_pct', 'st_snaps'])) {
    if (r.game_type !== 'REG') continue;
    const w = +r.week, t = fx(r.team);
    if (y === Y && w >= W) continue;
    const pk = `${t}|${y}|${w}`, pl = PLAYS[pk] || (PLAYS[pk] = { dsn: 0, osn: 0 });
    pl.dsn = Math.max(pl.dsn, num(r.defense_snaps)); pl.osn = Math.max(pl.osn, num(r.offense_snaps));
    if (!(num(r.defense_snaps) > 0 || num(r.st_snaps) > 0)) continue;
    const g = pfr2g[r.pfr_player_id] || name2g[`${nm(r.player)}|${t}|${y}|${w}`];
    if (!g) continue;
    const npos = (P[g] && P[g].pos) || r.position, grp = GRP[npos];
    if (!grp || !GRP[r.position]) continue;
    if (seen.has(g + '|' + y + '|' + w)) continue; seen.add(g + '|' + y + '|' + w);
    const s = ST[`${g}|${y}|${w}`] || { solo: 0, ast: 0, tfl: 0, sack: 0, qbh: 0, pd: 0, int: 0, ff: 0, fr: 0, td: 0 };
    const T = TT[pk] || { tkl: 0, sack: 0 };
    (G[g] || (G[g] = [])).push({ y, w, team: t, grp, dsn: num(r.defense_snaps), dpct: num(r.defense_pct), st: num(r.st_snaps), ...s, tkl: s.solo + s.ast,
      tm_tkl: T.tkl, tm_sack: T.sack });
  }
}
for (const g in G) G[g].sort((a, b) => a.y - b.y || a.w - b.w);
// team defence per game (team-weeks with stats rows): tackles, defensive snaps
const TG = {};
for (const k in TT) {
  const [t, y] = k.split('|'), cur = +y === Y, o = TG[t] || (TG[t] = { c: { g: 0, tkl: 0, dsn: 0 }, l: { g: 0, tkl: 0, dsn: 0 } }), b = cur ? o.c : o.l;
  b.g += 1; b.tkl += TT[k].tkl; b.dsn += (PLAYS[k] || { dsn: 0 }).dsn;
}
// opponent offence per game: offence plays, and what defences did against it (tackles, sacks, PD, QB hits)
const OG = {};
for (const k in TT) {
  const [t, y, w] = k.split('|'), cur = +y === Y, o = OG[t] || (OG[t] = { c: { g: 0, osn: 0, tkl: 0, sack: 0, pd: 0, qbh: 0 }, l: { g: 0, osn: 0, tkl: 0, sack: 0, pd: 0, qbh: 0 } });
  const b = cur ? o.c : o.l, dteam = GL[k], dt = dteam ? TT[`${dteam}|${y}|${w}`] : null;
  b.g += 1; b.osn += (PLAYS[k] || { osn: 0 }).osn;
  if (dt) { b.tkl += dt.tkl; b.sack += dt.sack; b.pd += dt.pd; b.qbh += dt.qbh; }
}
function usage(g, grp) {
  const L = G[g] || [], cur = L.filter(x => x.y === Y), last = L.filter(x => x.y === Y - 1), N = NORM[grp];
  const c = {}, l = {};
  for (const k of ['dsn', 'dpct', 'st', 'tkl', 'tm_tkl', 'sack', 'tm_sack', ...STATS]) { c[k] = S(cur, k); l[k] = S(last, k); }
  c.g = cur.length; l.g = last.length;
  const pct = cur.map(x => x.dpct), u = { g_cur: c.g };
  u.snap_pct = blend(c.dpct, c.g, l.dpct, l.g, 3, 4, N.pct);
  u.st_pg = blend(c.st, c.g, l.st, l.g, 3, 4, 8.0);
  u.tsh = blend(c.tkl, c.tm_tkl, l.tkl, l.tm_tkl, 180, 300, N.tsh);
  u.pg_solo = blend(c.solo, c.g, l.solo, l.g, 3, 4, N.pg_solo);
  u.pg_tkl = blend(c.tkl, c.g, l.tkl, l.g, 3, 4, N.pg_tkl);
  for (const k of [...STATS, 'tkl']) u['ps_' + k] = blend(c[k], c.dsn, l[k], l.dsn, 150, 300, N['ps_' + k]);
  const r4 = v => Math.round(v * 1e4) / 1e4;   // same rounding as the Python training data
  u.snap_l1 = pct.length ? r4(pct[pct.length - 1]) : null;
  u.snap_l3 = pct.length ? r4(pct.slice(-3).reduce((a, b) => a + b, 0) / pct.slice(-3).length) : null;
  // competition (all active defenders): tackle share and snap share with a tiny prior
  u.tsh_pit = blend(c.tkl, c.tm_tkl, l.tkl, l.tm_tkl, 180, 300, 0.01);
  u.pct_pit = blend(c.dpct, c.g, l.dpct, l.g, 3, 4, 0.15);
  return u;
}
// ---------------------------------------------------------------- injury report for week W
const INJ = {};
if (fs.existsSync(F.injuries(Y))) for (const r of readCSV(F.injuries(Y), ['season', 'week', 'gsis_id', 'report_status', 'practice_status', 'report_primary_injury', 'practice_primary_injury'])) {
  if (+r.season !== Y || +r.week !== W || !r.gsis_id) continue;
  const st = { Questionable: 1, Doubtful: 2, Out: 3 }[r.report_status] || 0;
  const ps = r.practice_status.toLowerCase(), pr = ps.includes('did not') ? 2 : ps.includes('limited') ? 1 : 0;
  const rest = /not injury|resting/.test((r.report_primary_injury + ' ' + r.practice_primary_injury).toLowerCase()) ? 1 : 0;
  INJ[r.gsis_id] = { st, pr, rest };
}
// ---------------------------------------------------------------- who is active (defenders)
let ACTIVE;
if ((A.active || 'roster') === 'roster') {   // live: 53-man roster (ACT/INA) minus Out/Doubtful; each team's own latest posted roster <= W
  const RO = readCSV(F.roster(Y), ['season', 'week', 'game_type', 'team', 'gsis_id', 'position', 'status']).filter(r => r.game_type === 'REG' && +r.season === Y);
  const tw = {}; for (const r of RO) { const w = +r.week; if (w <= W) tw[fx(r.team)] = Math.max(tw[fx(r.team)] || 0, w); }
  const sg = new Set();
  ACTIVE = RO.filter(r => +r.week === tw[fx(r.team)] && (r.status === 'ACT' || r.status === 'INA') && r.gsis_id && GRP[r.position])
    .filter(r => !((INJ[r.gsis_id] || {}).st >= 2))
    .filter(r => !sg.has(r.gsis_id) && sg.add(r.gsis_id))
    .map(r => { const npos = (P[r.gsis_id] && GRP[P[r.gsis_id].pos]) ? P[r.gsis_id].pos : r.position; return { g: r.gsis_id, team: fx(r.team), npos, grp: GRP[npos] }; });
} else {                                      // backtest: who actually played week W (snap file)
  ACTIVE = [];
  const sg = new Set();
  for (const r of readCSV(F.snaps(Y), ['season', 'game_type', 'week', 'player', 'pfr_player_id', 'position', 'team', 'defense_snaps', 'st_snaps'])) {
    if (r.game_type !== 'REG' || +r.week !== W || !(num(r.defense_snaps) > 0 || num(r.st_snaps) > 0)) continue;
    const t = fx(r.team), g = pfr2g[r.pfr_player_id] || name2g[`${nm(r.player)}|${t}|${Y}|${W}`];
    if (!g || sg.has(g)) continue;
    const npos = (P[g] && P[g].pos) || r.position;
    if (!GRP[npos] || !GRP[r.position]) continue;
    sg.add(g); ACTIVE.push({ g, team: t, npos, grp: GRP[npos] });
  }
}
const isActive = new Set(ACTIVE.map(a => a.g));
const byTeam = {};
for (const a of ACTIVE) { a.u = usage(a.g, a.grp); (byTeam[a.team] || (byTeam[a.team] = [])).push(a); }
// teammates out: season-to-date tackle share >= 3% (or sack share >= 10%) of defenders whose last team is t and who are not active
const FREED = {};
{
  const agg = {};
  for (const g in G) for (const x of G[g]) {
    if (x.y !== Y) continue;
    const o = agg[g] || (agg[g] = { tkl: 0, tm_tkl: 0, sack: 0, tm_sack: 0, team: null, grp: null, w: -1 });
    o.tkl += x.tkl; o.tm_tkl += x.tm_tkl; o.sack += x.sack; o.tm_sack += x.tm_sack;
    if (x.w > o.w) { o.w = x.w; o.team = x.team; o.grp = x.grp; }
  }
  for (const g in agg) {
    const o = agg[g], ts = o.tm_tkl > 0 ? o.tkl / o.tm_tkl : 0, ss = o.tm_sack > 0 ? o.sack / o.tm_sack : 0;
    if (!(ts >= 0.03 || ss >= 0.10) || isActive.has(g)) continue;
    const k = o.team + '|' + o.grp; FREED[k] = (FREED[k] || 0) + ts;
  }
}
// ---------------------------------------------------------------- depth chart (ESPN daily snapshot, last day before gameday): defensive slots
const DEFP = new Set(['LDE', 'RDE', 'LDT', 'RDT', 'NT', 'WLB', 'SLB', 'MLB', 'LILB', 'RILB', 'LCB', 'RCB', 'NB', 'FS', 'SS']);
const DCT = {}, DCR = {};
if (Y >= 2025 && fs.existsSync(F.depth(Y))) {
  const rows = readCSV(F.depth(Y), ['dt', 'team', 'gsis_id', 'pos_abb', 'pos_rank']).filter(r => DEFP.has(r.pos_abb));
  const byDayTeam = {}, days = new Set();
  for (const r of rows) { const d = r.dt.slice(0, 10), t = fx(r.team); days.add(d); (byDayTeam[d + '|' + t] || (byDayTeam[d + '|' + t] = [])).push(r); }
  const Dd = [...days].sort();
  for (const t in GM) {
    let k = Dd.filter(d => d < GM[t].day).length - 1, s = null;
    while (k >= 0 && !s) { s = byDayTeam[Dd[k] + '|' + t] || null; k--; }
    if (!s) continue;
    const rk = {};
    for (const r of s) if (r.gsis_id && !isNA(r.gsis_id)) rk[r.gsis_id] = Math.min(rk[r.gsis_id] ?? Infinity, +r.pos_rank);
    for (const g in rk) DCT[g + '|' + t] = Math.min(3, rk[g]);
    // rank inside the position group among ACTIVE players on the chart: tier, then tackle share, then id
    const L = (byTeam[t] || []).filter(a => DCT[a.g + '|' + t] !== undefined)
      .map(a => ({ g: a.g, grp: a.grp, tier: DCT[a.g + '|' + t], o: a.u.tsh_pit }))
      .sort((a, b) => (a.grp < b.grp ? -1 : a.grp > b.grp ? 1 : 0) || a.tier - b.tier || b.o - a.o || (a.g < b.g ? -1 : a.g > b.g ? 1 : 0));
    const n = {}; for (const x of L) { n[x.grp] = (n[x.grp] || 0) + 1; DCR[x.g + '|' + t] = n[x.grp]; }
  }
}
// ---------------------------------------------------------------- models + mapping
const MODELS = Object.fromEntries(STATS.map(k => [k, JSON.parse(fs.readFileSync(MD + `idp_${k}_prod.json`))]));
const MAP = JSON.parse(fs.readFileSync(MD + 'idp-median-map.json'));
export function fullLine(E, map = MAP) {          // expected main stats -> every Sleeper idp_* key
  const R = map.ratio, mu = E.pd;
  return {
    idp_tkl_solo: E.solo, idp_tkl_ast: E.ast, idp_tkl: E.solo + E.ast, idp_tkl_loss: E.tfl, idp_sack: E.sack, idp_qb_hit: E.qbh, idp_pass_def: E.pd,
    idp_int: E.int, idp_ff: E.ff, idp_fum_rec: E.fr, idp_def_td: R.td * (E.int + E.fr), idp_safe: R.sfty * E.sack, idp_blk_kick: R.blk,
    idp_sack_yd: R.sackyd * E.sack, idp_int_ret_yd: R.intyd * E.int, idp_fum_ret_yd: R.fryd * E.fr,
    idp_pass_def_3p: 1 - Math.exp(-mu) * (1 + mu + mu * mu / 2),
  };
}
export function idpParts(line, scoring, map = MAP) {   // league-scored expected points: [tackles, TFL/QB hit/PD, big plays]
  const pts = keys => keys.reduce((s, k) => s + (+(scoring[k] || 0)) * (line[k] || 0), 0);
  return [pts(map.groups.tackles), pts(map.groups.mid), pts(map.groups.rare)];
}
export function idpTypical(line, scoring, map = MAP) {  // the shown number: typical (median) game in that league's scoring
  const [t, m, r] = idpParts(line, scoring, map);
  const pBig = 1 - Math.exp(-((line.idp_sack || 0) + (line.idp_int || 0) + (line.idp_ff || 0) + (line.idp_fum_rec || 0)));   // P(any big play)
  return Math.max(0, map.b0 + map.b_tackles * t + map.b_mid * m + r * (map.b_rare + map.b_rare_p * pBig));
}
const SCO = MAP.scorings;
const out = [];
for (const t in byTeam) {
  const team = byTeam[t], gm = GM[t]; if (!gm) continue;   // bye
  const tg = TG[t] || { c: { g: 0, tkl: 0, dsn: 0 }, l: { g: 0, tkl: 0, dsn: 0 } };
  const og = OG[gm.opp] || { c: { g: 0, osn: 0, tkl: 0, sack: 0, pd: 0, qbh: 0 }, l: { g: 0, osn: 0, tkl: 0, sack: 0, pd: 0, qbh: 0 } };
  const ob = (k, K, K2, lg) => blend(og.c[k], og.c.g, og.l[k], og.l.g, K, K2, lg);
  const tm_tkl_pg = blend(tg.c.tkl, tg.c.g, tg.l.tkl, tg.l.g, 3, 4, LGT), tm_dsn_pg = blend(tg.c.dsn, tg.c.g, tg.l.dsn, tg.l.g, 3, 4, LGD);
  const opp_plays_pg = ob('osn', 4, 6, 63.0), opp_tkl_conc = ob('tkl', 4, 6, LGT), opp_sack_conc = ob('sack', 4, 6, 2.4);
  const opp_pd_conc = ob('pd', 4, 6, 5.5), opp_qbh_conc = ob('qbh', 4, 6, 5.5);
  const actT = team.reduce((s, a) => s + a.u.tsh_pit, 0), actG = {};
  for (const a of team) actG[a.grp] = (actG[a.grp] || 0) + a.u.tsh_pit;
  for (const a of team) {
    const u = a.u, j = INJ[a.g] || { st: 0, pr: 0, rest: 0 }, p = P[a.g] || {}, c = CAR[a.g];
    const snap_w = u.snap_l3 ?? u.snap_pct, exp_dsn = snap_w * (tm_dsn_pg + opp_plays_pg) / 2;
    const e = k => u['ps_' + k] * exp_dsn;
    const x = {
      exp_solo: e('solo'), exp_ast: e('ast'), exp_tfl: e('tfl'), exp_sack: e('sack'), exp_qbh: e('qbh'), exp_pd: e('pd'), exp_int: e('int'),
      exp_ff: e('ff'), exp_fr: e('fr'), exp_dsn,
      exp_pd_opp: e('pd') * opp_pd_conc / 5.5, exp_sack_opp: e('sack') * opp_sack_conc / 2.4, exp_tkl_opp: e('tkl') * opp_tkl_conc / LGT,
      snap_l1: u.snap_l1, snap_l3: u.snap_l3, own_pct: u.pct_pit, dc_rank: Math.min(9, DCR[a.g + '|' + t] || 9), dc_tier: DCT[a.g + '|' + t] ?? 4,
      grp_n: GNUM[a.grp], role: ROLE[a.npos] ?? ROLE_G[a.grp], st_pg: u.st_pg,
      grp_sh_of_active: u.tsh_pit / actG[a.grp], act_tsh_grp: actG[a.grp], act_tsh: actT, freed_tsh_grp: FREED[t + '|' + a.grp] || 0,
      norm_tkl: u.tsh_pit / actT * tm_tkl_pg, tsh: u.tsh,
      opp_qbh_conc_pg: opp_qbh_conc, opp_pd_conc_pg: opp_pd_conc, spread: gm.spread, total: gm.total,
      pg_solo: u.pg_solo, pg_tkl: u.pg_tkl, ps_tkl: u.ps_tkl,
      car_sack_pg: c && c.g > 0 ? c.sack / c.g : null, car_pd_pg: c && c.g > 0 ? c.pd / c.g : null, car_int_pg: c && c.g > 0 ? c.int / c.g : null,
      car_tkl_pg: c && c.g > 0 ? c.tkl / c.g : null, car_std_pg: c && c.g > 0 ? c.std / c.g : null,
      draft_pick_f: p.pick ?? 300, age: p.birth && !isNA(p.birth) ? Math.floor((Date.parse(gm.day) - Date.parse(p.birth)) / 864e5) / 365.25 : null,
      inj_score: (j.st + j.pr) * (1 - j.rest), g_cur: u.g_cur,
    };
    x.exp_std = x.exp_solo + .5 * x.exp_ast + x.exp_tfl + 2 * x.exp_sack + x.exp_qbh + 3 * x.exp_int + x.exp_pd + 2 * x.exp_ff + 2 * x.exp_fr;
    const E = {}; for (const k of STATS) E[k] = Math.exp(wrTreePredict(MODELS[k], x));   // Poisson trees: log link
    const line = fullLine(E);
    const r3 = v => +v.toFixed(4);
    out.push({ gsis: a.g, team: t, grp: a.grp, pos: a.npos, x, line: Object.fromEntries(Object.entries(line).map(([k, v]) => [k, r3(v)])),
      parts: { std: idpParts(line, SCO.std).map(r3), psy: idpParts(line, SCO.psy).map(r3) },
      typical: { std: r3(idpTypical(line, SCO.std)), psy: r3(idpTypical(line, SCO.psy)) } });
  }
}
if (A.out) fs.writeFileSync(A.out, JSON.stringify(out));
console.log(`season ${Y} week ${W}: ${out.length} defenders (${['DL', 'LB', 'DB'].map(g => out.filter(o => o.grp === g).length + ' ' + g).join(', ')})`);
