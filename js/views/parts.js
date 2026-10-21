// 几个页面共用的卡片片段

import { categories } from '../registry.js';
import { progress } from '../store.js';
import { cover } from '../covers.js';
import { icon } from '../icons.js';
import { esc } from '../ui.js';

// 成绩那一行，比如「最高 2,048 分」；还没有成绩时为空
export const recordText = (game) => game.formatRecord?.(progress.getRecords(game.id)) ?? '';

export function subtitle(game) {
  if (game.status !== 'ready') return '即将推出';
  return recordText(game) || categories[game.category];
}

// 方形封面 + 标题，用在横向栏和资料库网格里
export function tile(game) {
  return `
    <button class="tile" data-open="${game.id}">
      <div class="art">${cover(game)}</div>
      <div class="tile-title">${esc(game.title)}</div>
      <div class="tile-sub">${esc(subtitle(game))}</div>
    </button>`;
}

// 小封面 + 两行文字的列表行，用在搜索结果里
export function listRow(game) {
  const status = game.status === 'ready' ? subtitle(game) : '即将推出';
  return `
    <button class="list-row" data-open="${game.id}">
      <div class="art">${cover(game)}</div>
      <div class="list-text">
        <div class="list-copy">
          <div class="list-title">${esc(game.title)}</div>
          <div class="list-sub">${esc(categories[game.category])} · ${esc(status)}</div>
        </div>
        ${icon('chevronRight')}
      </div>
    </button>`;
}
