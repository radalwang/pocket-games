// 拼图用的图：内置的插画全用代码画，不需要图片文件；也可以从相册选一张照片。
// 插画画在 300×400 的坐标里，要多大就整体放大。星星、窗户、花这些细节用固定的随机数种子，每次画出来都一样。

import { random } from './pieces.js';

const TAU = Math.PI * 2;

// ---------- 画笔小工具 ----------

function linear(g, x0, y0, x1, y1, stops) {
  const gradient = g.createLinearGradient(x0, y0, x1, y1);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function radial(g, x, y, r0, r1, stops) {
  const gradient = g.createRadialGradient(x, y, r0, x, y, r1);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  return gradient;
}

function circle(g, x, y, r, fill) {
  g.beginPath();
  g.arc(x, y, r, 0, TAU);
  g.fillStyle = fill;
  g.fill();
}

function ellipse(g, x, y, rx, ry, fill, rotation = 0) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rotation, 0, TAU);
  g.fillStyle = fill;
  g.fill();
}

function shape(g, points, fill) {
  g.beginPath();
  points.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

// 几个圆叠成一朵云，w 是云的宽度
function cloud(g, x, y, w, fill) {
  g.beginPath();
  for (const [dx, dy, r] of [[0, 0, 0.3], [0.26, -0.14, 0.28], [0.52, 0, 0.24], [-0.26, 0.05, 0.2], [0.14, 0.07, 0.28]]) {
    g.moveTo(x + dx * w + r * w, y + dy * w);
    g.arc(x + dx * w, y + dy * w, r * w, 0, TAU);
  }
  g.fillStyle = fill;
  g.fill();
}

// 起伏的山坡：一条正弦曲线，下面填满
function hill(g, base, amplitude, waves, phase, fill) {
  g.beginPath();
  g.moveTo(0, 400);
  for (let x = 0; x <= 300; x += 6) g.lineTo(x, base - amplitude * Math.sin((x / 300) * waves * TAU + phase));
  g.lineTo(300, 400);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

// 飞鸟：两笔弯弯的弧线
function birds(g, flock, color) {
  g.strokeStyle = color;
  g.lineWidth = 1.5;
  g.lineCap = 'round';
  for (const [x, y, s] of flock) {
    g.beginPath();
    g.moveTo(x - s, y - s * 0.35);
    g.quadraticCurveTo(x - s * 0.4, y - s * 0.6, x, y);
    g.quadraticCurveTo(x + s * 0.4, y - s * 0.6, x + s, y - s * 0.35);
    g.stroke();
  }
}

// ---------- 落日群山 ----------

// 一层山脊：山峰和山谷交替，峰高在 top 附近、谷底在 valley 附近，下面一直填到湖边
function ridge(g, rand, top, valley, fill) {
  g.beginPath();
  g.moveTo(-10, 302);
  let x = -10;
  let peak = rand() < 0.5;
  while (x < 330) {
    g.lineTo(x, peak ? top + rand() * 22 : valley - rand() * 18);
    x += 16 + rand() * 28;
    peak = !peak;
  }
  g.lineTo(330, 302);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
}

function pine(g, x, base, h, fill) {
  g.beginPath();
  for (let k = 0; k < 3; k++) {
    const top = base - h + k * h * 0.22;
    const half = h * (0.18 + k * 0.08);
    g.moveTo(x, top);
    g.lineTo(x + half, top + h * 0.45);
    g.lineTo(x - half, top + h * 0.45);
    g.closePath();
  }
  g.rect(x - h * 0.04, base - h * 0.2, h * 0.08, h * 0.2);
  g.fillStyle = fill;
  g.fill();
}

function sunset(g, rand) {
  g.fillStyle = linear(g, 0, 0, 0, 300, [[0, '#24194f'], [0.4, '#7b2f86'], [0.72, '#f0607a'], [1, '#ffbe7a']]);
  g.fillRect(0, 0, 300, 300);
  for (let k = 0; k < 45; k++) circle(g, rand() * 300, rand() * 110, 0.4 + rand() * 0.9, `rgba(255,255,255,${0.3 + rand() * 0.6})`);
  circle(g, 190, 215, 115, radial(g, 190, 215, 30, 115, [[0, 'rgba(255,214,130,0.55)'], [1, 'rgba(255,214,130,0)']]));
  circle(g, 190, 215, 48, linear(g, 0, 167, 0, 263, [[0, '#fff3b8'], [1, '#ff9b5c']]));
  // 一条条横着的晚霞
  for (const [x, y, w, h, a] of [[100, 150, 60, 6, 0.5], [220, 120, 70, 5, 0.4], [55, 186, 45, 4, 0.45], [255, 168, 55, 5, 0.5], [130, 100, 40, 3.5, 0.35]]) {
    ellipse(g, x, y, w, h, `rgba(255,170,190,${a})`);
  }
  ridge(g, rand, 150, 222, '#a45a9a');
  ridge(g, rand, 186, 252, '#6a3480');
  ridge(g, rand, 226, 288, '#341f55');
  // 湖面、太阳的倒影和波纹
  g.fillStyle = linear(g, 0, 300, 0, 400, [[0, '#f38a7e'], [0.35, '#8c3d7d'], [1, '#22164a']]);
  g.fillRect(0, 300, 300, 100);
  for (let k = 0; k < 12; k++) {
    ellipse(g, 190 + (rand() - 0.5) * 8, 306 + k * 7, (62 - k * 4 + rand() * 10) / 2, 1.6, `rgba(255,220,150,${0.75 - k * 0.05})`);
  }
  for (let k = 0; k < 26; k++) ellipse(g, rand() * 300, 314 + rand() * 84, 6 + rand() * 14, 0.8, 'rgba(255,255,255,0.18)');
  for (let x = -5; x < 305; x += 9 + rand() * 12) pine(g, x, 303, 14 + rand() * 24, '#1d1238');
  // 近处的芦苇
  g.strokeStyle = '#1d1238';
  g.lineWidth = 1.6;
  for (let k = 0; k < 14; k++) {
    const x = 6 + k * 4 + rand() * 3;
    g.beginPath();
    g.moveTo(x, 402);
    g.quadraticCurveTo(x + 2, 370, x + 6 - rand() * 4, 340 + rand() * 20);
    g.stroke();
  }
  birds(g, [[70, 120, 7], [88, 112, 5], [102, 126, 6], [232, 88, 5]], '#2a1840');
}

// ---------- 海边灯塔 ----------

function lighthouse(g, rand) {
  g.fillStyle = linear(g, 0, 0, 0, 260, [[0, '#3fa9f5'], [1, '#d4f1ff']]);
  g.fillRect(0, 0, 300, 260);
  circle(g, 62, 66, 64, radial(g, 62, 66, 18, 64, [[0, 'rgba(255,250,210,0.75)'], [1, 'rgba(255,250,210,0)']]));
  circle(g, 62, 66, 22, '#fff6c9');
  cloud(g, 175, 56, 76, 'rgba(255,255,255,0.95)');
  cloud(g, 262, 128, 48, 'rgba(255,255,255,0.85)');
  cloud(g, 36, 168, 44, 'rgba(255,255,255,0.8)');
  // 海和浪花
  g.fillStyle = linear(g, 0, 250, 0, 400, [[0, '#4fb3ec'], [0.4, '#1f7fd1'], [1, '#0b3f86']]);
  g.fillRect(0, 250, 300, 150);
  g.strokeStyle = 'rgba(255,255,255,0.7)';
  g.lineWidth = 1.4;
  for (let k = 0; k < 46; k++) {
    const y = 256 + rand() * 142;
    const w = 3 + (y - 250) / 14 + rand() * 4;
    const x = rand() * 300;
    g.beginPath();
    g.arc(x, y + w, w, 1.15 * Math.PI, 1.85 * Math.PI);
    g.stroke();
  }
  // 悬崖、岩层、草皮和海里的礁石
  shape(g, [[150, 402], [166, 336], [180, 304], [200, 284], [230, 272], [270, 267], [302, 264], [302, 402]], '#7a5236');
  g.strokeStyle = 'rgba(0,0,0,0.2)';
  g.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [[172, 330, 300, 310], [162, 362, 300, 342], [156, 388, 300, 372], [190, 300, 300, 288]]) {
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }
  shape(g, [[194, 290], [214, 276], [238, 268], [272, 262], [302, 259], [302, 271], [270, 274], [236, 280], [206, 294]], '#58b84a');
  ellipse(g, 150, 392, 22, 10, '#3f4652');
  ellipse(g, 126, 398, 14, 7, '#4b5361');
  ellipse(g, 172, 372, 10, 6, '#4b5361');
  // 灯光
  shape(g, [[248, 132], [110, 92], [110, 172]], 'rgba(255,240,150,0.35)');
  // 灯塔：红白相间的塔身、黑色的走廊、黄色的灯室、红色的顶
  const tower = [[232, 270], [264, 270], [258, 152], [238, 152]];
  g.save();
  shape(g, tower, '#fdfdfd');
  g.clip();
  for (let y = 152; y < 270; y += 40) {
    g.fillStyle = '#e53935';
    g.fillRect(220, y + 20, 60, 20);
  }
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(252, 150, 20, 122);
  g.restore();
  g.fillStyle = '#5b3a2a';
  g.beginPath();
  g.arc(248, 262, 5, Math.PI, 0);
  g.rect(243, 262, 10, 8);
  g.fill();
  g.fillStyle = '#2b2b33';
  g.fillRect(232, 146, 32, 6);
  g.fillStyle = '#ffe680';
  g.fillRect(240, 126, 16, 20);
  g.fillStyle = '#2b2b33';
  for (const x of [240, 247, 254]) g.fillRect(x, 126, 2, 20);
  shape(g, [[235, 127], [261, 127], [248, 110]], '#c62828');
  circle(g, 248, 109, 2.5, '#c62828');
  // 帆船
  shape(g, [[48, 300], [112, 300], [102, 313], [58, 313]], '#d84a3a');
  g.fillStyle = '#5b3a2a';
  g.fillRect(80, 228, 2.5, 72);
  shape(g, [[84, 232], [84, 296], [116, 296]], '#ffffff');
  shape(g, [[78, 246], [78, 296], [54, 296]], '#ffe9b0');
  ellipse(g, 80, 317, 30, 3, 'rgba(0,30,80,0.3)');
  birds(g, [[132, 196, 6], [148, 206, 4.5], [120, 214, 5]], '#ffffff');
}

// ---------- 热气球 ----------

// 热气球：上半是圆，下半收成一个尖，竖条纹两边窄中间宽，看起来是鼓的；底下吊一个篮子
function balloon(g, x, y, r, colors) {
  const outline = () => {
    g.beginPath();
    g.moveTo(x - r, y);
    g.arc(x, y, r, Math.PI, 0);
    g.bezierCurveTo(x + r, y + r * 0.7, x + r * 0.35, y + r * 1.15, x + r * 0.22, y + r * 1.35);
    g.lineTo(x - r * 0.22, y + r * 1.35);
    g.bezierCurveTo(x - r * 0.35, y + r * 1.15, x - r, y + r * 0.7, x - r, y);
    g.closePath();
  };
  g.save();
  outline();
  g.clip();
  const n = 8;
  for (let k = 0; k < n; k++) {
    const a = x + r * Math.sin(-Math.PI / 2 + (k * Math.PI) / n);
    const b = x + r * Math.sin(-Math.PI / 2 + ((k + 1) * Math.PI) / n);
    g.fillStyle = colors[k % colors.length];
    g.fillRect(a, y - r, b - a + 0.5, r * 2.5);
  }
  g.fillStyle = radial(g, x - r * 0.35, y - r * 0.4, r * 0.1, r * 1.7, [[0, 'rgba(255,255,255,0.4)'], [0.45, 'rgba(255,255,255,0)'], [1, 'rgba(0,0,0,0.3)']]);
  g.fillRect(x - r, y - r, r * 2, r * 2.5);
  g.restore();
  g.strokeStyle = 'rgba(80,50,30,0.85)';
  g.lineWidth = Math.max(0.6, r * 0.03);
  g.beginPath();
  g.moveTo(x - r * 0.22, y + r * 1.35);
  g.lineTo(x - r * 0.15, y + r * 1.6);
  g.moveTo(x + r * 0.22, y + r * 1.35);
  g.lineTo(x + r * 0.15, y + r * 1.6);
  g.stroke();
  g.fillStyle = '#8a5a2b';
  g.fillRect(x - r * 0.18, y + r * 1.58, r * 0.36, r * 0.26);
}

function balloons(g, rand) {
  g.fillStyle = linear(g, 0, 0, 0, 340, [[0, '#6cc6ff'], [0.6, '#bfe6ff'], [1, '#ffe3ef']]);
  g.fillRect(0, 0, 300, 340);
  cloud(g, 60, 52, 64, 'rgba(255,255,255,0.9)');
  cloud(g, 236, 150, 58, 'rgba(255,255,255,0.85)');
  cloud(g, 150, 245, 50, 'rgba(255,255,255,0.75)');
  // 山坡、树、小房子
  hill(g, 300, 14, 1.3, 0.5, '#b5e08f');
  hill(g, 330, 20, 0.9, 2.2, '#7ccc5c');
  for (let k = 0; k < 9; k++) {
    const x = 12 + k * 33 + rand() * 12;
    const y = 330 - 20 * Math.sin((x / 300) * 0.9 * TAU + 2.2) + 2;
    g.fillStyle = '#6b4a2b';
    g.fillRect(x - 1, y - 6, 2, 7);
    circle(g, x, y - 9, 5 + rand() * 3, '#3f8f3a');
  }
  g.fillStyle = '#fff7e6';
  g.fillRect(200, 302, 26, 18);
  shape(g, [[196, 303], [213, 289], [230, 303]], '#e0533d');
  g.fillStyle = '#7a4b2a';
  g.fillRect(209, 310, 7, 10);
  g.fillStyle = '#7fc4ff';
  g.fillRect(202, 307, 5, 5);
  hill(g, 362, 14, 1.6, 4, '#4fae47');
  g.strokeStyle = 'rgba(255,255,255,0.18)';
  g.lineWidth = 3;
  for (let k = 0; k < 6; k++) {
    g.beginPath();
    for (let x = 0; x <= 300; x += 10) g.lineTo(x, 374 + k * 6 - 14 * Math.sin((x / 300) * 1.6 * TAU + 4));
    g.stroke();
  }
  balloon(g, 240, 72, 16, ['#ffffff', '#ff6b6b']);
  balloon(g, 270, 250, 12, ['#ffb703', '#219ebc']);
  balloon(g, 58, 196, 21, ['#ffd23f', '#3fa7ff']);
  balloon(g, 206, 196, 31, ['#9b5de5', '#00c9a7']);
  balloon(g, 112, 102, 47, ['#ff5d5d', '#ffd34d', '#ff9f43']);
}

// ---------- 城市夜色 ----------

const WINDOW_LIGHTS = ['#ffd76a', '#ffeaa0', '#ffc94a', '#8fe9ff'];

function city(g, rand) {
  const sky = linear(g, 0, 0, 0, 300, [[0, '#0a1238'], [0.45, '#2b2a78'], [0.8, '#a24f97'], [1, '#ff9a76']]);
  g.fillStyle = sky;
  g.fillRect(0, 0, 300, 300);
  for (let k = 0; k < 80; k++) circle(g, rand() * 300, rand() * 170, 0.4 + rand() * 0.8, `rgba(255,255,255,${0.3 + rand() * 0.7})`);
  // 月牙：先画一个满月，再用同样的天空颜色盖掉一块，最后罩一圈光晕
  circle(g, 232, 64, 20, '#fff3cf');
  circle(g, 241, 57, 17, sky);
  circle(g, 232, 64, 44, radial(g, 232, 64, 16, 44, [[0, 'rgba(255,240,200,0.3)'], [1, 'rgba(255,240,200,0)']]));
  // 远处的楼
  let x = -4;
  while (x < 300) {
    const w = 14 + rand() * 14;
    const h = 70 + rand() * 90;
    g.fillStyle = '#3a2f74';
    g.fillRect(x, 300 - h, w, h);
    x += w + 1;
  }
  // 中间那座塔
  shape(g, [[133, 302], [149, 302], [143, 120], [139, 120]], '#251f52');
  ellipse(g, 141, 128, 11, 6, '#2f2862');
  g.fillStyle = '#251f52';
  g.fillRect(140, 64, 2, 60);
  circle(g, 141, 63, 2.6, '#ff4d4d');
  // 近处的楼和亮着灯的窗户
  const lit = [];
  x = -6;
  while (x < 300) {
    const w = 22 + rand() * 22;
    const h = 50 + rand() * 120;
    g.fillStyle = ['#1b1740', '#231c4d', '#2a2258', '#191433'][Math.floor(rand() * 4)];
    g.fillRect(x, 300 - h, w, h);
    for (let wy = 300 - h + 6; wy < 294; wy += 9) {
      for (let wx = x + 4; wx < x + w - 5; wx += 7) {
        const on = rand() < 0.42;
        const color = on ? WINDOW_LIGHTS[Math.floor(rand() * rand() * 4)] : '#352d66';
        g.fillStyle = color;
        g.fillRect(wx, wy, 4, 5);
        if (on) lit.push([wx, color]);
      }
    }
    x += w + 2;
  }
  // 水面和灯光的倒影
  g.fillStyle = linear(g, 0, 300, 0, 400, [[0, '#2a1f5e'], [1, '#0c0a26']]);
  g.fillRect(0, 300, 300, 100);
  for (let k = 0; k < 160; k++) {
    const [wx, color] = lit[Math.floor(rand() * lit.length)] ?? [rand() * 300, '#ffd76a'];
    const y = 304 + rand() * 94;
    g.globalAlpha = 0.25 + 0.45 * (1 - (y - 300) / 100);
    g.fillStyle = color;
    g.fillRect(wx - 1 + (rand() - 0.5) * 4, y, 3 + rand() * 6, 1.3);
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(0, 300, 300, 3);
}

// ---------- 向日葵 ----------

function sunflower(g, rand, x, y, r) {
  g.strokeStyle = '#3f7d2c';
  g.lineWidth = Math.max(1, r * 0.16);
  g.beginPath();
  g.moveTo(x, y);
  g.quadraticCurveTo(x + r * 0.3, y + r * 2, x - r * 0.1, 410);
  g.stroke();
  ellipse(g, x - r * 0.55, y + r * 1.9, r * 0.6, r * 0.22, '#4f9a37', -0.5);
  ellipse(g, x + r * 0.62, y + r * 2.5, r * 0.6, r * 0.22, '#4f9a37', 0.5);
  for (let ring = 0; ring < 2; ring++) {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * TAU + ring * 0.2;
      const reach = r * (ring ? 0.58 : 0.66);
      ellipse(g, x + Math.cos(a) * reach, y + Math.sin(a) * reach, r * 0.4, r * 0.15, ring ? '#ffc400' : '#ffad00', a);
    }
  }
  circle(g, x, y, r * 0.42, '#6b3a1a');
  circle(g, x, y, r * 0.3, '#4a250f');
  if (r > 10) {
    for (let k = 0; k < 24; k++) {
      const a = k * 2.4;
      const d = Math.sqrt(k / 24) * r * 0.36;
      circle(g, x + Math.cos(a) * d, y + Math.sin(a) * d, r * 0.03, '#2c1608');
    }
  }
}

function sunflowers(g, rand) {
  g.fillStyle = linear(g, 0, 0, 0, 250, [[0, '#3d9df5'], [1, '#c7ecff']]);
  g.fillRect(0, 0, 300, 250);
  circle(g, 246, 52, 60, radial(g, 246, 52, 20, 60, [[0, 'rgba(255,245,180,0.8)'], [1, 'rgba(255,245,180,0)']]));
  g.strokeStyle = 'rgba(255,240,160,0.8)';
  g.lineWidth = 2;
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * TAU;
    g.beginPath();
    g.moveTo(246 + Math.cos(a) * 30, 52 + Math.sin(a) * 30);
    g.lineTo(246 + Math.cos(a) * 40, 52 + Math.sin(a) * 40);
    g.stroke();
  }
  circle(g, 246, 52, 24, '#fff1a8');
  cloud(g, 70, 60, 66, 'rgba(255,255,255,0.95)');
  cloud(g, 160, 110, 44, 'rgba(255,255,255,0.85)');
  hill(g, 226, 10, 1, 1, '#9bd46b');
  // 山坡上的风车
  shape(g, [[62, 232], [78, 232], [75, 192], [65, 192]], '#f5efe6');
  shape(g, [[62, 193], [78, 193], [70, 180]], '#c0392b');
  g.fillStyle = '#7a4b2a';
  g.fillRect(68, 220, 4, 12);
  g.save();
  g.translate(70, 192);
  g.rotate(0.35);
  g.fillStyle = '#8d6e63';
  for (let k = 0; k < 4; k++) {
    g.rotate(Math.PI / 2);
    g.fillRect(-2, 0, 4, 26);
    g.fillStyle = '#efe6d8';
    g.fillRect(2, 6, 6, 18);
    g.fillStyle = '#8d6e63';
  }
  g.restore();
  circle(g, 70, 192, 2.5, '#5d4037');
  hill(g, 248, 8, 1.4, 3, '#78c04f');
  g.fillStyle = linear(g, 0, 250, 0, 400, [[0, '#5aa83f'], [1, '#2f6b26']]);
  g.fillRect(0, 252, 300, 150);
  // 由远到近三排向日葵
  for (let k = 0; k < 20; k++) sunflower(g, rand, 4 + k * 15 + rand() * 6, 258 + rand() * 10, 6 + rand() * 2);
  for (let k = 0; k < 10; k++) sunflower(g, rand, 10 + k * 31 + rand() * 10, 292 + rand() * 14, 12 + rand() * 4);
  for (const [x, y, r] of [[48, 338, 30], [250, 332, 28], [150, 366, 38]]) sunflower(g, rand, x, y, r);
}

