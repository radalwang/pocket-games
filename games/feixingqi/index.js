// 飞行棋：你和 1–3 个电脑轮流掷骰子，谁先把自己的飞机全部飞进中间的终点谁赢。
// 规则在 rules.js，棋盘在 board.js，电脑在 ai.js；一局怎么进行、存档和以后联机的接口在 match.js。
// 这里只管画棋盘、放动画、接收点击：本机的人点骰子和飞机，电脑由这里定时替它走。接口说明见 js/player.js。

import guide from './guide.js';
import { chooseMove } from './ai.js';
import {
  COLOR_NAMES, goalSpot, goalTriangle, hangarSpot, LOOP, loopCenter, loopColor, padSpot, runwayCenter, RUNWAYS, SIZE, START, yardRect,
} from './board.js';
import { FLY_FROM, FLY_TO, GOAL, HANGAR, LAST_LOOP, legalPlanes, loopIndex, TAKEOFF } from './rules.js';
import { Match, newSetup } from './match.js';

// 电脑掷骰子、选飞机前停一下，看得清它在干什么；只有一种走法时本机也自动走
const AI_ROLL_MS = 550;
const AI_MOVE_MS = 450;
const AUTO_MOVE_MS = 320;
const STEP_MS = 140;
const ROLL_MS = 480;

// 每方的颜色：飞机用最饱和的，大圈的格子用浅一点的，机场用更浅的底色
const PLANE_COLORS = ['#ff3b30', '#ffbf00', '#0a84ff', '#30c35a'];
const THEMES = {
  light: {
    board: '#fbf6ec', edge: '#e6dac4', spot: '#ffffff',
    cell: ['#ff8f87', '#ffd55c', '#7ab8ff', '#7fdc98'],
    yard: ['#ffe1de', '#fff1c4', '#dcebff', '#d9f5e1'],
  },
  dark: {
    board: '#1f1f22', edge: '#38383c', spot: '#2c2c2e',
    cell: ['#b8483f', '#b38d1c', '#3a74c0', '#2f8f4b'],
    yard: ['#3d2321', '#3a3119', '#1c2b40', '#1c3324'],
  },
};

// 俯视的小飞机，机头朝上，大小 1
const PLANE = new Path2D('M0 -0.5C0.07 -0.5 0.09 -0.4 0.09 -0.3L0.09 -0.1L0.48 0.12L0.48 0.22L0.09 0.12L0.07 0.32L0.22 0.42L0.22 0.5L0 0.45L-0.22 0.5L-0.22 0.42L-0.07 0.32L-0.09 0.12L-0.48 0.22L-0.48 0.12L-0.09 -0.1L-0.09 -0.3C-0.09 -0.4 -0.07 -0.5 0 -0.5Z');
// 骰子 1–6 点各亮哪几个点（3×3 的格子，从左上往右下数）
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
// 同一格叠着几架自己的飞机时，各往哪边错开一点
const STACK = [[-0.17, -0.17], [0.17, 0.17], [0.17, -0.17], [-0.17, 0.17]];

const NEW = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 3.8v3.9h3.9"/></svg>';

const lerp = (a, b, t) => a + (b - a) * t;
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);
// 机头朝 (dx, dy) 方向时要转的角度
const heading = (dx, dy) => Math.atan2(dx, -dy);

