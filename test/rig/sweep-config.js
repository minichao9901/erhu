// 参数扫描：在真实二胡录音上比较不同配置，用数据决定参数
const fs = require('fs');
const path = require('path');

const REPO = 'E:/VibeCoding/erhu-tuner';
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const B = '/* ===== DSP:CORE-BEGIN ===== */', E = '/* ===== DSP:CORE-END ===== */';
const core = html.slice(html.indexOf(B) + B.length, html.indexOf(E));
const api = new Function(core + `
  return {detectPitchYIN, buildSlots, KEY_DEFS, OPEN_INNER_MIDI, SLOTS_PER_STRING,
          centsBetween, rms, median, freqToNote};`)();

function readWav(file) {
  const buf = fs.readFileSync(file);
  let off = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    else if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size & 1);
  }
  const n = Math.floor(dataLen / (fmt.bits / 8));
  const out = new Float32Array(n);
  if (fmt.format === 3) for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(dataOff + i * 4);
  else for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(dataOff + i * 2) / 32768;
  return { data: out, rate: fmt.rate };
}

const file = process.argv[2];
const wav = readWav(file);
const SR = wav.rate, src = wav.data;
const key = api.KEY_DEFS[0];
const slots = api.buildSlots(key.root, api.OPEN_INNER_MIDI, api.SLOTS_PER_STRING, 440);
const RANGE = { lo: slots[0].freq * 0.9, hi: 1760 * 1.15 };

const MIN_RMS = 0.0008, SILENCE_RATIO = 1.8, YIN_TH = 0.15;
const CLARITY_MIN = 0.55, CLARITY_MIN_CONT = 0.25;

/** 跑一种配置，返回统计 + 转谱
 *  stability: 'median'    老逻辑（比中位数）
 *             'candidate' 连续 N 帧同一音高才算数
 *             'adaptive'  可信度高 → 立即响应；可信度一般 → 要求连续 N 帧（抗噪但不拖快板）
 *             'off'       不判
 */
function run(cfg) {
  const { FFT, SMOOTH_N, STABLE_N, STABLE_CENTS, SMOOTH_RESET_CENTS, stability, HIGH_CL } = cfg;
  const HOP = 1824;
  let noiseFloor = MIN_RMS, smoothing = [], cand = 0, candN = 0;
  const st = { frames: 0, ok: 0, gated: 0, nodetect: 0, lowclarity: 0, unstable: 0 };
  const notes = [];
  for (let end = FFT; end < src.length; end += HOP) {
    st.frames++;
    const win = src.subarray(end - FFT, end);
    const level = api.rms(win);
    const t = (end - FFT / 2) / SR;
    const gate = Math.max(MIN_RMS, noiseFloor * SILENCE_RATIO);
    if (level < gate) { st.gated++; noiseFloor = noiseFloor * 0.9 + level * 0.1; if (notes.length) notes[notes.length - 1].gap = true; continue; }
    const r = api.detectPitchYIN(win, SR, { minFreq: RANGE.lo, maxFreq: RANGE.hi, threshold: YIN_TH });
    if (!r) { st.nodetect++; if (notes.length) notes[notes.length - 1].gap = true; continue; }
    if (r.clarity < CLARITY_MIN) {
      const consistent = smoothing.length >= 3 && Math.abs(api.centsBetween(r.freq, api.median(smoothing))) < 50;
      if (!(consistent && r.clarity >= CLARITY_MIN_CONT)) { st.lowclarity++; if (notes.length) notes[notes.length - 1].gap = true; continue; }
    }
    // 稳定性判定
    let needCheck = true;
    if (stability === 'off') needCheck = false;
    else if (stability === 'adaptive' && r.clarity >= (HIGH_CL || 0.75)) needCheck = false;   // 信号清晰 → 立即信
    if (needCheck && stability !== 'off') {
      if (stability === 'median' && smoothing.length >= STABLE_N) {
        const pm = api.median(smoothing);
        if (Math.abs(api.centsBetween(r.freq, pm)) > STABLE_CENTS) { st.unstable++; cand = 0; candN = 0; if (notes.length) notes[notes.length - 1].gap = true; continue; }
      } else if (stability === 'candidate' || stability === 'adaptive') {
        if (cand && Math.abs(api.centsBetween(r.freq, cand)) <= STABLE_CENTS) candN++;
        else { cand = r.freq; candN = 1; }
        if (candN < STABLE_N) { st.unstable++; if (notes.length) notes[notes.length - 1].gap = true; continue; }
      }
    }
    st.ok++;
    if (SMOOTH_RESET_CENTS && smoothing.length &&
        Math.abs(api.centsBetween(r.freq, api.median(smoothing))) >= SMOOTH_RESET_CENTS) smoothing = [];
    smoothing.push(r.freq); if (smoothing.length > SMOOTH_N) smoothing.shift();
    const med = api.median(smoothing);
    const info = api.freqToNote(med, 440);
    const last = notes[notes.length - 1];
    if (last && !last.gap && last.note === info.full) { last.end = t; last.n++; last.centsSum += info.cents; }
    else notes.push({ note: info.full, start: t, end: t, n: 1, centsSum: info.cents, gap: false });
  }
  const clean = notes.filter(n => n.n >= 2);
  const durs = clean.map(n => n.end - n.start + 0.038);
  const short = durs.filter(d => d < 0.15).length;
  const medDur = durs.length ? durs.slice().sort((a, b) => a - b)[durs.length >> 1] : 0;
  const frag = clean.length ? (clean.length / Math.max(1, new Set(clean.map(n => n.note)).size)) : 0;
  return { st, okRate: st.ok / st.frames, medDur, short, notes: clean.length, frag };
}