// ---------- 星际旅行 ----------

function space(g, rand) {
  g.fillStyle = linear(g, 0, 0, 0, 400, [[0, '#070b24'], [0.5, '#190f40'], [1, '#0b1636']]);
  g.fillRect(0, 0, 300, 400);
  circle(g, 70, 110, 150, radial(g, 70, 110, 0, 150, [[0, 'rgba(170,70,255,0.38)'], [1, 'rgba(170,70,255,0)']]));
  circle(g, 250, 300, 160, radial(g, 250, 300, 0, 160, [[0, 'rgba(40,220,230,0.28)'], [1, 'rgba(40,220,230,0)']]));
  circle(g, 220, 70, 110, radial(g, 220, 70, 0, 110, [[0, 'rgba(255,80,150,0.24)'], [1, 'rgba(255,80,150,0)']]));
  for (let k = 0; k < 220; k++) circle(g, rand() * 300, rand() * 400, 0.3 + rand() * 1.1, `rgba(255,255,255,${0.25 + rand() * 0.75})`);
  g.strokeStyle = 'rgba(255,255,255,0.85)';
  g.lineWidth = 1;
  for (let k = 0; k < 10; k++) {
    const x = rand() * 300;
    const y = rand() * 400;
    const s = 3 + rand() * 4;
    g.beginPath();
    g.moveTo(x - s, y);
    g.lineTo(x + s, y);
    g.moveTo(x, y - s);
    g.lineTo(x, y + s);
    g.stroke();
  }
  // 彗星
  g.strokeStyle = linear(g, 18, 36, 104, 86, [[0, 'rgba(255,255,255,0)'], [1, 'rgba(200,240,255,0.9)']]);
  g.lineWidth = 3;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(18, 36);
  g.lineTo(104, 86);
  g.stroke();
  circle(g, 105, 87, 3.5, '#e6f8ff');
  // 带环的行星：先画后半圈环，再画星球，最后画前半圈环
  const ring = (from, to) => {
    g.beginPath();
    g.ellipse(205, 150, 92, 22, -0.35, from, to);
    g.strokeStyle = 'rgba(255,225,170,0.75)';
    g.lineWidth = 7;
    g.stroke();
  };
  ring(Math.PI, TAU);
  g.save();
  g.beginPath();
  g.arc(205, 150, 50, 0, TAU);
  g.clip();
  g.fillStyle = radial(g, 188, 130, 6, 70, [[0, '#ffd59a'], [0.55, '#f08a4b'], [1, '#9c3f2b']]);
  g.fillRect(150, 95, 110, 110);
  for (const [dy, h] of [[-26, 6], [-8, 9], [14, 5], [30, 7]]) ellipse(g, 205, 150 + dy, 70, h, 'rgba(150,60,40,0.25)', -0.35);
  g.restore();
  ring(0, Math.PI);
  // 蓝色星球和月亮
  circle(g, 62, 318, 44, radial(g, 62, 318, 26, 44, [[0, 'rgba(120,200,255,0.35)'], [1, 'rgba(120,200,255,0)']]));
  g.save();
  g.beginPath();
  g.arc(62, 318, 30, 0, TAU);
  g.clip();
  g.fillStyle = radial(g, 52, 306, 4, 38, [[0, '#8fe3ff'], [0.6, '#2a6fdb'], [1, '#173c8f']]);
  g.fillRect(30, 286, 64, 64);
  for (const [x, y, rx, ry] of [[50, 304, 10, 6], [70, 322, 12, 7], [46, 336, 7, 4], [80, 300, 5, 3]]) ellipse(g, x, y, rx, ry, 'rgba(76,207,122,0.85)', 0.4);
  g.restore();
  circle(g, 262, 312, 13, '#cfd3dc');
  for (const [x, y, r] of [[258, 308, 3], [266, 316, 2.2], [263, 304, 1.5]]) circle(g, x, y, r, '#aab0bd');
  // 火箭
  g.save();
  g.translate(132, 262);
  g.rotate(0.62);
  g.fillStyle = linear(g, 0, 26, 0, 58, [[0, 'rgba(255,240,120,1)'], [0.5, 'rgba(255,140,40,0.9)'], [1, 'rgba(255,80,40,0)']]);
  g.beginPath();
  g.moveTo(-7, 26);
  g.quadraticCurveTo(0, 66, 7, 26);
  g.fill();
  shape(g, [[-11, 8], [-20, 26], [-9, 22]], '#ff4d5a');
  shape(g, [[11, 8], [20, 26], [9, 22]], '#ff4d5a');
  g.beginPath();
  g.moveTo(0, -38);
  g.bezierCurveTo(14, -24, 12, 10, 9, 26);
  g.lineTo(-9, 26);
  g.bezierCurveTo(-12, 10, -14, -24, 0, -38);
  g.fillStyle = '#f4f6fb';
  g.fill();
  g.save();
  g.clip();
  g.fillStyle = '#ff4d5a';
  g.fillRect(-15, -40, 30, 14);
  g.fillStyle = 'rgba(0,0,0,0.12)';
  g.fillRect(4, -40, 12, 70);
  g.restore();
  circle(g, 0, -6, 7, '#c9d3e6');
  circle(g, 0, -6, 5, '#59c8ff');
  circle(g, -1.5, -7.5, 1.6, 'rgba(255,255,255,0.8)');
  g.restore();
}

