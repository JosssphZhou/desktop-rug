// 地毯表面：Paper Shaders 的实时材质，外加一块 Canvas 画的波斯纹样。
// 每种材质给出一张 canvas，布料网格每帧把它当贴图用，所以图案会跟着布一起弯折。
import {
  ShaderMount,
  getShaderColorFromString as col,
  getShaderNoiseTexture,
  ShaderFitOptions,
  defaultPatternSizing,
  defaultObjectSizing,
  warpFragmentShader, WarpPatterns,
  grainGradientFragmentShader, GrainGradientShapes,
  meshGradientFragmentShader,
  dotGridFragmentShader, DotGridShapes,
} from '@paper-design/shaders';

// 噪声贴图是一张异步加载的图片，ShaderMount 要求先加载完，所以模块加载时先解码好，各材质共用这一张。
const NOISE = getShaderNoiseTexture();
await NOISE.decode();

// 贴图的 CSS 尺寸，3:2（参考视频选中拉直时布面是 1.52，静止时布面略松，约 1.6）。ShaderMount 按设备像素比放大，实际约 1800x1200。
export const TEX_W = 900;
export const TEX_H = 600;

function sizing(base, over = {}) {
  const s = { ...base, ...over };
  return {
    u_fit: ShaderFitOptions[s.fit],
    u_scale: s.scale,
    u_rotation: s.rotation,
    u_offsetX: s.offsetX,
    u_offsetY: s.offsetY,
    u_originX: s.originX,
    u_originY: s.originY,
    u_worldWidth: s.worldWidth,
    u_worldHeight: s.worldHeight,
  };
}

// 每种 Paper 材质的参数在官方预设基础上改成更像织物的配色。
const PAPER = {
  warp: {
    name: '条纹流动',
    shader: warpFragmentShader,
    speed: 0.5,
    uniforms: () => ({
      u_colors: ['#4a0d10', '#b5413a', '#1d2950', '#ead2a0'].map(col),
      u_colorsCount: 4,
      u_proportion: 0.5,
      u_softness: 0,
      u_distortion: 0.1,
      u_swirl: 0.25,
      u_swirlIterations: 4,
      u_shapeScale: 0.6,
      u_shape: WarpPatterns.stripes,
      u_noiseTexture: NOISE,
      ...sizing(defaultPatternSizing, { scale: 0.45, rotation: 90 }),
    }),
  },
  grain: {
    name: '颗粒渐变',
    shader: grainGradientFragmentShader,
    speed: 0.6,
    uniforms: () => ({
      u_colorBack: col('#170c06'),
      u_colors: ['#7a2c12', '#e2b46f', '#2e6a4e'].map(col),
      u_colorsCount: 3,
      u_softness: 0,
      u_intensity: 0.22,
      u_noise: 0.85,
      u_shape: GrainGradientShapes.truchet,
      u_noiseTexture: NOISE,
      ...sizing(defaultPatternSizing, { scale: 0.22 }),
    }),
  },
  mesh: {
    name: '丝绸渐变',
    shader: meshGradientFragmentShader,
    speed: 0.35,
    uniforms: () => ({
      u_colors: ['#f2dfbe', '#b8322a', '#5e1b48', '#1c3a60'].map(col),
      u_colorsCount: 4,
      u_distortion: 0.85,
      u_swirl: 0.35,
      u_grainMixer: 0.12,
      u_grainOverlay: 0.22,
      ...sizing(defaultObjectSizing, { fit: 'cover' }),
    }),
  },
  dots: {
    name: '菱格织纹',
    shader: dotGridFragmentShader,
    speed: 0,
    // 静态材质只在尺寸变化时画一次，可能早于贴图读取，所以先持续渲染一小段再停
    warmup: true,
    uniforms: () => ({
      u_colorBack: col('#1f3d2e'),
      u_colorFill: col('#10261b'),
      u_colorStroke: col('#d6ab5f'),
      u_dotSize: 8,
      u_gapX: 24,
      u_gapY: 24,
      u_strokeWidth: 1.6,
      u_sizeRange: 0,
      u_opacityRange: 0,
      u_shape: DotGridShapes.diamond,
      ...sizing(defaultPatternSizing),
    }),
  },
};

