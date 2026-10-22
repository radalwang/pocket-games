// 2048 的玩法介绍：第一次打开时由外壳弹出，格式见 js/player.js 开头

const FONT = 'font-family="ui-rounded, -apple-system, system-ui, sans-serif" font-weight="800" text-anchor="middle" dominant-baseline="central"';

// 和游戏里的方块同色（取每组渐变的中间色）
const COLORS = {
  2: ['#fff1e0', '#9a4d12'],
  4: ['#ffd3a6', '#9a4d12'],
  8: ['#ffab4d', '#fff'],
  16: ['#ff8943', '#fff'],
  2048: ['#4142bb', '#fff'],
  4096: ['#262a8a', '#fff'],
};

const svg = (body) => `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

function tile(x, y, size, value, attrs = '') {
  const [bg, fg] = COLORS[value];
  const fontSize = size * (String(value).length > 3 ? 0.3 : 0.44);
  return `<g ${attrs}><rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.22}" fill="${bg}"/>`
    + `<text x="${x + size / 2}" y="${y + size / 2}" ${FONT} font-size="${fontSize}" fill="${fg}">${value}</text></g>`;
}

// 4×4 棋盘，tiles 为 [行, 列, 数字]
function board(x, y, cell, gap, tiles) {
  const size = cell * 4 + gap * 5;
  const at = (i) => gap + i * (cell + gap);
  let out = `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${cell * 0.45}" style="fill:var(--fill)"/>`;
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) out += `<rect x="${x + at(c)}" y="${y + at(r)}" width="${cell}" height="${cell}" rx="${cell * 0.24}" style="fill:var(--fill)"/>`;
  }
  for (const [r, c, value] of tiles) out += tile(x + at(c), y + at(r), cell, value);
  return out;
}

function arrow(x1, y, x2) {
  return `<path d="M${x1} ${y}H${x2}M${x2 - 9} ${y - 7}L${x2} ${y}L${x2 - 9} ${y + 7}" fill="none" style="stroke:var(--label-2)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export default [
  {
    title: '滑动方块',
    text: '在棋盘上往任意方向滑，所有方块会一起滑到那一边。',
    art: svg(board(28, 37, 20, 3, [[0, 0, 2], [1, 2, 4], [2, 1, 8], [3, 3, 2]])
      + arrow(136, 85, 166)
      + board(177, 37, 20, 3, [[0, 3, 2], [1, 3, 4], [2, 3, 8], [3, 3, 2]])),
  },
  {
    title: '相同就合并',
    text: '两个相同的数字撞到一起，会合成它们的和，分数也跟着增加。',
    art: svg(tile(52, 63, 44, 2) + tile(102, 63, 44, 2) + arrow(162, 85, 194) + tile(206, 63, 44, 4)),
  },
  {
    title: '新方块',
    text: '每滑一次，空位上会冒出一个新的 2 或 4。棋盘满了又合不动，就结束了。',
    art: svg(board(92, 27, 24, 4, [[0, 0, 4], [0, 1, 2], [1, 0, 8], [2, 0, 2]])
      + tile(180, 115, 24, 2)
      + '<rect x="176" y="111" width="32" height="32" rx="9" fill="none" stroke="#ff2d6f" stroke-width="2" stroke-dasharray="4 3"/>'
      + '<path d="M214 105l6-6M218 122h8M192 99v-8" fill="none" stroke="#ff2d6f" stroke-width="2.5" stroke-linecap="round"/>'),
  },
  {
    title: '凑出 2048',
    text: '凑出 2048 就赢了，还可以接着挑战更大的数字。最高分会一直记着。',
    art: svg('<circle cx="110" cy="85" r="54" fill="#5e5ce6" fill-opacity=".18"/>'
      + tile(75, 50, 70, 2048)
      + arrow(166, 85, 198)
      + tile(210, 58, 54, 4096, 'opacity=".55"')),
  },
];
