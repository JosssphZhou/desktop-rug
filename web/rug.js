// 桌面地毯主程序：布料模拟（verlet 积分加距离约束）、渲染、鼠标交互、演示脚本。
// 坐标约定：屏幕坐标以左上为原点、单位是点；世界坐标以屏幕中心为原点、y 向上、z 朝向观看者，
// 在 z=0 平面上世界坐标和屏幕点一比一。
import * as THREE from 'three';
import { createSurface, MATERIAL_IDS } from './materials.js';

const params = new URLSearchParams(location.search);
const W = innerWidth, H = innerHeight;
const post = (m) => { try { window.webkit.messageHandlers.rug.postMessage(m); } catch (e) { /* 浏览器里调试时没有宿主 */ } };

// ---------- 渲染器与相机 ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, premultipliedAlpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(W, H);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.VSMShadowMap;   // 可以模糊的软阴影，鼓包和褶子的影子边缘不会发硬
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

const FOV = 25;
const CAM_DIST = (H / 2) / Math.tan((FOV * Math.PI) / 360);
const camera = new THREE.PerspectiveCamera(FOV, W / H, 10, CAM_DIST * 3);
camera.position.set(0, 0, CAM_DIST);
camera.lookAt(0, 0, 0);

const scene = new THREE.Scene();
const hemi = new THREE.HemisphereLight(0xffffff, 0x5a4d3f, 0.8);
hemi.position.set(0, 0, 1);   // 本场景朝上的方向是 z，不是默认的 y，否则斜面的明暗会错
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff6ea, 3.0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0006;
sun.shadow.normalBias = 0.6;
sun.shadow.radius = 9;
sun.shadow.blurSamples = 16;
sun.shadow.intensity = 0.5;   // 投影淡一些，鼓包靠朝光面的亮和背光坡的暗来读，不靠一块黑影
scene.add(sun, sun.target);

// 接影子的透明地面，比布低一点，地毯边缘有一圈细影
const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H * 2), new THREE.ShadowMaterial({ opacity: 0.32 }));
ground.position.z = -1.5;
ground.receiveShadow = true;
scene.add(ground);

const toWorld = (sx, sy) => new THREE.Vector2(sx - W / 2, H / 2 - sy);
const _v = new THREE.Vector3();
function toScreen(x, y, z) {
  _v.set(x, y, z).project(camera);
  return [(_v.x + 1) * 0.5 * W, (1 - _v.y) * 0.5 * H];
}
const _ray = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
const _plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
function screenToPlane(sx, sy, z) {
  _ndc.set((sx / W) * 2 - 1, -(sy / H) * 2 + 1);
  _ray.setFromCamera(_ndc, camera);
  _plane.constant = -z;
  const out = new THREE.Vector3();
  return _ray.ray.intersectPlane(_plane, out) ? out : null;
}

// ---------- 地毯摆放状态（保存在本地） ----------
const ASPECT = 2 / 3;
function defaultPlacement() {
  return { cx: 0, cy: -H * 0.05, angle: 0, width: Math.min(W * 0.34, 680) };
}
let place = defaultPlacement();
try {
  const saved = JSON.parse(localStorage.getItem('rug.place') || 'null');
  if (saved && isFinite(saved.width)) place = saved;
} catch (e) { /* 本地存储不可用时用默认位置 */ }
if (params.get('rug')) {
  const [x, y, w] = params.get('rug').split(',').map(Number);
  const p = toWorld(x, y);
  place = { cx: p.x, cy: p.y, angle: 0, width: w || place.width };
}
const savePlace = () => { try { localStorage.setItem('rug.place', JSON.stringify(place)); } catch (e) {} };

// ---------- 布料 ----------
const NX = 84, NY = 56;   // 网格够密，鼓包边上的褶子才画得出来
const N = (NX + 1) * (NY + 1);
const idx = (i, j) => j * (NX + 1) + i;
const pos = new Float32Array(N * 3);
const prev = new Float32Array(N * 3);
const rest = new Float32Array(N * 2);
const local = new Float32Array(N * 2);   // 以地毯宽度为 1 的局部坐标
const inv = new Float32Array(N).fill(1);
const floorZ = new Float32Array(N);
const flipped = new Uint8Array(N);

for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
  const k = idx(i, j);
  local[k * 2] = i / NX - 0.5;
  local[k * 2 + 1] = (0.5 - j / NY) * ASPECT;
}

// 约束：结构、剪切、弯曲。长度按宽度为 1 记录，求解时乘以当前宽度。
const cA = [], cB = [], cL = [], cS = [];
function addC(a, b, s) {
  const dx = local[a * 2] - local[b * 2], dy = local[a * 2 + 1] - local[b * 2 + 1];
  cA.push(a); cB.push(b); cL.push(Math.hypot(dx, dy)); cS.push(s);
}
for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) {
  const k = idx(i, j);
  if (i < NX) addC(k, idx(i + 1, j), 1);
  if (j < NY) addC(k, idx(i, j + 1), 1);
  if (i < NX && j < NY) { addC(k, idx(i + 1, j + 1), 0.9); addC(idx(i + 1, j), idx(i, j + 1), 0.9); }
  // 弯曲约束偏硬：厚毯子折起来是圆弧，不会折出尖角
  if (i < NX - 1) addC(k, idx(i + 2, j), 0.42);
  if (j < NY - 1) addC(k, idx(i, j + 2), 0.42);
}
const CA = Int32Array.from(cA), CB = Int32Array.from(cB), CL = Float32Array.from(cL), CS = Float32Array.from(cS);
const NC = CA.length;

function computeRest() {
  const c = Math.cos(place.angle), s = Math.sin(place.angle), w = place.width;
  for (let k = 0; k < N; k++) {
    const lx = local[k * 2] * w, ly = local[k * 2 + 1] * w;
    rest[k * 2] = place.cx + lx * c - ly * s;
    rest[k * 2 + 1] = place.cy + lx * s + ly * c;
  }
  if (stacks.length) drapeRest();
}

