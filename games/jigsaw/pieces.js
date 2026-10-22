// 拼图块的形状：相邻两块之间的每条边上随机长一个凸起，一块的凸起正好是隔壁那块的凹槽。
// 同一个 seed 总是切出一样的形状，所以存档里只要记下 seed。

// 每档切成几列几行，画板是 3:4 竖着的
export const GRIDS = { easy: [3, 4], medium: [4, 6], hard: [6, 8] };
// 凸起最多伸出去多远（以格子短边为 1），画一块时四周要留出这么宽的边
export const TAB = 0.34;

// 可以重现的随机数（mulberry32），返回 0 到 1 之间的数
export function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// 切法：每条内部边一个凸起朝向（flip）和一点随机扰动，让每个凸起长得不太一样。
// across[r][c] 是第 r 行上方那条横边（r 从 0 到 rows），down[c][r] 是第 c 列左边那条竖边；画板的外框为 null，是直边
export function cut(cols, rows, seed) {
  const rand = random(seed);
  const wiggle = (size) => (rand() - 0.5) * size;
  const jag = () => ({ flip: rand() < 0.5 ? 1 : -1, a: wiggle(0.08), b: wiggle(0.08), c: wiggle(0.06), d: wiggle(0.06), e: wiggle(0.08) });
  const across = Array.from({ length: rows + 1 }, (_, r) => Array.from({ length: cols }, () => (r > 0 && r < rows ? jag() : null)));
  const down = Array.from({ length: cols + 1 }, (_, c) => Array.from({ length: rows }, () => (c > 0 && c < cols ? jag() : null)));
  return { cols, rows, across, down };
}

// 一条边从 (x0, y0) 到 (x1, y1) 的三段贝塞尔曲线的控制点，共 10 个点。
// 沿着边的位置按边长算，凸起的形状按格子短边 s 算，长方形格子上的凸起也是圆的。
// flip 为 1 时凸起朝前进方向的左手边（横边往下、竖边往左）。
function edgePoints(x0, y0, x1, y1, jag, s) {
  if (!jag) return [[x0, y0], [x0, y0], [x1, y1], [x1, y1]];
  const length = Math.hypot(x1 - x0, y1 - y0);
  const ux = (x1 - x0) / length;
  const uy = (y1 - y0) / length;
  const { flip, a, b, c, d, e } = jag;
  const t = 0.1;
  const mid = length / 2 + b * s;
  const at = (along, side) => [x0 + ux * along - uy * side * flip * s, y0 + uy * along + ux * side * flip * s];
  return [
    at(0, 0),
    at(length * 0.2, a), at(mid + d * s, c - t), at(mid - t * s, c + t),
    at(mid - (2 * t + d) * s, c + 3 * t), at(mid + (2 * t - d) * s, c + 3 * t), at(mid + t * s, c + t),
    at(mid + d * s, c - t), at(length * 0.8, e), at(length, 0),
  ];
}

// 第 (col, row) 块的轮廓，画板坐标，格子宽 cw、高 ch。pen 可以是 canvas 的 context，
// 也可以是别的只要有 moveTo、bezierCurveTo、closePath 的东西（玩法介绍里拿它拼 SVG 路径）。
// 顺时针走一圈：上边从左到右，右边从上到下，下边从右到左，左边从下到上
export function tracePiece(pen, shape, col, row, cw, ch) {
  const s = Math.min(cw, ch);
  const x0 = col * cw;
  const y0 = row * ch;
  const x1 = x0 + cw;
  const y1 = y0 + ch;
  const sides = [
    edgePoints(x0, y0, x1, y0, shape.across[row][col], s),
    edgePoints(x1, y0, x1, y1, shape.down[col + 1][row], s),
    edgePoints(x0, y1, x1, y1, shape.across[row + 1][col], s).reverse(),
    edgePoints(x0, y0, x0, y1, shape.down[col][row], s).reverse(),
  ];
  pen.moveTo(...sides[0][0]);
  for (const points of sides) {
    for (let k = 1; k < points.length; k += 3) pen.bezierCurveTo(...points[k], ...points[k + 1], ...points[k + 2]);
  }
  pen.closePath();
}

// 外框上的块（至少有一条直边）
export const isBorder = (shape, id) => {
  const col = id % shape.cols;
  const row = Math.floor(id / shape.cols);
  return col === 0 || row === 0 || col === shape.cols - 1 || row === shape.rows - 1;
};
