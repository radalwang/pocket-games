// 本地存储：存档、最高分、最近玩过。所有数据只保存在这台设备上。
// 浏览器不让用 localStorage 时（比如无痕模式），退回到只在本次打开期间有效的内存存储。

const PREFIX = 'pg:';
const memory = new Map();

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return memory.has(key) ? memory.get(key) : fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    memory.set(key, value);
  }
}

export const changes = new EventTarget();
const notify = () => changes.dispatchEvent(new Event('change'));

export const progress = {
  // 存档：{ state, summary, finished, at }，state 的格式由各个游戏自己决定
  getSave: (id) => read(`save:${id}`, null),

  setSave(id, state, { summary = '', finished = false } = {}) {
    write(`save:${id}`, { state, summary, finished, at: Date.now() });
    notify();
  },

  getBest: (id) => read(`best:${id}`, 0),

  // 记录分数，返回更新后的最高分
  submitScore(id, score) {
    const best = progress.getBest(id);
    if (score <= best) return best;
    write(`best:${id}`, score);
    return score;
  },

  getRecent: () => read('recent', []),

  // 最后打开的游戏，继续游戏条显示的就是它
  getSession: () => read('session', null),

  touch(id) {
    write('recent', [id, ...progress.getRecent().filter((other) => other !== id)].slice(0, 12));
    write('session', id);
    notify();
  },

  // 清除存档、最高分和最近玩过，保留界面偏好
  clearAll() {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key.startsWith(PREFIX) && !key.startsWith(`${PREFIX}pref:`)) keys.push(key);
      }
      keys.forEach((key) => localStorage.removeItem(key));
    } catch {
      // localStorage 不可用，只需清内存
    }
    for (const key of [...memory.keys()]) if (!key.startsWith('pref:')) memory.delete(key);
    notify();
  },
};

export const prefs = {
  get: (key, fallback) => read(`pref:${key}`, fallback),
  set: (key, value) => write(`pref:${key}`, value),
};
