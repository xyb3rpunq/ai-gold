// Price action: swing, struktur pasar, pola candlestick, divergensi, double top/bottom,
// pivot point, Fibonacci. Semua pola hanya dibaca dari bar yang SUDAH tutup supaya tidak repaint.

// Pivot high/low terkonfirmasi: bar i lebih tinggi/rendah dari `left` bar kiri dan `right` bar kanan.
export function swings(high, low, left = 3, right = 3, uptoIndex = high.length - 1) {
  const highs = [];
  const lows = [];
  for (let i = left; i <= uptoIndex - right; i++) {
    let isH = true;
    let isL = true;
    for (let k = 1; k <= left; k++) {
      if (!(high[i] > high[i - k])) isH = false;
      if (!(low[i] < low[i - k])) isL = false;
    }
    for (let k = 1; k <= right; k++) {
      if (!(high[i] >= high[i + k])) isH = false;
      if (!(low[i] <= low[i + k])) isL = false;
    }
    if (isH) highs.push({ i, price: high[i] });
    if (isL) lows.push({ i, price: low[i] });
  }
  return { highs, lows };
}

// Teori Dow: HH + HL = naik, LH + LL = turun.
export function marketStructure(sw) {
  const { highs, lows } = sw;
  if (highs.length < 2 || lows.length < 2) return { trend: 0, label: 'data swing kurang' };
  const [h1, h2] = highs.slice(-2);
  const [l1, l2] = lows.slice(-2);
  const hh = h2.price > h1.price;
  const hl = l2.price > l1.price;
  if (hh && hl) return { trend: 1, label: 'HH + HL' };
  if (!hh && !hl) return { trend: -1, label: 'LH + LL' };
  return { trend: 0, label: hh ? 'HH + LL (melebar)' : 'LH + HL (menyempit)' };
}

// Break of structure: close menembus swing high/low terakhir yang terkonfirmasi.
export function breakOfStructure(close, sw) {
  const lh = sw.highs[sw.highs.length - 1];
  const ll = sw.lows[sw.lows.length - 1];
  if (!lh || !ll) return { dir: 0, level: NaN };
  if (close > lh.price) return { dir: 1, level: lh.price };
  if (close < ll.price) return { dir: -1, level: ll.price };
  return { dir: 0, level: NaN };
}

const body = (o, c) => Math.abs(c - o);

// Deteksi pola pada bar tertutup index i. `trend` = konteks sebelum pola (+1/-1/0), `atr` untuk skala.
export function candlePatterns(open, high, low, close, i, atrValue, trend = 0) {
  const found = [];
  if (i < 2 || !Number.isFinite(atrValue) || atrValue <= 0) return found;
  const o = open[i];
  const h = high[i];
  const l = low[i];
  const c = close[i];
  const range = h - l;
  const b = body(o, c);
  const upper = h - Math.max(o, c);
  const lower = Math.min(o, c) - l;
  const po = open[i - 1];
  const pc = close[i - 1];
  const pb = body(po, pc);
  const bull = c > o;
  const bear = c < o;
  const add = (name, dir, strength) => found.push({ name, dir, strength });

  if (range > 0 && b <= range * 0.1) add('Doji', 0, 0);
  if (bull && pc < po && c >= po && o <= pc && b > pb) add('Bullish Engulfing', 1, 1);
  if (bear && pc > po && c <= po && o >= pc && b > pb) add('Bearish Engulfing', -1, 1);
  if (range > atrValue * 0.3 && lower >= b * 2 && upper <= b * 0.6 && b > 0) {
    if (trend <= 0) add('Hammer', 1, 0.7);
    else add('Hanging Man', -1, 0.5);
  }
  if (range > atrValue * 0.3 && upper >= b * 2 && lower <= b * 0.6 && b > 0) {
    if (trend >= 0) add('Shooting Star', -1, 0.7);
    else add('Inverted Hammer', 1, 0.5);
  }
  if (b >= range * 0.9 && b > atrValue * 0.8) add(bull ? 'Bullish Marubozu' : 'Bearish Marubozu', bull ? 1 : -1, 0.6);
  const pmid = (po + pc) / 2;
  if (pc < po && bull && o < pc && c > pmid && c < po) add('Piercing Line', 1, 0.7);
  if (pc > po && bear && o > pc && c < pmid && c > po) add('Dark Cloud Cover', -1, 0.7);
  if (Math.abs(l - low[i - 1]) <= atrValue * 0.05 && pc < po && bull) add('Tweezer Bottom', 1, 0.5);
  if (Math.abs(h - high[i - 1]) <= atrValue * 0.05 && pc > po && bear) add('Tweezer Top', -1, 0.5);
  if (h < high[i - 1] && l > low[i - 1]) add('Inside Bar', 0, 0);

  const o2 = open[i - 2];
  const c2 = close[i - 2];
  const b2 = body(o2, c2);
  const smallMid = pb <= Math.max(b2, b) * 0.35;
  if (c2 < o2 && b2 > atrValue * 0.5 && smallMid && bull && c > (o2 + c2) / 2) add('Morning Star', 1, 1);
  if (c2 > o2 && b2 > atrValue * 0.5 && smallMid && bear && c < (o2 + c2) / 2) add('Evening Star', -1, 1);
  const up3 = [i - 2, i - 1, i].every((j) => close[j] > open[j] && body(open[j], close[j]) > atrValue * 0.4);
  const dn3 = [i - 2, i - 1, i].every((j) => close[j] < open[j] && body(open[j], close[j]) > atrValue * 0.4);
  if (up3 && close[i] > close[i - 1] && close[i - 1] > close[i - 2]) add('Three White Soldiers', 1, 1);
  if (dn3 && close[i] < close[i - 1] && close[i - 1] < close[i - 2]) add('Three Black Crows', -1, 1);
  return found;
}

