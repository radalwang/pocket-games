// 全屏游戏页和底部的继续游戏条，交互参考 Apple Music 的“正在播放”：
// 游戏页从底部升起，往下拖或点左上角收起；收起后游戏不销毁，点继续条马上回来。
//
// 每个游戏模块导出 { mount(root, ctx) }，可以是异步的。ctx 提供：
//   ctx.saved                 上次的存档（没有则为 null）
//   ctx.records               历史最好成绩 { 名称: 数值 }，比如 { score: 2048 }
//   ctx.save(state, info)     存档；info = { summary: 显示在继续条上的文字, finished: 这一局是否已结束 }
//   ctx.submitRecord(key, value, { lowerIsBetter })
//                             记录一项成绩，返回这一项更新后的最好成绩；用时这类越小越好的传 lowerIsBetter: true
//                             在 boards.js 里有榜的成绩键，破了个人纪录会自动排进全网榜单的上传队列
//   ctx.runEnded()            一局结束时调用（游戏结束、解开、过关）。这一局破了纪录的话，外壳弹出「新纪录！」和全网名次
//   ctx.runStarted()          新开一局时调用。玩的过程中就一直在报成绩的游戏（2048、合数、像素小鸟、雨滴算术）要调：
//                             上一局中途破了纪录又放弃的话，不清掉会让下一局结束时误报「新纪录！」
// 卡片上怎么显示成绩，由 registry.js 里这个游戏的 formatRecord 决定。
// mount 返回的对象可以有 pause()、resume()、destroy()：
// 收起游戏页、切到后台或打开玩法介绍时调用 pause，回来时调用 resume，卸载时调用 destroy。
//
// 模块还可以导出 guide：[{ title, text, art }]，art 是 viewBox 为 0 0 300 170 的 SVG。
// 第一次打开这个游戏时自动弹出，之后点右上角的“?”再看。

import { getGame } from './registry.js';
import { prefs, progress } from './store.js';
import { cover } from './covers.js';
import { esc, setBehind, toast } from './ui.js';
import { BOARDS, boardOf, formatValue } from './boards.js';
import { fetchBoard, queueScore } from './scores.js';

const app = document.getElementById('app');
const sheet = document.getElementById('player');
const head = sheet.querySelector('.player-head');
const titleEl = sheet.querySelector('.player-title');
const stage = sheet.querySelector('.player-stage');
const mini = document.getElementById('mini');
const miniArt = mini.querySelector('.mini-art');
const miniTitle = mini.querySelector('.mini-title');
const miniSub = mini.querySelector('.mini-sub');
const guideButton = sheet.querySelector('[data-action="guide"]');
const guideEl = sheet.querySelector('.guide');
const guidePages = guideEl.querySelector('.guide-pages');
const guideDots = guideEl.querySelector('.guide-dots');
const guideSkip = guideEl.querySelector('.guide-skip');
const guideNext = guideEl.querySelector('.guide-next');

let current = null; // { game, instance, guide }
let open = false;
let opening = false;
let guideOpen = false;

export const isPlayerOpen = () => open;

export async function openGame(id) {
  const game = getGame(id);
  if (!game || opening) return;
  if (game.status !== 'ready') {
    toast(`「${game.title}」正在制作中，敬请期待`);
    return;
  }
  opening = true;
  try {
    if (current?.game.id !== id && !(await mountGame(game))) return;
    if (current.guide && !prefs.get(`guide:${id}`, false)) openGuide();
    expand();
  } finally {
    opening = false;
  }
}

