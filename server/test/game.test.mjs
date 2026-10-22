// 对局：整局打完、服务器说了算的规则、限时和动画等待、掉线和回来。

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { GAMES } from '../games.js';
import * as fx from '../../games/feixingqi/rules.js';
import { Bot, LOCAL, MINUTE, Player, playOut, quickTable, world } from './helpers.mjs';

const IDLE_CAP = 6000;
const AI_DELAY = 700;
const EMPTY_TTL = 10 * MINUTE;
const NAMES = ['甲', '乙', '丙', '丁'];

// 每个客户端收到的 log 都和服务器的一样、seq 没断过，用游戏自己的 replay 重放出来正好是服务器的局面
function checkReplays(room, bots) {
  const local = LOCAL[room.gameId];
  for (const bot of bots) {
    assert.deepEqual(bot.gaps, [], `${bot.name} 的 seq 断了`);
    const playing = bot.inbox.slice(bot.inbox.indexOf(bot.start));
    assert.deepEqual(playing.filter((m) => m.t === 'error'), [], `${bot.name} 在对局里收到了错误`);
    assert.deepEqual(bot.log, room.log, `${bot.name} 的 log 和服务器的不一样`);
    assert.deepEqual(local.replay(bot.start, bot.log), room.state, `${bot.name} 重放出来的局面不对`);
    assert.deepEqual(bot.state, room.state);
  }
}

describe('整局打完', () => {
  const tables = [
    { title: '飞行棋：快速匹配，两个人加两台电脑', game: 'feixingqi', humans: 2 },
    { title: '飞行棋：房间码，三个人各两架飞机', game: 'feixingqi', humans: 3, room: { seats: 3, options: { planes: 2 } } },
    { title: '大富翁：快速匹配，四个人', game: 'monopoly', humans: 4 },
    { title: '大富翁：房间码，两个人加一台电脑，40 轮', game: 'monopoly', humans: 2, room: { seats: 3, options: { rounds: 40 } } },
  ];
  for (const { title, game, humans, room: settings } of tables) {
    test(title, (t) => {
      const w = world(t);
      const bots = NAMES.slice(0, humans).map((name) => new Bot(w, name));
      let room;
      if (settings) {
        const code = bots[0].create(game, settings);
        for (const bot of bots.slice(1)) bot.join(game, code);
        bots[0].send({ t: 'start' });
        room = bots[0].room;
      } else {
        room = quickTable(w, game, bots);
      }
      assert.equal(room.players.length, settings?.seats ?? 4);
      playOut(w, room);
      assert.equal(room.state.phase, 'over');
      assert.ok(room.log.length > 20);
      checkReplays(room, bots);
      if (game === 'monopoly') {
        // 大富翁的 rev 就是 seq
        room.log.forEach((action, seq) => assert.equal(action.rev, seq));
        assert.ok(bots.every((bot) => bot.all('act').every((m) => m.action.rev === m.seq)));
      }
    });
  }
});

