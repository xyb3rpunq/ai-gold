// Indikator teknikal murni: array angka masuk, array angka keluar (sejajar, NaN saat warm-up).
// Rumus mengikuti definisi Pine Script TradingView supaya bisa divalidasi silang
// terhadap nilai scanner TradingView pada simbol BINANCE:XAUUSDT.P.

export const nans = (n) => new Array(n).fill(NaN);
const fin = Number.isFinite;
export const clamp = (x, lo = -1, hi = 1) => (fin(x) ? Math.min(hi, Math.max(lo, x)) : NaN);
export const last = (arr, back = 0) => arr[arr.length - 1 - back];

export function sma(src, n) {
  const out = nans(src.length);
  let sum = 0;
  let valid = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (fin(v)) { sum += v; valid++; }
    if (i >= n) {
      const o = src[i - n];
      if (fin(o)) { sum -= o; valid--; }
    }
    if (i >= n - 1 && valid === n) out[i] = sum / n;
  }
  return out;
}

// Rata-rata eksponensial dengan benih SMA dari n nilai valid pertama.
function smoothed(src, n, alpha) {
  const out = nans(src.length);
  let prev = NaN;
  let run = 0;
  let sum = 0;
  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    if (!fin(v)) {
      if (fin(prev)) out[i] = prev;
      else { run = 0; sum = 0; }
      continue;
    }
    if (!fin(prev)) {
      run++;
      sum += v;
      if (run === n) { prev = sum / n; out[i] = prev; }
    } else {
      prev = alpha * v + (1 - alpha) * prev;
      out[i] = prev;
    }
  }
  return out;
}

export const ema = (src, n) => smoothed(src, n, 2 / (n + 1));
export const rma = (src, n) => smoothed(src, n, 1 / n);

export function wma(src, n) {
  const out = nans(src.length);
  const denom = (n * (n + 1)) / 2;
  for (let i = n - 1; i < src.length; i++) {
    let s = 0;
    let ok = true;
    for (let k = 0; k < n; k++) {
      const v = src[i - k];
      if (!fin(v)) { ok = false; break; }
      s += v * (n - k);
    }
    if (ok) out[i] = s / denom;
  }
  return out;
}

export function hma(src, n) {
  const half = wma(src, Math.floor(n / 2));
  const full = wma(src, n);
  const diff = half.map((v, i) => 2 * v - full[i]);
  return wma(diff, Math.floor(Math.sqrt(n)));
}

export function vwma(src, vol, n) {
  const pv = sma(src.map((v, i) => v * vol[i]), n);
  const vv = sma(vol, n);
  return pv.map((v, i) => (vv[i] ? v / vv[i] : NaN));
}

// Simpangan baku populasi (ta.stdev TradingView).
export function stdev(src, n) {
  const out = nans(src.length);
  const mean = sma(src, n);
  for (let i = n - 1; i < src.length; i++) {
    if (!fin(mean[i])) continue;
    let s = 0;
    for (let k = 0; k < n; k++) s += (src[i - k] - mean[i]) ** 2;
    out[i] = Math.sqrt(s / n);
  }
  return out;
}

export function highest(src, n) {
  const out = nans(src.length);
  for (let i = n - 1; i < src.length; i++) {
    let m = -Infinity;
    for (let k = 0; k < n; k++) m = Math.max(m, src[i - k]);
    out[i] = m;
  }
  return out;
}

export function lowest(src, n) {
  const out = nans(src.length);
  for (let i = n - 1; i < src.length; i++) {
    let m = Infinity;
    for (let k = 0; k < n; k++) m = Math.min(m, src[i - k]);
    out[i] = m;
  }
  return out;
}

export function rsi(close, n = 14) {
  const up = nans(close.length);
  const dn = nans(close.length);
  for (let i = 1; i < close.length; i++) {
    const d = close[i] - close[i - 1];
    up[i] = Math.max(d, 0);
    dn[i] = Math.max(-d, 0);
  }
  const ru = rma(up, n);
  const rd = rma(dn, n);
  return ru.map((u, i) => {
    const d = rd[i];
    if (!fin(u) || !fin(d)) return NaN;
    if (d === 0) return 100;
    if (u === 0) return 0;
    return 100 - 100 / (1 + u / d);
  });
}

