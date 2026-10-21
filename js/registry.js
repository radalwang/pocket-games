// 游戏清单：加新游戏时在这里登记一条。
// status 为 'ready' 表示可以玩；为 'soon' 时只显示封面，标「即将推出」。
// cover 决定封面：colors 是渐变的三个颜色，ink 是卡片文字区的底色，motif 是封面图案（见 covers.js）。
// formatRecord 把这个游戏的成绩（见 player.js 里的 ctx.records）变成卡片上的一行字，没有成绩时返回空字符串。

import { clock, fmt } from './ui.js';

export const categories = {
  puzzle: '益智',
};

const MINE_LEVELS = { hard: '高级', medium: '中级', easy: '初级' };

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
    // 显示最难一档的最快用时
    formatRecord: (records) => {
      const level = Object.keys(MINE_LEVELS).find((key) => records[key]);
      return level ? `${MINE_LEVELS[level]}最快 ${clock(records[level])}` : '';
    },
    load: () => import('../games/minesweeper/index.js'),
  },
  {
    id: 'sudoku',
    title: '数独',
    tagline: '每行、每列、每宫都填入 1 到 9',
    category: 'puzzle',
    status: 'soon',
    keywords: ['shudu', 'sudoku'],
    cover: { colors: ['#5ac8fa', '#5e5ce6', '#bf5af2'], ink: '#3b2f94', motif: 'sudoku' },
  },
];

export const getGame = (id) => games.find((game) => game.id === id);
