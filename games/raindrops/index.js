// 雨滴算术：天上落下装着算式的雨滴，在它落进水里之前输入答案、按「确定」。
// 答案一样的雨滴一起消掉；漏掉一滴水就涨一格，涨满三格游戏结束；答错不丢命，只是连对断了。
// 偶尔落下一颗金色的雨滴，答对它，屏幕上的雨滴全部消掉。分数越高题目越难、雨下得越快，但都只快一点点。
// 出题和难度在 rules.js，雨滴的形状在 drop.js，玩法介绍在 guide.js。接口说明见 js/player.js。

import guide from './guide.js';
import { COLORS, dropPath, layoutProblem } from './drop.js';
import { fallSeconds, makeProblem, maxDrops, OPS, pointsFor, solve, spawnSeconds } from './rules.js';

const LIVES = 3;
// 水面高度占天空的比例：一开始有一点，每漏一滴涨到警戒线的三分之一，漏满三滴正好涨到警戒线
const WATER_BASE = 0.07;
const WATER_FLOOD = 0.37;
const WATER_STEP = (WATER_FLOOD - WATER_BASE) / LIVES;
// 答对这么多滴以后才会来金色雨滴，之后每滴有 1/SUN_EVERY 的机会是金色的
const SUN_AFTER = 6;
const SUN_EVERY = 14;
const MAX_DIGITS = 3;
// 开始和继续之前的 3、2、1（秒）
const COUNTDOWN = 1.5;
// 结束面板出来后按钮先锁一会儿，免得正在狂按键盘时误点「再来一局」
const OVER_LOCK_MS = 700;
const FONT = 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif';

const fmt = (n) => n.toLocaleString('zh-CN');
const clamp01 = (t) => Math.min(1, Math.max(0, t));
const easeOut = (t) => 1 - (1 - t) ** 3;

const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/></svg>';
const BACKSPACE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.2 5h10.3a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H9.2a1.5 1.5 0 0 1-1.1-.5L2.8 12l5.3-6.5a1.5 1.5 0 0 1 1.1-.5Z"/><path d="m12 9.5 5 5m0-5-5 5"/></svg>';
const LIFE = `<svg viewBox="-11 -19 22 30" aria-hidden="true"><path d="${dropPath(0, 0, 10)}"/></svg>`;