export const MATERIAL_IDS = ['persian', 'warp', 'grain', 'mesh', 'dots'];

// 返回 { canvas, animated, dispose }。
export function createSurface(id) {
  if (id === 'persian') return persianSurface();
  const def = PAPER[id] || PAPER.warp;
  const host = document.createElement('div');
  // ShaderMount 离开视口会自动暂停，所以留在视口内，只是看不见。
  Object.assign(host.style, {
    position: 'fixed', left: '0px', top: '0px',
    width: TEX_W + 'px', height: TEX_H + 'px',
    opacity: '0', pointerEvents: 'none', zIndex: '-1',
  });
  document.body.appendChild(host);
  const mount = new ShaderMount(
    host, def.shader, def.uniforms(),
    { preserveDrawingBuffer: true, premultipliedAlpha: false, alpha: false, antialias: true },
    def.warmup ? 1 : def.speed, 0, 2,
  );
  if (def.warmup) setTimeout(() => mount.setSpeed(0), 2500);
  return {
    canvas: mount.canvasElement,
    animated: def.speed !== 0,
    // 静态材质的 noise 贴图异步加载，前一秒多刷新几次
    warmupMs: def.warmup ? 3000 : 1500,
    // 暂停：速度设为 0，ShaderMount 会取消自己的逐帧渲染循环，GPU 就空闲了
    setLive(on) { if (def.speed !== 0) mount.setSpeed(on ? def.speed : 0); },
    dispose() { mount.dispose(); host.remove(); },
  };
}

// MARK: 波斯纹样（Canvas 2D 程序生成，静态）

