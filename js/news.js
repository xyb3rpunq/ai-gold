// Kalender ekonomi (ForexFactory, feed JSON publik) + headline TradingView. Dipakai skrip cron
// (scripts/build-news.mjs) dan oleh browser saat membaca news.json. Angka aktual dibaca realtime
// dari scanner TradingView (ECONOMICS:*) lewat pemetaan judul → ticker di bawah.

export const FF_URL = 'https://nfs.faireconomy.media/ff_calendar_thisweek.json';
const fin = Number.isFinite;

export function headlinesUrl(symbol) {
  return `https://news-headlines.tradingview.com/v2/headlines?client=web&lang=en&symbol=${encodeURIComponent(symbol)}`;
}

// Judul event USD di ForexFactory → ticker data ekonomi TradingView (nilai rilis terakhir).
export const USD_TICKERS = [
  [/^CPI m\/m$/i, 'ECONOMICS:USIRMM'],
  [/^CPI y\/y$/i, 'ECONOMICS:USIRYY'],
  [/^Core CPI y\/y$/i, 'ECONOMICS:USCIR'],
  [/^Non-Farm Employment Change$/i, 'ECONOMICS:USNFP'],
  [/^Unemployment Rate$/i, 'ECONOMICS:USUR'],
  [/^Federal Funds Rate$/i, 'ECONOMICS:USINTR'],
  [/^Retail Sales m\/m$/i, 'ECONOMICS:USRSMM'],
  [/^Core Retail Sales m\/m$/i, 'ECONOMICS:USRSEA'],
  [/GDP q\/q$/i, 'ECONOMICS:USGDPQQ'],
  [/^PPI m\/m$/i, 'ECONOMICS:USPPIMM'],
  [/^PPI y\/y$/i, 'ECONOMICS:USPPIYY'],
  [/^Unemployment Claims$/i, 'ECONOMICS:USIJC'],
  [/^ISM Manufacturing PMI$/i, 'ECONOMICS:USBCOI'],
  [/^Core PCE Price Index m\/m$/i, 'ECONOMICS:USCPCEPIMM'],
  [/^CB Consumer Confidence$/i, 'ECONOMICS:USCCI'],
  [/^Durable Goods Orders m\/m$/i, 'ECONOMICS:USDGO'],
];

export function tickerFor(title, currency) {
  if (currency !== 'USD') return null;
  const hit = USD_TICKERS.find(([re]) => re.test(title.trim()));
  return hit ? hit[1] : null;
}

// "162K" → 162000, "-0.1%" → -0.1, "<1.25%" → 1.25, "3-0-6" → null.
export function parseFFNumber(text) {
  if (text === null || text === undefined) return null;
  const s = String(text).trim().replace(/^[<>≤≥~]/, '');
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([KMBT%])?$/i);
  if (!m) return null;
  const mult = { K: 1e3, M: 1e6, B: 1e9, T: 1e12 }[(m[2] || '').toUpperCase()] || 1;
  return Number(m[1]) * mult;
}

const IMPORTANCE = { High: 1, Medium: 0, Low: -1, Holiday: -1 };

export function transformForexFactory(raw) {
  const list = Array.isArray(raw) ? raw : [];
  return list
    .filter((e) => e && e.title && e.date && (IMPORTANCE[e.impact] ?? -1) >= 0 && Number.isFinite(Date.parse(e.date)))
    .map((e) => {
      const date = new Date(e.date);
      const currency = String(e.country || '').toUpperCase();
      return {
        id: `${currency}-${date.getTime()}-${String(e.title).replace(/\W+/g, '').slice(0, 24)}`,
        title: String(e.title),
        currency,
        importance: IMPORTANCE[e.impact],
        date: date.toISOString(),
        actual: parseFFNumber(e.actual),
        forecast: parseFFNumber(e.forecast),
        previous: parseFFNumber(e.previous),
        unit: /%/.test(`${e.forecast}${e.previous}`) ? '%' : '',
        ticker: tickerFor(String(e.title), currency),
      };
    })
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
}

export function transformHeadlines(...rawLists) {
  const seen = new Set();
  const out = [];
  for (const raw of rawLists) {
    for (const it of raw?.items || []) {
      if (!it?.id || !it.title || seen.has(it.id)) continue;
      seen.add(it.id);
      out.push({
        id: it.id,
        title: String(it.title),
        source: it.source || it.provider || '',
        published: Number(it.published) || 0,
        urgency: Number(it.urgency) || 0,
        url: it.storyPath ? `https://www.tradingview.com${it.storyPath}` : null,
      });
    }
  }
  return out.sort((a, b) => b.published - a.published).slice(0, 60);
}

export function formatValue(v, unit = '') {
  if (!fin(v)) return '–';
  const abs = Math.abs(v);
  if (unit !== '%' && abs >= 1e3) {
    const [div, suf] = abs >= 1e9 ? [1e9, 'B'] : abs >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
    return `${(v / div).toFixed(abs / div >= 100 ? 0 : 1)}${suf}`;
  }
  const s = abs >= 100 ? v.toFixed(0) : abs >= 10 ? v.toFixed(1) : String(Number(v.toFixed(2)));
  return `${s}${unit}`;
}

// Nilai aktual realtime dari scanner (ECONOMICS:*) mengisi event yang belum punya aktual,
// tetapi hanya setelah jam rilis dan hanya kalau nilainya berubah dari "previous".
export function mergeLiveActual(ev, liveValue, nowMs) {
  if (fin(ev.actual) || !fin(liveValue) || Date.parse(ev.date) > nowMs) return ev;
  if (fin(ev.previous) && Math.abs(liveValue - ev.previous) < 1e-9) return ev;
  return { ...ev, actual: liveValue, liveActual: true };
}
