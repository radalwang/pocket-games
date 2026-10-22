// 雨滴算术的规则：出题和难度都只看分数，分数越高雨下得越快、题越难、每滴值的分越多。
// 都是随分数一点一点涨，没有台阶，也没有尽头（只是越往后涨得越慢）。不碰界面。
// 题目的答案都是非负整数，最多三位数：减法不出负数，除法都能除尽；算式两边加起来最多四位数字，一行写得下。

export const OPS = ['+', '−', '×', '÷'];

// 速度和分值的难度曲线：0 分时是 0，越往后越接近 1，但永远到不了
const heat = (score) => 1 - Math.exp(-Math.max(0, score) / 10000);
// 题目的范围从 from 分到 to 分匀速放宽，之后不再变
const ramp = (score, from, to) => Math.min(1, Math.max(0, (score - from) / (to - from)));

// 雨滴从天上落到水面要几秒、隔几秒下一滴、屏幕上最多同时几滴
export const fallSeconds = (score) => 7 + 4.5 * (1 - heat(score));
export const spawnSeconds = (score) => 1.6 + 1.4 * (1 - heat(score));
export const maxDrops = (score) => 4 + Math.round(3 * heat(score));

// 答对一滴得多少分：分数越高越多，连着答对每次再多一成，最多翻倍；取整到 10
export function pointsFor(score, combo) {
  const bonus = 1 + Math.min(combo, 10) * 0.1;
  return Math.round(((100 + 120 * heat(score)) * bonus) / 10) * 10;
}

// 这个分数下的题：加减法的和（被减数）最大多少；乘法两个因数的上限；除法的除数、商的上限；
// weights 是加、减、乘、除各自出现的比重，乘法和除法是慢慢多起来的
function rangesFor(score) {
  return {
    sum: Math.round(10 + 89 * ramp(score, 0, 14000)),
    mul: [Math.round(4 + 8 * ramp(score, 1500, 14000)), Math.round(4 + 5 * ramp(score, 1500, 9000))],
    div: [Math.round(4 + 5 * ramp(score, 3500, 9000)), Math.round(4 + 8 * ramp(score, 3500, 14000))],
    weights: [3, 2 + ramp(score, 0, 1500), 3 * ramp(score, 1500, 3500), 3 * ramp(score, 3500, 5500)],
  };
}

const between = (lo, hi, rand) => lo + Math.floor(rand() * (hi - lo + 1));

function pick(weights, rand) {
  let x = rand() * weights.reduce((sum, w) => sum + w, 0);
  for (let k = 0; k < weights.length; k++) {
    x -= weights[k];
    if (x < 0) return k;
  }
  return 0;
}

// 出一道题：{ a, b, op, answer }，写成一行「a op b」
export function makeProblem(score, rand = Math.random) {
  const { sum, mul, div, weights } = rangesFor(score);
  const op = OPS[pick(weights, rand)];
  if (op === '+') {
    const a = between(1, sum - 1, rand);
    const b = between(1, sum - a, rand);
    return { a, b, op, answer: a + b };
  }
  if (op === '−') {
    const a = between(2, sum, rand);
    const b = between(1, a - 1, rand);
    return { a, b, op, answer: a - b };
  }
  if (op === '×') {
    const a = between(2, mul[0], rand);
    const b = between(1, mul[1], rand);
    return { a, b, op, answer: a * b };
  }
  const b = between(2, div[0], rand);
  const answer = between(1, div[1], rand);
  return { a: b * answer, b, op, answer };
}

// 算出 a op b；不是能出的题（不是非负整数、除不尽、得负数、超过三位数）就返回 null。读存档时用它重新核对答案
export function solve(a, op, b) {
  if (![a, b].every((v) => Number.isInteger(v) && v >= 0)) return null;
  let answer = null;
  if (op === '+') answer = a + b;
  else if (op === '−') answer = a - b;
  else if (op === '×') answer = a * b;
  else if (op === '÷' && b > 0 && a % b === 0) answer = a / b;
  return answer !== null && answer >= 0 && answer <= 999 ? answer : null;
}
