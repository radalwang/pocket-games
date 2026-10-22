// 华容道：在 4×5 的棋盘上挪动棋子，让曹操从最下面中间的出口逃出去。
// 按住棋子拖动（路上可以拐弯），或者点一下只有一个方向能走的棋子；同一个棋子连着走只算一步。
// 规则和求解在 rules.js，关卡在 levels.js。接口说明见 js/player.js。

import { cellAt, COLS, DIRS, isSolved, occupancy, parseLayout, reachable, routeTo, ROWS, solve } from './rules.js';
import { getLevel, LEVELS } from './levels.js';

const MOVE_TOLERANCE = 6;
const SNAP = 0.4; // 松手时朝下一格走过了四成，就算走到下一格
const NOTE_MS = 2200;

const RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';
const UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>';

// 棋子的颜色：曹操和五员大将各一组双色渐变（左上 → 右下），和首页封面、2048 的方块是同一种画法。
// 棋盘上的棋子、选关缩略图和玩法介绍的插图都用这里的颜色；兵是中性色，跟着深浅模式变（见 style.css）。
// 每关正好五员大将（rules.js 按顺序起名），所以同一关里不会有两员大将同色
const COLORS = {
  cao: ['#ff6a3d', '#ff2d6f'],
  guan: ['#30d158', '#0a8f6a'],
  zhang: ['#5e5ce6', '#2b2f9e'],
  zhao: ['#5ac8fa', '#1f6fd1'],
  ma: ['#bf5af2', '#7a2fc7'],
  huang: ['#ffb547', '#e0702a'],
};
const ROLES = { 曹操: 'cao', 关羽: 'guan', 张飞: 'zhang', 赵云: 'zhao', 马超: 'ma', 黄忠: 'huang' };
const colorOf = (piece) => ROLES[piece.name] ?? 'bing';

// ---------- 用 SVG 画的小棋盘：选关缩略图和玩法介绍的插图 ----------

const FAMILY = 'font-family="ui-rounded, \'SF Pro Rounded\', -apple-system, system-ui, sans-serif" dominant-baseline="central"';
const FONT = `${FAMILY} text-anchor="middle"`;

// 一张图里要用的渐变。id 是名字前缀，同一页上的几张图不能重名；bing 是兵的两个颜色
function gradients(id, bing) {
  const linear = Object.entries({ ...COLORS, bing })
    .map(([key, [a, b]]) => `<linearGradient id="${id}-${key}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" style="stop-color:${a}"/><stop offset="1" style="stop-color:${b}"/></linearGradient>`)
    .join('');
  return `<defs>${linear}<radialGradient id="${id}-shine" cx="0.85" cy="0.12" r="0.67"><stop offset="0" stop-color="#fff" stop-opacity="0.38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>`;
}

// 按布局画棋子：(x, y) 是棋盘左上角，unit 是一格多大，gap 是棋子之间的缝；outline 是兵的描边，浅色的兵放在浅色卡片上也看得出边
function pieceRects(pieces, id, { x = 0, y = 0, unit, gap, rx, outline }) {
  return pieces
    .map((p) => {
      const box = `x="${x + p.c * unit + gap / 2}" y="${y + p.r * unit + gap / 2}" width="${p.w * unit - gap}" height="${p.h * unit - gap}" rx="${rx}"`;
      const stroke = outline && p.kind === 'bing' ? ` style="stroke:${outline}" stroke-width="0.8"` : '';
      return `<rect ${box} fill="url(#${id}-${colorOf(p)})"${stroke}/><rect ${box} fill="url(#${id}-shine)"/>`;
    })
    .join('');
}

// 选关列表里的小棋盘，棋盘和兵的颜色跟着深浅模式走（见 style.css）
function preview(level) {
  const id = `hrd-pv-${level.id}`;
  const pieces = pieceRects(parseLayout(level.layout), id, { unit: 10, gap: 1.4, rx: 2.2 });
  return `<svg viewBox="0 0 40 50" aria-hidden="true">${gradients(id, ['var(--hrd-bing-a)', 'var(--hrd-bing-b)'])}<rect width="40" height="50" rx="3.5" style="fill:var(--hrd-board)"/>${pieces}</svg>`;
}

