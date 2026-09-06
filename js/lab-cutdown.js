// ══════════════════════════════════════════════════════════════════
// js/lab-cutdown.js — CUTDOWN DESK (LAB26)
//
// Lab port of the C2 sandbox's Roster Cutdown concept, rebuilt for the
// lab shell (owner approval 2026-09-06: "wire them to the Lab only").
// Two C2 sources inform it:
//   • roster-cutdown.js       — the rule store (active/taxi caps + date)
//   • my-team.js "GM's Desk"  — strategy-aware cut/taxi scoring
// The scoring is ported faithfully so the owner can judge the ORIGINAL
// logic; the one change for the lab is a visible ONE-BRAIN CHECK line
// that flags any call clashing with the brain's needs/surplus reads —
// we surface disagreements here instead of silently rewriting them.
//
// Storage key matches C2's ('wr_roster_cutdown_<leagueId>') so a rule
// recorded here carries over verbatim when this ships to the website.
// Values come from the live engine (window.dynastyValue — v2 on this
// shell); nothing here writes to any engine state.
// ══════════════════════════════════════════════════════════════════
(function () {
    'use strict';

    const KEY = lid => 'wr_roster_cutdown_' + lid;
    const NEAR_DAYS = 14;
    const DAY_MS = 86400000;

    // ── Rule store (C2 roster-cutdown.js, verbatim behavior) ──────────
    function getRule(lid) {
        try { return JSON.parse(localStorage.getItem(KEY(lid)) || 'null'); } catch (e) { return null; }
    }
    function setRule(lid, fields) {
        const effectiveDate = fields.effectiveDate ? String(fields.effectiveDate) : '';
        const rawActive = Number(fields.activeSlots) || 0;
        if (!rawActive || !effectiveDate) return null;
        const rec = {
            activeSlots: Math.max(1, Math.round(rawActive)),
            taxiSlots: Math.max(0, Math.round(Number(fields.taxiSlots) || 0)),
            effectiveDate,
            setBy: 'owner',
            updatedAt: Date.now(),
        };
        localStorage.setItem(KEY(lid), JSON.stringify(rec));
        return rec;
    }
    function clearRule(lid) { localStorage.removeItem(KEY(lid)); }
    function ruleStatus(rule) {
        if (!rule || !rule.effectiveDate) return null;
        const target = new Date(rule.effectiveDate + 'T00:00:00').getTime();
        if (Number.isNaN(target)) return null;
        const daysUntil = Math.ceil((target - Date.now()) / DAY_MS);
        return { daysUntil, isPast: daysUntil < 0, isNear: daysUntil <= NEAR_DAYS };
    }

    // ── Peak phase (lab derivation) ───────────────────────────────────
    // The sandbox reads peakPhase off its PlayerValue rows; the shared
    // engine doesn't export one, so the lab derives it from age by
    // position — the same walls the app family prices against.
    function peakPhase(pos, age) {
        if (age == null) return 'PEAK';
        const walls = {
            QB: { pre: 25, vet: 33, post: 36 }, RB: { pre: 23, vet: 27, post: 29 },
            WR: { pre: 24, vet: 29, post: 31 }, TE: { pre: 25, vet: 30, post: 32 },
            DL: { pre: 24, vet: 30, post: 32 }, LB: { pre: 24, vet: 29, post: 31 },
            DB: { pre: 24, vet: 29, post: 31 },
        };
        const w = walls[pos] || { pre: 24, vet: 30, post: 32 };
        if (age < w.pre) return 'PRE';
        if (age >= w.post) return 'POST';
        if (age >= w.vet) return 'VET';
        return 'PEAK';
    }

    // ── Strategy-aware scoring (C2 my-team.js port) ───────────────────
    function scarcityMult(pos, league) {
        const positions = league?.roster_positions || [];
        const scoring = league?.scoring_settings || {};
        let mult = 1.0;
        if (positions.includes('SUPER_FLEX') && pos === 'QB') mult = 1.8;
        if ((scoring.bonus_rec_te || scoring.rec_te || 0) > 0 && pos === 'TE') mult = 1.5;
        const rbSlots = positions.filter(s => s === 'RB').length;
        if (pos === 'RB' && rbSlots >= 2) mult = Math.max(mult, 1.3);
        return mult;
    }
    function gmMode(strategy) {
        const t = String(strategy?.timeline || '').toLowerCase();
        if (/now|this_year|win/.test(t)) return 'win_now';
        if (/youth|rebuild|future/.test(t)) return 'rebuild';
        return 'compete';
    }
    function cutScore(r, mode, strategy, league) {
        let score = 0;
        const ageCutoff = 30;
        if (mode === 'rebuild') {
            if (r.phase === 'VET' || r.phase === 'POST') score += 15;
            if (r.age != null && r.age >= ageCutoff) score += 10;
            if (r.phase === 'PRE') score -= 20;
        } else if (mode === 'win_now') {
            if (r.phase === 'PRE') score += 15;
            if (r.age != null && r.age <= 22 && !r.curGP) score += 10;
            if (r.phase === 'VET') score -= 15;
        } else {
            if (r.phase === 'POST') score += 5;
        }
        const sell = new Set(strategy?.sellPositions || []);
        const target = new Set(strategy?.targetPositions || []);
        if (sell.has(r.pos)) score += 8;
        if (target.has(r.pos)) score -= 5;
        score -= (scarcityMult(r.pos, league) - 1) * 20;
        return score;
    }
    // Strategy reorders only near-equal players: capped to ±20% of DHQ.
    function adjustedDhq(r, mode, strategy, league) {
        const pct = Math.max(-0.2, Math.min(0.2, cutScore(r, mode, strategy, league) / 200));
        return r.dhq * (1 - pct);
    }
    function reasonFor(r, verdict, mode) {
        const ageTxt = r.age != null ? r.age + '-year-old ' : '';
        if (verdict === 'STASH') {
            if (mode === 'win_now') return 'Not ready to move the needle this season — taxi him and save the bench spot for a win-now piece.';
            if (mode === 'rebuild') return ageTxt + r.pos + ', still building — exactly what a rebuild protects. Taxi him, don’t cut him.';
            return 'Taxi-eligible with real upside left — no reason to burn a bench spot on him yet.';
        }
        if (mode === 'rebuild') return ageTxt + r.pos + ' doesn’t fit a youth build. Sell him or cut him.';
        if (mode === 'win_now') {
            // Lab fix over the C2 port: before Week 1 NOBODY has current-season
            // games, so the "hasn't played a snap" line fired for 35-year-old
            // vets. It now applies only to genuinely developmental players.
            if (!r.curGP && (r.phase === 'PRE' || (r.age != null && r.age <= 23))) return 'Hasn’t played a snap that matters — a win-now roster can’t carry a developmental piece.';
            return ageTxt + r.pos + ' isn’t helping this year’s push.';
        }
        return 'Lowest DHQ on the bench — not developing, not producing.';
    }

    // ── Compute the desk ──────────────────────────────────────────────
    function compute() {
        const S = window.S || {};
        const lid = String(S.currentLeagueId || '');
        const league = (S.leagues || []).find(l => String(l.league_id) === lid) || S.leagues?.[0];
        if (!lid || !league || !(S.rosters || []).length || !S.players) return null;

        // My roster: the lab login's Sleeper username.
        let auth = {};
        try { auth = JSON.parse(localStorage.getItem('od_auth_v1') || '{}'); } catch (e) { /* noop */ }
        const uname = String(auth.sleeperUsername || auth.username || '').toLowerCase();
        const me = (S.leagueUsers || []).find(u => String(u.display_name || '').toLowerCase() === uname);
        const myRoster = (S.rosters || []).find(r => me && String(r.owner_id) === String(me.user_id));
        if (!myRoster) return { error: 'Could not find your roster in this league.' };

        // Hold until the engine has real values — ranking a roster of zeros
        // would put the wrong names on the cut list (rig finding, LAB26).
        const anyValued = (S.rosters || []).some(r => (r.players || []).slice(0, 40).some(pid => {
            try { return Number(window.dynastyValue?.(pid)) > 0; } catch (e) { return false; }
        }));
        if (!anyValued) return { waiting: true };

        const strategy = window.GMStrategy?.getStrategy?.() || null;
        const mode = gmMode(strategy);
        const untouchable = new Set((strategy?.untouchables || []).map(String));
        const starters = new Set((myRoster.starters || []).map(String));
        const taxiSet = new Set((myRoster.taxi || []).map(String));
        const irSet = new Set((myRoster.reserve || []).map(String));
        const val = pid => { try { return Number(window.dynastyValue?.(pid)) || 0; } catch (e) { return 0; } };

        const rows = (myRoster.players || []).map(String).map(pid => {
            const p = S.players[pid] || {};
            const pos = String(p.position || p.pos || '?');
            const age = p.age != null ? Number(p.age) : null;
            return {
                pid, pos, age,
                name: ((p.first_name || '') + ' ' + (p.last_name || '')).trim() || pid,
                yearsExp: p.years_exp != null ? Number(p.years_exp) : 99,
                dhq: val(pid),
                phase: peakPhase(pos, age),
                curGP: 0, // pre-week-1: nobody has current-season games
                isStarter: starters.has(pid),
                isTaxi: taxiSet.has(pid),
                isIR: irSet.has(pid),
                untouchable: untouchable.has(pid),
            };
        });

        // League taxi shape (Sleeper settings, C2's fallbacks preserved).
        const taxiYears = Number.isFinite(Number(league?.settings?.taxi_years)) ? Number(league.settings.taxi_years) : 1;
        const taxiSlotsCap = Number(league?.settings?.taxi_slots) > 0 ? Number(league.settings.taxi_slots)
            : (league?.roster_positions || []).filter(p => p === 'TAXI').length;

        const rule = getRule(lid);
        const st = ruleStatus(rule);
        const activeCount = rows.filter(r => !r.isIR && !r.isTaxi).length;
        const taxiCount = rows.filter(r => r.isTaxi && !r.isIR).length;
        const activeOver = rule ? Math.max(0, activeCount - (rule.activeSlots || 0)) : 0;
        const taxiOver = rule ? Math.max(0, taxiCount - (rule.taxiSlots || 0)) : 0;

        // Candidate routing (C2 my-team.js port): bench ranked by
        // strategy-adjusted DHQ ascending; taxi-eligible players route to
        // STASH while room lasts, the rest to CUT.
        const bench = rows
            .filter(r => !r.isStarter && !r.isIR && !r.isTaxi && !r.untouchable)
            .sort((a, b) => adjustedDhq(a, mode, strategy, league) - adjustedDhq(b, mode, strategy, league));
        const taxiPlayers = rows.filter(r => r.isTaxi && !r.isIR).sort((a, b) => a.dhq - b.dhq);
        const ruleActive = !!(rule && st && st.isNear);
        const activeCandidates = ruleActive
            ? bench.slice(0, activeOver > 0 ? activeOver : 3)
            : bench.slice(0, 3);
        const roomStart = ruleActive
            ? (activeOver > 0 ? Math.max(0, (rule.taxiSlots || 0) - taxiPlayers.length) : 0)
            : Math.max(0, taxiSlotsCap - taxiPlayers.length);
        let taxiRoomLeft = roomStart;
        const calls = [];
        activeCandidates.forEach(r => {
            const eligible = r.yearsExp <= taxiYears;
            const verdict = (eligible && taxiRoomLeft > 0) ? 'STASH' : 'CUT';
            if (verdict === 'STASH') taxiRoomLeft--;
            calls.push({ r, verdict, reason: reasonFor(r, verdict, mode) });
        });
        if (ruleActive && taxiOver > 0) {
            taxiPlayers.slice(0, taxiOver).forEach(r => calls.push({ r, verdict: 'CUT', reason: 'Taxi squad over its own cap — weakest taxi value goes first.' }));
        }

        // One-brain check (lab law): a CUT at a position the brain reads as
        // a NEED gets flagged, never silently rewritten — that disagreement
        // is exactly what this lab test exists to surface.
        const brain = (window.DhqBrain && String(window.DhqBrain.leagueId || '') === lid) ? window.DhqBrain : null;
        const ob = brain?.byRosterId?.[String(myRoster.roster_id)] || null;
        const needSet = new Set((ob?.needs || []).map(n => n.pos));
        calls.forEach(c => { c.brainClash = c.verdict === 'CUT' && needSet.has(c.r.pos); });

        return {
            lid, league, mode, strategyDeclared: !!strategy && strategy.timeline !== undefined,
            rule, st, activeCount, taxiCount, activeOver, taxiOver, taxiSlotsCap, taxiYears,
            calls, brainOn: !!ob, needs: ob ? (ob.needs || []).map(n => n.pos) : [],
        };
    }

    // ── Render ────────────────────────────────────────────────────────
    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

    function render() {
        const d = compute();
        const host = document.getElementById('lab-cutdown');
        if (!host) return;
        if (!d) { host.innerHTML = ''; return; }
        if (d.waiting) { host.innerHTML = '<div class="lc-head"><span>CUTDOWN DESK</span><em>LAB26</em></div><div class="lc-note">Waiting for the engine to finish valuing the league…</div>'; return; }
        if (d.error) { host.innerHTML = '<div class="lc-note">' + esc(d.error) + '</div>'; return; }

        const ruleLine = d.rule
            ? 'Rule: <b>' + d.rule.activeSlots + ' active / ' + d.rule.taxiSlots + ' taxi</b> effective <b>' + esc(d.rule.effectiveDate) + '</b>'
                + (d.st ? (d.st.isPast ? ' — <span class="lc-warn">past due</span>' : ' — ' + d.st.daysUntil + ' day' + (d.st.daysUntil === 1 ? '' : 's') + ' out') : '')
                + ' · roster now: ' + d.activeCount + ' active / ' + d.taxiCount + ' taxi'
                + (d.activeOver + d.taxiOver > 0 ? ' · <span class="lc-warn">over by ' + (d.activeOver + d.taxiOver) + '</span>' : ' · <span class="lc-ok">fits</span>')
            : 'No cutdown rule set — showing the standing "3 weakest bench spots" advisory. Set your league’s cutdown rule below.';

        const modeLabel = { win_now: 'Win Now', rebuild: 'Rebuild', compete: 'Compete' }[d.mode] || d.mode;
        const brainLine = d.brainOn
            ? 'One-brain check: needs read as <b>' + (d.needs.join(', ') || 'none') + '</b>. Calls that clash are flagged ⚠.'
            : 'One-brain check: brain not loaded for this league (calls unchecked).';

        const rows = d.calls.map(c => {
            const v = c.r;
            const chip = c.verdict === 'STASH' ? '<span class="lc-chip lc-stash">STASH → TAXI</span>' : '<span class="lc-chip lc-cut">CUT</span>';
            const clash = c.brainClash ? ' <span class="lc-warn" title="The one brain reads this position as a roster NEED">⚠ brain reads ' + esc(v.pos) + ' as a need</span>' : '';
            return '<div class="lc-row">' + chip + '<b>' + esc(v.name) + '</b> <span class="lc-meta">' + esc(v.pos) + (v.age != null ? ' · ' + v.age : '') + ' · DHQ ' + Math.round(v.dhq).toLocaleString() + '</span>'
                + '<div class="lc-reason">' + esc(c.reason) + clash + '</div></div>';
        }).join('') || '<div class="lc-note">No candidates — bench is clean.</div>';

        host.innerHTML =
            '<div class="lc-head"><span>CUTDOWN DESK</span><em>LAB26 · ' + esc(modeLabel) + ' lens · lab only</em></div>'
            + '<div class="lc-note">' + ruleLine + '</div>'
            + '<div class="lc-note">' + brainLine + '</div>'
            + '<div class="lc-rows">' + rows + '</div>'
            + '<div class="lc-form">Active slots <input id="lcActive" inputmode="numeric" value="' + (d.rule ? d.rule.activeSlots : d.activeCount) + '">'
            + ' Taxi slots <input id="lcTaxi" inputmode="numeric" value="' + (d.rule ? d.rule.taxiSlots : d.taxiSlotsCap) + '">'
            + ' Date <input id="lcDate" type="date" value="' + (d.rule ? esc(d.rule.effectiveDate) : '') + '">'
            + ' <button id="lcSave">Save rule</button>' + (d.rule ? ' <button id="lcClear">Clear</button>' : '') + '</div>';

        const $ = id => document.getElementById(id);
        $('lcSave').onclick = () => {
            setRule(d.lid, { activeSlots: $('lcActive').value, taxiSlots: $('lcTaxi').value, effectiveDate: $('lcDate').value });
            render();
        };
        if ($('lcClear')) $('lcClear').onclick = () => { clearRule(d.lid); render(); };
    }

    function mount() {
        if (document.getElementById('lab-cutdown')) return;
        const style = document.createElement('style');
        style.textContent =
            '#lab-cutdown{margin:18px auto 40px;max-width:1100px;padding:14px 16px;background:var(--off-black,#111);border:1px solid var(--gold,#D4AF37);border-radius:12px;font-size:0.85rem;color:var(--silver,#c9c9c9)}'
            + '.lc-head{display:flex;justify-content:space-between;align-items:baseline;color:var(--gold,#D4AF37);font-weight:700;letter-spacing:0.06em;margin-bottom:8px}.lc-head em{font-weight:400;font-style:normal;opacity:0.7;font-size:0.75rem}'
            + '.lc-note{margin:4px 0;line-height:1.5}.lc-rows{margin:10px 0}.lc-row{padding:8px 10px;border:1px solid rgba(255,255,255,0.08);border-radius:8px;margin-bottom:6px}'
            + '.lc-chip{display:inline-block;font:700 0.7rem/1.6 monospace;padding:0 8px;border-radius:6px;margin-right:8px}.lc-cut{background:#5c1f1f;color:#ff9d9d}.lc-stash{background:#1f4d2a;color:#8fe3a5}'
            + '.lc-meta{opacity:0.7;margin-left:6px}.lc-reason{margin-top:4px;opacity:0.85;line-height:1.45}.lc-warn{color:#ffb300}.lc-ok{color:#8fe3a5}'
            + '.lc-form{margin-top:10px;display:flex;flex-wrap:wrap;gap:8px;align-items:center}.lc-form input{width:90px;background:#000;border:1px solid rgba(255,255,255,0.2);border-radius:6px;color:#eee;padding:4px 8px}'
            + '.lc-form button{background:var(--gold,#D4AF37);color:#000;border:none;border-radius:6px;padding:5px 12px;font-weight:700;cursor:pointer}';
        document.head.appendChild(style);
        const sec = document.createElement('section');
        sec.id = 'lab-cutdown';
        document.body.appendChild(sec);
    }

    function boot() {
        mount();
        render();
        if (window.DhqEvents) {
            window.DhqEvents.on?.('li:loaded', () => setTimeout(render, 400));
            window.DhqEvents.on?.('strategy:changed', () => render());
        }
        window.addEventListener('dhq:situation-changed', () => setTimeout(render, 400));
        // League switches re-run intel; a slow poll catches anything missed.
        setInterval(() => {
            const h = document.getElementById('lab-cutdown');
            if (h && (!h.innerHTML || h.innerHTML.indexOf('Waiting for the engine') !== -1)) render();
        }, 5000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
    else boot();
})();
