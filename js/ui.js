// Helper tampilan murni: format angka/waktu, warna skor, dan pembuat SVG (gauge, ring, radar, sparkline).
// Tidak menyentuh DOM supaya bisa diuji di Node.

const fin = Number.isFinite;

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function fmt(x, d = 2) {
  if (!fin(x)) return '–';
  return x.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function fmtSigned(x, d = 1) {
  if (!fin(x)) return '–';
  const r = Number(x.toFixed(d));
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${fmt(Math.abs(r), d)}`;
}

export function fmtPct(x, d = 2) {
  return fin(x) ? `${fmtSigned(x, d)}%` : '–';
}

// Persen dengan satu desimal untuk probabilitas/akurasi 0..1.
export function pct(x, d = 1) {
  return fin(x) ? `${(x * 100).toFixed(d)}%` : '–';
}

// Warna TEKS untuk skor -100..100 yang selalu lolos kontras AA (≥ 4.5:1) di permukaan gelap:
// kekuatan skor menaikkan saturasi, bukan menggelapkan — jadi skor lemah tidak jadi cokelat kusam.
export function scoreColor(score) {
  if (!fin(score)) return 'hsl(40 14% 66%)';
  const s = Math.max(-100, Math.min(100, score)) / 100;
  const a = Math.abs(s);
  if (a < 0.15) return 'hsl(42 22% 74%)';
  if (s > 0) return `hsl(158 ${Math.round(45 + 35 * a)}% ${Math.round(62 - 6 * a)}%)`;
  return `hsl(350 ${Math.round(60 + 30 * a)}% ${Math.round(74 - 6 * a)}%)`;
}

// Warna LATAR/tint (rgba) untuk tile & batang: intensitas mengikuti kekuatan skor.
export function scoreFill(score, maxAlpha = 0.34) {
  if (!fin(score)) return 'rgba(163, 151, 128, 0.08)';
  const s = Math.max(-100, Math.min(100, score)) / 100;
  const a = Math.abs(s);
  const alpha = (0.07 + (maxAlpha - 0.07) * a).toFixed(3);
  if (a < 0.15) return `rgba(212, 175, 55, ${alpha})`;
  return s > 0 ? `rgba(16, 185, 129, ${alpha})` : `rgba(225, 29, 72, ${alpha})`;
}

export function toneOf(score) {
  if (!fin(score)) return 'na';
  if (score >= 40) return 'sbull';
  if (score >= 15) return 'bull';
  if (score > -15) return 'neutral';
  if (score > -40) return 'bear';
  return 'sbear';
}

export function arrow(score) {
  if (!fin(score)) return '·';
  if (score >= 40) return '⬆';
  if (score >= 15) return '↗';
  if (score > -15) return '→';
  if (score > -40) return '↘';
  return '⬇';
}

// Label ringkas untuk ruang sempit (tile, mobile).
export function shortLabel(score) {
  return { sbull: 'S.BULL', bull: 'BULL', neutral: 'NETRAL', bear: 'BEAR', sbear: 'S.BEAR', na: '…' }[toneOf(score)];
}

export function timeAgo(ms) {
  if (!fin(ms) || ms < 0) return '–';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} dtk`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} mnt`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} jam`;
  return `${Math.round(h / 24)} hari`;
}

export function countdown(ms) {
  if (!fin(ms)) return '–';
  const neg = ms < 0;
  let s = Math.floor(Math.abs(ms) / 1000);
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const pad = (x) => String(x).padStart(2, '0');
  const body = d ? `${d}h ${pad(h)}:${pad(m)}` : `${pad(h)}:${pad(m)}:${pad(s)}`;
  return neg ? `−${body}` : body;
}

export function wib(ms, withDate = false) {
  const d = new Date(ms + 7 * 3_600_000);
  const pad = (x) => String(x).padStart(2, '0');
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  if (!withDate) return time;
  const days = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  return `${days[d.getUTCDay()]} ${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)} ${time}`;
}

// Sesi pasar emas berdasarkan jam UTC (tanpa penyesuaian DST, cukup untuk panduan).
export const SESSIONS = [
  { id: 'sydney', label: 'Sydney', start: 21, end: 6 },
  { id: 'tokyo', label: 'Tokyo', start: 0, end: 9 },
  { id: 'london', label: 'London', start: 7, end: 16 },
  { id: 'newyork', label: 'New York', start: 12, end: 21 },
];

export function sessionsAt(ms) {
  const h = new Date(ms).getUTCHours() + new Date(ms).getUTCMinutes() / 60;
  const day = new Date(ms).getUTCDay();
  const weekend = day === 6 || (day === 0 && h < 21) || (day === 5 && h >= 21);
  return SESSIONS.map((s) => ({
    ...s,
    open: !weekend && (s.start < s.end ? h >= s.start && h < s.end : h >= s.start || h < s.end),
  }));
}