describe('服务器说了算', () => {
  test('骰子都是 1～6 的整数，客户端指定的点数不算数', (t) => {
    const w = world(t);
    const seen = new Set();
    for (const game of ['feixingqi', 'monopoly']) {
      const room = quickTable(w, game, NAMES.map((name) => new Bot(w, name)));
      playOut(w, room);
      const rolls = LOCAL[game].rolls(room.log);
      assert.ok(rolls.length > 50);
      for (const value of rolls) {
        assert.ok(Number.isInteger(value) && value >= 1 && value <= 6, `点数 ${value}`);
        seen.add(value);
      }
      if (game === 'monopoly') assert.ok(room.log.every((a) => a.type !== 'roll' || a.dice.length === 2));
    }
    assert.deepEqual([...seen].sort(), [1, 2, 3, 4, 5, 6]);

    // 每次都说要 6 点：服务器照样自己掷
    const players = NAMES.map((name) => new Player(w, name));
    const room = quickTable(w, 'feixingqi', players);
    const bySeat = (seat) => players.find((p) => p.seat === seat);
    for (let k = 0; k < 40; k++) {
      if (room.state.phase === 'move') bySeat(room.state.turn).act({ type: 'move', plane: fx.legalPlanes(room.state)[0] });
      bySeat(room.state.turn).act({ type: 'roll', value: 6 });
    }
    const values = LOCAL.feixingqi.rolls(room.log);
    assert.equal(values.length, 40);
    assert.ok(values.some((v) => v !== 6));
  });

  test('没轮到的人出手会被拒绝，局面不变', (t) => {
    const w = world(t);
    for (const game of ['feixingqi', 'monopoly']) {
      const players = NAMES.map((name) => new Player(w, name));
      const room = quickTable(w, game, players);
      const turn = players[0].last('turn').seat;
      const mover = players.find((p) => p.seat === turn);
      const other = players.find((p) => p.seat === (turn + 1) % 4);
      other.act({ type: 'roll' });
      assert.equal(other.last('error').code, 'bad-action');
      assert.equal(room.log.length, 0);
      assert.ok(players.every((p) => p.all('act').length === 0));
      mover.act({ type: 'roll' });
      assert.equal(room.log.length, 1);
      assert.ok(players.every((p) => p.all('act').length === 1));
      assert.equal(LOCAL[game].seatOf(room.log[0]), turn);
      assert.equal(mover.all('error').length, 0);
      if (room.state.turn !== turn) {
        mover.act({ type: 'roll' }); // 刚走完一步，已经换人了
        assert.equal(mover.last('error').code, 'bad-action');
        assert.equal(room.log.length, 1);
      }
    }
  });

  test('大富翁随时可以认输，剩一个人时这一局结束', (t) => {
    const w = world(t);
    const players = NAMES.map((name) => new Player(w, name));
    const room = quickTable(w, 'monopoly', players);
    const bySeat = (seat) => players.find((p) => p.seat === seat);
    assert.equal(room.state.turn, 0);

    bySeat(2).act({ type: 'resign' }); // 不是他的回合
    assert.deepEqual(bySeat(0).last('act'), { t: 'act', seq: 0, action: { type: 'resign', by: 2, rev: 0 } });
    assert.equal(room.state.players[2].out, true);
    assert.equal(room.state.turn, 0);
    bySeat(2).act({ type: 'resign' });
    assert.equal(bySeat(2).last('error').code, 'bad-action'); // 已经出局了
    bySeat(2).act({ type: 'roll' });
    assert.equal(bySeat(2).last('error').code, 'bad-action');

    bySeat(0).act({ type: 'resign' }); // 自己的回合认输，轮到下一个还在的人
    assert.equal(room.state.turn, 1);
    bySeat(3).act({ type: 'resign' });
    assert.equal(room.state.phase, 'over');
    assert.equal(room.state.winner, 1);
    assert.equal(room.phase, 'over');
    bySeat(1).act({ type: 'roll' });
    assert.equal(bySeat(1).last('error').code, 'bad-action');
    assert.equal(room.log.length, 3);
  });
});

describe('限时和等动画', () => {
  for (const game of ['feixingqi', 'monopoly']) {
    test(`${game}：真人超时，电脑替他走这一步`, (t) => {
      const w = world(t);
      const players = NAMES.map((name) => new Player(w, name));
      const room = quickTable(w, game, players);
      const { limit } = GAMES[game];
      const turn = players[0].last('turn');
      assert.equal(turn.ms, limit);
      w.clock.advance(limit - 1);
      assert.equal(room.log.length, 0);
      w.clock.advance(1);
      assert.equal(room.log.length, 1);
      assert.equal(room.log[0].type, 'roll');
      assert.equal(LOCAL[game].seatOf(room.log[0]), turn.seat);
      assert.ok(players.every((p) => p.last('act').seq === 0));
    });
  }

  test('等大家放完动画最多等 6 秒；都回了 idle 就马上开始下一步', (t) => {
    const w = world(t);
    const players = NAMES.map((name) => new Player(w, name));
    const room = quickTable(w, 'feixingqi', players);
    const turns = () => players[0].all('turn').length;
    const mover = () => players.find((p) => p.seat === players[0].last('turn').seat);
    const step = () => mover().act(room.state.phase === 'roll' ? { type: 'roll' } : { type: 'move', plane: fx.legalPlanes(room.state)[0] });

    assert.equal(turns(), 1);
    step();
    // 三个人回了 idle，还有一个没回：等满 6 秒
    for (const p of players.slice(1)) p.send({ t: 'idle', seq: 1 });
    w.clock.advance(IDLE_CAP - 1);
    assert.equal(turns(), 1);
    w.clock.advance(1);
    assert.equal(turns(), 2);
    assert.equal(players[0].last('turn').ms, GAMES.feixingqi.limit);

    step();
    for (const p of players) p.send({ t: 'idle', seq: 1 }); // 旧的 seq 不算
    w.clock.advance(IDLE_CAP - 1);
    assert.equal(turns(), 2);
    for (const p of players) p.send({ t: 'idle', seq: 2 });
    assert.equal(turns(), 3);

    // seq 报得比 log 还长也只算到 log 的长度
    step();
    for (const p of players) p.send({ t: 'idle', seq: 99 });
    assert.equal(turns(), 4);
    step();
    w.clock.advance(IDLE_CAP - 1);
    assert.equal(turns(), 4);
  });

  test('电脑座位等大家放完动画后再停 0.7 秒出手', (t) => {
    const w = world(t);
    const players = ['甲', '乙'].map((name) => new Player(w, name));
    const room = quickTable(w, 'monopoly', players);
    // 一直让真人自己掷骰子、不买不盖，直到轮到电脑
    while (room.players[room.state.turn].client) {
      const mover = players.find((p) => p.seat === room.state.turn);
      mover.act({ type: room.state.phase === 'roll' ? 'roll' : 'pass' });
      for (const p of players) p.send({ t: 'idle', seq: room.log.length });
    }
    const seq = room.log.length;
    w.clock.advance(AI_DELAY - 1);
    assert.equal(room.log.length, seq);
    w.clock.advance(1);
    assert.equal(room.log.length, seq + 1);
    assert.ok(players.every((p) => p.all('turn').every((m) => room.players[m.seat].client)), '电脑的回合不该发 turn');
  });
});

