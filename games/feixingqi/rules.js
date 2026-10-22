// 飞行棋的规则（经典玩法）。只有纯数据和纯函数：不碰界面，也不用随机数。
// 骰子的点数写在动作里传进来，所以同样的开局设置 + 同样的动作，在哪台设备上算都得到同样的局面，
// 存档和以后联机都靠这一点（见 match.js）。
//
// 开局设置 config：
//   { rules: 规则版本, planes: 每方几架飞机（4 或 2）, first: 谁先走（players 的下标）,
//     players: [{ color: 0–3, name }] }，players 按顺时针排，也就是走棋顺序。
//   每方由谁来下（本机的人、电脑、别的设备）不在这里，那是各台设备自己的事，见 match.js
// 动作：{ type: 'roll', seat, value: 1–6 } 掷骰子，{ type: 'move', seat, plane } 走哪架飞机；seat 是 players 的下标
//
// 一架飞机的位置用相对步数 p 表示：-1 在机场，0 在起飞点，1–49 绕大圈（1 是自己的起点，49 是自己跑道的入口），
// 50–54 是终点跑道，55 是终点。
//
// 规则：
// - 掷到 6 才能起飞（从机场到起飞点）；掷到 6 走完还能再掷一次，同一轮连掷三次 6，这一轮作废
// - 停在自己颜色的格子，往前跳 4 格到下一个同色格；停在自己的飞行格（第 17 格），顺着虚线飞到第 29 格。
//   先跳后飞、先飞后跳都可以，各一次
// - 停在有别人飞机的格子，把那里的飞机都撞回机场；飞行时虚线横穿对面那一方跑道的最后一格，停在那里的飞机也被撞回去
// - 自己的飞机可以叠在同一格
// - 进终点要正好，多出的步数往回退；自己的飞机全部到终点就赢了，这一局结束

import { LOOP, START } from './board.js';

export const RULES_VERSION = 1;
export const HANGAR = -1;
export const TAKEOFF = 0;
export const LAST_LOOP = 49;
export const GOAL = 55;
export const JUMP = 4;
export const FLY_FROM = 17;
export const FLY_TO = 29;
// 飞行虚线横穿的是对面那一方（颜色 +2）跑道的最后一格，也就是它的第 54 格
export const CROSSED = 54;
export const SIX = 6;
export const MAX_SIXES = 3;

export class RuleError extends Error {}

export const isLoop = (p) => p >= 1 && p <= LAST_LOOP;
export const loopIndex = (color, p) => (START[color] + p - 1) % LOOP.length;
const isOwnColor = (p) => isLoop(p) && (p - 1) % 4 === 0;

// 开局设置对不对：两到四方、颜色不重复、飞机 2 或 4 架
export function checkConfig(config) {
  const players = config?.players;
  const ok = config?.rules === RULES_VERSION && [2, 4].includes(config.planes) && Array.isArray(players)
    && players.length >= 2 && players.length <= 4 && Number.isInteger(config.first) && config.first >= 0 && config.first < players.length
    && players.every((p, k) => Number.isInteger(p.color) && p.color >= 0 && p.color < 4 && typeof p.name === 'string'
      && (k === 0 || p.color > players[k - 1].color));
  if (!ok) throw new RuleError('开局设置不对');
}

export function createGame(config) {
  checkConfig(config);
  return {
    turn: config.first,
    phase: 'roll', // 'roll' 等掷骰子，'move' 等选飞机，'over' 结束
    dice: null,
    sixes: 0, // 这一轮连着掷出了几次 6
    planes: config.players.map(() => Array(config.planes).fill(HANGAR)),
    winner: null,
  };
}

// 掷出 dice 后，这一方哪几架飞机能走
export function legalPlanes(state, dice = state.dice) {
  return state.planes[state.turn].flatMap((p, k) => (p === GOAL || (p === HANGAR && dice !== SIX) ? [] : [k]));
}

