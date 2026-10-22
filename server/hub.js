// 联机大厅和对局：快速匹配、房间码、开局、转发动作、限时、掉线代打。消息格式见 PROTOCOL.md。
//
// 这里不碰网络：server.js 每来一个连接就 hub.open(send) 拿到一个 client，收到消息交给 hub.message，断开时 hub.close。
// 这样测试时直接调这几个方法就能模拟好几台手机。
//
// 一张桌子（Room）先在「大厅」里等人：快速匹配等满 4 人或者 30 秒，房间码等房主点开始。
// 开局后由服务器保管权威局面：轮到谁、骰子点数、动作合不合法都以这里为准，客户端只发“我想做什么”。
// 每一步之后先等在场的人把动画放完（客户端发 idle），再让下一个人出手、开始计时，免得画面落后、限时被动画吃掉。

import { randomBytes, randomInt } from 'node:crypto';
import { GAMES } from './games.js';

export const PROTOCOL = 1;

export const QUICK_SEATS = 4;
export const QUICK_WAIT = 30_000; // 快速匹配等多久就用电脑补位
const IDLE_CAP = 6_000; // 等客户端放完动画最多等多久（有人卡住也不至于拖住整桌）
const AI_DELAY = 700; // 电脑和掉线的人出手前停一下，看起来不那么急
const EMPTY_TTL = 10 * 60_000; // 对局里一个真人都不在、或者已经结束后，留多久给人重连
const NAME_MAX = 8;
const NAME_UNITS = 10;

const shuffle = (list) => {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
};

// 昵称最多 8 个字；emoji 一个算两个 UTF-16 单位，再限制总长不超过 10（大富翁的名字最长 12，重名时还要加一位数字）
export function cleanName(name) {
  let text = '';
  for (const ch of typeof name === 'string' ? [...name.trim()].slice(0, NAME_MAX) : []) {
    if (text.length + ch.length > NAME_UNITS) break;
    text += ch;
  }
  return text || '玩家';
}

class Room {
  constructor(hub, { game, mode, seats, options, code = null }) {
    this.hub = hub;
    this.id = randomBytes(8).toString('hex');
    this.gameId = game;
    this.adapter = GAMES[game];
    this.mode = mode; // 'quick' 快速匹配，'private' 房间码
    this.code = code;
    this.seats = seats;
    this.options = options;
    this.phase = 'lobby'; // lobby 等人，playing 对局中，over 结束
    this.members = []; // 大厅里的人（client），先来的在前
    this.host = null;
    this.deadline = 0;
    this.alone = false;
    this.timer = null; // 大厅倒计时 / 对局里的出手计时
    this.idleCap = null;
    this.expiry = null;
  }

  // ---------- 大厅 ----------

  add(client) {
    this.members.push(client);
    client.place = { room: this };
    if (this.mode === 'private' && !this.host) this.host = client;
    if (this.mode === 'quick') {
      if (this.members.length >= this.seats) return this.start();
      if (this.members.length === 1 || this.alone) this.restartCountdown();
    }
    this.lobbyUpdate();
  }

  remove(client) {
    this.members = this.members.filter((c) => c !== client);
    client.place = null;
    if (!this.members.length) return this.dispose();
    if (this.host === client) this.host = this.members[0];
    this.lobbyUpdate();
  }

  restartCountdown() {
    this.alone = false;
    this.deadline = this.hub.now() + QUICK_WAIT;
    this.hub.clear(this.timer);
    this.timer = this.hub.later(() => this.countdownDone(), QUICK_WAIT);
  }

  countdownDone() {
    this.timer = null;
    if (this.members.length >= 2) return this.start();
    // 只有一个人：问他继续等还是和电脑玩（客户端回 wait 或 leave）
    this.alone = true;
    this.members[0]?.send({ t: 'alone' });
  }

  lobbyUpdate() {
    for (const client of this.members) {
      const players = this.members.map((c) => ({ name: c.name, me: c === client, host: c === this.host }));
      if (this.mode === 'quick') {
        client.send({ t: 'queue', game: this.gameId, players, seats: this.seats, ms: this.alone ? 0 : Math.max(0, this.deadline - this.hub.now()) });
      } else {
        client.send({ t: 'room', game: this.gameId, code: this.code, host: client === this.host, players, seats: this.seats, options: this.options });
      }
    }
  }

