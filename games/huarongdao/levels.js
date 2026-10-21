// 关卡，从易到难。layout 的写法见 rules.js 的 parseLayout，min 是最少步数。
// 左右布兵、齐头并进、指挥若定、兵分三路、横刀立马是传统布局；其余几关是用 rules.js 的搜索挑出来的新布局。
// 改了布局要重新算 min：node -e "import('./games/huarongdao/rules.js').then(({ parseLayout, solve }) => console.log(solve(parseLayout([...])).length))"

export const LEVELS = [
  { id: 'sangu', name: '三顾茅庐', min: 6, layout: ['ACDE', 'ACDE', '.BB.', 'FBBG', 'FHIJ'] },
  { id: 'chuchu', name: '初出茅庐', min: 14, layout: ['ACDE', 'AC.E', '.BBF', 'GBBF', 'GHIJ'] },
  { id: 'shezhan', name: '舌战群儒', min: 25, layout: ['AC.D', 'A.EE', 'FBBG', 'FBBG', 'HHIJ'] },
  { id: 'caochuan', name: '草船借箭', min: 38, layout: ['AACC', 'DBBE', 'DBBE', '.FFG', 'HI.J'] },
  { id: 'zuoyou', name: '左右布兵', min: 54, layout: ['ABBC', 'DBBE', 'FGHI', 'FGHI', '.JJ.'] },
  { id: 'qitou', name: '齐头并进', min: 60, layout: ['ABBC', 'ABBC', 'DEFG', 'HIIJ', 'H..J'] },
  { id: 'zhihui', name: '指挥若定', min: 70, layout: ['ABBC', 'ABBC', 'DEEF', 'GHIJ', 'G..J'] },
  { id: 'bingfen', name: '兵分三路', min: 72, layout: ['ABBC', 'DBBE', 'DFFE', 'GHIJ', 'G..J'] },
  { id: 'hengdao', name: '横刀立马', min: 81, layout: ['ABBC', 'ABBC', 'DEEF', 'DGHF', 'I..J'] },
  { id: 'guowuguan', name: '过五关', min: 123, layout: ['.BB.', 'ABBC', 'DEEF', 'DGGF', 'HIIJ'] },
];

export const getLevel = (id) => LEVELS.find((level) => level.id === id);
