// 舒尔特方格的玩法介绍：第一次打开时由外壳弹出，格式见 js/player.js 开头

const FONT = 'font-family="ui-rounded, -apple-system, system-ui, sans-serif" text-anchor="middle" dominant-baseline="central"';
const BLUE = '#2f6bff'; // 和游戏里点过的格子同色
const RED = '#ff3b30';

const svg = (body) => `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const text = (x, y, label, size = 12, weight = 600, style = 'fill:var(--label-2)') =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" style="${style}">${label}</text>`;

// 一格：done 是已经点过的（变淡），wrong 是点错的（变红）
function cell(x, y, size, n, state = '') {
  const bg = state === 'done' ? `fill="${BLUE}" fill-opacity=".16"`
    : state === 'wrong' ? `fill="${RED}" fill-opacity=".2"`
      : 'style="fill:var(--fill-2)"';
  const color = state === 'done' ? 'fill:var(--label-3)' : state === 'wrong' ? `fill:${RED}` : 'fill:var(--label)';
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.26}" ${bg}/>`
    + (n ? text(x + size / 2, y + size / 2, n, size * 0.46, 700, color) : '');
}

// size×size 的方格，numbers 按行排；不超过 done 的数字算已经点过
function grid(x, y, cellSize, gap, size, numbers = [], done = 0) {
  let out = `<rect x="${x - gap}" y="${y - gap}" width="${size * (cellSize + gap) + gap}" height="${size * (cellSize + gap) + gap}" rx="${cellSize * 0.4}" style="fill:var(--fill)"/>`;
  for (let i = 0; i < size * size; i++) {
    const n = numbers[i];
    out += cell(x + (i % size) * (cellSize + gap), y + Math.floor(i / size) * (cellSize + gap), cellSize, n, n && n <= done ? 'done' : '');
  }
  return out;
}

const finger = (x, y) => `<circle cx="${x}" cy="${y}" r="13" fill="#fff" fill-opacity=".75" stroke="#000" stroke-opacity=".18" stroke-width="1.5"/>`;

export default [
  {
    title: '按顺序点',
    text: '格子里打乱放着 1 到 25，从 1 开始，按顺序一个个点下去。',
    // 1、2 已经点过，虚线是眼睛找过去的路线，手指正点在 3 上
    art: svg(grid(84, 17, 30, 4, 4, [9, 3, 14, 6, 1, 12, 7, 16, 11, 5, 2, 10, 15, 8, 13, 4], 2)
      + `<path d="M99 66L167 100L133 32" fill="none" stroke="${BLUE}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 6"/>`
      + finger(149, 48)),
  },
  {
    title: '越快越好',
    text: '点完最后一个数字就停表。点错的格子会晃一下，记一次失误。',
    // 左边点错了在晃，右边是停下来的表
    art: svg(cell(56, 44, 60, 8, 'wrong')
      + `<path d="M44 58v32M36 64v20M128 58v32M136 64v20" fill="none" stroke="${RED}" stroke-opacity=".6" stroke-width="3" stroke-linecap="round"/>`
      + text(86, 134, '点错 · 失误 +1')
      + '<rect x="176" y="44" width="92" height="60" rx="16" style="fill:var(--fill)"/>'
      + text(214, 74, '18.4', 26, 800, 'fill:var(--label)') + text(250, 78, '秒', 13, 700, 'fill:var(--label-2)')
      + text(222, 134, '点完 · 停表')),
  },
  {
    title: '盯住中间',
    text: '眼睛尽量盯着方格中间，用余光去找。3×3 到 6×6 各记各的最快用时。',
    // 从小到大三种方格，中间都有一个点
    art: svg([[3, 22], [4, 16], [5, 12.4]].map(([size, s], k) => {
      const gap = size === 3 ? 4 : 3;
      const width = size * s + (size - 1) * gap;
      const x = 52 + k * 98 - width / 2;
      const y = 72 - width / 2;
      return grid(x, y, s, gap, size)
        + `<circle cx="${52 + k * 98}" cy="72" r="4" fill="${BLUE}"/>`
        + text(52 + k * 98, 134, `${size}×${size}`, 13, 700);
    }).join('')),
  },
];
