// 推箱子的规则和求解：读关卡、走一步、判断过关、找推不动的死箱子，以及提示用的搜索。
// 不碰页面，浏览器和 node 里都能用；levels.js 里每关的最少步数就是用这里的 solveMoves 算出来的。
//
// 关卡用推箱子通行的文本写法：# 墙，空格 地面，. 目标点，$ 箱子，* 已经在目标点上的箱子，@ 人，+ 站在目标点上的人。
// 格子用一个数字表示：第 r 行第 c 列是 r * w + c。墙外面的空格不算地面。
// 走法记成一串字母：u d l r 是往上下左右走一格，大写的 U D L R 是这一步推着箱子。

export const DIRS = ['u', 'd', 'l', 'r'];
const VECTORS = { u: [-1, 0], d: [1, 0], l: [0, -1], r: [0, 1] };

export function parseLevel(rows) {
  const h = rows.length;
  const w = Math.max(...rows.map((row) => row.length));
  const n = w * h;
  const wall = new Uint8Array(n);
  const goal = new Uint8Array(n);
  const boxes = [];
  let player = -1;
  rows.forEach((row, r) => {
    for (let c = 0; c < w; c++) {
      const ch = row[c] ?? ' ';
      const i = r * w + c;
      if (ch === '#') wall[i] = 1;
      if (ch === '.' || ch === '*' || ch === '+') goal[i] = 1;
      if (ch === '$' || ch === '*') boxes.push(i);
      if (ch === '@' || ch === '+') player = i;
    }
  });
  const level = { w, h, wall, goal, boxes, player };
  level.delta = { u: -w, d: w, l: -1, r: 1 };
  // 从人站的地方往外找，走得到的才是地面
  level.floor = new Uint8Array(n);
  level.floor[player] = 1;
  const stack = [player];
  while (stack.length) {
    const i = stack.pop();
    for (const j of neighbors(level, i)) {
      if (!wall[j] && !level.floor[j]) {
        level.floor[j] = 1;
        stack.push(j);
      }
    }
  }
  level.goals = [];
  for (let i = 0; i < n; i++) if (goal[i] && level.floor[i]) level.goals.push(i);
  level.dead = deadCells(level);
  return level;
}

// 往四个方向走一格能到的格子（不出棋盘）
function neighbors({ w, h }, i) {
  const r = Math.floor(i / w);
  const c = i % w;
  const out = [];
  if (r > 0) out.push(i - w);
  if (r < h - 1) out.push(i + w);
  if (c > 0) out.push(i - 1);
  if (c < w - 1) out.push(i + 1);
  return out;
}

export const rowCol = (level, i) => [Math.floor(i / level.w), i % level.w];
export const isSolved = (level, boxes) => boxes.every((b) => level.goal[b]);

// 箱子一旦被推进这些格子，就再也推不到任何目标点（比如没有目标点的墙角）。
// 算法：从每个目标点出发“往回拉”箱子，拉得到的格子都是活的，剩下的地面就是死角
function deadCells(level) {
  const live = new Uint8Array(level.floor.length);
  const queue = [...level.goals];
  for (const g of queue) live[g] = 1;
  while (queue.length) {
    const b = queue.pop();
    for (const dir of DIRS) {
      const d = level.delta[dir];
      const to = b + d;
      if (level.floor[to] && level.floor[to + d] && !live[to]) {
        live[to] = 1;
        queue.push(to);
      }
    }
  }
  return level.floor.map((f, i) => (f && !live[i] ? 1 : 0));
}

// 往 dir 走一步，前面是箱子就推。走不了返回 null；否则返回新的人和箱子的位置，pushed 是被推的箱子原来在哪（没推是 -1）
export function step(level, player, boxes, dir) {
  const d = level.delta[dir];
  const to = player + d;
  if (!level.floor[to]) return null;
  const k = boxes.indexOf(to);
  if (k < 0) return { player: to, boxes, pushed: -1 };
  const beyond = to + d;
  if (!level.floor[beyond] || boxes.includes(beyond)) return null;
  const moved = boxes.slice();
  moved[k] = beyond;
  return { player: to, boxes: moved, pushed: to };
}

// 从关卡开头按走法一步步走，走不通就返回 null。存档和撤销都靠它重放
export function replay(level, path) {
  let player = level.player;
  let boxes = level.boxes.slice();
  for (const ch of path) {
    const dir = ch.toLowerCase();
    if (!VECTORS[dir]) return null;
    const next = step(level, player, boxes, dir);
    // 大写表示推了箱子，记的和实际对不上也算坏存档
    if (!next || (next.pushed >= 0) !== (ch !== dir)) return null;
    ({ player, boxes } = next);
  }
  return { player, boxes };
}

// 推完这一下，箱子是不是卡死了：推进了死角，或者和墙、别的箱子挤成 2×2 的一团（团里有没在目标点上的箱子）
export function isStuck(level, boxes, box) {
  if (level.dead[box]) return true;
  const { w } = level;
  const solid = (i) => !level.floor[i] || boxes.includes(i);
  for (const [a, b, c] of [[-1, -w, -w - 1], [1, -w, -w + 1], [-1, w, w - 1], [1, w, w + 1]]) {
    const square = [box, box + a, box + b, box + c];
    if (square.every(solid) && square.some((i) => boxes.includes(i) && !level.goal[i])) return true;
  }
  return false;
}

