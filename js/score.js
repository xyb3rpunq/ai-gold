// Menggabungkan suara sinyal → skor teknikal per timeframe → skor akhir dengan konteks
// (DXY, yield, makro, sentimen) → putusan per horizon dan keseluruhan.
import { CATEGORIES } from './signals.js';
import { TIMEFRAMES, HORIZONS } from './candles.js';

const fin = Number.isFinite;

// Bobot dasar komponen skor akhir. Bobot AI dikalikan reliabilitasnya (skill out-of-sample 0..1),
// jadi model yang tidak terbukti lebih baik dari tebakan otomatis tidak ikut menentukan.
export const CONTEXT_WEIGHTS = { technical: 0.45, ai: 0.25, dxy: 0.15, rates: 0.07, macro: 0.05, sentiment: 0.03 };

export function label(score) {
  if (!fin(score)) return { text: 'N/A', tone: 'na' };
  if (score >= 40) return { text: 'STRONG BULL', tone: 'sbull' };
  if (score >= 15) return { text: 'BULL', tone: 'bull' };
  if (score > -15) return { text: 'NETRAL', tone: 'neutral' };
  if (score > -40) return { text: 'BEAR', tone: 'bear' };
  return { text: 'STRONG BEAR', tone: 'sbear' };
}

export function technicalScore(signals) {
  const active = signals.filter((s) => s.vote !== null);
  const cats = {};
  for (const [id, meta] of Object.entries(CATEGORIES)) {
    const inCat = active.filter((s) => s.cat === id);
    const w = inCat.reduce((a, s) => a + s.weight, 0);
    cats[id] = {
      label: meta.label,
      weight: meta.weight,
      n: inCat.length,
      score: w ? (100 * inCat.reduce((a, s) => a + s.weight * s.vote, 0)) / w : null,
    };
  }
  const present = Object.values(cats).filter((c) => c.score !== null);
  const cw = present.reduce((a, c) => a + c.weight, 0);
  const score = cw ? present.reduce((a, c) => a + c.weight * c.score, 0) / cw : null;
  const absSum = active.reduce((a, s) => a + s.weight * Math.abs(s.vote), 0);
  const netSum = active.reduce((a, s) => a + s.weight * s.vote, 0);
  return {
    score,
    cats,
    agreement: absSum ? Math.abs(netSum) / absSum : 0,
    coverage: signals.length ? active.length / signals.length : 0,
    bulls: active.filter((s) => s.vote > 0.05).length,
    bears: active.filter((s) => s.vote < -0.05).length,
    neutral: active.filter((s) => Math.abs(s.vote) <= 0.05).length,
  };
}

// ctx: { ai, aiReliability, dxy, rates, macro, sentiment } — vote -1..1 atau null; riskFactor 0..1.
export function finalScore(tech, ctx = {}, riskFactor = 1) {
  const parts = [];
  if (fin(tech.score)) parts.push(['technical', tech.score / 100, CONTEXT_WEIGHTS.technical]);
  if (fin(ctx.ai) && ctx.aiReliability > 0) parts.push(['ai', ctx.ai, CONTEXT_WEIGHTS.ai * Math.min(1, ctx.aiReliability)]);
  for (const key of ['dxy', 'rates', 'macro', 'sentiment']) if (fin(ctx[key])) parts.push([key, ctx[key], CONTEXT_WEIGHTS[key]]);
  if (!parts.length) return { score: null, components: {}, confidence: 0, label: label(null) };
  const w = parts.reduce((a, [, , x]) => a + x, 0);
  const score = (100 * parts.reduce((a, [, v, x]) => a + x * v, 0)) / w;
  const components = Object.fromEntries(parts.map(([k, v, x]) => [k, { vote: v, weight: x / w }]));
  // Keyakinan: kesepakatan antar sinyal × kelengkapan data × faktor risiko news × kekuatan skor,
  // lalu dinaikkan sedikit bila AI yang terbukti andal searah dengan skor.
  const strength = Math.min(1, Math.abs(score) / 50);
  const aiAgree = fin(ctx.ai) && ctx.aiReliability > 0 && Math.sign(ctx.ai) === Math.sign(score) ? 1 + 0.15 * Math.min(1, ctx.aiReliability) : 1;
  const confidence = Math.min(99, Math.round(100 * (0.35 + 0.65 * tech.agreement) * (0.5 + 0.5 * tech.coverage) * riskFactor * (0.4 + 0.6 * strength) * aiAgree));
  return { score, components, confidence, label: label(score) };
}

export function topReasons(signals, k = 4) {
  return signals
    .filter((s) => s.vote !== null && Math.abs(s.vote) > 0.05)
    .map((s) => ({ ...s, impact: s.weight * s.vote }))
    .sort((a, b) => Math.abs(b.impact) - Math.abs(a.impact))
    .slice(0, k);
}

// results: { [tfId]: { final } }
export function aggregate(results, timeframes = TIMEFRAMES) {
  const avg = (tfs) => {
    let num = 0;
    let den = 0;
    let conf = 0;
    for (const tf of tfs) {
      const f = results[tf.id]?.final;
      if (!f || !fin(f.score)) continue;
      num += tf.weight * f.score;
      conf += tf.weight * f.confidence;
      den += tf.weight;
    }
    const score = den ? num / den : null;
    let pNum = 0;
    let pDen = 0;
    for (const tf of tfs) {
      const ai = results[tf.id]?.ai;
      if (!ai || !fin(ai.p)) continue;
      const w = tf.weight * Math.max(0.05, ai.reliability);
      pNum += w * ai.p;
      pDen += w;
    }
    return {
      score,
      confidence: den ? Math.round(conf / den) : 0,
      label: label(score),
      n: den ? tfs.length : 0,
      aiProb: pDen ? pNum / pDen : null,
    };
  };
  const horizons = HORIZONS.map((h) => ({ ...avg(timeframes.filter((tf) => tf.horizon === h.id)), id: h.id, name: h.label, hint: h.hint }));
  const overall = avg(timeframes);
  const scored = timeframes.map((tf) => results[tf.id]?.final?.score).filter(fin);
  overall.bullTfs = scored.filter((x) => x >= 15).length;
  overall.bearTfs = scored.filter((x) => x <= -15).length;
  overall.neutralTfs = scored.length - overall.bullTfs - overall.bearTfs;
  return { overall, horizons };
}
