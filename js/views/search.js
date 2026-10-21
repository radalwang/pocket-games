// 搜索：按游戏名、拼音、类别筛选

import { categories, games } from '../registry.js';
import { icon } from '../icons.js';
import { esc } from '../ui.js';
import { listRow } from './parts.js';

let input;
let clearButton;
let results;

export function mountSearch(el) {
  el.innerHTML = `
    <div class="title-row"><h1 class="large-title">搜索</h1></div>
    <label class="search-field">
      ${icon('search')}
      <input type="search" placeholder="游戏名称、拼音或类别" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search">
      <button type="button" class="search-clear" aria-label="清除" hidden>${icon('xmark')}</button>
    </label>
    <div class="search-results"></div>`;

  input = el.querySelector('input');
  clearButton = el.querySelector('.search-clear');
  results = el.querySelector('.search-results');

  input.addEventListener('input', updateSearch);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') input.blur();
  });
  clearButton.addEventListener('click', (e) => {
    e.preventDefault();
    input.value = '';
    updateSearch();
    input.focus();
  });
  updateSearch();
}

export function updateSearch() {
  if (!results) return;
  const raw = input.value.trim();
  const query = raw.toLowerCase();
  clearButton.hidden = !raw;

  const list = query ? games.filter((game) => matches(game, query)) : games;
  if (!list.length) {
    results.innerHTML = `
      <div class="empty">
        <p class="empty-title">没有找到“${esc(raw)}”</p>
        <p class="empty-sub">试试游戏名称或拼音，比如“数独”“shudu”</p>
      </div>`;
    return;
  }
  results.innerHTML = `
    <h2 class="section-head">${query ? '搜索结果' : '全部游戏'}</h2>
    <div class="list">${list.map(listRow).join('')}</div>`;
}

function matches(game, query) {
  const fields = [game.title, game.tagline, categories[game.category], ...(game.keywords ?? [])];
  return fields.some((field) => field.toLowerCase().includes(query));
}
