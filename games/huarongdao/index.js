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
const CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

// 配色分四类：曹操、关羽、其他大将、兵
const colorOf = (piece) => (piece.kind === 'cao' || piece.kind === 'bing' ? piece.kind : piece.name === '关羽' ? 'guan' : 'general');

// 选关列表里的小棋盘
function preview(level) {
  const rects = parseLayout(level.layout)
    .map((p) => `<rect class="p-${colorOf(p)}" x="${p.c * 10 + 0.7}" y="${p.r * 10 + 0.7}" width="${p.w * 10 - 1.4}" height="${p.h * 10 - 1.4}" rx="2.2"/>`)
    .join('');
  return `<svg viewBox="0 0 40 50" aria-hidden="true">${rects}</svg>`;
}

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

// 存档里的棋子都要在棋盘内，而且不能叠在一起
function isValidSave(saved) {
  const level = getLevel(saved?.level);
  if (!level || !Array.isArray(saved.positions) || !Array.isArray(saved.history)) return false;
  const pieces = parseLayout(level.layout);
  const { positions } = saved;
  if (positions.length !== pieces.length || !positions.every((pos) => Array.isArray(pos) && pos.every(Number.isInteger))) return false;
  positions.forEach(([r, c], id) => Object.assign(pieces[id], { r, c }));
  if (!pieces.every((p) => p.r >= 0 && p.c >= 0 && p.r + p.h <= ROWS && p.c + p.w <= COLS)) return false;
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
      const meta = best ? `<span class="hrd-card-meta is-done">${CHECK}最好 ${best} 步</span>` : `<span class="hrd-card-meta">最少 ${level.min} 步</span>`;
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
    const route = routeTo(reachable(this.pieces, last.id), ...last.from);
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
      if (e.type === 'pointerup') track(e);
      const { id, el, moved, at, dir, t } = drag;
      const shown = dragPosition(drag);
      drag = null;
      el.classList.remove('is-held', 'is-dragging');
      if (!moved) {
        if (e.type === 'pointerup') this.tap(id);
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
    layer.addEventListener('pointercancel', end);
  }

  // ---------- 画面 ----------

  render({ enter = false } = {}) {
    this.els = this.pieces.map((p, id) => {
      const el = document.createElement('div');
      el.className = `hrd-piece k-${colorOf(p)}${p.h > p.w ? ' is-tall' : ''}`;
      el.dataset.id = id;
      el.style.setProperty('--w', p.w);
      el.style.setProperty('--h', p.h);
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

  destroy() {
    clearTimeout(this.noteTimer);
  }
}

export default {
  async mount(root, ctx) {
    await loadStyles();
    const game = new Huarongdao(root, ctx);
    return { destroy: () => game.destroy() };
  },
};
