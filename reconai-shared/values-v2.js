// ══════════════════════════════════════════════════════════════════
// lab/values-v2.js — DHQ VALUE FORMULA v2, pure library (TRADE LAB ONLY)
//
// The ratified pricing formula (owner rulings 2026-09-05, all five dials
// + the rookie rule). This file computes values from data it is HANDED —
// it fetches nothing, patches nothing, and owns no state. The lab's copy
// of the shared DHQ engine calls computeFromData() as ITS value step, so
// the one store every surface reads (LI.playerScores) is priced by this
// formula natively. One engine, one formula, every surface.
//
//   VALUE = ( WIN POINTS + BODY VALUE + HANDCUFF INSURANCE )
//           × AGE DISCOUNT × PFF QUALITY LENS × ROLE × AVAILABILITY
//           → scaled to the 0-10,000 ladder → bounded market vote
//
//   • Anchor: 70% last season + 30% prior, per game, league scoring —
//     real games only; the current season takes over week by week.
//   • Win points vs the league's own waiver line — format prices itself.
//   • Body value 15% (a proven producer is never zero — the Vidal rule);
//     handcuff = 20% of the starter-ahead's win points.
//   • Age: decline band ×1.0→×0.55; past it a producer keeps ×0.35 (the
//     Henry floor). Youth ≤23 ×1.15, ≤25 ×1.08.
//   • PFF grade nudges ±10%. Kickers graduate 750→150.
//   • Market (FantasyCalc rows, handed in): ≤25% weight, ±20% max move.
//   • Rookies are priced where the national market ranks them: Sleeper's
//     ADP (dynasty / redraft / superflex / IDP ladders) mapped onto this
//     league's own veteran ladder; the league's draft slot nudges 20%;
//     real games walk them toward the formula (owner ruling 2026-09-16).
//
// Loaded only by trade-lab.html, before the shared engine bundle.
// Nothing in production references it.
// ══════════════════════════════════════════════════════════════════
(function (root) {
    'use strict';

    var POS = ['QB', 'RB', 'WR', 'TE', 'K', 'DL', 'LB', 'DB'];
    var BAND = { QB: [33, 38], RB: [28, 30], WR: [30, 33], TE: [30, 33], K: [30, 42], DL: [29, 33], LB: [29, 33], DB: [28, 32] };

    function normPos(p) {
        p = String(p || '').toUpperCase();
        if (['DE', 'DT', 'NT', 'EDGE', 'ED', 'DI', 'IDL'].indexOf(p) >= 0) return 'DL';
        if (['CB', 'S', 'FS', 'SS'].indexOf(p) >= 0) return 'DB';
        if (['OLB', 'ILB', 'MLB'].indexOf(p) >= 0) return 'LB';
        if (p === 'HB' || p === 'FB') return 'RB';
        return p;
    }
    function nname(n) {
        return String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
            .replace(/[.'’`]/g, '').replace(/[-_]/g, ' ')
            .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
            .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
    }
    function rel(gp) {
        gp = Number(gp) || 0;
        if (gp >= 12) return 1;
        if (gp >= 10) return 0.96 + (gp - 10) * 0.02;
        if (gp >= 8) return 0.88 + (gp - 8) * 0.04;
        if (gp >= 5) return 0.7 + (gp - 5) * 0.06;
        if (gp >= 3) return 0.55 + (gp - 3) * 0.075;
        return gp > 0 ? 0.45 : 0;
    }

    // computeFromData(d) → { values, meta, waiver }
    //   d: { league {scoring_settings, roster_positions, season},
    //        rosters, playersData,
    //        stA (last season stats), stB (prior), stCur (current),
    //        pff (byName grade map), draftPicks (current-season league
    //        rookie draft picks), pickValues (league slot values),
    //        fcRows (FantasyCalc rows, may be []),
    //        adp (Sleeper season projections keyed by pid — the rows carry
    //             adp_ppr / adp_dynasty_2qb / adp_idp … ; 999 = unranked),
    //        format { dynasty, sf, ppr:'ppr'|'half'|'std', idp },
    //        prospectRankOf (optional fn(player) → consensus rank | null),
    //        waiverRookies (price unrostered rookies on NFL clubs too) }
    //   → { values, meta, waiver, rookieLadder }
    function computeFromData(d) {
        var league = d.league || {};
        var sc = league.scoring_settings || {};
        var rosters = d.rosters || [];
        var players = d.playersData || {};
        var stA = d.stA || {}, stB = d.stB || {}, stCur = d.stCur || {};
        var pff = d.pff || {};

        function score(st) { var t = 0; for (var k in sc) if (st[k]) t += sc[k] * st[k]; return t; }
        function pgOf(stats, pid) { var s = stats[pid]; if (!s || !s.gp) return { v: 0, gp: 0 }; return { v: score(s) / s.gp, gp: s.gp }; }
        function anchorOf(pid) {
            var a = pgOf(stA, pid), b = pgOf(stB, pid), c = pgOf(stCur, pid);
            var aAdj = a.v * rel(a.gp), bAdj = b.v * rel(b.gp);
            var base = (a.v && b.v) ? aAdj * 0.7 + bAdj * 0.3 : (aAdj || bAdj * 0.85);
            if (c.gp > 0) { var w = c.gp / (c.gp + 6); return c.v * w + base * (1 - w); }
            return base;
        }

        var rostered = {};
        rosters.forEach(function (r) { (r.players || []).forEach(function (pid) { rostered[String(pid)] = 1; }); });

        // Waiver line: best three free agents on an NFL roster, per position.
        var waiver = {};
        POS.forEach(function (P) {
            var free = [];
            for (var pid in players) {
                var p = players[pid];
                if (rostered[pid] || !p.team || p.status !== 'Active') continue;
                if (normPos(p.position) !== P) continue;
                var v = anchorOf(pid);
                if (v > 0) free.push(v);
            }
            free.sort(function (a, b) { return b - a; });
            waiver[P] = free.length ? free.slice(0, 3).reduce(function (s, v) { return s + v; }, 0) / Math.min(3, free.length) : 0;
        });

        // Average starter pace per position (youth gate).
        var avgStarter = {};
        POS.forEach(function (P) {
            var arr = [];
            for (var pid in rostered) { if (normPos((players[pid] || {}).position) === P) { var v = anchorOf(pid); if (v > 0) arr.push(v); } }
            arr.sort(function (a, b) { return b - a; });
            var n = Math.min(arr.length, { QB: 32, RB: 48, WR: 64, TE: 32, K: 32, DL: 64, LB: 48, DB: 64 }[P] || 32);
            avgStarter[P] = n ? arr.slice(0, n).reduce(function (s, v) { return s + v; }, 0) / n : 0;
        });

        var teamNo1 = {};
        for (var pid0 in players) { var p0 = players[pid0]; if (p0.team && Number(p0.depth_chart_order) === 1) teamNo1[p0.team + ':' + normPos(p0.position)] = pid0; }

        function ageMult(pos, age, anchor) {
            if (!age) return 1;
            var band = BAND[pos] || [29, 33], s = band[0], e = band[1];
            if (age < s) return 1;
            if (age <= e) return 1 - 0.45 * ((age - s) / Math.max(1, e - s));
            return anchor > 3 ? 0.35 : 0.15; // the Henry floor: a producer is never erased
        }
        function youthMult(pos, age, anchor) {
            if (!age || anchor < (avgStarter[pos] || 0) * 0.6) return 1;
            if (age <= 23) return 1.15;
            if (age <= 25) return 1.08;
            return 1;
        }
        function qualityMult(p) {
            var hit = pff[nname(p.full_name)];
            if (!hit) return 1;
            return 1 + Math.max(-0.10, Math.min(0.10, (hit.g - 70) / 200));
        }
        function roleMult(p) {
            var pos = normPos(p.position); var o = p.depth_chart_order;
            if (!isFinite(o) || o == null) return 1;
            if (pos === 'QB') return o <= 1 ? 1 : o === 2 ? 0.75 : 0.5;
            if (pos === 'RB') return o <= 1 ? 1 : o === 2 ? 0.95 : o === 3 ? 0.8 : 0.65;
            if (pos === 'WR') return o <= 2 ? 1 : o === 3 ? 0.95 : 0.82;
            if (pos === 'TE') return o <= 1 ? 1 : o === 2 ? 0.85 : 0.65;
            if (pos === 'K') return o <= 1 ? 1 : 0.6;
            return o <= 2 ? 1 : 0.9;
        }
        function availMult(p, isRostered) {
            var st = String(p.status || '').toLowerCase();
            var inj = String(p.injury_status || '').toLowerCase();
            if (st.indexOf('retired') >= 0) return 0;
            // Sleeper stamps every IR / PUP / NFI player "Inactive" — still under
            // contract, still an asset. That reads as the injury haircut below,
            // never a zero (owner ruling 2026-09-16: Tyson, Brazzell). An
            // "Inactive" player with no club and no injury is genuinely gone.
            if (st.indexOf('inactive') >= 0 && !inj && !p.team) return 0;
            var m = 1;
            if (!p.team) m *= 0.3; // no NFL club
            if (!isRostered) m *= 0.55; // free agent in this league — nobody pays roster space for him yet
            if (inj === 'out' || inj.indexOf('ir') >= 0 || inj === 'pup' || inj === 'nfi' || (st.indexOf('inactive') >= 0 && inj)) m *= 0.7; // down right now
            return m;
        }

        // ── raw formula values: every active player with a real pulse ──
        // (rostered players always; unrostered actives too, so free-agency
        // and waiver surfaces price from the same formula.)
        var raw = {}, meta = {};
        var kickers = [];
        function priceOne(pid) {
            var p = players[pid] || {};
            var pos = normPos(p.position);
            if (POS.indexOf(pos) < 0) return;
            if (Number(p.years_exp) === 0) return; // rookies: slot rule below
            var isRos = !!rostered[pid];
            var anchor = anchorOf(pid);
            if (!isRos && anchor <= 0) return; // irrelevant free agents stay unpriced
            if (pos === 'K') { if (isRos) kickers.push({ pid: pid, anchor: anchor, age: Number(p.age) || 0, grade: (pff[nname(p.full_name)] || {}).g || 60 }); return; }
            var win = Math.max(0, anchor - (waiver[pos] || 0));
            var body = anchor > 3 ? anchor * 0.15 : 0;
            var cuff = 0;
            if (isRos && (pos === 'RB' || pos === 'QB') && Number(p.depth_chart_order) === 2) {
                var starter = teamNo1[p.team + ':' + pos];
                if (starter) cuff = Math.max(0, anchorOf(starter) - (waiver[pos] || 0)) * 0.20;
            }
            var age = Number(p.age) || 0;
            var am = ageMult(pos, age, anchor), ym = youthMult(pos, age, anchor);
            var qm = qualityMult(p), rm = roleMult(p), av = availMult(p, isRos);
            raw[pid] = (win + body + cuff) * am * ym * qm * rm * av;
            meta[pid] = { pos: pos, ppg: +anchor.toFixed(1), age: age, win: +win.toFixed(1), body: +body.toFixed(1), cuff: +cuff.toFixed(1), am: +am.toFixed(2), ym: ym, qm: +qm.toFixed(2), rm: rm, av: +av.toFixed(2), source: 'LAB_V2' };
        }
        for (var pidR in rostered) priceOne(pidR);
        for (var pidA in players) { if (!rostered[pidA] && (players[pidA] || {}).team) priceOne(pidA); }

        // Scale (winsorized shoulder): top player ≈ 9,500.
        var sorted = Object.keys(raw).map(function (k) { return raw[k]; }).sort(function (a, b) { return b - a; });
        var shoulder = sorted.length > 2 ? (sorted[1] + sorted[2]) / 2 : (sorted[0] || 1);
        var top = Math.max(1, Math.min(sorted[0] || 1, shoulder * 1.2));
        var values = {};
        for (var pid2 in raw) values[pid2] = Math.round(Math.min(10000, raw[pid2] / top * 9500));

        // Kickers: graduated 750 → 150, ranked by pace + PFF FG grade.
        kickers.sort(function (a, b) { return (b.anchor * 0.6 + b.grade * 0.04) - (a.anchor * 0.6 + a.grade * 0.04); });
        kickers.forEach(function (k, i) {
            var t = kickers.length > 1 ? i / (kickers.length - 1) : 0;
            values[k.pid] = Math.round(750 - t * 600);
            meta[k.pid] = { pos: 'K', ppg: +k.anchor.toFixed(1), age: k.age, grade: k.grade, kRank: i + 1, source: 'LAB_V2' };
        });

        // ── Rookies (owner ruling 2026-09-16): national ADP is the baseline ──
        // A rookie is priced like the veterans the market ranks around him:
        // count the veterans Sleeper's ADP ranks ahead of him, hand him the
        // value at that rung of THIS league's own veteran ladder. No curve,
        // no constants — the league scale prices itself, in its own scoring.
        //   ladder   : dynasty leagues read the dynasty ADP (2QB when
        //              superflex, else the league's PPR flavor); redraft and
        //              keeper read the redraft ADP; IDP rookies read the IDP
        //              ladder against IDP veterans.
        //   fallback : a sibling flavor, then prospect consensus rank mapped
        //              onto the rookie ADP ladder, then the league's own
        //              draft slot alone. Nothing anywhere = no value.
        //   slot     : where the league drafted him is a nudge (20%).
        //   form     : real games walk him toward the formula (unchanged).
        //   waivers  : an unrostered rookie on an NFL club prices the same
        //              way, with the free-agent haircut veterans get.
        var fmt = d.format || {};
        var adpRows = d.adp || {};
        var slotByPlayer = {};
        (d.draftPicks || []).forEach(function (pk) { var id = pk.player_id || pk.pid; if (id) slotByPlayer[String(id)] = pk.pick_no; });
        var pickValues = d.pickValues || {};
        var IDP = ['DL', 'LB', 'DB'];

        function adpOf(pid, field) {
            var row = adpRows[pid]; var v = row && row[field];
            return (v != null && isFinite(v) && +v > 0 && +v < 900) ? +v : null;
        }
        function adpChain(pos) {
            var flav = fmt.ppr === 'ppr' ? 'ppr' : fmt.ppr === 'half' ? 'half_ppr' : 'std';
            var c = [];
            if (IDP.indexOf(pos) >= 0) { c.push(fmt.sf ? 'adp_idp' : 'adp_idp_1qb', fmt.sf ? 'adp_idp_1qb' : 'adp_idp'); }
            else if (fmt.dynasty) {
                if (fmt.sf) c.push('adp_dynasty_2qb');
                c.push('adp_dynasty_' + flav, 'adp_dynasty_ppr', 'adp_dynasty_half_ppr', 'adp_dynasty_std');
                if (fmt.sf) c.push('adp_2qb');
                c.push('adp_' + flav, 'adp_ppr');
            } else {
                if (fmt.sf) c.push('adp_2qb');
                c.push('adp_' + flav, 'adp_ppr', 'adp_half_ppr', 'adp_std');
            }
            var seen = {}; return c.filter(function (f) { if (seen[f]) return false; seen[f] = 1; return true; });
        }
        // Per ADP field: the veterans that ladder ranks (values already priced
        // above, rookies excluded) — their ADPs low→high and their values
        // high→low. A rookie is priced among THESE veterans: the ones the
        // market actually ranks, so a rookie the market puts behind all of
        // them lands below them, not at some mid-ladder rung.
        var vetPids = [];
        for (var pv in values) { if (Number((players[pv] || {}).years_exp) !== 0 && values[pv] > 0) vetPids.push(pv); }
        var vetLadderCache = {};
        function vetLadder(field) {
            if (vetLadderCache[field]) return vetLadderCache[field];
            var adps = [], vals = [];
            vetPids.forEach(function (vp) { var a = adpOf(vp, field); if (a != null) { adps.push(a); vals.push(values[vp]); } });
            adps.sort(function (a, b) { return a - b; });
            vals.sort(function (a, b) { return b - a; });
            return (vetLadderCache[field] = { adps: adps, vals: vals });
        }
        function ladderValue(field, adp) {
            var L = vetLadder(field);
            if (L.adps.length < 20) return 0; // too thin to be a market
            var lo = 0, hi = L.adps.length; // veterans the market ranks ahead of him
            while (lo < hi) { var mid = (lo + hi) >> 1; if (L.adps[mid] < adp) lo = mid + 1; else hi = mid; }
            if (lo < L.vals.length) return L.vals[lo];
            // Past the last ranked veteran: fall away in proportion to how far
            // past him the market puts the rookie (ADP 600 vs a last rung at 300
            // = half of that rung), never below zero.
            var lastAdp = L.adps[L.adps.length - 1], lastVal = L.vals[L.vals.length - 1];
            return Math.round(lastVal * Math.min(1, lastAdp / Math.max(adp, lastAdp)));
        }
        // Rookie ADP ladders (every rookie on an NFL club), for the prospect
        // fallback: consensus rank r → the ADP of the r-th ranked rookie.
        var rookieAdpCache = {};
        function rookieAdps(field) {
            if (rookieAdpCache[field]) return rookieAdpCache[field];
            var arr = [];
            for (var rp in players) { var rr = players[rp] || {}; if (Number(rr.years_exp) === 0 && rr.team) { var a = adpOf(rp, field); if (a != null) arr.push(a); } }
            arr.sort(function (a, b) { return a - b; });
            return (rookieAdpCache[field] = arr);
        }
        function consensusValue(p) {
            var pos = normPos(p.position), chain = adpChain(pos), pid = p.player_id || null;
            for (var i = 0; i < chain.length; i++) {
                var a = pid != null ? adpOf(pid, chain[i]) : null;
                if (a != null) { var lv = ladderValue(chain[i], a); if (lv > 0) return { value: lv, field: chain[i], adp: a, via: 'adp' }; }
            }
            if (typeof d.prospectRankOf === 'function') {
                var r = null; try { r = d.prospectRankOf(p); } catch (e) { r = null; }
                if (r > 0) {
                    for (var k = 0; k < chain.length; k++) {
                        var lad = rookieAdps(chain[k]);
                        if (lad.length >= 8) {
                            var a2 = lad[Math.min(Math.round(r) - 1, lad.length - 1)];
                            var lv2 = ladderValue(chain[k], a2);
                            if (lv2 > 0) return { value: lv2, field: chain[k], adp: a2, via: 'prospect', rank: r };
                        }
                    }
                }
            }
            return null;
        }

        var rookieLadder = [];
        var rookieDraftOpen = !d.waiverRookies;
        for (var pid3 in players) {
            var p3 = players[pid3] || {};
            if (Number(p3.years_exp) !== 0) continue;
            var pos3 = normPos(p3.position);
            if (POS.indexOf(pos3) < 0) continue;
            var isRos3 = !!rostered[pid3];
            if (!isRos3 && (rookieDraftOpen || !p3.team)) continue;
            if (!p3.player_id) p3 = Object.assign({ player_id: pid3 }, p3);
            var cons = consensusValue(p3);
            var slotNo = slotByPlayer[pid3];
            var slotVal = slotNo && pickValues[slotNo] ? (pickValues[slotNo].value || 0) : 0;
            var base = 0, via = null;
            if (cons && slotVal > 0) { base = cons.value * 0.8 + slotVal * 0.2; via = cons.via + '+slot'; }
            else if (cons) { base = cons.value; via = cons.via; }
            else if (slotVal > 0) { base = slotVal; via = 'slot'; }
            if (cons) rookieLadder.push({ pid: pid3, pos: pos3, adpVal: cons.value, adp: cons.adp, field: cons.field });
            if (!(base > 0)) continue;
            var anchor3 = anchorOf(pid3);
            var gp3 = (stCur[pid3] || {}).gp || 0;
            var w3 = gp3 / (gp3 + 5);
            var form3 = Math.round(Math.min(10000, (Math.max(0, anchor3 - (waiver[pos3] || 0)) + (anchor3 > 3 ? anchor3 * 0.15 : 0)) * qualityMult(p3) / top * 9500));
            var v3 = base * (1 - w3) + form3 * w3;
            var av3 = availMult(p3, isRos3); // injury / no club / free-agent haircut, same as veterans
            v3 = Math.round(Math.min(10000, v3 * av3));
            if (v3 > 0) {
                values[pid3] = v3;
                meta[pid3] = { pos: pos3, ppg: +anchor3.toFixed(1), age: Number(p3.age) || 0, rookie: 1, via: via,
                    adpField: cons ? cons.field : null, adp: cons ? cons.adp : null, adpVal: cons ? Math.round(cons.value) : 0,
                    prospectRank: cons && cons.rank ? cons.rank : null,
                    slot: slotNo || null, slotVal: slotVal, played: gp3, av: +av3.toFixed(2), source: 'LAB_V2_ROOKIE' };
            }
        }
        rookieLadder.sort(function (a, b) { return b.adpVal - a.adpVal; });

        // ── Market leash: ≤25% weight, never more than ±20% movement ──
        try {
            var matched = (d.fcRows || []).filter(function (row) {
                var sid = row.player && row.player.sleeperId;
                return sid && values[sid] > 0 && row.value > 0 && !(meta[sid] && meta[sid].rookie);
            }).map(function (row) { return { sid: row.player.sleeperId, fc: row.value }; });
            matched.sort(function (a, b) { return b.fc - a.fc; });
            var ratios = matched.slice(0, 20).map(function (m) { return values[m.sid] / m.fc; }).sort(function (a, b) { return a - b; });
            var sf = ratios[Math.floor(ratios.length / 2)] || 1;
            matched.forEach(function (m) {
                var mkt = m.fc * sf;
                var v = values[m.sid];
                var dev = Math.abs(v - mkt) / Math.max(v, mkt, 1);
                var w = dev > 0.5 ? 0.25 : dev > 0.25 ? 0.20 : 0.15;
                var blended = v * (1 - w) + mkt * w;
                blended = Math.max(v * 0.8, Math.min(v * 1.2, blended)); // the ±20% leash
                if (meta[m.sid]) meta[m.sid].mkt = Math.round(mkt);
                values[m.sid] = Math.round(blended);
            });
        } catch (e) { /* market unavailable — the formula stands alone */ }

        return { values: values, meta: meta, waiver: waiver, rookieLadder: rookieLadder };
    }

    root.WrLabValuesV2 = {
        computeFromData: computeFromData,
        _normPos: normPos, // exposed for tests
    };
})(typeof window !== 'undefined' ? window : globalThis);
