// 雨滴的形状：下面是一个圆，上面两条切线收成一个尖。游戏里用 Path2D 画在 canvas 上，玩法介绍里直接当 SVG 路径用

// 尖到圆心的距离是半径的几倍；越大雨滴越瘦长
const TIP = 1.75;
// 切点离圆心正上方偏开的角度
const SPREAD = Math.acos(1 / TIP);

const num = (v) => String(Math.round(v * 10) / 10);

// 圆心在 (x, y)、半径 r 的一滴雨，返回 SVG 路径
export function dropPath(x, y, r) {
  const dx = r * Math.sin(SPREAD);
  const dy = r * Math.cos(SPREAD);
  return `M${num(x)} ${num(y - TIP * r)}L${num(x + dx)} ${num(y - dy)}A${num(r)} ${num(r)} 0 1 1 ${num(x - dx)} ${num(y - dy)}Z`;
}

// 雨滴最高点到圆心的距离（以半径为 1）
export const DROP_TOP = TIP;

// 题目写成一行「a op b」，摆在圆的正中。不能把两个数上下叠起来、运算符夹在中间，那样「21 − 3」看着像分数或者除法。
// 数字用粗体（700），再粗 3、5、6、8 的口就糊上了；运算符更粗（800）、大一号，两边各空一点，免得「−」看着像连在数上。
// 长的题整体缩小，宽度不超过 maxWidth（以半径为单位）：圆里面去掉白边还有约 1.88，左右各留出约 0.18 的余量
export const TEXT = {
  size: 0.54, // 短题的数字字号（以半径为单位）
  opScale: 1.12, // 运算符字号是数字的几倍
  gap: 0.18, // 运算符左右各空多宽（以数字字号为单位）
  maxWidth: 1.52,
};

// 估算宽度用的字宽（以字号为单位）：SF Rounded 粗体里最宽的数字约 0.66，运算符约 0.67。往宽了估，宁可小一点也不出圈
export const GLYPH = { digit: 0.66, op: 0.67 };
export const estimateWidth = (text, size, isOp) => [...text].length * size * (isOp ? GLYPH.op : GLYPH.digit);

// 排一道题：measure(文字, 字号, 是不是运算符) 返回宽度。返回数字和运算符的字号、
// a、运算符、b 各自左端的横坐标（相对圆心），和基线的纵坐标（让数字的上下正好以圆心为中）
export function layoutProblem({ a, op, b }, r, measure = estimateWidth) {
  const widths = (size) => {
    const wa = measure(String(a), size, false);
    const wo = measure(op, size * TEXT.opScale, true);
    const wb = measure(String(b), size, false);
    return { wa, wo, total: wa + wo + wb + 2 * TEXT.gap * size };
  };
  let size = TEXT.size * r;
  const first = widths(size);
  // 字宽和字号成正比，按比例缩一次就够；再往下取到 0.1 像素，不会超出
  if (first.total > TEXT.maxWidth * r) size = Math.floor(((size * TEXT.maxWidth * r) / first.total) * 10) / 10;
  const { wa, wo, total } = widths(size);
  const left = -total / 2;
  return {
    size,
    opSize: size * TEXT.opScale,
    width: total,
    aX: left,
    opX: left + wa + TEXT.gap * size,
    bX: left + wa + wo + 2 * TEXT.gap * size,
    // 数字高约 0.72 个字号，基线放在圆心下面一半，数字正好上下居中；运算符本来就在数字中间偏下的位置
    baseline: size * 0.36,
  };
}

// 普通雨滴和金色雨滴的颜色。四种运算符各一种浅色，在浅色、深色模式的雨滴上都看得清（对比度至少 3.5），
// 「−」和「÷」、「+」和「×」除了形状还能靠颜色分开；金色雨滴上统一用深棕色
export const COLORS = {
  drop: '#1d4f69',
  dropEdge: '#ffffff',
  ink: '#ffffff',
  ops: { '+': '#b4f5a8', '−': '#ffd770', '×': '#ffc4e3', '÷': '#d9ccff' },
  sun: ['#ffe27a', '#ffb020'],
  sunInk: '#6b3b00',
};
