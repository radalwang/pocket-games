// 倒水：点一根管子拿起来，再点另一根把水倒进去；只能倒进空管，或者倒在同一种颜色的水上面。
// 每根管子都装满同一种颜色就过关。撤销每局 5 次，卡住时还可以加一根空管（每局一次）。
// 管子和水画在 canvas 上，这样管子倾斜时水面也能一直保持水平。
// 规则、出题和求解在 puzzle.js。接口说明见 js/player.js。

import { canPick, canPour, CAPACITY, COLOR_COUNT, generate, hasMove, isDone, isWon, pour, top, unpour } from './puzzle.js';

const LEVELS = { easy: '初级', medium: '中级', hard: '高级' };
const UNDOS = 5;
// 颜色按好不好区分排序，颜色少的难度只用前面几种
const PALETTE = ['#ff3b30', '#2f6bff', '#ffd60a', '#34c759', '#b45cf2', '#ff9500', '#ff7ac3', '#5ad1fa', '#9c6a3d', '#a9a9b1'];
// 每种颜色再配一个小图案，分不清颜色的时候看图案也能认出来，顺序跟 PALETTE 一一对应。
// 图案半透明地叠在水上：深色的水上用白色，浅色的水上用黑色。水的颜色不随浅色、深色模式变，两种模式下都一样清楚
const LIGHT_INK = 'rgba(255, 255, 255, 0.55)';
const DARK_INK = 'rgba(0, 0, 0, 0.3)';
const MARKS = [
  ['dot', LIGHT_INK], // 红
  ['ring', LIGHT_INK], // 蓝
  ['triangle', DARK_INK], // 黄
  ['plus', DARK_INK], // 绿
  ['diamond', LIGHT_INK], // 紫
  ['wave', DARK_INK], // 橙
  ['star', DARK_INK], // 粉
  ['cross', DARK_INK], // 青
  ['square', LIGHT_INK], // 棕
  ['stripes', DARK_INK], // 灰
];
// 图案的大小，以管宽为单位
const MARK_SIZE = 0.4;

// 管子的形状，以管宽为 1：每层水高 LAYER，装满后水面上方还空着 HEAD，底是半圆。
// 半圆底比方底少装一点水，管子再加长一点补上，这样四层水正好装到 HEAD 下面
const LAYER = 0.9;
const HEAD = 0.55;
const RADIUS = 0.5;
const DEPTH = HEAD + CAPACITY * LAYER + RADIUS - (Math.PI * RADIUS) / 4;

// 排版，同样以管宽为单位：最上面留出倒水时举起管子的地方，两排之间留出拿起管子的地方
const TOP_ROOM = 1.9;
const ROW_GAP = 1;
const LIFT = 0.45;
const MAX_WIDTH = 50;
// 底下留给提示条的高度（像素）
const NOTE_ROOM = 36;

// 一次倒水分三段：飞到目标管上方并倾斜，倒水，飞回原位
const MOVE_MS = 230;
const BACK_MS = 230;
const flowMs = (count) => 140 + 90 * count;
// 水柱从管口落到水面要一点时间：源管倒完以后，目标管还要再接一会儿
const LAG = 0.15;
const APPEAR_MS = 320;
const SHAKE_MS = 320;
const CORK_MS = 280;
const WAVE_MS = 480;
const WAVE_STEP = 60;

const clamp01 = (t) => Math.min(1, Math.max(0, t));
const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeOutBack = (t) => 1 + 2.7 * (t - 1) ** 3 + 1.7 * (t - 1) ** 2;

