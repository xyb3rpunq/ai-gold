// Candle: parsing kline Binance, agregasi ke timeframe turunan, dan pembaruan live.

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;

// Satu-satunya daftar timeframe.
// `res` = resolusi series TradingView yang diminta, `factor` = berapa bar `res` digabung
// (2m dan 10m tidak tersedia untuk akun tanpa login, jadi dirakit dari 1m dan 5m).
// `bn` = jalur cadangan Binance: feed, interval, factor. `tv` = timeframe rating scanner terdekat.
export const TIMEFRAMES = [
  { id: '1m', ms: MIN, res: '1', factor: 1, bn: ['perp', '1m', 1], tv: ['1'], weight: 0.5, horizon: 'scalp' },
  { id: '2m', ms: 2 * MIN, res: '1', factor: 2, bn: ['perp', '1m', 2], tv: ['1'], weight: 0.5, horizon: 'scalp' },
  { id: '3m', ms: 3 * MIN, res: '3', factor: 1, bn: ['perp', '3m', 1], tv: ['1', '5'], weight: 0.6, horizon: 'scalp' },
  { id: '5m', ms: 5 * MIN, res: '5', factor: 1, bn: ['perp', '5m', 1], tv: ['5'], weight: 0.7, horizon: 'scalp' },
  { id: '10m', ms: 10 * MIN, res: '5', factor: 2, bn: ['perp', '5m', 2], tv: ['5', '15'], weight: 0.8, horizon: 'intraday' },
  { id: '15m', ms: 15 * MIN, res: '15', factor: 1, bn: ['perp', '15m', 1], tv: ['15'], weight: 1, horizon: 'intraday' },
  { id: '30m', ms: 30 * MIN, res: '30', factor: 1, bn: ['perp', '30m', 1], tv: ['30'], weight: 1, horizon: 'intraday' },
  { id: '45m', ms: 45 * MIN, res: '45', factor: 1, bn: ['perp', '15m', 3], tv: ['30', '60'], weight: 1, horizon: 'intraday' },
  { id: '1H', ms: HOUR, res: '60', factor: 1, bn: ['perp', '1h', 1], tv: ['60'], weight: 1.2, horizon: 'intraday' },
  { id: '2H', ms: 2 * HOUR, res: '120', factor: 1, bn: ['perp', '2h', 1], tv: ['120'], weight: 1.2, horizon: 'swing' },
  { id: '3H', ms: 3 * HOUR, res: '180', factor: 1, bn: ['perp', '1h', 3], tv: ['120', '240'], weight: 1.2, horizon: 'swing' },
  { id: '4H', ms: 4 * HOUR, res: '240', factor: 1, bn: ['perp', '4h', 1], tv: ['240'], weight: 1.3, horizon: 'swing' },
  { id: '1D', ms: DAY, res: '1D', factor: 1, bn: ['paxg', '1d', 1], tv: [''], weight: 1.5, horizon: 'swing' },
  { id: '1W', ms: 7 * DAY, res: '1W', factor: 1, bn: ['paxg', '1w', 1], tv: ['1W'], weight: 1.2, horizon: 'position' },
  { id: '1M', ms: 30 * DAY, res: '1M', factor: 1, bn: ['paxg', '1M', 1], tv: ['1M'], weight: 1, horizon: 'position' },
];

// Resolusi TradingView unik yang perlu di-subscribe.
export function tvResolutions(timeframes = TIMEFRAMES) {
  return [...new Set(timeframes.map((tf) => tf.res))];
}

export const HORIZONS = [
  { id: 'scalp', label: 'Scalping', hint: '1m–5m' },
  { id: 'intraday', label: 'Intraday', hint: '10m–1H' },
  { id: 'swing', label: 'Swing', hint: '2H–1D' },
  { id: 'position', label: 'Posisi', hint: '1W–1M' },
];

// Interval Binance unik per feed (jalur cadangan).
export function baseStreams(timeframes = TIMEFRAMES) {
  const out = {};
  for (const tf of timeframes) {
    const [feed, base] = tf.bn;
    out[feed] ??= [];
    if (!out[feed].includes(base)) out[feed].push(base);
  }
  return out;
}

// Kline REST Binance: [openTime, o, h, l, c, v, closeTime, quoteVol, trades, takerBuyBase, ...]
export function parseKline(k) {
  return { t: +k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5], tb: +k[9], closeT: +k[6] };
}

