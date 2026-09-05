// ══════════════════════════════════════════════════════════════════
// lab/conductor.js — THE ONE-BRAIN CONDUCTOR (TRADE LAB ONLY)
//
// Owner order 2026-09-05: "make everything sync, one brain — the
// situation room should constantly scan the entire app, and if a tab
// isn't staying on message it should automatically fix it."
//
// How every tab is forced onto one message: every lab surface that
// judges a roster ultimately calls window.assessTeamFromGlobal (Roster
// Pulse, Analytics, League Teams cards, owner-detail Roster Audit,
// briefing, DNA). The conductor computes the one brain (points ledger
// v4 + WrLabOneBrain, the ratified assessment spec) league-wide, then
// PATCHES the assessor AT THE SOURCE so its every answer carries the
// brain's health, tier, power, needs, strengths, and quality-template
// starter counts. No surface needs individual rewiring, and none can
// disagree — they all drink from the same tap.
//
// The sentinel then scans on a loop: if any late-loading module
// re-binds the assessor (drift), it re-patches on the spot; if rosters
// change (trade, add/drop, sync), it recomputes the brain and re-emits
// the app's own refresh events so mounted tabs re-render on the new
// truth. Every action is logged to window._labDbg.conductor.
//
// Loaded only by trade-lab.html. Nothing in production references it.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';
    if (typeof window === 'undefined') return;

    var DBG = { boots: 0, repatches: 0, recomputes: 0, lastSync: 0, errors: 0 };
    try { window._labDbg = window._labDbg || {}; window._labDbg.conductor = DBG; } catch (_e) { /* no-op */ }

    var brain = null;        // WrLabOneBrain.compute result
    var patchedFns = { single: null, all: null };
    var lastLid = null;
    var lastRosterSig = '';

    function rosterSig(S) {
        try { return (S.rosters || []).map(function (r) { return r.roster_id + ':' + (r.players || []).length + ':' + (r.players || []).slice(0, 3).join(','); }).join('|'); }
        catch (_e) { return ''; }
    }

    function normPos(p) {
        var L = window.WrLabPointsLedger;
        return L ? L.normPos(p) : String(p || '').toUpperCase();
    }

    // Pick ownership by owner USER id (same shape the brain's capital
    // score expects): every roster owns its own future picks, then the
    // league's traded-picks table reassigns.
    function buildPicksByOwner(S, curSeason) {
        var out = {};
        var years = [curSeason + 1, curSeason + 2, curSeason + 3];
        var rounds = 5;
        var ownerByKey = {};
        var byRid = {};
        (S.rosters || []).forEach(function (r) {
            byRid[String(r.roster_id)] = r;
            years.forEach(function (y) { for (var rd = 1; rd <= rounds; rd++) ownerByKey[y + '-' + rd + '-' + r.roster_id] = String(r.owner_id); });
        });
        (S.tradedPicks || []).forEach(function (tp) {
            var y = Number(tp.season); if (years.indexOf(y) < 0) return;
            var key = y + '-' + tp.round + '-' + tp.roster_id;
            var owner = byRid[String(tp.owner_id)];
            if (key in ownerByKey && owner) ownerByKey[key] = String(owner.owner_id);
        });
        Object.keys(ownerByKey).forEach(function (k) {
            var parts = k.split('-');
            (out[ownerByKey[k]] = out[ownerByKey[k]] || []).push({ year: +parts[0], round: +parts[1] });
        });
        return out;
    }

    function brainWindowOf(tier) {
        return (tier === 'ELITE' || tier === 'CONTENDER') ? 'CONTENDING'
            : tier === 'REBUILDING' ? 'REBUILDING' : 'TRANSITIONING';
    }

    // The overlay: one assessment, rewritten to the brain's truth.
    function overlay(a, rosterId) {
        if (!a || !brain) return a;
        var ob = brain.byRosterId && brain.byRosterId[String(rosterId != null ? rosterId : a.rosterId)];
        if (!ob) return a;
        var needs = ob.needs.map(function (n) {
            var old = (a.needs || []).filter(function (x) { return x.pos === n.pos; })[0] || {};
            return Object.assign({}, old, { pos: n.pos, urgency: n.urgency, have: n.have, need: n.need });
        });
        var strengths = ob.strengths.map(function (s) { return s.pos; });
        var posAssessment = Object.assign({}, a.posAssessment || {});
        Object.keys(brain.template).forEach(function (pos) {
            var have = ob.qualityCount[pos] || 0, need = brain.template[pos];
            var st = have < need ? (need - have >= 2 ? 'deficit' : 'thin') : have > need ? 'surplus' : 'ok';
            // The Roster Audit rows read nflStarters/startingReq for their
            // "x/y starters" line — those now speak the quality template, so
            // one card can never again say Stable in the row and Needs in the
            // header (owner report 2026-09-05).
            posAssessment[pos] = Object.assign({}, posAssessment[pos] || {}, {
                status: st, nflStarters: have, startingReq: need,
            });
        });
        return Object.assign({}, a, {
            healthScore: ob.health,
            tier: ob.tier, tierColor: ob.tierColor, tierBg: ob.tierBg,
            window: brainWindowOf(ob.tier),
            weeklyPts: ob.weeklyPts, targetPts: ob.barTotal,
            powerScore: ob.powerScore, powerRank: ob.powerRank,
            needs: needs, strengths: strengths, posAssessment: posAssessment,
            oneBrain: ob,
        });
    }

    function installPatch() {
        var orig = window.App && window.App.assessTeamFromGlobal;
        if (typeof orig !== 'function') return false;
        if (orig.__labConductor) return true; // already ours
        var single = function (rosterId) { return overlay(orig(rosterId), rosterId); };
        single.__labConductor = true;
        window.App.assessTeamFromGlobal = single;
        window.assessTeamFromGlobal = single;
        patchedFns.single = single;
        var origAll = window.App.assessAllTeams;
        if (typeof origAll === 'function' && !origAll.__labConductor) {
            var all = function () {
                var res = origAll.apply(this, arguments);
                try { return Array.isArray(res) ? res.map(function (a) { return overlay(a, a && a.rosterId); }) : res; }
                catch (_e) { return res; }
            };
            all.__labConductor = true;
            window.App.assessAllTeams = all;
            if (window.assessAllTeams) window.assessAllTeams = all;
            patchedFns.all = all;
        }
        return true;
    }

    function announce() {
        try { if (window.DhqEvents) window.DhqEvents.emit('li:loaded', { source: 'lab-conductor' }); } catch (_e) { /* no-op */ }
        try { window.dispatchEvent(new CustomEvent('dhq:situation-changed', { detail: { source: 'lab-conductor' } })); } catch (_e) { /* no-op */ }
    }

    function compute(S) {
        var lid = S.currentLeagueId;
        var rawLg = (S.leagues || []).filter(function (l) { return String(l.league_id) === String(lid); })[0];
        if (!rawLg || !rawLg.scoring_settings || !window.WrLabPointsLedger || !window.WrLabOneBrain) return Promise.resolve(false);
        var posOf = function (pid) { var p = S.players && S.players[pid]; return p ? p.position : null; };
        return window.WrLabPointsLedger.load({ league: rawLg, rosters: S.rosters, posOf: posOf }).then(function (ledger) {
            var curSeason = parseInt(rawLg.season, 10) || new Date().getFullYear();
            brain = window.WrLabOneBrain.compute({
                ledger: ledger, leagueInfo: rawLg, rosters: S.rosters,
                posOf: posOf, picksByOwner: buildPicksByOwner(S, curSeason),
            });
            window.LabBrain = brain; // one readable tap for every lab module
            DBG.recomputes++; DBG.lastSync = Date.now();
            return true;
        });
    }

    // ── The sentinel: constant scan, automatic correction ────────────
    var busy = false;
    setInterval(function () {
        try {
            if (busy) return;
            var S = window.S || (window.App && window.App.S);
            if (!S || !S.currentLeagueId || !S.rosters || !S.rosters.length || !S.players) return;
            // Situation Room on, always, in the lab.
            window.__DHQ_SITUATION_ROOM = true;
            var sig = rosterSig(S);
            var leagueChanged = S.currentLeagueId !== lastLid;
            var rostersChanged = sig !== lastRosterSig;
            var patchLost = !(window.assessTeamFromGlobal && window.assessTeamFromGlobal.__labConductor);
            if (!leagueChanged && !rostersChanged && !patchLost) return;
            busy = true;
            var work = (leagueChanged || rostersChanged)
                ? compute(S)
                : Promise.resolve(true);
            work.then(function (ok) {
                if (!ok) { busy = false; return; }
                lastLid = S.currentLeagueId; lastRosterSig = sig;
                var installed = installPatch();
                if (installed && patchLost && !leagueChanged && !rostersChanged) DBG.repatches++;
                if (installed && (leagueChanged || rostersChanged)) DBG.boots++;
                if (installed) announce();
                busy = false;
            }).catch(function (e) {
                DBG.errors++; busy = false;
                try { if (window.wrLog) window.wrLog('lab.conductor', e); } catch (_e2) { /* no-op */ }
            });
        } catch (e) { DBG.errors++; busy = false; }
    }, 2000);
})();