export function macd(close, fast = 12, slow = 26, signal = 9) {
  const f = ema(close, fast);
  const s = ema(close, slow);
  const line = f.map((v, i) => v - s[i]);
  const sig = ema(line, signal);
  const hist = line.map((v, i) => v - sig[i]);
  return { line, signal: sig, hist };
}

export function stoch(high, low, close, kLen = 14, kSmooth = 3, dSmooth = 3) {
  const hh = highest(high, kLen);
  const ll = lowest(low, kLen);
  const raw = close.map((c, i) => {
    const r = hh[i] - ll[i];
    if (!fin(r)) return NaN;
    return r === 0 ? 50 : (100 * (c - ll[i])) / r;
  });
  const k = sma(raw, kSmooth);
  const d = sma(k, dSmooth);
  return { k, d };
}

export function stochRsi(close, rsiLen = 14, stochLen = 14, kSmooth = 3, dSmooth = 3) {
  const r = rsi(close, rsiLen);
  return stoch(r, r, r, stochLen, kSmooth, dSmooth);
}

export function cci(high, low, close, n = 20) {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const ma = sma(tp, n);
  return tp.map((v, i) => {
    if (!fin(ma[i])) return NaN;
    let dev = 0;
    for (let k = 0; k < n; k++) dev += Math.abs(tp[i - k] - ma[i]);
    dev /= n;
    return dev === 0 ? 0 : (v - ma[i]) / (0.015 * dev);
  });
}

export function williamsR(high, low, close, n = 14) {
  const hh = highest(high, n);
  const ll = lowest(low, n);
  return close.map((c, i) => {
    const r = hh[i] - ll[i];
    if (!fin(r)) return NaN;
    if (r === 0) return -50;
    const v = (-100 * (hh[i] - c)) / r;
    return v === 0 ? 0 : v; // hindari −0
  });
}

export function roc(close, n = 10) {
  return close.map((c, i) => (i >= n && close[i - n] ? (100 * (c - close[i - n])) / close[i - n] : NaN));
}

export function momentum(close, n = 10) {
  return close.map((c, i) => (i >= n ? c - close[i - n] : NaN));
}

export function trueRange(high, low, close) {
  return high.map((h, i) => {
    if (i === 0) return h - low[i];
    const pc = close[i - 1];
    return Math.max(h - low[i], Math.abs(h - pc), Math.abs(low[i] - pc));
  });
}

export const atr = (high, low, close, n = 14) => rma(trueRange(high, low, close), n);

export function dmi(high, low, close, n = 14, adxSmooth = 14) {
  const len = high.length;
  const plusDM = nans(len);
  const minusDM = nans(len);
  for (let i = 1; i < len; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    plusDM[i] = up > down && up > 0 ? up : 0;
    minusDM[i] = down > up && down > 0 ? down : 0;
  }
  const tr = trueRange(high, low, close);
  tr[0] = NaN;
  const trur = rma(tr, n);
  const plus = rma(plusDM, n).map((v, i) => (100 * v) / trur[i]);
  const minus = rma(minusDM, n).map((v, i) => (100 * v) / trur[i]);
  const dx = plus.map((p, i) => {
    const s = p + minus[i];
    if (!fin(s)) return NaN;
    return s === 0 ? 0 : (100 * Math.abs(p - minus[i])) / s;
  });
  return { plus, minus, adx: rma(dx, adxSmooth) };
}

export function aroon(high, low, n = 25) {
  const len = high.length;
  const up = nans(len);
  const down = nans(len);
  for (let i = n; i < len; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    let hiAgo = 0;
    let loAgo = 0;
    for (let k = 0; k <= n; k++) {
      if (high[i - k] > hi) { hi = high[i - k]; hiAgo = k; }
      if (low[i - k] < lo) { lo = low[i - k]; loAgo = k; }
    }
    up[i] = (100 * (n - hiAgo)) / n;
    down[i] = (100 * (n - loAgo)) / n;
  }
  return { up, down };
}

