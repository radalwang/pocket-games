// 全网榜单：每款单机游戏有哪几个榜、按什么排、怎么显示。榜单页、上传成绩和服务器检查成绩都用这一份。
//
// key   就是游戏 ctx.submitRecord 用的成绩键，游戏不用为榜单另外报成绩
// lower 越小越好（用时、步数）
// kind  怎么显示：score 分数、time 用时（毫秒）、steps 步数、number 合到的数、tiles 格数
// min / max 合理范围：超出的成绩服务器不收（简单防作弊，挡掉明显不可能的成绩）
//
// 这个文件服务器也会直接 import，所以只能放纯数据和纯函数，不能碰页面。

import { LEVELS as KLOTSKI } from '../games/huarongdao/levels.js';
import { LEVELS as SOKOBAN } from '../games/sokoban/levels.js';

const DAY = 24 * 60 * 60 * 1000;
const DIFFICULTY = [['easy', '初级'], ['medium', '中级'], ['hard', '高级']];

// 按难度记最快用时的游戏：fastest 是每档最快可信用时（毫秒）
const byDifficulty = (fastest) => DIFFICULTY.map(([key, label]) => ({ key, label, kind: 'time', lower: true, min: fastest[key], max: DAY }));

const score = (max) => ({ key: 'score', label: '分数', kind: 'score', min: 1, max });

export const BOARDS = {
  2048: [score(4_000_000)],
  minesweeper: byDifficulty({ easy: 1_000, medium: 3_000, hard: 5_000 }),
  sudoku: byDifficulty({ easy: 20_000, medium: 30_000, hard: 40_000 }),
  merge: [score(10_000_000), { key: 'max', label: '合到最大', kind: 'number', min: 2, max: 99 }],
  // 汉诺塔 n 层至少要搬 2^n−1 次，每次再快也要一百多毫秒
  hanoi: [3, 4, 5, 6, 7].map((n) => ({ key: `d${n}`, label: `${n} 层`, kind: 'time', lower: true, min: (2 ** n - 1) * 150, max: DAY })),
  tetris: [score(100_000_000)],
  // 华容道和推箱子每关一个榜，比谁用的步数少；关卡里的 min 是最少步数
  huarongdao: KLOTSKI.map((level) => ({ key: level.id, label: level.name, kind: 'steps', lower: true, min: level.min, max: 10_000 })),
  'pixel-bird': [score(100_000)],
  watersort: byDifficulty({ easy: 3_000, medium: 5_000, hard: 8_000 }),
  // 舒尔特 n×n 要点 n² 下
  schulte: [3, 4, 5, 6].map((n) => ({ key: `s${n}`, label: `${n}×${n}`, kind: 'time', lower: true, min: n * n * 120, max: DAY })),
  sokoban: SOKOBAN.map((level) => ({ key: level.id, label: level.name, kind: 'steps', lower: true, min: level.min, max: 10_000 })),
  jigsaw: byDifficulty({ easy: 5_000, medium: 10_000, hard: 20_000 }),
  memory: [
    { key: 'tiles', label: '经典', kind: 'tiles', min: 1, max: 64 },
    { key: 'tilesR', label: '旋转', kind: 'tiles', min: 1, max: 64 },
  ],
  raindrops: [score(10_000_000)],
};

// 只查自己的键（game 是 '__proto__' 这类原型上的名字时也返回 null）
export const boardOf = (game, key) => (Object.hasOwn(BOARDS, game) ? BOARDS[game].find((board) => board.key === key) ?? null : null);

// 成绩合不合理：整数、在范围内
export const plausible = (board, value) => Number.isInteger(value) && value >= board.min && value <= board.max;

// 新成绩比旧的好吗（旧的没有也算好）
export const beats = (board, value, best) => best === undefined || best === null || (board.lower ? value < best : value > best);

const number = (n) => Number(n).toLocaleString('zh-CN');

// 榜单上一行成绩怎么写：一分钟以内的用时精确到 0.1 秒，再长的写成 1:03
export function formatValue(board, value) {
  switch (board.kind) {
    case 'time': {
      if (value < 60_000) return `${(Math.floor(value / 100) / 10).toFixed(1)} 秒`;
      const seconds = Math.floor(value / 1000);
      return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    }
    case 'steps':
      return `${number(value)} 步`;
    case 'number':
      return `合到 ${value}`;
    case 'tiles':
      return `${value} 格`;
    default:
      return `${number(value)} 分`;
  }
}
