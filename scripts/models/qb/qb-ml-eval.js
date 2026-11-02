// DHQ stand-alone QB model (qb-ml compact): evaluate the exported LightGBM component boosters (linear-tree leaves) and
// turn them into the shown typical number (median), the average week and a full stat line. No dependencies.
// model = JSON from qb_ml_compact_<season>.json; x = {featureName: number|null} (null / NaN = missing).
function treeOut(T, v) {
  let n = 0;
  while (!T.leaf[n]) {
    let xv = v[T.f[n]]; const mt = T.mt[n], miss = Number.isNaN(xv);
    if ((mt === 2 && miss) || (mt === 1 && (miss || xv === 0))) n = T.dl[n] ? T.l[n] : T.r[n];
    else { if (miss) xv = 0; n = xv <= T.t[n] ? T.l[n] : T.r[n]; }
  }
  const lf = T.lf[n];
  if (lf && lf.length) {   // linear leaf: const + coef . x (any missing input -> plain leaf value)
    let s = T.lc[n];
    for (let i = 0; i < lf.length; i++) { const z = v[lf[i]]; if (Number.isNaN(z)) return T.v[n]; s += T.lk[n][i] * z; }
    return s;
  }
  return T.lc[n] ?? T.v[n];
}
function qbMlPredict(model, x) {
  const v = model.features.map(f => (x[f] === null || x[f] === undefined || Number.isNaN(+x[f])) ? NaN : +x[f]);
  const raw = {};
  for (const [c, C] of Object.entries(model.components)) {
    let acc = 0;
    for (const trees of C.boosters) { let s = 0; for (const T of trees) s += treeOut(T, v); acc += C.link === 'exp' ? Math.exp(s) : s; }
    raw[c] = acc / C.boosters.length;
  }
  const W = model.points_weights; let meanRaw = 0, mean = 0; const E = {};
  for (const c in raw) {
    const k = model.calibration[c] || {}; E[c] = 'add' in k ? raw[c] + k.add : raw[c] * (k.mult ?? 1);
  }
  for (const c in W) { meanRaw += W[c] * raw[c]; mean += W[c] * E[c]; }
  return {
    pred: meanRaw + model.median_shift, pred_mean: mean, raw,
    stat: { E_pass_yd: E.pyd, E_pass_td: E.ptd, E_int: E.int, E_sack: E.sk, E_rush_yd: E.ryd, E_rush_td: E.rtd, E_fum: E.fl,
      E_pass_fd: E.pfd, E_rush_fd: E.rfd, E_2pt: E.p2, E_rec_pts: E.rec },
  };
}
if (typeof module !== 'undefined') module.exports = { qbMlPredict };
