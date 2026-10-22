// 大厅：快速匹配、房间码、乱发的消息。

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { QUICK_WAIT } from '../hub.js';
import { GAMES } from '../games.js';
import { Player, world } from './helpers.mjs';

const names = (start) => start.players.map((p) => p.name).sort();

describe('快速匹配', () => {
  test('两个人等满 30 秒开局，电脑补两个座位，重名的加数字', (t) => {
    const w = world(t);
    const a = new Player(w, '小明');
    const b = new Player(w, '小明');
    a.quick('feixingqi');
    assert.deepEqual(a.last('queue'), {
      t: 'queue', game: 'feixingqi', players: [{ name: '小明', me: true, host: false }], seats: 4, ms: QUICK_WAIT,
    });
    w.clock.advance(5000);
    b.quick('feixingqi');
    assert.equal(a.last('queue').players.length, 2);
    assert.deepEqual(b.last('queue').players.map((p) => p.me), [false, true]);
    assert.equal(b.last('queue').ms, QUICK_WAIT - 5000);

    w.clock.advance(QUICK_WAIT - 5000 - 1);
    assert.equal(a.start, undefined);
    w.clock.advance(1);
    assert.ok(a.start && b.start);
    assert.equal(a.start.room, b.start.room);
    assert.notEqual(a.seat, b.seat);
    assert.notEqual(a.start.token, b.start.token);
    assert.deepEqual(a.start.log, []);
    assert.deepEqual(names(a.start), ['小明', '小明2', '电脑1', '电脑2']);
    assert.deepEqual(a.start.players.map((p) => p.ai).sort(), [false, false, true, true]);
    assert.equal(a.start.players[a.seat].ai, false);
    assert.equal(a.start.players[b.seat].ai, false);
    assert.ok(a.start.players.every((p) => !p.away));
    assert.deepEqual(a.start.config.players.map((p) => p.name), a.start.players.map((p) => p.name));
    assert.equal(w.hub.forming.size, 0);
  });

  test('四个人凑齐马上开局，第五个人进新的一桌', (t) => {
    const w = world(t);
    const players = ['甲', '乙', '丙', '丁'].map((name) => new Player(w, name));
    for (const p of players.slice(0, 3)) p.quick('monopoly');
    assert.ok(players.every((p) => !p.start));
    players[3].quick('monopoly');
    assert.ok(players.every((p) => p.start));
    assert.deepEqual(players.map((p) => p.seat).sort(), [0, 1, 2, 3]);
    const { start } = players[0];
    assert.ok(start.players.every((p) => !p.ai));
    assert.deepEqual(start.config.players.map((p) => p.kind), ['human', 'human', 'human', 'human']);
    assert.equal(start.config.rounds, 20);
    assert.ok(Number.isInteger(start.seed));
    // 开局没有动画要等，马上轮到第一个人
    assert.deepEqual(players[0].last('turn'), { t: 'turn', seat: 0, ms: GAMES.monopoly.limit });

    const late = new Player(w, '戊');
    late.quick('monopoly');
    assert.deepEqual(late.last('queue').players, [{ name: '戊', me: true, host: false }]);
    assert.notEqual(w.hub.forming.get(`monopoly:${GAMES.monopoly.rules}`), players[0].room);
  });

  test('只有一个人：倒计时到了收到 alone，wait 重新倒计时，有人来了也重新倒计时', (t) => {
    const w = world(t);
    const a = new Player(w, '甲');
    a.quick('feixingqi');
    a.send({ t: 'wait' }); // 还没到 alone 时发 wait 不算数
    assert.equal(a.all('queue').length, 1);
    w.clock.advance(QUICK_WAIT);
    assert.equal(a.all('alone').length, 1);
    assert.equal(a.start, undefined);

    a.send({ t: 'wait' });
    assert.equal(a.last('queue').ms, QUICK_WAIT);
    w.clock.advance(QUICK_WAIT - 1);
    assert.equal(a.all('alone').length, 1);
    w.clock.advance(1);
    assert.equal(a.all('alone').length, 2);
    assert.equal(a.last('queue').ms, QUICK_WAIT); // alone 之后不再倒计时，但桌子还在

    w.clock.advance(10_000);
    const b = new Player(w, '乙');
    b.quick('feixingqi');
    assert.equal(a.last('queue').ms, QUICK_WAIT);
    assert.equal(b.last('queue').ms, QUICK_WAIT);
    w.clock.advance(QUICK_WAIT - 1);
    assert.equal(a.start, undefined);
    w.clock.advance(1);
    assert.ok(a.start && b.start);
    assert.equal(a.start.players.filter((p) => p.ai).length, 2);
    assert.equal(a.all('alone').length, 2);
  });

  test('离开排队：别人看到少了一个，最后一个人走了桌子和计时器都清掉', (t) => {
    const w = world(t);
    const a = new Player(w, '甲');
    const b = new Player(w, '乙');
    a.quick('feixingqi');
    b.quick('feixingqi');
    a.send({ t: 'leave' });
    assert.deepEqual(b.last('queue').players, [{ name: '乙', me: true, host: false }]);
    assert.equal(w.hub.rooms.size, 1);
    b.close(); // 断线和 leave 一样
    assert.equal(w.hub.rooms.size, 0);
    assert.equal(w.hub.forming.size, 0);
    assert.equal(w.clock.timers.size, 0);
    w.clock.advance(QUICK_WAIT);
    assert.equal(a.all('alone').length + b.all('alone').length, 0);

    // 再来的人从头倒计时
    w.clock.advance(5000);
    a.quick('feixingqi');
    assert.equal(a.last('queue').ms, QUICK_WAIT);
    // 换一款游戏排队就离开原来那一桌
    a.quick('monopoly');
    assert.equal(w.hub.rooms.size, 1);
    assert.equal(a.last('queue').game, 'monopoly');
  });

  test('规则版本对不上的不让排队', (t) => {
    const w = world(t);
    const a = new Player(w, '甲');
    a.quick('feixingqi', GAMES.feixingqi.rules + 1);
    assert.equal(a.last('error').code, 'version');
    a.send({ t: 'create', game: 'monopoly', rules: 0 });
    assert.equal(a.last('error').code, 'version');
    a.send({ t: 'join', game: 'monopoly', code: '1234' });
    assert.equal(a.last('error').code, 'version');
    assert.equal(w.hub.rooms.size, 0);
    assert.equal(a.all('queue').length + a.all('room').length, 0);

    const old = new Player(w, '乙', { hello: false });
    old.send({ t: 'hello', protocol: 0, name: '乙' });
    assert.equal(old.last('error').code, 'version');
    old.quick('feixingqi');
    assert.equal(old.last('error').code, 'bad-request'); // 招呼没打成
  });
});

