// 俄罗斯方块：移动、旋转往下落的方块，填满一整行就消除，方块堆到顶就结束。
// 规则按现在通行的做法：7 种方块一组随机出、SRS 旋转和踢墙、暂存、落点影子、落地后还能挪动一小会儿。
// 触屏上直接在棋盘上拖动、轻点，也可以用下面的按钮；电脑上用键盘。接口说明见 js/player.js。

const COLS = 10;
const ROWS = 20;
const HIDDEN = 2; // 棋盘上方看不见的两行，新方块从这里出来
const HEIGHT = ROWS + HIDDEN;
const NEXT_COUNT = 3;

const LOCK_MS = 500; // 落地后还能挪动的时间
const LOCK_RESETS = 15; // 落地后靠挪动续时最多几次，免得一直拖着不落
const DAS_MS = 160; // 按住左右，多久以后开始连续移动
const ARR_MS = 45; // 连续移动时每一格的间隔
const SOFT_MS = 32; // 按住加速时每落一格的间隔
const CLEAR_MS = 240; // 消行动画
const FLICK_SPEED = 0.8; // 手指甩动超过这个速度（像素/毫秒）算“一划”

// 棋盘和右侧栏的尺寸，要和 style.css 里 .tet-well 的 padding、.tet-main 的 gap 一致
const WELL_PAD = 5;
const MAIN_GAP = 10;
const SIDE_MIN = 60;
const SIDE_MAX = 96;

// 每种方块的初始朝向，坐标是 [列, 行]；size 是旋转时绕着转的方框边长（SRS 标准）
const SHAPES = {
  I: { size: 4, cells: [[0, 1], [1, 1], [2, 1], [3, 1]] },
  J: { size: 3, cells: [[0, 0], [0, 1], [1, 1], [2, 1]] },
  L: { size: 3, cells: [[2, 0], [0, 1], [1, 1], [2, 1]] },
  O: { size: 4, cells: [[1, 0], [2, 0], [1, 1], [2, 1]] },
  S: { size: 3, cells: [[1, 0], [2, 0], [0, 1], [1, 1]] },
  T: { size: 3, cells: [[1, 0], [0, 1], [1, 1], [2, 1]] },
  Z: { size: 3, cells: [[0, 0], [1, 0], [1, 1], [2, 1]] },
};
const TYPES = Object.keys(SHAPES);

// 预先算好四个朝向。顺时针转一次：(x, y) → (size - 1 - y, x)；O 怎么转都一样
const ROTATIONS = Object.fromEntries(TYPES.map((type) => {
  const { size, cells } = SHAPES[type];
  const states = [cells];
  for (let r = 1; r < 4; r++) {
    states.push(type === 'O' ? cells : states[r - 1].map(([x, y]) => [size - 1 - y, x]));
  }
  return [type, states];
}));

// SRS 踢墙表：原地转不过去时依次试这几个偏移。键是「原朝向 新朝向」，0 朝上、1 朝右、2 朝下、3 朝左。
// 表是照标准抄的，y 朝上；棋盘的 y 朝下，所以取反
const flipY = (table) =>
  Object.fromEntries(Object.entries(table).map(([key, offsets]) => [key, offsets.map(([x, y]) => [x, -y])]));

const KICKS = flipY({
  '01': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '10': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '12': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '21': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '23': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '32': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '30': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '03': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
});

const KICKS_I = flipY({
  '01': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '10': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '12': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
  '21': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '23': [[0, 0], [2, 0], [-1, 0], [2, 1], [-1, -2]],
  '32': [[0, 0], [-2, 0], [1, 0], [-2, -1], [1, 2]],
  '30': [[0, 0], [1, 0], [-2, 0], [1, -2], [-2, 1]],
  '03': [[0, 0], [-1, 0], [2, 0], [-1, 2], [2, -1]],
});

// 每种方块一组双色渐变，和 2048 的方块、首页封面是同一种画法
const COLORS = {
  I: ['#6ad8ff', '#2fb1ea'],
  J: ['#4aa3ff', '#5e5ce6'],
  L: ['#ffb84d', '#ff7a2f'],
  O: ['#ffe266', '#ffc21a'],
  S: ['#5ee27a', '#1fb57a'],
  T: ['#d68bff', '#9b4df0'],
  Z: ['#ff7373', '#ff2d55'],
};

// 计分按现代规则，下面的分数都要再乘以当前等级
const LINE_SCORES = [0, 100, 300, 500, 800];
const TSPIN_SCORES = [400, 800, 1200, 1600];
const MINI_SCORES = [100, 200, 400];
const PERFECT_SCORES = [0, 800, 1200, 1800, 2000];
const CLEAR_NAMES = ['', '单消', '双消', '三消', '四消'];

// 每落一格的间隔（毫秒），随等级变快，20 级以后不再变
function gravityMs(level) {
  const n = Math.min(level, 20) - 1;
  return (0.8 - n * 0.007) ** n * 1000;
}

// 字母键一律按小写查：按着 Shift 松开 A 时收到的是“A”，开着大写锁定时也一样，不然按键会松不开
const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowDown: 'soft', ArrowUp: 'rotate',
  a: 'left', d: 'right', s: 'soft', w: 'rotate',
  x: 'rotate', z: 'rotateBack',
  ' ': 'hard', c: 'hold', Shift: 'hold',
  p: 'pause', Enter: 'confirm',
};
const keyAction = ({ key = '' }) => KEYS[key.length === 1 ? key.toLowerCase() : key];

const stroked = (body, width = 2.6) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const PAUSE = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="4.5" width="4.2" height="15" rx="1.4"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.4"/></svg>';
const LEFT = stroked('<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>');
const RIGHT = stroked('<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>');
const DOWN = stroked('<path d="m5.5 9.5 6.5 6.5 6.5-6.5"/>');
const DROP = stroked('<path d="m6 4.5 6 6 6-6"/><path d="m6 10.5 6 6 6-6"/><path d="M5 20.5h14"/>', 2.4);
const ROTATE = stroked('<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path d="M19.5 3.8v3.9h-3.9"/>', 2.6);

