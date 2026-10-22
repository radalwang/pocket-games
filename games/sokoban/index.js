// 推箱子：把所有箱子都推到圆圈（目标点）上就过关。箱子只能推，不能拉，一次只能推一个。
// 在棋盘上往哪边划，小人就往哪边走一格；点空地，小人自己走过去；点身边的箱子，推它一下。键盘可以用方向键或 WASD，Z 撤销。
// 规则和求解在 rules.js，关卡在 levels.js。接口说明见 js/player.js。

import { DIRS, isSolved, isStuck, parseLevel, replay, rowCol, solvePushes, step, walkPath } from './rules.js';
import { getLevel, LEVELS } from './levels.js';

const STEP_MS = 85; // 自动走路时每走一格的时间
const SWIPE = 18; // 手指移动超过这么多像素算划动，否则算点
const NOTE_MS = 2400;
const KEYS = {
  ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r',
  w: 'u', s: 'd', a: 'l', d: 'r', W: 'u', S: 'd', A: 'l', D: 'r',
};
const FACING = { u: [0, -1], d: [0, 1], l: [-1, 0], r: [1, 0] };

const RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';
const UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6.5 9.5 5.5 5.5 5.5-5.5"/></svg>';

// 墙、箱子和小人的颜色：和首页封面、2048 的方块是同一种双色渐变（左上 → 右下），再叠一层右上角的光泽。
// 棋盘上的箱子、小人写在 style.css 里（颜色和这里一致），这里给墙、选关缩略图和玩法介绍的插图用
const COLORS = {
  wall: ['#6b7896', '#3c4660'],
  box: ['#ffb547', '#ff6a3d'],
  done: ['#30d158', '#0a8f6a'],
  stuck: ['#ff6b6b', '#d63031'],
  player: ['#5ac8fa', '#1f6fd1'],
};
const GOAL = '#ff2d6f';

// ---------- 用 SVG 画的棋盘：游戏里的地面和墙、选关缩略图、玩法介绍的插图 ----------
// 一格是 1 个单位。棋盘底色和地面用 CSS 变量传进来，跟着深浅模式变；墙、箱子和小人颜色固定

// shine 是墙和箱子右上角的光泽（同 CSS 的 circle at 85% 12%），gloss 是小人身上更亮的一块高光（circle at 75% 20%）
function gradients(id) {
  const linear = Object.entries(COLORS)
    .map(([key, [a, b]]) => `<linearGradient id="${id}-${key}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`)
    .join('');
  const radial = (name, cx, cy, r, opacity) => `<radialGradient id="${id}-${name}" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0" stop-color="#fff" stop-opacity="${opacity}"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>`;
  return `<defs>${linear}${radial('shine', 0.85, 0.12, 0.67, 0.28)}${radial('gloss', 0.75, 0.2, 0.55, 0.45)}</defs>`;
}

// 阴影：在图形下面垫一层往下错开一点的半透明黑色，比滤镜省事，缩略图里也不糊
const shade = (opacity) => `fill="#000" fill-opacity="${opacity}"`;

// 只画挨着地面的墙（包括斜着挨的），房间外面的墙不画
function touchesFloor(level, i) {
  const [r, c] = rowCol(level, i);
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < level.h && cc >= 0 && cc < level.w && level.floor[rr * level.w + cc]) return true;
    }
  }
  return false;
}

// 墙：和地面一样大的圆角方块，渐变加光泽，下面一道浅浅的阴影
function wallShape(id, x, y) {
  const block = (dy, fill) => `<rect x="${x + 0.04}" y="${y + 0.04 + dy}" width="0.92" height="0.92" rx="0.16" ${fill}/>`;
  return block(0.035, shade(0.14)) + block(0, `fill="url(#${id}-wall)"`) + block(0, `fill="url(#${id}-shine)"`);
}

// 箱子：渐变加光泽，中间一圈白色圆角方框是箱盖（和 style.css 的 .skb-crate 一样）
function boxShape(id, x, y, kind) {
  const crate = (dy, fill) => `<rect x="${x + 0.09}" y="${y + 0.09 + dy}" width="0.82" height="0.82" rx="0.16" ${fill}/>`;
  return `${crate(0.05, shade(0.16))}${crate(0, `fill="url(#${id}-${kind})"`)}${crate(0, `fill="url(#${id}-shine)"`)}
    <rect x="${x + 0.27}" y="${y + 0.27}" width="0.46" height="0.46" rx="0.06" fill="none" stroke="#fff" stroke-opacity="0.75" stroke-width="0.06"/>`;
}

