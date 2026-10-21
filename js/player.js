// 全屏游戏页和底部的继续游戏条，交互参考 Apple Music 的“正在播放”：
// 游戏页从底部升起，往下拖或点左上角收起；收起后游戏不销毁，点继续条马上回来。
//
// 每个游戏模块导出 { mount(root, ctx) }，可以是异步的。ctx 提供：
//   ctx.saved                 上次的存档（没有则为 null）
//   ctx.best                  历史最高分
//   ctx.save(state, info)     存档；info = { summary: 显示在继续条上的文字, finished: 这一局是否已结束 }
//   ctx.submitScore(score)    记录分数，返回更新后的最高分
// mount 返回的对象可以有 pause()、resume()、destroy()，分别在收起、展开、卸载时调用。

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
  const root = document.createElement('div');
  root.className = 'game-root';
  stage.replaceChildren(root);

  try {
    const instance = await module.default.mount(root, {
      saved: progress.getSave(game.id)?.state ?? null,
      best: progress.getBest(game.id),
      save: (state, info) => progress.setSave(game.id, state, info),
      submitScore: (score) => progress.submitScore(game.id, score),
    });
    current = { game, instance: instance ?? {} };
  } catch (err) {
    console.error(err);
    stage.replaceChildren();
    toast('游戏启动失败');
    return false;
  }
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
