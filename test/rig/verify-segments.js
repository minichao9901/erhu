// 解码分段 MP3，在每个音符的中点核对音高与段长。
// 用法: node verify-segments.js <简谱.json> <分段目录>
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const score = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const outDir = process.argv[3];
const ffmpeg = process.env.FFMPEG_EXE ||
  'E:\\VibeCoding\\Xuhaoyan_视频裁剪\\ffmpeg_local\\ffmpeg-8.1.2-essentials_build\\bin\\ffmpeg.exe';
const html = fs.readFileSync(path.join(__dirname, '..', '..', 'index.html'), 'utf8');
const begin = '/* ===== DSP:CORE-BEGIN ===== */', end = '/* ===== DSP:CORE-END ===== */';
const { detectPitchYIN, centsBetween } = new Function(
  html.slice(html.indexOf(begin) + begin.length, html.indexOf(end)) +
  'return {detectPitchYIN, centsBetween};'
)();
const keyRoot = { '♭B': 58, F: 65, C: 60, G: 67, D: 62 };
const semi = [0, 2, 4, 5, 7, 9, 11];
const units = { '16th': .25, eighth: .5, quarter: 1, half: 2, whole: 4 };
const keyName = { '♭B': '降B', F: 'F', C: 'C', G: 'G', D: 'D' };
const sampleRate = 44100, frameSize = 4096;
const freq = midi => 440 * Math.pow(2, (midi - 69) / 12);
let failures = 0, checked = 0;

for (const bpm of [30, 60]) {
  const beat = 60 / bpm;
  for (let i = 0; i < score.key_sections.length; i++) {
    const section = score.key_sections[i];
    const next = score.key_sections[i + 1]?.from_measure ?? score.total_measures + 1;
    const measures = score.measures.filter(m => m.measure >= section.from_measure && m.measure < next);
    const chord = String(section.tuning_inner_string).replace('(低音)', '') +
      String(section.tuning_outer_string).replace('(低音)', '') + '弦';
    const name = `快速转调练习_${bpm}BPM_段${i + 1}_${keyName[section.key]}_${chord}.mp3`;
    const file = path.join(outDir, name);
    const pcm = execFileSync(ffmpeg, [
      '-hide_banner', '-loglevel', 'error', '-i', file,
      '-f', 'f32le', '-acodec', 'pcm_f32le', '-ac', '1', '-ar', String(sampleRate), 'pipe:1'
    ], { maxBuffer: 32 * 1024 * 1024 });
    const sampleCount = pcm.length / 4;
    let time = 0, good = 0;
    for (const measure of measures) {
      for (const note of measure.notes) {
        const duration = units[note.duration] * beat;
        const center = Math.floor((time + duration / 2) * sampleRate);
        const frame = new Float32Array(frameSize);
        for (let k = 0; k < frameSize; k++) frame[k] = pcm.readFloatLE((center - frameSize / 2 + k) * 4);
        const result = detectPitchYIN(frame, sampleRate, { minFreq: 200, maxFreq: 2200, threshold: .15 });
        const expected = freq(keyRoot[measure.key] + semi[note.degree - 1] + 12 * note.octave);
        if (!result || Math.abs(centsBetween(result.freq, expected)) >= 5) {
          failures++;
          console.error(`  错音：${name} 第${measure.measure}小节 ${time.toFixed(2)}s`);
        } else good++;
        checked++;
        time += duration;
      }
    }
    if (Math.abs(sampleCount / sampleRate - time) > .06) {
      failures++;
      console.error(`  段长错误：${name} 实际 ${(sampleCount / sampleRate).toFixed(3)}s，应为 ${time.toFixed(3)}s`);
    }
    console.log(`${name}: ${good}/${measures.flatMap(m => m.notes).length} 音正确，${(sampleCount / sampleRate).toFixed(2)}s`);
  }
}

console.log(`合计 ${checked - failures}/${checked} 个音符；${failures} 项错误`);
process.exit(failures ? 1 : 0);
