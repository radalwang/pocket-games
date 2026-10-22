# 联机服务器：怎么跑、消息格式

## 本机跑起来

```
cd server
npm install
npm start
```

服务器在 8787 端口：联机连 `ws://localhost:8787/online`，其他路径会把整个游戏当网页发出去（上线时一台服务器就能同时放网页和联机）。游戏页面开在 localhost 或局域网地址上时，`js/online.js` 会自动连这台电脑的 8787 端口；正式上线前要在那里填上服务器的域名。

## 谁说了算

服务器保管每一局的权威局面，用的就是游戏自己的规则文件（`games/feixingqi/rules.js`、`games/monopoly/engine.js`）：

- 客户端只发“我想做什么”（意图），服务器检查合不合法、**掷骰子**，再把确定的动作按顺序广播给桌上所有人，**包括发出的那个人**。客户端只执行服务器广播的动作，自己不先走。
- 电脑座位、掉线的人、超时的人都由服务器替他走（用游戏自己的 `ai.js`）。
- 每广播一个动作，服务器先等在场的人把动画放完（客户端发 `idle`，最多等 6 秒），再让下一个人出手、开始计时。
- 限时：飞行棋每步 15 秒，大富翁每步 30 秒，超时按电脑的走法替他走。

## 消息

都是 JSON，`t` 是消息类型。连上后第一条必须是 `hello`。

### 客户端 → 服务器

| 消息 | 说明 |
| --- | --- |
| `{ t: 'hello', protocol: 1, name }` | 打招呼，带上昵称（最多 8 个字） |
| `{ t: 'name', name }` | 改昵称（大厅里马上生效） |
| `{ t: 'quick', game, rules }` | 快速匹配。`game` 是 `feixingqi` / `monopoly`，`rules` 是规则版本，不同版本不会凑到一桌 |
| `{ t: 'wait' }` | 收到 `alone` 后选择继续等，重新倒计时 30 秒 |
| `{ t: 'create', game, rules, seats, options }` | 开房间。`seats` 2～4，空位开局时用电脑补；`options`：飞行棋 `{ planes: 4 \| 2 }`，大富翁 `{ rounds: 20 \| 40 \| 0 }` |
| `{ t: 'join', game, rules, code }` | 输房间码加入 |
| `{ t: 'configure', seats?, options? }` | 房主改设置 |
| `{ t: 'start' }` | 房主开局，至少两个真人 |
| `{ t: 'leave' }` | 离开排队、房间或对局。对局里离开后座位由电脑代打，凭 token 还能回来 |
| `{ t: 'resume', room, token }` | 回到对局（重新打开 App、断线重连、从后台切回来） |
| `{ t: 'act', action }` | 想做的动作，座位由服务器按连接认定。飞行棋：`{ type: 'roll' }`、`{ type: 'move', plane }`；大富翁：`{ type: 'roll' \| 'buy' \| 'upgrade' \| 'pass' \| 'resign' }`（认输随时都能发） |
| `{ t: 'idle', seq }` | 动画放完了，已经执行到第 `seq` 个动作（就是本机 log 的长度） |

### 服务器 → 客户端

| 消息 | 说明 |
| --- | --- |
| `{ t: 'hello', protocol: 1 }` | 招呼成功 |
| `{ t: 'error', code, message }` | 出错。`code`：`version` 版本不对、`no-room` 没有这个房间、`full` 满了、`started` 已开始、`not-host` 不是房主、`alone` 人不够、`no-game` 对局已经没有了、`bad-action` 动作不合法、`bad-request`、`server`。`message` 可以直接给玩家看 |
| `{ t: 'queue', game, players, seats, ms }` | 快速匹配排队状态。`players: [{ name, me }]`，`ms` 是离电脑补位还剩多少毫秒 |
| `{ t: 'alone' }` | 倒计时到了只有你一个人：回 `wait` 继续等，或 `leave` 后自己和电脑玩 |
| `{ t: 'room', game, code, host, players, seats, options }` | 房间状态。`host` 表示你是不是房主，`players: [{ name, me, host }]` |
| `{ t: 'start', game, room, token, seat, players, log, ...开局数据 }` | 开局或回到对局。`seat` 是你的座位，`players: [{ name, ai, away }]` 按座位排；`log` 是到现在为止的全部动作（重连时直接重放）。开局数据：飞行棋 `{ config }`，大富翁 `{ config, seed }`。`room` 和 `token` 要存进存档，回来时用 |
| `{ t: 'act', seq, action }` | 确定执行的第 `seq` 个动作（从 0 开始）。飞行棋 `{ type: 'roll', seat, value }` / `{ type: 'move', seat, plane }`；大富翁 `{ type, by, rev, dice? }`，`rev` 等于 `seq` |
| `{ t: 'turn', seat, ms }` | 开始给在场的真人计时，`ms` 是这一步还剩多少毫秒。电脑和掉线的座位不发 |
| `{ t: 'presence', seat, away }` | 有人掉线（`away: true`，之后电脑代打）或回来了 |

## 存档和重连

客户端把 `start` 里的 `room`、`token` 存进存档。App 被关掉、切到后台、网断了以后回来，就用 `resume` 回到对局，服务器会回一条完整的 `start`。服务器重启或这一局已经结束太久时会回 `error: no-game`，这时提示“这局联机已经结束”，回到开局设置。

## 测试

`hub.js` 不碰网络，测试时用 `hub.open(send)` 造几个假的客户端、换上假时钟就能把整局跑完。