// 布盖过鼓包时，坡面要多用掉一段布，四周的布会被往鼓包中心拉过去一点，
// 花纹也跟着往里聚、直线绕着鼓包弯。只改静止位置，物理和落回都以它为目标。
function drapeRest() {
  for (let k = 0; k < N; k++) {
    const x = rest[k * 2], y = rest[k * 2 + 1];
    let sx = 0, sy = 0;
    for (const st of stacks) {
      const dx = x - st.x, dy = y - st.y;
      const r = Math.hypot(dx, dy);
      if (r < 1 || r > ICON_HALF + st.F * 5) continue;
      const d = r - ICON_HALF;   // 近似为离图标边缘的距离
      if (d <= 0) continue;
      const m = (1.5 * st.h) / st.F;
      const e = Math.sqrt(1 + m * m) - 1;   // 每走一点水平距离，坡面多用掉的布
      const S = d < st.F ? e * d : e * st.F * Math.exp(-(d - st.F) / (1.6 * st.F));
      sx -= (dx / r) * Math.min(S, d * 0.8);
      sy -= (dy / r) * Math.min(S, d * 0.8);
    }
    const len = Math.hypot(sx, sy), cap = 14;
    const f = len > cap ? cap / len : 1;
    rest[k * 2] = x + sx * f;
    rest[k * 2 + 1] = y + sy * f;
  }
}

// 图标鼓包：布被下面的图标顶起来。
// 位置相近的图标算作一摞，摞得越多越高；顶部是图标的圆角方块形状，四周向外坡下去，
// 坡上有一圈放射状的褶子，像布被拉紧的样子。
let icons = [];    // {x, y} 世界坐标
let stacks = [];   // {x, y, h, F, K, ph}
const ICON_HALF = 24;      // 图标顶面的半边长
const ICON_CORNER = 9;
function buildStacks() {
  stacks = [];
  for (const ic of icons) {
    const st = stacks.find((s) => Math.hypot(s.sx / s.n - ic.x, s.sy / s.n - ic.y) < 26);
    if (st) { st.n++; st.sx += ic.x; st.sy += ic.y; }
    else stacks.push({ n: 1, sx: ic.x, sy: ic.y });
  }
  stacks.forEach((s, i) => {
    s.x = s.sx / s.n; s.y = s.sy / s.n;
    s.h = Math.min(11 + 8 * (s.n - 1), 52);   // 一个图标约 11 点高，每多一个加 8 点
    s.F = 10 + s.h * 1.15;                      // 坡的水平长度，越高坡越长
    s.K = 4 + (i % 3);                          // 褶子的条数
    s.ph = i * 1.7;
  });
}
const smooth = (t) => t * t * (3 - 2 * t);
function bumpAt(x, y) {
  let best = 0;
  for (const s of stacks) {
    const dx = x - s.x, dy = y - s.y;
    const reach = ICON_HALF + s.F * 2;
    if (dx > reach || dx < -reach || dy > reach || dy < -reach) continue;
    // 圆角方块的有向距离：方块内为负
    const qx = Math.abs(dx) - (ICON_HALF - ICON_CORNER), qy = Math.abs(dy) - (ICON_HALF - ICON_CORNER);
    const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - ICON_CORNER;
    let h;
    if (d <= 0) h = s.h * (1 + 0.04 * Math.min(-d / ICON_HALF, 1));   // 顶面略微鼓起
    else if (d < s.F) h = s.h * (1 - smooth(d / s.F));
    else h = 0;
    // 拉紧的褶子：从坡上往外放射，离开图标越远越淡
    const u = (d + 2) / (s.F * 3.4);
    if (u > 0 && u < 1) {
      const ang = Math.atan2(dy, dx);
      // 每条褶子宽窄、强弱不一，往外略微打弯
      const a = ang * s.K + s.ph + Math.sin(ang * 2 + s.ph) * 0.7 + u * 0.8;
      const ridge = Math.pow(Math.max(0, Math.cos(a)), 1.6) * (0.55 + 0.45 * Math.sin(ang * 3 + s.ph * 2));
      h += (3 + s.h * 0.4) * ridge * Math.sin(Math.PI * Math.sqrt(u)) * (1 - u);
    }
    if (h > best) best = h;
  }
  return best;
}

function snapToRest() {
  computeRest();
  for (let k = 0; k < N; k++) {
    const x = rest[k * 2], y = rest[k * 2 + 1], z = bumpAt(x, y);
    pos[k * 3] = prev[k * 3] = x;
    pos[k * 3 + 1] = prev[k * 3 + 1] = y;
    pos[k * 3 + 2] = prev[k * 3 + 2] = z;
    flipped[k] = 0;
  }
  deformed = false;
}
let deformed = false;   // 松手后布停在掀起或叠起的样子，不再自动摊平
snapToRest();

// 物理阶段：idle 静止休眠（可能停在叠起的样子），drag 被抓着，falling 松手后按重力落下直到停住，restoring 只在双击或菜单放平时摊平回原位
let phase = 'idle';
let phaseT = 0;
let calmFrames = 0;
let grabK = -1;
let grabTarget = null;
let grabStart = null;
let releasedAt = 0;
const GRAVITY = 4200;   // 比丝巾重：下落快，不飘
const LAYER = 1.5;   // 翻过来那一层的正面离底下一层的距离；厚度另由背面偏移体现

function updateFloor() {
  for (let k = 0; k < N; k++) floorZ[k] = bumpAt(pos[k * 3], pos[k * 3 + 1]) + (flipped[k] ? LAYER : 0);
}

