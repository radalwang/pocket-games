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
      <div class="sd-stat"><span>用时</span><strong data-ref="time">0:00</strong></div>
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
    if (this.started && !window.confirm('换难度会放弃这一局，确定吗？')) return;
    this.newGame(level);
  }

  requestNewGame() {
    if (this.started && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
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
    const { levels, pad, undo, erase, notes, notesBadge, hint, hintBadge, bottom, result, resultText, board } = this.refs;
    const playing = this.status === 'playing';
    const sel = this.selected;
    for (const button of levels.children) button.classList.toggle('is-active', button.dataset.level === this.level);

    this.refs.mistakes.textContent = this.mistakes;
    this.refs.mistakesStat.classList.toggle('has-mistakes', this.mistakes > 0);
    this.renderTime();

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

export default {
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
