// 联机：连服务器、昵称。消息格式见 server/PROTOCOL.md，匹配和房间的界面在 lobby.js。

import { prefs } from './store.js';

export const PROTOCOL = 1;

// 正式上线时填上服务器地址，比如 'wss://game.example.com/online'。
// 页面开在本机或局域网地址上时，自动连这台电脑上的服务器（server/ 里 npm start）
const PRODUCTION_SERVER = '';
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\]|192\.168\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$/;

export function serverUrl() {
  if (LOCAL_HOST.test(window.location.hostname)) return `ws://${window.location.hostname}:8787/online`;
  return PRODUCTION_SERVER;
}

// ---------- 昵称 ----------

export const NAME_MAX = 8;
const ADJECTIVES = ['快乐的', '安静的', '勇敢的', '机灵的', '好奇的', '闪亮的', '慢吞吞的', '爱睡觉的'];
const ANIMALS = ['熊猫', '企鹅', '柴犬', '海豚', '狐狸', '松鼠', '考拉', '水獭'];
const pick = (list) => list[Math.floor(Math.random() * list.length)];

export function nickname() {
  let name = prefs.get('online:name', '');
  if (!name) {
    name = pick(ADJECTIVES) + pick(ANIMALS);
    prefs.set('online:name', name);
  }
  return name;
}

export function setNickname(name) {
  const clean = [...String(name ?? '').trim()].slice(0, NAME_MAX).join('');
  if (clean) prefs.set('online:name', clean);
  return nickname();
}

// ---------- 连接 ----------

export class OnlineError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

// 一条到服务器的连接。connect() 打完招呼才算连上；on(t, fn) 收某一种消息，返回取消订阅的函数；
// on('close', fn) 在连接意外断开时调用（自己调 close() 断开时不调）
export class Connection {
  constructor() {
    this.handlers = new Map();
    this.socket = null;
  }

  connect() {
    const url = serverUrl();
    if (!url) return Promise.reject(new OnlineError('no-server', '联机对战即将开放，敬请期待'));
    if (!navigator.onLine) return Promise.reject(new OnlineError('offline', '没有网络，连上网再试'));
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code, message) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.close();
        reject(new OnlineError(code, message));
      };
      const timer = setTimeout(() => fail('unreachable', '连不上联机服务器'), 8000);
      let socket;
      try {
        socket = new WebSocket(url);
      } catch {
        fail('unreachable', '连不上联机服务器');
        return;
      }
      this.socket = socket;
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ t: 'hello', protocol: PROTOCOL, name: nickname() }));
      });
      socket.addEventListener('message', (e) => {
        let message;
        try {
          message = JSON.parse(e.data);
        } catch {
          return;
        }
        if (settled) {
          this.emit(message.t, message);
        } else if (message.t === 'hello') {
          settled = true;
          clearTimeout(timer);
          resolve(this);
        } else if (message.t === 'error') {
          fail(message.code, message.message);
        }
      });
      socket.addEventListener('close', () => {
        if (!settled) fail('unreachable', '连不上联机服务器');
        else if (this.socket === socket) {
          this.socket = null;
          this.emit('close', {});
        }
      });
    });
  }

  get connected() {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  send(message) {
    if (this.connected) this.socket.send(JSON.stringify(message));
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  emit(type, message) {
    for (const handler of [...(this.handlers.get(type) ?? [])]) handler(message);
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    socket?.close();
  }
}