// Waktu tutup bar yang sedang berjalan, dihitung dari jam buka bar terakhir (mengikuti sesi broker apa adanya).
export function barCloseAt(lastBarT, tfId, tfMs) {
  if (!fin(lastBarT)) return NaN;
  if (tfId === '1M') {
    const d = new Date(lastBarT);
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes());
  }
  return lastBarT + tfMs;
}

// Sudut jarum gauge (derajat, 0 = kiri/−100, 180 = kanan/+100) — dipakai sebagai rotasi CSS supaya bisa dianimasikan.
export function needleAngle(score) {
  const v = fin(score) ? Math.max(-100, Math.min(100, score)) : 0;
  return ((v + 100) / 200) * 180;
}

// Gauge setengah lingkaran -100..100. Jarum berupa <g class="gauge-needle-g"> yang diputar lewat CSS.
export function gaugeSvg(score, { size = 260, stroke = 16 } = {}) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const pt = (v, rr = r) => {
    const a = Math.PI * (1 - (v + 100) / 200);
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  };
  const arc = (a, b, color) => {
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${color}" stroke-width="${stroke}" fill="none"/>`;
  };
  const bands = [[-100, -40.8, 'var(--sbear)'], [-39.2, -15.8, 'var(--bear)'], [-14.2, 14.2, 'var(--neutral-2)'], [15.8, 39.2, 'var(--bull)'], [40.8, 100, 'var(--sbull)']];
  const ticks = [-100, -50, 0, 50, 100].map((t) => {
    const [x, y] = pt(t, r - stroke - 10);
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" class="gauge-tick">${t}</text>`;
  }).join('');
  return `<svg viewBox="0 ${stroke / -2} ${size} ${size / 2 + stroke * 1.4}" class="gauge" role="img" aria-label="Skor gabungan ${fin(score) ? score.toFixed(0) : 'belum tersedia'}">
${bands.map(([a, b, c]) => arc(a, b, c)).join('')}
${ticks}
<g class="gauge-needle-g" style="transform-origin:${cx}px ${cy}px;transform:rotate(${needleAngle(score).toFixed(2)}deg)">
<line x1="${cx}" y1="${cy}" x2="${cx - (r - stroke - 2)}" y2="${cy}" class="gauge-needle"/>
</g>
<circle cx="${cx}" cy="${cy}" r="${stroke * 0.6}" class="gauge-hub"/>
</svg>`;
}

// Parameter lingkaran progres untuk probabilitas 0..1.
export function ringDash(p, size = 120, stroke = 11) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = fin(p) ? Math.max(0, Math.min(1, p)) : 0;
  return { r, c, offset: c * (1 - v), color: fin(p) ? scoreColor((v - 0.5) * 200) : 'var(--text-3)' };
}

