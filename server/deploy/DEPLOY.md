# 把联机服务器搬到香港云服务器上

这份说明从买服务器开始，一步一步把大富翁和飞行棋的联机服务器部署好。做完以后：

- `https://你的域名/` 直接就是一份完整的游戏，大陆打开比 github.io 稳；
- `wss://你的域名/online` 是联机地址，github.io 上的游戏和新域名上的游戏都连它。

花费大约是服务器每月 ¥30、域名每年几十元。动手的时间一个小时左右，另外域名实名认证要等 1～3 天，可以先把域名买了。

下文用 `game.example.com` 代表你的域名，`1.2.3.4` 代表服务器的公网 IP，照着做的时候换成自己的。

```
手机 ──https / wss──▶ Caddy（443 端口，自动申请 https 证书）──▶ 联机服务器 node server.js（本机 8787 端口）
```

这个文件夹里的几个文件：

```
DEPLOY.md              这份说明
pocket-games.service   让联机服务器开机自动运行、崩了自动重启（systemd 服务）
Caddyfile              Caddy 的配置：https 证书，把请求转给联机服务器
update.sh              以后更新用：拉代码、装依赖、重启
```

**开始前**：服务器是从 GitHub 下载代码的，所以先把联机相关的所有改动（`server/`、`server/deploy/`、`js/online.js`、`js/lobby.js` 和两款游戏的改动）都提交并推送到 GitHub。

## 1. 买服务器

腾讯云和阿里云都可以，选一家就行。两家都要先完成账号实名认证。

- **腾讯云**：产品里找「轻量应用服务器」→ 新建。地域选「中国香港」；镜像选「系统镜像」里的 **Ubuntu 24.04 LTS**（没有就选 22.04）；套餐选最便宜的一档就够。
- **阿里云**：产品里找「轻量应用服务器」→ 创建。地域选「中国香港」；镜像选「系统镜像」里的 **Ubuntu 24.04**（没有就选 22.04）；套餐同样选最便宜的。

不要选带宝塔、WordPress 之类的「应用镜像」，它们会占用 80 和 443 端口。

买好后，在服务器详情页记下两样东西：

1. **公网 IP**，比如 `1.2.3.4`。
2. **登录用户名和密码**：点「重置密码」设一个密码。腾讯云的 Ubuntu 用户名是 `ubuntu`，阿里云一般是 `root`（以重置密码页面上写的为准）。密码设长一点（16 位以上），香港的服务器一上线就会有人不停地来试密码。

### 打开 80 和 443 端口

在服务器详情页找到「防火墙」（阿里云在「安全」→「防火墙」下面），确认有这两条「允许」规则，没有就点「添加规则」加上：

| 应用类型 | 协议 | 端口 |
| --- | --- | --- |
| HTTP | TCP | 80 |
| HTTPS | TCP | 443 |

22 端口（SSH 登录用）默认是开着的，不要删。**不要**开 8787：联机服务器只让本机的 Caddy 访问。

## 2. 买域名，指向服务器

1. 在腾讯云（DNSPod）或阿里云（万网）买一个域名，后缀随意，`.com` 最常见。
2. 按提示给域名做实名认证。审核通过前域名是解析不了的，一般要 1～3 个工作日。服务器在香港，**不需要** ICP 备案。
3. 到域名的「解析」页面，添加一条记录：

| 主机记录 | 记录类型 | 记录值 |
| --- | --- | --- |
| `game` | A | 服务器公网 IP，比如 `1.2.3.4` |

主机记录填 `game`，地址就是 `game.你的域名.com`；想直接用 `你的域名.com`，主机记录填 `@`。其它选项保持默认。

**也可以在 Cloudflare 买域名**（dash.cloudflare.com →「域注册」）：按成本价卖，不用实名，买完马上能用，但要用能付美元的信用卡或 PayPal。解析在 Cloudflare 的「DNS」→「记录」里加：类型 `A`，名称 `game`，IPv4 地址填服务器公网 IP，**代理状态一定要关掉，选「仅 DNS」（灰色云朵）**。开着代理（橙色云朵）的话，大陆玩家的请求会绕到 Cloudflare 的海外节点，又慢又不稳，联机会经常断。