function playerShape(id, x, y, dir = 'd') {
  const [fx, fy] = FACING[dir];
  const eye = (side) => {
    const ex = x + 0.5 + side * 0.13 + fx * 0.07;
    const ey = y + 0.46 + fy * 0.07;
    return `<ellipse cx="${ex}" cy="${ey}" rx="0.085" ry="0.1" fill="#fff"/><circle cx="${ex + fx * 0.03}" cy="${ey + fy * 0.035}" r="0.045" fill="#1c1c1e"/>`;
  };
  const body = (dy, fill) => `<circle cx="${x + 0.5}" cy="${y + 0.5 + dy}" r="0.37" ${fill}/>`;
  return `${body(0.05, shade(0.18))}${body(0, `fill="url(#${id}-player)"`)}${body(0, `fill="url(#${id}-gloss)"`)}${eye(-1)}${eye(1)}`;
}

// 棋盘的图形部分（不含外层 <svg>）。boxes、player 不给就只画地面、墙和目标点；kinds 可以指定某个箱子画成什么颜色。
// 给了 board 就先铺一块圆角的棋盘底色（游戏里的底色和外框由 CSS 画，不用给）；thumb 是选关缩略图，目标点太小画不出虚线，画成实心小圆点
function boardShapes(level, { id, board, floor, boxes = [], player = -1, facing = 'd', kinds = {}, thumb = false }) {
  let out = gradients(id);
  if (board) out += `<rect width="${level.w}" height="${level.h}" rx="0.5" style="fill:${board}"/>`;
  const n = level.w * level.h;
  let walls = '';
  for (let i = 0; i < n; i++) {
    const [r, c] = rowCol(level, i);
    if (level.floor[i]) out += `<rect x="${c + 0.04}" y="${r + 0.04}" width="0.92" height="0.92" rx="0.14" style="fill:${floor}"/>`;
    else if (level.wall[i] && touchesFloor(level, i)) walls += wallShape(id, c, r);
  }
  // 墙等地面都画完再画（盖在上面），阴影才落得到地面上
  out += walls;
  // 目标点：强调色的虚线圆圈，一圈 8 段
  for (const g of level.goals) {
    const [r, c] = rowCol(level, g);
    out += thumb
      ? `<circle cx="${c + 0.5}" cy="${r + 0.5}" r="0.2" fill="${GOAL}"/>`
      : `<circle cx="${c + 0.5}" cy="${r + 0.5}" r="0.26" fill="none" stroke="${GOAL}" stroke-width="0.075" stroke-linecap="round" stroke-dasharray="0.06 0.144"/>`;
  }
  boxes.forEach((b, k) => {
    const [r, c] = rowCol(level, b);
    out += boxShape(id, c, r, kinds[k] ?? (level.goal[b] ? 'done' : 'box'));
  });
  if (player >= 0) {
    const [r, c] = rowCol(level, player);
    out += playerShape(id, c, r, facing);
  }
  return out;
}

// 游戏里和选关缩略图用的颜色（变量定义在 style.css 的 .skb 里）；游戏里的棋盘底色和外框由 CSS 画，只用 floor
const BOARD_COLORS = { board: 'var(--skb-board)', floor: 'var(--skb-floor)' };

function preview(level) {
  const map = parseLevel(level.map);
  const id = `skb-pv-${level.id}`;
  const shapes = boardShapes(map, { id, ...BOARD_COLORS, thumb: true, boxes: map.boxes, player: map.player });
  return `<svg viewBox="0 0 ${map.w} ${map.h}" aria-hidden="true">${shapes}</svg>`;
}

// ---------- 玩法介绍 ----------
// 介绍卡片不在 .skb 里面：style.css 给插图的 .skb-art 也定义了同一套棋盘颜色；万一样式没加载，退回外壳的中性色

const GUIDE_COLORS = { board: 'var(--skb-board, var(--fill))', floor: 'var(--skb-floor, var(--bg))' };
const FONT = 'font-family="ui-rounded, \'SF Pro Rounded\', -apple-system, system-ui, sans-serif" text-anchor="middle" dominant-baseline="central"';

