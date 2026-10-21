// 游戏清单：加新游戏时在这里登记一条。
// status 为 'ready' 表示可以玩；为 'soon' 时只显示封面，标「即将推出」。
// cover 决定封面：colors 是渐变的三个颜色，ink 是卡片文字区的底色，motif 是封面图案（见 covers.js）。
// formatRecord 把这个游戏的成绩（见 player.js 里的 ctx.records）变成卡片上的一行字，没有成绩时返回空字符串。

import { clock, fmt } from './ui.js';

export const categories = {
  puzzle: '益智',
  arcade: '街机',
};

// 扫雷和数独都按难度记最快用时，卡片上显示最难一档的
const LEVELS = { hard: '高级', medium: '中级', easy: '初级' };

function fastest(records) {
  const level = Object.keys(LEVELS).find((key) => records[key]);
  return level ? `${LEVELS[level]}最快 ${clock(records[level])}` : '';
}

export const games = [
  {
    id: '2048',
    title: '2048',
    tagline: '滑动合并相同数字，凑出 2048',
    category: 'puzzle',
    status: 'ready',
    keywords: ['2048'],
    cover: { colors: ['#ffb547', '#ff6a3d', '#ff2d6f'], ink: '#b4233f', motif: 'tiles' },
    formatRecord: (records) => (records.score ? `最高 ${fmt(records.score)} 分` : ''),
    load: () => import('../games/2048/index.js'),
  },
  {
    id: 'minesweeper',
    title: '扫雷',
    tagline: '根据数字推理，避开所有地雷',
    category: 'puzzle',
    status: 'ready',
    keywords: ['saolei', 'minesweeper'],
    cover: { colors: ['#30d158', '#1fb5a8', '#0a6e83'], ink: '#0b4f5e', motif: 'mines' },
    formatRecord: fastest,
    load: () => import('../games/minesweeper/index.js'),
  },
  {
    id: 'sudoku',
    title: '数独',
    tagline: '每行、每列、每宫都填入 1 到 9',
    category: 'puzzle',
    status: 'ready',
    keywords: ['shudu', 'sudoku'],
    cover: { colors: ['#5ac8fa', '#5e5ce6', '#bf5af2'], ink: '#3b2f94', motif: 'sudoku' },
    formatRecord: fastest,
    load: () => import('../games/sudoku/index.js'),
  },
  {
    id: 'merge',
    title: '合数',
    tagline: '点一组相连的相同数字合成更大的数，合到 10',
    category: 'puzzle',
    status: 'ready',
    keywords: ['heshu', 'hecheng', 'merge', '10'],
    cover: { colors: ['#ff8a5b', '#f0384f', '#a3215f'], ink: '#7d1745', motif: 'merge' },
    formatRecord: (records) => (records.max ? `最高合到 ${records.max}` : ''),
    load: () => import('../games/merge/index.js'),
  },
  {
    id: 'hanoi',
    title: '汉诺塔',
    tagline: '把整摞圆盘搬到终点，大盘不能压小盘',
    category: 'puzzle',
    status: 'ready',
    keywords: ['hannuota', 'hanoi', 'tower'],
    cover: { colors: ['#f5c242', '#e08a26', '#8f4a17'], ink: '#6e3810', motif: 'hanoi' },
    // 每种层数记最快用时（d3…d7），卡片上显示层数最多的那个
    formatRecord: (records) => {
      const n = [7, 6, 5, 4, 3].find((k) => records[`d${k}`]);
      return n ? `${n} 层最快 ${clock(records[`d${n}`])}` : '';
    },
    load: () => import('../games/hanoi/index.js'),
  },
  {
    id: 'tetris',
    title: '俄罗斯方块',
    tagline: '旋转落下的方块，填满一行就消除',
    category: 'puzzle',
    status: 'ready',
    keywords: ['eluosifangkuai', 'fangkuai', 'tetris'],
    cover: { colors: ['#ff6ad5', '#a84bff', '#3a1fa0'], ink: '#2e1a7a', motif: 'blocks' },
    formatRecord: (records) => (records.score ? `最高 ${fmt(records.score)} 分` : ''),
    load: () => import('../games/tetris/index.js'),
  },
  {
    id: 'huarongdao',
    title: '华容道',
    tagline: '挪开挡路的棋子，让曹操从出口逃走',
    category: 'puzzle',
    status: 'ready',
    keywords: ['huarongdao', 'klotski', 'caocao'],
    cover: { colors: ['#6fc3b2', '#2f7a8a', '#1f3b63'], ink: '#1f3b63', motif: 'klotski' },
    // 每关记最少用了几步（键是关卡 id），卡片上显示过了几关
    formatRecord: (records) => {
      const cleared = Object.keys(records).length;
      return cleared ? `已过 ${cleared} 关` : '';
    },
    load: () => import('../games/huarongdao/index.js'),
  },
  {
    id: 'pixel-bird',
    title: '像素小鸟',
    tagline: '点一下扑一下翅膀，从水管的缝隙中穿过去',
    category: 'arcade',
    status: 'ready',
    keywords: ['xiangsuxiaoniao', 'xiaoniao', 'flappy', 'bird'],
    cover: { colors: ['#9be7ff', '#3fb5d6', '#1d7fbf'], ink: '#155f8f', motif: 'bird' },
    formatRecord: (records) => (records.score ? `最高 ${fmt(records.score)} 分` : ''),
    load: () => import('../games/pixel-bird/index.js'),
  },
  {
    id: 'watersort',
    title: '倒水',
    tagline: '把同一种颜色的水倒进同一根管子',
    category: 'puzzle',
    status: 'ready',
    keywords: ['daoshui', 'shuipaixu', '水排序', 'watersort', 'water'],
    cover: { colors: ['#cfe83a', '#5cc65a', '#16866a'], ink: '#105f4c', motif: 'tubes' },
    formatRecord: fastest,
    load: () => import('../games/watersort/index.js'),
  },
];

export const getGame = (id) => games.find((game) => game.id === id);
