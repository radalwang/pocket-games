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

// 合数：一盘数字，中间是白色的 10，上方和右边一组描了边的 9 正要合进去。X 是那个 10
const MERGE_BOARD = [
  '2413251',
  '1352614',
  '4279932',
  '368X915',
  '5147263',
  '2531824',
  '1264132',
];

function merge(game) {
  const pitch = 60;
  const size = 50;
  let out = '';
  MERGE_BOARD.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      const x = 150 + (c - 3) * pitch - size / 2;
      const y = 150 + (r - 3) * pitch - size / 2;
      if (ch === 'X') {
        out += `<rect x="${x - 3}" y="${y - 3}" width="${size + 6}" height="${size + 6}" rx="13" fill="#fff"/>
          <text x="${x + size / 2}" y="${y + size / 2}" ${BOLD} font-size="25" fill="${game.cover.ink}">10</text>`;
        return;
      }
      const picked = ch === '9';
      // 离中间越远越淡
      const far = Math.max(Math.abs(r - 3), Math.abs(c - 3));
      const fill = picked ? 0.34 : 0.26 - far * 0.05;
      out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="12" fill="#fff" fill-opacity="${fill.toFixed(2)}"${picked ? ' stroke="#fff" stroke-width="3.5"' : ''}/>
        <text x="${x + size / 2}" y="${y + size / 2}" ${BOLD} font-size="24" fill="#fff" fill-opacity="${picked ? 1 : (0.9 - far * 0.2).toFixed(2)}">${ch}</text>`;
    });
  });
  return `<g transform="rotate(8 150 150)">${out}</g>`;
}

// 汉诺塔：三根柱子，左边一摞、中间一个；最小的白色圆盘正沿虚线从中间飞向右边的终点
function hanoi() {
  const pegs = [58, 150, 242];
  const baseY = 214;
  const disc = (peg, level, w, opacity) =>
    `<rect x="${pegs[peg] - w / 2}" y="${baseY - (level + 1) * 24}" width="${w}" height="22" rx="11" fill="#fff" fill-opacity="${opacity}"/>`;
  return `<g transform="translate(150 150) rotate(-8) scale(1.12) translate(-150 -150)">
    <rect x="4" y="${baseY}" width="292" height="14" rx="7" fill="#fff" fill-opacity=".38"/>
    ${pegs.map((x) => `<rect x="${x - 5}" y="92" width="10" height="${baseY - 92}" rx="5" fill="#fff" fill-opacity=".3"/>`).join('')}
    ${disc(0, 0, 100, 0.6)}${disc(0, 1, 84, 0.5)}${disc(0, 2, 50, 0.42)}${disc(1, 0, 68, 0.48)}
    <path d="M150 128Q196 58 242 128" fill="none" stroke="#fff" stroke-opacity=".75" stroke-width="3" stroke-linecap="round" stroke-dasharray="1 9"/>
    <rect x="178" y="82" width="36" height="22" rx="11" fill="#fff"/>
  </g>`;
}

// 俄罗斯方块：底下的方块堆留了一个 T 形缺口，白色的 T 正往下落，缺口里描着它的落点，落进去就能消两行。
// 字母是堆着的方块，同一个字母深浅相同；W 是正在落的 T，G 是落点，. 是淡淡的空格子
const TETRIS_ROWS = [
  '.........',
  '...WWW...',
  '....W....',
  'a.......h',
  'abbGGGhhi',
  'accdGeiii',
  'cfddeeggj',
  'ffkkegjjj',
];
const TETRIS_SHADES = { a: 0.3, b: 0.2, c: 0.14, d: 0.34, e: 0.24, f: 0.18, g: 0.28, h: 0.22, i: 0.16, j: 0.26, k: 0.12 };

function blocks() {
  const pitch = 44;
  const size = 38;
  let out = '';
  TETRIS_ROWS.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      const x = 150 + (c - 4) * pitch - size / 2;
      const y = 150 + (r - 3.3) * pitch - size / 2;
      if (ch === '.') {
        out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="10" fill="#fff" fill-opacity=".07"/>`;
      } else if (ch === 'W') {
        out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="10" fill="#fff"/>`;
      } else if (ch === 'G') {
        out += `<rect x="${x + 2}" y="${y + 2}" width="${size - 4}" height="${size - 4}" rx="8" fill="#fff" fill-opacity=".1" stroke="#fff" stroke-opacity=".8" stroke-width="3"/>`;
      } else {
        out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="10" fill="#fff" fill-opacity="${TETRIS_SHADES[ch]}"/>`;
      }
    });
  });
  return `<g transform="rotate(-8 150 150)">${out}</g>`;
}

// 华容道：横刀立马的开局，白色的大块是曹操。同一个字母是同一个棋子，C 是曹操
const KLOTSKI_BOARD = ['ACCB', 'ACCB', 'DEEF', 'DGHF', 'I..J'];

