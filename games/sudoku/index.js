// 数独：让每行、每列、每个 3×3 宫都正好填入 1 到 9。
// 点格子选中，再点下面的数字填进去，填错的数字会标红；打开笔记后，点数字是在格子里做小标记。
// 出题和求解在 puzzle.js。接口说明见 js/player.js。

import { candidates, colOf, generate, PEERS, rowOf, UNITS_OF } from './puzzle.js';

const LEVELS = { easy: '初级', medium: '中级', hard: '高级' };
const HINTS = 3;
const DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const MOVES = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
// 放在格子本身上的动画（pop 在里面的数字上，不算）
const CELL_ANIMATIONS = ['shake', 'flash', 'wave'];

function clock(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

const RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';
const UNDO = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 14 4.5 9.5 9 5"/><path d="M4.5 9.5h9.5a5.5 5.5 0 0 1 0 11H11"/></svg>';
const ERASE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.2 5h10.3a1.5 1.5 0 0 1 1.5 1.5v11a1.5 1.5 0 0 1-1.5 1.5H9.2a1.5 1.5 0 0 1-1.1-.5L2.8 12l5.3-6.5a1.5 1.5 0 0 1 1.1-.5Z"/><path d="m12 9.5 5 5m0-5-5 5"/></svg>';
const PENCIL = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/><path d="m13.5 6.5 3 3"/></svg>';
const BULB = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/></svg>';

const TEMPLATE = `
  <div class="sd">
    <div class="sd-seg" data-ref="levels">
      ${Object.entries(LEVELS).map(([key, name]) => `<button data-level="${key}">${name}</button>`).join('')}
    </div>
    <div class="sd-top">
      <div class="sd-stat" data-ref="mistakesStat"><span>错误</span><strong data-ref="mistakes">0</strong></div>
      <div class="sd-stat sd-timer"><div class="sd-time"><span>用时</span><strong data-ref="time">0:00</strong></div><small data-ref="best"></small></div>
      <button class="sd-new" data-ref="newGame">${RESTART}新游戏</button>
    </div>
    <div class="sd-stage"><div class="sd-board" data-ref="board"></div></div>
    <div class="sd-bottom" data-ref="bottom">
      <div class="sd-controls">
        <div class="sd-tools">
          <button data-tool="undo" data-ref="undo">${UNDO}<span>撤销</span></button>
          <button data-tool="erase" data-ref="erase">${ERASE}<span>擦除</span></button>
          <button data-tool="notes" data-ref="notes">${PENCIL}<span>笔记</span><i class="sd-badge" data-ref="notesBadge">关</i></button>
          <button data-tool="hint" data-ref="hint">${BULB}<span>提示</span><i class="sd-badge" data-ref="hintBadge">${HINTS}</i></button>
        </div>
        <div class="sd-pad" data-ref="pad">
          ${DIGITS.map((d) => `<button data-digit="${d}" aria-label="${d}"><b>${d}</b><small></small></button>`).join('')}
        </div>
      </div>
      <div class="sd-result" data-ref="result">
        <span data-ref="resultText"></span>
        <button class="sd-again" data-ref="again">再来一局</button>
      </div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="sudoku"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'sudoku';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

// 存档里的盘面是 81 个字符的字符串，比如 "530070000…"
const encode = (grid) => grid.join('');
const decode = (text) => [...text].map(Number);
const isGrid = (text) => typeof text === 'string' && /^[0-9]{81}$/.test(text);

const isValidSave = (saved) =>
  Boolean(saved && Object.hasOwn(LEVELS, saved.level)
    && isGrid(saved.puzzle) && isGrid(saved.solution) && isGrid(saved.values)
    && Array.isArray(saved.notes) && saved.notes.length === 81);

class Sudoku {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.notesMode = false;
    this.active = false;
    this.runningSince = 0;
    this.ticker = 0;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.buildBoard();

    this.refs.levels.addEventListener('click', (e) => {
      const button = e.target.closest('[data-level]');
      if (button) this.chooseLevel(button.dataset.level);
    });
    this.refs.pad.addEventListener('click', (e) => {
      const button = e.target.closest('[data-digit]');
      if (button) this.act(() => this.input(Number(button.dataset.digit)));
    });
    root.querySelector('.sd-tools').addEventListener('click', (e) => {
      const tool = e.target.closest('[data-tool]')?.dataset.tool;
      if (tool === 'undo') this.act(() => this.undo());
      else if (tool === 'erase') this.act(() => this.erase());
      else if (tool === 'notes') this.act(() => { this.notesMode = !this.notesMode; });
      else if (tool === 'hint') this.act(() => this.hint());
    });
    this.refs.board.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.sd-cell');
      if (el && e.button === 0) this.act(() => this.select(Number(el.dataset.i)));
    });
    // 动画放完就把对应的类去掉，下次才能重新播放
    this.refs.board.addEventListener('animationend', (e) => {
      e.target.closest('.sd-cell')?.classList.remove(e.animationName.replace('sd-', ''));
    });
    this.refs.newGame.addEventListener('click', () => this.requestNewGame());
    this.refs.again.addEventListener('click', () => this.newGame());
    this.onKey = this.onKey.bind(this);

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.newGame('easy');
  }

  // 棋盘由 9 个宫组成，每个宫里 3×3 个格子；this.cells 按行排列，下标和盘面一致
  buildBoard() {
    this.cells = [];
    const boxes = Array.from({ length: 9 }, (_, b) => {
      const box = document.createElement('div');
      box.className = 'sd-box';
      for (let k = 0; k < 9; k++) {
        const i = (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3);
        const el = document.createElement('div');
        el.className = 'sd-cell';
        el.dataset.i = i;
        this.cells[i] = el;
        box.append(el);
      }
      return box;
    });
    this.refs.board.replaceChildren(...boxes);
  }

  // ---------- 开局与存档 ----------

  // 这一局有没有动过：填过数字或做过笔记
  get started() {
    return this.status === 'playing'
      && (this.values.some((v, i) => v !== this.puzzle[i]) || this.notes.some(Boolean));
  }

  chooseLevel(level) {
    if (level === this.level && this.status === 'playing') return;
    if (!this.confirmAbandon('换难度会放弃这一局，确定吗？')) return;
    this.newGame(level);
  }

  requestNewGame() {
    if (!this.confirmAbandon('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
  }

  // 动过的局先停表再弹确认框，点取消接着计时，犹豫的这几秒不算进用时
  confirmAbandon(message) {
    if (!this.started) return true;
    const wasRunning = Boolean(this.runningSince);
    this.stopClock();
    const ok = window.confirm(message);
    if (!ok && wasRunning) this.startClock();
    return ok;
  }

  newGame(level = this.level) {
    this.stopClock();
    const { puzzle, solution } = generate(level);
    this.level = level;
    this.puzzle = puzzle;
    this.solution = solution;
    this.values = puzzle.slice();
    this.notes = Array(81).fill(0);
    this.history = [];
    this.selected = this.values.indexOf(0);
    this.mistakes = 0;
    this.hintsLeft = HINTS;
    this.elapsed = 0;
    this.status = 'playing';
    this.record = null;
    this.paintAll();
    // 题目里的数字从左上角往右下角依次出现
    for (let i = 0; i < 81; i++) if (puzzle[i]) this.animate(i, 'pop', (rowOf(i) + colOf(i)) * 14);
    this.updateChrome();
    this.save();
    if (this.active) this.startClock();
  }

  restore(saved) {
    this.level = saved.level;
    this.puzzle = decode(saved.puzzle);
    this.solution = decode(saved.solution);
    this.values = decode(saved.values);
    this.notes = saved.notes.map((mask) => mask | 0);
    this.history = [];
    // 选中的格子不在棋盘上，就当没选
    this.selected = Number.isInteger(saved.selected) && saved.selected >= 0 && saved.selected < 81 ? saved.selected : -1;
    this.notesMode = Boolean(saved.notesMode);
    this.mistakes = saved.mistakes || 0;
    this.hintsLeft = saved.hintsLeft ?? HINTS;
    this.elapsed = saved.elapsed || 0;
    this.status = saved.status === 'won' ? 'won' : 'playing';
    this.record = saved.record ?? null;
    this.paintAll();
    this.updateChrome();
  }

  save() {
    const state = {
      level: this.level,
      puzzle: encode(this.puzzle),
      solution: encode(this.solution),
      values: encode(this.values),
      notes: this.notes,
      selected: this.selected,
      notesMode: this.notesMode,
      mistakes: this.mistakes,
      hintsLeft: this.hintsLeft,
      elapsed: Math.round(this.now()),
      status: this.status,
      record: this.record,
    };
    this.ctx.save(state, { summary: this.summary(), finished: this.status === 'won' });
  }

  summary() {
    const name = LEVELS[this.level];
    if (this.status === 'won') return `${name}通关 · 用时 ${clock(this.elapsed)}`;
    const left = this.values.filter((v, i) => v !== this.solution[i]).length;
    return `${name} · 还剩 ${left} 格 · ${clock(this.now())}`;
  }

  // ---------- 规则 ----------

  // 题目给的数字和填对的数字都不能再改
  isFixed(i) {
    return this.values[i] === this.solution[i];
  }

  isWrong(i) {
    return this.values[i] !== 0 && !this.isFixed(i);
  }

  // 某个数字已经正确填入了几次
  placed(d) {
    let n = 0;
    for (let i = 0; i < 81; i++) if (this.values[i] === d && this.isFixed(i)) n++;
    return n;
  }

  // 改动前记下这些格子原来的样子，撤销时还原
  remember(indices) {
    this.history.push({
      selected: this.selected,
      cells: indices.map((i) => [i, this.values[i], this.notes[i]]),
    });
    if (this.history.length > 300) this.history.shift();
  }

  select(i) {
    if (this.status === 'playing') this.selected = i;
  }

  input(d) {
    const i = this.selected;
    if (this.status !== 'playing' || i < 0 || this.isFixed(i)) return;
    if (this.notesMode) {
      // 格子里有填错的数字时，先擦掉才能做笔记
      if (this.values[i]) {
        this.animate(i, 'shake');
        return;
      }
      this.remember([i]);
      this.notes[i] ^= 1 << d;
      return;
    }
    if (this.values[i] === d) return;
    if (!this.place(i, d)) {
      this.mistakes++;
      this.animate(i, 'shake');
    }
  }

  // 在一格里填数字，返回填得对不对。填对时顺手把同行、同列、同宫笔记里的这个数字划掉
  place(i, d) {
    const correct = d === this.solution[i];
    const peers = correct ? PEERS[i].filter((j) => this.notes[j] & (1 << d)) : [];
    this.remember([i, ...peers]);
    this.values[i] = d;
    this.notes[i] = 0;
    for (const j of peers) this.notes[j] &= ~(1 << d);
    this.animate(i, 'pop');
    if (correct) {
      this.celebrateUnits(i);
      this.checkWin();
    }
    return correct;
  }

  erase() {
    const i = this.selected;
    if (this.status !== 'playing' || i < 0 || this.isFixed(i)) return;
    if (!this.values[i] && !this.notes[i]) return;
    this.remember([i]);
    this.values[i] = 0;
    this.notes[i] = 0;
  }

  undo() {
    const last = this.history.pop();
    if (!last || this.status !== 'playing') return;
    for (const [i, value, notes] of last.cells) {
      this.values[i] = value;
      this.notes[i] = notes;
    }
    this.selected = last.selected;
  }

  // 提示：选中的格子还没填对就填它，否则找一个候选最少、最好推的格子
  hint() {
    if (this.status !== 'playing' || !this.hintsLeft) return;
    let i = this.selected;
    if (i < 0 || this.isFixed(i)) i = this.easiestCell();
    if (i < 0) return;
    this.hintsLeft--;
    this.selected = i;
    this.place(i, this.solution[i]);
    // 提示填的数字不能撤销：去掉 place 刚记下的这一步，再从更早的记录里去掉这一格，免得撤销时把它擦掉
    this.history.pop();
    this.history = this.history
      .map((step) => ({ ...step, cells: step.cells.filter(([j]) => j !== i) }))
      .filter((step) => step.cells.length);
  }

  easiestCell() {
    const known = this.values.map((v, i) => (this.isFixed(i) ? v : 0));
    let best = -1;
    let fewest = 10;
    for (let i = 0; i < 81; i++) {
      if (known[i]) continue;
      let n = 0;
      for (let m = candidates(known, i); m; m &= m - 1) n++;
      if (n < fewest) {
        best = i;
        fewest = n;
      }
    }
    return best;
  }

  // 填满一行、一列或一宫时，从刚填的格子往外闪一下
  celebrateUnits(i) {
    for (const unit of UNITS_OF[i]) {
      if (!unit.every((j) => this.isFixed(j))) continue;
      for (const j of unit) {
        if (j === i) continue;
        const distance = Math.abs(rowOf(j) - rowOf(i)) + Math.abs(colOf(j) - colOf(i));
        this.animate(j, 'flash', distance * 40);
      }
    }
  }

  checkWin() {
    if (!this.values.every((v, i) => v === this.solution[i])) return;
    this.status = 'won';
    this.stopClock();
    this.selected = -1;
    this.history = [];
    const time = Math.round(this.elapsed);
    const previous = this.records[this.level];
    this.records[this.level] = this.ctx.submitRecord(this.level, time, { lowerIsBetter: true });
    this.record = previous === undefined ? 'first' : time < previous ? 'best' : null;
    for (let i = 0; i < 81; i++) this.animate(i, 'wave', (rowOf(i) + colOf(i)) * 35);
    // 告诉外壳这一局结束了，破了纪录的话外壳会弹出「新纪录！」
    this.ctx.runEnded?.();
  }

  // ---------- 操作 ----------

  // 每次操作后刷新界面并存档
  act(action) {
    action();
    this.paintAll();
    this.updateChrome();
    this.save();
  }

  setKeyboard(on) {
    if (on) document.addEventListener('keydown', this.onKey);
    else document.removeEventListener('keydown', this.onKey);
  }

  // 电脑上可以用键盘：数字填入，退格擦除，方向键移动，N 切换笔记
  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    if (/^[1-9]$/.test(e.key)) this.act(() => this.input(Number(e.key)));
    else if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') this.act(() => this.erase());
    else if (e.key === 'n' || e.key === 'N') this.act(() => { this.notesMode = !this.notesMode; });
    else if (MOVES[e.key]) this.act(() => this.move(...MOVES[e.key]));
    else return;
    e.preventDefault();
  }

  move(dr, dc) {
    if (this.selected < 0) {
      this.select(40);
      return;
    }
    const r = (rowOf(this.selected) + dr + 9) % 9;
    const c = (colOf(this.selected) + dc + 9) % 9;
    this.select(r * 9 + c);
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

  // 播放一次性的动画：pop 数字弹出、shake 晃一下、flash 闪一下、wave 通关时的波浪
  // 格子本身的动画同一时间只有一个生效，被盖住的收不到 animationend，类会一直留着，
  // 等盖住它的放完又重播一遍（比如通关时的波浪盖住刚开始的闪烁），所以先把它们都去掉
  animate(i, name, delay = 0) {
    const el = this.cells[i];
    el.classList.remove(...(name === 'pop' ? [name] : CELL_ANIMATIONS));
    el.style.setProperty('--d', `${delay}ms`);
    void el.offsetWidth;
    el.classList.add(name);
  }

  paint(i) {
    const el = this.cells[i];
    const value = this.values[i];
    const notes = value ? 0 : this.notes[i];
    const sel = this.selected;
    const selValue = sel >= 0 ? this.values[sel] : 0;
    const related = sel >= 0 && i !== sel
      && (rowOf(i) === rowOf(sel) || colOf(i) === colOf(sel) || UNITS_OF[sel][2].includes(i));

    el.classList.toggle('is-given', this.puzzle[i] !== 0);
    el.classList.toggle('is-user', value !== 0 && this.puzzle[i] === 0 && this.isFixed(i));
    el.classList.toggle('is-wrong', this.isWrong(i));
    el.classList.toggle('is-sel', i === sel);
    el.classList.toggle('is-peer', related);
    el.classList.toggle('is-same', i !== sel && value !== 0 && value === selValue);
    // 选中的格子填错了：把和它冲突的数字也标出来
    el.classList.toggle('is-clash', related && value !== 0 && value === selValue && this.isWrong(sel));

    const content = value ? String(value) : notes ? `n${notes}` : '';
    if (el.dataset.content !== content) {
      el.dataset.content = content;
      el.innerHTML = value
        ? `<span class="sd-digit">${value}</span>`
        : notes
          ? `<span class="sd-notes">${DIGITS.map((d) => `<span>${notes & (1 << d) ? d : ''}</span>`).join('')}</span>`
          : '';
    }
    if (notes) {
      el.querySelectorAll('.sd-notes span').forEach((span, k) => {
        span.classList.toggle('is-hl', selValue === k + 1 && Boolean(notes & (1 << selValue)));
      });
    }
  }

  paintAll() {
    for (let i = 0; i < 81; i++) this.paint(i);
  }

  resultText() {
    const time = clock(this.elapsed);
    if (this.record === 'best') return `用时 ${time} · 新纪录！`;
    if (this.record === 'first') return `用时 ${time} · 第一次通关${LEVELS[this.level]}`;
    const best = this.records[this.level];
    return best ? `用时 ${time} · 最快 ${clock(best)}` : `用时 ${time}`;
  }

  updateChrome() {
    const { levels, pad, undo, erase, notes, notesBadge, hint, hintBadge, bottom, result, resultText, best, board } = this.refs;
    const playing = this.status === 'playing';
    const sel = this.selected;
    for (const button of levels.children) button.classList.toggle('is-active', button.dataset.level === this.level);

    this.refs.mistakes.textContent = this.mistakes;
    this.refs.mistakesStat.classList.toggle('has-mistakes', this.mistakes > 0);
    this.renderTime();
    // 用时下面写着这个难度的最快用时，还没通关过就不写
    const fastest = this.records[this.level];
    best.hidden = !fastest;
    best.textContent = fastest ? `最快 ${clock(fastest)}` : '';

    for (const button of pad.children) {
      const left = 9 - this.placed(Number(button.dataset.digit));
      button.classList.toggle('is-done', left === 0);
      button.querySelector('small').textContent = left || '';
    }
    pad.classList.toggle('is-notes', this.notesMode);

    undo.disabled = !this.history.length;
    erase.disabled = sel < 0 || this.isFixed(sel) || (!this.values[sel] && !this.notes[sel]);
    notes.classList.toggle('is-active', this.notesMode);
    notesBadge.textContent = this.notesMode ? '开' : '关';
    hint.disabled = !this.hintsLeft;
    hintBadge.textContent = this.hintsLeft;

    bottom.classList.toggle('is-over', !playing);
    result.hidden = playing;
    resultText.textContent = playing ? '' : this.resultText();
    board.classList.toggle('is-won', !playing);
  }

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
  }
}

// ---------- 玩法介绍 ----------
// 第一次打开游戏时外壳会自动显示，之后点标题栏的“?”还能再看。配图是照着游戏画面简化的 300×170 示意图：
// 中性的字、线和底色用外壳的颜色变量，深浅色模式下都看得清；游戏自己的颜色直接写死

const ART_INK = '#6b69ee'; // 介于浅色模式的 #5856d6 和深色模式的 #8e8cff 之间，两种底色上都看得清
const ART_RED = '#ff3b30';
const ART_FONT = 'font-family="ui-rounded, -apple-system, system-ui, sans-serif" text-anchor="middle" dominant-baseline="central"';
// 格子的底色：同行列宫、选中、填错，分别是 [颜色, 不透明度]
const PEER = [ART_INK, 0.16];
const SEL = [ART_INK, 0.4];
const WRONG = [ART_RED, 0.16];

// 一盘填好的数独，示意图里的数字都从这里取，保证不重复
const solved = (r, c) => ((r * 3 + Math.floor(r / 3) + c) % 9) + 1;

const art = (body) => `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
const label = (x, y, text, size, color = 'var(--label)', weight = 600) =>
  `<text x="${x}" y="${y}" ${ART_FONT} font-size="${size}" font-weight="${weight}" style="fill:${color}">${text}</text>`;
const pill = (x, y, w, h, rx, color, opacity = 1) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" style="fill:${color}" fill-opacity="${opacity}"/>`;
// 手指点在哪里
const tapAt = (x, y) => `<circle cx="${x}" cy="${y}" r="14" fill="#fff" fill-opacity=".7" stroke="#000" stroke-opacity=".15"/>`;
// 工具栏的图标，直接用上面按钮里的线条，(x, y) 是图标中心
const icon = (svg, x, y, color) =>
  `<g transform="translate(${x - 12} ${y - 12})" fill="none" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="stroke:${color}">${svg.replace(/^<svg[^>]*>|<\/svg>$/g, '')}</g>`;
const badge = (x, y, text, color) => pill(x, y, 18, 16, 8, color) + label(x + 9, y + 8, text, 10, '#fff', 700);

// 画一块棋盘：rows×cols 格，每格边长 size；cell(r, c) 返回这一格的样子 { bg, digit, color, weight, notes }。
// 左上角那格在整盘里的行列决定粗线画在哪，所以传进 r0、c0
function board(x0, y0, size, rows, cols, cell, r0 = 0, c0 = 0) {
  const w = cols * size;
  const h = rows * size;
  let out = pill(x0, y0, w, h, 4, 'var(--bg)');
  let marks = '';
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { bg, digit, color = 'var(--label)', weight = 600, notes = [] } = cell(r, c) ?? {};
      const x = x0 + c * size;
      const y = y0 + r * size;
      if (bg) out += pill(x, y, size, size, 0, ...bg);
      if (digit) marks += label(x + size / 2, y + size / 2, digit, size * 0.62, color, weight);
      // 笔记的小数字和游戏里一样排成 3×3
      for (const d of notes) {
        const k = d - 1;
        marks += label(x + size * (0.2 + (k % 3) * 0.3), y + size * (0.2 + Math.floor(k / 3) * 0.3), d, size * 0.24, 'var(--label-2)');
      }
    }
  }
  const lines = { thin: '', thick: '' };
  const line = (x1, y1, x2, y2, thick) => {
    lines[thick ? 'thick' : 'thin'] += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" style="stroke:var(--label-2)" stroke-width="${thick ? 1.6 : 0.8}" stroke-opacity="${thick ? 1 : 0.35}"/>`;
  };
  for (let c = 1; c < cols; c++) line(x0 + c * size, y0, x0 + c * size, y0 + h, (c0 + c) % 3 === 0);
  for (let r = 1; r < rows; r++) line(x0, y0 + r * size, x0 + w, y0 + r * size, (r0 + r) % 3 === 0);
  const frame = `<rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="4" fill="none" style="stroke:var(--label-2)" stroke-width="1.6"/>`;
  return out + lines.thin + lines.thick + frame + marks;
}