function persianSurface() {
  // 按参考视频 f1054（选中拉直后最清楚的一帧）重画，不用视频里的原图。比例取自那一帧：
  // 外圈深红包边 0.8%，奶白小花细边，深蓝主边带约 4.8% 宽、排着红色大圆花，里面几道细边，内场从 10.5% 开始；
  // 红底上撒满细小花枝；四角是深蓝角花，边上一条带圆齿的奶白花带；中心是深蓝阶梯菱形，
  // 里面一朵八瓣奶白大花；菱形左右各一个深蓝小水滴
  const W = 1800, H = 1200;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const RED = '#7e1f1c', RED_HI = '#8e2a26', RED_DK = '#5e1715', EDGE = '#651416',
    NAVY = '#1b1d27', NAVY_HI = '#262a3a', CREAM = '#c8a188', CREAM_DK = '#a87f68', ROSE = '#996a5b', ROSE_DK = '#7c4a3e', TAN = '#bf9680';
  const rnd = mulberry32(11);
  const box = (i, color) => { g.fillStyle = color; g.fillRect(i, i, W - 2 * i, H - 2 * i); };
  const ring = (i, w, color) => { g.strokeStyle = color; g.lineWidth = w; g.strokeRect(i + w / 2, i + w / 2, W - 2 * i - w, H - 2 * i - w); };
  const dot = (x, y, r, color) => { g.fillStyle = color; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); };
  const flower = (x, y, r, petals, c1, c2, c3, rot = 0) => {
    g.save(); g.translate(x, y); g.rotate(rot); g.fillStyle = c1;
    for (let i = 0; i < petals; i++) { g.rotate((Math.PI * 2) / petals); g.beginPath(); g.ellipse(r * 0.58, 0, r * 0.42, r * 0.22, 0, 0, Math.PI * 2); g.fill(); }
    g.restore();
    dot(x, y, r * 0.34, c2); if (c3) dot(x, y, r * 0.14, c3);
  };
  const leaf = (x, y, a, l, w, color) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = color; g.beginPath(); g.ellipse(l / 2, 0, l / 2, w / 2, 0, 0, Math.PI * 2); g.fill(); g.restore(); };
  // 佩斯利水滴（小花叶）
  const boteh = (x, y, s, a, c1, c2) => {
    g.save(); g.translate(x, y); g.rotate(a); g.scale(s, s);
    g.fillStyle = c1; g.beginPath(); g.moveTo(0, -14); g.bezierCurveTo(14, -12, 14, 10, 0, 12); g.bezierCurveTo(-12, 10, -10, -4, 6, -2); g.bezierCurveTo(-2, -8, -6, -12, 0, -14); g.fill();
    g.fillStyle = c2; g.beginPath(); g.arc(3, 3, 4, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  // 沿一条带子排一串东西
  const along = (x0, y0, x1, y1, step, fn) => { const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(L / step)); for (let i = 0; i <= n; i++) fn(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, i); };
  const rectRun = (inset, step, fn) => {
    along(inset, inset, W - inset, inset, step, fn); along(inset, H - inset, W - inset, H - inset, step, fn);
    along(inset, inset, inset, H - inset, step, fn); along(W - inset, inset, W - inset, H - inset, step, fn);
  };

  // 1. 从外到内的边：深红包边、奶白小花细边、深线、深蓝主边带、细边组
  box(0, EDGE);
  box(14, RED_DK);
  rectRun(27, 22, (x, y, i) => (i % 2 ? dot(x, y, 4.5, CREAM) : flower(x, y, 9, 4, CREAM_DK, RED, null, Math.PI / 4)));
  box(46, NAVY);
  const MB0 = 46, MB1 = 132, mid = (MB0 + MB1) / 2;
  // 主边带：红色大圆花（奶白圈、深蓝心），花间是小奶白花和蔓
  rectRun(mid, 104, (x, y) => { flower(x, y, 32, 10, RED, RED_HI, null); flower(x, y, 22, 8, ROSE, RED_DK, null, 0.3); dot(x, y, 10, CREAM_DK); dot(x, y, 6, RED); for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4; dot(x + Math.cos(a) * 26, y + Math.sin(a) * 26, 2.5, CREAM_DK); } });
  for (const [x0, y0, x1, y1] of [[mid, mid, W - mid, mid], [mid, H - mid, W - mid, H - mid], [mid, mid, mid, H - mid], [W - mid, mid, W - mid, H - mid]]) {
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.round(L / 104);
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t; flower(x, y, 11, 6, CREAM, ROSE, RED); leaf(x - 20, y - 14, -0.6, 16, 6, ROSE_DK); leaf(x + 6, y + 10, 0.6, 16, 6, ROSE_DK); }
  }
  // 细边组：奶白线、红色小花带、奶白线、深线、红细带、奶白线
  ring(132, 5, CREAM_DK);
  g.fillStyle = RED_DK; g.fillRect(137, 137, W - 274, H - 274);
  rectRun(148.5, 19, (x, y, i) => (i % 2 ? dot(x, y, 3.5, CREAM) : dot(x, y, 4.5, ROSE)));
  ring(160, 4, CREAM_DK); ring(164, 6, NAVY);
  g.fillStyle = RED; g.fillRect(170, 170, W - 340, H - 340);
  rectRun(176, 14, (x, y) => dot(x, y, 2.6, TAN));
  ring(182, 4, CREAM_DK);

  // 2. 内场
  const F = 186, FW = W - 2 * F, FH = H - 2 * F;
  g.fillStyle = RED; g.fillRect(F, F, FW, FH);
  g.save(); g.beginPath(); g.rect(F, F, FW, FH); g.clip();
  // 底纹：深红藤蔓
  g.lineCap = 'round';
  for (let k = 0; k < 120; k++) {
    let x = F + rnd() * FW, y = F + rnd() * FH, a = rnd() * 6.28;
    g.strokeStyle = rnd() < 0.6 ? RED_DK : ROSE_DK; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, y);
    for (let s2 = 0; s2 < 6; s2++) { a += (rnd() - 0.5) * 1.3; const nx = x + Math.cos(a) * 26, ny = y + Math.sin(a) * 26; g.quadraticCurveTo((x + nx) / 2 + (rnd() - 0.5) * 10, (y + ny) / 2 + (rnd() - 0.5) * 10, nx, ny); x = nx; y = ny; if (rnd() < 0.45) leaf(x, y, a + (rnd() < 0.5 ? 0.9 : -0.9), 13, 5, rnd() < 0.5 ? ROSE_DK : NAVY_HI); }
    g.stroke();
  }
  // 细密的小花：间距 34，奶白、玫瑰、深蓝几种
  for (let y = F + 14; y < H - F; y += 32) {
    for (let x = F + 14 + ((y / 32) % 2) * 16; x < W - F; x += 32) {
      const t = rnd(), jx = (rnd() - 0.5) * 14, jy = (rnd() - 0.5) * 14;
      if (t < 0.25) { flower(x + jx, y + jy, 15 + rnd() * 5, 8, ROSE_DK, RED_HI, NAVY, rnd() * 6); dot(x + jx, y + jy, 3, CREAM); }
      else if (t < 0.42) flower(x + jx, y + jy, 10, 5, rnd() < 0.4 ? CREAM_DK : ROSE, RED_DK, null, rnd() * 6);
      else if (t < 0.6) boteh(x + jx, y + jy, 1.3, rnd() * 6.28, ROSE, NAVY);
      else if (t < 0.72) { leaf(x + jx, y + jy, rnd() * 6, 22, 8, ROSE_DK); }
      else if (t < 0.84) flower(x + jx, y + jy, 9, 4, NAVY_HI, ROSE, null, rnd() * 6);
      else dot(x + jx, y + jy, 3.5, CREAM_DK);
    }
  }
  g.restore();

  // 3. 两端的深蓝角区：一条带圆齿的奶白花带从上边 30% 处弯到侧边 40% 高处，贴着侧边往下，再弯回下边，
  //    带子外侧（靠角的一边）是深蓝底红花，内场是一块中间宽、两头窄的红地
  const endBracket = (sx) => {
    g.save(); g.translate(sx < 0 ? W : 0, 0); g.scale(sx, 1);
    const xa = W * 0.3, xs = F + 40, ya = H * 0.3, yb = H * 0.7;
    const curve = (join) => {
      if (join) g.lineTo(xa, F); else g.moveTo(xa, F); g.bezierCurveTo(xa - 90, F + 60, xs + 40, ya - 120, xs, ya);
      g.lineTo(xs, yb); g.bezierCurveTo(xs + 40, yb + 120, xa - 90, H - F - 60, xa, H - F);
    };
    // 花带的点：沿曲线取样
    const samples = [];
    { const seg = (p0, p1, p2, p3, n) => { for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; samples.push([u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]]); } };
      seg([xa, F], [xa - 90, F + 60], [xs + 40, ya - 120], [xs, ya], 16);
      for (let i = 1; i < 6; i++) samples.push([xs, ya + ((yb - ya) * i) / 6]);
      seg([xs, yb], [xs + 40, yb + 120], [xa - 90, H - F - 60], [xa, H - F], 16); }
    g.save(); g.beginPath(); g.rect(F, F, W - 2 * F, H - 2 * F); g.clip();
    g.strokeStyle = CREAM; g.lineWidth = 74; g.lineJoin = 'round'; g.beginPath(); curve(); g.stroke();
    for (const [x, y] of samples) dot(x + 34, y, 15, CREAM);   // 朝内场的圆齿
    g.fillStyle = NAVY; g.beginPath(); g.moveTo(F, F); curve(true); g.lineTo(F, H - F); g.closePath(); g.fill();
    g.strokeStyle = CREAM_DK; g.lineWidth = 3; g.beginPath(); curve(); g.stroke();
    samples.forEach(([x, y], i) => { if (i % 2) flower(x + 19, y, 10, 5, ROSE, RED, null); else dot(x + 19, y, 4, ROSE_DK); });
    g.restore();
    // 深蓝角区里的红花和叶
    g.save(); g.beginPath(); g.moveTo(F, F); curve(true); g.lineTo(F, H - F); g.closePath(); g.clip();
    for (let y = F + 12; y < H - F; y += 34) for (let x = F + 12 + ((y / 34) % 2) * 17; x < xa; x += 34) {
      const t = rnd();
      if (t < 0.45) flower(x, y, 12, 7, RED_HI, ROSE, NAVY, rnd() * 6);
      else if (t < 0.7) leaf(x, y, rnd() * 6, 18, 6, ROSE_DK);
      else if (t < 0.85) dot(x, y, 3.5, CREAM_DK);
    }
    g.restore();
    g.restore();
  };
  endBracket(1); endBracket(-1);

  // 4. 中心：深蓝阶梯菱形（半宽 16.5%、半高 24.5%），奶白描边，里面撒红花
  const cx = W / 2, cy = H / 2, MW = W * 0.165, MH = H * 0.245;
  const stepDiamond = (hw, hh, steps) => {
    g.beginPath();
    const pts = [];
    for (let i = 0; i <= steps; i++) { const t = i / steps; pts.push([hw * t, -hh * (1 - t)]); }
    // 每段做成小台阶
    const quad = (sx, sy) => { for (let i = 0; i < steps; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; g.lineTo(cx + sx * x1, cy + sy * y0); g.lineTo(cx + sx * x1, cy + sy * y1); } };
    g.moveTo(cx, cy - hh); quad(1, 1);
    for (let i = steps; i > 0; i--) { const [x0, y0] = pts[i], [x1, y1] = pts[i - 1]; g.lineTo(cx + x1, cy - y0); g.lineTo(cx + x1, cy - y1); }
    for (let i = 0; i < steps; i++) { const [x0, y0] = pts[i], [x1, y1] = pts[i + 1]; g.lineTo(cx - x1, cy - y0); g.lineTo(cx - x1, cy - y1); }
    for (let i = steps; i > 0; i--) { const [x0, y0] = pts[i], [x1, y1] = pts[i - 1]; g.lineTo(cx - x1, cy + y0); g.lineTo(cx - x1, cy + y1); }
    g.closePath();
  };
  // 上下两端的小花头
  for (const s2 of [-1, 1]) { g.fillStyle = NAVY; g.beginPath(); g.ellipse(cx, cy + s2 * (MH + 18), 22, 30, 0, 0, Math.PI * 2); g.fill(); flower(cx, cy + s2 * (MH + 18), 13, 6, CREAM_DK, RED, null); }
  g.fillStyle = CREAM; stepDiamond(MW + 10, MH + 10, 9); g.fill();
  g.fillStyle = NAVY; stepDiamond(MW, MH, 9); g.fill();
  g.save(); stepDiamond(MW - 4, MH - 4, 9); g.clip();
  for (let y = cy - MH; y < cy + MH; y += 28) for (let x = cx - MW + ((y / 28) % 2) * 14; x < cx + MW; x += 28) {
    const t = rnd();
    if (t < 0.5) flower(x, y, 9, 6, RED_HI, CREAM_DK, NAVY, rnd() * 6);
    else if (t < 0.75) leaf(x, y, rnd() * 6, 13, 5, ROSE_DK);
  }
  g.restore();
  // 八瓣奶白大花：半宽 17% 毯宽的一半，花瓣是圆头
  const lobed = (r, n, color, amp) => {
    g.fillStyle = color; g.beginPath();
    for (let i = 0; i <= 360; i++) { const a = (i * Math.PI) / 180, rr = r * (1 + amp * Math.pow(Math.abs(Math.cos((a * n) / 2)), 0.6)); const x = cx + Math.cos(a) * rr * 1.0, y = cy + Math.sin(a) * rr * 1.1; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.closePath(); g.fill();
  };
  lobed(128, 8, CREAM_DK, 0.18); lobed(122, 8, CREAM, 0.18);
  for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4 + Math.PI / 8; flower(cx + Math.cos(a) * 92, cy + Math.sin(a) * 100, 13, 6, ROSE, RED_DK, null, a); }
  lobed(70, 8, RED_HI, 0.25);
  flower(cx, cy, 64, 12, RED, NAVY, null);
  flower(cx, cy, 36, 8, CREAM_DK, RED_HI, NAVY);
  // 左右的小水滴：深蓝外框、红心、奶白描边
  for (const s2 of [-1, 1]) {
    const px = cx + s2 * W * 0.25;
    const drop = (k, color) => { g.fillStyle = color; g.beginPath(); g.moveTo(px - s2 * 70 * k, cy); g.bezierCurveTo(px - s2 * 30 * k, cy - 44 * k, px + s2 * 46 * k, cy - 46 * k, px + s2 * 46 * k, cy); g.bezierCurveTo(px + s2 * 46 * k, cy + 46 * k, px - s2 * 30 * k, cy + 44 * k, px - s2 * 70 * k, cy); g.fill(); };
    drop(1.5, CREAM_DK); drop(1.38, NAVY); drop(0.95, RED);
    flower(px + s2 * 10, cy, 14, 6, ROSE, CREAM, NAVY);
  }

  // 5. 织物的细颗粒
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 18;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);

  return { canvas: c, animated: false, warmupMs: 0, dispose() {} };
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
