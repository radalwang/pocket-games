// 记忆方格：几个格子亮一下，熄灭后凭记忆把它们点出来，顺序随便。点错一格这一回合就结束。
// 全对的话下一回合多记一格（方格也会慢慢变大），点错就退一级。一局 12 回合。
// 旋转模式下，格子熄灭后整块方格会转 90°，要在脑子里跟着转过去再点。
// 收起或切到后台时：还在亮、在转的回合作废，回来重新出一组；已经在点的回合原样留着（存档里也记着），回来接着点。
// 两种模式各记最高分（score、scoreR）和全对过的最多格子数（tiles、tilesR）。接口说明见 js/player.js。

import guide from './guide.js';

const ROUNDS = 12;
// 每一级的 [方格边长, 要记的格子数]。全对一路升上去，第 12 回合正好到最后一级
const LEVELS = [[3, 3], [3, 4], [4, 4], [4, 5], [4, 6], [5, 6], [5, 7], [5, 8], [6, 9], [6, 10], [7, 11], [7, 12]];
const MODES = { classic: '经典', rotate: '旋转' };
const KEYS = { classic: ['score', 'tiles'], rotate: ['scoreR', 'tilesR'] };

const READY_MS = 500; // 新回合先空着停一下，让眼睛看清方格
const showMs = (tiles) => 600 + tiles * 120; // 亮多久：格子越多亮得越久
const HIDE_MS = 300;
const TURN_MS = 700; // 转 90° 的时间（和 style.css 里的过渡一致）
const PASS_MS = 900;
const FAIL_MS = 1600;
const POINTS = 10; // 点对一格的分；整回合全对，这一回合的分翻倍

const RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';

