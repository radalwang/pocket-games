// 入口：切换标签页、分发点击、注册离线缓存

import { changes, prefs } from './store.js';
import { icon } from './icons.js';
import { renderHome } from './views/home.js';
import { renderLibrary } from './views/library.js';
import { mountSearch, updateSearch } from './views/search.js';
import { isPlayerOpen, openGame, updateMini } from './player.js';
import { openSettings, VERSION } from './settings.js';
import { toast } from './ui.js';

const views = Object.fromEntries([...document.querySelectorAll('.view')].map((view) => [view.dataset.view, view]));
const bodyOf = (name) => views[name].querySelector('.view-body');

document.querySelectorAll('[data-icon]').forEach((el) => {
  el.innerHTML = icon(el.dataset.icon);
});

// 游戏进行时数据会频繁变化，等游戏页收起后再统一刷新列表
let stale = false;

function refresh() {
  stale = false;
  renderHome(bodyOf('home'));
  renderLibrary(bodyOf('library'));
  updateSearch();
}

function selectTab(name, { initial = false } = {}) {
  const view = views[name] ?? views.home;
  if (!initial && view.classList.contains('is-active')) {
    view.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  for (const other of Object.values(views)) other.classList.toggle('is-active', other === view);
  for (const tab of document.querySelectorAll('.dock [data-tab]')) {
    const active = tab.dataset.tab === view.dataset.view;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  }
  prefs.set('tab', view.dataset.view);
}

document.addEventListener('click', (e) => {
  const target = e.target.closest('[data-open], [data-tab], [data-action="settings"]');
  if (!target) return;
  const { open, tab, action } = target.dataset;
  if (open) openGame(open);
  else if (tab) selectTab(tab);
  else if (action === 'settings') openSettings();
});

// 往下滚动后，顶部出现带毛玻璃的小标题栏
for (const view of Object.values(views)) {
  view.addEventListener('scroll', () => {
    view.classList.toggle('is-scrolled', view.scrollTop > 44);
  }, { passive: true });
}

changes.addEventListener('change', () => {
  updateMini();
  if (isPlayerOpen()) stale = true;
  else refresh();
});

document.addEventListener('player:closed', () => {
  if (stale) refresh();
});

mountSearch(bodyOf('search'));
refresh();
selectTab(prefs.get('tab', 'home'), { initial: true });
updateMini();

// 新版本装好后，sw.js 会带上 ?updated 刷新页面
const here = new URL(window.location.href);
if (here.searchParams.has('updated')) {
  here.searchParams.delete('updated');
  window.history.replaceState(null, '', here.href);
  toast(`已更新到 ${VERSION}`);
}

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('sw.js').then((registration) => {
    // 主屏幕上的 App 从后台切回来时不会重新加载页面，浏览器也就不会去查新版本，这里手动查一次（没网时查不到，忽略）
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') registration.update().catch(() => {});
    });
  }).catch((err) => console.warn('离线缓存注册失败', err));
}