const art = (body) => `<svg class="skb-art" viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

// 在 (x, y) 处按 unit 的大小画一块小棋盘
function sketch(id, rows, x, y, unit, options = {}) {
  const map = parseLevel(rows);
  const shapes = boardShapes(map, { id, ...GUIDE_COLORS, boxes: map.boxes, player: map.player, ...options });
  return `<g transform="translate(${x} ${y}) scale(${unit})">${shapes}</g>`;
}

function arrow(d, [tx, ty], [dx, dy], color = 'var(--label-2)') {
  const head = `M${tx - dx * 6 - dy * 5} ${ty - dy * 6 + dx * 5}L${tx} ${ty}L${tx - dx * 6 + dy * 5} ${ty - dy * 6 - dx * 5}`;
  return `<path d="${d} ${head}" fill="none" style="stroke:${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// 手指点的位置：半透明的文字色圆点，落在白色地面、深色模式里都看得见
const tapAt = (x, y) => `<circle cx="${x}" cy="${y}" r="13" style="fill:var(--label);stroke:var(--label)" fill-opacity="0.14" stroke-opacity="0.3" stroke-width="1.5"/>`;
const cross = (x, y) => `<path d="M${x - 7} ${y - 7}l14 14m0-14-14 14" style="stroke:#ff3b30" stroke-width="3.5" stroke-linecap="round"/>`;

const chip = (x, y, w, h, label, value) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" style="fill:var(--fill)"/>
  <text x="${x + w / 2}" y="${y + h * 0.3}" font-size="9.5" font-weight="600" style="fill:var(--label-2)" ${FONT}>${label}</text>
  <text x="${x + w / 2}" y="${y + h * 0.68}" font-size="${h * 0.4}" font-weight="700" style="fill:var(--label)" ${FONT}>${value}</text>`;
const tool = (x, icon, label) => `<rect x="${x}" y="84" width="48" height="52" rx="12" style="fill:var(--fill)"/>
  ${icon.replace('<svg ', `<svg x="${x + 14}" y="92" width="20" height="20" style="color:var(--label)" `)}
  <text x="${x + 24}" y="124" font-size="10" font-weight="600" style="fill:var(--label)" ${FONT}>${label}</text>`;

// 插图里渐变的名字带上 skb-g步骤号，免得和别的图重名
const GUIDE = [
  {
    title: '推到圆圈上',
    text: '小人把所有箱子都推到圆圈上就过关。推到位的箱子会变成绿色。',
    art: art(`${sketch('skb-g1a', ['#######', '# @$ .#', '#######'], 8, 59, 17, { facing: 'r' })}
      ${arrow('M137 85H160', [163, 85], [1, 0])}
      ${sketch('skb-g1b', ['#######', '#   @*#', '#######'], 173, 59, 17, { facing: 'r' })}`),
  },
  {
    title: '只能推不能拉',
    text: '一次只能推一个箱子。推进没有圆圈的墙角就再也推不出来，箱子会变红，撤销一步就好。',
    art: art(`${sketch('skb-g2a', ['#####', '#$  #', '#  @#', '#   #', '#####'], 22, 22, 25, { kinds: { 0: 'stuck' }, facing: 'l' })}
      ${sketch('skb-g2b', ['#######', '#@$$ .#', '#######'], 160, 60, 18, { facing: 'r' })}
      ${arrow('M183 48H229', [232, 48], [1, 0])}
      ${cross(207, 48)}`),
  },
  {
    title: '划动和点按',
    text: '往哪边划，小人就往哪边走一格。点一下空地，小人自己走过去；点身边的箱子，就推它一下。',
    art: art(`${sketch('skb-g3', ['########', '#@     #', '# ## $ #', '#      #', '########'], 50, 27, 25)}
      <path d="M87.5 64.5H212.5V114.5" fill="none" style="stroke:var(--accent)" stroke-width="2.5" stroke-dasharray="1 6" stroke-linecap="round"/>
      ${tapAt(212.5, 114.5)}`),
  },
  {
    title: '撤销与提示',
    text: '推错了就撤销或重来，卡住了点提示替你推一下。点上方的关卡名换关，每关最好成绩都记着。',
    art: art(`${sketch('skb-g4', LEVELS[3].map, 14, 50, 11.5)}
      <rect x="122" y="26" width="96" height="44" rx="12" style="fill:var(--fill)"/>
      <text x="133" y="39" font-size="9.5" font-weight="500" style="fill:var(--label-2)" font-family="ui-rounded, -apple-system, system-ui, sans-serif" dominant-baseline="central">第 4 关</text>
      <text x="133" y="56" font-size="14" font-weight="700" style="fill:var(--label)" font-family="ui-rounded, -apple-system, system-ui, sans-serif" dominant-baseline="central">${LEVELS[3].name}</text>
      <path d="M199 45.5l4.5 4.5 4.5-4.5" fill="none" style="stroke:var(--label-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      ${chip(224, 26, 54, 44, '最好', LEVELS[3].min)}
      ${tool(122, UNDO, '撤销')}${tool(176, RESTART, '重来')}${tool(230, BULB, '提示')}
      ${tapAt(254, 104)}`),
  },
];

const TEMPLATE = `
  <div class="skb">
    <div class="skb-top">
      <button class="skb-level" data-ref="levelButton">
        <span class="skb-level-text"><small data-ref="levelNo"></small><strong data-ref="levelName"></strong></span>
        ${CHEVRON}
      </button>
      <div class="skb-stat"><span>步数</span><strong data-ref="moves">0</strong></div>
      <div class="skb-stat"><span>最好</span><strong data-ref="best">–</strong></div>
    </div>
    <div class="skb-picker" data-ref="picker" hidden></div>
    <div class="skb-stage" data-ref="stage">
      <div class="skb-frame">
        <div class="skb-board" data-ref="board">
          <div class="skb-ground" data-ref="ground"></div>
          <div class="skb-things" data-ref="things"></div>
        </div>
      </div>
      <p class="skb-note" data-ref="note"></p>
    </div>
    <div class="skb-bottom" data-ref="bottom">
      <div class="skb-tools" data-ref="tools">
        <button data-action="undo" data-ref="undo">${UNDO}<span>撤销</span></button>
        <button data-action="restart">${RESTART}<span>重来</span></button>
        <button data-action="hint">${BULB}<span>提示</span></button>
      </div>
      <div class="skb-result" data-ref="result">
        <span data-ref="resultText"></span>
        <button class="skb-next" data-ref="next">下一关</button>
      </div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="sokoban"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'sokoban';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

