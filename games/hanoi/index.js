// 汉诺塔：把左边柱子上的一摞圆盘全部搬到最右边的柱子上。
// 每次只能拿最上面的一个圆盘，大盘不能压在小盘上。点柱子拿起圆盘、再点另一根放下，也可以直接拖过去。
// 圆盘的位置由 JS 按棋盘大小算成像素，移动动画用 Web Animations。接口说明见 js/player.js。

const LEVELS = [3, 4, 5, 6, 7];
const TARGET = 2; // 终点是最右边的柱子
const DRAG_TOLERANCE = 8;
const FLASH_MS = 1600;

function clock(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const minMoves = (n) => 2 ** n - 1;
const startPegs = (n) => [Array.from({ length: n }, (_, k) => n - k), [], []];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const tf = ({ x, y }) => `translate(${x}px, ${y}px)`;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

// 从任意合法局面出发的最优下一步：找出最大的、还不在目标柱上的圆盘 k，
// 先要把比它小的都挪到第三根柱子上；都挪好了，下一步就是移动 k 本身。pos[圆盘大小] = 所在柱子
function nextMove(pos, k, target) {
  for (; k >= 1; k--) {
    if (pos[k] === target) continue;
    const spare = 3 - pos[k] - target;
    return nextMove(pos, k - 1, spare) ?? [pos[k], target];
  }
  return null;
}

const RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';
const UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/></svg>';

const TEMPLATE = `
  <div class="hn">
    <div class="hn-seg" data-ref="levels">
      ${LEVELS.map((n) => `<button data-level="${n}">${n} 层</button>`).join('')}
    </div>
    <div class="hn-top">
      <div class="hn-stat"><span>步数</span><strong><span data-ref="moves">0</span><small data-ref="least"></small></strong></div>
      <div class="hn-stat"><span>用时</span><strong data-ref="time">0:00</strong></div>
      <button class="hn-new" data-ref="newGame">${RESTART}新游戏</button>
    </div>
    <div class="hn-stage">
      <div class="hn-board" data-ref="board">
        ${[0, 1, 2].map((i) => `<div class="hn-peg${i === TARGET ? ' is-target' : ''}" data-peg="${i}"><i class="hn-rod"></i><i class="hn-base"></i>${i === TARGET ? '<span class="hn-goal">终点</span>' : ''}</div>`).join('')}
      </div>
    </div>
    <p class="hn-tip" data-ref="tip"></p>
    <div class="hn-bottom">
      <div class="hn-tools" data-ref="tools">
        <button data-ref="undo">${UNDO}撤销</button>
        <button data-ref="hint">${BULB}提示</button>
      </div>
      <div class="hn-result" data-ref="result">
        <div><strong data-ref="resultTitle"></strong><small data-ref="resultText"></small></div>
        <button class="hn-again" data-ref="again"></button>
      </div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="hanoi"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'hanoi';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

// 三根柱子合起来正好是 1…n 各一个，每根柱子从下往上越来越小
function isValidSave(saved) {
  if (!saved || !LEVELS.includes(saved.discs) || !Array.isArray(saved.pegs) || saved.pegs.length !== 3) return false;
  if (!saved.pegs.every((stack) => Array.isArray(stack) && stack.every((d, k) => k === 0 || d < stack[k - 1]))) return false;
  const all = saved.pegs.flat().sort((a, b) => a - b);
  return all.length === saved.discs && all.every((d, k) => d === k + 1);
}

// 从开局照着 history 一步步重放，每一步都得是合法的 [从哪根, 到哪根]；走不通返回 null
function replay(n, history) {
  const pegs = startPegs(n);
  for (const move of history) {
    if (!Array.isArray(move) || move.length !== 2) return null;
    const [from, to] = move;
    if (![0, 1, 2].includes(from) || ![0, 1, 2].includes(to) || from === to) return null;
    const disc = pegs[from].at(-1);
    const under = pegs[to].at(-1);
    if (disc === undefined || (under !== undefined && under < disc)) return null;
    pegs[to].push(pegs[from].pop());
  }
  return pegs;
}

class Hanoi {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.runningSince = 0;
    this.ticker = 0;
    this.flashTimer = 0;
    this.flashText = '';
    this.flashWarn = false;
    this.held = null; // 拿在手上的圆盘来自哪根柱子；圆盘在数据上仍然算在那根柱子最上面
    this.drag = null;
    this.geo = null;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.pegEls = [...root.querySelectorAll('.hn-peg')];

    this.refs.levels.addEventListener('click', (e) => {
      const button = e.target.closest('[data-level]');
      if (button) this.chooseLevel(Number(button.dataset.level));
    });
    this.refs.newGame.addEventListener('click', () => this.requestNewGame());
    this.refs.undo.addEventListener('click', () => this.act(() => this.undo()));
    this.refs.hint.addEventListener('click', () => this.act(() => this.showHint()));
    this.refs.again.addEventListener('click', () => this.newGame(Math.min(this.discs + 1, LEVELS.at(-1))));
    this.onKey = this.onKey.bind(this);
    this.bindBoard();

    this.resizer = new ResizeObserver(() => this.layout());
    this.resizer.observe(this.refs.board);

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.newGame(LEVELS[0]);
  }

  // ---------- 开局与存档 ----------

  get playing() {
    return this.status === 'playing' && this.moves > 0;
  }

  chooseLevel(n) {
    if (this.drag || (n === this.discs && this.status !== 'won')) return;
    if (this.playing && !window.confirm('换层数会放弃这一局，确定吗？')) return;
    this.newGame(n);
  }

  requestNewGame() {
    if (this.drag) return;
    if (this.playing && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
  }

  newGame(n = this.discs) {
    this.stopClock();
    this.setup(n, startPegs(n));
    this.moves = 0;
    this.history = [];
    this.elapsed = 0;
    this.status = 'ready';
    this.record = null;
    this.layout();
    this.updateChrome();
    this.save();
  }

  // 局面已经由 isValidSave 查过，其余字段也可能是旧的、缺的或者坏的：
  // 步骤记录要能从开局重放出存档里的局面，对不上就不要了（只是没法撤销）；赢没赢以局面为准
  restore(saved) {
    const { discs, pegs } = saved;
    this.setup(discs, pegs.map((stack) => [...stack]));
    const replayed = Array.isArray(saved.history) ? replay(discs, saved.history) : null;
    if (replayed && JSON.stringify(replayed) === JSON.stringify(pegs)) {
      this.history = saved.history;
      this.moves = saved.history.length;
    } else {
      this.history = [];
      this.moves = Number.isInteger(saved.moves) && saved.moves >= 0 ? saved.moves : 0;
    }
    this.elapsed = Number.isFinite(saved.elapsed) && saved.elapsed >= 0 ? saved.elapsed : 0;
    const done = pegs[TARGET].length === discs;
    this.status = done ? 'won' : this.moves || saved.status === 'playing' ? 'playing' : 'ready';
    this.record = done && ['first', 'best'].includes(saved.record) ? saved.record : null;
    this.layout();
    this.updateChrome();
  }

  setup(n, pegs) {
    this.discs = n;
    this.pegs = pegs;
    this.held = null;
    this.drag = null;
    this.clearMarks();
    const { board } = this.refs;
    board.querySelectorAll('.hn-disc').forEach((el) => el.remove());
    // discEls[大小]，1 最小
    this.discEls = [null];
    for (let size = 1; size <= n; size++) {
      const el = document.createElement('div');
      el.className = `hn-disc s${size}`;
      board.append(el);
      this.discEls.push(el);
    }
  }

  save() {
    const { discs, pegs, moves, history, status, record } = this;
    const state = { discs, pegs, moves, history, elapsed: Math.round(this.now()), status, record };
    this.ctx.save(state, { summary: this.summary(), finished: status === 'won' });
  }

  summary() {
    const n = this.discs;
    if (this.status === 'won') return `${n} 层完成 · ${this.moves} 步 · ${clock(this.elapsed)}`;
    if (this.status === 'ready') return `${n} 层 · 新的一局`;
    return `${n} 层 · 已走 ${this.moves} 步 · ${clock(this.now())}`;
  }

  // ---------- 规则 ----------

  top(peg) {
    return this.pegs[peg].at(-1);
  }

  canMove(from, to) {
    const disc = this.top(from);
    const under = this.top(to);
    return disc !== undefined && (under === undefined || disc < under);
  }

  startPlaying() {
    if (this.status !== 'ready') return;
    this.status = 'playing';
    this.startClock();
  }

  // 每次操作：先清掉上一次的提示标记，做完后刷新界面并存档。
  // 拖动途中（另一根手指点了撤销、提示）什么都不做，等松手以后再说，免得局面在手指底下变掉
  act(action) {
    if (this.status === 'won' || !this.geo || this.drag) return;
    this.clearMarks();
    action();
    this.updateChrome();
    this.save();
  }

  tapPeg(peg) {
    this.act(() => {
      if (this.held === null) {
        if (!this.pegs[peg].length) return;
        this.startPlaying();
        this.held = peg;
        const disc = this.top(peg);
        this.fly(disc, [this.liftPoint(disc, peg)]);
      } else if (this.held === peg) {
        this.putBack();
      } else if (this.canMove(this.held, peg)) {
        const disc = this.top(this.held);
        this.commit(this.held, peg, [this.liftPoint(disc, peg), this.stackPoint(disc, peg, this.pegs[peg].length)]);
      } else {
        this.refuse(this.top(this.held), peg);
      }
    });
  }

  // 把圆盘从 from 移到 to，path 是它要经过的位置（最后一个是终点）
  commit(from, to, path) {
    const disc = this.pegs[from].pop();
    this.pegs[to].push(disc);
    this.held = null;
    this.moves++;
    this.history.push([from, to]);
    this.fly(disc, path);
    if (this.pegs[TARGET].length === this.discs) this.win();
  }

  // 放回原来的柱子
  putBack() {
    if (this.held === null) return;
    const peg = this.held;
    const disc = this.top(peg);
    this.held = null;
    this.fly(disc, [this.stackPoint(disc, peg, this.pegs[peg].length - 1)]);
  }

  // 大盘不能压小盘：手上的圆盘 disc 摇一下，目标柱上挡路的那个圆盘也闪一下
  refuse(disc, peg) {
    this.shake(this.discEls[disc]);
    this.pulse(this.discEls[this.top(peg)]);
    this.flash('大盘不能压在小盘上', true);
  }

  undo() {
    if (!this.history.length) return;
    this.putBack();
    const [from, to] = this.history.pop();
    const disc = this.pegs[to].pop();
    this.pegs[from].push(disc);
    this.moves--;
    this.fly(disc, [this.liftPoint(disc, to), this.liftPoint(disc, from), this.stackPoint(disc, from, this.pegs[from].length - 1)]);
  }

  showHint() {
    const pos = [];
    this.pegs.forEach((stack, peg) => stack.forEach((disc) => {
      pos[disc] = peg;
    }));
    const move = nextMove(pos, this.discs, TARGET);
    if (!move) return;
    const [from, to] = move;
    if (this.held !== null && this.held !== from) this.putBack();
    this.discEls[this.top(from)].classList.add('is-hint');
    this.pegEls[to].classList.add('is-hint');
    this.flash('把亮起的圆盘移到亮起的柱子上');
  }

  clearMarks() {
    for (const el of this.refs.board.querySelectorAll('.is-hint, .is-over, .is-bad')) {
      el.classList.remove('is-hint', 'is-over', 'is-bad');
    }
  }

  win() {
    this.status = 'won';
    this.stopClock();
    const time = Math.round(this.elapsed);
    const key = `d${this.discs}`;
    const previous = this.records[key];
    this.records[key] = this.ctx.submitRecord(key, time, { lowerIsBetter: true });
    this.record = previous === undefined ? 'first' : time < previous ? 'best' : null;
    // 等最后一个圆盘落下，从上往下依次跳一下
    const stack = [...this.pegs[TARGET]].reverse();
    stack.forEach((disc, k) => this.bounce(this.discEls[disc], 380 + k * 70));
  }

  // ---------- 点按与拖动 ----------

  pegAt(clientX) {
    const rect = this.refs.board.getBoundingClientRect();
    return clamp(Math.floor(((clientX - rect.left) / rect.width) * 3), 0, 2);
  }

  bindBoard() {
    const { board } = this.refs;
    let press = null;

    board.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || this.status === 'won' || press) return;
      press = { id: e.pointerId, x: e.clientX, y: e.clientY, peg: this.pegAt(e.clientX), moved: false };
      board.setPointerCapture(e.pointerId);
    });

    board.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (!press.moved && Math.hypot(e.clientX - press.x, e.clientY - press.y) > DRAG_TOLERANCE) {
        press.moved = true;
        this.startDrag(press.peg);
      }
      if (this.drag) this.moveDrag(e.clientX, e.clientY);
    });

    const finish = (e, cancelled) => {
      if (!press || e.pointerId !== press.id) return;
      const { peg, moved } = press;
      press = null;
      if (this.drag) this.endDrag(cancelled ? null : this.pegAt(e.clientX));
      else if (!moved && !cancelled) this.tapPeg(peg);
    };
    board.addEventListener('pointerup', (e) => finish(e, false));
    board.addEventListener('pointercancel', (e) => finish(e, true));
  }

  startDrag(peg) {
    if (this.status === 'won' || !this.geo || !this.pegs[peg].length) return;
    this.clearMarks();
    if (this.held !== null && this.held !== peg) this.putBack();
    this.startPlaying();
    this.held = peg;
    const disc = this.top(peg);
    const el = this.discEls[disc];
    el.getAnimations().forEach((a) => a.cancel());
    el.classList.add('is-held', 'is-dragging');
    this.drag = { disc, from: peg };
    this.updateChrome();
  }

  moveDrag(clientX, clientY) {
    const { disc, from } = this.drag;
    const rect = this.refs.board.getBoundingClientRect();
    const { dh } = this.geo;
    const w = this.discWidth(disc);
    // 圆盘浮在手指上方一点，免得被手指挡住
    const point = { x: clientX - rect.left - w / 2, y: clientY - rect.top - dh * 1.1 };
    this.discEls[disc].style.transform = tf(point);
    const over = this.pegAt(clientX);
    this.pegEls.forEach((el, i) => {
      el.classList.toggle('is-over', i === over && i !== from);
      el.classList.toggle('is-bad', i === over && i !== from && !this.canMove(from, i));
    });
  }

  endDrag(over) {
    const { disc, from } = this.drag;
    this.drag = null;
    this.discEls[disc].classList.remove('is-dragging');
    this.act(() => {
      if (over === null || over === from) this.putBack();
      else if (this.canMove(from, over)) this.commit(from, over, [this.stackPoint(disc, over, this.pegs[over].length)]);
      else {
        // 先起飞再摇：飞的时候会取消圆盘身上已有的动画
        this.putBack();
        this.refuse(disc, over);
      }
    });
  }

  setKeyboard(on) {
    if (on) document.addEventListener('keydown', this.onKey);
    else document.removeEventListener('keydown', this.onKey);
  }

  // 1、2、3 相当于点三根柱子，⌘Z / Ctrl+Z 撤销
  onKey(e) {
    if (e.target.closest?.('input, textarea') || this.drag) return;
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      this.act(() => this.undo());
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const peg = ['1', '2', '3'].indexOf(e.key);
    if (peg < 0) return;
    e.preventDefault();
    this.tapPeg(peg);
  }

  // ---------- 布局与动画 ----------

  // 按棋盘大小算出圆盘尺寸和柱子位置，柱子和底座的位置交给 CSS 变量
  layout() {
    const { board } = this.refs;
    const W = board.clientWidth;
    const H = board.clientHeight;
    if (!W || !H) return;
    const n = this.discs;
    const col = W / 3;
    const base = 12;
    const lift = 16; // 拿起的圆盘和柱顶之间的空隙
    const label = 26; // 底座下面留给「终点」两个字
    const dh = clamp((H - base - lift - label - 12) / (n + 2), 12, 30);
    const pegH = dh * (n + 0.9);
    const top = Math.max(6, (H - (dh + lift + pegH + base + label)) / 2);
    const maxW = col - clamp(col * 0.08, 6, 14);
    this.geo = {
      col,
      dh,
      maxW,
      minW: Math.max(maxW * 0.3, dh * 1.6),
      liftY: top,
      baseY: top + dh + lift + pegH,
    };
    board.style.setProperty('--peg-top', `${top + dh + lift}px`);
    board.style.setProperty('--base-top', `${this.geo.baseY}px`);
    board.style.setProperty('--base-h', `${base}px`);
    board.style.setProperty('--dh', `${dh}px`);

    for (let disc = 1; disc <= n; disc++) {
      const el = this.discEls[disc];
      el.style.width = `${this.discWidth(disc)}px`;
      el.style.height = `${dh - 2}px`;
      if (this.drag?.disc === disc) continue;
      el.getAnimations().forEach((a) => a.cancel());
      el.style.transform = tf(this.homePoint(disc));
      el.classList.toggle('is-held', this.isHeld(disc));
    }
  }

  discWidth(disc) {
    const { minW, maxW } = this.geo;
    return this.discs === 1 ? maxW : minW + ((maxW - minW) * (disc - 1)) / (this.discs - 1);
  }

  // 圆盘左上角的位置：叠在 peg 柱的第 level 层（0 是最底下），或者拿起来悬在柱子上方
  stackPoint(disc, peg, level) {
    return this.pointFor(disc, peg, this.geo.baseY - (level + 1) * this.geo.dh);
  }

  liftPoint(disc, peg) {
    return this.pointFor(disc, peg, this.geo.liftY);
  }

  pointFor(disc, peg, y) {
    return { x: this.geo.col * (peg + 0.5) - this.discWidth(disc) / 2, y };
  }

  isHeld(disc) {
    return this.held !== null && this.top(this.held) === disc;
  }

  // 圆盘此刻应该待的地方：拿在手上的悬在柱子上方，其余的叠在柱子上
  homePoint(disc) {
    const peg = this.pegs.findIndex((stack) => stack.includes(disc));
    if (this.isHeld(disc)) return this.liftPoint(disc, peg);
    return this.stackPoint(disc, peg, this.pegs[peg].indexOf(disc));
  }

  // 从当前位置（可能正在半路上）沿 path 飞过去；目标位置写进 style，动画只是过程
  fly(disc, path) {
    const el = this.discEls[disc];
    const end = path.at(-1);
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    const points = [{ x: m.m41, y: m.m42 }, ...path];
    el.getAnimations().forEach((a) => a.cancel());
    el.style.transform = tf(end);
    el.classList.toggle('is-held', this.isHeld(disc));

    const lengths = points.slice(1).map((p, k) => Math.hypot(p.x - points[k].x, p.y - points[k].y));
    const total = lengths.reduce((a, b) => a + b, 0);
    if (total < 1 || reducedMotion.matches) return;
    let travelled = 0;
    const frames = points.map((p, k) => {
      if (k) travelled += lengths[k - 1];
      return { transform: tf(p), offset: travelled / total };
    });
    el.animate(frames, { duration: clamp(120 + total * 0.7, 150, 420), easing: 'cubic-bezier(0.3, 0.7, 0.4, 1)' });
  }

  // 摇的是单独的 translate 属性，和 transform 上正在飞的动画叠在一起，一边飞回去一边摇
  shake(el) {
    el.animate(
      [0, -7, 6, -4, 2, 0].map((dx) => ({ translate: `${dx}px 0` })),
      { duration: 320, easing: 'ease-out' },
    );
  }

  pulse(el) {
    el?.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(1.5)' }, { filter: 'brightness(1)' }], { duration: 360 });
  }

  bounce(el, delay) {
    if (reducedMotion.matches) return;
    const base = el.style.transform;
    el.animate(
      [{ transform: base }, { transform: `${base} translateY(-14px)`, offset: 0.4 }, { transform: base }],
      { duration: 420, delay, easing: 'ease-out' },
    );
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

  // ---------- 界面 ----------

  // 底下那行字临时换成一句提醒，过一会儿恢复
  flash(text, warn = false) {
    clearTimeout(this.flashTimer);
    this.flashText = text;
    this.flashWarn = warn;
    this.flashTimer = setTimeout(() => {
      this.flashText = '';
      this.updateTip();
    }, FLASH_MS);
    this.updateTip();
  }

  updateTip() {
    const { tip } = this.refs;
    let text = '每次搬一个圆盘，大盘不能压在小盘上';
    if (this.flashText) text = this.flashText;
    else if (this.drag) text = '拖到另一根柱子上松手';
    else if (this.held !== null) text = '点另一根柱子放下，点原处放回';
    else if (this.status === 'ready') text = '点一根柱子拿起圆盘，把它们都搬到终点';
    tip.textContent = text;
    tip.classList.toggle('is-warn', Boolean(this.flashText) && this.flashWarn);
    // 赢了以后只把提示变透明、不让它消失：消失会让棋盘变高，触发重新布局，打断最后落下和庆祝的动画
    tip.classList.toggle('is-gone', this.status === 'won');
  }

  resultTitle() {
    if (this.record === 'best') return '新纪录！';
    if (this.record === 'first') return `第一次完成 ${this.discs} 层！`;
    return `完成 ${this.discs} 层`;
  }

  resultText() {
    const min = minMoves(this.discs);
    const steps = this.moves === min ? `${this.moves} 步，正好是最少步数` : `${this.moves} 步（最少 ${min} 步）`;
    const best = this.records[`d${this.discs}`];
    const time = `用时 ${clock(this.elapsed)}`;
    return this.record || !best ? `${time} · ${steps}` : `${time}，最快 ${clock(best)} · ${steps}`;
  }

  updateChrome() {
    const { levels, moves, least, board, tools, undo, result, resultTitle, resultText, again } = this.refs;
    const won = this.status === 'won';
    // 赢了的棋盘带一圈绿光；放在这里，读档回来的已完成局面也有
    board.classList.toggle('is-won', won);
    for (const button of levels.children) {
      button.classList.toggle('is-active', Number(button.dataset.level) === this.discs);
    }
    moves.textContent = this.moves;
    least.textContent = ` / ${minMoves(this.discs)}`;
    this.renderTime();
    this.updateTip();

    tools.hidden = won;
    undo.disabled = !this.history.length;
    result.hidden = !won;
    if (won) {
      resultTitle.textContent = this.resultTitle();
      resultText.textContent = this.resultText();
      const next = this.discs < LEVELS.at(-1) ? this.discs + 1 : null;
      again.textContent = next ? `挑战 ${next} 层` : '再来一局';
    }
  }

  pause() {
    this.setKeyboard(false);
    if (!this.runningSince) return;
    this.stopClock();
    this.renderTime();
    this.save();
  }

  resume() {
    this.setKeyboard(true);
    this.startClock();
    this.layout();
  }

  destroy() {
    this.setKeyboard(false);
    this.stopClock();
    clearTimeout(this.flashTimer);
    this.resizer.disconnect();
  }
}

// 玩法说明：外壳第一次打开这个游戏时、或点标题栏的“?”时一页页显示。
// 配图是简化的 3 层棋盘，圆盘的渐变和木头柱子的颜色跟游戏里一样；中性的底色、文字和线条用外壳的颜色变量，深色模式下也看得清。
const GUIDE_X = [55, 150, 245]; // 三根柱子的中线
const GUIDE_W = [0, 38, 56, 74]; // 圆盘宽度，下标是圆盘大小
const GUIDE_DISCS = [null, ['#ff7a85', '#ff375f'], ['#ffb057', '#ff7a1a'], ['#ffdf5e', '#f5b400']];
const GUIDE_OK = '#34c759';
const GUIDE_BAD = '#ff3b30';
const GUIDE_ACCENT = '#fa2d48';

// color 是颜色值，或者外壳的颜色变量名（比如 --label-2）
const guidePaint = (prop, color) => (color.startsWith('--') ? `style="${prop}:var(${color})"` : `${prop}="${color}"`);

function guideText(x, y, text, { size, color, weight = 700 }) {
  return `<text x="${x}" y="${y}" font-family="ui-rounded, -apple-system, system-ui, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="middle" dominant-baseline="central" ${guidePaint('fill', color)}>${text}</text>`;
}