  configure(client, { seats, options }) {
    if (client !== this.host) throw new HubError('not-host', '只有房主能改设置');
    if (Number.isInteger(seats)) {
      if (seats < 2 || seats > 4 || seats < this.members.length) throw new HubError('bad-request', '人数不对');
      this.seats = seats;
    }
    if (options) this.options = this.adapter.checkOptions(options);
    this.lobbyUpdate();
  }

  // ---------- 开局 ----------

  start() {
    this.hub.clear(this.timer);
    this.timer = null;
    if (this.mode === 'quick') this.hub.forming.delete(this.formingKey);
    const humans = shuffle(this.members).map((client) => ({ client, name: client.name, ai: false }));
    const ais = this.seats - humans.length;
    const robots = Array.from({ length: ais }, (_, k) => ({ client: null, name: ais > 1 ? `电脑${k + 1}` : '电脑', ai: true }));
    // 重名的人后面加个数字，免得分不清
    // （和已经用掉的名字比，「玩家」「玩家」「玩家2」会变成「玩家」「玩家3」「玩家2」）
    const taken = new Set([...humans, ...robots].map((p) => p.name));
    const used = new Set();
    const entrants = [...humans, ...robots].map((p) => {
      if (!used.has(p.name)) {
        used.add(p.name);
        return p;
      }
      let n = 2;
      while (used.has(`${p.name}${n}`) || taken.has(`${p.name}${n}`)) n++;
      used.add(`${p.name}${n}`);
      return { ...p, name: `${p.name}${n}` };
    });
    const { data, state } = this.adapter.create(entrants.map(({ name, ai }) => ({ name, ai })), this.options);
    this.data = data;
    this.state = state;
    this.log = [];
    this.turn = null; // 正在计时的真人：{ seat, endsAt }
    this.players = entrants.map(({ client, name, ai }) => ({
      name, ai, client, token: ai ? null : randomBytes(12).toString('hex'), idle: 0,
    }));
    this.phase = 'playing';
    this.members = [];
    this.players.forEach((p, seat) => {
      if (!p.client) return;
      p.client.place = { room: this, seat };
      this.sendStart(seat);
    });
    this.schedule();
  }

  publicPlayers() {
    return this.players.map(({ name, ai, client }) => ({ name, ai, away: !ai && !client }));
  }

  sendStart(seat) {
    const p = this.players[seat];
    p.client.send({
      t: 'start', game: this.gameId, room: this.id, token: p.token, seat,
      players: this.publicPlayers(), ...this.data, log: this.log,
    });
    if (this.turn) p.client.send({ t: 'turn', seat: this.turn.seat, ms: Math.max(0, this.turn.endsAt - this.hub.now()) });
  }

  // ---------- 对局 ----------

  // 下一步：先等在场的人放完动画，再让该出手的人出手
  schedule() {
    this.hub.clear(this.timer);
    this.hub.clear(this.idleCap);
    this.timer = null;
    this.turn = null;
    if (this.adapter.awaiting(this.state) === null) return this.finish();
    if (!this.players.some((p) => p.client)) return this.emptied(); // 一个真人都不在：先停着等人回来
    this.waiting = true;
    this.idleCap = this.hub.later(() => this.proceed(), IDLE_CAP);
    this.checkIdle();
  }

  checkIdle() {
    if (this.waiting && this.players.every((p) => !p.client || p.idle >= this.log.length)) this.proceed();
  }

  proceed() {
    this.waiting = false;
    this.hub.clear(this.idleCap);
    const seat = this.adapter.awaiting(this.state);
    const p = this.players[seat];
    if (p.client) {
      const ms = this.adapter.limit;
      this.turn = { seat, endsAt: this.hub.now() + ms };
      this.broadcast({ t: 'turn', seat, ms });
      this.timer = this.hub.later(() => this.autoPlay(seat), ms);
    } else {
      this.timer = this.hub.later(() => this.autoPlay(seat), AI_DELAY);
    }
  }

  autoPlay(seat) {
    this.timer = null;
    if (this.adapter.awaiting(this.state) !== seat) return;
    const intent = this.adapter.auto(this.data, this.state, seat);
    this.commit(this.adapter.confirm(this.data, this.state, seat, intent));
  }

