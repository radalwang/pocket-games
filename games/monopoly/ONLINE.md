# 大富翁：联机怎么接

现在只能在同一台手机上轮流玩、或者和电脑玩，但代码已经按联机的方式分好了层。以后接联机，主要是写一个联机用的 transport 和一个服务器，规则和界面不用重写。

## 现在的分层

```
界面 index.js ──submit(动作)──▶ 牌桌 table.js ──send──▶ transport
                                      ▲                    │
     ◀── 事件(events) + 新局面 ────────┴──receive(动作)◀────┘
                                      │
                               规则 engine.js（纯计算）
```

- **engine.js**：给局面和动作，算出新局面和事件。不碰页面、不读时间，浏览器和 node 里结果一样，服务器可以直接拿来当裁判。
- **动作**都是普通 JSON：`{ type, by }`。`type` 有 `roll`（掷骰子）、`buy` / `upgrade` / `pass`（买地、盖房、不要）、`resign`（认输）；`by` 是座位号。谁能在什么时候做什么，只看 `canAct(局面, 动作)`。
- **随机**：骰子和抽卡用的随机数存在局面的 `rng` 里。同一个种子、同一串动作，到哪台设备上算都是同一个局面。
- **table.js**：所有动作都经 `submit` 交给 transport，再由 transport 送回 `receive` 执行。现在的 `LocalTransport` 是原样马上送回来。动作带着提交时的 `rev`（局面已经执行了几个动作），过期、重复的动作会被丢掉。
- **座位由谁操作**（`table.controller(seat)`）：`local` 本机真人、`ai` 由本机替电脑出手、`remote` 等别的设备传动作过来。界面只给 `local` 的座位显示按钮；轮到 `remote` 时显示“等待某某”。
- **存档就是同步数据**：`table.snapshot()` 是 `{ v, config, seed, log }`（规则版本、开局设置、种子、全部动作），读档时用 `engine.replay` 重放。断线重连发的就是这一份。
- **指纹**：`table.hash()` / `engine.hashState()` 算出局面的指纹，各方对一下就知道有没有算岔。
- **开局设置**里每个座位已经有「联机」选项，现在是灰的。

## 接联机要做的事

1. **写一个联机 transport**（比如 WebSocket），和 `LocalTransport` 一样实现三个方法：
   - `connect(deliver)`：记住 `deliver`，收到服务器确认的动作时调用 `deliver(动作)`
   - `send(动作)`：发给服务器
   - `close()`：断开
2. **服务器**：建房间、分座位、给动作排先后（`rev` 不对的直接拒绝），确认后广播给房间里所有人。服务器可以用同一份 `engine.js` 先 `canAct` 校验、再自己执行一份权威局面。
3. **开局**：房主定好 `config`（每个座位的名字和 `kind: 'human' | 'ai'`），服务器生成种子，广播 `{ config, seed }`。每台设备：
   ```js
   new Table({ config, seed, transport, seats: [我的座位], hostsAI: 我是不是房主 })
   ```
   电脑座位只由房主那台设备出手，其他设备上它是 `remote`。
4. **断线重连**：服务器把 `{ config, seed, log }` 发回来，`new Table({ config, seed, log, ... })` 会把动作重放一遍。
5. **对指纹**：每隔几个动作各方发一次 `{ rev, hash }`，和服务器的不一样，就让服务器重新发完整数据。
6. **限时和掉线**：服务器给每一步限时，超时替他提交 `pass`（或 `roll`）；掉线太久就替他提交 `resign`。
7. **规则版本**：`RULES_VERSION` 不同的设备不能同桌（存档里的 `v` 也是它）。

## 防作弊（还没做）

种子公开的话，客户端能提前算出后面的骰子。朋友间玩无所谓；互不认识的人联机时：

- **骰子**：服务器自己保管种子，收到 `roll` 时补上点数再广播，即 `{ type: 'roll', by, dice: [a, b] }`。引擎已经支持：带了 `dice` 就用这个点数，不再用随机数。
- **抽卡**：机会、命运的牌堆顺序也来自随机数，还需要同样的处理（比如服务器在动作里带上抽到的是哪张）。这一步引擎还没做。

## 消息格式（草案）

| 方向 | 消息 |
| --- | --- |
| 客户端 → 服务器 | `{ t: 'join', room, name }` 进房间 |
| 服务器 → 客户端 | `{ t: 'seated', seat }` 分到的座位 |
| 服务器 → 所有人 | `{ t: 'start', config, seed }` 开局 |
| 客户端 → 服务器 | `{ t: 'act', action: { type, by, rev } }` 提交动作 |
| 服务器 → 所有人 | `{ t: 'act', action: { type, by, rev, dice? } }` 确定执行的动作 |
| 服务器 → 客户端 | `{ t: 'sync', v, config, seed, log }` 重连、纠错 |
| 双向 | `{ t: 'hash', rev, hash }` 对指纹 |
