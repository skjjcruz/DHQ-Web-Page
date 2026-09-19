// Run with:  node --test js/shared/matchup-engine.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('./matchup-engine.js');

const BASE = { median: 15, floor: 11, ceiling: 21 };
const projectWith = (extra) => E.project(Object.assign({ pid: 'x', week: 3, position: 'WR', baseline: BASE, baselineSource: 'sleeper' }, extra));

test('weights sum to 100 and match the owner ruling', () => {
    const sum = Object.values(E.WEIGHTS).reduce((a, b) => a + b, 0);
    assert.equal(sum, 100);
    assert.deepEqual(E.WEIGHTS, { role: 22, health: 14, opponent: 14, game: 12, coaching: 8, h2h: 8, trench: 8, trend: 8, teamContext: 3, luck: 3 });
});

test('no factor data at all → projection equals the baseline, grade C, every factor listed as missing', () => {
    const p = projectWith({});
    assert.equal(p.mult, 1);
    assert.deepEqual(p.points, { median: 15, floor: 11, ceiling: 21 });
    assert.equal(p.grade, 'C');
    assert.equal(p.verdict, 'flex');
    assert.equal(p.baseline.source, 'sleeper');
    assert.equal(p.missing.length, 10);
    assert.equal(p.why.length, 0);
});

test('a ruled-out or bye player projects zero and is unavailable', () => {
    for (const status of ['OUT', 'IR', 'BYE', 'SUS']) {
        const p = projectWith({ health: { status } });
        assert.equal(p.available, false, status);
        assert.deepEqual(p.points, { median: 0, floor: 0, ceiling: 0 });
        assert.equal(p.verdict, 'out');
    }
});

test('questionable trims the number and cuts the floor harder than the ceiling', () => {
    const p = projectWith({ health: { status: 'Q' } });
    assert.ok(p.points.median < 15);
    assert.ok(p.points.floor / 11 < p.points.ceiling / 21, 'floor loses more than ceiling');
    assert.equal(p.available, true);
});

test('a factor can never move the number more than weight × SWING percent', () => {
    // role has the biggest weight (22) → max ±11%
    const best = projectWith({ role: { depthRank: 1, share: 1 } });
    const worst = projectWith({ role: { depthRank: 4, share: 0 } });
    assert.ok(best.mult <= 1 + 0.22 * E.SWING + 1e-9);
    assert.ok(worst.mult >= 1 - 0.22 * E.SWING - 1e-9);
    assert.ok(best.mult > 1 && worst.mult < 1);
});

test('softest defense lifts, toughest defense drops, middle is neutral', () => {
    const soft = projectWith({ opponent: { abbr: 'CAR', rankVsPos: 32 } });
    const tough = projectWith({ opponent: { abbr: 'BAL', rankVsPos: 1 } });
    const mid = projectWith({ opponent: { abbr: 'DAL', rankVsPos: 16.5 } });
    assert.ok(soft.points.median > 15);
    assert.ok(tough.points.median < 15);
    assert.equal(mid.mult, 1);
    assert.match(soft.why[0].note, /Soft matchup vs CAR/);
});

test('division bully history helps every player on that team, and hurts the victim', () => {
    const bully = projectWith({ h2h: { games: 6, wins: 6, avgMargin: 12, division: true } });
    const victim = projectWith({ h2h: { games: 6, wins: 0, avgMargin: -12, division: true } });
    const nonDiv = projectWith({ h2h: { games: 6, wins: 6, avgMargin: 12, division: false } });
    assert.ok(bully.mult > 1);
    assert.ok(victim.mult < 1);
    assert.ok(bully.mult > nonDiv.mult, 'division games count more');
    assert.match(bully.why[0].note, /Owns this matchup \(6-0 last 6, division\)/);
    // one meeting is not history
    assert.equal(projectWith({ h2h: { games: 1, wins: 1 } }).mult, 1);
});

test('established staff vs green staff is an edge; even staffs are neutral', () => {
    const edge = projectWith({ coaching: { team: 0.9, opp: 0.3 } });
    const even = projectWith({ coaching: { team: 0.6, opp: 0.6 } });
    assert.ok(edge.mult > 1);
    assert.equal(even.mult, 1);
    assert.match(edge.why[0].note, /Staff edge/);
});

test('trench edge works from the player\'s side of the ball, including IDP', () => {
    const olWins = projectWith({ position: 'RB', trench: { mine: 80, theirs: 55 } });
    const dlWins = projectWith({ position: 'DL', trench: { mine: 85, theirs: 50 } });
    const dlLoses = projectWith({ position: 'DL', trench: { mine: 50, theirs: 85 } });
    assert.ok(olWins.mult > 1);
    assert.ok(dlWins.mult > 1);
    assert.ok(dlLoses.mult < 1);
});

