// Inti AI: dua model machine learning yang dilatih langsung di browser dari riwayat candle
// tiap timeframe, lalu diuji walk-forward out-of-sample sebelum boleh ikut memberi suara.
//   A. Logistic regression (L2, Newton-Raphson) — belajar bobot tiap fitur indikator.
//   B. k-Nearest Neighbors "analog pasar" — mencari kondisi historis paling mirip.
// Target: apakah close H bar ke depan lebih tinggi dari close sekarang.
import * as I from './indicators.js';
import { asofCloses } from './candles.js';

const fin = Number.isFinite;
export const HORIZON_BARS = 5;
export const MIN_SAMPLES = 150;

// Nama fitur (urutan = kolom matriks). Semua kausal: hanya memakai data sampai bar i.
export const FEATURES = [
  ['px_ema21', 'Jarak harga–EMA21 (ATR)'],
  ['ema9_21', 'EMA9 − EMA21 (ATR)'],
  ['ema21_50', 'EMA21 − EMA50 (ATR)'],
  ['px_sma20', 'Jarak harga–SMA20 (ATR)'],
  ['sma20_50', 'SMA20 − SMA50 (ATR)'],
  ['hma9_slope', 'Kemiringan Hull MA 9'],
  ['hma21_slope', 'Kemiringan Hull MA 21'],
  ['supertrend', 'Arah SuperTrend'],
  ['psar', 'Arah Parabolic SAR'],
  ['adx_dir', 'ADX × arah DMI'],
  ['aroon', 'Aroon up − down'],
  ['linreg', 'Slope regresi linear'],
  ['donchian', 'Posisi Donchian'],
  ['tenkan_kijun', 'Tenkan − Kijun (ATR)'],
  ['heikin', 'Warna Heikin Ashi 3 bar'],
  ['rsi', 'RSI'],
  ['macd_hist', 'Histogram MACD (ATR)'],
  ['stoch', 'Stochastic %K'],
  ['stochrsi', 'Stoch RSI %K'],
  ['cci', 'CCI'],
  ['willr', 'Williams %R'],
  ['mom', 'Momentum 10 (ATR)'],
  ['ao', 'Awesome Oscillator (ATR)'],
  ['uo', 'Ultimate Oscillator'],
  ['bb_pctb', 'Bollinger %B'],
  ['bb_width', 'Lebar Bollinger'],
  ['atr_pct', 'Volatilitas ATR %'],
  ['vwap_z', 'Jarak harga–VWAP (σ)'],
  ['vwma', 'Jarak harga–VWMA (ATR)'],
  ['obv', 'Slope OBV'],
  ['adl', 'Slope A/D Line'],
  ['cvd', 'Slope CVD'],
  ['mfi', 'Money Flow Index'],
  ['cmf', 'Chaikin Money Flow'],
  ['volosc', 'Volume Oscillator'],
  ['ret1', 'Return 1 bar (ATR)'],
  ['ret5', 'Return 5 bar (ATR)'],
  ['anti_dxy5', 'Return anti-DXY 5 bar'],
  ['hour_sin', 'Jam sesi (sin)'],
  ['hour_cos', 'Jam sesi (cos)'],
];

// Return 5 bar instrumen pembanding yang diselaraskan as-of ke bar emas.
export function fxReturns(times, fxCandles, lag = 5, tolMs = Infinity) {
  const closes = asofCloses(times.map((t) => ({ t })), fxCandles || [], tolMs);
  return closes.map((c, i) => (i >= lag && c > 0 && closes[i - lag] > 0 ? Math.log(c / closes[i - lag]) : NaN));
}

/**
 * Matriks fitur untuk semua bar.
 * @param s seri toSeries(); @param ind hasil computeIndicatorSet()
 * @param fx { candles, sign } — candle DXY (sign −1) atau EURUSD (sign +1) timeframe sama → fitur "anti-DXY"
 * @returns {{rows: (number[]|null)[]}} rows[i] = vektor fitur atau null bila warm-up belum cukup
 */