const TEMPLATE = `
  <div class="tet">
    <div class="tet-top">
      <div class="tet-stat"><span>分数</span><strong data-ref="score">0</strong></div>
      <div class="tet-stat"><span>最高</span><strong data-ref="best">0</strong></div>
      <button class="tet-pause" data-ref="pause" aria-label="暂停">${PAUSE}</button>
    </div>
    <div class="tet-main" data-ref="main">
      <div class="tet-well" data-ref="well">
        <canvas class="tet-board" data-ref="board"></canvas>
        <div class="tet-flash" data-ref="flash"></div>
        <div class="tet-overlay" data-ref="overlay" hidden></div>
      </div>
      <div class="tet-side" data-ref="side">
        <button class="tet-box" data-ref="holdBox" aria-label="暂存"><span>暂存</span><canvas data-ref="hold"></canvas></button>
        <div class="tet-box"><span>下一个</span><canvas data-ref="next"></canvas></div>
        <div class="tet-infos">
          <div class="tet-info"><span>等级</span><strong data-ref="level">1</strong></div>
          <div class="tet-info"><span>行数</span><strong data-ref="lines">0</strong></div>
        </div>
      </div>
    </div>
    <div class="tet-pad" data-ref="pad">
      <button data-control="left" aria-label="左移">${LEFT}</button>
      <button data-control="soft" aria-label="加速下落">${DOWN}</button>
      <button data-control="right" aria-label="右移">${RIGHT}</button>
      <span class="tet-pad-gap"></span>
      <button data-control="hard" aria-label="直接落下">${DROP}</button>
      <button data-control="rotate" class="is-main" aria-label="旋转">${ROTATE}</button>
    </div>
  </div>`;

// 触屏的玩法写在文件末尾的玩法说明（guide）里，这里只留电脑上的按键
const KEY_TIPS = [
  ['← →', '移动'],
  ['↑ 或 X', '旋转（Z 反着转）'],
  ['↓', '加速下落'],
  ['空格', '直接落到底'],
  ['C', '暂存'],
  ['P', '暂停'],
];

