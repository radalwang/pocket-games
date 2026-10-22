// 电脑怎么走：把每架能走的飞机都用 rules.js 试走一遍，看结果打分，挑分最高的。
// 只看这一步，不往后算：撞人、进终点、起飞、躲进跑道加分；停在别人一步就能撞到的地方扣分。
// 电脑的选择会作为普通的 move 动作记进记录里，所以这里用随机数打破平局也不影响重放。

import { LOOP, START } from './board.js';
import { apply, GOAL, HANGAR, isLoop, LAST_LOOP, legalPlanes, loopIndex, TAKEOFF } from './rules.js';

// 别的方在下一次掷骰子时能不能停到大圈第 at 格（绝对格号）上：大圈上落后 1–6 格、还没拐进跑道的飞机，
// 和起飞点上离那格 1–6 步的飞机都算。返回有几架
function threats(config, state, player, at) {
  let count = 0;
  config.players.forEach((other, q) => {
    if (q === player) return;
    for (const p of state.planes[q]) {
      if (p === TAKEOFF) {
        const steps = (at - START[other.color] + LOOP.length) % LOOP.length + 1;
        if (steps <= 6) count++;
      } else if (isLoop(p)) {
        const behind = (at - loopIndex(other.color, p) + LOOP.length) % LOOP.length;
        if (behind >= 1 && behind <= 6 && p + behind <= LAST_LOOP) count++;
      }
    }
  });
  return count;
}

// 一架飞机在 p 处有多危险：被撞回去损失越大（走得越远）越危险
function danger(config, state, player, p) {
  if (!isLoop(p)) return 0;
  const at = loopIndex(config.players[player].color, p);
  return threats(config, state, player, at) * (4 + p / 6);
}

function score(config, state, plane) {
  const player = state.turn;
  const from = state.planes[player][plane];
  const { state: after, events } = apply(config, state, { type: 'move', seat: player, plane });
  const to = after.planes[player][plane];
  let value = 0;
  for (const event of events) {
    if (event.type === 'capture' && event.by === player) value += 14 + event.from / 3;
    if (event.type === 'jump' || event.type === 'fly') value += 3;
  }
  if (from === HANGAR) value += 10 - after.planes[player].filter((p) => p >= TAKEOFF && p < GOAL).length * 2;
  else value += (to - from) / 2;
  if (to === GOAL) value += 20;
  if (from <= LAST_LOOP && to > LAST_LOOP) value += 6;
  value += danger(config, state, player, from) - danger(config, after, player, to);
  return value;
}

export function chooseMove(config, state) {
  let best = null;
  let bestValue = -Infinity;
  for (const plane of legalPlanes(state)) {
    const value = score(config, state, plane) + Math.random() * 0.5;
    if (value > bestValue) {
      best = plane;
      bestValue = value;
    }
  }
  return best;
}