function step(dt, restoreK) {
  const g = GRAVITY * dt * dt;
  const damp = restoreK > 0 ? 0.9 : 0.965;   // 阻尼大，落地后很快停住
  for (let k = 0; k < N; k++) {
    if (inv[k] === 0) continue;
    const o = k * 3;
    let vx = (pos[o] - prev[o]) * damp, vy = (pos[o + 1] - prev[o + 1]) * damp, vz = (pos[o + 2] - prev[o + 2]) * damp;
    prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
    let ax = 0, ay = 0, az = -g;
    if (restoreK > 0) {
      // 落回：每个点被拉向自己的静止位置，离得越远抬得越高，翻过去的那片会沿弧线翻回来
      const dx = rest[k * 2] - pos[o], dy = rest[k * 2 + 1] - pos[o + 1];
      const d = Math.hypot(dx, dy);
      const kk = restoreK * dt * dt;
      ax = dx * kk; ay = dy * kk;
      if (d > 2) az = (Math.min(d * 0.5, 150) + floorZ[k] - pos[o + 2]) * kk;
    }
    pos[o] += vx + ax; pos[o + 1] += vy + ay; pos[o + 2] += vz + az;
  }
  if (grabK >= 0 && grabTarget) {
    const o = grabK * 3;
    // 抓点平滑跟随鼠标，避免瞬移把布扯出尖角
    pos[o] += (grabTarget.x - pos[o]) * 0.5;
    pos[o + 1] += (grabTarget.y - pos[o + 1]) * 0.5;
    pos[o + 2] += (grabTarget.z - pos[o + 2]) * 0.5;
    prev[o] = pos[o]; prev[o + 1] = pos[o + 1]; prev[o + 2] = pos[o + 2];
  }
  const w = place.width;
  for (let it = 0; it < 12; it++) {
    for (let c = 0; c < NC; c++) {
      const a = CA[c] * 3, b = CB[c] * 3;
      const wa = inv[CA[c]], wb = inv[CB[c]], ws = wa + wb;
      if (ws === 0) continue;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const s = (CS[c] * (d - CL[c] * w)) / (d * ws);
      pos[a] += dx * s * wa; pos[a + 1] += dy * s * wa; pos[a + 2] += dz * s * wa;
      pos[b] -= dx * s * wb; pos[b + 1] -= dy * s * wb; pos[b + 2] -= dz * s * wb;
    }
    // 地面碰撞和摩擦
    if (it % 3 === 2 || it === 11) {
      for (let k = 0; k < N; k++) {
        const o = k * 3;
        if (pos[o + 2] < floorZ[k] + 0.5) {
          if (pos[o + 2] < floorZ[k]) pos[o + 2] = floorZ[k];
          // 贴地的点有摩擦：收回这一步大部分水平位移，地毯不会被拖着整块滑走
          if (restoreK === 0 && inv[k] > 0) {
            pos[o] = prev[o] + (pos[o] - prev[o]) * 0.35;
            pos[o + 1] = prev[o + 1] + (pos[o + 1] - prev[o + 1]) * 0.35;
          }
        }
      }
    }
  }
}

// 松手后：用还平躺着、没翻面的那部分估计地毯现在的位置和角度，作为落回的目标
function refitPlacement() {
  let n = 0, mx = 0, my = 0, lx = 0, ly = 0;
  const w = place.width;
  const keep = [];
  for (let k = 0; k < N; k++) {
    if (flipped[k] || pos[k * 3 + 2] > floorZ[k] + 4) continue;
    keep.push(k);
    mx += pos[k * 3]; my += pos[k * 3 + 1]; lx += local[k * 2] * w; ly += local[k * 2 + 1] * w; n++;
  }
  if (n < N * 0.25) return;
  mx /= n; my /= n; lx /= n; ly /= n;
  let sxx = 0, sxy = 0;
  for (const k of keep) {
    const ax = local[k * 2] * w - lx, ay = local[k * 2 + 1] * w - ly;
    const bx = pos[k * 3] - mx, by = pos[k * 3 + 1] - my;
    sxx += ax * bx + ay * by; sxy += ax * by - ay * bx;
  }
  const angle = Math.atan2(sxy, sxx);
  const c = Math.cos(angle), s = Math.sin(angle);
  const ncx = mx - (lx * c - ly * s), ncy = my - (lx * s + ly * c);
  // 只是掀了一下、整体没怎么动时落回原位；真的拖走了才认新位置
  let da = angle - place.angle; da = Math.atan2(Math.sin(da), Math.cos(da));
  if (Math.abs(da) < 0.12 && Math.hypot(ncx - place.cx, ncy - place.cy) < place.width * 0.06) return;
  place.angle = angle;
  place.cx = ncx;
  place.cy = ncy;
  savePlace();
  computeRest();
}

// ---------- 网格与材质 ----------
const geo = new THREE.BufferGeometry();
const posAttr = new THREE.BufferAttribute(pos, 3);
posAttr.setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('position', posAttr);
const uv = new Float32Array(N * 2);
for (let j = 0; j <= NY; j++) for (let i = 0; i <= NX; i++) { const k = idx(i, j); uv[k * 2] = i / NX; uv[k * 2 + 1] = 1 - j / NY; }
geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
const tri = [];
for (let j = 0; j < NY; j++) for (let i = 0; i < NX; i++) {
  const a = idx(i, j), b = idx(i + 1, j), c = idx(i, j + 1), d = idx(i + 1, j + 1);
  tri.push(a, c, b, b, c, d);
}
geo.setIndex(tri);
geo.computeVertexNormals();

