// Scorecard for backtest-projections.mjs runs.
//
//   node scripts/compare-backtests.mjs base rb-nocut rb-k30     # variants to compare
//   node scripts/compare-backtests.mjs --min 12 base ...          # starters only
//
// For every variant and position: how far the shown number (typical week)
// and the average week sit from what happened (bias), how far off they are
// on average (MAE), and how often each beats Sleeper's line on the same
// player-week. Rows: Sleeper line >= --min (default 8) and the player played.
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(ROOT, 'scripts/.backtest-out');
const args = process.argv.slice(2);
const flag = (k, d) => { const i = args.indexOf(k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const MIN = Number(flag('--min', 8));
const WEEKS = flag('--weeks', null); // e.g. 4-5
const wRange = WEEKS ? WEEKS.split('-').map(Number) : null;
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--min' && args[i - 1] !== '--weeks');
const POSN = ['QB', 'RB', 'WR', 'TE'];

async function load(name) {
    const dir = path.join(OUT, name);
    const files = (await readdir(dir)).filter(f => /^w\d+\.json$/.test(f)).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)));
    const rows = [];
    for (const f of files) { const j = JSON.parse(await readFile(path.join(dir, f), 'utf8')); for (const r of j.rows) rows.push({ ...r, week: j.week }); }
    return rows.filter(r => POSN.includes(r.pos) && r.played && r.sleeper != null && r.sleeper >= MIN && r.actual != null && (!wRange || (r.week >= wRange[0] && r.week <= (wRange[1] || wRange[0]))));
}
const f1 = (n) => (n >= 0 ? '+' : '') + n.toFixed(2);
function card(rows) {
    const n = rows.length; if (!n) return null;
    const m = (k) => rows.reduce((a, r) => a + r[k], 0) / n;
    const mae = (k) => rows.reduce((a, r) => a + Math.abs(r[k] - r.actual), 0) / n;
    const wins = (k) => rows.filter(r => Math.abs(r[k] - r.actual) < Math.abs(r.sleeper - r.actual)).length;
    return { n, bias: f1(m('median') - m('actual')), biasAvg: f1(m('mean') - m('actual')), biasSlp: f1(m('sleeper') - m('actual')),
        mae: mae('median').toFixed(2), maeAvg: mae('mean').toFixed(2), maeSlp: mae('sleeper').toFixed(2), beatsSlp: Math.round(100 * wins('median') / n) + '%' };
}
async function main() {
    if (!names.length) { console.error('usage: node scripts/compare-backtests.mjs [--min 8] <name> [<name> ...]'); process.exit(2); }
    const all = {};
    for (const nm of names) all[nm] = await load(nm);
    for (const pos of POSN) {
        console.log('\n' + pos + '  (Sleeper line >= ' + MIN + ', played)');
        console.log('  variant'.padEnd(22) + 'n'.padStart(5) + '  bias  biasAvg  Sleeper |   MAE  MAEavg Sleeper | beats Sleeper');
        for (const nm of names) {
            const c = card(all[nm].filter(r => r.pos === pos)); if (!c) continue;
            console.log('  ' + nm.padEnd(20) + String(c.n).padStart(5) + ' ' + c.bias.padStart(6) + ' ' + c.biasAvg.padStart(7) + ' ' + c.biasSlp.padStart(8) + ' | ' + c.mae.padStart(5) + ' ' + c.maeAvg.padStart(7) + ' ' + c.maeSlp.padStart(7) + ' | ' + c.beatsSlp.padStart(6));
        }
    }
    // the same player-weeks in every variant? say so if not
    const sizes = names.map(nm => all[nm].length);
    if (new Set(sizes).size > 1) console.log('\nnote: variants graded different row counts ' + JSON.stringify(Object.fromEntries(names.map((nm, i) => [nm, sizes[i]]))));
}
main().catch(err => { console.error(err.stack || err.message || err); process.exit(1); });