export function bollinger(close, n = 20, mult = 2) {
  const basis = sma(close, n);
  const dev = stdev(close, n);
  const upper = basis.map((b, i) => b + mult * dev[i]);
  const lower = basis.map((b, i) => b - mult * dev[i]);
  const percentB = close.map((c, i) => {
    const w = upper[i] - lower[i];
    if (!fin(w)) return NaN;
    return w === 0 ? 0.5 : (c - lower[i]) / w;
  });
  const width = basis.map((b, i) => (b ? (upper[i] - lower[i]) / b : NaN));
  return { basis, upper, lower, percentB, width };
}

export function keltner(high, low, close, n = 20, mult = 2) {
  const basis = ema(close, n);
  const range = ema(trueRange(high, low, close), n);
  return {
    basis,
    upper: basis.map((b, i) => b + mult * range[i]),
    lower: basis.map((b, i) => b - mult * range[i]),
  };
}

export function donchian(high, low, n = 20) {
  const upper = highest(high, n);
  const lower = lowest(low, n);
  return { upper, lower, mid: upper.map((u, i) => (u + lower[i]) / 2) };
}

export function ichimoku(high, low, conv = 9, base = 26, spanB = 52, displacement = 26) {
  const mid = (n) => {
    const hh = highest(high, n);
    const ll = lowest(low, n);
    return hh.map((h, i) => (h + ll[i]) / 2);
  };
  const tenkan = mid(conv);
  const kijun = mid(base);
  const leadA = tenkan.map((t, i) => (t + kijun[i]) / 2);
  const leadB = mid(spanB);
  const off = displacement - 1;
  // Awan yang tergambar di bar i dihitung dari bar i - (displacement - 1).
  const cloudA = leadA.map((_, i) => (i >= off ? leadA[i - off] : NaN));
  const cloudB = leadB.map((_, i) => (i >= off ? leadB[i - off] : NaN));
  return { tenkan, kijun, leadA, leadB, cloudA, cloudB, lag: off };
}

export function supertrend(high, low, close, period = 10, mult = 3) {
  const len = close.length;
  const a = atr(high, low, close, period);
  const line = nans(len);
  const dir = nans(len);
  let upPrev = NaN;
  let dnPrev = NaN;
  let trendPrev = 1;
  for (let i = 0; i < len; i++) {
    if (!fin(a[i])) continue;
    const hl2 = (high[i] + low[i]) / 2;
    let up = hl2 - mult * a[i];
    let dn = hl2 + mult * a[i];
    if (fin(upPrev) && close[i - 1] > upPrev) up = Math.max(up, upPrev);
    if (fin(dnPrev) && close[i - 1] < dnPrev) dn = Math.min(dn, dnPrev);
    // Seperti ta.supertrend: arah dibandingkan dengan pita bar ini, bukan pita bar sebelumnya.
    let trend = trendPrev;
    if (!fin(upPrev)) trend = 1;
    else if (trendPrev === -1) trend = close[i] > dn ? 1 : -1;
    else trend = close[i] < up ? -1 : 1;
    dir[i] = trend;
    line[i] = trend === 1 ? up : dn;
    upPrev = up;
    dnPrev = dn;
    trendPrev = trend;
  }
  return { line, dir };
}

export function psar(high, low, start = 0.02, inc = 0.02, max = 0.2) {
  const len = high.length;
  const sar = nans(len);
  const dir = nans(len);
  if (len < 2) return { sar, dir };
  let up = high[1] >= high[0];
  let af = start;
  let ep = up ? high[1] : low[1];
  let s = up ? low[0] : high[0];
  sar[1] = s;
  dir[1] = up ? 1 : -1;
  for (let i = 2; i < len; i++) {
    s = s + af * (ep - s);
    if (up) {
      s = Math.min(s, low[i - 1], low[i - 2]);
      if (low[i] < s) {
        up = false; s = ep; ep = low[i]; af = start;
      } else if (high[i] > ep) {
        ep = high[i]; af = Math.min(af + inc, max);
      }
    } else {
      s = Math.max(s, high[i - 1], high[i - 2]);
      if (high[i] > s) {
        up = true; s = ep; ep = high[i]; af = start;
      } else if (low[i] < ep) {
        ep = low[i]; af = Math.min(af + inc, max);
      }
    }
    sar[i] = s;
    dir[i] = up ? 1 : -1;
  }
  return { sar, dir };
}

