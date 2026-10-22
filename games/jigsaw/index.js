// 拼图：把底下托盘里的块拖到画板上，放到它该在的位置附近就会吸住，全部拼好就过关。
// 没想好放哪的块可以先随手放在画板上，拖回托盘就收起来。
// 图片可以用内置的插画，也可以从相册选一张照片；照片存在存档里，只留在这台设备上。
// 切块在 pieces.js，内置插画和读照片在 pictures.js，玩法介绍在 guide.js。接口说明见 js/player.js。

import guide from './guide.js';
import { ADD_PHOTO, CLOSE, EDGES, EYE, GATHER, PICTURE, SWAP } from './icons.js';
import { cut, GRIDS, isBorder, TAB, tracePiece } from './pieces.js';
import { getPicture, loadImage, loadPhoto, PICTURES, renderPicture } from './pictures.js';

const LEVELS = { easy: '初级', medium: '中级', hard: '高级' };
// 内置插画画多宽（像素），手机上画板最宽大约 1000 物理像素，这样够清楚
const SOURCE_WIDTH = 900;
// 托盘里每块最大多少像素
const TRAY_PIECE = 76;
// 从托盘拖出来时，块在手指上方一点，免得被手指挡住
const FINGER_LIFT = 30;
// 离正确位置多近就吸住（以格子短边为 1）
const SNAP = 0.3;

