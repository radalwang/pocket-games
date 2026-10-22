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

// 舒尔特方格：5×5 打乱的数字。1 到 4 已经找到、变淡了，虚线是眼睛找过去的路线，拐个弯落到中间白色的 5
const SCHULTE_BOARD = [
  [12, 17, 8, 24, 9],
  [20, 1, 2, 3, 22],
  [16, 19, 5, 4, 6],
  [25, 14, 23, 11, 18],
  [13, 21, 7, 15, 10],
];

function schulte(game) {
  const pitch = 64;
  const size = 54;
  const center = (r, c) => [150 + (c - 2) * pitch, 150 + (r - 2) * pitch];
  const at = {};
  let cells = '';
  SCHULTE_BOARD.forEach((row, r) => {
    row.forEach((n, c) => {
      const [cx, cy] = center(r, c);
      at[n] = `${cx} ${cy}`;
      if (n === 5) return;
      const found = n < 5;
      cells += `<rect x="${cx - size / 2}" y="${cy - size / 2}" width="${size}" height="${size}" rx="14" fill="#fff" fill-opacity="${found ? 0.1 : 0.22}"/>
        <text x="${cx}" y="${cy}" ${BOLD} font-size="24" fill="#fff" fill-opacity="${found ? 0.4 : 0.92}">${n}</text>`;
    });
  });
  const [x, y] = center(2, 2);
  return `<g transform="rotate(-8 150 150)">
    <path d="M${[1, 2, 3, 4, 5].map((n) => at[n]).join('L')}" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="1 9"/>
    ${cells}
    <rect x="${x - size / 2 - 3}" y="${y - size / 2 - 3}" width="${size + 6}" height="${size + 6}" rx="16" fill="#fff"/>
    <text x="${x}" y="${y}" ${BOLD} font-size="28" fill="${game.cover.ink}">5</text>
  </g>`;
}

// 推箱子：仓库的一角，墙和地面是半透明的方块，小人刚把白色的箱子推到圆圈上。
// # 墙，. 目标点，$ 箱子，X 推到位的箱子，@ 小人（面朝右）
const CRATE_ROOM = [
  '#######',
  '#  .  #',
  '# $#  #',
  '#  @X #',
  '#. $  #',
  '#     #',
  '#######',
];

function crates(game) {
  const pitch = 46;
  const size = 42;
  let out = '';
  CRATE_ROOM.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      const x = 150 + (c - 3) * pitch - size / 2;
      const y = 150 + (r - 3) * pitch - size / 2;
      const cx = x + size / 2;
      const cy = y + size / 2;
      out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="9" fill="#fff" fill-opacity="${ch === '#' ? 0.32 : 0.1}"/>`;
      if (ch === '.') out += `<circle cx="${cx}" cy="${cy}" r="9" fill="none" stroke="#fff" stroke-opacity=".85" stroke-width="3.5"/>`;
      if (ch === '$' || ch === 'X') {
        const done = ch === 'X';
        out += `<rect x="${x + 3}" y="${y + 3}" width="${size - 6}" height="${size - 6}" rx="8" fill="#fff" fill-opacity="${done ? 1 : 0.55}"/>
          <rect x="${x + 11}" y="${y + 11}" width="${size - 22}" height="${size - 22}" rx="4" fill="none" stroke="${done ? game.cover.ink : '#fff'}" stroke-opacity=".85" stroke-width="2.5"/>`;
      }
      if (ch === '@') {
        out += `<circle cx="${cx}" cy="${cy}" r="16" fill="#fff"/>
          <circle cx="${cx - 3}" cy="${cy - 1}" r="3.2" fill="${game.cover.ink}"/><circle cx="${cx + 8}" cy="${cy - 1}" r="3.2" fill="${game.cover.ink}"/>`;
      }
    });
  });
  return `<g transform="rotate(-8 150 150)">${out}</g>`;
}

// 拼图：斜放的一整片拼图，中间一块被拿起来挪到右上方，原来的位置空着。
// 凸起的形状左右对称，所以一条边倒着走、凸起方向反过来，画出来还是同一条边
const JIGSAW_TAB = [[0.2, 0], [0.5, -0.1], [0.4, 0.1], [0.3, 0.3], [0.7, 0.3], [0.6, 0.1], [0.5, -0.1], [0.8, 0], [1, 0]];

// 从 (x0, y0) 到 (x1, y1) 的一条边；flip 为 1 时凸起朝前进方向的左手边，为 0 是直边
function jigsawEdge(x0, y0, x1, y1, flip) {
  if (!flip) return `L${x1} ${y1}`;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const points = JIGSAW_TAB.map(([along, side]) =>
    `${(x0 + dx * along - dy * side * flip).toFixed(1)} ${(y0 + dy * along + dx * side * flip).toFixed(1)}`);
  return `C${points.slice(0, 3).join(' ')}C${points.slice(3, 6).join(' ')}C${points.slice(6).join(' ')}`;
}

function jigsaw() {
  const n = 5;
  const s = 70;
  const o = 150 - (n * s) / 2;
  // 横边、竖边上凸起朝哪边，打乱一点免得太整齐
  const across = (r, c) => (r > 0 && r < n ? ((r * 3 + c * 5) % 4 < 2 ? 1 : -1) : 0);
  const down = (r, c) => (c > 0 && c < n ? ((r * 7 + c * 3) % 4 < 2 ? 1 : -1) : 0);
  const outline = (r, c, x0, y0) => {
    const x1 = x0 + s;
    const y1 = y0 + s;
    return `M${x0} ${y0}${jigsawEdge(x0, y0, x1, y0, across(r, c))}${jigsawEdge(x1, y0, x1, y1, down(r, c + 1))}`
      + `${jigsawEdge(x1, y1, x0, y1, -across(r + 1, c))}${jigsawEdge(x0, y1, x0, y0, -down(r, c))}Z`;
  };
  let out = '';
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const d = outline(r, c, o + c * s, o + r * s);
      out += r === 2 && c === 2
        ? `<path d="${d}" fill="#000" fill-opacity=".14"/>`
        : `<path d="${d}" fill="#fff" fill-opacity="${(0.1 + ((r * 5 + c * 3) % 5) * 0.05).toFixed(2)}" stroke="#fff" stroke-opacity=".5" stroke-width="2.5" stroke-linejoin="round"/>`;
    }
  }
  const lifted = outline(2, 2, o + 2 * s + 30, o + 2 * s - 36);
  out += `<path d="${lifted}" fill="#000" fill-opacity=".16" transform="translate(5 9)"/><path d="${lifted}" fill="#fff"/>`;
  return `<g transform="rotate(-10 150 150)">${out}</g>`;
}

// 记忆方格：深色的方格里亮着几格薄荷绿，外面一圈淡淡的光
const MEMORY_LIT = [3, 6, 12, 14, 15, 23];

function memory() {
  const pitch = 52;
  const size = 44;
  let out = '';
  for (let i = 0; i < 25; i++) {
    const x = 150 + ((i % 5) - 2) * pitch - size / 2;
    const y = 150 + (Math.floor(i / 5) - 2) * pitch - size / 2;
    if (MEMORY_LIT.includes(i)) {
      out += `<rect x="${x - 5}" y="${y - 5}" width="${size + 10}" height="${size + 10}" rx="14" fill="#4fe3c1" fill-opacity=".22"/>
        <rect x="${x}" y="${y}" width="${size}" height="${size}" rx="10" fill="#4fe3c1"/>`;
    } else {
      out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="10" fill="#fff" fill-opacity=".12"/>`;
    }
  }
  return `<g transform="rotate(-8 150 150)">${out}</g>`;
}

