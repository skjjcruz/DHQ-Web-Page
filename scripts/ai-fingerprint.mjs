// The AI analyst: a common-sense read on this week's projections.
//
// For each selected player it builds a short dossier (the locked DHQ
// projection and what built it, Sleeper's number, Vegas, his last three
// weeks, snaps, the injury note) and asks Claude whether the number makes
// sense. Claude answers with a verdict, an adjusted typical-week number,
// a confidence and a one-line fingerprint. Owner rulings 2026-09-29:
// Claude Haiku (cheapest), $10 a month hard ceiling, adjustments shown as
// soon as they land (the math-only number is kept beside them and both
// are graded every week).
//
//   node scripts/ai-fingerprint.mjs                 # weekly pass (Batch API, half price)
//   node scripts/ai-fingerprint.mjs --mode test     # 20 players, live calls, for a look
//   node scripts/ai-fingerprint.mjs --mode flagged  # injury tags and big gaps only
//   node scripts/ai-fingerprint.mjs --dry           # build dossiers, no API calls
//
// Needs ANTHROPIC_API_KEY (a Lab repo secret; never in the browser).
// Output: data/ai/{season}-w{week}.json, spend ledger data/ai/spend-{YYYY-MM}.json.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MODEL = 'claude-haiku-4-5';
// $ per million tokens (Claude Haiku 4.5, first-party API, Sept 2026). Batch is half.
const PRICE = { input: 1.0, output: 5.0, cacheWrite: 1.25, cacheRead: 0.1 };
const MONTH_CAP = Number(process.env.AI_MONTH_CAP || 8);   // stop here; the account limit is $10
const SL = 'https://api.sleeper.app/v1';
const UA = { headers: { 'User-Agent': 'curl/8.5.0', Accept: 'application/json' } };
const args = process.argv.slice(2);
const argVal = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MODE = argVal('--mode', 'weekly');
const DRY = args.includes('--dry');
const LIMIT = Number(argVal('--limit', MODE === 'test' ? 20 : MODE === 'flagged' ? 80 : 250));

async function J(u, tries = 3) {
    for (let i = 1; i <= tries; i++) {
        try { const r = await fetch(u, UA); if (r.status === 404) return null; if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + u); return await r.json(); }
        catch (e) { if (i === tries) throw e; await new Promise(res => setTimeout(res, 800 * i)); }
    }
}
const readJson = async (p, dflt) => { try { return JSON.parse(await readFile(p, 'utf8')); } catch (e) { return dflt; } };
const pts = (st, sc) => { let t = 0; for (const [k, v] of Object.entries(sc || {})) if (st && Number.isFinite(st[k])) t += st[k] * v; return +t.toFixed(1); };
// ESPN's league injury list (one call) carries RotoWire's newest note on
// every listed player, dated, which Sleeper's tag often lags behind.
const ESPN_TEAM = { WSH: 'WAS', JAC: 'JAX', LA: 'LAR' };
const nameKey = (n, t) => String(n || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv|v)\b\.?/g, '').replace(/[^a-z]/g, '') + '|' + (t || '');
async function espnReports() {
    const j = await J('https://site.api.espn.com/apis/site/v2/sports/football/nfl/injuries').catch(() => null);
    const by = {};
    for (const t of (j && j.injuries) || []) for (const i of t.injuries || []) {
        const a = i.athlete || {}, ab = a.team && a.team.abbreviation;
        const note = ((a.notes && a.notes.items) || [])[0];
        by[nameKey(a.displayName, ESPN_TEAM[ab] || ab)] = {
            status: i.status || null, date: i.date ? String(i.date).slice(0, 10) : null,
            injury: (i.details && (i.details.type || i.details.location)) || null,
            note: String((note && note.headline) || i.shortComment || '').slice(0, 300) || null,
        };
    }
    return by;
}
const r1 = (n) => (n == null || !isFinite(n) ? null : +Number(n).toFixed(1));