describe('掉线和回来', () => {
  test('掉线的人：别人收到 presence，之后由电脑替他走，不再给他计时', (t) => {
    const w = world(t);
    const bots = NAMES.map((name) => new Bot(w, name));
    const room = quickTable(w, 'feixingqi', bots);
    const gone = bots.find((b) => b.seat === room.state.turn);
    const others = bots.filter((b) => b !== gone);
    const seat = gone.seat;
    gone.close();
    for (const b of others) assert.deepEqual(b.last('presence'), { t: 'presence', seat, away: true });
    assert.equal(room.players[seat].client, null);
    const marks = others.map((b) => b.inbox.length);

    // 正轮到他：大家早就放完了开局的“动画”，再等 0.7 秒电脑就替他出手
    w.clock.advance(AI_DELAY);
    assert.equal(room.log.length, 1);
    assert.equal(room.log[0].seat, seat);

    w.clock.until(() => room.log.filter((a) => a.seat === seat).length >= 10 || room.phase === 'over');
    others.forEach((b, k) => {
      const turns = b.inbox.slice(marks[k]).filter((m) => m.t === 'turn');
      assert.ok(turns.length > 0);
      assert.ok(turns.every((m) => m.seat !== seat), '掉线的人不该再有 turn');
    });
    playOut(w, room);
    checkReplays(room, others);
  });

  test('凭 token 回来拿到完整的 log 接着玩，token 不对的不行', (t) => {
    const w = world(t);
    const bots = NAMES.slice(0, 3).map((name) => new Bot(w, name));
    const room = quickTable(w, 'monopoly', bots);
    const [gone, ...others] = bots;
    const { seat, room: id, token } = gone.start;
    w.clock.until(() => room.log.length >= 15);
    gone.close();
    w.clock.until(() => room.log.length >= 40);
    assert.equal(room.phase, 'playing');

    const back = new Bot(w, '甲');
    back.send({ t: 'resume', room: id, token: 'not-a-token' });
    assert.equal(back.last('error').code, 'no-game');
    back.send({ t: 'resume', room: 'no-such-room', token });
    assert.equal(back.last('error').code, 'no-game');
    back.send({ t: 'resume', room: id, token: '' });
    assert.equal(back.last('error').code, 'no-game');
    assert.equal(back.start, undefined);

    back.send({ t: 'resume', room: id, token });
    assert.equal(back.start.seat, seat);
    assert.equal(back.start.token, token);
    assert.deepEqual(back.start.log, room.log);
    assert.deepEqual(back.start.players[seat], { name: gone.start.players[seat].name, ai: false, away: false });
    assert.equal(back.start.seed, gone.start.seed);
    for (const b of others) assert.deepEqual(b.last('presence'), { t: 'presence', seat, away: false });
    assert.equal(back.all('presence').length, 0);

    const mark = back.inbox.length;
    playOut(w, room);
    assert.ok(back.inbox.slice(mark).some((m) => m.t === 'turn' && m.seat === seat), '回来以后又轮到他自己走');
    checkReplays(room, [back, ...others]);
  });

  test('轮到他时掉线、电脑还没替他走就回来了：这一步还是他自己走', (t) => {
    const w = world(t);
    const players = NAMES.map((name) => new Player(w, name));
    const room = quickTable(w, 'feixingqi', players);
    const gone = players.find((p) => p.seat === room.state.turn);
    gone.close();
    w.clock.advance(AI_DELAY - 400);
    const back = new Player(w, gone.name);
    back.send({ t: 'resume', room: gone.start.room, token: gone.start.token });
    back.send({ t: 'idle', seq: 0 });
    w.clock.advance(GAMES.feixingqi.limit - 1);
    assert.equal(room.log.length, 0, '电脑替回来的人走了');
    assert.deepEqual(back.last('turn'), { t: 'turn', seat: gone.seat, ms: GAMES.feixingqi.limit });
    back.act({ type: 'roll' });
    assert.equal(room.log.length, 1);
    assert.equal(room.log[0].seat, gone.seat);
  });

  test('同一个人从新连接回来，旧连接作废', (t) => {
    const w = world(t);
    const players = ['甲', '乙'].map((name) => new Player(w, name));
    const room = quickTable(w, 'feixingqi', players);
    const [old, other] = players;
    const fresh = new Player(w, '甲');
    fresh.send({ t: 'resume', room: old.start.room, token: old.start.token });
    assert.equal(fresh.seat, old.seat);
    assert.equal(room.players[old.seat].client, fresh.client);
    assert.equal(fresh.last('turn')?.seat, room.turn?.seat); // 正在给真人计时的话也告诉他

    // 旧连接再发动作不算，断开时也不会把座位标成掉线
    const seats = room.players.map((p) => p.client);
    old.act({ type: 'roll' });
    assert.equal(old.last('error').code, 'bad-action');
    old.close();
    assert.deepEqual(room.players.map((p) => p.client), seats);
    assert.ok(other.all('presence').every((m) => m.away === false));
  });

  test('人都走光了先停着，10 分钟没人回来就收掉', (t) => {
    const w = world(t);
    const bots = ['甲', '乙'].map((name) => new Bot(w, name));
    const room = quickTable(w, 'feixingqi', bots);
    w.clock.until(() => room.log.length >= 10);
    for (const b of bots) b.close();
    const length = room.log.length;
    w.clock.advance(EMPTY_TTL - 1);
    assert.equal(room.log.length, length, '没人在的时候电脑不该接着走');
    assert.ok(w.hub.rooms.has(room.id));
    assert.equal(w.clock.timers.size, 1); // 只剩收房间的计时器
    w.clock.advance(1);
    assert.ok(!w.hub.rooms.has(room.id));
    assert.equal(w.clock.timers.size, 0);

    const back = new Player(w, '甲');
    back.send({ t: 'resume', room: bots[0].start.room, token: bots[0].start.token });
    assert.equal(back.last('error').code, 'no-game');
  });

  test('停着的时候有人回来，接着打，打完 10 分钟后收掉', (t) => {
    const w = world(t);
    const bots = ['甲', '乙'].map((name) => new Bot(w, name));
    const room = quickTable(w, 'monopoly', bots);
    w.clock.until(() => room.log.length >= 10);
    for (const b of bots) b.close();
    const left = w.clock.now();
    const length = room.log.length;
    w.clock.advance(5 * MINUTE);
    const back = new Bot(w, '乙');
    back.send({ t: 'resume', room: bots[1].start.room, token: bots[1].start.token });
    assert.deepEqual(back.start.players.map((p) => p.away), back.start.players.map((p, seat) => seat === bots[0].seat));

    playOut(w, room);
    const over = w.clock.now();
    assert.ok(room.log.length > length);
    checkReplays(room, [back]);
    // 走光时定下的 10 分钟已经取消了，改成从打完算起
    w.clock.advance(Math.max(0, left + EMPTY_TTL - over) + 1);
    assert.ok(w.hub.rooms.has(room.id));
    w.clock.advance(over + EMPTY_TTL - 1 - w.clock.now());
    assert.ok(w.hub.rooms.has(room.id));
    w.clock.advance(1);
    assert.ok(!w.hub.rooms.has(room.id));
  });
});
