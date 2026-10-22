// 拼图的玩法介绍：第一次打开时由外壳弹出，格式见 js/player.js 开头。
// 配图里的拼图块用游戏里同样的切法画，块上的画面是一张简化的「落日群山」

import { EDGES, EYE, PICTURE } from './icons.js';
import { cut, tracePiece } from './pieces.js';

const FONT = 'ui-rounded, -apple-system, system-ui, sans-serif';
const SHAPE = cut(3, 4, 7);
const num = (v) => String(Math.round(v * 10) / 10);
const text = (x, y, content, size, style) =>
  `<text x="${x}" y="${y}" text-anchor="middle" font-size="${size}" font-weight="600" font-family="${FONT}" ${style}>${content}</text>`;

// 第 n 步的配图。几页配图同时在页面上，id 都带上 jigsaw-n 的前缀（下面的 p），免得重名
function art(n, draw) {
  const p = `jigsaw-${n}`;
  return `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><defs><linearGradient id="${p}-sky" x1="0" y1="0" x2="0" y2="1">
  <stop offset="0" stop-color="#3b2a7a"/><stop offset=".6" stop-color="#ef6f7f"/><stop offset="1" stop-color="#ffc07a"/>
</linearGradient></defs>${draw(p)}</svg>`;
}

// 整张小画，3×4 格、每格 cell 大
function scene(p, cell) {
  const w = cell * 3;
  const h = cell * 4;
  return `<rect width="${w}" height="${h}" fill="url(#${p}-sky)"/>
    <circle cx="${num(w * 0.62)}" cy="${num(h * 0.5)}" r="${num(w * 0.17)}" fill="#ffe08a"/>
    <path d="M0 ${num(h * 0.7)}L${num(w * 0.25)} ${num(h * 0.47)}L${num(w * 0.45)} ${num(h * 0.64)}L${num(w * 0.7)} ${num(h * 0.42)}L${w} ${num(h * 0.68)}V${h}H0Z" fill="#6a3480"/>
    <rect y="${num(h * 0.8)}" width="${w}" height="${num(h * 0.2)}" fill="#341f55"/>`;
}

// 第 (col, row) 块的 SVG 路径，坐标是整张小画里的位置
function piecePath(col, row, cell) {
  let d = '';
  tracePiece({
    moveTo: (x, y) => {
      d += `M${num(x)} ${num(y)}`;
    },
    bezierCurveTo: (...points) => {
      d += `C${points.map(num).join(' ')}`;
    },
    closePath: () => {
      d += 'Z';
    },
  }, SHAPE, col, row, cell, cell);
  return d;
}

// 一块拼图，格子左上角放在 (x, y)；key 用来给裁剪路径起名（同一步里不重复），lifted 的带投影
function piece(p, key, col, row, cell, x, y, lifted = false) {
  const id = `${p}-${key}`;
  const d = piecePath(col, row, cell);
  const shadow = lifted ? `<path d="${d}" fill="#000" fill-opacity=".22" transform="translate(2 5)"/>` : '';
  return `<g transform="translate(${num(x - col * cell)} ${num(y - row * cell)})">${shadow}
    <clipPath id="${id}"><path d="${d}"/></clipPath>
    <g clip-path="url(#${id})">${scene(p, cell)}</g>
    <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.2"/>
  </g>`;
}

// 画板：底色、可选的淡底图、已经拼好的块（[col, row]）、一个虚线的空位
function board(p, x, y, cell, placed, { ghost = false, slot } = {}) {
  let out = `<rect x="${x}" y="${y}" width="${cell * 3}" height="${cell * 4}" rx="3" style="fill:var(--fill)"/>`;
  if (ghost) out += `<g transform="translate(${x} ${y})" opacity=".3">${scene(p, cell)}</g>`;
  out += placed.map(([col, row], k) => piece(p, k, col, row, cell, x + col * cell, y + row * cell)).join('');
  if (slot) {
    out += `<path d="${piecePath(slot[0], slot[1], cell)}" transform="translate(${x} ${y})" fill="none" style="stroke:var(--label-2)" stroke-width="1.5" stroke-dasharray="4 3"/>`;
  }
  return out;
}

