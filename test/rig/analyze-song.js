// 对真实二胡录音跑线上同一套算法，做逐帧基频分析 + 转谱
// 用法: node analyze-song.js <wav> [起始秒] [时长秒]
const fs = require('fs');
const path = require('path');

const REPO = 'E:/VibeCoding/erhu-tuner';
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const B = '/* ===== DSP:CORE-BEGIN ===== */', E = '/* ===== DSP:CORE-END ===== */';
const core = html.slice(html.indexOf(B) + B.length, html.indexOf(E));
const api = new Function(core + `
  return {detectPitchYIN, buildSlots, KEY_DEFS, OPEN_INNER_MIDI, SLOTS_PER_STRING,
          centsBetween, rms, median, freqToNote};`)();

// ---- 读 WAV（只处理 ffmpeg 输出的 float32）----
function readWav(file) {
  const buf = fs.readFileSync(file);
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('不是 WAV');
  let off = 12, fmt = null, dataOff = 0, dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString('ascii', off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { format: buf.readUInt16LE(off + 8), channels: buf.readUInt16LE(off + 10), rate: buf.readUInt32LE(off + 12), bits: buf.readUInt16LE(off + 22) };
    else if (id === 'data') { dataOff = off + 8; dataLen = size; break; }
    off += 8 + size + (size & 1);
  }
  if (!fmt || !dataOff) throw new Error('WAV 缺 fmt/data');
  const n = Math.floor(dataLen / (fmt.bits / 8));
  const out = new Float32Array(n);
  if (fmt.format === 3) { for (let i = 0; i < n; i++) out[i] = buf.readFloatLE(dataOff + i * 4); }
  else if (fmt.bits === 16) { for (let i = 0; i < n; i++) out[i] = buf.readInt16LE(dataOff + i * 2) / 32768; }
  else throw new Error('不支持的位深 ' + fmt.bits);
  return { data: out, rate: fmt.rate, channels: fmt.channels };
}

const file = process.argv[2];
const startSec = parseFloat(process.argv[3] || '0');
const durSec = parseFloat(process.argv[4] || '0');
const wav = readWav(file);
const SR = wav.rate;
let src = wav.data;
if (startSec > 0 || durSec > 0) {
  const a = Math.floor(startSec * SR);
  const b = durSec > 0 ? Math.min(src.length, a + Math.floor(durSec * SR)) : src.length;
  src = src.subarray(a, b);
}
console.log(`文件: ${path.basename(file)}  ${SR}Hz  ${(src.length / SR).toFixed(1)}s`);

// ---- 参数直接从 index.html 里读，保证永远和线上一致 ----
function num(name, def) {
  const m = new RegExp('var\\s+' + name + '\\s*=\\s*(-?[0-9.]+)').exec(html);
  return m ? parseFloat(m[1]) : def;
}
const P = {
  FFT: num('FFT_SIZE', 4096), HOP: 1824,          // 步进 38ms（页面按 ts 节流，约 26fps）
  MIN_RMS: num('MIN_RMS', 0.0008),
  SILENCE_RATIO: num('SILENCE_RATIO', 1.8),
  YIN_TH: num('YIN_THRESHOLD', 0.15),
  CLARITY_MIN: num('CLARITY_MIN', 0.55),
  CLARITY_MIN_CONT: num('CLARITY_MIN_CONT', 0.25),
  CLARITY_FAST: num('CLARITY_FAST', 0.80),
  SMOOTH_N: num('SMOOTH_N', 3),
  STABLE_N: num('STABLE_N', 2),
  STABLE_CENTS: num('STABLE_CENTS', 250)
};
console.log('页面参数:', JSON.stringify(P));
const key = api.KEY_DEFS[0];
const slots = api.buildSlots(key.root, api.OPEN_INNER_MIDI, api.SLOTS_PER_STRING, 440);
const RANGE = { lo: slots[0].freq * 0.9, hi: 1760 * 1.15 };