// 规则：标出一行、一列、一宫，里面正好是 1 到 9
function ruleArt() {
  const marked = (r, c) => r === 1 || c === 6 || (r >= 6 && c < 3);
  return art(
    board(78, 18, 16, 9, 9, (r, c) => (marked(r, c) ? { bg: PEER, digit: solved(r, c) } : null))
    + label(64, 42, '行', 12, ART_INK, 700) + label(182, 9, '列', 12, ART_INK, 700) + label(64, 138, '宫', 12, ART_INK, 700),
  );
}

// 填数：先点空格，再点数字键；填错的标红。# 题目给的数，. 空格，s 选中的格子，w 填错的，u 自己填对的
const FILL_ROWS = ['#w..#.#..', '#.#.s.#.#', '.#.#.#.u.'];

function fillArt() {
  const cells = board(42, 12, 24, 3, 9, (r, c) => {
    const ch = FILL_ROWS[r][c];
    if (ch === 's') return { bg: SEL };
    if (ch === 'w') return { bg: WRONG, digit: 8, color: ART_RED };
    return {
      bg: r === 1 || (c >= 3 && c < 6) ? PEER : null,
      digit: ch === '.' ? 0 : solved(r + 3, c),
      color: ch === 'u' ? ART_INK : 'var(--label)',
      weight: ch === '#' ? 700 : 600,
    };
  });
  const pad = DIGITS.map((d, k) => pill(8 + k * 32, 100, 28, 50, 9, 'var(--fill)') + label(22 + k * 32, 125, d, 20, ART_INK)).join('');
  // 点格子的手指稍微偏右下，露出选中格子的底色
  return art(cells + pad + tapAt(155, 53) + tapAt(278, 125));
}

