// ══════════════════════════════════════════════════════════════════
// js/shared/matchup-engine.js — window.App.MatchupEngine
//
// DHQ PROJECTED POINTS for one player in one week.
//
// The idea in one sentence: start from a baseline number of points
// (Sleeper's published line scored through the league's rules, or the
// engine's own estimate when Sleeper has none), then move that number
// up or down by ten weighted factors that decide whether a player
// succeeds in a given matchup. The result is shown BESIDE Sleeper's
// number, never in place of it (owner ruling 2026-09-19).
//
// HOW A FACTOR WORKS
//   Every factor turns its raw inputs into a score from -1 (worst case)
//   to +1 (best case). 0 means neutral or "no data". The score is then
//   turned into a multiplier:
//
//       multiplier = 1 + score × (weight / 100) × SWING
//
//   so a factor with weight 22 and SWING 0.5 can move the projection by
//   at most ±11%, and a factor with weight 8 by at most ±4%. All ten
//   multipliers are multiplied together and applied to the baseline.
//
// THE FACTORS AND THEIR WEIGHTS (owner ruling 2026-09-19, sum = 100)
//   role        22  depth-chart slot and snap / target share
//   health      14  injury tag, practice report, weeks since return
//   opponent    14  opposing defense (or offense, for IDP) vs this position
//   game        12  implied total, spread, home / away / overseas, weather
//   coaching     8  staff quality, this team's staff vs the opponent's
//   h2h          8  team-vs-team history, division games count double
//   trench       8  offensive line vs defensive line (best line wins)
//   trend        8  last three weeks vs season average
//   teamContext  3  quarterback quality and team record
//   luck         3  touchdown rate vs what is sustainable (regression)
//
// This file is PURE: it never fetches anything. Feeds (Sleeper, ESPN,
// PFF snapshot) build the input object; this file only does the math,
// so every line of it can be unit-tested in Node:
//     node --test js/shared/matchup-engine.test.js
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};

    const WEIGHTS = {
        role: 22,
        health: 14,
        opponent: 14,
        game: 12,
        coaching: 8,
        h2h: 8,
        trench: 8,
        trend: 8,
        teamContext: 3,
        luck: 3,
    };

    // How far a factor at full strength may move the number, as a share
    // of its weight. 0.5 means "weight 22 → up to ±11%".
    const SWING = 0.5;

    const LABELS = {
        role: 'Role & opportunity',
        health: 'Health',
        opponent: 'Opponent vs position',
        game: 'Game environment',
        coaching: 'Coaching staff',
        h2h: 'Head-to-head history',
        trench: 'Trench edge (OL vs DL)',
        trend: 'Trend line',
        teamContext: 'Team context',
        luck: 'Luck & regression',
    };

    const LEAGUE_AVG_IMPLIED = 22.5;   // average NFL implied team total
    const OUT_STATUSES = new Set(['OUT', 'IR', 'PUP', 'SUS', 'NA', 'DNP', 'BYE', 'COV']);
    const PASS_GAME_POSITIONS = new Set(['QB', 'WR', 'TE']);
    const IDP_POSITIONS = new Set(['DL', 'LB', 'DB']);

    function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }
    function num(v) { const n = Number(v); return Number.isFinite(n) ? n : null; }
    function pos(input) { return String(input && input.position || '').toUpperCase(); }

    // ── Factor scorers ───────────────────────────────────────────────
    // Each returns { score: -1..1 | null, note: 'plain-English reason' }.
    // null score = no data → treated as neutral (0) and flagged in `why`.

    function scoreRole(input) {
        const r = input.role;
        if (!r) return { score: null, note: 'No depth-chart data' };
        const rank = num(r.depthRank);
        const share = num(r.share);
        if (rank == null && share == null) return { score: null, note: 'No depth-chart data' };
        let s = 0;
        const notes = [];
        if (rank != null) {
            if (rank <= 1) { s += 0.6; notes.push('Starter'); }
            else if (rank === 2) { s -= 0.4; notes.push('Second on the depth chart'); }
            else { s -= 0.9; notes.push('Deep on the depth chart'); }
        }
        if (share != null) {
            // 50% share is neutral; 90%+ is a workhorse; 20% is a bit part.
            s += clamp((share - 0.5) * 2, -1, 1) * 0.5;
            notes.push(Math.round(share * 100) + '% of snaps / targets');
        }
        return { score: clamp(s, -1, 1), note: notes.join(' · ') };
    }

    function scoreHealth(input) {
        if (!input.health) return { score: null, note: 'No injury report' };
        const h = input.health;
        const status = String(h.status || '').trim().toUpperCase();
        if (OUT_STATUSES.has(status)) return { score: -1, note: status === 'BYE' ? 'Bye week' : 'Ruled out (' + status + ')', out: true };
        let s = 0;
        const notes = [];
        if (status === 'D' || status === 'DOUBTFUL') { s -= 0.85; notes.push('Doubtful'); }
        else if (status === 'Q' || status === 'QUESTIONABLE') { s -= 0.35; notes.push('Questionable'); }
        const practice = String(h.practice || '').toUpperCase();
        if (practice === 'DNP') { s -= 0.2; notes.push('Did not practice'); }
        else if (practice === 'LP') { s -= 0.1; notes.push('Limited in practice'); }
        const back = num(h.weeksSinceReturn);
        if (back === 0) { s -= 0.25; notes.push('First game back'); }
        else if (back === 1) { s -= 0.1; notes.push('Second game back'); }
        if (!notes.length) notes.push('Healthy');
        return { score: clamp(s, -1, 1), note: notes.join(' · ') };
    }

    // rankVsPos: 1 = toughest unit against this position, 32 = softest.
    function scoreOpponent(input) {
        const o = input.opponent || {};
        const rank = num(o.rankVsPos);
        if (rank == null) return { score: null, note: 'No matchup rank yet' };
        const s = clamp((rank - 16.5) / 15.5, -1, 1);
        const who = o.abbr ? ' vs ' + o.abbr : '';
        const label = s >= 0.5 ? 'Soft matchup' : s >= 0.15 ? 'Favorable matchup' : s > -0.15 ? 'Neutral matchup' : s > -0.5 ? 'Tough matchup' : 'Elite unit';
        return { score: s, note: label + who + ' (rank ' + Math.round(rank) + ' of 32)' };
    }

    function scoreGame(input) {
        const g = input.game;
        if (!g) return { score: null, note: 'No game info yet' };
        const P = pos(input);
        let s = 0;
        const notes = [];
        const implied = num(g.impliedTotal);
        if (implied != null && implied > 0) {
            s += clamp((implied - LEAGUE_AVG_IMPLIED) / 7.5, -1, 1) * 0.6;
            notes.push('Implied ' + implied.toFixed(1) + ' pts');
        }
        const spread = num(g.spread); // negative = this team favored
        if (spread != null) {
            const favored = clamp(-spread / 14, -1, 1);
            // Favorites run out the clock (good for RB); underdogs throw (mild
            // help to the passing game). Kickers and IDP are left alone.
            if (P === 'RB') s += favored * 0.25;
            else if (PASS_GAME_POSITIONS.has(P)) s -= favored * 0.15;
            notes.push(spread <= 0 ? 'Favored by ' + Math.abs(spread) : 'Underdog by ' + spread);
        }
        if (g.international) { s -= 0.15; notes.push('Overseas game'); }
        else if (g.neutral) { notes.push('Neutral site'); }
        else if (g.home === true) { s += 0.2; notes.push('Home'); }
        else if (g.home === false) { s -= 0.2; notes.push('Away'); }
        const w = g.weather;
        if (w && !w.indoor) {
            const d = String(w.display || w.condition || '').toLowerCase();
            const cold = num(w.tempF) != null && num(w.tempF) <= 25;
            const bad = /wind|rain|snow|storm/.test(d) || cold;
            if (bad && P !== 'RB' && !IDP_POSITIONS.has(P)) { s -= 0.3; notes.push('Weather: ' + (w.display || w.condition || 'cold')); }
        }
        if (!notes.length) return { score: null, note: 'No game info yet' };
        return { score: clamp(s, -1, 1), note: notes.join(' · ') };
    }

    // team / opp: staff scores 0..1 (built by the ESPN feed from tenure,
    // win rate and playoff history). Better staff than the opponent → plus.
    function scoreCoaching(input) {
        const c = input.coaching || {};
        const mine = num(c.team), theirs = num(c.opp);
        if (mine == null || theirs == null) return { score: null, note: 'No coaching data' };
        const s = clamp((mine - theirs) * 2, -1, 1);
        const label = s > 0.3 ? 'Staff edge' : s < -0.3 ? 'Staff disadvantage' : 'Even staffs';
        return { score: s, note: label + ' (' + Math.round(mine * 100) + ' vs ' + Math.round(theirs * 100) + ')' };
    }

    // Team-vs-team history from the PLAYER'S team's point of view.
    // games / wins / avgMargin over the recent meetings; division = true
    // makes the effect count more (they meet twice a year, it is a rivalry).
    function scoreH2h(input) {
        const h = input.h2h || {};
        const games = num(h.games) || 0;
        if (games < 2) return { score: null, note: 'Not enough recent meetings' };
        const wins = num(h.wins) || 0;
        const margin = num(h.avgMargin) || 0;
        let s = ((wins / games) - 0.5) * 2 * 0.6 + clamp(margin / 14, -1, 1) * 0.4;
        s *= Math.min(1, games / 4);           // two meetings say less than four
        if (h.division) s *= 1.25;             // division bully / division victim
        s = clamp(s, -1, 1);
        const rec = wins + '-' + (games - wins);
        const label = s > 0.35 ? 'Owns this matchup' : s < -0.35 ? 'Gets bullied here' : 'Even history';
        return { score: s, note: label + ' (' + rec + ' last ' + games + (h.division ? ', division' : '') + ')' };
    }

    // mine / theirs: 0..100 unit grades from the PLAYER'S side of the ball.
    // Offense: my OL vs their DL. IDP: my DL vs their OL. Feeds pick the pair.
    function scoreTrench(input) {
        const t = input.trench || {};
        const mine = num(t.mine), theirs = num(t.theirs);
        if (mine == null || theirs == null) return { score: null, note: 'No line grades' };
        const s = clamp((mine - theirs) / 40, -1, 1);
        const label = s > 0.25 ? 'Wins the trenches' : s < -0.25 ? 'Loses the trenches' : 'Even in the trenches';
        return { score: s, note: label + ' (' + Math.round(mine) + ' vs ' + Math.round(theirs) + ')' };
    }

    function scoreTrend(input) {
        const t = input.trend || {};
        const last3 = num(t.last3), season = num(t.season);
        if (last3 == null || season == null || season < 2) return { score: null, note: 'Not enough games' };
        const ratio = last3 / season;
        const s = clamp((ratio - 1) * 2, -1, 1);
        const label = s > 0.3 ? 'Heating up' : s < -0.3 ? 'Cooling off' : 'Steady';
        return { score: s, note: label + ' (' + last3.toFixed(1) + ' last 3 vs ' + season.toFixed(1) + ' season)' };
    }

    function scoreTeamContext(input) {
        const c = input.teamContext || {};
        const qb = num(c.qbGrade), rec = num(c.recordDiff);
        if (qb == null && rec == null) return { score: null, note: 'No team context' };
        let s = 0;
        const notes = [];
        if (qb != null) { s += clamp((qb - 65) / 25, -1, 1) * 0.6; notes.push('QB grade ' + Math.round(qb)); }
        if (rec != null) { s += clamp(rec, -1, 1) * 0.4; notes.push(rec > 0 ? 'Better record' : rec < 0 ? 'Worse record' : 'Same record'); }
        return { score: clamp(s, -1, 1), note: notes.join(' · ') };
    }

    // A player scoring touchdowns far above the rate his usage supports is
    // due to cool off; one far below is due to warm up (half as strong).
    function scoreLuck(input) {
        const l = input.luck || {};
        const rate = num(l.tdRate), exp = num(l.expectedTdRate);
        if (rate == null || exp == null || exp <= 0) return { score: null, note: 'No regression data' };
        const diff = (rate - exp) / exp;
        let s;
        if (diff > 0) s = -clamp(diff, 0, 1);
        else s = clamp(-diff, 0, 1) * 0.5;
        const label = s < -0.3 ? 'Running hot, due to cool' : s > 0.2 ? 'Running cold, due to pop' : 'Sustainable';
        return { score: s, note: label };
    }

    const SCORERS = {
        role: scoreRole,
        health: scoreHealth,
        opponent: scoreOpponent,
        game: scoreGame,
        coaching: scoreCoaching,
        h2h: scoreH2h,
        trench: scoreTrench,
        trend: scoreTrend,
        teamContext: scoreTeamContext,
        luck: scoreLuck,
    };

    // ── Put it together ──────────────────────────────────────────────
    function factorScores(input) {
        return Object.keys(WEIGHTS).map(key => {
            const r = SCORERS[key](input || {}) || {};
            const score = r.score == null ? null : clamp(Number(r.score) || 0, -1, 1);
            const mult = 1 + (score || 0) * (WEIGHTS[key] / 100) * SWING;
            return {
                key,
                label: LABELS[key],
                weight: WEIGHTS[key],
                score,
                mult: +mult.toFixed(4),
                impactPct: +(((mult - 1) * 100).toFixed(1)),
                note: r.note || '',
                out: !!r.out,
                hasData: score != null,
            };
        });
    }

    function gradeFor(mult) {
        if (mult >= 1.12) return 'A';
        if (mult >= 1.05) return 'B';
        if (mult >= 0.96) return 'C';
        if (mult >= 0.88) return 'D';
        return 'F';
    }

    // The lineup solver still makes the final call; this verdict is the
    // quick read a row can show before the owner opens the "why" panel.
    function verdictFor(grade, available) {
        if (!available) return 'out';
        if (grade === 'A' || grade === 'B') return 'start';
        if (grade === 'C') return 'flex';
        return 'sit';
    }

    // input.baseline: { median, floor, ceiling } league-scored points.
    function project(input) {
        input = input || {};
        const factors = factorScores(input);
        const out = factors.some(f => f.out);
        let mult = 1;
        for (const f of factors) mult *= f.mult;
        mult = +mult.toFixed(4);

        const base = input.baseline || {};
        const bMed = num(base.median) || 0;
        const bFloor = num(base.floor) != null ? num(base.floor) : bMed * 0.75;
        const bCeil = num(base.ceiling) != null ? num(base.ceiling) : bMed * 1.25;
        const available = !out && bMed > 0;

        // Doubtful/questionable players keep their ceiling but lose floor:
        // the risk is that they play little or leave early.
        const health = factors.find(f => f.key === 'health');
        const floorPenalty = health && health.score != null && health.score < 0 ? Math.min(0.3, -health.score * 0.3) : 0;

        const points = available ? {
            median: +(bMed * mult).toFixed(2),
            floor: +(bFloor * mult * (1 - floorPenalty)).toFixed(2),
            ceiling: +(bCeil * mult).toFixed(2),
        } : { median: 0, floor: 0, ceiling: 0 };

        const grade = available ? gradeFor(mult) : 'F';
        const why = factors
            .filter(f => f.hasData)
            .sort((a, b) => Math.abs(b.impactPct) - Math.abs(a.impactPct))
            .map(f => ({ key: f.key, label: f.label, impactPct: f.impactPct, note: f.note }));
        const missing = factors.filter(f => !f.hasData).map(f => f.key);

        return {
            pid: input.pid,
            week: input.week,
            position: pos(input),
            available,
            baseline: { median: bMed, floor: +bFloor.toFixed(2), ceiling: +bCeil.toFixed(2), source: input.baselineSource || 'estimate' },
            mult,
            points,
            grade,
            verdict: verdictFor(grade, available),
            factors,
            why,
            missing,
        };
    }

    App.MatchupEngine = App.MatchupEngine || {
        WEIGHTS, SWING, LABELS,
        factorScores, project, gradeFor, verdictFor,
        scorers: SCORERS,
    };
    /* global module */
    if (typeof module !== 'undefined' && module.exports) module.exports = App.MatchupEngine;
})(typeof window !== 'undefined' ? window : globalThis);