// 人从 from 走到 to（中间不推箱子）的最短走法，走不到返回 null
export function walkPath(level, boxes, from, to) {
  if (from === to) return '';
  if (!level.floor[to] || boxes.includes(to)) return null;
  const prev = new Map([[from, null]]);
  const queue = [from];
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head];
    for (const dir of DIRS) {
      const j = i + level.delta[dir];
      if (!level.floor[j] || prev.has(j) || boxes.includes(j)) continue;
      prev.set(j, [i, dir]);
      if (j === to) {
        let path = '';
        for (let k = to; prev.get(k); k = prev.get(k)[0]) path = prev.get(k)[1] + path;
        return path;
      }
      queue.push(j);
    }
  }
  return null;
}

// 人不推箱子能走到的所有格子，标在 seen 里；返回其中编号最小的一格，用来代表“人在这一片”
function reach(level, occupied, from, seen) {
  seen.fill(0);
  seen[from] = 1;
  const stack = [from];
  let min = from;
  while (stack.length) {
    const i = stack.pop();
    for (const dir of DIRS) {
      const j = i + level.delta[dir];
      if (level.floor[j] && !seen[j] && !occupied[j]) {
        seen[j] = 1;
        if (j < min) min = j;
        stack.push(j);
      }
    }
  }
  return min;
}

// 提示用：推箱子次数最少的解法。人在哪一片能走到的区域里都算同一个局面，所以搜得快。
// 返回每一下推的 [箱子位置, 方向]；已经无解返回 null；局面太多算不完返回 undefined
export function solvePushes(level, player, boxes, maxStates = 400000) {
  const n = level.floor.length;
  const occupied = new Uint8Array(n);
  const seen = new Uint8Array(n); // 当前局面人能走到哪
  const scratch = new Uint8Array(n); // 推完以后人能走到哪，只用来算代表格
  const keyOf = (bs, p) => `${[...bs].sort((a, b) => a - b).join(',')}:${p}`;

  boxes.forEach((b) => { occupied[b] = 1; });
  const startKey = keyOf(boxes, reach(level, occupied, player, seen));
  boxes.forEach((b) => { occupied[b] = 0; });
  if (isSolved(level, boxes)) return [];

  const parents = new Map([[startKey, null]]);
  let layer = [{ boxes, player, key: startKey }];
  while (layer.length) {
    const next = [];
    for (const state of layer) {
      state.boxes.forEach((b) => { occupied[b] = 1; });
      reach(level, occupied, state.player, seen);
      for (let k = 0; k < state.boxes.length; k++) {
        const b = state.boxes[k];
        for (const dir of DIRS) {
          const d = level.delta[dir];
          const to = b + d;
          if (!seen[b - d] || !level.floor[to] || occupied[to] || level.dead[to]) continue;
          const moved = state.boxes.slice();
          moved[k] = to;
          occupied[b] = 0;
          occupied[to] = 1;
          const stuck = isStuck(level, moved, to);
          const key = stuck ? null : keyOf(moved, reach(level, occupied, b, scratch));
          occupied[to] = 0;
          occupied[b] = 1;
          if (!key || parents.has(key)) continue;
          parents.set(key, [state.key, b, dir]);
          if (isSolved(level, moved)) {
            const pushes = [];
            for (let at = key; parents.get(at); at = parents.get(at)[0]) pushes.unshift(parents.get(at).slice(1));
            return pushes;
          }
          if (parents.size > maxStates) return undefined;
          next.push({ boxes: moved, player: b, key });
        }
      }
      state.boxes.forEach((b) => { occupied[b] = 0; });
    }
    layer = next;
  }
  return null;
}

// 走的步数最少的解法（一格算一步），返回走法字符串；算 levels.js 里的最少步数用，局面多，只在 node 里跑
export function solveMoves(level, maxStates = 20000000) {
  const keyOf = (p, bs) => `${p}:${[...bs].sort((a, b) => a - b).join(',')}`;
  const startKey = keyOf(level.player, level.boxes);
  const parents = new Map([[startKey, null]]);
  let layer = [{ player: level.player, boxes: level.boxes, key: startKey }];
  while (layer.length) {
    const next = [];
    for (const state of layer) {
      for (const dir of DIRS) {
        const moved = step(level, state.player, state.boxes, dir);
        if (!moved) continue;
        if (moved.pushed >= 0 && isStuck(level, moved.boxes, moved.pushed + level.delta[dir])) continue;
        const key = keyOf(moved.player, moved.boxes);
        if (parents.has(key)) continue;
        parents.set(key, [state.key, moved.pushed >= 0 ? dir.toUpperCase() : dir]);
        if (moved.pushed >= 0 && isSolved(level, moved.boxes)) {
          let path = '';
          for (let at = key; parents.get(at); at = parents.get(at)[0]) path = parents.get(at)[1] + path;
          return path;
        }
        if (parents.size > maxStates) return undefined;
        next.push({ ...moved, key });
      }
    }
    layer = next;
  }
  return null;
}