// Payload stream WebSocket `<symbol>@kline_<interval>`.
export function parseWsKline(msg) {
  const k = msg.k;
  return { t: k.t, o: +k.o, h: +k.h, l: +k.l, c: +k.c, v: +k.v, tb: +k.V, closeT: k.T, closed: k.x, interval: k.i };
}

// Gabungkan bar yang sudah terurut ke periode `periodMs` yang sejajar dengan epoch UTC.
export function aggregate(candles, periodMs) {
  const out = [];
  let cur = null;
  for (const b of candles) {
    const t = Math.floor(b.t / periodMs) * periodMs;
    if (!cur || cur.t !== t) {
      cur = { t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v, tb: b.tb, closeT: t + periodMs - 1 };
      out.push(cur);
    } else {
      cur.h = Math.max(cur.h, b.h);
      cur.l = Math.min(cur.l, b.l);
      cur.c = b.c;
      cur.v += b.v;
      cur.tb += b.tb;
    }
  }
  return out;
}

// Masukkan/timpa bar live. Mengembalikan array yang sama (dimutasi) supaya murah dipanggil tiap tick.
export function upsert(candles, bar, maxLen = 1500) {
  const n = candles.length;
  if (!n || bar.t > candles[n - 1].t) {
    candles.push(bar);
    if (candles.length > maxLen) candles.splice(0, candles.length - maxLen);
  } else if (bar.t === candles[n - 1].t) {
    candles[n - 1] = bar;
  } else {
    const idx = candles.findIndex((c) => c.t === bar.t);
    if (idx >= 0) candles[idx] = bar;
  }
  return candles;
}

export function toSeries(candles) {
  return {
    t: candles.map((c) => c.t),
    o: candles.map((c) => c.o),
    h: candles.map((c) => c.h),
    l: candles.map((c) => c.l),
    c: candles.map((c) => c.c),
    v: candles.map((c) => c.v),
    tb: candles.map((c) => c.tb),
  };
}

// Close seri `b` yang berlaku pada tiap bar `a` (as-of: bar b terakhir yang mulai ≤ bar a,
// selisih < tolMs). Jam buka sesi tiap instrumen bisa beda (mis. DXY ICE vs XAUUSD broker),
// jadi pencocokan timestamp persis akan melewatkan hampir semua bar ≥ 45m.
export function asofCloses(a, b, tolMs = Infinity) {
  const out = new Array(a.length).fill(NaN);
  let j = 0;
  for (let i = 0; i < a.length; i++) {
    while (j + 1 < b.length && b[j + 1].t <= a[i].t) j++;
    if (b.length && b[j].t <= a[i].t && a[i].t - b[j].t < tolMs) out[i] = b[j].c;
  }
  return out;
}

// Log return yang dipasangkan (as-of), untuk korelasi dua instrumen.
export function alignedReturns(a, b, maxN = 100, tolMs = Infinity) {
  const bc = asofCloses(a, b, tolMs);
  const ra = [];
  const rb = [];
  for (let i = 1; i < a.length; i++) {
    const b0 = bc[i - 1];
    const b1 = bc[i];
    if (b0 > 0 && b1 > 0 && a[i - 1].c && a[i].c) {
      ra.push(Math.log(a[i].c / a[i - 1].c));
      rb.push(Math.log(b1 / b0));
    }
  }
  return { a: ra.slice(-maxN), b: rb.slice(-maxN) };
}

// Bar terakhir yang sudah tutup pada `nowMs` — sumber pivot point dari timeframe di atasnya
// (hari kemarin untuk intraday, minggu lalu untuk 1D, bulan lalu untuk 1W).
export function lastClosed(candles, nowMs) {
  for (let i = candles.length - 1; i >= 0; i--) {
    if (candles[i].closeT < nowMs) return candles[i];
  }
  return null;
}

// Satu tahun kalender terakhir yang sudah tutup, dirangkum dari bar bulanan — pivot untuk 1M.
export function lastClosedYear(monthly, nowMs) {
  const year = new Date(nowMs).getUTCFullYear() - 1;
  const bars = monthly.filter((c) => new Date(c.t).getUTCFullYear() === year);
  if (!bars.length) return null;
  return { h: Math.max(...bars.map((c) => c.h)), l: Math.min(...bars.map((c) => c.l)), c: bars[bars.length - 1].c };
}
