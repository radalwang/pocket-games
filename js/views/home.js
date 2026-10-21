// 首页：顶部大卡片横向滑动，下面是「最近玩过」和按类别分的横向栏

import { categories, games, getGame } from '../registry.js';
import { progress } from '../store.js';
import { cover } from '../covers.js';
import { icon } from '../icons.js';
import { esc, fmt, patch } from '../ui.js';
import { tile } from './parts.js';

export function renderHome(el) {
  const recent = progress.getRecent().map(getGame).filter(Boolean);
  const byCategory = Object.entries(categories).map(([key, name]) =>
    shelf(`${name}游戏`, `category-${key}`, games.filter((game) => game.category === key)));

  patch(el, `
    <div class="title-row">
      <h1 class="large-title">首页</h1>
      <button class="avatar" data-action="settings" aria-label="设置">${icon('person')}</button>
    </div>
    <div class="hero" data-scroll-key="hero">${games.map(heroCard).join('')}</div>
    ${recent.length ? shelf('最近玩过', 'recent', recent) : ''}
    ${byCategory.join('')}
    <p class="footnote">所有游戏都存在这台设备上，没有网络也能玩</p>`);
}

function heroCard(game) {
  const ready = game.status === 'ready';
  const save = ready ? progress.getSave(game.id) : null;
  const resuming = Boolean(save && !save.finished);
  const best = progress.getBest(game.id);
  const eyebrow = !ready ? '即将推出' : resuming ? '继续上次的进度' : '立即开玩';
  const action = ready
    ? `<span class="pill">${icon('play')}${resuming ? '继续' : '开始游戏'}</span>`
    : '<span class="pill pill-ghost">敬请期待</span>';

  return `
    <div class="hero-item">
      <p class="eyebrow">${eyebrow}</p>
      <button class="hero-card" data-open="${game.id}" style="--ink: ${game.cover.ink}">
        <div class="hero-art">${cover(game)}</div>
        <div class="hero-info">
          <h3 class="hero-title">${esc(game.title)}</h3>
          <p class="hero-tagline">${esc(game.tagline)}</p>
          <div class="hero-actions">
            ${action}
            ${best ? `<span class="hero-meta">最高 ${fmt(best)} 分</span>` : ''}
          </div>
        </div>
      </button>
    </div>`;
}

function shelf(title, key, list) {
  return `
    <section class="shelf">
      <button class="shelf-head" data-tab="library">${esc(title)}${icon('chevronRight')}</button>
      <div class="row" data-scroll-key="${key}">${list.map(tile).join('')}</div>
    </section>`;
}
