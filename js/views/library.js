// 资料库：按类别列出所有游戏

import { categories, games } from '../registry.js';
import { esc, patch } from '../ui.js';
import { tile } from './parts.js';

export function renderLibrary(el) {
  const sections = Object.entries(categories).map(([key, name]) => {
    const list = games.filter((game) => game.category === key);
    return `
      <section class="section">
        <h2 class="section-head">${esc(name)}<small>${list.length} 款</small></h2>
        <div class="grid">${list.map(tile).join('')}</div>
      </section>`;
  });

  patch(el, `
    <div class="title-row"><h1 class="large-title">资料库</h1></div>
    ${sections.join('')}`);
}
