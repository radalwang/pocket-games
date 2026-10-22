// 大富翁：2 到 4 人轮流掷骰子绕着棋盘走，买地、盖房、收过路费，最后身家最高（或者没破产的那个）赢。
// 可以在同一台手机上轮流玩、和电脑玩，也可以联机和别人玩（服务器说了算，见 ONLINE.md 和 server/PROTOCOL.md）：
//   board.js 棋盘和卡牌 · engine.js 规则（纯计算，可重放）· table.js 牌桌和 transport · ai.js 电脑玩家 · 这里只管画面和操作。
// 界面从不直接改局面：点按钮只是 table.submit 一个动作，局面变了以后按事件一步步播动画。接口说明见 js/player.js。

import guide from './guide.js';
import { GROUPS, JAIL, LEVEL_NAMES, SALARY, SEAT_COLORS, SEAT_NAMES, STATION_RENT, TILES, UTILITY_RATE, isBuyable } from './board.js';
import { RULES_VERSION, ROUND_OPTIONS, houseCost, netWorth, rentOf, replay } from './engine.js';
import { OnlineTransport, Table } from './table.js';
import { decide } from './ai.js';
import { openLobby } from '../../js/lobby.js';
import { Connection, OnlineError } from '../../js/online.js';
import { esc, toast } from '../../js/ui.js';

const KIND_NAMES = { human: '本机', ai: '电脑' };
const DEFAULT_SETUP = { count: 3, kinds: ['human', 'ai', 'ai', 'ai'], rounds: 20 };
const SOLO_SETUP = { count: 4, kinds: ['human', 'ai', 'ai', 'ai'], rounds: 20 }; // 联机匹配只等到自己、选了「和电脑玩」
const N = TILES.length;

const RETRY_MS = [1000, 2000, 4000, 8000]; // 联机断了：先马上连一次，不行再隔这么久各试一次
const GONE = new Set(['no-game', 'version', 'no-server']); // 这几种错误重连也没用
const GONE_TEXT = '这局联机已经结束';
const TURN_MS = 30_000; // 服务器给每一步的限时（server/games.js），这里只用来画剩下多少
const URGENT_MS = 10_000; // 自己的回合只剩这么多时，秒数变红

const DICE_MS = 550;
const STEP_MS = 150;
const BEAT_MS = 450; // 交钱、买地这类消息停留一下
const CARD_MS = 1500;
const AI_MS = 650; // 轮到电脑时先等一下，看得清是谁在走

const fmt = (n) => n.toLocaleString('zh-CN');
const money = (n) => `¥${fmt(n)}`;
const clone = (o) => JSON.parse(JSON.stringify(o));

// 第 i 格在 8×8 棋盘上的 [行, 列]：起点在右下角，沿底边往左，再沿左边往上、顶边往右、右边往下
function cellOf(i) {
  if (i <= 7) return [7, 7 - i];
  if (i <= 14) return [14 - i, 0];
  if (i <= 21) return [0, i - 14];
  return [i - 21, 7];
}

// 色带朝向棋盘里面：底边的格子色带在上，左边的在右，以此类推
const sideOf = (i) => (i < 7 ? 'b' : i < 14 ? 'l' : i < 21 ? 't' : 'r');

// 棋盘上的格子很小，钱数不带 ¥ 才放得下（点开格子看详情时带）
const CORNER_NOTES = { start: `+${fmt(SALARY)}`, jail: '探监', park: '休息', gotojail: '去坐牢' };
const DECK_NAMES = { chance: '机会', fate: '命运' };

// 骰子面：3×3 的点位
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
const dieFace = (v) => `<svg viewBox="0 0 30 30" aria-hidden="true">${PIPS[v].map((k) => `<circle cx="${7 + (k % 3) * 8}" cy="${7 + Math.floor(k / 3) * 8}" r="2.8"/>`).join('')}</svg>`;

const TEMPLATE = `
  <div class="mono">
    <div class="mono-setup" data-ref="setup" hidden>
      <div class="mono-field">
        <span>人数</span>
        <div class="mono-seg" data-ref="count">${[2, 3, 4].map((n) => `<button data-count="${n}">${n} 人</button>`).join('')}</div>
      </div>
      <div class="mono-seats" data-ref="seats"></div>
      <div class="mono-field">
        <span>打几轮</span>
        <div class="mono-seg" data-ref="rounds">${ROUND_OPTIONS.map((r) => `<button data-rounds="${r}">${r ? `${r} 轮` : '不限'}</button>`).join('')}</div>
      </div>
      <p class="mono-note" data-ref="setupNote"></p>
      <button class="mono-primary mono-start" data-ref="start">开始游戏</button>
      <button class="mono-secondary mono-start" data-ref="versus">联机对战</button>
    </div>
    <div class="mono-game" data-ref="game" hidden>
      <div class="mono-players" data-ref="players"></div>
      <div class="mono-stage">
        <div class="mono-board" data-ref="board">
          <div class="mono-center">
            <div class="mono-turn" data-ref="turn"></div>
            <div class="mono-dice" data-ref="dice"><div class="mono-die"></div><div class="mono-die"></div></div>
            <p class="mono-msg" data-ref="msg"></p>
            <div class="mono-actions" data-ref="actions"></div>
            <div class="mono-card" data-ref="card" hidden></div>
          </div>
          <div class="mono-tokens" data-ref="tokens"></div>
        </div>
      </div>
      <ol class="mono-log" data-ref="log"></ol>
      <div class="mono-foot">
        <button data-ref="resign">认输</button>
        <button data-ref="restart">新一局</button>
      </div>
    </div>
    <div class="mono-sheet" data-ref="sheet" hidden></div>
    <div class="mono-overlay" data-ref="overlay" hidden></div>
  </div>`;

function loadStyles() {
  if (document.querySelector('link[data-game="monopoly"]')) return Promise.resolve();
  return new Promise((resolve) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('./style.css', import.meta.url).href;
    link.dataset.game = 'monopoly';
    link.onload = link.onerror = () => resolve();
    document.head.append(link);
  });
}