// 叠在所有材质上的一层：包边和细密的织纹，让它读起来像一块织物
function makeOverlay() {
  const c = document.createElement('canvas');
  c.width = 1800; c.height = 1200;
  const g = c.getContext('2d');
  for (let y = 0; y < c.height; y += 4) { g.fillStyle = 'rgba(0,0,0,0.07)'; g.fillRect(0, y, c.width, 1.5); }
  for (let x = 0; x < c.width; x += 4) { g.fillStyle = 'rgba(255,255,255,0.035)'; g.fillRect(x, 0, 1.5, c.height); }
  const b = 16;
  g.strokeStyle = 'rgba(28,16,10,0.78)'; g.lineWidth = b * 2; g.strokeRect(0, 0, c.width, c.height);
  g.strokeStyle = 'rgba(232,214,173,0.45)'; g.lineWidth = 3; g.strokeRect(b + 4, b + 4, c.width - 2 * b - 8, c.height - 2 * b - 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const overlayTex = makeOverlay();

let surface = null;
let surfaceTex = null;
let surfaceBorn = 0;
// 正面用带绒面光泽的材质：朝光的坡面会亮起一层柔和的高光，像羊毛绒头
const frontMat = new THREE.MeshPhysicalMaterial({ roughness: 0.85, specularIntensity: 0.3, metalness: 0, side: THREE.FrontSide, sheen: 0.3, sheenRoughness: 0.5, sheenColor: new THREE.Color(0xffe2c0) });
const backMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.BackSide });
for (const m of [frontMat, backMat]) {
  m.onBeforeCompile = (shader) => {
    shader.uniforms.overlayMap = { value: overlayTex };
    shader.fragmentShader = 'uniform sampler2D overlayMap;\n' + shader.fragmentShader.replace(
      '#include <map_fragment>',
      '#include <map_fragment>\n#ifdef USE_MAP\nvec4 ovl = texture2D(overlayMap, vMapUv);\ndiffuseColor.rgb = mix(diffuseColor.rgb, ovl.rgb, ovl.a);\n#endif\n',
    );
  };
}
// 背面是地毯背后的织底：花纹褪色偏麻色，上面是一格一格的经纬结
backMat.onBeforeCompile = (shader) => {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <map_fragment>',
    `#include <map_fragment>
    #ifdef USE_MAP
    float lum = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));
    vec3 jute = vec3(0.56, 0.46, 0.33);
    diffuseColor.rgb = mix(mix(diffuseColor.rgb, vec3(lum), 0.55), jute, 0.35) * 0.82;
    vec2 g = abs(fract(vMapUv * vec2(210.0, 140.0)) - 0.5);
    float knot = smoothstep(0.3, 0.5, max(g.x, g.y));
    diffuseColor.rgb *= 1.0 - 0.32 * knot;
    #endif`,
  );
};

// 厚度：正面在布料点上，背面沿法线往下偏移一个厚度，四周再补一圈侧边
const thick = () => place.width * 0.009;
const backPos = new Float32Array(N * 3);
const backGeo = new THREE.BufferGeometry();
const backAttr = new THREE.BufferAttribute(backPos, 3);
backAttr.setUsage(THREE.DynamicDrawUsage);
backGeo.setAttribute('position', backAttr);
backGeo.setAttribute('uv', geo.getAttribute('uv'));
backGeo.setIndex(tri);
const backNrm = new THREE.BufferAttribute(new Float32Array(N * 3), 3);
backGeo.setAttribute('normal', backNrm);

const RING = [];
for (let i = 0; i < NX; i++) RING.push(idx(i, 0));
for (let j = 0; j < NY; j++) RING.push(idx(NX, j));
for (let i = NX; i > 0; i--) RING.push(idx(i, NY));
for (let j = NY; j > 0; j--) RING.push(idx(0, j));
const sidePos = new Float32Array(RING.length * 2 * 3);
const sideGeo = new THREE.BufferGeometry();
const sideAttr = new THREE.BufferAttribute(sidePos, 3);
sideAttr.setUsage(THREE.DynamicDrawUsage);
sideGeo.setAttribute('position', sideAttr);
const sideIdx = [];
for (let r = 0; r < RING.length; r++) {
  const a = r * 2, b = ((r + 1) % RING.length) * 2;
  sideIdx.push(a, a + 1, b, b, a + 1, b + 1);
}
sideGeo.setIndex(sideIdx);
const sideMat = new THREE.MeshStandardMaterial({ color: 0x2b1e16, roughness: 1, side: THREE.DoubleSide });

function updateThickness() {
  const T = thick();
  const n = geo.attributes.normal.array;
  for (let k = 0; k < N * 3; k += 3) {
    backPos[k] = pos[k] - n[k] * T;
    backPos[k + 1] = pos[k + 1] - n[k + 1] * T;
    backPos[k + 2] = pos[k + 2] - n[k + 2] * T;
  }
  backNrm.array.set(n);
  backAttr.needsUpdate = true; backNrm.needsUpdate = true;
  for (let r = 0; r < RING.length; r++) {
    const k = RING[r] * 3, o = r * 6;
    sidePos[o] = pos[k]; sidePos[o + 1] = pos[k + 1]; sidePos[o + 2] = pos[k + 2];
    sidePos[o + 3] = backPos[k]; sidePos[o + 4] = backPos[k + 1]; sidePos[o + 5] = backPos[k + 2];
  }
  sideAttr.needsUpdate = true;
  sideGeo.computeVertexNormals();
}

const front = new THREE.Mesh(geo, frontMat);
front.castShadow = true; front.receiveShadow = true;
const back = new THREE.Mesh(backGeo, backMat);
back.receiveShadow = true;
const side = new THREE.Mesh(sideGeo, sideMat);
side.castShadow = true; side.receiveShadow = true;
front.frustumCulled = back.frustumCulled = side.frustumCulled = false;
scene.add(front, back, side);

let materialId = MATERIAL_IDS.includes(params.get('material')) ? params.get('material') : 'persian';
function setMaterial(id) {
  if (!MATERIAL_IDS.includes(id)) return;
  materialId = id;
  if (surface) surface.dispose();
  if (surfaceTex) surfaceTex.dispose();
  surface = createSurface(id);
  surfaceTex = new THREE.CanvasTexture(surface.canvas);
  surfaceTex.colorSpace = THREE.SRGBColorSpace;
  surfaceTex.anisotropy = renderer.capabilities.getMaxAnisotropy();
  frontMat.map = backMat.map = params.get('plain') ? null : surfaceTex;   // plain=1 时用纯色布检查光照
  frontMat.needsUpdate = backMat.needsUpdate = true;
  surfaceBorn = performance.now();
  needsRender = true;
  post({ type: 'material', id });
}