export function featureMatrix(s, ind, fx = { candles: [], sign: 1 }, intraday = true) {
  const n = s.c.length;
  const fxRet = fxReturns(s.t, fx.candles, 5, fx.tolMs ?? Infinity);
  const fxVals = fxRet.filter(fin);
  const fxStd = fxVals.length > 10 ? Math.sqrt(fxVals.reduce((a, v) => a + v * v, 0) / fxVals.length) || 1 : 1;
  const vol = ind.vol;
  const rows = new Array(n).fill(null);
  for (let i = 6; i < n; i++) {
    const atr = ind.atr[i];
    const c = s.c[i];
    if (!(atr > 0)) continue;
    const hour = new Date(s.t[i]).getUTCHours() + new Date(s.t[i]).getUTCMinutes() / 60;
    const hasVol = s.v[i] > 0;
    const haSum = [0, 1, 2].reduce((a, k) => a + Math.sign(ind.ha.close[i - k] - ind.ha.open[i - k]), 0);
    const fr = fxRet[i];
    const vsd = ind.vwap.sd[i];
    const row = [
      (c - ind.ema21[i]) / atr,
      (ind.ema9[i] - ind.ema21[i]) / atr,
      (ind.ema21[i] - ind.ema50[i]) / atr,
      (c - ind.sma20[i]) / atr,
      (ind.sma20[i] - ind.sma50[i]) / atr,
      (ind.hma9[i] - ind.hma9[i - 1]) / atr,
      (ind.hma21[i] - ind.hma21[i - 1]) / atr,
      ind.st.dir[i],
      ind.ps.dir[i],
      Math.sign(ind.dmi.plus[i] - ind.dmi.minus[i]) * (ind.dmi.adx[i] / 50),
      (ind.aroon.up[i] - ind.aroon.down[i]) / 100,
      (ind.slope[i] * 20) / atr,
      (c - ind.dc.mid[i]) / ((ind.dc.upper[i] - ind.dc.lower[i]) / 2 || atr),
      (ind.ich.tenkan[i] - ind.ich.kijun[i]) / atr,
      haSum / 3,
      (ind.rsi[i] - 50) / 20,
      ind.macd.hist[i] / atr,
      (ind.stoch.k[i] - 50) / 50,
      (ind.stochRsi.k[i] - 50) / 50,
      ind.cci[i] / 150,
      (ind.willr[i] + 50) / 50,
      ind.mom[i] / atr,
      ind.ao[i] / atr,
      (ind.uo[i] - 50) / 20,
      ind.bb.percentB[i] - 0.5,
      ind.bb.width[i] * 100,
      (atr / c) * 100,
      vsd > 0 ? (c - ind.vwap.vwap[i]) / vsd : 0,
      hasVol && fin(ind.vwma[i]) ? (c - ind.vwma[i]) / atr : 0,
      hasVol && fin(vol.obvNorm[i]) ? vol.obvNorm[i] : 0,
      hasVol && fin(vol.adlNorm[i]) ? vol.adlNorm[i] : 0,
      hasVol && fin(vol.cvdNorm[i]) ? vol.cvdNorm[i] : 0,
      hasVol && fin(vol.mfi[i]) ? (vol.mfi[i] - 50) / 50 : 0,
      hasVol && fin(vol.cmf[i]) ? vol.cmf[i] * 5 : 0,
      hasVol && fin(vol.volOsc[i]) ? Math.tanh(vol.volOsc[i] / 50) : 0,
      Math.log(c / s.c[i - 1]) / (atr / c),
      Math.log(c / s.c[i - 5]) / (atr / c),
      fin(fr) ? (fx.sign * fr) / fxStd : 0,
      intraday ? Math.sin((2 * Math.PI * hour) / 24) : 0,
      intraday ? Math.cos((2 * Math.PI * hour) / 24) : 0,
    ];
    if (row.every(fin)) rows[i] = row;
  }
  return { rows };
}

// Dataset berlabel: fitur bar i → apakah close[i+H] > close[i]. Bar live (terakhir) tidak dipakai.
export function buildDataset(rows, close, H = HORIZON_BARS) {
  const X = [];
  const y = [];
  const fwd = [];
  const idx = [];
  const lastLabeled = close.length - 2 - H; // bar terakhir = live, jangan dipakai sebagai target
  for (let i = 0; i <= lastLabeled; i++) {
    if (!rows[i]) continue;
    const r = Math.log(close[i + H] / close[i]);
    if (!fin(r)) continue;
    X.push(rows[i]);
    y.push(r > 0 ? 1 : 0);
    fwd.push(r);
    idx.push(i);
  }
  return { X, y, fwd, idx };
}

export function fitScaler(X) {
  const d = X[0]?.length || 0;
  const mean = new Array(d).fill(0);
  const std = new Array(d).fill(0);
  for (const row of X) for (let j = 0; j < d; j++) mean[j] += row[j] / X.length;
  for (const row of X) for (let j = 0; j < d; j++) std[j] += (row[j] - mean[j]) ** 2 / X.length;
  for (let j = 0; j < d; j++) std[j] = Math.sqrt(std[j]) || 1;
  return { mean, std };
}

