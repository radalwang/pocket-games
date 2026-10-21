// 全屏游戏页和底部的继续游戏条，交互参考 Apple Music 的“正在播放”：
// 游戏页从底部升起，往下拖或点左上角收起；收起后游戏不销毁，点继续条马上回来。
//
// 每个游戏模块导出 { mount(root, ctx) }，可以是异步的。ctx 提供：
//   ctx.saved                 上次的存档（没有则为 null）
//   ctx.records               历史最好成绩 { 名称: 数值 }，比如 { score: 2048 }
//   ctx.save(state, info)     存档；info = { summary: 显示在继续条上的文字, finished: 这一局是否已结束 }
//   ctx.submitRecord(key, value, { lowerIsBetter })
//                             记录一项成绩，返回这一项更新后的最好成绩；用时这类越小越好的传 lowerIsBetter: true
// 卡片上怎么显示成绩，由 registry.js 里这个游戏的 formatRecord 决定。
// mount 返回的对象可以有 pause()、resume()、destroy()：
// 收起游戏页或切到后台时调用 pause，回来时调用 resume，卸载时调用 destroy。

import { getGame } from './registry.js';
import { progress } from './store.js';
import { cover } from './covers.js';
import { esc, setBehind, toast } from './ui.js';

const app = document.getElementById('app');
const sheet = document.getElementById('player');
const head = sheet.querySelector('.player-head');
const titleEl = sheet.querySelector('.player-title');
const stage = sheet.querySelector('.player-stage');
const mini = document.getElementById('mini');
const miniArt = mini.querySelector('.mini-art');
const miniTitle = mini.querySelector('.mini-title');
const miniSub = mini.querySelector('.mini-sub');

let current = null; // { game, instance }
let open = false;
let opening = false;

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
    return module.default.mount(root, {
      saved,
      records: progress.getRecords(game.id),
      save: (state, info) => progress.setSave(game.id, state, info),
      submitRecord: (key, value, options) => progress.submitRecord(game.id, key, value, options),
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
  current = { game, instance: instance ?? {} };
  progress.touch(game.id);
  return true;
}

function unmountGame() {
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
  current?.instance.resume?.();
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

sheet.querySelector('[data-action="collapse"]').addEventListener('click', collapse);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && open) collapse();
});

// 锁屏或切到别的 App 时也算暂停，比如扫雷的计时会停下
document.addEventListener('visibilitychange', () => {
  if (!open) return;
  if (document.hidden) current?.instance.pause?.();
  else current?.instance.resume?.();
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