// 第 level 层圆盘的上沿（0 是最底下）
const guideY = (level, base = 124, dh = 16) => base - (level + 1) * dh + 1;

// 一个圆盘，y 是上沿；mark 是 faded（拖动半路上的影子，变淡）或 hint（提示，外面描一圈强调色）
function guideDisc(step, size, cx, y, h = 14, mark = '') {
  const w = GUIDE_W[size];
  let out = `<rect x="${cx - w / 2}" y="${y}" width="${w}" height="${h}" rx="${h / 2}" fill="url(#hn-${step}-s${size})"${mark === 'faded' ? ' fill-opacity="0.35"' : ''}/>`;
  if (mark === 'hint') out += `<rect x="${cx - w / 2 - 3}" y="${y - 3}" width="${w + 6}" height="${h + 6}" rx="${h / 2 + 3}" fill="none" stroke="${GUIDE_ACCENT}" stroke-width="2.5"/>`;
  return out;
}

// 虚线框出圆盘要去的位置
function guideGhost(size, cx, y, color) {
  const w = GUIDE_W[size];
  return `<rect x="${cx - w / 2 + 0.75}" y="${y + 0.75}" width="${w - 1.5}" height="12.5" rx="6.25" fill="none" ${guidePaint('stroke', color)} stroke-width="1.5" stroke-dasharray="4 3"/>`;
}