// 笔记：打开笔记后，格子里记的是小数字
const NOTES_BOX = [
  [2, [1, 4], 7],
  [[1, 8], [1, 4, 8], 6],
  [5, 3, [4, 8, 9]],
];

function notesArt() {
  const button = icon(PENCIL, 62, 74, ART_INK) + label(62, 102, '笔记', 12, ART_INK) + badge(69, 54, '开', ART_INK);
  const box = board(150, 25, 40, 3, 3, (r, c) => {
    const v = NOTES_BOX[r][c];
    return Array.isArray(v) ? { bg: r === 1 && c === 1 ? SEL : null, notes: v } : { digit: v, weight: 700 };
  });
  return art(button + tapAt(62, 74) + box);
}

// 工具栏：提示填进选中的格子，按钮上的数字是还剩几次
const TOOLS_ROW = [4, 'w', 9, 0, 'h', 1, 'u'];

function toolsArt() {
  const strip = board(45, 28, 30, 1, 7, (r, c) => {
    const v = TOOLS_ROW[c];
    if (v === 'w') return { bg: WRONG, digit: 7, color: ART_RED };
    if (v === 'h') return { bg: SEL, digit: 2, color: ART_INK };
    if (v === 'u') return { digit: 5, color: ART_INK };
    return { digit: v, weight: 700 };
  });
  const tools = [[UNDO, '撤销'], [ERASE, '擦除'], [PENCIL, '笔记', '关'], [BULB, '提示', '2']].map(([svg, name, count], k) => {
    const x = 37.5 + k * 75;
    return icon(svg, x, 100, 'var(--label-2)') + label(x, 123, name, 12, 'var(--label-2)') + (count ? badge(x + 7, 84, count, '#6e6e73') : '');
  }).join('');
  return art(strip + tools + tapAt(262.5, 100));
}