function loadStyles() {
  if (document.querySelector('link[data-game="tetris"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'tetris';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

const fmt = (n) => n.toLocaleString('zh-CN');

function shuffled(list) {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function roundedRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// 一格的图案先画在小画布上，之后每帧直接贴上去
function sprite(size, ratio, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = Math.max(1, Math.round(size * ratio));
  const g = canvas.getContext('2d');
  g.scale(canvas.width / size, canvas.height / size);
  draw(g, size);
  return canvas;
}

function drawBlock(g, s, [a, b]) {
  const inset = Math.max(0.75, s * 0.045);
  roundedRect(g, inset, inset, s - inset * 2, s - inset * 2, s * 0.22);
  const fill = g.createLinearGradient(0, 0, s, s);
  fill.addColorStop(0, a);
  fill.addColorStop(1, b);
  g.fillStyle = fill;
  g.fill();
  const shine = g.createRadialGradient(s * 0.82, s * 0.12, 0, s * 0.82, s * 0.12, s * 0.8);
  shine.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
  shine.addColorStop(1, 'rgba(255, 255, 255, 0)');
  g.fillStyle = shine;
  g.fill();
}

function drawGhost(g, s, [a]) {
  const line = Math.max(1.5, s * 0.08);
  const inset = Math.max(0.75, s * 0.045) + line / 2;
  roundedRect(g, inset, inset, s - inset * 2, s - inset * 2, s * 0.2);
  g.fillStyle = a;
  g.globalAlpha = 0.16;
  g.fill();
  g.strokeStyle = a;
  g.lineWidth = line;
  g.globalAlpha = 0.8;
  g.stroke();
}

const isValidSave = (saved) =>
  saved?.v === 1 && typeof saved.board === 'string' && saved.board.length === COLS * HEIGHT && Array.isArray(saved.queue);

// 存档里的计数必须是非负整数，否则当成 fallback（坏存档里的字符串会被拼接成怪数字）
const count = (value, fallback = 0) => (Number.isInteger(value) && value >= 0 ? value : fallback);

// 坐标不是整数时碰撞检测永远判“不碰撞”，算落点的循环会停不下来，所以恢复前要先把关
const isValidPiece = (p) =>
  Boolean(p && SHAPES[p.type] && [0, 1, 2, 3].includes(p.rot)
    && Number.isInteger(p.x) && Number.isInteger(p.y) && p.y >= -HIDDEN && p.y < HEIGHT);

class Tetris {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.best = ctx.records.score ?? 0;
    this.raf = 0;
    this.lastTime = 0;
    this.serial = 0; // 每出一个新方块加一，手势据此判断手指下面换了方块
    this.cell = 0;
    this.sprites = new Map();
    this.down = new Set(); // 正按着的 left、right、soft
    this.shiftDir = 0;
    this.softHeld = false;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.el = root.firstElementChild;
    this.g = this.refs.board.getContext('2d');

    this.frame = this.frame.bind(this);
    this.onKey = this.onKey.bind(this);
    this.onKeyUp = this.onKeyUp.bind(this);
    // 窗口失去焦点后收不到松开按键的事件，先当作全都松开了
    this.onBlur = () => this.releaseAll();
    this.refs.pause.addEventListener('click', () => {
      this.refs.pause.blur();
      this.pause();
    });
    this.refs.holdBox.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.status === 'playing') this.hold();
    });
    this.bindPad();
    this.bindWell();

    // 深浅色切换时，空格子的颜色要跟着换
    this.scheme = window.matchMedia('(prefers-color-scheme: dark)');
    this.onScheme = () => this.layout();
    this.scheme.addEventListener('change', this.onScheme);
    this.resizer = new ResizeObserver(() => this.layout());
    this.resizer.observe(this.refs.main);

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else {
      this.reset();
      this.showIntro();
    }
    this.layout();
  }

  get level() {
    return Math.floor(this.lines / 10) + 1;
  }

  // ---------- 开局与存档 ----------

  reset() {
    this.board = Array(COLS * HEIGHT).fill(null);
    this.queue = [];
    this.refill();
    this.holdType = null;
    this.canHold = true;
    this.score = 0;
    this.lines = 0;
    this.combo = -1;
    this.b2b = false;
    this.bestBefore = this.best;
    this.clearing = null;
    this.status = 'ready';
    this.spawn();
    this.updateStats();
  }

  restore(saved) {
    this.board = [...saved.board].map((ch) => (SHAPES[ch] ? ch : null));
    this.queue = saved.queue.filter((type) => SHAPES[type]);
    this.refill();
    this.holdType = SHAPES[saved.hold] ? saved.hold : null;
    this.canHold = saved.canHold !== false;
    this.score = count(saved.score);
    this.lines = count(saved.lines);
    this.combo = Number.isInteger(saved.combo) && saved.combo >= -1 ? saved.combo : -1;
    this.b2b = Boolean(saved.b2b);
    this.bestBefore = saved.bestBefore ?? this.best;
    this.clearing = null;
    this.status = saved.status === 'over' || saved.status === 'ready' ? saved.status : 'paused';
    this.piece = null;

    const p = saved.piece;
    if (isValidPiece(p) && !this.collides(p.type, p.rot, p.x, p.y)) {
      this.piece = { type: p.type, rot: p.rot, x: p.x, y: p.y };
      this.serial += 1;
      this.lowest = p.y;
      this.resets = 0;
      this.lockTime = 0;
      this.fallTime = 0;
      this.lastRotate = null;
    } else if (this.status !== 'over') {
      // 存档时正好在消行，补完再出下一个
      this.removeRows(this.fullRows());
      this.spawn();
    }
    this.updateStats();
    if (this.status === 'over') this.showOver();
    else if (this.status === 'ready') this.showIntro();
    else this.showPaused();
  }

  save() {
    const { piece, score, lines, combo, b2b, bestBefore } = this;
    const state = {
      v: 1,
      board: this.board.map((type) => type ?? '.').join(''),
      piece: piece && { ...piece },
      queue: this.queue,
      hold: this.holdType,
      canHold: this.canHold,
      score,
      lines,
      combo,
      b2b,
      bestBefore,
      // 下次打开时先停在暂停画面，等玩家点继续
      status: this.status === 'playing' ? 'paused' : this.status,
    };
    this.ctx.save(state, { summary: this.summary(), finished: this.status === 'over' });
  }

  summary() {
    if (this.status === 'over') return `本局结束 · ${fmt(this.score)} 分`;
    if (this.status === 'ready') return '新的一局';
    return `${fmt(this.score)} 分 · 第 ${this.level} 级`;
  }

  submitBest() {
    if (this.score > 0) this.best = this.ctx.submitRecord('score', this.score);
  }

  // ---------- 规则 ----------

  // 7 种方块一组打乱，用完一组再来一组，所以不会很久都等不到长条
  refill() {
    while (this.queue.length < 7) this.queue.push(...shuffled(TYPES));
  }

  collides(type, rot, x, y) {
    for (const [cx, cy] of ROTATIONS[type][rot]) {
      const bx = x + cx;
      const by = y + cy;
      if (bx < 0 || bx >= COLS || by >= HEIGHT) return true;
      if (by >= 0 && this.board[by * COLS + bx]) return true;
    }
    return false;
  }

  landed() {
    const p = this.piece;
    return this.collides(p.type, p.rot, p.x, p.y + 1);
  }

  dropDistance() {
    const p = this.piece;
    let d = 0;
    while (!this.collides(p.type, p.rot, p.x, p.y + d + 1)) d++;
    return d;
  }

  // 新方块从看不见的那两行出来，能往下就先落一格露出来；出生的位置被占了就结束
  spawn(type) {
    if (!type) {
      type = this.queue.shift();
      this.refill();
    }
    this.piece = { type, rot: 0, x: 3, y: 0 };
    this.serial += 1;
    this.lockTime = 0;
    this.fallTime = 0;
    this.resets = 0;
    this.lastRotate = null;
    this.lowest = 0;
    this.renderSide();
    if (this.collides(type, 0, 3, 0)) {
      this.gameOver();
      return;
    }
    if (!this.collides(type, 0, 3, 1)) this.piece.y = 1;
    this.lowest = this.piece.y;
  }

  // 落到了新的最低处，续时次数重新算
  reachedLower() {
    if (this.piece.y <= this.lowest) return false;
    this.lowest = this.piece.y;
    this.resets = 0;
    this.lockTime = 0;
    return true;
  }

  // 落地以后左右移动或旋转，落地计时从头开始，但次数有限
  touched() {
    if (this.reachedLower()) return;
    if (this.resets < LOCK_RESETS && (this.lockTime > 0 || this.landed())) {
      this.lockTime = 0;
      this.resets += 1;
    }
  }

  shift(dir) {
    const p = this.piece;
    if (!p || this.clearing || this.collides(p.type, p.rot, p.x + dir, p.y)) return false;
    p.x += dir;
    this.lastRotate = null;
    this.touched();
    return true;
  }

  fall() {
    const p = this.piece;
    if (!p || this.clearing || this.landed()) return false;
    p.y += 1;
    this.lastRotate = null;
    this.reachedLower();
    return true;
  }

  rotate(dir) {
    const p = this.piece;
    if (!p || this.clearing || p.type === 'O') return;
    const to = (p.rot + dir + 4) % 4;
    const kicks = (p.type === 'I' ? KICKS_I : KICKS)[`${p.rot}${to}`];
    for (let k = 0; k < kicks.length; k++) {
      const [dx, dy] = kicks[k];
      if (this.collides(p.type, to, p.x + dx, p.y + dy)) continue;
      p.rot = to;
      p.x += dx;
      p.y += dy;
      this.lastRotate = { kick: k };
      this.touched();
      return;
    }
  }

  softDrop() {
    if (!this.fall()) return;
    this.score += 1;
    this.fallTime = 0;
    this.updateStats();
  }

  hardDrop() {
    const p = this.piece;
    if (!p || this.clearing) return;
    const d = this.dropDistance();
    if (d) {
      p.y += d;
      this.lastRotate = null;
      this.score += d * 2;
    }
    this.bump();
    this.lock();
  }

  hold() {
    if (!this.piece || !this.canHold || this.clearing) return;
    const swap = this.holdType;
    this.holdType = this.piece.type;
    this.canHold = false;
    this.spawn(swap);
  }

  // T 旋：最后一下是旋转，T 所在方框的四个角至少占了三个。
  // 朝前的两个角都占了（或者用到了最后一档踢墙）算完整的 T 旋，否则算 Mini
  spinKind() {
    const p = this.piece;
    if (p.type !== 'T' || !this.lastRotate) return null;
    const occupied = ([cx, cy]) => {
      const x = p.x + cx;
      const y = p.y + cy;
      return x < 0 || x >= COLS || y >= HEIGHT || (y >= 0 && Boolean(this.board[y * COLS + x]));
    };
    const corners = [[0, 0], [2, 0], [2, 2], [0, 2]]; // 左上、右上、右下、左下
    if (corners.filter(occupied).length < 3) return null;
    const front = [corners[p.rot], corners[(p.rot + 1) % 4]];
    return front.every(occupied) || this.lastRotate.kick === 4 ? 'full' : 'mini';
  }

  lock() {
    const p = this.piece;
    const spin = this.spinKind();
    let outside = true;
    for (const [cx, cy] of ROTATIONS[p.type][p.rot]) {
      const y = p.y + cy;
      if (y >= 0) this.board[y * COLS + p.x + cx] = p.type;
      if (y >= HIDDEN) outside = false;
    }
    this.piece = null;
    this.canHold = true;
    // 整个方块都停在棋盘上沿外面，也算堆到顶了
    if (outside) {
      this.gameOver();
      return;
    }

    const rows = this.fullRows();
    this.award(rows, spin);
    this.updateStats();
    this.submitBest();
    if (rows.length) {
      this.clearing = { rows, t: 0 };
      this.renderSide();
      return;
    }
    this.spawn();
    if (this.status === 'playing') this.save();
  }

  fullRows() {
    const rows = [];
    for (let r = 0; r < HEIGHT; r++) {
      if (this.board.slice(r * COLS, (r + 1) * COLS).every(Boolean)) rows.push(r);
    }
    return rows;
  }

  removeRows(rows) {
    if (!rows.length) return;
    const full = new Set(rows);
    const kept = this.board.filter((_, i) => !full.has(Math.floor(i / COLS)));
    this.board = [...Array(rows.length * COLS).fill(null), ...kept];
  }

  finishClear() {
    this.removeRows(this.clearing.rows);
    this.clearing = null;
    this.spawn();
    if (this.status === 'playing') this.save();
  }

  award(rows, spin) {
    const lines = rows.length;
    const level = this.level;
    const messages = [];
    let points;
    if (spin === 'full') points = TSPIN_SCORES[lines];
    else if (spin === 'mini') points = MINI_SCORES[lines] ?? MINI_SCORES[2];
    else points = LINE_SCORES[lines];

    if (spin) messages.push(`${spin === 'mini' ? 'Mini ' : ''}T-Spin${lines ? ` ${CLEAR_NAMES[lines]}` : ''}`);
    else if (lines === 4) messages.push('四消！');

    if (lines) {
      // 连续两次四消或 T 旋消行叫“背靠背”，多给一半分
      const hard = lines === 4 || Boolean(spin);
      if (hard && this.b2b) {
        points *= 1.5;
        messages.push('背靠背');
      }
      this.b2b = hard;
      this.combo += 1;
      if (this.combo > 0) {
        points += 50 * this.combo;
        messages.push(`连击 ×${this.combo + 1}`);
      }
    } else {
      this.combo = -1;
    }
    points *= level;

    const full = new Set(rows);
    if (lines && this.board.every((type, i) => !type || full.has(Math.floor(i / COLS)))) {
      points += PERFECT_SCORES[lines] * level;
      messages.push('全部清空！');
    }

    this.score += Math.round(points);
    this.lines += lines;
    if (this.level > level) messages.push(`升到第 ${this.level} 级`);
    if (messages.length) this.flash(messages);
  }

  gameOver() {
    this.status = 'over';
    this.stopLoop();
    this.releaseAll();
    this.submitBest();
    this.updateStats();
    this.save();
    this.showOver();
    this.render();
  }

  // ---------- 游戏循环 ----------

  start() {
    this.status = 'playing';
    this.hideOverlay();
    document.activeElement?.blur?.();
    this.startLoop();
  }

  newGame() {
    this.reset();
    this.start();
    this.save();
  }

  requestRestart() {
    if (this.score > 0 && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
  }

  pause() {
    if (this.status !== 'playing') return;
    this.status = 'paused';
    this.stopLoop();
    this.releaseAll();
    this.submitBest();
    this.save();
    this.showPaused();
    this.render();
  }

  // 暂停、开始画面上按回车或空格，相当于点主按钮
  confirm() {
    if (this.status === 'ready' || this.status === 'paused') this.start();
    else if (this.status === 'over') this.newGame();
  }

  startLoop() {
    if (this.raf) return;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stopLoop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  frame(now) {
    // 切到后台再回来时，不要一下补算太多
    const dt = Math.min(100, Math.max(0, now - this.lastTime));
    this.lastTime = now;
    if (this.status === 'playing') this.step(dt);
    this.render();
    this.raf = this.status === 'playing' ? requestAnimationFrame(this.frame) : 0;
  }

  step(dt) {
    if (this.clearing) {
      this.clearing.t += dt;
      if (this.clearing.t >= CLEAR_MS) this.finishClear();
      return;
    }
    if (!this.piece) return;
    this.autoShift(dt);
    this.autoSoft(dt);
    if (!this.piece) return;

    const interval = gravityMs(this.level);
    this.fallTime += dt;
    while (this.fallTime >= interval) {
      this.fallTime -= interval;
      if (!this.fall()) {
        this.fallTime = 0;
        break;
      }
    }

    if (this.landed()) {
      this.lockTime += dt;
      if (this.lockTime >= LOCK_MS || this.resets >= LOCK_RESETS) this.lock();
    }
  }

  // 按住左右：先走一格，停一下，再连续走
  autoShift(dt) {
    if (!this.shiftDir) return;
    this.shiftTime += dt;
    if (!this.shiftCharged) {
      if (this.shiftTime < DAS_MS) return;
      this.shiftCharged = true;
      this.shiftTime -= DAS_MS;
      this.shift(this.shiftDir);
    }
    while (this.shiftTime >= ARR_MS) {
      this.shiftTime -= ARR_MS;
      if (!this.shift(this.shiftDir)) {
        this.shiftTime = 0;
        break;
      }
    }
  }

  autoSoft(dt) {
    if (!this.softHeld) return;
    this.softTime += dt;
    while (this.softTime >= SOFT_MS && this.piece) {
      this.softTime -= SOFT_MS;
      this.softDrop();
    }
  }

  // ---------- 操作 ----------

  press(control) {
    if (this.status !== 'playing') return;
    if (control === 'left' || control === 'right') {
      this.down.add(control);
      this.shiftDir = control === 'left' ? -1 : 1;
      this.shiftTime = 0;
      this.shiftCharged = false;
      this.shift(this.shiftDir);
    } else if (control === 'soft') {
      this.down.add(control);
      this.softHeld = true;
      this.softTime = 0;
      this.softDrop();
    } else if (control === 'rotate') this.rotate(1);
    else if (control === 'rotateBack') this.rotate(-1);
    else if (control === 'hard') this.hardDrop();
    else if (control === 'hold') this.hold();
  }

  release(control) {
    if (!this.down.delete(control)) return;
    if (control === 'soft') this.softHeld = false;
    if (control !== 'left' && control !== 'right') return;
    // 松开一边时另一边还按着，就换成往那边走
    const other = control === 'left' ? 'right' : 'left';
    if (this.shiftDir !== (control === 'left' ? -1 : 1)) return;
    this.shiftDir = this.down.has(other) ? -this.shiftDir : 0;
    this.shiftTime = 0;
    this.shiftCharged = false;
  }

  releaseAll() {
    this.down.clear();
    this.shiftDir = 0;
    this.softHeld = false;
    this.refs.pad.querySelectorAll('.is-down').forEach((el) => el.classList.remove('is-down'));
  }

  bindPad() {
    const { pad } = this.refs;
    pad.addEventListener('pointerdown', (e) => {
      const button = e.target.closest('[data-control]');
      if (!button) return;
      e.preventDefault();
      button.setPointerCapture(e.pointerId);
      button.classList.add('is-down');
      this.press(button.dataset.control);
    });
    const up = (e) => {
      const button = e.target.closest('[data-control]');
      if (!button?.classList.contains('is-down')) return;
      button.classList.remove('is-down');
      this.release(button.dataset.control);
    };
    pad.addEventListener('pointerup', up);
    pad.addEventListener('pointercancel', up);
    pad.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // 棋盘上的手势：左右拖动一格走一格；往下拖加速；快速往下一划直接落下，往上一划暂存；轻点旋转。
  // 一次手势只认一个方向，免得左右拖的时候不小心往下落
  bindWell() {
    const { well } = this.refs;
    let touch = null;

    well.addEventListener('pointerdown', (e) => {
      if (this.status !== 'playing' || touch) return;
      e.preventDefault();
      well.setPointerCapture(e.pointerId);
      touch = {
        id: e.pointerId, x0: e.clientX, y0: e.clientY, t0: e.timeStamp,
        ax: e.clientX, ay: e.clientY, lastY: e.clientY, lastT: e.timeStamp,
        vy: 0, axis: null, serial: this.serial,
      };
    });

    well.addEventListener('pointermove', (e) => {
      if (!touch || e.pointerId !== touch.id) return;
      const dt = e.timeStamp - touch.lastT;
      if (dt > 0) touch.vy = touch.vy * 0.4 + ((e.clientY - touch.lastY) / dt) * 0.6;
      touch.lastY = e.clientY;
      touch.lastT = e.timeStamp;
      // 方块已经落定换了新的，这次手势就不再管用
      if (this.status !== 'playing' || touch.serial !== this.serial) return;

      const dx = e.clientX - touch.x0;
      const dy = e.clientY - touch.y0;
      if (!touch.axis && Math.hypot(dx, dy) > 10) touch.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      const step = this.cell * 0.9;
      if (touch.axis === 'x') {
        while (e.clientX - touch.ax >= step) {
          touch.ax += step;
          this.shift(1);
        }
        while (touch.ax - e.clientX >= step) {
          touch.ax -= step;
          this.shift(-1);
        }
      } else if (touch.axis === 'y') {
        while (e.clientY - touch.ay >= this.cell) {
          touch.ay += this.cell;
          this.softDrop();
        }
      }
    });

    const end = (e) => {
      if (!touch || e.pointerId !== touch.id) return;
      const { x0, y0, t0, axis, vy, serial } = touch;
      touch = null;
      if (e.type === 'pointercancel' || this.status !== 'playing' || serial !== this.serial) return;
      const dy = e.clientY - y0;
      if (!axis) {
        if (e.timeStamp - t0 < 350) this.rotate(1);
      } else if (axis === 'y' && vy > FLICK_SPEED && dy > this.cell) {
        this.hardDrop();
      } else if (axis === 'y' && vy < -FLICK_SPEED && dy < -this.cell * 1.5) {
        this.hold();
      }
    };
    well.addEventListener('pointerup', end);
    well.addEventListener('pointercancel', end);
  }

  setKeyboard(on) {
    if (on) {
      document.addEventListener('keydown', this.onKey);
      document.addEventListener('keyup', this.onKeyUp);
      window.addEventListener('blur', this.onBlur);
    } else {
      document.removeEventListener('keydown', this.onKey);
      document.removeEventListener('keyup', this.onKeyUp);
      window.removeEventListener('blur', this.onBlur);
      this.releaseAll();
    }
  }

  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    const action = keyAction(e);
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    if (action === 'pause') {
      if (this.status === 'playing') this.pause();
      else this.confirm();
    } else if (this.status !== 'playing') {
      if (action === 'confirm' || action === 'hard') this.confirm();
    } else {
      this.press(action);
    }
  }

  onKeyUp(e) {
    const action = keyAction(e);
    if (action) this.release(action);
  }

  // ---------- 画面 ----------

  // 按可用空间算出每格多大：棋盘尽量大，右侧栏至少留出 SIDE_MIN
  layout() {
    const { main, board, side, hold, next } = this.refs;
    const w = main.clientWidth;
    const h = main.clientHeight;
    if (!w || !h) return;
    const cell = Math.max(8, Math.floor(Math.min(
      (h - WELL_PAD * 2) / ROWS,
      (w - WELL_PAD * 2 - MAIN_GAP - SIDE_MIN) / COLS,
    )));
    const ratio = window.devicePixelRatio || 1;
    this.cell = cell;
    this.ratio = ratio;

    const bw = cell * COLS;
    const bh = cell * ROWS;
    board.style.width = `${bw}px`;
    board.style.height = `${bh}px`;
    board.width = Math.round(bw * ratio);
    board.height = Math.round(bh * ratio);
    this.g.setTransform(board.width / bw, 0, 0, board.height / bh, 0, 0);

    const sideW = Math.min(SIDE_MAX, w - bw - WELL_PAD * 2 - MAIN_GAP);
    side.style.width = `${sideW}px`;
    side.style.height = `${bh + WELL_PAD * 2}px`;
    // 上面的分数栏和下面的按钮跟棋盘加右侧栏一样宽
    this.el.style.setProperty('--tet-w', `${bw + WELL_PAD * 2 + MAIN_GAP + sideW}px`);

    // 预览格子：右侧栏里放得下一个横着的长条
    const mini = Math.max(6, Math.floor(Math.min((sideW - 16) / 4, cell * 0.66)));
    this.mini = mini;
    this.sizeCanvas(hold, mini * 4, mini * 2.5);
    this.sizeCanvas(next, mini * 4, mini * 3 * NEXT_COUNT);

    this.paintGrid();
    this.render();
    this.renderSide();
  }

  sizeCanvas(canvas, w, h) {
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    canvas.width = Math.round(w * this.ratio);
    canvas.height = Math.round(h * this.ratio);
    canvas.getContext('2d').setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);
  }

  // 空棋盘的格子只在尺寸或深浅色变化时重画一次
  paintGrid() {
    const s = this.cell;
    const color = getComputedStyle(this.el).getPropertyValue('--tet-cell').trim() || 'rgba(255, 255, 255, 0.6)';
    this.grid = document.createElement('canvas');
    this.grid.width = Math.round(s * COLS * this.ratio);
    this.grid.height = Math.round(s * ROWS * this.ratio);
    const g = this.grid.getContext('2d');
    g.scale(this.grid.width / (s * COLS), this.grid.height / (s * ROWS));
    g.fillStyle = color;
    const inset = Math.max(0.75, s * 0.06);
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        roundedRect(g, c * s + inset, r * s + inset, s - inset * 2, s - inset * 2, s * 0.2);
        g.fill();
      }
    }
  }

  spritesFor(size) {
    const key = `${size}@${this.ratio}`;
    let set = this.sprites.get(key);
    if (!set) {
      set = { block: {}, ghost: {} };
      for (const type of TYPES) {
        set.block[type] = sprite(size, this.ratio, (g, s) => drawBlock(g, s, COLORS[type]));
        set.ghost[type] = sprite(size, this.ratio, (g, s) => drawGhost(g, s, COLORS[type]));
      }
      this.sprites.set(key, set);
    }
    return set;
  }

  render() {
    const { g, cell: s } = this;
    if (!s) return;
    const w = s * COLS;
    const h = s * ROWS;
    g.clearRect(0, 0, w, h);
    g.drawImage(this.grid, 0, 0, w, h);

    const { block, ghost } = this.spritesFor(s);
    const base = this.status === 'over' ? 0.4 : 1;
    const clearing = this.clearing;
    const fade = clearing ? Math.min(1, clearing.t / CLEAR_MS) : 0;

    for (let r = HIDDEN; r < HEIGHT; r++) {
      g.globalAlpha = clearing?.rows.includes(r) ? base * (1 - fade) : base;
      for (let c = 0; c < COLS; c++) {
        const type = this.board[r * COLS + c];
        if (type) g.drawImage(block[type], c * s, (r - HIDDEN) * s, s, s);
      }
    }
    g.globalAlpha = 1;

    // 消掉的行亮一下，光带从两边往中间收
    if (clearing) {
      g.fillStyle = '#fff';
      g.globalAlpha = 0.85 * (1 - fade);
      const bw = w * (1 - fade);
      for (const r of clearing.rows) {
        roundedRect(g, (w - bw) / 2, (r - HIDDEN) * s + s * 0.1, bw, s * 0.8, s * 0.3);
        g.fill();
      }
      g.globalAlpha = 1;
    }

    const p = this.piece;
    if (!p || this.status === 'over') return;
    const d = this.dropDistance();
    if (d) this.drawPiece(ghost[p.type], p, p.y + d);
    this.drawPiece(block[p.type], p, p.y);
  }

  drawPiece(image, { type, rot, x }, y) {
    const s = this.cell;
    for (const [cx, cy] of ROTATIONS[type][rot]) {
      const row = y + cy - HIDDEN;
      if (row >= 0) this.g.drawImage(image, (x + cx) * s, row * s, s, s);
    }
  }

  // 右侧栏：暂存的方块和接下来的几个
  renderSide() {
    const s = this.mini;
    if (!s) return;
    const { hold, next } = this.refs;
    const hg = hold.getContext('2d');
    hg.clearRect(0, 0, s * 4, s * 2.5);
    if (this.holdType) {
      hg.globalAlpha = this.canHold ? 1 : 0.35;
      this.drawPreview(hg, this.holdType, s * 2, s * 1.25, s);
      hg.globalAlpha = 1;
    }
    const ng = next.getContext('2d');
    ng.clearRect(0, 0, s * 4, s * 3 * NEXT_COUNT);
    this.queue.slice(0, NEXT_COUNT).forEach((type, i) => this.drawPreview(ng, type, s * 2, s * (1.5 + i * 3), s));
  }

  drawPreview(g, type, cx, cy, s) {
    const cells = ROTATIONS[type][0];
    const xs = cells.map(([x]) => x);
    const ys = cells.map(([, y]) => y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const ox = Math.round(cx - ((Math.max(...xs) - minX + 1) * s) / 2 - minX * s);
    const oy = Math.round(cy - ((Math.max(...ys) - minY + 1) * s) / 2 - minY * s);
    const image = this.spritesFor(s).block[type];
    for (const [x, y] of cells) g.drawImage(image, ox + x * s, oy + y * s, s, s);
  }

  updateStats() {
    const { score, best, level, lines } = this.refs;
    score.textContent = fmt(this.score);
    best.textContent = fmt(Math.max(this.best, this.score));
    level.textContent = this.level;
    lines.textContent = this.lines;
    this.refs.pause.disabled = this.status === 'over';
  }

  // 直接落下时棋盘往下顿一下
  bump() {
    const { well } = this.refs;
    well.classList.remove('is-bump');
    void well.offsetWidth;
    well.classList.add('is-bump');
  }

  // 四消、T 旋、连击这些在棋盘中间浮出一行字
  flash(messages) {
    const item = document.createElement('div');
    item.className = 'tet-flash-item';
    for (const text of messages) {
      const line = document.createElement('span');
      line.textContent = text;
      item.append(line);
    }
    item.addEventListener('animationend', () => item.remove());
    this.refs.flash.replaceChildren(item);
  }

  showOverlay({ title, text = '', tips = null, actions }) {
    const { overlay } = this.refs;
    overlay.innerHTML = '<h3></h3><p></p><div class="tet-actions"></div>';
    overlay.querySelector('h3').textContent = title;
    const p = overlay.querySelector('p');
    p.textContent = text;
    p.hidden = !text;
    if (tips) {
      const list = document.createElement('dl');
      list.className = 'tet-tips';
      for (const [key, meaning] of tips) {
        const dt = document.createElement('dt');
        dt.textContent = key;
        const dd = document.createElement('dd');
        dd.textContent = meaning;
        list.append(dt, dd);
      }
      p.before(list);
    }
    const row = overlay.querySelector('.tet-actions');
    for (const { label, primary, onClick } of actions) {
      const button = document.createElement('button');
      button.className = primary ? 'tet-btn is-primary' : 'tet-btn';
      button.textContent = label;
      button.addEventListener('click', onClick);
      row.append(button);
    }
    overlay.hidden = false;
  }

  hideOverlay() {
    this.refs.overlay.hidden = true;
  }

  showIntro() {
    const keyboard = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
    this.showOverlay({
      title: keyboard ? '操作方法' : '准备好了吗',
      tips: keyboard ? KEY_TIPS : null,
      text: keyboard ? '' : '忘了怎么玩，可以点上面的 ? 再看一遍',
      actions: [{ label: '开始游戏', primary: true, onClick: () => this.start() }],
    });
  }

  showPaused() {
    this.showOverlay({
      title: '已暂停',
      text: `现在 ${fmt(this.score)} 分 · 第 ${this.level} 级`,
      actions: [
        { label: '重新开始', onClick: () => this.requestRestart() },
        { label: '继续', primary: true, onClick: () => this.start() },
      ],
    });
  }

  showOver() {
    const record = this.bestBefore > 0 && this.score > this.bestBefore;
    this.showOverlay({
      title: '方块堆到顶了',
      text: `这一局 ${fmt(this.score)} 分，消除 ${this.lines} 行${record ? '，刷新了最高分！' : '。'}`,
      actions: [{ label: '再来一局', primary: true, onClick: () => this.newGame() }],
    });
  }

  destroy() {
    this.stopLoop();
    this.setKeyboard(false);
    this.resizer.disconnect();
    this.scheme.removeEventListener('change', this.onScheme);
  }
}

