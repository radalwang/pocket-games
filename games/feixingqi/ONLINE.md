# 飞行棋：联机怎么接

现在只能和电脑玩，但代码已经按联机的方式分好了层。以后接联机，主要是写一个联机通道（`link`）和一个服务器（或者让房主的手机当裁判），规则和界面不用重写。思路和大富翁（`games/monopoly/ONLINE.md`）一样。

## 现在的分层

```
界面 index.js ──roll() / move(飞机)──▶ 对局 match.js ──send──▶ link（联机通道，现在没有）
      ▲                                   │   ▲                      │
      └──── 事件 events（放动画） ◀────────┘   └──── receive(消息) ◀───┘
                                          │
                                  规则 rules.js（纯计算）
```

- **rules.js**：给开局设置、局面和动作，算出新局面和事件。不碰页面、不用随机数、不读时间，浏览器和 node 里结果一样，服务器可以直接拿来当裁判。
- **动作**都是普通 JSON：`{ type: 'roll', seat, value }`（掷骰子，点数写在动作里）和 `{ type: 'move', seat, plane }`（走哪架飞机）。`seat` 是 `config.players` 的下标。不合法的动作 `apply` 会抛 `RuleError`，局面不变。
- **骰子**：点数由掷的那一方用 `match.dice()` 生成，写进 `roll` 动作。要防作弊，就让服务器（或房主）统一生成点数：轮到谁掷，由服务器替他造好 `roll` 动作广播出去，动作格式不用变。
- **开局设置 `config`** 是各方共享的：规则版本、每方几架飞机、谁先走、各方颜色和名字。
- **座位由谁来下 `seats`** 是每台设备自己的看法，不共享：`local` 本机的人、`ai` 由本机替电脑走、`remote` 等别的设备发来。同一局里，你的手机上你是 `local`、对方是 `remote`，对方手机上正好反过来。电脑只由房主那台设备替它走，其他设备上它是 `remote`。界面只在 `local` 的座位上让人点骰子和飞机，轮到 `remote` 时显示「等某某方」。
- **存档就是同步数据**：`match.toJSON()` 是 `{ config, seats, log }`，读档时把 `log` 重放一遍。发给别的设备时只发 `config` 和 `log`（`seats` 各算各的）。
- **指纹**：`match.hash()` 是当前局面的指纹，各方隔几步对一下就知道有没有算岔。

## 消息格式（match.js）

所有消息都带 `protocol`（现在是 1），版本不同的设备不要互相接受。

| 消息 | 什么时候发 | 收到后 |
| --- | --- | --- |
| `{ kind: 'action', seq, action }` | 本机每走一步（`match` 自动通过 `link.send` 发出） | `seq` 正好等于本机已有的步数、而且轮到的是 `remote` 座位，才执行；否则丢掉 |
| `{ kind: 'sync', config, log }` | 刚加入、掉线重连、或者发现对不上时 | 先重放一遍验证，没问题就整个换掉 |
| `{ kind: 'check', seq, hash }` | 隔几步发一次 | `receive` 返回 `false` 表示指纹对不上，该请求一次 `sync` |

## 接联机要做的事

1. **写一个 link**，有两个方法：`send(message)` 把消息发出去；`onMessage(handler)` 收到消息时调用 `handler(message)`。WebSocket、WebRTC 都行。新建对局时传进去：
   ```js
   new Match({ config, seats, log, link })
   ```
2. **服务器（或房主）**：建房间、分座位、定 `config`（`newSetup` 能把座位表拆成 `config` 和本机的 `seats`）；转发 `action` 消息；可以用同一份 `rules.js` 先校验再转发，自己留一份权威局面。
3. **开局设置面板**：现在只有「对手几个电脑」，加上「邀请朋友」时，把那几个座位设成 `remote`。
4. **断线重连**：服务器把 `{ config, log }` 用 `sync` 消息发回来。
5. **限时和掉线**：服务器给每一步限时，超时替他掷骰子、按电脑的走法（`ai.js` 的 `chooseMove`）替他走；掉线太久就把那个座位交给电脑。
6. **规则版本**：`RULES_VERSION`（`config.rules`）不同的设备不能同桌。

## 已经验证过的

用两个 `Match` 通过一个本地的回环 link 互相连上、各自替自己的座位走，下了 50 局：每一步之后两边的局面都一样；故意丢掉一条消息时，序号对不上的那边发 `sync` 后马上补齐。
