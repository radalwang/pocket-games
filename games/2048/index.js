// 2048：在 4×4 棋盘上滑动，相同数字的方块碰到一起会合并。
// 这也是游戏模块的参考写法：导出 mount(root, ctx)，返回 { pause, resume, destroy }（接口说明见 js/player.js）。

const SIZE = 4;
const SLIDE_MS = 110;
const DIRS = { left: [0, -1], right: [0, 1], up: [-1, 0], down: [1, 0] };
const KEYS = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  a: 'left', d: 'right', w: 'up', s: 'down',
};

const fmt = (n) => n.toLocaleString('zh-CN');
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;

const TEMPLATE = `
  <div class="g2048">
    <div class="g2048-top">
      <div class="g2048-score"><span>分数</span><strong data-ref="score">0</strong></div>
      <div class="g2048-score"><span>最高</span><strong data-ref="best">0</strong></div>
      <button class="g2048-new" data-ref="newGame">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>
        新游戏
      </button>
    </div>
    <div class="g2048-board">
      <div class="g2048-cells">${'<div></div>'.repeat(SIZE * SIZE)}</div>
      <div class="g2048-tiles" data-ref="tiles"></div>
      <div class="g2048-overlay" data-ref="overlay" hidden></div>
    </div>
    <p class="g2048-hint">滑动来移动方块，相同数字碰到一起会合并</p>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="2048"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = '2048';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

const isValidSave = (saved) => Array.isArray(saved?.cells) && saved.cells.length === SIZE * SIZE;

class Game {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.best = ctx.records.score ?? 0;
    this.tiles = new Map(); // id → { id, value, r, c, el }
    this.retiring = []; // 合并掉的方块，滑完动画后移除
    this.nextId = 1;
    this.timer = 0;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.refs.newGame.addEventListener('click', () => this.requestNewGame());
    this.onKey = this.onKey.bind(this);
    this.bindSwipe(root);

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.newGame();
  }

  requestNewGame() {
    const playing = this.score > 0 && !this.over;
    if (playing && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
  }

  newGame() {
    this.clearBoard();
    this.score = 0;
    this.won = false;
    this.keepPlaying = false;
    this.over = false;
    this.bestBefore = this.best;
    this.spawn();
    this.spawn();
    this.hideOverlay();
    this.updateScores();
    this.save();
  }

  restore(saved) {
    this.clearBoard();
    saved.cells.forEach((value, i) => {
      if (value) this.addTile(value, Math.floor(i / SIZE), i % SIZE);
    });
    this.score = saved.score || 0;
    this.won = Boolean(saved.won);
    this.keepPlaying = Boolean(saved.keepPlaying);
    this.over = Boolean(saved.over);
    this.bestBefore = saved.bestBefore ?? this.best;
    this.updateScores();
    if (this.over) this.showOver();
    else if (this.won && !this.keepPlaying) this.showWin();
  }

  clearBoard() {
    clearTimeout(this.timer);
    this.tiles.clear();
    this.retiring = [];
    this.refs.tiles.replaceChildren();
  }

  addTile(value, r, c, effect) {
    const el = document.createElement('div');
    el.className = effect ? `g2048-tile ${effect}` : 'g2048-tile';
    el.append(document.createElement('div'));
    const tile = { id: this.nextId++, value, r, c, el };
    this.place(tile);
    this.refs.tiles.append(el);
    this.tiles.set(tile.id, tile);
    return tile;
  }

  place(tile) {
    const { el, value } = tile;
    el.style.setProperty('--r', tile.r);
    el.style.setProperty('--c', tile.c);
    el.firstChild.className = `g2048-face v${value > 2048 ? 'max' : value} d${String(value).length}`;
    el.firstChild.textContent = value;
  }

  grid() {
    const grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    for (const tile of this.tiles.values()) grid[tile.r][tile.c] = tile;
    return grid;
  }

  spawn() {
    const grid = this.grid();
    const empty = [];
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) if (!grid[r][c]) empty.push([r, c]);
    }
    if (!empty.length) return;
    const [r, c] = empty[Math.floor(Math.random() * empty.length)];
    this.addTile(Math.random() < 0.9 ? 2 : 4, r, c, 'is-new');
  }

  retire(tile, r, c) {
    tile.r = r;
    tile.c = c;
    this.place(tile);
    this.tiles.delete(tile.id);
    this.retiring.push(tile);
  }

  dropRetiring() {
    for (const tile of this.retiring) tile.el.remove();
    this.retiring = [];
  }

  // 连续快速滑动时，先把上一步没播完的动画收尾
  settle() {
    clearTimeout(this.timer);
    this.dropRetiring();
    for (const tile of this.tiles.values()) tile.el.classList.remove('is-new', 'is-merged');
  }

  move(dir) {
    if (this.over || (this.won && !this.keepPlaying)) return;
    this.settle();

    const [dr, dc] = DIRS[dir];
    const order = [0, 1, 2, 3];
    const rows = dr > 0 ? [...order].reverse() : order;
    const cols = dc > 0 ? [...order].reverse() : order;
    const grid = this.grid();
    const mergedThisMove = new Set();
    let moved = false;
    let gained = 0;

    for (const r of rows) {
      for (const c of cols) {
        const tile = grid[r][c];
        if (!tile) continue;
        let nr = r;
        let nc = c;
        while (inside(nr + dr, nc + dc) && !grid[nr + dr][nc + dc]) {
          nr += dr;
          nc += dc;
        }
        const tr = nr + dr;
        const tc = nc + dc;
        const target = inside(tr, tc) ? grid[tr][tc] : null;
        grid[r][c] = null;

        if (target && target.value === tile.value && !mergedThisMove.has(target.id)) {
          this.retire(tile, tr, tc);
          this.retire(target, tr, tc);
          const merged = this.addTile(tile.value * 2, tr, tc, 'is-merged');
          grid[tr][tc] = merged;
          mergedThisMove.add(merged.id);
          gained += merged.value;
          moved = true;
        } else {
          grid[nr][nc] = tile;
          if (nr !== r || nc !== c) {
            tile.r = nr;
            tile.c = nc;
            this.place(tile);
            moved = true;
          }
        }
      }
    }
    if (!moved) return;

    this.score += gained;
    this.best = this.ctx.submitRecord('score', this.score);
    this.spawn();
    this.updateScores();
    this.timer = setTimeout(() => this.dropRetiring(), SLIDE_MS + 30);

    if (!this.won && this.maxTile() >= 2048) {
      this.won = true;
      this.showWin();
    } else if (!this.canMove()) {
      this.over = true;
      this.showOver();
    }
    this.save();
  }

  maxTile() {
    let max = 0;
    for (const tile of this.tiles.values()) max = Math.max(max, tile.value);
    return max;
  }

  canMove() {
    const grid = this.grid();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = grid[r][c];
        if (!tile) return true;
        if (c + 1 < SIZE && grid[r][c + 1]?.value === tile.value) return true;
        if (r + 1 < SIZE && grid[r + 1][c]?.value === tile.value) return true;
      }
    }
    return false;
  }

  updateScores() {
    this.refs.score.textContent = fmt(this.score);
    this.refs.best.textContent = fmt(this.best);
  }

  save() {
    const cells = Array(SIZE * SIZE).fill(0);
    for (const tile of this.tiles.values()) cells[tile.r * SIZE + tile.c] = tile.value;
    const { score, won, keepPlaying, over, bestBefore } = this;
    this.ctx.save({ cells, score, won, keepPlaying, over, bestBefore }, {
      summary: over ? `本局结束 · ${fmt(score)} 分` : `${fmt(score)} 分 · 最大方块 ${this.maxTile()}`,
      finished: over,
    });
  }

  showOverlay(title, text, actions) {
    const { overlay } = this.refs;
    overlay.innerHTML = '<h3></h3><p></p><div class="g2048-actions"></div>';
    overlay.querySelector('h3').textContent = title;
    overlay.querySelector('p').textContent = text;
    const row = overlay.querySelector('.g2048-actions');
    for (const { label, primary, onClick } of actions) {
      const button = document.createElement('button');
      button.className = primary ? 'g2048-btn is-primary' : 'g2048-btn';
      button.textContent = label;
      button.addEventListener('click', onClick);
      row.append(button);
    }
    overlay.hidden = false;
  }

  hideOverlay() {
    this.refs.overlay.hidden = true;
  }

  showWin() {
    this.showOverlay('凑出 2048 了！', `现在 ${fmt(this.score)} 分，可以继续挑战更大的数字`, [
      { label: '新游戏', onClick: () => this.newGame() },
      {
        label: '继续挑战',
        primary: true,
        onClick: () => {
          this.keepPlaying = true;
          this.hideOverlay();
          this.save();
        },
      },
    ]);
  }

  showOver() {
    const record = this.bestBefore > 0 && this.score > this.bestBefore;
    this.showOverlay('没有可以移动的方块了', `这一局 ${fmt(this.score)} 分${record ? '，刷新了最高分！' : '。'}`, [
      { label: '再来一局', primary: true, onClick: () => this.newGame() },
    ]);
  }

  bindSwipe(root) {
    let start = null;
    root.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button')) return;
      start = { id: e.pointerId, x: e.clientX, y: e.clientY };
    });
    root.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      if (Math.abs(dx) > Math.abs(dy)) this.move(dx > 0 ? 'right' : 'left');
      else this.move(dy > 0 ? 'down' : 'up');
    });
    root.addEventListener('pointercancel', () => {
      start = null;
    });
  }

  setKeyboard(on) {
    if (on) document.addEventListener('keydown', this.onKey);
    else document.removeEventListener('keydown', this.onKey);
  }

  onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    const dir = KEYS[e.key];
    if (!dir) return;
    e.preventDefault();
    this.move(dir);
  }

  destroy() {
    this.setKeyboard(false);
    clearTimeout(this.timer);
  }
}

export default {
  async mount(root, ctx) {
    await loadStyles();
    const game = new Game(root, ctx);
    return {
      pause: () => game.setKeyboard(false),
      resume: () => game.setKeyboard(true),
      destroy: () => game.destroy(),
    };
  },
};
