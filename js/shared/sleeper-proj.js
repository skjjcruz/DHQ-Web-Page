// ══════════════════════════════════════════════════════════════════
// js/shared/sleeper-proj.js — window.App.SleeperProj
// Loads Sleeper's OWN published weekly projection stat lines for the
// upcoming week and feeds them to App.WeeklyProj.setProjections, so the
// Proj column (and start/sit) shows the exact number the owner sees in
// the Sleeper app — scored through their league's rules. One voice.
//
// Source: Sleeper's public projections endpoint (CORS-open, same host the
// app already uses for stats):
//   https://api.sleeper.app/v1/projections/nfl/regular/{season}/{week}
// Returns a pid → statLine map (same shape as season stats: pass_yd,
// pass_td, rec, … plus pts_ppr/half_ppr/std), so App.calcRawPts scores it
// directly. Degrades to a no-op (home-grown engine) if unavailable.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';
    const App = root.App = root.App || {};
    const _done = {}; // `${season}|${week}` already loaded
    const SLEEPER = 'https://api.sleeper.app/v1';

    function targetWeek() {
        const WP = App.WeeklyProj;
        return (WP && WP.currentWeek) ? WP.currentWeek() : 1;
    }
    function targetSeason(season) {
        const s = root.S || {};
        const y = Number(season || (s.nflState && s.nflState.season) || s.season || 0);
        return y > 0 ? y : new Date().getFullYear();
    }

    async function fetchWeek(season, week) {
        // Prefer the shared Sleeper API (IndexedDB cache / dedupe) when present.
        if (root.Sleeper && root.Sleeper.fetchWeekProjections) return root.Sleeper.fetchWeekProjections(season, week);
        const r = await fetch(SLEEPER + '/projections/nfl/regular/' + season + '/' + week);
        if (!r.ok) throw new Error('projections ' + r.status);
        return r.json();
    }

    // A week's payload counts as published when a real number of rows carry
    // projected volume (attempts, targets, kicks, tackles) or points — not just
    // the draft-ADP placeholder every player row carries year-round.
    const VOLUME_FIELDS = ['pts_ppr', 'pts_half_ppr', 'pts_std', 'pass_att', 'rush_att', 'rec_tgt', 'fga', 'xpm', 'idp_tkl', 'idp_sack'];
    function looksPublished(byPid) {
        if (!byPid || typeof byPid !== 'object') return false;
        let live = 0;
        for (const pid in byPid) {
            const row = byPid[pid];
            if (row && VOLUME_FIELDS.some(k => Number(row[k]) > 0) && ++live >= 50) return true;
        }
        return false;
    }

    // Load the upcoming week's Sleeper projections and hand them to WeeklyProj.
    // Cached per (season, week). Returns the loaded week, or null on failure.
    async function loadCurrent(season) {
        const WP = App.WeeklyProj;
        if (!WP || !WP.setProjections) return null;
        const wk = targetWeek();
        const yr = targetSeason(season);
        const key = yr + '|' + wk;
        if (_done[key]) return wk;
        try {
            let byPid = await fetchWeek(yr, wk);
            // Sleeper returns a row for every player even before it has
            // published the week's lines — placeholder rows with an ADP and
            // no volume. A payload like that is NOT the week's projections:
            // it must not be handed to the projector (every surface would fall
            // back to estimates) and must not be marked done. The shared cache
            // can hold such a payload for hours, so go straight to the network
            // once before giving up (owner report 2026-09-17).
            if (!looksPublished(byPid)) {
                try {
                    const r = await fetch(SLEEPER + '/projections/nfl/regular/' + yr + '/' + wk);
                    if (r.ok) byPid = await r.json();
                } catch (e) { /* keep the cached payload for the check below */ }
            }
            if (looksPublished(byPid)) {
                WP.setProjections(wk, byPid);
                _done[key] = true;
                try { root.dispatchEvent && root.dispatchEvent(new CustomEvent('wr:proj-updated', { detail: { week: wk, season: yr } })); } catch (e) { /* no window */ }
                return wk;
            }
        } catch (e) { if (root.wrLog) root.wrLog('sleeperProj.load', e); }
        return null;
    }

    App.SleeperProj = App.SleeperProj || { loadCurrent, targetWeek, targetSeason, _done };
})(typeof window !== 'undefined' ? window : globalThis);
