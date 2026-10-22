// 飞行棋的玩法介绍：第一次打开时由外壳弹出，格式见 js/player.js 开头。配图里的格子、飞机和游戏里同样的颜色、同样的形状

const FONT = 'ui-rounded, -apple-system, system-ui, sans-serif';
const PLANE_COLORS = ['#ff3b30', '#ffbf00', '#0a84ff', '#30c35a'];
const CELL_COLORS = ['#ff8f87', '#ffd55c', '#7ab8ff', '#7fdc98'];
const YARD_COLORS = ['#ffe1de', '#fff1c4', '#dcebff', '#d9f5e1'];
const PLANE = 'M0 -0.5C0.07 -0.5 0.09 -0.4 0.09 -0.3L0.09 -0.1L0.48 0.12L0.48 0.22L0.09 0.12L0.07 0.32L0.22 0.42L0.22 0.5L0 0.45L-0.22 0.5L-0.22 0.42L-0.07 0.32L-0.09 0.12L-0.48 0.22L-0.48 0.12L-0.09 -0.1L-0.09 -0.3C-0.09 -0.4 -0.07 -0.5 0 -0.5Z';
// 骰子 1–6 点各亮哪几个点
const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

const svg = (body) => `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
const text = (x, y, content, size = 12) =>
  `<text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-size="${size}" font-weight="600" font-family="${FONT}" style="fill:var(--label-2)">${content}</text>`;

// 一架飞机，机头朝 angle 度（0 朝上，90 朝右）
const plane = (x, y, angle, color, size = 26) =>
  `<path d="${PLANE}" transform="translate(${x} ${y}) rotate(${angle}) scale(${size})" fill="${PLANE_COLORS[color]}" stroke="#fff" stroke-width="${(1.8 / size).toFixed(3)}" stroke-linejoin="round"/>`;

const cell = (x, y, color, size = 30) => `<rect x="${x}" y="${y}" width="${size - 4}" height="${size - 4}" rx="6" fill="${CELL_COLORS[color]}"/>`;

// 一排格子，颜色从 first 开始轮流；返回每格中心的横坐标
function row(x, y, count, first, size = 30) {
  return Array.from({ length: count }, (_, k) => cell(x + k * size, y, (first + k) % 4, size)).join('');
}

function arrow(d, [ex, ey], angle, dashed = false) {
  const head = (a) => `${(ex - 8 * Math.cos(angle + a)).toFixed(1)} ${(ey - 8 * Math.sin(angle + a)).toFixed(1)}`;
  const line = 'fill="none" style="stroke:var(--label-2)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';
  return `<path d="${d}" ${line}${dashed ? ' stroke-dasharray="5 5"' : ''}/><path d="M${head(0.5)}L${ex} ${ey}L${head(-0.5)}" ${line}/>`;
}

function dice(x, y, value, size = 52) {
  const pip = size * 0.1;
  const at = (k) => [x + size * (0.25 + (k % 3) * 0.25), y + size * (0.25 + Math.floor(k / 3) * 0.25)];
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.24}" fill="#fff" stroke="${PLANE_COLORS[0]}" stroke-width="3"/>`
    + PIPS[value].map((k) => `<circle cx="${at(k)[0]}" cy="${at(k)[1]}" r="${pip}" fill="#1c1c1e"/>`).join('');
}

// 一个机场：底色、四个停机位
function yard(x, y, size, color) {
  const spots = [[0.3, 0.3], [0.7, 0.3], [0.3, 0.7], [0.7, 0.7]]
    .map(([sx, sy]) => `<circle cx="${x + sx * size}" cy="${y + sy * size}" r="${size * 0.13}" fill="#fff" stroke="${CELL_COLORS[color]}" stroke-width="2"/>`).join('');
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.14}" fill="${YARD_COLORS[color]}"/>${spots}`;
}

export default [
  {
    title: '掷6起飞',
    text: '掷到 6 才能从机场起飞，掷到 6 还能再掷一次。同一轮连掷三次 6，这一轮就作废。',
    art: svg(
      yard(28, 18, 104, 0)
      + plane(59, 49, 180, 0) + plane(101, 49, 180, 0) + plane(59, 91, 180, 0)
      + `<circle cx="101" cy="140" r="13" fill="${CELL_COLORS[0]}"/>${plane(101, 140, 180, 0)}`
      + arrow('M110 96Q126 116 112 130', [112, 130], 2.2)
      + dice(186, 34, 6, 62) + text(217, 122, '再掷一次'),
    ),
  },
  {
    title: '同色跳虚线飞',
    text: '停在自己颜色的格子就跳到下一个同色格，停在小飞机格就顺着虚线飞过去。跳和飞能连着来。',
    art: svg(
      row(24, 26, 8, 0) + plane(37, 39, 90, 0)
      + arrow('M40 24Q86 -2 152 24', [152, 24], 0.6)
      + cell(70, 104, 0, 34) + cell(196, 104, 0, 34)
      + `<rect x="133" y="88" width="34" height="62" rx="6" fill="${YARD_COLORS[2]}" stroke="${CELL_COLORS[2]}" stroke-width="2"/>`
      + `<path d="M85 119H211" stroke="${PLANE_COLORS[0]}" stroke-width="3.5" stroke-dasharray="7 6" stroke-linecap="round"/>`
      + plane(150, 119, 90, 0, 28),
    ),
  },
  {
    title: '撞回机场',
    text: '停在别人飞机所在的格子，把它们撞回机场。飞行时横穿的那格跑道上的飞机也会被撞回去。',
    art: svg(
      row(30, 96, 7, 0) + plane(43, 109, 90, 0) + plane(133, 109, 90, 1, 22)
      + arrow('M48 94Q92 64 128 94', [128, 94], 0.7)
      + yard(212, 14, 64, 1) + plane(244, 46, 180, 1, 20)
      + arrow('M150 98Q190 96 222 62', [222, 62], -0.9, true),
    ),
  },
  {
    title: '正好进终点',
    text: '绕一圈后拐进自己颜色的跑道，要正好走到终点，多出的步数往回退。飞机全部到终点就赢了。',
    art: svg(
      [0, 1, 2, 3, 4].map((k) => `<rect x="${26 + k * 34}" y="70" width="30" height="30" rx="6" fill="${YARD_COLORS[0]}" stroke="${CELL_COLORS[0]}" stroke-width="2"/>`).join('')
      + `<path d="M196 50L246 85L196 120Z" fill="${CELL_COLORS[0]}"/>`
      + plane(109, 85, 90, 0)
      + dice(236, 112, 4, 44)
      + arrow('M114 66Q164 22 214 72', [214, 72], 0.9)
      + arrow('M214 98Q194 132 180 104', [180, 104], -2.0),
    ),
  },
];