// 雨滴算术：斜斜落下的一场雨，中间一颗大白雨滴里是一道竖着写的加法，底下是起伏的水面
function rain(game) {
  // 圆心 (x, y)、半径 r 的雨滴：下面是圆，上面收成尖（和游戏里 drop.js 的形状一样）
  const drop = (x, y, r) => `M${x} ${(y - 1.75 * r).toFixed(1)}L${(x + 0.821 * r).toFixed(1)} ${(y - 0.571 * r).toFixed(1)}`
    + `A${r} ${r} 0 1 1 ${(x - 0.821 * r).toFixed(1)} ${(y - 0.571 * r).toFixed(1)}Z`;
  let out = '';
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < 7; col++) {
      const x = col * 58 + (row % 2) * 29 - 24;
      const y = row * 60 - 20;
      if (Math.abs(x - 150) < 62 && Math.abs(y - 150) < 80) continue;
      const k = (row * 5 + col * 3) % 5;
      out += `<path d="${drop(x, y, 8 + k * 1.5)}" fill="#fff" fill-opacity="${(0.14 + k * 0.05).toFixed(2)}"/>`;
    }
  }
  const wave = (top, amp, opacity) => {
    let d = `M-60 360V${top}`;
    for (let x = -60; x <= 360; x += 20) d += `L${x} ${(top + Math.sin(x / 34) * amp).toFixed(1)}`;
    return `<path d="${d}V360Z" fill="#fff" fill-opacity="${opacity}"/>`;
  };
  // 题目排成一行，和游戏里一样；竖着叠会让“−”看起来像“÷”
  out += `${wave(262, 7, 0.16)}${wave(276, 6, 0.2)}
    <path d="${drop(150, 168, 54)}" fill="#fff"/>
    <text x="150" y="172" ${BOLD} font-size="34" fill="${game.cover.ink}">7<tspan dx="6" font-size="38" fill="#1a8f4c">+</tspan><tspan dx="6">8</tspan></text>`;
  return `<g transform="rotate(-6 150 150)">${out}</g>`;
}