function clock(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

// ---------- 管子的几何 ----------

// 管子内壁的轮廓，原点在管口中间：从右上角往下，绕过半圆底，回到左上角
const OUTLINE = [[0.5, 0]];
for (let k = 0; k <= 12; k++) {
  const a = (Math.PI * k) / 12;
  OUTLINE.push([RADIUS * Math.cos(a), DEPTH - RADIUS + RADIUS * Math.sin(a)]);
}
OUTLINE.push([-0.5, 0]);
// 画玻璃时管口两边各往外翻一点
const RIMMED = [[0.6, 0], ...OUTLINE, [-0.6, 0]];

// 把管子上的点放到画布上。pose = { x, y, angle, pivot }：管口上 pivot 那一点（-0.5 左角、0 中间、0.5 右角）
// 放在 (x, y)，整根管子绕它顺时针转 angle；w 是管宽（像素）
function place(pose, w, points = OUTLINE) {
  const cos = Math.cos(pose.angle);
  const sin = Math.sin(pose.angle);
  return points.map(([px, py]) => {
    const lx = (px - pose.pivot) * w;
    const ly = py * w;
    return [pose.x + lx * cos - ly * sin, pose.y + lx * sin + ly * cos];
  });
}

// 多边形在 y = level 这条水平线以下（画布 y 朝下）的面积
function areaBelow(points, level) {
  const kept = [];
  points.forEach(([x1, y1], k) => {
    const [x2, y2] = points[(k + 1) % points.length];
    if (y1 >= level) kept.push([x1, y1]);
    if (y1 >= level !== y2 >= level) kept.push([x1 + ((level - y1) / (y2 - y1)) * (x2 - x1), level]);
  });
  let area = 0;
  kept.forEach(([x1, y1], k) => {
    const [x2, y2] = kept[(k + 1) % kept.length];
    area += x1 * y2 - x2 * y1;
  });
  return Math.abs(area) / 2;
}

// 水面在哪个高度，下面正好是这么多水（单位：层）
function levelFor(points, volume, w) {
  const target = volume * LAYER * w * w;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [, y] of points) {
    lo = Math.min(lo, y);
    hi = Math.max(hi, y);
  }
  for (let k = 0; k < 24; k++) {
    const mid = (lo + hi) / 2;
    if (areaBelow(points, mid) > target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

// 管子绕右上角往右倒 θ 度（0 到 90）时，右上角以下还装得下几层水
const SPILL = Array.from({ length: 91 }, (_, deg) =>
  areaBelow(place({ x: 0, y: 0, angle: (deg * Math.PI) / 180, pivot: 0.5 }, 1), 0) / LAYER);

// 倒水时管子倾斜多少跟着剩下的水量走：水面正好碰到管口
function tiltFor(volume) {
  if (volume >= SPILL[0]) return 0;
  for (let d = 1; d <= 90; d++) {
    if (SPILL[d] <= volume) return ((d - 1 + (SPILL[d - 1] - volume) / (SPILL[d - 1] - SPILL[d])) * Math.PI) / 180;
  }
  return Math.PI / 2;
}

// 管子里的水按颜色分段，从下往上：[{ color, amount }]，amount 以层为单位，倒水途中可以是小数
function bandsOf(tube) {
  const bands = [];
  for (const color of tube) {
    const last = bands[bands.length - 1];
    if (last?.color === color) last.amount++;
    else bands.push({ color, amount: 1 });
  }
  return bands;
}

// 最上面一段加上（或减去）一些水
function adjustTop(bands, color, delta) {
  const out = bands.map((band) => ({ ...band }));
  const last = out[out.length - 1];
  if (last?.color === color) last.amount += delta;
  else if (delta > 0) out.push({ color, amount: delta });
  if (out.length && out[out.length - 1].amount <= 1e-6) out.pop();
  return out;
}

function trace(g, points, closed) {
  g.beginPath();
  points.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  if (closed) g.closePath();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 水平线 y 穿过管子的那一段的中点
function middleAt(points, y) {
  let left = Infinity;
  let right = -Infinity;
  points.forEach(([x1, y1], k) => {
    const [x2, y2] = points[(k + 1) % points.length];
    if (y1 >= y === y2 >= y) return;
    const x = x1 + ((y - y1) / (y2 - y1)) * (x2 - x1);
    left = Math.min(left, x);
    right = Math.max(right, x);
  });
  return (left + right) / 2;
}

// 小图案的画法：原点在正中，r 是半径；用线画的图案粗细都一样（见 drawMark）
const scaled = (points, r) => points.map(([x, y]) => [x * r, y * r]);
function segments(g, list, r) {
  for (const [x1, y1, x2, y2] of list) {
    g.moveTo(x1 * r, y1 * r);
    g.lineTo(x2 * r, y2 * r);
  }
}
const STAR = Array.from({ length: 10 }, (_, k) => {
  const a = -Math.PI / 2 + (k * Math.PI) / 5;
  const d = k % 2 ? 0.42 : 0.95;
  return [d * Math.cos(a), d * Math.sin(a)];
});
const MARK_SHAPES = {
  dot(g, r) {
    g.arc(0, 0, r * 0.62, 0, Math.PI * 2);
    g.fill();
  },
  ring(g, r) {
    g.arc(0, 0, r * 0.6, 0, Math.PI * 2);
    g.stroke();
  },
  triangle(g, r) {
    trace(g, scaled([[0, -0.8], [0.86, 0.7], [-0.86, 0.7]], r), true);
    g.fill();
  },
  plus(g, r) {
    segments(g, [[-0.74, 0, 0.74, 0], [0, -0.74, 0, 0.74]], r);
    g.stroke();
  },
  diamond(g, r) {
    trace(g, scaled([[0, -0.92], [0.7, 0], [0, 0.92], [-0.7, 0]], r), true);
    g.fill();
  },
  wave(g, r) {
    for (let k = 0; k <= 16; k++) g.lineTo(((k / 16) * 1.6 - 0.8) * r, -Math.sin((k / 16) * Math.PI * 3) * 0.32 * r);
    g.stroke();
  },
  star(g, r) {
    trace(g, scaled(STAR, r), true);
    g.fill();
  },
  cross(g, r) {
    segments(g, [[-0.6, -0.6, 0.6, 0.6], [0.6, -0.6, -0.6, 0.6]], r);
    g.stroke();
  },
  square(g, r) {
    g.rect(-0.58 * r, -0.58 * r, 1.16 * r, 1.16 * r);
    g.stroke();
  },
  stripes(g, r) {
    segments(g, [[-0.72, -0.56, 0.72, -0.56], [-0.72, 0, 0.72, 0], [-0.72, 0.56, 0.72, 0.56]], r);
    g.stroke();
  },
};

// 在 size × size 的小画布正中画一种颜色的图案
function drawMark(g, [kind, ink], size) {
  const r = size / 2;
  g.translate(r, r);
  g.fillStyle = ink;
  g.strokeStyle = ink;
  g.lineWidth = r * 0.3;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.beginPath();
  MARK_SHAPES[kind](g, r);
}

// ---------- 界面 ----------

const RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';
const UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const ADD_TUBE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 3.5h8M7.5 3.5V17a2 2 0 0 0 4 0V3.5"/><path d="M18.5 8.5v7M15 12h7"/></svg>';
const REPLAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.5 5v14"/><path d="M18.5 5.5 9 12l9.5 6.5Z"/></svg>';

const TEMPLATE = `
  <div class="ws">
    <div class="ws-seg" data-ref="levels">
      ${Object.entries(LEVELS).map(([key, name]) => `<button data-level="${key}">${name}</button>`).join('')}
    </div>
    <div class="ws-top">
      <div class="ws-stat"><span>步数</span><strong data-ref="moves">0</strong></div>
      <div class="ws-stat"><span>用时</span><strong data-ref="time">0:00</strong></div>
      <button class="ws-new" data-ref="newGame">${RESTART}新游戏</button>
    </div>
    <div class="ws-stage" data-ref="stage">
      <canvas data-ref="canvas"></canvas>
      <p class="ws-note" data-ref="note" hidden></p>
    </div>
    <div class="ws-bottom" data-ref="bottom">
      <div class="ws-tools">
        <button data-tool="undo" data-ref="undo">${UNDO}<span>撤销</span><i class="ws-badge" data-ref="undoBadge">${UNDOS}</i></button>
        <button data-tool="tube" data-ref="tube">${ADD_TUBE}<span>加空管</span><i class="ws-badge" data-ref="tubeBadge">1</i></button>
        <button data-tool="restart" data-ref="restart">${REPLAY}<span>重来</span></button>
      </div>
      <div class="ws-result" data-ref="result" hidden>
        <span data-ref="resultText"></span>
        <button class="ws-again" data-ref="again">再来一局</button>
      </div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="watersort"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'watersort';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

const isTube = (tube, colors) =>
  Array.isArray(tube) && tube.length <= CAPACITY && tube.every((c) => Number.isInteger(c) && c >= 0 && c < colors);

function isValidSave(saved) {
  const colors = LEVELS[saved?.level] && COLOR_COUNT[saved.level];
  if (!colors) return false;
  const { start, tubes, history } = saved;
  return Array.isArray(start) && start.length === colors + 2 && start.every((tube) => isTube(tube, colors))
    && Array.isArray(tubes) && tubes.length >= start.length && tubes.length <= start.length + 1
    && tubes.every((tube) => isTube(tube, colors))
    && Array.isArray(history)
    && history.every((move) => Array.isArray(move) && move.length === 3 && move.every(Number.isInteger))
    && canUndoAll(tubes, history.slice(-UNDOS));
}

// 留下来的几步撤销要能从现在的局面一步步倒回去，倒不回去说明存档坏了
function canUndoAll(tubes, history) {
  const copy = tubes.map((tube) => tube.slice());
  return history.slice().reverse().every((move) => unpour(copy, move));
}

class WaterSort {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.active = false;
    this.runningSince = 0;
    this.ticker = 0;
    this.selected = -1;
    this.pours = []; // 正在播放的倒水动画
    this.lifts = []; // 每根管子拿起来的高度，0 到 1
    this.slots = []; // 每根管子该在的位置（管口中间）
    this.spots = []; // 每根管子现在画在哪，加了空管以后会滑到新位置
    this.born = []; // 每根管子出现的时刻
    this.corks = new Map(); // 排好的管子 → 塞子落下的时刻
    this.shakes = new Map(); // 晃一下表示点了也没用
    this.sparks = [];
    this.waveAt = -Infinity;
    this.pendingWin = false;
    this.width = 0;
    this.sprites = []; // 每种颜色的小图案，画好一次存起来
    this.markPx = 0;
    this.raf = 0;
    this.lastFrame = 0;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.g = this.refs.canvas.getContext('2d');

    this.refs.levels.addEventListener('click', (e) => {
      const button = e.target.closest('[data-level]');
      if (button) this.chooseLevel(button.dataset.level);
    });
    root.querySelector('.ws-tools').addEventListener('click', (e) => {
      const tool = e.target.closest('[data-tool]')?.dataset.tool;
      if (tool === 'undo') this.undo();
      else if (tool === 'tube') this.addTube();
      else if (tool === 'restart') this.restart();
    });
    this.refs.canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0) this.tap(this.hit(e));
    });
    this.refs.newGame.addEventListener('click', () => this.requestNewGame());
    this.refs.again.addEventListener('click', () => this.newGame());
    this.onKey = this.onKey.bind(this);
    this.frame = this.frame.bind(this);

    this.resizer = new ResizeObserver(() => this.layout(true));
    this.resizer.observe(this.refs.stage);
    this.scheme = window.matchMedia('(prefers-color-scheme: dark)');
    this.onScheme = () => {
      this.readTheme();
      this.draw();
    };
    this.scheme.addEventListener('change', this.onScheme);
    this.readTheme();

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.newGame('easy');
  }

  // 玻璃的颜色跟着浅色、深色模式变，定义在 style.css 里
  readTheme() {
    const style = getComputedStyle(this.refs.stage);
    const read = (name) => style.getPropertyValue(name).trim();
    this.theme = { glass: read('--ws-glass'), inside: read('--ws-inside'), shine: read('--ws-shine') };
  }

  // ---------- 开局与存档 ----------

  // 这一局有没有动过
  get started() {
    return this.status === 'playing' && (this.moves > 0 || this.extraUsed);
  }

  chooseLevel(level) {
    if (level === this.level && this.status === 'playing') return;
    if (this.started && !window.confirm('换难度会放弃这一局，确定吗？')) return;
    this.newGame(level);
  }

  requestNewGame() {
    if (this.started && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
  }

  newGame(level = this.level) {
    this.stopClock();
    this.level = level;
    this.start = generate(level);
    this.elapsed = 0;
    this.record = null;
    this.reset();
    this.save();
    if (this.active) this.startClock();
  }

  // 重来：回到这一题的开头，撤销次数和空管也还给你，用时接着算
  restart() {
    if (!this.started || !window.confirm('回到这一题的开头重新倒，确定吗？')) return;
    this.reset();
    this.save();
  }

  reset() {
    this.tubes = this.start.map((tube) => tube.slice());
    this.history = [];
    this.undosLeft = UNDOS;
    this.extraUsed = false;
    this.moves = 0;
    this.status = 'playing';
    this.clearMotion();
    const now = performance.now();
    this.born = this.tubes.map((_, i) => now + i * 30);
    this.layout(true);
    this.updateChrome();
    this.requestFrame();
  }

  restore(saved) {
    this.level = saved.level;
    this.start = saved.start;
    this.tubes = saved.tubes;
    this.history = saved.history.slice(-UNDOS);
    this.undosLeft = Math.min(UNDOS, saved.undosLeft ?? UNDOS);
    this.extraUsed = Boolean(saved.extraUsed);
    this.moves = saved.moves || 0;
    this.elapsed = saved.elapsed || 0;
    this.status = saved.status === 'won' ? 'won' : 'playing';
    this.record = saved.record ?? null;
    this.clearMotion();
    // 接着上次玩，管子不用再出场；每根都记上，之后加的空管才会排在对的位置上
    this.born = this.tubes.map(() => -Infinity);
    this.layout(true);
    this.updateChrome();
  }

  clearMotion() {
    this.selected = -1;
    this.pours = [];
    this.sparks = [];
    this.shakes.clear();
    this.pendingWin = false;
    this.waveAt = -Infinity;
    this.lifts = this.tubes.map(() => 0);
    this.corks.clear();
    this.sealAll();
  }

  save() {
    const state = {
      level: this.level,
      start: this.start,
      tubes: this.tubes,
      history: this.history,
      undosLeft: this.undosLeft,
      extraUsed: this.extraUsed,
      moves: this.moves,
      elapsed: Math.round(this.now()),
      status: this.status,
      record: this.record,
    };
    this.ctx.save(state, { summary: this.summary(), finished: this.status === 'won' });
  }

  summary() {
    const name = LEVELS[this.level];
    if (this.status === 'won') return `${name}通关 · 用时 ${clock(this.elapsed)}`;
    const done = this.tubes.filter(isDone).length;
    return `${name} · 排好 ${done}/${COLOR_COUNT[this.level]} 种颜色 · ${clock(this.now())}`;
  }

  // ---------- 操作 ----------

  // 点中的是哪根管子：每根管子占一格，管子上方拿起来的那段也算
  hit(e) {
    const rect = this.refs.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = this.width;
    return this.slots.findIndex((slot) => Math.abs(x - slot.x) <= this.slotWidth / 2
      && y >= slot.y - w * (LIFT + 0.35) && y <= slot.y + w * (DEPTH + 0.2));
  }

  // 正在倒水的管子，以及还在接水的管子，暂时不能点
  isBusy(i) {
    return this.pours.some((p) => p.from === i || (p.to === i && !p.landed));
  }

  tap(i) {
    if (this.status !== 'playing' || i < 0 || this.isBusy(i)) return;
    const from = this.selected;
    if (from === i) this.selected = -1;
    else if (from >= 0 && canPour(this.tubes, from, i)) this.pourStart(from, i);
    else if (canPick(this.tubes[i])) this.selected = i;
    else {
      // 点了空管或者封好的管子：拿着的放下，没拿的晃一下
      this.shake(from >= 0 ? from : i);
      this.selected = -1;
    }
    this.requestFrame();
  }

  pourStart(from, to) {
    const src = this.tubes[from].slice();
    const dst = this.tubes[to].slice();
    const color = top(src);
    const count = pour(this.tubes, from, to);
    this.history.push([from, to, count]);
    if (this.history.length > UNDOS) this.history.shift();
    this.moves++;
    this.selected = -1;
    this.pours.push({
      from,
      to,
      color,
      count,
      src: bandsOf(src),
      dst: bandsOf(dst),
      volume: src.length,
      side: this.sideFor(from, to),
      lift: this.lifts[from],
      start: performance.now(),
      flow: flowMs(count),
      landed: false,
    });
    if (isWon(this.tubes)) this.win();
    this.updateChrome();
    this.save();
  }

  // 从哪边倒：1 是从目标管左边往右倒，-1 反过来。管身朝远离目标的一侧伸出去，
  // 一般从源管所在的那边倒；那边地方不够、管身会伸出屏幕时换到另一边
  sideFor(from, to) {
    const x = this.slots[to].x;
    const reach = (DEPTH + 0.2) * this.width + 4;
    const side = x >= this.slots[from].x ? 1 : -1;
    if (side === 1 && x - reach < 0 && x + reach <= this.view.w) return -1;
    if (side === -1 && x + reach > this.view.w && x - reach >= 0) return 1;
    return side;
  }

  // 水全部落进目标管：装满一种颜色就盖上塞子，冒一下火花
  land(p) {
    p.landed = true;
    if (!isDone(this.tubes[p.to])) return;
    this.corks.set(p.to, performance.now());
    this.burst(p.to, p.color);
  }

  win() {
    this.status = 'won';
    this.stopClock();
    this.history = [];
    const time = Math.round(this.elapsed);
    const previous = this.records[this.level];
    this.records[this.level] = this.ctx.submitRecord(this.level, time, { lowerIsBetter: true });
    this.record = previous === undefined ? 'first' : time < previous ? 'best' : null;
    // 等最后一管水倒完再庆祝
    this.pendingWin = true;
  }

  undo() {
    if (this.status !== 'playing' || !this.history.length || !this.undosLeft) return;
    this.finishPours();
    const move = this.history.pop();
    if (!unpour(this.tubes, move)) {
      // 记录跟局面对不上就不撤了，剩下的记录也不可信，一起扔掉
      this.history = [];
      this.updateChrome();
      this.save();
      return;
    }
    const [from] = move;
    this.undosLeft--;
    this.selected = -1;
    this.sealAll();
    // 水回到的那根管子跳一下
    this.lifts[from] = 0.7;
    this.updateChrome();
    this.save();
    this.requestFrame();
  }

  addTube() {
    if (this.status !== 'playing' || this.extraUsed) return;
    this.finishPours();
    this.extraUsed = true;
    this.selected = -1;
    this.tubes.push([]);
    this.lifts.push(0);
    this.born.push(performance.now() + 120);
    this.layout();
    this.updateChrome();
    this.save();
  }

  // 撤销或加管子前，把还没放完的倒水动画直接放完
  finishPours() {
    for (const p of this.pours) this.lifts[p.from] = 0;
    this.pours = [];
    this.sealAll();
  }

  // 按现在的局面给排好的管子盖上塞子（不放动画），没排好的拿掉
  sealAll() {
    this.tubes.forEach((tube, i) => {
      if (!isDone(tube)) this.corks.delete(i);
      else if (!this.corks.has(i)) this.corks.set(i, -Infinity);
    });
  }

  shake(i) {
    this.shakes.set(i, performance.now());
  }

  burst(i, color) {
    const { x, y } = this.spots[i];
    const w = this.width;
    const now = performance.now();
    for (let k = 0; k < 18; k++) {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const speed = w * (0.004 + Math.random() * 0.007);
      this.sparks.push({
        x,
        y: y - w * 0.3,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        born: now,
        life: 500 + Math.random() * 350,
        r: w * (0.04 + Math.random() * 0.06),
        color: k % 3 ? PALETTE[color] : '#ffd60a',
      });
    }
  }

  setKeyboard(on) {
    if (on) document.addEventListener('keydown', this.onKey);
    else document.removeEventListener('keydown', this.onKey);
  }

  // 电脑上按 Z 或退格撤销
  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    if (e.key !== 'z' && e.key !== 'Z' && e.key !== 'Backspace') return;
    e.preventDefault();
    this.undo();
  }

  // ---------- 计时 ----------

  now() {
    return this.elapsed + (this.runningSince ? performance.now() - this.runningSince : 0);
  }

  startClock() {
    if (this.runningSince || this.status !== 'playing') return;
    this.runningSince = performance.now();
    this.ticker = setInterval(() => this.renderTime(), 250);
  }

  stopClock() {
    if (!this.runningSince) return;
    this.elapsed = this.now();
    this.runningSince = 0;
    clearInterval(this.ticker);
  }

  renderTime() {
    this.refs.time.textContent = clock(this.now());
  }

  // ---------- 状态栏 ----------

  noteText() {
    if (this.status !== 'playing') return '';
    if (!hasMove(this.tubes)) {
      const ways = [];
      if (this.undosLeft && this.history.length) ways.push('撤销');
      if (!this.extraUsed) ways.push('加一根空管');
      return ways.length ? `没有能倒的了，试试${ways.join('或')}` : '没有能倒的了，点「重来」从头再倒一次';
    }
    return this.moves ? '' : '点一根管子拿起来，再点另一根把水倒进去';
  }

  resultText() {
    const time = clock(this.elapsed);
    if (this.record === 'best') return `用时 ${time} · 新纪录！`;
    if (this.record === 'first') return `用时 ${time} · 第一次通关`;
    const best = this.records[this.level];
    return best ? `用时 ${time} · 最快 ${clock(best)}` : `用时 ${time}`;
  }

  updateChrome() {
    const { levels, undo, undoBadge, tube, tubeBadge, restart, bottom, result, resultText, note } = this.refs;
    const playing = this.status === 'playing';
    const over = !playing && !this.pendingWin;
    for (const button of levels.children) button.classList.toggle('is-active', button.dataset.level === this.level);

    this.refs.moves.textContent = this.moves;
    this.renderTime();

    undo.disabled = !playing || !this.history.length || !this.undosLeft;
    undoBadge.textContent = this.undosLeft;
    tube.disabled = !playing || this.extraUsed;
    tubeBadge.textContent = this.extraUsed ? 0 : 1;
    restart.disabled = !this.started;

    bottom.classList.toggle('is-over', over);
    result.hidden = !over;
    resultText.textContent = over ? this.resultText() : '';

    const text = this.noteText();
    note.hidden = !text;
    note.textContent = text;
    note.classList.toggle('is-stuck', playing && !hasMove(this.tubes));
  }

  // ---------- 排版 ----------

  // 管子少就排一行，多了排两行；管子宽度按屏幕宽度和高度里更紧的那个来定。
  // snap 为 false 时（加了空管），已有的管子滑到新位置
  layout(snap = false) {
    const { stage, canvas } = this.refs;
    const viewW = stage.clientWidth;
    const viewH = stage.clientHeight;
    if (!viewW || !viewH || !this.tubes) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(viewW * dpr) || canvas.height !== Math.round(viewH * dpr)) {
      canvas.width = Math.round(viewW * dpr);
      canvas.height = Math.round(viewH * dpr);
    }
    this.view = { w: viewW, h: viewH, dpr };

    const n = this.tubes.length;
    const rows = n <= 5 || (n <= 8 && viewW / n >= 70) ? 1 : 2;
    const perRow = Math.ceil(n / rows);
    const slot = Math.min(viewW / perRow, 110);
    const units = TOP_ROOM + rows * DEPTH + (rows - 1) * ROW_GAP;
    const roomH = viewH - NOTE_ROOM;
    const w = Math.min(MAX_WIDTH, slot * 0.56, roomH / (units + 0.2));
    const first = (roomH - w * units) / 2 + w * TOP_ROOM;
    this.width = w;
    this.slotWidth = slot;
    // 管子大小变了，小图案按新的大小重画
    const markPx = Math.ceil(MARK_SIZE * w * dpr);
    if (markPx !== this.markPx) {
      this.markPx = markPx;
      this.sprites = [];
    }
    this.slots = this.tubes.map((_, i) => {
      const row = Math.floor(i / perRow);
      const inRow = row < rows - 1 ? perRow : n - perRow * (rows - 1);
      const col = i - row * perRow;
      return { x: viewW / 2 + (col - (inRow - 1) / 2) * slot, y: first + row * w * (DEPTH + ROW_GAP) };
    });
    this.spots = this.slots.map((target, i) => (snap || !this.spots[i] ? { ...target } : this.spots[i]));
    this.draw();
    this.requestFrame();
  }

  // ---------- 动画 ----------

  requestFrame() {
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.raf = 0;
    const dt = this.lastFrame ? Math.min(64, now - this.lastFrame) : 16;
    const moving = this.step(now, dt);
    this.draw(now);
    if (moving) this.requestFrame();
    this.lastFrame = moving ? now : 0;
  }

  // 推进一帧，返回还要不要接着画
  step(now, dt) {
    let moving = false;
    const follow = 1 - Math.exp(-dt / 45);

    this.lifts.forEach((lift, i) => {
      const goal = i === this.selected ? 1 : 0;
      if (Math.abs(goal - lift) < 0.002) {
        this.lifts[i] = goal;
      } else {
        this.lifts[i] = lift + (goal - lift) * follow;
        moving = true;
      }
    });

    this.spots.forEach((spot, i) => {
      const target = this.slots[i];
      if (Math.abs(target.x - spot.x) + Math.abs(target.y - spot.y) < 0.3) {
        spot.x = target.x;
        spot.y = target.y;
      } else {
        spot.x += (target.x - spot.x) * follow * 0.6;
        spot.y += (target.y - spot.y) * follow * 0.6;
        moving = true;
      }
    });

    for (const p of this.pours) if (!p.landed && now - p.start >= MOVE_MS + p.flow) this.land(p);
    this.pours = this.pours.filter((p) => now - p.start < MOVE_MS + p.flow + BACK_MS);
    if (this.pours.length) moving = true;
    if (this.pendingWin && this.pours.every((p) => p.landed)) {
      this.pendingWin = false;
      this.waveAt = now;
      this.updateChrome();
    }

    this.sparks = this.sparks.filter((s) => now - s.born < s.life);
    for (const s of this.sparks) {
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.vy += this.width * 0.00003 * dt;
    }
    if (this.sparks.length) moving = true;

    for (const [i, start] of this.shakes) if (now - start >= SHAKE_MS) this.shakes.delete(i);
    if (this.shakes.size) moving = true;
    if (this.born.some((t) => now < t + APPEAR_MS)) moving = true;
    for (const start of this.corks.values()) if (now < start + CORK_MS) moving = true;
    if (now < this.waveAt + WAVE_MS + this.tubes.length * WAVE_STEP) moving = true;
    return moving;
  }

  // 倒水进度 0 到 1：源管先倒完，水柱落进目标管还要一会儿
  poured(p, now) {
    return easeInOut(clamp01((now - p.start - MOVE_MS) / (p.flow * (1 - LAG))));
  }

  received(p, now) {
    return easeInOut(clamp01((now - p.start - MOVE_MS - p.flow * LAG) / (p.flow * (1 - LAG))));
  }

  // 倒水时管口停在目标管正上方，高度要让倾斜的管身让开目标管
  spout(p) {
    const w = this.width;
    const target = this.spots[p.to];
    const tilt = Math.max(tiltFor(p.volume), 0.3);
    return { x: target.x, y: target.y - Math.max(0.45 * w, (0.5 * w + 4) / Math.tan(tilt)) - 0.15 * w };
  }

  // 放在原地的管子：拿起来、晃一下、出场、通关时跳一下
  restPose(i, now) {
    const w = this.width;
    const spot = this.spots[i];
    let x = spot.x;
    let y = spot.y - this.lifts[i] * LIFT * w;
    const shake = (now - (this.shakes.get(i) ?? -Infinity)) / SHAKE_MS;
    if (shake < 1) x += Math.sin(shake * Math.PI * 6) * w * 0.12 * (1 - shake);
    const appear = easeOut(clamp01((now - (this.born[i] ?? -Infinity)) / APPEAR_MS));
    y += (1 - appear) * w * 0.8;
    const wave = (now - this.waveAt - i * WAVE_STEP) / WAVE_MS;
    if (wave > 0 && wave < 1) y -= Math.sin(wave * Math.PI) * w * 0.5;
    return { x, y, angle: 0, pivot: 0, alpha: appear };
  }

  // 正在倒水的管子：绕靠近目标的那个管口角转动
  pourPose(p, now) {
    const w = this.width;
    const t = now - p.start;
    const home = this.spots[p.from];
    const pivot = p.side * 0.5;
    const spout = this.spout(p);
    const startTilt = tiltFor(p.volume);
    if (t < MOVE_MS) {
      const k = easeInOut(clamp01(t / MOVE_MS));
      return this.keepInside({
        x: lerp(home.x + pivot * w, spout.x, k),
        y: lerp(home.y - p.lift * LIFT * w, spout.y, k),
        angle: p.side * startTilt * k,
        pivot,
      });
    }
    if (t < MOVE_MS + p.flow) {
      return { ...spout, angle: p.side * tiltFor(p.volume - p.count * this.poured(p, now)), pivot };
    }
    const k = easeInOut(clamp01((t - MOVE_MS - p.flow) / BACK_MS));
    return this.keepInside({
      x: lerp(spout.x, home.x + pivot * w, k),
      y: lerp(spout.y, home.y, k),
      angle: p.side * tiltFor(p.volume - p.count) * (1 - k),
      pivot,
    });
  }

  // 飞过去、飞回来的路上管子还斜着，靠边那几根的管身会伸出画布，整根往里挪一点
  keepInside(pose) {
    const edge = Math.max(1.5, this.width * 0.06);
    let left = Infinity;
    let right = -Infinity;
    for (const [x] of place(pose, this.width, RIMMED)) {
      left = Math.min(left, x);
      right = Math.max(right, x);
    }
    if (left < edge) pose.x += edge - left;
    else if (right > this.view.w - edge) pose.x -= right - (this.view.w - edge);
    return pose;
  }

  // ---------- 画面 ----------

  draw(now = performance.now()) {
    const g = this.g;
    if (!this.view) return;
    const { w, h, dpr } = this.view;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!this.width) return;

    // 先画放在原地的管子，再画水柱，最后画正在倒水的管子，让它盖在别的管子上面
    const flying = new Map(this.pours.map((p) => [p.from, p]));
    const filling = new Map(this.pours.filter((p) => !p.landed).map((p) => [p.to, p]));
    this.tubes.forEach((tube, i) => {
      if (flying.has(i)) return;
      const p = filling.get(i);
      const bands = p ? adjustTop(p.dst, p.color, p.count * this.received(p, now)) : bandsOf(tube);
      this.drawTube(this.restPose(i, now), bands, p ? undefined : this.corks.get(i), now);
    });
    for (const p of this.pours) this.drawStream(p, now);
    for (const p of flying.values()) {
      this.drawTube(this.pourPose(p, now), adjustTop(p.src, p.color, -p.count * this.poured(p, now)));
    }
    this.drawSparks(now);
  }

  drawTube(pose, bands, cork, now) {
    const g = this.g;
    const w = this.width;
    const points = place(pose, w);
    g.save();
    g.globalAlpha = pose.alpha ?? 1;

    trace(g, points, true);
    g.fillStyle = this.theme.inside;
    g.fill();
    g.save();
    g.clip();
    // 水按世界坐标横着画，裁在管子里面，所以管子怎么斜水面都是平的
    let minX = Infinity;
    let maxX = -Infinity;
    let below = -Infinity;
    for (const [x, y] of points) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      below = Math.max(below, y);
    }
    // 多少水对应的水面在哪，画水和画图案都要用，算过的记下来；没有水时水面就在管底
    const levels = new Map([[0, below]]);
    const levelAt = (volume) => {
      if (!levels.has(volume)) levels.set(volume, levelFor(points, volume, w));
      return levels.get(volume);
    };
    below += 1;
    let volume = 0;
    for (const band of bands) {
      volume += band.amount;
      const level = levelAt(volume);
      g.fillStyle = PALETTE[band.color];
      g.fillRect(minX - 1, level, maxX - minX + 2, below - level + 0.5);
      below = level;
    }
    this.drawMarks(points, bands, levelAt);
    // 玻璃反光：贴着左壁的一道亮条，跟着管子一起转
    g.translate(pose.x, pose.y);
    g.rotate(pose.angle);
    g.translate(-pose.pivot * w, 0);
    g.fillStyle = this.theme.shine;
    roundRect(g, -0.34 * w, 0.22 * w, 0.12 * w, (DEPTH - 0.85) * w, 0.06 * w);
    g.fill();
    g.restore();

    trace(g, place(pose, w, RIMMED), false);
    g.strokeStyle = this.theme.glass;
    g.lineWidth = Math.max(1.5, w * 0.06);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.stroke();
    if (cork !== undefined) this.drawCork(pose, cork, now);
    g.restore();
  }

  // 每层水正中贴一个这种颜色的图案，跟水面一样保持水平，不跟着管子转。
  // 只露出这段水里面的部分：倒水时图案跟着水面一点点露出来或者没下去；管子斜过来、一层水变薄时图案也跟着变小
  drawMarks(points, bands, levelAt) {
    const g = this.g;
    const w = this.width;
    let start = 0;
    for (const band of bands) {
      const end = start + band.amount;
      g.save();
      g.beginPath();
      g.rect(0, levelAt(end), this.view.w, levelAt(start) - levelAt(end));
      g.clip();
      // 从这段水的最下面一层往上数，每层一个
      for (let k = start; k < end; k++) {
        const lower = levelAt(k);
        const upper = levelAt(k + 1);
        const size = Math.min(MARK_SIZE * w, (lower - upper) * 0.8);
        if (size < 3) continue;
        const y = (lower + upper) / 2;
        g.drawImage(this.sprite(band.color), middleAt(points, y) - size / 2, y - size / 2, size, size);
      }
      g.restore();
      start = end;
    }
  }

  // 图案先画在一块小画布上存起来，每帧直接贴上去；管子大小变了才重画（见 layout）
  sprite(color) {
    if (!this.sprites[color]) {
      const canvas = document.createElement('canvas');
      canvas.width = this.markPx;
      canvas.height = this.markPx;
      drawMark(canvas.getContext('2d'), MARKS[color], this.markPx);
      this.sprites[color] = canvas;
    }
    return this.sprites[color];
  }

  // 排好的管子盖上软木塞，刚排好时从上面落下来
  drawCork(pose, start, now) {
    const g = this.g;
    const w = this.width;
    const k = clamp01((now - start) / CORK_MS);
    g.save();
    g.globalAlpha *= clamp01(k * 3);
    g.translate(pose.x, pose.y);
    g.rotate(pose.angle);
    g.translate(-pose.pivot * w, (1 - easeOutBack(k)) * -1.2 * w);
    g.fillStyle = '#b07a48';
    roundRect(g, -0.36 * w, -0.06 * w, 0.72 * w, 0.4 * w, 0.08 * w);
    g.fill();
    g.fillStyle = '#d9a66e';
    roundRect(g, -0.56 * w, -0.32 * w, 1.12 * w, 0.3 * w, 0.1 * w);
    g.fill();
    g.restore();
  }

  // 水柱从管口落进目标管的水面
  drawStream(p, now) {
    const q = (now - p.start - MOVE_MS) / p.flow;
    if (q <= 0 || q >= 1) return;
    const w = this.width;
    const spout = this.spout(p);
    const target = this.spots[p.to];
    const volume = p.dst.reduce((sum, band) => sum + band.amount, 0) + p.count * this.received(p, now);
    const surface = levelFor(place({ x: target.x, y: target.y, angle: 0, pivot: 0 }, w), volume, w);
    const head = lerp(spout.y, surface, clamp01(q / LAG));
    const tail = lerp(spout.y, surface, clamp01((q - (1 - LAG)) / LAG));
    const width = w * 0.16;
    this.g.fillStyle = PALETTE[p.color];
    this.g.fillRect(spout.x - p.side * width * 0.3 - width / 2, tail, width, head - tail);
  }

  drawSparks(now) {
    const g = this.g;
    for (const s of this.sparks) {
      g.globalAlpha = 1 - (now - s.born) / s.life;
      g.fillStyle = s.color;
      g.beginPath();
      g.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
  }

  // ---------- 生命周期 ----------

  pause() {
    this.active = false;
    this.setKeyboard(false);
    if (!this.runningSince) return;
    this.stopClock();
    this.renderTime();
    this.save();
  }

  resume() {
    this.active = true;
    this.setKeyboard(true);
    this.startClock();
  }

  destroy() {
    this.setKeyboard(false);
    this.stopClock();
    cancelAnimationFrame(this.raf);
    this.resizer.disconnect();
    this.scheme.removeEventListener('change', this.onScheme);
  }
}

// ---------- 玩法说明 ----------
// 外壳第一次打开游戏、或者点「?」时显示（见 js/player.js）。配图是简化的管子，水的颜色和小图案都跟游戏里一样

const GUIDE_FONT = 'ui-rounded, -apple-system, system-ui, sans-serif';
// 配图里的管子：管宽 26，每层水高 16，最下面一层连着圆底高 22，水面上方空 8
const GUIDE_R = 13;
const GUIDE_LAYER = 16;
const GUIDE_BOTTOM = 22;
const GUIDE_HEAD = 8;
const num = (v) => String(Math.round(v * 10) / 10);
const guideArt = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 300 170" aria-hidden="true">${body}</svg>`;
const guideText = (x, y, text, size, style) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="600" font-family="${GUIDE_FONT}" ${style}>${text}</text>`;

// 小图案借用游戏里的画法（MARK_SHAPES）：给它一支只会记路径的假画笔，记下的路径变成 SVG
function guideMark(color, x, y, r) {
  const [kind, ink] = MARKS[color];
  const at = (px, py) => `${num(x + px)} ${num(y + py)}`;
  let d = '';
  let out = '';
  const pen = {
    beginPath() {
      d = '';
    },
    moveTo(px, py) {
      d += `M${at(px, py)}`;
    },
    lineTo(px, py) {
      d += `${d ? 'L' : 'M'}${at(px, py)}`;
    },
    closePath() {
      d += 'Z';
    },
    rect(px, py, w, h) {
      d += `M${at(px, py)}h${num(w)}v${num(h)}h${num(-w)}Z`;
    },
    arc(px, py, radius) {
      const a = `a${num(radius)} ${num(radius)} 0 1 0`;
      d += `M${at(px - radius, py)}${a} ${num(2 * radius)} 0${a} ${num(-2 * radius)} 0`;
    },
    fill() {
      out = `<path d="${d}" fill="${ink}"/>`;
    },
    stroke() {
      out = `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${num(r * 0.3)}" stroke-linecap="round" stroke-linejoin="round"/>`;
    },
  };
  MARK_SHAPES[kind](pen, r);
  return out;
}

// 一根管子：x 是管口中间，bottom 是管底，layers 从下往上是颜色编号；lift 是拿起来多高，cork 是盖上塞子
function guideTube(x, bottom, layers, { lift = 0, cork = false } = {}) {
  const r = GUIDE_R;
  const y = bottom - lift;
  const mouth = y - GUIDE_BOTTOM - (CAPACITY - 1) * GUIDE_LAYER - GUIDE_HEAD;
  // 从左壁往下，绕过半圆底，回到右壁
  const bowl = `V${y - r}a${r} ${r} 0 0 0 ${2 * r} 0`;
  let out = `<path d="M${x - r} ${mouth}${bowl}V${mouth}Z" style="fill:var(--fill)"/>`;
  layers.forEach((color, k) => {
    const top = y - GUIDE_BOTTOM - k * GUIDE_LAYER;
    out += k
      ? `<rect x="${x - r}" y="${top}" width="${2 * r}" height="${GUIDE_LAYER + 0.5}" fill="${PALETTE[color]}"/>`
      : `<path d="M${x - r} ${top}${bowl}V${top}Z" fill="${PALETTE[color]}"/>`;
    out += guideMark(color, x, top + (k ? GUIDE_LAYER / 2 : 10), 5.5);
  });
  out += `<path d="M${x - r - 2.6} ${mouth}H${x - r}${bowl}V${mouth}H${x + r + 2.6}" fill="none" style="stroke:var(--label-2)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (cork) {
    out += `<rect x="${num(x - 9.4)}" y="${num(mouth - 1.6)}" width="18.7" height="10.4" rx="2" fill="#b07a48"/>`
      + `<rect x="${num(x - 14.6)}" y="${num(mouth - 8.3)}" width="29.1" height="7.8" rx="2.6" fill="#d9a66e"/>`;
  }
  return out;
}

// 手指点的地方，n 是先后顺序
const guideTap = (x, y, n) =>
  `<circle cx="${x}" cy="${y}" r="14" fill="#fff" fill-opacity="0.7" stroke="#000" stroke-opacity="0.2" stroke-width="1.5"/>`
  + guideText(x, y + 4.5, n, 13, 'fill="#1c1c1e"');

// 倒水的箭头：从 (x1, y1) 往上弯 lift 再落到 (x2, y2)；dashed 的是不能这样倒，弯的最高处打个叉
function guideArrow(x1, y1, x2, y2, lift, dashed = false) {
  const cx = (x1 + x2) / 2;
  const cy = Math.min(y1, y2) - lift;
  const angle = Math.atan2(y2 - cy, x2 - cx);
  const head = (a) => `${num(x2 - 8 * Math.cos(angle + a))} ${num(y2 - 8 * Math.sin(angle + a))}`;
  const line = 'fill="none" style="stroke:var(--label-2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';
  let out = `<path d="M${x1} ${y1}Q${num(cx)} ${num(cy)} ${x2} ${y2}" ${line}${dashed ? ' stroke-dasharray="5 6"' : ''}/>`;
  if (!dashed) return `${out}<path d="M${head(0.5)}L${x2} ${y2}L${head(-0.5)}" ${line}/>`;
  const mx = num((x1 + 2 * cx + x2) / 4);
  const my = num((y1 + 2 * cy + y2) / 4);
  out += `<path d="M-6 -6L6 6M6 -6L-6 6" transform="translate(${mx} ${my})" fill="none" stroke="#ff3b30" stroke-width="3" stroke-linecap="round"/>`;
  return out;
}

// 工具栏的按钮：图标、名字，有次数的带个角标
function guideTool(icon, x, label, badge) {
  let out = `<g style="color:var(--label-2)">${icon.replace('<svg ', `<svg x="${x - 13}" y="27" width="26" height="26" `)}</g>`;
  out += guideText(x, 74, label, 12, 'style="fill:var(--label-2)"');
  if (badge) out += `<rect x="${x + 6}" y="23" width="18" height="14" rx="7" fill="#6e6e73"/>${guideText(x + 15, 33.5, badge, 10, 'fill="#fff"')}`;
  return out;
}

const GUIDE = [
  {
    title: '把颜色分开',
    text: '每根管子都只装一种颜色，就过关啦。排好的管子会盖上塞子。',
    art: guideArt(
      guideTube(38, 128, [0, 1, 2, 0]) + guideTube(78, 128, [1, 2, 0, 1]) + guideTube(118, 128, [2, 0, 1, 2])
      + guideArrow(138, 92, 162, 92, 0)
      + [0, 1, 2].map((color, k) => guideTube(182 + k * 40, 128, [color, color, color, color], { cork: true })).join(''),
    ),
  },
  {
    title: '点一下倒水',
    text: '先点一根管子拿起来，再点另一根倒进去。只能倒在同色的水上或空管里，装满为止。',
    art: guideArt(
      guideTube(55, 150, [1, 0, 0], { lift: 14 }) + guideTube(150, 150, [2, 0]) + guideTube(245, 150, [3, 1])
      + guideArrow(62, 50, 146, 62, 20) + guideArrow(58, 46, 241, 62, 40, true)
      + guideTap(55, 124, 1) + guideTap(150, 138, 2),
    ),
  },
  {
    title: '认准小图案',
    text: '每种颜色都有自己的小图案，分不清颜色时认图案就行。',
    art: guideArt(
      guideTube(48, 126, [9, 6, 4, 1])
      + PALETTE.map((color, c) => {
        const x = 110 + (c % 5) * 38;
        const y = c < 5 ? 63 : 105;
        return `<rect x="${x - 15}" y="${y - 15}" width="30" height="30" rx="7" fill="${color}"/>${guideMark(c, x, y, 9)}`;
      }).join(''),
    ),
  },
  {
    title: '卡住也不怕',
    text: '每局能撤销 5 次、加一根空管，还能重来。每种难度都记下最快用时。',
    art: guideArt(
      guideTool(UNDO, 60, '撤销', UNDOS) + guideTool(ADD_TUBE, 150, '加空管', 1) + guideTool(REPLAY, 240, '重来')
      + guideText(150, 101, '最快用时', 11, 'style="fill:var(--label-2)"')
      + [['easy', '0:58'], ['medium', '2:05'], ['hard', '3:42']].map(([level, time], k) => {
        const x = 54 + k * 96;
        return `<rect x="${x - 44}" y="109" width="88" height="30" rx="15" style="fill:var(--fill)"/>`
          + guideText(x, 129, `${LEVELS[level]} ${time}`, 13, 'style="fill:var(--label)"');
      }).join(''),
    ),
  },
];

export default {
  guide: GUIDE,
  async mount(root, ctx) {
    await loadStyles();
    const game = new WaterSort(root, ctx);
    return {
      pause: () => game.pause(),
      resume: () => game.resume(),
      destroy: () => game.destroy(),
    };
  },
};
