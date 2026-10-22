// 榜单：上面选游戏和榜，下面是全网前 100 名，自己的名次固定在标签栏上方。
// 数据从 scores.js 取；每个游戏有哪几个榜、成绩怎么写见 boards.js。

import { games } from '../registry.js';
import { prefs, progress } from '../store.js';
import { cover } from '../covers.js';
import { icon } from '../icons.js';
import { esc, fmt, patch } from '../ui.js';
import { BOARDS, boardOf, formatValue } from '../boards.js';
import { fetchBoard, pendingScore } from '../scores.js';
import { nickname, OnlineError } from '../online.js';
import { isPlayerOpen } from '../player.js';

const PREF = 'leaderboard'; // { game: 上次看的游戏, boards: { 游戏: 这个游戏上次看的榜 } }
const MEDALS = ['gold', 'silver', 'bronze'];
const TIMEOUT = 20_000;

// 有榜的游戏，按游戏清单的顺序
const listed = games.filter((game) => Object.hasOwn(BOARDS, game.id));
const valid = (id) => listed.some((game) => game.id === id);

let view;
let gameRow;
let boardsEl;
let mainEl;
let pinEl;
let gameId = ''; // 正在看的游戏
let boardKey = ''; // 正在看的榜

// 「游戏:榜」→ { data, error }：切回看过的榜时先显示上次取到的，同时在后台刷新
const cache = new Map();
let ticket = 0; // 每取一次加一；回来的结果不是最近一次的就丢掉（快速切换游戏或榜时）
let loading = ''; // 正在取的「游戏:榜」

const current = () => `${gameId}:${boardKey}`;

export function mountLeaderboard(el) {
  view = el.closest('.view');
  el.innerHTML = `
    <div class="title-row">
      <h1 class="large-title">榜单</h1>
      <button class="avatar" data-action="settings" aria-label="设置">${icon('person')}</button>
    </div>
    <div class="lb-games" role="tablist" aria-label="游戏">${listed.map(gameChip).join('')}</div>
    <div class="lb-boards"></div>
    <div class="lb-main"></div>
    <div class="lb-pin"></div>`;
  gameRow = el.querySelector('.lb-games');
  boardsEl = el.querySelector('.lb-boards');
  mainEl = el.querySelector('.lb-main');
  pinEl = el.querySelector('.lb-pin');

  el.addEventListener('click', (e) => {
    const target = e.target.closest('[data-game], [data-board], [data-action="retry"]');
    if (!target) return;
    if (target.dataset.game) choose(target.dataset.game);
    else if (target.dataset.board) choose(gameId, target.dataset.board);
    else refreshLeaderboard();
  });

  // 上次看的游戏；第一次打开时看最近玩过的、有榜的游戏
  pick([prefs.get(PREF, {}).game, ...progress.getRecent()].find(valid));
  render({ reveal: true });
}

// 从别处跳过来看某个榜（游戏页里点「新纪录！」）
export function showBoard(id, board) {
  if (!view) return;
  pick(id, board);
  view.scrollTop = 0;
  render({ reveal: true });
  refreshLeaderboard();
}

// 重新取当前的榜。同一个榜已经在取了就不再发一次（切到这页和回到前台可能同时触发）
export function refreshLeaderboard() {
  if (!view || loading === current()) return;
  const id = current();
  const seq = ++ticket;
  loading = id;
  renderMain();
  withTimeout(fetchBoard(gameId, boardKey))
    .then((data) => {
      if (!Array.isArray(data?.entries)) throw new Error('榜单数据不对');
      return { data };
    })
    .catch((error) => ({ data: cache.get(id)?.data, error }))
    .then((entry) => {
      if (seq !== ticket) return;
      loading = '';
      cache.set(id, entry);
      renderMain();
    });
}

// 本机的成绩变了（比如清除了数据）时重画底部自己那一行，不重新取
export function updateLeaderboard() {
  if (view) renderMain();
}

// fetch 本身没有超时，网络卡住时会一直转圈：20 秒还没回来就算连不上
function withTimeout(promise) {
  let timer = 0;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new OnlineError('unreachable', '连不上榜单服务器')), TIMEOUT);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// 换到某个游戏的某个榜。游戏不对就留在当前的游戏；榜不对就用这个游戏上次看的，再不然用第一个。
// 记进偏好，下次打开还是它
function pick(id, board) {
  const saved = prefs.get(PREF, {});
  gameId = [id, gameId].find(valid) ?? listed[0].id;
  boardKey = (boardOf(gameId, board) ?? boardOf(gameId, saved.boards?.[gameId]) ?? BOARDS[gameId][0]).key;
  prefs.set(PREF, { game: gameId, boards: { ...saved.boards, [gameId]: boardKey } });
}

// 点了游戏或榜：换过去，重新取
function choose(id, board) {
  const before = current();
  pick(id, board);
  if (current() === before) return;
  render();
  refreshLeaderboard();
}

function render({ reveal = false } = {}) {
  for (const chip of gameRow.children) {
    const active = chip.dataset.game === gameId;
    chip.classList.toggle('is-active', active);
    chip.setAttribute('aria-selected', String(active));
  }
  patch(boardsEl, boardPicker());
  renderMain();
  if (reveal) {
    scrollToActive(gameRow);
    scrollToActive(boardsEl.querySelector('.lb-pills'));
  }
}

// 选中的那一项在横向栏里看不见时（比如从游戏页跳过来），把它滚到中间
function scrollToActive(row) {
  const item = row?.querySelector('.is-active');
  if (!item) return;
  const box = row.getBoundingClientRect();
  const rect = item.getBoundingClientRect();
  if (rect.left < box.left || rect.right > box.right) {
    row.scrollLeft += rect.left + rect.width / 2 - (box.left + box.width / 2);
  }
}