export function scale(row, sc, clip = 5) {
  return row.map((v, j) => Math.max(-clip, Math.min(clip, (v - sc.mean[j]) / sc.std[j])));
}

export const sigmoid = (z) => 1 / (1 + Math.exp(-Math.max(-35, Math.min(35, z))));

// Eliminasi Gauss dengan pivot parsial: menyelesaikan A x = b (A dimodifikasi).
export function solve(A, b) {
  const n = b.length;
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
    if (Math.abs(A[piv][col]) < 1e-12) return null;
    [A[col], A[piv]] = [A[piv], A[col]];
    [b[col], b[piv]] = [b[piv], b[col]];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / A[col][col];
      if (!f) continue;
      for (let k = col; k < n; k++) A[r][k] -= f * A[col][k];
      b[r] -= f * b[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r];
    for (let k = r + 1; k < n; k++) s -= A[r][k] * x[k];
    x[r] = s / A[r][r];
  }
  return x;
}

// Logistic regression L2 via Newton-Raphson. Xs sudah diskalakan. w[0] = bias (tidak diregularisasi).
export function trainLogistic(Xs, y, { l2 = 4, iters = 20 } = {}) {
  const d = (Xs[0]?.length || 0) + 1;
  let w = new Array(d).fill(0);
  for (let it = 0; it < iters; it++) {
    const g = new Array(d).fill(0);
    const H = Array.from({ length: d }, () => new Array(d).fill(0));
    for (let i = 0; i < Xs.length; i++) {
      const x = [1, ...Xs[i]];
      let z = 0;
      for (let j = 0; j < d; j++) z += w[j] * x[j];
      const p = sigmoid(z);
      const s = Math.max(p * (1 - p), 1e-6);
      for (let j = 0; j < d; j++) {
        g[j] += (p - y[i]) * x[j];
        const sx = s * x[j];
        for (let k = j; k < d; k++) H[j][k] += sx * x[k];
      }
    }
    for (let j = 0; j < d; j++) {
      for (let k = 0; k < j; k++) H[j][k] = H[k][j];
      if (j > 0) { g[j] += l2 * w[j]; H[j][j] += l2; }
    }
    const step = solve(H, g);
    if (!step) break;
    w = w.map((v, j) => v - step[j]);
    if (Math.max(...step.map(Math.abs)) < 1e-6) break;
  }
  return { w };
}

export function predictLogistic(model, xs) {
  let z = model.w[0];
  for (let j = 0; j < xs.length; j++) z += model.w[j + 1] * xs[j];
  return sigmoid(z);
}

// k-NN analog: rata-rata tertimbang jarak dari k kondisi historis paling mirip (dengan smoothing Laplace).
export function knnPredict(trainXs, trainY, trainFwd, xs, k) {
  const dists = new Array(trainXs.length);
  for (let i = 0; i < trainXs.length; i++) {
    const row = trainXs[i];
    let d = 0;
    for (let j = 0; j < xs.length; j++) {
      const diff = row[j] - xs[j];
      d += diff * diff;
    }
    dists[i] = [d, i];
  }
  dists.sort((a, b) => a[0] - b[0]);
  const top = dists.slice(0, Math.min(k, dists.length));
  let up = 1;
  let tot = 2;
  let ret = 0;
  let wsum = 0;
  for (const [d, i] of top) {
    const w = 1 / (Math.sqrt(d) + 0.5);
    up += w * trainY[i];
    tot += w;
    ret += w * trainFwd[i];
    wsum += w;
  }
  return { p: up / tot, avgFwd: wsum ? ret / wsum : 0, neighbors: top.map(([, i]) => i) };
}

export function brier(ps, y) {
  return ps.reduce((a, p, i) => a + (p - y[i]) ** 2, 0) / ps.length;
}

export function metrics(ps, y, baseRate) {
  const n = ps.length;
  if (!n) return null;
  const acc = ps.filter((p, i) => (p > 0.5 ? 1 : 0) === y[i]).length / n;
  const b = brier(ps, y);
  const ref = y.reduce((a, v) => a + (baseRate - v) ** 2, 0) / n;
  const confIdx = ps.map((p, i) => [p, i]).filter(([p]) => Math.abs(p - 0.5) >= 0.1);
  const confAcc = confIdx.length ? confIdx.filter(([p, i]) => (p > 0.5 ? 1 : 0) === y[i]).length / confIdx.length : null;
  const majority = Math.max(baseRate, 1 - baseRate);
  return { n, accuracy: acc, brier: b, bss: ref ? 1 - b / ref : 0, confAccuracy: confAcc, confN: confIdx.length, majority };
}

