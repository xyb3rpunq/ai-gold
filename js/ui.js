// Helper tampilan murni: format angka/waktu, warna skor, dan pembuat SVG (gauge, radar, sparkline).
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

// Warna kontinu merah → abu → hijau untuk skor -100..100.
export function scoreColor(score) {
  if (!fin(score)) return 'hsl(220 8% 45%)';
  const s = Math.max(-100, Math.min(100, score)) / 100;
  if (s >= 0) return `hsl(${142} ${Math.round(10 + 62 * s)}% ${Math.round(46 - 4 * s)}%)`;
  return `hsl(${0} ${Math.round(10 + 74 * -s)}% ${Math.round(46 + 14 * -s)}%)`;
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

// Gauge setengah lingkaran -100..100.
export function gaugeSvg(score, { size = 260, stroke = 18 } = {}) {
  const r = (size - stroke) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const pt = (v) => {
    const a = Math.PI * (1 - (v + 100) / 200);
    return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  };
  const arc = (a, b, color) => {
    const [x1, y1] = pt(a);
    const [x2, y2] = pt(b);
    return `<path d="M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}" stroke="${color}" stroke-width="${stroke}" fill="none" stroke-linecap="butt"/>`;
  };
  const bands = [[-100, -40, 'var(--sbear)'], [-40, -15, 'var(--bear)'], [-15, 15, 'var(--neutral)'], [15, 40, 'var(--bull)'], [40, 100, 'var(--sbull)']];
  const v = fin(score) ? Math.max(-100, Math.min(100, score)) : 0;
  const [nx, ny] = (() => {
    const a = Math.PI * (1 - (v + 100) / 200);
    return [cx + (r - stroke) * Math.cos(a), cy - (r - stroke) * Math.sin(a)];
  })();
  const ticks = [-100, -50, 0, 50, 100].map((t) => {
    const a = Math.PI * (1 - (t + 100) / 200);
    const x = cx + (r + stroke * 0.95) * Math.cos(a);
    const y = cy - (r + stroke * 0.95) * Math.sin(a);
    return `<text x="${x.toFixed(1)}" y="${(y + 4).toFixed(1)}" class="gauge-tick">${t}</text>`;
  }).join('');
  return `<svg viewBox="${-stroke} ${-stroke} ${size + 2 * stroke} ${size / 2 + stroke * 2.2}" class="gauge" role="img" aria-label="Skor ${fin(score) ? score.toFixed(0) : 'n/a'}">
${bands.map(([a, b, c]) => arc(a, b, c)).join('')}
${ticks}
<line x1="${cx}" y1="${cy}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" class="gauge-needle"${fin(score) ? '' : ' opacity="0.25"'}/>
<circle cx="${cx}" cy="${cy}" r="${stroke * 0.55}" class="gauge-hub"/>
</svg>`;
}

// Radar kategori: nilai -100..100 dipetakan ke jari-jari 0..1 (0 = lingkaran tengah).
export function radarSvg(cats, { size = 240 } = {}) {
  const entries = Object.values(cats);
  const n = entries.length;
  const c = size / 2;
  const R = size / 2 - 34;
  const pos = (i, rr) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [c + rr * Math.cos(a), c + rr * Math.sin(a)];
  };
  const ring = (f) => entries.map((_, i) => pos(i, R * f).map((x) => x.toFixed(1)).join(',')).join(' ');
  const pts = entries.map((e, i) => pos(i, R * (fin(e.score) ? (e.score + 100) / 200 : 0.5)).map((x) => x.toFixed(1)).join(',')).join(' ');
  const avg = entries.filter((e) => fin(e.score)).reduce((a, e, _, arr) => a + e.score / arr.length, 0);
  const labels = entries.map((e, i) => {
    const [x, y] = pos(i, R + 18);
    return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" class="radar-label">${esc(e.label)}<tspan x="${x.toFixed(1)}" dy="12" class="radar-val">${fin(e.score) ? e.score.toFixed(0) : '–'}</tspan></text>`;
  }).join('');
  return `<svg viewBox="0 0 ${size} ${size}" class="radar" role="img" aria-label="Radar kategori">
<polygon points="${ring(1)}" class="radar-ring"/><polygon points="${ring(0.75)}" class="radar-ring"/>
<polygon points="${ring(0.5)}" class="radar-mid"/><polygon points="${ring(0.25)}" class="radar-ring"/>
<polygon points="${pts}" fill="${scoreColor(avg)}" fill-opacity="0.28" stroke="${scoreColor(avg)}" stroke-width="2"/>
${labels}
</svg>`;
}

export function sparklineSvg(values, { width = 160, height = 36 } = {}) {
  const v = values.filter(fin);
  if (v.length < 2) return '';
  const lo = Math.min(...v);
  const hi = Math.max(...v);
  const span = hi - lo || 1;
  const pts = v.map((x, i) => `${((i / (v.length - 1)) * width).toFixed(1)},${(height - ((x - lo) / span) * height).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${width} ${height}" class="spark" preserveAspectRatio="none"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>`;
}

// Batang divergen untuk vote -1..1 (lebar 0..50% dari tengah).
export function voteBar(vote) {
  if (!fin(vote)) return '<span class="vbar vbar-na"></span>';
  const w = Math.abs(vote) * 50;
  const side = vote >= 0 ? `left:50%;width:${w.toFixed(1)}%` : `left:${(50 - w).toFixed(1)}%;width:${w.toFixed(1)}%`;
  return `<span class="vbar"><i style="${side};background:${scoreColor(vote * 100)}"></i></span>`;
}

// Cincin probabilitas AI: 0..1, warna mengikuti arah (merah < 50% < hijau).
export function probRing(p, { size = 120, stroke = 11, label = 'PELUANG NAIK' } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = fin(p) ? Math.max(0, Math.min(1, p)) : 0;
  const color = fin(p) ? scoreColor((v - 0.5) * 200) : 'var(--dim)';
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="Probabilitas naik ${fin(p) ? Math.round(v * 100) : 'n/a'}%">
<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-track" stroke-width="${stroke}"/>
<circle cx="${size / 2}" cy="${size / 2}" r="${r}" class="ring-val" stroke-width="${stroke}" stroke="${color}"
  stroke-dasharray="${c.toFixed(2)}" stroke-dashoffset="${(c * (1 - v)).toFixed(2)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>
<text x="${size / 2}" y="${size / 2 + 4}" class="ring-num">${fin(p) ? `${Math.round(v * 100)}%` : '–'}</text>
<text x="${size / 2}" y="${size / 2 + 22}" class="ring-lbl">${esc(label)}</text>
<text x="${size / 2}" y="${size / 2 - 20}" class="ring-lbl">AI</text>
</svg>`;
}

// Persen dengan satu desimal untuk probabilitas/akurasi 0..1.
export function pct(x, d = 1) {
  return fin(x) ? `${(x * 100).toFixed(d)}%` : '–';
}

export function statusLevel(st, nowMs, staleMs) {
  if (!st) return 'wait';
  if (st.ok === false) return 'down';
  if (fin(st.at) && nowMs - st.at > staleMs) return 'stale';
  return st.at ? 'up' : 'wait';
}