const TEMPLATE = `
  <div class="mem">
    <div class="mem-seg" data-ref="modes">
      ${Object.entries(MODES).map(([key, name]) => `<button data-mode="${key}">${name}</button>`).join('')}
    </div>
    <div class="mem-top">
      <div class="mem-stat"><span>回合</span><strong data-ref="round">1/${ROUNDS}</strong></div>
      <div class="mem-stat"><span>分数</span><strong data-ref="score">0</strong></div>
      <div class="mem-stat is-tiles"><span>要记</span><strong data-ref="tiles">3 格</strong></div>
      <button class="mem-restart" data-ref="restart" aria-label="重新开始">${RESTART}</button>
    </div>
    <div class="mem-stage">
      <div class="mem-wrap">
        <div class="mem-board" data-ref="board"></div>
        <div class="mem-overlay" data-ref="overlay" hidden></div>
      </div>
    </div>
    <div class="mem-bottom">
      <p class="mem-hint" data-ref="hint"></p>
      <div class="mem-result" data-ref="result" hidden>
        <div class="mem-result-text"><strong data-ref="resultScore"></strong><span data-ref="resultNote"></span></div>
        <button class="mem-again" data-ref="again">再来一局</button>
      </div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="memory"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'memory';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

// 从 total 个格子里随机挑 count 个
function pick(total, count) {
  const all = Array.from({ length: total }, (_, i) => i);
  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}

const isCount = (n, max) => Number.isInteger(n) && n >= 0 && n <= max;

// 存档记第几回合、第几级、分数，以及每回合对没对；点到一半暂停的回合另记在 held 里
function isValidSave(saved) {
  if (!saved || !MODES[saved.mode] || !['ready', 'paused', 'done'].includes(saved.status)) return false;
  const { round, level, score, most, results } = saved;
  return isCount(round, ROUNDS) && isCount(level, LEVELS.length - 1) && isCount(score, 1e6) && isCount(most, 99)
    && Array.isArray(results) && results.length === round && results.every((r) => typeof r === 'boolean')
    && isValidHeld(saved);
}

// held：亮过哪几格（pattern）、已经点对哪几格（found）、方格转了多少（turn）
function isValidHeld({ held = null, status, round, level }) {
  if (held === null) return true;
  if (status !== 'paused' || round >= ROUNDS) return false;
  const [size, count] = LEVELS[level];
  const { pattern, found, turn } = held;
  return Array.isArray(pattern) && pattern.length === count && new Set(pattern).size === count
    && pattern.every((i) => isCount(i, size * size - 1))
    && Array.isArray(found) && found.length < count && new Set(found).size === found.length
    && found.every((i) => pattern.includes(i)) && [0, 90, -90].includes(turn);
}

class Memory {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.timer = 0;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });

    this.refs.modes.addEventListener('click', (e) => {
      const button = e.target.closest('[data-mode]');
      if (button) this.chooseMode(button.dataset.mode);
    });
    this.refs.restart.addEventListener('click', () => this.requestRestart());
    this.refs.again.addEventListener('click', () => this.newGame());
    // 用按下来判断，手指一碰到就算
    this.refs.board.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.mem-cell');
      if (!el) return;
      e.preventDefault();
      this.tap(Number(el.dataset.i));
    });

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.newGame('classic');
  }

  get size() {
    return LEVELS[this.level][0];
  }

  get count() {
    return LEVELS[this.level][1];
  }

  get inProgress() {
    return this.status !== 'ready' && this.status !== 'done';
  }

  // ---------- 开局与存档 ----------

  // 问之前先暂停：对话框开着时计时也停着，不先停的话亮着的格子会一直亮着
  chooseMode(mode) {
    if (mode === this.mode) return;
    this.pause();
    if (this.inProgress && !window.confirm('换模式会放弃这一局，确定吗？')) return;
    this.newGame(mode);
  }

  requestRestart() {
    this.pause();
    if (this.inProgress && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
  }

  newGame(mode = this.mode) {
    clearTimeout(this.timer);
    this.mode = mode;
    this.round = 0; // 已经打完几回合
    this.level = 0;
    this.score = 0;
    this.roundScore = 0; // 这一回合点对的分，回合结束才算进总分
    this.most = 0; // 这一局全对过的最多格子数
    this.results = [];
    this.status = 'ready';
    this.held = false; // 暂停时这一回合是不是点到一半、留着回来接着点
    this.record = null;
    this.build({ enter: true });
    this.updateChrome();
    this.save();
  }

  restore(saved) {
    Object.assign(this, {
      mode: saved.mode, round: saved.round, level: saved.level, score: saved.score, most: saved.most,
      results: saved.results, record: saved.record ?? null, roundScore: 0, held: false,
    });
    // 最后一回合打完、还没来得及出结果就关掉了：现在补上记成绩
    if (saved.status !== 'done' && this.round >= ROUNDS) {
      this.finish();
      return;
    }
    // 点到一半收起的回合：照原样摆回去（方向也转好），点继续接着点
    if (saved.held) {
      this.held = true;
      this.pattern = saved.held.pattern;
      this.found = new Set(saved.held.found);
      this.turn = saved.held.turn;
      this.roundScore = this.found.size * POINTS;
    }
    if (saved.status === 'done') this.status = 'done';
    else this.status = this.round > 0 || this.held ? 'paused' : 'ready';
    this.build({ turn: this.held ? this.turn : 0 });
    if (this.held) this.found.forEach((i) => this.paint(i, 'is-hit'));
    this.updateChrome();
  }

  save() {
    const { mode, round, level, score, most, results, record } = this;
    const status = this.status === 'done' || this.status === 'ready' ? this.status : 'paused';
    const held = this.held ? { pattern: this.pattern, found: [...this.found], turn: this.turn } : null;
    this.ctx.save({ mode, round, level, score, most, results, record, status, held }, { summary: this.summary(), finished: status === 'done' });
  }

  summary() {
    const name = MODES[this.mode];
    if (this.status === 'done') return `${name} · ${this.score} 分，最多记住 ${this.most} 格`;
    if (this.status === 'ready') return `${name} · 新的一局`;
    // 最后一回合刚打完、还没出结果时 round 已经是 12，不能写成第 13 回合
    return `${name} · 第 ${Math.min(this.round + 1, ROUNDS)}/${ROUNDS} 回合 · ${this.score} 分`;
  }

  // ---------- 一个回合 ----------

  // 回合按时间往下走：空着停一下 → 亮 → 熄灭 →（旋转模式转一下）→ 等着点
  later(ms, next) {
    clearTimeout(this.timer);
    this.timer = setTimeout(next, ms);
  }

  start() {
    if (this.status !== 'ready' && this.status !== 'paused') return;
    if (this.held) {
      this.held = false;
      this.recall();
    } else {
      this.playRound();
    }
  }

  playRound() {
    const sizeChanged = this.cells?.length !== this.size * this.size;
    this.pattern = pick(this.size * this.size, this.count);
    this.found = new Set();
    this.roundScore = 0;
    this.status = 'show';
    this.turn = this.mode === 'rotate' ? (Math.random() < 0.5 ? 90 : -90) : 0;
    this.build({ enter: sizeChanged });
    this.updateChrome();
    this.later(READY_MS + (sizeChanged ? 300 : 0), () => {
      this.pattern.forEach((i) => this.paint(i, 'is-lit'));
      this.later(showMs(this.count), () => {
        this.pattern.forEach((i) => this.paint(i, ''));
        this.later(HIDE_MS, () => {
          if (!this.turn) {
            this.recall();
            return;
          }
          this.status = 'turn';
          this.refs.board.style.setProperty('--turn', `${this.turn}deg`);
          this.updateChrome();
          this.later(TURN_MS, () => this.recall());
        });
      });
    });
  }

  recall() {
    this.status = 'recall';
    this.updateChrome();
  }

  tap(i) {
    if (this.status !== 'recall' || this.found.has(i)) return;
    if (!this.pattern.includes(i)) {
      this.paint(i, 'is-wrong');
      this.endRound(false);
      return;
    }
    this.found.add(i);
    this.roundScore += POINTS;
    this.paint(i, 'is-hit');
    if (this.found.size === this.pattern.length) this.endRound(true);
    else this.updateChrome();
  }

  // 全对：分数翻倍、升一级；点错：亮出漏掉的格子、降一级
  endRound(passed) {
    this.status = passed ? 'passed' : 'failed';
    this.lastCount = this.count;
    this.lastSize = this.size;
    this.score += passed ? this.roundScore * 2 : this.roundScore;
    this.roundScore = 0;
    if (passed) this.most = Math.max(this.most, this.count);
    else this.pattern.filter((i) => !this.found.has(i)).forEach((i) => this.paint(i, 'is-missed'));
    this.refs.board.classList.toggle('is-passed', passed);
    this.results.push(passed);
    this.round += 1;
    this.level = Math.min(Math.max(this.level + (passed ? 1 : -1), 0), LEVELS.length - 1);
    this.updateChrome();
    this.save();
    this.later(passed ? PASS_MS : FAIL_MS, () => (this.round >= ROUNDS ? this.finish() : this.playRound()));
  }

  finish() {
    this.status = 'done';
    const [scoreKey, tilesKey] = KEYS[this.mode];
    const previous = this.records[scoreKey];
    this.records[scoreKey] = this.ctx.submitRecord(scoreKey, this.score);
    if (this.most) this.records[tilesKey] = this.ctx.submitRecord(tilesKey, this.most);
    this.record = previous === undefined ? 'first' : this.score > previous ? 'best' : null;
    this.build();
    this.updateChrome();
    this.save();
  }

  // 收起游戏页或切到后台：已经在点的回合原样留着（方格不动），回来接着点；
  // 还在亮、在转的回合作废，回来后点继续，重新出一组格子
  pause() {
    if (!this.inProgress || this.status === 'paused') return;
    clearTimeout(this.timer);
    if (this.round >= ROUNDS) {
      this.finish();
      return;
    }
    this.held = this.status === 'recall';
    if (!this.held) {
      this.roundScore = 0;
      this.build();
    }
    this.status = 'paused';
    this.updateChrome();
    this.save();
  }

  destroy() {
    clearTimeout(this.timer);
  }

  // ---------- 画面 ----------

  // 按当前这一级的大小摆好空方格，方向摆正或直接转到 turn（不播转动的动画）
  build({ enter = false, turn = 0 } = {}) {
    const { board } = this.refs;
    const { size } = this;
    board.classList.remove('is-passed');
    board.classList.add('is-instant');
    board.style.setProperty('--turn', `${turn}deg`);
    board.style.setProperty('--size', size);
    if (this.cells?.length !== size * size || enter) {
      const mid = (size - 1) / 2;
      this.cells = Array.from({ length: size * size }, (_, i) => {
        const el = document.createElement('div');
        el.className = enter ? 'mem-cell is-in' : 'mem-cell';
        el.dataset.i = i;
        el.style.setProperty('--d', `${Math.hypot(Math.floor(i / size) - mid, (i % size) - mid) * 40}ms`);
        return el;
      });
      board.replaceChildren(...this.cells);
    } else {
      this.cells.forEach((_, i) => this.paint(i, ''));
    }
    void board.offsetWidth;
    board.classList.remove('is-instant');
  }

  // 一格的样子：is-lit 亮着要记，is-hit 点对了，is-wrong 点错了，is-missed 漏掉没点的
  paint(i, state) {
    this.cells[i].className = state ? `mem-cell ${state}` : 'mem-cell';
  }

  hintText() {
    const left = this.count - (this.found?.size ?? 0);
    switch (this.status) {
      case 'ready': return this.mode === 'rotate'
        ? '记住亮起的格子。熄灭后方格会转 90°，跟着转过去再点'
        : '记住亮起的格子，熄灭后把它们一个个点出来';
      case 'paused': return this.held ? '点继续，接着把这一回合点完' : '点继续，这一回合会重新出一组格子';
      case 'show': return `记住亮起的 ${this.count} 个格子`;
      case 'turn': return '方格在转，眼睛跟上';
      case 'recall': return left === this.count ? `点出刚才亮的 ${this.count} 个格子` : `还差 ${left} 个`;
      case 'passed':
        if (this.round >= ROUNDS) return '全对！';
        if (this.lastCount < this.count) return '全对！下一回合多记一格';
        return this.lastSize < this.size ? '全对！下一回合方格变大' : '全对！';
      case 'failed': return '点错了，虚线框是漏掉的格子';
      default: return '';
    }
  }

  resultNote() {
    const passed = this.results.filter(Boolean).length;
    const base = `最多记住 ${this.most} 格 · 全对 ${passed}/${ROUNDS} 回合`;
    if (this.record === 'best') return `${base} · 新纪录！`;
    const best = this.records[KEYS[this.mode][0]];
    if (this.record !== 'first' && best) return `${base} · 最高 ${best} 分`;
    return base;
  }

  showOverlay() {
    const { overlay } = this.refs;
    if (this.status !== 'ready' && this.status !== 'paused') {
      overlay.hidden = true;
      return;
    }
    const best = this.records[KEYS[this.mode][0]];
    const note = this.status === 'paused'
      ? `第 ${this.round + 1}/${ROUNDS} 回合 · ${this.score} 分`
      : best ? `最高 ${best} 分` : `一局 ${ROUNDS} 回合`;
    overlay.innerHTML = '<button class="mem-go"></button><p></p>';
    const go = overlay.querySelector('.mem-go');
    go.textContent = this.status === 'paused' ? '继续' : '开始';
    go.addEventListener('click', () => this.start());
    overlay.querySelector('p').textContent = note;
    overlay.hidden = false;
  }

  updateChrome() {
    const { modes, round, score, tiles, hint, result, resultScore, resultNote } = this.refs;
    for (const button of modes.children) button.classList.toggle('is-active', button.dataset.mode === this.mode);
    const done = this.status === 'done';
    const between = this.status === 'passed' || this.status === 'failed';
    // 回合结束后已经算进下一回合了，画面上还显示刚打完的这一回合
    round.textContent = `${Math.min(between ? this.round : this.round + 1, ROUNDS)}/${ROUNDS}`;
    score.textContent = this.score + this.roundScore;
    tiles.textContent = `${between ? this.lastCount : this.count} 格`;
    hint.textContent = this.hintText();
    hint.hidden = done;
    result.hidden = !done;
    resultScore.textContent = done ? `${this.score} 分` : '';
    resultNote.textContent = done ? this.resultNote() : '';
    this.showOverlay();
  }
}

export default {
  guide,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Memory(root, ctx);
    return {
      pause: () => game.pause(),
      destroy: () => game.destroy(),
    };
  },
};