// Seberapa layak AI dipercaya (0..1) berdasarkan skill out-of-sample.
export function reliability(m) {
  if (!m || m.n < 60) return 0;
  const byBss = m.bss / 0.03;
  const byAcc = (m.accuracy - Math.max(0.5, m.majority)) / 0.05;
  return Math.max(0, Math.min(1, Math.max(byBss, byAcc)));
}

/**
 * Latih + uji walk-forward, lalu latih ulang di seluruh data berlabel untuk prediksi live.
 * @returns model siap pakai atau { error }
 */
export function trainModel(rows, close, { H = HORIZON_BARS, split = 0.7 } = {}) {
  const ds = buildDataset(rows, close, H);
  if (ds.X.length < MIN_SAMPLES) return { error: `sampel ${ds.X.length} < ${MIN_SAMPLES}`, samples: ds.X.length };
  const cut = Math.floor(ds.X.length * split);
  // Celah H sampel supaya target train tidak tumpang tindih dengan fitur test.
  const trainEnd = Math.max(0, cut - H);
  const trX = ds.X.slice(0, trainEnd);
  const trY = ds.y.slice(0, trainEnd);
  const trF = ds.fwd.slice(0, trainEnd);
  const teX = ds.X.slice(cut);
  const teY = ds.y.slice(cut);
  const sc = fitScaler(trX);
  const trXs = trX.map((r) => scale(r, sc));
  const teXs = teX.map((r) => scale(r, sc));
  const base = trY.reduce((a, v) => a + v, 0) / trY.length;
  const k = Math.max(15, Math.round(Math.sqrt(trXs.length)));
  const logit = trainLogistic(trXs, trY);
  const pL = teXs.map((x) => predictLogistic(logit, x));
  const pK = teXs.map((x) => knnPredict(trXs, trY, trF, x, k).p);
  const mL = metrics(pL, teY, base);
  const mK = metrics(pK, teY, base);
  const wl = Math.max(mL.bss, 0) + 0.01;
  const wk = Math.max(mK.bss, 0) + 0.01;
  const mix = { logit: wl / (wl + wk), knn: wk / (wl + wk) };
  const pE = pL.map((p, i) => mix.logit * p + mix.knn * pK[i]);
  const mE = metrics(pE, teY, base);

  // Model final: seluruh data berlabel.
  const scAll = fitScaler(ds.X);
  const allXs = ds.X.map((r) => scale(r, scAll));
  const finalLogit = trainLogistic(allXs, ds.y);
  return {
    H,
    samples: ds.X.length,
    trainN: trXs.length,
    testN: teXs.length,
    baseRate: ds.y.reduce((a, v) => a + v, 0) / ds.y.length,
    scaler: scAll,
    logit: finalLogit,
    knn: { Xs: allXs, y: ds.y, fwd: ds.fwd, idx: ds.idx, k: Math.max(15, Math.round(Math.sqrt(allXs.length))) },
    mix,
    oos: { logit: mL, knn: mK, ensemble: mE },
    reliability: reliability(mE),
  };
}

// Prediksi untuk vektor fitur terbaru + penjelasan (kontribusi fitur & analog historis).
export function predict(model, row, times = []) {
  if (!model || model.error || !row) return null;
  const xs = scale(row, model.scaler);
  const pL = predictLogistic(model.logit, xs);
  const kn = knnPredict(model.knn.Xs, model.knn.y, model.knn.fwd, xs, model.knn.k);
  const p = model.mix.logit * pL + model.mix.knn * kn.p;
  const contributions = FEATURES.map(([id, name], j) => ({ id, name, weight: model.logit.w[j + 1], value: xs[j], impact: model.logit.w[j + 1] * xs[j] }))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact));
  const importance = FEATURES.map(([id, name], j) => ({ id, name, weight: model.logit.w[j + 1] }))
    .sort((a, b) => Math.abs(b.weight) - Math.abs(a.weight));
  const analogs = kn.neighbors.slice(0, 5).map((i) => ({ t: times[model.knn.idx[i]] ?? null, up: model.knn.y[i] === 1, fwd: model.knn.fwd[i] }));
  const upShare = kn.neighbors.filter((i) => model.knn.y[i] === 1).length / (kn.neighbors.length || 1);
  return {
    p,
    pLogit: pL,
    pKnn: kn.p,
    vote: I.clamp((p - 0.5) * 2),
    reliability: model.reliability,
    analogUpShare: upShare,
    analogAvgFwdPct: kn.avgFwd * 100,
    contributions: contributions.slice(0, 6),
    importance: importance.slice(0, 8),
    analogs,
  };
}