const gameChip = (game) => `
  <button class="lb-game" role="tab" aria-selected="false" data-game="${game.id}">
    <span class="lb-thumb">${cover(game)}</span>${esc(game.title)}
  </button>`;

// 两到四个榜用分段控件，更多的（汉诺塔、华容道、推箱子）用一排能横向滑动的标签
function boardPicker() {
  const boards = BOARDS[gameId];
  if (boards.length < 2) return '';
  const buttons = boards.map((board) => {
    const active = board.key === boardKey;
    return `<button class="${active ? 'is-active' : ''}" role="tab" aria-selected="${active}" data-board="${esc(board.key)}">${esc(board.label)}</button>`;
  }).join('');
  return boards.length <= 4
    ? `<div class="lb-seg" role="tablist" aria-label="榜">${buttons}</div>`
    : `<div class="lb-pills" role="tablist" aria-label="榜" data-scroll-key="boards-${gameId}">${buttons}</div>`;
}

function renderMain() {
  const board = boardOf(gameId, boardKey);
  const { data, error } = cache.get(current()) ?? {};
  const busy = loading === current();
  if (data) mainEl.innerHTML = ranking(board, data, busy ? null : error);
  else if (error && !busy) mainEl.innerHTML = failed(error);
  else mainEl.innerHTML = '<div class="lb-spinner" role="status" aria-label="正在加载"></div>';
  pinEl.innerHTML = mineCard(board, data, !busy && error);
}

// error：刚才刷新没成功，但还有上次取到的榜可以看
function ranking(board, { total, entries }, error) {
  if (!entries.length) {
    return `
      <div class="empty">
        <p class="empty-title">还没有人上榜</p>
        <p class="empty-sub">快来当第一名</p>
      </div>`;
  }
  const side = error
    ? '<button class="lb-link" data-action="retry">刷新失败，重试</button>'
    : total > entries.length ? `<span>显示前 ${entries.length} 名</span>` : '';
  return `
    <div class="lb-meta"><span>共 ${fmt(total)} 人上榜</span>${side}</div>
    <ol class="lb-list">${entries.map((entry) => row(board, entry)).join('')}</ol>`;
}

function row(board, entry) {
  return `
    <li class="lb-row${entry.me ? ' is-me' : ''}">
      ${rank(entry.rank)}
      <span class="lb-name">${esc(entry.name)}</span>
      ${entry.me ? '<span class="lb-tag">我</span>' : ''}
      <span class="lb-value">${esc(formatValue(board, entry.value))}</span>
    </li>`;
}

// 名次牌：前三名是金、银、铜色
function rank(n) {
  const medal = MEDALS[n - 1];
  return `<span class="lb-rank${medal ? ` is-${medal}` : ''}">${esc(n)}</span>`;
}

function failed(error) {
  // 不是 OnlineError 的（比如服务器回了坏数据）也当成服务器出了问题
  const message = error instanceof OnlineError ? error.message : '榜单暂时打不开，过一会儿再试';
  return `
    <div class="empty">
      <p class="empty-title">${esc(message)}</p>
      ${error.code === 'no-server' ? '' : '<button class="lb-retry" data-action="retry">重试</button>'}
    </div>`;
}

// 底部固定的自己那一行：在榜上就显示名次和成绩；有还没传上去的成绩就说一声；还没成绩就点一下去玩
function mineCard(board, data, error) {
  const pending = pendingScore(gameId, boardKey);
  const mine = data?.mine;
  if (mine) {
    const note = pending === undefined ? `全网第 ${fmt(mine.rank)} 名` : `新成绩 ${formatValue(board, pending)} 还没上传`;
    return card(rank(mine.rank), `
      <span class="lb-me-title">${esc(nickname())}</span>
      <span class="lb-me-sub">${esc(note)}</span>`, `<span class="lb-me-value">${esc(formatValue(board, mine.value))}</span>`);
  }
  const badge = `<span class="lb-rank">${icon('trophy')}</span>`;
  if (pending !== undefined) {
    return card(badge, `<span class="lb-me-note">你的成绩 ${esc(formatValue(board, pending))} 还没上传，联网后自动上传</span>`);
  }
  // 本机有成绩，但榜还没取到（或者服务器没收这个成绩）
  const best = progress.getRecords(gameId)[boardKey];
  if (best !== undefined) {
    const note = data ? '没有上榜' : error?.code === 'no-server' ? '榜单开放后显示名次' : error ? '暂时查不到名次' : '正在查询名次…';
    return card(badge, `
      <span class="lb-me-title">你的最好成绩</span>
      <span class="lb-me-sub">${note}</span>`, `<span class="lb-me-value">${esc(formatValue(board, best))}</span>`);
  }
  return `
    <button class="lb-me glass" data-open="${gameId}">
      ${badge}
      <span class="lb-me-text"><span class="lb-me-note">还没有成绩，去玩一局吧</span></span>
      <span class="lb-go">${icon('play')}</span>
    </button>`;
}

const card = (badge, text, side = '') => `
  <div class="lb-me glass">
    ${badge}
    <span class="lb-me-text">${text}</span>
    ${side}
  </div>`;

// 开着榜单页时，回到前台、重新连上网、收起游戏页，都刷新一下
const showing = () => view?.classList.contains('is-active') && !document.hidden && !isPlayerOpen();

document.addEventListener('visibilitychange', () => {
  if (showing()) refreshLeaderboard();
});
window.addEventListener('online', () => {
  if (showing()) refreshLeaderboard();
});
document.addEventListener('player:closed', () => {
  if (showing()) refreshLeaderboard();
});
