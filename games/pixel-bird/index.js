// 像素小鸟：点一下屏幕小鸟就往上扑一下，从水管之间的缝隙穿过去得 1 分，碰到水管或地面就结束。
// 画面先画在一张只有 256 像素高的小画布上，再整体放大显示，所以是像素风格；画布宽度随屏幕比例变化。
// 物理按固定步长计算，60Hz 和 120Hz 的屏幕手感一样。图案全部用代码画，不需要图片文件。

const H = 256;
const MIN_W = 144;
const MAX_W = 240;
const GROUND_Y = 224; // 地面顶边
const BIRD_X = 44;
const BIRD_R = 5; // 碰撞半径，比小鸟的图略小，擦个边不算撞上
const READY_Y = 112;
const CEILING = -12;
const STEP = 1 / 120;

const GRAVITY = 470;
const FLAP_SPEED = -142;
const MAX_FALL = 240;
const DIVE = Math.PI / 2;
const SPEED = 62; // 水管和地面每秒移动的像素
const PIPE_W = 24;
const CAP_H = 12;
const PIPE_SPACING = 96;
const THEME_EVERY = 20; // 每 20 分换一次天色：白天 → 黄昏 → 夜晚
const THEME_FADE = 1.5;
const COUNTDOWN = 1.5; // 暂停后继续时的 3、2、1
const OVER_LOCK_MS = 600; // 结算面板出来后先锁一下按钮，免得狂点时直接开了下一局

// 缝隙从 64 像素开始，每 8 分收窄 2 像素，最窄 52
const gapFor = (score) => Math.max(52, 64 - Math.floor(score / 8) * 2);

const MEDALS = [
  { min: 40, name: '白金', colors: ['#5d6d7e', '#dfe8ef', '#ffffff'] },
  { min: 30, name: '金', colors: ['#8f6200', '#f5c518', '#fff3a8'] },
  { min: 20, name: '银', colors: ['#5f6672', '#c4cad3', '#f4f6fa'] },
  { min: 10, name: '铜', colors: ['#7c3f14', '#d4823f', '#f6c08a'] },
];

const FLAP_KEYS = new Set([' ', 'ArrowUp', 'w', 'W', 'Enter']);

const fmt = (n) => n.toLocaleString('zh-CN');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const r2 = (n) => Math.round(n * 100) / 100;

// ---------- 像素图 ----------

const INK = '#3b2a33';

// 小鸟 17×12：身体一张，翅膀三个姿势叠上去。k 描边，w 白，y 身体，Y 高光，o 肚子，r 嘴
const BIRD_BODY = [
  '.....kkkkkk......',
  '...kkYYyykwwk....',
  '..kYYyyykwwwwk...',
  '.kyyyyyykwwwkwk..',
  '.kyyyyyykwwwkwk..',
  'kyyyyyyyykwwwwk..',
  'kyyyyyyyyykkkkkk.',
  'kyyyyyyyykrrrrrrk',
  '.kooooooookrkkkk.',
  '..koooooookrrrrk.',
  '...kkoooooookkk..',
  '.....kkkkkk......',
];

// [起始行, 图案]，. 表示保留身体原样
const WINGS = [
  [2, ['.kkkk..', 'kwwwwk.', 'kwwwwk.', 'kywwyk.', '.kkkk..']],
  [4, ['kkkkk..', 'kwwwwk.', 'kwwwwwk', 'kywwwk.', '.kkkk..']],
  [6, ['.kkkk..', 'kywwwk.', 'kwwwwk.', 'kwwwk..', '.kkk...']],
];
const FLAP_CYCLE = [0, 1, 2, 1];

const SKINS = [
  { y: '#f8c832', Y: '#fdf2a0', o: '#f08a24', r: '#f2552c' },
  { y: '#5cc8f5', Y: '#c8f0ff', o: '#2f8fd8', r: '#f2552c' },
  { y: '#f4625a', Y: '#ffc0b0', o: '#cf3a3a', r: '#ffb020' },
];

// 水管：每个字母是一列的颜色，从左到右有高光和阴影
const PIPE_COLORS = { k: INK, H: '#e4fd8b', l: '#9ce659', g: '#74bf2e', m: '#5fa525', d: '#4a8a1a' };
const PIPE_BODY = `klHHll${'g'.repeat(13)}mmdmk`;
const PIPE_CAP = `klHHll${'g'.repeat(17)}mmdmk`;

// 分数用的 5×7 数字
const DIGITS = [
  ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
  ['..#..', '.##..', '..#..', '..#..', '..#..', '..#..', '.###.'],
  ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
  ['#####', '...#.', '..#..', '...#.', '....#', '#...#', '.###.'],
  ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
  ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
  ['..##.', '.#...', '#....', '####.', '#...#', '#...#', '.###.'],
  ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
  ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
  ['.###.', '#...#', '#...#', '.####', '....#', '...#.', '.##..'],
];

