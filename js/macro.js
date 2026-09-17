// Lapisan konteks antar-pasar: DXY, yield, VIX, kejutan data ekonomi, risiko news,
// sentimen (posisi ritel Binance, funding, COT CFTC) dan nada headline.
import { clamp, pearson } from './indicators.js';

const fin = Number.isFinite;

// Bobot geometrik resmi ICE untuk DXY.
export const DXY_WEIGHTS = { EURUSD: -0.576, USDJPY: 0.136, GBPUSD: -0.119, USDCAD: 0.091, USDSEK: 0.042, USDCHF: 0.036 };

export function syntheticDxy(q) {
  let v = 50.14348112;
  for (const [pair, w] of Object.entries(DXY_WEIGHTS)) {
    if (!fin(q[pair]) || q[pair] <= 0) return NaN;
    v *= q[pair] ** w;
  }
  return v;
}

// Korelasi return emas vs EURUSD (proksi DXY terbalik). Relasi normal = positif.
// Faktor 0.25..1 menentukan seberapa besar suara DXY dipercaya di timeframe itu.
export function correlationFactor(corr) {
  if (!fin(corr)) return 0.6;
  return clamp((corr + 0.2) / 0.8, 0.25, 1);
}

export function goldCorrelation(goldRet, eurRet) {
  return pearson(goldRet, eurRet);
}

// Suara DXY untuk emas di satu timeframe: kebalikan rating DXY, ditimbang korelasi terkini.
export function dxyVote(dxyRating, dxyChangePct, corr) {
  const parts = [];
  if (fin(dxyRating)) parts.push([-dxyRating, 0.7]);
  if (fin(dxyChangePct)) parts.push([-Math.tanh(dxyChangePct / 0.3), 0.3]);
  if (!parts.length) return null;
  const w = parts.reduce((a, [, x]) => a + x, 0);
  return (parts.reduce((a, [v, x]) => a + v * x, 0) / w) * correlationFactor(corr);
}

// Yield naik = biaya peluang emas naik (bear). VIX naik = permintaan safe haven (sedikit bull).
export function ratesVote({ us10yChg, us02yChg, vixChg } = {}) {
  const parts = [];
  if (fin(us10yChg)) parts.push([-Math.tanh(us10yChg / 1), 0.5]);
  if (fin(us02yChg)) parts.push([-Math.tanh(us02yChg / 1), 0.3]);
  if (fin(vixChg)) parts.push([Math.tanh(vixChg / 10), 0.2]);
  if (!parts.length) return null;
  const w = parts.reduce((a, [, x]) => a + x, 0);
  return parts.reduce((a, [v, x]) => a + v * x, 0) / w;
}

// Arah USD bila angka lebih tinggi dari perkiraan. 0 = tidak dinilai (mis. stok minyak).
export function eventPolarity(title) {
  const t = title.toLowerCase();
  if (/(crude|gasoline|distillate|natural gas|rig count|mortgage rate|speech|speaks|testimony|minutes|press conference|projections|statement|votes|holiday|auction)/.test(t)) return 0;
  if (/(unemployment rate|unemployment claims|jobless claims|continuing claims|initial claims|claimant count|trade deficit)/.test(t)) return -1;
  return 1;
}

// Tanda pengaruh data suatu negara terhadap USD: data kuat negara lain melemahkan USD (bobot DXY).
export function currencyUsdSign(currency) {
  const map = { USD: 1, EUR: -0.576, JPY: -0.136, GBP: -0.119, CAD: -0.091, SEK: -0.042, CHF: -0.036 };
  return map[currency] ?? 0;
}

// Kejutan data rilis: vote untuk EMAS (kebalikan arah USD), meluruh dengan waktu (half-life ~4 jam).
export function surpriseVote(ev, nowMs) {
  if (!fin(ev.actual) || !fin(ev.forecast)) return null;
  const pol = eventPolarity(ev.title);
  const cur = currencyUsdSign(ev.currency);
  if (!pol || !cur) return null;
  const released = Date.parse(ev.date);
  if (!fin(released) || released > nowMs) return null;
  const hours = (nowMs - released) / 3_600_000;
  if (hours > 48) return null;
  const scale = Math.max(Math.abs(ev.forecast) * 0.1, Math.abs(ev.previous ?? 0) * 0.05, 0.1);
  const magnitude = Math.tanh((ev.actual - ev.forecast) / scale);
  const importance = ev.importance >= 1 ? 1 : 0.4;
  const usd = magnitude * pol * cur * importance;
  return { vote: -usd * Math.exp((-hours * Math.LN2) / 4), usd, hours };
}

