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

// 贴图的 CSS 尺寸，3:2。ShaderMount 按设备像素比放大，实际约 1800x1200。
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
    dispose() { mount.dispose(); host.remove(); },
  };
}

// MARK: 波斯纹样（Canvas 2D 程序生成，静态）

function persianSurface() {
  const W = 1800, H = 1200;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const RED = '#8a1c1c', RED2 = '#6e1414', NAVY = '#1b2346', NAVY2 = '#121935',
    CREAM = '#e8d6ad', GOLD = '#c99a4b', TEAL = '#2f5d62', ROSE = '#c0574a';

  const rnd = mulberry32(7);

  // 底色
  g.fillStyle = RED; g.fillRect(0, 0, W, H);

  // 外边框：深蓝宽带 + 米色细线
  const B = 150;
  g.fillStyle = NAVY; g.fillRect(0, 0, W, H);
  g.fillStyle = RED; g.fillRect(B, B, W - 2 * B, H - 2 * B);
  stripe(18, CREAM, 6); stripe(34, RED2, 8); stripe(B - 24, CREAM, 6); stripe(B - 10, GOLD, 4);
  function stripe(inset, color, w) {
    g.strokeStyle = color; g.lineWidth = w;
    g.strokeRect(inset, inset, W - 2 * inset, H - 2 * inset);
  }

  // 边框里的花朵带
  const rosette = (x, y, r, petals, c1, c2, c3) => {
    g.save(); g.translate(x, y);
    g.fillStyle = c1;
    for (let i = 0; i < petals; i++) {
      g.rotate((Math.PI * 2) / petals);
      g.beginPath(); g.ellipse(r * 0.55, 0, r * 0.45, r * 0.2, 0, 0, Math.PI * 2); g.fill();
    }
    g.fillStyle = c2; g.beginPath(); g.arc(0, 0, r * 0.32, 0, Math.PI * 2); g.fill();
    g.fillStyle = c3; g.beginPath(); g.arc(0, 0, r * 0.14, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  const mid = B / 2 + 4;
  for (let x = 90; x < W - 60; x += 92) { rosette(x, mid, 40, 8, ROSE, CREAM, NAVY2); rosette(x, H - mid, 40, 8, ROSE, CREAM, NAVY2); }
  for (let y = 182; y < H - 140; y += 92) { rosette(mid, y, 40, 8, ROSE, CREAM, NAVY2); rosette(W - mid, y, 40, 8, ROSE, CREAM, NAVY2); }
  // 花朵之间的小叶
  g.fillStyle = TEAL;
  for (let x = 136; x < W - 100; x += 92) { leaf(x, mid, 0); leaf(x, H - mid, 0); }
  for (let y = 228; y < H - 180; y += 92) { leaf(mid, y, Math.PI / 2); leaf(W - mid, y, Math.PI / 2); }
  function leaf(x, y, a) { g.save(); g.translate(x, y); g.rotate(a); g.beginPath(); g.ellipse(0, 0, 18, 7, 0, 0, Math.PI * 2); g.fill(); g.restore(); }

  // 内场：小花散点纹
  g.save();
  g.beginPath(); g.rect(B, B, W - 2 * B, H - 2 * B); g.clip();
  for (let y = B + 30; y < H - B; y += 54) {
    for (let x = B + 30 + ((y / 54) % 2) * 27; x < W - B; x += 54) {
      const t = rnd();
      if (t < 0.55) rosette(x, y, 14, 6, t < 0.3 ? CREAM : GOLD, NAVY, CREAM);
      else { g.fillStyle = t < 0.8 ? NAVY : TEAL; g.save(); g.translate(x, y); g.rotate(Math.PI / 4); g.fillRect(-6, -6, 12, 12); g.restore(); }
    }
  }
  // 藤蔓
  g.strokeStyle = 'rgba(232,214,173,0.35)'; g.lineWidth = 3;
  for (let k = 0; k < 14; k++) {
    g.beginPath();
    let x = B + rnd() * (W - 2 * B), y = B + rnd() * (H - 2 * B);
    g.moveTo(x, y);
    for (let s = 0; s < 6; s++) { const nx = x + (rnd() - 0.5) * 260, ny = y + (rnd() - 0.5) * 200; g.quadraticCurveTo((x + nx) / 2 + 40, (y + ny) / 2 - 40, nx, ny); x = nx; y = ny; }
    g.stroke();
  }
  g.restore();

  // 四角的四分之一花饰
  const corner = (x, y, sx, sy) => {
    g.save(); g.translate(x, y); g.scale(sx, sy);
    g.beginPath(); g.moveTo(0, 0); g.lineTo(300, 0); g.quadraticCurveTo(250, 150, 0, 240); g.closePath();
    g.fillStyle = NAVY; g.fill();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(230, 0); g.quadraticCurveTo(190, 110, 0, 180); g.closePath();
    g.fillStyle = CREAM; g.fill();
    g.beginPath(); g.moveTo(0, 0); g.lineTo(160, 0); g.quadraticCurveTo(130, 70, 0, 120); g.closePath();
    g.fillStyle = RED2; g.fill();
    rosette(70, 45, 34, 8, GOLD, NAVY, CREAM);
    g.restore();
  };
  corner(B, B, 1, 1); corner(W - B, B, -1, 1); corner(B, H - B, 1, -1); corner(W - B, H - B, -1, -1);

  // 中心大花饰：多层星形 + 两端吊坠
  const cx = W / 2, cy = H / 2;
  const star = (r1, r2, n, color, rot = 0) => {
    g.beginPath();
    for (let i = 0; i < n * 2; i++) {
      const r = i % 2 ? r2 : r1, a = rot + (i * Math.PI) / n;
      const x = cx + Math.cos(a) * r * 1.35, y = cy + Math.sin(a) * r;
      i ? g.lineTo(x, y) : g.moveTo(x, y);
    }
    g.closePath(); g.fillStyle = color; g.fill();
  };
  // 吊坠
  for (const s of [-1, 1]) {
    g.save(); g.translate(cx + s * 470, cy);
    g.beginPath(); g.moveTo(-s * 60, -70); g.lineTo(s * 70, 0); g.lineTo(-s * 60, 70); g.closePath();
    g.fillStyle = NAVY; g.fill();
    rosette(0, 0, 36, 8, CREAM, RED2, GOLD);
    g.restore();
  }
  star(330, 270, 16, NAVY);
  star(300, 250, 16, CREAM, 0.1);
  star(270, 220, 16, RED2);
  star(220, 170, 12, NAVY, 0.2);
  star(170, 140, 12, GOLD);
  star(140, 110, 8, CREAM, 0.3);
  star(100, 80, 8, ROSE);
  rosette(cx, cy, 70, 12, NAVY, CREAM, RED2);
  // 中心花饰周围的小花圈
  for (let i = 0; i < 16; i++) {
    const a = (i * Math.PI) / 8;
    rosette(cx + Math.cos(a) * 245 * 1.35, cy + Math.sin(a) * 195, 16, 6, CREAM, NAVY, GOLD);
  }

  // 磨旧感：随机细斑点
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * 22;
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
