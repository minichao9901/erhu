// 端到端实测：笔记本喇叭放二胡仿真音频 → 浏览器真实麦克风采集 → 页面 YIN 检测 → 读检出统计
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const REPO = 'E:/VibeCoding/erhu-tuner';
const WAVDIR = path.join(__dirname, 'wav');
const PORT = 8123, CDP_PORT = 9333;
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 静态服务器（localhost 是安全上下文，麦克风可用）----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(REPO, rel === '/' ? 'index.html' : rel);
  fs.readFile(f, (e, d) => {
    if (e) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
    res.end(d);
  });
});

function playWav(file) {
  // 用 Play() 异步起播，便于控制测量窗口；调用方负责 kill
  return spawn('powershell', ['-NoProfile', '-Command',
    `(New-Object Media.SoundPlayer '${file.replace(/'/g, "''")}').Play(); Start-Sleep -Seconds 12`], { stdio: 'ignore' });
}

let ws, msgId = 0; const pend = new Map(); const events = [];
function send(method, params = {}) {
  return new Promise((res, rej) => { const i = ++msgId; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
}
async function evalJs(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception || {}).description);
  return r.result.value;
}
async function clickAt(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
}

(async () => {
  await new Promise(r => server.listen(PORT, r));
  console.log('静态服务器: http://localhost:' + PORT);

  const prof = path.join(os.tmpdir(), 'edge-erhu-rig');
  const edge = spawn(EDGE, [
    '--remote-debugging-port=' + CDP_PORT, '--user-data-dir=' + prof,
    '--use-fake-ui-for-media-stream',      // 自动授权麦克风（不伪造设备，用真麦克风）
    '--no-first-run', '--no-default-browser-check', '--new-window', 'about:blank'
  ], { stdio: 'ignore', detached: false });

  let list = null;
  for (let i = 0; i < 80; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json(); if (list.some(t => t.type === 'page')) break; } catch (e) {}
    await sleep(250);
  }
  if (!list) throw new Error('连不上浏览器 DevTools');
  const page = list.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws')); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
    else if (m.method) events.push(m.method);
  };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: `http://localhost:${PORT}/` });
  for (let i = 0; i < 60 && !events.includes('Page.loadEventFired'); i++) await sleep(150);
  await sleep(700);

  // 真实点击「开始调音」（CDP 的输入事件是可信手势，Safari/Chrome 才肯开麦并解锁音频）
  const rect = await evalJs(`(function(){var b=document.getElementById('startBtn').getBoundingClientRect();return JSON.stringify({x:b.left+b.width/2,y:b.top+b.height/2});})()`);
  const { x, y } = JSON.parse(rect);
  await clickAt(x, y);
  await sleep(1500);

  const st = await evalJs(`JSON.stringify({running:__erhu.state().running, ctx:__erhu.state().ctxState,
    mic:(navigator.mediaDevices?'ok':'no'), label:(document.getElementById('diag').textContent.match(/麦克风: (.*)/)||[])[1]||'?'})`);
  console.log('启动状态: ' + st);
  const started = await evalJs('__erhu.state().running');
  if (!started) { console.log('!! 麦克风没起来，后面测不了'); }

  const files = fs.readdirSync(WAVDIR).filter(f => f.endsWith('.wav')).sort();
  console.log('\n音频文件               | 检出率 | 成功 | 门限挡 | 认不出 | 可信度不足 | 帧间不稳 | 平均dBFS | 末次频率');
  console.log('-----------------------|--------|------|--------|--------|------------|----------|-----------|');

  const summary = [];
  for (const f of files) {
    const player = playWav(path.join(WAVDIR, f));
    // 等电平真的起来（说明声音在响、而不是文件头尾的静音），再开窗测量
    const t0 = Date.now();
    while (Date.now() - t0 < 3000) {
      const db = await evalJs('__erhu.stats().lastDb');
      if (db > -46) break;
      await sleep(80);
    }
    await evalJs('__erhu.resetStats()');
    await sleep(1500);                       // 声音稳定段测量窗口
    const s = await evalJs('JSON.stringify(__erhu.stats())');
    try { player.kill(); } catch (e) {}
    const d = JSON.parse(s);
    const okRate = d.frames ? (d.ok / d.frames * 100) : 0;
    const avgDb = d.dbN ? d.dbSum / d.dbN : -99;
    const avgCl = d.clN ? d.clSum / d.clN : 0;
    console.log(`${f.replace(/\.wav$/, '').padEnd(22)} | ${(okRate.toFixed(0) + '%').padStart(6)} | ${String(d.ok).padStart(4)} | ${String(d.gated).padStart(6)} | ${String(d.nodetect).padStart(6)} | ${String(d.lowclarity).padStart(10)} | ${String(d.unstable).padStart(8)} | ${avgDb.toFixed(1).padStart(8)} | ${String(d.lastFreq ? d.lastFreq.toFixed(0) : '-').padStart(8)}`);
    summary.push({ f, okRate, avgDb, avgCl, d });
    await sleep(400);
  }

  console.log('\n=== 诊断结论 ===');
  const bad = summary.filter(s => s.okRate < 60);
  if (!bad.length) console.log('  所有用例检出率都 ≥60%，本机声学路径下没有复现"不灵敏"');
  else {
    console.log('  检出率低的用例：');
    for (const b of bad) {
      const why = [];
      if (b.d.gated > b.d.frames * 0.3) why.push('门限挡掉（信号太弱）');
      if (b.d.nodetect > b.d.frames * 0.3) why.push('YIN 认不出基频');
      if (b.d.lowclarity > b.d.frames * 0.3) why.push('可信度不足');
      console.log(`    ${b.f}: ${b.okRate.toFixed(0)}%  ← ${why.join(' + ') || '其它'}  平均 ${b.avgDb.toFixed(1)} dBFS, 可信度 ${b.avgCl.toFixed(2)}`);
    }
  }
  const avgAll = summary.reduce((a, b) => a + b.okRate, 0) / summary.length;
  console.log(`  总体平均检出率: ${avgAll.toFixed(0)}%`);
  const lv = summary.map(s => s.avgDb);
  console.log(`  麦克风收到电平范围: ${Math.min(...lv).toFixed(1)} ~ ${Math.max(...lv).toFixed(1)} dBFS（若普遍 < -60，说明喇叭没声或被静音）`);

  ws.close(); server.close();
  try { edge.kill(); } catch (e) {}
  setTimeout(() => process.exit(0), 300);
})().catch(e => { console.error('ERR', e.message); try { server.close(); } catch (x) {} process.exit(1); });
