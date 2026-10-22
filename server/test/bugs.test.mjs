// 测试时发现、后来修好的问题，留着防止再犯。每个测试上面的注释是当时的毛病。

import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as mono from '../../games/monopoly/engine.js';
import { Bot, LOCAL, MINUTE, Player, playOut, quickTable, world } from './helpers.mjs';

const AI_DELAY = 700;

test('同一条连接上发 resume（客户端对不上时重新同步）不该让别人看到他掉线又回来，也不该重新计时', (t) => {
  const w = world(t);
  const players = ['甲', '乙', '丙', '丁'].map((name) => new Player(w, name));
  const room = quickTable(w, 'feixingqi', players);
  const mover = players.find((p) => p.seat === room.state.turn);
  const others = players.filter((p) => p !== mover);
  const { limit } = room.adapter;
  w.clock.advance(5000);
  mover.send({ t: 'resume', room: mover.start.room, token: mover.start.token });
  assert.equal(mover.all('start').length, 2);
  w.clock.advance(AI_DELAY);
  assert.equal(room.log.length, 0, '电脑替还在线的人走了一步');
  assert.equal(mover.last('turn')?.seat, mover.seat);
  for (const p of others) assert.deepEqual(p.all('presence'), [], '别人看到他掉线又回来');
  assert.ok(mover.last('turn').ms <= limit - 5000, `计时从头算了：还剩 ${mover.last('turn').ms} 毫秒`);
});

test('打完以后有人回来看结果，房间照样在 10 分钟后收掉', (t) => {
  const w = world(t);
  const bots = ['甲', '乙'].map((name) => new Bot(w, name));
  const room = quickTable(w, 'monopoly', bots);
  bots[0].close(); // App 切到后台
  playOut(w, room);
  const back = new Player(w, '甲'); // 回到前台：客户端发 resume，看到已经结束就断开
  back.send({ t: 'resume', room: bots[0].start.room, token: bots[0].start.token });
  assert.equal(back.start.log.length, room.log.length);
  back.close();
  bots[1].close();
  w.clock.advance(11 * MINUTE);
  assert.ok(!w.hub.rooms.has(room.id), '结束的房间一直没收掉');
});

test('起名去重后不会有两个人同名', (t) => {
  const w = world(t);
  const players = ['玩家', '玩家', '玩家2'].map((name) => new Player(w, name));
  quickTable(w, 'feixingqi', players);
  const names = players[0].start.players.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, `有重名：${names.join('、')}`);
});

test('用 emoji 起名，大富翁的开局设置也能被游戏自己的 replay 认出来', (t) => {
  const w = world(t);
  const players = ['😀😀😀😀😀😀😀😀', '乙'].map((name) => new Player(w, name));
  const room = quickTable(w, 'monopoly', players);
  assert.ok(mono.isValidConfig(players[0].start.config), '开局设置不合规矩');
  assert.deepEqual(LOCAL.monopoly.replay(players[0].start, room.log), room.state);
});

test('不是游戏名的 game（__proto__、constructor）回 bad-request', (t) => {
  const w = world(t);
  const a = new Player(w, '甲');
  a.send({ t: 'quick', game: '__proto__' });
  assert.equal(a.last('error')?.code, 'bad-request');
  a.send({ t: 'create', game: 'constructor' });
  assert.equal(a.last('error')?.code, 'bad-request');
  assert.equal(w.hub.rooms.size, 0);
});

test('房主输自己的房间码“加入”，房间还在、别人还能进', (t) => {
  const w = world(t);
  const [a, b] = ['甲', '乙'].map((name) => new Player(w, name));
  const code = a.create('feixingqi');
  a.join('feixingqi', code);
  b.join('feixingqi', code);
  assert.equal(b.last('error'), undefined, '别人进不来了');
  assert.equal(a.last('room').players.length, 2);
});
