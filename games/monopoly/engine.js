// 大富翁的规则引擎：给一个局面和一个动作，算出下一个局面，以及这一步发生了什么（events，界面拿来播动画、写记录）。
//
// 为了能联机，它刻意做成这样（详见同目录的 ONLINE.md）：
//   · 不碰页面、不读时间，浏览器和 node 里算出来一模一样，服务器可以直接拿它当裁判
//   · 骰子和抽卡用的随机数存在局面里（rng）：同一个种子、同一串动作，在哪台设备上都得到同一个局面
//   · 动作是普通的 JSON：{ type, by }，by 是座位号；谁能在什么时候做什么，只由 canAct 判断
//   · 联机时骰子由服务器掷：roll 动作里带着 dice: [a, b]，引擎就用这个点数，客户端没法提前算出来
//
// 局面里的钱、位置、地主都只在这里改；界面和电脑玩家只读局面、只提交动作。

import { CARDS, GROUPS, JAIL, MAX_LEVEL, SALARY, START_CASH, STATION_RENT, TILES, UTILITY_RATE, isBuyable } from './board.js';

export const RULES_VERSION = 1; // 规则改了要加一，旧存档和不同版本的联机对手就能认出来
export const ROUND_OPTIONS = [20, 40, 0]; // 一局打几轮，0 是不限，打到只剩一个人
const N = TILES.length;
const KINDS = ['human', 'ai'];

// 每个阶段能做的动作；resign（认输）任何时候都行
const PHASES = { roll: ['roll'], buy: ['buy', 'pass'], upgrade: ['upgrade', 'pass'] };

// ---------- 随机数：mulberry32，状态存在局面的 rng 里 ----------

