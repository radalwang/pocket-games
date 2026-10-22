// 飞行棋：你和 1–3 个电脑轮流掷骰子，谁先把自己的飞机全部飞进中间的终点谁赢；也可以联机和别人玩。
// 规则在 rules.js，棋盘在 board.js，电脑在 ai.js；一局怎么进行、存档和联机的接口在 match.js。
// 这里只管画棋盘、放动画、接收点击：本机的人点骰子和飞机，电脑由这里定时替它走。接口说明见 js/player.js。
// 联机对战（大厅在 js/lobby.js，消息格式见 server/PROTOCOL.md）时服务器说了算：点骰子、点飞机只发意图，
// 服务器广播回来的动作排着队一个个放动画，放完告诉服务器；电脑、超时和掉线的人都由服务器替他走。

import guide from './guide.js';
import { chooseMove } from './ai.js';
import {
  COLOR_NAMES, goalSpot, goalTriangle, hangarSpot, LOOP, loopCenter, loopColor, padSpot, runwayCenter, RUNWAYS, SIZE, START, yardRect,
} from './board.js';
import { FLY_FROM, FLY_TO, GOAL, HANGAR, LAST_LOOP, legalPlanes, loopIndex, RULES_VERSION, TAKEOFF } from './rules.js';
import { Match, newSetup } from './match.js';
import { openLobby } from '../../js/lobby.js';
import { Connection } from '../../js/online.js';
import { esc } from '../../js/ui.js';

// 电脑掷骰子、选飞机前停一下，看得清它在干什么；只有一种走法时本机也自动走
const AI_ROLL_MS = 550;
const AI_MOVE_MS = 450;
const AUTO_MOVE_MS = 320;
const STEP_MS = 140;
const ROLL_MS = 480;
// 联机：服务器给每一步限时 15 秒（server/games.js），牌子底下的细条按这个长度缩短；断线后隔多久重连一次
const TURN_MS = 15000;
const RETRY_MS = [1000, 2000, 4000, 8000];

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

// 从存档重放出那一局。座位要正好一个本机的人、其余都是电脑（联机对局不这样存，见 saveOnline）；不对就抛错
function restoreMatch(saved) {
  const { config, seats, log } = saved.match ?? {};
  if (!Array.isArray(log)) throw new Error('存档里没有走棋记录');
  const match = new Match({ config, seats, log });
  if (match.seats.filter((kind) => kind === 'local').length !== 1 || match.seats.includes('remote')) {
    throw new Error('存档里的座位不对');
  }
  return match;
}