过几分钟，在 Mac 的「终端」里检查一下：

```bash
dig +short game.example.com
```

显示的是服务器的公网 IP 就对了。什么都不显示的话，再等一会儿，或者检查实名认证是否已经通过。

## 3. 登录服务器

在 Mac 上打开「终端」App。腾讯云：

```bash
ssh ubuntu@1.2.3.4
```

阿里云用 `root`：

```bash
ssh root@1.2.3.4
```

第一次连会问 `Are you sure you want to continue connecting`，输入 `yes` 回车。然后输入密码，输入时屏幕上不会显示任何字符，输完直接回车。看到 `ubuntu@...:~$` 或 `root@...:~#` 这样的提示符就是登录成功了。

也可以直接点控制台服务器详情页上的「登录」（阿里云叫「远程连接」），在网页里打开同样的命令行窗口。

后面的命令都在这个窗口里一条一条输入。用 root 登录的话，命令前面的 `sudo` 照打也没关系。登录时或装软件时如果看到 `setlocale`、`locale` 之类的警告，不用管，不影响使用。

## 4. 装 git 和 Node.js

先更新系统：

```bash
sudo apt update
```

```bash
sudo apt upgrade -y
```

可能要几分钟。中途可能遇到这几种情况：

- 停在 `Waiting for cache lock`：系统正在后台自动更新，等它几分钟就会继续。
- 出现紫色的对话框，问要不要重启某些服务或者提示内核更新：直接按回车。
- 问要不要替换 `sshd_config` 之类的配置文件：直接按回车（保留现有的）。

更新完重启一次服务器，等一分钟再用上一步的 ssh 命令重新登录：

```bash
sudo reboot
```

装 git 和 curl：

```bash
sudo apt install -y git curl
```

装 Node.js 24（Ubuntu 自带的版本太旧，这里用 NodeSource 的安装源）：

```bash
curl -fsSL https://deb.nodesource.com/setup_24.x -o nodesource_setup.sh
```

```bash
sudo -E bash nodesource_setup.sh
```

```bash
sudo apt install -y nodejs
```

检查一下：

```bash
node -v
```

显示 `v24.` 开头的版本号就对了。服务器要求 Node.js 20 以上，但 20 已经停止维护，所以直接装 24。

## 5. 下载代码

联机服务器不用 root 运行，而是用一个专门的用户 `pocketgames`，它不能登录，只用来跑服务器。代码放在 `/srv/pocket-games`，归这个用户所有。

```bash
sudo useradd --system --user-group --create-home --home-dir /var/lib/pocketgames --shell /usr/sbin/nologin pocketgames
```

```bash
sudo mkdir /srv/pocket-games
```

```bash
sudo chown pocketgames:pocketgames /srv/pocket-games
```

下载代码（以 `pocketgames` 的身份）：

```bash
sudo -u pocketgames -H git clone https://github.com/radalwang/pocket-games.git /srv/pocket-games
```

装服务器的依赖：

```bash
cd /srv/pocket-games/server
```

```bash
sudo -u pocketgames -H npm ci --omit=dev
```

最后一行显示 `added 1 package` 之类的就好了。

## 6. 让联机服务器一直运行

把服务文件装到系统里：

```bash
sudo cp /srv/pocket-games/server/deploy/pocket-games.service /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload
```

启动它，并设成开机自动启动：

```bash
sudo systemctl enable --now pocket-games
```

看看状态：

```bash
sudo systemctl status pocket-games --no-pager
```