// ---- 逐帧分析 ----
const rows = [];
let noiseFloor = P.MIN_RMS, smoothing = [], candFreq = 0, candN = 0;
const st = { frames: 0, ok: 0, gated: 0, nodetect: 0, lowclarity: 0, unstable: 0 };
for (let end = P.FFT; end < src.length; end += P.HOP) {
  st.frames++;
  const win = src.subarray(end - P.FFT, end);
  const level = api.rms(win);
  const db = 20 * Math.log10(Math.max(level, 1e-6));
  const t = (end - P.FFT / 2) / SR;
  const gate = Math.max(P.MIN_RMS, noiseFloor * P.SILENCE_RATIO);
  if (level < gate) { st.gated++; noiseFloor = noiseFloor * 0.9 + level * 0.1; rows.push({ t, db, state: 'gated' }); continue; }
  const r = api.detectPitchYIN(win, SR, { minFreq: RANGE.lo, maxFreq: RANGE.hi, threshold: P.YIN_TH });
  if (!r) { st.nodetect++; rows.push({ t, db, state: 'nodetect' }); continue; }
  if (r.clarity < P.CLARITY_MIN) {
    const consistent = smoothing.length >= 3 && Math.abs(api.centsBetween(r.freq, api.median(smoothing))) < 50;
    if (!(consistent && r.clarity >= P.CLARITY_MIN_CONT)) { st.lowclarity++; rows.push({ t, db, state: 'lowclarity', f: r.freq, cl: r.clarity }); continue; }
  }
  // 稳定性判定（与页面一致的自适应逻辑）
  if (r.clarity < P.CLARITY_FAST) {
    if (candFreq && Math.abs(api.centsBetween(r.freq, candFreq)) <= P.STABLE_CENTS) candN++;
    else { candFreq = r.freq; candN = 1; }
    if (candN < P.STABLE_N) { st.unstable++; rows.push({ t, db, state: 'unstable' }); continue; }
  } else { candFreq = r.freq; candN = P.STABLE_N; }
  smoothing.push(r.freq); if (smoothing.length > P.SMOOTH_N) smoothing.shift();
  var med = api.median(smoothing);
  st.ok++;
  const info = api.freqToNote(med, 440);
  rows.push({ t, db, state: 'ok', f: med, cl: r.clarity, note: info.full, cents: info.cents });
}

const pct = v => (v / st.frames * 100).toFixed(1) + '%';
console.log('\n=== 逐帧统计（线上算法，逐字未改）===');
console.log(`  总帧 ${st.frames}  成功 ${st.ok} (${pct(st.ok)})`);
console.log(`  音量低于门限 ${st.gated} (${pct(st.gated)})`);
console.log(`  认不出基频   ${st.nodetect} (${pct(st.nodetect)})`);
console.log(`  可信度不足   ${st.lowclarity} (${pct(st.lowclarity)})`);
console.log(`  帧间不稳     ${st.unstable} (${pct(st.unstable)})`);

// 有效帧里的八度异常检查（相邻帧频率比接近 2 或 1/2 且持续）
let octaveJumps = 0;
for (let i = 1; i < rows.length; i++) {
  if (rows[i].state === 'ok' && rows[i - 1].state === 'ok') {
    const ratio = rows[i].f / rows[i - 1].f;
    if (ratio > 1.9 && ratio < 2.1 || ratio > 0.47 && ratio < 0.53) octaveJumps++;
  }
}
console.log(`  相邻帧八度跳变次数 ${octaveJumps}`);