// 一块棋盘：pegs[柱子] 是从下往上的圆盘大小，rods[柱子] 给柱子换颜色（拖动时的绿、红，提示的强调色），marks[圆盘大小] 见 guideDisc。
// 默认占满整张图；最后一张图上下还要摆层数和按钮，用 y、h、base、top、dh 把它压扁一点
function guideBoard(step, pegs, { rods = [], marks = {}, y = 6, h = 158, base = 124, top = 56, dh = 16, label = true } = {}) {
  let out = `<rect x="8" y="${y}" width="284" height="${h}" rx="18" style="fill:var(--fill)"/>`;
  GUIDE_X.forEach((cx, peg) => {
    const color = rods[peg];
    if (color) out += `<rect x="${cx - 6}" y="${top - 3}" width="12" height="${base - top + 5}" rx="6" fill="${color}" fill-opacity="0.25"/>`;
    out += `<rect x="${cx - 3}" y="${top}" width="6" height="${base - top + 2}" rx="3" fill="${color ?? `url(#hn-${step}-rod)`}"/>`;
    out += `<rect x="${cx - 41}" y="${base}" width="82" height="8" rx="4" fill="url(#hn-${step}-${peg === TARGET ? 'goal' : 'base'})"/>`;
    pegs[peg].forEach((size, level) => {
      out += guideDisc(step, size, cx, guideY(level, base, dh), dh - 2, marks[size]);
    });
  });
  if (label) out += guideText(GUIDE_X[TARGET], base + 22, '终点', { size: 12, color: GUIDE_ACCENT });
  return out;
}

const guideTap = (x, y, n = '') =>
  `<circle cx="${x}" cy="${y}" r="14" fill="#fff" fill-opacity="0.7" stroke="#000" stroke-opacity="0.18" stroke-width="1.5"/>${n && guideText(x, y, n, { size: 13, color: '#1c1c1e' })}`;

// 弧线箭头：从 from 经过控制点 via 弯到 to，箭头顺着末端的方向；dashed 是拖动时手指划过的轨迹
function guideArrow(from, via, to, dashed = false) {
  const angle = Math.atan2(to[1] - via[1], to[0] - via[0]);
  const wing = (turn) => `${(to[0] - 8 * Math.cos(angle + turn)).toFixed(1)} ${(to[1] - 8 * Math.sin(angle + turn)).toFixed(1)}`;
  const line = 'fill="none" style="stroke:var(--label-2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';
  return `<path d="M${from.join(' ')}Q${via.join(' ')} ${to.join(' ')}" ${line}${dashed ? ' stroke-dasharray="1 6"' : ''}/><path d="M${wing(-0.6)}L${to.join(' ')}L${wing(0.6)}" ${line}/>`;
}

// 圆形小标记：放得下是绿底白勾，放不下是红底白叉
const guideBadge = (x, y, ok) =>
  `<circle cx="${x}" cy="${y}" r="9" fill="${ok ? GUIDE_OK : GUIDE_BAD}"/><path d="${ok ? `M${x - 4} ${y}l2.8 3 5-6` : `M${x - 3.5} ${y - 3.5}l7 7m0-7-7 7`}" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;

// 顶上选层数的那一排
function guideLevels(active) {
  let out = '<rect x="22" y="6" width="257" height="26" rx="9" style="fill:var(--fill)"/>';
  LEVELS.forEach((n, k) => {
    const x = 24 + k * 51;
    if (n === active) out += `<rect x="${x}" y="8" width="49" height="22" rx="7" style="fill:var(--fill)"/>`;
    out += guideText(x + 24.5, 19, `${n} 层`, { size: 12, weight: n === active ? 700 : 500, color: n === active ? '--label' : '--label-2' });
  });
  return out;
}

// 底部的按钮，图标就用游戏里那两个
function guideButton(x, y, w, icon, label) {
  const glyph = icon.replace('<svg ', `<svg x="${x + w / 2 - 27}" y="${y + 7}" width="16" height="16" `).replace('stroke="currentColor"', 'style="stroke:var(--label)"');
  return `<rect x="${x}" y="${y}" width="${w}" height="30" rx="10" style="fill:var(--fill)"/>${glyph}${guideText(x + w / 2 + 9, y + 15, label, { size: 13, weight: 600, color: '--label' })}`;
}

// 每张图带自己的渐变，id 前面加上游戏和第几步（比如 hn-1-s3），几张图同时在页面上也不会串
function guideArt(step, body) {
  const gradient = (name, [from, to], x2, y2) =>
    `<linearGradient id="hn-${step}-${name}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient>`;
  const defs = [
    ...GUIDE_DISCS.slice(1).map((colors, k) => gradient(`s${k + 1}`, colors, 1, 1)),
    gradient('rod', ['#e2d6c6', '#c4b29b'], 1, 0),
    gradient('base', ['#e2d6c6', '#c4b29b'], 0, 1),
    gradient('goal', ['#ed8a8d', '#e4626a'], 0, 1), // 终点的底座混了一点强调色，和游戏里一样
  ];
  return `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs>${defs.join('')}</defs>${body}</svg>`;
}

