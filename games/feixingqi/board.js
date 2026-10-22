// 飞行棋的棋盘：15×15 的格子。四个角是四方的机场，中间十字的四条臂上是绕圈的 52 格，
// 每条臂正中那一列是一方的终点跑道，正中间是终点。四方的布置绕中心转 90° 后完全一样，
// 所以这里只写出一方（或四分之一圈），其余的转出来。
// 只管格子在哪、什么颜色，不画图；规则（rules.js）和界面（index.js）都用它。
//
// 坐标以格子为单位：格子 (x, y) 占 x 到 x+1、y 到 y+1，中心是 (x+0.5, y+0.5)。

export const SIZE = 15;

// 顺时针四方：0 红（左上）、1 黄（右上）、2 蓝（右下）、3 绿（左下）
export const COLOR_NAMES = ['红', '黄', '蓝', '绿'];

// 绕棋盘中心顺时针转 90°：格子坐标和连续坐标各一个
const rotateCell = ([x, y]) => [SIZE - 1 - y, x];
const rotatePoint = ([x, y]) => [SIZE - y, x];

function times(rotate, item, n) {
  let out = item;
  for (let k = 0; k < n; k++) out = rotate(out);
  return out;
}

const center = ([x, y]) => [x + 0.5, y + 0.5];

// 大圈的四分之一：从上臂左列最下面往上，横过顶端，再从右列往下。转四次连起来就是顺时针的 52 格
const QUARTER = [[6, 5], [6, 4], [6, 3], [6, 2], [6, 1], [6, 0], [7, 0], [8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5]];
export const LOOP = [0, 1, 2, 3].flatMap((k) => QUARTER.map((cell) => times(rotateCell, cell, k)));

// 每方在大圈上的起点（离开起飞点后走的第一格）。从起点往后每 4 格一个同色格
export const START = [0, 1, 2, 3].map((c) => (49 + 13 * c) % LOOP.length);
export const loopColor = (i) => (i + 3) % 4;

// 终点跑道：黄方的在上臂中间一列，从外往里；其余各方转过去
const RUNWAY_YELLOW = [[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]];
export const RUNWAYS = [0, 1, 2, 3].map((c) => RUNWAY_YELLOW.map((cell) => times(rotateCell, cell, (c + 3) % 4)));

// 红方的机场（左上角）：外框、四个停机位、起飞点（紧挨着起点那一格）、到终点后停的位置；其余各方转过去
const YARD_RED = [[0.25, 0.25], [5.75, 5.75]];
const SPOTS_RED = [[2, 2], [4, 2], [2, 4], [4, 4]];
const PAD_RED = [3.5, 5.5];
const GOAL_RED = [[6.75, 7.15], [6.75, 7.85], [7.15, 7.5], [6.45, 7.5]];

const forColor = (c, point) => times(rotatePoint, point, c);

export function yardRect(c) {
  const [a, b] = YARD_RED.map((point) => forColor(c, point));
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])];
}

export const hangarSpot = (c, k) => forColor(c, SPOTS_RED[k]);
export const padSpot = (c) => forColor(c, PAD_RED);
export const goalSpot = (c, k) => forColor(c, GOAL_RED[k]);
export const loopCenter = (i) => center(LOOP[i]);
export const runwayCenter = (c, k) => center(RUNWAYS[c][k]);

// 中间终点区里每方的三角形（连续坐标的三个顶点），尖朝中心
export function goalTriangle(c) {
  return [[6, 6], [6, 9], [7.5, 7.5]].map((point) => forColor(c, point));
}