function isValidSetup(setup) {
  return Boolean(setup) && [2, 3, 4].includes(setup.count) && ROUND_OPTIONS.includes(setup.rounds)
    && Array.isArray(setup.kinds) && setup.kinds.length === 4 && setup.kinds.every((k) => k === 'human' || k === 'ai');
}

// 存档里的对局要能从头重放出来，规则版本也要对得上
function savedTable(saved) {
  const t = saved?.table;
  if (!t || t.v !== RULES_VERSION) return null;
  return replay(t.config, t.seed, t.log) ? t : null;
}

// 存档里的联机对局只有房间和凭证，局面要回到服务器那里去拿
function savedOnline(saved) {
  const o = saved?.online;
  return o && typeof o.room === 'string' && typeof o.token === 'string' ? { room: o.room, token: o.token } : null;
}

function newSeed() {
  try {
    return crypto.getRandomValues(new Int32Array(1))[0];
  } catch {
    return (Math.random() * 2 ** 32) | 0;
  }
}

class Monopoly {
  constructor(root, ctx) {
    this.ctx = ctx;
    this.records = { ...ctx.records };
    this.queue = []; // 还没播完的事件
    this.busy = false;
    this.fast = false; // 收起游戏页时剩下的动画一下播完，电脑也先不出手
    this.timer = 0;
    this.aiTimer = 0;
    this.lines = [];
    this.lobby = null; // 打开着的联机大厅
    this.online = null; // 联机对局：连接、座位、还没执行的动作……，见 beginOnline
    this.clockTimer = 0;
    this.onVisibility = () => this.visibilityChanged();

    root.innerHTML = TEMPLATE;
    this.root = root.firstElementChild;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.bindSetup();
    this.bindGame();

    this.setup = isValidSetup(ctx.saved?.setup) ? ctx.saved.setup : clone(DEFAULT_SETUP);
    const online = savedOnline(ctx.saved);
    const table = online ? null : savedTable(ctx.saved);
    if (online) this.backOnline(online, ctx.saved.counted === true);
    else if (table) this.open(table, { resumed: true, counted: ctx.saved.counted });
    else this.showSetup();
  }

  // ---------- 开局设置 ----------

  bindSetup() {
    const { count, rounds, seats, start, versus, overlay } = this.refs;
    count.addEventListener('click', (e) => {
      const button = e.target.closest('[data-count]');
      if (!button) return;
      this.setup.count = Number(button.dataset.count);
      this.renderSetup();
    });
    rounds.addEventListener('click', (e) => {
      const button = e.target.closest('[data-rounds]');
      if (!button) return;
      this.setup.rounds = Number(button.dataset.rounds);
      this.renderSetup();
    });
    seats.addEventListener('click', (e) => {
      const button = e.target.closest('[data-kind]');
      if (!button) return;
      this.setup.kinds[Number(button.dataset.seat)] = button.dataset.kind;
      this.renderSetup();
    });
    start.addEventListener('click', () => this.startGame());
    versus.addEventListener('click', () => this.openLobby());
    // 联机连接提示上的按钮（大厅自己的按钮用 data-act，这里用 data-net 分开）
    overlay.addEventListener('click', (e) => {
      const act = e.target.closest('[data-net]')?.dataset.net;
      if (act === 'retry') this.rejoin('正在重新连接…');
      if (act === 'quit') this.quitOnline();
    });
  }

  // 回到开局设置：现在这一局就不要了（还在播的动画、电脑的下一步、联机连接都停掉）
  showSetup() {
    this.closeLobby();
    this.endOnline();
    this.stopTimers();
    this.table?.close();
    this.table = null;
    this.queue = [];
    this.save();
    this.refs.game.hidden = true;
    this.refs.setup.hidden = false;
    this.renderSetup();
  }

  renderSetup() {
    const { count, rounds, seats, setupNote } = this.refs;
    const { setup } = this;
    for (const b of count.children) b.classList.toggle('is-active', Number(b.dataset.count) === setup.count);
    for (const b of rounds.children) b.classList.toggle('is-active', Number(b.dataset.rounds) === setup.rounds);
    seats.innerHTML = Array.from({ length: setup.count }, (_, i) => `
      <div class="mono-seat">
        <span class="mono-dot" style="--c:${SEAT_COLORS[i]}"></span>
        <strong>${SEAT_NAMES[i]}</strong>
        <div class="mono-seg is-small">
          ${Object.entries(KIND_NAMES).map(([kind, name]) => `<button data-seat="${i}" data-kind="${kind}"${setup.kinds[i] === kind ? ' class="is-active"' : ''}>${name}</button>`).join('')}
        </div>
      </div>`).join('');
    const humans = setup.kinds.slice(0, setup.count).filter((k) => k === 'human').length;
    setupNote.textContent = humans > 1
      ? `${humans} 位本机玩家轮流用这台手机操作`
      : humans === 1 ? '你和电脑对局，电脑会自己掷骰子、买地' : '全是电脑：坐着看它们对局';
  }

  startGame() {
    const { count, kinds, rounds } = this.setup;
    const config = {
      players: Array.from({ length: count }, (_, i) => ({ name: SEAT_NAMES[i], kind: kinds[i] })),
      rounds,
    };
    this.open({ config, seed: newSeed(), log: [] });
  }

  // ---------- 对局 ----------

  // 打开一局：读档、联机重连时把动作直接算到现在（不播动画），新开局时 log 是空的。
  // 联机时这台设备只操作自己的座位，电脑和别人都等服务器广播
  open({ config, seed, log }, { resumed = false, counted } = {}) {
    this.stopTimers();
    this.table?.close();
    const { online } = this;
    this.table = online
      ? new Table({ config, seed, log, transport: new OnlineTransport(online.conn), seats: [online.seat], hostsAI: false })
      : new Table({ config, seed, log });
    this.table.subscribe((events) => this.onEvents(events));
    // 这一局的输赢记过成绩没有，跟着存档走。早先的存档没有这一项：已经结束的当作记过了，免得记两次
    const over = this.table.state.phase === 'over';
    this.counted = typeof counted === 'boolean' ? counted : over;
    if (over) this.countWin();
    this.queue = [];
    this.busy = false;
    this.view = clone(this.table.state);
    if (!(online && resumed)) this.lines = []; // 联机断线回来接着用原来的记录
    this.refs.setup.hidden = true;
    this.refs.game.hidden = false;
    this.buildBoard();
    this.buildPlayers();
    this.renderAll();
    this.say(resumed ? (online ? '回到联机对局' : '接着上次的对局') : `开局！每人 ${money(this.view.players[0].cash)}`);
    if (over) this.say(this.overText());
    if (over && online) this.hangUp(); // 回来时这一局已经打完了：连接用不着了
    this.save();
    this.next();
  }