export function obv(close, vol) {
  const out = nans(close.length);
  let acc = 0;
  for (let i = 0; i < close.length; i++) {
    if (i > 0) acc += close[i] > close[i - 1] ? vol[i] : close[i] < close[i - 1] ? -vol[i] : 0;
    out[i] = acc;
  }
  return out;
}

export function mfi(high, low, close, vol, n = 14) {
  const len = close.length;
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const out = nans(len);
  for (let i = n; i < len; i++) {
    let pos = 0;
    let neg = 0;
    for (let k = 0; k < n; k++) {
      const j = i - k;
      const flow = tp[j] * vol[j];
      if (tp[j] > tp[j - 1]) pos += flow;
      else if (tp[j] < tp[j - 1]) neg += flow;
    }
    out[i] = neg === 0 ? 100 : 100 - 100 / (1 + pos / neg);
  }
  return out;
}

export function cmf(high, low, close, vol, n = 20) {
  const mfv = close.map((c, i) => {
    const r = high[i] - low[i];
    return r === 0 ? 0 : (((c - low[i]) - (high[i] - c)) / r) * vol[i];
  });
  const a = sma(mfv, n);
  const b = sma(vol, n);
  return a.map((v, i) => (b[i] ? v / b[i] : NaN));
}

// VWAP ter-anchor + band simpangan baku tertimbang volume.
// `anchor(t)` mengembalikan kunci periode; VWAP di-reset saat kunci berubah.
export function vwap(time, high, low, close, vol, anchor = (t) => Math.floor(t / 86400000)) {
  const len = close.length;
  const mid = nans(len);
  const sd = nans(len);
  let key = null;
  let pv = 0;
  let vv = 0;
  let pv2 = 0;
  for (let i = 0; i < len; i++) {
    const k = anchor(time[i]);
    if (k !== key) { key = k; pv = 0; vv = 0; pv2 = 0; }
    const tp = (high[i] + low[i] + close[i]) / 3;
    const w = vol[i] > 0 ? vol[i] : 0;
    pv += tp * w;
    vv += w;
    pv2 += tp * tp * w;
    if (vv > 0) {
      mid[i] = pv / vv;
      sd[i] = Math.sqrt(Math.max(0, pv2 / vv - mid[i] * mid[i]));
    } else {
      mid[i] = tp;
      sd[i] = 0;
    }
  }
  return {
    vwap: mid,
    sd,
    upper1: mid.map((m, i) => m + sd[i]),
    lower1: mid.map((m, i) => m - sd[i]),
    upper2: mid.map((m, i) => m + 2 * sd[i]),
    lower2: mid.map((m, i) => m - 2 * sd[i]),
  };
}

// ---------------- volume ----------------

// Accumulation/Distribution Line (Chaikin).
export function adl(high, low, close, vol) {
  const out = nans(close.length);
  let acc = 0;
  for (let i = 0; i < close.length; i++) {
    const r = high[i] - low[i];
    const mfm = r === 0 ? 0 : ((close[i] - low[i]) - (high[i] - close[i])) / r;
    acc += mfm * vol[i];
    out[i] = acc;
  }
  return out;
}

export function chaikinOsc(high, low, close, vol, fast = 3, slow = 10) {
  const a = adl(high, low, close, vol);
  const f = ema(a, fast);
  const s = ema(a, slow);
  return f.map((v, i) => v - s[i]);
}

// Volume Price Trend.
export function pvt(close, vol) {
  const out = nans(close.length);
  let acc = 0;
  for (let i = 0; i < close.length; i++) {
    if (i > 0 && close[i - 1]) acc += ((close[i] - close[i - 1]) / close[i - 1]) * vol[i];
    out[i] = acc;
  }
  return out;
}

// Elder Force Index: EMA dari perubahan harga × volume.
export function forceIndex(close, vol, n = 13) {
  const raw = close.map((c, i) => (i ? (c - close[i - 1]) * vol[i] : NaN));
  return ema(raw, n);
}