// 难度和用时：每档难度分开记最快用时
function levelArt() {
  // 选中的那档描一圈细边，深色模式下也认得出
  const levels = pill(30, 30, 240, 34, 10, 'var(--fill)') + pill(32, 32, 77.3, 30, 8, 'var(--bg)')
    + '<rect x="32" y="32" width="77.3" height="30" rx="8" fill="none" style="stroke:var(--label-2)" stroke-opacity=".3"/>'
    + Object.values(LEVELS).map((name, k) => label(70.7 + k * 79.3, 47, name, 14)).join('');
  const time = pill(30, 86, 112, 48, 14, 'var(--fill)') + label(56, 110, '用时', 13, 'var(--label-2)') + label(100, 110, '4:32', 20, 'var(--label)', 700);
  const best = pill(152, 86, 118, 48, 14, '#34c759', 0.18) + label(211, 110, '初级最快 3:58', 13);
  return art(levels + tapAt(99, 55) + time + best);
}

const GUIDE = [
  { title: '填满九宫格', text: '每一行、每一列和每个 3×3 宫里，1 到 9 都要正好出现一次。', art: ruleArt() },
  { title: '点格子填数字', text: '先点一个空格，再点下面的数字填进去。填错的数字会变红。', art: fillArt() },
  { title: '做笔记', text: '拿不准时打开笔记，点数字会在格子里记下小数字，再点一次就去掉。', art: notesArt() },
  { title: '提示和撤销', text: '卡住了就点提示，每局 3 次，提示的数不能撤销。撤销退回上一步，擦除清掉填错的数。', art: toolsArt() },
  { title: '难度和计时', text: '上面可以换难度，新手先从初级玩起。每档难度分开记最快用时。', art: levelArt() },
];

export default {
  guide: GUIDE,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Sudoku(root, ctx);
    return {
      pause: () => game.pause(),
      resume: () => game.resume(),
      destroy: () => game.destroy(),
    };
  },
};