// Divergensi reguler RSI pada dua swing terakhir (high untuk bearish, low untuk bullish).
export function divergence(sw, osc) {
  const hs = sw.highs.slice(-2);
  const ls = sw.lows.slice(-2);
  const res = [];
  if (hs.length === 2) {
    const [a, b] = hs;
    if (b.price > a.price && osc[b.i] < osc[a.i]) res.push({ name: 'Bearish divergence RSI', dir: -1, at: b.i });
    if (b.price < a.price && osc[b.i] > osc[a.i]) res.push({ name: 'Hidden bearish divergence RSI', dir: -0.5, at: b.i });
  }
  if (ls.length === 2) {
    const [a, b] = ls;
    if (b.price < a.price && osc[b.i] > osc[a.i]) res.push({ name: 'Bullish divergence RSI', dir: 1, at: b.i });
    if (b.price > a.price && osc[b.i] < osc[a.i]) res.push({ name: 'Hidden bullish divergence RSI', dir: 0.5, at: b.i });
  }
  return res;
}

// Double top/bottom terkonfirmasi: dua puncak/lembah setara (≤ tol × ATR) dan neckline tertembus.
export function doublePattern(sw, low, high, close, atrValue, tol = 0.6) {
  if (!Number.isFinite(atrValue)) return null;
  const hs = sw.highs.slice(-2);
  const ls = sw.lows.slice(-2);
  if (hs.length === 2 && Math.abs(hs[1].price - hs[0].price) <= atrValue * tol) {
    let neck = Infinity;
    for (let j = hs[0].i; j <= hs[1].i; j++) neck = Math.min(neck, low[j]);
    if (close < neck) return { name: 'Double Top (neckline tembus)', dir: -1, neckline: neck };
  }
  if (ls.length === 2 && Math.abs(ls[1].price - ls[0].price) <= atrValue * tol) {
    let neck = -Infinity;
    for (let j = ls[0].i; j <= ls[1].i; j++) neck = Math.max(neck, high[j]);
    if (close > neck) return { name: 'Double Bottom (neckline tembus)', dir: 1, neckline: neck };
  }
  return null;
}

export function pivotPoints(h, l, c) {
  const p = (h + l + c) / 3;
  const r = h - l;
  return {
    classic: { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + r, s2: p - r, r3: h + 2 * (p - l), s3: l - 2 * (h - p) },
    fibonacci: { p, r1: p + 0.382 * r, s1: p - 0.382 * r, r2: p + 0.618 * r, s2: p - 0.618 * r, r3: p + r, s3: p - r },
    camarilla: { r3: c + (r * 1.1) / 4, s3: c - (r * 1.1) / 4, r4: c + (r * 1.1) / 2, s4: c - (r * 1.1) / 2 },
  };
}

// Posisi retracement Fibonacci dari kaki swing terakhir.
export function fibPosition(sw, close) {
  const h = sw.highs[sw.highs.length - 1];
  const l = sw.lows[sw.lows.length - 1];
  if (!h || !l || h.price === l.price) return null;
  const legUp = l.i < h.i; // kaki terakhir naik (low → high), sekarang koreksi turun
  const span = h.price - l.price;
  const retr = legUp ? (h.price - close) / span : (close - l.price) / span;
  return { legUp, retr, high: h.price, low: l.price };
}

// Support/resistance terdekat dari swing terkonfirmasi.
export function nearestLevels(sw, price) {
  const above = sw.highs.map((s) => s.price).concat(sw.lows.map((s) => s.price)).filter((p) => p > price);
  const below = sw.highs.map((s) => s.price).concat(sw.lows.map((s) => s.price)).filter((p) => p < price);
  return {
    resistance: above.length ? Math.min(...above) : NaN,
    support: below.length ? Math.max(...below) : NaN,
  };
}