function tray(x, y, w, h) {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="12" style="fill:var(--fill)"/>`;
}

function arrow(d, end, angle) {
  const head = (a) => `${num(end[0] - 9 * Math.cos(angle + a))} ${num(end[1] - 9 * Math.sin(angle + a))}`;
  const line = 'fill="none" style="stroke:var(--label-2)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"';
  return `<path d="${d}" ${line} stroke-dasharray="5 5"/><path d="M${head(0.5)}L${end[0]} ${end[1]}L${head(-0.5)}" ${line}/>`;
}

// 工具栏上的按钮：图标、名字，开关类的带个角标
function tool(icon, x, y, label, badge) {
  let out = `<g style="color:var(--label-2)">${icon.replace('<svg ', `<svg x="${x - 13}" y="${y}" width="26" height="26" `)}</g>`;
  out += text(x, y + 44, label, 12, 'style="fill:var(--label-2)"');
  if (badge) out += `<rect x="${x + 6}" y="${y - 4}" width="18" height="14" rx="7" fill="#6e6e73"/>${text(x + 15, y + 6.5, badge, 10, 'fill="#fff"')}`;
  return out;
}

// 选图页的小缩略图，每张用两种颜色示意
const THUMBS = [['#7b2f86', '#ffbe7a'], ['#3fa9f5', '#0b3f86'], ['#6cc6ff', '#7ccc5c'], ['#0a1238', '#a24f97'], ['#3d9df5', '#ffc400'], ['#070b24', '#6a3ad0']];

export default [
  {
    title: '拖到画板上',
    text: '从下面的托盘里拖出一块，放到它在画上的位置，靠近了就会自动吸住。',
    art: art(1, (p) =>
      board(p, 34, 16, 34, [[0, 0], [1, 0], [2, 0], [0, 1], [0, 2]], { slot: [1, 1] })
      + tray(166, 118, 118, 42)
      + piece(p, 't1', 2, 3, 15, 180, 128) + piece(p, 't2', 1, 2, 15, 214, 128) + piece(p, 't3', 2, 2, 15, 248, 128)
      + piece(p, 'drag', 1, 1, 34, 150, 44, true)
      + arrow('M200 116Q196 96 186 86', [186, 86], -2.1)
      + arrow('M146 60Q122 58 104 56', [104, 56], Math.PI),
    ),
  },
  {
    title: '先放一放也行',
    text: '没想好放哪的块，可以先随手放在画板上，之后再挪；拖回托盘就收起来了。',
    art: art(2, (p) =>
      board(p, 34, 16, 34, [[0, 0], [1, 0], [2, 0], [0, 1], [1, 1], [0, 2], [0, 3]])
      + piece(p, 'l1', 2, 2, 34, 92, 90, true) + piece(p, 'l2', 1, 3, 34, 196, 26, true)
      + tray(166, 118, 118, 42)
      + piece(p, 't1', 2, 1, 15, 196, 128)
      + arrow('M226 72Q246 92 236 116', [236, 116], 1.8),
    ),
  },
  {
    title: '对照原图',
    text: '画板上有淡淡的原图可以对照，也能关掉。按住眼睛按钮能看清整张图，「只看边缘」可以先拼外框。',
    art: art(3, (p) =>
      board(p, 34, 16, 34, [[0, 0], [1, 0], [0, 1]], { ghost: true })
      + tool(PICTURE, 196, 18, '底图', '开') + tool(EYE, 256, 18, '按住看原图') + tool(EDGES, 226, 96, '只看边缘', '关'),
    ),
  },
  {
    title: '换一张图',
    text: '点「换图」挑一张内置的插画，也可以从相册选一张照片来拼。每种难度都记下最快用时。',
    art: art(4, (p) =>
      THUMBS.map(([top, bottom], k) => {
        const x = 12 + k * 41;
        return `<linearGradient id="${p}-${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>`
          + `<rect x="${x}" y="22" width="35" height="47" rx="7" fill="url(#${p}-${k})"/>`;
      }).join('')
      + '<rect x="258" y="22" width="35" height="47" rx="7" fill="#fa2d48" fill-opacity=".1" stroke="#fa2d48" stroke-opacity=".5" stroke-width="1.5"/>'
      + '<path d="M275.5 37v17M267 45.5h17" stroke="#fa2d48" stroke-width="2.5" stroke-linecap="round"/>'
      + text(150, 98, '最快用时', 11, 'style="fill:var(--label-2)"')
      + [['初级', '1:12'], ['中级', '3:40'], ['高级', '9:05']].map(([level, time], k) => {
        const x = 54 + k * 96;
        return `<rect x="${x - 44}" y="108" width="88" height="30" rx="15" style="fill:var(--fill)"/>`
          + text(x, 128, `${level} ${time}`, 13, 'style="fill:var(--label)"');
      }).join(''),
    ),
  },
];