// 联机对局的存档里只有房间和凭证，局面要连上服务器再要回来；不对就抛错
function onlineSave(saved) {
  const { room, token } = saved.online;
  if (typeof room !== 'string' || typeof token !== 'string') throw new Error('存档里的联机凭证不对');
  return { room, token };
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
    this.lobby = null; // 开着的联机大厅
    this.online = null; // 联机对局的连接和状态，见 goOnline
    this.subText = '';
    // 有存档先把那一局重放出来：用不了就直接抛错，这时还没挂任何监听，外壳会丢掉存档重新开一局。
    // 联机对局的存档要连上服务器才能回去；联机结束后的存档（ended）只留开局设置
    const saved = ctx.saved;
    const rejoining = saved?.online ? onlineSave(saved) : null;
    const restored = saved == null || rejoining || saved.ended === true ? null : restoreMatch(saved);
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
    this.onVisibility = () => this.visibilityChanged();
    document.addEventListener('visibilitychange', this.onVisibility);

    if (rejoining) {
      this.online = this.newOnline(rejoining);
      this.showRejoining();
      this.rejoin();
    } else if (restored) {
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
    this.closeLobby();
    this.dropOnline();
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
    // 换局时上一局的骰子可能正转到一半（那段动画不会再放完了），别让它一直抖
    this.refs.dice.classList.remove('is-rolling');
    this.syncDisplay();
    this.drawBoardLayer();
    this.renderPlayers();
    this.draw();
  }

  askNewGame() {
    // 联机对局退出后座位由电脑代打，凭存档也不再回去
    if (this.online && !this.online.closed) {
      if (!window.confirm('退出联机对局？你的座位会交给电脑')) return;
      this.online.conn?.send({ t: 'leave' });
      this.endOnline('已退出联机对局', '');
      return;
    }
    const playing = !this.online && this.match && this.match.state.phase !== 'over' && this.match.log.length > 0;
    if (playing && !window.confirm('重新开始会放弃这一局，确定吗？')) return;
    this.showSetup();
  }

  // ---------- 开局设置和结束面板 ----------

  // note 是顶上的一行说明，比如「这局联机已经结束」
  showSetup(note = '') {
    clearTimeout(this.timer);
    this.closeLobby();
    const { overlay } = this.refs;
    const choice = (name, value, label, extra = '') =>
      `<button data-${name}="${value}"${extra}>${label}</button>`;
    overlay.innerHTML = `
      <div class="fx-panel">
        <h3>飞行棋</h3>
        ${note ? `<p>${esc(note)}</p>` : ''}
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
        <button class="fx-btn" data-online>联机对战</button>
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
      if (button.hasAttribute('data-online')) {
        // 选好的颜色和飞机数记下来：大厅里开房间用这个飞机数，「和电脑玩」也照这个开
        this.setup = draft;
        this.showLobby();
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
    this.say(note || '选好对手和颜色，点「开始」', '');
    this.refs.dice.disabled = true;
  }

  showOver() {
    const { state } = this.match;
    const won = state.winner === this.me;
    const { overlay } = this.refs;
    const winner = this.sideName(state.winner);
    // 联机时「再来一局」回到大厅重新匹配，「返回」回到开局设置
    overlay.innerHTML = `
      <div class="fx-panel">
        <h3>${won ? '你赢了！' : `${esc(winner)}赢了`}</h3>
        <p>${won ? `一共赢了 ${this.wins} 局` : '再来一局，下次一定'}</p>
        <div class="fx-actions">
          <button class="fx-btn" data-setup>${this.online ? '返回' : '换个设置'}</button>
          <button class="fx-btn is-primary" data-again>再来一局</button>
        </div>
      </div>`;
    overlay.querySelector('[data-setup]').addEventListener('click', () => this.showSetup());
    overlay.querySelector('[data-again]').addEventListener('click', () => (this.online ? this.showLobby() : this.start()));
    overlay.hidden = false;
    this.say(won ? '你赢了！' : `${winner}赢了`, '');
    this.refs.dice.disabled = true;
  }

  // 联机大厅画在遮罩里，和开局设置面板一样居中
  showLobby() {
    clearTimeout(this.timer);
    this.closeLobby();
    this.refs.overlay.hidden = false;
    this.lobby = openLobby(this.refs.overlay, {
      game: 'feixingqi',
      rules: RULES_VERSION,
      title: '飞行棋',
      options: [{ key: 'planes', label: '飞机', choices: [{ value: 4, label: '每方 4 架' }, { value: 2, label: '2 架快速局' }], value: this.setup.planes }],
      onStart: (conn, start) => {
        this.lobby = null;
        this.goOnline(conn, start);
      },
      onBack: () => {
        this.lobby = null;
        this.showSetup();
      },
      onSolo: () => {
        this.lobby = null;
        this.start({ ...this.setup, opponents: 3 });
      },
    });
    this.say('联机对战', '');
    this.refs.dice.disabled = true;
    this.refs.dice.classList.remove('is-ready');
  }

  closeLobby() {
    this.lobby?.close();
    this.lobby = null;
  }

  hideOverlay() {
    this.refs.overlay.hidden = true;
    this.refs.overlay.replaceChildren();
  }

  // ---------- 存档 ----------

  save() {
    if (this.online) {
      this.saveOnline();
      return;
    }
    const player = this.match?.config.players[this.me];
    if (!player) return;
    const { state, config } = this.match;
    const color = COLOR_NAMES[player.color];
    let summary = `你是${color}方 · 已到终点 ${state.planes[this.me].filter((p) => p === GOAL).length}/${config.planes} 架`;
    if (state.phase === 'over') summary = state.winner === this.me ? `你赢了 · 一共赢了 ${this.wins} 局` : `${COLOR_NAMES[config.players[state.winner].color]}方赢了`;
    this.ctx.save({ match: this.match.toJSON(), setup: this.setup, counted: this.counted }, { summary, finished: state.phase === 'over' });
  }

  // 联机对局只存房间和凭证：局面在服务器上，回来时凭它们要回整局。counted 也存着，回来时不会重复记赢。
  // 下完了、退出了、服务器上没有了，就只留开局设置（ended），再打开时不再连服务器
  saveOnline() {
    const { online, match } = this;
    const over = match?.state.phase === 'over';
    if (over || online.closed) {
      const summary = over ? (match.state.winner === this.me ? `你赢了 · 一共赢了 ${this.wins} 局` : `${this.sideName(match.state.winner)}赢了`) : online.summary;
      this.ctx.save({ setup: this.setup, ended: true }, { summary, finished: true });
    } else if (match) {
      const color = COLOR_NAMES[match.config.players[this.me].color];
      this.ctx.save({ online: { room: online.room, token: online.token }, setup: this.setup, counted: this.counted }, { summary: `联机对战中 · 你是${color}方`, finished: false });
    }
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
    if (seats[player] === 'local') return `你（${color}方）`;
    // 联机时带上昵称
    const name = this.online?.players[player]?.name;
    return name ? `${name}（${color}方）` : `${color}方`;
  }

  // 不是你的那一方叫什么：单机是「红方」，联机是昵称
  sideName(player) {
    return this.online?.players[player]?.name ?? `${COLOR_NAMES[this.match.config.players[player].color]}方`;
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
    } else if (this.online && !this.online.ready) {
      // 联机断开了、正在连回去：先什么都不能点
      this.say(this.online.notice || '正在回到联机对局…', '');
    } else if (match.kind === 'local') {
      if (match.pending) {
        // 联机：意图已经发给服务器了，等它广播回来
      } else if (state.phase === 'roll') {
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
    } else if (this.online) {
      // 联机的别人（包括服务器替它走的电脑）：等服务器广播，由 drain 放出来
      const away = this.online.players[player]?.away;
      this.say(`等${this.who(player)}…`, away ? '掉线了 · 电脑代打' : state.phase === 'move' ? `掷出 ${state.dice}，在选飞机` : '');
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
    if (this.online) {
      // 联机：只告诉服务器「我要掷」，点数由它掷好广播回来；等回音时骰子先按不动，免得连点
      if (!this.online.ready || !match.roll()) return;
      this.refs.dice.disabled = true;
      this.refs.dice.classList.remove('is-ready');
      return;
    }
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

  // 一段动画：每帧调用 update(进度 0–1)，放完 resolve。上一段放完时动画循环可能已经停了，这里重新拉起来。
  // 联机时游戏页收起了或者在看玩法介绍：别人不等你，动画直接跳到结尾，回来时看到的就是最新的局面
  tween(ms, update) {
    if (this.online && !this.active) {
      update(1);
      return Promise.resolve();
    }
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
    // 联机：接着放排着队的下一步，都放完了 drain 会告诉服务器
    if (this.online) this.drain();
    if (!this.busy) this.advance();
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
    const online = this.online;
    // 四方时牌子最窄，样式里收紧一点，保证名字露得出来
    this.refs.players.classList.toggle('is-four', config.players.length === 4);
    this.refs.players.classList.toggle('is-online', Boolean(online));
    this.refs.players.innerHTML = config.players.map((p, k) => {
      const home = state.planes[k].filter((at) => at === GOAL).length;
      const turn = k === state.turn && state.phase !== 'over';
      if (online) {
        // 联机的牌子写两行：昵称（太长就省略）和到终点几架；掉线的变淡、写「掉线代打」；正在计时的人底下有根细条在缩短
        const info = online.players[k] ?? {};
        const name = seats[k] === 'local' ? '你' : esc(info.name ?? COLOR_NAMES[p.color]);
        const left = online.turn?.seat === k ? Math.max(0, online.turn.endsAt - Date.now()) : -1;
        const timer = left >= 0 ? `<u style="animation-duration:${TURN_MS}ms;animation-delay:-${Math.max(0, TURN_MS - left)}ms"></u>` : '';
        return `<div class="fx-chip${turn ? ' is-turn' : ''}${info.away ? ' is-away' : ''}" style="--c:${PLANE_COLORS[p.color]}">
          <i></i><span><b>${name}</b><small>${info.away ? '掉线代打' : `${home}/${config.planes}`}</small></span>${timer}
        </div>`;
      }
      // 四方时每个牌子很窄，只写一个字：你，或者那一方的颜色
      const name = seats[k] === 'local' ? '你' : COLOR_NAMES[p.color];
      return `<div class="fx-chip${turn ? ' is-turn' : ''}" style="--c:${PLANE_COLORS[p.color]}">
        <i></i><b>${name}</b><small>${home}/${config.planes}</small>
      </div>`;
    }).join('');
  }

  say(msg, sub) {
    this.refs.msg.textContent = msg;
    this.subText = sub;
    this.renderClock();
  }

  // 第二行提示；联机轮到你、服务器在计时的时候后面跟着「还剩几秒」，最后 5 秒变红
  renderClock() {
    const turn = this.online?.turn;
    const mine = Boolean(turn) && turn.seat === this.me && !this.busy;
    const left = mine ? Math.max(0, Math.ceil((turn.endsAt - Date.now()) / 1000)) : 0;
    this.refs.sub.textContent = mine ? [this.subText, `还剩 ${left} 秒`].filter(Boolean).join(' · ') : this.subText;
    this.refs.sub.classList.toggle('is-hurry', mine && left <= 5);
  }

  toast(text) {
    const { toast } = this.refs;
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove('is-out');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => toast.classList.add('is-out'), 1400);
  }

  // ---------- 联机对战 ----------
  //
  // this.online 在显示联机对局（或正在连回联机对局）时都在，开新的一局（单机或联机）时才换掉：
  //   room、token  凭它们回到这一局（存档里也是这两样）
  //   conn、offs   现在的连接和挂在上面的监听，断开时为 null
  //   ready        连上了、局面也和服务器对上了，这时才能点；notice 是没对上时状态栏写什么
  //   players      服务器给的 [{ name, ai, away }]，按座位排
  //   queue        动画放着时收到的动作，放完一个接一个执行
  //   turn         服务器正在给谁计时：{ seat, endsAt }
  //   closed       这局已经下完、退出了或者服务器上没有了，不再连；summary 是这时存档的说明

  newOnline({ room, token }) {
    return {
      room, token, conn: null, offs: [], ready: false, notice: '', players: [], queue: [], turn: null,
      ticker: 0, attempt: 0, retryTimer: 0, closed: false, summary: '',
    };
  }

  // 大厅里凑齐人开局了：连接从此归这里管
  goOnline(conn, start) {
    this.dropOnline();
    this.online = this.newOnline(start);
    this.counted = false;
    this.useConnection(conn);
    this.loadStart(start, true);
  }

  useConnection(conn) {
    const online = this.online;
    this.dropConnection();
    online.conn = conn;
    online.offs = [
      conn.on('start', (m) => this.loadStart(m)),
      conn.on('act', (m) => this.received(m)),
      conn.on('turn', (m) => this.setTurn({ seat: m.seat, endsAt: Date.now() + m.ms })),
      conn.on('presence', (m) => this.presence(m)),
      conn.on('error', (m) => this.serverError(m)),
      conn.on('close', () => this.connectionLost()),
    ];
  }

  // 断开现在的连接（不算意外断开）：排着队的动作和计时都作废，连回来时服务器会发完整的 start
  dropConnection() {
    const online = this.online;
    if (!online) return;
    online.offs.forEach((off) => off());
    online.offs = [];
    online.conn?.close();
    online.conn = null;
    online.ready = false;
    online.queue = [];
    this.setTurn(null);
  }

  // 彻底放下联机（开新的一局、游戏被卸载）：不发 leave，服务器照样让电脑代打，凭存档里的凭证还能回去
  dropOnline() {
    if (!this.online) return;
    clearTimeout(this.online.retryTimer);
    this.dropConnection();
    this.online = null;
  }

  // 开局或回到对局：服务器发来完整的 start，按 log 直接重放出局面，不放动画
  loadStart(start, fresh = false) {
    const online = this.online;
    if (!online || start.game !== 'feixingqi') return;
    let match;
    try {
      const seats = start.config.players.map((_, k) => (k === start.seat ? 'local' : 'remote'));
      match = new Match({ config: start.config, seats, log: start.log, server: (action) => this.online?.conn?.send({ t: 'act', action }) });
    } catch {
      this.endOnline('这局联机读不出来了');
      return;
    }
    clearTimeout(online.retryTimer);
    Object.assign(online, { room: start.room, token: start.token, players: start.players, queue: [], ready: true, notice: '', attempt: 0 });
    this.setTurn(null);
    this.attach(match);
    this.hideOverlay();
    if (match.state.dice) this.setFace(match.state.dice);
    // 不在的这段时间里赢了的（比如电脑替你走完的），这里补记上；记过的不会再记
    this.countWin();
    if (fresh) this.toast(`${this.who(match.state.turn)}先走`);
    this.save();
    this.sendIdle();
    if (match.state.phase === 'over') this.finishOnline();
    this.advance();
  }

  // 服务器广播的动作先排队，前面的动画放完再一个个执行
  received({ seq, action }) {
    const online = this.online;
    if (!online.ready || !this.match) return;
    this.setTurn(null); // 有人出手了，这一步的计时作废，下一步服务器会重新发 turn
    online.queue.push({ seq, action });
    this.drain();
  }

  // 把排着队的动作一个个放出来；都放完了告诉服务器（idle），它才会让下一个人出手、开始计时
  drain() {
    const { online, match } = this;
    if (!online?.ready || !match || this.busy) return;
    while (online.queue.length && !this.busy) {
      const { seq, action } = online.queue.shift();
      // 没点就轮到自己的动作：超时了，服务器替你走的
      const forced = action?.seat === this.me && seq === match.log.length && !match.pending;
      try {
        if (!match.accept(seq, action)) continue; // 重复收到的，早就执行过了
      } catch {
        this.resync();
        return;
      }
      if (forced) this.toast('时间到，电脑替你走了一步');
      if (match.state.phase === 'over') {
        this.finishOnline();
        return;
      }
    }
    if (!this.busy) this.sendIdle();
  }

  sendIdle() {
    this.online?.conn?.send({ t: 'idle', seq: this.match.log.length });
  }

  // 和服务器对不上了（漏收了动作，或者动作执行不了）：整局重新要一次，服务器回 start 后重建
  resync() {
    const online = this.online;
    online.ready = false;
    online.queue = [];
    online.conn?.send({ t: 'resume', room: online.room, token: online.token });
  }

  setTurn(turn) {
    const online = this.online;
    if (!online) return;
    online.turn = turn;
    clearInterval(online.ticker);
    online.ticker = turn ? setInterval(() => this.renderClock(), 250) : 0;
    this.renderClock();
    this.renderPlayers();
  }

  presence({ seat, away }) {
    const p = this.online.players[seat];
    if (!p || p.away === away) return;
    p.away = away;
    this.toast(away ? `${p.name}掉线了，由电脑代打` : `${p.name}回来了`);
    this.renderPlayers();
    if (!this.busy && this.match?.state.turn === seat) this.advance();
  }

  serverError({ code, message }) {
    if (code === 'no-game') {
      this.endOnline('这局联机已经结束');
      return;
    }
    // 意图没被接受（多半是刚好超时，服务器已经替你走了）：不用提示，可以再点
    this.match?.reject();
    if (code !== 'bad-action') this.toast(message);
    if (!this.busy) this.advance();
  }

  // 连接意外断了：在前台就重连，切到后台断的不管，回到前台时会连
  connectionLost() {
    const online = this.online;
    this.dropConnection();
    if (online.closed || document.hidden) return;
    this.retry();
  }

  // 隔 1、2、4、8 秒重连一次，都连不上就让玩家选重试还是退出
  retry(err) {
    const online = this.online;
    if (online.attempt >= RETRY_MS.length) {
      this.showOffline(err?.message ?? '连不上联机服务器');
      return;
    }
    online.notice = '连接断了，正在重连…';
    online.retryTimer = setTimeout(() => this.rejoin(), RETRY_MS[online.attempt++]);
    if (!this.busy) this.advance();
  }

  // 连上服务器回到这一局：重新打开 App、从后台回来、断线重连都走这里。服务器回 start 后由 loadStart 重建
  async rejoin() {
    const online = this.online;
    if (!online || online.closed || document.hidden) return;
    clearTimeout(online.retryTimer);
    const conn = new Connection();
    this.useConnection(conn);
    try {
      await conn.connect();
    } catch (err) {
      if (this.online !== online || online.conn !== conn) return; // 等的时候已经退出或者换了连接
      this.dropConnection();
      // 服务器没上线、版本对不上，重试也没用
      if (err.code === 'no-server' || err.code === 'version') this.endOnline(err.message);
      else this.retry(err);
      return;
    }
    if (this.online !== online || online.conn !== conn) return;
    conn.send({ t: 'resume', room: online.room, token: online.token });
  }

  // 联机时自己管前后台：切到后台马上断开（服务器让电脑先替你走），回到前台再连上回到这一局。
  // 收起游戏页、看玩法介绍不算，连接一直留着，免得看一眼介绍座位就交给电脑
  visibilityChanged() {
    const online = this.online;
    if (!online || online.closed) return;
    if (document.hidden) {
      clearTimeout(online.retryTimer);
      this.dropConnection();
      return;
    }
    if (online.conn) return; // 已经连着或者正在连
    online.attempt = 0;
    online.notice = '正在回到联机对局…';
    if (!this.refs.overlay.hidden) this.showRejoining();
    else if (!this.busy) this.advance();
    this.rejoin();
  }

  // 这局下完了：连接用不着了，存档记成已结束
  finishOnline() {
    const online = this.online;
    clearTimeout(online.retryTimer);
    this.dropConnection();
    online.closed = true;
    this.save();
  }

  // 这局联机没法继续了（服务器上没有了、主动退出、连不上放弃）：回到开局设置，存档里不再留房间和凭证。
  // summary 写在继续条上，note 写在开局设置面板上
  endOnline(summary, note = summary) {
    const online = this.online;
    clearTimeout(online.retryTimer);
    this.dropConnection();
    online.closed = true;
    online.summary = summary;
    this.save();
    this.showSetup(note);
  }

  // 打开 App 回到联机对局时，连上之前盖在棋盘上的面板
  showRejoining() {
    this.refs.overlay.innerHTML = `
      <div class="fx-panel">
        <h3>联机对战</h3>
        <p class="fx-wait"><span class="fx-spinner"></span>正在回到联机对局…</p>
      </div>`;
    this.refs.overlay.hidden = false;
    this.say('正在回到联机对局…', '');
    this.refs.dice.disabled = true;
    this.refs.dice.classList.remove('is-ready');
  }

  // 重连了几次都不行：重试，或者退出（座位留给电脑，不再回去）
  showOffline(message) {
    const { overlay } = this.refs;
    overlay.innerHTML = `
      <div class="fx-panel">
        <h3>连不上联机对局</h3>
        <p>${esc(message)}</p>
        <div class="fx-actions">
          <button class="fx-btn" data-quit>退出</button>
          <button class="fx-btn is-primary" data-retry>重试</button>
        </div>
      </div>`;
    overlay.querySelector('[data-quit]').addEventListener('click', () => this.endOnline('已退出联机对局', ''));
    overlay.querySelector('[data-retry]').addEventListener('click', () => {
      this.online.attempt = 0;
      this.showRejoining();
      this.rejoin();
    });
    overlay.hidden = false;
    this.say('连不上联机对局', '');
    this.refs.dice.disabled = true;
    this.refs.dice.classList.remove('is-ready');
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

  // 外壳收起游戏页、切到后台、打开玩法介绍时调用。联机的连接不在这里断（切后台由 visibilityChanged 管）
  pause() {
    this.stop();
    // 联机时正在放的动画直接跳到结尾（见 tween），排着队的动作接着执行，不让别人等
    if (this.online) {
      for (const tween of this.tweens.splice(0)) {
        tween.update(1);
        tween.resolve();
      }
    }
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
    this.closeLobby();
    this.dropOnline();
    document.removeEventListener('visibilitychange', this.onVisibility);
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
