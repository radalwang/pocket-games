// 扫雷的玩法介绍：第一次打开时由外壳弹出，格式见 js/player.js 开头

const FONT = 'font-family="ui-rounded, -apple-system, system-ui, sans-serif" font-weight="800" text-anchor="middle" dominant-baseline="central"';
const HIDDEN = '#5ccfae';
const NUMBER = { 1: '#2f8cff', 2: '#2fa84f', 3: '#ff453a' };

const svg = (body) => `<svg viewBox="0 0 300 170" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;
const tap = (x, y) => `<circle cx="${x}" cy="${y}" r="14" fill="#fff" fill-opacity=".7" stroke="#000" stroke-opacity=".15" stroke-width="1.5"/>`;

// 一格：'#' 没翻开，'F' 插旗，'.' 翻开的空白，数字是翻开后的雷数
function cell(x, y, size, kind) {
  const rx = size * 0.24;
  if (kind === '#' || kind === 'F') {
    let out = `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${rx}" fill="${HIDDEN}"/>`;
    if (kind === 'F') {
      const px = x + size * 0.36;
      out += `<rect x="${px}" y="${y + size * 0.2}" width="${size * 0.08}" height="${size * 0.58}" rx="${size * 0.04}" fill="#fff"/>`
        + `<path d="M${px + size * 0.08} ${y + size * 0.2}L${x + size * 0.8} ${y + size * 0.36}L${px + size * 0.08} ${y + size * 0.52}Z" fill="#ff3b30"/>`
        + `<rect x="${x + size * 0.22}" y="${y + size * 0.74}" width="${size * 0.36}" height="${size * 0.1}" rx="${size * 0.05}" fill="#fff"/>`;
    }
    return out;
  }
  let out = `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="${rx}" style="fill:var(--bg)"/>`;
  if (NUMBER[kind]) out += `<text x="${x + size / 2}" y="${y + size / 2}" ${FONT} font-size="${size * 0.56}" fill="${NUMBER[kind]}">${kind}</text>`;
  return out;
}

// rows 是字符串数组，每个字符一格
function grid(x, y, size, gap, rows) {
  let out = '';
  rows.forEach((line, r) => [...line].forEach((kind, c) => {
    out += cell(x + c * (size + gap), y + r * (size + gap), size, kind);
  }));
  return out;
}

function arrow(x1, y, x2) {
  return `<path d="M${x1} ${y}H${x2}M${x2 - 9} ${y - 7}L${x2} ${y}L${x2 - 9} ${y + 7}" fill="none" style="stroke:var(--label-2)" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>`;
}

export default [
  {
    title: '翻开格子',
    text: '点一下翻开格子，把所有不是雷的格子都翻开就赢了。第一下总是安全的。',
    art: svg(grid(50, 36, 30, 4, ['######', '#1..1#', '#1.2##']) + tap(133, 85)),
  },
  {
    title: '看数字',
    text: '数字表示它周围 8 格里藏着几颗雷，用它推理出雷在哪里。',
    art: svg('<rect x="80" y="15" width="140" height="140" rx="16" fill="none" style="stroke:var(--label-2)" stroke-width="2" stroke-dasharray="6 5"/>'
      + grid(85, 20, 40, 5, ['F##', '#2#', '##F'])),
  },
  {
    title: '插旗',
    text: '长按格子插上旗子，标记你认为是雷的地方。也可以切到插旗模式点按。',
    art: svg(cell(70, 45, 80, 'F')
      + '<circle cx="128" cy="108" r="24" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="3"/>'
      + tap(128, 108)
      + '<rect x="184" y="70" width="96" height="30" rx="15" style="fill:var(--fill)"/>'
      + '<rect x="232" y="72" width="46" height="26" rx="13" style="fill:var(--bg)"/>'
      + `<text x="208" y="85" ${FONT} font-weight="600" font-size="12" style="fill:var(--label-2)">翻开</text>`
      + `<text x="255" y="85" ${FONT} font-weight="600" font-size="12" style="fill:var(--label)">插旗</text>`),
  },
  {
    title: '快速翻开',
    text: '点一个周围旗子已经插够的数字，会一次翻开它周围剩下的格子。',
    art: svg(grid(40, 42, 26, 4, ['F##', '#1#', '###']) + tap(83, 85)
      + arrow(138, 85, 166)
      + grid(174, 42, 26, 4, ['F1.', '11.', '...'])),
  },
];