const STAR = ['..#..', '.###.', '#####', '.###.', '.#.#.'];

// 三种天色。tint 是盖在水管和地面上的一层颜色，让它们和天色协调
const THEMES = [
  {
    skyTop: '#3fb5d6', skyBottom: '#a6e6ec',
    cloud: '#f4fbfb', cloudShade: '#d3eef1',
    city: '#a9dcc9', cityShade: '#93cdb7', window: '#c6eadc', lit: 0,
    bush: '#5bcf5f', bushShade: '#47b14b',
    tint: [0, 0, 0, 0],
  },
  {
    skyTop: '#4b3d8f', skyBottom: '#ffa36e', sun: '#ffd773',
    cloud: '#ffc8a6', cloudShade: '#f0a28c',
    city: '#7d5c8f', cityShade: '#6b4d7d', window: '#8f6c9f', lit: 0.25,
    bush: '#4f8f5a', bushShade: '#3f7a4c',
    tint: [110, 50, 120, 0.16],
  },
  {
    skyTop: '#0d1b3d', skyBottom: '#2f5182', moon: '#f6f1c7', stars: true,
    cloud: '#3d5b87', cloudShade: '#34507a',
    city: '#1f3053', cityShade: '#192842', window: '#2a3d63', lit: 0.45,
    bush: '#2b5c49', bushShade: '#224c3c',
    tint: [12, 22, 64, 0.38],
  },
];

const GROUND = { edge: INK, light: '#9be15d', dark: '#73bf2e', base: '#558022', top: '#cdbf6b', dirt: '#ded895', speck: '#d2c97f' };

function makeCanvas(w, h, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  paint(canvas.getContext('2d'));
  return canvas;
}

function paintRows(g, rows, palette, ox = 0, oy = 0) {
  rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '.') return;
      g.fillStyle = palette[ch];
      g.fillRect(ox + x, oy + y, 1, 1);
    });
  });
}

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

function mix(a, b, t) {
  const from = rgb(a);
  const to = rgb(b);
  return `rgb(${from.map((v, i) => Math.round(v + (to[i] - v) * t)).join(',')})`;
}