  act(client, intent) {
    const seat = client.place.seat;
    if (this.phase !== 'playing') throw new HubError('bad-action', '这一局已经结束了');
    if (!this.adapter.anytime(intent) && this.adapter.awaiting(this.state) !== seat) throw new HubError('bad-action', '还没轮到你');
    let action;
    try {
      action = this.adapter.confirm(this.data, this.state, seat, intent);
    } catch (err) {
      throw new HubError('bad-action', err.message);
    }
    this.commit(action);
  }

  commit(action) {
    this.state = this.adapter.apply(this.data, this.state, action);
    this.log.push(action);
    this.broadcast({ t: 'act', seq: this.log.length - 1, action });
    this.schedule();
  }

  idle(client, seq) {
    const p = this.players[client.place.seat];
    if (Number.isInteger(seq) && seq > p.idle) p.idle = Math.min(seq, this.log.length);
    this.checkIdle();
  }

  // 离开对局（主动退出、断线、App 切到后台都算）：座位交给电脑，凭 token 随时可以回来
  detach(client) {
    const seat = client.place.seat;
    const p = this.players[seat];
    client.place = null;
    if (p.client !== client) return;
    p.client = null;
    if (this.phase !== 'playing') return;
    this.broadcast({ t: 'presence', seat, away: true });
    if (this.turn?.seat === seat || !this.players.some((q) => q.client)) this.schedule();
    else this.checkIdle();
  }

  resume(client, token) {
    const seat = this.players.findIndex((p) => p.token && p.token === token);
    if (seat < 0) throw new HubError('no-game', '找不到这一局');
    const p = this.players[seat];
    p.idle = 0;
    // 同一条连接上重新同步（客户端发现自己漏了动作）：只把整局再发一遍，不算离开又回来，计时也照旧
    if (p.client === client) return this.sendStart(seat);
    if (p.client) p.client.place = null; // 旧连接还没断干净：以新的为准
    const wasEmpty = !this.players.some((q) => q.client);
    p.client = client;
    client.place = { room: this, seat };
    // 对局中有人回来就不收房间了；已经结束的照旧到点收掉
    if (this.phase === 'playing') {
      this.hub.clear(this.expiry);
      this.expiry = null;
    }
    this.sendStart(seat);
    if (this.phase !== 'playing') return;
    this.broadcast({ t: 'presence', seat, away: false }, client);
    // 正好轮到他、电脑还没替他走：取消电脑那一步，等他放完重放再给他计时
    if (wasEmpty || (this.adapter.awaiting(this.state) === seat && !this.turn)) this.schedule();
  }

  emptied() {
    this.hub.clear(this.expiry);
    this.expiry = this.hub.later(() => this.dispose(), EMPTY_TTL);
  }

  finish() {
    this.phase = 'over';
    this.hub.clear(this.expiry);
    this.expiry = this.hub.later(() => this.dispose(), EMPTY_TTL);
  }

  broadcast(message, except = null) {
    for (const p of this.players) if (p.client && p.client !== except) p.client.send(message);
  }

  dispose() {
    for (const t of [this.timer, this.idleCap, this.expiry]) this.hub.clear(t);
    this.hub.rooms.delete(this.id);
    if (this.code) this.hub.codes.delete(this.code);
    if (this.mode === 'quick' && this.hub.forming.get(this.formingKey) === this) this.hub.forming.delete(this.formingKey);
  }
}

export class HubError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class Hub {
  // now / later / clear 可以换成假的时钟，测试时不用真的等
  constructor({ now = Date.now, later = (fn, ms) => setTimeout(fn, ms), clear = (t) => clearTimeout(t) } = {}) {
    this.now = now;
    // 计时器里出错只记下来，不能让整个服务器崩掉
    this.later = (fn, ms) => later(() => {
      try {
        fn();
      } catch (err) {
        console.error(err);
      }
    }, ms);
    this.clear = (t) => t && clear(t);
    this.rooms = new Map(); // id → Room（大厅里的和对局中的都在）
    this.codes = new Map(); // 房间码 → Room
    this.forming = new Map(); // 「游戏:规则版本」→ 正在凑人的快速匹配桌
  }

  open(send) {
    return { send: (message) => send(JSON.stringify(message)), name: '玩家', ready: false, place: null };
  }

