// 全网榜单：每台设备在每个榜上只留最好的一次成绩，按 js/boards.js 的规则排名。
//
// 没有账号，一台设备就是一个人：手机第一次上传时随机生成 device，之后一直用它（换手机、删掉 App 就是新的人）。
// device 只在上传和查自己名次时用，不会出现在榜单上；榜单上显示的是昵称，改了昵称所有榜上一起变。
//
// 数据放在内存里，改动后过两秒整个写进 DATA_DIR/scores.json（先写临时文件再改名，写一半断电也不会坏）。
// 简单防作弊：成绩要在 boards.js 的合理范围内；同一台设备一分钟最多传 30 次。

import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beats, boardOf, plausible } from '../js/boards.js';
import { cleanName } from './hub.js';

const TOP = 100; // 榜单显示前多少名
const SAVE_DELAY = 2_000;
const RATE_WINDOW = 60_000;
const RATE_LIMIT = 30;
const DEVICE = /^[0-9a-f]{32}$/;

export class ScoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export class Scores {
  // dir 为空时只放内存（测试用）
  constructor({ dir = null, now = Date.now } = {}) {
    this.dir = dir;
    this.now = now;
    this.boards = new Map(); // 「游戏:榜」→ Map(device → { value, at })
    this.names = new Map(); // device → 昵称
    this.sorted = new Map(); // 排好序的缓存，榜单有变动就丢掉
    this.recent = new Map(); // device → 最近一分钟上传的时间
    this.timer = null;
    if (dir) this.load();
  }

  load() {
    let data;
    try {
      data = JSON.parse(readFileSync(join(this.dir, 'scores.json'), 'utf8'));
    } catch {
      return; // 第一次跑，还没有文件
    }
    for (const [device, name] of Object.entries(data.names ?? {})) this.names.set(device, name);
    for (const [id, entries] of Object.entries(data.boards ?? {})) this.boards.set(id, new Map(Object.entries(entries)));
  }

  save() {
    if (!this.dir || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush();
    }, SAVE_DELAY);
  }

  flush() {
    if (!this.dir) return;
    const data = {
      version: 1,
      names: Object.fromEntries(this.names),
      boards: Object.fromEntries([...this.boards].map(([id, entries]) => [id, Object.fromEntries(entries)])),
    };
    mkdirSync(this.dir, { recursive: true });
    const file = join(this.dir, 'scores.json');
    writeFileSync(`${file}.tmp`, JSON.stringify(data));
    renameSync(`${file}.tmp`, file);
  }

  // 上传一个成绩：比自己以前的好才记下。返回这个榜上自己现在的名次
  submit({ device, name, game, board: key, value }) {
    const board = this.check(game, key, device);
    if (!plausible(board, value)) throw new ScoreError(422, '这个成绩不太可能');
    this.limit(device);
    this.setName(device, name);
    const id = `${game}:${key}`;
    if (!this.boards.has(id)) this.boards.set(id, new Map());
    const entries = this.boards.get(id);
    const old = entries.get(device);
    if (beats(board, value, old?.value)) {
      entries.set(device, { value, at: this.now() });
      this.sorted.delete(id);
      this.save();
    }
    return this.mine(game, key, device);
  }

  setName(device, name) {
    const clean = cleanName(name);
    if (this.names.get(device) === clean) return;
    this.names.set(device, clean);
    this.save();
  }

  rename(device, name) {
    if (!DEVICE.test(String(device))) throw new ScoreError(400, '设备标识不对');
    this.limit(device);
    this.setName(device, name);
  }

  // 前 100 名，加上这台设备自己的名次（不在前 100 也给）
  top(game, key, device = null) {
    this.check(game, key, null);
    const list = this.ranking(game, key);
    const entries = list.slice(0, TOP).map((entry, k) => ({
      rank: k + 1, name: this.names.get(entry.device) ?? '玩家', value: entry.value, me: entry.device === device,
    }));
    return { total: list.length, entries, mine: device ? this.mine(game, key, device) : null };
  }

  mine(game, key, device) {
    const list = this.ranking(game, key);
    const index = list.findIndex((entry) => entry.device === device);
    return index < 0 ? null : { rank: index + 1, value: list[index].value, total: list.length };
  }

  // 排序：成绩好的在前，一样好的先达到的在前
  ranking(game, key) {
    const id = `${game}:${key}`;
    if (!this.sorted.has(id)) {
      const board = boardOf(game, key);
      const list = [...(this.boards.get(id) ?? [])].map(([device, { value, at }]) => ({ device, value, at }));
      list.sort((a, b) => (board.lower ? a.value - b.value : b.value - a.value) || a.at - b.at);
      this.sorted.set(id, list);
    }
    return this.sorted.get(id);
  }

  check(game, key, device) {
    const board = boardOf(game, key);
    if (!board) throw new ScoreError(404, '没有这个榜单');
    if (device !== null && !DEVICE.test(String(device))) throw new ScoreError(400, '设备标识不对');
    return board;
  }

  limit(device) {
    const now = this.now();
    const times = (this.recent.get(device) ?? []).filter((t) => now - t < RATE_WINDOW);
    if (times.length >= RATE_LIMIT) throw new ScoreError(429, '传得太频繁了，过一会儿再试');
    times.push(now);
    this.recent.set(device, times);
    // 记录太多时清掉一分钟前的，免得内存越用越多
    if (this.recent.size > 10_000) {
      for (const [id, list] of this.recent) if (now - list[list.length - 1] >= RATE_WINDOW) this.recent.delete(id);
    }
  }
}
