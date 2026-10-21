// 扫雷：根据数字推理出地雷的位置。点按翻开、长按插旗；切到插旗模式后反过来。
// 第一下必定安全；点一个周围旗子已经插够的数字，会一次翻开它周围剩下的格子。
// 接口说明见 js/player.js。

const LEVELS = {
  easy: { name: '初级', cols: 9, rows: 9, mines: 10 },
  medium: { name: '中级', cols: 10, rows: 14, mines: 24 },
  hard: { name: '高级', cols: 10, rows: 16, mines: 35 },
};
const LONG_PRESS_MS = 380;
const MOVE_TOLERANCE = 10;

function clock(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const MINE = `<svg viewBox="-16 -16 32 32" fill="currentColor" aria-hidden="true">${[0, 45, 90, 135]
  .map((angle) => `<rect x="-13.5" y="-1.9" width="27" height="3.8" rx="1.9" transform="rotate(${angle})"/>`)
  .join('')}<circle r="8.6"/><circle cx="-3" cy="-3" r="2.5" fill="#fff" fill-opacity=".85"/></svg>`;
const FLAG = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7.2" y="3" width="2.4" height="16.5" rx="1.2" fill="currentColor"/><path d="M9.6 3.4 19.5 7.6 9.6 11.8Z" fill="#ff3b30"/><rect x="4.4" y="18.4" width="9" height="2.8" rx="1.4" fill="currentColor"/></svg>';
const TAP = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="7.8"/></svg>';
const CLOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>';
const RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';

const TEMPLATE = `
  <div class="ms">
    <div class="ms-seg" data-ref="levels">
      ${Object.entries(LEVELS).map(([key, { name }]) => `<button data-level="${key}">${name}</button>`).join('')}
    </div>
    <div class="ms-top">
      <div class="ms-stat" aria-label="剩余地雷">${MINE}<strong data-ref="left">0</strong></div>
      <div class="ms-stat" aria-label="用时">${CLOCK}<strong data-ref="time">0:00</strong></div>
      <button class="ms-new" data-ref="newGame">${RESTART}新游戏</button>
    </div>
    <div class="ms-stage"><div class="ms-board" data-ref="board"></div></div>
    <div class="ms-bottom">
      <p class="ms-hint" data-ref="hint">点任意一格开始，长按可以插旗</p>
      <div class="ms-seg ms-modes" data-ref="modes">
        <button data-mode="dig">${TAP}翻开</button>
        <button data-mode="flag">${FLAG}插旗</button>
      </div>
      <div class="ms-result" data-ref="result">
        <span data-ref="resultText"></span>
        <button class="ms-again" data-ref="again">再来一局</button>
      </div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="minesweeper"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'minesweeper';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

const isValidSave = (saved) =>
  Boolean(saved && LEVELS[saved.level] && Array.isArray(saved.open) && Array.isArray(saved.flags));

class Minesweeper {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.mode = 'dig';
    this.runningSince = 0;
    this.ticker = 0;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });

    this.refs.levels.addEventListener('click', (e) => {
      const button = e.target.closest('[data-level]');
      if (button) this.chooseLevel(button.dataset.level);
    });
    this.refs.modes.addEventListener('click', (e) => {
      const button = e.target.closest('[data-mode]');
      if (!button) return;
      this.mode = button.dataset.mode;
      this.updateChrome();
      this.save();
    });
    this.refs.newGame.addEventListener('click', () => this.requestNewGame());
    this.refs.again.addEventListener('click', () => this.newGame());
    this.bindBoard();

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.newGame('easy');
  }

  get over() {
    return this.status === 'won' || this.status === 'lost';
  }

  // ---------- 开局与存档 ----------

  chooseLevel(level) {
    if (level === this.level && !this.over) return;
    if (this.status === 'playing' && !window.confirm('换难度会放弃这一局，确定吗？')) return;
    this.newGame(level);
  }

  requestNewGame() {
    if (this.status === 'playing' && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
  }

  newGame(level = this.level) {
    this.stopClock();
    this.setLevel(level);
    this.mines = null; // 第一下之后才埋雷，保证第一下安全
    this.counts = null;
    this.open = new Set();
    this.flags = new Set();
    this.elapsed = 0;
    this.status = 'ready';
    this.exploded = null;
    this.record = null;
    this.paintAll();
    this.updateChrome();
    this.save();
  }

  restore(saved) {
    this.setLevel(saved.level);
    this.mines = Array.isArray(saved.mines) ? new Set(saved.mines) : null;
    this.counts = this.mines ? this.countAll() : null;
    this.open = new Set(saved.open);
    this.flags = new Set(saved.flags);
    this.elapsed = saved.elapsed || 0;
    this.status = saved.status ?? (this.mines ? 'playing' : 'ready');
    this.exploded = saved.exploded ?? null;
    this.record = saved.record ?? null;
    if (saved.mode === 'flag') this.mode = 'flag';
    this.paintAll();
    this.updateChrome();
  }

  setLevel(level) {
    const { cols, rows, mines } = LEVELS[level];
    Object.assign(this, { level, cols, rows, mineCount: mines, total: cols * rows });
    const { board } = this.refs;
    board.style.setProperty('--cols', cols);
    board.style.setProperty('--rows', rows);
    this.cells = Array.from({ length: this.total }, (_, i) => {
      const el = document.createElement('div');
      el.className = 'ms-cell';
      el.dataset.i = i;
      return el;
    });
    board.replaceChildren(...this.cells);
  }

  save() {
    const state = {
      level: this.level,
      mode: this.mode,
      mines: this.mines ? [...this.mines] : null,
      open: [...this.open],
      flags: [...this.flags],
      elapsed: Math.round(this.now()),
      status: this.status,
      exploded: this.exploded,
      record: this.record,
    };
    this.ctx.save(state, { summary: this.summary(), finished: this.over });
  }

  summary() {
    const { name } = LEVELS[this.level];
    if (this.status === 'won') return `${name}通关 · 用时 ${clock(this.elapsed)}`;
    if (this.status === 'lost') return `${name} · 踩到雷了`;
    if (this.status === 'ready') return `${name} · 新的一局`;
    return `${name} · 还剩 ${this.minesLeft()} 个雷 · ${clock(this.now())}`;
  }

  // ---------- 规则 ----------

  minesLeft() {
    return this.mineCount - this.flags.size;
  }

  neighbors(i) {
    const r = Math.floor(i / this.cols);
    const c = i % this.cols;
    const out = [];
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const nr = r + dr;
        const nc = c + dc;
        if ((dr || dc) && nr >= 0 && nr < this.rows && nc >= 0 && nc < this.cols) out.push(nr * this.cols + nc);
      }
    }
    return out;
  }

  // 第一下点的格子和它周围一圈都不放雷，这样一开局就能翻开一片
  placeMines(safe) {
    const keepClear = new Set([safe, ...this.neighbors(safe)]);
    let pool = [];
    for (let i = 0; i < this.total; i++) if (!keepClear.has(i)) pool.push(i);
    if (pool.length < this.mineCount) pool = [...Array(this.total).keys()].filter((i) => i !== safe);
    for (let k = 0; k < this.mineCount; k++) {
      const j = k + Math.floor(Math.random() * (pool.length - k));
      [pool[k], pool[j]] = [pool[j], pool[k]];
    }
    this.mines = new Set(pool.slice(0, this.mineCount));
    this.counts = this.countAll();
  }

  countAll() {
    return Array.from({ length: this.total }, (_, i) => this.neighbors(i).filter((j) => this.mines.has(j)).length);
  }

  // 从一格开始翻开，碰到空白格就继续往外翻；返回 [格子, 离起点几步]，用来做由近及远的动画
  flood(start, startDepth = 0) {
    const opened = [];
    const queue = [[start, startDepth]];
    while (queue.length) {
      const [i, depth] = queue.shift();
      if (this.open.has(i) || this.flags.has(i)) continue;
      this.open.add(i);
      opened.push([i, depth]);
      if (this.counts[i] === 0) {
        for (const j of this.neighbors(i)) if (!this.open.has(j)) queue.push([j, depth + 1]);
      }
    }
    return opened;
  }

  reveal(i) {
    if (this.open.has(i) || this.flags.has(i)) return;
    if (!this.mines) {
      this.placeMines(i);
      this.status = 'playing';
      this.startClock();
    }
    if (this.mines.has(i)) {
      this.lose(i);
      return;
    }
    this.showOpened(this.flood(i));
    this.checkWin();
  }

  // 点数字：周围的旗子数等于数字时，翻开周围其余的格子
  chord(i) {
    const n = this.counts?.[i];
    if (!n) return;
    const around = this.neighbors(i);
    const closed = around.filter((j) => !this.flags.has(j) && !this.open.has(j));
    if (!closed.length) return;
    if (around.filter((j) => this.flags.has(j)).length !== n) {
      this.nudge(i);
      return;
    }
    const hit = closed.find((j) => this.mines.has(j));
    if (hit !== undefined) {
      this.lose(hit);
      return;
    }
    this.showOpened(closed.flatMap((j) => this.flood(j, 1)));
    this.checkWin();
  }

  toggleFlag(i) {
    if (this.open.has(i)) return;
    if (this.flags.has(i)) {
      this.flags.delete(i);
      this.paint(i);
    } else {
      this.flags.add(i);
      this.paint(i, { pop: true });
    }
  }

  lose(i) {
    this.status = 'lost';
    this.exploded = i;
    this.stopClock();
    const er = Math.floor(i / this.cols);
    const ec = i % this.cols;
    for (let j = 0; j < this.total; j++) {
      const hidden = this.mines.has(j) && !this.flags.has(j);
      const wrongFlag = this.flags.has(j) && !this.mines.has(j);
      if (!hidden && !wrongFlag) continue;
      const distance = Math.hypot(Math.floor(j / this.cols) - er, (j % this.cols) - ec);
      this.paint(j, { pop: hidden, delay: Math.min(distance * 45, 700) });
    }
  }

  checkWin() {
    if (this.open.size !== this.total - this.mineCount) return;
    this.status = 'won';
    this.stopClock();
    const time = Math.round(this.elapsed);
    const previous = this.records[this.level];
    this.records[this.level] = this.ctx.submitRecord(this.level, time, { lowerIsBetter: true });
    this.record = previous === undefined ? 'first' : time < previous ? 'best' : null;
    // 剩下的雷自动插上旗
    const unflagged = [...this.mines].filter((m) => !this.flags.has(m)).sort((a, b) => a - b);
    unflagged.forEach((m, k) => {
      this.flags.add(m);
      this.paint(m, { pop: true, delay: Math.min(k * 40, 600) });
    });
  }

  // ---------- 操作 ----------

  // 每次操作：先收尾上一次的动画，做完后刷新界面并存档
  act(action) {
    if (this.over) return;
    for (const el of this.cells) el.classList.remove('pop');
    action();
    this.updateChrome();
    this.save();
  }

  // 开局前切换按钮是隐藏的，第一下总是翻开
  get flagMode() {
    return this.mode === 'flag' && this.status === 'playing';
  }

  tap(i) {
    this.act(() => {
      if (this.open.has(i)) this.chord(i);
      else if (this.flagMode) this.toggleFlag(i);
      else this.reveal(i);
    });
  }

  longPress(i) {
    this.act(() => {
      if (this.open.has(i)) this.chord(i);
      else if (this.flagMode) this.reveal(i);
      else this.toggleFlag(i);
    });
  }

  bindBoard() {
    const { board } = this.refs;
    let press = null;

    const release = () => {
      if (!press) return;
      clearTimeout(press.timer);
      press.el.classList.remove('is-down');
      press = null;
    };

    board.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.ms-cell');
      if (!el || e.button !== 0 || this.over) return;
      release();
      const current = { i: Number(el.dataset.i), el, id: e.pointerId, x: e.clientX, y: e.clientY, long: false };
      current.timer = setTimeout(() => {
        current.long = true;
        el.classList.remove('is-down');
        this.longPress(current.i);
      }, LONG_PRESS_MS);
      el.classList.add('is-down');
      press = current;
    });

    board.addEventListener('pointermove', (e) => {
      if (!press || e.pointerId !== press.id) return;
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > MOVE_TOLERANCE) release();
    });

    board.addEventListener('pointerup', (e) => {
      if (!press || e.pointerId !== press.id) return;
      const { i, long } = press;
      release();
      if (!long) this.tap(i);
    });

    board.addEventListener('pointercancel', release);

    // 电脑上右键插旗；触屏长按时有的浏览器也会触发这个事件，那时 press 还在，跳过
    board.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const el = e.target.closest('.ms-cell');
      if (press || !el) return;
      const i = Number(el.dataset.i);
      this.act(() => (this.open.has(i) ? this.chord(i) : this.toggleFlag(i)));
    });
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

  // ---------- 画面 ----------

  paint(i, { pop = false, delay = 0 } = {}) {
    const el = this.cells[i];
    const isMine = this.mines?.has(i) ?? false;
    const lost = this.status === 'lost';
    const classes = ['ms-cell'];
    let content = '';

    if ((Math.floor(i / this.cols) + (i % this.cols)) % 2) classes.push('alt');
    if (this.open.has(i)) {
      classes.push('is-open');
      const n = this.counts[i];
      if (n) {
        classes.push(`n${n}`);
        content = String(n);
      }
    } else if (lost && i === this.exploded) {
      classes.push('is-open', 'is-exploded');
      content = 'mine';
    } else if (lost && isMine && !this.flags.has(i)) {
      classes.push('is-open', 'is-mine');
      content = 'mine';
    } else if (this.flags.has(i)) {
      classes.push('is-flag');
      if (lost && !isMine) classes.push('is-wrong');
      content = 'flag';
    }
    if (pop) {
      classes.push('pop');
      el.style.setProperty('--d', `${delay}ms`);
    }

    el.className = classes.join(' ');
    if (el.dataset.content !== content) {
      el.dataset.content = content;
      el.innerHTML = content === 'mine' ? MINE : content === 'flag' ? FLAG : content;
    }
  }

  paintAll() {
    for (let i = 0; i < this.total; i++) this.paint(i);
  }

  // 刚翻开的格子由近及远依次弹出
  showOpened(opened) {
    for (const [i, depth] of opened) this.paint(i, { pop: true, delay: Math.min(depth * 22, 450) });
  }

  // 周围旗子数不对时，晃一下数字提示
  nudge(i) {
    const el = this.cells[i];
    el.classList.remove('nudge');
    void el.offsetWidth;
    el.classList.add('nudge');
    el.addEventListener('animationend', () => el.classList.remove('nudge'), { once: true });
  }

  resultText() {
    if (this.status === 'lost') return '踩到雷了';
    const time = clock(this.elapsed);
    if (this.record === 'best') return `用时 ${time} · 新纪录！`;
    if (this.record === 'first') return `用时 ${time} · 第一次通关${LEVELS[this.level].name}`;
    const best = this.records[this.level];
    return best ? `用时 ${time} · 最快 ${clock(best)}` : `用时 ${time}`;
  }

  updateChrome() {
    const { levels, modes, hint, result, resultText, left, board } = this.refs;
    for (const button of levels.children) button.classList.toggle('is-active', button.dataset.level === this.level);
    for (const button of modes.children) button.classList.toggle('is-active', button.dataset.mode === this.mode);
    left.textContent = this.minesLeft();
    this.renderTime();

    hint.hidden = this.status !== 'ready';
    modes.hidden = this.status !== 'playing';
    result.hidden = !this.over;
    result.classList.toggle('is-won', this.status === 'won');
    result.classList.toggle('is-lost', this.status === 'lost');
    resultText.textContent = this.over ? this.resultText() : '';
    board.classList.toggle('is-won', this.status === 'won');
  }

  pause() {
    if (!this.runningSince) return;
    this.stopClock();
    this.renderTime();
    this.save();
  }

  resume() {
    this.startClock();
  }

  destroy() {
    this.stopClock();
  }
}

export default {
  async mount(root, ctx) {
    await loadStyles();
    const game = new Minesweeper(root, ctx);
    return {
      pause: () => game.pause(),
      resume: () => game.resume(),
      destroy: () => game.destroy(),
    };
  },
};