// ---------- 对外接口 ----------

export const PICTURES = [
  { id: 'sunset', name: '落日群山', draw: sunset, seed: 11 },
  { id: 'lighthouse', name: '海边灯塔', draw: lighthouse, seed: 22 },
  { id: 'balloons', name: '热气球', draw: balloons, seed: 33 },
  { id: 'city', name: '城市夜色', draw: city, seed: 44 },
  { id: 'sunflowers', name: '向日葵', draw: sunflowers, seed: 55 },
  { id: 'space', name: '星际旅行', draw: space, seed: 66 },
];

export const getPicture = (id) => PICTURES.find((picture) => picture.id === id);

// 把一张内置插画画到新的 canvas 上，宽 width、高 width 的 4/3 倍
export function renderPicture(id, width) {
  const picture = getPicture(id);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round((width * 4) / 3);
  const g = canvas.getContext('2d');
  g.scale(canvas.width / 300, canvas.height / 400);
  picture.draw(g, random(picture.seed));
  return canvas;
}

// 照片：从中间裁成 3:4，缩到 750×1000 以内，存成 JPEG 的 data URL（大约一两百 KB）
export async function loadPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const image = await loadImage(url);
    const scale = Math.min(image.naturalWidth / 3, image.naturalHeight / 4);
    const cropW = scale * 3;
    const cropH = scale * 4;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(Math.min(750, cropW));
    canvas.height = Math.round((canvas.width * 4) / 3);
    canvas.getContext('2d').drawImage(image, (image.naturalWidth - cropW) / 2, (image.naturalHeight - cropH) / 2, cropW, cropH, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.82);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('图片读取失败'));
    image.src = src;
  });
}
