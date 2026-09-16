// 把《快速转调练习》简谱 JSON 还原成音频
// 用: node render-jianpu.js <json> <out.wav> [--no-bb-shift]
const fs = require('fs');
const path = require('path');

const SRC = process.argv[2];
const OUT = process.argv[3];
const BB_SHIFT = !process.argv.includes('--no-bb-shift');
const PH6 = process.argv.includes('--bb-first6');
const SR = 44100;
const BPM = 60;                      // 用户指定：60（四分音符 = 1 秒）
const BEAT = 60 / BPM;               // 1.0 秒
const NOTE_UNITS = { '16th': 0.25, 'eighth': 0.5, 'quarter': 1, 'half': 2, 'whole': 4 };

const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const MAJ = [0, 2, 4, 5, 7, 9, 11];
// 主音 MIDI：由"内弦=D4(62)"这条约束反推（五段互相验证通过）
const KEYROOT = { '♭B': 58, 'B♭': 58, 'Bb': 58, 'F': 65, 'C': 60, 'G': 67, 'D': 62 };

/* ---------- 1. 铺时间轴 ---------- */
const events = [];
let t = 0;
for (const m of j.measures) {
  const key = KEYROOT[m.key] !== undefined ? m.key : j.starting_key;
  let shift = 0;
  const isBB = (m.key === '♭B' || m.key === 'B♭' || m.key === 'Bb');
  if (isBB && BB_SHIFT) {
    // PH6：只上移前 6 小节（第 1-6 小节用到了低于空弦的 1、2；
    //      第 7-12 小节原本就落在音域内，上移会顶到 F6）
    if (PH6 ? m.measure <= 6 : true) shift = 12;
  }
  for (const n of m.notes) {
    const dur = (NOTE_UNITS[n.duration] || 0.25) * BEAT;
    const midi = KEYROOT[key] + MAJ[n.degree - 1] + 12 * (n.octave || 0) + shift;
    events.push({ t, dur, midi, measure: m.measure, degree: n.degree, octave: n.octave || 0, key: m.key });
    t += dur;
  }
}
const pieceLen = t;                       // 126 秒
const COUNT_IN = 4 * BEAT;                // 4 拍预备
const total = COUNT_IN + pieceLen + 1.2;  // 尾巴留一点余量

const midiToFreq = m => 440 * Math.pow(2, (m - 69) / 12);
console.log(`音符 ${events.length} 个，旋律 ${pieceLen}s + 预备 ${COUNT_IN}s = 总长 ${total.toFixed(1)}s`);
console.log(`音域 ${Math.min(...events.map(e => e.midi))} ~ ${Math.max(...events.map(e => e.midi))} MIDI` +
  (BB_SHIFT ? '（bB 段已上移八度）' : '（bB 段按原样）'));

/* ---------- 2. 合成 ---------- */
const N = Math.ceil(total * SR);
const buf = new Float32Array(N);

// 三角波（纯净音：无噪声、有轻微泛音，比正弦厚实一点）
function tri(phase) { const p = phase - Math.floor(phase); return 4 * Math.abs(p - 0.5) - 1; }

// 旋律
for (const e of events) {
  const f = midiToFreq(e.midi);
  const start = Math.floor((COUNT_IN + e.t) * SR);
  const len = Math.floor(e.dur * SR);
  const atk = Math.floor(0.008 * SR), rel = Math.floor(0.045 * SR);
  const sus = Math.max(atk + 1, len - rel);
  let ph = 0;
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    let env;
    if (i < atk) env = i / atk;
    else if (i < sus) env = 1;
    else env = Math.max(0, 1 - (i - sus) / rel);
    ph += f / SR;
    buf[idx] += tri(ph) * env * 0.30;
  }
}

// 节拍轻点：每拍一声，2/4 的第一拍重一点
const beatCount = Math.ceil(pieceLen / BEAT);
for (let b = 0; b <= beatCount; b++) {
  const isDown = (b % 2 === 0);            // 2/4：每两拍一个强拍
  const f = isDown ? 1760 : 1319;
  const start = Math.floor((COUNT_IN + b * BEAT) * SR);
  const len = Math.floor(0.045 * SR);
  const amp = (b < 0 ? 0.22 : (isDown ? 0.20 : 0.13));
  for (let i = 0; i < len; i++) {
    const idx = start + i;
    if (idx >= N) break;
    buf[idx] += Math.sin(2 * Math.PI * f * i / SR) * Math.exp(-i / (0.012 * SR)) * amp;
  }
}
// 预备拍（旋律开始前 4 拍）
for (let b = 0; b < 4; b++) {
  const isDown = (b % 2 === 0);
  const f = isDown ? 1760 : 1319;
  const start = Math.floor(b * BEAT * SR);
  const len = Math.floor(0.06 * SR);
  for (let i = 0; i < len; i++) {
    buf[start + i] += Math.sin(2 * Math.PI * f * i / SR) * Math.exp(-i / (0.015 * SR)) * (isDown ? 0.26 : 0.17);
  }
}

/* ---------- 3. 归一化 + 写 WAV ---------- */
let peak = 0;
for (let i = 0; i < N; i++) peak = Math.max(peak, Math.abs(buf[i]));
const gain = peak > 0 ? 0.89 / peak : 1;
console.log(`峰值 ${peak.toFixed(3)} → 归一化增益 ${gain.toFixed(3)}`);

const out = Buffer.alloc(44 + N * 2);
out.write('RIFF', 0); out.writeUInt32LE(36 + N * 2, 4); out.write('WAVE', 8);
out.write('fmt ', 12); out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20);
out.writeUInt16LE(1, 22); out.writeUInt32LE(SR, 24); out.writeUInt32LE(SR * 2, 28);
out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
out.write('data', 36); out.writeUInt32LE(N * 2, 40);
for (let i = 0; i < N; i++) {
  const v = Math.max(-1, Math.min(1, buf[i] * gain));
  out.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
}
fs.writeFileSync(OUT, out);
console.log(`已写出 ${OUT}（${(out.length / 1048576).toFixed(1)} MB，${total.toFixed(1)}s）`);

// 附一份对照表，方便核对
const map = path.join(path.dirname(OUT), '转调练习-音高对照.txt');
const lines = ['# 《快速转调练习》音高对照（60 BPM，四分音符=1秒）', ''];
lines.push('# 说明：内弦 D4 / 外弦 A4（标准定弦），A4=440Hz' + (BB_SHIFT ? '；bB 段已上移一个八度' : ''));
lines.push('# 小节\t调\t简谱\t实际音高\t起始秒(含4拍预备)\t时长');
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
let prev = -1;
for (const e of events) {
  if (e.measure !== prev) {
    prev = e.measure;
    lines.push(`# ---- 第 ${e.measure} 小节  1=${e.key} ----`);
  }
  const nm = NAMES[((e.midi % 12) + 12) % 12] + (Math.floor(e.midi / 12) - 1);
  const dots = e.octave > 0 ? '̇'.repeat(e.octave) : (e.octave < 0 ? '̣'.repeat(-e.octave) : '');
  lines.push(`${e.measure}\t${e.key}\t${e.degree}${dots}\t${nm}\t${(COUNT_IN + e.t).toFixed(2)}\t${e.dur.toFixed(2)}`);
}
fs.writeFileSync(map, lines.join('\n'), 'utf8');
console.log(`已写出对照表 ${map}`);
