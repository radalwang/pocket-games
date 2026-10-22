// 设置：安装说明、离线状态、清除数据、版本信息

import { games } from './registry.js';
import { progress } from './store.js';
import { resetPlayer } from './player.js';
import { setBehind, toast } from './ui.js';

export const VERSION = '0.7.1';

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

function canUpdate() {
  return 'serviceWorker' in navigator && window.isSecureContext;
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
      ${canUpdate() ? '<button class="cell cell-action" data-action="check-update"><span>检查更新</span><span class="cell-value"></span></button>' : ''}
      <div class="cell"><span>游戏</span><span class="cell-value">${games.length} 款 · ${playable} 款可以玩</span></div>
    </div>`;
}

sheet.querySelector('[data-action="close-settings"]').addEventListener('click', closeSettings);

body.addEventListener('click', (e) => {
  const button = e.target.closest('[data-action]');
  if (button?.dataset.action === 'reset') resetAll();
  else if (button?.dataset.action === 'check-update') checkUpdate(button);
});

function resetAll() {
  if (!window.confirm('确定要清除所有存档和最高分吗？清除后无法恢复。')) return;
  resetPlayer();
  progress.clearAll();
  render();
  toast('已清除所有记录');
}

// 手动查一次新版本。有新版就开始下载，下载完 sw.js 会把页面刷新成新版并提示“已更新”（见 sw.js 的 activate）
async function checkUpdate(button) {
  const status = button.querySelector('.cell-value');
  const finish = (message) => {
    button.disabled = false;
    status.textContent = '';
    toast(message);
  };
  const registration = await navigator.serviceWorker.getRegistration();
  if (!registration) {
    toast('离线缓存还没准备好，稍后再试');
    return;
  }
  button.disabled = true;
  status.textContent = '正在检查…';
  try {
    await registration.update();
  } catch {
    finish('没有连上网络，稍后再试');
    return;
  }
  const worker = registration.installing ?? registration.waiting;
  if (!worker) {
    finish('已是最新版本');
    return;
  }
  status.textContent = '正在下载新版本…';
  worker.addEventListener('statechange', () => {
    if (worker.state === 'redundant') finish('新版本没下载完，稍后再试');
  });
}
