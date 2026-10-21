// 界面上通用的小工具

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (text) => String(text).replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

export const fmt = (n) => Number(n).toLocaleString('zh-CN');

// 重新渲染一块区域，同时保留里面横向滚动栏的位置
export function patch(el, html) {
  const kept = new Map();
  el.querySelectorAll('[data-scroll-key]').forEach((s) => kept.set(s.dataset.scrollKey, s.scrollLeft));
  el.innerHTML = html;
  el.querySelectorAll('[data-scroll-key]').forEach((s) => {
    const left = kept.get(s.dataset.scrollKey);
    if (left) s.scrollLeft = left;
  });
}

// 打开游戏或设置时，让主界面缩小退到后面
export function setBehind(on) {
  document.getElementById('app').classList.toggle('is-behind', on);
}

let toastTimer = 0;

export function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), 2000);
}