const configs = [
  { name: 'A 旧版(窗4096/平滑5/中位数判稳)', FFT: 4096, SMOOTH_N: 5, STABLE_N: 2, STABLE_CENTS: 250, stability: 'median' },
  { name: 'H 窗2048/平滑3/自适应判稳', FFT: 2048, SMOOTH_N: 3, STABLE_N: 2, STABLE_CENTS: 250, stability: 'adaptive' },
  { name: 'I 窗4096/平滑3/自适应判稳', FFT: 4096, SMOOTH_N: 3, STABLE_N: 2, STABLE_CENTS: 250, stability: 'adaptive' },
  { name: 'J 窗2048/平滑3/不判稳', FFT: 2048, SMOOTH_N: 3, STABLE_N: 2, STABLE_CENTS: 250, stability: 'off' },
  { name: 'K 窗2048/平滑5/自适应判稳', FFT: 2048, SMOOTH_N: 5, STABLE_N: 2, STABLE_CENTS: 250, stability: 'adaptive' },
  { name: 'L 窗2048/平滑3/自适应(高门槛0.6)', FFT: 2048, SMOOTH_N: 3, STABLE_N: 2, STABLE_CENTS: 250, stability: 'adaptive', HIGH_CL: 0.6 },
  { name: 'M 现版(4096/平滑3/换音清窗)', FFT: 4096, SMOOTH_N: 3, SMOOTH_RESET_CENTS: 75, STABLE_N: 2, STABLE_CENTS: 250, stability: 'adaptive', HIGH_CL: 0.80 }
];

console.log(`文件 ${path.basename(file)}  ${(src.length / SR).toFixed(1)}s\n`);
console.log('配置                              | 检出率 | 不稳 | 认不出 | 转谱音数 | 音长中位 | <0.15s');
console.log('----------------------------------|--------|------|--------|----------|----------|-------');
const results = [];
for (const c of configs) {
  const r = run(c);
  console.log(`${c.name.padEnd(33)} | ${(r.okRate * 100).toFixed(1).padStart(5)}% | ${String(r.st.unstable).padStart(4)} | ${String(r.st.nodetect).padStart(6)} | ${String(r.notes).padStart(8)} | ${r.medDur.toFixed(2).padStart(7)}s | ${String(r.short).padStart(5)}`);
  results.push({ c, r });
}
const best = results.slice().sort((a, b) => b.r.okRate - a.r.okRate)[0];
console.log(`\n检出率最高: ${best.c.name} → ${(best.r.okRate * 100).toFixed(1)}%`);
const bestFrag = results.slice().sort((a, b) => a.r.frag - b.r.frag)[0];
console.log(`转谱最不碎: ${bestFrag.c.name} → 碎片比 ${bestFrag.r.frag.toFixed(1)}`);