// Ease of Movement (skala 10.000, rata-rata n).
export function easeOfMovement(high, low, vol, n = 14, divisor = 10000) {
  const raw = high.map((h, i) => {
    if (!i || !vol[i]) return i ? 0 : NaN;
    const dm = (h + low[i]) / 2 - (high[i - 1] + low[i - 1]) / 2;
    return (divisor * dm * (h - low[i])) / vol[i];
  });
  return sma(raw, n);
}

// Klinger Volume Oscillator (34, 55, sinyal 13).
export function klinger(high, low, close, vol, fast = 34, slow = 55, signal = 13) {
  const len = close.length;
  const vf = nans(len);
  for (let i = 1; i < len; i++) {
    const hlc = high[i] + low[i] + close[i];
    const prev = high[i - 1] + low[i - 1] + close[i - 1];
    vf[i] = (hlc > prev ? 1 : -1) * vol[i];
  }
  const f = ema(vf, fast);
  const s = ema(vf, slow);
  const kvo = f.map((v, i) => v - s[i]);
  return { kvo, signal: ema(kvo, signal) };
}

// Negative / Positive Volume Index (mulai 1000).
export function volumeIndexes(close, vol) {
  const len = close.length;
  const nvi = nans(len);
  const pvi = nans(len);
  if (!len) return { nvi, pvi };
  nvi[0] = 1000;
  pvi[0] = 1000;
  for (let i = 1; i < len; i++) {
    const chg = close[i - 1] ? (close[i] - close[i - 1]) / close[i - 1] : 0;
    nvi[i] = vol[i] < vol[i - 1] ? nvi[i - 1] * (1 + chg) : nvi[i - 1];
    pvi[i] = vol[i] > vol[i - 1] ? pvi[i - 1] * (1 + chg) : pvi[i - 1];
  }
  return { nvi, pvi };
}

// Volume Oscillator: selisih persen EMA volume cepat vs lambat.
export function volumeOsc(vol, fast = 5, slow = 10) {
  const f = ema(vol, fast);
  const s = ema(vol, slow);
  return f.map((v, i) => (s[i] ? (100 * (v - s[i])) / s[i] : NaN));
}

// Relative volume: volume bar vs rata-rata n bar sebelumnya.
export function relativeVolume(vol, n = 20) {
  const avg = sma(vol, n);
  return vol.map((v, i) => (i > 0 && avg[i - 1] > 0 ? v / avg[i - 1] : NaN));
}

// Twiggs Money Flow: seperti CMF tetapi memakai true range dan smoothing Wilder.
export function twiggsMoneyFlow(high, low, close, vol, n = 21) {
  const len = close.length;
  const ad = nans(len);
  const vv = nans(len);
  for (let i = 1; i < len; i++) {
    const th = Math.max(high[i], close[i - 1]);
    const tl = Math.min(low[i], close[i - 1]);
    const r = th - tl;
    ad[i] = r === 0 ? 0 : (((close[i] - tl) - (th - close[i])) / r) * vol[i];
    vv[i] = vol[i];
  }
  const a = rma(ad, n);
  const b = rma(vv, n);
  return a.map((v, i) => (b[i] ? v / b[i] : NaN));
}

// Cumulative Volume Delta. Dengan taker-buy (Binance) delta = 2·takerBuy − volume (akurat);
// tanpa itu diestimasi dari posisi close di dalam range bar.
export function cvd(open, high, low, close, vol, takerBuy) {
  const out = nans(close.length);
  let acc = 0;
  let exact = true;
  for (let i = 0; i < close.length; i++) {
    let delta;
    if (takerBuy && Number.isFinite(takerBuy[i])) delta = 2 * takerBuy[i] - vol[i];
    else {
      exact = false;
      const r = high[i] - low[i];
      delta = r === 0 ? 0 : (((close[i] - low[i]) - (high[i] - close[i])) / r) * vol[i];
    }
    acc += delta;
    out[i] = acc;
  }
  out.exact = exact;
  return out;
}

