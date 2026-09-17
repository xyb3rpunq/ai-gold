// Penjelas bahasa awam untuk Mode Pemula. Murni tanpa DOM supaya bisa diuji.
// Bahasa sengaja deskriptif ("condong naik"), bukan perintah beli/jual.
import { sessionsAt, fmt, wib, countdown } from './ui.js';

const fin = Number.isFinite;

export const STYLES = [
  { id: 'scalp', name: 'Scalping', hint: 'posisi hitungan menit', tfs: ['1m', '2m', '3m', '5m'], mainTf: '5m' },
  { id: 'intraday', name: 'Intraday', hint: 'posisi hitungan jam', tfs: ['10m', '15m', '30m', '45m', '1H'], mainTf: '1H' },
  { id: 'swing', name: 'Swing', hint: 'posisi beberapa hari', tfs: ['2H', '3H', '4H', '1D'], mainTf: '4H' },
  { id: 'position', name: 'Jangka Panjang', hint: 'posisi minggu–bulan', tfs: ['1W', '1M'], mainTf: '1W' },
];

// Arah dalam bahasa awam. Ambang sama dengan label NETRAL (±15).
export function directionWord(score) {
  if (!fin(score)) return { key: 'wait', label: 'MEMUAT', short: '…' };
  if (score >= 15) return { key: 'up', label: 'CONDONG NAIK', short: 'Naik' };
  if (score <= -15) return { key: 'down', label: 'CONDONG TURUN', short: 'Turun' };
  return { key: 'wait', label: 'BELUM JELAS', short: 'Tunggu' };
}

// Kekuatan sinyal 0..3 dari besar skor dan keyakinan.
export function strengthWord(score, confidence) {
  if (!fin(score)) return { level: 0, label: 'belum ada data' };
  const a = Math.abs(score);
  if (a < 15) return { level: 0, label: 'tidak ada arah jelas' };
  if (a >= 40 && confidence >= 55) return { level: 3, label: 'kuat' };
  if (a >= 25 || confidence >= 45) return { level: 2, label: 'sedang' };
  return { level: 1, label: 'lemah' };
}

export function reliabilityWord(rel) {
  if (!fin(rel) || rel <= 0) return 'belum terbukti';
  if (rel < 0.4) return 'rendah';
  if (rel < 0.75) return 'sedang';
  return 'tinggi';
}

// Berapa timeframe gaya ini yang searah dengan arah gabungan gaya tersebut.
export function agreement(results, tfs, dirKey) {
  const scores = tfs.map((id) => results?.[id]?.final?.score).filter(fin);
  const same = scores.filter((s) => directionWord(s).key === dirKey).length;
  return { same, total: scores.length };
}

export function upcomingNews(events, nowMs, n = 3) {
  return (events || [])
    .filter((e) => e.importance >= 1 && Date.parse(e.date) > nowMs - 5 * 60_000)
    .sort((a, b) => Date.parse(a.date) - Date.parse(b.date))
    .slice(0, n)
    .map((e) => {
      const t = Date.parse(e.date);
      return { title: e.title, currency: e.currency, at: t, when: `${wib(t, true)} WIB`, inMs: t - nowMs };
    });
}

export function sessionNote(nowMs) {
  const open = sessionsAt(nowMs).filter((s) => s.open).map((s) => s.label);
  if (!open.length) return { ok: null, text: 'Pasar emas sedang tutup (akhir pekan) — harga tidak bergerak.' };
  const busy = open.includes('London') || open.includes('New York');
  return {
    ok: busy ? null : true,
    text: busy
      ? `Sesi ${open.join(' & ')} aktif — biasanya harga bergerak lebih cepat dan lebih jauh.`
      : `Sesi ${open.join(' & ')} aktif — biasanya pergerakan lebih tenang.`,
  };
}

/**
 * Penjelasan satu gaya trading dari snapshot.
 * @returns {{style, score, dir, strength, sentence, checks: {ok: boolean|null, text: string}[], levels, ai}}
 */
