// 华容道的规则：棋盘、棋子、走法，以及求最少步数的搜索。界面和“提示”都用它。
// 棋盘 4 列 5 行，曹操（2×2）走到最下面中间的出口就算过关。
// 一个棋子连着走（中间可以拐弯）只算一步，“横刀立马最少 81 步”就是这么算的。

export const COLS = 4;
export const ROWS = 5;
export const EXIT = { r: 3, c: 1 }; // 曹操的左上角到这里，就能从出口出去

export const DIRS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
const GENERALS = ['关羽', '张飞', '赵云', '马超', '黄忠'];
const SHAPE_KEYS = { cao: 'C', h: 'H', v: 'V', bing: 'S' };

// 格子编号；出了棋盘返回 -1
export const cellAt = (r, c) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? r * COLS + c : -1);

// 布局是 5 行字符串，同一个字母是同一个棋子，. 是空格。
// 返回棋子数组，数组下标就是棋子的 id：曹操在最前，然后是横着的、竖着的大将，最后是兵。
export function parseLayout(rows) {
  const boxes = new Map();
  rows.forEach((line, r) => {
    [...line].forEach((ch, c) => {
      if (ch === '.') return;
      const box = boxes.get(ch);
      if (box) {
        box.w = Math.max(box.w, c - box.c + 1);
        box.h = Math.max(box.h, r - box.r + 1);
      } else {
        boxes.set(ch, { r, c, w: 1, h: 1 });
      }
    });
  });

  const order = { cao: 0, h: 1, v: 2, bing: 3 };
  const pieces = [...boxes.values()]
    .map((box) => ({ ...box, kind: box.w === 2 && box.h === 2 ? 'cao' : box.w === 2 ? 'h' : box.h === 2 ? 'v' : 'bing' }))
    .sort((a, b) => order[a.kind] - order[b.kind] || a.r - b.r || a.c - b.c);

  let general = 0;
  for (const piece of pieces) {
    if (piece.kind === 'cao') piece.name = '曹操';
    else if (piece.kind === 'bing') piece.name = '兵';
    else piece.name = GENERALS[general++ % GENERALS.length];
  }
  return pieces;
}

export const isSolved = (pieces) => pieces.some((p) => p.kind === 'cao' && p.r === EXIT.r && p.c === EXIT.c);

// 每一格被哪个棋子占着，-1 表示空
export function occupancy(pieces) {
  const grid = new Int8Array(COLS * ROWS).fill(-1);
  pieces.forEach((p, id) => {
    for (let dr = 0; dr < p.h; dr++) for (let dc = 0; dc < p.w; dc++) grid[(p.r + dr) * COLS + p.c + dc] = id;
  });
  return grid;
}

function fits(grid, p, id, r, c) {
  if (r < 0 || c < 0 || r + p.h > ROWS || c + p.w > COLS) return false;
  for (let dr = 0; dr < p.h; dr++) {
    for (let dc = 0; dc < p.w; dc++) {
      const owner = grid[(r + dr) * COLS + c + dc];
      if (owner !== -1 && owner !== id) return false;
    }
  }
  return true;
}

// 别的棋子不动时，这个棋子能走到的所有位置（包括原地）。
// 返回 Map：格子编号 → { r, c, from }，from 是走过来的上一个位置的编号，用来还原路线。
export function reachable(pieces, id, grid = occupancy(pieces)) {
  const p = pieces[id];
  const start = { r: p.r, c: p.c, from: -1 };
  const spots = new Map([[cellAt(p.r, p.c), start]]);
  const queue = [start];
  for (let k = 0; k < queue.length; k++) {
    const { r, c } = queue[k];
    for (const [dr, dc] of DIRS) {
      const key = cellAt(r + dr, c + dc);
      if (key < 0 || spots.has(key) || !fits(grid, p, id, r + dr, c + dc)) continue;
      const spot = { r: r + dr, c: c + dc, from: cellAt(r, c) };
      spots.set(key, spot);
      queue.push(spot);
    }
  }
  return spots;
}

// 从起点走到 (r, c) 经过的位置，包括起点和终点：[[r, c], ...]
export function routeTo(spots, r, c) {
  const route = [];
  for (let key = cellAt(r, c); key >= 0; key = spots.get(key).from) {
    const { r: sr, c: sc } = spots.get(key);
    route.unshift([sr, sc]);
  }
  return route;
}

// 同样形状的棋子互相换位置算同一个局面，这样要搜的局面只有几万个
function shapeKey(pieces) {
  const cells = Array(COLS * ROWS).fill('.');
  for (const p of pieces) {
    for (let dr = 0; dr < p.h; dr++) for (let dc = 0; dc < p.w; dc++) cells[(p.r + dr) * COLS + p.c + dc] = SHAPE_KEYS[p.kind];
  }
  return cells.join('');
}

// 从当前局面出发，用最少的步数过关的走法：[{ id, r, c }, ...]，每一项是把某个棋子挪到某处。
// 已经过关返回 []，无解返回 null。按层搜索，先找到的就是最短的。
export function solve(start) {
  const first = start.map(({ r, c, w, h, kind }) => ({ r, c, w, h, kind }));
  const firstKey = shapeKey(first);
  const parents = new Map([[firstKey, null]]); // 局面 → { key: 上一个局面, move }
  const queue = [{ pieces: first, key: firstKey }];

  for (let k = 0; k < queue.length; k++) {
    const { pieces, key } = queue[k];
    if (isSolved(pieces)) {
      const moves = [];
      for (let at = parents.get(key); at; at = parents.get(at.key)) moves.unshift(at.move);
      return moves;
    }
    const grid = occupancy(pieces);
    pieces.forEach((p, id) => {
      for (const spot of reachable(pieces, id, grid).values()) {
        if (spot.from < 0) continue;
        const next = pieces.slice();
        next[id] = { ...p, r: spot.r, c: spot.c };
        const nextKey = shapeKey(next);
        if (parents.has(nextKey)) continue;
        parents.set(nextKey, { key, move: { id, r: spot.r, c: spot.c } });
        queue.push({ pieces: next, key: nextKey });
      }
    });
  }
  return null;
}
