// 一局对战：把「局面怎么变」（rules.js）和「下一步从哪来、点数谁来掷、怎么同步给别的设备」分开，联机只动这里。
//
// - config 是开局设置，开局后不变；log 是按顺序记下的每一步动作。同样的 config + log 在任何设备上
//   重放都得到同样的局面（rules.js 不用随机数），存档存的就是这两样，联机时各设备之间也只交换这两样。
// - seats 是这台设备眼里每一方由谁来下，和 config.players 一一对应：'local' 等本机的人点，
//   'ai' 由本机算（ai.js），'remote' 等别的设备或服务器发来。同一局在你的手机上你是 local、对方是 remote，
//   在对方手机上正好反过来，所以 seats 只存在本机，不放进 config，也不通过联机发出去。
// - 掷骰子的点数由掷的那一方用 dice() 生成，写进 roll 动作里；联机对战时由服务器统一给点数（见下面的 server），
//   动作格式一样。
// - link 是设备之间直接联机的通道，要有 send(message) 和 onMessage(handler) 两个方法，不传就是单机。
//   本机走的每一步都会用 action 消息发出去；收到的消息交给 receive()，验证合法后和本机的动作走同一条路。
// - server 是联机对战（服务器说了算，见 server/PROTOCOL.md）用的：传一个 send(intent) 函数。这时本机的人掷骰子、
//   走飞机都不自己走，只把意图交给它发给服务器；服务器掷好点数、确认合法后广播给所有人，再由 accept(seq, action)
//   执行。所有座位（包括自己）的动作都走 accept，所以本机的 log 和服务器的一模一样。电脑由服务器替它走，本机看来是 remote。

import { apply, checkConfig, createGame, legalPlanes, replay, RULES_VERSION, RuleError } from './rules.js';

export const KINDS = ['local', 'ai', 'remote'];

// 联机消息的格式版本，版本不同的设备之间不要互相接受
export const PROTOCOL = 1;

// 一步动作：seq 是这一步在 log 里的序号（从 0 开始），对方据此发现漏收或重复
export const actionMessage = (seq, action) => ({ protocol: PROTOCOL, kind: 'action', seq, action });
// 整局同步：刚加入或者掉线重连时，把开局设置和全部动作发过去，对方直接重放
export const syncMessage = (config, log) => ({ protocol: PROTOCOL, kind: 'sync', config, log });
// 对指纹：隔几步发一次「走到第 seq 步时局面的指纹」，对不上就说明算岔了，该发整局同步
export const checkMessage = (seq, hash) => ({ protocol: PROTOCOL, kind: 'check', seq, hash });

// 局面的指纹（FNV-1a）：同一个局面在任何设备上算出来都一样
export function hashState(state) {
  const text = JSON.stringify(state);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const randomDie = () => 1 + Math.floor(Math.random() * 6);

// 新开一局：players 是 [{ color, name, kind }]，按颜色排成顺时针的走棋顺序，拆成共享的 config 和本机的 seats
export function newSetup({ players, planes, first = Math.floor(Math.random() * players.length) }) {
  const sorted = [...players].sort((a, b) => a.color - b.color);
  return {
    config: { rules: RULES_VERSION, planes, first, players: sorted.map(({ color, name }) => ({ color, name })) },
    seats: sorted.map(({ kind }) => kind),
  };
}

export class Match {
  constructor({ config, seats, log = [], dice = randomDie, link = null, server = null }) {
    checkConfig(config);
    if (!Array.isArray(seats) || seats.length !== config.players.length || !seats.every((kind) => KINDS.includes(kind))) {
      throw new RuleError('座位设置不对');
    }
    this.config = config;
    this.seats = seats;
    this.log = [];
    this.state = createGame(config);
    this.dice = dice;
    this.listeners = new Set();
    for (const action of log) this.commit(action, { quiet: true });
    this.server = server;
    this.pending = false; // 联机对战：意图已经发给服务器，还没等到它广播回来
    this.link = link;
    link?.onMessage((message) => this.receive(message));
  }

  // 现在轮到的这一方由谁来下
  get kind() {
    return this.seats[this.state.turn];
  }

  // 本机替当前这一方掷骰子 / 走飞机。动作不合法会抛 RuleError。
  // 联机对战时只把意图发给服务器，发出去了返回 true（不返回事件，动画等服务器广播回来再放）
  roll() {
    if (this.server) return this.request({ type: 'roll' });
    return this.commit({ type: 'roll', seat: this.state.turn, value: this.dice() });
  }

  move(plane) {
    if (this.server) {
      if (this.state.phase !== 'move' || !legalPlanes(this.state).includes(plane)) throw new RuleError('这架飞机不能走');
      return this.request({ type: 'move', plane });
    }
    return this.commit({ type: 'move', seat: this.state.turn, plane });
  }

  // 联机对战：轮到本机的人时把意图发给服务器。等到广播之前不再发第二次（防连点），这时返回 false
  request(intent) {
    if (this.pending || this.kind !== 'local' || this.state.phase === 'over') return false;
    this.pending = true;
    this.server(intent);
    return true;
  }

  // 联机对战：服务器广播的第 seq 步动作。正好接得上就执行，返回 true；早就执行过的（重复收到）返回 false；
  // 跳了号或者执行不了，说明和服务器对不上了，抛 RuleError，这时该向服务器整局重要一次
  accept(seq, action) {
    if (seq < this.log.length) return false;
    if (seq > this.log.length) throw new RuleError('漏收了动作，和服务器对不上');
    this.pending = false;
    this.commit(action, { remote: true });
    return true;
  }

  // 联机对战：服务器没接受刚才的意图（比如刚好超时，它已经替你走了），可以再点
  reject() {
    this.pending = false;
  }

  // 做一步动作：算出新局面、记进 log、通知界面；本机产生的动作同时发给联机的对方
  commit(action, { quiet = false, remote = false } = {}) {
    const { state, events } = apply(this.config, this.state, action);
    this.state = state;
    this.log.push(action);
    if (!quiet && !remote) this.link?.send(actionMessage(this.log.length - 1, action));
    if (!quiet) this.listeners.forEach((listener) => listener(events, action));
    return events;
  }

  hash() {
    return hashState(this.state);
  }

  // 收到联机消息，处理了返回 true。只接受轮到远程座位时、序号正好接得上的动作；
  // 对不上的扔掉，等对方重发或者发整局同步。check 消息返回指纹对不对得上（序号不同时没法比，当作对得上）
  receive(message) {
    if (message?.protocol !== PROTOCOL) return false;
    if (message.kind === 'check') return message.seq !== this.log.length || message.hash === this.hash();
    if (message.kind === 'action') {
      const { seq, action } = message;
      if (seq !== this.log.length || this.seats[action?.seat] !== 'remote') return false;
      try {
        this.commit(action, { remote: true });
        return true;
      } catch {
        return false;
      }
    }
    if (message.kind === 'sync') {
      try {
        replay(message.config, message.log);
      } catch {
        return false;
      }
      if (message.config.players.length !== this.seats.length) return false;
      this.config = message.config;
      this.state = createGame(message.config);
      this.log = [];
      for (const action of message.log) this.commit(action, { quiet: true });
      this.listeners.forEach((listener) => listener([{ type: 'sync' }], null));
      return true;
    }
    return false;
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // 存档用：共享的 config + log，加上本机的 seats
  toJSON() {
    return { config: this.config, seats: this.seats, log: this.log };
  }
}
