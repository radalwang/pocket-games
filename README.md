# 口袋游戏

可以离线玩的 iPhone 小游戏合集。用网页技术（PWA）写成，在 Safari 里“添加到主屏幕”后会全屏运行，没有网络也能打开。界面参考 Apple Music。

目前包括：2048（可以玩），数独、扫雷（即将推出）。

## 本地预览

```bash
python3 -m http.server 8080
```

然后在浏览器里打开 http://localhost:8080 ，用开发者工具切到 iPhone 尺寸。本机预览时，离线缓存会先从网络取文件，所以改完代码刷新就能看到。

## 装到 iPhone 上

离线缓存只在 https 网址下生效，所以要先把整个文件夹放到一个静态网站托管服务上，比如 GitHub Pages、Netlify 或 Cloudflare Pages。然后：

1. 用 iPhone 的 Safari 打开网址
2. 点底部的“分享”按钮，选“添加到主屏幕”
3. 从主屏幕图标打开，等首页出来以后，就可以离线使用了

只是想在手机上看看界面的话，Mac 和 iPhone 连同一个 Wi‑Fi，在手机上访问 `http://<Mac 的局域网 IP>:8080` 就行。这种方式没有离线缓存。

## 目录

```
index.html              页面骨架
manifest.webmanifest    主屏幕 App 的名称、图标、颜色
sw.js                   离线缓存
css/app.css             外壳样式（颜色、标签栏、卡片、游戏页）
js/app.js               入口：标签页切换、点击分发
js/registry.js          游戏清单
js/player.js            全屏游戏页、继续游戏条，以及游戏模块的接口说明
js/store.js             存档、最高分、最近玩过
js/covers.js            用代码画的游戏封面
js/views/               首页、资料库、搜索
games/2048/             2048 的代码和样式
icons/                  主屏幕图标（由 tools/make_icons.py 生成）
```

## 加一个新游戏

1. 新建 `games/<游戏名>/index.js`，导出 `mount(root, ctx)`。可以照着 `games/2048/index.js` 写，接口说明在 `js/player.js` 开头。
2. 在 `js/registry.js` 的 `games` 里加一条，`status` 写 `'ready'`，`load` 指向上面的文件。
3. 想要新的封面图案，就在 `js/covers.js` 的 `MOTIFS` 里加一个函数。
4. 把新文件的路径加进 `sw.js` 的 `ASSETS`，再改一下 `VERSION`。

## 发布新版本

改完代码后，把 `sw.js` 里的 `VERSION` 改成新的版本号，再重新上传。手机下次联网打开时会自动更新文件。`js/settings.js` 里的 `VERSION` 是设置页显示的版本号，可以一起改。