// ── What Claude is told (stable across players) ──────────────────────
const SYSTEM = `You are the DHQ projection analyst: an NFL fantasy expert who sanity-checks a statistical model's weekly projections, one player at a time.

The number you judge is the TYPICAL-WEEK projection (the median outcome) in half-PPR scoring with IDP and kicker defaults. It is graded on how close it lands to what the player actually scores, head to head against Sleeper's projection. Big weeks happen, but a projection should be the most likely outcome, not the best case.

You receive a dossier: the model's number and the stat line that built it (volume, efficiency, expected touchdowns), the matchup factors that moved it, Sleeper's projection, the Vegas team total and spread, the player's last three games (points, volume, snap share), and his injury status and notes.

How to judge:
- Ask whether the number is realistic for this player in this spot. Stacked optimism (high volume AND high efficiency AND lots of touchdowns AND a soft-matchup boost) is the classic error; so is a projection far above anything he has scored recently.
- Check the pieces: expected touchdowns above ~1.0 for a non-QB, yards per carry far above his norm, targets above his recent peak, a backup projected like a starter, a part-time defender projected like an every-down one.
- Sleeper's injury tag can lag a week behind. latest_report is ESPN/RotoWire's newest note with its date; when it is newer and says he is healthy, practicing or questionable, trust it over the old tag. A model number of 0 next to a fresh "he's playing" report means the model was fooled by a stale tag: give him a realistic number (Sleeper's is a fair anchor).
- Weigh the injury picture: Out/IR means 0. Doubtful usually means he sits. Questionable players usually play, but limited practice, a soft-tissue injury (hamstring, calf, groin) or a missed practice late in the week raises the risk of a limited role.
- Sleeper and Vegas are useful references, not the answer. When the model is far from Sleeper, look for the reason in the dossier; if there is none, lean toward Sleeper.
- Team context: the Vegas implied total caps how much offense a team can produce. A 20-point implied total does not support several big fantasy games.
- Change the number only when the dossier gives you a reason. If it looks right, keep it. Small nudges (under ~0.5 points) are not worth making.

Answer with:
- verdict: "keep", "lower", "raise", or "out_risk" (he may not play or may play a reduced role)
- adjusted: your typical-week projection (same scoring; equal to the model's number when you keep it)
- confidence: "low", "medium", or "high"
- fingerprint: one or two plain sentences a fantasy manager would understand, naming the specific reason
- reasons: up to three short phrases`;

const SCHEMA = {
    type: 'object',
    properties: {
        verdict: { type: 'string', enum: ['keep', 'lower', 'raise', 'out_risk'] },
        adjusted: { type: 'number' },
        confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
        fingerprint: { type: 'string' },
        reasons: { type: 'array', items: { type: 'string' } },
    },
    required: ['verdict', 'adjusted', 'confidence', 'fingerprint', 'reasons'],
    additionalProperties: false,
};

// ── The dossier ───────────────────────────────────────────────────────
function dossier(pid, meta, row, pl, recent, week, espn) {
    const games = recent.map(g => g.stats && g.stats.gp >= 1 ? {
        wk: g.week, pts: pts(g.stats, g.scoring),
        snap: g.stats.tm_off_snp > 0 ? Math.round(100 * (g.stats.off_snp || 0) / g.stats.tm_off_snp) + '%' : g.stats.tm_def_snp > 0 ? Math.round(100 * (g.stats.def_snp || 0) / g.stats.tm_def_snp) + '%' : null,
        vol: [g.stats.pass_att ? g.stats.pass_att + ' att' : null, g.stats.rush_att ? g.stats.rush_att + ' car' : null, g.stats.rec_tgt ? g.stats.rec_tgt + ' tgt' : null, g.stats.idp_tkl ? g.stats.idp_tkl + ' tkl' : null, g.stats.idp_sack ? g.stats.idp_sack + ' sk' : null, g.stats.fga ? g.stats.fga + ' FGA' : null].filter(Boolean).join(', ') || '—',
        td: (g.stats.rush_td || 0) + (g.stats.rec_td || 0) + (g.stats.pass_td ? g.stats.pass_td + ' pass' : 0) || 0,
    } : { wk: g.week, pts: 0, note: 'did not play' });
    return {
        player: (pl.full_name || pid) + ', ' + meta.pos + ', ' + meta.team + (pl.age ? ', age ' + pl.age : '') + (pl.years_exp != null ? ', ' + pl.years_exp + ' yrs exp' : ''),
        week, opponent: meta.opp || null,
        model_projection: row[0], model_average_week: row[2] != null ? row[2] : row[0], sleeper_projection: row[1],
        model_reasoning: meta.why || '',
        vegas: { team_implied_total: meta.imp, spread: meta.spr },
        injury: { status: pl.injury_status || meta.inj || 'healthy', body_part: pl.injury_body_part || null, notes: pl.injury_notes || null, practice: pl.practice_participation || null },
        latest_report: espn || null,
        depth_chart: pl.depth_chart_position ? pl.depth_chart_position + ' #' + (pl.depth_chart_order || '?') : null,
        last_games: games,
    };
}

