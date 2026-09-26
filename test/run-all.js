// 一次跑完所有测试套件：node test/run-all.js
const { execFileSync } = require('child_process');
const path = require('path');

const suites = ['dsp.test.js', 'ui.test.js', 'score.test.js'];
let failed = 0;
const summary = [];

for (const f of suites) {
  console.log('\n════════ ' + f + ' ════════');
  try {
    execFileSync(process.execPath, [path.join(__dirname, f)], { stdio: 'inherit' });
    summary.push('  ✓ ' + f);
  } catch (e) {
    failed++;
    summary.push('  ✗ ' + f + '（失败）');
  }
}

console.log('\n════════ 汇总 ════════');
summary.forEach(s => console.log(s));
console.log(failed ? '\n✗ 有套件未通过\n' : '\n✓ 全部通过\n');
process.exit(failed ? 1 : 0);
