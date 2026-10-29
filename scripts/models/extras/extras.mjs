// DHQ league-scoring "extras" for offensive players (QB, RB, WR, TE), Node, no dependencies.
//
// The WR/RB/TE models (and DHQ's QB line) predict half-PPR points; the engine carries a league's own rules by scoring
// DHQ's baseline stat line both ways (matchup-inputs.js wrModel). Rules whose stats that line lacks are missed: first
// downs, all fumbles, sacks taken, pick-sixes, kick/punt return yards and TDs, 100/200/300/400-yard bonuses, 25-completion
// and 20-carry bonuses, 40+/50+ yard plays and TDs, reception-length buckets, first-down bonuses by position, PPR bonuses
// for RB/WR, incompletions. This module gives every player his EXPECTED value of each of those Sleeper scoring keys for
// the coming game, from free nflverse weekly stats only (games before week W, shrunk to last season and position norms;
// constants fitted on 2016-2024, extras-params.json), and extraPoints() turns them into points for any league.
//
// node extras.mjs --season=2026 --week=8 [--out=extras.json] [--params=extras-params.json]
//   files (MODEL_DATA = the weekly job's nflverse download folder, scripts/build-wr-model-snapshot.mjs):
//   stats_player_week_<season-1>.csv and stats_player_week_<season>.csv. Nothing else.
//
// import { extraPoints } from './extras.mjs'
//   extraPoints(x, scoring)            -> { typical, average }
//   extraPoints(x, scoring, 'typical') -> points to ADD to the shown (typical) number in that league
//   extraPoints(x, scoring, 'average') -> points to ADD to the average number
//   x = a player's expected extras ({ rec_fd: 3.18, kr_yd: 0, ... }); scoring = the league's scoring_settings.
//   Typical = steady stats (first downs, sacks, returns, incompletions, PPR/first-down bonuses, catch buckets) plus the
//   rare bonuses (yardage bonuses, long plays and TDs, return TDs) at their expected value; rare NEGATIVE events (all
//   fumbles, pick-sixes) only in the average. Never double counts: no key here is in DHQ's baseline line.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OFF = ['QB', 'RB', 'WR', 'TE'];
let PRM = null;
export function loadParams(file) { PRM = JSON.parse(fs.readFileSync(file || path.join(HERE, 'extras-params.json'), 'utf8')); return PRM; }

// ---------------------------------------------------------------- points for a league
export function extraPoints(x, scoring, kind, params) {
  const P = params || PRM || loadParams();
  const sc = scoring || {}, G = P.groups, F = P.typical;
  const sum = keys => keys.reduce((a, k) => a + (Number(sc[k]) || 0) * (Number(x && x[k]) || 0), 0);
  const s = sum(G.steady), r = sum(G.rare), n = sum(G.neg);
  const out = { typical: F.steady * s + F.rare * r + F.neg * n, average: s + r + n };
  return kind === 'typical' ? out.typical : kind === 'average' ? out.average : out;
}

// ---------------------------------------------------------------- tiny CSV reader (quotes, embedded newlines)
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
const blend = (cn, cd, ln, ld, K, K2, lg) => (cn + K * ((ln + K2 * lg) / (ld + K2))) / (cd + K);
const sig = z => 1 / (1 + Math.exp(-z));

// stat columns -> our names (first downs in Sleeper's definition: nflverse's minus touchdowns)
const SRC = ['player_id', 'player_display_name', 'position', 'season_type', 'week', 'team', 'attempts', 'completions', 'passing_yards', 'passing_tds',
  'passing_interceptions', 'sacks_suffered', 'passing_first_downs', 'carries', 'rushing_yards', 'rushing_tds', 'rushing_first_downs', 'targets',
  'receptions', 'receiving_yards', 'receiving_tds', 'receiving_first_downs', 'fumbles_total', 'kickoff_returns', 'kickoff_return_yards',
  'punt_returns', 'punt_return_yards', 'special_teams_tds', 'receiving_40', 'rushing_40', 'passing_40', 'receiving_10', 'receiving_20'];
const COLS = ['rec_tgt', 'rec', 'rec_yd', 'rec_td', 'rec_fd', 'rush_att', 'rush_yd', 'rush_td', 'rush_fd', 'pass_att', 'pass_cmp', 'pass_yd',
  'pass_td', 'pass_fd', 'pass_int', 'pass_sack', 'fum', 'kr', 'kr_yd', 'pr', 'pr_yd', 'st_td', 'rec_40p', 'rush_40p', 'pass_cmp_40p',
  'rec_10p', 'rec_20p', 'tkr', 'tpr'];