  message(client, text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return client.send({ t: 'error', code: 'bad-request', message: '看不懂的消息' });
    }
    try {
      this.handle(client, message ?? {});
    } catch (err) {
      if (!(err instanceof HubError)) console.error(err);
      client.send({ t: 'error', code: err.code ?? 'server', message: err instanceof HubError ? err.message : '服务器出错了' });
    }
  }

  close(client) {
    this.leave(client);
  }

  handle(client, m) {
    if (m.t === 'hello') {
      if (m.protocol !== PROTOCOL) throw new HubError('version', '游戏版本和服务器对不上，请先更新');
      client.ready = true;
      client.name = cleanName(m.name);
      return client.send({ t: 'hello', protocol: PROTOCOL });
    }
    if (!client.ready) throw new HubError('bad-request', '还没打招呼');
    const room = client.place?.room;
    switch (m.t) {
      case 'name':
        client.name = cleanName(m.name);
        if (room?.phase === 'lobby') room.lobbyUpdate();
        return;
      case 'quick':
        return this.quick(client, m);
      case 'wait':
        if (room?.phase === 'lobby' && room.mode === 'quick' && room.alone) {
          room.restartCountdown();
          room.lobbyUpdate();
        }
        return;
      case 'create':
        return this.create(client, m);
      case 'join':
        return this.join(client, m);
      case 'configure':
        if (room?.phase !== 'lobby' || room.mode !== 'private') throw new HubError('bad-request', '不在房间里');
        return room.configure(client, m);
      case 'start':
        if (room?.phase !== 'lobby' || room.mode !== 'private') throw new HubError('bad-request', '不在房间里');
        if (client !== room.host) throw new HubError('not-host', '只有房主能开始');
        if (room.members.length < 2) throw new HubError('alone', '至少要两个人才能开始');
        return room.start();
      case 'leave':
        return this.leave(client);
      case 'resume':
        return this.resume(client, m);
      case 'act':
        if (room?.phase !== 'playing' || client.place.seat === undefined) throw new HubError('bad-action', '不在对局里');
        return room.act(client, m.action);
      case 'idle':
        if (room && client.place.seat !== undefined) room.idle(client, m.seq);
        return;
      default:
        throw new HubError('bad-request', '不认识的消息');
    }
  }

  adapterFor(m) {
    const adapter = Object.hasOwn(GAMES, m.game) ? GAMES[m.game] : null;
    if (!adapter) throw new HubError('bad-request', '没有这个游戏');
    if (m.rules !== adapter.rules) throw new HubError('version', '游戏版本和对方对不上，请先更新');
    return adapter;
  }

  quick(client, m) {
    const adapter = this.adapterFor(m);
    this.leave(client);
    const key = `${m.game}:${adapter.rules}`;
    let room = this.forming.get(key);
    if (!room) {
      room = new Room(this, { game: m.game, mode: 'quick', seats: QUICK_SEATS, options: adapter.quickOptions });
      room.formingKey = key;
      this.forming.set(key, room);
      this.rooms.set(room.id, room);
    }
    room.add(client);
  }

  create(client, m) {
    const adapter = this.adapterFor(m);
    this.leave(client);
    const seats = [2, 3, 4].includes(m.seats) ? m.seats : 4;
    let code;
    do code = String(randomInt(1000, 10000)); while (this.codes.has(code));
    const room = new Room(this, { game: m.game, mode: 'private', seats, options: adapter.checkOptions(m.options), code });
    this.codes.set(code, room);
    this.rooms.set(room.id, room);
    room.add(client);
  }

  join(client, m) {
    this.adapterFor(m);
    const room = this.codes.get(String(m.code ?? ''));
    if (!room || room.gameId !== m.game) throw new HubError('no-room', '没有这个房间');
    if (room.phase !== 'lobby') throw new HubError('started', '这个房间已经开始了');
    if (client.place?.room === room) return room.lobbyUpdate(); // 已经在这个房间里了
    if (room.members.length >= room.seats) throw new HubError('full', '房间已经满了');
    this.leave(client);
    room.add(client);
  }

  resume(client, m) {
    const room = this.rooms.get(m.room);
    if (!room || room.phase === 'lobby') throw new HubError('no-game', '这一局已经没有了');
    if (client.place?.room !== room) this.leave(client);
    room.resume(client, m.token);
  }

  leave(client) {
    const room = client.place?.room;
    if (!room) return;
    if (room.phase === 'lobby') room.remove(client);
    else room.detach(client);
  }
}