const TEMPLATE = `
  <div class="fx">
    <div class="fx-top">
      <div class="fx-players" data-ref="players"></div>
      <button class="fx-new" data-ref="newGame" aria-label="新游戏">${NEW}</button>
    </div>
    <div class="fx-stage" data-ref="stage">
      <canvas data-ref="canvas"></canvas>
      <div class="fx-toast" data-ref="toast" hidden></div>
      <div class="fx-overlay" data-ref="overlay" hidden></div>
    </div>
    <div class="fx-bottom">
      <button class="fx-dice" data-ref="dice" aria-label="掷骰子">${'<i></i>'.repeat(9)}</button>
      <div class="fx-msg">
        <strong data-ref="msg"></strong>
        <span data-ref="sub"></span>
      </div>
    </div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="feixingqi"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'feixingqi';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

// 一架飞机在 p 处画在哪（棋盘坐标）
function spot(color, p, plane) {
  if (p === HANGAR) return hangarSpot(color, plane);
  if (p === TAKEOFF) return padSpot(color);
  if (p <= LAST_LOOP) return loopCenter(loopIndex(color, p));
  if (p < GOAL) return runwayCenter(color, p - LAST_LOOP - 1);
  return goalSpot(color, plane);
}

// 停着的飞机机头朝哪：朝下一步要去的地方；在机场朝起飞点，到了终点朝中心
function restAngle(color, p, plane) {
  const [x, y] = spot(color, p, plane);
  const [tx, ty] = p === HANGAR ? padSpot(color) : p >= GOAL ? [SIZE / 2, SIZE / 2] : spot(color, p + 1, plane);
  return heading(tx - x, ty - y);
}

const DEFAULT_SETUP = { opponents: 1, color: 0, planes: 4 };

const isSetup = (s) => s && [1, 2, 3].includes(s.opponents) && [0, 1, 2, 3].includes(s.color) && [2, 4].includes(s.planes);

// 从存档重放出那一局。座位要正好一个本机的人、其余都是电脑（联机还没做，远程座位会一直干等）；不对就抛错
function restoreMatch(saved) {
  const { config, seats, log } = saved.match ?? {};
  if (!Array.isArray(log)) throw new Error('存档里没有走棋记录');
  const match = new Match({ config, seats, log });
  if (match.seats.filter((kind) => kind === 'local').length !== 1 || match.seats.includes('remote')) {
    throw new Error('存档里的座位不对');
  }
  return match;
}

class Feixingqi {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.wins = ctx.records.wins ?? 0;
    this.active = false;
    this.busy = false; // 正在放动画
    this.timer = 0;
    this.toastTimer = 0;
    this.raf = 0;
    this.lastFrame = 0;
    this.tweens = [];
    this.sparks = [];
    this.choices = [];
    this.match = null;
    this.unlisten = null;
    // 有存档先把那一局重放出来：用不了就直接抛错，这时还没挂任何监听，外壳会丢掉存档重新开一局
    const saved = ctx.saved;
    const restored = saved == null ? null : restoreMatch(saved);
    this.setup = isSetup(saved?.setup) ? saved.setup : { ...DEFAULT_SETUP };
    // 这一局本机的人赢了有没有记进成绩，跟着存档走，免得漏记或重复记
    this.counted = saved?.counted === true;

    root.innerHTML = TEMPLATE;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.g = this.refs.canvas.getContext('2d');
    this.pips = [...this.refs.dice.children];

    this.refs.dice.addEventListener('click', () => this.rollByHand());
    this.refs.canvas.addEventListener('pointerdown', (e) => this.tapBoard(e));
    this.refs.newGame.addEventListener('click', () => this.askNewGame());
    this.frame = this.frame.bind(this);

    this.scheme = window.matchMedia('(prefers-color-scheme: dark)');
    this.onScheme = () => {
      this.theme = THEMES[this.scheme.matches ? 'dark' : 'light'];
      this.drawBoardLayer();
      this.draw();
    };
    this.theme = THEMES[this.scheme.matches ? 'dark' : 'light'];
    this.scheme.addEventListener('change', this.onScheme);
    this.resizer = new ResizeObserver(() => this.layout());
    this.resizer.observe(this.refs.stage);

    if (restored) {
      this.attach(restored);
      // 上次赢了、但动画没放完就被关掉的，这里补记上
      this.countWin();
      if (restored.state.phase === 'over') this.showOver();
    } else {
      this.showSetup();
    }
    // 存档停在掷完骰子、还没走的时候，骰子要显示真正掷出的点数
    this.setFace(this.match?.state.dice ?? 6);
  }

  // ---------- 开局 ----------

  // 按设置开一局：我是 setup.color，电脑坐在其余的位置上（只有一个电脑时坐对面）
  start(setup = this.setup) {
    this.setup = setup;
    const others = [2, 1, 3].map((k) => (setup.color + k) % 4).slice(0, setup.opponents);
    const players = [
      { color: setup.color, name: '你', kind: 'local' },
      ...others.map((color) => ({ color, name: '电脑', kind: 'ai' })),
    ];
    this.counted = false;
    this.attach(new Match(newSetup({ players, planes: setup.planes })));
    this.hideOverlay();
    this.toast(`${this.who(this.match.state.turn)}先走`);
    this.save();
    this.advance();
  }

  attach(match) {
    this.unlisten?.();
    clearTimeout(this.timer);
    this.match = match;
    this.me = match.seats.indexOf('local');
    this.unlisten = match.onChange((events) => {
      this.countWin();
      this.play(events);
    });
    this.tweens = [];
    this.sparks = [];
    this.busy = false;
    this.syncDisplay();
    this.drawBoardLayer();
    this.renderPlayers();
    this.draw();
  }

  askNewGame() {
    const playing = this.match && this.match.state.phase !== 'over' && this.match.log.length > 0;
    if (playing && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.showSetup();
  }

  // ---------- 开局设置和结束面板 ----------

  showSetup() {
    clearTimeout(this.timer);
    const { overlay } = this.refs;
    const choice = (name, value, label, extra = '') =>
      `<button data-${name}="${value}"${extra}>${label}</button>`;
    overlay.innerHTML = `
      <div class="fx-panel">
        <h3>飞行棋</h3>
        <div class="fx-field"><span>对手</span><div class="fx-seg" data-group="opponents">
          ${[1, 2, 3].map((n) => choice('opponents', n, `${n} 个电脑`)).join('')}
        </div></div>
        <div class="fx-field"><span>我的颜色</span><div class="fx-colors" data-group="color">
          ${COLOR_NAMES.map((name, c) => choice('color', c, name, ` style="--c:${PLANE_COLORS[c]}"`)).join('')}
        </div></div>
        <div class="fx-field"><span>飞机</span><div class="fx-seg" data-group="planes">
          ${choice('planes', 4, '每方 4 架')}${choice('planes', 2, '2 架快速局')}
        </div></div>
        <button class="fx-btn is-primary" data-start>开始</button>
      </div>`;
    const draft = { ...this.setup };
    const mark = () => overlay.querySelectorAll('[data-group]').forEach((group) => {
      for (const button of group.children) button.classList.toggle('is-active', Number(button.dataset[group.dataset.group]) === draft[group.dataset.group]);
    });
    // 面板每次都是新建的，监听挂在面板上，不会越挂越多
    overlay.firstElementChild.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-start')) {
        this.start(draft);
        return;
      }
      const group = button.parentElement.dataset.group;
      if (group) {
        draft[group] = Number(button.dataset[group]);
        mark();
      }
    });
    mark();
    overlay.hidden = false;
    this.say('选好对手和颜色，点「开始」', '');
    this.refs.dice.disabled = true;
  }

  showOver() {
    const { state } = this.match;
    const won = state.winner === this.me;
    const { overlay } = this.refs;
    const color = COLOR_NAMES[this.match.config.players[state.winner].color];
    overlay.innerHTML = `
      <div class="fx-panel">
        <h3>${won ? '你赢了！' : `${color}方赢了`}</h3>
        <p>${won ? `一共赢了 ${this.wins} 局` : '再来一局，下次一定'}</p>
        <div class="fx-actions">
          <button class="fx-btn" data-setup>换个设置</button>
          <button class="fx-btn is-primary" data-again>再来一局</button>
        </div>
      </div>`;
    overlay.querySelector('[data-setup]').addEventListener('click', () => this.showSetup());
    overlay.querySelector('[data-again]').addEventListener('click', () => this.start());
    overlay.hidden = false;
    this.say(won ? '你赢了！' : `${color}方赢了`, '');
    this.refs.dice.disabled = true;
  }

  hideOverlay() {
    this.refs.overlay.hidden = true;
    this.refs.overlay.replaceChildren();
  }

  // ---------- 存档 ----------

  save() {
    const player = this.match?.config.players[this.me];
    if (!player) return;
    const { state, config } = this.match;
    const color = COLOR_NAMES[player.color];
    let summary = `你是${color}方 · 已到终点 ${state.planes[this.me].filter((p) => p === GOAL).length}/${config.planes} 架`;
    if (state.phase === 'over') summary = state.winner === this.me ? `你赢了 · 一共赢了 ${this.wins} 局` : `${COLOR_NAMES[config.players[state.winner].color]}方赢了`;
    this.ctx.save({ match: this.match.toJSON(), setup: this.setup, counted: this.counted }, { summary, finished: state.phase === 'over' });
  }

  // 本机的人赢了就马上记一局，不等动画放完（放到一半被关掉也不会漏记）；记过就标上 counted，同一局只记一次
  countWin() {
    const { state } = this.match;
    if (state.phase !== 'over' || state.winner !== this.me || this.counted) return;
    this.counted = true;
    this.wins = this.ctx.submitRecord('wins', this.wins + 1);
    this.save();
  }

  // ---------- 轮到谁、该干什么 ----------

  who(player) {
    const { config, seats } = this.match;
    const color = COLOR_NAMES[config.players[player].color];
    return seats[player] === 'local' ? `你（${color}方）` : `${color}方`;
  }

  // 一步放完动画之后，看下一步该谁、干什么：本机的人就等他点，电脑就定时替它走，远程的就等消息
  advance() {
    clearTimeout(this.timer);
    this.timer = 0;
    this.choices = [];
    const match = this.match;
    if (!match || this.busy || !this.active || !this.refs.overlay.hidden) {
      this.renderPlayers();
      return;
    }
    const { state } = match;
    const player = state.turn;
    this.refs.dice.disabled = true;
    this.refs.dice.classList.remove('is-ready');
    if (state.phase === 'over') {
      this.showOver();
    } else if (match.kind === 'local') {
      if (state.phase === 'roll') {
        this.refs.dice.disabled = false;
        this.refs.dice.classList.add('is-ready');
        this.refs.dice.style.setProperty('--c', PLANE_COLORS[match.config.players[player].color]);
        this.say('轮到你了', '点骰子');
      } else {
        const legal = legalPlanes(state);
        const at = state.planes[player];
        // 能走的飞机都在同一处（比如都在机场），走哪架都一样，替他走
        if (legal.every((k) => at[k] === at[legal[0]])) {
          this.later(() => match.move(legal[0]), AUTO_MOVE_MS);
        } else {
          this.choices = legal;
          this.say(`掷出 ${state.dice}`, '点一架发亮的飞机');
        }
      }
    } else if (match.kind === 'ai') {
      this.say(`${this.who(player)}（电脑）`, state.phase === 'roll' ? '掷骰子…' : `掷出 ${state.dice}，想一想…`);
      if (state.phase === 'roll') this.later(() => match.roll(), AI_ROLL_MS);
      else this.later(() => match.move(chooseMove(match.config, state)), AI_MOVE_MS);
    } else {
      // 远程座位：等联机消息（match.receive），这里什么也不用做
      this.say(`等${this.who(player)}…`, '');
    }
    this.renderPlayers();
    this.draw();
    if (this.choices.length) this.startLoop();
  }

  later(fn, ms) {
    this.timer = setTimeout(() => {
      this.timer = 0;
      if (this.active && !this.busy) fn();
    }, ms);
  }

  rollByHand() {
    const match = this.match;
    if (!match || this.busy || match.kind !== 'local' || match.state.phase !== 'roll') return;
    match.roll();
  }

  // 点棋盘：找离手指最近的一架能走的飞机
  tapBoard(e) {
    if (!this.choices.length || this.busy || !this.cell) return;
    const rect = this.refs.canvas.getBoundingClientRect();
    const x = (e.clientX - rect.left) / this.cell;
    const y = (e.clientY - rect.top) / this.cell;
    const placed = this.placements();
    let best = -1;
    let bestDistance = 0.95;
    for (const plane of this.choices) {
      const { x: px, y: py } = placed[this.me][plane];
      const distance = Math.hypot(px - x, py - y);
      if (distance < bestDistance) {
        best = plane;
        bestDistance = distance;
      }
    }
    if (best >= 0) {
      this.choices = [];
      this.match.move(best);
    }
  }

  // ---------- 动画 ----------

  // 每架飞机现在画在哪：x、y（棋盘坐标）、机头角度、抬起多高（放大一点表示在空中）
  syncDisplay() {
    const { config, state } = this.match;
    this.display = state.planes.map((planes, player) => planes.map((p, k) => {
      const color = config.players[player].color;
      const [x, y] = spot(color, p, k);
      return { x, y, angle: restAngle(color, p, k), lift: 0, moving: false };
    }));
  }

  // 一段动画：每帧调用 update(进度 0–1)，放完 resolve。上一段放完时动画循环可能已经停了，这里重新拉起来
  tween(ms, update) {
    const done = new Promise((resolve) => this.tweens.push({ ms, t: 0, update, resolve }));
    this.startLoop();
    return done;
  }

  wait(ms) {
    return this.tween(ms, () => {});
  }

  // 把一架飞机从现在的位置挪到 (x, y)：arc 是中途抬起多高
  fly(player, plane, [x, y], ms, arc = 0) {
    const d = this.display[player][plane];
    const from = { x: d.x, y: d.y };
    if (Math.hypot(x - from.x, y - from.y) > 0.01) d.angle = heading(x - from.x, y - from.y);
    d.moving = true;
    return this.tween(ms, (k) => {
      const t = easeInOut(k);
      d.x = lerp(from.x, x, t);
      d.y = lerp(from.y, y, t);
      d.lift = Math.sin(Math.PI * k) * arc;
      if (k >= 1) d.moving = false;
    });
  }

  async play(events) {
    this.busy = true;
    this.choices = [];
    this.refs.dice.disabled = true;
    this.refs.dice.classList.remove('is-ready');
    this.startLoop();
    for (const event of events) await this.playEvent(event);
    this.busy = false;
    this.syncDisplay();
    this.renderPlayers();
    this.save();
    this.advance();
  }

  async playEvent(event) {
    const { config } = this.match;
    const color = (player) => config.players[player].color;
    const { player, plane } = event;
    switch (event.type) {
      case 'roll':
        this.say(this.who(player), '掷骰子…');
        await this.spinDice(event.value, player);
        break;
      case 'pass':
        this.say(`掷出 ${event.value}`, event.value === 6 ? '没有能走的飞机' : '掷到 6 才能起飞');
        await this.wait(700);
        break;
      case 'forfeit':
        this.say('连掷三次 6', '这一轮作废');
        await this.wait(1000);
        break;
      case 'again':
        this.say(`${this.who(player)}掷到 6`, '再掷一次');
        await this.wait(250);
        break;
      case 'turn':
        this.renderPlayers();
        await this.wait(150);
        break;
      case 'takeoff':
        await this.fly(player, plane, padSpot(color(player)), 380, 0.35);
        break;
      case 'move':
        for (const p of event.path) await this.fly(player, plane, spot(color(player), p, plane), STEP_MS, 0.18);
        break;
      case 'jump':
        this.say(this.who(player), '跳到下一个同色格');
        await this.fly(player, plane, spot(color(player), event.to, plane), 320, 0.45);
        break;
      case 'fly':
        this.say(this.who(player), '顺着虚线飞过去');
        await this.fly(player, plane, spot(color(player), event.to, plane), 600, 0.6);
        break;
      case 'capture': {
        const [x, y] = spot(color(player), event.from, plane);
        this.burst(x, y, PLANE_COLORS[color(event.by)]);
        this.toast(`撞回${COLOR_NAMES[color(player)]}方一架飞机！`);
        await this.fly(player, plane, hangarSpot(color(player), plane), 480, 0.6);
        this.display[player][plane].angle = restAngle(color(player), HANGAR, plane);
        break;
      }
      case 'goal': {
        const [x, y] = goalSpot(color(player), plane);
        this.burst(x, y, PLANE_COLORS[color(player)]);
        this.say(this.who(player), '一架飞机到终点了');
        await this.wait(300);
        break;
      }
      default:
        break;
    }
  }

  // 骰子转一会儿再停在点数上，边框是掷骰子那一方的颜色
  async spinDice(value, player) {
    const { dice } = this.refs;
    dice.style.setProperty('--c', PLANE_COLORS[this.match.config.players[player].color]);
    dice.classList.add('is-rolling');
    let shown = 0;
    await this.tween(ROLL_MS, (k) => {
      const step = Math.floor(k * 7);
      if (step !== shown && k < 1) {
        shown = step;
        this.setFace(1 + Math.floor(Math.random() * 6));
      }
    });
    dice.classList.remove('is-rolling');
    this.setFace(value);
    this.say(this.who(player), `掷出 ${value}`);
  }

  setFace(value) {
    this.pips.forEach((pip, k) => pip.classList.toggle('is-on', PIPS[value].includes(k)));
    this.refs.dice.dataset.value = value;
  }

  burst(x, y, color) {
    for (let k = 0; k < 16; k++) {
      const angle = (k / 16) * Math.PI * 2 + Math.random() * 0.3;
      const speed = 2.5 + Math.random() * 2.5;
      this.sparks.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, color, t: 0, life: 0.5 + Math.random() * 0.3 });
    }
    this.startLoop();
  }

  startLoop() {
    if (!this.raf && this.active) this.raf = requestAnimationFrame(this.frame);
  }

  frame(now) {
    this.raf = 0;
    const dt = this.lastFrame ? Math.min(50, now - this.lastFrame) : 16;
    this.lastFrame = now;
    for (const tween of [...this.tweens]) {
      tween.t += dt;
      const k = Math.min(1, tween.t / tween.ms);
      tween.update(k);
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(tween), 1);
        tween.resolve();
      }
    }
    for (const s of this.sparks) {
      s.t += dt / 1000;
      s.x += s.vx * (dt / 1000);
      s.y += s.vy * (dt / 1000);
    }
    this.sparks = this.sparks.filter((s) => s.t < s.life);
    this.draw(now);
    // 有动画、火花，或者等着点飞机（发亮的圈在呼吸）时接着画
    if (this.tweens.length || this.sparks.length || this.choices.length) this.raf = requestAnimationFrame(this.frame);
    else this.lastFrame = 0;
  }

  // ---------- 画面 ----------

  layout() {
    const { stage, canvas } = this.refs;
    const side = Math.floor(Math.min(stage.clientWidth, stage.clientHeight));
    if (side <= 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.style.width = `${side}px`;
    canvas.style.height = `${side}px`;
    canvas.width = Math.round(side * dpr);
    canvas.height = Math.round(side * dpr);
    this.view = { side, dpr };
    this.cell = side / SIZE;
    this.drawBoardLayer();
    this.draw();
  }

  // 棋盘不动的部分先画在一张底图上，每帧直接贴上去
  // 还没开局时（开局设置面板后面）四方都画成在玩的样子
  drawBoardLayer() {
    if (!this.view) return;
    const { side, dpr } = this.view;
    const layer = this.layer ?? document.createElement('canvas');
    this.layer = layer;
    layer.width = Math.round(side * dpr);
    layer.height = Math.round(side * dpr);
    const g = layer.getContext('2d');
    const u = this.cell;
    const theme = this.theme;
    const playing = new Set(this.match ? this.match.config.players.map((p) => p.color) : [0, 1, 2, 3]);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, side, side);

    roundRect(g, 0, 0, side, side, u * 0.6);
    g.fillStyle = theme.board;
    g.fill();
    g.lineWidth = 1;
    g.strokeStyle = theme.edge;
    g.stroke();

    // 四个机场：停机位，和紧挨着起点的起飞点。没人玩的颜色画淡一些
    for (let c = 0; c < 4; c++) {
      g.globalAlpha = playing.has(c) ? 1 : 0.4;
      const [x, y, w, h] = yardRect(c);
      roundRect(g, x * u, y * u, w * u, h * u, u * 0.7);
      g.fillStyle = theme.yard[c];
      g.fill();
      for (let k = 0; k < 4; k++) {
        const [sx, sy] = hangarSpot(c, k);
        circle(g, sx * u, sy * u, u * 0.62, theme.spot);
        g.lineWidth = u * 0.08;
        g.strokeStyle = theme.cell[c];
        g.stroke();
      }
      const [px, py] = padSpot(c);
      circle(g, px * u, py * u, u * 0.44, theme.cell[c]);
      g.setLineDash([u * 0.12, u * 0.1]);
      g.lineWidth = u * 0.06;
      g.strokeStyle = theme.spot;
      g.stroke();
      g.setLineDash([]);
    }
    g.globalAlpha = 1;

    // 大圈：每格是哪一方的颜色；每方的起点画一个白圈
    LOOP.forEach(([x, y], i) => {
      roundRect(g, (x + 0.07) * u, (y + 0.07) * u, u * 0.86, u * 0.86, u * 0.2);
      g.fillStyle = theme.cell[loopColor(i)];
      g.fill();
    });
    for (let c = 0; c < 4; c++) {
      const [x, y] = loopCenter(START[c]);
      g.beginPath();
      g.arc(x * u, y * u, u * 0.26, 0, Math.PI * 2);
      g.lineWidth = u * 0.07;
      g.strokeStyle = theme.spot;
      g.stroke();
    }

    // 终点跑道和中间的终点
    for (let c = 0; c < 4; c++) {
      RUNWAYS[c].forEach(([x, y]) => {
        roundRect(g, (x + 0.07) * u, (y + 0.07) * u, u * 0.86, u * 0.86, u * 0.2);
        g.fillStyle = theme.yard[c];
        g.fill();
        g.lineWidth = u * 0.07;
        g.strokeStyle = theme.cell[c];
        g.stroke();
      });
      g.beginPath();
      goalTriangle(c).forEach(([x, y], k) => (k ? g.lineTo(x * u, y * u) : g.moveTo(x * u, y * u)));
      g.closePath();
      g.fillStyle = theme.cell[c];
      g.fill();
      g.lineWidth = 1.5;
      g.strokeStyle = theme.board;
      g.stroke();
    }

    // 飞行线：每方第 17 格到第 29 格的虚线，飞行格上画一架小飞机
    for (let c = 0; c < 4; c++) {
      const [ax, ay] = loopCenter(loopIndex(c, FLY_FROM));
      const [bx, by] = loopCenter(loopIndex(c, FLY_TO));
      g.globalAlpha = playing.has(c) ? 1 : 0.4;
      g.setLineDash([u * 0.22, u * 0.16]);
      g.lineWidth = u * 0.1;
      g.lineCap = 'round';
      g.strokeStyle = PLANE_COLORS[c];
      g.beginPath();
      g.moveTo(ax * u, ay * u);
      g.lineTo(bx * u, by * u);
      g.stroke();
      g.setLineDash([]);
      drawPlane(g, ax * u, ay * u, heading(bx - ax, by - ay), u * 0.5, theme.spot, null);
    }
    g.globalAlpha = 1;
  }

  // 每架飞机这一帧画在哪：叠在同一处、又没在动的自己的飞机错开一点
  placements() {
    const groups = new Map();
    this.display.forEach((planes, player) => planes.forEach((d, k) => {
      if (d.moving) return;
      const key = `${player}:${d.x.toFixed(2)},${d.y.toFixed(2)}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(k);
    }));
    return this.display.map((planes, player) => planes.map((d, k) => {
      const group = groups.get(`${player}:${d.x.toFixed(2)},${d.y.toFixed(2)}`);
      if (d.moving || !group || group.length < 2) return { ...d, scale: 1 };
      const [ox, oy] = STACK[group.indexOf(k)];
      return { ...d, x: d.x + ox, y: d.y + oy, scale: 0.82 };
    }));
  }

  draw(now = performance.now()) {
    if (!this.view) return;
    const g = this.g;
    const { side, dpr } = this.view;
    const u = this.cell;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, side, side);
    if (this.layer) g.drawImage(this.layer, 0, 0, side, side);
    if (!this.match) return;

    const placed = this.placements();
    const { config } = this.match;
    // 能选的飞机下面画一个一呼一吸的圈
    const pulse = 0.5 + 0.5 * Math.sin(now / 220);
    for (const plane of this.choices) {
      const { x, y } = placed[this.me][plane];
      g.beginPath();
      g.arc(x * u, y * u, u * (0.62 + pulse * 0.08), 0, Math.PI * 2);
      g.fillStyle = `rgba(255, 255, 255, ${0.35 + pulse * 0.25})`;
      g.fill();
      g.lineWidth = u * 0.1;
      g.strokeStyle = PLANE_COLORS[config.players[this.me].color];
      g.stroke();
    }
    // 先画停着的，再画在动的，在动的盖在上面
    const order = placed.flatMap((planes, player) => planes.map((d) => ({ d, player }))).sort((a, b) => a.d.moving - b.d.moving);
    for (const { d, player } of order) {
      const size = u * 0.9 * d.scale * (1 + d.lift * 0.6);
      drawPlane(g, d.x * u, d.y * u, d.angle, size, PLANE_COLORS[config.players[player].color], d.lift);
    }
    for (const s of this.sparks) {
      g.globalAlpha = 1 - s.t / s.life;
      circle(g, s.x * u, s.y * u, u * 0.09, s.color);
    }
    g.globalAlpha = 1;
  }

  // ---------- 状态栏 ----------

  renderPlayers() {
    if (!this.match) return;
    const { config, state, seats } = this.match;
    // 四方时牌子最窄，样式里收紧一点，保证名字露得出来
    this.refs.players.classList.toggle('is-four', config.players.length === 4);
    this.refs.players.innerHTML = config.players.map((p, k) => {
      const home = state.planes[k].filter((at) => at === GOAL).length;
      // 四方时每个牌子很窄，只写一个字：你，或者那一方的颜色
      const name = seats[k] === 'local' ? '你' : COLOR_NAMES[p.color];
      return `<div class="fx-chip${k === state.turn && state.phase !== 'over' ? ' is-turn' : ''}" style="--c:${PLANE_COLORS[p.color]}">
        <i></i><b>${name}</b><small>${home}/${config.planes}</small>
      </div>`;
    }).join('');
  }

  say(msg, sub) {
    this.refs.msg.textContent = msg;
    this.refs.sub.textContent = sub;
  }

  toast(text) {
    const { toast } = this.refs;
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove('is-out');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.add('is-out'), 1400);
  }

  // ---------- 生命周期 ----------

  // 停下电脑的定时器和动画，不存档（destroy 也用它，卸载时不能存档）
  stop() {
    this.active = false;
    clearTimeout(this.timer);
    this.timer = 0;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.lastFrame = 0;
  }

  pause() {
    this.stop();
    this.save();
  }

  resume() {
    this.active = true;
    this.startLoop();
    if (!this.busy) this.advance();
  }

  destroy() {
    this.stop();
    this.unlisten?.();
    clearTimeout(this.toastTimer);
    this.resizer.disconnect();
    this.scheme.removeEventListener('change', this.onScheme);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function circle(g, x, y, r, fill) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
}

// 一架小飞机：lift 不为 null 时带一圈白边和投影，在空中（lift 大）投影离得更远
function drawPlane(g, x, y, angle, size, color, lift) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(size, size);
  if (lift !== null) {
    g.shadowColor = 'rgba(0, 0, 0, 0.3)';
    g.shadowBlur = 3 + lift * 10;
    g.shadowOffsetY = 1 + lift * 6;
  }
  g.fillStyle = color;
  g.fill(PLANE);
  g.shadowColor = 'transparent';
  if (lift !== null) {
    g.lineWidth = 0.07;
    g.lineJoin = 'round';
    g.strokeStyle = '#ffffff';
    g.stroke(PLANE);
  }
  g.restore();
}

export default {
  guide,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Feixingqi(root, ctx);
    return {
      pause: () => game.pause(),
      resume: () => game.resume(),
      destroy: () => game.destroy(),
    };
  },
};