function clock(ms) {
  const seconds = Math.floor(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

const TEMPLATE = `
  <div class="jg">
    <div class="jg-seg" data-ref="levels">
      ${Object.entries(LEVELS).map(([key, name]) => `<button data-level="${key}">${name}</button>`).join('')}
    </div>
    <div class="jg-top">
      <div class="jg-stat"><span>已拼</span><strong data-ref="count">0/0</strong></div>
      <div class="jg-stat"><span>用时</span><strong data-ref="time">0:00</strong></div>
      <button class="jg-new" data-ref="change">${SWAP}换图</button>
    </div>
    <div class="jg-stage" data-ref="stage">
      <div class="jg-board" data-ref="board">
        <canvas class="jg-picture" data-ref="picture"></canvas>
        <div class="jg-placed" data-ref="placed"></div>
      </div>
    </div>
    <div class="jg-bottom" data-ref="bottom">
      <div class="jg-controls">
        <div class="jg-tools">
          <button data-tool="ghost">${PICTURE}<span>底图</span><i class="jg-badge" data-ref="ghostBadge">开</i></button>
          <button data-tool="peek" data-ref="peek">${EYE}<span>按住看原图</span></button>
          <button data-tool="edges" data-ref="edgesTool">${EDGES}<span>只看边缘</span><i class="jg-badge" data-ref="edgesBadge">关</i></button>
          <button data-tool="gather" data-ref="gather">${GATHER}<span>收回托盘</span></button>
        </div>
        <div class="jg-tray" data-ref="tray">
          <div class="jg-tray-row" data-ref="trayRow"></div>
          <p class="jg-tray-empty" data-ref="trayEmpty" hidden></p>
        </div>
      </div>
      <div class="jg-result" data-ref="result" hidden>
        <span data-ref="resultText"></span>
        <button class="jg-again" data-ref="again">换一张</button>
      </div>
    </div>
    <div class="jg-float" data-ref="float"></div>
    <div class="jg-picker" data-ref="picker" hidden>
      <div class="jg-picker-head">
        <h3>选一张图</h3>
        <button class="jg-picker-close" data-ref="closePicker" aria-label="关闭">${CLOSE}</button>
      </div>
      <div class="jg-picker-grid" data-ref="grid"></div>
      <p class="jg-picker-note" data-ref="pickerNote"></p>
      <input type="file" accept="image/*" data-ref="file" hidden>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="jigsaw"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'jigsaw';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

const isPiece = (p) => p && (p.at === 'tray' || p.at === 'placed' || (p.at === 'loose' && Number.isFinite(p.x) && Number.isFinite(p.y)));
const isPhoto = (photo) => typeof photo === 'string' && photo.startsWith('data:image/');

function isValidSave(saved) {
  const grid = LEVELS[saved?.level] && GRIDS[saved.level];
  if (!grid) return false;
  const picture = saved.picture === 'photo' ? isPhoto(saved.photo) : Boolean(getPicture(saved.picture));
  return picture && Number.isInteger(saved.seed) && Array.isArray(saved.pieces)
    && saved.pieces.length === grid[0] * grid[1] && saved.pieces.every(isPiece);
}

class Jigsaw {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.active = false;
    this.runningSince = 0;
    this.ticker = 0;
    this.drag = null;
    this.metrics = null;
    this.thumbs = null;
    this.token = 0;
    this.photoTicket = 0;
    this.z = 1;

    root.innerHTML = TEMPLATE;
    this.root = root.firstElementChild;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });

    this.refs.levels.addEventListener('click', (e) => {
      const button = e.target.closest('[data-level]');
      if (button) this.chooseLevel(button.dataset.level);
    });
    root.querySelector('.jg-tools').addEventListener('click', (e) => {
      const tool = e.target.closest('[data-tool]')?.dataset.tool;
      if (tool === 'ghost') this.toggle('ghost');
      else if (tool === 'edges') this.toggle('edgesOnly');
      else if (tool === 'gather') this.gather();
    });
    // 原图要按住才显示，松手就收起
    this.refs.peek.addEventListener('pointerdown', () => this.root.classList.add('is-peek'));
    this.refs.change.addEventListener('click', () => this.openPicker());
    this.refs.again.addEventListener('click', () => this.openPicker());
    this.refs.closePicker.addEventListener('click', () => this.closePicker());
    this.refs.grid.addEventListener('click', (e) => {
      const pick = e.target.closest('[data-pick]')?.dataset.pick;
      if (pick === 'album') this.refs.file.click();
      else if (pick) this.choosePicture(pick);
    });
    this.refs.file.addEventListener('change', () => this.readPhoto());

    this.onDown = this.onDown.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onUp = this.onUp.bind(this);
    // 拖动时手指的移动和松开挂在 window 上，只在游戏进行时（resume 到 pause 之间）才监听
    this.root.addEventListener('pointerdown', this.onDown);

    this.resizer = new ResizeObserver(() => this.layout());
    this.resizer.observe(this.refs.stage);
    this.ready = this.start(ctx.saved);
  }

  // ---------- 开局与存档 ----------

  async start(saved) {
    if (isValidSave(saved)) {
      try {
        await this.restore(saved);
        return;
      } catch (err) {
        // 照片读不出来，就丢掉它，换内置的图重新开一局
        console.error(err);
        if (saved.picture === 'photo') this.photo = null;
      }
    }
    await this.newGame({ level: 'easy', picture: PICTURES[0].id });
  }

  // 已经动过了：有块离开了托盘
  get started() {
    return this.status === 'playing' && this.pieces.some((p) => p.at !== 'tray');
  }

  chooseLevel(level) {
    if (level === this.level && this.status === 'playing') return;
    if (this.started && !window.confirm('换难度会放弃这一局，确定吗？')) return;
    this.newGame({ level });
  }

  // 用户的照片 this.photo 换图时也一直留着，选图页里随时能再选「我的照片」
  async newGame({ level = this.level, picture = this.picture } = {}) {
    this.stopClock();
    const [cols, rows] = GRIDS[level];
    this.level = level;
    this.picture = picture;
    this.seed = Math.floor(Math.random() * 2 ** 31);
    this.pieces = Array.from({ length: cols * rows }, () => ({ at: 'tray' }));
    this.tray = shuffle(this.pieces.map((_, id) => id));
    this.ghost ??= true;
    this.edgesOnly ??= false;
    this.elapsed = 0;
    this.status = 'playing';
    this.record = null;
    if (!(await this.setup())) return;
    this.save();
    if (this.active) this.startClock();
  }

  async restore(saved) {
    this.level = saved.level;
    this.picture = saved.picture;
    this.photo = isPhoto(saved.photo) ? saved.photo : null;
    this.seed = saved.seed;
    this.pieces = saved.pieces.map((p) => ({ ...p }));
    // 托盘顺序以存档为准，存档里漏掉的块补在后面
    const inTray = this.pieces.map((p, id) => (p.at === 'tray' ? id : -1)).filter((id) => id >= 0);
    const kept = Array.isArray(saved.tray) ? saved.tray.filter((id, k, list) => inTray.includes(id) && list.indexOf(id) === k) : [];
    this.tray = [...kept, ...inTray.filter((id) => !kept.includes(id))];
    this.ghost = saved.ghost !== false;
    this.edgesOnly = Boolean(saved.edgesOnly);
    // 用时不对（不是数、负数、无穷大）就从 0 算，免得显示成 NaN 或记成成绩
    this.elapsed = Number.isFinite(saved.elapsed) && saved.elapsed >= 0 ? saved.elapsed : 0;
    this.status = saved.status === 'won' && this.pieces.every((p) => p.at === 'placed') ? 'won' : 'playing';
    this.record = saved.record === 'first' || saved.record === 'best' ? saved.record : null;
    await this.setup();
  }

  // 准备好图片、切好块、摆好位置。换图的时候可能连着点了几次，只有最后一次算数
  async setup() {
    const token = ++this.token;
    const source = this.picture === 'photo' ? await loadImage(this.photo) : renderPicture(this.picture, SOURCE_WIDTH);
    if (token !== this.token) return false;
    this.source = source;
    const [cols, rows] = GRIDS[this.level];
    this.shape = cut(cols, rows, this.seed);
    this.endDrag();
    this.els = this.pieces.map((_, id) => {
      const el = document.createElement('canvas');
      el.className = isBorder(this.shape, id) ? 'jg-piece' : 'jg-piece is-inner';
      el.dataset.id = id;
      return el;
    });
    this.refs.trayRow.replaceChildren(...this.tray.map((id) => this.els[id]));
    this.refs.placed.replaceChildren();
    this.refs.float.replaceChildren();
    this.pieces.forEach((p, id) => {
      if (p.at === 'placed') {
        this.els[id].classList.add('is-placed');
        this.refs.placed.append(this.els[id]);
      } else if (p.at === 'loose') {
        this.refs.float.append(this.els[id]);
      }
    });
    this.root.classList.remove('is-done');
    this.refs.tray.scrollLeft = 0;
    this.metrics = null;
    this.layout();
    this.updateChrome();
    return true;
  }

  save() {
    const state = {
      level: this.level,
      picture: this.picture,
      photo: this.photo,
      seed: this.seed,
      pieces: this.pieces,
      tray: this.tray,
      ghost: this.ghost,
      edgesOnly: this.edgesOnly,
      elapsed: Math.round(this.now()),
      status: this.status,
      record: this.record,
    };
    this.ctx.save(state, { summary: this.summary(), finished: this.status === 'won' });
  }

  pictureName() {
    return this.picture === 'photo' ? '我的照片' : getPicture(this.picture).name;
  }

  summary() {
    const name = LEVELS[this.level];
    if (this.status === 'won') return `${this.pictureName()} · ${name}拼好了 · 用时 ${clock(this.elapsed)}`;
    const placed = this.pieces.filter((p) => p.at === 'placed').length;
    return `${this.pictureName()} · ${name} · 已拼 ${placed}/${this.pieces.length}`;
  }

  // ---------- 排版和画块 ----------

  // 画板在中间那块地方里尽量大（3:4）；尺寸变了就重画所有的块
  layout() {
    if (!this.shape) return;
    const { stage, board, picture } = this.refs;
    const viewW = stage.clientWidth;
    const viewH = stage.clientHeight;
    if (!viewW || !viewH) return;
    const bw = Math.floor(Math.min(viewW, (viewH * 3) / 4));
    const bh = Math.floor((bw * 4) / 3);
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const key = `${bw}x${bh}@${dpr}`;
    if (this.metrics?.key !== key) {
      const { cols, rows } = this.shape;
      const cw = bw / cols;
      const ch = bh / rows;
      const s = Math.min(cw, ch);
      const m = Math.ceil(TAB * s + 2);
      this.metrics = { key, bw, bh, cw, ch, s, m, dpr, w: cw + 2 * m, h: ch + 2 * m };
      this.metrics.k = Math.min(1, TRAY_PIECE / Math.max(this.metrics.w, this.metrics.h));
      board.style.width = `${bw}px`;
      board.style.height = `${bh}px`;
      picture.width = Math.round(bw * dpr);
      picture.height = Math.round(bh * dpr);
      picture.getContext('2d').drawImage(this.source, 0, 0, picture.width, picture.height);
      this.els.forEach((_, id) => this.renderPiece(id));
    }
    this.pieces.forEach((_, id) => this.position(id));
  }

  // 画一块：按形状裁出图片，左上沿描一道亮边、右下沿描一道暗边，看起来有点厚度
  renderPiece(id) {
    const { bw, bh, cw, ch, s, m, dpr, w, h } = this.metrics;
    const col = id % this.shape.cols;
    const row = Math.floor(id / this.shape.cols);
    const el = this.els[id];
    el.width = Math.ceil(w * dpr);
    el.height = Math.ceil(h * dpr);
    const g = el.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(m - col * cw, m - row * ch);
    const outline = (shift = 0) => {
      g.beginPath();
      g.save();
      g.translate(shift, shift);
      tracePiece(g, this.shape, col, row, cw, ch);
      g.restore();
    };
    const line = Math.max(1.2, s * 0.035);
    outline();
    g.save();
    g.clip();
    g.drawImage(this.source, 0, 0, bw, bh);
    g.lineWidth = line * 2;
    outline(line * 0.7);
    g.strokeStyle = 'rgba(255,255,255,0.42)';
    g.stroke();
    outline(-line * 0.7);
    g.strokeStyle = 'rgba(0,0,0,0.32)';
    g.stroke();
    g.restore();
    outline();
    g.lineWidth = 0.8;
    g.strokeStyle = 'rgba(0,0,0,0.3)';
    g.stroke();
  }

  // 把一块摆到它现在该在的地方：托盘里按比例缩小，拼好的在画板上，散放的在浮层上
  position(id) {
    const el = this.els[id];
    const p = this.pieces[id];
    const { w, h, k, cw, ch, m, bw, bh } = this.metrics;
    const scale = p.at === 'tray' ? k : 1;
    el.style.width = `${w * scale}px`;
    el.style.height = `${h * scale}px`;
    if (p.at === 'tray') {
      el.style.transform = '';
    } else if (p.at === 'placed') {
      const col = id % this.shape.cols;
      const row = Math.floor(id / this.shape.cols);
      el.style.transform = `translate(${col * cw - m}px, ${row * ch - m}px)`;
    } else {
      const board = this.boardOffset();
      el.style.transform = `translate(${board.x + p.x * bw - m}px, ${board.y + p.y * bh - m}px)`;
    }
  }

  // 画板左上角相对整个游戏区的位置
  boardOffset() {
    const root = this.root.getBoundingClientRect();
    const board = this.refs.board.getBoundingClientRect();
    return { x: board.left - root.left, y: board.top - root.top };
  }

  // ---------- 拖动 ----------

  // 手指下面是哪一块。块的图片四周有一圈透明的边。
  // 散放的块不接手指（见 style.css），这里从最上面那块往下找，只认画出来的形状，透明的边不会挡住按钮；
  // 再看托盘：点在透明处时看看旁边有没有别的块，都没有再算最上面那块
  pieceAt(x, y) {
    const loose = [...this.refs.float.children]
      .map((el, k) => ({ el, z: Number(el.style.zIndex) || 0, k }))
      .sort((a, b) => b.z - a.z || b.k - a.k)
      .find(({ el }) => this.solidAt(el, x, y));
    if (loose) return loose.el;
    const hits = document.elementsFromPoint(x, y)
      .filter((el) => el.classList.contains('jg-piece') && this.refs.trayRow.contains(el));
    return hits.find((el) => this.solidAt(el, x, y)) ?? hits[0] ?? null;
  }

  solidAt(el, x, y) {
    const rect = el.getBoundingClientRect();
    if (x < rect.left || x >= rect.right || y < rect.top || y >= rect.bottom) return false;
    const px = Math.floor(((x - rect.left) / rect.width) * el.width);
    const py = Math.floor(((y - rect.top) / rect.height) * el.height);
    return el.getContext('2d').getImageData(px, py, 1, 1).data[3] > 24;
  }

  onDown(e) {
    if (!this.active || this.status !== 'playing' || this.drag || e.button > 0 || !this.metrics) return;
    // 按钮总是先算按钮的；选图页开着时底下的块都不能动
    if (e.target.closest('button') || !this.refs.picker.hidden) return;
    const el = this.pieceAt(e.clientX, e.clientY);
    if (!el) return;
    const id = Number(el.dataset.id);
    this.drag = {
      id,
      el,
      from: this.pieces[id].at,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      touch: e.pointerType !== 'mouse',
      moving: false,
    };
  }

  onMove(e) {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    if (!d.moving) {
      // 托盘可以左右滑：用手指时要往上拖一段才算拿起来，横着滑交给浏览器去滚动托盘。散放的块一动就跟着走
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.hypot(dx, dy) < (d.from === 'tray' ? 8 : 4)) return;
      if (d.from === 'tray' && d.touch && -dy < Math.abs(dx)) return;
      this.lift(d);
    }
    d.x = e.clientX - d.originX;
    d.y = e.clientY - d.originY;
    d.clientY = e.clientY;
    d.ghost.style.transform = `translate(${d.x}px, ${d.y}px)`;
  }

  onUp(e) {
    if (e.type === 'pointerup' || e.type === 'pointercancel') this.root.classList.remove('is-peek');
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.drag = null;
    if (d.moving) this.drop(d);
    else if (d.from === 'loose') d.el.style.zIndex = ++this.z;
  }

  // 拿起一块。从托盘拿时托盘里的原件先藏起来、浮层上放一个复制品跟着手指走，
  // 因为手指按下去的那个元素在这次触摸结束前不能挪地方，不然 Safari 会收不到后面的触摸事件
  lift(d) {
    const { w, h } = this.metrics;
    const root = this.root.getBoundingClientRect();
    if (d.from === 'tray') {
      const copy = document.createElement('canvas');
      copy.className = 'jg-piece';
      copy.width = d.el.width;
      copy.height = d.el.height;
      copy.getContext('2d').drawImage(d.el, 0, 0);
      copy.style.width = `${w}px`;
      copy.style.height = `${h}px`;
      this.refs.float.append(copy);
      d.ghost = copy;
      d.el.classList.add('is-away');
      d.originX = root.left + w / 2;
      d.originY = root.top + h / 2 + (d.touch ? FINGER_LIFT : 0);
    } else {
      const rect = d.el.getBoundingClientRect();
      d.ghost = d.el;
      d.originX = root.left + (d.startX - rect.left);
      d.originY = root.top + (d.startY - rect.top);
    }
    d.ghost.classList.add('is-dragging');
    d.ghost.style.zIndex = ++this.z;
    d.moving = true;
  }

  // 松手：离正确位置够近就吸住；落在托盘上就收回托盘；否则就散放在那里
  drop(d) {
    const { m, cw, ch, s, bw, bh, w, h } = this.metrics;
    const board = this.boardOffset();
    const col = d.id % this.shape.cols;
    const row = Math.floor(d.id / this.shape.cols);
    const cellX = d.x + m - board.x;
    const cellY = d.y + m - board.y;
    d.ghost.classList.remove('is-dragging');
    if (d.ghost !== d.el) d.ghost.remove();
    d.el.classList.remove('is-away', 'is-dragging');

    if (Math.hypot(cellX - col * cw, cellY - row * ch) < SNAP * s) {
      this.pieces[d.id] = { at: 'placed' };
      this.tray = this.tray.filter((id) => id !== d.id);
      d.el.classList.add('is-placed', 'is-snap');
      d.el.style.zIndex = '';
      this.refs.placed.append(d.el);
      // 从松手的地方滑进去
      d.el.style.transition = 'none';
      this.position(d.id);
      d.el.style.transform = `translate(${cellX - m}px, ${cellY - m}px)`;
      void d.el.offsetWidth;
      d.el.style.transition = '';
      this.position(d.id);
      d.el.addEventListener('animationend', () => d.el.classList.remove('is-snap'), { once: true });
    } else if (d.clientY > this.refs.tray.getBoundingClientRect().top - 6) {
      if (d.from === 'loose') {
        this.pieces[d.id] = { at: 'tray' };
        this.tray.unshift(d.id);
        d.el.style.zIndex = '';
        this.refs.trayRow.prepend(d.el);
        this.refs.tray.scrollLeft = 0;
        this.position(d.id);
      }
    } else {
      // 散放的块不能拖出中间那块地方
      const stage = this.refs.stage.getBoundingClientRect();
      const root = this.root.getBoundingClientRect();
      const left = stage.left - root.left;
      const top = stage.top - root.top;
      const x = Math.min(Math.max(d.x, left - m), left + stage.width - w + m);
      const y = Math.min(Math.max(d.y, top - m), top + stage.height - h + m);
      this.pieces[d.id] = { at: 'loose', x: (x + m - board.x) / bw, y: (y + m - board.y) / bh };
      this.tray = this.tray.filter((id) => id !== d.id);
      if (d.from === 'tray') this.refs.float.append(d.el);
      d.el.style.zIndex = d.ghost.style.zIndex;
      this.position(d.id);
    }
    this.afterMove();
  }

  // 正在拖的时候被打断（切到后台、换图）：放回原处
  endDrag() {
    const d = this.drag;
    this.drag = null;
    this.root.classList.remove('is-peek');
    if (!d?.moving) return;
    d.ghost.classList.remove('is-dragging');
    if (d.ghost !== d.el) d.ghost.remove();
    d.el.classList.remove('is-away');
    if (this.metrics && this.pieces[d.id]) this.position(d.id);
  }

  // 把散放的块都收回托盘
  gather() {
    if (this.status !== 'playing') return;
    this.endDrag();
    const loose = this.pieces.map((p, id) => (p.at === 'loose' ? id : -1)).filter((id) => id >= 0);
    if (!loose.length) return;
    for (const id of loose) {
      this.pieces[id] = { at: 'tray' };
      this.els[id].style.zIndex = '';
      this.position(id);
    }
    this.tray.unshift(...loose);
    this.refs.trayRow.prepend(...loose.map((id) => this.els[id]));
    this.refs.tray.scrollLeft = 0;
    this.afterMove();
  }

  toggle(option) {
    this[option] = !this[option];
    this.updateChrome();
    this.save();
  }

  afterMove() {
    if (this.pieces.every((p) => p.at === 'placed')) this.win();
    this.updateChrome();
    this.save();
  }

  win() {
    this.status = 'won';
    this.stopClock();
    const time = Math.round(this.elapsed);
    const previous = this.records[this.level];
    this.records[this.level] = this.ctx.submitRecord(this.level, time, { lowerIsBetter: true });
    this.record = previous === undefined ? 'first' : time < previous ? 'best' : null;
  }

  // ---------- 换图 ----------

  openPicker() {
    this.endDrag();
    const { grid, picker, pickerNote } = this.refs;
    this.thumbs ??= Object.fromEntries(PICTURES.map((p) => [p.id, renderPicture(p.id, 180)]));
    const tile = (pick, art, name) => {
      const button = document.createElement('button');
      button.className = pick === this.picture ? 'jg-pick is-current' : 'jg-pick';
      button.dataset.pick = pick;
      const frame = document.createElement('span');
      frame.className = 'jg-pick-art';
      frame.append(art);
      const label = document.createElement('span');
      label.textContent = name;
      button.append(frame, label);
      return button;
    };
    const tiles = PICTURES.map((p) => tile(p.id, this.thumbs[p.id], p.name));
    if (this.photo) {
      const image = new Image();
      image.src = this.photo;
      image.alt = '';
      tiles.push(tile('photo', image, '我的照片'));
    }
    const album = tile('album', document.createRange().createContextualFragment(ADD_PHOTO), '从相册选');
    album.classList.add('is-album');
    grid.replaceChildren(...tiles, album);
    pickerNote.textContent = '照片只保存在这台设备上';
    picker.hidden = false;
  }

  closePicker() {
    // 还在读的照片作废，读完也不再换图
    this.photoTicket++;
    this.refs.picker.hidden = true;
  }

  async readPhoto() {
    const { file, pickerNote } = this.refs;
    const chosen = file.files[0];
    file.value = '';
    if (!chosen) return;
    const ticket = ++this.photoTicket;
    pickerNote.textContent = '正在读取照片…';
    let photo;
    try {
      photo = await loadPhoto(chosen);
    } catch (err) {
      console.error(err);
      if (ticket === this.photoTicket) pickerNote.textContent = '这张照片读不出来，换一张试试';
      return;
    }
    // 读的这段时间里关掉了选图页，或是又选了别的图
    if (ticket !== this.photoTicket) return;
    if (this.choosePicture('photo', photo)) return;
    // 没放弃这一局：照片留着以后选。正在拼的就是之前那张照片时只能先留着旧的
    if (this.picture !== 'photo') {
      this.photo = photo;
      this.save();
    }
    this.openPicker();
  }

  // 换图；photo 是刚从相册读出来的照片。返回是不是真的换了
  choosePicture(picture, photo) {
    if (this.started && !window.confirm('换图会放弃这一局，确定吗？')) return false;
    if (photo) this.photo = photo;
    this.closePicker();
    this.newGame({ picture });
    return true;
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

  // ---------- 状态栏 ----------

  resultText() {
    const time = clock(this.elapsed);
    if (this.record === 'best') return `用时 ${time} · 新纪录！`;
    if (this.record === 'first') return `用时 ${time} · 第一次拼好${LEVELS[this.level]}`;
    const best = this.records[this.level];
    return best ? `用时 ${time} · 最快 ${clock(best)}` : `用时 ${time}`;
  }

  updateChrome() {
    const { levels, count, ghostBadge, edgesTool, edgesBadge, gather, trayRow, trayEmpty, bottom, result, resultText } = this.refs;
    const playing = this.status === 'playing';
    for (const button of levels.children) button.classList.toggle('is-active', button.dataset.level === this.level);
    const placed = this.pieces.filter((p) => p.at === 'placed').length;
    count.textContent = `${placed}/${this.pieces.length}`;
    this.renderTime();

    this.root.classList.toggle('no-ghost', !this.ghost);
    ghostBadge.textContent = this.ghost ? '开' : '关';
    edgesTool.classList.toggle('is-active', this.edgesOnly);
    edgesBadge.textContent = this.edgesOnly ? '开' : '关';
    gather.disabled = !this.pieces.some((p) => p.at === 'loose');
    trayRow.classList.toggle('is-edges', this.edgesOnly);
    const showing = this.tray.filter((id) => !this.edgesOnly || isBorder(this.shape, id)).length;
    trayEmpty.hidden = !playing || showing > 0;
    trayEmpty.textContent = !this.tray.length ? '托盘空了，画板上还有没放好的块' : '边缘的块都拿出来了';

    this.root.classList.toggle('is-done', !playing);
    bottom.classList.toggle('is-over', !playing);
    result.hidden = playing;
    resultText.textContent = playing ? '' : this.resultText();
  }

  // ---------- 生命周期 ----------

  listen(on) {
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('pointermove', this.onMove);
    window[method]('pointerup', this.onUp);
    window[method]('pointercancel', this.onUp);
  }

  pause() {
    this.active = false;
    this.endDrag();
    this.listen(false);
    if (!this.runningSince) return;
    this.stopClock();
    this.renderTime();
    this.save();
  }

  resume() {
    this.active = true;
    this.listen(true);
    this.startClock();
  }

  destroy() {
    this.active = false;
    this.endDrag();
    this.listen(false);
    this.stopClock();
    this.resizer.disconnect();
  }
}

export default {
  guide,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Jigsaw(root, ctx);
    await game.ready;
    return {
      pause: () => game.pause(),
      resume: () => game.resume(),
      destroy: () => game.destroy(),
    };
  },
};