describe('房间码', () => {
  test('开房间、加入、房主改设置', (t) => {
    const w = world(t);
    const a = new Player(w, '甲');
    const b = new Player(w, '乙');
    const code = a.create('feixingqi', { seats: 3, options: { planes: 2 } });
    assert.match(code, /^\d{4}$/);
    assert.deepEqual(a.last('room'), {
      t: 'room', game: 'feixingqi', code, host: true, players: [{ name: '甲', me: true, host: true }], seats: 3, options: { planes: 2 },
    });
    b.join('feixingqi', code);
    assert.equal(b.last('room').host, false);
    assert.deepEqual(b.last('room').players, [{ name: '甲', me: false, host: true }, { name: '乙', me: true, host: false }]);
    assert.equal(a.last('room').players.length, 2);

    a.send({ t: 'configure', seats: 4, options: { planes: 7 } }); // 不认识的设置换成默认的
    assert.equal(b.last('room').seats, 4);
    assert.deepEqual(b.last('room').options, { planes: 4 });
    a.send({ t: 'configure', seats: 1 });
    assert.equal(a.last('error').code, 'bad-request');
    a.send({ t: 'configure', seats: 5 });
    assert.equal(a.last('error').code, 'bad-request');
    a.send({ t: 'configure', options: { planes: 2 } });
    assert.equal(b.last('room').seats, 4);
    assert.deepEqual(b.last('room').options, { planes: 2 });

    b.send({ t: 'name', name: '  一个很长很长很长的名字  ' });
    assert.equal(a.last('room').players[1].name, '一个很长很长很长');

    const c = new Player(w, '丙');
    c.create('monopoly', { seats: 9, options: { rounds: 40 } });
    assert.equal(c.last('room').seats, 4);
    assert.deepEqual(c.last('room').options, { rounds: 40 });
    c.send({ t: 'configure', options: { rounds: 13 } });
    assert.deepEqual(c.last('room').options, { rounds: 20 });
  });

  test('满了、已开始、没有这个房间、不是房主都会被拒绝', (t) => {
    const w = world(t);
    const [a, b, c, d] = ['甲', '乙', '丙', '丁'].map((name) => new Player(w, name));
    const code = a.create('feixingqi', { seats: 2 });
    b.join('feixingqi', code);
    c.join('feixingqi', code);
    assert.equal(c.last('error').code, 'full');
    assert.equal(a.last('room').players.length, 2);

    b.send({ t: 'configure', seats: 4 });
    assert.equal(b.last('error').code, 'not-host');
    b.send({ t: 'start' });
    assert.equal(b.last('error').code, 'not-host');

    const unused = String(((Number(code) - 1000 + 1) % 9000) + 1000);
    d.join('feixingqi', unused);
    assert.equal(d.last('error').code, 'no-room');
    d.join('monopoly', code); // 房间码对，游戏不对
    assert.equal(d.last('error').code, 'no-room');

    a.send({ t: 'start' });
    assert.ok(a.start && b.start);
    assert.equal(a.start.players.length, 2);
    c.join('feixingqi', code);
    assert.equal(c.last('error').code, 'started');
    assert.equal(c.start, undefined);
  });

  test('至少两个真人才能开局，空位用电脑补', (t) => {
    const w = world(t);
    const [a, b, c] = ['甲', '乙', '丙'].map((name) => new Player(w, name));
    const code = a.create('monopoly', { options: { rounds: 40 } });
    a.send({ t: 'start' });
    assert.equal(a.last('error').code, 'alone');
    b.join('monopoly', code);
    c.join('monopoly', code);

    // 房主走了，下一个人当房主
    a.send({ t: 'leave' });
    assert.equal(b.last('room').host, true);
    assert.equal(c.last('room').host, false);
    c.send({ t: 'leave' });
    b.send({ t: 'start' });
    assert.equal(b.last('error').code, 'alone');
    c.join('monopoly', code);
    b.send({ t: 'start' });
    assert.ok(b.start && c.start);
    assert.equal(b.start.config.rounds, 40);
    assert.deepEqual(b.start.players.map((p) => p.ai).sort(), [false, false, true, true]);
    assert.deepEqual(names(b.start), ['丙', '乙', '电脑1', '电脑2']);
  });

  test('房间里的人都走了，房间码就收回', (t) => {
    const w = world(t);
    const [a, b] = ['甲', '乙'].map((name) => new Player(w, name));
    const code = a.create('feixingqi');
    b.join('feixingqi', code);
    a.close();
    b.send({ t: 'leave' });
    assert.equal(w.hub.codes.size, 0);
    assert.equal(w.hub.rooms.size, 0);
    const c = new Player(w, '丙');
    c.join('feixingqi', code);
    assert.equal(c.last('error').code, 'no-room');
  });
});

