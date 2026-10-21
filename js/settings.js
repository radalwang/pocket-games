// 设置：安装说明、离线状态、清除数据、版本信息

import { games } from './registry.js';
import { progress } from './store.js';
import { resetPlayer } from './player.js';
import { setBehind, toast } from './ui.js';

export const VERSION = '0.4.0';

const sheet = document.getElementById('settings');
const body = sheet.querySelector('.sheet-body');

export function openSettings() {
  render();
  sheet.inert = false;
  sheet.classList.add('is-open');
  setBehind(true);
}

function closeSettings() {
  sheet.classList.remove('is-open');
  sheet.inert = true;
  setBehind(false);
}

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
}

function offlineStatus() {
  if (!('serviceWorker' in navigator)) return '不支持';
  if (!window.isSecureContext) return '需要 https 网址';
  return navigator.serviceWorker.controller ? '已就绪' : '准备中';
}

function render() {
  const standalone = isStandalone();
  const playable = games.filter((game) => game.status === 'ready').length;
  body.innerHTML = `
    <p class="group-label">安装</p>
    <div class="group">
      <div class="cell"><span>添加到主屏幕</span><span class="cell-value">${standalone ? '已添加' : '未添加'}</span></div>
      <div class="cell"><span>离线缓存</span><span class="cell-value">${offlineStatus()}</span></div>
    </div>
    ${standalone ? '' : '<p class="group-note">在 Safari 里点底部的“分享”按钮，选“添加到主屏幕”。之后从主屏幕打开，就是全屏、可以离线玩的 App。</p>'}

    <p class="group-label">数据</p>
    <div class="group">
      <button class="cell cell-danger" data-action="reset">清除所有存档和最高分</button>
    </div>
    <p class="group-note">存档只保存在这台设备上。删除主屏幕上的图标时，存档也会一起删除。</p>

    <p class="group-label">关于</p>
    <div class="group">
      <div class="cell"><span>版本</span><span class="cell-value">${VERSION}</span></div>
      <div class="cell"><span>游戏</span><span class="cell-value">${games.length} 款 · ${playable} 款可以玩</span></div>
    </div>`;
}

sheet.querySelector('[data-action="close-settings"]').addEventListener('click', closeSettings);

body.addEventListener('click', (e) => {
  if (!e.target.closest('[data-action="reset"]')) return;
  if (!window.confirm('确定要清除所有存档和最高分吗？清除后无法恢复。')) return;
  resetPlayer();
  progress.clearAll();
  render();
  toast('已清除所有记录');
});
