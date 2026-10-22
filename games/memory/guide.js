// 记忆方格的玩法介绍：第一次打开时由外壳弹出，格式见 js/player.js 开头

const FONT = 'font-family="ui-rounded, -apple-system, system-ui, sans-serif" text-anchor="middle" dominant-baseline="central"';
const MINT = '#22bfb4'; // 和游戏里亮起的格子同色（取渐变的中间色）

const svg = (body) => `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

const text = (x, y, label, size = 12, weight = 600, style = 'fill:var(--label-2)') =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" style="${style}">${label}</text>`;

// 一格：亮着的是薄荷绿，没亮的用外壳的中性色
function cell(x, y, size, on) {
  const fill = on ? `fill="${MINT}"` : 'style="fill:var(--fill-2)"';
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.24}" ${fill}/>`;
}

// size×size 的方格，左上角在 (x, y)；states 是 { 格子序号: true }，标出亮着的格子
function grid(x, y, cellSize, gap, size, states = {}) {
  const full = size * cellSize + (size + 1) * gap;
  let out = `<rect x="${x}" y="${y}" width="${full}" height="${full}" rx="${cellSize * 0.42}" style="fill:var(--fill)"/>`;
  for (let i = 0; i < size * size; i++) {
    out += cell(x + gap + (i % size) * (cellSize + gap), y + gap + Math.floor(i / size) * (cellSize + gap), cellSize, states[i]);
  }
  return out;
}

const gridWidth = (cellSize, gap, size) => size * cellSize + (size + 1) * gap;
const lit = (...cells) => Object.fromEntries(cells.map((i) => [i, true]));
const finger = (x, y) => `<circle cx="${x}" cy="${y}" r="13" fill="#fff" fill-opacity=".75" stroke="#000" stroke-opacity=".18" stroke-width="1.5"/>`;

function arrow(x1, x2, y) {
  return `<path d="M${x1} ${y}H${x2}M${x2 - 8} ${y - 6}L${x2} ${y}L${x2 - 8} ${y + 6}" fill="none" style="stroke:var(--label-2)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
}

// 顺时针转 90° 以后，第 i 格跑到哪一格
const turned = (i, size) => (i % size) * size + (size - 1 - Math.floor(i / size));

export default [
  {
    title: '记住亮格',
    text: '每回合会有几个格子亮一会儿，趁亮着记住它们的位置。',
    art: svg(grid(150 - gridWidth(26, 5, 4) / 2, 85 - gridWidth(26, 5, 4) / 2, 26, 5, 4, lit(1, 4, 10, 15))),
  },
  {
    title: '凭记忆点出来',
    text: '格子熄灭后，把刚才亮的格子一个个点出来，顺序随便。点错一格，这一回合就结束。',
    // 左边是亮着的样子，右边已经点对两格，手指正点第三格
    art: svg(grid(34, 39, 26, 4, 3, lit(0, 5, 7))
      + arrow(136, 164, 85)
      + grid(180, 39, 26, 4, 3, lit(0, 5))
      + finger(180 + 4 + 26 + 4 + 13, 39 + 4 + (26 + 4) * 2 + 13)),
  },
  {
    title: '越记越多',
    text: '全对的话分数翻倍，下一回合多记一格，方格也会变大；点错就退一级。一局 12 回合。',
    art: svg([[3, 14, lit(0, 4, 8), '3 格'], [4, 11, lit(1, 6, 8, 15), '4 格'], [5, 8.6, lit(0, 7, 12, 14, 21, 23), '6 格']]
      .map(([size, s, states, label], k) => {
        const cx = 56 + k * 94;
        const width = gridWidth(s, 3, size);
        return grid(cx - width / 2, 74 - width / 2, s, 3, size, states) + text(cx, 136, label, 13, 700);
      }).join('')),
  },
  {
    title: '旋转模式',
    text: '格子熄灭后整块方格会转 90°。在脑子里跟着转过去，再点亮过的格子。',
    art: svg(grid(34, 39, 26, 4, 3, lit(0, 1, 5))
      + '<path d="M138 68a22 22 0 0 1 30 0" fill="none" style="stroke:var(--label-2)" stroke-width="3" stroke-linecap="round"/>'
      + '<path d="M162 59l6 9-10 2" fill="none" style="stroke:var(--label-2)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>'
      + text(153, 100, '90°', 13, 700)
      + grid(180, 39, 26, 4, 3, lit(...[0, 1, 5].map((i) => turned(i, 3))))),
  },
];