// 固定种子的随机数，保证每次生成的城市和云朵都一样
function seeded(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function disc(g, cx, cy, r) {
  for (let dy = -r; dy <= r; dy++) {
    const half = Math.floor(Math.sqrt(r * r - dy * dy));
    g.fillRect(cx - half, cy + dy, half * 2 + 1, 1);
  }
}

function paintSky(g, theme) {
  const bands = 7;
  const bandH = GROUND_Y / bands;
  for (let i = 0; i < bands; i++) {
    g.fillStyle = mix(theme.skyTop, theme.skyBottom, i / (bands - 1));
    g.fillRect(0, i * bandH, MAX_W, bandH);
  }
  // 色带交界处用棋盘格过渡，是像素画常见的渐变画法
  for (let i = 1; i < bands; i++) {
    const y = i * bandH;
    g.fillStyle = mix(theme.skyTop, theme.skyBottom, i / (bands - 1));
    for (let x = 0; x < MAX_W; x++) {
      if (x % 2 === 0) g.fillRect(x, y - 1, 1, 1);
      if (x % 4 === 1) g.fillRect(x, y - 2, 1, 1);
    }
  }
  const rand = seeded(7);
  if (theme.stars) {
    g.fillStyle = '#fff';
    for (let i = 0; i < 46; i++) {
      const x = Math.floor(rand() * MAX_W);
      const y = Math.floor(rand() * 140);
      g.globalAlpha = 0.45 + rand() * 0.55;
      g.fillRect(x, y, 1, 1);
      if (i % 9 === 0) {
        g.fillRect(x - 1, y, 3, 1);
        g.fillRect(x, y - 1, 1, 3);
      }
    }
    g.globalAlpha = 1;
  }
  if (theme.sun) {
    g.fillStyle = theme.sun;
    disc(g, 104, 150, 20);
  }
  if (theme.moon) {
    g.fillStyle = theme.moon;
    disc(g, 108, 42, 9);
    g.fillStyle = '#ddd6a6';
    g.fillRect(104, 39, 3, 2);
    g.fillRect(110, 45, 2, 2);
    g.fillRect(111, 37, 2, 1);
  }
}

// 一排连绵的圆包，用来画云和灌木；period 是图案重复的宽度，首尾能接上
function paintMounds(g, period, baseY, puffs, color, squash = 1) {
  g.fillStyle = color;
  for (let x = 0; x < period; x++) {
    let h = 0;
    for (const p of puffs) {
      let d = Math.abs(x - p.x);
      d = Math.min(d, period - d);
      if (d < p.r) h = Math.max(h, Math.floor(Math.sqrt(p.r * p.r - d * d) * squash));
    }
    if (h > 0) g.fillRect(x, baseY - h, 1, h);
  }
}

function puffs(rand, period, minR, maxR, step) {
  const list = [];
  for (let x = 0; x < period; x += step) list.push({ x: x + Math.floor(rand() * step), r: minR + Math.floor(rand() * (maxR - minR)) });
  return list;
}

const CLOUD_P = 192;
const CITY_P = 128;
const BUSH_P = 96;

function paintClouds(g, theme) {
  const rand = seeded(11);
  paintMounds(g, CLOUD_P, 186, puffs(rand, CLOUD_P, 12, 24, 22), theme.cloudShade, 0.9);
  paintMounds(g, CLOUD_P, 190, puffs(rand, CLOUD_P, 10, 20, 18), theme.cloud, 0.85);
  g.fillStyle = theme.cloud;
  g.fillRect(0, 186, CLOUD_P, GROUND_Y - 186);
}

function paintCity(g, theme) {
  const rand = seeded(23);
  const base = GROUND_Y - 6;
  let x = 0;
  while (x < CITY_P) {
    const w = Math.min(CITY_P - x, 9 + Math.floor(rand() * 10));
    const top = base - 14 - Math.floor(rand() * 30);
    g.fillStyle = rand() < 0.5 ? theme.city : theme.cityShade;
    g.fillRect(x, top, w, base - top);
    g.fillRect(x + 1, top - 1, w - 2, 1);
    for (let wy = top + 3; wy < base - 4; wy += 4) {
      for (let wx = x + 2; wx < x + w - 2; wx += 3) {
        g.fillStyle = rand() < theme.lit ? '#ffd96b' : theme.window;
        g.fillRect(wx, wy, 1, 2);
      }
    }
    x += w;
  }
}

function paintBushes(g, theme) {
  const rand = seeded(31);
  paintMounds(g, BUSH_P, GROUND_Y, puffs(rand, BUSH_P, 9, 15, 14), theme.bushShade, 0.8);
  paintMounds(g, BUSH_P, GROUND_Y, puffs(rand, BUSH_P, 6, 12, 12), theme.bush, 0.75);
}

// 地面每 8 像素重复一次，滚动时只要错开 0 到 7 像素
function paintGround(g) {
  const w = MAX_W + 8;
  g.fillStyle = GROUND.edge;
  g.fillRect(0, 0, w, 1);
  for (let y = 1; y <= 5; y++) {
    for (let x = 0; x < w; x++) {
      g.fillStyle = (x + y) % 8 < 4 ? GROUND.light : GROUND.dark;
      g.fillRect(x, y, 1, 1);
    }
  }
  g.fillStyle = GROUND.base;
  g.fillRect(0, 6, w, 1);
  g.fillStyle = GROUND.top;
  g.fillRect(0, 7, w, 1);
  g.fillStyle = GROUND.dirt;
  g.fillRect(0, 8, w, H - GROUND_Y - 8);
  g.fillStyle = GROUND.speck;
  for (let x = 0; x < w; x++) {
    if (x % 8 < 3) g.fillRect(x, 14, 1, 1);
    if ((x + 4) % 8 < 2) g.fillRect(x, 22, 1, 1);
  }
}

function digitSprite(rows, scale) {
  return makeCanvas(rows[0].length * scale + 2, rows.length * scale + 3, (g) => {
    const cells = [];
    rows.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && cells.push([x * scale, y * scale])));
    // 先往外扩一圈画深色描边，下面多一像素当阴影，再画白字
    g.fillStyle = INK;
    for (const [x, y] of cells) g.fillRect(x, y, scale + 2, scale + 3);
    g.fillStyle = '#fff';
    for (const [x, y] of cells) g.fillRect(x + 1, y + 1, scale, scale);
  });
}

function medalSprite(medal) {
  const [rim, face, shine] = medal.colors;
  return makeCanvas(16, 16, (g) => {
    g.fillStyle = INK;
    disc(g, 8, 8, 7);
    g.fillStyle = rim;
    disc(g, 8, 8, 6);
    g.fillStyle = face;
    disc(g, 8, 8, 5);
    g.fillStyle = shine;
    g.fillRect(5, 4, 2, 1);
    g.fillRect(4, 5, 1, 2);
    paintRows(g, STAR, { '#': rim }, 6, 6);
  });
}

let art = null;

