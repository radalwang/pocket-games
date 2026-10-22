// 合数：点一组相连的相同数字选中，再点一次就合成一个大 1 的数，目标是合到 10。
// 第二下点在组里哪一格，新数字就出现在哪一格；组里其余的格子被吃掉，上面的数字落下来，顶上补新数字。
// 棋盘上找不到两个相邻的相同数字时，这一局结束。接口说明见 js/player.js。

const SIZE = 5;
const GOAL = 10;
const GATHER_MS = 130;
const FALL_EASE = 'cubic-bezier(0.5, 0, 0.8, 0.4)';
const NEIGHBORS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const HINT = '点一组相连的相同数字选中，再点一次合并';
const RESTART = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';

const fmt = (n) => n.toLocaleString('zh-CN');
const inside = (r, c) => r >= 0 && r < SIZE && c >= 0 && c < SIZE;
// 落 d 格要多久：越远越久，但不会拖太长
const fallMs = (d) => 110 + 45 * d;
// 方块和进度条共用的配色，12 以上统一用最深的一档
const valueClass = (n) => `v${n > 12 ? 'max' : n} d${String(n).length}`;

// 新数字的范围跟着棋盘上的最大数走：上限是最大数减 2（至少是 3），往下一共 4 个数，
// 最大数到 8 以后收窄成 3 个；越小的数越常见。这样小数字会渐渐不再出现，剩在棋盘上的要想办法消化掉。
// 这组参数是拿模拟对局调出来的：一个只看一步的简单玩法，大约三成能合到 10。
function randomValue(max) {
  const hi = Math.max(3, max - 2);
  const lo = Math.max(1, hi - (max < 8 ? 3 : 2));
  const n = hi - lo + 1;
  let x = Math.random() * ((n * (n + 1)) / 2);
  for (let v = lo; v < hi; v++) {
    x -= hi - v + 1;
    if (x < 0) return v;
  }
  return hi;
}

// 有没有两个相邻的相同数字，也就是还能不能合并
function hasPair(values) {
  return values.some((v, i) => (i % SIZE < SIZE - 1 && values[i + 1] === v) || values[i + SIZE] === v);
}

