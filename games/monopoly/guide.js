// 大富翁的玩法介绍：第一次打开时由外壳弹出，格式见 js/player.js 开头。插图用游戏里同样的颜色画成 SVG

import { GROUPS, SALARY, SEAT_COLORS } from './board.js';

const FONT = 'font-family="ui-rounded, -apple-system, system-ui, sans-serif" text-anchor="middle" dominant-baseline="central"';
const [RED, BLUE] = SEAT_COLORS;

const svg = (body) => `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
const text = (x, y, label, size = 11, weight = 600, style = 'fill:var(--label-2)') =>
  `<text x="${x}" y="${y}" ${FONT} font-size="${size}" font-weight="${weight}" style="${style}">${label}</text>`;

// 一格地：上面一条色带，下面是名字；owner 给了就按地主的颜色染底，houses 是盖了几层
function tile(x, y, name, group, { owner, houses = 0, w = 44, h = 52 } = {}) {
  const bg = owner ? `fill="${owner}" fill-opacity=".18"` : 'style="fill:var(--fill)"';
  let out = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="7" ${bg}/>`;
  if (group) out += `<rect x="${x + 4}" y="${y + 4}" width="${w - 8}" height="7" rx="3" fill="${GROUPS[group].color}"/>`;
  out += text(x + w / 2, y + h / 2 + 2, name, 11, 700, 'fill:var(--label)');
  for (let k = 0; k < houses; k++) out += `<path d="M${x + 11 + k * 11} ${y + h - 9}l5-5 5 5v4h-10z" fill="${owner ?? 'var(--label-2)'}"/>`;
  return out;
}

const token = (x, y, color, r = 9) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}" stroke="#fff" stroke-width="2.5"/>`;

function die(x, y, v, size = 30) {
  const pips = { 3: [0, 4, 8], 4: [0, 2, 6, 8] }[v];
  const step = size / 3.75;
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${size * 0.22}" fill="#fff" stroke="#000" stroke-opacity=".12"/>`
    + pips.map((k) => `<circle cx="${x + step * (0.9 + (k % 3))}" cy="${y + step * (0.9 + Math.floor(k / 3))}" r="${size * 0.085}" fill="#1c1c1e"/>`).join('');
}

function arrow(d, [tx, ty], [dx, dy], color = 'var(--label-2)') {
  const head = `M${tx - dx * 7 - dy * 5} ${ty - dy * 7 + dx * 5}L${tx} ${ty}L${tx - dx * 7 + dy * 5} ${ty - dy * 7 - dx * 5}`;
  return `<path d="${d} ${head}" fill="none" style="stroke:${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

function card(x, y, label, line, rotate) {
  return `<g transform="rotate(${rotate} ${x + 40} ${y + 30})">
    <rect x="${x}" y="${y}" width="80" height="60" rx="10" fill="#fff" stroke="#000" stroke-opacity=".1"/>
    ${text(x + 40, y + 18, label, 12, 800, `fill:${label === '机会' ? '#ff9f0a' : '#5e5ce6'}`)}
    ${text(x + 40, y + 40, line, 10, 600, 'fill:#3c3c43')}
  </g>`;
}

export default [
  {
    title: '掷骰子前进',
    text: `轮到你时点「掷骰子」，按点数沿着棋盘往前走。每次经过起点领 ¥${SALARY.toLocaleString('zh-CN')}。`,
    art: svg(['老街', '菜园路', '北站', '柳岸', '茶馆街'].map((name, k) => tile(14 + k * 50, 70, name, ['a', 'a', null, 'b', 'b'][k])).join('')
      + token(36, 56, RED)
      + arrow('M48 50Q140 14 232 50', [234, 52], [0.8, 0.6])
      + die(118, 128, 3) + die(156, 128, 4)),
  },
  {
    title: '买地盖房',
    text: '停在没人买的地上可以买下来。以后再停在自己的地上，可以盖一层房子，最多盖到酒店。',
    art: svg(tile(52, 46, '花市', 'c', { w: 64, h: 72 })
      + arrow('M132 82H166', [168, 82], [1, 0])
      + tile(184, 46, '花市', 'c', { owner: RED, houses: 3, w: 64, h: 72 })
      + text(84, 138, '买下') + text(216, 138, '盖到 3 栋')),
  },
  {
    title: '收过路费',
    text: '别人停在你的地上要交过路费，房子越高越贵。一整组颜色都是你的，空地的过路费翻倍。',
    art: svg(tile(118, 40, '湖滨', 'e', { owner: RED, houses: 2, w: 64, h: 72 })
      + token(170, 98, BLUE)
      + token(56, 76, RED, 12)
      + arrow('M150 124Q100 146 66 96', [64, 92], [-0.4, -0.9], '#ff9f0a')
      + text(92, 148, '交过路费', 11, 700, 'fill:#ff9f0a')
      + text(244, 76, '同色全买下', 11, 600) + text(244, 94, '空地 ×2', 13, 800, 'fill:var(--label)')),
  },
  {
    title: '机会和破产',
    text: '机会和命运会带来意外，入狱停一回合。钱不够自动变卖，还不够就破产，最后身家最高的人赢。',
    art: svg(card(34, 46, '机会', '后退 3 格', -8)
      + card(110, 52, '命运', '中了彩票', 6)
      + `<rect x="204" y="44" width="64" height="72" rx="8" style="fill:var(--fill)"/>`
      + [0, 1, 2, 3].map((k) => `<rect x="${212 + k * 14}" y="44" width="4" height="72" style="fill:var(--label-3)"/>`).join('')
      + token(236, 92, BLUE)
      + text(236, 134, '停一回合')),
  },
];
