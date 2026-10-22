// 服务器上的两款联机游戏：直接用游戏自己的规则文件当裁判，这里只是把它们包成同一个样子，给 room.js 用。
//
// 每款游戏提供：
//   rules            规则版本，客户端版本不同不能同桌
//   limit            真人每一步的限时（毫秒），超时由电脑替他走
//   quickOptions     快速匹配用的设置；checkOptions 把房主发来的设置整理成合法的
//   create(players, options)  按座位顺序的 [{ name, ai }] 开一局，返回 { data, state }；data 是开局数据，原样发给客户端
//   awaiting(state)   现在等哪个座位出手，结束了返回 null
//   confirm(data, state, seat, intent)  把客户端（或电脑）想做的动作补全成确定的动作：骰子由服务器掷。不合法就抛错
//   apply(data, state, action)  执行确定的动作，返回新局面
//   auto(data, state, seat)  电脑替这个座位想好的动作（电脑座位、掉线和超时都用它）
//   anytime(intent)   不用等轮到也能做的动作（大富翁的认输）

import { randomInt } from 'node:crypto';
import * as fx from '../games/feixingqi/rules.js';
import { chooseMove } from '../games/feixingqi/ai.js';
import * as mono from '../games/monopoly/engine.js';
import { decide } from '../games/monopoly/ai.js';

const die = () => randomInt(1, 7);

// 飞行棋按人数选颜色：两个人坐对面，三个人占相邻三色
const FX_COLORS = { 2: [0, 2], 3: [0, 1, 2], 4: [0, 1, 2, 3] };

const feixingqi = {
  rules: fx.RULES_VERSION,
  limit: 15000,
  quickOptions: { planes: 4 },
  checkOptions: (options) => ({ planes: options?.planes === 2 ? 2 : 4 }),

  create(players, options) {
    const colors = FX_COLORS[players.length];
    const config = {
      rules: fx.RULES_VERSION,
      planes: options.planes,
      first: randomInt(players.length),
      players: players.map(({ name }, seat) => ({ color: colors[seat], name })),
    };
    return { data: { config }, state: fx.createGame(config) };
  },

  awaiting: (state) => (state.phase === 'over' ? null : state.turn),

  confirm(data, state, seat, intent) {
    let action;
    if (intent?.type === 'roll') action = { type: 'roll', seat, value: die() };
    else if (intent?.type === 'move') action = { type: 'move', seat, plane: intent.plane };
    else throw new Error('不认识的动作');
    fx.apply(data.config, state, action); // 不合法会抛错
    return action;
  },

  apply: (data, state, action) => fx.apply(data.config, state, action).state,

  auto(data, state, seat) {
    if (state.phase === 'roll') return { type: 'roll' };
    return { type: 'move', plane: chooseMove(data.config, state) };
  },

  anytime: () => false,

  replay: (data, log) => fx.replay(data.config, log),
};

const monopoly = {
  rules: mono.RULES_VERSION,
  limit: 30000,
  quickOptions: { rounds: 20 },
  checkOptions: (options) => ({ rounds: mono.ROUND_OPTIONS.includes(options?.rounds) ? options.rounds : 20 }),

  create(players, options) {
    const config = {
      rounds: options.rounds,
      players: players.map(({ name, ai }) => ({ name, kind: ai ? 'ai' : 'human' })),
    };
    const seed = randomInt(2 ** 31);
    return { data: { config, seed }, state: mono.newGame(config, seed) };
  },

  awaiting: (state) => (state.phase === 'over' ? null : state.turn),

  // 大富翁的动作带 rev（执行前局面已经走过几步），客户端靠它认出过期和重复的动作
  confirm(data, state, seat, intent) {
    const action = { type: intent?.type, by: seat };
    if (action.type === 'roll') action.dice = [die(), die()];
    if (!mono.canAct(state, action)) throw new Error('现在不能这样做');
    return { ...action, rev: state.rev };
  },

  apply(data, state, action) {
    const { rev, ...clean } = action;
    return mono.act(state, clean).state;
  },

  auto: (data, state, seat) => decide(state, seat),

  anytime: (intent) => intent?.type === 'resign',

  replay(data, log) {
    let state = mono.newGame(data.config, data.seed);
    for (const action of log) state = monopoly.apply(data, state, action);
    return state;
  },
};

export const GAMES = { feixingqi, monopoly };