// 流苏：两条短边上的细线，跟着边缘的方向伸出去
const FR_PER = 2;
const frCount = NY * FR_PER * 2;
const frPos = new Float32Array(frCount * 4 * 3);
const frGeo = new THREE.BufferGeometry();
const frAttr = new THREE.BufferAttribute(frPos, 3);
frAttr.setUsage(THREE.DynamicDrawUsage);
frGeo.setAttribute('position', frAttr);
const frIdx = [];
for (let f = 0; f < frCount; f++) { const b = f * 4; frIdx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
frGeo.setIndex(frIdx);
const fringe = new THREE.Mesh(frGeo, new THREE.MeshStandardMaterial({ color: 0xe6d6b4, roughness: 1, side: THREE.DoubleSide }));
fringe.frustumCulled = false;
scene.add(fringe);
const frJitter = Array.from({ length: frCount }, (_, f) => 0.85 + 0.3 * Math.abs(Math.sin(f * 12.9898) * 43758.5453 % 1));

function updateFringe() {
  const len = place.width * 0.035, half = 1.1;
  let f = 0;
  for (const side of [0, 1]) {
    const iE = side ? NX : 0, iI = side ? NX - 1 : 1;
    for (let j = 0; j < NY; j++) for (let q = 0; q < FR_PER; q++) {
      const t = (q + 0.5) / FR_PER;
      const e0 = idx(iE, j) * 3, e1 = idx(iE, j + 1) * 3, n0 = idx(iI, j) * 3, n1 = idx(iI, j + 1) * 3;
      const ex = pos[e0] + (pos[e1] - pos[e0]) * t, ey = pos[e0 + 1] + (pos[e1 + 1] - pos[e0 + 1]) * t, ez = pos[e0 + 2] + (pos[e1 + 2] - pos[e0 + 2]) * t;
      const nx = pos[n0] + (pos[n1] - pos[n0]) * t, ny = pos[n0 + 1] + (pos[n1 + 1] - pos[n0 + 1]) * t, nz = pos[n0 + 2] + (pos[n1 + 2] - pos[n0 + 2]) * t;
      let dx = ex - nx, dy = ey - ny, dz = ez - nz;
      const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
      const L = len * frJitter[f];
      const tx = ex + dx * L, ty = ey + dy * L, tz = Math.max(ez + dz * L - 1, 0.2);
      const px = -dy * half, py = dx * half;
      const b = f * 12;
      frPos.set([ex + px, ey + py, ez + 0.3, ex - px, ey - py, ez + 0.3, tx + px, ty + py, tz, tx - px, ty - py, tz], b);
      f++;
    }
  }
  frAttr.needsUpdate = true;
}

// ---------- 点击穿透：把地毯轮廓告诉宿主 ----------
let optionDown = false;
let lastHit = '';
const PERIM = [];
for (let i = 0; i <= NX; i += 2) PERIM.push(idx(i, 0));
for (let j = 2; j <= NY; j += 2) PERIM.push(idx(NX, j));
for (let i = NX - 2; i >= 0; i -= 2) PERIM.push(idx(i, NY));
for (let j = NY - 2; j > 0; j -= 2) PERIM.push(idx(0, j));

function cornersScreen(pad = 0) {
  const ks = [idx(0, 0), idx(NX, 0), idx(NX, NY), idx(0, NY)];
  const [cx, cy] = toScreen(place.cx, place.cy, 0);
  return ks.map((k) => {
    let [x, y] = toScreen(rest[k * 2], rest[k * 2 + 1], 0);
    if (pad) { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy); x += (dx / d) * pad; y += (dy / d) * pad; }
    return [x, y];
  });
}
// 点集的凸包（单调链），布停在叠起的样子时用它当可点击范围
function hullOf(pts) {
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const p of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], p) <= 0) lo.pop(); lo.push(p); }
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], p) <= 0) up.pop(); up.push(p); }
  lo.pop(); up.pop();
  return lo.concat(up);
}
function deformedHull(pad = 10) {
  const pts = [];
  for (let k = 0; k < N; k += 3) pts.push(toScreen(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]));
  const h = hullOf(pts);
  const cx = h.reduce((a, p) => a + p[0], 0) / h.length, cy = h.reduce((a, p) => a + p[1], 0) / h.length;
  return h.map(([x, y]) => { const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1; return [x + (dx / d) * pad, y + (dy / d) * pad]; });
}
function idleOutline(pad) { return deformed ? deformedHull(pad) : cornersScreen(pad); }
function publishHit() {
  let flat = [];
  if (phase === 'idle') {
    // 静止时用四个角，按 Option 时往外扩一点把角上的控制点也算进去；流苏也算在地毯里
    for (const [x, y] of idleOutline(optionDown ? 26 : 10)) flat.push(Math.round(x), Math.round(y));
  } else {
    for (const k of PERIM) { const [x, y] = toScreen(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); flat.push(Math.round(x), Math.round(y)); }
  }
  const s = flat.join(',');
  if (s !== lastHit) { lastHit = s; post({ type: 'hit', poly: flat }); }
}

// ---------- Option 控制点 ----------
const handles = [0, 1, 2, 3].map(() => {
  const d = document.createElement('div');
  Object.assign(d.style, {
    position: 'fixed', width: '12px', height: '12px', marginLeft: '-6px', marginTop: '-6px', borderRadius: '50%',
    background: '#fff', boxShadow: '0 0 0 1.5px rgba(0,0,0,0.55), 0 1px 4px rgba(0,0,0,0.4)', display: 'none', pointerEvents: 'none',
  });
  document.body.appendChild(d);
  return d;
});
function updateHandles() {
  const show = optionDown && (phase === 'idle' || mode === 'transform');
  const cs = cornersScreen();
  handles.forEach((h, i) => {
    h.style.display = show ? 'block' : 'none';
    if (show) { h.style.left = cs[i][0] + 'px'; h.style.top = cs[i][1] + 'px'; }
  });
}

// ---------- 交互 ----------
let mode = null;    // 'cloth' 掀布，'transform' Option 缩放旋转或移动
let tf = null;
let needsRender = true;

function pointInPoly(x, y, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[j];
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
  }
  return inside;
}