看到绿色的 `active (running)`，下面有一行 `口袋游戏联机服务器：http://127.0.0.1:8787（联机连 /online，榜单在 /api/）`，就说明跑起来了。再在服务器上试着取一下首页：

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/
```

显示 `200` 就对了。

## 7. 装 Caddy，开 https

Caddy 负责 https：它会自动申请和续期证书，再把所有请求转给 8787 端口的联机服务器。联机用的 WebSocket 也会原样转过去，不用额外设置。

**开始这一步前**，先确认第 2 步的 `dig +short` 已经能显示服务器 IP。域名还没解析好就装，证书会申请失败，而且 Caddy 失败后会隔越来越久才重试。

照 Caddy 官网的步骤安装，一条一条输入：

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
```

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
```

```bash
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
```

```bash
sudo chmod o+r /usr/share/keyrings/caddy-stable-archive-keyring.gpg
```

```bash
sudo chmod o+r /etc/apt/sources.list.d/caddy-stable.list
```

```bash
sudo apt update
```

```bash
sudo apt install -y caddy
```

装好后 Caddy 已经在运行了，接下来换上我们的配置：

```bash
sudo cp /srv/pocket-games/server/deploy/Caddyfile /etc/caddy/Caddyfile
```

```bash
sudo nano /etc/caddy/Caddyfile
```

找到 `game.example.com {` 这一行，把 `game.example.com` 改成你自己的域名（后面的 `{` 留着）。按 Ctrl+O、回车保存，再按 Ctrl+X 退出。

让 Caddy 用新配置：

```bash
sudo systemctl reload caddy
```

没有任何输出就是成功了。如果报错，多半是 Caddyfile 改错了，再用 nano 打开检查一下。

## 8. 检查一下

**网页**：用手机或电脑打开 `https://game.example.com/`（换成你的域名），能看到游戏首页，地址栏有小锁，就说明域名、证书、服务器都通了。上一步 reload 之后 Caddy 要花十几秒到一分钟申请证书，这期间打开会报错，稍等再刷新。

这时候游戏里的联机还用不了，会提示「联机服务器还没上线」，因为游戏还不知道服务器地址，第 9 步再填。

**联机通道**：在 Mac 的终端里运行下面这条（把域名换成你的），它会在 3 秒后自己结束：

```bash
curl --http1.1 -s -i -N -m 3 -H "Connection: Upgrade" -H "Upgrade: websocket" -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" https://game.example.com/online
```

第一行是 `HTTP/1.1 101 Switching Protocols` 就说明联机通道通了。

**服务器状态和日志**（在服务器上）：

```bash
sudo systemctl status pocket-games --no-pager
```

```bash
sudo journalctl -u pocket-games -n 50 --no-pager
```

想一直盯着日志看，用下面这条，按 Ctrl+C 退出：

```bash
sudo journalctl -u pocket-games -f
```

Caddy 的日志（证书申请失败时看这里）：

```bash
sudo journalctl -u caddy -n 50 --no-pager
```

## 9. 让游戏连上这台服务器

回到 Mac 上的项目，打开 `js/online.js`，把

```js
const PRODUCTION_SERVER = '';
```

改成（换成你的域名）：

```js
const PRODUCTION_SERVER = 'wss://game.example.com/online';
```

然后按 README 里「发布新版本」的步骤发一版：改 `sw.js` 和 `js/settings.js` 里的 `VERSION`，提交并推送到 GitHub。

推送后，再到服务器上跑一次更新，让新域名上的网页也是新版（见下一节）：

```bash
bash /srv/pocket-games/server/deploy/update.sh
```

最后用两台手机（或者手机加电脑）试一下：都打开游戏，进大富翁或飞行棋，点「快速匹配」，应该能匹配到一起。手机上如果还是旧版本，到设置里点「检查更新」。

## 10. 以后怎么更新

每次发新版本，照常推送到 GitHub 后，登录服务器跑一次：

```bash
bash /srv/pocket-games/server/deploy/update.sh
```

它会拉最新代码、装依赖、重启联机服务器，最后检查服务器有没有正常跑起来。用 `ubuntu` 或 `root` 登录都可以直接跑，不用加 sudo。

要注意：

- **重启会断开正在进行的联机对局**，挑没人玩的时候跑。
- **发版后尽快更新服务器**。大富翁或飞行棋的规则改过的话，新版游戏和旧服务器凑不到一起，会提示「游戏版本和服务器对不上，请先更新」。
- update.sh 如果提示 `pocket-games.service 有改动`，或者你改过 `Caddyfile`，要手动重新装一下，见下面。
- 不要直接在服务器上改代码，不然 `git pull` 会拒绝更新。

**`pocket-games.service` 改过时**，复制过去，再让 systemd 重新读一遍并重启：

```bash
sudo cp /srv/pocket-games/server/deploy/pocket-games.service /etc/systemd/system/
```

```bash
sudo systemctl daemon-reload
```

```bash
sudo systemctl restart pocket-games
```

**`Caddyfile` 改过时**，重做第 7 步最后那三条命令：`cp`、`nano`（把 `game.example.com` 改回你的域名，这一步千万别漏，不然网站会打不开）、`reload`。

系统本身的安全更新 Ubuntu 会自动装。隔几个月可以手动全面更新一次（包括 Node.js），然后重启联机服务器：

```bash
sudo apt update && sudo apt upgrade -y
```

```bash
sudo systemctl restart pocket-games
```

## 11. 大陆玩家直接用这个域名玩

github.io 在大陆时好时坏。这台服务器本身就会把整个游戏当网页发出来，所以 `https://game.example.com/` 就是一份完整的游戏，大陆打开更稳。可以把这个地址发给朋友，让他们用 Safari 打开后「添加到主屏幕」。

要知道的是：**从 github.io 装到主屏幕的和从新域名装的是两个不同的 App**，存档、最高分、联机昵称各存各的，互相看不到。已经从 github.io 装过的人改用新域名，旧存档不会跟过来。两边都能联机，连的是同一台服务器，可以互相匹配到。

## 出问题时

**`https://game.example.com/` 打不开**

1. 在 Mac 上 `dig +short game.example.com`，看显示的是不是服务器 IP。不是的话检查域名解析和实名认证。
2. 检查第 1 步里防火墙的 80 和 443 有没有开。
3. 看 Caddy 的日志 `sudo journalctl -u caddy -n 50 --no-pager`，证书申请失败会写在这里。如果是因为域名当时还没解析好，现在 `dig` 已经正常了，就用 `sudo systemctl restart caddy` 让它马上重新申请。
4. 少数镜像会开着 Ubuntu 自己的防火墙。运行 `sudo ufw status`，如果显示 `Status: active`，就用 `sudo ufw allow 80,443/tcp` 放行。

**网页打开是 502 错误**：Caddy 正常，但联机服务器没在运行。用 `sudo systemctl status pocket-games --no-pager` 和 `sudo journalctl -u pocket-games -n 50 --no-pager` 看原因。

**游戏里提示「联机服务器还没上线」**：`js/online.js` 里的 `PRODUCTION_SERVER` 还是空的，或者手机上还是旧版本（设置里点「检查更新」）。

**游戏里提示「连不上联机服务器」**：检查 `PRODUCTION_SERVER` 有没有写错（应该是 `wss://` 开头、`/online` 结尾），再用第 8 步的 curl 命令试一下联机通道。

**update.sh 拉代码时报错**（`Not possible to fast-forward` 或 `Your local changes would be overwritten`）：服务器上的代码被改动过，或者 GitHub 上的提交历史被改写过（比如 force push）。用下面这条看看情况：

```bash
sudo -u pocketgames -H git -C /srv/pocket-games status
```

确认服务器上没有需要保留的改动后，让它和 GitHub 上的完全一样，再重新跑 update.sh：

```bash
sudo -u pocketgames -H git -C /srv/pocket-games fetch
```

```bash
sudo -u pocketgames -H git -C /srv/pocket-games reset --hard origin/main
```
