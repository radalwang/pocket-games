// 一局对战：把「局面怎么变」（rules.js）和「下一步从哪来、点数谁来掷、怎么同步给别的设备」分开，以后接联机只动这里。
//
// - config 是开局设置，开局后不变；log 是按顺序记下的每一步动作。同样的 config + log 在任何设备上
//   重放都得到同样的局面（rules.js 不用随机数），存档存的就是这两样，联机时各设备之间也只交换这两样。
// - seats 是这台设备眼里每一方由谁来下，和 config.players 一一对应：'local' 等本机的人点，
//   'ai' 由本机算（ai.js），'remote' 等别的设备发来（联机以后做）。同一局在你的手机上你是 local、对方是 remote，
//   在对方手机上正好反过来，所以 seats 只存在本机，不放进 config，也不通过联机发出去。
// - 掷骰子的点数由掷的那一方用 dice() 生成，写进 roll 动作里。以后要防作弊，可以改成房主或服务器统一给点数，
//   动作格式不用变。
// - link 是联机通道，要有 send(message) 和 onMessage(handler) 两个方法，现在不传就是单机。
//   本机走的每一步都会用 action 消息发出去；收到的消息交给 receive()，验证合法后和本机的动作走同一条路。

import { apply, checkConfig, createGame, replay, RULES_VERSION, RuleError } from './rules.js';

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
  constructor({ config, seats, log = [], dice = randomDie, link = null }) {
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
    this.link = link;
    link?.onMessage((message) => this.receive(message));
  }

  // 现在轮到的这一方由谁来下
  get kind() {
    return this.seats[this.state.turn];
  }

  // 本机替当前这一方掷骰子 / 走飞机。动作不合法会抛 RuleError
  roll() {
    return this.commit({ type: 'roll', seat: this.state.turn, value: this.dice() });
  }

  move(plane) {
    return this.commit({ type: 'move', seat: this.state.turn, plane });
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