function load(file) {
  const all = readCSV(file, SRC).filter(r => r.season_type === 'REG');
  const T = {};      // team-week returns over EVERY position (returners include DBs)
  for (const r of all) {
    const k = r.team + '|' + r.week, t = T[k] || (T[k] = { team: r.team, week: +r.week, kr: 0, kr_yd: 0, pr: 0, pr_yd: 0 });
    t.kr += num(r.kickoff_returns); t.kr_yd += num(r.kickoff_return_yards); t.pr += num(r.punt_returns); t.pr_yd += num(r.punt_return_yards);
  }
  const P = [], seen = new Set();
  for (const r of all) {
    if (!r.player_id || !['QB', 'RB', 'FB', 'WR', 'TE'].includes(r.position)) continue;
    const key = r.player_id + '|' + r.week; if (seen.has(key)) continue; seen.add(key);
    const t = T[r.team + '|' + r.week];
    P.push({ g: r.player_id, name: r.player_display_name, pos: r.position === 'FB' ? 'RB' : r.position, week: +r.week, team: r.team,
      rec_tgt: num(r.targets), rec: num(r.receptions), rec_yd: num(r.receiving_yards), rec_td: num(r.receiving_tds),
      rec_fd: num(r.receiving_first_downs) - num(r.receiving_tds), rush_att: num(r.carries), rush_yd: num(r.rushing_yards),
      rush_td: num(r.rushing_tds), rush_fd: num(r.rushing_first_downs) - num(r.rushing_tds), pass_att: num(r.attempts), pass_cmp: num(r.completions),
      pass_yd: num(r.passing_yards), pass_td: num(r.passing_tds), pass_fd: num(r.passing_first_downs) - num(r.passing_tds),
      pass_int: num(r.passing_interceptions), pass_sack: num(r.sacks_suffered), fum: num(r.fumbles_total), kr: num(r.kickoff_returns),
      kr_yd: num(r.kickoff_return_yards), pr: num(r.punt_returns), pr_yd: num(r.punt_return_yards), st_td: num(r.special_teams_tds),
      rec_40p: num(r.receiving_40), rush_40p: num(r.rushing_40), pass_cmp_40p: num(r.passing_40), rec_10p: num(r.receiving_10),
      rec_20p: num(r.receiving_20), tkr: t ? t.kr : 0, tpr: t ? t.pr : 0 });
  }
  return { P, T: Object.values(T) };
}