  get seatNames() {
    return this.table.config.players.map((p) => p.name);
  }

  bindGame() {
    const { board, actions, resign, restart, sheet } = this.refs;
    board.addEventListener('click', (e) => {
      const tile = e.target.closest('[data-tile]');
      if (tile) this.showTile(Number(tile.dataset.tile));
    });
    actions.addEventListener('click', (e) => {
      const button = e.target.closest('[data-act]');
      if (!button || button.disabled) return;
      const { act } = button.dataset;
      if (act === 'again') {
        // 联机打完了再来一局：回到联机大厅
        if (this.online) {
          this.endOnline();
          this.openLobby();
        } else {
          this.showSetup();
        }
        return;
      }
      if (act === 'back') {
        this.showSetup();
        return;
      }
      if (this.online?.pending) return;
      if (this.table.submit({ type: act, by: this.table.state.turn }) && this.online) {
        // 联机时要等服务器广播回来才算数，这之前按钮先变灰，免得点两下
        this.online.pending = true;
        this.renderActions();
      }
    });
    resign.addEventListener('click', () => {
      const s = this.table.state;
      const { online } = this;
      // 联机时随时都能认输（只认自己的座位），本机对局是轮到谁谁认输
      const seat = online ? online.seat : s.turn;
      if (s.phase === 'over' || this.table.controller(seat) !== 'local' || s.players[seat].out || online?.pending) return;
      if (!window.confirm(online ? '要认输吗？地和房子都会还给银行。' : `${this.seatNames[seat]}要认输吗？地和房子都会还给银行。`)) return;
      if (this.table.submit({ type: 'resign', by: seat }) && online) online.pending = true;
    });
    restart.addEventListener('click', () => {
      // 联机还没打完：退出后座位交给电脑。已经认输出局的只是在看，不用问
      const { online } = this;
      if (online && this.table?.state.phase !== 'over') {
        const out = this.table?.state.players[online.seat]?.out;
        if (!out && !window.confirm('退出联机对局？你的座位会交给电脑')) return;
        this.quitOnline();
        return;
      }
      // 结束的动画播完了就直接开新局；还没打完（或者最后一段还在播）先问一句
      const done = this.table.state.phase === 'over' && !this.busy;
      if (!done && !window.confirm('开新的一局，现在这一局就不要了，确定吗？')) return;
      this.showSetup();
    });
    sheet.addEventListener('click', (e) => {
      if (e.target === sheet || e.target.closest('[data-close]')) sheet.hidden = true;
    });
  }

  onEvents(events) {
    this.queue.push(...events);
    // 输赢一定下来就记成绩，和存档在同一步里：不等动画播到最后，中途开新局或者 App 被关掉都不会漏记
    const over = this.table.state.phase === 'over';
    if (over) this.countWin();
    if (over && this.online) this.hangUp(); // 联机这一局打完了，连接用不着了
    this.save();
    if (!this.busy) this.drain();
  }

  // 一个个播事件。播完以后画面和局面完全对齐，再看下一步该谁
  async drain() {
    const { table } = this;
    this.busy = true;
    this.renderActions();
    while (this.queue.length && this.table === table) await this.play(this.queue.shift());
    // 播的时候换了一局（新开局、回到设置），这一串就不用接着播了
    if (this.table !== table) return;
    this.busy = false;
    this.view = clone(this.table.state);
    this.renderAll();
    this.next();
  }

  // 轮到电脑时替它想好动作提交；本机玩家等按钮。联机时接着执行服务器发来的下一个动作
  // （收起游戏页、看玩法介绍时也照常执行，只是不播动画，免得拖住整桌）
  next() {
    clearTimeout(this.aiTimer);
    if (this.busy || !this.table) return;
    if (this.online) {
      this.pumpOnline();
      return;
    }
    if (this.fast) return;
    const s = this.table.state;
    if (s.phase === 'over' || this.table.controller(s.turn) !== 'ai') return;
    this.aiTimer = setTimeout(() => {
      const action = decide(this.table.state, this.table.state.turn);
      if (action) this.table.submit(action);
    }, AI_MS);
  }

  sleep(ms) {
    if (this.fast) return Promise.resolve();
    return new Promise((resolve) => {
      this.wake = resolve;
      this.timer = setTimeout(resolve, ms);
    });
  }

  stopTimers() {
    clearTimeout(this.timer);
    clearTimeout(this.aiTimer);
    this.wake?.();
  }