function random(s) {
  s.rng = (s.rng + 0x6d2b79f5) | 0;
  let t = Math.imul(s.rng ^ (s.rng >>> 15), 1 | s.rng);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

const die = (s) => 1 + Math.floor(random(s) * 6);

function shuffled(s, count) {
  const order = Array.from({ length: count }, (_, i) => i);
  for (let i = count - 1; i > 0; i--) {
    const j = Math.floor(random(s) * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

// ---------- 开局 ----------

// config：{ players: [{ name, kind: 'human' | 'ai' }], rounds }。kind 是从整桌来看的，和“谁在这台设备上操作”无关（那个由 table.js 管）
export function isValidConfig(config) {
  return Boolean(config) && Array.isArray(config.players) && config.players.length >= 2 && config.players.length <= 4
    && config.players.every((p) => typeof p?.name === 'string' && p.name.length > 0 && p.name.length <= 12 && KINDS.includes(p.kind))
    && ROUND_OPTIONS.includes(config.rounds);
}

export function newGame(config, seed) {
  const s = {
    v: RULES_VERSION,
    rev: 0, // 已经执行了几个动作，联机时用来认出重复或过期的动作
    rng: seed | 0,
    rounds: config.rounds,
    round: 1,
    players: config.players.map(({ name, kind }) => ({ name, kind, cash: START_CASH, pos: 0, jail: 0, passes: 0, out: false })),
    owner: Array(N).fill(-1), // 每格的地主座位号，-1 是银行的
    level: Array(N).fill(0),
    turn: 0,
    phase: 'roll', // roll 等着掷骰子，buy / upgrade 等着决定买不买、盖不盖，over 结束
    dice: null,
    decks: null,
    winner: -1,
    ending: null, // 怎么结束的：last 只剩一人，rounds 轮数到了
  };
  s.decks = { chance: shuffled(s, CARDS.chance.length), fate: shuffled(s, CARDS.fate.length) };
  return s;
}

const validDice = (d) => Array.isArray(d) && d.length === 2 && d.every((n) => Number.isInteger(n) && n >= 1 && n <= 6);

export function canAct(s, action) {
  if (!action || !Number.isInteger(action.by) || s.phase === 'over') return false;
  const p = s.players[action.by];
  if (!p || p.out) return false;
  if (action.type === 'resign') return true;
  if (action.by !== s.turn || !PHASES[s.phase]?.includes(action.type)) return false;
  return action.dice === undefined || (action.type === 'roll' && validDice(action.dice));
}

// 执行一个动作，返回新的局面（原来的不动）和这一步发生的事
export function act(state, action) {
  if (!canAct(state, action)) throw new Error(`不能执行的动作：${JSON.stringify(action)}`);
  const s = JSON.parse(JSON.stringify(state));
  const ev = [];
  switch (action.type) {
    case 'roll':
      roll(s, ev, action.dice);
      break;
    case 'buy':
      buy(s, ev);
      finishTurn(s, ev);
      break;
    case 'upgrade':
      upgrade(s, ev);
      finishTurn(s, ev);
      break;
    case 'pass':
      ev.push({ e: 'pass', seat: s.turn, tile: s.players[s.turn].pos, upgrade: s.phase === 'upgrade' });
      finishTurn(s, ev);
      break;
    case 'resign':
      resign(s, ev, action.by);
      break;
    default:
      break;
  }
  s.rev += 1;
  return { state: s, events: ev };
}

// 从开局按动作记录重放一遍；有一步对不上就返回 null。读档和联机断线重连都靠它
export function replay(config, seed, actions) {
  if (!isValidConfig(config) || !Number.isInteger(seed) || !Array.isArray(actions)) return null;
  let s = newGame(config, seed);
  for (const action of actions) {
    if (!canAct(s, action)) return null;
    s = act(s, action).state;
  }
  return s;
}

// 局面的指纹。两边一对就知道有没有算岔（测试里用；联机现在靠动作序号连续来发现问题）
export function hashState(s) {
  const text = JSON.stringify(s);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---------- 查询 ----------

export const houseCost = (i) => GROUPS[TILES[i].group]?.house ?? 0;
export const ownsGroup = (s, seat, group) => TILES.every((t, i) => t.group !== group || s.owner[i] === seat);
const stationsOf = (s, seat) => TILES.filter((t, i) => t.type === 'station' && s.owner[i] === seat).length;

export function rentOf(s, i) {
  const tile = TILES[i];
  const owner = s.owner[i];
  if (owner < 0) return 0;
  if (tile.type === 'station') return STATION_RENT[stationsOf(s, owner) - 1];
  if (tile.type === 'utility') return UTILITY_RATE * (s.dice ? s.dice[0] + s.dice[1] : 7);
  const base = tile.rent[s.level[i]];
  return s.level[i] === 0 && ownsGroup(s, owner, tile.group) ? base * 2 : base;
}

// 身家：现金加上地和房子按买价算的钱
export function netWorth(s, seat) {
  return s.owner.reduce((sum, o, i) => (o === seat ? sum + TILES[i].price + s.level[i] * houseCost(i) : sum), s.players[seat].cash);
}

// ---------- 一回合 ----------

// 钱的进出都走这里，事件里带上变化后的余额，界面照着更新就不会错
function gain(s, ev, seat, delta) {
  if (!delta) return;
  const p = s.players[seat];
  p.cash += delta;
  ev.push({ e: 'cash', seat, delta, cash: p.cash });
}

function roll(s, ev, forced) {
  const seat = s.turn;
  s.dice = forced ?? [die(s), die(s)];
  ev.push({ e: 'dice', seat, dice: s.dice });
  walk(s, ev, seat, s.dice[0] + s.dice[1]);
  if (!land(s, ev, seat)) finishTurn(s, ev);
}

// 往前走 steps 格（负数是后退），往前走经过或停在起点领钱
function walk(s, ev, seat, steps) {
  const p = s.players[seat];
  const from = p.pos;
  p.pos = (((from + steps) % N) + N) % N;
  ev.push({ e: 'move', seat, from, to: p.pos, steps });
  if (from + steps >= N) {
    ev.push({ e: 'salary', seat });
    gain(s, ev, seat, SALARY);
  }
}

// 停下以后看这一格。要等玩家决定（买地、盖房）时返回 true
function land(s, ev, seat) {
  const p = s.players[seat];
  const i = p.pos;
  const tile = TILES[i];
  if (isBuyable(tile)) {
    const owner = s.owner[i];
    if (owner < 0) {
      if (p.cash >= tile.price) {
        s.phase = 'buy';
        return true;
      }
      ev.push({ e: 'poor', seat, tile: i });
    } else if (owner === seat) {
      if (tile.type === 'city' && s.level[i] < MAX_LEVEL) {
        if (p.cash >= houseCost(i)) {
          s.phase = 'upgrade';
          return true;
        }
        ev.push({ e: 'poor', seat, tile: i, upgrade: true });
      }
    } else {
      const amount = rentOf(s, i);
      ev.push({ e: 'rent', seat, owner, tile: i, amount });
      pay(s, ev, seat, amount, owner);
    }
    return false;
  }
  switch (tile.type) {
    case 'tax':
      ev.push({ e: 'tax', seat, tile: i, amount: tile.amount });
      pay(s, ev, seat, tile.amount, -1);
      return false;
    case 'chance':
    case 'fate':
      return draw(s, ev, seat, tile.type);
    case 'gotojail':
      toJail(s, ev, seat);
      return false;
    default:
      return false;
  }
}

function draw(s, ev, seat, deck) {
  const order = s.decks[deck];
  const k = order.shift();
  order.push(k);
  const card = CARDS[deck][k];
  const p = s.players[seat];
  ev.push({ e: 'card', seat, deck, text: card.text });
  switch (card.act) {
    case 'money':
      if (card.amount > 0) gain(s, ev, seat, card.amount);
      else pay(s, ev, seat, -card.amount, -1);
      return false;
    case 'goto':
      walk(s, ev, seat, (card.tile - p.pos + N) % N);
      return land(s, ev, seat);
    case 'station': {
      let steps = 1;
      while (TILES[(p.pos + steps) % N].type !== 'station') steps += 1;
      walk(s, ev, seat, steps);
      return land(s, ev, seat);
    }
    case 'back':
      walk(s, ev, seat, -card.steps);
      return land(s, ev, seat);
    case 'jail':
      toJail(s, ev, seat);
      return false;
    case 'pass':
      p.passes += 1;
      return false;
    case 'each':
      s.players.forEach((other, j) => {
        if (j === seat || other.out || p.out) return;
        if (card.amount > 0) pay(s, ev, j, card.amount, seat);
        else pay(s, ev, seat, -card.amount, j);
      });
      return false;
    case 'repair': {
      const levels = s.level.reduce((sum, l, i) => (s.owner[i] === seat ? sum + l : sum), 0);
      if (levels) pay(s, ev, seat, levels * card.amount, -1);
      return false;
    }
    default:
      return false;
  }
}

// 入狱：有出狱卡就用掉，没有就去监狱，下一回合停一次
function toJail(s, ev, seat) {
  const p = s.players[seat];
  if (p.passes > 0) {
    p.passes -= 1;
    ev.push({ e: 'freed', seat });
    return;
  }
  ev.push({ e: 'jail', seat, from: p.pos });
  p.pos = JAIL;
  p.jail = 1;
}

function buy(s, ev) {
  const seat = s.turn;
  const i = s.players[seat].pos;
  s.owner[i] = seat;
  ev.push({ e: 'buy', seat, tile: i, price: TILES[i].price });
  gain(s, ev, seat, -TILES[i].price);
}

function upgrade(s, ev) {
  const seat = s.turn;
  const i = s.players[seat].pos;
  s.level[i] += 1;
  ev.push({ e: 'upgrade', seat, tile: i, level: s.level[i], cost: houseCost(i) });
  gain(s, ev, seat, -houseCost(i));
}

// 付钱。钱不够先变卖，还不够就破产：手上剩的钱都给债主，地和房子还给银行
function pay(s, ev, seat, amount, creditor) {
  const p = s.players[seat];
  if (p.cash < amount) raise(s, ev, seat, amount);
  const paid = Math.min(p.cash, amount);
  gain(s, ev, seat, -paid);
  if (creditor >= 0) gain(s, ev, creditor, paid);
  if (paid === amount) return true;
  ev.push({ e: 'bankrupt', seat, creditor });
  retire(s, ev, seat);
  return false;
}

// 钱不够时自动变卖给银行：先拆房子（每层按造价的一半），再卖地（按地价的一半），都先动最便宜的
function raise(s, ev, seat, amount) {
  const p = s.players[seat];
  const mine = () => s.owner.flatMap((o, i) => (o === seat ? [i] : []));
  while (p.cash < amount) {
    const built = mine().filter((i) => s.level[i] > 0).sort((a, b) => houseCost(a) - houseCost(b) || s.level[b] - s.level[a]);
    if (built.length) {
      const i = built[0];
      s.level[i] -= 1;
      ev.push({ e: 'sell', seat, tile: i, level: s.level[i], owner: seat });
      gain(s, ev, seat, houseCost(i) / 2);
      continue;
    }
    const lots = mine().sort((a, b) => TILES[a].price - TILES[b].price);
    if (!lots.length) return;
    const i = lots[0];
    s.owner[i] = -1;
    ev.push({ e: 'sell', seat, tile: i, level: 0, owner: -1 });
    gain(s, ev, seat, TILES[i].price / 2);
  }
}

function resign(s, ev, seat) {
  ev.push({ e: 'resign', seat });
  retire(s, ev, seat);
  if (s.phase !== 'over' && s.turn === seat) finishTurn(s, ev);
}

// 出局：地和房子都还给银行；只剩一个人时游戏结束
function retire(s, ev, seat) {
  const p = s.players[seat];
  p.out = true;
  p.jail = 0;
  const tiles = s.owner.flatMap((o, i) => (o === seat ? [i] : []));
  for (const i of tiles) {
    s.owner[i] = -1;
    s.level[i] = 0;
  }
  ev.push({ e: 'retire', seat, tiles });
  if (s.players.filter((q) => !q.out).length <= 1) end(s, ev, 'last');
}

// 轮到下一位：跳过出局的人，坐牢的人这回合停一次。转回第一个座位时算新的一轮，轮数到了就结束
function finishTurn(s, ev) {
  if (s.phase === 'over') return;
  const n = s.players.length;
  let seat = s.turn;
  for (let guard = 0; guard < n * 4; guard++) {
    seat = (seat + 1) % n;
    if (seat === 0) {
      s.round += 1;
      if (s.rounds && s.round > s.rounds) {
        end(s, ev, 'rounds');
        return;
      }
      ev.push({ e: 'round', round: s.round });
    }
    const p = s.players[seat];
    if (p.out) continue;
    if (p.jail > 0) {
      p.jail -= 1;
      ev.push({ e: 'skip', seat });
      continue;
    }
    s.turn = seat;
    s.phase = 'roll';
    ev.push({ e: 'turn', seat });
    return;
  }
}

// 结束：身家最高的人赢（只剩一个人时就是他）
function end(s, ev, reason) {
  s.phase = 'over';
  s.ending = reason;
  const alive = s.players.flatMap((p, i) => (p.out ? [] : [i]));
  s.winner = alive.reduce((best, i) => (netWorth(s, i) > netWorth(s, best) ? i : best), alive[0]);
  ev.push({ e: 'over', winner: s.winner, reason });
}
