// 雨滴算术的玩法介绍：第一次打开时由外壳弹出，格式见 js/player.js 开头。配图里的雨滴和游戏里同一个形状、同样的摆法

import { COLORS, dropPath, layoutProblem, TEXT } from './drop.js';

const FONT = 'ui-rounded, -apple-system, system-ui, sans-serif';
const num = (v) => String(Math.round(v * 10) / 10);
const text = (x, y, content, size, attrs, anchor = 'middle', weight = 700) =>
  `<text x="${num(x)}" y="${num(y)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${num(size)}" font-weight="${weight}" font-family="${FONT}" ${attrs}>${content}</text>`;

// 几页配图同时在页面上，id 都带上游戏名和第几页（比如 raindrops-3-sky），不会互相串
const defs = (p) => `<defs>
  <linearGradient id="${p}-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#a3e9f5"/><stop offset="1" stop-color="#3ec4d8"/></linearGradient>
  <linearGradient id="${p}-water" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1f7d98"/><stop offset="1" stop-color="#13465c"/></linearGradient>
  <linearGradient id="${p}-sun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${COLORS.sun[0]}"/><stop offset="1" stop-color="${COLORS.sun[1]}"/></linearGradient>
</defs>`;

// 第 step 页的配图；draw(p) 画内容，p 是这一页 id 的前缀
const svg = (step, draw) => {
  const p = `raindrops-${step}`;
  return `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${defs(p)}${draw(p)}</svg>`;
};

// 一块天空，底下有水；water 是水面离天空底边多高
function sky(p, x, y, w, h, water) {
  const top = y + h - water;
  let wave = `M${x} ${y + h}V${top}`;
  for (let k = 0; k <= 12; k++) wave += `L${num(x + (w * k) / 12)} ${num(top + Math.sin(k * 1.3) * 2)}`;
  return `<clipPath id="${p}-clip"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14"/></clipPath>
    <g clip-path="url(#${p}-clip)"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="url(#${p}-sky)"/>
    <path d="${wave}V${y + h}Z" fill="url(#${p}-water)"/></g>`;
}

// 一滴雨，题目和游戏里一样写成一行，运算符换颜色；faded 的画得淡一些，sun 是金色雨滴（要传这一页的前缀 p）
function drop(x, y, r, a, op, b, { sun = false, faded = false, p = '' } = {}) {
  const ink = sun ? COLORS.sunInk : COLORS.ink;
  // 字号按估算的字宽定（往宽了估），整行由浏览器居中
  const t = layoutProblem({ a, op, b }, r);
  const gap = num(TEXT.gap * t.size);
  return `<g${faded ? ' opacity=".35"' : ''}>
    <path d="${dropPath(x, y, r)}" fill="${sun ? `url(#${p}-sun)` : COLORS.drop}" stroke="#fff" stroke-width="${num(r * 0.12)}" stroke-linejoin="round"/>
    <text x="${num(x)}" y="${num(y + t.baseline)}" text-anchor="middle" font-size="${num(t.size)}" font-weight="700" font-family="${FONT}" fill="${ink}">${a}<tspan dx="${gap}" font-size="${num(t.opSize)}" font-weight="800" fill="${sun ? ink : COLORS.ops[op]}">${op}</tspan><tspan dx="${gap}">${b}</tspan></text>
  </g>`;
}

// 输入框和「确定」键
function keys(answer) {
  return `<rect x="20" y="124" width="174" height="38" rx="11" style="fill:var(--fill)"/>
    ${text(36, 143, answer, 22, 'style="fill:var(--label)"', 'start')}
    <rect x="202" y="124" width="78" height="38" rx="11" fill="#fa2d48"/>
    ${text(241, 143, '确定', 15, 'fill="#fff"', 'middle', 600)}`;
}

// 炸开的一圈小水珠
function burst(x, y, r, color = '#fff') {
  return [0, 1, 2, 3, 4, 5, 6, 7].map((k) => {
    const a = (k / 8) * Math.PI * 2;
    return `<circle cx="${num(x + Math.cos(a) * r)}" cy="${num(y + Math.sin(a) * r)}" r="2.6" fill="${color}"/>`;
  }).join('');
}

// 落进水里时往两边溅起的水花
function splash(x, y) {
  return [[-24, -4, 2.8], [-31, -12, 2.2], [-18, -14, 2], [24, -4, 2.8], [31, -12, 2.2], [18, -14, 2]]
    .map(([dx, dy, r]) => `<circle cx="${x + dx}" cy="${y + dy}" r="${r}" fill="#fff" fill-opacity=".9"/>`).join('');
}

const float = (x, y, label) => text(x, y, label, 14, 'fill="#fff" stroke="#0f4a5e" stroke-opacity=".35" stroke-width="3" paint-order="stroke"', 'middle', 800);

export default [
  {
    title: '落水前算出来',
    text: '雨滴里是一道算式。在它落进水里之前，用下面的数字键输入答案，按「确定」。',
    art: svg(1, (p) => sky(p, 20, 8, 260, 108, 16)
      + drop(98, 56, 21, 8, '+', 4) + drop(196, 70, 21, 15, '−', 6) + drop(250, 32, 14, 3, '×', 3)
      + keys('12')),
  },
  {
    title: '一次消好几滴',
    text: '答案一样的雨滴，输一次全部消掉。连着答对，分数越来越高；答错不丢命，只是连对断了。',
    art: svg(2, (p) => sky(p, 20, 8, 260, 108, 16)
      + drop(96, 64, 21, 16, '÷', 4, { faded: true }) + burst(96, 64, 30)
      + drop(200, 54, 21, 20, '÷', 5, { faded: true }) + burst(200, 54, 30)
      + float(96, 24, '+120') + float(200, 18, '+130')
      + keys('4')),
  },
  {
    title: '别让水漫上来',
    text: '漏掉一滴，水就涨一格。左边的刻度是警戒线，涨满三格这一局就结束了。',
    // 已经漏过一滴：水面在第一条刻度上，又一滴正落进水里
    art: svg(3, (p) => sky(p, 20, 8, 260, 150, 44)
      + [0, 1, 2].map((k) => `<rect x="20" y="${num(112.5 - k * 22)}" width="12" height="3" fill="#fff" fill-opacity=".85"/>`).join('')
      + drop(160, 89, 21, 9, '+', 7) + splash(160, 112)
      + [0, 1, 2].map((k) => `<path d="${dropPath(226 + k * 18, 30, 6)}" fill="#1fb3cf"${k === 2 ? ' fill-opacity=".25"' : ''}/>`).join('')),
  },
  {
    title: '金色的雨滴',
    text: '偶尔会落下金色的雨滴，答对它，屏幕上的雨滴一起消掉。分数越高，题目越难、雨也下得越快一点。',
    art: svg(4, (p) => sky(p, 20, 8, 260, 150, 18)
      + '<circle cx="150" cy="78" r="44" fill="#fff4c2" fill-opacity=".55"/>'
      + drop(64, 54, 17, 12, '−', 5, { faded: true }) + drop(236, 46, 17, 9, '×', 4, { faded: true })
      + drop(92, 112, 15, 18, '÷', 3, { faded: true }) + drop(220, 108, 15, 6, '+', 9, { faded: true })
      + drop(150, 84, 28, 6, '×', 7, { sun: true, p })),
  },
];