  async play(ev) {
    const { view } = this;
    // 名字先取好：播到一半可能回到了开局设置（this.table 变成 null），await 之后不能再去读它
    const names = this.seatNames;
    const name = (seat) => names[seat];
    const tileName = (i) => TILES[i].name;
    switch (ev.e) {
      case 'dice':
        await this.rollDice(ev.dice);
        this.say(`${name(ev.seat)}掷出 ${ev.dice[0]} + ${ev.dice[1]} = ${ev.dice[0] + ev.dice[1]}`);
        break;
      case 'move': {
        const dir = Math.sign(ev.steps);
        for (let k = 1; k <= Math.abs(ev.steps); k++) {
          view.players[ev.seat].pos = (((ev.from + dir * k) % N) + N) % N;
          this.renderTokens();
          await this.sleep(STEP_MS);
        }
        break;
      }
      case 'jail':
        view.players[ev.seat].pos = JAIL;
        this.renderTokens({ jump: true });
        this.say(`${name(ev.seat)}进了监狱，下回合停一次`);
        await this.sleep(BEAT_MS + 200);
        break;
      case 'salary':
        this.say(`${name(ev.seat)}经过起点，领 ${money(SALARY)}`);
        break;
      case 'cash':
        view.players[ev.seat].cash = ev.cash;
        this.renderPlayers();
        this.flash(ev.seat, ev.delta);
        break;
      case 'buy':
        view.owner[ev.tile] = ev.seat;
        this.renderTile(ev.tile);
        this.say(`${name(ev.seat)}花 ${money(ev.price)} 买下${tileName(ev.tile)}`);
        await this.sleep(BEAT_MS);
        break;
      case 'upgrade':
        view.level[ev.tile] = ev.level;
        this.renderTile(ev.tile);
        this.say(`${name(ev.seat)}在${tileName(ev.tile)}盖到${LEVEL_NAMES[ev.level]}`);
        await this.sleep(BEAT_MS);
        break;
      case 'rent':
        this.say(`${name(ev.seat)}踩到${name(ev.owner)}的${tileName(ev.tile)}，交过路费 ${money(ev.amount)}`);
        await this.sleep(BEAT_MS);
        break;
      case 'tax':
        this.say(`${name(ev.seat)}交${tileName(ev.tile)} ${money(ev.amount)}`);
        await this.sleep(BEAT_MS);
        break;
      case 'card':
        await this.showCard(ev.deck, ev.text);
        this.say(`${name(ev.seat)}抽到${DECK_NAMES[ev.deck]}：${ev.text}`);
        break;
      case 'freed':
        this.say(`${name(ev.seat)}用掉一张出狱卡，不用坐牢`);
        await this.sleep(BEAT_MS);
        break;
      case 'skip':
        this.say(`${name(ev.seat)}在坐牢，这回合停一次`);
        await this.sleep(BEAT_MS + 200);
        break;
      case 'poor':
        this.say(ev.upgrade ? `${name(ev.seat)}的钱不够在${tileName(ev.tile)}盖房` : `${name(ev.seat)}的钱不够买${tileName(ev.tile)}`);
        await this.sleep(BEAT_MS);
        break;
      case 'pass':
        this.say(ev.upgrade ? `${name(ev.seat)}没在${tileName(ev.tile)}盖房` : `${name(ev.seat)}没买${tileName(ev.tile)}`);
        break;
      case 'sell':
        view.owner[ev.tile] = ev.owner;
        view.level[ev.tile] = ev.level;
        this.renderTile(ev.tile);
        this.say(ev.owner < 0 ? `${name(ev.seat)}钱不够，把${tileName(ev.tile)}卖给了银行` : `${name(ev.seat)}钱不够，拆了${tileName(ev.tile)}的一层房子`);
        await this.sleep(BEAT_MS);
        break;
      case 'bankrupt':
        this.say(`${name(ev.seat)}破产了！`);
        await this.sleep(BEAT_MS + 300);
        break;
      case 'resign':
        this.say(`${name(ev.seat)}认输了`);
        break;
      case 'retire':
        view.players[ev.seat].out = true;
        for (const i of ev.tiles) {
          view.owner[i] = -1;
          view.level[i] = 0;
        }
        this.renderAll();
        break;
      case 'round':
        view.round = ev.round;
        this.renderTurn();
        break;
      case 'turn':
        view.turn = ev.seat;
        this.renderPlayers();
        this.renderTurn();
        break;
      case 'over':
        view.phase = 'over';
        view.winner = ev.winner;
        this.say(this.overText());
        break;
      default:
        break;
    }
  }

  overText() {
    const s = this.table.state;
    const winner = this.callName(s.winner);
    return s.ending === 'rounds' ? `${s.rounds} 轮打完，${winner}身家最高，赢了！` : `只剩${winner}没破产，赢了！`;
  }

  // 联机时自己的座位叫“你”（轮到谁、谁赢了），卡片和记录里还是写昵称
  callName(seat) {
    return this.online?.seat === seat ? '你' : this.seatNames[seat];
  }

  // ---------- 画面 ----------

  buildBoard() {
    const { board, tokens } = this.refs;
    board.querySelectorAll('.mono-tile').forEach((el) => el.remove());
    this.tiles = TILES.map((tile, i) => {
      const [r, c] = cellOf(i);
      const el = document.createElement('button');
      el.className = `mono-tile t-${tile.type} s-${sideOf(i)}`;
      el.dataset.tile = i;
      el.style.gridArea = `${r + 1} / ${c + 1}`;
      if (tile.group) el.style.setProperty('--g', GROUPS[tile.group].color);
      board.insertBefore(el, tokens);
      return el;
    });
    tokens.innerHTML = this.seatNames.map((_, seat) => `<span class="mono-token" style="--c:${SEAT_COLORS[seat]}"></span>`).join('');
    this.tokenEls = [...tokens.children];
  }

  renderAll() {
    TILES.forEach((_, i) => this.renderTile(i));
    this.renderTokens();
    this.renderPlayers();
    this.renderTurn();
    this.renderDice(this.view.dice);
    this.renderActions();
    this.renderLog();
  }

  renderTile(i) {
    const tile = TILES[i];
    const el = this.tiles[i];
    const owner = this.view.owner[i];
    const level = this.view.level[i];
    let foot = '';
    if (CORNER_NOTES[tile.type]) foot = CORNER_NOTES[tile.type];
    else if (tile.type === 'tax') foot = fmt(tile.amount);
    else if (isBuyable(tile)) foot = owner >= 0 ? (level === 4 ? '酒店' : '●'.repeat(level)) : fmt(tile.price);
    const glyph = tile.type === 'chance' ? '?' : tile.type === 'fate' ? '★' : '';
    el.innerHTML = `${tile.group ? '<span class="mono-band"></span>' : ''}<span class="mono-name">${tile.name}</span>${glyph ? `<span class="mono-glyph">${glyph}</span>` : ''}<span class="mono-sub">${foot}</span>`;
    el.classList.toggle('is-owned', owner >= 0);
    el.style.setProperty('--own', owner >= 0 ? SEAT_COLORS[owner] : 'transparent');
    el.setAttribute('aria-label', `${tile.name}${owner >= 0 ? `，${this.seatNames[owner]}的地` : ''}`);
  }