// 大富翁：一圈地（有几块深一点，是有人买下的），中间两颗白色的骰子
function monopoly(game) {
  const pitch = 50;
  const size = 44;
  let out = '';
  for (let r = 0; r < 6; r++) {
    for (let c = 0; c < 6; c++) {
      if (r > 0 && r < 5 && c > 0 && c < 5) continue;
      const x = 150 + (c - 2.5) * pitch - size / 2;
      const y = 150 + (r - 2.5) * pitch - size / 2;
      out += `<rect x="${x}" y="${y}" width="${size}" height="${size}" rx="9" fill="#fff" fill-opacity="${(r * 6 + c) % 4 === 1 ? 0.34 : 0.15}"/>`;
    }
  }
  const die = (cx, cy, pips, angle) => `<g transform="rotate(${angle} ${cx} ${cy})">
    <rect x="${cx - 31}" y="${cy - 31}" width="62" height="62" rx="14" fill="#fff"/>
    ${pips.map((k) => `<circle cx="${cx + ((k % 3) - 1) * 18}" cy="${cy + (Math.floor(k / 3) - 1) * 18}" r="6" fill="${game.cover.ink}"/>`).join('')}
  </g>`;
  out += die(124, 138, [0, 2, 4, 6, 8], -12) + die(182, 168, [0, 4, 8], 14);
  return `<g transform="rotate(-8 150 150)">${out}</g>`;
}

// 飞行棋：斜放的一张棋盘，四色的格子绕成十字、四角是机场，一架描白边的大红飞机从中间往右上飞出去，身后拖一条虚线。
// 底色很浅，飞机要是白的就看不清，所以用红色
const FLIGHT_COLORS = ['#ff6b5f', '#ffc928', '#3d9bff', '#3fcf6e'];
const FLIGHT_TINTS = ['#ffd9d4', '#ffefb8', '#d3e6ff', '#cff3dc'];
const FLIGHT_PLANE = 'M0 -0.5C0.07 -0.5 0.09 -0.4 0.09 -0.3L0.09 -0.1L0.48 0.12L0.48 0.22L0.09 0.12L0.07 0.32L0.22 0.42L0.22 0.5L0 0.45L-0.22 0.5L-0.22 0.42L-0.07 0.32L-0.09 0.12L-0.48 0.22L-0.48 0.12L-0.09 -0.1L-0.09 -0.3C-0.09 -0.4 -0.07 -0.5 0 -0.5Z';

function flight() {
  const s = 24;
  const o = 150 - 7.5 * s;
  const at = (v) => o + v * s;
  let out = '';
  // 四角的机场：红、黄、蓝、绿顺时针
  [[0, 0], [9, 0], [9, 9], [0, 9]].forEach(([x, y], c) => {
    out += `<rect x="${at(x) + 4}" y="${at(y) + 4}" width="${6 * s - 8}" height="${6 * s - 8}" rx="16" fill="${FLIGHT_TINTS[c]}"/>`;
    for (const [dx, dy] of [[2, 2], [4, 2], [2, 4], [4, 4]]) out += `<circle cx="${at(x + dx)}" cy="${at(y + dy)}" r="${s * 0.55}" fill="#fff"/>`;
  });
  // 十字上的格子：中间一列（行）是跑道，用那一方的浅色；其余的四色轮流
  const arm = (x, y) => (y < 6 ? 1 : y > 8 ? 3 : x < 6 ? 0 : 2);
  for (let y = 0; y < 15; y++) {
    for (let x = 0; x < 15; x++) {
      const inCross = (x >= 6 && x <= 8) !== (y >= 6 && y <= 8);
      if (!inCross) continue;
      const runway = (x === 7 || y === 7) && x > 0 && x < 14 && y > 0 && y < 14;
      const fill = runway ? FLIGHT_TINTS[arm(x, y)] : FLIGHT_COLORS[(x + y) % 4];
      out += `<rect x="${at(x) + 1.5}" y="${at(y) + 1.5}" width="${s - 3}" height="${s - 3}" rx="5" fill="${fill}"/>`;
    }
  }
  // 中间的终点：四个三角形
  [[[6, 6], [6, 9]], [[6, 6], [9, 6]], [[9, 6], [9, 9]], [[6, 9], [9, 9]]].forEach(([[x1, y1], [x2, y2]], c) => {
    out += `<path d="M${at(x1)} ${at(y1)}L${at(x2)} ${at(y2)}L${at(7.5)} ${at(7.5)}Z" fill="${FLIGHT_COLORS[c]}"/>`;
  });
  out += `<path d="M70 236Q120 210 150 150" fill="none" stroke="${FLIGHT_COLORS[0]}" stroke-opacity=".7" stroke-width="7" stroke-linecap="round" stroke-dasharray="2 14"/>
    <path d="${FLIGHT_PLANE}" transform="translate(160 130) rotate(40) scale(150)" fill="#000" fill-opacity=".16"/>
    <path d="${FLIGHT_PLANE}" transform="translate(152 120) rotate(40) scale(150)" fill="#ff3b30" stroke="#fff" stroke-width=".035" stroke-linejoin="round"/>`;
  return `<g transform="rotate(-10 150 150)">${out}</g>`;
}

const MOTIFS = { tiles, sudoku, mines, merge, hanoi, blocks, klotski, bird, tubes, schulte, crates, jigsaw, memory, rain, monopoly, flight };