// ── Who gets reviewed ─────────────────────────────────────────────────
function select(lock, mode, limit, now) {
    const half = lock.scorings.half.players;
    const started = (T) => lock.kickoffs && lock.kickoffs[T] && new Date(lock.kickoffs[T]) <= now;
    let rows = Object.entries(lock.players)
        .map(([pid, m]) => ({ pid, m, r: half[pid] }))
        .filter(x => x.r && !started(x.m.team));
    // zeroed by the model while Sleeper still plays him: usually a stale injury tag
    const zeroed = rows.filter(x => x.r[0] <= 0.5 && x.r[1] >= 8).sort((a, b) => b.r[1] - a.r[1]);
    rows = rows.filter(x => x.r[0] > 0.5);
    const byPos = (p) => rows.filter(x => x.m.pos === p).sort((a, b) => b.r[0] - a.r[0]);
    const gap = (x) => x.r[1] != null ? x.r[0] - x.r[1] : 0;
    const pick = new Map();
    const add = (x) => { if (x && !pick.has(x.pid) && pick.size < limit) pick.set(x.pid, x); };
    if (mode === 'test') {
        // the case that started this: the biggest projection over Sleeper
        rows.slice().sort((a, b) => gap(b) - gap(a)).slice(0, 3).forEach(add);
        const quota = { QB: 2, RB: 3, WR: 3, TE: 2, K: 1, DL: 2, LB: 1, DB: 1 };
        for (const [p, n] of Object.entries(quota)) byPos(p).slice(0, n).forEach(add);
        rows.filter(x => x.m.inj).sort((a, b) => b.r[0] - a.r[0]).slice(0, 3).forEach(add);
        zeroed.slice(0, 2).forEach(add);
        rows.slice().sort((a, b) => gap(a) - gap(b)).forEach(add);
    } else if (mode === 'flagged') {
        zeroed.forEach(add);
        rows.filter(x => x.m.inj || Math.abs(gap(x)) >= 3).sort((a, b) => Math.abs(gap(b)) - Math.abs(gap(a))).forEach(add);
    } else {
        // the fantasy-relevant pool: top of each position
        const quota = { QB: 32, RB: 50, WR: 70, TE: 30, K: 20, DL: 16, LB: 16, DB: 16 };
        for (const [p, n] of Object.entries(quota)) byPos(p).slice(0, n).forEach(add);
    }
    return [...pick.values()];
}