// 玩法介绍里的棋盘（或者棋盘的一角）。介绍卡片在深浅模式下底色不同，所以棋盘、边框和兵用外壳的中性色，曹操和大将的颜色不变。
// exit 为真时画整个棋盘：边框绕一圈，底边中间留出出口，口子里一道强调色，和游戏里一样
function sketch(id, layout, { x, y, unit, exit = false }) {
  const pieces = parseLayout(layout);
  const w = layout[0].length * unit;
  const h = layout.length * unit;
  let out = gradients(id, ['var(--cell)', 'var(--cell)']);
  out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" style="fill:var(--fill)"/>`;
  if (exit) {
    const [x0, y0, x1, y1, r] = [x - 2.5, y - 2.5, x + w + 2.5, y + h + 2.5, 9.5];
    const left = x + w / 4 + 2;
    const right = x + (w * 3) / 4 - 2;
    out += `<path d="M${right} ${y1}H${x1 - r}A${r} ${r} 0 0 0 ${x1} ${y1 - r}V${y0 + r}A${r} ${r} 0 0 0 ${x1 - r} ${y0}H${x0 + r}A${r} ${r} 0 0 0 ${x0} ${y0 + r}V${y1 - r}A${r} ${r} 0 0 0 ${x0 + r} ${y1}H${left}" fill="none" style="stroke:var(--fill-2)" stroke-width="5"/>`;
    out += `<path d="M${left + 4} ${y1}H${right - 4}" style="stroke:var(--accent)" stroke-width="2.5" stroke-linecap="round"/>`;
  }
  out += pieceRects(pieces, id, { x, y, unit, gap: 3, rx: unit * 0.17, outline: 'var(--label-3)' });
  const cao = pieces.find((p) => p.kind === 'cao');
  if (cao) out += `<text x="${x + (cao.c + 1) * unit}" y="${y + (cao.r + 1) * unit}" font-size="${unit * 0.5}" font-weight="700" fill="#fff" ${FONT}>曹操</text>`;
  return out;
}

// 手指点的位置：半透明的白圈
const tapAt = (x, y) => `<circle cx="${x}" cy="${y}" r="14" fill="#fff" fill-opacity="0.7" stroke="#000" stroke-opacity="0.15" stroke-width="1.5"/>`;