  // 同一格上的几个棋子错开摆，先摆在下半格（只挡住价格，不挡地名）
  renderTokens({ jump = false } = {}) {
    const slots = [[0.3, 0.8], [0.7, 0.8], [0.3, 0.52], [0.7, 0.52]];
    const crowd = new Map();
    this.view.players.forEach((p, seat) => {
      const el = this.tokenEls[seat];
      el.hidden = p.out;
      if (p.out) return;
      const k = crowd.get(p.pos) ?? 0;
      crowd.set(p.pos, k + 1);
      const [r, c] = cellOf(p.pos);
      const [ox, oy] = slots[k];
      el.style.setProperty('--x', c + ox);
      el.style.setProperty('--y', r + oy);
      el.classList.toggle('is-turn', seat === this.view.turn && this.view.phase !== 'over');
      el.classList.toggle('is-jump', jump);
    });
  }

  // 玩家卡片只建一次，之后原地更新，飘着的 +/- 数字不会被冲掉
  // 联机时名字是玩家自己起的昵称：放进页面前都要转义，太长的在卡片上截成省略号
  buildPlayers() {
    this.refs.players.innerHTML = this.seatNames.map((name, seat) => `
      <div class="mono-player" style="--c:${SEAT_COLORS[seat]}">
        <span class="mono-player-name"><span class="mono-dot"></span><b>${esc(name)}</b></span>
        <strong></strong>
        <small></small>
      </div>`).join('');
    this.chips = [...this.refs.players.children];
  }

  renderPlayers() {
    const { view, online } = this;
    const over = view.phase === 'over';
    view.players.forEach((p, seat) => {
      const chip = this.chips[seat];
      const away = Boolean(online?.players[seat]?.away) && !p.out && !over;
      const tags = [];
      if (over && !p.out) tags.push(`身家 ${money(netWorth(view, seat))}`);
      else if (this.table.config.players[seat].kind === 'ai') tags.push('电脑');
      else if (online?.seat === seat) tags.push('你');
      if (p.out) tags.push('出局');
      else if (away) tags.push('掉线<i> · 电脑</i>代打'); // 卡片窄时只写“掉线代打”（见 style.css）
      else if (p.jail) tags.push('坐牢');
      if (p.passes && !over) tags.push(`出狱卡 ${p.passes}`);
      const cash = chip.querySelector('strong');
      cash.textContent = money(p.cash);
      cash.classList.toggle('is-long', cash.textContent.length > 7); // 六位数起字小一号，四个人时也放得下
      chip.querySelector('small').innerHTML = tags.join(' · ') || ' '; // 都是固定的字和钱数，没有昵称
      chip.classList.toggle('is-turn', seat === view.turn && !over);
      chip.classList.toggle('is-out', p.out);
      chip.classList.toggle('is-away', away);
      chip.classList.toggle('is-winner', view.winner === seat);
    });
  }

  renderTurn() {
    const { view } = this;
    const rounds = view.rounds ? `第 ${Math.min(view.round, view.rounds)}/${view.rounds} 轮` : `第 ${view.round} 轮`;
    const name = `<b style="color:${SEAT_COLORS[view.turn]}">${esc(this.callName(view.turn))}</b>`;
    const who = view.phase === 'over' ? '游戏结束' : this.online?.seat === view.turn ? `轮到${name}了` : `轮到${name}`;
    this.refs.turn.innerHTML = `<span>${who}</span><small>${rounds}</small>`;
  }

  renderDice(dice) {
    const [a, b] = dice ?? [1, 1];
    const [d1, d2] = this.refs.dice.children;
    d1.innerHTML = dieFace(a);
    d2.innerHTML = dieFace(b);
    this.refs.dice.classList.toggle('is-idle', !dice);
  }