const GUIDE = [
  {
    title: '搬到终点',
    text: '把左边这一摞圆盘，全部搬到最右边的「终点」柱子上就赢了。',
    art: guideArt(1,
      guideBoard(1, [[3, 2, 1], [], []]) +
        [3, 2, 1].map((size, level) => guideGhost(size, GUIDE_X[TARGET], guideY(level), '--label-2')).join('') +
        guideArrow([62, 66], [150, -8], [234, 66])),
  },
  {
    title: '大盘不压小盘',
    // 拿起的是中号圆盘：放到小盘上不行，放到空柱子上可以
    text: '每次只能拿最上面的一个圆盘，而且大盘不能压在小盘上。',
    art: guideArt(2,
      guideBoard(2, [[3], [1], []]) +
        guideDisc(2, 2, GUIDE_X[0], 34) +
        guideGhost(2, GUIDE_X[1], guideY(1), GUIDE_BAD) +
        guideGhost(2, GUIDE_X[2], guideY(0), GUIDE_OK) +
        guideArrow([90, 42], [128, 40], [138, 72]) +
        guideArrow([90, 32], [220, -4], [232, 92]) +
        guideBadge(GUIDE_X[1] + 34, guideY(1) + 7, false) +
        guideBadge(GUIDE_X[2] + 34, guideY(0) + 7, true)),
  },
  {
    title: '点一下拿起',
    text: '点一根柱子拿起最上面的圆盘，再点另一根柱子放下。点原处就放回去。',
    art: guideArt(3,
      guideBoard(3, [[3, 2], [], []]) +
        guideDisc(3, 1, GUIDE_X[0], 34) +
        guideGhost(1, GUIDE_X[2], guideY(0), '--label-2') +
        guideArrow([82, 38], [160, 0], [228, 52]) +
        guideTap(GUIDE_X[0], 92, '1') +
        guideTap(GUIDE_X[2], 86, '2')),
  },
  {
    title: '直接拖过去',
    // 拖着中号圆盘经过小盘（柱子变红）到空柱子上（柱子变绿）；游戏里同一时间只有手指下面那根会亮
    text: '也可以按住圆盘拖过去。柱子变绿就能放，变红就放不下。',
    art: guideArt(4,
      guideBoard(4, [[3], [1], []], { rods: [null, GUIDE_BAD, GUIDE_OK] }) +
        guideDisc(4, 2, GUIDE_X[1], 58, 14, 'faded') +
        guideDisc(4, 2, GUIDE_X[2], 58) +
        guideArrow([64, 92], [110, 10], [210, 62], true) +
        guideTap(GUIDE_X[2], 90)),
  },
  {
    title: '撤销和提示',
    text: '走错了就撤销，没头绪就点提示。3 到 7 层各记一个最快用时。',
    art: guideArt(5,
      guideLevels(3) +
        guideBoard(5, [[3, 2], [], [1]], { rods: [null, GUIDE_ACCENT], marks: { 2: 'hint' }, y: 38, h: 90, base: 108, top: 64, dh: 12, label: false }) +
        guideButton(20, 136, 126, UNDO, '撤销') +
        guideButton(154, 136, 126, BULB, '提示') +
        guideTap(212, 151)),
  },
];

export default {
  guide: GUIDE,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Hanoi(root, ctx);
    return {
      pause: () => game.pause(),
      resume: () => game.resume(),
      destroy: () => game.destroy(),
    };
  },
};
