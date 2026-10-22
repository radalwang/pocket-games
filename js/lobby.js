// 联机大厅：昵称、快速匹配、创建 / 加入房间，凑齐人开局后把连接交给游戏。两款联机游戏共用，样式在 app.css 的「联机大厅」。
//
// 用法：const lobby = openLobby(容器, { game, rules, title, options, onStart, onBack, onSolo })
//   options  房主能改的设置：[{ key, label, choices: [{ value, label }], value }]，比如飞行棋的飞机数
//   onStart(connection, start)  开局了：start 是服务器的 start 消息（见 server/PROTOCOL.md），连接从此归游戏管
//   onBack()  玩家点了返回，回到游戏自己的开局设置
//   onSolo()  快速匹配只等到自己、选了「和电脑玩」
// 游戏被关掉时调 lobby.close()，会断开还没交出去的连接。

import { Connection, NAME_MAX, nickname, setNickname } from './online.js';
import { esc, toast } from './ui.js';

const QUICK_NOTE = '凑满 4 人马上开始，30 秒凑不齐由电脑补位';

export function openLobby(host, { game, rules, title, options = [], onStart, onBack, onSolo }) {
  const panel = document.createElement('div');
  panel.className = 'lobby';
  host.replaceChildren(panel);

  const conn = new Connection();
  const offs = [];
  let view = 'connecting';
  let status = null; // 最近一次 queue / room 消息
  let deadline = 0;
  let ticker = 0;
  let closed = false;

  const send = (message) => conn.send(message);

  function render(next = view) {
    view = next;
    clearInterval(ticker);
    ticker = 0;
    panel.innerHTML = VIEWS[view]();
    if (view === 'queue') {
      ticker = setInterval(tick, 250);
      tick();
    }
    panel.querySelector('[autofocus]')?.focus();
  }

  function tick() {
    const el = panel.querySelector('[data-countdown]');
    if (!el) return;
    const left = Math.ceil(Math.max(0, deadline - Date.now()) / 1000);
    el.textContent = left > 0 ? `还有 ${left} 秒电脑补位` : '正在开局…';
  }

  const seatList = (players, seats, empty) => `
    <ul class="lobby-seats">
      ${Array.from({ length: seats }, (_, k) => {
        const p = players[k];
        if (!p) return `<li class="is-empty">${empty}</li>`;
        const tags = [p.me && '你', p.host && '房主'].filter(Boolean).map((t) => `<em>${t}</em>`).join('');
        return `<li><span>${esc(p.name)}</span>${tags}</li>`;
      }).join('')}
    </ul>`;

  const seg = (key, choices, value) => `
    <div class="lobby-seg" data-key="${key}">
      ${choices.map((c) => `<button data-value="${c.value}"${c.value === value ? ' class="is-active"' : ''}>${esc(c.label)}</button>`).join('')}
    </div>`;

  const VIEWS = {
    connecting: () => `
      <h3>联机对战</h3>
      <p class="lobby-wait"><span class="lobby-spinner"></span>正在连接服务器…</p>`,

    error: () => `
      <h3>联机对战</h3>
      <p>${esc(status?.message ?? '连不上联机服务器')}</p>
      <div class="lobby-row">
        <button class="lobby-btn" data-act="back">返回</button>
        ${status?.retry === false ? '' : '<button class="lobby-btn is-primary" data-act="retry">重试</button>'}
      </div>`,

    menu: () => `
      <h3>联机对战</h3>
      <p>和别人一起玩${esc(title)}</p>
      <label class="lobby-name"><span>昵称</span><input data-name maxlength="${NAME_MAX}" value="${esc(nickname())}" enterkeyhint="done" autocomplete="off"></label>
      <button class="lobby-btn is-primary" data-act="quick">快速匹配</button>
      <p class="lobby-note">${QUICK_NOTE}</p>
      <div class="lobby-row">
        <button class="lobby-btn" data-act="create">创建房间</button>
        <button class="lobby-btn" data-act="join">加入房间</button>
      </div>
      <button class="lobby-link" data-act="back">返回</button>`,

    queue: () => `
      <h3>正在匹配…</h3>
      ${seatList(status.players, status.seats, '等待中…')}
      <p class="lobby-note" data-countdown></p>
      <button class="lobby-btn" data-act="cancel">取消</button>`,

    alone: () => `
      <h3>暂时只有你一个人</h3>
      <p>可以继续等别人，也可以先和电脑玩</p>
      <div class="lobby-row">
        <button class="lobby-btn" data-act="solo">和电脑玩</button>
        <button class="lobby-btn is-primary" data-act="wait">继续等</button>
      </div>
      <button class="lobby-link" data-act="cancel">取消</button>`,

    join: () => `
      <h3>加入房间</h3>
      <p>输入朋友给你的 4 位房间号</p>
      <input class="lobby-code-input" data-code inputmode="numeric" pattern="[0-9]*" maxlength="4" autocomplete="off" autofocus aria-label="房间号">
      <button class="lobby-btn is-primary" data-act="enter">加入</button>
      <button class="lobby-link" data-act="menu">返回</button>`,

    room: () => {
      const humans = status.players.length;
      const hostControls = status.host ? `
        <div class="lobby-field"><span>人数</span>${seg('seats', [2, 3, 4].map((n) => ({ value: n, label: `${n} 人` })), status.seats)}</div>
        ${options.map((o) => `<div class="lobby-field"><span>${esc(o.label)}</span>${seg(o.key, o.choices, status.options?.[o.key])}</div>`).join('')}
        <button class="lobby-btn is-primary" data-act="start"${humans < 2 ? ' disabled' : ''}>${humans < 2 ? '等朋友加入…' : '开始'}</button>`
        : '<p class="lobby-wait"><span class="lobby-spinner"></span>等房主开始…</p>';
      return `
        <h3>房间号</h3>
        <p class="lobby-code">${esc(status.code)}</p>
        <p class="lobby-note">把房间号告诉朋友，在「加入房间」里输入</p>
        ${seatList(status.players, status.seats, '空位 · 开局时电脑补上')}
        ${hostControls}
        <button class="lobby-link" data-act="cancel">离开房间</button>`;
    },
  };

  async function connect() {
    render('connecting');
    try {
      await conn.connect();
    } catch (err) {
      if (closed) return;
      status = { message: err.message, retry: err.code !== 'no-server' };
      render('error');
      return;
    }
    if (closed) return conn.close();
    render('menu');
  }

  // ---------- 服务器消息 ----------

  offs.push(conn.on('queue', (m) => {
    status = m;
    deadline = Date.now() + m.ms;
    render('queue');
  }));
  offs.push(conn.on('alone', () => render('alone')));
  offs.push(conn.on('room', (m) => {
    status = m;
    render('room');
  }));
  offs.push(conn.on('error', (m) => {
    if (m.code === 'version') {
      status = { message: m.message, retry: false };
      render('error');
    } else {
      toast(m.message);
    }
  }));
  offs.push(conn.on('close', () => {
    status = { message: '和联机服务器断开了' };
    render('error');
  }));
  offs.push(conn.on('start', (m) => {
    finish();
    onStart(conn, m);
  }));

  // ---------- 点按 ----------

  function joinWithCode() {
    const input = panel.querySelector('[data-code]');
    const code = input.value.replace(/\D/g, '');
    if (code.length !== 4) {
      toast('房间号是 4 位数字');
      input.focus();
      return;
    }
    send({ t: 'join', game, rules, code });
  }

  const ACTIONS = {
    back: () => {
      close();
      onBack();
    },
    retry: connect,
    menu: () => render('menu'),
    quick: () => send({ t: 'quick', game, rules }),
    create: () => send({ t: 'create', game, rules, seats: 4, options: Object.fromEntries(options.map((o) => [o.key, o.value])) }),
    join: () => render('join'),
    enter: joinWithCode,
    cancel: () => {
      send({ t: 'leave' });
      render('menu');
    },
    wait: () => send({ t: 'wait' }),
    solo: () => {
      close();
      onSolo();
    },
    start: () => send({ t: 'start' }),
  };

  panel.addEventListener('click', (e) => {
    const button = e.target.closest('button');
    if (!button || button.disabled) return;
    const choice = button.closest('[data-key]');
    if (choice) {
      const key = choice.dataset.key;
      const value = Number(button.dataset.value);
      send(key === 'seats' ? { t: 'configure', seats: value } : { t: 'configure', options: { ...status.options, [key]: value } });
      return;
    }
    ACTIONS[button.dataset.act]?.();
  });

  // 昵称改完（失焦或按完成）就存下来并告诉服务器
  panel.addEventListener('change', (e) => {
    if (!e.target.matches('[data-name]')) return;
    e.target.value = setNickname(e.target.value);
    send({ t: 'name', name: e.target.value });
  });

  panel.addEventListener('input', (e) => {
    if (!e.target.matches('[data-code]')) return;
    e.target.value = e.target.value.replace(/\D/g, '').slice(0, 4);
    if (e.target.value.length === 4) joinWithCode();
  });

  panel.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    if (e.target.matches('[data-name]')) e.target.blur();
    if (e.target.matches('[data-code]')) joinWithCode();
  });

  // 开局后：大厅退场，连接留给游戏
  function finish() {
    closed = true;
    clearInterval(ticker);
    offs.forEach((off) => off());
  }

  function close() {
    if (closed) return;
    finish();
    conn.close();
  }

  connect();
  return { close };
}
