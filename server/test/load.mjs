// 压力测试：自己起一台服务器（端口 8799，不打扰 8787 上开着的那台），连上一群模拟玩家，
// 两款游戏轮流快速匹配、自动打完一局接着排下一局，最后报：打完几局、出了多少错、服务器的内存和 CPU、
// 从发出 act 到收到它的广播要多久。不在 npm test 里。
//
//   node test/load.mjs [人数=200] [秒数=60] [每步延迟毫秒=0]
//
// 每步延迟：收到 act 后等多久回 idle（放动画）、轮到自己后等多久出手（想一想）。
// 0 就是能多快打多快，把服务器压满；真人大概是 1000 上下。

import { execFileSync, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { GAMES } from '../games.js';
import { PROTOCOL } from '../hub.js';
import { awaiting, LOCAL } from './helpers.mjs';

const PLAYERS = Number(process.argv[2]) || 200;
const SECONDS = Number(process.argv[3]) || 60;
const DELAY = Number(process.argv[4]) || 0;
const PORT = 8799;
const SERVER_URL = `ws://localhost:${PORT}/online`;
const SERVER_DIR = fileURLToPath(new URL('..', import.meta.url));
const ORDER = ['feixingqi', 'monopoly'];
const STUCK = 60_000; // 对局里这么久什么都没收到，就当卡住了

const stats = {
  finished: { feixingqi: 0, monopoly: 0 },
  rooms: new Map(), // 房间 → 服务器 log 的长度（看到的最大 seq + 1）
  over: new Set(),
  latency: [],
  errors: {},
  messages: 0,
};

const fail = (kind) => {
  stats.errors[kind] = (stats.errors[kind] ?? 0) + 1;
};

const later = (fn) => (DELAY ? setTimeout(fn, DELAY) : fn());

// ---------- 服务器 ----------

function startServer() {
  const child = spawn(process.execPath, ['server.js'], {
    cwd: SERVER_DIR,
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (text) => {
    for (const line of text.split('\n')) if (line.trim()) fail('server stderr');
    if (!stats.stderr) stats.stderr = text.slice(0, 500);
  });
  return new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (text) => {
      if (text.includes(String(PORT))) resolve(child);
    });
    child.on('exit', (code) => reject(new Error(`服务器退出了：${code}`)));
  });
}

// ps 的 time 列：[[天-]时:]分:秒.xx
function cpuSeconds(text) {
  const [days, rest] = text.includes('-') ? text.split('-') : [0, text];
  return Number(days) * 86400 + rest.split(':').reduce((sum, part) => sum * 60 + Number(part), 0);
}

