// ══════════════════════════════════════════════════════════════════
// js/shared/matchup-inputs.js — window.App.MatchupInputs
//
// Turns what the app already knows about a player into the input the
// matchup engine scores. One place decides where every factor's data
// comes from:
//
//   baseline     Sleeper's published line scored through the league's
//                rules (App.WeeklyProj), or the engine's own estimate.
//   role         PFF depth chart (order + snap share), Sleeper snap share.
//   health       Sleeper injury tag, PFF depth-chart status as backup.
//   opponent     App.SOS defense-vs-position rank for offense; a new
//                offense-vs-IDP rank (built here from Sleeper's weekly
//                pts_idp) for DL / LB / DB.
//   game         ESPN scoreboard context already loaded by nfl-context
//                (implied total, spread, home, weather) plus the ESPN
//                schedule for neutral-site and overseas games.
//   coaching     ESPN staff scores (matchup-feeds-espn).
//   h2h          ESPN last six meetings (matchup-feeds-espn).
//   trench       PFF team unit grades: my line vs their front, from the
//                player's side of the ball.
//   trend        Last three weeks vs season PPG (App.WeeklyProj).
//   teamContext  PFF grade of the team's starting QB + record gap (ESPN).
//   luck         Season touchdown rate vs a sustainable rate (Sleeper).
//
// Async work (ESPN, the IDP rank) happens once in prepare(); build() is
// then synchronous so a render can call it per row without awaiting.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const IDP_GROUP = { DE: 'DL', DT: 'DL', NT: 'DL', DL: 'DL', IDL: 'DL', EDGE: 'DL', LB: 'LB', OLB: 'LB', ILB: 'LB', MLB: 'LB', CB: 'DB', S: 'DB', SS: 'DB', FS: 'DB', DB: 'DB' };
    const PFF_POS_GROUP = { QB: 'QB', HB: 'RB', RB: 'RB', FB: 'RB', WR: 'WR', TE: 'TE', DI: 'DL', ED: 'DL', DL: 'DL', DE: 'DL', DT: 'DL', LB: 'LB', CB: 'DB', S: 'DB', K: 'K' };
    const SLEEPER_STATUS = { QUESTIONABLE: 'Q', DOUBTFUL: 'D', OUT: 'OUT', IR: 'IR', PUP: 'PUP', SUS: 'SUS', NA: 'NA', COV: 'COV', DNR: 'OUT' };
    const PFF_STATUS = { questionable: 'Q', doubtful: 'D', out: 'OUT', ir: 'IR', pup: 'PUP', suspended: 'SUS' };
    // Touchdowns per opportunity that a season tends to settle back to.
    const EXPECTED_TD_RATE = { RB: 0.03, WR: 0.04, TE: 0.045, QB: 0.045 };
    const TTL_MS = 4 * 60 * 60 * 1000;

    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
    const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
    const normName = (name) => String(name || '').toLowerCase().replace(/[.'’]/g, '').replace(/\s+(jr|sr|ii|iii|iv)$/i, '').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

    function posGroup(player) {
        const raw = String(player && player.position || '').toUpperCase();
        if (IDP_GROUP[raw]) return IDP_GROUP[raw];
        const n = App.normPos ? App.normPos(raw) : raw;
        return String(n || raw).toUpperCase();
    }
    function fullName(player) {
        return player ? (player.full_name || ((player.first_name || '') + ' ' + (player.last_name || ''))).trim() : '';
    }
    function pff() { return root.DhqPffMatchup || null; }
    function espn() { return App.MatchupFeeds && App.MatchupFeeds.espn; }

    function currentSeason() {
        const s = root.S || {};
        return Number(s.season || (s.nflState && s.nflState.season)) || (App.MatchupFeeds && espn() ? espn().currentSeason() : new Date().getUTCFullYear());
    }

    // ── Opponent for a team in a week ─────────────────────────────────
    function opponentOf(team, week) {
        const T = String(team || '').toUpperCase();
        const ctx = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek[T + '|' + week];
        if (ctx && ctx.opp) return String(ctx.opp).toUpperCase();
        const sch = App.SOS && App.SOS.schedule;
        return (sch && sch[week] && sch[week][T]) ? String(sch[week][T]).toUpperCase() : null;
    }
    function isByeWeek(team, week) {
        const sch = App.SOS && App.SOS.schedule;
        if (!sch || !sch[week]) return false;
        const T = String(team || '').toUpperCase();
        // A week with a full slate but no entry for this team is its bye.
        return Object.keys(sch[week]).length >= 20 && !sch[week][T];
    }

    // ── Offense vs IDP rank ───────────────────────────────────────────
    // How many IDP points each OFFENSE gives up to DL, LB and DB, from
    // Sleeper's weekly pts_idp. Rank 1 = stingiest offense (toughest for
    // that IDP group), 32 = most generous. Same pairing trick as the SOS
    // engine: the two TEAM_ rows whose yardage totals mirror each other
    // played each other.
    let _idp = { season: null, ranks: null, promise: null };
    function cacheKey(season) { return 'dhq_mi_idp_' + season; }
    async function fetchWeek(season, week) {
        if (App.SOS && App.SOS.getWeekStats) return App.SOS.getWeekStats(season, week);
        const r = await fetch('https://api.sleeper.app/v1/stats/nfl/regular/' + season + '/' + week);
        return r.ok ? r.json() : {};
    }
    function pairings(weekStats) {
        const rows = Object.entries(weekStats).filter(([k]) => k.startsWith('TEAM_')).map(([k, v]) => ({ t: k.slice(5), off: v.off_yd || 0, opp: v.opp_off_yd || 0 }));
        const out = {};
        for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
            const a = rows[i], b = rows[j];
            if (a.off > 0 && a.off === b.opp && b.off === a.opp) { out[a.t] = b.t; out[b.t] = a.t; }
        }
        return out;
    }
    async function idpRankings(season, playersData) {
        season = season || currentSeason();
        if (_idp.ranks && _idp.season === season) return _idp.ranks;
        try {
            const raw = root.sessionStorage && root.sessionStorage.getItem(cacheKey(season));
            if (raw) { const rec = JSON.parse(raw); if (Date.now() - rec.ts < TTL_MS) { _idp = { season, ranks: rec.data, promise: null }; return rec.data; } }
        } catch (e) { /* no storage */ }
        if (_idp.promise && _idp.season === season) return _idp.promise;
        _idp.season = season;
        _idp.promise = (async () => {
            const weeks = await Promise.all(Array.from({ length: 18 }, (_, i) => fetchWeek(season, i + 1).catch(() => ({}))));
            const allowed = {};   // offense → group → { pts, games }
            let played = 0;
            for (const wk of weeks) {
                if (!wk || Object.keys(wk).length < 10) continue;
                const pair = pairings(wk);
                if (!Object.keys(pair).length) continue;
                played++;
                for (const [pid, st] of Object.entries(wk)) {
                    if (pid.startsWith('TEAM_')) continue;
                    const pts = num(st.pts_idp);
                    if (!pts || pts <= 0) continue;
                    const p = playersData && playersData[pid];
                    const grp = p && IDP_GROUP[String(p.position || '').toUpperCase()];
                    if (!grp || !p.team) continue;
                    const offense = pair[String(p.team).toUpperCase()];
                    if (!offense) continue;
                    const a = allowed[offense] = allowed[offense] || {};
                    a[grp] = a[grp] || { pts: 0, games: new Set() };
                    a[grp].pts += pts;
                    a[grp].games.add(played);
                }
            }
            const ranks = {};
            for (const grp of ['DL', 'LB', 'DB']) {
                const list = Object.keys(allowed).filter(t => allowed[t][grp]).map(t => ({ t, avg: allowed[t][grp].pts / allowed[t][grp].games.size }));
                list.sort((a, b) => a.avg - b.avg);
                list.forEach((r, i) => { ranks[r.t] = ranks[r.t] || {}; ranks[r.t]['vs' + grp] = i + 1; ranks[r.t]['avg' + grp] = +r.avg.toFixed(1); });
            }
            const out = Object.keys(ranks).length ? ranks : null;
            _idp = { season, ranks: out, promise: null };
            try { if (out) root.sessionStorage && root.sessionStorage.setItem(cacheKey(season), JSON.stringify({ ts: Date.now(), data: out })); } catch (e) { /* ignore */ }
            return out;
        })();
        return _idp.promise;
    }

    // ── PFF lookups ───────────────────────────────────────────────────
    function pffDepthRow(team, player) {
        const snap = pff();
        const rows = snap && snap.depth && snap.depth[String(team || '').toUpperCase()];
        if (!rows || !rows.length) return null;
        const want = normName(fullName(player));
        const grp = posGroup(player);
        let best = null;
        for (const r of rows) {
            if (normName(r.n) !== want) continue;
            if (PFF_POS_GROUP[String(r.pos).toUpperCase()] && PFF_POS_GROUP[String(r.pos).toUpperCase()] !== grp) continue;
            if (!best || (r.d != null && (best.d == null || r.d < best.d)) || (r.d === best.d && (r.sp || 0) > (best.sp || 0))) best = r;
        }
        return best;
    }
    function pffPlayer(player) {
        const snap = pff();
        return snap && snap.players ? snap.players[normName(fullName(player))] || null : null;
    }
    function pffTeam(team) {
        const snap = pff();
        return snap && snap.teams ? snap.teams[String(team || '').toUpperCase()] || null : null;
    }
    function teamQbGrade(team) {
        const snap = pff();
        const rows = snap && snap.depth && snap.depth[String(team || '').toUpperCase()];
        if (!rows) return null;
        const qb = rows.filter(r => String(r.pos).toUpperCase() === 'QB').sort((a, b) => (a.d || 9) - (b.d || 9) || (b.sp || 0) - (a.sp || 0))[0];
        if (!qb) return null;
        const p = snap.players[normName(qb.n)];
        return p ? (num(p.pass) || num(p.off) || null) : (num(qb.g) || null);
    }
    // My line vs their front, from the player's side of the ball.
    function trenchFor(grp, team, opp) {
        const mine = pffTeam(team), theirs = pffTeam(opp);
        if (!mine || !theirs) return null;
        const g = (t, k) => num(t[k]);
        switch (grp) {
            case 'RB': return { mine: g(mine, 'grades_run_block'), theirs: g(theirs, 'grades_run_defense') };
            case 'QB': case 'WR': case 'TE': return { mine: g(mine, 'grades_pass_block'), theirs: g(theirs, 'grades_pass_rush_defense') };
            case 'DL': return { mine: g(mine, 'grades_pass_rush_defense'), theirs: g(theirs, 'grades_pass_block') };
            case 'LB': return { mine: g(mine, 'grades_run_defense'), theirs: g(theirs, 'grades_run_block') };
            case 'DB': return { mine: g(mine, 'grades_coverage_defense'), theirs: g(theirs, 'grades_pass_route') };
            default: return null;
        }
    }

    // ── Baseline ──────────────────────────────────────────────────────
    // Sleeper's published line when there is one. Otherwise the engine's
    // own per-game estimate BEFORE any matchup adjustment, so this
    // engine's factors are not applied on top of the old ones.
    function baselineFor(pid, week, opts) {
        const WP = App.WeeklyProj;
        if (!WP) return null;
        const line = WP.projLine && WP.projLine(pid, week);
        if (line) {
            const scored = WP.projectPlayer(pid, { playersData: opts.playersData, statsData: opts.statsData, priorData: opts.priorData, scoring: opts.scoring, week, requireSleeper: true });
            if (scored && scored.points) return { median: scored.points.median, floor: scored.points.floor, ceiling: scored.points.ceiling, source: 'sleeper' };
        }
        if (opts.sleeperOnly) return null;
        const season = opts.statsData && opts.statsData[pid];
        const prior = opts.priorData && opts.priorData[pid];
        const base = WP.buildBaseline && WP.buildBaseline(pid, season, prior, opts.scoring, week);
        const pts = base && App.calcRawPts ? num(App.calcRawPts(base, opts.scoring)) : null;
        if (pts == null || pts <= 0) return null;
        return { median: +pts.toFixed(2), floor: +(pts * 0.75).toFixed(2), ceiling: +(pts * 1.25).toFixed(2), source: 'estimate' };
    }

    // ── prepare: the async pieces, once per roster ────────────────────
    // Returns a context object build() reads synchronously.
    async function prepare(teams, week, opts) {
        opts = opts || {};
        const season = opts.season || currentSeason();
        const E = espn();
        const ctx = { season, week, coaching: null, standings: null, idp: null, games: {}, h2h: {} };
        const jobs = [];
        if (E) {
            jobs.push(E.coaching(season).then(c => { ctx.coaching = c; }).catch(() => {}));
            jobs.push(E.standings(season).then(s => { ctx.standings = s; }).catch(() => {}));
        }
        jobs.push(idpRankings(season, opts.playersData).then(r => { ctx.idp = r; }).catch(() => {}));
        const list = [...new Set((teams || []).map(t => String(t || '').toUpperCase()).filter(Boolean))];
        if (E) {
            for (const t of list) {
                jobs.push(E.gameFor(t, week, season).then(g => { ctx.games[t] = g; }).catch(() => {}));
                const opp = opponentOf(t, week);
                if (opp) jobs.push(E.headToHead(t, opp, season).then(h => { ctx.h2h[t + '|' + opp] = h; }).catch(() => {}));
            }
        }
        await Promise.all(jobs);
        return ctx;
    }

    // ── build: engine input for one player ────────────────────────────
    function build(pid, week, opts, ctx) {
        opts = opts || {}; ctx = ctx || {};
        const player = opts.playersData && opts.playersData[pid];
        if (!player) return null;
        const grp = posGroup(player);
        const team = String(player.team || '').toUpperCase();
        const opp = opponentOf(team, week);
        const stats = (opts.statsData && opts.statsData[pid]) || null;
        const input = { pid, week, position: grp, team, opponentAbbr: opp, baselineSource: 'estimate' };

        const base = baselineFor(pid, week, opts);
        if (base) { input.baseline = { median: base.median, floor: base.floor, ceiling: base.ceiling }; input.baselineSource = base.source; }

        // role
        const depth = pffDepthRow(team, player);
        const snapShare = stats && num(stats.off_snp) && num(stats.tm_off_snp) ? clamp(stats.off_snp / stats.tm_off_snp, 0, 1)
            : stats && num(stats.def_snp) && num(stats.tm_def_snp) ? clamp(stats.def_snp / stats.tm_def_snp, 0, 1) : null;
        if (depth || snapShare != null) {
            input.role = { depthRank: depth ? depth.d : null, share: snapShare != null ? snapShare : (depth && num(depth.sp) != null ? depth.sp / 100 : null) };
        }

        // health
        const sleeperStatus = String(player.injury_status || '').toUpperCase();
        let status = SLEEPER_STATUS[sleeperStatus] || (sleeperStatus ? sleeperStatus : '');
        if (!status && depth && PFF_STATUS[String(depth.st || '').toLowerCase()]) status = PFF_STATUS[String(depth.st).toLowerCase()];
        if (isByeWeek(team, week) || (num(player.bye_week) === week)) status = 'BYE';
        input.health = { status };

        // opponent
        if (opp) {
            let rank = null;
            if (grp === 'DL' || grp === 'LB' || grp === 'DB') rank = ctx.idp && ctx.idp[opp] ? num(ctx.idp[opp]['vs' + grp]) : null;
            else if (App.SOS && App.SOS.defenseRankings && App.SOS.defenseRankings[opp]) rank = num(App.SOS.defenseRankings[opp]['vs' + grp]);
            // SOS ranks QB/RB/WR/TE only; anything else (kickers) stays neutral.
            input.opponent = { abbr: opp, rankVsPos: rank != null && rank >= 1 ? rank : null };
        }

        // game
        const wk = App.WeeklyProj && App.WeeklyProj._ctx && App.WeeklyProj._ctx.byTeamWeek[team + '|' + week];
        const g = ctx.games && ctx.games[team];
        if (wk || g) {
            const w = wk && wk.weather;
            input.game = {
                impliedTotal: wk && wk.vegas ? num(wk.vegas.impliedTotal) : null,
                spread: wk && wk.vegas ? num(wk.vegas.spread) : null,
                home: g ? (g.neutral ? null : g.home) : (wk ? wk.home : null),
                neutral: !!(g && g.neutral), international: !!(g && g.international),
                weather: w ? { indoor: !!w.indoor, display: w.display || '', tempF: num(w.temp) } : null,
            };
        }

        // coaching
        if (ctx.coaching && opp && ctx.coaching[team] && ctx.coaching[opp]) input.coaching = { team: ctx.coaching[team].score, opp: ctx.coaching[opp].score };

        // head-to-head
        const h = opp && ctx.h2h && ctx.h2h[team + '|' + opp];
        if (h) input.h2h = { games: h.games, wins: h.wins, avgMargin: h.avgMargin, division: h.division };

        // trench
        const tr = opp && trenchFor(grp, team, opp);
        if (tr && tr.mine != null && tr.theirs != null) input.trench = tr;

        // trend
        if (App.WeeklyProj && App.WeeklyProj.recentPPG && App.calcPPG && stats) {
            const last3 = num(App.WeeklyProj.recentPPG(pid, week, 3));
            const seasonPPG = num(App.calcPPG(stats, opts.scoring));
            if (last3 != null && seasonPPG != null) input.trend = { last3, season: seasonPPG };
        }

        // team context
        const qbGrade = grp === 'QB' ? (pffPlayer(player) ? (num(pffPlayer(player).pass) || num(pffPlayer(player).off)) : null) : teamQbGrade(team);
        let recordDiff = null;
        if (ctx.standings && opp && ctx.standings[team] && ctx.standings[opp]) {
            const a = ctx.standings[team], b = ctx.standings[opp];
            const games = Math.min(a.wins + a.losses + a.ties, b.wins + b.losses + b.ties);
            const wa = num(a.winPct), wb = num(b.winPct);
            if (wa != null && wb != null) recordDiff = +((wa - wb) * Math.min(1, games / 6)).toFixed(3);
        }
        if (qbGrade != null || recordDiff != null) input.teamContext = { qbGrade, recordDiff };

        // luck
        if (stats && EXPECTED_TD_RATE[grp]) {
            const opps = grp === 'QB' ? num(stats.pass_att) || 0 : (num(stats.rush_att) || 0) + (num(stats.rec_tgt) || 0);
            const tds = grp === 'QB' ? num(stats.pass_td) || 0 : (num(stats.rush_td) || 0) + (num(stats.rec_td) || 0);
            if (opps >= 25) input.luck = { tdRate: tds / opps, expectedTdRate: EXPECTED_TD_RATE[grp] };
        }

        return input;
    }

    function project(pid, week, opts, ctx) {
        const input = build(pid, week, opts, ctx);
        if (!input || !App.MatchupEngine) return null;
        const out = App.MatchupEngine.project(input);
        out.team = input.team;
        out.opponentAbbr = input.opponentAbbr;
        out.input = input;
        return out;
    }

    // Everything for a roster in one call: prepares the async context for
    // the teams involved, then projects each player.
    async function projectRoster(playerIds, week, opts) {
        opts = opts || {};
        const ids = (playerIds || []).filter(Boolean);
        const teams = ids.map(pid => opts.playersData && opts.playersData[pid] && opts.playersData[pid].team).filter(Boolean);
        const ctx = await prepare(teams, week, opts);
        const out = {};
        for (const pid of ids) { const p = project(pid, week, opts, ctx); if (p) out[pid] = p; }
        return { week, ctx, projections: out };
    }

    App.MatchupInputs = App.MatchupInputs || {
        prepare, build, project, projectRoster, idpRankings, baselineFor, opponentOf, trenchFor, posGroup, normName,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.MatchupInputs;
})(typeof window !== 'undefined' ? window : globalThis);
