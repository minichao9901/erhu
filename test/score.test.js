// 锁定谱面校对结果与转调切点，避免重生音频时退回旧版本。
const assert = require('node:assert/strict');
const path = require('node:path');
const score = require(path.join(__dirname, '..', '快速转调练习_简谱.json'));

assert.deepEqual(score.key_sections.map(s => [s.key, s.from_measure]),
  [['♭B', 1], ['F', 13], ['C', 25], ['G', 37], ['D', 49]]);
for (const measure of score.measures) {
  const section = score.key_sections.filter(s => s.from_measure <= measure.measure).at(-1);
  assert.equal(measure.key, section.key, `第 ${measure.measure} 小节调号`);
}

const at = n => score.measures.find(m => m.measure === n);
assert.equal(at(34).notes[0].degree, 6);
assert.equal(at(34).notes[0].octave, 0, '第34小节 6333 的首音 6 没有高八度点');
assert.equal(at(34).jianpu.startsWith('6 3̇'), true);
assert.equal(at(48).notes.map(n => n.degree).join(''), '56543432');
assert.equal(at(49).notes.map(n => n.degree).join(''), '41117111');

const units = { '16th': 0.25, eighth: 0.5, quarter: 1, half: 2, whole: 4 };
const beatsBefore = n => score.measures.filter(m => m.measure < n)
  .flatMap(m => m.notes).reduce((sum, note) => sum + units[note.duration], 0);
assert.equal(beatsBefore(49) - beatsBefore(37), 24, 'G 调段应有 24 拍');
assert.equal(beatsBefore(49), 96, '60 BPM 时转 D 点应为含预备拍的第 100 秒');

console.log('谱面与分段切点：全部通过（G 第37–48小节；D 从第49小节起）');
