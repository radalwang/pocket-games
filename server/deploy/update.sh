#!/usr/bin/env bash
# 在服务器上更新口袋游戏：拉最新代码、装依赖、重启联机服务器。用法见 DEPLOY.md 的「以后怎么更新」。
#
#   bash /srv/pocket-games/server/deploy/update.sh
#
# 用登录的用户（ubuntu 或 root）直接跑就行。git 和 npm 会以仓库主人 pocketgames 的身份执行，
# 免得文件主人被弄乱。重启会断开正在进行的联机对局，挑没人玩的时候跑。

set -euo pipefail

SERVICE=pocket-games
PORT=8787 # 和 pocket-games.service 里的 PORT 一样

# 整个脚本包在 main 里：git pull 可能会改到这个文件本身，先读完再执行就不怕
main() {
  local repo owner
  repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  owner="$(stat -c %U "$repo")"

  as_owner() {
    if [ "$(id -un)" = "$owner" ]; then
      "$@"
    else
      sudo -u "$owner" -H "$@"
    fi
  }

  echo "==> 拉取最新代码（$repo）"
  as_owner git -C "$repo" pull --ff-only
  as_owner git -C "$repo" log -1 --format='    现在是 %h %s'

  echo "==> 安装依赖"
  cd "$repo/server"
  if ! as_owner npm ci --omit=dev; then
    echo "==> 依赖没装好，服务器还在用旧版本跑，先别重启它。网络正常后再运行一次这个脚本。" >&2
    return 1
  fi

  if ! cmp -s "$repo/server/deploy/$SERVICE.service" "/etc/systemd/system/$SERVICE.service"; then
    echo "==> 注意：$SERVICE.service 有改动，这次没有自动换上。按 DEPLOY.md 第 10 节重新安装。"
  fi

  echo "==> 重启 $SERVICE"
  sudo systemctl restart "$SERVICE"

  for _ in 1 2 3 4 5 6 7 8 9 10; do
    if curl -fs -o /dev/null "http://127.0.0.1:$PORT/"; then
      sudo systemctl status "$SERVICE" --no-pager --lines=5 || true
      echo "==> 更新完成，服务器在正常运行。"
      return 0
    fi
    sleep 1
  done

  sudo systemctl status "$SERVICE" --no-pager --lines=20 || true
  echo "==> 服务器没有跑起来。用 sudo journalctl -u $SERVICE -n 50 --no-pager 看看出了什么错。" >&2
  return 1
}

main "$@"
exit