// 箭头：d 是箭杆，(tx, ty) 是箭尖，(dx, dy) 是箭尖朝的方向
function arrow(d, [tx, ty], [dx, dy], color = 'var(--label-2)') {
  const head = `M${tx - dx * 6 - dy * 5} ${ty - dy * 6 + dx * 5}L${tx} ${ty}L${tx - dx * 6 + dy * 5} ${ty - dy * 6 - dx * 5}`;
  return `<path d="${d} ${head}" fill="none" style="stroke:${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// 棋子要去的地方：一个虚线框
const ghost = (x, y, w, h, rx) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" style="stroke:var(--label-2)" stroke-width="1.5" stroke-dasharray="4 3"/>`;

const art = (body) => `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

// 顶栏的计数和底栏的按钮，画在第三、四步的插图里
const chip = (x, y, w, h, label, value) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" style="fill:var(--fill)"/>
  <text x="${x + w / 2}" y="${y + h * 0.3}" font-size="${h > 50 ? 11 : 9.5}" font-weight="600" style="fill:var(--label-2)" ${FONT}>${label}</text>
  <text x="${x + w / 2}" y="${y + h * 0.68}" font-size="${h * 0.4}" font-weight="700" style="fill:var(--label)" ${FONT}>${value}</text>`;
const tool = (x, icon, label) => `<rect x="${x}" y="84" width="48" height="52" rx="12" style="fill:var(--fill)"/>
  ${icon.replace('<svg ', `<svg x="${x + 14}" y="92" width="20" height="20" style="color:var(--label)" `)}
  <text x="${x + 24}" y="124" font-size="10" font-weight="600" style="fill:var(--label)" ${FONT}>${label}</text>`;

// 玩法介绍：外壳第一次打开游戏时自动弹出，标题栏的“?”也能打开。插图里渐变的名字带上 hrd-步骤号，免得和别的图重名
const GUIDE = [
  {
    title: '帮曹操脱身',
    text: '把最大的那块曹操挪到棋盘底部正中，他就能从出口逃走啦。',
    art: art(`${sketch('hrd-1', ['AEED', 'AKLD', 'G..H', 'GBBH', 'IBBJ'], { x: 102, y: 8, unit: 24, exit: true })}
      ${arrow('M150 137V148', [150, 150], [0, 1], 'var(--accent)')}
      <text x="150" y="161" font-size="11" font-weight="600" letter-spacing="2" style="fill:var(--accent)" ${FONT}>出口</text>`),
  },
  {
    title: '拖着棋子走',
    text: '按住棋子拖进空格，路上还能拐弯。棋子只能滑，不能跳过别的棋子。',
    art: art(`${sketch('hrd-2', ['ABBC', 'ADDC', 'E..F'], { x: 82, y: 34, unit: 34 })}
      ${ghost(117.5, 103.5, 65, 31, 5.8)}
      ${tapAt(150, 85)}
      ${arrow('M150 101V122', [150, 124], [0, 1])}`),
  },
  {
    title: '怎么算步数',
    text: '同一个棋子连着走只算一步。每关都标着最少步数，看你能不能追平。',
    art: art(`${sketch('hrd-3', ['S.B', 'C.B', 'CDD'], { x: 34, y: 37, unit: 32 })}
      ${ghost(67.5, 70.5, 29, 29, 5.4)}
      ${arrow('M50 53H76Q82 53 82 59V80', [82, 82], [0, 1])}
      ${chip(156, 58, 56, 54, '步数', 1)}
      ${chip(222, 58, 56, 54, '最少', 81)}`),
  },
  {
    title: '撤销与提示',
    text: '走错了就撤销或重来，卡住了点提示替你走一步。点上方的关卡名换关，每关最好成绩都记着。',
    art: art(`${sketch('hrd-4', LEVELS.find((level) => level.id === 'hengdao').layout, { x: 30, y: 34, unit: 18, exit: true })}
      <rect x="64.5" y="86.5" width="21" height="21" rx="5.5" fill="none" style="stroke:var(--accent)" stroke-width="2"/>
      <rect x="122" y="26" width="96" height="44" rx="12" style="fill:var(--fill)"/>
      <text x="133" y="39" font-size="9.5" font-weight="500" style="fill:var(--label-2)" ${FAMILY}>第 9 关</text>
      <text x="133" y="56" font-size="14" font-weight="700" style="fill:var(--label)" ${FAMILY}>横刀立马</text>
      <path d="M199 45.5l4.5 4.5 4.5-4.5" fill="none" style="stroke:var(--label-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${chip(224, 26, 54, 44, '最好', 85)}
      ${tool(122, UNDO, '撤销')}${tool(176, RESTART, '重来')}${tool(230, BULB, '提示')}
      ${tapAt(254, 104)}`),
  },
];

const TEMPLATE = `
  <div class="hrd">
    <div class="hrd-top">
      <button class="hrd-level" data-ref="levelButton">
        <span class="hrd-level-text"><small data-ref="levelNo"></small><strong data-ref="levelName"></strong></span>
        ${CHEVRON}
      </button>
      <div class="hrd-stat"><span>步数</span><strong data-ref="steps">0</strong></div>
      <div class="hrd-stat"><span>最好</span><strong data-ref="best">–</strong></div>
    </div>
    <div class="hrd-picker" data-ref="picker" hidden></div>
    <div class="hrd-stage" data-ref="stage">
      <div class="hrd-frame">
        <div class="hrd-exit"></div>
        <div class="hrd-board" data-ref="board"><div class="hrd-pieces" data-ref="pieces"></div></div>
      </div>
      <p class="hrd-note" data-ref="note"></p>
    </div>
    <div class="hrd-bottom" data-ref="bottom">
      <div class="hrd-tools" data-ref="tools">
        <button data-action="undo" data-ref="undo">${UNDO}<span>撤销</span></button>
        <button data-action="restart">${RESTART}<span>重来</span></button>
        <button data-action="hint">${BULB}<span>提示</span></button>
      </div>
      <div class="hrd-result" data-ref="result">
        <span data-ref="resultText"></span>
        <button class="hrd-next" data-ref="next">下一关</button>
      </div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="huarongdao"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'huarongdao';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

// 存档里的棋子都要在棋盘内，而且不能叠在一起；记下的每一步也要指着有的棋子，起点在棋盘内
function isValidSave(saved) {
  const level = getLevel(saved?.level);
  if (!level || !Array.isArray(saved.positions) || !Array.isArray(saved.history)) return false;
  const pieces = parseLayout(level.layout);
  const { positions, history } = saved;
  const isSpot = (pos) => Array.isArray(pos) && pos.length === 2 && pos.every(Number.isInteger);
  const inside = (p, [r, c]) => r >= 0 && c >= 0 && r + p.h <= ROWS && c + p.w <= COLS;
  if (positions.length !== pieces.length || !positions.every(isSpot) || !pieces.every((p, id) => inside(p, positions[id]))) return false;
  const stepOk = (step) => Number.isInteger(step?.id) && step.id >= 0 && step.id < pieces.length && isSpot(step.from) && inside(pieces[step.id], step.from);
  if (!history.every(stepOk)) return false;
  positions.forEach(([r, c], id) => Object.assign(pieces[id], { r, c }));
  const area = pieces.reduce((sum, p) => sum + p.w * p.h, 0);
  return occupancy(pieces).filter((id) => id >= 0).length === area;
}

// ---------- 拖动 ----------
// 棋子跟着手指走，但只能沿着走得通的格子滑。drag.at 是最近停靠的格位，drag.dir 是正在往哪边走，drag.t 是走了几成。
// 刚起步（不到三成）时可以换方向；走到下一格以后可以接着走或者拐弯。

function follow(drag, tr, tc) {
  for (let guard = 0; guard < 12; guard++) {
    const { at } = drag;
    const dr = tr - at.r;
    const dc = tc - at.c;
    if (!drag.dir || drag.t < 0.3) {
      let best = null;
      let bestScore = 0;
      for (const dir of DIRS) {
        if (!drag.spots.has(cellAt(at.r + dir[0], at.c + dir[1]))) continue;
        // 稍微偏向原来的方向，免得手指斜着走时在两个方向之间来回跳
        const score = dr * dir[0] + dc * dir[1] + (dir === drag.dir ? 0.1 : 0);
        if (score > bestScore) {
          best = dir;
          bestScore = score;
        }
      }
      drag.dir = best;
    }
    if (!drag.dir) {
      drag.t = 0;
      return;
    }
    const t = dr * drag.dir[0] + dc * drag.dir[1];
    // 快到下一格、手指又明显偏向旁边时，也当作到了下一格，好接着拐弯
    const aside = Math.abs(dr * drag.dir[1]) + Math.abs(dc * drag.dir[0]);
    if (t < 1 && !(t > 0.75 && aside > 0.5)) {
      drag.t = Math.max(0, t);
      return;
    }
    drag.at = { r: at.r + drag.dir[0], c: at.c + drag.dir[1] };
    drag.dir = null;
    drag.t = 0;
  }
}

const dragPosition = ({ at, dir, t }) => (dir ? [at.r + dir[0] * t, at.c + dir[1] * t] : [at.r, at.c]);

class Huarongdao {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.noteTimer = 0;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });

    const { levelButton, picker, tools, next } = this.refs;
    levelButton.addEventListener('click', () => this.togglePicker());
    picker.addEventListener('click', (e) => {
      const card = e.target.closest('[data-level]');
      if (card) this.chooseLevel(card.dataset.level);
    });
    tools.addEventListener('click', (e) => {
      const action = e.target.closest('[data-action]')?.dataset.action;
      if (action === 'undo') this.undo();
      else if (action === 'restart') this.restart();
      else if (action === 'hint') this.hint();
    });
    next.addEventListener('click', () => this.nextLevel());
    this.bindBoard();

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.start((LEVELS.find((level) => !this.records[level.id]) ?? LEVELS[0]).id);
  }

  get inProgress() {
    return this.status === 'playing' && this.history.length > 0;
  }

  // ---------- 开局与存档 ----------

  start(levelId) {
    this.level = getLevel(levelId);
    this.pieces = parseLayout(this.level.layout);
    this.history = []; // 每一步：{ id, from: [r, c] }，撤销时把棋子送回 from
    this.status = 'playing';
    this.record = null;
    this.render({ enter: true });
    this.updateChrome();
    this.save();
  }

  restore(saved) {
    this.level = getLevel(saved.level);
    this.pieces = parseLayout(this.level.layout);
    saved.positions.forEach(([r, c], id) => Object.assign(this.pieces[id], { r, c }));
    this.history = saved.history;
    this.status = saved.status === 'won' ? 'won' : 'playing';
    this.record = saved.record ?? null;
    this.render();
    this.updateChrome();
  }

  save() {
    const state = {
      level: this.level.id,
      positions: this.pieces.map((p) => [p.r, p.c]),
      history: this.history,
      status: this.status,
      record: this.record,
    };
    this.ctx.save(state, { summary: this.summary(), finished: this.status === 'won' });
  }

  summary() {
    const steps = this.history.length;
    if (this.status === 'won') return `${this.level.name} · ${steps} 步过关`;
    if (!steps) return `${this.level.name} · 新的一局`;
    return `${this.level.name} · 已走 ${steps} 步`;
  }

  // ---------- 选关 ----------

  togglePicker(open = this.refs.picker.hidden) {
    const { picker, stage, bottom, levelButton } = this.refs;
    if (open) this.renderPicker();
    picker.hidden = !open;
    stage.hidden = open;
    bottom.hidden = open;
    levelButton.classList.toggle('is-open', open);
  }

  renderPicker() {
    this.refs.picker.innerHTML = LEVELS.map((level, k) => {
      const best = this.records[level.id];
      const meta = best ? `<span class="hrd-card-meta is-done">最好 ${best} 步</span>` : `<span class="hrd-card-meta">最少 ${level.min} 步</span>`;
      return `
        <button class="hrd-card${level === this.level ? ' is-current' : ''}" data-level="${level.id}">
          ${preview(level)}
          <span class="hrd-card-text"><small>第 ${k + 1} 关</small><strong>${level.name}</strong>${meta}</span>
        </button>`;
    }).join('');
  }

  chooseLevel(id) {
    if (id === this.level.id && this.status === 'playing') {
      this.togglePicker(false);
      return;
    }
    if (this.inProgress && !window.confirm('换关会放弃这一关已经走的步数，确定吗？')) return;
    this.togglePicker(false);
    this.start(id);
  }

  nextLevel() {
    const k = LEVELS.indexOf(this.level);
    this.start(LEVELS[(k + 1) % LEVELS.length].id);
  }

  restart() {
    if (this.inProgress && !window.confirm('重来会清空这一关已经走的步数，确定吗？')) return;
    this.start(this.level.id);
  }

  // ---------- 走棋 ----------

  // 把棋子挪到 (r, c)；route 是画面上要经过的位置，第一项是现在看到的位置
  moveTo(id, r, c, route) {
    const piece = this.pieces[id];
    const last = this.history.at(-1);
    if (last?.id === id) {
      // 同一个棋子接着走，还算同一步；走回这一步的起点，这一步就不算了
      if (last.from[0] === r && last.from[1] === c) this.history.pop();
    } else {
      this.history.push({ id, from: [piece.r, piece.c] });
    }
    piece.r = r;
    piece.c = c;
    this.place(id);
    this.animate(id, route);
    if (isSolved(this.pieces)) this.win();
    this.updateChrome();
    this.save();
  }

  // 点一下：只有一个方向能走时走一格，否则晃一下
  tap(id) {
    const piece = this.pieces[id];
    const spots = reachable(this.pieces, id);
    const options = DIRS.map(([dr, dc]) => spots.get(cellAt(piece.r + dr, piece.c + dc))).filter(Boolean);
    if (options.length !== 1) {
      this.wiggle(id, 'nudge');
      return;
    }
    const [{ r, c }] = options;
    this.moveTo(id, r, c, [[piece.r, piece.c], [r, c]]);
  }

  undo() {
    const last = this.status === 'playing' && this.history.pop();
    if (!last) return;
    const piece = this.pieces[last.id];
    const spots = piece && Array.isArray(last.from) && reachable(this.pieces, last.id);
    // 存档里的步子和棋盘对不上（比如关卡布局改过），这一步退不回去：剩下的步子都不要了，免得把棋子挪到别的棋子上
    if (!spots || !spots.has(cellAt(...last.from))) {
      this.history = [];
      this.updateChrome();
      this.save();
      return;
    }
    const route = routeTo(spots, ...last.from);
    [piece.r, piece.c] = last.from;
    this.place(last.id);
    this.animate(last.id, route);
    this.updateChrome();
    this.save();
  }

  // 提示：按最少步数的走法替你走一步
  hint() {
    if (this.status !== 'playing') return;
    const moves = solve(this.pieces);
    if (!moves?.length) return;
    const [{ id, r, c }] = moves;
    this.moveTo(id, r, c, routeTo(reachable(this.pieces, id), r, c));
    this.wiggle(id, 'is-hinted');
    if (moves.length > 1) this.showNote(`照这样走，最少还要 ${moves.length - 1} 步`);
  }

  win() {
    this.status = 'won';
    const steps = this.history.length;
    const previous = this.records[this.level.id];
    this.records[this.level.id] = this.ctx.submitRecord(this.level.id, steps, { lowerIsBetter: true });
    this.record = previous === undefined ? 'first' : steps < previous ? 'best' : null;
    this.refs.note.classList.remove('is-visible');
    // 告诉外壳这一关过了，破了纪录的话外壳会弹出「新纪录！」
    this.ctx.runEnded?.();
  }

  bindBoard() {
    const { pieces: layer } = this.refs;
    let drag = null;

    layer.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.hrd-piece');
      if (drag || !el || e.button !== 0 || this.status !== 'playing') return;
      const id = Number(el.dataset.id);
      const { r, c } = this.pieces[id];
      const rect = layer.getBoundingClientRect();
      el.getAnimations().forEach((animation) => animation.cancel());
      drag = {
        id,
        el,
        pointerId: e.pointerId,
        x: e.clientX,
        y: e.clientY,
        unitX: rect.width / COLS,
        unitY: rect.height / ROWS,
        spots: reachable(this.pieces, id),
        at: { r, c },
        dir: null,
        t: 0,
        moved: false,
      };
      layer.setPointerCapture(e.pointerId);
      el.classList.add('is-held');
    });

    const track = (e) => {
      const dx = e.clientX - drag.x;
      const dy = e.clientY - drag.y;
      if (!drag.moved) {
        if (Math.hypot(dx, dy) < MOVE_TOLERANCE) return;
        drag.moved = true;
        drag.el.classList.add('is-dragging');
      }
      const piece = this.pieces[drag.id];
      follow(drag, piece.r + dy / drag.unitY, piece.c + dx / drag.unitX);
      const [r, c] = dragPosition(drag);
      drag.el.style.setProperty('--r', r);
      drag.el.style.setProperty('--c', c);
    };

    layer.addEventListener('pointermove', (e) => {
      if (drag && e.pointerId === drag.pointerId) track(e);
    });

    const end = (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      // 手指抬起的位置也要算上，快速划动时最后一次 pointermove 可能还没到
      track(e);
      const { id, el, moved, at, dir, t } = drag;
      const shown = dragPosition(drag);
      drag = null;
      el.classList.remove('is-held', 'is-dragging');
      if (!moved) {
        this.tap(id);
        return;
      }
      const piece = this.pieces[id];
      const target = dir && t >= SNAP ? { r: at.r + dir[0], c: at.c + dir[1] } : at;
      if (target.r === piece.r && target.c === piece.c) {
        this.place(id);
        this.animate(id, [shown, [piece.r, piece.c]]);
      } else {
        this.moveTo(id, target.r, target.c, [shown, [target.r, target.c]]);
      }
    };
    layer.addEventListener('pointerup', end);

    // 被系统打断（来电、切到后台）或者游戏页收起时，这次拖动作废：棋子回到拖动前的位置，不算一步
    this.cancelDrag = () => {
      if (!drag) return;
      const { id, el } = drag;
      const shown = dragPosition(drag);
      drag = null;
      el.classList.remove('is-held', 'is-dragging');
      const { r, c } = this.pieces[id];
      this.place(id);
      this.animate(id, [shown, [r, c]]);
    };
    layer.addEventListener('pointercancel', (e) => {
      if (drag && e.pointerId === drag.pointerId) this.cancelDrag();
    });
  }

  // ---------- 画面 ----------

  render({ enter = false } = {}) {
    this.els = this.pieces.map((p, id) => {
      const el = document.createElement('div');
      const color = colorOf(p);
      el.className = `hrd-piece k-${color}${p.h > p.w ? ' is-tall' : ''}`;
      el.dataset.id = id;
      el.style.setProperty('--w', p.w);
      el.style.setProperty('--h', p.h);
      // 兵的颜色写在 style.css 里（深色模式要换），其余棋子用 COLORS
      if (COLORS[color]) {
        el.style.setProperty('--a', COLORS[color][0]);
        el.style.setProperty('--b', COLORS[color][1]);
      }
      el.innerHTML = `<div class="hrd-face"><span>${p.name}</span></div>`;
      if (enter) {
        el.classList.add('enter');
        el.style.setProperty('--d', `${id * 28}ms`);
        el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
      }
      return el;
    });
    this.els.forEach((_, id) => this.place(id));
    this.refs.pieces.replaceChildren(...this.els);
  }

  place(id) {
    const { r, c } = this.pieces[id];
    this.els[id].style.setProperty('--r', r);
    this.els[id].style.setProperty('--c', c);
  }

  // 沿着 points（[[r, c], ...]）把棋子滑过去，拐弯的路线会先走直线再拐
  animate(id, points) {
    const el = this.els[id];
    el.getAnimations().forEach((animation) => animation.cancel());
    const lengths = points.slice(1).map(([r, c], k) => Math.hypot(r - points[k][0], c - points[k][1]));
    const total = lengths.reduce((sum, length) => sum + length, 0);
    if (!total) return;
    let run = 0;
    const frames = points.map(([r, c], k) => {
      if (k) run += lengths[k - 1];
      return { left: `${c * (100 / COLS)}%`, top: `${r * (100 / ROWS)}%`, offset: run / total };
    });
    el.animate(frames, { duration: Math.min(80 + total * 80, 380), easing: 'cubic-bezier(0.2, 0.8, 0.3, 1)' });
  }

  // 给棋子加一个一次性的动画：nudge 是走不了时晃一下，is-hinted 是提示时亮一下
  wiggle(id, name) {
    const el = this.els[id];
    el.classList.remove(name);
    void el.offsetWidth;
    el.classList.add(name);
    el.firstElementChild.addEventListener('animationend', () => el.classList.remove(name), { once: true });
  }

  showNote(text) {
    const { note } = this.refs;
    note.textContent = text;
    note.classList.add('is-visible');
    clearTimeout(this.noteTimer);
    this.noteTimer = setTimeout(() => note.classList.remove('is-visible'), NOTE_MS);
  }

  resultText() {
    const steps = this.history.length;
    if (steps === this.level.min) return `${steps} 步过关 · 最少步数！`;
    if (this.record === 'best') return `${steps} 步过关 · 新纪录！`;
    const best = this.records[this.level.id];
    if (this.record === 'first' || !best) return `${steps} 步过关 · 最少 ${this.level.min} 步`;
    return `${steps} 步过关 · 最好 ${best} 步`;
  }

  updateChrome() {
    const { levelNo, levelName, steps, best, tools, result, resultText, next, undo, board } = this.refs;
    const k = LEVELS.indexOf(this.level);
    const won = this.status === 'won';
    levelNo.textContent = `第 ${k + 1} 关 · 最少 ${this.level.min} 步`;
    levelName.textContent = this.level.name;
    steps.textContent = this.history.length;
    best.textContent = this.records[this.level.id] ?? '–';
    undo.disabled = !this.history.length;
    tools.hidden = won;
    result.hidden = !won;
    resultText.textContent = won ? this.resultText() : '';
    next.textContent = k < LEVELS.length - 1 ? '下一关' : '从头再来';
    board.classList.toggle('is-won', won);
  }

  // 收起游戏页或切到后台：正拖着的棋子放回原处
  pause() {
    this.cancelDrag();
  }

  destroy() {
    clearTimeout(this.noteTimer);
  }
}

export default {
  guide: GUIDE,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Huarongdao(root, ctx);
    return { pause: () => game.pause(), destroy: () => game.destroy() };
  },
};
