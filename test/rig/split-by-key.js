// 按调式段落切分练习音频
// 用法: node split-by-key.js <简谱.json> <wav目录> <输出目录>
const fs = require('fs'), path = require('path');
const { execFileSync } = require('child_process');

const SRC = process.argv[2], WAVDIR = process.argv[3], OUTDIR = process.argv[4];
const FFMPEG = 'E:\\VibeCoding\\Xuhaoyan_视频裁剪\\ffmpeg_local\\ffmpeg-8.1.2-essentials_build\\bin\\ffmpeg.exe';
const j = JSON.parse(fs.readFileSync(SRC, 'utf8'));
const UNIT = { '16th': 0.25, 'eighth': 0.5, 'quarter': 1, 'half': 2, 'whole': 4 };

// 段名：中文调号 + 弦式
const KEYNAME = { '♭B': '降B', 'B♭': '降B', 'Bb': '降B', 'F': 'F', 'C': 'C', 'G': 'G', 'D': 'D' };
fs.mkdirSync(OUTDIR, { recursive: true });

for (const bpm of [30, 60]) {
  const BEAT = 60 / bpm;
  const COUNT_IN = 4 * BEAT;
  const wav = path.join(WAVDIR, `v${bpm}.wav`);
  if (!fs.existsSync(wav)) { console.log(`缺 ${wav}，跳过 ${bpm} BPM`); continue; }

  // 逐小节累计时间
  const measureStart = {};
  let t = 0;
  for (const m of j.measures) {
    measureStart[m.measure] = COUNT_IN + t;
    for (const n of m.notes) t += (UNIT[n.duration] || 0.25) * BEAT;
  }
  const pieceEnd = COUNT_IN + t;

  console.log(`\n════ ${bpm} BPM（四分音符 = ${BEAT} 秒）════`);
  for (let i = 0; i < j.key_sections.length; i++) {
    const ks = j.key_sections[i];
    const next = j.key_sections.find(x => x.from_measure > ks.from_measure);
    const to = (next ? next.from_measure : j.total_measures + 1) - 1;
    const start = measureStart[ks.from_measure];
    const end = next ? measureStart[next.from_measure] : pieceEnd;
    const dur = end - start;

    // 弦式：3 7弦 这种
    const chord = String(ks.tuning_inner_string).replace(/\(低音\)/, '') +
                  String(ks.tuning_outer_string).replace(/\(低音\)/, '') + '弦';
    const keyCn = KEYNAME[ks.key] || ks.key;
    const segNo = i + 1;
    const base = `快速转调练习_${bpm}BPM_段${segNo}_${keyCn}_${chord}`;
    const out = path.join(OUTDIR, base + '.mp3');

    execFileSync(FFMPEG, [
      '-hide_banner', '-loglevel', 'error',
      '-ss', start.toFixed(3), '-t', dur.toFixed(3),
      '-i', wav,
      '-codec:a', 'libmp3lame', '-b:a', '192k',
      '-metadata', `title=快速转调练习 段${segNo} 1=${ks.key}（${chord}）`,
      '-metadata', 'artist=刘逸安、赵寒阳 编曲（第六级练习曲）',
      '-metadata', `comment=${bpm} BPM · 第${ks.from_measure}-${to}小节 · 内弦D4/外弦A4 · A4=440Hz`,
      '-y', out
    ], { stdio: 'pipe' });

    const mm = Math.floor(start / 60), ss = (start % 60).toFixed(1).padStart(4, '0');
    console.log(`  段${segNo} 1=${ks.key.padEnd(2)} ${chord.padEnd(4)} 第${String(ks.from_measure).padStart(2)}-${String(to).padStart(2)}小节  ` +
      `${mm}:${ss} 起  时长 ${dur.toFixed(1)}s  →  ${base}.mp3`);
  }
}
console.log(`\n输出目录: ${OUTDIR}`);