const TEMPLATE = `
  <div class="gmerge">
    <div class="gmerge-top">
      <div class="gmerge-score"><span>分数</span><strong data-ref="score">0</strong></div>
      <div class="gmerge-score"><span>最高</span><strong data-ref="best">0</strong></div>
      <button class="gmerge-new" data-ref="newGame">${RESTART}新游戏</button>
    </div>
    <div class="gmerge-ladder" data-ref="ladder" aria-label="合到 ${GOAL} 的进度"></div>
    <div class="gmerge-board" data-ref="board">
      <div class="gmerge-cells">${'<div></div>'.repeat(SIZE * SIZE)}</div>
      <div class="gmerge-tiles" data-ref="tiles"></div>
      <div class="gmerge-overlay" data-ref="overlay" hidden></div>
    </div>
    <p class="gmerge-hint" data-ref="hint">${HINT}</p>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="merge"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'merge';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

const isValidSave = (saved) =>
  Array.isArray(saved?.cells) && saved.cells.length === SIZE * SIZE && saved.cells.every((v) => Number.isInteger(v) && v > 0);
// 存档里的分数这类数应该是非负整数，不是的话就不用它
const isCount = (n) => Number.isInteger(n) && n >= 0;

class Game {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.best = ctx.records.score ?? 0;
    this.grid = [];
    this.byEl = new WeakMap(); // 方块元素 → { value, r, c, el }
    this.picked = null; // 选中的那一组
    this.timers = new Set();
    this.pending = null; // 收拢之后“变数字、往下落”那一段动画

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.refs.newGame.addEventListener('click', () => this.requestNewGame());
    this.refs.tiles.addEventListener('click', (e) => this.onTap(e));

    if (isValidSave(ctx.saved)) this.restore(ctx.saved);
    else this.newGame();
  }

  requestNewGame() {
    const playing = this.score > 0 && !this.over;
    if (playing && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.newGame();
  }

  newGame() {
    // 新开一局时告诉外壳：分数是边玩边报的，上一局中途破了纪录又放弃的话，不清掉会让这一局结束时误报「新纪录！」
    this.ctx.runStarted?.();
    let cells;
    do {
      cells = Array.from({ length: SIZE * SIZE }, () => randomValue(4));
    } while (!hasPair(cells));
    this.build(cells);
    this.score = 0;
    this.peak = 0; // 这一局合出来过的最大数，成绩记的是它
    this.won = false;
    this.keepPlaying = false;
    this.over = false;
    this.bestBefore = this.best;
    this.hideOverlay();
    this.updateScores();
    this.updateLadder();
    this.save();
  }

  restore(saved) {
    this.build(saved.cells);
    this.score = isCount(saved.score) ? saved.score : 0;
    // 旧存档没记这一项，就用棋盘上的最大数；它不会比棋盘上的最大数还大
    this.peak = isCount(saved.peak) && saved.peak <= this.maxValue() ? saved.peak : this.maxValue();
    this.won = Boolean(saved.won);
    this.keepPlaying = Boolean(saved.keepPlaying);
    // 旧版本可能存下了“合到 10 后没有能合的、却没判结束”的局面，这里重新判断一次，并把结果存回去
    const stuck = !saved.over && !hasPair(this.values());
    this.over = Boolean(saved.over) || stuck;
    this.bestBefore = isCount(saved.bestBefore) ? saved.bestBefore : this.best;
    this.updateScores();
    this.updateLadder();
    if (stuck) this.save();
    if (this.over) this.showOver();
    else if (this.won && !this.keepPlaying) this.showWin();
  }

  build(cells) {
    this.stopAnimations();
    this.picked = null;
    this.refs.board.classList.remove('has-pick');
    this.refs.hint.textContent = HINT;
    this.refs.tiles.replaceChildren();
    this.grid = Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
    cells.forEach((value, i) => {
      const tile = this.createTile(value, Math.floor(i / SIZE), i % SIZE);
      this.place(tile);
      this.refs.tiles.append(tile.el);
    });
  }

  // 建一个方块放进棋盘数据里，但先不放到页面上：补进来的新数字要等上一段动画播完才出现
  createTile(value, r, c) {
    const el = document.createElement('div');
    el.className = 'gmerge-tile';
    el.append(document.createElement('div'));
    // 弹一下、抖一下播完就把类去掉，留着的话会一直盖住选中时的呼吸，下次换另一个动画也播不出来
    el.addEventListener('animationend', () => el.classList.remove('is-merged', 'is-alone'));
    const tile = { value, r, c, el };
    this.byEl.set(el, tile);
    this.grid[r][c] = tile;
    this.paint(tile);
    return tile;
  }

  paint(tile) {
    tile.el.firstChild.className = `gmerge-face ${valueClass(tile.value)}`;
    tile.el.firstChild.textContent = tile.value;
  }

  // 方块位置由 --r、--c 决定，改变它们时会用 ms 毫秒滑过去
  place(tile, ms = GATHER_MS, ease = 'ease-out') {
    const { style } = tile.el;
    style.setProperty('--r', tile.r);
    style.setProperty('--c', tile.c);
    style.setProperty('--t', `${ms}ms`);
    style.setProperty('--tf', ease);
  }

  tiles() {
    return this.grid.flat().filter(Boolean);
  }

  values() {
    return this.grid.flat().map((tile) => tile.value);
  }

  maxValue() {
    return Math.max(...this.tiles().map((tile) => tile.value));
  }

  onTap(e) {
    const tile = this.byEl.get(e.target.closest('.gmerge-tile'));
    // 已经被吃掉、正在淡出的格子不算
    if (!tile || this.grid[tile.r][tile.c] !== tile) return;
    if (this.over || (this.won && !this.keepPlaying)) return;
    this.flush();
    if (this.picked?.includes(tile)) {
      this.merge(tile);
      return;
    }
    const group = this.groupOf(tile);
    if (group.length < 2) {
      this.unpick();
      this.shake(tile);
      this.refs.hint.textContent = '要有两个以上相同的数字连在一起才能合并';
      return;
    }
    this.pick(group);
  }

  // 和这一格上下左右相连、数字相同的所有格子
  groupOf(start) {
    const group = [start];
    const seen = new Set(group);
    for (let i = 0; i < group.length; i++) {
      const { r, c } = group[i];
      for (const [dr, dc] of NEIGHBORS) {
        const next = inside(r + dr, c + dc) ? this.grid[r + dr][c + dc] : null;
        if (next && next.value === start.value && !seen.has(next)) {
          seen.add(next);
          group.push(next);
        }
      }
    }
    return group;
  }

  pick(group) {
    this.unpick();
    this.picked = group;
    for (const tile of group) tile.el.classList.add('is-picked');
    this.refs.board.classList.add('has-pick');
    this.refs.hint.textContent = `再点一次组里的任意一格，在那里合成 ${group[0].value + 1}`;
  }

  unpick() {
    if (!this.picked) return;
    for (const tile of this.picked) tile.el.classList.remove('is-picked');
    this.picked = null;
    this.refs.board.classList.remove('has-pick');
    this.refs.hint.textContent = HINT;
  }

  // 让一个动画类重新播一遍
  replay(tile, name) {
    tile.el.classList.remove(name);
    void tile.el.offsetWidth;
    tile.el.classList.add(name);
  }

  shake(tile) {
    this.replay(tile, 'is-alone');
  }

  merge(target) {
    const group = this.picked;
    this.unpick();
    const gained = (target.value + 1) * group.length * 10; // 合成出的数 × 参与的格子数 × 10

    // 组里其余的格子滑向目标格并淡出
    const eaten = group.filter((tile) => tile !== target);
    for (const tile of eaten) {
      this.grid[tile.r][tile.c] = null;
      tile.r = target.r;
      tile.c = target.c;
      tile.el.classList.add('is-gone');
      this.place(tile, GATHER_MS, 'ease-in');
    }
    target.value += 1;
    this.peak = Math.max(this.peak, target.value);

    // 局面马上算好并存档，这样动画播到一半收起或退出也不会丢；画面上等收拢完再变数字、往下落
    const { falling, fresh } = this.drop();
    this.score += gained;
    this.best = this.ctx.submitRecord('score', this.score);
    this.ctx.submitRecord('max', this.peak);
    const reachedGoal = !this.won && this.peak >= GOAL;
    if (reachedGoal) this.won = true;
    // 合到目标的这一步也可能刚好没有能合的了，要一起判断，否则点“继续挑战”后会卡住
    if (!hasPair(this.values())) this.over = true;
    this.updateScores();
    this.save();
    // 一局结束时告诉外壳，破了纪录的话外壳会弹出「新纪录！」
    if (this.over) this.ctx.runEnded?.();

    this.schedule(GATHER_MS, () => {
      for (const tile of eaten) tile.el.remove();
      this.paint(target);
      this.replay(target, 'is-merged');

      let longest = 0;
      for (const { tile, distance } of falling) {
        this.place(tile, fallMs(distance), FALL_EASE);
        longest = Math.max(longest, fallMs(distance));
      }
      // 新数字先摆在棋盘上方（被棋盘边缘挡住），再落进来
      for (const { tile, distance } of fresh) {
        tile.el.style.setProperty('--r', tile.r - distance);
        tile.el.style.setProperty('--c', tile.c);
        this.refs.tiles.append(tile.el);
      }
      void this.refs.tiles.offsetWidth;
      for (const { tile, distance } of fresh) {
        this.place(tile, fallMs(distance), FALL_EASE);
        longest = Math.max(longest, fallMs(distance));
      }
      this.updateLadder();

      if (this.over) this.later(longest + 120, () => this.showOver());
      else if (reachedGoal) this.later(longest + 120, () => this.showWin());
    });
  }

  // 每一列的数字往下落，填满空格；顶上空出来的位置补新数字
  drop() {
    const max = this.maxValue();
    const falling = [];
    const fresh = [];
    for (let c = 0; c < SIZE; c++) {
      let bottom = SIZE - 1;
      for (let r = SIZE - 1; r >= 0; r--) {
        const tile = this.grid[r][c];
        if (!tile) continue;
        if (r !== bottom) {
          this.grid[r][c] = null;
          this.grid[bottom][c] = tile;
          tile.r = bottom;
          falling.push({ tile, distance: bottom - r });
        }
        bottom--;
      }
      const empty = bottom + 1;
      for (let r = 0; r < empty; r++) fresh.push({ tile: this.createTile(randomValue(max), r, c), distance: empty });
    }
    return { falling, fresh };
  }

  later(ms, fn) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      fn();
    }, ms);
    this.timers.add(id);
  }

  // 排一段之后要播的动画；玩家点得快时，下一次点击会先把它直接播完，不用干等
  schedule(ms, fn) {
    const step = { fn };
    this.pending = step;
    this.later(ms, () => {
      if (this.pending === step) this.flush();
    });
  }

  flush() {
    const step = this.pending;
    this.pending = null;
    step?.fn();
  }

  stopAnimations() {
    for (const id of this.timers) clearTimeout(id);
    this.timers.clear();
    this.pending = null;
  }

  updateScores() {
    for (const [el, value] of [[this.refs.score, this.score], [this.refs.best, this.best]]) {
      el.textContent = fmt(value);
      // 六位数以上缩小字号，免得把分数栏撑出棋盘
      el.classList.toggle('is-long', el.textContent.length > 6);
    }
  }

  // 进度条：排着 1 到 10，这一局合出来过的最大数以内的都点亮；超过 10 以后整排往后挪
  updateLadder() {
    const { peak } = this;
    const first = Math.max(GOAL, peak) - GOAL + 1;
    this.refs.ladder.innerHTML = Array.from({ length: GOAL }, (_, i) => {
      const n = first + i;
      const state = n <= peak ? `is-reached ${valueClass(n)}` : n === GOAL ? 'is-goal' : '';
      return `<span class="gmerge-step ${state}">${n}</span>`;
    }).join('');
  }

  save() {
    const { score, peak, won, keepPlaying, over, bestBefore } = this;
    this.ctx.save({ cells: this.values(), score, peak, won, keepPlaying, over, bestBefore }, {
      summary: over ? `本局结束 · ${fmt(score)} 分` : `${fmt(score)} 分 · 最大 ${this.maxValue()}`,
      finished: over,
    });
  }

  showOverlay(title, text, actions) {
    const { overlay } = this.refs;
    overlay.innerHTML = '<h3></h3><p></p><div class="gmerge-actions"></div>';
    overlay.querySelector('h3').textContent = title;
    overlay.querySelector('p').textContent = text;
    const row = overlay.querySelector('.gmerge-actions');
    for (const { label, primary, onClick } of actions) {
      const button = document.createElement('button');
      button.className = primary ? 'gmerge-btn is-primary' : 'gmerge-btn';
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
    this.showOverlay(`合到 ${GOAL} 了！`, `现在 ${fmt(this.score)} 分，可以继续往上合`, [
      // 赢了不再接着合，这一局就到此结束；接着合的话等没有能合的了再算结束
      {
        label: '新游戏',
        onClick: () => {
          this.ctx.runEnded?.();
          this.newGame();
        },
      },
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
    this.showOverlay('没有可以合并的数字了', `这一局合到了 ${this.peak}，得 ${fmt(this.score)} 分${record ? '，刷新了最高分！' : '。'}`, [
      { label: '再来一局', primary: true, onClick: () => this.newGame() },
    ]);
  }

  destroy() {
    this.stopAnimations();
  }
}

// 玩法说明：外壳第一次打开这个游戏时、或点标题栏的“?”时一页页显示。
// 配图是简化的棋盘，数字的颜色取自游戏里每个数字渐变的中间色；中性的底色、文字和线条用外壳的颜色变量，深色模式下也看得清。
const GUIDE_COLORS = [null, '#4dbdf8', '#4fd07a', '#ffcf45', '#ff9446', '#ff5c68', '#f25faa', '#b06ef8', '#716fec', '#2bb9ae', '#ffb62f'];

// color 是颜色值，或者外壳的颜色变量名（比如 --label-2）
const guidePaint = (color) => (color.startsWith('--') ? `style="fill:var(${color})"` : `fill="${color}"`);

function guideText(x, y, text, { size, color, weight = 800, anchor = 'middle' }) {
  return `<text x="${x}" y="${y}" font-family="ui-rounded, -apple-system, system-ui, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central" ${guidePaint(color)}>${text}</text>`;
}

// 一个数字方块；mark 是 pick（选中，描白边）、dim（没选中，变淡）或 pop（刚合出来，外面一圈光）
function guideTile(x, y, size, n, mark) {
  const color = GUIDE_COLORS[n];
  const rx = Math.round(size / 4);
  let out = '';
  if (mark === 'pop') out += `<rect x="${x - 3.5}" y="${y - 3.5}" width="${size + 7}" height="${size + 7}" rx="${rx + 3}" fill="none" stroke="${color}" stroke-width="2.5" stroke-opacity="0.5"/>`;
  out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${rx}" fill="${color}"/>`;
  if (mark === 'pick') out += `<rect x="${x + 1.5}" y="${y + 1.5}" width="${size - 3}" height="${size - 3}" rx="${rx - 1.5}" fill="none" stroke="#fff" stroke-width="3"/>`;
  out += guideText(x + size / 2, y + size / 2, n, { size: Math.round(size * (n > 9 ? 0.4 : 0.5)), color: n === 3 ? '#8a5300' : '#fff' });
  return mark === 'dim' ? `<g opacity="0.4">${out}</g>` : out;
}

