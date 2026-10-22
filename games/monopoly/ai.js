// 电脑玩家：看局面决定下一步，返回一个和本机玩家点按钮一样的动作 { type, by }。
// 只读局面不改它：联机时服务器用它替电脑、掉线和超时的人出手，大家收到的也只是普通的动作。

import { TILES } from './board.js';
import { houseCost, rentOf } from './engine.js';

// 手上至少留多少钱：对手地上最贵的过路费的六成，最少 1000，免得一脚踩上去就破产
function reserveFor(s, seat) {
  let worst = 0;
  s.owner.forEach((o, i) => {
    if (o >= 0 && o !== seat) worst = Math.max(worst, rentOf(s, i));
  });
  return Math.max(1000, worst * 0.6);
}

export function decide(s, seat) {
  if (s.phase === 'roll') return { type: 'roll', by: seat };
  const p = s.players[seat];
  const i = p.pos;
  const tile = TILES[i];
  const reserve = reserveFor(s, seat);
  if (s.phase === 'buy') {
    // 买下就能凑齐一整组的地，留的钱可以少一半
    const completes = tile.group && TILES.every((t, j) => t.group !== tile.group || j === i || s.owner[j] === seat);
    const keep = completes ? reserve / 2 : reserve;
    return { type: p.cash - tile.price >= keep ? 'buy' : 'pass', by: seat };
  }
  if (s.phase === 'upgrade') return { type: p.cash - houseCost(i) >= reserve ? 'upgrade' : 'pass', by: seat };
  return null;
}