function costOf(u, batch) {
    const m = batch ? 0.5 : 1;
    return m * ((u.input_tokens || 0) * PRICE.input + (u.output_tokens || 0) * PRICE.output
        + (u.cache_creation_input_tokens || 0) * PRICE.cacheWrite + (u.cache_read_input_tokens || 0) * PRICE.cacheRead) / 1e6;
}
function readVerdict(message) {
    if (!message || message.stop_reason === 'refusal') return null;
    const text = (message.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
    try { return JSON.parse(text); } catch (e) { return null; }
}
// Guard rails on what the analyst can do to a number: out_risk may take
// him to zero; otherwise the adjusted number stays within half and one
// and a half times the model's (a typo can't turn 12 into 120). A player
// the model zeroed can be brought back only as far as Sleeper's number.
function settle(v, model, sleeper) {
    if (!v || !isFinite(Number(v.adjusted))) return null;
    let adj = Math.max(0, Number(v.adjusted));
    const hi = model >= 1 ? model * 1.5 + 1 : Math.max(1, sleeper || 0);
    if (v.verdict !== 'out_risk') adj = Math.min(hi, Math.max(model * 0.5, adj));
    if (v.verdict === 'keep') adj = model;
    return { adj: r1(adj), verdict: v.verdict, conf: v.confidence, note: String(v.fingerprint || '').slice(0, 400), reasons: (v.reasons || []).slice(0, 3).map(s => String(s).slice(0, 80)) };
}

async function main() {
    const state = await J(SL + '/state/nfl');
    const season = Number(state.season), week = Number(argVal('--week', state.week));
    const lock = await readJson(path.join(ROOT, 'data/locks/' + season + '-w' + week + '.json'), null);
    if (!lock) throw new Error('no lock sheet for week ' + week);
    const now = new Date();
    const month = now.toISOString().slice(0, 7);
    const ledgerPath = path.join(ROOT, 'data/ai/spend-' + month + '.json');
    const ledger = await readJson(ledgerPath, { month, cap: MONTH_CAP, spent: 0, runs: [] });
    if (!DRY && ledger.spent >= MONTH_CAP) { console.log('Monthly AI budget reached ($' + ledger.spent.toFixed(2) + ' of $' + MONTH_CAP + '); skipping.'); return; }

    const [espn, players, ...weeks] = await Promise.all([espnReports(), J(SL + '/players/nfl'), ...[1, 2, 3].map(k => week - k).filter(w => w >= 1).map(w => J(SL + '/stats/nfl/regular/' + season + '/' + w).then(s => ({ week: w, s })))]);
    const scoring = lock.scorings.half.scoring;
    const picks = select(lock, MODE, LIMIT, now);
    const jobs = picks.map(x => {
        const pl = players[x.pid] || {};
        const recent = weeks.sort((a, b) => b.week - a.week).map(w => ({ week: w.week, stats: w.s && w.s[x.pid], scoring }));
        return { pid: x.pid, model: x.r[0], d: dossier(x.pid, x.m, x.r, pl, recent, week, espn[nameKey(pl.full_name, x.m.team)]) };
    });
    const request = (j) => ({ model: MODEL, max_tokens: 700, system: SYSTEM, output_config: { format: { type: 'json_schema', schema: SCHEMA } }, messages: [{ role: 'user', content: 'Dossier:\n' + JSON.stringify(j.d) }] });
    console.log('week ' + week + ' · mode ' + MODE + ' · ' + jobs.length + ' players · budget $' + ledger.spent.toFixed(2) + ' of $' + MONTH_CAP + ' spent this month');
    if (DRY) {
        const chars = jobs.reduce((s, j) => s + JSON.stringify(j.d).length, 0) + jobs.length * SYSTEM.length;
        const estIn = Math.round(chars / 3.6), estOut = jobs.length * 170;
        console.log('dry run: ~' + estIn + ' input tokens, ~' + estOut + ' output tokens · est. $' + costOf({ input_tokens: estIn, output_tokens: estOut }, MODE === 'weekly').toFixed(3));
        for (const j of jobs) console.log('  ' + j.d.player.split(',').slice(0, 3).join(',').padEnd(34) + String(j.d.model_projection).padStart(6) + ' vs Sleeper ' + String(j.d.sleeper_projection).padStart(5) + (j.d.latest_report ? '  ESPN ' + j.d.latest_report.status + ' ' + j.d.latest_report.date : ''));
        if (args.includes('--show')) console.log(JSON.stringify(jobs[0].d, null, 1));
        return;
    }

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic();
    const outPath = path.join(ROOT, 'data/ai/' + season + '-w' + week + '.json');
    const out = await readJson(outPath, { season, week, model: MODEL, players: {} });
    let spent = 0, done = 0, failed = 0;
    const record = (j, msg, batch) => {
        if (msg && msg.usage) spent += costOf(msg.usage, batch);
        const s = settle(readVerdict(msg), j.model, j.d.sleeper_projection);
        if (!s) { failed++; return; }
        out.players[j.pid] = Object.assign({ math: j.model, sleeper: j.d.sleeper_projection, t: new Date().toISOString(), mode: MODE }, s);
        done++;
    };
    if (MODE === 'weekly') {
        // Batch API: half price, results within the hour as a rule.
        const batch = await client.messages.batches.create({ requests: jobs.map(j => ({ custom_id: 'p' + j.pid, params: request(j) })) });
        let b = batch;
        for (let i = 0; i < 180 && b.processing_status !== 'ended'; i++) { await new Promise(r => setTimeout(r, 30000)); b = await client.messages.batches.retrieve(batch.id); }
        const byId = Object.fromEntries(jobs.map(j => ['p' + j.pid, j]));
        for await (const res of await client.messages.batches.results(batch.id)) {
            const j = byId[res.custom_id]; if (!j) continue;
            if (res.result.type === 'succeeded') record(j, res.result.message, true); else failed++;
        }
    } else {
        for (const j of jobs) {
            if (ledger.spent + spent >= MONTH_CAP) { console.log('budget reached mid-run; stopping'); break; }
            try { record(j, await client.messages.create(request(j)), false); }
            catch (e) {
                failed++;
                if (e instanceof Anthropic.AuthenticationError) throw new Error('ANTHROPIC_API_KEY is missing or invalid');
                console.log('  ' + j.pid + ': ' + (e instanceof Anthropic.APIError ? 'API ' + e.status : e.message));
            }
        }
    }
    out.built = new Date().toISOString();
    await mkdir(path.dirname(outPath), { recursive: true });
    await writeFile(outPath, JSON.stringify(out));
    ledger.spent = +(ledger.spent + spent).toFixed(4);
    ledger.runs.push({ t: new Date().toISOString(), week, mode: MODE, players: done, failed, cost: +spent.toFixed(4) });
    await writeFile(ledgerPath, JSON.stringify(ledger, null, 1));
    console.log('reviewed ' + done + ' (failed ' + failed + ') · this run $' + spent.toFixed(4) + ' · month $' + ledger.spent.toFixed(2) + ' of $' + MONTH_CAP);
    for (const [pid, p] of Object.entries(out.players).filter(([, p]) => p.mode === MODE).slice(0, 40)) {
        const pl = players[pid] || {};
        console.log('  ' + (pl.full_name || pid).padEnd(22) + String(p.math).padStart(5) + ' → ' + String(p.adj).padStart(5) + '  ' + p.verdict.padEnd(8) + p.conf.padEnd(7) + p.note);
    }
}
main().catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
