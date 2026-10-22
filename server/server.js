// 联机服务器入口：WebSocket 连在 /online 上，全网榜单在 /api/ 下，别的路径直接当静态网站把整个游戏发出去
// （上线时一台服务器就能同时放网页、联机和榜单，大陆打开比 github.io 稳）。
//
// 本机开发：cd server && npm install && npm start，游戏页面在 localhost 上会自动连 ws://localhost:8787/online。
// 环境变量：PORT 端口；HOST 只听哪个地址（上线时设成 127.0.0.1，只让 Caddy 转进来）；DATA_DIR 榜单数据放哪。

import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Hub } from './hub.js';
import { ScoreError, Scores } from './scores.js';

const PORT = Number(process.env.PORT) || 8787;
const HOST = process.env.HOST || undefined;
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA_DIR = process.env.DATA_DIR || join(ROOT, 'server', 'data');
const HEARTBEAT = 25_000; // 隔多久 ping 一次；两次没回应就当掉线（手机切后台时连接常常不会正常关闭）

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

async function serveFile(req, res) {
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = normalize(join(ROOT, path.endsWith('/') ? `${path}index.html` : path));
  // 只发游戏本身的文件：不能跑出仓库目录，也不发服务器代码和隐藏文件
  const inside = file.startsWith(ROOT) && !file.slice(ROOT.length).split(sep).some((part) => part.startsWith('.') || part === 'server' || part === 'node_modules');
  const type = TYPES[extname(file)];
  if (req.method !== 'GET' || !inside || !type) return notFound(res);
  try {
    if (!(await stat(file)).isFile()) return notFound(res);
  } catch {
    return notFound(res);
  }
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
  createReadStream(file).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('没有这个文件');
}

// ---------- 全网榜单 ----------
//   POST /api/scores                 { device, name, game, board, value } → { rank, value, total }
//   GET  /api/boards/<游戏>/<榜>?device=  → { total, entries: [{ rank, name, value, me }], mine }
//   POST /api/name                   { device, name } 改昵称
// 网页可能放在别的网址（比如 github.io），所以要允许跨域

const scores = new Scores({ dir: DATA_DIR });
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function sendJson(res, status, data) {
  res.writeHead(status, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data === null ? '' : JSON.stringify(data));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 4096) {
        reject(new ScoreError(413, '内容太长'));
        req.destroy();
      } else chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new ScoreError(400, '看不懂的内容'));
      }
    });
    req.on('error', reject);
  });
}

async function serveApi(req, res, url) {
  if (req.method === 'OPTIONS') return sendJson(res, 204, null);
  const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', ...]
  if (req.method === 'POST' && parts[1] === 'scores' && parts.length === 2) {
    const body = await readJson(req);
    return sendJson(res, 200, scores.submit(body ?? {}));
  }
  if (req.method === 'POST' && parts[1] === 'name' && parts.length === 2) {
    const body = await readJson(req);
    scores.rename(body?.device, body?.name);
    return sendJson(res, 204, null);
  }
  if (req.method === 'GET' && parts[1] === 'boards' && parts.length === 4) {
    const device = url.searchParams.get('device');
    return sendJson(res, 200, scores.top(parts[2], parts[3], device && /^[0-9a-f]{32}$/.test(device) ? device : null));
  }
  throw new ScoreError(404, '没有这个接口');
}

const hub = new Hub();
const http = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    serveApi(req, res, url).catch((err) => {
      if (!(err instanceof ScoreError)) console.error(err);
      sendJson(res, err.status ?? 500, { error: err instanceof ScoreError ? err.message : '服务器出错了' });
    });
    return;
  }
  serveFile(req, res).catch(() => notFound(res));
});
const wss = new WebSocketServer({ server: http, path: '/online', maxPayload: 16 * 1024 });

wss.on('connection', (socket) => {
  socket.alive = true;
  socket.on('pong', () => {
    socket.alive = true;
  });
  const client = hub.open((text) => {
    if (socket.readyState === socket.OPEN) socket.send(text);
  });
  socket.on('message', (data) => hub.message(client, String(data)));
  socket.on('close', () => hub.close(client));
  socket.on('error', () => socket.terminate());
});

setInterval(() => {
  for (const socket of wss.clients) {
    if (!socket.alive) {
      socket.terminate();
      continue;
    }
    socket.alive = false;
    socket.ping();
  }
}, HEARTBEAT);

// 停服务器前把还没写盘的榜单写进去
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    scores.flush();
    process.exit(0);
  });
}

http.listen(PORT, HOST, () => console.log(`口袋游戏联机服务器：http://${HOST ?? 'localhost'}:${PORT}（联机连 /online，榜单在 /api/）`));