// ---------- 玩法说明 ----------
// 外壳第一次打开游戏、或者点标题栏的“?”时显示。插图是简化的棋盘：方块和游戏里一样是双色渐变加高光，
// 空格子、文字和箭头用外壳的颜色变量，深浅色下都看得清

const GUIDE_FONT = 'font-family="ui-rounded, -apple-system, system-ui, sans-serif"';
const iconBody = (svg) => svg.replace(/^<svg[^>]*>|<\/svg>$/g, '');
const num = (v) => Math.round(v * 100) / 100;

// 画一页插图：draw 拿到一组画图函数，返回 SVG 内容。渐变 id 带上页码，几页同时在页面上也不会串色
function guideArt(step, draw) {
  const id = (name) => `tetris-${step}-${name}`;
  const used = new Set();
  const line = (d, extra = '') =>
    `<path d="${d}" fill="none" style="stroke:var(--label-2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"${extra}/>`;
  // 箭头尖：(x, y) 是尖端，(ux, uy) 是箭头指的方向
  const head = (x, y, ux, uy) => {
    const side = (a) => `${num(x - 7 * (ux * Math.cos(a) - uy * Math.sin(a)))} ${num(y - 7 * (ux * Math.sin(a) + uy * Math.cos(a)))}`;
    return `M${side(0.6)}L${num(x)} ${num(y)}L${side(-0.6)}`;
  };
  const art = {
    // 棋盘底板和空格子，(x, y) 是左上角第一格的位置
    board(x, y, cols, rows, s) {
      const pad = Math.round(s * 0.35);
      const inset = Math.max(0.75, s * 0.06);
      let out = `<rect x="${x - pad}" y="${y - pad}" width="${cols * s + pad * 2}" height="${rows * s + pad * 2}" rx="${num(s * 0.7)}" style="fill:var(--fill)"/>`;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          out += `<rect x="${num(x + c * s + inset)}" y="${num(y + r * s + inset)}" width="${num(s - inset * 2)}" height="${num(s - inset * 2)}" rx="${num(s * 0.2)}" style="fill:var(--fill)"/>`;
        }
      }
      return out;
    },
    // 一格方块，画法同 drawBlock
    block(type, x, y, s) {
      used.add(type);
      const inset = Math.max(0.75, s * 0.045);
      const box = `x="${num(x + inset)}" y="${num(y + inset)}" width="${num(s - inset * 2)}" height="${num(s - inset * 2)}" rx="${num(s * 0.22)}"`;
      return `<rect ${box} fill="url(#${id(type)})"/><rect ${box} fill="url(#${id('shine')})"/>`;
    },
    // 落点影子，画法同 drawGhost
    ghost(type, x, y, s) {
      const width = Math.max(1.5, s * 0.08);
      const inset = Math.max(0.75, s * 0.045) + width / 2;
      const [color] = COLORS[type];
      return `<rect x="${num(x + inset)}" y="${num(y + inset)}" width="${num(s - inset * 2)}" height="${num(s - inset * 2)}" rx="${num(s * 0.2)}" fill="${color}" fill-opacity=".16" stroke="${color}" stroke-opacity=".8" stroke-width="${num(width)}"/>`;
    },
    // 一整个方块，(col, row) 是它旋转方框左上角所在的格子
    piece(type, rot, col, row, x, y, s, kind = 'block') {
      return ROTATIONS[type][rot].map(([cx, cy]) => art[kind](type, x + (col + cx) * s, y + (row + cy) * s, s)).join('');
    },
    // 已经堆着的方块：每行一个字符串，字母是方块种类，. 是空格；最后一行贴着棋盘底
    stack(lines, rows, x, y, s) {
      let out = '';
      lines.forEach((text, i) => {
        [...text].forEach((type, c) => {
          if (SHAPES[type]) out += art.block(type, x + c * s, y + (rows - lines.length + i) * s, s);
        });
      });
      return out;
    },
    // 手指按的位置
    tap: (x, y) => `<circle cx="${x}" cy="${y}" r="14" fill="#fff" fill-opacity=".7" stroke="#000" stroke-opacity=".18" stroke-width="1.5"/>`,
    // 直线箭头，heads 为 2 时画两层尖，表示甩得很快
    arrow(x1, y1, x2, y2, heads = 1) {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      let d = `M${x1} ${y1}L${x2} ${y2}`;
      for (let k = 0; k < heads; k++) d += head(x2 - ux * 6 * k, y2 - uy * 6 * k, ux, uy);
      return line(d);
    },
    // 任意路径加一个箭头尖，(x, y, ux, uy) 是终点和终点处的方向
    curve: (d, x, y, ux, uy) => line(d + head(x, y, ux, uy)),
    line,
    text: (x, y, label, { size = 12, weight = 600, color = 'var(--label-2)' } = {}) =>
      `<text x="${x}" y="${y}" ${GUIDE_FONT} font-size="${size}" font-weight="${weight}" text-anchor="middle" dominant-baseline="central" style="fill:${color}">${label}</text>`,
    // 底部按钮：圆底加游戏里同一个图标
    button(cx, cy, r, icon, main = false) {
      const k = r * 0.038;
      const fill = main ? 'fill="#fa2d48"' : 'style="fill:var(--fill)"';
      const stroke = main ? 'stroke="#fff"' : 'style="stroke:var(--label)"';
      return `<circle cx="${cx}" cy="${cy}" r="${r}" ${fill}/>`
        + `<g transform="translate(${num(cx - 12 * k)} ${num(cy - 12 * k)}) scale(${num(k)})" fill="none" ${stroke} stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${iconBody(icon)}</g>`;
    },
    // 右侧栏里带标题的小框
    box: (x, y, w, h, label) =>
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" style="fill:var(--fill)"/>${art.text(x + w / 2, y + 16, label, { size: 11 })}`,
  };
  const body = draw(art);
  const gradients = [...used].map((type) => {
    const [a, b] = COLORS[type];
    return `<linearGradient id="${id(type)}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  }).join('');
  const shine = `<radialGradient id="${id('shine')}" cx=".82" cy=".12" r=".8"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
  return `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg"><defs>${gradients}${shine}</defs>${body}</svg>`;
}

const GUIDE = [
  {
    title: '填满一行',
    text: '方块会一个个落下来，填满一整行就能消掉。堆到最顶上，这一局就结束了。',
    // 左边：长条正对着缺口往下落；右边：落进去以后这一行填满，亮一下就消掉
    art: guideArt(1, (a) => {
      const s = 11;
      const stack = ['.OO.......', 'JOO.T.....', 'JJJTTT....'];
      const row = 19 + 11 * s;
      return a.board(18, 19, 10, 12, s) + a.stack(stack, 12, 18, 19, s)
        + a.piece('I', 0, 6, 2, 18, 19, s) + a.piece('I', 0, 6, 10, 18, 19, s, 'ghost')
        + a.arrow(106, 70, 106, 130)
        + a.line('M145 75l9 10-9 10')
        + a.board(172, 19, 10, 12, s) + a.stack([...stack.slice(0, 2), 'JJJTTTIIII'], 12, 172, 19, s)
        + `<rect x="173" y="${num(row + s * 0.1)}" width="${10 * s - 2}" height="${num(s * 0.8)}" rx="${num(s * 0.3)}" fill="#fff" fill-opacity=".8"/>`;
    }),
  },
  {
    title: '拖动和轻点',
    text: '在棋盘上左右拖动来移动方块，轻点一下就能旋转。',
    // 左边：手指按住左右拖；右边：轻点一下，T 转了个方向
    art: guideArt(2, (a) => {
      const s = 15;
      const stack = ['Z...OO', 'ZZ..OO'];
      const scene = (x) => a.board(x, 14, 6, 7, s) + a.stack(stack, 7, x, 14, s);
      const cx = 192 + 2.5 * s;
      const cy = 14 + 2.5 * s;
      const r = 2.1 * s;
      const at = (deg) => [num(cx + r * Math.cos((deg * Math.PI) / 180)), num(cy + r * Math.sin((deg * Math.PI) / 180))];
      const [sx, sy] = at(-115);
      const [ex, ey] = at(-20);
      const end = (-20 * Math.PI) / 180;
      return scene(36) + a.piece('T', 0, 1, 1, 36, 14, s)
        + a.arrow(81, 81.5, 44, 81.5) + a.arrow(81, 81.5, 118, 81.5) + a.tap(81, 81.5)
        + a.text(81, 152, '拖动 · 移动')
        + scene(192) + a.piece('T', 1, 1, 1, 192, 14, s)
        + a.curve(`M${sx} ${sy}A${r} ${r} 0 0 1 ${ex} ${ey}`, ex, ey, -Math.sin(end), Math.cos(end))
        + a.tap(237, 89) + a.text(237, 152, '轻点 · 旋转');
    }),
  },
  {
    title: '上下划动',
    text: '往下拖加速下落，往下一划直接落到底；往上一划先暂存起来。',
    // 往下拖、往下一划、往上一划，各画一小块棋盘
    art: guideArt(3, (a) => {
      const s = 12;
      const y = 14;
      const left = 19;
      const mid = 101;
      const right = 183;
      return a.board(left, y, 5, 9, s) + a.stack(['L...J'], 9, left, y, s)
        + a.piece('S', 0, 1, 0, left, y, s) + a.piece('S', 0, 1, 7, left, y, s, 'ghost')
        + a.tap(49, 56) + a.arrow(49, 72, 49, 92) + a.text(49, 148, '加速下落')
        + a.board(mid, y, 5, 9, s) + a.stack(['O...O'], 9, mid, y, s)
        + a.line('M115 36V90M147 36V90', ' stroke-opacity=".45"')
        + a.piece('T', 0, 1, 7, mid, y, s)
        + a.tap(131, 32) + a.arrow(131, 48, 131, 92, 2) + a.text(131, 148, '直接落到底')
        + a.board(right, y, 4, 9, s) + a.stack(['J..S'], 9, right, y, s)
        + a.box(241, 10, 44, 64, '暂存') + a.piece('L', 0, 0, 0, 248, 40, 10)
        + a.tap(207, 92) + a.curve('M207 78V58Q207 48 217 48H236', 236, 48, 1, 0)
        + a.text(232, 148, '暂存起来');
    }),
  },
  {
    title: '用按钮也行',
    text: '也可以按下面的按钮：左右移动、加速、落到底和旋转。',
    // 和游戏里的按钮排法一样：左手三个，右手落到底和旋转
    art: guideArt(4, (a) => a.button(39, 70, 19, LEFT) + a.button(85, 70, 19, DOWN) + a.button(131, 70, 19, RIGHT)
      + a.button(205, 70, 19, DROP) + a.button(257, 70, 23, ROTATE, true)
      + a.tap(268, 82)
      + a.text(39, 112, '左移') + a.text(85, 112, '加速') + a.text(131, 112, '右移')
      + a.text(205, 112, '落到底') + a.text(257, 112, '旋转')),
  },
  {
    title: '暂存和升级',
    text: '右边是暂存和接下来的方块，点暂存框也能暂存。每消 10 行升一级，落得更快分更多。',
    // 右侧栏：暂存、下一个、等级和行数
    art: guideArt(5, (a) => a.box(40, 20, 100, 66, '暂存') + a.piece('T', 0, 0, 0, 72, 48, 12)
      + a.tap(128, 76)
      + a.box(40, 96, 46, 54, '等级') + a.text(63, 132, '2', { size: 20, weight: 700, color: 'var(--label)' })
      + a.box(94, 96, 46, 54, '行数') + a.text(117, 132, '12', { size: 20, weight: 700, color: 'var(--label)' })
      + a.box(160, 20, 100, 130, '下一个')
      + a.piece('I', 0, 0, -1, 190, 57, 10) + a.piece('O', 0, -1, 0, 200, 83, 10) + a.piece('S', 0, 0, 0, 195, 116, 10)),
  },
];

export default {
  guide: GUIDE,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Tetris(root, ctx);
    return {
      pause: () => {
        game.pause();
        game.setKeyboard(false);
      },
      resume: () => game.setKeyboard(true),
      destroy: () => game.destroy(),
    };
  },
};