describe('乱发的消息', () => {
  test('不是 JSON、不认识的类型、没打招呼都回 bad-request，连接还能接着用', (t) => {
    const w = world(t);
    const a = new Player(w, '甲', { hello: false });
    a.quick('feixingqi');
    assert.equal(a.last('error').code, 'bad-request');
    a.raw('{not json');
    assert.equal(a.last('error').code, 'bad-request');
    a.send({ t: 'hello', protocol: 1, name: 42 });
    assert.deepEqual(a.last('hello'), { t: 'hello', protocol: 1 });

    for (const text of ['{"t":"dance"}', 'null', '42', '"quick"', '[]', '{}', '']) {
      const before = a.all('error').length;
      a.raw(text);
      assert.equal(a.all('error').length, before + 1, text);
      assert.equal(a.last('error').code, 'bad-request', text);
      assert.equal(typeof a.last('error').message, 'string');
    }

    a.send({ t: 'act', action: { type: 'roll' } });
    assert.equal(a.last('error').code, 'bad-action');
    a.send({ t: 'configure', seats: 2 });
    assert.equal(a.last('error').code, 'bad-request');
    a.send({ t: 'start' });
    assert.equal(a.last('error').code, 'bad-request');
    a.send({ t: 'resume' });
    assert.equal(a.last('error').code, 'no-game');
    a.send({ t: 'quick', game: 'chess', rules: 1 });
    assert.equal(a.last('error').code, 'bad-request');
    a.send({ t: 'join', game: 'feixingqi', rules: GAMES.feixingqi.rules, code: { $ne: 1 } });
    assert.equal(a.last('error').code, 'no-room');
    // 这些不回话也不出错
    const before = a.inbox.length;
    a.send({ t: 'idle', seq: 'x' });
    a.send({ t: 'leave' });
    a.send({ t: 'wait' });
    assert.equal(a.inbox.length, before);

    a.quick('feixingqi');
    assert.equal(a.last('queue').players[0].name, '玩家');
  });

  test('对局里乱发的动作只回 bad-action，不会把局面弄坏', (t) => {
    const w = world(t);
    const players = ['甲', '乙', '丙', '丁'].map((name) => new Player(w, name));
    for (const game of ['feixingqi', 'monopoly']) {
      for (const p of players) p.quick(game);
      const { room } = players[0];
      const mover = players.find((p) => p.seat === room.state.turn);
      const junk = [undefined, null, 5, 'roll', {}, { type: 'move' }, { type: 'move', plane: 9 }, { type: 'buy' }, { type: '__proto__' }];
      if (game === 'feixingqi') junk.push({ type: 'resign' }); // 大富翁的认输是合法的
      for (const action of junk) {
        const before = mover.all('error').length;
        mover.act(action);
        assert.equal(mover.all('error').length, before + 1, JSON.stringify(action));
        assert.equal(mover.last('error').code, 'bad-action');
      }
      assert.equal(room.log.length, 0);
      mover.act({ type: 'roll', value: 6, dice: [6, 6] });
      assert.equal(room.log.length, 1);
    }
  });
});
