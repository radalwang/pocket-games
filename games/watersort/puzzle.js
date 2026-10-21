// 倒水的规则、出题和求解，不碰界面。
// 一根管子是从下往上排的颜色编号，比如 [3, 3, 0] 表示底下两层是 3 号色、最上面一层是 0 号色。

export const CAPACITY = 4;
// 每档有几种颜色，另外总有两根空管
export const COLOR_COUNT = { easy: 5, medium: 7, hard: 10 };
const EMPTY_TUBES = 2;
// 求解时最多看这么多种局面，超过了就当解不开，换一题
const SEARCH_LIMIT = 40000;

export const top = (tube) => tube[tube.length - 1];

// 最上面连续几层是同一种颜色
export function topRun(tube) {
  let n = 0;
  while (n < tube.length && tube[tube.length - 1 - n] === top(tube)) n++;
  return n;
}

// 装满同一种颜色就算排好了，排好的管子会盖上塞子，不能再动
export const isDone = (tube) => tube.length === CAPACITY && topRun(tube) === CAPACITY;
export const isWon = (tubes) => tubes.every((tube) => !tube.length || isDone(tube));
export const canPick = (tube) => tube.length > 0 && !isDone(tube);

// 只能倒进空管，或者倒在同一种颜色的水上面
export function canPour(tubes, from, to) {
  const a = tubes[from];
  const b = tubes[to];
  return from !== to && canPick(a) && b.length < CAPACITY && (!b.length || top(b) === top(a));
}

// 顶上连续的同色水尽量倒过去，倒满为止
export const pourAmount = (tubes, from, to) => Math.min(topRun(tubes[from]), CAPACITY - tubes[to].length);

export function pour(tubes, from, to) {
  const n = pourAmount(tubes, from, to);
  for (let k = 0; k < n; k++) tubes[to].push(tubes[from].pop());
  return n;
}

// 撤销一步：把倒过去的 count 层水倒回来。记录跟现在的局面对不上（比如存档坏了）就什么也不做，返回 false
export function unpour(tubes, [from, to, count]) {
  const a = tubes[from];
  const b = tubes[to];
  if (!a || !b || from === to || count < 1 || count > topRun(b) || a.length + count > CAPACITY) return false;
  for (let k = 0; k < count; k++) a.push(b.pop());
  return true;
}

export function hasMove(tubes) {
  for (let i = 0; i < tubes.length; i++) {
    for (let j = 0; j < tubes.length; j++) if (canPour(tubes, i, j)) return true;
  }
  return false;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// 管子里最长的一段同色水
function longestRun(tube) {
  let best = 0;
  let run = 0;
  tube.forEach((color, k) => {
    run = color === tube[k - 1] ? run + 1 : 1;
    best = Math.max(best, run);
  });
  return best;
}

// 把每种颜色的 4 层水打乱分进管子里，再加两根空管；开局就有三层连在一起的不要，解不开的也不要
export function generate(level) {
  const colors = COLOR_COUNT[level];
  for (;;) {
    const units = shuffle(Array.from({ length: colors * CAPACITY }, (_, k) => Math.floor(k / CAPACITY)));
    const tubes = Array.from({ length: colors }, (_, t) => units.slice(t * CAPACITY, (t + 1) * CAPACITY));
    if (tubes.some((tube) => longestRun(tube) >= 3)) continue;
    tubes.push(...Array.from({ length: EMPTY_TUBES }, () => []));
    if (solvable(tubes)) return tubes;
  }
}

// 管子的先后顺序不影响局面，排序后当作同一种
const keyOf = (tubes) => tubes.map((tube) => tube.join('')).sort().join('|');

// 深度优先找一条解法。整管同色的水倒进空管没有意义，几根空管也只用试一根；
// 倒在同色水上的走法先试，通常很快就能找到解
export function solvable(start) {
  const seen = new Set();
  const stack = [start.map((tube) => tube.slice())];
  while (stack.length) {
    const tubes = stack.pop();
    if (isWon(tubes)) return true;
    const key = keyOf(tubes);
    if (seen.has(key)) continue;
    seen.add(key);
    if (seen.size > SEARCH_LIMIT) return false;

    const intoEmpty = [];
    const ontoColor = [];
    const firstEmpty = tubes.findIndex((tube) => !tube.length);
    tubes.forEach((tube, i) => {
      if (!canPick(tube)) return;
      tubes.forEach((target, j) => {
        if (!canPour(tubes, i, j)) return;
        if (!target.length && (j !== firstEmpty || topRun(tube) === tube.length)) return;
        const next = tubes.map((t) => t.slice());
        pour(next, i, j);
        (target.length ? ontoColor : intoEmpty).push(next);
      });
    });
    stack.push(...intoEmpty, ...ontoColor);
  }
  return false;
}
