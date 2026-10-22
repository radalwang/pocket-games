// 牌桌：规则（engine.js）和“谁在操作”之间的一层，本机对局和联机对局共用。
//
// 不管是本机玩家点了按钮、电脑想好了，还是联机对手发来的，都是同一种动作 { type, by }，一律经 submit 交给 transport。
// transport 决定动作怎么生效：
//   · LocalTransport：马上原样送回来执行，同一台手机上轮流玩、和电脑玩都走这条路
//   · OnlineTransport：先发给服务器，服务器掷好骰子、排好先后再广播给所有人（包括自己），各自收到后再执行
// 大家从同一个种子出发、按同样的顺序执行同样的动作，就会得到同样的局面。接口约定和联机的做法见 ONLINE.md。
//
// 每个座位在这台设备上由谁操作（controller）：
//   local  这台设备上的真人，界面上给他按钮
//   ai     电脑，由这台设备替他出手（只在本机对局里；联机时电脑由服务器出手）
//   remote 别的设备上的人（或者服务器上的电脑），这里只等他的动作传过来

import { act, canAct, hashState, newGame, RULES_VERSION } from './engine.js';

export class LocalTransport {
  connect(deliver) {
    this.deliver = deliver;
  }

  send(action) {
    this.deliver(action);
  }

  close() {
    this.deliver = null;
  }
}

// 联机：只把“想做什么”发给服务器（server/PROTOCOL.md 的 act），座位由服务器按连接认定，骰子也由服务器掷。
// 服务器确认的动作带着 rev 和骰子广播回来，由界面按顺序（等上一个动画播完）交给 deliver 执行
export class OnlineTransport {
  constructor(connection) {
    this.connection = connection;
  }

  connect(deliver) {
    this.deliver = deliver;
  }

  send(action) {
    this.connection?.send({ t: 'act', action: { type: action.type } });
  }

  close() {
    this.deliver = null;
    this.connection = null;
  }
}

export class Table {
  // log：从开局到现在的全部动作（读档、断线重连时传进来重放）。
  // seats：这台设备上操作哪几个真人座位，默认是所有真人座位（同一台手机轮流玩）；hostsAI：电脑座位是不是由这台设备出手
  constructor({ config, seed, log = [], transport = new LocalTransport(), seats = null, hostsAI = true }) {
    this.config = config;
    this.seed = seed;
    this.state = newGame(config, seed);
    this.log = [];
    for (const action of log) this.apply(action);
    this.seats = seats ?? config.players.flatMap((p, i) => (p.kind === 'human' ? [i] : []));
    this.hostsAI = hostsAI;
    this.listeners = new Set();
    this.transport = transport;
    transport.connect((action) => this.receive(action));
  }

  controller(seat) {
    if (this.config.players[seat].kind === 'ai') return this.hostsAI ? 'ai' : 'remote';
    return this.seats.includes(seat) ? 'local' : 'remote';
  }

  // 这台设备提交一个动作。先在本地查一遍合不合规矩，再带上当前的 rev 交给 transport：
  // 服务器和别的设备靠 rev 认出过期或重复的动作（比如同一个按钮点了两下）
  submit(action) {
    if (!canAct(this.state, action)) return false;
    this.transport.send({ ...action, rev: this.state.rev });
    return true;
  }

  // transport 送来一个动作：rev 对不上就丢掉，否则执行并通知界面
  receive(action) {
    if (action.rev !== undefined && action.rev !== this.state.rev) return;
    if (!canAct(this.state, action)) return;
    const events = this.apply(action);
    for (const listener of this.listeners) listener(events, this.state);
  }

  apply(action) {
    const { type, by, dice } = action;
    const clean = dice ? { type, by, dice } : { type, by };
    const { state, events } = act(this.state, clean);
    this.state = state;
    this.log.push(clean);
    return events;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  // 存档和联机同步用的就是这一份：规则版本、开局设置、种子、全部动作
  snapshot() {
    return { v: RULES_VERSION, config: this.config, seed: this.seed, log: this.log };
  }

  hash() {
    return hashState(this.state);
  }

  close() {
    this.listeners.clear();
    this.transport.close();
  }
}