// 一块棋盘：rows 是每一行的数字，marks 按 'r,c' 标出特殊的格子，rest 是其余格子的标记
function guideBoard(x, y, cell, gap, rows, marks = {}) {
  const width = rows[0].length * (cell + gap) + gap;
  const height = rows.length * (cell + gap) + gap;
  let out = `<rect x="${x}" y="${y}" width="${width}" height="${height}" rx="${gap * 2}" style="fill:var(--fill)"/>`;
  rows.forEach((row, r) => row.forEach((n, c) => {
    out += guideTile(x + gap + c * (cell + gap), y + gap + r * (cell + gap), cell, n, marks[`${r},${c}`] ?? marks.rest);
  }));
  return out;
}

// 棋盘上第 i 行（列）格子的中心，用来摆点击标记
const guideCenter = (start, cell, gap, i) => start + gap + i * (cell + gap) + cell / 2;

const guideTap = (x, y) => `<circle cx="${x}" cy="${y}" r="14" fill="#fff" fill-opacity="0.7" stroke="#000" stroke-opacity="0.18" stroke-width="1.5"/>`;

const guideArrow = (x1, x2, y) =>
  `<path d="M${x1} ${y}H${x2}M${x2 - 7} ${y - 7}L${x2} ${y}L${x2 - 7} ${y + 7}" fill="none" style="stroke:var(--label-2)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;

// 进度条：1 到 10，peak 以内的点亮，10 用虚线框标成目标
function guideLadder(x, y, peak) {
  let out = '';
  for (let n = 1; n <= GOAL; n++) {
    const left = x + (n - 1) * 28;
    if (n <= peak) {
      out += `<rect x="${left}" y="${y}" width="24" height="24" rx="6" fill="${GUIDE_COLORS[n]}"/>`;
      out += guideText(left + 12, y + 12, n, { size: 12, color: n === 3 ? '#8a5300' : '#fff' });
    } else if (n === GOAL) {
      out += `<rect x="${left + 1}" y="${y + 1}" width="22" height="22" rx="5" fill="none" style="stroke:var(--label-2)" stroke-width="2" stroke-dasharray="3 3"/>`;
      out += guideText(left + 12, y + 12, n, { size: 12, color: '--label-2' });
    } else {
      out += `<rect x="${left}" y="${y}" width="24" height="24" rx="6" style="fill:var(--fill)"/>`;
      out += guideText(left + 12, y + 12, n, { size: 12, color: '--label-3' });
    }
  }
  return out;
}

function guideScore(y, label, value) {
  return `<rect x="184" y="${y}" width="100" height="32" rx="10" style="fill:var(--fill)"/>${guideText(196, y + 16, label, { size: 11, weight: 600, anchor: 'start', color: '--label-2' })}${guideText(274, y + 16, value, { size: 16, anchor: 'end', color: '--label' })}`;
}

const guideArt = (body) => `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const PICKED_THREES = { '1,0': 'pick', '1,1': 'pick', '2,1': 'pick', rest: 'dim' };