test('game environment: implied total, spread by position, home/away, overseas, weather', () => {
    const shootout = projectWith({ game: { impliedTotal: 30 } });
    const slog = projectWith({ game: { impliedTotal: 15 } });
    assert.ok(shootout.mult > 1 && slog.mult < 1);

    const favRB = projectWith({ position: 'RB', game: { spread: -10 } });
    const favWR = projectWith({ position: 'WR', game: { spread: -10 } });
    assert.ok(favRB.mult > 1, 'big favorite helps the RB');
    assert.ok(favWR.mult < 1, 'big favorite slightly hurts the passing game');

    assert.ok(projectWith({ game: { home: true } }).mult > projectWith({ game: { home: false } }).mult);
    assert.ok(projectWith({ game: { international: true } }).mult < 1);

    const windyWR = projectWith({ position: 'WR', game: { weather: { display: 'Wind 25 mph' } } });
    const windyRB = projectWith({ position: 'RB', game: { weather: { display: 'Wind 25 mph' } } });
    const domeWR = projectWith({ position: 'WR', game: { weather: { display: 'Wind 25 mph', indoor: true } } });
    assert.ok(windyWR.mult < 1);
    assert.equal(windyRB.mult, 1);
    assert.equal(domeWR.mult, 1);
});

test('trend: hot last three weeks lifts, cold drops, tiny sample is ignored', () => {
    assert.ok(projectWith({ trend: { last3: 20, season: 14 } }).mult > 1);
    assert.ok(projectWith({ trend: { last3: 8, season: 14 } }).mult < 1);
    assert.equal(projectWith({ trend: { last3: 5, season: 1 } }).mult, 1);
});

test('luck: unsustainable touchdown rate is a penalty, drought is a smaller boost', () => {
    const hot = projectWith({ luck: { tdRate: 0.12, expectedTdRate: 0.06 } });
    const cold = projectWith({ luck: { tdRate: 0.0, expectedTdRate: 0.06 } });
    assert.ok(hot.mult < 1);
    assert.ok(cold.mult > 1);
    assert.ok(Math.abs(hot.mult - 1) > Math.abs(cold.mult - 1));
});

test('grades follow the multiplier thresholds', () => {
    assert.equal(E.gradeFor(1.2), 'A');
    assert.equal(E.gradeFor(1.06), 'B');
    assert.equal(E.gradeFor(1.0), 'C');
    assert.equal(E.gradeFor(0.9), 'D');
    assert.equal(E.gradeFor(0.8), 'F');
    assert.equal(E.verdictFor('A', true), 'start');
    assert.equal(E.verdictFor('C', true), 'flex');
    assert.equal(E.verdictFor('F', true), 'sit');
    assert.equal(E.verdictFor('A', false), 'out');
});

test('the "why" list is sorted by impact and only lists factors that had data', () => {
    const p = projectWith({
        role: { depthRank: 1, share: 0.9 },
        opponent: { rankVsPos: 30 },
        luck: { tdRate: 0.06, expectedTdRate: 0.06 },
    });
    assert.deepEqual(p.why.map(w => w.key), ['role', 'opponent', 'luck']);
    assert.equal(p.missing.length, 7);
    for (let i = 1; i < p.why.length; i++) assert.ok(Math.abs(p.why[i - 1].impactPct) >= Math.abs(p.why[i].impactPct));
});

test('a full stacked best case and worst case stay inside sane bounds', () => {
    const best = projectWith({
        role: { depthRank: 1, share: 1 }, health: { status: '' }, opponent: { rankVsPos: 32 },
        game: { impliedTotal: 31, home: true }, coaching: { team: 1, opp: 0 }, h2h: { games: 6, wins: 6, avgMargin: 20, division: true },
        trench: { mine: 95, theirs: 40 }, trend: { last3: 25, season: 12 }, teamContext: { qbGrade: 92, recordDiff: 1 }, luck: { tdRate: 0, expectedTdRate: 0.06 },
    });
    const worst = projectWith({
        role: { depthRank: 3, share: 0 }, health: { status: 'D', practice: 'DNP', weeksSinceReturn: 0 }, opponent: { rankVsPos: 1 },
        game: { impliedTotal: 14, home: false, international: true, weather: { display: 'Snow' } }, coaching: { team: 0, opp: 1 }, h2h: { games: 6, wins: 0, avgMargin: -20, division: true },
        trench: { mine: 40, theirs: 95 }, trend: { last3: 4, season: 12 }, teamContext: { qbGrade: 40, recordDiff: -1 }, luck: { tdRate: 0.2, expectedTdRate: 0.06 },
    });
    assert.equal(best.grade, 'A');
    assert.equal(worst.grade, 'F');
    assert.ok(best.mult < 1.6, 'best case ' + best.mult);
    assert.ok(worst.mult > 0.5, 'worst case ' + worst.mult);
    assert.ok(best.points.floor <= best.points.median && best.points.median <= best.points.ceiling);
});
