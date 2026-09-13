// 生成测试音频：模拟二胡各种演奏状态，16bit PCM WAV
const fs = require('fs');
const path = require('path');

const SR = 48000;
const OUT = process.argv[2] || __dirname;

function writeWav(file, samples) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write('data', 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    let v = Math.max(-1, Math.min(1, samples[i]));
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return buf.length;
}

/** 二胡音色合成
 *  partials  谐波结构 [倍数, 幅度]
 *  vibHz/vibCents  揉弦
 *  bowHz     运弓的力度起伏（真实演奏中音量在波动）
 *  bowNoise  弓毛摩擦噪声
 *  roomNoise 环境噪声
 *  amp       总音量
 */
function erhu({ freq, dur, partials = [[1, 0.5], [2, 0.85], [3, 1.0], [4, 0.7], [5, 0.45], [6, 0.3], [7, 0.2], [8, 0.12]],
                vibHz = 0, vibCents = 0, bowHz = 0, bowDepth = 0, bowNoise = 0.006, roomNoise = 0.002,
                amp = 0.35, seed = 1, fade = 0.05 }) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  let norm = 0; partials.forEach(p => norm += p[1]);
  let phase = 0;
  const fadeN = Math.round(fade * SR);
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    const vib = vibCents * Math.sin(2 * Math.PI * vibHz * t);
    const f = freq * Math.pow(2, vib / 1200);
    phase += 2 * Math.PI * f / SR;
    let v = 0;
    for (const [m, a] of partials) v += a * Math.sin(phase * m);
    v /= norm;
    const bow = 1 + bowDepth * Math.sin(2 * Math.PI * bowHz * t);
    let env = 1;
    if (i < fadeN) env = i / fadeN;
    else if (i > n - fadeN) env = (n - i) / fadeN;
    out[i] = (v * bow * env * amp) + bowNoise * rnd() * env + roomNoise * rnd();
  }
  return out;
}

function silence(dur, roomNoise = 0.002, seed = 99) {
  const n = Math.round(dur * SR);
  const out = new Float32Array(n);
  let s = seed >>> 0;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 * 2 - 1; };
  for (let i = 0; i < n; i++) out[i] = roomNoise * rnd();
  return out;
}

function concat(parts) {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Float32Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

const D4 = 293.66, E4 = 329.63, FS4 = 369.99, G4 = 392.00, A4 = 440.00;

const cases = [
  ['01-纯正弦-D4', erhu({ freq: D4, dur: 10, partials: [[1, 1]], bowNoise: 0.001, roomNoise: 0.001 })],
  ['02-二胡音色-D4', erhu({ freq: D4, dur: 10 })],
  ['03-弱基频-D4', erhu({ freq: D4, dur: 10, partials: [[1, 0.18], [2, 1.0], [3, 0.7], [4, 0.4], [5, 0.2]] })],
  ['04-揉弦-D4', erhu({ freq: D4, dur: 10, vibHz: 5.5, vibCents: 28, bowHz: 6, bowDepth: 0.12 })],
  ['05-轻奏(远)-D4', erhu({ freq: D4, dur: 10, amp: 0.06, bowNoise: 0.002, roomNoise: 0.0015 })],
  ['06-极轻(很远)-D4', erhu({ freq: D4, dur: 10, amp: 0.015, bowNoise: 0.001, roomNoise: 0.001 })],
  ['07-环境噪声', silence(3.5)],
  ['08-长弓音阶-D大调', concat([
    erhu({ freq: D4, dur: 1.2, seed: 11 }), erhu({ freq: E4, dur: 1.2, seed: 12 }),
    erhu({ freq: FS4, dur: 1.2, seed: 13 }), erhu({ freq: G4, dur: 1.2, seed: 14 }),
    erhu({ freq: A4, dur: 1.2, seed: 15 })
  ])],
  ['09-外弦A4', erhu({ freq: A4, dur: 10, seed: 21 })],
  ['10-三把位D6', erhu({ freq: 1174.66, dur: 10, seed: 22 })]
];

console.log('生成测试音频（48kHz 16bit 单声道）:\n');
for (const [name, samples] of cases) {
  const f = path.join(OUT, 'erhu-' + name + '.wav');
  const size = writeWav(f, samples);
  // 算一下 RMS 便于对照
  let sum = 0; for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  console.log(`  ${name.padEnd(22)} ${(samples.length / SR).toFixed(1)}s  ${(size / 1024).toFixed(0)} KB  RMS=${rms.toFixed(4)} (${(20 * Math.log10(rms)).toFixed(1)} dBFS)`);
}
console.log('\n目录: ' + OUT);