function klotski(game) {
  const pitch = 66;
  const gap = 8;
  const boxes = new Map();
  KLOTSKI_BOARD.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch === '.') return;
      const box = boxes.get(ch) ?? { r, c };
      boxes.set(ch, { ...box, r2: r, c2: c });
    });
  });
  let out = '';
  for (const [ch, { r, c, r2, c2 }] of boxes) {
    const x = 150 + (c - 2) * pitch + gap / 2;
    const y = 150 + (r - 2.5) * pitch + gap / 2;
    const w = (c2 - c + 1) * pitch - gap;
    const h = (r2 - r + 1) * pitch - gap;
    if (ch === 'C') {
      out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="18" fill="#fff"/>
        <text x="${x + w / 2}" y="${y + h / 2}" ${BOLD} font-size="58" fill="${game.cover.ink}">曹</text>`;
    } else {
      const big = r2 > r || c2 > c;
      out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fff" fill-opacity="${big ? 0.3 : 0.18}"/>`;
    }
  }
  return `<g transform="rotate(-9 150 150)">${out}</g>`;
}

// 像素小鸟：小鸟从两根水管中间飞过，点阵和游戏里的一样。k 描边，w 白，y 身体，Y 高光，o 肚子，r 嘴
const BIRD_PIXELS = [
  '.....kkkkkk......',
  '...kkYYyykwwk....',
  '..kYYyyykwwwwk...',
  '.kyyyyyykwwwkwk..',
  'kkkkkyyykwwwkwk..',
  'kwwwwkyyykwwwwk..',
  'kwwwwwkyyykkkkkk.',
  'kywwwkyyykrrrrrrk',
  '.kkkkoooookrkkkk.',
  '..koooooookrrrrk.',
  '...kkoooooookkk..',
  '.....kkkkkk......',
];
const BIRD_COLORS = { k: '#3b2a33', w: '#fff', y: '#f8c832', Y: '#fdf2a0', o: '#f08a24', r: '#f2552c' };

function bird() {
  const px = 8;
  let pixels = '';
  BIRD_PIXELS.forEach((line, r) => {
    // 一行里连续同色的点合成一个矩形，多出 .5 盖住相邻矩形之间的细缝
    for (const run of line.matchAll(/([^.])\1*/g)) {
      pixels += `<rect x="${run.index * px}" y="${r * px}" width="${run[0].length * px + 0.5}" height="${px + 0.5}" fill="${BIRD_COLORS[run[1]]}"/>`;
    }
  });
  const pipe = (x, bodyY, bodyH, capY) => `
    <rect x="${x}" y="${bodyY}" width="64" height="${bodyH}" fill="#fff" fill-opacity=".26"/>
    <rect x="${x - 7}" y="${capY}" width="78" height="26" rx="4" fill="#fff" fill-opacity=".45"/>`;
  return `<g transform="rotate(-8 150 150)">
    ${pipe(16, 216, 140, 190)}
    ${pipe(220, -60, 160, 100)}
    <g transform="translate(150 150) rotate(-12) translate(${-8.5 * px} ${-6 * px})">${pixels}</g>
  </g>`;
}

// 倒水：一排斜放的试管，装着深浅不一的几层水；中间一管已经排好，盖上了塞子
const TUBE_LAYERS = [[0.34, 0.16, 0.5, 0.24], [0.24, 0.44], [1, 1, 1, 1], [0.5, 0.28, 0.16], [0.2, 0.44, 0.3, 0.5]];

function tubes() {
  const w = 50;
  const r = w / 2;
  const top = 46;
  const depth = 226;
  const layer = 44;
  const inset = 6;
  const glass = (x) => `<path d="M${x - r} ${top}V${top + depth - r}a${r} ${r} 0 0 0 ${w} 0V${top}" fill="none" stroke="#fff" stroke-opacity=".8" stroke-width="5" stroke-linecap="round"/>`;
  // 从下往上第 k 层水，最底下一层带着圆底
  const water = (x, k, opacity) => {
    const x0 = x - r + inset;
    const y0 = top + depth - inset - (k + 1) * layer;
    const fill = `fill="#fff" fill-opacity="${opacity}"`;
    if (k) return `<rect x="${x0}" y="${y0}" width="${w - 2 * inset}" height="${layer + 0.5}" ${fill}/>`;
    return `<path d="M${x0} ${y0}V${top + depth - r}a${r - inset} ${r - inset} 0 0 0 ${w - 2 * inset} 0V${y0}Z" ${fill}/>`;
  };
  let out = '';
  TUBE_LAYERS.forEach((opacities, k) => {
    const x = 150 + (k - 2) * 70;
    out += opacities.map((opacity, j) => water(x, j, opacity)).join('') + glass(x);
  });
  out += `<rect x="${150 - r + 9}" y="${top - 10}" width="${w - 18}" height="22" rx="5" fill="#fff"/>
    <rect x="${150 - r - 5}" y="${top - 26}" width="${w + 10}" height="20" rx="7" fill="#fff"/>`;
  return `<g transform="rotate(-12 150 150)">${out}</g>`;
}

const MOTIFS = { tiles, sudoku, mines, merge, hanoi, blocks, klotski, bird, tubes };
