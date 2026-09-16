// 回环验证：把生成的音频解回来，逐音检测，与 JSON 对照
const fs = require('fs'), path = require('path');
const REPO = 'E:/VibeCoding/erhu-tuner';
const html = fs.readFileSync(path.join(REPO, 'index.html'), 'utf8');
const B = '/* ===== DSP:CORE-BEGIN ===== */', E = '/* ===== DSP:CORE-END ===== */';
const api = new Function(html.slice(html.indexOf(B) + B.length, html.indexOf(E)) +
  'return {detectPitchYIN, rms, centsBetween};')();

function readWav(f) {
  const b = fs.readFileSync(f); let o = 12, fmt = null, d0 = 0, dl = 0;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4), s = b.readUInt32LE(o + 4);
    if (id === 'fmt ') fmt = { format: b.readUInt16LE(o + 8), rate: b.readUInt32LE(o + 12), bits: b.readUInt16LE(o + 22) };
    else if (id === 'data') { d0 = o + 8; dl = s; break; }
    o += 8 + s + (s & 1);
  }
  const n = Math.floor(dl / (fmt.bits / 8)), out = new Float32Array(n);
  if (fmt.format === 3) for (let i = 0; i < n; i++) out[i] = b.readFloatLE(d0 + i * 4);
  else for (let i = 0; i < n; i++) out[i] = b.readInt16LE(d0 + i * 2) / 32768;
  return { data: out, rate: fmt.rate };
}

const j = JSON.parse(fs.readFileSync(path.join(REPO, '快速转调练习_简谱.json'), 'utf8'));
const MAJ = [0, 2, 4, 5, 7, 9, 11];
const KEYROOT = { '♭B': 58, 'B♭': 58, 'Bb': 58, 'F': 65, 'C': 60, 'G': 67, 'D': 62 };
const BB_SHIFT = !process.argv.includes('--no-bb-shift');
const PH6 = process.argv.includes('--bb-first6');
const bpmArg = process.argv.find(a => a.startsWith('--bpm='));
const BPM = bpmArg ? parseFloat(bpmArg.split('=')[1]) : 60;
const BEAT = 60 / BPM, COUNT_IN = 4 * BEAT;
const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);

// 期望时间轴
const expect = [];
let t = 0;
for (const m of j.measures) {
  const shift = 0;   // JSON 已修正
  for (const n of m.notes) {
    const dur = (n.duration === 'quarter' ? 1 : 0.25) * BEAT;
    expect.push({ t: COUNT_IN + t, dur, midi: KEYROOT[m.key] + MAJ[n.degree - 1] + 12 * (n.octave || 0) + shift, measure: m.measure });
    t += dur;
  }
}

const wav = readWav(process.argv[2]);
const src = wav.data, SR = wav.rate;
const N = 4096, HALF = N >> 1;

// 在音符中段取样检测（避开起音与节拍轻点）
let ok = 0, miss = 0; const errs = [], bad = [];
for (const e of expect) {
  const mid = Math.floor((e.t + e.dur * 0.5) * SR);
  if (mid - HALF < 0 || mid + HALF >= src.length) { miss++; continue; }
  const win = src.subarray(mid - HALF, mid + HALF);
  const r = api.detectPitchYIN(win, SR, { minFreq: 200, maxFreq: 2200, threshold: 0.15 });
  const want = midiToFreq(e.midi);
  if (!r) { miss++; bad.push({ ...e, got: null }); continue; }
  const c = api.centsBetween(r.freq, want);
  if (Math.abs(c) < 50) ok++; else bad.push({ ...e, got: r.freq, cents: c });
  errs.push(Math.abs(c));
}
errs.sort((a, b) => a - b);
console.log(`\n=== 回环验证（对生成的音频逐音检测）===`);
console.log(`  期望音符 ${expect.length} 个`);
console.log(`  正确检出 ${ok} 个（${(ok / expect.length * 100).toFixed(1)}%）`);
console.log(`  偏差 >50 音分或未检出 ${bad.length} 个`);
if (errs.length) {
  console.log(`  音分误差: 中位 ${errs[errs.length >> 1].toFixed(2)}，90%分位 ${errs[Math.floor(errs.length * 0.9)].toFixed(2)}，最大 ${errs[errs.length - 1].toFixed(2)}`);
}
if (bad.length) {
  console.log('\n  异常明细（前 10）:');
  const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  for (const b of bad.slice(0, 10)) {
    const wn = NAMES[((b.midi % 12) + 12) % 12] + (Math.floor(b.midi / 12) - 1);
    const gn = b.got ? NAMES[((Math.round(69 + 12 * Math.log2(b.got / 440)) % 12) + 12) % 12] + (Math.floor((69 + 12 * Math.log2(b.got / 440)) / 12) - 1) : '未检出';
    console.log(`    第${b.measure}小节 ${b.t.toFixed(2)}s 期望 ${wn} 实得 ${gn}${b.cents !== undefined ? ' (' + b.cents.toFixed(1) + '音分)' : ''}`);
  }
}
// 顺带核对总时长与节拍数
console.log(`\n  音频时长 ${(src.length / SR).toFixed(1)}s，期望 ${(COUNT_IN + t).toFixed(1)}s`);
