// 游戏封面：用代码画出类似专辑封面的渐变海报，不需要图片文件。
// 新游戏可以复用已有图案，也可以在 MOTIFS 里加一个新的。

const FONT = 'font-family="ui-rounded, \'SF Pro Rounded\', -apple-system, system-ui, sans-serif"';
const BOLD = `${FONT} font-weight="800" text-anchor="middle" dominant-baseline="central"`;
const SEMIBOLD = `${FONT} font-weight="600" text-anchor="middle" dominant-baseline="central"`;

// 每张封面用自己的渐变 id，避免页面上多张封面互相串色
let seq = 0;

export function cover(game) {
  const id = `cover-${++seq}`;
  const [a, b, c] = game.cover.colors;
  const motif = MOTIFS[game.cover.motif]?.(game) ?? '';
  return `<svg class="cover" viewBox="0 0 300 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="${id}-bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${a}"/><stop offset=".55" stop-color="${b}"/><stop offset="1" stop-color="${c}"/>
      </linearGradient>
      <radialGradient id="${id}-shine" cx=".82" cy=".08" r=".85">
        <stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="300" height="300" fill="url(#${id}-bg)"/>
    ${motif}
    <rect width="300" height="300" fill="url(#${id}-shine)"/>
  </svg>`;
}

// 2048：斜放的数字方块，中间一块白色的 2048
function tiles(game) {
  const numbers = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024];
  const sizes = { 1: 28, 2: 26, 3: 21, 4: 17 };
  const mod = (n, m) => ((n % m) + m) % m;
  let out = '';
  for (let r = -1; r <= 5; r++) {
    for (let c = -1; c <= 5; c++) {
      if (r === 2 && c === 2) continue;
      const x = 150 + (c - 2) * 76 - 32;
      const y = 150 + (r - 2) * 76 - 32;
      const k = mod(r * 7 + c * 3, 10);
      out += `<rect x="${x}" y="${y}" width="64" height="64" rx="14" fill="#fff" fill-opacity="${(0.08 + k * 0.022).toFixed(3)}"/>`;
      if (k % 3 === 0) {
        const n = numbers[mod(r * 3 + c * 5, 10)];
        out += `<text x="${x + 32}" y="${y + 32}" ${BOLD} font-size="${sizes[String(n).length]}" fill="#fff" fill-opacity=".9">${n}</text>`;
      }
    }
  }
  out += `<rect x="112" y="112" width="76" height="76" rx="17" fill="#fff"/>
    <text x="150" y="150" ${BOLD} font-size="23" fill="${game.cover.ink}">2048</text>`;
  return `<g transform="rotate(-14 150 150)">${out}</g>`;
}

// 数独：九宫格线条和数字，中间一格高亮
function sudoku(game) {
  const s = 36;
  const o = 150 - s * 4.5;
  let out = `
    <rect x="${o}" y="${o + 4 * s}" width="${9 * s}" height="${s}" fill="#fff" fill-opacity=".1"/>
    <rect x="${o + 4 * s}" y="${o}" width="${s}" height="${9 * s}" fill="#fff" fill-opacity=".1"/>`;
  for (let i = 0; i <= 9; i++) {
    const p = o + i * s;
    const major = i % 3 === 0;
    const line = `stroke="#fff" stroke-opacity="${major ? 0.75 : 0.3}" stroke-width="${major ? 3 : 1.2}"`;
    out += `<line x1="${p}" y1="${o}" x2="${p}" y2="${o + 9 * s}" ${line}/><line x1="${o}" y1="${p}" x2="${o + 9 * s}" y2="${p}" ${line}/>`;
  }
  const digit = (r, c) => ((r * 3 + Math.floor(r / 3) + c) % 9) + 1;
  for (let r = 0; r < 9; r++) {
    for (let c = 0; c < 9; c++) {
      if ((r === 4 && c === 4) || (r * 7 + c * 4) % 5 > 1) continue;
      out += `<text x="${o + c * s + s / 2}" y="${o + r * s + s / 2}" ${SEMIBOLD} font-size="20" fill="#fff" fill-opacity=".92">${digit(r, c)}</text>`;
    }
  }
  const h = o + 4 * s;
  out += `<rect x="${h + 3}" y="${h + 3}" width="${s - 6}" height="${s - 6}" rx="7" fill="#fff"/>
    <text x="${h + s / 2}" y="${h + s / 2}" ${BOLD} font-size="21" fill="${game.cover.ink}">${digit(4, 4)}</text>`;
  return `<g transform="translate(150 150) rotate(9) scale(1.18) translate(-150 -150)">${out}</g>`;
}

// 扫雷：一局进行到一半的棋盘。# 未翻开，. 空白，数字是周围的雷数，* 踩到的雷，F 插旗
const MINE_BOARD = [
  '#######',
  '#######',
  '##222F#',
  '##*1111',
  '##21...',
  '###1111',
  '#######',
];

function mines() {
  const pitch = 58;
  const size = 50;
  let out = '';
  MINE_BOARD.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      const x = 150 + (c - 3) * pitch - size / 2;
      const y = 150 + (r - 3) * pitch - size / 2;
      const cx = x + size / 2;
      const cy = y + size / 2;
      if (ch === '#' || ch === 'F') {
        out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="10" fill="#fff" fill-opacity=".24"/>`;
      } else {
        out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="10" fill="${ch === '*' ? '#ff453a' : '#000'}" fill-opacity="${ch === '*' ? 1 : 0.1}"/>`;
      }
      if (ch === '*') out += mine(cx, cy);
      else if (ch === 'F') out += flag(cx, cy);
      else if (/\d/.test(ch)) {
        out += `<text x="${cx}" y="${cy}" ${BOLD} font-size="24" fill="${ch === '1' ? '#fff' : '#ffe066'}">${ch}</text>`;
      }
    });
  });
  return `<g transform="rotate(-10 150 150)">${out}</g>`;
}

function mine(x, y) {
  const spikes = [0, 45, 90, 135]
    .map((angle) => `<rect x="-19" y="-2.6" width="38" height="5.2" rx="2.6" fill="#1c1c1e" transform="rotate(${angle})"/>`)
    .join('');
  return `<g transform="translate(${x} ${y})">${spikes}<circle r="12.5" fill="#1c1c1e"/><circle cx="-4.3" cy="-4.3" r="3.4" fill="#fff" fill-opacity=".85"/></g>`;
}

function flag(x, y) {
  return `<g transform="translate(${x} ${y})">
    <rect x="-1.6" y="-15" width="3.2" height="27" rx="1.6" fill="#fff"/>
    <path d="M1.6-15 17-8 1.6-1Z" fill="#ff453a"/>
    <rect x="-10" y="10.5" width="20" height="4.5" rx="2.2" fill="#fff"/>
  </g>`;
}

const MOTIFS = { tiles, sudoku, mines };
