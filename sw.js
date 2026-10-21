// 离线缓存：第一次打开时把所有文件存到手机上，之后没有网络也能打开。
// 发布新版本时改一下 VERSION，手机下次联网打开时会换成新文件。
// 新增文件（比如新游戏）时，记得把路径加进 ASSETS。
const VERSION = 'v0.5.0';
const CACHE = `pocket-games-${VERSION}`;
const ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/app.css',
  'js/app.js',
  'js/covers.js',
  'js/icons.js',
  'js/player.js',
  'js/registry.js',
  'js/settings.js',
  'js/store.js',
  'js/ui.js',
  'js/views/home.js',
  'js/views/library.js',
  'js/views/parts.js',
  'js/views/search.js',
  'games/2048/index.js',
  'games/2048/style.css',
  'games/minesweeper/index.js',
  'games/minesweeper/style.css',
  'games/sudoku/index.js',
  'games/sudoku/puzzle.js',
  'games/sudoku/style.css',
  'games/merge/index.js',
  'games/merge/style.css',
  'games/hanoi/index.js',
  'games/hanoi/style.css',
  'games/tetris/index.js',
  'games/tetris/style.css',
  'games/huarongdao/index.js',
  'games/huarongdao/levels.js',
  'games/huarongdao/rules.js',
  'games/huarongdao/style.css',
  'games/pixel-bird/index.js',
  'games/pixel-bird/style.css',
  'games/watersort/index.js',
  'games/watersort/puzzle.js',
  'games/watersort/style.css',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

// 在本机开发时优先走网络，改完代码刷新就能看到
const DEV = ['localhost', '127.0.0.1'].includes(self.location.hostname);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  const activation = (async () => {
    const keys = await caches.keys();
    const old = keys.filter((key) => key.startsWith('pocket-games-') && key !== CACHE);
    await Promise.all(old.map((key) => caches.delete(key)));
    await self.clients.claim();
    return old.length > 0;
  })();
  event.waitUntil(activation);

  // 有旧版缓存说明这是一次更新：把开着的页面刷新成新版，免得旧页面加载到新版的游戏文件。
  // 带上 ?updated，页面据此提示“已更新”。第一次安装时不刷新。
  // 不能放进上面的 waitUntil：激活完成前浏览器会扣住所有请求，包括这次刷新，两边会互相等死。
  activation.then(async (updated) => {
    if (!updated) return;
    const windows = await self.clients.matchAll({ type: 'window' });
    for (const client of windows) client.navigate(withUpdatedFlag(client.url)).catch(() => {});
  });
});

function withUpdatedFlag(href) {
  const url = new URL(href);
  url.searchParams.set('updated', '');
  return url.href;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(DEV ? networkFirst(request) : cacheFirst(request));
});

async function cacheFirst(request) {
  const cached = await caches.match(request, { ignoreSearch: true });
  if (cached) return cached;
  try {
    return await fetch(request);
  } catch (err) {
    if (request.mode === 'navigate') return caches.match('index.html');
    throw err;
  }
}

async function networkFirst(request) {
  try {
    const response = await fetch(request, { cache: 'no-cache' });
    if (response.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match('index.html');
    return Response.error();
  }
}