// 所有图案第一次打开游戏时画好，之后一直复用
function getArt() {
  if (art) return art;
  const pipeCol = (cols) => (g, y) => [...cols].forEach((ch, x) => {
    g.fillStyle = PIPE_COLORS[ch];
    g.fillRect(x, y, 1, 1);
  });
  art = {
    birds: SKINS.map((skin) => WINGS.map(([top, wing]) => makeCanvas(17, 12, (g) => {
      const palette = { k: INK, w: '#fff', ...skin };
      paintRows(g, BIRD_BODY, palette);
      paintRows(g, wing, palette, 0, top);
    }))),
    pipeBody: makeCanvas(PIPE_W, 1, (g) => pipeCol(PIPE_BODY)(g, 0)),
    pipeCap: makeCanvas(PIPE_W + 4, CAP_H, (g) => {
      for (let y = 0; y < CAP_H; y++) pipeCol(PIPE_CAP)(g, y);
      g.fillStyle = INK;
      g.fillRect(0, 0, PIPE_W + 4, 1);
      g.fillRect(0, CAP_H - 1, PIPE_W + 4, 1);
    }),
    ground: makeCanvas(MAX_W + 8, H - GROUND_Y, paintGround),
    digits: DIGITS.map((rows) => digitSprite(rows, 2)),
    bigDigits: DIGITS.map((rows) => digitSprite(rows, 4)),
    scenery: THEMES.map((theme) => ({
      sky: makeCanvas(MAX_W, GROUND_Y, (g) => paintSky(g, theme)),
      clouds: makeCanvas(CLOUD_P, GROUND_Y, (g) => paintClouds(g, theme)),
      city: makeCanvas(CITY_P, GROUND_Y, (g) => paintCity(g, theme)),
      bushes: makeCanvas(BUSH_P, GROUND_Y, (g) => paintBushes(g, theme)),
    })),
  };
  return art;
}

// ---------- 声音：用 Web Audio 现场合成，不需要音频文件 ----------

class Sound {
  constructor(muted) {
    this.muted = muted;
    this.ac = null;
  }