function beginGrab(sx, sy) {
  // 选离鼠标最近、位置最高的那个点（翻折时抓上面那层）
  let best = -1, bestScore = Infinity;
  for (let k = 0; k < N; k++) {
    const [x, y] = toScreen(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    const d = Math.hypot(x - sx, y - sy);
    if (d > 40) continue;
    const score = d - pos[k * 3 + 2] * 0.4;
    if (score < bestScore) { bestScore = score; best = k; }
  }
  if (best < 0) return false;
  grabK = best;
  inv[grabK] = 0;
  grabStart = [sx, sy];
  grabTarget = new THREE.Vector3(pos[best * 3], pos[best * 3 + 1], pos[best * 3 + 2]);
  phase = 'drag';
  mode = 'cloth';
  moveGrab(sx, sy);
  return true;
}
function moveGrab(sx, sy) {
  if (grabK < 0 || !grabStart) return;
  const dist = Math.hypot(sx - grabStart[0], sy - grabStart[1]);
  const lift = Math.min(18 + dist * 0.38, 170);
  const p = screenToPlane(sx, sy, lift);
  if (p) grabTarget.copy(p);
}
function endGrab() {
  if (grabK >= 0) inv[grabK] = 1;
  grabK = -1; grabTarget = null;
  phase = 'falling'; phaseT = 0; calmFrames = 0;
  mode = null;
  releasedAt = performance.now();
}

function beginTransform(sx, sy) {
  if (phase !== 'idle' || deformed) { refitPlacement(); snapToRest(); phase = 'idle'; }
  const cs = cornersScreen();
  const nearCorner = cs.some(([x, y]) => Math.hypot(x - sx, y - sy) < 30);
  const m = toWorld(sx, sy);
  tf = {
    kind: nearCorner ? 'scale' : 'move',
    m0: m, c0: { x: place.cx, y: place.cy }, a0: place.angle, w0: place.width,
    v0: new THREE.Vector2(m.x - place.cx, m.y - place.cy),
  };
  mode = 'transform';
}
function moveTransform(sx, sy) {
  const m = toWorld(sx, sy);
  if (tf.kind === 'move') {
    place.cx = tf.c0.x + (m.x - tf.m0.x);
    place.cy = tf.c0.y + (m.y - tf.m0.y);
  } else {
    const v = new THREE.Vector2(m.x - place.cx, m.y - place.cy);
    place.angle = tf.a0 + Math.atan2(v.y, v.x) - Math.atan2(tf.v0.y, tf.v0.x);
    place.width = Math.max(200, Math.min(W * 0.9, (tf.w0 * v.length()) / Math.max(tf.v0.length(), 1)));
  }
  snapToRest();
  needsRender = true;
}
function endTransform() { mode = null; tf = null; savePlace(); }

const cv = renderer.domElement;
cv.style.cursor = 'grab';
cv.addEventListener('pointerdown', (e) => {
  const inside = pointInPoly(e.clientX, e.clientY, idleOutline(optionDown ? 26 : 10)) || phase !== 'idle';
  if (!inside) return;
  cv.setPointerCapture(e.pointerId);
  post({ type: 'drag', active: true });
  if (e.altKey || optionDown) beginTransform(e.clientX, e.clientY);
  else if (!beginGrab(e.clientX, e.clientY)) { post({ type: 'drag', active: false }); return; }
  cv.style.cursor = mode === 'transform' ? 'move' : 'grabbing';
  wake();
});
cv.addEventListener('pointermove', (e) => {
  if (mode === 'cloth') moveGrab(e.clientX, e.clientY);
  else if (mode === 'transform') moveTransform(e.clientX, e.clientY);
});
const up = () => {
  if (mode === 'cloth') endGrab();
  else if (mode === 'transform') endTransform();
  post({ type: 'drag', active: false });
  cv.style.cursor = 'grab';
};
cv.addEventListener('dblclick', () => { flatten(); });
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);

// 明确的动作才把布整块摊平：双击地毯，或菜单里选「把地毯放平」
function flatten() {
  if (phase === 'drag' || phase === 'restoring' || (phase === 'idle' && !deformed)) return;
  refitPlacement();
  phase = 'restoring'; phaseT = 0;
  releasedAt = performance.now();
  wake();
}
window.rugFlatten = flatten;

// ---------- 主循环 ----------
let lastT = performance.now();
let frameCount = 0, fpsT = lastT, fps = 0;
let running = false;
function wake() { needsRender = true; if (!running) { running = true; lastT = performance.now(); requestAnimationFrame(loop); } }