const TEMPLATE = `
  <div class="rd">
    <div class="rd-top">
      <div class="rd-stat"><span>分数</span><strong data-ref="score">0</strong></div>
      <div class="rd-stat"><span>最高</span><strong data-ref="best">0</strong></div>
      <div class="rd-lives" data-ref="lives" role="img" aria-label="还能漏掉的雨滴">${LIFE.repeat(LIVES)}</div>
    </div>
    <div class="rd-sky" data-ref="sky">
      <canvas data-ref="canvas"></canvas>
      <button class="rd-pause" data-ref="pause" aria-label="暂停">${PAUSE}</button>
      <div class="rd-count" data-ref="count" hidden></div>
      <div class="rd-overlay" data-ref="overlay" hidden></div>
    </div>
    <div class="rd-input" data-ref="input">
      <span class="rd-answer" data-ref="answer"></span>
      <button class="rd-back" data-key="back" data-ref="back" aria-label="删掉一位">${BACKSPACE}</button>
    </div>
    <div class="rd-pad" data-ref="pad">
      ${[7, 8, 9, 4, 5, 6, 1, 2, 3, 0].map((d) => `<button data-key="${d}">${d}</button>`).join('')}
      <button class="rd-enter" data-key="enter">确定</button>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="raindrops"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'raindrops';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isCount = (v) => Number.isInteger(v) && v >= 0;

// 雨滴每秒落下天空高度的几分之几，由它出现时的分数决定
const speedFor = (score) => (1 - WATER_BASE) / fallSeconds(score);

// 读存档里的一局：分数、连对、漏了几滴这些说不通就整局不要（返回 null）；
// 雨滴逐个核对，答案按算式重新算，说不通的雨滴扔掉，最多留这个分数下能同时有的那么多滴
function readRun(run) {
  if (!run || ![run.score, run.combo, run.solved, run.misses].every(isCount) || run.misses >= LIVES
    || !isNum(run.spawnIn) || !Array.isArray(run.drops)) return null;
  // 雨滴的速度只会在 0 分的速度和现在分数的速度之间
  const slowest = speedFor(0) * (1 - 1e-9);
  const fastest = speedFor(run.score) * (1 + 1e-9);
  const drops = [];
  for (const d of run.drops) {
    if (drops.length >= maxDrops(run.score)) break;
    if (!d || !OPS.includes(d.op) || ![d.x, d.y, d.speed].every(isNum)) continue;
    const answer = solve(d.a, d.op, d.b);
    if (answer === null || d.x < 0 || d.x > 1 || d.y < -1 || d.y >= 1 || d.speed < slowest || d.speed > fastest) continue;
    drops.push({ a: d.a, b: d.b, op: d.op, answer, x: d.x, y: d.y, speed: d.speed, sun: d.sun === true });
  }
  return { ...run, drops, spawnIn: Math.min(Math.max(run.spawnIn, 0), spawnSeconds(0)) };
}

class Raindrops {
  constructor(root, ctx) {
    this.ctx = ctx;
    const saved = ctx.saved ?? {};
    this.best = ctx.records.score ?? 0;
    this.last = isNum(saved.last) ? saved.last : null;
    this.state = 'ready';
    this.input = '';
    this.drops = [];
    this.pops = []; // 答对后炸开的雨滴
    this.floats = []; // 飘起来的「+120」
    this.sparks = []; // 炸开和落水溅起的小水珠
    this.flashAt = -Infinity; // 金色雨滴消掉全部时闪一下
    this.clouds = [[0.12, 0.1, 1], [0.68, 0.2, 0.8], [0.38, 0.4, 0.62]].map(([x, y, s]) => ({ x, y, s }));
    this.water = WATER_BASE;
    this.misses = 0;
    this.score = 0;
    this.view = null;
    this.raf = 0;
    this.lastFrame = 0;
    this.overTimer = 0;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.g = this.refs.canvas.getContext('2d');

    // 按键用 pointerdown，手指一碰就输入，连着快按也跟得上
    const press = (e) => {
      const button = e.target.closest('[data-key]');
      if (!button || button.disabled) return;
      e.preventDefault();
      button.classList.add('is-pressed');
      setTimeout(() => button.classList.remove('is-pressed'), 120);
      this.press(button.dataset.key);
    };
    this.refs.pad.addEventListener('pointerdown', press);
    this.refs.back.addEventListener('pointerdown', press);
    this.refs.input.addEventListener('animationend', () => this.refs.input.classList.remove('is-wrong'));
    this.refs.pause.addEventListener('click', () => this.pauseRun());
    this.onKey = this.onKey.bind(this);
    this.frame = this.frame.bind(this);

    this.resizer = new ResizeObserver(() => this.layout());
    this.resizer.observe(this.refs.sky);
    this.scheme = window.matchMedia('(prefers-color-scheme: dark)');
    this.onScheme = () => this.readTheme();
    this.scheme.addEventListener('change', this.onScheme);
    this.readTheme();

    const run = readRun(saved.run);
    if (run) this.restore(run);
    else this.toReady();
    this.layout();
  }

  // 雨滴、水和云的颜色跟着浅色、深色模式变，定义在 style.css 里
  readTheme() {
    const style = getComputedStyle(this.refs.sky);
    const read = (name) => style.getPropertyValue(name).trim();
    this.theme = {
      drop: read('--rd-drop') || COLORS.drop,
      waterTop: read('--rd-water-top'),
      waterBottom: read('--rd-water-bottom'),
      cloud: read('--rd-cloud'),
      mark: read('--rd-mark'),
    };
  }

  layout() {
    const { sky, canvas } = this.refs;
    const w = sky.clientWidth;
    const h = sky.clientHeight;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    this.view = { w, h, dpr };
    // 题目排成一行，雨滴要够宽：iPhone SE 上半径约 37，最长的题（四位数字）数字也有 15 像素
    this.r = Math.min(42, Math.max(28, w / 9.2));
    this.shape = new Path2D(dropPath(0, 0, this.r));
    this.layouts = new Map();
    this.draw(performance.now());
  }

  // ---------- 一局的开始、暂停、结束 ----------

  newRun() {
    this.score = 0;
    this.bestBefore = this.best;
    this.combo = 0;
    this.maxCombo = 0;
    this.misses = 0;
    this.solved = 0;
    this.spawnIn = 0;
    this.drops = [];
    this.pops = [];
    this.floats = [];
    this.sparks = [];
    this.input = '';
  }

  toReady() {
    clearTimeout(this.overTimer);
    this.newRun();
    this.state = 'ready';
    const last = this.last === null ? '' : `<p class="rd-note">上一局 ${fmt(this.last)} 分 · 最高 ${fmt(this.best)} 分</p>`;
    this.showPanel(`<h3>雨滴算术</h3><p>在雨滴落进水里之前，算出里面的题</p>${last}`, [
      { label: '开始', primary: true, onClick: () => this.start() },
    ]);
    this.updateHud();
  }

  start() {
    this.newRun();
    this.startCountdown();
    this.save();
  }

  startCountdown() {
    this.hideOverlay();
    this.state = 'countdown';
    this.countdown = COUNTDOWN;
    this.updateHud();
  }

  restore(run) {
    this.newRun();
    this.score = run.score;
    this.bestBefore = isCount(run.bestBefore) ? run.bestBefore : this.best;
    this.combo = run.combo;
    this.maxCombo = isCount(run.maxCombo) ? Math.max(run.maxCombo, run.combo) : run.combo;
    this.misses = run.misses;
    this.solved = run.solved;
    this.spawnIn = run.spawnIn;
    this.drops = run.drops;
    this.water = WATER_BASE + this.misses * WATER_STEP;
    this.state = 'paused';
    this.showPause();
    this.updateHud();
  }

  pauseRun() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.state = 'paused';
    this.showPause();
    this.updateHud();
    this.save();
  }

  showPause() {
    this.showPanel(`<h3>已暂停</h3><p>现在 ${fmt(this.score)} 分</p>`, [
      { label: '重新开始', onClick: () => this.start() },
      { label: '继续', primary: true, onClick: () => this.startCountdown() },
    ]);
  }

  gameOver() {
    this.state = 'over';
    this.last = this.score;
    // 剩下的雨滴都散掉
    const now = performance.now();
    for (const drop of this.drops) this.pops.push({ drop, t0: now, faded: true });
    this.drops = [];
    this.input = '';
    this.updateHud();
    this.save();
    clearTimeout(this.overTimer);
    this.overTimer = setTimeout(() => this.showOver(), 450);
  }

  showOver() {
    const record = this.score > this.bestBefore && this.score > 0;
    const buttons = this.showPanel(`
      <h3>${record ? '新纪录！' : '水漫上来了'}</h3>
      <p>答对 ${this.solved} 滴 · 最多连对 ${this.maxCombo} 滴</p>
      <div class="rd-stats">
        <div><span>得分</span><strong>${fmt(this.score)}</strong></div>
        <div><span>最高</span><strong>${fmt(this.best)}</strong></div>
      </div>`, [{ label: '再来一局', primary: true, onClick: () => this.start() }]);
    buttons.forEach((button) => {
      button.disabled = true;
    });
    this.overTimer = setTimeout(() => buttons.forEach((button) => {
      button.disabled = false;
    }), OVER_LOCK_MS);
  }

  showPanel(html, actions) {
    const { overlay } = this.refs;
    overlay.innerHTML = `<div class="rd-panel">${html}<div class="rd-actions"></div></div>`;
    const row = overlay.querySelector('.rd-actions');
    const buttons = actions.map(({ label, primary, onClick }) => {
      const button = document.createElement('button');
      button.className = primary ? 'rd-btn is-primary' : 'rd-btn';
      button.textContent = label;
      button.addEventListener('click', onClick);
      row.append(button);
      return button;
    });
    overlay.hidden = false;
    return buttons;
  }

  hideOverlay() {
    this.refs.overlay.hidden = true;
    this.refs.overlay.replaceChildren();
  }

  // ---------- 存档 ----------

  hasRun() {
    return ['playing', 'countdown', 'paused'].includes(this.state);
  }

  save() {
    const run = this.hasRun() ? {
      score: this.score,
      bestBefore: this.bestBefore,
      combo: this.combo,
      maxCombo: this.maxCombo,
      misses: this.misses,
      solved: this.solved,
      spawnIn: Math.round(this.spawnIn * 100) / 100,
      drops: this.drops.map(({ a, b, op, answer, x, y, speed, sun }) => ({ a, b, op, answer, x, y, speed, sun })),
    } : null;
    let summary = '准备开始';
    if (run) summary = `${fmt(this.score)} 分 · 还能漏 ${LIVES - this.misses} 滴`;
    else if (this.last !== null) summary = `上一局 ${fmt(this.last)} 分 · 最高 ${fmt(this.best)}`;
    this.ctx.save({ last: this.last, run }, { summary, finished: !run });
  }

  // ---------- 输入 ----------

  press(key) {
    if (key === 'enter') this.submit();
    else if (key === 'back') this.input = this.input.slice(0, -1);
    else if (this.state === 'playing' || this.state === 'countdown') {
      if (this.input === '0') this.input = key;
      else if (this.input.length < MAX_DIGITS) this.input += key;
    }
    this.renderInput();
  }

  setKeyboard(on) {
    if (on) document.addEventListener('keydown', this.onKey);
    else document.removeEventListener('keydown', this.onKey);
  }

  // 电脑上可以直接敲数字，退格删一位，回车确定，P 暂停
  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    if (/^[0-9]$/.test(e.key)) this.press(e.key);
    else if (e.key === 'Backspace') this.press('back');
    else if (e.key === 'Enter') this.press('enter');
    else if (e.key === 'p' || e.key === 'P') this.pauseRun();
    else return;
    e.preventDefault();
  }

  // 按「确定」：答案对上的雨滴全部消掉；其中有金色的，就把屏幕上的雨滴全部消掉
  submit() {
    if (this.state !== 'playing' || !this.input) return;
    const value = Number(this.input);
    this.input = '';
    const hits = this.drops.filter((drop) => drop.answer === value);
    if (!hits.length) {
      this.combo = 0;
      this.refs.input.classList.remove('is-wrong');
      void this.refs.input.offsetWidth;
      this.refs.input.classList.add('is-wrong');
      return;
    }
    const now = performance.now();
    const sun = hits.some((drop) => drop.sun);
    const cleared = sun ? this.drops : hits;
    if (sun) this.flashAt = now;
    for (const drop of cleared) {
      const points = pointsFor(this.score, this.combo);
      this.combo++;
      this.score += points;
      this.pop(drop, points, now);
    }
    this.maxCombo = Math.max(this.maxCombo, this.combo);
    this.solved += cleared.length;
    this.drops = this.drops.filter((drop) => !cleared.includes(drop));
    this.best = this.ctx.submitRecord('score', this.score);
    this.updateHud();
    this.save();
  }

  renderInput() {
    const { answer, back } = this.refs;
    answer.textContent = this.input || '输入答案';
    answer.classList.toggle('is-empty', !this.input);
    back.disabled = !this.input;
  }

  // ---------- 雨滴 ----------

  // 新雨滴的横向位置：在几个随机位置里挑离上面那些雨滴最远的，免得叠在一起。
  // 天空左上角是暂停键，雨滴整个落在它右边，题目刚落下来时不会被它挡住
  pickX() {
    const { w } = this.view;
    const r = this.r;
    const { pause } = this.refs;
    const left = Math.max(r + 6, pause.offsetLeft + pause.offsetWidth + 4 + r);
    const right = w - r - 6;
    const near = this.drops.filter((drop) => drop.y * this.view.h < r * 4).map((drop) => drop.x * w);
    let best = w / 2;
    let room = -1;
    for (let k = 0; k < 8; k++) {
      const x = left + Math.random() * Math.max(0, right - left);
      const gap = Math.min(Infinity, ...near.map((other) => Math.abs(other - x)));
      if (gap > room) {
        best = x;
        room = gap;
      }
    }
    return best / w;
  }

  spawn() {
    const sun = this.solved >= SUN_AFTER && !this.drops.some((drop) => drop.sun) && Math.random() < 1 / SUN_EVERY;
    // 同一道题不同时出现两次
    let problem = makeProblem(this.score);
    for (let k = 0; k < 5 && this.drops.some((d) => d.a === problem.a && d.b === problem.b && d.op === problem.op); k++) {
      problem = makeProblem(this.score);
    }
    this.drops.push({
      ...problem,
      x: this.pickX(),
      y: (-0.9 * this.r) / this.view.h,
      speed: speedFor(this.score),
      sun,
    });
  }

  pop(drop, points, now) {
    const x = drop.x * this.view.w;
    const y = drop.y * this.view.h;
    this.pops.push({ drop, t0: now });
    this.floats.push({ x, y: y - this.r * 0.4, text: `+${points}`, t0: now });
    this.burst(x, y, drop.sun ? COLORS.sun[1] : '#ffffff', 10, now);
  }

  // 一滴雨落进水里：水涨一格，连对断掉，涨满就结束
  miss(drop, now) {
    this.drops = this.drops.filter((other) => other !== drop);
    this.burst(drop.x * this.view.w, (1 - this.waterLevel()) * this.view.h, this.theme.waterTop, 14, now, true);
    this.misses++;
    this.combo = 0;
    if (this.misses >= LIVES) this.gameOver();
    else {
      this.updateHud();
      this.save();
    }
  }

  burst(x, y, color, count, now, splash = false) {
    const r = this.r;
    for (let k = 0; k < count; k++) {
      const angle = splash ? -Math.PI / 2 + (Math.random() - 0.5) * 2 : Math.random() * Math.PI * 2;
      const speed = r * (splash ? 3 + Math.random() * 4 : 2 + Math.random() * 3);
      this.sparks.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: r * (0.06 + Math.random() * 0.08),
        color,
        t0: now,
        life: 450 + Math.random() * 300,
      });
    }
  }

  waterLevel() {
    return WATER_BASE + this.misses * WATER_STEP;
  }

  // ---------- 每一帧 ----------

  setLoop(on) {
    if (on && !this.raf) {
      this.lastFrame = 0;
      this.raf = requestAnimationFrame(this.frame);
    } else if (!on && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  frame(now) {
    const dt = this.lastFrame ? Math.min(0.05, (now - this.lastFrame) / 1000) : 0;
    this.lastFrame = now;
    this.update(dt, now);
    this.draw(now);
    this.raf = requestAnimationFrame(this.frame);
  }

  update(dt, now) {
    for (const cloud of this.clouds) cloud.x = cloud.x > 1.3 ? -0.3 : cloud.x + dt * 0.006 * (1.4 - cloud.s);
    this.water += (this.waterLevel() - this.water) * (1 - Math.exp(-dt * 5));
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += this.r * 14 * dt;
    }
    this.sparks = this.sparks.filter((s) => now - s.t0 < s.life);
    this.pops = this.pops.filter((p) => now - p.t0 < 260);
    this.floats = this.floats.filter((f) => now - f.t0 < 800);

    if (this.state === 'countdown') {
      this.countdown -= dt;
      this.refs.count.textContent = Math.max(1, Math.ceil((this.countdown / COUNTDOWN) * 3));
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.updateHud();
      }
      return;
    }
    if (this.state !== 'playing' || !this.view) return;

    this.spawnIn -= dt;
    if (this.spawnIn <= 0 && this.drops.length < maxDrops(this.score)) {
      this.spawn();
      this.spawnIn = spawnSeconds(this.score);
    } else if (!this.drops.length && this.spawnIn > 0.6) {
      // 屏幕上的雨滴都消完了，下一滴快点来，不用干等
      this.spawnIn = 0.6;
    }
    const surface = (1 - this.waterLevel()) * this.view.h;
    for (const drop of [...this.drops]) {
      drop.y += drop.speed * dt;
      if (drop.y * this.view.h + this.r >= surface) this.miss(drop, now);
      if (this.state !== 'playing') break;
    }
  }

  draw(now) {
    if (!this.view) return;
    const g = this.g;
    const { w, h, dpr } = this.view;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    for (const cloud of this.clouds) this.drawCloud(cloud.x * w, cloud.y * h, cloud.s * w * 0.32);
    for (const drop of this.drops) this.drawDrop(drop, drop.x * w, drop.y * h, 1, 1, now);
    for (const p of this.pops) {
      const t = (now - p.t0) / 260;
      this.drawDrop(p.drop, p.drop.x * w, p.drop.y * h, p.faded ? 1 : 1 + easeOut(t) * 0.45, 1 - t, now);
    }
    this.drawWater(now);
    for (const s of this.sparks) {
      g.globalAlpha = 1 - (now - s.t0) / s.life;
      g.fillStyle = s.color;
      g.beginPath();
      g.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `800 ${Math.round(this.r * 0.62)}px ${FONT}`;
    for (const f of this.floats) {
      const t = (now - f.t0) / 800;
      g.globalAlpha = 1 - t * t;
      g.fillStyle = '#ffffff';
      g.shadowColor = 'rgba(0, 40, 60, 0.45)';
      g.shadowBlur = 6;
      g.fillText(f.text, f.x, f.y - easeOut(t) * this.r * 1.2);
    }
    g.shadowBlur = 0;
    const flash = (now - this.flashAt) / 450;
    if (flash < 1) {
      g.globalAlpha = 0.55 * (1 - flash);
      g.fillStyle = '#fff6d6';
      g.fillRect(0, 0, w, h);
    }
    g.globalAlpha = 1;
  }

  drawCloud(x, y, size) {
    const g = this.g;
    g.fillStyle = this.theme.cloud;
    g.beginPath();
    for (const [dx, dy, r] of [[0, 0, 0.22], [0.2, -0.1, 0.2], [0.4, 0, 0.17], [-0.2, 0.04, 0.15]]) {
      g.moveTo(x + dx * size + r * size, y + dy * size);
      g.arc(x + dx * size, y + dy * size, r * size, 0, Math.PI * 2);
    }
    g.rect(x - 0.2 * size, y, 0.6 * size, 0.17 * size);
    g.fill();
  }

  // 一滴雨：深色的底、白边，中间一行题目；金色雨滴发光
  drawDrop(drop, x, y, scale, alpha, now) {
    const g = this.g;
    const r = this.r;
    g.save();
    g.translate(x, y);
    g.scale(scale, scale);
    g.globalAlpha = clamp01(alpha);
    if (drop.sun) {
      const gradient = g.createLinearGradient(0, -1.7 * r, 0, r);
      gradient.addColorStop(0, COLORS.sun[0]);
      gradient.addColorStop(1, COLORS.sun[1]);
      g.shadowColor = 'rgba(255, 190, 40, 0.9)';
      g.shadowBlur = r * (0.5 + 0.2 * Math.sin(now / 160));
      g.fillStyle = gradient;
    } else {
      g.fillStyle = this.theme.drop;
    }
    g.fill(this.shape);
    g.shadowBlur = 0;
    g.lineWidth = r * 0.12;
    g.lineJoin = 'round';
    g.strokeStyle = COLORS.dropEdge;
    g.stroke(this.shape);

    // 题目写成一行「a op b」，运算符换一种颜色；雨滴只会往下落，不转也不晃，字一直是正的
    const t = this.problemLayout(drop);
    g.textBaseline = 'alphabetic';
    g.textAlign = 'left';
    g.fillStyle = drop.sun ? COLORS.sunInk : COLORS.ink;
    g.font = `700 ${t.size}px ${FONT}`;
    g.fillText(String(drop.a), t.aX, t.baseline);
    g.fillText(String(drop.b), t.bX, t.baseline);
    g.fillStyle = drop.sun ? COLORS.sunInk : COLORS.ops[drop.op];
    g.font = `800 ${t.opSize}px ${FONT}`;
    g.fillText(drop.op, t.opX, t.baseline);
    g.restore();
  }

  // 一道题怎么排（见 drop.js），用 canvas 实际量字宽；同一道题排一次就记下来，雨滴大小变了再重排
  problemLayout(drop) {
    const key = `${drop.a}${drop.op}${drop.b}`;
    let t = this.layouts.get(key);
    if (!t) {
      const g = this.g;
      t = layoutProblem(drop, this.r, (text, size, isOp) => {
        g.font = `${isOp ? 800 : 700} ${size}px ${FONT}`;
        return g.measureText(text).width;
      });
      if (this.layouts.size > 200) this.layouts.clear();
      this.layouts.set(key, t);
    }
    return t;
  }

  // 水面：两层起伏的波浪；左边的刻度是漏几滴会涨到哪里，最上面那条就是警戒线
  drawWater(now) {
    const g = this.g;
    const { w, h } = this.view;
    const t = now / 1000;
    g.fillStyle = this.theme.mark;
    for (let k = 1; k <= LIVES; k++) g.fillRect(0, (1 - WATER_BASE - k * WATER_STEP) * h - 1.5, 14, 3);
    const top = (1 - this.water) * h;
    const wave = (phase, speed, amp, waves) => {
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w + 8; x += 8) g.lineTo(x, top + Math.sin((x / w) * waves * Math.PI * 2 + t * speed + phase) * amp);
      g.lineTo(w, h);
      g.closePath();
    };
    g.globalAlpha = 0.45;
    g.fillStyle = this.theme.waterTop;
    wave(1.7, -1.1, 4, 1.2);
    g.fill();
    g.globalAlpha = 1;
    const gradient = g.createLinearGradient(0, top, 0, h);
    gradient.addColorStop(0, this.theme.waterTop);
    gradient.addColorStop(1, this.theme.waterBottom);
    g.fillStyle = gradient;
    wave(0, 1.6, 3, 1.7);
    g.fill();
  }

  // ---------- 状态栏 ----------

  updateHud() {
    const { score, best, lives, pause, pad, count } = this.refs;
    for (const [el, value] of [[score, this.score], [best, this.best]]) {
      el.textContent = fmt(value);
      // 六位数（100,000）起缩小字号，小屏上也放得下
      el.classList.toggle('is-long', el.textContent.length > 6);
    }
    [...lives.children].forEach((life, k) => life.classList.toggle('is-lost', k >= LIVES - this.misses));
    pause.hidden = this.state !== 'playing' && this.state !== 'countdown';
    count.hidden = this.state !== 'countdown';
    pad.classList.toggle('is-idle', !['playing', 'countdown'].includes(this.state));
    this.renderInput();
  }

  // ---------- 生命周期 ----------

  pause() {
    this.pauseRun();
    this.setLoop(false);
    this.setKeyboard(false);
    this.save();
  }

  resume() {
    this.setKeyboard(true);
    this.setLoop(true);
  }

  destroy() {
    this.setLoop(false);
    this.setKeyboard(false);
    clearTimeout(this.overTimer);
    this.resizer.disconnect();
    this.scheme.removeEventListener('change', this.onScheme);
  }
}

export default {
  guide,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Raindrops(root, ctx);
    return {
      pause: () => game.pause(),
      resume: () => game.resume(),
      destroy: () => game.destroy(),
    };
  },
};
