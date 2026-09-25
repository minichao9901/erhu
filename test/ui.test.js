// 无浏览器集成测试：用 DOM/AudioContext 桩跑通 index.html 的完整交互链路（指板面板版）
const fs = require('fs');
const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}${extra ? '  ' + extra : ''}`); }
  else { fail++; console.log(`  FAIL  ${name}${extra ? '  ' + extra : ''}`); }
};

console.log('\n=== 0. 静态检查 ===');
const script = html.slice(html.lastIndexOf('<script>') + 8, html.lastIndexOf('</script>'));
const wanted = [...new Set([...script.matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]))];
const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const missing = wanted.filter(id => !declared.has(id));
ok(`脚本引用的 ${wanted.length} 个 id 全部存在`, missing.length === 0, missing.length ? '缺失: ' + missing.join(', ') : '');
const allIds = [...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]);
ok('无重复 id', new Set(allIds).size === allIds.length);
for (const tag of ['html', 'head', 'body', 'style', 'script', 'div', 'details', 'button', 'svg', 'header', 'footer']) {
  const o = (html.match(new RegExp(`<${tag}[\\s>]`, 'g')) || []).length;
  const c = (html.match(new RegExp(`</${tag}>`, 'g')) || []).length;
  ok(`<${tag}> 开闭配对 (${o}/${c})`, o === c);
}
ok('无 </script> 出现在字符串里', (script.match(/<\/script/g) || []).length === 0);
ok('SVG 有 viewBox', /viewBox="0 0 360 566"/.test(html));

// ---------- DOM 桩 ----------
const ctx2dStub = new Proxy({}, { get: (t, k) => (k === 'createLinearGradient' ? () => ({ addColorStop() {} }) : () => {}), set: () => true });
function makeEl(id, tag) {
  const cls = new Set();
  const attrs = {};
  const el = {
    id, tagName: (tag || 'DIV').toUpperCase(), children: [], value: '', disabled: false,
    width: 0, height: 0, clientWidth: 360, clientHeight: 430, style: {},
    _cls: cls, _className: '', _html: '', _text: '',
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      toggle: (c, on) => { if (on === undefined) cls.has(c) ? cls.delete(c) : cls.add(c); else on ? cls.add(c) : cls.delete(c); },
      contains: c => cls.has(c)
    },
    _handlers: {}, _attrs: attrs,
    addEventListener(ev, fn) { (this._handlers[ev] = this._handlers[ev] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { this.children.push(c); return c; },
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); },
    insertBefore(c) { this.children.push(c); return c; },
    querySelector() { return makeEl('sub'); }, querySelectorAll() { return []; },
    getAttribute(n) { return (n in attrs) ? attrs[n] : null; },
    setAttribute(n, v) { attrs[n] = String(v); },
    removeAttribute(n) { delete attrs[n]; },
    getContext() { return ctx2dStub; },
    select() {}, focus() {}, remove() {},
    fire(ev, arg) { (this._handlers[ev] || []).forEach(f => f(arg || { preventDefault() {} })); }
  };
  Object.defineProperty(el, 'className', {
    get() { return el._className; },
    set(v) { el._className = String(v); cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); }
  });
  Object.defineProperty(el, 'innerHTML', {
    get() { return el._html; },
    set(v) { el._html = String(v); el._text = String(v).replace(/<[^>]*>/g, ''); }
  });
  Object.defineProperty(el, 'textContent', {
    get() { return el._text; },
    set(v) { el._text = String(v); el._html = String(v); }
  });
  return el;
}
const els = {};
const docHandlers = {};
const lsStore = {};
const getEl = id => (els[id] = els[id] || makeEl(id));
const keyButtons = ['D', 'G', 'F', 'C', 'A', 'Bb'].map(k => { const b = makeEl('key-' + k, 'button'); b.setAttribute('data-key', k); return b; });
const modeButtons = ['auto', 'D', 'A'].map(m => { const b = makeEl('mode-' + m, 'button'); b.setAttribute('data-mode', m); return b; });
const rateButtons = ['2', '1', '0.5'].map(r => { const b = makeEl('rate-' + r, 'button'); b.setAttribute('data-rate', r); return b; });
const timerButtons = ['1', '3', '5'].map(v => { const b = makeEl('timer-' + v, 'button'); b.setAttribute('data-min', v); return b; });
const a4Buttons = ['440', '441', '442', '443', '444'].map(v => { const b = makeEl('a4-' + v, 'button'); b.setAttribute('data-a4', v); if (v === '440') b.className = 'on'; return b; });
global.localStorage = { getItem: k => (k in lsStore ? lsStore[k] : null), setItem: (k, v) => { lsStore[k] = String(v); }, removeItem: k => { delete lsStore[k]; } };
const documentStub = {
  getElementById: getEl,
  createElement: (t) => makeEl('new', t),
  createElementNS: (ns, t) => makeEl('svg-' + t, t),
  querySelectorAll: sel => sel.indexOf('keySeg') >= 0 ? keyButtons : (sel.indexOf('modeSeg') >= 0 ? modeButtons : (sel.indexOf('metroSeg') >= 0 ? rateButtons : (sel.indexOf('a4Seg') >= 0 ? a4Buttons : (sel.indexOf('timerSeg') >= 0 ? timerButtons : [])))),
  querySelector: () => makeEl('q'),
  addEventListener: (ev, fn) => { (docHandlers[ev] = docHandlers[ev] || []).push(fn); },
  hidden: false, body: makeEl('body')
};
const fireGesture = ev => (docHandlers[ev] || []).forEach(f => f({}));

// ---------- AudioContext 桩 ----------
let toneFreq = 293.66, toneAmp = 0.3;
class FakeAnalyser {
  constructor(ctx) { this.ctx = ctx; this.fftSize = 2048; this.frequencyBinCount = 1024; }
  getFloatTimeDomainData(buf) {
    for (let i = 0; i < buf.length; i++) buf[i] = toneAmp * Math.sin(2 * Math.PI * toneFreq * i / this.ctx.sampleRate);
  }
  getByteFrequencyData(buf) { buf.fill(0); }
}
class FakeAudioContext {
  constructor() { this.sampleRate = 48000; this.state = ctxInitialState; this.destination = {}; this.onstatechange = null; }
  // 音频时钟跟着测试时钟走，节拍器的前瞻排程才测得了
  get currentTime() { return clock / 1000; }
  resume() { if (ctxResumeWorks) this.state = 'running'; return Promise.resolve(); }
  createAnalyser() { return new FakeAnalyser(this); }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createGain() {
    const calls = [];
    const p = {
      value: 1,
      setValueAtTime(v) { calls.push(v); },
      exponentialRampToValueAtTime(v) { calls.push(v); },
      setTargetAtTime(v) { calls.push(v); },
      linearRampToValueAtTime(v) { calls.push(v); },
      cancelScheduledValues() {}
    };
    const g = { gain: p, connect() {}, disconnect() {}, _calls: calls };
    gains.push(g);
    return g;
  }
  createOscillator() { const o = { type: 'sine', frequency: { value: 0 }, connect() {}, start() {}, stop() { o.stopped = true; } }; oscs.push(o); return o; }
}
let oscs = [];
let gains = [];
let oscTimes = [];
let gumBehavior = 'ok';
let ctxInitialState = 'running', ctxResumeWorks = true;
const fakeTrack = { label: 'Built-in Mic', stop() {}, getSettings: () => ({ echoCancellation: false, noiseSuppression: false, autoGainControl: false }), addEventListener() {} };
const fakeStream = { getTracks: () => [fakeTrack], getAudioTracks: () => [fakeTrack] };

let rafQueue = [], clock = 0;
let sessionLog = [];
// ---- 假定时器：音阶每秒一步，必须用可控时钟才测得动 ----
let timers = [], timerSeq = 0;
function fakeSetTimeout(fn, ms) { const id = ++timerSeq; timers.push({ id, fn, at: clock + (ms || 0) }); return id; }
function fakeClearTimeout(id) { timers = timers.filter(t => t.id !== id); }
// 周期定时器（练习计时器用）：到期后重新排期而不是移除
function fakeSetInterval(fn, ms) { const id = ++timerSeq; timers.push({ id, fn, at: clock + (ms || 1), every: ms || 1 }); return id; }
function fakeClearInterval(id) { timers = timers.filter(t => t.id !== id); }
const EPOCH = 1700000000000;
const FakeDate = function (...a) { return new Date(...a); };
FakeDate.now = () => EPOCH + clock;                       // 固定纪元，Date.now() 跟着假时钟走
function advance(ms) {
  const target = clock + ms;
  for (let guard = 0; guard < 5000; guard++) {
    let due = null;
    for (const t of timers) if (t.at <= target && (!due || t.at < due.at)) due = t;
    if (!due) break;
    if (due.every) { due.at = clock + due.every; }  // 周期定时器：原地重排
    else { timers = timers.filter(t => t !== due); }
    clock = Math.max(clock, due.at);
    try { due.fn(); } catch (e) { console.error('timer error:', e.message); }
  }
  clock = Math.max(clock, target);
}
function loadPage(opts = {}) {
  rafQueue = []; clock = 0; oscs = []; gains = []; sessionLog = []; timers = []; timerSeq = 0;
  ctxInitialState = opts.ctxState || 'running';
  ctxResumeWorks = opts.resumeWorks !== false;
  Object.keys(docHandlers).forEach(k => delete docHandlers[k]);
  Object.keys(els).forEach(k => delete els[k]);
  [...keyButtons, ...modeButtons, ...rateButtons, ...a4Buttons, ...timerButtons].forEach(b => { b._handlers = {}; b._cls.clear(); });

  const nav = {
    userAgent: opts.ua || 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone', maxTouchPoints: 5,
    mediaDevices: opts.noGum ? undefined : {
      getUserMedia: () => gumBehavior === 'ok' ? Promise.resolve(fakeStream) : Promise.reject(Object.assign(new Error('x'), { name: gumBehavior }))
    },
    permissions: { query: () => Promise.resolve({ state: 'prompt' }) },
    wakeLock: { request: () => Promise.resolve({ release() {} }) },
    clipboard: { writeText: () => Promise.resolve() }
  };
  if (!opts.noAudioSessionAPI) {
    let t = 'auto';
    nav.audioSession = { get type() { return t; }, set type(v) { t = v; sessionLog.push(v); } };
  }
  const win = {
    isSecureContext: opts.secure !== false,
    AudioContext: opts.noAudio ? undefined : FakeAudioContext,
    devicePixelRatio: 3, addEventListener() {}, navigator: nav,
    setTimeout: fakeSetTimeout, clearTimeout: fakeClearTimeout,
    setInterval: fakeSetInterval, clearInterval: fakeClearInterval,
    Date: FakeDate,
    requestAnimationFrame: fn => { rafQueue.push(fn); return rafQueue.length; },
    cancelAnimationFrame: () => {}, document: documentStub
  };
  const loc = { protocol: opts.secure === false ? 'http:' : 'https:', hostname: 'x', href: 'https://x/' };
  win.location = loc;
  const fn = new Function('window', 'document', 'navigator', 'location', 'performance',
    'requestAnimationFrame', 'cancelAnimationFrame', 'setTimeout', 'clearTimeout',
    'setInterval', 'clearInterval', 'Date', 'console', script);
  fn(win, documentStub, nav, loc, { now: () => clock }, win.requestAnimationFrame, win.cancelAnimationFrame,
     win.setTimeout, win.clearTimeout, win.setInterval, win.clearInterval, FakeDate, console);
  return win;
}
const pump = (frames, dt = 40) => {
  for (let i = 0; i < frames; i++) {
    const q = rafQueue; rafQueue = [];
    clock += dt;
    q.forEach(f => f(clock));
  }
};
const tick = () => new Promise(r => setTimeout(r, 0));
// 面板几何：按半音等比排布。两根弦的半音数序列不同（大七度 vs 小七度），必须分开算
const PAD_TOP = 36, UNIT = 20;
const SEMIS_INNER = [0, 2, 4, 5, 7, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24];
const SEMIS_OUTER = [0, 2, 4, 5, 7, 9, 10, 12, 14, 16, 17, 19, 21, 22, 24];
const slotY = (which, i) => PAD_TOP + (which === 'outer' ? SEMIS_OUTER : SEMIS_INNER)[i] * UNIT + UNIT / 2;
const arrowY = (el) => { const t = el.getAttribute('transform') || ''; const m = /translate\(([-\d.]+),([-\d.]+)\)/.exec(t); return m ? parseFloat(m[2]) : null; };
const isVisible = el => el.getAttribute('opacity') === '1';

(async function run() {
  console.log('\n=== 1. 加载与面板构建 ===');
  let w = loadPage({});
  ok('脚本执行无异常', true);
  let st = w.__erhu.state();
  ok('内弦 15 个音位', st.slotsInner.length === 15, st.slotsInner.map(s => s.name).join(' '));
  ok('外弦 15 个音位', st.slotsOuter.length === 15, st.slotsOuter.map(s => s.name).join(' '));
  ok('默认 1=D', st.keyId === 'D');
  ok('默认 15 弦', getEl('chordTxt').textContent === '15 弦', getEl('chordTxt').textContent);
  ok('未运行', st.running === false);

  console.log('\n=== 2. 开始调音 + 拉内弦空弦 D4 ===');
  getEl('startBtn').fire('click');
  await tick(); await tick();
  ok('进入运行态', w.__erhu.state().running === true);
  ok('按钮变为停止', getEl('startBtn').textContent === '停止调音');

  toneFreq = 293.66;
  pump(10);
  ok('音名显示 D4', getEl('noteName').textContent === 'D4', getEl('noteName').textContent);
  ok('简谱显示 1', getEl('jpBox').textContent === '1', getEl('jpBox').textContent);
  ok('音分≈0', Math.abs(parseFloat(getEl('cents').textContent)) < 1, getEl('cents').textContent);
  const bd = w.__erhu.board();
  ok('内弦箭头可见', isVisible(bd.arrowInner.g), bd.arrowInner.g.getAttribute('opacity'));
  ok('外弦箭头隐藏', !isVisible(bd.arrowOuter.g));
  ok('箭头精确落在内弦第1音位（空弦）', Math.abs(arrowY(bd.arrowInner.g) - slotY('inner',0)) < 0.5,
     `箭头y=${arrowY(bd.arrowInner.g)} 目标y=${slotY('inner',0)}`);
  ok('目标圈可见', bd.ring.getAttribute('opacity') === '1');
  ok('音准达标变绿', getEl('noteName')._cls.has('ok'), [...getEl('noteName')._cls].join(' '));
  ok('箭头变绿', bd.arrowInner.tri.getAttribute('fill') === '#22c55e', bd.arrowInner.tri.getAttribute('fill'));
  ok('频率行含目标', /293\.66/.test(getEl('freqLine').textContent), getEl('freqLine').textContent);

  console.log('\n=== 3. 同一个音两根弦都能按 -> 应优先低把位（空弦）===');
  toneFreq = 440.0;
  pump(10);
  ok('音名 A4', getEl('noteName').textContent === 'A4', getEl('noteName').textContent);
  ok('提示落在「外弦」（A4 是外弦空弦，不是内弦第5位）', /外弦/.test(getEl('freqLine').textContent),
     getEl('freqLine').textContent);
  ok('箭头切到外弦并落在第1音位', isVisible(w.__erhu.board().arrowOuter.g) &&
     Math.abs(arrowY(w.__erhu.board().arrowOuter.g) - slotY('inner',0)) < 0.5);
  toneFreq = 587.33;
  pump(10);
  ok('D5 提示落在「外弦」第1把位', /外弦 第1把位/.test(getEl('freqLine').textContent), getEl('freqLine').textContent);

  console.log('\n=== 4. 偏低 / 偏高：箭头位移与颜色 ===');
  toneFreq = 293.66 * Math.pow(2, -30 / 1200);
  pump(10);
  let c = parseFloat(getEl('cents').textContent);
  ok('偏低显示负值', c < -25 && c > -35, getEl('cents').textContent);
  let ay = arrowY(w.__erhu.board().arrowInner.g);
  ok('箭头按 0.7px/音分 向上偏移约 21px', Math.abs((slotY('inner',0) - ay) - 30 * 0.7) < 3,
     `实际偏移 ${(slotY('inner',0) - ay).toFixed(1)}px（理论 21px）`);
  ok('偏低用蓝色', getEl('cents')._cls.has('low'), [...getEl('cents')._cls].join(' '));
  ok('箭头变蓝', w.__erhu.board().arrowInner.tri.getAttribute('fill') === '#60a5fa');
  toneFreq = 293.66 * Math.pow(2, 22 / 1200);
  pump(10);
  c = parseFloat(getEl('cents').textContent);
  ok('偏高显示正值', c > 18 && c < 28, getEl('cents').textContent);
  ay = arrowY(w.__erhu.board().arrowInner.g);
  ok('箭头向下偏移约 15px', Math.abs((ay - slotY('inner',0)) - 22 * 0.7) < 3, `实际 ${(ay - slotY('inner',0)).toFixed(1)}px`);
  ok('偏高用橙色', getEl('cents')._cls.has('high'), [...getEl('cents')._cls].join(' '));
  ok('箭头变橙', w.__erhu.board().arrowInner.tri.getAttribute('fill') === '#fb923c');

  console.log('\n=== 5. 判绿门槛 ±5 音分 ===');
  toneFreq = 293.66; pump(10);
  toneFreq = 293.66 * Math.pow(2, 4 / 1200); pump(10);
  ok('+4 音分判绿', getEl('noteName')._cls.has('ok'), getEl('cents').textContent);
  toneFreq = 293.66 * Math.pow(2, 9 / 1200); pump(10);
  ok('+9 音分不判绿', !getEl('noteName')._cls.has('ok'), getEl('cents').textContent);
  toneFreq = 293.66 * Math.pow(2, -4 / 1200); pump(10);
  ok('-4 音分判绿', getEl('noteName')._cls.has('ok'), getEl('cents').textContent);

  console.log('\n=== 6. 静音处理 ===');
  toneAmp = 0.0002;
  pump(50);   // 要超过 HOLD_MS(1500ms) 读数才清空
  ok('读数清空', getEl('noteName').textContent === '--', getEl('noteName').textContent);
  ok('提示没听到声音', /没听到声音/.test(getEl('freqLine').textContent), getEl('freqLine').textContent);
  toneAmp = 0.3;

  console.log('\n=== 7. 切换调号：简谱数字重算 ===');
  keyButtons[1].fire('click');   // G
  await tick();
  st = w.__erhu.state();
  ok('切到 1=G', st.keyId === 'G');
  ok('弦式变 52 弦', getEl('chordTxt').textContent === '52 弦', getEl('chordTxt').textContent);
  ok('内弦空弦简谱变 5（带低八度点）', st.slotsInner[0].degree === 5 && st.slotsInner[0].dots === -1,
     `degree=${st.slotsInner[0].degree} dots=${st.slotsInner[0].dots}`);
  ok('外弦空弦简谱变 2', st.slotsOuter[0].degree === 2 && st.slotsOuter[0].dots === 0,
     `degree=${st.slotsOuter[0].degree} dots=${st.slotsOuter[0].dots}`);
  toneFreq = 293.66; pump(12);
  ok('拉 D4 显示简谱 5（低八度点+5）', /^·?5·?$/.test(getEl('jpBox').textContent), getEl('jpBox').textContent);
  ok('低八度点画在数字下方（dt 在 number 之后）',
     getEl('jpBox').innerHTML.indexOf('dt') > getEl('jpBox').innerHTML.indexOf('>5<'),
     getEl('jpBox').innerHTML);
  ok('音名仍是 D4（音高不随调号变）', getEl('noteName').textContent === 'D4', getEl('noteName').textContent);
  ok('不出现 -0.0 音分', getEl('cents').textContent.indexOf('-0.0') < 0, getEl('cents').textContent);

  keyButtons[0].fire('click');   // 回到 D
  await tick();
  ok('切回 1=D 恢复 15 弦', getEl('chordTxt').textContent === '15 弦');
  toneFreq = 587.33; pump(12);
  ok('1=D 时高八度点画在数字上方（dt 在 number 之前）',
     getEl('jpBox').innerHTML.indexOf('dt') < getEl('jpBox').innerHTML.indexOf('>1<'),
     getEl('jpBox').innerHTML);

  console.log('\n=== 8. 只检测单根弦 ===');
  modeButtons[1].fire('click');  // 只看内弦
  await tick();
  ok('模式切到只看内弦', w.__erhu.state().mode === 'D');
  toneFreq = 440; pump(12);
  ok('内弦模式下拉 A4 → 内弦第5位', /内弦/.test(getEl('freqLine').textContent), getEl('freqLine').textContent);
  modeButtons[2].fire('click');  // 只看外弦
  await tick();
  toneFreq = 440; pump(12);
  ok('外弦模式下拉 A4 → 外弦空弦', /外弦/.test(getEl('freqLine').textContent), getEl('freqLine').textContent);
  modeButtons[0].fire('click');
  await tick();

  console.log('\n=== 9. 点音位发声（新增功能）===');
  {
    const bd = w.__erhu.board();
    ok('面板有 30 个点击热区', bd.hit && bd.hit.length === 30, `实际 ${bd.hit ? bd.hit.length : 0} 个`);
    const hitInner0 = bd.hit[0];             // 内弦第1音位 D4
    const hitOuter0 = bd.hit[15];            // 外弦第1音位 A4
    oscs = [];
    hitInner0.fire('click');
    ok('点内弦①发出 4 个谐波', oscs.length === 4, `${oscs.length} 个`);
    ok('基频 = 293.66 Hz', Math.abs(oscs[0].frequency.value - 293.66) < 0.01, String(oscs[0].frequency.value));
    ok('谐波为 2/3/4 倍频', Math.abs(oscs[1].frequency.value - 587.32) < 0.05 &&
       Math.abs(oscs[2].frequency.value - 880.98) < 0.05, `${oscs[1].frequency.value.toFixed(1)} / ${oscs[2].frequency.value.toFixed(1)}`);
    ok('进入播放态', w.__erhu.state().playing === true);
    ok('音位圆圈高亮为琥珀色', bd.inner[0].circle.getAttribute('stroke') === '#f59e0b', bd.inner[0].circle.getAttribute('stroke'));
    ok('提示条显示音名与频率', /♪ D4/.test(getEl('boardHint').textContent) && /293\.66/.test(getEl('boardHint').textContent),
       getEl('boardHint').textContent);
    hitInner0.fire('click');
    ok('再点一次停止', w.__erhu.state().playing === false);
    ok('高亮复原', bd.inner[0].circle.getAttribute('stroke') === 'rgba(255,255,255,.20)', bd.inner[0].circle.getAttribute('stroke'));
    ok('提示条复原', getEl('boardHint').textContent.indexOf('点任意音位') >= 0, getEl('boardHint').textContent);

    oscs = [];
    hitOuter0.fire('click');
    ok('点外弦① = 440 Hz', Math.abs(oscs[0].frequency.value - 440) < 0.01, String(oscs[0].frequency.value));
    oscs = [];
    bd.hit[7].fire('click');                 // 内弦第8音位 D5
    ok('点内弦⑧ = D5 587.33 Hz', Math.abs(oscs[0].frequency.value - 587.33) < 0.01, String(oscs[0].frequency.value));
    ok('高把位音位也能点', w.__erhu.state().playing === true);

    // 播放中不做音高判定（避免扬声器声音被麦克风收进去）
    const before = getEl('noteName').textContent;
    pump(6);
    ok('发声播放中暂停音高判定', getEl('noteName').textContent === before, getEl('noteName').textContent);
    // 切换调号时自动停掉
    keyButtons[1].fire('click');
    await tick();
    ok('切换调号自动停止发声', w.__erhu.state().playing === false);
    keyButtons[0].fire('click');
    await tick();
  }

  console.log('\n=== 10. iOS 音频会话与"第一次响、再打开不响"的修复 ===');
  {
    // (a) 上下文处于 interrupted（iOS 从后台切回来常见）也要能恢复
    let w2 = loadPage({ ctxState: 'interrupted' });
    fireGesture('touchstart');
    ok('interrupted 状态被手势救回 running', w2.__erhu.state().ctxState === 'running', String(w2.__erhu.state().ctxState));
    ok('单纯触摸不抢音频会话（不打断后台音乐）', sessionLog.length === 0, sessionLog.join(' → '));
    w2.__erhu.board().hit[0].fire('click');
    ok('真正发声时才切 playback（忽略静音拨片）', sessionLog.indexOf('playback') >= 0, sessionLog.join(' → '));

    // (b) 从未创建过上下文时，任意一次触摸就提前解锁
    w2 = loadPage({});
    ok('初始未创建上下文', w2.__erhu.state().ctxState === null);
    fireGesture('touchstart');
    ok('触摸后上下文已创建并 running', w2.__erhu.state().ctxState === 'running', String(w2.__erhu.state().ctxState));

    // (c) 完全恢复不了时（模拟静音拨片/未解锁），要给用户可操作的提示
    w2 = loadPage({ ctxState: 'interrupted', resumeWorks: false });
    const bd2 = w2.__erhu.board();
    oscs = [];
    bd2.hit[0].fire('click');
    ok('仍然尝试发声（不静默失败）', oscs.length === 4);
    advance(400);
    ok('350ms 后仍非 running → 弹出静音拨片提示', /静音拨片/.test(getEl('banner').innerHTML), getEl('banner').innerHTML.slice(0, 60));
    ok('提示里给了耳机/蓝牙的排查方向', /耳机|蓝牙/.test(getEl('banner').innerHTML));

    // (d) 正常情况不弹提示
    w2 = loadPage({});
    fireGesture('touchstart');
    getEl('banner').innerHTML = '';
    w2.__erhu.board().hit[0].fire('click');
    advance(400);
    ok('正常时不出提示', getEl('banner').innerHTML === '', getEl('banner').innerHTML.slice(0, 40));

    // (e) 开麦时切 play-and-record，关麦切回 playback
    w2 = loadPage({});
    getEl('startBtn').fire('click');
    await tick(); await tick();
    ok('开麦后会话类别 play-and-record', w2.__erhu.state().sessionType === 'play-and-record', String(w2.__erhu.state().sessionType));
    getEl('startBtn').fire('click');
    ok('关麦后交还会话（auto）', w2.__erhu.state().sessionType === 'auto', String(w2.__erhu.state().sessionType));

    // (f) 没有 audioSession API 的老系统不能崩
    w2 = loadPage({ noAudioSessionAPI: true });
    fireGesture('touchstart');
    ok('不支持 audioSession API 时不报错', w2.__erhu.state().ctxState === 'running');
  }

  console.log('\n=== 10.5 音阶练习（低 2 个八度 · 上下行来回 · 每音 1 秒）===');
  {
    const w3 = loadPage({});
    // 本组断言按「每音 1 秒」写（60 BPM × 1 拍）。默认速度已改为 80 BPM，
    // 所以这里显式设成 60 BPM —— 测的是音阶机制，不该依赖默认速度。
    getEl('bpmRange').value = '0';
    getEl('bpmRange').fire('input');
    const n = w3.__erhu.state().slotsInner.length;
    ok('音阶 = 内弦 15 个音位（正好 2 个八度）', n === 15, `${n} 个音`);
    const inner = w3.__erhu.state().slotsInner;
    ok('首音 = 内弦空弦 D4', inner[0].name === 'D4' && Math.abs(inner[0].freq - 293.66) < 0.01, inner[0].name);
    ok('末音 = D6（高 2 个八度）', inner[14].name === 'D6', inner[14].name);

    oscs = [];
    getEl('scaleBtn').fire('click');
    const st1 = w3.__erhu.state();
    ok('点击进入音阶练习态', st1.scaleOn === true && st1.scaleStep === 0 && st1.scaleDir === 1);
    ok('按钮变为停止', /停止/.test(getEl('scaleBtn').textContent), getEl('scaleBtn').textContent);
    ok('按钮变琥珀色', getEl('scaleBtn')._cls.has('playing'));
    ok('第 1 个音发声 = 293.66Hz', Math.abs(oscs[0].frequency.value - 293.66) < 0.01, String(oscs[0].frequency.value));

    const bd3 = w3.__erhu.board();
    ok('箭头精确落在第 1 音位', Math.abs(arrowY(bd3.arrowInner.g) - slotY('inner', 0)) < 0.5,
       `箭头y=${arrowY(bd3.arrowInner.g)} 音位y=${slotY('inner', 0)}`);
    ok('目标圈套在第 1 音位', bd3.ring.getAttribute('opacity') === '1' &&
       Math.abs(parseFloat(bd3.ring.getAttribute('cy')) - slotY('inner', 0)) < 0.5);
    ok('读数显示 D4', getEl('noteName').textContent === 'D4', getEl('noteName').textContent);
    ok('读数显示 0.0 音分且判绿', /0\.0/.test(getEl('cents').textContent) && getEl('noteName')._cls.has('ok'),
       getEl('cents').textContent);
    ok('提示显示 1/15 与上行', /1\/15/.test(getEl('freqLine').textContent) && /上行/.test(getEl('freqLine').textContent),
       getEl('freqLine').textContent);

    // 逐个音前进，检查音高与箭头落点
    oscs = [];
    advance(1000);
    ok('1 秒后到第 2 个音 E4', Math.abs(oscs[0].frequency.value - 329.63) < 0.1, String(oscs[0].frequency.value));
    ok('步进 = 1', w3.__erhu.state().scaleStep === 1);
    ok('箭头跟着走到第 2 音位', Math.abs(arrowY(w3.__erhu.board().arrowInner.g) - slotY('inner', 1)) < 0.5);

    advance(1000 * 5);   // 走到第 7 个音（1=D 时是 C#5）
    ok('第 7 个音 = C#5（大七度）', Math.abs(oscs[oscs.length-4].frequency.value - 554.37) < 0.5, String(oscs[oscs.length-4].frequency.value));
    ok('步进 = 6', w3.__erhu.state().scaleStep === 6);

    advance(1000 * 8);   // 走到最高音（索引 14）
    ok('到达最高音 D6', w3.__erhu.state().scaleStep === 14 && Math.abs(oscs[oscs.length - 4].frequency.value - 1174.66) < 1,
       `step=${w3.__erhu.state().scaleStep} f=${oscs[oscs.length - 4].frequency.value.toFixed(1)}`);
    ok('箭头落在最高音位', Math.abs(arrowY(w3.__erhu.board().arrowInner.g) - slotY('inner', 14)) < 0.5);

    advance(1000);
    ok('到顶折返：方向转下行且退回 1 格', w3.__erhu.state().scaleDir === -1 && w3.__erhu.state().scaleStep === 13,
       `step=${w3.__erhu.state().scaleStep} dir=${w3.__erhu.state().scaleDir}`);
    advance(1000 * 14);
    ok('下行到底后再次折返上行', w3.__erhu.state().scaleDir === 1 && w3.__erhu.state().scaleStep === 1,
       `step=${w3.__erhu.state().scaleStep} dir=${w3.__erhu.state().scaleDir}`);

    // 换调后音阶的音必须跟着变
    const w4 = loadPage({});
    getEl('bpmRange').value = '0';      // 同上一组：按 60 BPM 量
    getEl('bpmRange').fire('input');
    keyButtons[1].fire('click');    // 1=G
    oscs = [];
    getEl('scaleBtn').fire('click');
    const gi = w4.__erhu.state().slotsInner;
    ok('1=G 首音仍是内弦空弦 D4', Math.abs(oscs[0].frequency.value - 293.66) < 0.01);
    advance(1000 * 6);
    ok('1=G 第 7 个音 = C5（小七度，与 1=D 的 C#5 不同）',
       Math.abs(oscs[oscs.length - 4].frequency.value - 523.25) < 0.5, String(oscs[oscs.length - 4].frequency.value));
    ok('1=G 第 7 音位简谱 = 4', gi[6].degree === 4, `degree=${gi[6].degree}`);

    // 停止
    getEl('scaleBtn').fire('click');
    ok('再点一次停止音阶', w4.__erhu.state().scaleOn === false);
    ok('按钮文字复原', /音阶练习/.test(getEl('scaleBtn').textContent), getEl('scaleBtn').textContent);
    ok('停止后箭头收起', w4.__erhu.board().arrowInner.g.getAttribute('opacity') === '0');

    // 停止后定时器不再推进
    const stepAfterStop = w4.__erhu.state().scaleStep;
    advance(3000);
    ok('停止后不会继续推进', w4.__erhu.state().scaleStep === stepAfterStop && w4.__erhu.state().scaleOn === false);

    // 播放中不做麦克风判定；开调音会先停音阶
    const w5 = loadPage({});
    getEl('scaleBtn').fire('click');
    ok('音阶播放中', w5.__erhu.state().scaleOn === true);
    getEl('startBtn').fire('click');
    await tick(); await tick();
    ok('开调音时自动停掉音阶（避免喇叭声音被麦克风收进去）', w5.__erhu.state().scaleOn === false);
    ok('调音正常启动', w5.__erhu.state().running === true);

    // 换调也会停
    getEl('scaleBtn').fire('click');
    keyButtons[2].fire('click');
    ok('换调时自动停掉音阶', w5.__erhu.state().scaleOn === false);
  }

  console.log('\n=== 10.6 节拍器与音阶速度 ===');
  {
    const w6 = loadPage({});
    // 页面的 <i> 节拍灯在桩里不存在，手动补上 4 个
    const dots = getEl('beatDots');
    if (!dots.children.length) for (let i = 0; i < 4; i++) dots.appendChild(makeEl('i'));

    ok('速度档位 = 60~140 共 9 档', w6.__erhu.tempo.list.join(',') === '60,70,80,90,100,110,120,130,140',
       w6.__erhu.tempo.list.join(','));
    ok('默认 80 BPM', w6.__erhu.state().bpm === 80, String(w6.__erhu.state().bpm));
    ok('默认 1 拍/音 → 每音 750ms', w6.__erhu.state().scaleNoteMs === 750,
       String(w6.__erhu.state().scaleNoteMs));
    ok('BPM 文案显示', getEl('bpmTxt').textContent === '80 BPM', getEl('bpmTxt').textContent);
    ok('滑杆位置与默认值一致', getEl('bpmRange').value === '2', getEl('bpmRange').value);

    // 拖到 60 BPM（第 1 档）
    getEl('bpmRange').value = '0';
    getEl('bpmRange').fire('input');
    ok('拖到第 1 档 = 60 BPM', w6.__erhu.state().bpm === 60 && getEl('bpmTxt').textContent === '60 BPM',
       getEl('bpmTxt').textContent);
    ok('60 BPM × 1 拍 = 1000ms/音', w6.__erhu.state().scaleNoteMs === 1000, String(w6.__erhu.state().scaleNoteMs));

    // 回到 80 BPM
    getEl('bpmRange').value = '2';
    getEl('bpmRange').fire('input');
    ok('回到 80 BPM × 1 拍 = 750ms', w6.__erhu.state().scaleNoteMs === 750, String(w6.__erhu.state().scaleNoteMs));

    // 切 2 拍/音
    w6.__erhu.tempo.setRate(2);
    ok('2 拍/音 → 1500ms', w6.__erhu.state().scaleNoteMs === 1500, String(w6.__erhu.state().scaleNoteMs));
    w6.__erhu.tempo.setRate(0.5);
    ok('½ 拍/音 → 375ms', w6.__erhu.state().scaleNoteMs === 375, String(w6.__erhu.state().scaleNoteMs));
    w6.__erhu.tempo.setRate(1);
    w6.__erhu.tempo.setBpm(0);
    ok('回到 60 BPM / 1 拍 = 1000ms', w6.__erhu.state().scaleNoteMs === 1000);

    // 音阶速度真的跟着 BPM 变
    getEl('bpmRange').value = '2';       // 80 BPM → 750ms
    getEl('bpmRange').fire('input');
    oscs = [];
    getEl('scaleBtn').fire('click');
    ok('音阶起步', w6.__erhu.state().scaleOn === true && w6.__erhu.state().scaleStep === 0);
    advance(750);
    ok('750ms 后走到第 2 个音（80BPM×1拍）', w6.__erhu.state().scaleStep === 1, `step=${w6.__erhu.state().scaleStep}`);
    ok('提示条标出 BPM', /80 BPM/.test(getEl('freqLine').textContent), getEl('freqLine').textContent);
    w6.__erhu.tempo.setRate(2);
    oscs = [];
    advance(1500);
    ok('切 2 拍/音后 1500ms 才走一步', w6.__erhu.state().scaleStep === 2, `step=${w6.__erhu.state().scaleStep}`);
    advance(1500);
    ok('再 1500ms 再走一步', w6.__erhu.state().scaleStep === 3, `step=${w6.__erhu.state().scaleStep}`);
    getEl('scaleBtn').fire('click');
    w6.__erhu.tempo.setRate(1);
    w6.__erhu.tempo.setBpm(0);

    // 节拍器
    w6.__erhu.tempo.setBpm(0);          // 本组按 60 BPM（1 秒一拍）量拍数，显式设好
    oscs = [];
    getEl('metroBtn').fire('click');
    ok('节拍器开启', w6.__erhu.state().metroOn === true);
    ok('按钮文案变「开」', /开/.test(getEl('metroBtn').textContent), getEl('metroBtn').textContent);
    ok('按钮高亮', getEl('metroBtn')._cls.has('playing'));
    ok('立刻排了第一拍', oscs.length >= 1, `${oscs.length} 个振荡器`);
    ok('第一拍是重音 1760Hz', Math.abs(oscs[0].frequency.value - 1760) < 1, String(oscs[0].frequency.value));

    oscs = [];
    advance(100);
    ok('第一拍亮黄灯（重音）', dots.children[0].className === 'on accent',
       dots.children.map(d => d.className || '-').join('|'));

    oscs = [];
    advance(3000);
    // 60 BPM = 1 秒一拍。首个拍在开启时就排掉了，窗口内再排 3 拍
    // （第 4 拍落在窗口外，属正常边界效应）
    const beats60 = oscs.length;
    ok('60 BPM 下 3 秒排 3 拍', beats60 === 3, `${beats60} 拍`);

    // 换到 120 BPM，重启节拍器让相位干净，再量同一窗口里的拍数
    getEl('metroBtn').fire('click');
    w6.__erhu.tempo.setBpm(6);
    ok('切到 120 BPM', w6.__erhu.state().bpm === 120);
    getEl('metroBtn').fire('click');
    oscs = [];
    advance(3000);
    const beats120 = oscs.length;
    ok('120 BPM 的拍数约为 60 BPM 的两倍',
       beats120 >= beats60 * 1.7 && beats120 <= beats60 * 2.3, `${beats60} 拍 → ${beats120} 拍`);
    ok('每拍都是短促的点（不是音阶那种 4 谐波叠加）',
       oscs.every(o => o.type === 'sine'), oscs.length + ' 个点');

    getEl('metroBtn').fire('click');
    ok('再点关闭节拍器', w6.__erhu.state().metroOn === false);
    ok('按钮文案复原', /关/.test(getEl('metroBtn').textContent), getEl('metroBtn').textContent);
    ok('节拍灯全灭', dots.children.every(d => !d.className), dots.children.map(d => d.className || '-').join('|'));
    oscs = [];
    advance(3000);
    ok('关闭后不再排拍', oscs.length === 0, `${oscs.length} 个`);

    // 音量：把节拍器重新打开，量一拍里的增益峰值（原来只有 0.34，用户反馈听不见）
    getEl('metroBtn').fire('click');            // 开
    gains = [];
    advance(1000);
    const peakOf = g => Math.max.apply(null, g._calls.filter(v => typeof v === 'number').concat([0]));
    const clickPeak = Math.max.apply(null, gains.map(peakOf).concat([0]));
    ok('节拍声峰值 ≥ 0.6（比原来 0.34 响一倍）', clickPeak >= 0.6, String(clickPeak));
    getEl('metroBtn').fire('click');            // 关

    // 音频起不来时（静音拨片/未解锁）要主动提示，别让用户干等
    const w7 = loadPage({ ctxState: 'interrupted', resumeWorks: false });
    getEl('metroBtn').fire('click');
    advance(400);
    ok('节拍器起不来时提示查静音拨片', /静音拨片/.test(getEl('banner').innerHTML), getEl('banner').innerHTML.slice(0, 40));

    // 复现用户报告：音阶运行中切换拍数，节奏会乱
    const w8 = loadPage({});
    getEl('scaleBtn').fire('click');            // 60BPM × 1拍 = 1000ms/音
    advance(500);                               // 当前音响了半秒
    const s0 = w8.__erhu.state().scaleStep;
    rateButtons[1].fire('click');               // 1拍/音
    rateButtons[0].fire('click');               // 2拍/音
    rateButtons[2].fire('click');               // ½拍/音（已过 500ms，剩余 60ms）
    advance(1000);
    const jumped = w8.__erhu.state().scaleStep - s0;
    // 新代码：560ms 走一步、1060ms 再一步 → 共 2 步
    // 旧代码：每次切换都留下没清掉的定时器，会连跳 3 步以上
    ok('切换拍数后不会连跳（旧代码残留定时器会乱节奏）', jumped === 2, `走了 ${jumped} 步`);
    const s1 = w8.__erhu.state().scaleStep;
    advance(5000);
    const per5s = w8.__erhu.state().scaleStep - s1;
    ok('之后按 ½拍(500ms) 匀速前进', per5s >= 9 && per5s <= 10, `5 秒走了 ${per5s} 步`);
  }

  console.log('\n=== 11. 停止 ===');
  w = loadPage({});
  getEl('startBtn').fire('click');
  await tick(); await tick();
  ok('先启动成功', w.__erhu.state().running === true);
  getEl('startBtn').fire('click');
  ok('回到未运行', w.__erhu.state().running === false);
  ok('按钮复位', getEl('startBtn').textContent === '开始调音', getEl('startBtn').textContent);

  console.log('\n=== 11. 权限被拒绝 ===');
  gumBehavior = 'NotAllowedError';
  w = loadPage({});
  getEl('startBtn').fire('click');
  await tick(); await tick();
  ok('未进入运行态', w.__erhu.state().running === false);
  ok('提示权限被拒绝', /权限被拒绝/.test(getEl('banner').innerHTML));
  ok('给出 iOS 设置路径', /设置 → Safari/.test(getEl('banner').innerHTML));
  ok('按钮解锁可重试', getEl('startBtn').disabled === false && getEl('startBtn').textContent === '开始调音');

  console.log('\n=== 12. 非 HTTPS / 非 Safari / 无 getUserMedia ===');
  w = loadPage({ secure: false });
  ok('提示不是 HTTPS', /不是 HTTPS/.test(getEl('banner').innerHTML));
  getEl('startBtn').fire('click');
  ok('非 HTTPS 下拒绝启动', w.__erhu.state().running === false);

  w = loadPage({ ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 MicroMessenger/8.0.44' });
  ok('微信内核给出 Safari 提示', /Safari/.test(getEl('banner').innerHTML));

  w = loadPage({ noGum: true });
  ok('无 getUserMedia 给出说明', /不支持麦克风采集/.test(getEl('banner').innerHTML));

  console.log('\n=== 13. 麦克风被占用 ===');
  gumBehavior = 'NotReadableError';
  w = loadPage({});
  getEl('startBtn').fire('click');
  await tick(); await tick();
  ok('提示被占用', /占用了/.test(getEl('banner').innerHTML));

  console.log('\n=== 14. 音准基准 A4 校准 ===');
  // 真实录音的音高标准各不相同（实测《翻身歌》≈441.6Hz、《金珠玛米赞》≈443.7Hz），
  // App 若写死 440，放这些录音时每个音都会被显示成"偏高"——那不是演奏不准。
  delete lsStore['erhu.a4'];
  w = loadPage({});
  ok('默认 A4 = 440（国际标准）', w.__erhu.state().a4Cal === 440, String(w.__erhu.state().a4Cal));
  ok('内弦空弦 293.66 Hz', Math.abs(w.__erhu.state().slotsInner[0].freq - 293.66) < 0.02, w.__erhu.state().slotsInner[0].freq.toFixed(2));
  ok('参考音标签显示 293.66', /293\.66/.test(getEl('refDFreq').textContent), getEl('refDFreq').textContent);
  ok('参考音标签显示 440.00', /440\.00/.test(getEl('refAFreq').textContent), getEl('refAFreq').textContent);

  a4Buttons[2].fire('click');                    // 442
  await tick();
  const s442 = w.__erhu.state();
  ok('切到 442 生效', s442.a4Cal === 442, String(s442.a4Cal));
  ok('内弦空弦随之变成 295.00 Hz', Math.abs(s442.slotsInner[0].freq - 295.00) < 0.05, s442.slotsInner[0].freq.toFixed(2));
  ok('外弦空弦随之变成 442.00 Hz', Math.abs(s442.slotsOuter[0].freq - 442.00) < 0.05, s442.slotsOuter[0].freq.toFixed(2));
  ok('按钮高亮切到 442', a4Buttons[2]._cls.has('on') && !a4Buttons[0]._cls.has('on'), '');
  ok('参考音标签同步更新', /295\.00/.test(getEl('refDFreq').textContent), getEl('refDFreq').textContent);
  ok('写进本地存储', lsStore['erhu.a4'] === '442', String(lsStore['erhu.a4']));

  w = loadPage({});
  ok('重开页面记住 442', w.__erhu.state().a4Cal === 442, String(w.__erhu.state().a4Cal));
  delete lsStore['erhu.a4'];

  console.log('\n=== 15. 跟录音练：系统性偏移诊断 ===');
  gumBehavior = 'ok';                            // 上一节模拟过"麦克风被占用"，这里要恢复
  w = loadPage({});
  getEl('startBtn').fire('click');               // 必须先启动，主循环才会跑
  await tick(); await tick();
  const baseF = w.__erhu.state().slotsInner[0].freq;
  toneFreq = baseF * Math.pow(2, 8 / 1200);      // 整个录音比 440 高 8 音分
  pump(60);
  const box = getEl('diagBox');
  box.open = true;
  box.fire('toggle');
  const diagTxt = getEl('diag').textContent;
  ok('诊断里标出"系统性偏高"', /系统性偏高/.test(diagTxt), diagTxt.split('\n').filter(l => /偏移/.test(l))[0] || diagTxt.slice(0, 60));
  ok('并建议把基准改成 442', /改成 442/.test(diagTxt), diagTxt.split('\n').filter(l => /改成/.test(l))[0] || '');
  const box2 = getEl('diagBox');
  box2.open = true;
  box2.fire('toggle');

  console.log('\n=== 16. 桩与真实 HTML 的一致性 ===');
  // 测试桩是"自己造按钮"的，所以真实 HTML 里标记写错了它抓不到。
  // 这里直接解析 index.html 原文校验按钮，堵住这个盲区
  // （真发生过：A4 的 442 按钮被误改成第二个 440，桩全过、界面上却露馅）。
  {
    const grab = seg => {
      const m = new RegExp('<div class="seg" id="' + seg + '">([\\s\\S]*?)</div>').exec(html);
      return m ? m[1] : '';
    };
    const vals = (chunk, name) => (chunk.match(new RegExp(name + '="[^"]+"', 'g')) || []).map(s => s.split('"')[1]);
    const a4 = grab('a4Seg');
    ok('HTML: A4 有 5 个按钮', vals(a4, 'data-a4').length === 5, String(vals(a4, 'data-a4').length));
    ok('HTML: A4 取值 = 440,441,442,443,444', vals(a4, 'data-a4').join(',') === '440,441,442,443,444', vals(a4, 'data-a4').join(','));
    ok('HTML: A4 默认只高亮一个', (a4.match(/class="on"/g) || []).length === 1, String((a4.match(/class="on"/g) || []).length));
    ok('HTML: A4 默认高亮 440', /data-a4="440" class="on"/.test(a4), a4.match(/data-a4="\d+" class="on"/) || '无');
    ok('HTML: 调号按钮齐全', vals(grab('keySeg'), 'data-key').join(',') === 'D,G,F,C,A,Bb', vals(grab('keySeg'), 'data-key').join(','));
    ok('HTML: 检测范围按钮齐全', vals(grab('modeSeg'), 'data-mode').join(',') === 'auto,D,A', vals(grab('modeSeg'), 'data-mode').join(','));
    const metro = /<div class="seg metroSeg" id="metroSeg">([\s\S]*?)<\/div>/.exec(html);
    ok('HTML: 拍数按钮齐全', metro && vals(metro[1], 'data-rate').join(',') === '2,1,0.5', metro ? vals(metro[1], 'data-rate').join(',') : '未找到 metroSeg');
  }

  console.log('\n=== 17. 练习计时器 ===');
  {
    w = loadPage({});
    ok('HTML: 计时按钮齐全（1/3/5 分钟）',
      (/<div class="seg timerSeg" id="timerSeg">([\s\S]*?)<\/div>/.exec(html) || [, ''])[1]
        .match(/data-min="[^"]+"/g).map(s => s.split('"')[1]).join(',') === '1,3,5',
      '');
    ok('初始无计时在跑', w.__erhu.timer.active() === null, String(w.__erhu.timer.active()));
    ok('初始按钮文字', timerButtons[1].textContent === '3 分钟', timerButtons[1].textContent);

    timerButtons[1].fire('click');                       // 启动 3 分钟
    ok('点了 3 分钟 → 启动', w.__erhu.timer.active() === '3', String(w.__erhu.timer.active()));
    ok('剩余 ≈ 180 秒', Math.abs(w.__erhu.timer.left() - 180000) < 300, w.__erhu.timer.left() + 'ms');
    ok('按钮显示倒计时', /^3:00$/.test(timerButtons[1].textContent), timerButtons[1].textContent);
    ok('正在计时的那颗高亮', timerButtons[1]._cls.has('on'), '');
    ok('其它按钮被禁用', timerButtons[0].disabled === true && timerButtons[2].disabled === true, '');

    advance(60000);                                      // 走 1 分钟
    ok('走 1 分钟后剩余 ≈ 120 秒', Math.abs(w.__erhu.timer.left() - 120000) < 600, w.__erhu.timer.left() + 'ms');
    ok('显示变成 2:00 附近', /^1:5\d$|^2:00$/.test(timerButtons[1].textContent), timerButtons[1].textContent);

    timerButtons[1].fire('click');                       // 再点一下 = 取消
    ok('再点一下取消', w.__erhu.timer.active() === null, String(w.__erhu.timer.active()));
    ok('取消后按钮文字复原', timerButtons[1].textContent === '3 分钟', timerButtons[1].textContent);
    ok('取消后其它按钮恢复可用', timerButtons[0].disabled === false, String(timerButtons[0].disabled));

    oscs = [];
    timerButtons[0].fire('click');                       // 1 分钟，跑满
    ok('启动 1 分钟', w.__erhu.timer.active() === '1', String(w.__erhu.timer.active()));
    advance(60500);
    ok('到点后自动结束', w.__erhu.timer.active() === null, String(w.__erhu.timer.active()));
    ok('到点响了三声', oscs.length === 3, `${oscs.length} 个振荡器`);
    ok('最后一声更高（1319Hz）', Math.abs(oscs[2].frequency.value - 1319) < 1, String(oscs[2].frequency.value));
    ok('横幅提示时间到', /分钟到/.test(getEl('banner').innerHTML), getEl('banner').innerHTML.slice(0, 50));
    ok('提示语更新为已完成', /已完成/.test(getEl('timerHint').textContent), getEl('timerHint').textContent);
  }

  console.log(`\n================ 结果: ${pass} 通过 / ${fail} 失败 ================\n`);  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('\n测试崩溃:', e); process.exit(1); });