export function probRing(p, { size = 120, stroke = 11, label = 'PELUANG NAIK' } = {}) {
  const d = ringDash(p, size, stroke);
  const h = size / 2;
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Probabilitas naik menurut AI ${fin(p) ? Math.round(p * 100) : 'belum tersedia'}%">
<circle cx="${h}" cy="${h}" r="${d.r}" class="ring-track" stroke-width="${stroke}"/>
<circle cx="${h}" cy="${h}" r="${d.r}" class="ring-val" stroke-width="${stroke}" stroke="${d.color}"
  stroke-dasharray="${d.c.toFixed(2)}" stroke-dashoffset="${d.offset.toFixed(2)}" transform="rotate(-90 ${h} ${h})"/>
<text x="${h}" y="${h - 17}" class="ring-lbl">AI</text>
<text x="${h}" y="${h + 7}" class="ring-num">${fin(p) ? `${Math.round(p * 100)}%` : '–'}</text>
<text x="${h}" y="${h + 24}" class="ring-lbl">${esc(label)}</text>
</svg>`;
}

// Radar kategori: nilai -100..100 dipetakan ke jari-jari 0..1 (0 = lingkaran tengah).
export function radarSvg(cats, { size = 260 } = {}) {
  const entries = Object.values(cats);
  const n = entries.length;
  const c = size / 2;
  const R = size / 2 - 42;
  const pos = (i, rr) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [c + rr * Math.cos(a), c + rr * Math.sin(a)];
  };
  const ring = (f) => entries.map((_, i) => pos(i, R * f).map((x) => x.toFixed(1)).join(',')).join(' ');
  const pts = entries.map((e, i) => pos(i, R * (fin(e.score) ? (e.score + 100) / 200 : 0.5)).map((x) => x.toFixed(1)).join(',')).join(' ');
  const valid = entries.filter((e) => fin(e.score));
  const avg = valid.length ? valid.reduce((a, e) => a + e.score, 0) / valid.length : NaN;
  const spokes = entries.map((_, i) => {
    const [x, y] = pos(i, R);
    return `<line x1="${c}" y1="${c}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}" class="radar-spoke"/>`;
  }).join('');
  const labels = entries.map((e, i) => {
    const [x, y] = pos(i, R + 22);
    return `<text x="${x.toFixed(1)}" y="${(y - 2).toFixed(1)}" class="radar-label">${esc(e.label)}<tspan x="${x.toFixed(1)}" dy="14" class="radar-val" style="fill:${scoreColor(e.score)}">${fin(e.score) ? fmtSigned(e.score, 0) : '–'}</tspan></text>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="radar" role="img" aria-label="Radar skor per kategori">
<polygon points="${ring(1)}" class="radar-ring"/><polygon points="${ring(0.75)}" class="radar-ring"/>
<polygon points="${ring(0.5)}" class="radar-mid"/><polygon points="${ring(0.25)}" class="radar-ring"/>
${spokes}
<polygon points="${pts}" fill="${scoreFill(avg, 0.45)}" stroke="${scoreColor(avg)}" stroke-width="2" stroke-linejoin="round"/>
${labels}
</svg>`;
}

export function sparklineSvg(values, { width = 160, height = 36, area = false, dot = false } = {}) {
  const v = values.filter(fin);
  if (v.length < 2) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pad = 2;
  const xy = v.map((x, i) => [(i / (v.length - 1)) * width, pad + (height - 2 * pad) - ((x - lo) / span) * (height - 2 * pad)]);
  const pts = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = xy[xy.length - 1];
  return `<svg viewBox="0 0 ${width} ${height}" class="spark" preserveAspectRatio="none" aria-hidden="true">
${area ? `<polygon points="0,${height} ${pts} ${width},${height}" fill="currentColor" opacity="0.12"/>` : ''}
<polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" vector-effect="non-scaling-stroke"/>
${dot ? `<circle cx="${lx.toFixed(1)}" cy="${ly.toFixed(1)}" r="2.5" fill="currentColor"/>` : ''}
</svg>`;
}

// Batang divergen untuk vote -1..1 (lebar 0..50% dari tengah).
export function voteBar(vote) {
  if (!fin(vote)) return '<span class="vbar vbar-na" aria-hidden="true"></span>';
  const w = Math.min(1, Math.abs(vote)) * 50;
  const side = vote >= 0 ? `left:50%;width:${w.toFixed(1)}%` : `left:${(50 - w).toFixed(1)}%;width:${w.toFixed(1)}%`;
  return `<span class="vbar" aria-hidden="true"><i style="${side};background:${scoreColor(vote * 100)}"></i></span>`;
}

// Posisi nilai di antara low–high (0..1), untuk bar rentang harian.
export function rangePosition(lo, hi, v) {
  if (!fin(lo) || !fin(hi) || !fin(v) || hi <= lo) return NaN;
  return Math.max(0, Math.min(1, (v - lo) / (hi - lo)));
}

// Arah dasar sebuah label putusan: STRONG BULL dan BULL sama-sama 'bull'.
export function direction(labelText) {
  const t = String(labelText || '').toUpperCase();
  if (t.includes('BULL')) return 'bull';
  if (t.includes('BEAR')) return 'bear';
  return 'neutral';
}

// Bandingkan putusan sebelumnya vs sekarang → daftar perubahan ARAH (bull ↔ netral ↔ bear).
// Naik-turun kekuatan (BULL ↔ STRONG BULL) sengaja diabaikan supaya feed tidak berisik.
export function diffVerdicts(prev, results, ids, nowMs) {
  const next = {};
  const events = [];
  for (const id of ids) {
    const f = results?.[id]?.final;
    if (!f || !fin(f.score)) continue;
    next[id] = f.label.text;
    if (prev && prev[id] && direction(prev[id]) !== direction(f.label.text)) {
      events.push({ tf: id, from: prev[id], to: f.label.text, score: f.score, at: nowMs });
    }
  }
  return { next, events };
}

// Favicon batangan emas; pita bawah berwarna sesuai putusan gabungan.
export function faviconSvg(tone) {
  const color = { sbull: '#10b981', bull: '#34d399', neutral: '#d4af37', bear: '#fb7185', sbear: '#e11d48', na: '#d4af37' }[tone] || '#d4af37';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1b8"/><stop offset=".5" stop-color="#d4af37"/><stop offset="1" stop-color="#8a6a1f"/></linearGradient></defs><path d="M6 46 18 20h28l12 26z" fill="url(#g)"/><path d="M18 20h28l-4 7H22z" fill="#fff6d0" opacity=".55"/><rect x="6" y="50" width="52" height="8" rx="3" fill="${color}"/></svg>`;
}

export function statusLevel(st, nowMs, staleMs) {
  if (!st) return 'wait';
  if (st.ok === false) return 'down';
  if (fin(st.at) && nowMs - st.at > staleMs) return 'stale';
  return st.at ? 'up' : 'wait';
}