// ---------------------------------------------------------------- expected extras for every player with a game before week W
export function buildExtras(Y, W, dataDir, params) {
  const PR = params || PRM || loadParams();
  const D = (dataDir || process.env.MODEL_DATA || 'scripts/.wr-cache').replace(/\/?$/, '/');
  const cur = load(D + `stats_player_week_${Y}.csv`), last = load(D + `stats_player_week_${Y - 1}.csv`);
  // league returns per team-game (prior: 16 team-games at last season's rate) and yards per return (prior: 100 returns)
  const lt = last.T, ct = cur.T.filter(t => t.week < W);
  const S = (a, k) => a.reduce((s, x) => s + x[k], 0);
  const lkr = S(lt, 'kr') / lt.length, lpr = S(lt, 'pr') / lt.length;
  const lg_kr = (S(ct, 'kr') + 16 * lkr) / (ct.length + 16), lg_pr = (S(ct, 'pr') + 16 * lpr) / (ct.length + 16);
  const lkry = S(lt, 'kr_yd') / Math.max(1, S(lt, 'kr')), lpry = S(lt, 'pr_yd') / Math.max(1, S(lt, 'pr'));
  const lg_kr_ypr = (S(ct, 'kr_yd') + 100 * lkry) / (S(ct, 'kr') + 100), lg_pr_ypr = (S(ct, 'pr_yd') + 100 * lpry) / (S(ct, 'pr') + 100);
  const H = {};      // gsis -> { l: [rows last season], c: [rows this season before W] }
  for (const r of last.P) (H[r.g] || (H[r.g] = { l: [], c: [] })).l.push(r);
  for (const r of cur.P) if (r.week < W) (H[r.g] || (H[r.g] = { l: [], c: [] })).c.push(r);
  const out = [];
  for (const g of Object.keys(H)) {
    const { l, c } = H[g];
    l.sort((a, b) => a.week - b.week); c.sort((a, b) => a.week - b.week);
    const sum = arr => { const o = {}; for (const k of COLS) o[k] = S(arr, k); return o; };
    const C = sum(c), L = sum(l), R3 = sum(l.concat(c).slice(-3)), cg = c.length, lgm = l.length;
    const lastRow = c.length ? c[c.length - 1] : l[l.length - 1];
    const pos = OFF.includes(lastRow.pos) ? lastRow.pos : 'WR';
    const rate = k => {
      const r = PR.rates[k], n = r.num, d = r.den, norm = r.norm[pos];
      if (d === 'opps') {
        const o = X => X.rush_att + X.rec + X.pass_att + X.pass_sack + X.kr + X.pr;
        return blend(C[n], o(C), L[n], o(L), r.K, r.K2, norm);
      }
      return blend(C[n], C[d], L[n], L[d], r.K, r.K2, norm);
    };
    const vol = v => { const p = PR.vol[v]; return blend(C[v], cg, L[v], lgm, p.K, p.K2, p.norm[pos]); };
    const tgt = vol('rec_tgt'), rush = vol('rush_att'), att = vol('pass_att');
    const rec = tgt * rate('catch'), cmp = att * rate('cmp');
    const mu = { mu_rec: rec, mu_rush_att: rush, mu_pass_att: att, mu_cmp: cmp, mu_rec_yd: tgt * rate('ypt'), mu_rush_yd: rush * rate('ypc'), mu_pass_yd: att * rate('ypa') };
    mu.mu_rr_yd = mu.mu_rec_yd + mu.mu_rush_yd;
    const x = {};
    x.rec_fd = rec * rate('recfd'); x.rush_fd = rush * rate('rushfd'); x.pass_fd = cmp * rate('passfd');
    x.pass_sack = att * rate('sack'); x.pass_inc = att - cmp;
    x.pass_int_td = att * rate('int') * PR.const.pick6;
    // returns: his share of his team's returns in his last 3 games x league returns per team-game this season
    const kr = R3.kr / Math.max(R3.tkr, 1) * lg_kr, pr = R3.pr / Math.max(R3.tpr, 1) * lg_pr;
    x.kr_yd = kr * blend(C.kr_yd, C.kr, L.kr_yd, L.kr, PR.rates.kr_ypr.K, PR.rates.kr_ypr.K2, lg_kr_ypr);
    x.pr_yd = pr * blend(C.pr_yd, C.pr, L.pr_yd, L.pr, PR.rates.pr_ypr.K, PR.rates.pr_ypr.K2, lg_pr_ypr);
    x.st_td = (kr + pr) * PR.const.ret_td;
    x.fum = (rush + rec + att + x.pass_sack + kr + pr) * rate('fum');
    x.rec_40p = rec * rate('rec40'); x.rush_40p = rush * rate('rush40'); x.pass_cmp_40p = cmp * rate('pass40');
    const Cp = PR.const.pos[pos];
    x.rec_td_40p = x.rec_40p * Cp.rec_td40; x.rec_td_50p = x.rec_40p * Cp.rec_td50;
    x.rush_td_40p = x.rush_40p * Cp.rush_td40; x.rush_td_50p = x.rush_40p * Cp.rush_td50;
    x.pass_td_40p = x.pass_cmp_40p * PR.const.pass_td40; x.pass_td_50p = x.pass_cmp_40p * PR.const.pass_td50;
    const r10 = rate('rec10'), r20 = rate('rec20'), r40 = rate('rec40'), f04 = PR.const.f0_4[pos], f2029 = PR.const.f20_29[pos];
    x.rec_0_4 = rec * (1 - r10) * f04; x.rec_5_9 = rec * (1 - r10) * (1 - f04); x.rec_10_19 = rec * (r10 - r20);
    x.rec_20_29 = rec * Math.max(0, r20 - r40) * f2029; x.rec_30_39 = rec * Math.max(0, r20 - r40) * (1 - f2029);
    for (const p of OFF) x['bonus_fd_' + p.toLowerCase()] = pos === p ? x.rec_fd + x.rush_fd + (p === 'QB' ? x.pass_fd : 0) : 0;
    x.bonus_rec_rb = pos === 'RB' ? rec : 0; x.bonus_rec_wr = pos === 'WR' ? rec : 0;
    for (const [k, m] of Object.entries(PR.bonus_mu)) {
      const [a, b] = PR.logit[k]; x[k] = mu[m] > 0 ? sig(a + b * Math.log(Math.max(mu[m], 0.5))) : 0;
    }
    for (const k of Object.keys(x)) x[k] = +x[k].toFixed(5);
    for (const k of Object.keys(mu)) mu[k] = +mu[k].toFixed(3);
    out.push({ gsis: g, name: lastRow.name, team: lastRow.team, pos, x, mu });
  }
  return out;
}

// ---------------------------------------------------------------- CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const A = Object.fromEntries(process.argv.slice(2).map(a => { const [k, ...v] = a.replace(/^--/, '').split('='); return [k, v.join('=')]; }));
  if (A.params) loadParams(A.params);
  const rows = buildExtras(+A.season, +A.week);
  if (A.out) fs.writeFileSync(A.out, JSON.stringify(rows));
  console.log(`season ${A.season} week ${A.week}: extras for ${rows.length} QB/RB/WR/TE`);
}
