// 舒尔特方格：格子里打乱放着 1 到 N，按顺序尽快点完，练注意力和余光。
// 3×3 到 6×6 每种大小各记最快用时。开局前和暂停时数字是盖住的，免得先把位置记下来。
// 接口说明见 js/player.js。

import guide from './guide.js';

const SIZES = [3, 4, 5, 6];
const DEFAULT_SIZE = 5;

// 用时显示到 0.1 秒，比如 18437 → 18.4
const secs = (ms) => (Math.floor(ms / 100) / 10).toFixed(1);

const RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';

const TEMPLATE = `
  <div class="sch">
    <div class="sch-seg" data-ref="sizes">
      ${SIZES.map((n) => `<button data-size="${n}">${n}×${n}</button>`).join('')}
    </div>
    <div class="sch-top">
      <div class="sch-stat is-next"><span>下一个</span><strong data-ref="next">1</strong></div>
      <div class="sch-stat"><span>用时</span><strong data-ref="time">0.0</strong></div>
      <div class="sch-stat"><span>失误</span><strong data-ref="miss">0</strong></div>
      <button class="sch-restart" data-ref="restart" aria-label="重新开始">${RESTART}</button>
    </div>
    <div class="sch-stage">
      <div class="sch-wrap">
        <div class="sch-board" data-ref="board"></div>
        <div class="sch-overlay" data-ref="overlay" hidden></div>
      </div>
    </div>
    <div class="sch-bottom">
      <p class="sch-hint" data-ref="hint">眼睛盯着中间，用余光去找下一个数字</p>
      <div class="sch-result" data-ref="result" hidden>
        <div class="sch-result-text"><strong data-ref="resultTime"></strong><span data-ref="resultNote"></span></div>
        <button class="sch-again" data-ref="again">再来一局</button>
      </div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="schulte"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'schulte';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

function shuffled(count) {
  const out = Array.from({ length: count }, (_, i) => i + 1);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// 存档里的数字必须正好是 1 到 size² 各一个
function isValidSave(saved) {
  if (!saved || !SIZES.includes(saved.size) || !Array.isArray(saved.numbers)) return false;
  const total = saved.size * saved.size;
  const seen = new Set(saved.numbers);
  return saved.numbers.length === total && seen.size === total
    && saved.numbers.every((n) => Number.isInteger(n) && n >= 1 && n <= total);
}

class Schulte {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.runningSince = 0;
    this.ticker = 0;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });

    this.refs.sizes.addEventListener('click', (e) => {
      const button = e.target.closest('[data-size]');
      if (button) this.chooseSize(Number(button.dataset.size));
    });
    this.refs.restart.addEventListener('click', () => this.requestRestart());
    this.refs.again.addEventListener('click', () => this.newGame());
    // 用按下而不是点击来判断，手指一碰到就算，计时更准
    this.refs.board.addEventListener('pointerdown', (e) => {
      const el = e.target.closest('.sch-cell');
      if (!el) return;
      e.preventDefault();
      this.tap(Number(el.dataset.i));
    });

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.newGame(DEFAULT_SIZE);
  }

  get total() {
    return this.size * this.size;
  }

  get inProgress() {
    return this.status === 'playing' || this.status === 'paused';
  }

  // ---------- 开局与存档 ----------

  chooseSize(size) {
    if (size === this.size && !this.inProgress) return;
    if (!this.confirmAbandon('换大小会放弃这一局，确定吗？')) return;
    this.newGame(size);
  }

  requestRestart() {
    if (!this.confirmAbandon('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
  }

  // 正在玩时先停表再弹确认框，点取消接着计时，犹豫的这几秒不算进用时
  confirmAbandon(message) {
    if (!this.inProgress) return true;
    this.stopClock();
    const ok = window.confirm(message);
    if (!ok) this.startClock();
    return ok;
  }

  newGame(size = this.size) {
    this.stopClock();
    this.size = size;
    this.numbers = shuffled(this.total);
    this.next = 1;
    this.elapsed = 0;
    this.mistakes = 0;
    this.status = 'ready';
    this.record = null;
    this.build();
    this.updateChrome();
    this.save();
  }

  restore(saved) {
    this.size = saved.size;
    this.numbers = saved.numbers;
    this.next = Math.min(Math.max(1, Math.floor(saved.next) || 1), this.total + 1);
    // 用时和失误必须是不小于 0 的数，不对就从 0 算，免得出现负数或字符串的用时被记成纪录
    this.elapsed = Number.isFinite(saved.elapsed) && saved.elapsed >= 0 ? saved.elapsed : 0;
    this.mistakes = Number.isInteger(saved.mistakes) && saved.mistakes >= 0 ? saved.mistakes : 0;
    this.record = saved.record ?? null;
    if (this.next > this.total) this.status = 'done';
    else if (this.next > 1 || this.elapsed > 0) this.status = 'paused'; // 上次没点完，先盖住，等点继续
    else this.status = 'ready';
    this.build();
    this.updateChrome();
  }

  save() {
    const { size, numbers, next, mistakes, status, record } = this;
    this.ctx.save(
      { size, numbers, next, mistakes, record, elapsed: Math.round(this.now()), status },
      { summary: this.summary(), finished: status === 'done' },
    );
  }

  summary() {
    const name = `${this.size}×${this.size}`;
    if (this.status === 'done') return `${name} · 用时 ${secs(this.elapsed)} 秒`;
    if (this.status === 'ready') return `${name} · 新的一局`;
    return `${name} · 找到 ${this.next - 1}/${this.total} · ${secs(this.now())} 秒`;
  }

  // ---------- 规则 ----------

  start() {
    if (this.status !== 'ready' && this.status !== 'paused') return;
    const fresh = this.status === 'ready';
    this.status = 'playing';
    this.paintAll({ reveal: fresh });
    this.startClock();
    this.updateChrome();
    this.save();
  }

  tap(i) {
    if (this.status !== 'playing') return;
    const n = this.numbers[i];
    if (n < this.next) return;
    if (n !== this.next) {
      this.mistakes += 1;
      this.shake(i);
      this.updateChrome();
      this.save();
      return;
    }
    this.next += 1;
    this.paint(i, 'pop');
    if (this.next > this.total) this.finish();
    this.updateChrome();
    this.save();
  }

  finish() {
    this.stopClock();
    this.status = 'done';
    const key = `s${this.size}`;
    const time = Math.round(this.elapsed);
    const previous = this.records[key];
    this.records[key] = this.ctx.submitRecord(key, time, { lowerIsBetter: true });
    this.record = previous === undefined ? 'first' : time < previous ? 'best' : null;
    this.ctx.runEnded?.();
  }

  // ---------- 计时 ----------

  now() {
    return this.elapsed + (this.runningSince ? performance.now() - this.runningSince : 0);
  }

  startClock() {
    if (this.runningSince || this.status !== 'playing') return;
    this.runningSince = performance.now();
    this.ticker = setInterval(() => this.renderTime(), 100);
  }

  stopClock() {
    if (!this.runningSince) return;
    this.elapsed = this.now();
    this.runningSince = 0;
    clearInterval(this.ticker);
  }

  renderTime() {
    this.refs.time.textContent = secs(this.now());
  }

  // 收起游戏页或切到后台：停表，把数字盖住，回来后点继续
  pause() {
    if (this.status !== 'playing') return;
    this.stopClock();
    this.status = 'paused';
    this.paintAll();
    this.updateChrome();
    this.save();
  }

  destroy() {
    this.stopClock();
  }

  // ---------- 画面 ----------

  build() {
    const { board } = this.refs;
    board.style.setProperty('--size', this.size);
    this.cells = this.numbers.map((_, i) => {
      const el = document.createElement('div');
      el.className = 'sch-cell';
      el.dataset.i = i;
      return el;
    });
    board.replaceChildren(...this.cells);
    this.paintAll();
  }

  // 开局前和暂停时只画空格子；reveal 时数字从中间往外依次弹出
  paint(i, effect = '') {
    const el = this.cells[i];
    const n = this.numbers[i];
    const shown = this.status === 'playing' || this.status === 'done';
    el.className = `sch-cell${shown && n < this.next ? ' is-done' : ''}${effect ? ` ${effect}` : ''}`;
    el.textContent = shown ? n : '';
  }

  paintAll({ reveal = false } = {}) {
    const mid = (this.size - 1) / 2;
    this.cells.forEach((el, i) => {
      this.paint(i, reveal ? 'is-in' : '');
      if (reveal) el.style.setProperty('--d', `${Math.hypot(Math.floor(i / this.size) - mid, (i % this.size) - mid) * 35}ms`);
    });
  }

  // 点错的格子晃一下、变红。顺便去掉入场动画的 is-in，不然晃完去掉 is-wrong 时入场动画会重播（格子消失再弹出来）
  shake(i) {
    const el = this.cells[i];
    el.classList.remove('is-wrong', 'is-in');
    void el.offsetWidth;
    el.classList.add('is-wrong');
    el.addEventListener('animationend', () => el.classList.remove('is-wrong'), { once: true });
  }

  resultNote() {
    const miss = this.mistakes ? `失误 ${this.mistakes} 次` : '没有失误';
    if (this.record === 'best') return `${miss} · 新纪录！`;
    if (this.record === 'first') return `${miss} · 第一次完成 ${this.size}×${this.size}`;
    const best = this.records[`s${this.size}`];
    return best ? `${miss} · 最快 ${secs(best)} 秒` : miss;
  }

  showOverlay() {
    const { overlay } = this.refs;
    if (this.status !== 'ready' && this.status !== 'paused') {
      overlay.hidden = true;
      return;
    }
    const best = this.records[`s${this.size}`];
    const note = this.status === 'paused'
      ? `已找到 ${this.next - 1}/${this.total} · ${secs(this.elapsed)} 秒`
      : best ? `最快 ${secs(best)} 秒` : `按顺序点 1 到 ${this.total}`;
    overlay.innerHTML = '<button class="sch-go"></button><p></p>';
    const go = overlay.querySelector('.sch-go');
    go.textContent = this.status === 'paused' ? '继续' : '开始';
    go.addEventListener('click', () => this.start());
    overlay.querySelector('p').textContent = note;
    overlay.hidden = false;
  }

  updateChrome() {
    const { sizes, next, miss, hint, result, resultTime, resultNote, board } = this.refs;
    for (const button of sizes.children) button.classList.toggle('is-active', Number(button.dataset.size) === this.size);
    const done = this.status === 'done';
    next.textContent = done ? '完成' : this.next;
    miss.textContent = this.mistakes;
    this.renderTime();
    hint.hidden = this.status !== 'ready';
    result.hidden = !done;
    resultTime.textContent = done ? `用时 ${secs(this.elapsed)} 秒` : '';
    resultNote.textContent = done ? this.resultNote() : '';
    board.classList.toggle('is-finished', done);
    this.showOverlay();
  }
}

export default {
  guide,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Schulte(root, ctx);
    return {
      pause: () => game.pause(),
      destroy: () => game.destroy(),
    };
  },
};
