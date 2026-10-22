// 大富翁：2 到 4 人轮流掷骰子绕着棋盘走，买地、盖房、收过路费，最后身家最高（或者没破产的那个）赢。
// 现在可以在同一台手机上轮流玩，也可以和电脑玩；代码按联机的方式分了层，以后接联机见 ONLINE.md：
//   board.js 棋盘和卡牌 · engine.js 规则（纯计算，可重放）· table.js 牌桌和 transport · ai.js 电脑玩家 · 这里只管画面和操作。
// 界面从不直接改局面：点按钮只是 table.submit 一个动作，局面变了以后按事件一步步播动画。接口说明见 js/player.js。

import guide from './guide.js';
import { GROUPS, JAIL, LEVEL_NAMES, SALARY, SEAT_COLORS, SEAT_NAMES, STATION_RENT, TILES, UTILITY_RATE, isBuyable } from './board.js';
import { RULES_VERSION, ROUND_OPTIONS, houseCost, netWorth, rentOf, replay } from './engine.js';
import { Table } from './table.js';
import { decide } from './ai.js';

const KIND_NAMES = { human: '本机', ai: '电脑', online: '联机' };
const DEFAULT_SETUP = { count: 3, kinds: ['human', 'ai', 'ai', 'ai'], rounds: 20 };
const N = TILES.length;

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

    root.innerHTML = TEMPLATE;
    this.root = root.firstElementChild;
    this.refs = {};
    root.querySelectorAll('[data-ref]').forEach((el) => {
      this.refs[el.dataset.ref] = el;
    });
    this.bindSetup();
    this.bindGame();

    this.setup = isValidSetup(ctx.saved?.setup) ? ctx.saved.setup : clone(DEFAULT_SETUP);
    const table = savedTable(ctx.saved);
    if (table) this.open(table, { resumed: true, counted: ctx.saved.counted });
    else this.showSetup();
  }

  // ---------- 开局设置 ----------

  bindSetup() {
    const { count, rounds, seats, start } = this.refs;
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
      if (button.dataset.kind === 'online') {
        this.refs.setupNote.textContent = '联机对战还在做，现在可以和电脑玩，或者几个人轮流用这台手机玩';
        return;
      }
      this.setup.kinds[Number(button.dataset.seat)] = button.dataset.kind;
      this.renderSetup();
    });
    start.addEventListener('click', () => this.startGame());
  }

  // 回到开局设置：现在这一局就不要了（还在播的动画、电脑的下一步都停掉）
  showSetup() {
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
          ${Object.entries(KIND_NAMES).map(([kind, name]) => `<button data-seat="${i}" data-kind="${kind}" class="${setup.kinds[i] === kind ? 'is-active' : ''}${kind === 'online' ? ' is-soon' : ''}">${name}</button>`).join('')}
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

  // 打开一局：读档时把动作重放一遍，新开局时 log 是空的
  open({ config, seed, log }, { resumed = false, counted } = {}) {
    this.stopTimers();
    this.table?.close();
    this.table = new Table({ config, seed, log });
    this.table.subscribe((events) => this.onEvents(events));
    // 这一局的输赢记过成绩没有，跟着存档走。早先的存档没有这一项：已经结束的当作记过了，免得记两次
    const over = this.table.state.phase === 'over';
    this.counted = typeof counted === 'boolean' ? counted : over;
    if (over) this.countWin();
    this.queue = [];
    this.busy = false;
    this.view = clone(this.table.state);
    this.lines = [];
    this.refs.setup.hidden = true;
    this.refs.game.hidden = false;
    this.buildBoard();
    this.buildPlayers();
    this.renderAll();
    this.say(resumed ? '接着上次的对局' : `开局！每人 ${money(this.view.players[0].cash)}`);
    if (this.view.phase === 'over') this.say(this.overText());
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
      if (!button) return;
      if (button.dataset.act === 'again') {
        this.showSetup();
        return;
      }
      this.table.submit({ type: button.dataset.act, by: this.table.state.turn });
    });
    resign.addEventListener('click', () => {
      const s = this.table.state;
      if (s.phase === 'over' || this.table.controller(s.turn) !== 'local') return;
      if (!window.confirm(`${this.seatNames[s.turn]}要认输吗？地和房子都会还给银行。`)) return;
      this.table.submit({ type: 'resign', by: s.turn });
    });
    restart.addEventListener('click', () => {
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
    if (this.table.state.phase === 'over') this.countWin();
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

  // 轮到电脑时替它想好动作提交；本机玩家等按钮，联机对手等 transport
  next() {
    clearTimeout(this.aiTimer);
    if (this.fast || this.busy || !this.table) return;
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
    const winner = this.seatNames[s.winner];
    return s.ending === 'rounds' ? `${s.rounds} 轮打完，${winner}身家最高，赢了！` : `只剩${winner}没破产，赢了！`;
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
  buildPlayers() {
    this.refs.players.innerHTML = this.seatNames.map((name, seat) => `
      <div class="mono-player" style="--c:${SEAT_COLORS[seat]}">
        <span class="mono-player-name"><span class="mono-dot"></span>${name}</span>
        <strong></strong>
        <small></small>
      </div>`).join('');
    this.chips = [...this.refs.players.children];
  }

  renderPlayers() {
    const { view } = this;
    const over = view.phase === 'over';
    view.players.forEach((p, seat) => {
      const chip = this.chips[seat];
      const tags = [];
      if (over && !p.out) tags.push(`身家 ${money(netWorth(view, seat))}`);
      else if (this.table.config.players[seat].kind === 'ai') tags.push('电脑');
      if (p.out) tags.push('出局');
      else if (p.jail) tags.push('坐牢');
      if (p.passes && !over) tags.push(`出狱卡 ${p.passes}`);
      const cash = chip.querySelector('strong');
      cash.textContent = money(p.cash);
      cash.classList.toggle('is-long', cash.textContent.length > 7); // 六位数起字小一号，四个人时也放得下
      chip.querySelector('small').textContent = tags.join(' · ') || ' ';
      chip.classList.toggle('is-turn', seat === view.turn && !over);
      chip.classList.toggle('is-out', p.out);
      chip.classList.toggle('is-winner', view.winner === seat);
    });
  }

  renderTurn() {
    const { view } = this;
    const rounds = view.rounds ? `第 ${Math.min(view.round, view.rounds)}/${view.rounds} 轮` : `第 ${view.round} 轮`;
    const who = view.phase === 'over' ? '游戏结束' : `轮到<b style="color:${SEAT_COLORS[view.turn]}">${this.seatNames[view.turn]}</b>`;
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
    const s = this.table.state;
    const seat = s.turn;
    const name = this.seatNames[seat];
    const button = (act, label, primary = false) => `<button class="${primary ? 'mono-primary' : 'mono-secondary'}" data-act="${act}">${label}</button>`;
    this.refs.resign.disabled = s.phase === 'over' || this.table.controller(seat) !== 'local';
    // 动画播完之前不给按钮，结束时也等最后一段播完再出“再来一局”
    if (this.busy) {
      actions.innerHTML = '';
      return;
    }
    if (s.phase === 'over') {
      actions.innerHTML = button('again', '再来一局', true);
      return;
    }
    const controller = this.table.controller(seat);
    if (controller === 'ai') {
      actions.innerHTML = `<p class="mono-wait">${name}（电脑）在想…</p>`;
      return;
    }
    if (controller === 'remote') {
      actions.innerHTML = `<p class="mono-wait">等${name}出手…</p>`;
      return;
    }
    const i = s.players[seat].pos;
    const tile = TILES[i];
    if (s.phase === 'roll') actions.innerHTML = button('roll', '掷骰子', true);
    else if (s.phase === 'buy') actions.innerHTML = `<p class="mono-ask">买下${tile.name}？</p>${button('pass', '不买')}${button('buy', `买 ${money(tile.price)}`, true)}`;
    else if (s.phase === 'upgrade') {
      const next = LEVEL_NAMES[s.level[i] + 1];
      actions.innerHTML = `<p class="mono-ask">在${tile.name}盖到${next}？</p>${button('pass', '不盖')}${button('upgrade', `盖 ${money(houseCost(i))}`, true)}`;
    }
  }

  say(text) {
    this.refs.msg.textContent = text;
    this.lines.unshift(text);
    this.lines.length = Math.min(this.lines.length, 40);
    this.renderLog();
  }

  renderLog() {
    this.refs.log.innerHTML = this.lines.slice(1, 5).map((line) => `<li>${line}</li>`).join('');
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
    const ownerLine = isBuyable(tile) ? (owner >= 0 ? `${this.seatNames[owner]}的地${tile.type === 'city' ? ` · ${LEVEL_NAMES[s.level[i]]}` : ''}` : `没人买 · 地价 ${money(tile.price)}`) : '';
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

  // ---------- 存档与生命周期 ----------

  summary() {
    const s = this.table?.state;
    if (!s) return '准备开局';
    if (s.phase === 'over') return `${this.seatNames[s.winner]}赢了`;
    const me = s.players.findIndex((p, seat) => p.kind === 'human' && !p.out);
    const rounds = s.rounds ? `第 ${s.round}/${s.rounds} 轮` : `第 ${s.round} 轮`;
    return me >= 0 ? `${rounds} · ${s.players[me].name} ${money(s.players[me].cash)}` : rounds;
  }

  // 一局分出输赢时记一次成绩：本机玩家赢了、而且对手里有电脑才算（几个人轮流玩的不算）。counted 保证一局只记一次
  countWin() {
    if (this.counted) return;
    this.counted = true;
    const { config, state } = this.table;
    if (this.table.controller(state.winner) === 'local' && config.players.some((p) => p.kind === 'ai')) {
      this.records.wins = this.ctx.submitRecord('wins', (this.records.wins ?? 0) + 1);
    }
  }

  save() {
    const table = this.table ? this.table.snapshot() : null;
    this.ctx.save({ setup: this.setup, table, counted: this.counted }, { summary: this.summary(), finished: !table || this.table.state.phase === 'over' });
  }

  // 收起游戏页或切到后台：剩下的动画一下播完，电脑先不出手
  pause() {
    this.fast = true;
    this.stopTimers();
    if (this.table) this.save();
  }

  resume() {
    this.fast = false;
    this.next();
  }

  destroy() {
    this.fast = true;
    this.stopTimers();
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