// ---- 转谱：把连续同音合并成音符 ----
const notes = [];
for (const r of rows) {
  if (r.state !== 'ok') { if (notes.length) notes[notes.length - 1].gap = true; continue; }
  const last = notes[notes.length - 1];
  if (last && !last.gap && last.note === r.note) {
    last.end = r.t; last.centsSum += r.cents; last.n++; last.fSum += r.f;
  } else {
    notes.push({ note: r.note, start: r.t, end: r.t, centsSum: r.cents, n: 1, fSum: r.f, gap: false });
  }
}
const clean = notes.filter(n => n.n >= 2);          // 至少两帧才算一个音（>38ms）
console.log(`\n=== 转谱：共 ${clean.length} 个音（≥2帧，即 ≥38ms）===`);
const durs = clean.map(n => n.end - n.start + 0.038);
const dursSorted = durs.slice().sort((a, b) => a - b);
console.log(`  音长: 最短 ${dursSorted[0].toFixed(2)}s  中位 ${dursSorted[dursSorted.length >> 1].toFixed(2)}s  最长 ${dursSorted[dursSorted.length - 1].toFixed(2)}s`);
const fast = durs.filter(d => d < 0.15).length;
console.log(`  短于 0.15s 的音: ${fast} 个（快板段落，最考验跟踪速度）`);
const centsAbs = clean.map(n => Math.abs(n.centsSum / n.n));
const avgDev = centsAbs.reduce((a, b) => a + b, 0) / centsAbs.length;
console.log(`  每个音的平均音分偏差取绝对值后平均: ${avgDev.toFixed(1)} 音分（含演奏本身的音准波动）`);

// 音符分布（看有没有系统性八度错误）
const hist = {};
for (const n of clean) hist[n.note] = (hist[n.note] || 0) + 1;
const histSorted = Object.entries(hist).sort((a, b) => b[1] - a[1]);
console.log(`\n  音高分布（前 15）: ${histSorted.slice(0, 15).map(([k, v]) => k + '×' + v).join('  ')}`);

// ---- 输出转谱文本，便于对着谱子核 ----
const outTxt = path.join(path.dirname(file), path.basename(file, '.wav') + '-notes.txt');
let lines = ['# ' + path.basename(file) + ' 转谱（线上算法逐字未改）', ''];
lines.push('# 起始(s)  时长(s)  音名   平均音分  帧数');
for (const n of clean) {
  lines.push(`${n.start.toFixed(2)}\t${(n.end - n.start + 0.038).toFixed(2)}\t${n.note}\t${(n.centsSum / n.n).toFixed(1)}\t${n.n}`);
}
fs.writeFileSync(outTxt, lines.join('\n'), 'utf8');
console.log(`\n转谱已写入: ${outTxt}`);

// ---- 快板段落抽查：跟踪延迟 ----
console.log('\n=== 快板段落抽查（音长 < 0.15s 的连续片段）===');
let shown = 0;
for (let i = 0; i < clean.length - 4 && shown < 3; i++) {
  const seg = clean.slice(i, i + 6);
  if (seg.every(n => (n.end - n.start) < 0.15)) {
    console.log('  ' + seg.map(n => `${n.note}(${n.start.toFixed(2)}s)`).join(' → '));
    shown++;
    i += 6;
  }
}
if (!shown) console.log('  未找到连续 6 个短音');

// ---- 失败帧上下文（看失败发生在什么时候）----
const failRuns = [];
let run = null;
for (const r of rows) {
  if (r.state !== 'ok') {
    if (!run) run = { state: r.state, start: r.t, n: 0 };
    run.n++;
  } else if (run) { run.end = r.t; failRuns.push(run); run = null; }
}
if (run) { run.end = rows[rows.length - 1].t; failRuns.push(run); }
const longRuns = failRuns.filter(r => r.n >= 5).sort((a, b) => b.n - a.n);
console.log(`\n=== 连续失败段（≥5 帧 ≈ 0.19s），共 ${failRuns.length} 段，最长 ${failRuns.length ? Math.max(...failRuns.map(r => r.n)) : 0} 帧 ===`);
for (const r of longRuns.slice(0, 8)) {
  const seg = rows.filter(x => x.t >= r.start - 0.1 && x.t <= r.end + 0.1).map(x => x.db.toFixed(0));
  console.log(`  ${r.start.toFixed(2)}–${r.end.toFixed(2)}s  ${r.n} 帧  ${r.state}  该段电平(dBFS): ${seg.slice(0, 8).join(' ')}`);
}