  async rollDice(dice) {
    const { dice: box } = this.refs;
    box.classList.add('is-rolling');
    box.classList.remove('is-idle');
    const until = performance.now() + DICE_MS;
    while (!this.fast && performance.now() < until) {
      this.renderDice([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
      await this.sleep(70);
    }
    box.classList.remove('is-rolling');
    this.view.dice = dice;
    this.renderDice(dice);
  }

  // 中间的按钮：只给这台设备上的真人；电脑和联机对手显示在等谁
  renderActions() {
    const { actions } = this.refs;
    const { online } = this;
    const s = this.table.state;
    const seat = s.turn;
    const name = this.seatNames[seat];
    const pending = Boolean(online?.pending);
    const button = (act, label, primary = false) => `<button class="${primary ? 'mono-primary' : 'mono-secondary'}" data-act="${act}"${pending ? ' disabled' : ''}>${label}</button>`;
    this.refs.resign.disabled = s.phase === 'over' || (online ? s.players[online.seat].out : this.table.controller(seat) !== 'local');
    // 动画播完之前不给按钮，结束时也等最后一段播完再出“再来一局”
    if (this.busy) {
      actions.innerHTML = '';
      return;
    }
    if (s.phase === 'over') {
      // 联机打完了：再来一局回大厅，返回回到开局设置
      actions.innerHTML = online ? `${button('back', '返回')}${button('again', '再来一局', true)}` : button('again', '再来一局', true);
      return;
    }
    const controller = this.table.controller(seat);
    if (controller !== 'local') {
      const text = this.table.config.players[seat].kind === 'ai' ? `${name}（电脑）在想…`
        : online?.players[seat]?.away ? `${name}掉线了，电脑代打…` : `等${name}出手…`;
      actions.innerHTML = `<p class="mono-wait">${esc(text)}</p>`;
      return;
    }
    const i = s.players[seat].pos;
    const tile = TILES[i];
    let html = '';
    if (s.phase === 'roll') html = button('roll', '掷骰子', true);
    else if (s.phase === 'buy') html = `<p class="mono-ask">买下${tile.name}？</p>${button('pass', '不买')}${button('buy', `买 ${money(tile.price)}`, true)}`;
    else if (s.phase === 'upgrade') {
      const next = LEVEL_NAMES[s.level[i] + 1];
      html = `<p class="mono-ask">在${tile.name}盖到${next}？</p>${button('pass', '不盖')}${button('upgrade', `盖 ${money(houseCost(i))}`, true)}`;
    }
    // 联机限时：按钮下面写还剩几秒（tickClock 每隔一会儿更新）
    if (online?.clock?.seat === seat) html += '<p class="mono-clock"></p>';
    actions.innerHTML = html;
    if (online) this.tickClock();
  }

  say(text) {
    this.refs.msg.textContent = text;
    this.lines.unshift(text);
    this.lines.length = Math.min(this.lines.length, 40);
    this.renderLog();
  }

  renderLog() {
    this.refs.log.innerHTML = this.lines.slice(1, 5).map((line) => `<li>${esc(line)}</li>`).join('');
  }

  // 钱变了：在玩家卡片上飘一个 +/- 的数
  flash(seat, delta) {
    const chip = this.chips[seat];
    if (!chip || this.fast) return;
    const tag = document.createElement('span');
    tag.className = `mono-delta${delta > 0 ? ' is-gain' : ''}`;
    tag.textContent = `${delta > 0 ? '+' : '−'}${fmt(Math.abs(delta))}`;
    chip.append(tag);
    tag.addEventListener('animationend', () => tag.remove(), { once: true });
  }

  async showCard(deck, text) {
    const { card } = this.refs;
    card.innerHTML = `<small>${DECK_NAMES[deck]}</small><p>${text}</p>`;
    card.className = `mono-card is-${deck}`;
    card.hidden = false;
    await this.sleep(CARD_MS);
    card.hidden = true;
  }

  // 点一格看详情：价格、各级过路费、谁的地
  showTile(i) {
    const tile = TILES[i];
    const s = this.view;
    const owner = s.owner[i];
    const rows = [];
    const ownerLine = isBuyable(tile) ? (owner >= 0 ? `${esc(this.seatNames[owner])}的地${tile.type === 'city' ? ` · ${LEVEL_NAMES[s.level[i]]}` : ''}` : `没人买 · 地价 ${money(tile.price)}`) : '';
    if (tile.type === 'city') {
      tile.rent.forEach((rent, level) => {
        const label = level === 0 ? '空地（一整组都买下翻倍）' : LEVEL_NAMES[level];
        rows.push([label, money(rent), owner >= 0 && s.level[i] === level]);
      });
      rows.push(['每盖一层', money(houseCost(i))]);
    } else if (tile.type === 'station') {
      STATION_RENT.forEach((rent, k) => rows.push([`有 ${k + 1} 个车站`, money(rent)]));
    } else if (tile.type === 'utility') {
      rows.push(['过路费', `点数 × ${UTILITY_RATE}`]);
    } else if (tile.type === 'tax') {
      rows.push(['停在这里交', money(tile.amount)]);
    }
    const notes = {
      start: `每次经过或停在这里领 ${money(SALARY)}。`,
      jail: '路过只是探监。被送进来的人下一回合停一次。',
      park: '休息一下，什么也不发生。',
      gotojail: '停在这里直接进监狱，下一回合停一次。有出狱卡会自动用掉。',
      chance: '抽一张机会卡：可能前进、后退、拿钱、罚款，也可能直接入狱。',
      fate: '抽一张命运卡：可能中奖、交维修费，也可能和大家互相送钱。',
    };
    const current = owner >= 0 && isBuyable(tile) ? `<p class="mono-sheet-now">现在踩上去要交 <b>${money(rentOf(s, i))}</b></p>` : '';
    this.refs.sheet.innerHTML = `
      <div class="mono-sheet-card">
        <div class="mono-sheet-head" style="--g:${GROUPS[tile.group]?.color ?? 'var(--fill-2)'}">
          <strong>${tile.name}</strong>${ownerLine ? `<small>${ownerLine}</small>` : ''}
        </div>
        ${notes[tile.type] ? `<p class="mono-sheet-note">${notes[tile.type]}</p>` : ''}
        ${rows.length ? `<dl>${rows.map(([k, v, on]) => `<div${on ? ' class="is-on"' : ''}><dt>${k}</dt><dd>${v}</dd></div>`).join('')}</dl>` : ''}
        ${current}
        <button class="mono-secondary" data-close>好的</button>
      </div>`;
    this.refs.sheet.hidden = false;
  }

  // ---------- 联机 ----------
  // 服务器说了算（server/PROTOCOL.md）：这里只发“想做什么”，服务器掷骰子、排好先后再广播给所有人，
  // 收到的动作按顺序一个个执行，上一个的动画播完才执行下一个，全部播完告诉服务器（idle），它才让下一个人出手。

  // 打开联机大厅（js/lobby.js），盖在开局设置或者刚打完的对局上面
  openLobby() {
    this.closeLobby();
    this.refs.overlay.hidden = false;
    this.lobby = openLobby(this.refs.overlay, {
      game: 'monopoly',
      rules: RULES_VERSION,
      title: '大富翁',
      options: [{ key: 'rounds', label: '轮数', choices: ROUND_OPTIONS.map((r) => ({ value: r, label: r ? `${r} 轮` : '不限' })), value: this.setup.rounds }],
      onStart: (connection, start) => this.goOnline(connection, start),
      onBack: () => this.showSetup(),
      onSolo: () => {
        this.closeLobby();
        this.setup = clone(SOLO_SETUP);
        this.startGame();
      },
    });
  }

  // 关掉大厅（开局以后大厅已经把连接交出来了，这时 close 不会断开它）
  closeLobby() {
    this.lobby?.close();
    this.lobby = null;
    this.hideOverlay();
  }

  hideOverlay() {
    this.refs.overlay.hidden = true;
    this.refs.overlay.innerHTML = '';
  }

  // 联机这一局的状态。room、token 用来回到这一局；conn 是现在的连接，断开时为 null
  beginOnline({ room, token }) {
    this.endOnline();
    this.online = {
      room,
      token,
      seat: -1,
      players: [], // 服务器的 start 里按座位排的 { name, ai, away }
      conn: null,
      offs: [],
      inbox: [], // 收到了、还没执行的动作（上一个的动画还在播）
      idle: -1, // 上次告诉服务器已经播到第几个动作
      pending: false, // 发了动作还没等到服务器广播回来：按钮先变灰，免得点两下
      resyncing: false,
      clock: null, // 服务器正在给谁计时：{ seat, endsAt }
      gen: 0, // 每次重连、断开都加一，过时的重连结果直接丢掉
      retry: 0, // 等下一次重连的计时器，wake 提前叫醒它
      wake: null,
    };
    document.addEventListener('visibilitychange', this.onVisibility);
    return this.online;
  }

  // 大厅凑齐了人、开局了：连接从此归这一局管
  goOnline(connection, start) {
    this.closeLobby();
    this.beginOnline(start);
    this.counted = false;
    this.attach(connection);
    this.openOnline(start, { resumed: false });
  }

  // 打开游戏时存档里是一局联机对局：先连上服务器要回完整局面，拿到以后再搭牌桌
  backOnline(saved, counted) {
    this.beginOnline(saved);
    this.counted = counted;
    this.refs.setup.hidden = true;
    this.refs.game.hidden = true;
    this.rejoin('正在回到联机对局…');
  }

  // 按服务器的 start 搭牌桌：开局，或者回到对局（动作直接算到现在，不播动画）
  openOnline(start, { resumed }) {
    Object.assign(this.online, {
      room: start.room, token: start.token, seat: start.seat, players: start.players,
      inbox: [], idle: -1, pending: false, resyncing: false, clock: null,
    });
    this.hideOverlay();
    this.open({ config: start.config, seed: start.seed, log: start.log }, { resumed, counted: this.counted });
  }

  // 接手一条连接：服务器广播的动作、计时、有人掉线都从这里来
  attach(conn) {
    const { online } = this;
    online.conn = conn;
    online.offs = [
      conn.on('act', (m) => this.onAct(m)),
      conn.on('turn', (m) => {
        online.clock = { seat: m.seat, endsAt: performance.now() + m.ms };
        this.renderActions();
        this.tickClock();
      }),
      conn.on('presence', (m) => this.onPresence(m)),
      conn.on('start', (m) => this.openOnline(m, { resumed: true })), // 自己算岔了、要来的完整局面
      conn.on('error', (m) => this.onOnlineError(m)),
      conn.on('close', () => this.onClose(conn)),
    ];
  }

  onAct(m) {
    const { online } = this;
    if (m.action?.by === online.seat) online.pending = false;
    online.clock = null; // 每执行一步，服务器都重新计时
    online.inbox.push(m);
    this.tickClock();
    this.pumpOnline();
  }

  // 执行收到的动作：动画播完一个再执行下一个。都播完了告诉服务器
  pumpOnline() {
    const { online, table } = this;
    if (!online || !table || online.resyncing) return;
    while (!this.busy && online.inbox.length) {
      const { seq, action } = online.inbox.shift();
      if (seq < table.log.length) continue; // 执行过了
      const before = table.log.length;
      if (seq === before) table.transport.deliver?.(action);
      // 漏了动作，或者和服务器算得不一样：向服务器要一份完整的局面
      if (table.log.length === before) {
        this.resync();
        return;
      }
    }
    if (this.busy || online.inbox.length || online.idle === table.log.length) return;
    online.idle = table.log.length;
    online.conn?.send({ t: 'idle', seq: online.idle });
  }

  resync() {
    const { online } = this;
    online.resyncing = true;
    online.inbox = [];
    online.conn?.send({ t: 'resume', room: online.room, token: online.token });
  }

  onPresence({ seat, away }) {
    const { online } = this;
    if (!online.players[seat]) return;
    online.players[seat].away = away;
    if (away && online.clock?.seat === seat) online.clock = null;
    const name = this.seatNames[seat];
    this.say(away ? `${name}掉线了，先由电脑代打` : `${name}回来了`);
    this.renderPlayers();
    this.renderActions();
  }

  onOnlineError(m) {
    if (m.code === 'no-game') {
      this.onlineGone();
      return;
    }
    if (m.code === 'bad-action') {
      // 多半是和限时到点撞上了：服务器已经替你走了，画面会跟上
      this.online.pending = false;
      this.renderActions();
      return;
    }
    toast(m.message);
  }

  // 连接意外断了：在前台就马上重连，在后台的等回到前台再连
  onClose(conn) {
    const { online } = this;
    if (!online || online.conn !== conn) return;
    this.hangUp();
    if (this.table?.state.phase === 'over' || document.hidden) return;
    this.rejoin('连接断了，正在重连…');
  }

  // 真的切到后台（锁屏、换 App）才断开：服务器马上让电脑替你走，回到前台再连上接着打。
  // 收起游戏页、看玩法介绍只是 pause，连接不断，座位也不会交给电脑
  visibilityChanged() {
    const { online } = this;
    if (!online || this.table?.state.phase === 'over') return;
    if (document.hidden) {
      this.hangUp();
      if (this.table) this.save();
    } else if (!online.conn) {
      this.rejoin('正在回到联机对局…');
    }
  }

  // 连上服务器回到这一局：先马上连一次，不行再隔 1、2、4、8 秒各试一次。服务器说这局没了就回开局设置；
  // 一直连不上时，打到一半的给「重试 / 退出」，刚打开游戏、牌桌还没搭起来的就当这局已经结束
  async rejoin(text) {
    const { online } = this;
    if (!online) return;
    this.hangUp();
    const gen = online.gen;
    this.notice(text, { waiting: true });
    for (let k = 0; ; k++) {
      try {
        await this.resumeOnline(online, gen);
        return;
      } catch (err) {
        if (!this.live(online, gen)) return;
        if (GONE.has(err.code)) {
          this.onlineGone(err.code === 'version' ? err.message : GONE_TEXT);
          return;
        }
        if (k === RETRY_MS.length) {
          if (this.table) this.notice('连不上联机服务器，电脑先替你走着', { waiting: false });
          else this.onlineGone();
          return;
        }
      }
      await new Promise((resolve) => {
        online.wake = resolve;
        online.retry = setTimeout(resolve, RETRY_MS[k]);
      });
      if (!this.live(online, gen)) return;
    }
  }

  live(online, gen) {
    return this.online === online && online.gen === gen;
  }

  // 新开一条连接发 resume。服务器回 start 时当场接手这条连接，紧跟着来的消息（比如计时）不会漏掉
  async resumeOnline(online, gen) {
    const conn = new Connection();
    await conn.connect();
    if (!this.live(online, gen)) {
      conn.close();
      return;
    }
    await new Promise((resolve, reject) => {
      const offs = [
        conn.on('start', (m) => {
          stop();
          if (!this.live(online, gen)) {
            conn.close();
          } else {
            this.attach(conn);
            this.openOnline(m, { resumed: true });
          }
          resolve();
        }),
        conn.on('error', (m) => {
          stop();
          conn.close();
          reject(new OnlineError(m.code, m.message));
        }),
        conn.on('close', () => {
          stop();
          reject(new OnlineError('unreachable', '和联机服务器断开了'));
        }),
      ];
      const stop = () => offs.forEach((off) => off());
      conn.send({ t: 'resume', room: online.room, token: online.token });
    });
  }

  // 断开现在的连接（自己断的不算意外，不会触发重连），正在等的重连也作废
  hangUp() {
    const { online } = this;
    if (!online) return;
    online.gen += 1;
    clearTimeout(online.retry);
    online.wake?.();
    online.offs.forEach((off) => off());
    online.offs = [];
    online.conn?.close();
    online.conn = null;
    online.inbox = [];
    online.clock = null;
    this.tickClock();
  }

  // 不再联机：断开连接，回到前台也不再重连
  endOnline() {
    if (!this.online) return;
    this.hangUp();
    this.online = null;
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.hideOverlay();
  }

  // 主动退出这局联机：告诉服务器（座位交给电脑），回到开局设置
  quitOnline() {
    this.online?.conn?.send({ t: 'leave' });
    this.showSetup();
  }

  // 服务器上已经没有这一局了（服务器重启过、或者打完太久）：回到开局设置，存档也不再记着它
  onlineGone(text = GONE_TEXT) {
    this.showSetup();
    this.refs.setupNote.textContent = text;
    toast(text);
  }

  // 联机连接的提示，盖在棋盘上：正在连（转圈，也可以退出），或者一直连不上（重试 / 退出）
  notice(text, { waiting }) {
    const { overlay } = this.refs;
    overlay.hidden = false;
    overlay.innerHTML = `
      <div class="lobby">
        <h3>联机对战</h3>
        ${waiting
          ? `<p class="lobby-wait"><span class="lobby-spinner"></span>${text}</p><button class="lobby-link" data-net="quit">退出</button>`
          : `<p>${text}</p><div class="lobby-row"><button class="lobby-btn" data-net="quit">退出</button><button class="lobby-btn is-primary" data-net="retry">重试</button></div>`}
      </div>`;
  }

  // 联机限时：自己的回合在按钮下面写还剩几秒，别人的回合在他的卡片底下画一条慢慢变短的线
  tickClock() {
    clearTimeout(this.clockTimer);
    const clock = this.online?.clock;
    const left = clock ? Math.max(0, clock.endsAt - performance.now()) : 0;
    this.chips?.forEach((chip, seat) => {
      const timed = seat === clock?.seat;
      chip.classList.toggle('is-timed', timed);
      if (timed) chip.style.setProperty('--left', Math.min(1, left / TURN_MS).toFixed(3));
    });
    const text = this.refs.actions.querySelector('.mono-clock');
    if (text) {
      text.textContent = `还剩 ${Math.ceil(left / 1000)} 秒`;
      text.classList.toggle('is-urgent', left <= URGENT_MS);
    }
    if (left > 0) this.clockTimer = setTimeout(() => this.tickClock(), 250);
  }

  // ---------- 存档与生命周期 ----------

  summary() {
    const s = this.table?.state;
    if (!s) return '准备开局';
    if (s.phase === 'over') return `${this.callName(s.winner)}赢了`;
    const rounds = s.rounds ? `第 ${s.round}/${s.rounds} 轮` : `第 ${s.round} 轮`;
    if (this.online) return `联机对战中 · ${rounds}`;
    const me = s.players.findIndex((p, seat) => p.kind === 'human' && !p.out);
    return me >= 0 ? `${rounds} · ${s.players[me].name} ${money(s.players[me].cash)}` : rounds;
  }

  // 一局分出输赢时记一次成绩：这台设备上的玩家赢了才算。联机赢了都算；本机对局要对手里有电脑（几个人轮流玩的不算）。
  // counted 保证一局只记一次，跟着存档走（联机断线、App 被关掉再回来也不会多记）
  countWin() {
    if (this.counted) return;
    this.counted = true;
    const { config, state } = this.table;
    const rivals = this.online || config.players.some((p) => p.kind === 'ai');
    if (this.table.controller(state.winner) === 'local' && rivals) {
      this.records.wins = this.ctx.submitRecord('wins', (this.records.wins ?? 0) + 1);
    }
  }

  save() {
    const { online } = this;
    if (online) {
      // 联机只存回到这一局要用的房间和凭证，局面回来时找服务器要；打完了就不用再回去
      const over = this.table?.state.phase === 'over';
      const state = over ? { setup: this.setup } : { setup: this.setup, online: { room: online.room, token: online.token }, counted: this.counted };
      this.ctx.save(state, { summary: this.summary(), finished: over });
      return;
    }
    const table = this.table ? this.table.snapshot() : null;
    this.ctx.save({ setup: this.setup, table, counted: this.counted }, { summary: this.summary(), finished: !table || this.table.state.phase === 'over' });
  }

  // 收起游戏页、切到后台或者看玩法介绍：剩下的动画一下播完，电脑先不出手。联机时连接不动（真切到后台的另见 visibilityChanged）
  pause() {
    this.fast = true;
    this.stopTimers();
    if (this.table) this.save();
  }

  resume() {
    this.fast = false;
    this.next();
  }

  // 卸载：断开联机（座位交给电脑，存档还在，下次打开再回来），不存档
  destroy() {
    this.fast = true;
    this.stopTimers();
    this.closeLobby();
    this.endOnline();
    this.table?.close();
  }
}

export default {
  guide,
  async mount(root, ctx) {
    await loadStyles();
    const game = new Monopoly(root, ctx);
    return {
      pause: () => game.pause(),
      resume: () => game.resume(),
      destroy: () => game.destroy(),
    };
  },
};