// 存档记的是从开局起的走法，读档时重放一遍：走不通（比如关卡改过）就当没有存档
function isValidSave(saved) {
  const level = getLevel(saved?.level);
  if (!level || typeof saved.path !== 'string' || !/^[udlrUDLR]*$/.test(saved.path) || !Array.isArray(saved.marks)) return false;
  const marksOk = saved.marks.every((m, k) => Number.isInteger(m) && m >= (saved.marks[k - 1] ?? 0) && m < saved.path.length);
  return marksOk && Boolean(replay(parseLevel(level.map), saved.path));
}

class Sokoban {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.queue = []; // 还没走完的几步（点空地自动走路时）
    this.timer = 0;
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
    this.onKey = this.onKey.bind(this);
    this.bindStage();

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.start((LEVELS.find((level) => !this.records[level.id]) ?? LEVELS[0]).id);
  }

  get inProgress() {
    return this.status === 'playing' && this.path.length > 0;
  }

  // ---------- 开局与存档 ----------

  start(levelId) {
    this.stopWalking();
    this.level = getLevel(levelId);
    this.map = parseLevel(this.level.map);
    this.player = this.map.player;
    this.boxes = this.map.boxes.slice();
    this.path = ''; // 从开局起的走法，大写是推箱子的那几步
    this.marks = []; // 每个动作从 path 的第几步开始，撤销时一次退回一个动作
    this.facing = 'd';
    this.status = 'playing';
    this.record = null;
    this.render({ enter: true });
    this.updateChrome();
    this.save();
  }

  restore(saved) {
    this.level = getLevel(saved.level);
    this.map = parseLevel(this.level.map);
    const { player, boxes } = replay(this.map, saved.path);
    this.player = player;
    this.boxes = boxes;
    this.path = saved.path;
    this.marks = saved.marks;
    this.facing = saved.path.at(-1)?.toLowerCase() ?? 'd';
    this.status = saved.status === 'won' && isSolved(this.map, boxes) ? 'won' : 'playing';
    this.record = saved.record ?? null;
    this.render();
    this.updateChrome();
  }

  save() {
    const state = { level: this.level.id, path: this.path, marks: this.marks, status: this.status, record: this.record };
    this.ctx.save(state, { summary: this.summary(), finished: this.status === 'won' });
  }

  summary() {
    const moves = this.path.length;
    if (this.status === 'won') return `${this.level.name} · ${moves} 步过关`;
    if (!moves) return `${this.level.name} · 新的一局`;
    const left = this.boxes.filter((b) => !this.map.goal[b]).length;
    return `${this.level.name} · 已走 ${moves} 步，还剩 ${left} 个箱子`;
  }

  // ---------- 选关 ----------

  togglePicker(open = this.refs.picker.hidden) {
    const { picker, stage, bottom, levelButton } = this.refs;
    if (open) {
      this.stopWalking();
      this.renderPicker();
    }
    picker.hidden = !open;
    stage.hidden = open;
    bottom.hidden = open;
    levelButton.classList.toggle('is-open', open);
  }

  renderPicker() {
    this.refs.picker.innerHTML = LEVELS.map((level, k) => {
      const best = this.records[level.id];
      const meta = best ? `<span class="skb-card-meta is-done">最好 ${best} 步</span>` : `<span class="skb-card-meta">最少 ${level.min} 步</span>`;
      return `
        <button class="skb-card${level === this.level ? ' is-current' : ''}" data-level="${level.id}">
          ${preview(level)}
          <span class="skb-card-text"><small>第 ${k + 1} 关</small><strong>${level.name}</strong>${meta}</span>
        </button>`;
    }).join('');
    this.refs.picker.querySelector('.is-current')?.scrollIntoView({ block: 'nearest' });
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

  // ---------- 走路和推箱子 ----------

  // 开始一个动作：path 是要走的几步（小写），会一格一格走过去。撤销时整个动作一起退回
  act(path) {
    if (this.status !== 'playing' || !path) return;
    this.finishWalking();
    this.marks.push(this.path.length);
    this.queue = [...path];
    this.refs.board.classList.toggle('is-walking', path.length > 1);
    this.walk();
  }

  walk() {
    clearTimeout(this.timer);
    this.timer = 0;
    const dir = this.queue.shift();
    if (dir) this.applyStep(dir);
    if (this.queue.length) {
      this.timer = setTimeout(() => this.walk(), STEP_MS);
      return;
    }
    this.refs.board.classList.remove('is-walking');
    // 一步也没走成（不该发生），这个动作就不算
    if (this.marks.at(-1) === this.path.length) this.marks.pop();
    this.updateChrome();
    this.save();
  }

  // 正在自动走路时又有新的操作：剩下的几步直接走完，不播动画
  finishWalking() {
    if (!this.queue.length) return;
    clearTimeout(this.timer);
    this.timer = 0;
    while (this.queue.length) this.applyStep(this.queue.shift());
    this.refs.board.classList.remove('is-walking');
    this.place({ instant: true });
    this.updateChrome();
    this.save();
  }

  // 换关、收起游戏页：剩下的几步也走完，免得存档里少了半截
  stopWalking() {
    if (this.queue.length) this.finishWalking();
  }

  applyStep(dir) {
    const next = step(this.map, this.player, this.boxes, dir);
    this.facing = dir;
    if (!next) {
      this.queue = [];
      return;
    }
    const pushed = next.pushed >= 0;
    this.path += pushed ? dir.toUpperCase() : dir;
    this.player = next.player;
    this.boxes = next.boxes;
    let moved = -1;
    if (pushed) moved = this.boxes.findIndex((b) => b === next.pushed + this.map.delta[dir]);
    this.place({ moved });
    if (pushed && isSolved(this.map, this.boxes)) {
      this.queue = [];
      this.win();
    } else if (moved >= 0 && this.isStuckBox(moved)) {
      this.showNote('这个箱子推不动了，撤销一步试试');
    }
    this.refs.moves.textContent = this.path.length;
  }

  isStuckBox(k) {
    const b = this.boxes[k];
    return !this.map.goal[b] && isStuck(this.map, this.boxes, b);
  }

  // 划一下：往 dir 走一格（前面是箱子就推）；走不了就原地晃一下
  move(dir) {
    if (this.status !== 'playing') return;
    this.finishWalking();
    if (step(this.map, this.player, this.boxes, dir)) {
      this.act(dir);
    } else {
      this.facing = dir;
      this.place();
      this.wiggle(this.playerEl, 'bump');
    }
  }

  // 点一下格子 i：身边的箱子就推一下，空地就走过去
  tapCell(i) {
    if (this.status !== 'playing') return;
    this.finishWalking();
    if (i === this.player) return;
    const k = this.boxes.indexOf(i);
    if (k >= 0) {
      const dir = DIRS.find((d) => this.player + this.map.delta[d] === i);
      if (dir && step(this.map, this.player, this.boxes, dir)) this.act(dir);
      else this.wiggle(this.boxEls[k], 'nudge');
      return;
    }
    if (!this.map.floor[i]) return;
    const path = walkPath(this.map, this.boxes, this.player, i);
    if (path) this.act(path);
    else this.showNote('走不过去，先把挡路的箱子推开');
  }

  undo() {
    if (this.status !== 'playing') return;
    this.finishWalking();
    const mark = this.marks.pop();
    if (mark === undefined) return;
    const undone = this.path.slice(mark);
    const state = replay(this.map, this.path.slice(0, mark));
    if (!state) return;
    this.path = this.path.slice(0, mark);
    this.player = state.player;
    this.boxes = state.boxes;
    // 退回一格时滑回去，退回一整段路时直接跳回去
    this.place({ instant: undone.length > 1 });
    this.updateChrome();
    this.save();
  }

  // 提示：按推箱子次数最少的解法，替你走到该推的地方推一下
  hint() {
    if (this.status !== 'playing') return;
    this.finishWalking();
    const pushes = solvePushes(this.map, this.player, this.boxes);
    if (pushes === undefined) {
      this.showNote('这一步太难算了，自己试试吧');
      return;
    }
    if (!pushes) {
      this.showNote('这样推不成了，撤销几步试试');
      return;
    }
    if (!pushes.length) return;
    const [box, dir] = pushes[0];
    const path = walkPath(this.map, this.boxes, this.player, box - this.map.delta[dir]);
    if (path === null) return;
    const k = this.boxes.indexOf(box);
    this.act(path + dir);
    this.wiggle(this.boxEls[k], 'is-hinted');
    if (pushes.length > 1) this.showNote(`照这样推，最少还要推 ${pushes.length - 1} 下`);
  }

  win() {
    this.status = 'won';
    const moves = this.path.length;
    const previous = this.records[this.level.id];
    this.records[this.level.id] = this.ctx.submitRecord(this.level.id, moves, { lowerIsBetter: true });
    this.record = previous === undefined ? 'first' : moves < previous ? 'best' : null;
    this.refs.note.classList.remove('is-visible');
    this.boxEls.forEach((el, k) => el.style.setProperty('--i', k));
    this.refs.board.classList.add('is-won');
  }

  // ---------- 操作 ----------

  // 划动和点都在整块棋盘区域上判断：棋盘小的关卡，在棋盘外面划也能走
  bindStage() {
    const { stage } = this.refs;
    let start = null;
    stage.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    stage.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.hypot(dx, dy) >= SWIPE) {
        if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? 'r' : 'l');
        else this.move(dy > 0 ? 'd' : 'u');
        return;
      }
      const rect = this.refs.board.getBoundingClientRect();
      const c = Math.floor(((e.clientX - rect.left) / rect.width) * this.map.w);
      const r = Math.floor(((e.clientY - rect.top) / rect.height) * this.map.h);
      if (r >= 0 && r < this.map.h && c >= 0 && c < this.map.w) this.tapCell(r * this.map.w + c);
    });
    stage.addEventListener('pointercancel', () => {
      start = null;
    });
  }

  setKeyboard(on) {
    if (on) document.addEventListener('keydown', this.onKey);
    else document.removeEventListener('keydown', this.onKey);
  }

  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    if (!this.refs.picker.hidden) return;
    const dir = KEYS[e.key];
    if (dir) {
      e.preventDefault();
      this.move(dir);
    } else if (e.key === 'z' || e.key === 'Z' || e.key === 'Backspace') {
      e.preventDefault();
      this.undo();
    }
  }

  // ---------- 画面 ----------

  render({ enter = false } = {}) {
    const { w, h } = this.map;
    const { board, ground, things } = this.refs;
    board.classList.remove('is-won', 'is-walking');
    board.style.setProperty('--w', w);
    board.style.setProperty('--h', h);
    ground.innerHTML = `<svg viewBox="0 0 ${w} ${h}" aria-hidden="true">${boardShapes(this.map, { id: 'skb-live', floor: BOARD_COLORS.floor })}</svg>`;
    this.boxEls = this.boxes.map(() => {
      const el = document.createElement('div');
      el.className = 'skb-thing skb-box';
      el.innerHTML = '<div class="skb-crate"></div>';
      return el;
    });
    this.playerEl = document.createElement('div');
    this.playerEl.className = 'skb-thing skb-player';
    this.playerEl.innerHTML = '<div class="skb-face"></div>';
    things.replaceChildren(...this.boxEls, this.playerEl);
    if (enter) {
      [...this.boxEls, this.playerEl].forEach((el, k) => {
        el.classList.add('enter');
        el.style.setProperty('--d', `${k * 40}ms`);
        el.addEventListener('animationend', () => el.classList.remove('enter'), { once: true });
      });
    }
    this.place({ instant: true });
  }

  // 把箱子和小人摆到当前位置。instant 时不播滑动动画；moved 是刚被推的箱子，推到圆圈上时弹一下
  place({ instant = false, moved = -1 } = {}) {
    const { board } = this.refs;
    if (instant) board.classList.add('is-instant');
    const set = (el, i) => {
      const [r, c] = rowCol(this.map, i);
      el.style.setProperty('--r', r);
      el.style.setProperty('--c', c);
    };
    this.boxes.forEach((b, k) => {
      const el = this.boxEls[k];
      set(el, b);
      el.classList.toggle('is-done', Boolean(this.map.goal[b]));
      // 刚卡死的箱子晃一下。和点不动时用同一个 nudge，已经变红的箱子再点也会晃
      const stuck = this.isStuckBox(k);
      if (stuck && !el.classList.contains('is-stuck')) this.wiggle(el, 'nudge');
      el.classList.toggle('is-stuck', stuck);
      if (k === moved && this.map.goal[b]) this.wiggle(el, 'is-landing');
    });
    set(this.playerEl, this.player);
    const [fx, fy] = FACING[this.facing];
    this.playerEl.style.setProperty('--fx', fx);
    this.playerEl.style.setProperty('--fy', fy);
    if (instant) {
      void board.offsetWidth;
      board.classList.remove('is-instant');
    }
  }

  // 一次性的动画：nudge 是推不动或刚卡死时晃一下，bump 是小人撞墙，is-hinted 是提示时亮一下，is-landing 是箱子到位
  wiggle(el, name) {
    if (!el) return;
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
    const moves = this.path.length;
    if (moves === this.level.min) return `${moves} 步过关 · 最少步数！`;
    if (this.record === 'best') return `${moves} 步过关 · 新纪录！`;
    const best = this.records[this.level.id];
    if (this.record === 'first' || !best) return `${moves} 步过关 · 最少 ${this.level.min} 步`;
    return `${moves} 步过关 · 最好 ${best} 步`;
  }

  updateChrome() {
    const { levelNo, levelName, moves, best, tools, result, resultText, next, undo } = this.refs;
    const k = LEVELS.indexOf(this.level);
    const won = this.status === 'won';
    levelNo.textContent = `第 ${k + 1} 关 · 最少 ${this.level.min} 步`;
    levelName.textContent = this.level.name;
    moves.textContent = this.path.length;
    best.textContent = this.records[this.level.id] ?? '–';
    undo.disabled = !this.marks.length;
    tools.hidden = won;
    result.hidden = !won;
    resultText.textContent = won ? this.resultText() : '';
    next.textContent = k < LEVELS.length - 1 ? '下一关' : '从头再来';
  }

  // 收起游戏页或切到后台：没走完的路直接走完并存档，键盘不再控制
  pause() {
    this.stopWalking();
    this.setKeyboard(false);
  }

  resume() {
    this.setKeyboard(true);
  }

  destroy() {
    clearTimeout(this.timer);
    clearTimeout(this.noteTimer);
    this.setKeyboard(false);
  }
}

export default {
  guide: GUIDE,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Sokoban(root, ctx);
    return { pause: () => game.pause(), resume: () => game.resume(), destroy: () => game.destroy() };
  },
};