async function mountGame(game) {
  let module;
  try {
    module = await game.load();
  } catch (err) {
    console.error(err);
    toast('游戏加载失败，请联网后再试一次');
    return false;
  }

  unmountGame();
  sheet.style.setProperty('--tint', game.cover.colors[1]);
  titleEl.innerHTML = `<span class="thumb">${cover(game)}</span><span>${esc(game.title)}</span>`;

  const start = (saved) => {
    const root = document.createElement('div');
    root.className = 'game-root';
    stage.replaceChildren(root);
    const run = new Map(); // 这一局破了纪录的成绩键 → 这一局开始前的最好成绩
    return module.default.mount(root, {
      saved,
      records: progress.getRecords(game.id),
      save: (state, info) => progress.setSave(game.id, state, info),
      submitRecord: (key, value, options) => {
        const before = progress.getRecords(game.id)[key];
        const best = progress.submitRecord(game.id, key, value, options);
        if (best === value && before !== value) {
          queueScore(game.id, key, value);
          if (!run.has(key)) run.set(key, before);
        }
        return best;
      },
      runEnded: () => cheer(game.id, run),
      runStarted: () => run.clear(),
    });
  };

  const fail = (err) => {
    console.error(err);
    stage.replaceChildren();
    toast('游戏启动失败');
    return false;
  };

  const saved = progress.getSave(game.id)?.state ?? null;
  let instance;
  try {
    instance = await start(saved);
  } catch (err) {
    if (saved === null) return fail(err);
    // 存档读不出来（被截断、或是旧版本留下的格式）：丢掉存档重新开一局，免得以后每次打开都失败
    console.error(err);
    progress.clearSave(game.id);
    try {
      instance = await start(null);
    } catch (retryErr) {
      return fail(retryErr);
    }
    toast('存档读取失败，已重新开始');
  }
  const guide = Array.isArray(module.default.guide) && module.default.guide.length ? module.default.guide : null;
  current = { game, instance: instance ?? {}, guide };
  guideButton.classList.toggle('is-hidden', !guide);
  progress.touch(game.id);
  return true;
}

// ---------- 破纪录的庆祝 ----------
// 一局结束时：破了以前的纪录就弹「新纪录！」，等服务器回了名次再补上「全网第 N 名」；
// 第一次有成绩（以前没有纪录）不算破纪录，只在排进前 100 时提示「已上榜」。点一下去榜单页看这个榜

const cheerEl = sheet.querySelector('.cheer');
let cheerTimer = 0;
let cheerBoard = null; // { game, key }

function cheer(gameId, run) {
  const entries = [...run].filter(([key]) => boardOf(gameId, key));
  run.clear();
  if (!entries.length) return;
  const beaten = entries.find(([, before]) => before !== undefined);
  const [key] = beaten ?? entries[0];
  const board = boardOf(gameId, key);
  // 只有一个榜的游戏不用写榜名（免得出现「分数 12,345 分」）
  const label = BOARDS[gameId].length > 1 ? `${board.label} ` : '';
  const detail = `${label}${formatValue(board, progress.getRecords(gameId)[key])}`;
  if (beaten) showCheer(gameId, key, '新纪录！', detail);
  fetchBoard(gameId, key).then(({ mine }) => {
    if (!mine) return;
    const text = `${detail} · 全网第 ${mine.rank} 名`;
    if (beaten && cheerBoard?.game === gameId && cheerBoard.key === key && !cheerEl.hidden) {
      cheerEl.querySelector('.cheer-detail').textContent = text;
    } else if (!beaten && mine.rank <= 100) {
      showCheer(gameId, key, '已上榜', text);
    }
  }).catch(() => {});
}

function showCheer(gameId, key, title, detail) {
  cheerBoard = { game: gameId, key };
  cheerEl.querySelector('.cheer-title').textContent = title;
  cheerEl.querySelector('.cheer-detail').textContent = detail;
  cheerEl.hidden = false;
  void cheerEl.offsetWidth;
  cheerEl.classList.add('is-visible');
  clearTimeout(cheerTimer);
  cheerTimer = setTimeout(hideCheer, 5000);
}

function hideCheer() {
  clearTimeout(cheerTimer);
  cheerEl.classList.remove('is-visible');
  cheerTimer = setTimeout(() => {
    cheerEl.hidden = true;
  }, 300);
}

// 点庆祝条：收起游戏页，去榜单页看这个榜（榜单页监听 leaderboard:show）
cheerEl.addEventListener('click', () => {
  hideCheer();
  collapse();
  document.dispatchEvent(new CustomEvent('leaderboard:show', { detail: cheerBoard }));
});

function unmountGame() {
  hideGuide();
  if (!cheerEl.hidden) hideCheer();
  current?.instance.destroy?.();
  current = null;
  stage.replaceChildren();
}

function expand() {
  open = true;
  sheet.inert = false;
  sheet.style.transform = '';
  sheet.classList.add('is-open');
  setBehind(true);
  if (!guideOpen) current?.instance.resume?.();
}

export function collapse() {
  if (!open) return;
  open = false;
  sheet.classList.remove('is-open');
  sheet.style.transform = '';
  sheet.inert = true;
  setBehind(false);
  current?.instance.pause?.();
  document.dispatchEvent(new Event('player:closed'));
}

// 清除数据时调用：收起并卸载当前游戏
export function resetPlayer() {
  collapse();
  unmountGame();
}