function loop(t) {
  const cpu0 = performance.now();
  const dtFrame = Math.min((t - lastT) / 1000, 1 / 30);
  lastT = t;
  phaseT += dtFrame;

  if (phase !== 'idle') {
    const restoreK = phase === 'restoring' ? Math.min(phaseT / 0.2, 1) * (phaseT > 1.6 ? 300 : 115) : 0;
    updateFloor();
    const SUB = 2;
    for (let s = 0; s < SUB; s++) step(dtFrame / SUB, restoreK);
    // 用上一帧的法线判断哪些点翻过去了
    const nrm = geo.attributes.normal.array;
    for (let k = 0; k < N; k++) flipped[k] = nrm[k * 3 + 2] < -0.15 ? 1 : 0;
    if (phase === 'falling') {
      // 松手后只受重力：最快的点几乎不动了就算停稳，布留在落下来的样子
      let vmax = 0;
      for (let k = 0; k < N; k++) {
        if (inv[k] === 0) continue;
        const o = k * 3;
        const v = Math.abs(pos[o] - prev[o]) + Math.abs(pos[o + 1] - prev[o + 1]) + Math.abs(pos[o + 2] - prev[o + 2]);
        if (v > vmax) vmax = v;
      }
      calmFrames = vmax < 0.25 * (dtFrame * 60) ? calmFrames + 1 : 0;
      if ((calmFrames > 6 && phaseT > 0.25) || phaseT > 3) {
        let maxD = 0;
        for (let k = 0; k < N; k++) {
          const d = Math.hypot(rest[k * 2] - pos[k * 3], rest[k * 2 + 1] - pos[k * 3 + 1], pos[k * 3 + 2] - bumpAt(pos[k * 3], pos[k * 3 + 1]));
          if (d > maxD) maxD = d;
        }
        if (maxD < 3) snapToRest(); else deformed = true;   // 几乎还是平的就吸附回去，免得留下看不出来的歪斜
        phase = 'idle';
        console.log('停稳用时', (performance.now() - releasedAt).toFixed(0) + 'ms', deformed ? '停在掀起的样子' : '平整');
      }
    }
    if (phase === 'restoring') {
      let maxD = 0;
      for (let k = 0; k < N; k++) {
        const d = Math.hypot(rest[k * 2] - pos[k * 3], rest[k * 2 + 1] - pos[k * 3 + 1], pos[k * 3 + 2] - bumpAt(pos[k * 3], pos[k * 3 + 1]));
        if (d > maxD) maxD = d;
      }
      if (maxD < 1.2 || phaseT > 4) { snapToRest(); phase = 'idle'; console.log('停稳用时', (performance.now() - releasedAt).toFixed(0) + 'ms'); }
    }
    needsRender = true;
  }

  const animated = surface && (surface.animated || t - surfaceBorn < surface.warmupMs);
  // 动态材质在地毯静止时按 30 帧刷新，省一半耗电；拖动和录制时每帧都刷新
  if (animated && (phase !== 'idle' || mode !== null || recorder || (frameCount & 1) === 0)) { surfaceTex.needsUpdate = true; needsRender = true; }
  if (recorder) needsRender = true;   // 录制时每帧都画，否则录到被清空的画布

  if (needsRender) {
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    updateThickness();
    updateFringe();
    const [lx, ly] = [place.cx, place.cy];
    sun.position.set(lx - 700, ly + 760, 640);   // 斜射光，鼓包和褶皱才有明暗
    sun.target.position.set(lx, ly, 0);
    const r = place.width * 0.85;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 100, far: 3000 });
    sun.shadow.camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    needsRender = false;
  }
  if (recorder) recorder.draw();
  publishHit();
  updateHandles();

  frameCount++;
  if (t - fpsT > 1000) { fps = frameCount; frameCount = 0; fpsT = t; window.__fps = fps; if (demoRunning || params.get('debug')) console.log('帧率', fps, phase, 'cpu', (window.__cpu || 0).toFixed(1) + 'ms'); }

  window.__cpu = (window.__cpu || 0) * 0.9 + (performance.now() - cpu0) * 0.1;
  // 静止且材质不动时停掉循环，省电
  if (phase === 'idle' && !animated && mode === null && !demoRunning) { running = false; return; }
  requestAnimationFrame(loop);
}

// ---------- 宿主调用的接口 ----------
window.rugSetOption = (b) => { optionDown = b; needsRender = true; publishHit(); updateHandles(); };
window.rugSetMaterial = (id) => { setMaterial(id); wake(); };
window.rugReset = () => { place = defaultPlacement(); savePlace(); snapToRest(); phase = 'idle'; wake(); };   // 放回屏幕中间，同时摊平
window.rugSetIcons = (list) => {
  icons = list.map(([x, y]) => { const p = toWorld(x, y); return { x: p.x, y: p.y }; });
  buildStacks();
  snapToRest(); phase = 'falling'; phaseT = 0; wake();
};
window.__testMove = () => {
  // 测试 Option 拖中间移动：从地毯中心往右下拖 (60, 40) 点
  const before = { ...place };
  const [cx, cy] = toScreen(place.cx, place.cy, 0);
  window.rugSetOption(true);
  beginTransform(cx, cy);
  const kind = tf.kind;
  moveTransform(cx + 60, cy + 40);
  endTransform();
  window.rugSetOption(false);
  console.log('测试移动', kind, '中心变化', (place.cx - before.cx).toFixed(1), (place.cy - before.cy).toFixed(1), '角度变化', (place.angle - before.angle).toFixed(3), '材质', materialId);
  place = before; savePlace(); snapToRest(); wake();
};
window.rugState = () => ({ phase, deformed, place, fps: window.__fps, materialId, icons: icons.length });