  // iPhone 要求声音由点击触发，所以在第一次点击时才创建
  unlock() {
    if (!this.ac) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      try {
        this.ac = new AudioContext();
      } catch {
        return;
      }
    }
    if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
  }

  ready() {
    return !this.muted && this.ac?.state === 'running';
  }

  tone(type, from, to, duration, volume, delay = 0) {
    if (!this.ready()) return;
    const t = this.ac.currentTime + delay;
    const osc = this.ac.createOscillator();
    const gain = this.ac.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(to, t + duration);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(this.ac.destination);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  noise(duration, volume) {
    if (!this.ready()) return;
    const length = Math.floor(this.ac.sampleRate * duration);
    const buffer = this.ac.createBuffer(1, length, this.ac.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ac.createBufferSource();
    const gain = this.ac.createGain();
    source.buffer = buffer;
    gain.gain.value = volume;
    source.connect(gain).connect(this.ac.destination);
    source.start();
  }

  flap() {
    this.tone('triangle', 380, 820, 0.08, 0.16);
  }

  point() {
    this.tone('square', 988, 988, 0.07, 0.05);
    this.tone('square', 1319, 1319, 0.2, 0.05, 0.07);
  }

  hit() {
    this.noise(0.14, 0.22);
    this.tone('square', 200, 70, 0.16, 0.08);
  }

  fall() {
    this.tone('triangle', 640, 110, 0.5, 0.14, 0.18);
  }

  close() {
    this.ac?.close().catch(() => {});
    this.ac = null;
  }
}

// ---------- 游戏 ----------

const ICONS = {
  pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" rx="1.2"/><rect x="13.9" y="5" width="3.6" height="14" rx="1.2"/></svg>',
  sound: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18.2 6.5a8 8 0 0 1 0 11"/></svg>',
  muted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" fill="currentColor"/><path d="m16 9.5 5 5m0-5-5 5"/></svg>',
};

const TEMPLATE = `
  <div class="pbird">
    <div class="pbird-screen" data-ref="screen">
      <canvas class="pbird-canvas" data-ref="canvas" width="${MIN_W}" height="${H}" role="img" aria-label="像素小鸟的游戏画面"></canvas>
      <div class="pbird-hud">
        <button class="pbird-icon" data-ref="pause" aria-label="暂停">${ICONS.pause}</button>
        <button class="pbird-icon" data-ref="sound"></button>
      </div>
      <p class="pbird-hint" data-ref="hint"></p>
      <div class="pbird-overlay" data-ref="overlay" hidden></div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="pixel-bird"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'pixel-bird';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

const isNum = Number.isFinite;

function isValidRun(run) {
  return Boolean(run)
    && [run.score, run.dist, run.nextPipeAt, run.bird?.y, run.bird?.vy, run.bird?.rot].every(isNum)
    && Array.isArray(run.pipes)
    && run.pipes.every((p) => [p.wx, p.gapY, p.gap].every(isNum));
}

function circleHitsRect(cx, cy, r, x, y, w, h) {
  const dx = cx - clamp(cx, x, x + w);
  const dy = cy - clamp(cy, y, y + h);
  return dx * dx + dy * dy < r * r;
}

class Game {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.best = ctx.records.score ?? 0;
    this.last = isNum(ctx.saved?.last) ? ctx.saved.last : null;
    this.sound = new Sound(Boolean(ctx.saved?.muted));
    this.art = getArt();
    this.reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    this.raf = 0;
    this.overTimer = 0;

    root.innerHTML = TEMPLATE;
    this.root = root.firstElementChild;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.W = MIN_W;
    this.setCanvasWidth(MIN_W);

    this.frame = this.frame.bind(this);
    this.onKey = this.onKey.bind(this);
    this.bindInput();
    this.resizer = new ResizeObserver(([entry]) => this.fit(entry.contentRect));
    this.resizer.observe(this.root);

    this.time = 0;
    this.dist = 0;
    this.theme = 0;
    this.themeFrom = 0;
    this.themeT = 1;
    this.flash = 0;
    this.shake = 0;
    if (isValidRun(ctx.saved?.run)) this.restore(ctx.saved.run);
    else this.toReady();
    this.draw();
  }

  // ---------- 局面 ----------

  toReady() {
    clearTimeout(this.overTimer);
    this.state = 'ready';
    this.skin = Math.floor(Math.random() * SKINS.length);
    this.bird = { y: READY_Y, vy: 0, rot: 0 };
    this.pipes = [];
    this.score = 0;
    this.setTheme(0);
    this.hideOverlay();
    this.updateHud();
  }

  start() {
    this.state = 'playing';
    this.score = 0;
    this.bestBefore = this.best;
    this.pipes = [];
    this.lastGapY = null;
    this.nextPipeAt = Math.round(this.dist) + this.W + 8;
    this.updateHud();
  }

  restore(run) {
    this.state = 'paused';
    this.score = run.score;
    this.bestBefore = isNum(run.bestBefore) ? run.bestBefore : this.best;
    this.skin = SKINS[run.skin] ? run.skin : 0;
    this.dist = run.dist;
    this.nextPipeAt = run.nextPipeAt;
    this.lastGapY = isNum(run.lastGapY) ? run.lastGapY : null;
    this.bird = { ...run.bird };
    this.pipes = run.pipes.map(({ wx, gapY, gap, scored }) => ({ wx, gapY, gap, scored: Boolean(scored) }));
    this.theme = this.themeFrom = THEMES[run.theme] ? run.theme : 0;
    this.showPause();
    this.updateHud();
  }

  snapshot() {
    const { score, bestBefore, skin, theme, nextPipeAt, lastGapY, bird } = this;
    return {
      score, bestBefore, skin, theme, nextPipeAt, lastGapY,
      dist: r2(this.dist),
      bird: { y: r2(bird.y), vy: r2(bird.vy), rot: r2(bird.rot) },
      pipes: this.pipes.map(({ wx, gapY, gap, scored }) => ({ wx, gapY, gap, scored })),
    };
  }

  hasRun() {
    return ['playing', 'countdown', 'paused'].includes(this.state);
  }

  save() {
    const run = this.hasRun() ? this.snapshot() : null;
    let summary = '准备起飞';
    if (run) summary = `${fmt(this.score)} 分 · 已暂停`;
    else if (this.last !== null) summary = `上一局 ${fmt(this.last)} 分 · 最高 ${fmt(this.best)}`;
    this.ctx.save({ muted: this.sound.muted, last: this.last, run }, { summary, finished: !run });
  }

  setTheme(index) {
    if (index === this.theme) return;
    this.themeFrom = this.theme;
    this.theme = index;
    this.themeT = 0;
  }

  // ---------- 操作 ----------

  flap() {
    if (this.state === 'ready') this.start();
    if (this.state !== 'playing') return;
    this.bird.vy = FLAP_SPEED;
    this.bird.rot = -0.42;
    this.sound.flap();
  }

  pauseRun() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.state = 'paused';
    this.showPause();
    this.updateHud();
    this.save();
  }

  continueRun() {
    if (this.state !== 'paused') return;
    this.hideOverlay();
    this.state = 'countdown';
    this.countdown = COUNTDOWN;
    this.updateHud();
  }

  restart() {
    if (this.state === 'over' && performance.now() - this.overAt < OVER_LOCK_MS) return;
    this.toReady();
  }

  bindInput() {
    const { root } = this;
    root.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this.sound.unlock();
      if (e.target.closest('button, .pbird-panel')) return;
      e.preventDefault();
      this.flap();
    });
    // 触屏上 pointerdown 还不算“用户操作”，声音要等手指抬起时才能打开
    root.addEventListener('pointerup', () => this.sound.unlock());
    this.refs.pause.addEventListener('click', () => this.pauseRun());
    this.refs.sound.addEventListener('click', () => {
      this.sound.muted = !this.sound.muted;
      this.updateHud();
      this.save();
    });
  }

  setKeyboard(on) {
    if (on) document.addEventListener('keydown', this.onKey);
    else document.removeEventListener('keydown', this.onKey);
  }

  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    if (FLAP_KEYS.has(e.key)) {
      e.preventDefault();
      if (e.repeat) return;
      this.sound.unlock();
      if (this.state === 'paused') this.continueRun();
      else if (this.state === 'over') this.restart();
      else this.flap();
    } else if (e.key === 'p' || e.key === 'P') {
      if (this.state === 'paused') this.continueRun();
      else this.pauseRun();
    }
  }

  // ---------- 每一帧 ----------

  setLoop(on) {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!on) return;
    this.lastFrame = performance.now();
    this.acc = 0;
    this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.raf = requestAnimationFrame(this.frame);
    this.acc += Math.min(0.1, Math.max(0, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    // 60 Hz 一帧正好两步，但帧间隔有 1 毫秒左右的抖动（Safari 的时间戳按毫秒取整），
    // 按 floor 算会一帧走 1 步、下一帧走 3 步，画面一顿一顿。离整数步很近时就按整数步走，差的一点留给下一帧
    const exact = this.acc / STEP;
    const steps = Math.abs(exact - Math.round(exact)) < 0.25 ? Math.round(exact) : Math.floor(exact);
    for (let i = 0; i < steps; i++) this.update(STEP);
    this.acc -= steps * STEP;
    this.draw();
  }

  update(dt) {
    this.time += dt;
    this.themeT = Math.min(1, this.themeT + dt / THEME_FADE);
    this.flash = Math.max(0, this.flash - dt);
    this.shake = Math.max(0, this.shake - dt);

    switch (this.state) {
      case 'ready':
        this.dist += SPEED * dt;
        this.bird.y = READY_Y + Math.sin(this.time * 7) * 3;
        break;
      case 'playing':
        this.dist += SPEED * dt;
        this.fly(dt);
        this.updatePipes();
        this.checkHits();
        break;
      case 'countdown':
        this.countdown -= dt;
        if (this.countdown <= 0) {
          this.state = 'playing';
          this.updateHud();
        }
        break;
      case 'dying':
        this.fall(dt);
        break;
      default:
        break;
    }
  }

  fly(dt) {
    const { bird } = this;
    bird.vy = Math.min(MAX_FALL, bird.vy + GRAVITY * dt);
    bird.y += bird.vy * dt;
    if (bird.y < CEILING) {
      bird.y = CEILING;
      bird.vy = 0;
    }
    // 扑翅膀后先抬头，开始往下掉时再慢慢低头
    if (bird.vy > 90) bird.rot = Math.min(DIVE, bird.rot + 5 * dt);
  }

  updatePipes() {
    while (this.nextPipeAt <= this.dist + this.W + 8) {
      const gap = gapFor(this.score);
      const lo = 28 + gap / 2;
      const hi = GROUND_Y - 24 - gap / 2;
      let gapY = lo + Math.random() * (hi - lo);
      // 相邻两个缝隙高低差不能太大，不然来不及飞过去
      if (this.lastGapY !== null) gapY = clamp(gapY, this.lastGapY - 64, this.lastGapY + 64);
      gapY = Math.round(gapY);
      this.pipes.push({ wx: this.nextPipeAt, gapY, gap, scored: false });
      this.lastGapY = gapY;
      this.nextPipeAt += PIPE_SPACING;
    }
    for (const pipe of this.pipes) {
      if (!pipe.scored && pipe.wx + PIPE_W / 2 <= this.dist + BIRD_X) {
        pipe.scored = true;
        this.addPoint();
      }
    }
    this.pipes = this.pipes.filter((pipe) => pipe.wx + PIPE_W + 4 > this.dist);
  }

  addPoint() {
    this.score += 1;
    this.best = this.ctx.submitRecord('score', this.score);
    this.sound.point();
    this.setTheme(Math.floor(this.score / THEME_EVERY) % THEMES.length);
  }

  checkHits() {
    const { bird } = this;
    if (bird.y + BIRD_R >= GROUND_Y) {
      bird.y = GROUND_Y - BIRD_R;
      this.crash(true);
      return;
    }
    for (const pipe of this.pipes) {
      const x = pipe.wx - this.dist;
      if (x > BIRD_X + 16 || x + PIPE_W < BIRD_X - 16) continue;
      const top = pipe.gapY - pipe.gap / 2;
      const bottom = pipe.gapY + pipe.gap / 2;
      const hit = [
        [x, top - CAP_H - 1000, PIPE_W, 1000],
        [x - 2, top - CAP_H, PIPE_W + 4, CAP_H],
        [x - 2, bottom, PIPE_W + 4, CAP_H],
        [x, bottom + CAP_H, PIPE_W, GROUND_Y],
      ].some(([rx, ry, rw, rh]) => circleHitsRect(BIRD_X, bird.y, BIRD_R, rx, ry, rw, rh));
      if (hit) {
        this.crash(false);
        return;
      }
    }
  }

  crash(onGround) {
    this.state = 'dying';
    this.landed = onGround;
    this.dieTimer = 0;
    this.bird.vy = onGround ? 0 : Math.max(0, this.bird.vy);
    this.flash = 0.25;
    this.shake = this.reduceMotion ? 0 : 0.22;
    this.sound.hit();
    if (!onGround) this.sound.fall();
    this.last = this.score;
    this.updateHud();
    this.save();
  }

  // 撞上以后小鸟头朝下掉到地上，停一会儿再出结算面板
  fall(dt) {
    const { bird } = this;
    if (!this.landed) {
      bird.vy = Math.min(MAX_FALL * 1.4, bird.vy + GRAVITY * dt);
      bird.y += bird.vy * dt;
      bird.rot = Math.min(DIVE, bird.rot + 8 * dt);
      if (bird.y + 8 >= GROUND_Y) {
        bird.y = GROUND_Y - 8;
        this.landed = true;
      }
      return;
    }
    this.dieTimer += dt;
    if (this.dieTimer >= 0.5) this.showOver();
  }

  // ---------- 画面 ----------

  setCanvasWidth(w) {
    this.W = w;
    this.refs.canvas.width = w;
    this.g = this.refs.canvas.getContext('2d');
    this.g.imageSmoothingEnabled = false;
  }

  // 高度固定 256，宽度按可用区域的比例算，整张画面再等比放大
  fit({ width, height }) {
    if (!width || !height) return;
    const w = clamp(Math.round((H * width) / height), MIN_W, MAX_W);
    if (w !== this.W) this.setCanvasWidth(w);
    const scale = Math.min(width / w, height / H);
    this.refs.screen.style.width = `${Math.floor(w * scale)}px`;
    this.refs.screen.style.height = `${Math.floor(H * scale)}px`;
    this.draw();
  }

  draw() {
    const { g, W } = this;
    g.save();
    if (this.shake > 0) {
      g.translate(Math.round((Math.random() - 0.5) * 4), Math.round((Math.random() - 0.5) * 4));
    }
    if (this.themeT < 1) {
      this.drawScenery(this.themeFrom, 1);
      this.drawScenery(this.theme, this.themeT);
    } else {
      this.drawScenery(this.theme, 1);
    }

    const scroll = Math.round(this.dist);
    const tint = this.tint();
    for (const pipe of this.pipes) this.drawPipe(pipe.wx - scroll, pipe, tint);
    g.drawImage(this.art.ground, -(scroll % 8), GROUND_Y);
    if (tint) {
      g.fillStyle = tint;
      g.fillRect(0, GROUND_Y, W, H - GROUND_Y);
    }

    this.drawBird();
    if (['playing', 'countdown', 'dying', 'paused'].includes(this.state)) this.drawNumber(this.score, this.art.digits, 18);
    if (this.state === 'countdown') {
      this.drawNumber(Math.ceil(this.countdown / (COUNTDOWN / 3)), this.art.bigDigits, 92);
    }
    g.restore();

    if (this.flash > 0) {
      g.fillStyle = `rgba(255, 255, 255, ${(this.flash / 0.25) * 0.85})`;
      g.fillRect(0, 0, W, H);
    }
  }

  drawScenery(index, alpha) {
    const { g, W } = this;
    const layers = this.art.scenery[index];
    g.globalAlpha = alpha;
    g.drawImage(layers.sky, 0, 0);
    for (const [layer, period, speed] of [[layers.clouds, CLOUD_P, 0.12], [layers.city, CITY_P, 0.25], [layers.bushes, BUSH_P, 0.5]]) {
      for (let x = -(Math.floor(this.dist * speed) % period); x < W; x += period) g.drawImage(layer, x, 0);
    }
    g.globalAlpha = 1;
  }

  tint() {
    const from = THEMES[this.themeFrom].tint;
    const to = THEMES[this.theme].tint;
    const t = this.themeT;
    const [r, gr, b, a] = from.map((v, i) => v + (to[i] - v) * t);
    return a > 0.01 ? `rgba(${Math.round(r)}, ${Math.round(gr)}, ${Math.round(b)}, ${a.toFixed(3)})` : null;
  }

  drawPipe(x, pipe, tint) {
    const { g } = this;
    if (x > this.W + 4 || x + PIPE_W + 4 < 0) return;
    const top = Math.round(pipe.gapY - pipe.gap / 2);
    const bottom = Math.round(pipe.gapY + pipe.gap / 2);
    const rects = [
      [x, 0, PIPE_W, top - CAP_H],
      [x - 2, top - CAP_H, PIPE_W + 4, CAP_H],
      [x - 2, bottom, PIPE_W + 4, CAP_H],
      [x, bottom + CAP_H, PIPE_W, GROUND_Y - bottom - CAP_H],
    ];
    rects.forEach(([rx, ry, rw, rh], i) => {
      if (rh <= 0) return;
      if (i % 3 === 0) g.drawImage(this.art.pipeBody, rx, ry, rw, rh);
      else g.drawImage(this.art.pipeCap, rx, ry);
    });
    if (tint) {
      g.fillStyle = tint;
      for (const [rx, ry, rw, rh] of rects) if (rh > 0) g.fillRect(rx, ry, rw, rh);
    }
  }

  drawBird() {
    const { g, bird } = this;
    // 低头俯冲或者已经撞上时翅膀不动
    const still = this.state === 'dying' || this.state === 'over' || this.state === 'paused' || bird.rot > 1.1;
    const rate = this.state === 'ready' ? 8 : 14;
    const frame = still ? 1 : FLAP_CYCLE[Math.floor(this.time * rate) % FLAP_CYCLE.length];
    g.save();
    g.translate(BIRD_X, Math.round(bird.y));
    g.rotate(bird.rot);
    g.drawImage(this.art.birds[this.skin][frame], -9, -6);
    g.restore();
  }

  drawNumber(n, font, y) {
    const glyphs = String(n).split('').map((ch) => font[Number(ch)]);
    const advance = glyphs[0].width - 1;
    let x = Math.round((this.W - advance * glyphs.length - 1) / 2);
    for (const glyph of glyphs) {
      this.g.drawImage(glyph, x, y);
      x += advance;
    }
  }

  // ---------- 界面 ----------

  updateHud() {
    const { pause, sound, hint } = this.refs;
    pause.hidden = this.state !== 'playing' && this.state !== 'countdown';
    sound.innerHTML = this.sound.muted ? ICONS.muted : ICONS.sound;
    sound.setAttribute('aria-label', this.sound.muted ? '打开声音' : '关闭声音');
    hint.hidden = this.state !== 'ready';
    if (this.state === 'ready') {
      const touch = window.matchMedia('(hover: none)').matches;
      hint.innerHTML = `${touch ? '点屏幕起飞' : '点击画面或按空格起飞'}${this.best ? `<small>最高 ${fmt(this.best)} 分</small>` : ''}`;
    }
  }

  showPanel(html, actions) {
    const { overlay } = this.refs;
    overlay.innerHTML = `<div class="pbird-panel">${html}<div class="pbird-actions"></div></div>`;
    const row = overlay.querySelector('.pbird-actions');
    const buttons = actions.map(({ label, primary, onClick }) => {
      const button = document.createElement('button');
      button.className = primary ? 'pbird-btn is-primary' : 'pbird-btn';
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

  showPause() {
    this.showPanel(`<h3>已暂停</h3><p>现在 ${fmt(this.score)} 分</p>`, [
      { label: '重新开始', onClick: () => this.toReady() },
      { label: '继续', primary: true, onClick: () => this.continueRun() },
    ]);
  }

  showOver() {
    this.state = 'over';
    this.overAt = performance.now();
    const { score, best } = this;
    const record = this.bestBefore > 0 && score > this.bestBefore;
    const medal = MEDALS.find((m) => score >= m.min);
    const next = [...MEDALS].reverse().find((m) => score < m.min);
    let note = `拿到${medal?.name}牌，太厉害了`;
    if (!medal) note = `再得 ${fmt(next.min - score)} 分就能拿${next.name}牌`;
    else if (next) note = `拿到${medal.name}牌，再得 ${fmt(next.min - score)} 分升${next.name}牌`;

    const buttons = this.showPanel(`
      ${medal ? '<div class="pbird-medal"></div>' : ''}
      <h3>${record ? '新纪录！' : '游戏结束'}</h3>
      <p>${note}</p>
      <div class="pbird-stats">
        <div class="pbird-stat"><span>得分</span><strong>${fmt(score)}</strong></div>
        <div class="pbird-stat"><span>最高</span><strong>${fmt(best)}</strong></div>
      </div>`, [{ label: '再来一局', primary: true, onClick: () => this.restart() }]);
    if (medal) this.refs.overlay.querySelector('.pbird-medal').append(medalSprite(medal));

    buttons.forEach((button) => {
      button.disabled = true;
    });
    clearTimeout(this.overTimer);
    this.overTimer = setTimeout(() => buttons.forEach((button) => {
      button.disabled = false;
    }), OVER_LOCK_MS);
    this.updateHud();
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
    this.sound.close();
  }
}

export default {
  async mount(root, ctx) {
    await loadStyles();
    const game = new Game(root, ctx);
    return {
      pause: () => game.pause(),
      resume: () => game.resume(),
      destroy: () => game.destroy(),
    };
  },
};