export function updateMini() {
  const game = getGame(progress.getSession());
  const save = game ? progress.getSave(game.id) : null;
  app.classList.toggle('has-mini', Boolean(save));
  if (!save) return;
  mini.dataset.open = game.id;
  if (mini.dataset.art !== game.id) {
    miniArt.innerHTML = cover(game);
    mini.dataset.art = game.id;
  }
  miniTitle.textContent = game.title;
  miniSub.textContent = save.summary || '继续游戏';
}

// ---------- 玩法介绍 ----------

// 打开时游戏暂停（计时停下、键盘不再控制游戏），关掉后再继续
function openGuide() {
  const steps = current?.guide;
  if (!steps || guideOpen) return;
  guideOpen = true;
  current.instance.pause?.();
  guidePages.innerHTML = steps.map((step) => `
    <section class="guide-page">
      <div class="guide-art">${step.art ?? ''}</div>
      <h3 class="guide-title">${esc(step.title)}</h3>
      <p class="guide-text">${esc(step.text)}</p>
    </section>`).join('');
  guideDots.innerHTML = steps.map(() => '<span></span>').join('');
  guideEl.hidden = false;
  guidePages.scrollLeft = 0;
  updateGuideFoot();
  // 先让浏览器排一次版再加 is-open，淡入动画才会播；不用 requestAnimationFrame，页面在后台时它不触发
  void guideEl.offsetWidth;
  guideEl.classList.add('is-open');
}

function closeGuide() {
  if (!guideOpen) return;
  prefs.set(`guide:${current.game.id}`, true);
  hideGuide();
  if (open && !document.hidden) current.instance.resume?.();
}

function hideGuide() {
  guideOpen = false;
  guideEl.classList.remove('is-open');
  setTimeout(() => {
    if (!guideOpen) guideEl.hidden = true;
  }, 300);
}

const guidePage = () => Math.round(guidePages.scrollLeft / Math.max(1, guidePages.clientWidth));

function updateGuideFoot() {
  const count = guideDots.children.length;
  const page = Math.min(guidePage(), count - 1);
  [...guideDots.children].forEach((dot, i) => dot.classList.toggle('is-active', i === page));
  const last = page === count - 1;
  guideSkip.style.visibility = last ? 'hidden' : '';
  guideNext.textContent = last ? '知道了' : '下一步';
}

guideButton.addEventListener('click', openGuide);
guideSkip.addEventListener('click', closeGuide);
guidePages.addEventListener('scroll', updateGuideFoot, { passive: true });

guideNext.addEventListener('click', () => {
  const page = guidePage();
  if (page >= guideDots.children.length - 1) closeGuide();
  else guidePages.scrollTo({ left: (page + 1) * guidePages.clientWidth, behavior: 'smooth' });
});

// 点卡片外面的暗处也能关掉
guideEl.addEventListener('click', (e) => {
  if (e.target === guideEl) closeGuide();
});

// ---------- 收起与暂停 ----------

sheet.querySelector('[data-action="collapse"]').addEventListener('click', collapse);

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !open) return;
  if (guideOpen) closeGuide();
  else collapse();
});

// 锁屏或切到别的 App 时也算暂停，比如扫雷的计时会停下
document.addEventListener('visibilitychange', () => {
  if (!open) return;
  if (document.hidden) current?.instance.pause?.();
  else if (!guideOpen) current?.instance.resume?.();
});

// 按住顶部往下拖可以收起，拖得够远或甩得够快就收起，否则弹回
let drag = null;

head.addEventListener('pointerdown', (e) => {
  if (!open || e.target.closest('button')) return;
  drag = { startY: e.clientY, lastY: e.clientY, lastT: e.timeStamp, velocity: 0, dy: 0 };
  head.setPointerCapture(e.pointerId);
  sheet.classList.add('is-dragging');
});

head.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const dt = Math.max(1, e.timeStamp - drag.lastT);
  drag.velocity = (e.clientY - drag.lastY) / dt;
  drag.lastY = e.clientY;
  drag.lastT = e.timeStamp;
  drag.dy = Math.max(0, e.clientY - drag.startY);
  sheet.style.transform = `translateY(${drag.dy}px)`;
});

function endDrag() {
  if (!drag) return;
  const { dy, velocity } = drag;
  drag = null;
  sheet.classList.remove('is-dragging');
  if (dy > 140 || (dy > 30 && velocity > 0.5)) collapse();
  else sheet.style.transform = '';
}

head.addEventListener('pointerup', endDrag);
head.addEventListener('pointercancel', endDrag);
