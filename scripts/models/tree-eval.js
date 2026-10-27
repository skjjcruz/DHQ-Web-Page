// DHQ WR median model: evaluate the exported gradient-boosted trees in the browser (no dependencies).
// model = JSON from wr_median_*.json; x = {featureName: number|null|undefined} (null/NaN = missing).
function wrTreePredict(model, x) {
  const v = model.features.map(f => (x[f] === null || x[f] === undefined || Number.isNaN(+x[f])) ? NaN : +x[f]);
  let s = model.base;
  for (const t of model.trees) {
    let n = 0;
    while (!t.leaf[n]) {
      const xv = v[t.f[n]];
      n = Number.isNaN(xv) ? (t.m[n] ? t.l[n] : t.r[n]) : (xv <= t.t[n] ? t.l[n] : t.r[n]);
    }
    s += t.v[n];
  }
  return Math.max(model.clip_min ?? -Infinity, s);
}
if (typeof module !== 'undefined') module.exports = { wrTreePredict };