function sample(pid) {
  const [rss, time] = execFileSync('ps', ['-o', 'rss=,time=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
  return { at: performance.now(), rss: Number(rss) * 1024, cpu: cpuSeconds(time) };
}

// ---------- 模拟玩家 ----------

class Sim {
  constructor(id) {
    this.id = id;
    this.next = id % 2; // 下一局玩哪个游戏，两款轮流
    this.start = null;
    this.sentAt = 0;
    this.heardAt = performance.now();
    this.socket = new WebSocket(SERVER_URL);
    this.socket.on('open', () => this.send({ t: 'hello', protocol: PROTOCOL, name: `压测${id}` }));
    this.socket.on('message', (data) => this.receive(JSON.parse(String(data))));
    this.socket.on('error', () => fail('socket error'));
    this.socket.on('close', () => {
      if (!stopping) fail('socket closed');
    });
  }

  send(message) {
    if (this.socket.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  queue() {
    if (stopping) return;
    this.start = null;
    const game = ORDER[this.next];
    this.next = 1 - this.next;
    this.send({ t: 'quick', game, rules: GAMES[game].rules });
  }

  receive(m) {
    stats.messages++;
    this.heardAt = performance.now();
    switch (m.t) {
      case 'hello':
        return this.queue();
      case 'alone':
        return this.send({ t: 'wait' });
      case 'start':
        return this.begin(m);
      case 'act':
        return this.follow(m);
      case 'turn':
        if (m.seat === this.start?.seat) later(() => this.play(this.log.length));
        return;
      case 'error':
        fail(`error ${m.code}`);
        if (m.code === 'bad-action') this.sentAt = 0;
        return;
      default:
    }
  }

  begin(start) {
    this.start = start;
    this.local = LOCAL[start.game];
    this.state = this.local.init(start);
    this.log = [];
    for (const action of start.log) this.record(action);
    this.send({ t: 'idle', seq: this.log.length });
  }

  follow({ seq, action }) {
    if (!this.start) return;
    if (seq !== this.log.length) {
      fail('seq gap');
      return;
    }
    try {
      this.record(action);
    } catch {
      fail('replay failed');
      return;
    }
    if (this.sentAt && this.local.seatOf(action) === this.start.seat) {
      stats.latency.push(performance.now() - this.sentAt);
      this.sentAt = 0;
    }
    const room = this.start.room;
    stats.rooms.set(room, Math.max(stats.rooms.get(room) ?? 0, seq + 1));
    if (awaiting(this.state) === null) {
      if (!stats.over.has(room)) {
        stats.over.add(room);
        stats.finished[this.start.game]++;
      }
      return later(() => this.queue());
    }
    later(() => this.send({ t: 'idle', seq: seq + 1 }));
  }

  record(action) {
    this.state = this.local.apply(this.start, this.state, action);
    this.log.push(action);
  }

  play(at) {
    if (!this.start || this.log.length !== at || awaiting(this.state) !== this.start.seat) return;
    this.sentAt = performance.now();
    this.send({ t: 'act', action: this.local.intent(this.start, this.state, this.start.seat) });
  }
}

// ---------- 跑 ----------

const percentile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor((sorted.length * p) / 100))] ?? NaN;
const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;
const ms = (value) => `${value.toFixed(1)} ms`;
const sleep = (time) => new Promise((resolve) => setTimeout(resolve, time));

let stopping = false;
const server = await startServer();
const idle = sample(server.pid);
const selfStart = process.cpuUsage();
console.log(`服务器 pid ${server.pid}，空着时 ${mb(idle.rss)}。${PLAYERS} 个玩家，跑 ${SECONDS} 秒，每步延迟 ${DELAY} 毫秒……`);

const sims = [];
for (let i = 0; i < PLAYERS; i++) {
  sims.push(new Sim(i));
  if (i % 50 === 49) await sleep(50); // 别一下子全挤进来
}

const samples = [sample(server.pid)];
const began = performance.now();
while (performance.now() - began < SECONDS * 1000) {
  await sleep(1000);
  samples.push(sample(server.pid));
  const now = performance.now();
  for (const sim of sims) {
    if (sim.start && awaiting(sim.state) !== null && now - sim.heardAt > STUCK) {
      fail('stuck');
      sim.heardAt = now;
    }
  }
}
stopping = true;
const end = samples.at(-1);
const self = process.cpuUsage(selfStart);
for (const sim of sims) sim.socket.close();
await sleep(500);
server.kill();

// 两次采样之间的 CPU：一核跑满是 100%
const cpu = samples.slice(1).map((s, k) => (100 * (s.cpu - samples[k].cpu)) / ((s.at - samples[k].at) / 1000));
const elapsed = (end.at - samples[0].at) / 1000;
const actions = [...stats.rooms.values()].reduce((sum, n) => sum + n, 0);
const latency = stats.latency.sort((a, b) => a - b);
const report = {
  players: PLAYERS,
  seconds: Math.round(elapsed),
  delayMs: DELAY,
  gamesFinished: { ...stats.finished, total: stats.finished.feixingqi + stats.finished.monopoly },
  tables: stats.rooms.size,
  actions,
  actionsPerSecond: Math.round(actions / elapsed),
  messagesPerSecondToClients: Math.round(stats.messages / elapsed),
  errors: stats.errors,
  serverRss: { idle: mb(idle.rss), peak: mb(Math.max(...samples.map((s) => s.rss))), end: mb(end.rss) },
  serverCpu: {
    average: `${((100 * (end.cpu - samples[0].cpu)) / elapsed).toFixed(1)}%`,
    peak1s: `${Math.max(...cpu).toFixed(1)}%`,
  },
  loadGeneratorCpu: `${((100 * (self.user + self.system)) / 1e6 / elapsed).toFixed(1)}%`,
  latency: {
    samples: latency.length,
    p50: ms(percentile(latency, 50)),
    p95: ms(percentile(latency, 95)),
    p99: ms(percentile(latency, 99)),
    max: ms(latency.at(-1) ?? NaN),
  },
};
console.log(JSON.stringify(report, null, 2));
if (stats.stderr) console.log(`服务器 stderr 开头：\n${stats.stderr}`);
process.exit(0);
