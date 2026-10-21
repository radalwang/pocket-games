// 数独的出题和求解，不涉及界面。
// 盘面是长度 81 的数组，按行从左到右、从上到下排列，0 表示空格。
// 候选数用二进制位表示：第 d 位为 1 表示还可以填 d。

const ALL = 0b1111111110; // 1 到 9 都可以填

export const rowOf = (i) => Math.floor(i / 9);
export const colOf = (i) => i % 9;
export const boxOf = (i) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3);

const CELLS = [...Array(81).keys()];
const ROWS = Array.from({ length: 9 }, (_, n) => CELLS.filter((i) => rowOf(i) === n));
const COLS = Array.from({ length: 9 }, (_, n) => CELLS.filter((i) => colOf(i) === n));
const BOXES = Array.from({ length: 9 }, (_, n) => CELLS.filter((i) => boxOf(i) === n));
const UNITS = [...ROWS, ...COLS, ...BOXES];

// 每一格所在的行、列、宫
export const UNITS_OF = CELLS.map((i) => [ROWS[rowOf(i)], COLS[colOf(i)], BOXES[boxOf(i)]]);

// 和每一格同行、同列或同宫的其他 20 格
export const PEERS = CELLS.map((i) => [...new Set(UNITS_OF[i].flat())].filter((j) => j !== i));

// 出题时挖空到剩多少个数字；singles 表示只用“唯一候选”和“唯一位置”两种方法就能解出来
export const LEVELS = {
  easy: { clues: 38, singles: true },
  medium: { clues: 30, singles: true },
  hard: { clues: 25, singles: false },
};

function bitCount(mask) {
  let n = 0;
  for (let m = mask; m; m &= m - 1) n++;
  return n;
}

const digitOf = (bit) => 31 - Math.clz32(bit);

// 某一格现在还能填哪些数字
export function candidates(grid, i) {
  let used = 0;
  for (const j of PEERS[i]) used |= 1 << grid[j];
  return ALL & ~used;
}

// 回溯求解，每次挑候选最少的格子。找到 limit 个解就停。
// 返回 { count, solution }，solution 是找到的第一个解；random 不为空时随机尝试候选，用来生成完整的终盘。
function search(puzzle, { limit, random = null }) {
  const grid = puzzle.slice();
  const rows = Array(9).fill(0);
  const cols = Array(9).fill(0);
  const boxes = Array(9).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!grid[i]) continue;
    const bit = 1 << grid[i];
    if ((rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]) & bit) return { count: 0, solution: null };
    rows[rowOf(i)] |= bit;
    cols[colOf(i)] |= bit;
    boxes[boxOf(i)] |= bit;
  }

  let count = 0;
  let solution = null;

  const step = () => {
    let best = -1;
    let bestMask = 0;
    let bestCount = 10;
    for (let i = 0; i < 81 && bestCount > 1; i++) {
      if (grid[i]) continue;
      const mask = ALL & ~(rows[rowOf(i)] | cols[colOf(i)] | boxes[boxOf(i)]);
      const n = bitCount(mask);
      if (n < bestCount) {
        best = i;
        bestMask = mask;
        bestCount = n;
      }
    }
    if (best < 0) {
      count++;
      solution ??= grid.slice();
      return count >= limit;
    }
    if (bestCount === 0) return false;

    const digits = [];
    for (let m = bestMask; m; m &= m - 1) digits.push(digitOf(m & -m));
    if (random) shuffle(digits, random);

    const r = rowOf(best);
    const c = colOf(best);
    const b = boxOf(best);
    for (const d of digits) {
      const bit = 1 << d;
      grid[best] = d;
      rows[r] |= bit;
      cols[c] |= bit;
      boxes[b] |= bit;
      if (step()) return true;
      rows[r] &= ~bit;
      cols[c] &= ~bit;
      boxes[b] &= ~bit;
    }
    grid[best] = 0;
    return false;
  };

  step();
  return { count, solution };
}

export const countSolutions = (puzzle, limit = 2) => search(puzzle, { limit }).count;

// 只用两种最基本的方法反复推：某格只剩一个候选（唯一候选），或某个数字在一行/列/宫里只剩一个位置（唯一位置）
export function solvableWithSingles(puzzle) {
  const grid = puzzle.slice();
  let empty = grid.filter((v) => !v).length;

  const findSingle = () => {
    for (let i = 0; i < 81; i++) {
      if (grid[i]) continue;
      const mask = candidates(grid, i);
      if (!mask) return null;
      if (bitCount(mask) === 1) return [i, digitOf(mask)];
    }
    for (const unit of UNITS) {
      for (let d = 1; d <= 9; d++) {
        let spot = -1;
        let spots = 0;
        for (const i of unit) {
          if (grid[i] === d) {
            spots = -1;
            break;
          }
          if (!grid[i] && candidates(grid, i) & (1 << d)) {
            spot = i;
            spots++;
          }
        }
        if (spots === 1) return [spot, d];
      }
    }
    return null;
  };

  while (empty) {
    const found = findSingle();
    if (!found) return false;
    grid[found[0]] = found[1];
    empty--;
  }
  return true;
}

function shuffle(list, random) {
  for (let k = list.length - 1; k > 0; k--) {
    const j = Math.floor(random() * (k + 1));
    [list[k], list[j]] = [list[j], list[k]];
  }
  return list;
}

// 从终盘开始，按中心对称成对地挖空；挖掉后不满足 accept 就放回去
function dig(solution, target, accept, random) {
  const puzzle = solution.slice();
  let clues = 81;
  for (const i of shuffle([...Array(41).keys()], random)) {
    if (clues <= target) break;
    const pair = i === 40 ? [40] : [i, 80 - i];
    for (const j of pair) puzzle[j] = 0;
    if (accept(puzzle)) clues -= pair.length;
    else for (const j of pair) puzzle[j] = solution[j];
  }
  return { puzzle, clues };
}

// 出一道题，返回 { puzzle, solution }。保证只有一个解。
// 挖不到目标数量时多试几个终盘，取挖得最多的那道。
export function generate(level, random = Math.random) {
  const { clues: target, singles } = LEVELS[level];
  const accept = singles ? solvableWithSingles : (puzzle) => countSolutions(puzzle) === 1;
  let best = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const { solution } = search(Array(81).fill(0), { limit: 1, random });
    const { puzzle, clues } = dig(solution, target, accept, random);
    if (!best || clues < best.clues) best = { puzzle, solution, clues };
    if (clues <= target) break;
  }
  return { puzzle: best.puzzle, solution: best.solution };
}