// Volume Profile n bar terakhir: POC + Value Area 70%.
export function volumeProfile(high, low, close, vol, n = 120, bins = 40) {
  const len = close.length;
  const from = Math.max(0, len - n);
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = from; i < len; i++) { lo = Math.min(lo, low[i]); hi = Math.max(hi, high[i]); }
  if (!Number.isFinite(lo) || hi <= lo) return null;
  const step = (hi - lo) / bins;
  const hist = new Array(bins).fill(0);
  for (let i = from; i < len; i++) {
    const a = Math.max(0, Math.floor((low[i] - lo) / step));
    const b = Math.min(bins - 1, Math.floor((high[i] - lo) / step));
    const share = (vol[i] > 0 ? vol[i] : 0) / (b - a + 1);
    for (let k = a; k <= b; k++) hist[k] += share;
  }
  const total = hist.reduce((x, y) => x + y, 0);
  if (!total) return null;
  let poc = 0;
  for (let k = 1; k < bins; k++) if (hist[k] > hist[poc]) poc = k;
  let vaLo = poc;
  let vaHi = poc;
  let acc = hist[poc];
  while (acc < total * 0.7 && (vaLo > 0 || vaHi < bins - 1)) {
    const down = vaLo > 0 ? hist[vaLo - 1] : -1;
    const up = vaHi < bins - 1 ? hist[vaHi + 1] : -1;
    if (up >= down) { vaHi++; acc += hist[vaHi]; } else { vaLo--; acc += hist[vaLo]; }
  }
  return { poc: lo + (poc + 0.5) * step, vah: lo + (vaHi + 1) * step, val: lo + vaLo * step, hist, lo, step };
}

export function awesome(high, low) {
  const hl2 = high.map((h, i) => (h + low[i]) / 2);
  const f = sma(hl2, 5);
  const s = sma(hl2, 34);
  return f.map((v, i) => v - s[i]);
}

export function ultimate(high, low, close, a = 7, b = 14, c = 28) {
  const len = close.length;
  const bp = nans(len);
  const tr = nans(len);
  for (let i = 1; i < len; i++) {
    const lo = Math.min(low[i], close[i - 1]);
    const hi = Math.max(high[i], close[i - 1]);
    bp[i] = close[i] - lo;
    tr[i] = hi - lo;
  }
  const avg = (n) => {
    const sb = sma(bp, n);
    const st = sma(tr, n);
    return sb.map((v, i) => (st[i] ? v / st[i] : NaN));
  };
  const A = avg(a);
  const B = avg(b);
  const C = avg(c);
  return A.map((v, i) => (100 * (4 * v + 2 * B[i] + C[i])) / 7);
}

// Kemiringan regresi linear (poin per bar) atas n bar terakhir.
export function linregSlope(src, n = 20) {
  const out = nans(src.length);
  const xm = (n - 1) / 2;
  let den = 0;
  for (let x = 0; x < n; x++) den += (x - xm) ** 2;
  for (let i = n - 1; i < src.length; i++) {
    let ym = 0;
    for (let x = 0; x < n; x++) ym += src[i - n + 1 + x];
    ym /= n;
    let num = 0;
    for (let x = 0; x < n; x++) num += (x - xm) * (src[i - n + 1 + x] - ym);
    out[i] = num / den;
  }
  return out;
}

export function heikinAshi(open, high, low, close) {
  const len = close.length;
  const o = nans(len);
  const c = nans(len);
  const h = nans(len);
  const l = nans(len);
  for (let i = 0; i < len; i++) {
    c[i] = (open[i] + high[i] + low[i] + close[i]) / 4;
    o[i] = i === 0 ? (open[i] + close[i]) / 2 : (o[i - 1] + c[i - 1]) / 2;
    h[i] = Math.max(high[i], o[i], c[i]);
    l[i] = Math.min(low[i], o[i], c[i]);
  }
  return { open: o, high: h, low: l, close: c };
}

export function pearson(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return NaN;
  let ma = 0;
  let mb = 0;
  for (let i = 0; i < n; i++) { ma += a[i]; mb += b[i]; }
  ma /= n;
  mb /= n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return da && db ? num / Math.sqrt(da * db) : NaN;
}
