// 大富翁的棋盘和卡牌。28 格绕一圈（手机上摆成 8×8 的一圈），四个角是起点、监狱、公园、入狱。
// 地名都是虚构的街区。价格和过路费参照经典玩法定的，再用 node 让电脑对局调过（见 engine.js 开头）。
// 只有数据，不碰页面；规则在 engine.js。

// 座位的颜色和名字（棋子、玩家卡片、地主标记、玩法介绍都用）
export const SEAT_COLORS = ['#ff3b30', '#0a84ff', '#30d158', '#ff9f0a'];
export const SEAT_NAMES = ['小红', '小蓝', '小绿', '小橙'];

export const START_CASH = 15000;
export const SALARY = 1000; // 经过或停在起点领的钱
export const JAIL = 7; // 监狱在第几格
export const MAX_LEVEL = 4; // 0 空地，1～3 栋房子，4 是酒店
export const LEVEL_NAMES = ['空地', '1 栋房子', '2 栋房子', '3 栋房子', '酒店'];

// 色组：同一组的地全买下，空地的过路费翻倍。house 是每盖一层的价钱
export const GROUPS = {
  a: { color: '#a0634a', house: 500 },
  b: { color: '#5ac8fa', house: 500 },
  c: { color: '#ff6fae', house: 1000 },
  d: { color: '#ff9f0a', house: 1000 },
  e: { color: '#ff453a', house: 1500 },
  f: { color: '#3a4fd8', house: 2000 },
};

// rent 是 0～4 级的过路费
const city = (name, group, price, rent) => ({ type: 'city', name, group, price, rent });

export const TILES = [
  { type: 'start', name: '起点' },
  city('老街', 'a', 600, [120, 600, 1800, 5400, 8000]),
  { type: 'fate', name: '命运' },
  city('菜园路', 'a', 600, [160, 800, 2400, 7200, 10000]),
  { type: 'tax', name: '所得税', amount: 2000 },
  { type: 'station', name: '北站', price: 2000 },
  city('柳岸', 'b', 1000, [200, 1000, 3000, 9000, 12000]),
  { type: 'jail', name: '监狱' },
  city('茶馆街', 'b', 1000, [200, 1000, 3000, 9000, 12000]),
  { type: 'chance', name: '机会' },
  city('书院路', 'b', 1200, [240, 1200, 3600, 10000, 14000]),
  city('花市', 'c', 1400, [300, 1500, 4400, 12000, 16000]),
  { type: 'utility', name: '电厂', price: 1500 },
  city('戏台', 'c', 1600, [360, 1800, 5200, 14000, 18000]),
  { type: 'park', name: '公园' },
  city('码头', 'd', 1800, [400, 2000, 6000, 16000, 20000]),
  { type: 'fate', name: '命运' },
  city('钟楼', 'd', 1800, [400, 2000, 6000, 16000, 20000]),
  city('古桥', 'd', 2000, [440, 2200, 6600, 17000, 22000]),
  { type: 'station', name: '南站', price: 2000 },
  city('湖滨', 'e', 2200, [500, 2500, 7200, 18000, 24000]),
  { type: 'gotojail', name: '入狱' },
  city('广场', 'e', 2200, [500, 2500, 7200, 18000, 24000]),
  city('剧院', 'e', 2400, [560, 2800, 8000, 20000, 26000]),
  { type: 'chance', name: '机会' },
  city('金融街', 'f', 3500, [800, 4000, 11000, 24000, 30000]),
  { type: 'tax', name: '奢侈税', amount: 1000 },
  city('观景台', 'f', 4000, [1000, 5000, 13000, 28000, 36000]),
];

export const STATION_RENT = [600, 1600]; // 有 1 个、2 个车站时的过路费
export const UTILITY_RATE = 50; // 电厂的过路费是骰子点数乘这个数

export const isBuyable = (tile) => tile.type === 'city' || tile.type === 'station' || tile.type === 'utility';

// 机会和命运的卡。act 决定效果：money 加减钱，goto 走到某一格（经过起点照常领钱），back 后退，
// station 走到前面最近的车站，jail 入狱，pass 得到出狱卡，each 和每位玩家收钱（负数是给钱），repair 每层房子交维修费
export const CARDS = {
  chance: [
    { text: '前进到起点', act: 'goto', tile: 0 },
    { text: '去钟楼逛逛', act: 'goto', tile: 17 },
    { text: '坐车去前面最近的车站', act: 'station' },
    { text: '走错路，后退 3 格', act: 'back', steps: 3 },
    { text: '银行发分红，得 ¥500', act: 'money', amount: 500 },
    { text: '超速被罚 ¥300', act: 'money', amount: -300 },
    { text: '得到一张出狱卡，入狱时自动用掉', act: 'pass' },
    { text: '被人举报，直接入狱', act: 'jail' },
  ],
  fate: [
    { text: '中了彩票，得 ¥1,000', act: 'money', amount: 1000 },
    { text: '过生日，每位玩家送你 ¥200', act: 'each', amount: 200 },
    { text: '生病看医生，花 ¥500', act: 'money', amount: -500 },
    { text: '房屋维修，每层房子交 ¥250', act: 'repair', amount: 250 },
    { text: '卖掉旧家具，得 ¥300', act: 'money', amount: 300 },
    { text: '请大家吃饭，给每位玩家 ¥200', act: 'each', amount: -200 },
    { text: '得到一张出狱卡，入狱时自动用掉', act: 'pass' },
    { text: '退税 ¥800', act: 'money', amount: 800 },
  ],
};