// ---------- 演示脚本：用虚拟抓点走一遍，不动真鼠标 ----------
let demoRunning = false;
// 用渲染帧计时：窗口被别的窗口挡住时 WebKit 会放慢 setTimeout，但渲染帧照常
const sleep = (ms) => new Promise((r) => { const t0 = performance.now(); const f = () => (performance.now() - t0 >= ms ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
const ease = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
async function glide(from, to, ms, fn) {
  const t0 = performance.now();
  for (;;) {
    const t = Math.min((performance.now() - t0) / ms, 1), e = ease(t);
    fn(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e);
    if (t >= 1) break;
    await sleep(16);
  }
}
async function waitIdle(maxMs = 4000) { const t0 = performance.now(); while (phase !== 'idle' && performance.now() - t0 < maxMs) await sleep(50); }
const lerp2 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

window.rugDemo = async () => {
  if (demoRunning) return;
  demoRunning = true; wake();
  try {
    await sleep(700);
    if (params.get('record')) startRecording();
    console.log('演示开始');
    // 1. 抓右下角，往左上方掀起对折，松手落回
    let cs = cornersScreen();
    beginGrab(cs[2][0] - 3, cs[2][1] - 3);
    await glide(cs[2], lerp2(cs[2], cs[0], 0.62), 1300, moveGrab);
    await sleep(700);
    endGrab();
    await waitIdle();
    console.log('松手后停稳', JSON.stringify({ phase, deformed }));
    await sleep(1500);   // 留一会儿让人看到布停在叠起的样子，不会自己弹回
    console.log('1.5 秒后仍然', JSON.stringify({ phase, deformed }));
    flatten();           // 相当于双击地毯
    await sleep(300);
    await waitIdle();
    await sleep(400);
    console.log('演示第2步');
    // 2. 抓左上角，往右边翻过去
    cs = cornersScreen();
    beginGrab(cs[0][0] + 3, cs[0][1] + 3);
    await glide(cs[0], lerp2(cs[0], cs[1], 0.75), 1100, moveGrab);
    await sleep(600);
    endGrab();
    await waitIdle();
    await sleep(1200);
    flatten();
    await sleep(300);
    await waitIdle();
    await sleep(400);
    console.log('演示第3步');
    // 3. 按住 Option，拖右上角控制点：旋转并放大
    window.rugSetOption(true);
    await sleep(500);
    cs = cornersScreen();
    beginTransform(cs[1][0], cs[1][1]);
    const [ccx, ccy] = toScreen(place.cx, place.cy, 0);
    const v = [cs[1][0] - ccx, cs[1][1] - ccy];
    const rot = -0.22, sc = 1.12;
    const target = [ccx + (v[0] * Math.cos(rot) - v[1] * Math.sin(rot)) * sc, ccy + (v[0] * Math.sin(rot) + v[1] * Math.cos(rot)) * sc];
    await glide(cs[1], target, 1200, moveTransform);
    endTransform();
    await sleep(500);
    window.rugSetOption(false);
    await sleep(500);
    await waitIdle();
    console.log('演示第4步');
    // 4. 抓下边中点往上提，像拎起一块布
    cs = cornersScreen();
    const bm = lerp2(cs[3], cs[2], 0.5);
    beginGrab(bm[0], bm[1] - 3);
    await glide(bm, [bm[0] + 40, bm[1] - place.width * 0.3], 900, moveGrab);
    await sleep(500);
    endGrab();
    await waitIdle();
    await sleep(1000);
    flatten();
    await sleep(300);
    await waitIdle();
    await sleep(400);
  } finally {
    if (params.get('record')) await stopRecording();
    demoRunning = false;
    post({ type: 'demoDone' });
    console.log('演示结束', JSON.stringify(window.rugState()));
  }
};


// ---------- 网页内录制：把地毯周围一块画面录成视频，只含地毯，不经过屏幕截图 ----------
let recorder = null;
function startRecording() {
  const dpr = renderer.getPixelRatio();
  const [cx, cy] = toScreen(place.cx, place.cy, 0);
  const rw = Math.round(Math.min(W, place.width * 1.9)), rh = Math.round(Math.min(H, place.width * 1.35));
  const rx = Math.round(Math.max(0, Math.min(W - rw, cx - rw / 2))), ry = Math.round(Math.max(0, Math.min(H - rh, cy - rh / 2)));
  const out = document.createElement('canvas');
  out.width = rw & ~1; out.height = rh & ~1;
  const g = out.getContext('2d');
  const types = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm'];
  const mimeType = types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
  if (!mimeType) { console.error('不支持 MediaRecorder'); return; }
  const stream = out.captureStream(30);
  const mr = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 12e6 });
  const chunks = [];
  mr.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  mr.start(250);
  const bg = g.createRadialGradient(out.width / 2, out.height / 2, 50, out.width / 2, out.height / 2, out.width * 0.75);
  bg.addColorStop(0, '#a8875f'); bg.addColorStop(1, '#7d6244');
  recorder = {
    mr, chunks, mimeType,
    draw() {
      g.fillStyle = bg; g.fillRect(0, 0, out.width, out.height);
      g.drawImage(renderer.domElement, rx * dpr, ry * dpr, out.width * dpr, out.height * dpr, 0, 0, out.width, out.height);
      if (optionDown && (phase === 'idle' || mode === 'transform')) {
        for (const [x, y] of cornersScreen()) {
          g.beginPath(); g.arc(x - rx, y - ry, 6, 0, Math.PI * 2);
          g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5; g.strokeStyle = 'rgba(0,0,0,0.55)'; g.stroke();
        }
        g.fillStyle = 'rgba(40,30,22,0.85)'; g.beginPath(); g.roundRect(out.width / 2 - 22, out.height - 64, 44, 44, 10); g.fill();
        g.fillStyle = '#fff'; g.font = '26px -apple-system'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('⌥', out.width / 2, out.height - 42);
      }
    },
  };
  console.log('开始录制', mimeType, out.width + 'x' + out.height);
}
async function stopRecording() {
  if (!recorder) return;
  const { mr, chunks, mimeType } = recorder;
  recorder = null;
  await new Promise((r) => { mr.onstop = r; mr.stop(); });
  const buf = new Uint8Array(await new Blob(chunks, { type: mimeType }).arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  post({ type: 'recording', mime: mimeType, data: btoa(bin) });
  console.log('录制结束', buf.length, '字节');
}

// ---------- 启动 ----------
if (params.get('fakeBumps')) {
  // 模拟数据：在地毯下面放几摞假的图标，用来演示鼓包效果
  const w = place.width, h = w * ASPECT;
  // 每项是 [横向位置, 纵向位置, 这一摞有几个图标]，位置以地毯宽高为单位
  const spots = [[-0.3, 0.2, 3], [0.27, 0.22, 1], [0.24, -0.2, 2], [-0.2, -0.22, 1], [0.02, 0.02, 4]];
  icons = [];
  for (const [u, v, n] of spots) for (let s = 0; s < n; s++) icons.push({ x: place.cx + u * w + s * 4, y: place.cy + v * h - s * 3 });
  buildStacks();
  snapToRest();
  let mz = 0; for (let k = 0; k < N; k++) mz = Math.max(mz, pos[k * 3 + 2]);
  console.log('模拟图标', stacks.map((t) => `${t.n}个高${t.h}`).join(' '), '网格最高点', mz.toFixed(1));
}
if (params.get('reset')) window.rugReset();
computeRest();
setMaterial(materialId);
wake();
console.log('地毯就绪', W, H, 'dpr', devicePixelRatio, '材质', materialId, '约束', NC);
if (params.get('pose') === 'fold') {
  // 截图用的姿势：抓住右下角掀起来并一直保持
  demoRunning = true;
  setTimeout(async () => {
    const cs = cornersScreen();
    beginGrab(cs[2][0] - 3, cs[2][1] - 3);
    await glide(cs[2], lerp2(cs[2], cs[0], 0.45), 900, moveGrab);
    console.log('姿势已就位');
  }, 600);
}
if (params.get('demo')) { if (!params.get('rug')) window.rugReset(); setTimeout(() => window.rugDemo(), 800); }
