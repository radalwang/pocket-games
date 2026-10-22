// 测试用的假时钟和假客户端：不碰网络、不真的等，几十分钟的对局一眨眼就跑完。
//
// world(t) 造一个用假时钟的 Hub；new Player(w, name) 是一台手动操作的手机，测试里一条条发消息；
// new Bot(w, name) 会自己玩：收到 act 照着走一步、放完“动画”回 idle，轮到自己就按电脑的走法出手。

import assert from 'node:assert/strict';
import { Hub, PROTOCOL } from '../hub.js';
import { GAMES } from '../games.js';
import * as fx from '../../games/feixingqi/rules.js';
import { chooseMove } from '../../games/feixingqi/ai.js';
import * as mono from '../../games/monopoly/engine.js';
import { decide } from '../../games/monopoly/ai.js';

export const MINUTE = 60_000;

export class Clock {
  constructor() {
    this.time = 0;
    this.timers = new Map(); // id → { at, fn }。id 从 1 起：hub 把假值当成“没有计时器”
    this.nextId = 1;
  }

  now = () => this.time;

  later = (fn, ms) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + ms, fn });
    return id;
  };

  clear = (id) => {
    this.timers.delete(id);
  };

  // 执行下一个不晚于 end 的计时器（同一时刻按设定的先后），没有就返回 false
  step(end = Infinity) {
    let id = null;
    let next = null;
    for (const [k, timer] of this.timers) {
      if (timer.at <= end && (!next || timer.at < next.at)) {
        id = k;
        next = timer;
      }
    }
    if (!next) return false;
    this.timers.delete(id);
    this.time = Math.max(this.time, next.at);
    next.fn();
    return true;
  }

  // 往前拨 ms 毫秒，途中到点的计时器都执行
  advance(ms) {
    const end = this.time + ms;
    while (this.step(end));
    this.time = end;
  }

  // 一直往前走到 done() 成立，最多走 limit 毫秒
  until(done, limit = 24 * 60 * MINUTE) {
    const end = this.time + limit;
    while (!done()) {
      if (!this.step(end)) throw new Error(`走了 ${limit} 毫秒还没等到（还剩 ${this.timers.size} 个计时器）`);
    }
  }
}

// 一个用假时钟的 Hub。服务器自己 console.error 的都记下来，测试结束时必须是空的
export function world(t) {
  const clock = new Clock();
  const hub = new Hub({ now: clock.now, later: clock.later, clear: clock.clear });
  const logged = [];
  t.mock.method(console, 'error', (...args) => logged.push(args.map(String).join(' ')));
  t.after(() => assert.deepEqual(logged, [], '服务器记了错误'));
  return { clock, hub, logged };
}

// 两款游戏在客户端这边要用到的：开局、执行一步、从头重放、该谁出手、电脑会怎么走
export const LOCAL = {
  feixingqi: {
    init: (start) => fx.createGame(start.config),
    apply: (start, state, action) => fx.apply(start.config, state, action).state,
    replay: (start, log) => fx.replay(start.config, log),
    seatOf: (action) => action.seat,
    rolls: (log) => log.filter((a) => a.type === 'roll').map((a) => a.value),
    intent: (start, state) => (state.phase === 'roll' ? { type: 'roll' } : { type: 'move', plane: chooseMove(start.config, state) }),
  },
  monopoly: {
    init: (start) => mono.newGame(start.config, start.seed),
    apply: (start, state, action) => mono.act(state, action).state,
    replay: (start, log) => mono.replay(start.config, start.seed, log),
    seatOf: (action) => action.by,
    rolls: (log) => log.filter((a) => a.type === 'roll').flatMap((a) => a.dice),
    intent: (start, state, seat) => ({ type: decide(state, seat).type }),
  },
};

export const awaiting = (state) => (state.phase === 'over' ? null : state.turn);

export class Player {
  constructor(w, name = '玩家', { hello = true } = {}) {
    this.w = w;
    this.name = name;
    this.inbox = [];
    this.closed = false;
    this.client = w.hub.open((text) => this.receive(JSON.parse(text)));
    if (hello) this.send({ t: 'hello', protocol: PROTOCOL, name });
  }

  send(message) {
    if (!this.closed) this.w.hub.message(this.client, JSON.stringify(message));
  }

  raw(text) {
    this.w.hub.message(this.client, text);
  }

  close() {
    this.closed = true;
    this.w.hub.close(this.client);
  }

  receive(message) {
    this.inbox.push(message);
    if (message.t === 'start') this.start = message;
  }

  all(t) {
    return this.inbox.filter((m) => m.t === t);
  }

  last(t) {
    return this.all(t).at(-1);
  }

  quick(game, rules = GAMES[game].rules) {
    this.send({ t: 'quick', game, rules });
  }

  create(game, extra = {}) {
    this.send({ t: 'create', game, rules: GAMES[game].rules, ...extra });
    return this.last('room')?.code;
  }

  join(game, code) {
    this.send({ t: 'join', game, rules: GAMES[game].rules, code });
  }

  act(action) {
    this.send({ t: 'act', action });
  }

  get seat() {
    return this.start?.seat;
  }

  get room() {
    return this.w.hub.rooms.get(this.start?.room);
  }
}

// 自己会玩的客户端。回复都经过时钟延后发出：真的网络不会在服务器广播到一半时插进来
export class Bot extends Player {
  constructor(w, name, { anim = 300, think = 500, auto = true } = {}) {
    super(w, name);
    this.anim = anim; // 每一步的“动画”放多久才回 idle
    this.think = think; // 轮到自己后想多久才出手
    this.auto = auto;
    this.gaps = []; // seq 对不上的地方
  }

  receive(message) {
    super.receive(message);
    if (this.closed) return;
    if (message.t === 'start') this.begin(message);
    else if (message.t === 'act') this.follow(message);
    else if (message.t === 'turn' && message.seat === this.seat && this.auto) {
      const at = this.log.length;
      this.w.clock.later(() => this.play(at), this.think);
    }
  }

  get local() {
    return LOCAL[this.start.game];
  }

  begin(start) {
    this.log = [];
    this.state = this.local.init(start);
    for (const action of start.log) this.record(action);
    this.idle(this.log.length);
  }

  follow({ seq, action }) {
    if (seq !== this.log.length) this.gaps.push({ expected: this.log.length, got: seq });
    if (seq < this.log.length) return;
    this.record(action);
    this.idle(seq + 1);
  }

  record(action) {
    this.state = this.local.apply(this.start, this.state, action);
    this.log.push(action);
  }

  idle(seq) {
    this.w.clock.later(() => this.send({ t: 'idle', seq }), this.anim);
  }

  // 轮到自己时（at 是那时 log 的长度）出手；这期间已经有人替自己走过了就算了
  play(at) {
    if (this.closed || this.log.length !== at || awaiting(this.state) !== this.seat) return;
    this.act(this.local.intent(this.start, this.state, this.seat));
  }
}

// 快速匹配凑齐一桌：前面的人先排队，等 30 秒（不满 4 人时）开局，返回开局时的服务器房间
export function quickTable(w, game, players) {
  for (const p of players) p.quick(game);
  if (!players[0].start) w.clock.advance(30_000);
  assert.ok(players.every((p) => p.start), '没有开局');
  return players[0].room;
}

// 一直跑到这一局结束
export function playOut(w, room) {
  w.clock.until(() => room.phase === 'over');
}