export function macroVote(events, nowMs) {
  const votes = events.map((e) => ({ e, s: surpriseVote(e, nowMs) })).filter((x) => x.s);
  if (!votes.length) return { vote: null, items: [] };
  const sum = votes.reduce((a, x) => a + x.s.vote, 0);
  return { vote: clamp(sum), items: votes };
}

// Jendela berbahaya: event high impact USD/majors dalam `beforeMin` ke depan atau `afterMin` ke belakang.
export function newsRisk(events, nowMs, beforeMin = 30, afterMin = 15) {
  const hot = events.filter((e) => {
    if (e.importance < 1 || !currencyUsdSign(e.currency)) return false;
    const t = Date.parse(e.date);
    return t - nowMs <= beforeMin * 60_000 && nowMs - t <= afterMin * 60_000;
  });
  const next = events
    .filter((e) => e.importance >= 1 && currencyUsdSign(e.currency) && Date.parse(e.date) > nowMs)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0] || null;
  return { active: hot.length > 0, events: hot, next, factor: hot.length ? 0.5 : 1 };
}

// Posisi ritel kontrarian: mayoritas long = risiko long squeeze.
export function retailContrarianVote(longShortRatio) {
  if (!fin(longShortRatio) || longShortRatio <= 0) return null;
  return -Math.tanh(Math.log(longShortRatio) / 1.2);
}

export function fundingVote(rate) {
  if (!fin(rate)) return null;
  return -Math.tanh(rate / 0.0005);
}

// COT managed money: net long ekstrem (persentil tinggi) = ramai, kontrarian bear.
export function cotVote(history) {
  const nets = history.map((r) => r.net).filter(fin);
  if (nets.length < 20) return null;
  const latest = nets[0];
  const pct = nets.filter((x) => x <= latest).length / nets.length;
  return { vote: clamp((0.5 - pct) * 2) * 0.8, percentile: pct, net: latest };
}

const BULL_WORDS = [
  'gold rises', 'gold gains', 'gold climbs', 'gold jumps', 'gold rallies', 'gold surges', 'gold hits record', 'record high',
  'safe-haven demand', 'safe haven demand', 'rate cut', 'dovish', 'dollar falls', 'dollar slips', 'dollar weakens',
  'yields fall', 'yields drop', 'central bank buying', 'etf inflows', 'geopolitical', 'escalat',
];
const BEAR_WORDS = [
  'gold falls', 'gold drops', 'gold slips', 'gold slides', 'gold declines', 'gold tumbles', 'gold retreats', 'gold eases',
  'rate hike', 'hikes', 'hawkish', 'dollar rises', 'dollar gains', 'dollar strengthens', 'dollar firms', 'yields rise',
  'yields climb', 'yields jump', 'etf outflows', 'profit-taking', 'ceasefire',
];

export function headlineScore(title) {
  const t = ` ${title.toLowerCase()} `;
  const bull = BULL_WORDS.filter((w) => t.includes(w)).length;
  const bear = BEAR_WORDS.filter((w) => t.includes(w)).length;
  if (!bull && !bear) return 0;
  return (bull - bear) / (bull + bear);
}

// Rata-rata tertimbang waktu (half-life 6 jam) atas headline 24 jam terakhir.
export function headlinesVote(headlines, nowMs) {
  let num = 0;
  let den = 0;
  const scored = [];
  for (const h of headlines) {
    const age = (nowMs - h.published * 1000) / 3_600_000;
    if (age < 0 || age > 24) continue;
    const sc = headlineScore(h.title);
    if (!sc) continue;
    const w = Math.exp((-age * Math.LN2) / 6);
    num += sc * w;
    den += w;
    scored.push({ ...h, score: sc });
  }
  return { vote: den ? num / den : null, scored };
}

export function sentimentVote({ longShort, funding, headlines, cot, useCot }) {
  const parts = [];
  if (fin(longShort)) parts.push([longShort, 0.35]);
  if (fin(funding)) parts.push([funding, 0.15]);
  if (fin(headlines)) parts.push([headlines, 0.3]);
  if (useCot && cot && fin(cot.vote)) parts.push([cot.vote, 0.2]);
  if (!parts.length) return null;
  const w = parts.reduce((a, [, x]) => a + x, 0);
  return parts.reduce((a, [v, x]) => a + v * x, 0) / w;
}
