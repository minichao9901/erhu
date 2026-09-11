// 抽取 index.html 的 DSP 核心 + 音位模型，验证算法与乐理正确性
const fs = require('fs');
const src = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const B = '/* ===== DSP:CORE-BEGIN ===== */', E = '/* ===== DSP:CORE-END ===== */';
const i = src.indexOf(B), j = src.indexOf(E);
if (i < 0 || j < 0) { console.error('FAIL: 未找到 DSP 核心标记'); process.exit(1); }
const core = src.slice(i + B.length, j);

const api = new Function(core + `
return {detectPitchYIN,freqToNote,centsBetween,decimate,rms,median,
        buildSlots,degreeSemitones,findNearestSlot,midiToFreq,
        KEY_DEFS,OPEN_INNER_MIDI,OPEN_OUTER_MIDI,SLOTS_PER_STRING,BAND_SIZE};`)();
const { detectPitchYIN, freqToNote, centsBetween, decimate, rms, median,
        buildSlots, findNearestSlot, KEY_DEFS, OPEN_INNER_MIDI, OPEN_OUTER_MIDI,
        SLOTS_PER_STRING } = api;

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`); }
};

function tone({ freq, sr, n, partials = [[1, 1]], noise = 0, seed = 1 }) {
  const buf = new Float32Array(n);
  let s = seed;
  const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff * 2 - 1;
  for (let k = 0; k < n; k++) {
    let v = 0, norm = 0;
    for (const [mult, amp] of partials) { v += amp * Math.sin(2 * Math.PI * freq * mult * k / sr); norm += amp; }
    buf[k] = (v / norm) * 0.5 + noise * rnd();
  }
  return buf;
}
const centsOff = (f, ref) => 1200 * Math.log2(f / ref);
const SR = 48000, N = 4096;   // 与页面一致：48k 全量采集，不降采样

console.log('\n=== 1. 纯音精度 ===');
for (const f of [293.66, 440.0, 196.0, 587.33, 880.0, 110.0]) {
  const r = detectPitchYIN(tone({ freq: f, sr: SR, n: N }), SR, { minFreq: 90, maxFreq: 1200, threshold: 0.15 });
  const err = r ? centsOff(r.freq, f) : NaN;
  ok(`${f} Hz`, r && Math.abs(err) < 1.0, r ? `误差 ${err.toFixed(3)} 音分 clarity=${r.clarity.toFixed(3)}` : '未检出');
}

console.log('\n=== 1b. 高把位高频精度（面板顶端 A6=1760Hz，采样率越低越难测准）===');
for (const f of [1174.66, 1318.51, 1567.98, 1760.0]) {
  const r = detectPitchYIN(tone({ freq: f, sr: SR, n: N }), SR, { minFreq: 264, maxFreq: 2024, threshold: 0.15 });
  const err = r ? centsOff(r.freq, f) : NaN;
  const pass5 = r && Math.abs(err) < 5;
  ok(`${f} Hz 误差 < 5 音分（判绿门槛）`, pass5, r ? `误差 ${err.toFixed(2)} 音分，tau≈${(SR / f).toFixed(1)} 采样` : '未检出');
}
for (const f of [1174.66, 1760.0]) {
  const r = detectPitchYIN(tone({ freq: f, sr: SR, n: N, partials: [[1, 0.35], [2, 1.0], [3, 0.5], [4, 0.2]] }), SR,
                           { minFreq: 264, maxFreq: 2024, threshold: 0.15 });
  const err = r ? centsOff(r.freq, f) : NaN;
  ok(`${f} Hz 含强谐波`, r && Math.abs(err) < 8, r ? `误差 ${err.toFixed(2)} 音分` : '未检出');
}

console.log('\n=== 2. 二胡音色（基频弱、谐波强）—— 最易八度误判 ===');
const timbres = [
  { name: '基频弱于2次谐波', partials: [[1, 0.30], [2, 1.00], [3, 0.60], [4, 0.25]] },
  { name: '2次谐波极强', partials: [[1, 0.12], [2, 1.00], [3, 0.30]] },
  { name: '含 5/6 次谐波', partials: [[1, 0.6], [2, 0.9], [3, 0.7], [4, 0.5], [5, 0.35], [6, 0.2]] },
  { name: '纯正弦', partials: [[1, 1]] }
];
for (const t of timbres) {
  for (const f of [293.66, 440.0]) {
    const r = detectPitchYIN(tone({ freq: f, sr: SR, n: N, partials: t.partials }), SR, { minFreq: 90, maxFreq: 1200, threshold: 0.15 });
    const err = r ? centsOff(r.freq, f) : NaN;
    ok(`${t.name} @${f}Hz`, r && Math.abs(err) < 8, r ? `误差 ${err.toFixed(2)} 音分` : '未检出');
  }
}

console.log('\n=== 3. 噪声 / 静音拒绝 ===');
for (const noise of [0.02, 0.05, 0.1]) {
  const r = detectPitchYIN(tone({ freq: 293.66, sr: SR, n: N, noise }), SR, { minFreq: 90, maxFreq: 1200, threshold: 0.15 });
  ok(`噪声 ${noise}`, r && Math.abs(centsOff(r.freq, 293.66)) < 12, r ? `误差 ${centsOff(r.freq, 293.66).toFixed(2)} 音分` : '未检出');
}
ok('纯静音 -> null', detectPitchYIN(new Float32Array(N), SR, { minFreq: 90, maxFreq: 1200 }) === null);
const rw = detectPitchYIN(tone({ freq: 100, sr: SR, n: N, partials: [[1, 0]], noise: 1 }), SR, { minFreq: 90, maxFreq: 1200 });
ok('白噪声 -> 拒绝', !rw || rw.clarity < 0.8, rw ? `clarity=${rw.clarity.toFixed(3)}` : 'null');

console.log('\n=== 4. 音名 / 十二平均律 ===');
for (const [f, want] of [[293.66, 'D4'], [440.0, 'A4'], [261.63, 'C4'], [196.0, 'G3'], [587.33, 'D5']]) {
  const info = freqToNote(f, 440);
  ok(`${f} Hz -> ${want}`, info.full === want, `得到 ${info.full}`);
}

console.log('\n=== 5. 音位模型：1=D（15弦）===');
{
  const key = KEY_DEFS.find(k => k.id === 'D');
  const inner = buildSlots(key.root, OPEN_INNER_MIDI, SLOTS_PER_STRING, 440);
  const outer = buildSlots(key.root, OPEN_OUTER_MIDI, SLOTS_PER_STRING, 440);
  const names = inner.map(s => s.name).join(' ');
  ok('内弦 15 个音位', inner.length === 15, names);
  ok('内弦第1位 = D4 简谱1 无点', inner[0].name === 'D4' && inner[0].degree === 1 && inner[0].dots === 0);
  ok('内弦第5位 = A4 简谱5', inner[4].name === 'A4' && inner[4].degree === 5, `${inner[4].name} 简谱${inner[4].degree}`);
  ok('内弦第8位 = D5 简谱1 上一点', inner[7].name === 'D5' && inner[7].degree === 1 && inner[7].dots === 1,
     `${inner[7].name} 简谱${inner[7].degree} dots=${inner[7].dots}`);
  ok('内弦末位 = D6', inner[14].name === 'D6', inner[14].name);
  ok('外弦第1位 = A4 简谱5（空弦同位对齐内弦第5位）',
     outer[0].name === 'A4' && outer[0].degree === 5 && inner[4].name === 'A4' && inner[4].degree === 5,
     `外弦[0]=${outer[0].name}/${outer[0].degree}  内弦[4]=${inner[4].name}/${inner[4].degree}`);
  ok('外弦末位 = A6', outer[14].name === 'A6', outer[14].name);
  ok('两弦音位频率一致处：内弦[4]=外弦[0]', Math.abs(inner[4].freq - outer[0].freq) < 0.01);
  ok('内弦空弦 293.66 Hz', Math.abs(inner[0].freq - 293.66) < 0.01, inner[0].freq.toFixed(2));
  ok('外弦空弦 440.00 Hz', Math.abs(outer[0].freq - 440.00) < 0.01, outer[0].freq.toFixed(2));
  ok('弦式标记 = 15 弦', key.chord === '15 弦', key.chord);
}

console.log('\n=== 6. 六个调的弦式与简谱（专业正确性核心）===');
const expectChord = { D: '15', G: '52', F: '63', C: '26', A: '41', Bb: '37' };
for (const key of KEY_DEFS) {
  const inner = buildSlots(key.root, OPEN_INNER_MIDI, SLOTS_PER_STRING, 440);
  const outer = buildSlots(key.root, OPEN_OUTER_MIDI, SLOTS_PER_STRING, 440);
  const chord = String(inner[0].degree) + String(outer[0].degree);
  ok(`1=${key.label} 应为 ${expectChord[key.id]}弦`, chord === expectChord[key.id],
     `得到 ${chord}弦（内弦${inner[0].degree} dots=${inner[0].dots} / 外弦${outer[0].degree} dots=${outer[0].dots}）`);
  ok(`1=${key.label} 内弦空弦仍是 D4`, Math.abs(inner[0].freq - 293.66) < 0.01, inner[0].freq.toFixed(2) + ' Hz');
  ok(`1=${key.label} 外弦空弦仍是 A4`, Math.abs(outer[0].freq - 440.00) < 0.01, outer[0].freq.toFixed(2) + ' Hz');
  const asc = inner.every((s, k) => k === 0 || s.freq > inner[k - 1].freq);
  ok(`1=${key.label} 内弦音位严格递增`, asc);
}

console.log('\n=== 7. 八度点方向（简谱中音区锚定中央 C）===');
{
  const check = (keyId, expectInnerDots, expectOuterDots) => {
    const key = KEY_DEFS.find(k => k.id === keyId);
    const inner = buildSlots(key.root, OPEN_INNER_MIDI, SLOTS_PER_STRING, 440);
    const outer = buildSlots(key.root, OPEN_OUTER_MIDI, SLOTS_PER_STRING, 440);
    ok(`1=${key.label} 内弦空弦八度点 = ${expectInnerDots}`, inner[0].dots === expectInnerDots, `得到 ${inner[0].dots}`);
    ok(`1=${key.label} 外弦空弦八度点 = ${expectOuterDots}`, outer[0].dots === expectOuterDots, `得到 ${outer[0].dots}`);
  };
  check('D', 0, 0);    // 1=D：内弦 D4 就是中音 1
  check('G', -1, 0);   // 1=G：主音 G4，内弦 D4 低五度 → 低音 5̣
  check('F', -1, 0);   // 1=F：主音 F4，内弦 D4 → 低音 6̣
  check('C', 0, 0);    // 1=C：主音 C4，内弦 D4 就在中音区 → 2
  check('A', -1, 0);   // 1=A：主音 A4，内弦 D4 低七度 → 低音 4̣（外弦 A4 才是中音 1）
  check('Bb', -1, -1); // 1=bB：主音 bB4，两弦空弦都低一个八度 → 3̣ / 7̣
}

console.log('\n=== 8. 目标音位查找（箭头落点依据）===');
{
  const key = KEY_DEFS.find(k => k.id === 'D');
  const inner = buildSlots(key.root, OPEN_INNER_MIDI, SLOTS_PER_STRING, 440);
  const outer = buildSlots(key.root, OPEN_OUTER_MIDI, SLOTS_PER_STRING, 440);
  let r = findNearestSlot(440.0, inner);
  ok('拉准 A4 → 内弦第5位，偏差 0', r.slot.name === 'A4' && Math.abs(r.cents) < 0.01, `${r.slot.name} ${r.cents.toFixed(3)} 音分`);
  r = findNearestSlot(440.0 * Math.pow(2, 20 / 1200), inner);
  ok('偏高 20 音分 → 偏差 +20', Math.abs(r.cents - 20) < 0.5, `${r.cents.toFixed(2)} 音分`);
  r = findNearestSlot(440.0 * Math.pow(2, -35 / 1200), inner);
  ok('偏低 35 音分 → 偏差 -35', Math.abs(r.cents + 35) < 0.5, `${r.cents.toFixed(2)} 音分`);
  r = findNearestSlot(293.66, inner);
  ok('拉准 D4 → 内弦第1位（空弦）', r.slot.name === 'D4' && r.index === 0);
  r = findNearestSlot(587.33, outer);
  ok('外弦上的 D5 → 外弦第4位', r.slot.name === 'D5' && r.index === 3, `${r.slot.name} idx=${r.index}`);
  const rIn = findNearestSlot(587.33, inner), rOut = findNearestSlot(587.33, outer);
  ok('同一个 D5 两弦都能定位（内弦 idx7 / 外弦 idx3）', rIn.index === 7 && rOut.index === 3,
     `内弦${rIn.index} 外弦${rOut.index}`);
}

console.log('\n=== 9. 面板量程与检测范围 ===');
{
  const key = KEY_DEFS.find(k => k.id === 'D');
  const inner = buildSlots(key.root, OPEN_INNER_MIDI, SLOTS_PER_STRING, 440);
  const outer = buildSlots(key.root, OPEN_OUTER_MIDI, SLOTS_PER_STRING, 440);
  const lo = inner[0].freq, hi = Math.max(inner[14].freq, outer[14].freq);
  ok('量程覆盖两个八度以上', hi / lo > 4, `${lo.toFixed(0)}–${hi.toFixed(0)} Hz (${(Math.log2(hi / lo)).toFixed(2)} 个八度)`);
  ok('最低音 = 内弦空弦 D4', Math.abs(lo - 293.66) < 0.01);
  const buf = tone({ freq: 440, sr: SR, n: N });
  const r = detectPitchYIN(buf, SR, { minFreq: lo * 0.9, maxFreq: hi * 1.15, threshold: 0.15 });
  ok('面板量程内检测正常', r && Math.abs(centsOff(r.freq, 440)) < 1);
}

console.log('\n=== 10. 性能 ===');
{
  const perfBuf = tone({ freq: 293.66, sr: SR, n: N, partials: [[1, 0.3], [2, 1], [3, 0.5]] });
  for (let w = 0; w < 50; w++) detectPitchYIN(perfBuf, SR, { minFreq: 260, maxFreq: 2000 });
  const t0 = process.hrtime.bigint();
  const ITER = 500;
  for (let k = 0; k < ITER; k++) detectPitchYIN(perfBuf, SR, { minFreq: 260, maxFreq: 2000 });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / ITER;
  ok('单帧耗时 < 8ms', ms < 8, `${ms.toFixed(3)} ms/帧（26fps 占单核约 ${(ms / 38 * 100).toFixed(1)}%）`);
}

console.log('\n=== 11. 半音间距模型（面板排布依据）===');
{
  const key = KEY_DEFS.find(k => k.id === 'D');
  const inner = buildSlots(key.root, OPEN_INNER_MIDI, SLOTS_PER_STRING, 440);
  const outer = buildSlots(key.root, OPEN_OUTER_MIDI, SLOTS_PER_STRING, 440);
  const si = inner.map(s => s.semis), so = outer.map(s => s.semis);

  const wantInner = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
  const wantOuter = [0, 2, 4, 5, 7, 9, 10, 12, 14, 16, 17, 19, 21, 22, 24];
  ok('内弦半音序列（第6级=大七度 11 半音）', si.join(',') === wantInner.join(','), si.join(','));
  ok('外弦半音序列（第6级=小七度 10 半音）', so.join(',') === wantOuter.join(','), so.join(','));

  // 这正是"两弦不能共用 slotY"的原因：从主音数 6 级是大七度，从属音数 6 级是小七度
  ok('第7音位：内弦 C#5 / 外弦 G5，指距确实不同',
     inner[6].name === 'C#5' && inner[6].semis === 11 && outer[6].name === 'G5' && outer[6].semis === 10,
     `内弦 ${inner[6].name}/${inner[6].semis}  外弦 ${outer[6].name}/${outer[6].semis}`);
  ok('第1~6音位两弦指距完全一致（同位置对齐）',
     si.slice(0, 6).join(',') === so.slice(0, 6).join(','), si.slice(0, 6).join(',') + ' | ' + so.slice(0, 6).join(','));
  ok('第8音位（八度）两弦重新重合于 12 半音', si[7] === 12 && so[7] === 12);

  const gapsI = si.slice(1).map((v, i) => v - si[i]);
  const gapsO = so.slice(1).map((v, i) => v - so[i]);
  ok('内弦相邻间距只有 1/2 两种', gapsI.every(g => g === 1 || g === 2), gapsI.join(','));
  ok('外弦相邻间距只有 1/2 两种', gapsO.every(g => g === 1 || g === 2), gapsO.join(','));
  const pairI = gapsI.map((g, i) => g === 1 ? (inner[i].degree + '→' + inner[i + 1].degree) : null).filter(Boolean);
  const pairO = gapsO.map((g, i) => g === 1 ? (outer[i].degree + '→' + outer[i + 1].degree) : null).filter(Boolean);
  ok('内弦半音对 = 3→4 与 7→1', pairI.join(' ') === '3→4 7→1 3→4 7→1', pairI.join(' '));
  ok('外弦半音对 = 7→1 与 3→4（位置与内弦不同）', pairO.join(' ') === '7→1 3→4 7→1 3→4', pairO.join(' '));
  ok('两弦半音对位置确实错开一格', pairI[0] !== pairO[0], `内弦首对 ${pairI[0]} / 外弦首对 ${pairO[0]}`);

  // 把位：5 个音位 = 纯五度 = 7 个半音，两弦各段等高
  for (let b = 0; b < 3; b++) {
    ok(`第${b + 1}把位两弦跨度都是 7 个半音`,
       si[b * 5 + 4] - si[b * 5] === 7 && so[b * 5 + 4] - so[b * 5] === 7,
       `内弦 ${si[b * 5]}→${si[b * 5 + 4]}  外弦 ${so[b * 5]}→${so[b * 5 + 4]}`);
  }
  // 半音位置随调号变化：空弦在不同调里所处的音级不同，"往上数 6 级"可能是大七度也可能是小七度，
  // 所以面板排布必须按当前调重算，而且两根弦各算各的
  const EXPECT = {
    D:  { i: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24], o: [0, 2, 4, 5, 7, 9, 10, 12, 14, 16, 17, 19, 21, 22, 24] },
    G:  { i: [0, 2, 4, 5, 7, 9, 10, 12, 14, 16, 17, 19, 21, 22, 24], o: [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19, 21, 22, 24] },
    F:  { i: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24], o: [0, 1, 3, 5, 7, 8, 10, 12, 13, 15, 17, 19, 20, 22, 24] },
    C:  { i: [0, 2, 3, 5, 7, 9, 10, 12, 14, 15, 17, 19, 21, 22, 24], o: [0, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 20, 22, 24] },
    A:  { i: [0, 2, 4, 6, 7, 9, 11, 12, 14, 16, 18, 19, 21, 23, 24], o: [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24] },
    Bb: { i: [0, 1, 3, 5, 7, 8, 10, 12, 13, 15, 17, 19, 20, 22, 24], o: [0, 1, 3, 5, 6, 8, 10, 12, 13, 15, 17, 18, 20, 22, 24] }
  };
  for (const k of KEY_DEFS) {
    const a = buildSlots(k.root, OPEN_INNER_MIDI, SLOTS_PER_STRING, 440).map(x => x.semis);
    const b = buildSlots(k.root, OPEN_OUTER_MIDI, SLOTS_PER_STRING, 440).map(x => x.semis);
    ok(`1=${k.label} 内弦半音序列`, a.join(',') === EXPECT[k.id].i.join(','), a.join(','));
    ok(`1=${k.label} 外弦半音序列`, b.join(',') === EXPECT[k.id].o.join(','), b.join(','));
    ok(`1=${k.label} 相邻间距只有 1/2（仅半音/全音）`,
       a.slice(1).every((v, i) => v - a[i] === 1 || v - a[i] === 2) &&
       b.slice(1).every((v, i) => v - b[i] === 1 || v - b[i] === 2));
    // 每 5 个音位一个把位。1=D 时两弦跨度都正好是纯五度(7 个半音)；
    // 其它调因为音阶分组落在不同音级上，跨度会差 ±1 个半音（面板底色用并集自适应）
    const spans = [];
    for (const s of [a, b]) for (const n of [0, 1, 2]) spans.push(s[n * 5 + 4] - s[n * 5]);
    if (k.id === 'D') {
      ok('1=D 三个把位跨度都正好是纯五度(7 个半音)', spans.every(v => v === 7), spans.join(','));
    } else {
      ok(`1=${k.label} 把位跨度在 6~8 之间（音阶分组的自然差异）`,
         spans.every(v => v >= 6 && v <= 8), spans.join(','));
    }
  }
  ok('不同调的排布确实不同（说明必须随调重算）',
     EXPECT.D.i.join() !== EXPECT.G.i.join() && EXPECT.D.o.join() !== EXPECT.A.o.join());
}

console.log(`\n================ 结果: ${pass} 通过 / ${fail} 失败 ================\n`);
process.exit(fail ? 1 : 0);