const GUIDE = [
  {
    title: '合到10',
    text: '相连的相同数字能合成更大的数，合到 10 就赢了，还可以接着往上合。',
    art: guideArt(
      guideTile(30, 60, 50, 9) +
        guideTile(86, 60, 50, 9) +
        guideText(169, 67, '+1', { size: 15, color: '--label-2' }) +
        guideArrow(152, 186, 85) +
        '<rect x="198" y="46" width="78" height="78" rx="22" fill="#ffb62f" fill-opacity="0.22"/>' +
        guideTile(204, 52, 66, 10),
    ),
  },
  {
    title: '选中一组',
    text: '点一下连在一起的相同数字，至少两个，整组会描上白边、轻轻跳动。',
    art: guideArt(
      guideBoard(59, 16, 38, 6, [[2, 1, 4, 2], [3, 3, 1, 4], [1, 3, 2, 1]], PICKED_THREES) +
        guideTap(guideCenter(59, 38, 6, 1), guideCenter(16, 38, 6, 1)),
    ),
  },
  {
    title: '再点合并',
    // 点的是最下面那个 3：合成的 4 留在那格，左边两列上面的数字各落一格，顶上补两个新数字
    text: '再点组里任意一格，整组就在那格合成大 1 的数，上面的落下，顶上补新数。',
    art: guideArt(
      guideBoard(18, 34, 30, 5, [[1, 2, 4], [3, 3, 1], [2, 3, 4]], PICKED_THREES) +
        guideTap(guideCenter(18, 30, 5, 1), guideCenter(34, 30, 5, 2)) +
        guideArrow(140, 164, 89) +
        guideBoard(172, 34, 30, 5, [[3, 1, 4], [1, 2, 1], [2, 4, 4]], { '2,1': 'pop' }) +
        [0, 1].map((c) => {
          const x = guideCenter(172, 30, 5, c);
          return `<path d="M${x - 6} 19l6 6l6 -6" fill="none" style="stroke:var(--label-2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
        }).join(''),
    ),
  },
  {
    title: '进度和结束',
    text: '上面那排小格随合出的数点亮，一次合得越多分越高。没有相邻的相同数字时，这一局结束。',
    art: guideArt(
      guideLadder(12, 16, 6) +
        guideBoard(16, 72, 30, 5, [[5, 2, 6, 3], [3, 4, 2, 5]]) +
        guideScore(72, '分数', '1,240') +
        guideScore(113, '最高', '2,860'),
    ),
  },
];

export default {
  guide: GUIDE,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Game(root, ctx);
    return {
      destroy: () => game.destroy(),
    };
  },
};