// 做一步动作，返回新的局面和发生了什么（给界面放动画用）。动作不合法就抛 RuleError，原来的局面不变
export function apply(config, state, action) {
  if (state.phase === 'over') throw new RuleError('这一局已经结束了');
  if (action?.seat !== state.turn) throw new RuleError('还没轮到这一方');
  const next = structuredClone(state);
  const events = [];
  const player = next.turn;

  if (action.type === 'roll') {
    if (next.phase !== 'roll') throw new RuleError('现在不该掷骰子');
    const { value } = action;
    if (!Number.isInteger(value) || value < 1 || value > 6) throw new RuleError('点数不对');
    next.dice = value;
    next.sixes = value === SIX ? next.sixes + 1 : 0;
    events.push({ type: 'roll', player, value });
    if (next.sixes >= MAX_SIXES) {
      events.push({ type: 'forfeit', player });
      endTurn(config, next, events);
    } else if (!legalPlanes(next).length) {
      // 没有能走的：掷到 6 照样再掷一次，否则轮到下一方
      events.push({ type: 'pass', player, value });
      if (value === SIX) rollAgain(next, events);
      else endTurn(config, next, events);
    } else {
      next.phase = 'move';
    }
  } else if (action.type === 'move') {
    if (next.phase !== 'move') throw new RuleError('现在不该走飞机');
    if (!legalPlanes(next).includes(action.plane)) throw new RuleError('这架飞机不能走');
    movePlane(config, next, player, action.plane, next.dice, events);
    if (next.planes[player].every((p) => p === GOAL)) {
      next.phase = 'over';
      next.winner = player;
      events.push({ type: 'win', player });
    } else if (next.dice === SIX) {
      rollAgain(next, events);
    } else {
      endTurn(config, next, events);
    }
  } else {
    throw new RuleError('不认识的动作');
  }
  return { state: next, events };
}

function rollAgain(state, events) {
  state.phase = 'roll';
  state.dice = null;
  events.push({ type: 'again', player: state.turn });
}

function endTurn(config, state, events) {
  state.turn = (state.turn + 1) % config.players.length;
  state.phase = 'roll';
  state.dice = null;
  state.sixes = 0;
  events.push({ type: 'turn', player: state.turn });
}

// 把飞机挪到 p（机场、起飞点或某一格），并记下为什么挪
function place(state, player, plane, to, events, event) {
  state.planes[player][plane] = to;
  events.push({ ...event, player, plane, to });
}

function movePlane(config, state, player, plane, dice, events) {
  const from = state.planes[player][plane];
  if (from === HANGAR) {
    place(state, player, plane, TAKEOFF, events, { type: 'takeoff', from });
    return;
  }
  // 一步一步走，到了终点还有步数就往回退
  const path = [];
  let p = from;
  let step = 1;
  for (let k = 0; k < dice; k++) {
    if (p === GOAL) step = -1;
    p += step;
    path.push(p);
  }
  place(state, player, plane, p, events, { type: 'move', from, path });
  if (isLoop(p)) {
    capture(config, state, player, p, events);
    if (p === FLY_FROM) {
      p = fly(config, state, player, plane, events);
      if (isOwnColor(p) && p + JUMP <= LAST_LOOP) p = jump(config, state, player, plane, p, events);
    } else if (isOwnColor(p) && p + JUMP <= LAST_LOOP) {
      p = jump(config, state, player, plane, p, events);
      if (p === FLY_FROM) fly(config, state, player, plane, events);
    }
  }
  if (state.planes[player][plane] === GOAL) events.push({ type: 'goal', player, plane });
}

function jump(config, state, player, plane, from, events) {
  place(state, player, plane, from + JUMP, events, { type: 'jump', from });
  capture(config, state, player, from + JUMP, events);
  return from + JUMP;
}

function fly(config, state, player, plane, events) {
  const across = (config.players[player].color + 2) % 4;
  place(state, player, plane, FLY_TO, events, { type: 'fly', from: FLY_FROM, across });
  config.players.forEach((other, q) => {
    if (other.color !== across) return;
    state.planes[q].forEach((op, j) => {
      if (op === CROSSED) place(state, q, j, HANGAR, events, { type: 'capture', from: op, by: player });
    });
  });
  capture(config, state, player, FLY_TO, events);
  return FLY_TO;
}

// 停在大圈第 p 格：同一格上别人的飞机都撞回机场
function capture(config, state, player, p, events) {
  const at = loopIndex(config.players[player].color, p);
  config.players.forEach((other, q) => {
    if (q === player) return;
    state.planes[q].forEach((op, j) => {
      if (isLoop(op) && loopIndex(other.color, op) === at) place(state, q, j, HANGAR, events, { type: 'capture', from: op, by: player });
    });
  });
}

// 从开局把动作一步步重放出来；有哪一步不合法就抛 RuleError
export function replay(config, log) {
  let state = createGame(config);
  for (const action of log) state = apply(config, state, action).state;
  return state;
}
