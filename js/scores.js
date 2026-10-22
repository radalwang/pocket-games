// 全网榜单的手机这一头：破了自己的纪录就排进上传队列，有网时传上去；榜单页从这里取数据。
// 榜单有哪些、怎么排见 boards.js；服务器接口见 server/server.js。
//
// 没网时成绩先存在本机（每个榜只留最好的一个），联网、回到前台、打开 App 时再传。
// 第一次用这个版本时，会把以前已经有的个人最好成绩也补传上去。

import { BOARDS, beats, boardOf, plausible } from './boards.js';
import { nickname, OnlineError, serverUrl } from './online.js';
import { prefs, progress } from './store.js';

const PENDING = 'scores:pending'; // 「游戏:榜」→ 还没传上去的成绩
const SEEDED = 'scores:seeded';

// 服务器地址：和联机用同一台，ws://…/online 换成 http://…/api
function apiBase() {
  const ws = serverUrl();
  if (!ws) return '';
  const url = new URL(ws);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/api';
  return url.href;
}

// 这台设备在榜单上的身份：32 位十六进制，只在第一次用时生成
export function deviceId() {
  let id = prefs.get('online:device', '');
  if (!/^[0-9a-f]{32}$/.test(id)) {
    id = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
    prefs.set('online:device', id);
  }
  return id;
}

// 排进上传队列（同一个榜只留最好的）。不在榜单上的成绩键、不合理的成绩直接忽略
export function queueScore(game, key, value) {
  const board = boardOf(game, key);
  if (!board || !plausible(board, value)) return;
  const pending = prefs.get(PENDING, {});
  const id = `${game}:${key}`;
  if (!beats(board, value, pending[id])) return;
  prefs.set(PENDING, { ...pending, [id]: value });
  clearTimeout(soon);
  soon = setTimeout(flushScores, 1500);
}

let soon = 0;
let flushing = null;

// 把队列里的成绩传上去。返回 Map：「游戏:榜」→ 服务器回的 { rank, value, total }
export function flushScores() {
  flushing ??= upload().finally(() => {
    flushing = null;
  });
  return flushing;
}

async function upload() {
  const results = new Map();
  const base = apiBase();
  if (!base || !navigator.onLine) return results;
  seed();
  for (const [id, value] of Object.entries(prefs.get(PENDING, {}))) {
    const [game, key] = id.split(':');
    let response;
    try {
      response = await post(`${base}/scores`, { device: deviceId(), name: nickname(), game, board: key, value });
    } catch {
      break; // 网断了：剩下的下次再传
    }
    if (response.status === 429 || response.status >= 500) break;
    if (response.ok) results.set(id, await response.json());
    // 传成功了，或者服务器说这个成绩不收（不合理、没有这个榜）：都从队列里拿掉。这期间又有更好的成绩就留着
    const pending = prefs.get(PENDING, {});
    if (pending[id] === value) {
      delete pending[id];
      prefs.set(PENDING, pending);
    }
  }
  return results;
}

// 第一次用榜单时，把以前的个人最好成绩都排进队列
function seed() {
  if (prefs.get(SEEDED, false)) return;
  prefs.set(SEEDED, true);
  for (const [game, boards] of Object.entries(BOARDS)) {
    const records = progress.getRecords(game);
    for (const board of boards) if (records[board.key] !== undefined) queueScore(game, board.key, records[board.key]);
  }
}

const post = (url, body) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

// 取一个榜：{ total, entries: [{ rank, name, value, me }], mine }。先把自己没传的成绩传上去，名次才是最新的
export async function fetchBoard(game, key) {
  const base = apiBase();
  if (!base) throw new OnlineError('no-server', '全网榜单即将开放。你的成绩会先记在手机上，开放后自动上传');
  if (!navigator.onLine) throw new OnlineError('offline', '没有网络，连上网再看榜单');
  await flushScores();
  let response;
  try {
    response = await fetch(`${base}/boards/${encodeURIComponent(game)}/${encodeURIComponent(key)}?device=${deviceId()}`);
  } catch {
    throw new OnlineError('unreachable', '连不上榜单服务器');
  }
  if (!response.ok) throw new OnlineError('server', '榜单暂时打不开，过一会儿再试');
  return response.json();
}

// 这个榜上还有没传上去的成绩吗（榜单页上提示「还没上传」）
export const pendingScore = (game, key) => prefs.get(PENDING, {})[`${game}:${key}`];

// 打开 App 一会儿后、回到前台、重新连上网时，把没传的成绩传上去
setTimeout(flushScores, 3000);
window.addEventListener('online', () => flushScores());
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') flushScores();
});

// 改了昵称：所有榜上的名字一起改（没网就算了，下次上传成绩时也会带上新名字）
export function renameOnBoards(name) {
  const base = apiBase();
  if (!base || !navigator.onLine) return;
  post(`${base}/name`, { device: deviceId(), name }).catch(() => {});
}