export function explainStyle(styleId, snap, nowMs) {
  const style = STYLES.find((s) => s.id === styleId) || STYLES[1];
  const hz = snap?.summary?.horizons?.find((h) => h.id === style.id);
  const score = hz?.score;
  const dir = directionWord(score);
  const strength = strengthWord(score, hz?.confidence);
  const results = snap?.results || {};
  const g = snap?.global || {};
  const checks = [];

  const ag = agreement(results, style.tfs, dir.key === 'wait' ? 'wait' : dir.key);
  if (ag.total) {
    checks.push(dir.key === 'wait'
      ? { ok: null, text: `Timeframe ${style.tfs.join(', ')} belum kompak — sinyalnya saling bertentangan.` }
      : { ok: ag.same / ag.total >= 0.5, text: `${ag.same} dari ${ag.total} timeframe (${style.tfs.join(', ')}) ${dir.key === 'up' ? 'condong naik' : 'condong turun'}.` });
  }

  // AI: rata-rata tertimbang reliabilitas pada timeframe gaya ini.
  const ais = style.tfs.map((id) => results[id]?.ai).filter(Boolean);
  const bestRel = ais.length ? Math.max(...ais.map((a) => a.reliability)) : NaN;
  const ai = { prob: hz?.aiProb, reliability: bestRel, word: reliabilityWord(bestRel) };
  if (fin(ai.prob)) {
    const pctTxt = `${Math.round(ai.prob * 100)}%`;
    checks.push(bestRel > 0
      ? { ok: dir.key === 'wait' ? null : (ai.prob > 0.5) === (dir.key === 'up'), text: `AI memperkirakan peluang naik ${pctTxt} (keandalan ${ai.word}, sudah diuji dengan data yang belum pernah dilihatnya).` }
      : { ok: null, text: `AI menghitung peluang naik ${pctTxt}, tapi belum terbukti andal di gaya ini — anggap sebagai info saja.` });
  }

  const main = results[style.mainTf];
  const dxy = main?.ctx?.dxy;
  if (fin(dxy)) {
    checks.push(Math.abs(dxy) < 0.1
      ? { ok: null, text: 'Dolar AS sedang datar — pengaruhnya ke emas kecil.' }
      : { ok: dxy > 0 ? dir.key !== 'down' : dir.key !== 'up', text: dxy > 0 ? 'Dolar AS melemah — biasanya mendukung harga emas naik.' : 'Dolar AS menguat — biasanya menekan harga emas.' });
  }
  if (fin(g.rates)) {
    checks.push(Math.abs(g.rates) < 0.1
      ? { ok: null, text: 'Imbal hasil obligasi AS stabil.' }
      : { ok: g.rates > 0 ? dir.key !== 'down' : dir.key !== 'up', text: g.rates > 0 ? 'Imbal hasil obligasi AS turun — kondisi ini cenderung positif untuk emas.' : 'Imbal hasil obligasi AS naik — kondisi ini cenderung negatif untuk emas.' });
  }

  const risk = g.risk;
  if (risk?.active) {
    checks.push({ ok: false, text: `Hati-hati: berita besar sedang/akan rilis (${risk.events.map((e) => `${e.currency} ${e.title}`).join(', ')}). Harga bisa melonjak liar dan spread melebar.` });
  } else if (risk?.next) {
    const inMs = Date.parse(risk.next.date) - nowMs;
    checks.push({ ok: inMs > 2 * 3_600_000 ? true : null, text: `Berita besar berikutnya: ${risk.next.currency} ${risk.next.title} dalam ${countdown(inMs)} (${wib(Date.parse(risk.next.date))} WIB).` });
  } else {
    checks.push({ ok: true, text: 'Tidak ada berita besar terjadwal dalam waktu dekat.' });
  }
  checks.push(sessionNote(nowMs));

  const levels = main?.levels ? { tf: style.mainTf, support: main.levels.support, resistance: main.levels.resistance, price: main.levels.price } : null;

  let sentence;
  if (!fin(score)) sentence = 'Data sedang dimuat…';
  else if (dir.key === 'wait') sentence = `Untuk ${style.name.toLowerCase()} (${style.hint}), arah emas belum jelas. Banyak trader memilih menunggu sampai sinyal lebih kompak.`;
  else sentence = `Untuk ${style.name.toLowerCase()} (${style.hint}), emas ${dir.key === 'up' ? 'condong naik' : 'condong turun'} dengan kekuatan ${strength.label}.`;

  return { style, score, dir, strength, sentence, checks, levels, ai };
}

// Kalimat level penting dalam bahasa awam.
export function levelsSentence(levels) {
  if (!levels) return '';
  const parts = [];
  if (fin(levels.resistance)) parts.push(`batas atas terdekat (resistance) di ${fmt(levels.resistance)}`);
  if (fin(levels.support)) parts.push(`batas bawah terdekat (support) di ${fmt(levels.support)}`);
  if (!parts.length) return '';
  return `Di timeframe ${levels.tf}, ${parts.join(' dan ')}. Harga sering tertahan atau berbalik di sekitar level ini.`;
}
