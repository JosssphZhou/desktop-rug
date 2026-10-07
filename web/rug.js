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
const ground = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, H * 2), new THREE.ShadowMaterial({ opacity: 0.4 }));
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
const ASPECT = 44 / 70;   // 宽高比 1.59，参考视频静止的地毯是 1.598
// 默认位置按参考视频 f0700：毯宽占屏宽 46%（屏幕很宽时最多 720 点，约十二个桌面图标宽），
// 中心在屏幕横向 50.4%、纵向 44.1% 处，逆时针歪 3 度
function defaultPlacement() {
  return { cx: W * 0.004, cy: H * 0.059, angle: (3 * Math.PI) / 180, width: Math.min(W * 0.46, 720) };
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
// 测试时用 --rug 指定了位置，就不写回本地存储，免得覆盖老板平时摆好的位置
const savePlace = () => { if (params.get('rug')) return; try { localStorage.setItem('rug.place', JSON.stringify(place)); } catch (e) {} };

// ---------- 布料 ----------
const NX = 70, NY = 44;   // 网格是正方形，宽高比 70:44 约等于参考视频里的 1.6
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
const BEND2 = +(params.get('bend2') ?? 0.5), BEND4 = +(params.get('bend4') ?? 0.15);
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
  // 弯曲约束分两档：隔一格的管小皱，隔三格的管大褶。只有隔一格的话，布一压就皱成一团小褶子，像破布
  if (i < NX - 1) addC(k, idx(i + 2, j), BEND2);
  if (j < NY - 1) addC(k, idx(i, j + 2), BEND2);
  if (BEND4 > 0 && i < NX - 3) addC(k, idx(i + 4, j), BEND4);
  if (BEND4 > 0 && j < NY - 3) addC(k, idx(i, j + 4), BEND4);
}
const CA = Int32Array.from(cA), CB = Int32Array.from(cB), CL = Float32Array.from(cL), CS = Float32Array.from(cS);
const NC = CA.length;
const ITER = +(params.get('iter') ?? 8);           // 每个子步里约束迭代的次数
const FRIC_DRAG = +(params.get('fric') ?? 0.09);   // 抓着拖时地面摩擦每次扣掉的滑动（点），按毯宽 680 为基准
const LEASH = +(params.get('leash') ?? 1.25);   // 抓点离周围的点最远不超过静止间距的 1.25 倍
const STICK = +(params.get('stick') ?? 40);   // 松手后贴地的点慢于每秒 40 点（毯宽 680 为基准）就粘住不动
const SPASS = +(params.get('spass') ?? 12);   // 限制伸长的遍数：2 遍时猛拖仍会局部拉长 15% 以上，12 遍压到 9% 以内
const MAX_STRAIN = +(params.get('strain') ?? 1.04);  // 最大伸长：布不能被拉长，最多比静止长度长 4%
const LIM = Int32Array.from(Array.from({ length: NC }, (_, c) => c).filter((c) => CS[c] >= 0.5));
const NLIM = LIM.length;
const LRA = +(params.get('lra') ?? 1.01);   // 长程牵引的松量，0 表示关掉

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
    const len = Math.hypot(sx, sy), cap = 3;   // 参考视频里没有可见的鼓包，花纹几乎不往里收
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
    s.h = Math.min(2 + 1.2 * (s.n - 1), 10);   // 参考视频里几乎看不出鼓包：一个图标约 2 点，每多一个加 1.2 点，最多 10 点
    s.F = 18 + 2 * s.h;                         // 坡的水平长度，缓缓地坡下去
    s.K = 4 + (i % 3);                          // 褶子的条数
    s.ph = i * 1.7;
  });
}
const RIDGE_AMP = 0;   // 放射状褶子的强度，参考视频里没有，先关掉；要试效果时改成 1
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
      h += RIDGE_AMP * Math.min(0.15 * s.h, 1) * ridge * Math.sin(Math.PI * Math.sqrt(u)) * (1 - u);
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
let calmMs = 0;
let grabK = -1;
let grabTarget = null;
let grabZ0 = 0;
let grabStart = null;
let releasedAt = 0;
const GRAVITY = 4200;   // 比丝巾重：下落快，不飘
const thick = () => Math.min(Math.max(place.width * 0.003, 1.2), 2.5);   // 参考视频里的布很薄，叠层只多几个像素
const LAYER = () => thick() + 0.5;   // 翻过来那一层的正面离底下一层的距离，至少比厚度多一点

function updateFloor() {
  for (let k = 0; k < N; k++) floorZ[k] = bumpAt(pos[k * 3], pos[k * 3 + 1]) + (flipped[k] ? LAYER() : 0);
}

// 布在桌面上盖住的面积占摊平时的比例：按一格的边长打格子，数有布点落进去的格子。摊平是 1，对折一半约 0.5 到 0.65，皱成一团更小
const coverSet = new Set();
function coverFrac() {
  const cell = place.width / NX;
  coverSet.clear();
  for (let k = 0; k < N; k++) coverSet.add(Math.floor(pos[k * 3] / cell) * 100003 + Math.floor(pos[k * 3 + 1] / cell));
  return coverSet.size / N;
}
function step(dt, restoreK, curlK = 0, extraDamp = 1) {
  const g = GRAVITY * dt * dt;
  const damp = Math.pow(restoreK > 0 ? 0.9 : 0.965, dt * 120) * (extraDamp < 1 ? Math.pow(extraDamp, dt * 120) : 1);   // 以 120 Hz 子步为基准，和帧率无关
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
    if (curlK > 0 && !flipped[k]) {
      // 没翻过去、离原位不远的小翘角：慢慢放平（参考视频里翘角约 0.3 到 0.7 秒缓缓落下，没有来回弹）
      const dx = rest[k * 2] - pos[o], dy = rest[k * 2 + 1] - pos[o + 1], dz = floorZ[k] - pos[o + 2];
      const lim = place.width * 0.10;
      if (Math.hypot(dx, dy) < lim && -dz < lim * 0.8) { const kk = curlK * dt * dt; ax += dx * kk; ay += dy * kk; az += dz * kk * 0.5; }
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
  for (let it = 0; it < ITER; it++) {
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
    if (it === 1 || it === ITER - 1) {
      for (let k = 0; k < N; k++) {
        const o = k * 3;
        if (pos[o + 2] < floorZ[k] + 0.5) {
          if (pos[o + 2] < floorZ[k]) pos[o + 2] = floorZ[k];
          // 贴地的点有摩擦：收回这一步大部分水平位移，地毯不会被拖着整块滑走
          if (restoreK === 0 && inv[k] > 0) {
            let fx = pos[o] - prev[o], fy = pos[o + 1] - prev[o + 1];
            if (phase === 'drag') {
              // 抓着拖时是库仑摩擦：每步只扣掉固定的一小段滑动，拉得动就整块跟着走，没被拉的部分贴着不动
              const m = Math.hypot(fx, fy), cut = Math.min(m, FRIC_DRAG * place.width / 680);
              if (m > 1e-9) { fx *= (m - cut) / m; fy *= (m - cut) / m; }
            } else if (Math.hypot(fx, fy) < STICK * dt * place.width / 680) { fx = 0; fy = 0; }   // 静摩擦：贴地的点慢慢蹭的时候直接粘住，布不会一直蠕动
            else { fx *= 0.35; fy *= 0.35; }   // 松手后摩擦大，布停在原地
            pos[o] = prev[o] + fx;
            pos[o + 1] = prev[o + 1] + fy;
          }
        }
      }
    }
  }
  // 抓点的「牵绳」：布拖不动时，手拽着的那个点落在鼠标后面，不把布在抓点周围拉成长长的尖角
  if (grabK >= 0 && phase === 'drag') {
    const gi = grabK % (NX + 1), gj = (grabK / (NX + 1)) | 0;
    for (let q = 0; q < 3; q++) {
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        if (!di && !dj) continue;
        const ni = gi + di, nj = gj + dj;
        if (ni < 0 || nj < 0 || ni > NX || nj > NY) continue;
        const n = idx(ni, nj) * 3, g0 = grabK * 3;
        const Lr = Math.hypot(di, dj) * (place.width / NX) * LEASH;   // 网格间距近似；横纵间距略有不同，取平均
        const dx = pos[n] - pos[g0], dy = pos[n + 1] - pos[g0 + 1], dz = pos[n + 2] - pos[g0 + 2];
        const d = Math.hypot(dx, dy, dz);
        if (d > Lr) { const f = (d - Lr) / d; pos[g0] += dx * f * 0.5; pos[g0 + 1] += dy * f * 0.5; pos[g0 + 2] += dz * f * 0.5; }
      }
    }
    const g0 = grabK * 3; prev[g0] = pos[g0]; prev[g0 + 1] = pos[g0 + 1]; prev[g0 + 2] = pos[g0 + 2];
  }
  // 长程牵引：任何一点离抓点的直线距离都不能超过两点在布上的距离。拉的时候整块布立刻跟着走，
  // 不会只有抓点附近被拉长，远处还留在原地
  if (grabK >= 0 && phase === 'drag' && LRA) {
    const g0 = grabK * 3, gx = local[grabK * 2], gy = local[grabK * 2 + 1];
    for (let k = 0; k < N; k++) {
      if (inv[k] === 0) continue;
      const o = k * 3;
      const L = Math.hypot(local[k * 2] - gx, local[k * 2 + 1] - gy) * w * LRA;
      const dx = pos[g0] - pos[o], dy = pos[g0 + 1] - pos[o + 1], dz = pos[g0 + 2] - pos[o + 2];
      const d = Math.hypot(dx, dy, dz);
      if (d > L) { const f = (d - L) / d; pos[o] += dx * f; pos[o + 1] += dy * f; pos[o + 2] += dz * f; }
    }
  }
  // 限制最大伸长：布不能被拉长。结构约束和剪切约束超过 MAX_STRAIN 就直接拉回，这样拖得再猛也不会拉成橡皮
  for (let pass = 0; pass < SPASS; pass++) {
    for (let q = 0; q < NLIM; q++) {
      const c = LIM[q];
      const a = CA[c] * 3, b = CB[c] * 3;
      const wa = inv[CA[c]], wb = inv[CB[c]], ws = wa + wb;
      if (ws === 0) continue;
      const dx = pos[b] - pos[a], dy = pos[b + 1] - pos[a + 1], dz = pos[b + 2] - pos[a + 2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6;
      const L = CL[c] * w * MAX_STRAIN;
      if (d <= L) continue;
      const s = (d - L) / (d * ws);
      pos[a] += dx * s * wa; pos[a + 1] += dy * s * wa; pos[a + 2] += dz * s * wa;
      pos[b] -= dx * s * wb; pos[b + 1] -= dy * s * wb; pos[b + 2] -= dz * s * wb;
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
  let angle = Math.atan2(sxy, sxx);
  // 布皱成一团时贴地的点不再是一块刚性的布，拟合出的角度不可信（重放视频时曾一下转了 83 度、挪了 330 点）。
  // 这时只按贴地部分平移，角度保持原样
  let c = Math.cos(angle), s = Math.sin(angle), err = 0;
  for (const k of keep) {
    const ax = local[k * 2] * w - lx, ay = local[k * 2 + 1] * w - ly;
    err += (pos[k * 3] - mx - (ax * c - ay * s)) ** 2 + (pos[k * 3 + 1] - my - (ax * s + ay * c)) ** 2;
  }
  if (Math.sqrt(err / n) > w * 0.06) { angle = place.angle; c = Math.cos(angle); s = Math.sin(angle); }
  const ncx = mx - (lx * c - ly * s), ncy = my - (lx * s + ly * c);
  // 只是掀了一下、整体没怎么动时落回原位；真的拖走了才认新位置
  let da = angle - place.angle; da = Math.atan2(Math.sin(da), Math.cos(da));
  if (Math.abs(da) < 0.02 && Math.hypot(ncx - place.cx, ncy - place.cy) < place.width * 0.01) return;
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

// 叠在所有材质上的一层：包边上的细罗纹
function makeOverlay() {
  const c = document.createElement('canvas');
  c.width = 1800; c.height = 1200;
  const g = c.getContext('2d');
  // 参考视频里内场看不出织纹，只有包边上有很细的竖向罗纹（f0700）。包边约 0.8% 毯宽，图案自带
  const e = Math.round(c.width * 0.008);
  for (let x = 0; x < c.width; x += 3) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(x, 0, 1, e); g.fillRect(x, c.height - e, 1, e); }
  for (let y = 0; y < c.height; y += 3) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y, e, 1); g.fillRect(c.width - e, y, e, 1); }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const overlayTex = makeOverlay();

let surface = null;
let surfaceTex = null;
let surfaceBorn = 0;
// 正面用带绒面光泽的材质：朝光的坡面会亮起一层柔和的高光，像羊毛绒头
// 参考视频里的布面是哑光的，没有高光
const frontMat = new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0, side: THREE.FrontSide });
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
// 参考视频里翻过去的那一面和正面是同一幅图案，颜色相差不到 3%，所以背面直接用同一张贴图

// 厚度：正面在布料点上，背面沿法线往下偏移一个厚度，四周再补一圈侧边
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
const sideMat = new THREE.MeshStandardMaterial({ color: 0x4a1012, roughness: 1, side: THREE.DoubleSide });

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
const rugGroup = new THREE.Group();
rugGroup.matrixAutoUpdate = false;
rugGroup.add(front, back, side);
scene.add(rugGroup);

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
  liveUntil = surfaceBorn + LIVE_MS;
  surfaceLive = true;
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
fringe.visible = false;   // 参考视频里的地毯没有流苏
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

// ---------- 按住 Option 选中地毯（参考视频 f1030 到 f1054 选中，f1342 到 f1346 取消） ----------
// 选中时布拉直：宽度 24 帧里先冲到 1.063 倍（第 14 帧）再回到 1.037 倍，高度一直升到 1.092 倍，
// 整块抬起，影子变大。取消时 4 帧内线性落回。这些倍数是视频里 764x476 到 792x520 的量。
const SEL_SX = 792 / 764, SEL_SY = 520 / 476, SEL_LIFT = 16, SEL_PEAK = (812 - 764) / (792 - 764);
let selOn = false, selT0 = -1e9;
const selNow = { w: 0, h: 0, z: 0 }, selFrom = { w: 0, h: 0, z: 0 };
function updateSel(now) {
  const n = ((now - selT0) / 1000) * 60;   // 进入当前状态后过了几帧（按 60 帧）
  if (selOn) {
    const eo = (t) => 1 - (1 - t) * (1 - t);
    selNow.w = n < 14 ? SEL_PEAK * eo(n / 14) : n < 24 ? SEL_PEAK + (1 - SEL_PEAK) * smooth((n - 14) / 10) : 1;
    selNow.h = smooth(Math.min(n / 24, 1));
    selNow.z = smooth(Math.min(n / 16, 1));
  } else {
    const u = Math.max(0, 1 - n / 4);
    selNow.w = selFrom.w * u; selNow.h = selFrom.h * u; selNow.z = selFrom.z * u;
  }
  const { w: pw, h: ph, z: pz } = selNow, sx = 1 + (SEL_SX - 1) * pw, sy = 1 + (SEL_SY - 1) * ph;
  const a = place.angle, c = Math.cos(a), si = Math.sin(a);
  const m00 = c * c * sx + si * si * sy, m01 = c * si * (sx - sy), m11 = si * si * sx + c * c * sy;
  rugGroup.matrix.set(m00, m01, 0, place.cx - (m00 * place.cx + m01 * place.cy), m01, m11, 0, place.cy - (m01 * place.cx + m11 * place.cy), 0, 0, 1, SEL_LIFT * pz, 0, 0, 0, 1);
  rugGroup.matrixWorldNeedsUpdate = true;
  return selOn ? n < 26 : n < 5;   // 还在动画里
}
// 世界坐标里的一点在选中变形之后落在屏幕哪里
function selScreen(x, y, z = 0) {
  _sv.set(x, y, z).applyMatrix4(rugGroup.matrix);
  return toScreen(_sv.x, _sv.y, _sv.z);
}
const _sv = new THREE.Vector3();
function setSelected(b) {
  if (b === selOn) return;
  if (!b) { selFrom.w = selNow.w; selFrom.h = selNow.h; selFrom.z = selNow.z; }
  selOn = b; selT0 = now();
  // 选中时布先放平（参考视频 f1030 右上角的翘角在选中后 24 帧内拉平）
  if (b && (deformed || phase === 'falling')) flatten();
  wake();
}

function cornersScreen(pad = 0) {
  const ks = [idx(0, 0), idx(NX, 0), idx(NX, NY), idx(0, NY)];
  const [cx, cy] = selScreen(place.cx, place.cy, 0);
  return ks.map((k) => {
    let [x, y] = selScreen(rest[k * 2], rest[k * 2 + 1], 0);
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
// 点击穿透用的网格：布面三角形在屏幕上的投影算「地毯在这里」，地毯被掀走后露出来的桌面放行，
// 这样掀开一角后，文件可以拖进露出来的那块桌面
const MASK_CELL = 6;
let maskDirty = false;
function postMask() {
  const mw = Math.ceil(W / MASK_CELL), mh = Math.ceil(H / MASK_CELL);
  updateFloor();
  const sp = new Float32Array(N * 2);
  const gr = new Uint8Array(N);
  for (let k = 0; k < N; k++) {
    const [x, y] = toScreen(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]);
    sp[k * 2] = x / MASK_CELL; sp[k * 2 + 1] = y / MASK_CELL;
    gr[k] = 1;   // 所有可见的布面都算，悬空的折角也能被抓住
  }
  const bytes = new Uint8Array(mw * mh);
  let on = 0;
  // 每个贴地的三角形把它外接矩形盖到的格子都标上，三角形只有几个像素大，不用再画轮廓
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t], b = tri[t + 1], c = tri[t + 2];
    if (!(gr[a] && gr[b] && gr[c])) continue;
    const x0 = Math.max(0, Math.floor(Math.min(sp[a * 2], sp[b * 2], sp[c * 2]))), x1 = Math.min(mw - 1, Math.floor(Math.max(sp[a * 2], sp[b * 2], sp[c * 2])));
    const y0 = Math.max(0, Math.floor(Math.min(sp[a * 2 + 1], sp[b * 2 + 1], sp[c * 2 + 1]))), y1 = Math.min(mh - 1, Math.floor(Math.max(sp[a * 2 + 1], sp[b * 2 + 1], sp[c * 2 + 1])));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * mw + x; if (!bytes[i]) { bytes[i] = 1; on++; } }
  }
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  window.__mask = { w: mw, h: mh, cell: MASK_CELL, bytes };
  post({ type: 'hitMask', w: mw, h: mh, cell: MASK_CELL, data: btoa(bin) });
  console.log('点击范围网格', mw + 'x' + mh, '贴地格数', on);
}
function idleOutline(pad) { return deformed ? deformedHull(pad) : cornersScreen(pad); }
function publishHit() {
  if (phase === 'idle' && deformed && !optionDown) {
    // 布停在叠起的样子：只让贴着桌面的部分接收鼠标，其余穿透
    if (maskDirty) { maskDirty = false; lastHit = 'mask'; postMask(); }
    return;
  }
  let flat = [];
  if (phase === 'idle') {
    // 静止时用四个角，按 Option 时往外扩一点把角上的控制点也算进去；流苏也算在地毯里
    let pts = idleOutline(optionDown ? 36 : 10);
    const pr = optionDown && selUI().pill;
    if (pr) pts = hullOf(pts.concat([[pr[0], pr[1]], [pr[0] + pr[2], pr[1]], [pr[0] + pr[2], pr[1] + pr[3] + 4], [pr[0], pr[1] + pr[3] + 4]]));
    for (const [x, y] of pts) flat.push(Math.round(x), Math.round(y));
  } else {
    for (const k of PERIM) { const [x, y] = toScreen(pos[k * 3], pos[k * 3 + 1], pos[k * 3 + 2]); flat.push(Math.round(x), Math.round(y)); }
  }
  const s = flat.join(',');
  if (s !== lastHit) { lastHit = s; post({ type: 'hit', poly: flat }); if (params.get('debug')) console.log('点击范围', s); }
}

// ---------- Option 选中时的控制点、花样条、角度气泡（参考视频 f1054、f1210） ----------
// 四角是小白点；地毯最低点下方约 42 点处有一条「花样 | 垃圾桶」小条；拖角旋转时光标旁显示角度
const handles = [0, 1, 2, 3].map(() => {
  const d = document.createElement('div');
  Object.assign(d.style, {
    position: 'fixed', width: '8px', height: '8px', marginLeft: '-4px', marginTop: '-4px', borderRadius: '50%',
    background: '#fff', boxShadow: '0 0 0 1px rgba(0,0,0,0.35), 0 1px 2px rgba(0,0,0,0.3)', display: 'none', pointerEvents: 'none',
  });
  document.body.appendChild(d);
  return d;
});
const HOT = '#2f7cf6';
const PILL_W = 136, PILL_H = 36, PILL_GAP = 24;
const ICON_SWATCH = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="2" width="5" height="12" rx="1.6"/><path d="M6.5 5.2l3.6-2.1a1.4 1.4 0 0 1 1.9.5l3 5.2a1.4 1.4 0 0 1-.5 1.9L6.5 14"/><circle cx="4" cy="11.3" r=".9" fill="currentColor"/></svg>';
const ICON_TRASH = '<svg width="13" height="15" viewBox="0 0 13 15" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1 3.2h11M4.5 3.2V1.6h4v1.6M2.4 3.2l.8 10.2h6.6l.8-10.2M5 5.8v5.3M8 5.8v5.3"/></svg>';
const pill = document.createElement('div');
Object.assign(pill.style, {
  position: 'fixed', width: PILL_W + 'px', height: PILL_H + 'px', borderRadius: PILL_H / 2 + 'px', display: 'none',
  background: 'rgba(176,131,89,0.94)', boxShadow: 'inset 0 0 0 1px rgba(255,236,210,0.18), 0 1px 3px rgba(60,35,15,0.18)',
  color: 'rgba(250,226,192,0.95)', font: '600 13px -apple-system, "PingFang SC", sans-serif', alignItems: 'center', userSelect: 'none', cursor: 'default',
});
pill.innerHTML = `<div data-act="design" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px;height:100%">${ICON_SWATCH}<span>花样</span></div>`
  + '<div style="width:1px;height:18px;background:rgba(250,226,192,0.28)"></div>'
  + `<div data-act="trash" style="width:42px;display:flex;align-items:center;justify-content:center;height:100%">${ICON_TRASH}</div>`;
document.body.appendChild(pill);
pill.addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'design') { const i = MATERIAL_IDS.indexOf(materialId); setMaterial(MATERIAL_IDS[(i + 1) % MATERIAL_IDS.length]); touchLive(); }
  else if (act === 'trash') post({ type: 'quit' });   // 收起地毯：退出应用，下次打开还在原处
});
const bubble = document.createElement('div');
Object.assign(bubble.style, {
  position: 'fixed', display: 'none', padding: '2px 6px', borderRadius: '6px', background: 'rgba(92,64,40,0.9)',
  color: '#f6e7d2', font: '600 11px -apple-system, sans-serif', pointerEvents: 'none',
});
document.body.appendChild(bubble);
let pointerX = 0, pointerY = 0;
// 控制点、花样条和气泡的位置，DOM 和录像共用
function selUI() {
  const show = selOn && (phase === 'idle' || phase === 'restoring' || mode === 'transform');
  const cs = cornersScreen();
  const [ccx] = selScreen(place.cx, place.cy, 0);
  const bottom = Math.max(...cs.map((p) => p[1]));
  let deg = Math.round((place.angle * 180) / Math.PI) % 360; if (deg > 180) deg -= 360; if (deg <= -180) deg += 360;
  return {
    handles: show ? cs : null,
    pill: show && selNow.h > 0.6 ? [ccx - PILL_W / 2, bottom + PILL_GAP, PILL_W, PILL_H] : null,
    bubble: mode === 'transform' && tf && tf.kind === 'rotate' ? [pointerX + 14, pointerY + 10, deg + '°'] : null,
    // 光标停在角点上（或正按着角点缩放）时，那个角点变蓝（参考视频 f1300）
    hot: show ? cs.findIndex(([x, y], i) => (mode === 'transform' && tf ? tf.kind === 'scale' && i === tf.ci : Math.hypot(x - pointerX, y - pointerY) < 10)) : -1,
  };
}
function updateHandles() {
  const ui = selUI();
  handles.forEach((h, i) => {
    h.style.display = ui.handles ? 'block' : 'none';
    if (ui.handles) { h.style.left = ui.handles[i][0] + 'px'; h.style.top = ui.handles[i][1] + 'px'; h.style.background = i === ui.hot ? HOT : '#fff'; }
  });
  pill.style.display = ui.pill ? 'flex' : 'none';
  if (ui.pill) { pill.style.left = ui.pill[0] + 'px'; pill.style.top = ui.pill[1] + 'px'; }
  bubble.style.display = ui.bubble ? 'block' : 'none';
  if (ui.bubble) { bubble.style.left = ui.bubble[0] + 'px'; bubble.style.top = ui.bubble[1] + 'px'; bubble.textContent = ui.bubble[2]; }
}
// 录像和调试截图里没有 DOM，把同样的东西画到二维画布上
function drawSelUI(g, ox, oy) {
  const ui = selUI();
  if (ui.handles) for (const [i, [x, y]] of ui.handles.entries()) { g.beginPath(); g.arc(x - ox, y - oy, 4, 0, Math.PI * 2); g.fillStyle = i === ui.hot ? HOT : '#fff'; g.fill(); g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,0.35)'; g.stroke(); }
  if (ui.pill) {
    const [x, y, w, h] = ui.pill;
    g.fillStyle = 'rgba(176,131,89,0.94)'; g.beginPath(); g.roundRect(x - ox, y - oy, w, h, h / 2); g.fill();
    g.fillStyle = 'rgba(250,226,192,0.95)'; g.font = '600 13px -apple-system, "PingFang SC"'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('▱ 花样', x - ox + (w - 43) / 2, y - oy + h / 2); g.fillText('🗑', x - ox + w - 21, y - oy + h / 2);
    g.fillStyle = 'rgba(250,226,192,0.28)'; g.fillRect(x - ox + w - 43, y - oy + 9, 1, h - 18);
  }
  if (ui.bubble) {
    const [x, y, t] = ui.bubble;
    g.font = '600 11px -apple-system'; const tw = g.measureText(t).width + 12;
    g.fillStyle = 'rgba(92,64,40,0.9)'; g.beginPath(); g.roundRect(x - ox, y - oy, tw, 18, 6); g.fill();
    g.fillStyle = '#f6e7d2'; g.textAlign = 'left'; g.textBaseline = 'middle'; g.fillText(t, x - ox + 6, y - oy + 9);
  }
}

// ---------- 交互 ----------
let mode = null;    // 'cloth' 掀布，'transform' Option 缩放旋转或移动
let tf = null;
let needsRender = true;
const snapQueue = [];

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
  grabZ0 = pos[best * 3 + 2];   // 抓到的那一刻布离桌面多高，鼠标没动之前不再抬
  grabSX = sx; grabSY = sy; grabMoveT = now();
  phase = 'drag';
  mode = 'cloth';
  moveGrab(sx, sy);
  return true;
}
// 鼠标停住时抓着的那一角慢慢放到桌面上（参考视频 f0278 到 f0290、f0503 到 f0515：光标停着，折过去的那片已经平躺）
let grabSX = 0, grabSY = 0, grabZFull = 0, grabMoveT = 0;
function moveGrab(sx, sy) {
  if (grabK < 0 || !grabStart) return;
  const dist = Math.hypot(sx - grabStart[0], sy - grabStart[1]);
  // 6 点死区：鼠标还没明显移动时布不抬；之后每移动 1 点抬 0.16 点，最多抬到毯宽的 10%
  const lift = Math.min(Math.max(dist - 6, 0) * 0.16, place.width * 0.1);
  let z = grabZ0 + lift;
  const p = screenToPlane(sx, sy, z);
  if (!p) return;
  // 把布拖回它原来的位置附近（32 点内）时逐渐放低，盖回去不会悬在半空
  const dr = Math.hypot(p.x - rest[grabK * 2], p.y - rest[grabK * 2 + 1]);
  if (dr < 32) {
    const base = floorZ[grabK];
    z = base + (grabZ0 + lift - base) * (dr / 32);
  }
  if (Math.hypot(sx - grabSX, sy - grabSY) > 0.5) grabMoveT = now();
  grabSX = sx; grabSY = sy; grabZFull = z;
  holdGrab();
}
// 光标停住 80 毫秒后，抓点高度按 0.12 秒的时间常数降到贴着下面那层布
function holdGrab() {
  if (grabK < 0 || !grabTarget) return;
  const still = now() - grabMoveT;
  const h = params.get('nohold') || still < 80 ? 1 : Math.exp(-(still - 80) / +(params.get('holdtau') ?? 120));
  const base = Math.min(grabZFull, floorZ[grabK] + thick());
  const p = screenToPlane(grabSX, grabSY, base + (grabZFull - base) * h);
  if (p) grabTarget.copy(p);
}
function endGrab() {
  if (grabK >= 0) inv[grabK] = 1;
  grabK = -1; grabTarget = null;
  refitPlacement();   // 拖着滑走的布以现在的位置为准，不拉回老地方
  phase = 'falling'; phaseT = 0; calmMs = 0;
  mode = null;
  releasedAt = performance.now();
}

// 角点 10 点以内算「角上」（缩放），角外 10 到 36 点、又不在布上算「角外」（旋转）
function nearestCorner(sx, sy) {
  const cs = cornersScreen();
  let bi = 0;
  cs.forEach(([x, y], i) => { if (Math.hypot(x - sx, y - sy) < Math.hypot(cs[bi][0] - sx, cs[bi][1] - sy)) bi = i; });
  return bi;
}
function cornerZone(sx, sy) {
  const cs = cornersScreen();
  let best = Infinity;
  for (const [x, y] of cs) best = Math.min(best, Math.hypot(x - sx, y - sy));
  if (best < 10) return 'scale';
  if (best < 36 && !pointInPoly(sx, sy, cs)) return 'rotate';
  return null;
}
function beginTransform(sx, sy) {
  if (phase === 'falling') { phase = 'idle'; deformed = true; maskDirty = true; }   // 变形时布停在现在的样子
  else if (phase === 'restoring') { snapToRest(); phase = 'idle'; }
  // 参考视频 f1300 起：按在角点上拖是缩放；f1150 起：按在角外一圈拖是旋转；按在布上拖是移动
  const kind = cornerZone(sx, sy) || 'move';
  const ci = nearestCorner(sx, sy), ko = [idx(0, 0), idx(NX, 0), idx(NX, NY), idx(0, NY)][(ci + 2) % 4];
  const m = toWorld(sx, sy);
  tf = {
    kind,
    ci, opp: { x: rest[ko * 2], y: rest[ko * 2 + 1] }, m0: m, c0: { x: place.cx, y: place.cy }, a0: place.angle, w0: place.width,
    v0: new THREE.Vector2(m.x - place.cx, m.y - place.cy),
  };
  mode = 'transform';
}
// 布叠着时，把整块布（位置、上一步位置、静止位置）跟着摆放的变化一起平移、旋转、缩放
function applyPlaceDelta(a, b) {
  const dA = b.angle - a.angle, c = Math.cos(dA), s = Math.sin(dA), r = b.width / a.width;
  for (const arr of [pos, prev]) {
    for (let k = 0; k < N; k++) {
      const o = k * 3, x = arr[o] - a.cx, y = arr[o + 1] - a.cy;
      arr[o] = b.cx + (x * c - y * s) * r;
      arr[o + 1] = b.cy + (x * s + y * c) * r;
      arr[o + 2] *= r;
    }
  }
}
function moveTransform(sx, sy) {
  const m = toWorld(sx, sy);
  const before = { ...place };
  if (tf.kind === 'move') {
    place.cx = tf.c0.x + (m.x - tf.m0.x);
    place.cy = tf.c0.y + (m.y - tf.m0.y);
  } else if (tf.kind === 'rotate') {
    const v = new THREE.Vector2(m.x - place.cx, m.y - place.cy);
    place.angle = tf.a0 + Math.atan2(v.y, v.x) - Math.atan2(tf.v0.y, tf.v0.x);
  } else {
    // 缩放时对角不动（参考视频 f1300 到 f1350：宽从 804 放到 867，中心跟着往右下挪了 45 点）
    const o = tf.opp, d0x = tf.m0.x - o.x, d0y = tf.m0.y - o.y;
    let k = ((m.x - o.x) * d0x + (m.y - o.y) * d0y) / Math.max(d0x * d0x + d0y * d0y, 1);
    k = Math.max(200 / tf.w0, Math.min((W * 0.9) / tf.w0, k));
    place.width = tf.w0 * k;
    place.cx = o.x + (tf.c0.x - o.x) * k;
    place.cy = o.y + (tf.c0.y - o.y) * k;
  }
  if (deformed) { applyPlaceDelta(before, place); computeRest(); maskDirty = true; }
  else snapToRest();
  needsRender = true;
}
function endTransform() { mode = null; tf = null; savePlace(); }

let lastDownT = 0, lastDownX = 0, lastDownY = 0;
const cv = renderer.domElement;
cv.style.cursor = 'default';   // 参考视频里抓、拖、悬停都是普通箭头
cv.addEventListener('pointerdown', (e) => {
  const inside = pointInPoly(e.clientX, e.clientY, idleOutline(optionDown ? 36 : 10)) || phase !== 'idle';
  if (!inside) return;
  // 双击摊平：第二下按下时不再抓布，免得两次抓放让布抖两下
  const now = performance.now();
  const isSecondClick = now - lastDownT < 300 && Math.hypot(e.clientX - lastDownX, e.clientY - lastDownY) < 8 && !(e.altKey || optionDown);
  lastDownT = now; lastDownX = e.clientX; lastDownY = e.clientY;
  if (isSecondClick) return;
  cv.setPointerCapture(e.pointerId);
  post({ type: 'drag', active: true });
  if (e.altKey || optionDown) beginTransform(e.clientX, e.clientY);
  else if (!beginGrab(e.clientX, e.clientY)) { post({ type: 'drag', active: false }); return; }
  touchLive();
});
cv.addEventListener('pointermove', (e) => {
  pointerX = e.clientX; pointerY = e.clientY;
  if (performance.now() > liveUntil - LIVE_MS * 0.5) touchLive();   // 鼠标停在地毯上时材质保持流动
  if (mode === 'cloth') moveGrab(e.clientX, e.clientY);
  else if (mode === 'transform') moveTransform(e.clientX, e.clientY);
});
const up = () => {
  if (mode === 'cloth') endGrab();
  else if (mode === 'transform') endTransform();
  post({ type: 'drag', active: false });
};
// 双击摊平：两次点击都几乎没动（4 点内）才算，抓住折角拖几下不会被当成双击
let downX0 = 0, downY0 = 0, movedMax = 0;
const clickStatic = [true, true];
cv.addEventListener('pointerdown', (e) => { downX0 = e.clientX; downY0 = e.clientY; movedMax = 0; }, true);
cv.addEventListener('pointermove', (e) => { movedMax = Math.max(movedMax, Math.hypot(e.clientX - downX0, e.clientY - downY0)); });
cv.addEventListener('pointerup', () => { clickStatic.shift(); clickStatic.push(movedMax <= 4); });
cv.addEventListener('dblclick', () => { if (clickStatic[0] && clickStatic[1] && !optionDown) flatten(); });
cv.addEventListener('pointerup', up);
cv.addEventListener('pointercancel', up);

// 明确的动作才把布整块摊平：双击地毯，或菜单里选「把地毯放平」
function flatten() {
  if (phase === 'drag' || phase === 'restoring' || (phase === 'idle' && !deformed)) return;
  refitPlacement();
  phase = 'restoring'; phaseT = 0; relaxing = false;
  releasedAt = performance.now();
  wake();
}
window.rugFlatten = flatten;

// ---------- 主循环 ----------
// 逐帧录制对比视频时用模拟时钟：每次只走 1/60 秒，和真实时间无关
let offline = false, simNow = 0, lastFlipCount = 0;
let relaxing = false;   // 皱团舒展中：和放平同一套力，展开到一定程度就停
const RELAX_COVER = +(params.get('relax') ?? 0.45), RELAX_STOP = 0.85;
const now = () => (offline ? simNow : performance.now());
let lastT = performance.now();
let frameCount = 0, fpsT = lastT, fps = 0;
let running = false;
let liveUntil = 0;
let surfaceLive = true;   // 动态材质现在是否在自己逐帧渲染
const LIVE_MS = 4000;
function touchLive() { liveUntil = performance.now() + LIVE_MS; wake(); }
function wake() { needsRender = true; if (!running && !offline) { running = true; lastT = performance.now(); requestAnimationFrame(loop); } }

function loop(t) {
  const cpu0 = performance.now();
  const dtFrame = Math.min((t - lastT) / 1000, 1 / 30);
  lastT = t;
  phaseT += dtFrame;

  if (phase !== 'idle') {
    // 摊平时刚度在 0.25 秒内平滑升到 100，再平滑升到 300，没有突然跳变
    const ramp = (a, b) => { const x = Math.min(Math.max((phaseT - a) / (b - a), 0), 1); return x * x * (3 - 2 * x); };
    const restoreK = phase === 'restoring' ? ramp(0, 0.25) * (100 + 200 * ramp(1.2, 2.7)) : 0;
    // 小翘角慢慢放平；翻过去的布超过 5% 就是一次真正的对折，折痕不去动它（参考视频 f0293 以后大折叠一直不动）
    const curlK = phase === 'falling' && phaseT > 0.12 && lastFlipCount < N * 0.05 ? 12 : 0;
    // 松手 0.25 秒后加大阻尼：参考视频里松手后布零帧回弹、不再蠕动（f0293 到 f0420 面积变化小于 0.02%）
    // 0.6 秒后再加大一档，残留的慢慢蠕动很快停下
    const extraDamp = phase !== 'falling' || phaseT <= 0.25 ? 1 : phaseT <= 0.6 ? 0.93 : +(params.get('fdamp') ?? 0.8);
    updateFloor();
    if (phase === 'drag') holdGrab();
    const SUB = +(params.get('sub') ?? 3);
    for (let s = 0; s < SUB; s++) step(dtFrame / SUB, restoreK, curlK, extraDamp);
    // 用上一帧的法线判断哪些点翻过去了
    const nrm = geo.attributes.normal.array;
    let flipCount = 0;
    for (let k = 0; k < N; k++) { const f = nrm[k * 3 + 2] < -0.15 ? 1 : 0; flipCount += f; flipped[k] = f; }
    lastFlipCount = flipCount;
    if (phase === 'falling') {
      // 松手后只受重力。按速度（点每秒）判断停稳：95% 的点慢于 20S，最快的慢于 40S（再慢的蠕动肉眼看不出，直接停住），连续 250 毫秒，
      // 且松手至少 300 毫秒。S 是毯宽相对 680 点的比例。不再有无条件结束
      const S = place.width / 680, sub = dtFrame / SUB;
      let vmax = 0, fast = 0, cnt = 0;
      for (let k = 0; k < N; k++) {
        if (inv[k] === 0) continue;
        const o = k * 3;
        const v = Math.hypot(pos[o] - prev[o], pos[o + 1] - prev[o + 1], pos[o + 2] - prev[o + 2]) / sub;
        if (v > vmax) vmax = v;
        if (v > 20 * S) fast++;
        cnt++;
      }
      const calm = vmax < 40 * S && fast < cnt * 0.05;
      calmMs = calm ? calmMs + dtFrame * 1000 : 0;
      if (params.get('debug') && (frameCount % 10) === 0) console.log('落下', phaseT.toFixed(2), 'vmax', vmax.toFixed(1), '快点比例', (fast / cnt).toFixed(3), '翻面点数', flipCount);
      // 皱成一团的不等它停稳：松手 0.4 秒后盖住的面积还不到 45% 就开始舒展
      const heap = phaseT > 0.4 && coverFrac() < RELAX_COVER;
      if ((calmMs >= 250 && phaseT >= 0.3) || phaseT > 14 || heap) {
        let maxD = 0;
        for (let k = 0; k < N; k++) {
          const d = Math.hypot(rest[k * 2] - pos[k * 3], rest[k * 2 + 1] - pos[k * 3 + 1], pos[k * 3 + 2] - bumpAt(pos[k * 3], pos[k * 3 + 1]));
          if (d > maxD) maxD = d;
        }
        // 没有翻面、所有点离原位 3 点内才吸附回平铺，免得留下看不出来的歪斜；叠着的布不会被吸附
        const cover = coverFrac();
        if (maxD < 3 * S && flipCount === 0) snapToRest();
        else if (cover < RELAX_COVER) {
          // 皱成一团（盖住的面积不到摊平时的 45%，干净的对折在 0.55 以上）：大致舒展开，展到 85% 就停，留下大的折痕
          refitPlacement(); computeRest();
          phase = 'restoring'; phaseT = 0; relaxing = true;
          console.log('皱成一团，舒展开', cover.toFixed(2));
        } else { deformed = true; maskDirty = true; }
        if (!relaxing) {
          for (let k = 0; k < N * 3; k++) prev[k] = pos[k];
          phase = 'idle';
        }
        if (!relaxing) console.log('停稳用时', (performance.now() - releasedAt).toFixed(0) + 'ms', deformed ? '停在掀起的样子' : '平整');
      }
    }
    if (phase === 'restoring') {
      let maxD = 0;
      for (let k = 0; k < N; k++) {
        const d = Math.hypot(rest[k * 2] - pos[k * 3], rest[k * 2 + 1] - pos[k * 3 + 1], pos[k * 3 + 2] - bumpAt(pos[k * 3], pos[k * 3 + 1]));
        if (d > maxD) maxD = d;
      }
      if (relaxing && coverFrac() >= RELAX_STOP) { relaxing = false; phase = 'falling'; phaseT = 0; calmMs = 0; }
      else if (maxD < 1.2 || phaseT > 5) { relaxing = false; snapToRest(); phase = 'idle'; console.log('放平用时', (performance.now() - releasedAt).toFixed(0) + 'ms'); }
    }
    needsRender = true;
  }

  // 动态材质只在有人碰地毯（掀、拖、鼠标停在上面）后的几秒里动，之后停下来不再渲染，省电
  const wantLive = !!(surface && surface.animated && (t < liveUntil || recorder || demoRunning));
  if (surface && surface.setLive && wantLive !== surfaceLive) { surface.setLive(wantLive); surfaceLive = wantLive; if (!wantLive) { surfaceTex.needsUpdate = true; needsRender = true; } }
  const animated = surface && (wantLive || t - surfaceBorn < surface.warmupMs);
  // 动态材质在地毯静止时按 30 帧刷新，省一半耗电；拖动和录制时每帧都刷新
  if (animated && (phase !== 'idle' || mode !== null || recorder || (frameCount & 1) === 0)) { surfaceTex.needsUpdate = true; needsRender = true; }
  if (recorder) needsRender = true;   // 录制时每帧都画，否则录到被清空的画布

  const selAnimating = updateSel(now());
  if (selAnimating) needsRender = true;
  if (needsRender) {
    posAttr.needsUpdate = true;
    geo.computeVertexNormals();
    updateThickness();
    const [lx, ly] = [place.cx, place.cy];
    sun.position.set(lx - 720, ly + 1200, 640);   // 光从左上来，影子落在右下，往下比往右长（参考视频 f1090）
    sun.target.position.set(lx, ly, 0);
    const r = place.width * 0.85;
    Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 100, far: 3000 });
    sun.shadow.camera.updateProjectionMatrix();
    renderer.render(scene, camera);
    needsRender = false;
  }
  for (const it of snapQueue.splice(0)) {
    // 调试截图：默认截地毯周围一块、底色用木地板色；给了范围时按范围截，背景透明
    const [cx, cy] = toScreen(place.cx, place.cy, 0), dpr = renderer.getPixelRatio();
    let rw = Math.round(Math.min(W, place.width * 1.7)), rh = Math.round(Math.min(H, place.width * 1.2));
    let rx = Math.max(0, Math.min(W - rw, cx - rw / 2)), ry = Math.max(0, Math.min(H - rh, cy - rh / 2));
    if (it.rect) [rx, ry, rw, rh] = it.rect;
    const out = document.createElement('canvas'); out.width = rw; out.height = rh;
    const g = out.getContext('2d');
    if (!it.rect) { g.fillStyle = '#b98f68'; g.fillRect(0, 0, rw, rh); }
    g.drawImage(renderer.domElement, rx * dpr, ry * dpr, rw * dpr, rh * dpr, 0, 0, rw, rh);
    drawSelUI(g, rx, ry);
    post({ type: 'snap', name: it.name, data: out.toDataURL('image/png').split(',')[1] });
  }
  if (recorder) recorder.draw();
  publishHit();
  updateHandles();

  frameCount++;
  if (t - fpsT > 1000) { fps = frameCount; frameCount = 0; fpsT = t; window.__fps = fps; if (demoRunning || params.get('debug')) console.log('帧率', fps, phase, 'cpu', (window.__cpu || 0).toFixed(1) + 'ms'); }

  window.__cpu = (window.__cpu || 0) * 0.9 + (performance.now() - cpu0) * 0.1;
  // 静止且材质不动时停掉循环，省电
  if (offline) return;
  if (phase === 'idle' && !animated && mode === null && !demoRunning && !selAnimating) { running = false; return; }
  requestAnimationFrame(loop);
}

// ---------- 宿主调用的接口 ----------
window.rugSetOption = (b) => { optionDown = b; setSelected(b); if (!b && deformed) maskDirty = true;   // 按着 Option 时控制点在四角，范围临时改回外形，松开再用网格
  needsRender = true; publishHit(); updateHandles(); };
window.rugSetMaterial = (id) => { setMaterial(id); touchLive(); };
window.rugReset = () => { place = defaultPlacement(); savePlace(); snapToRest(); phase = 'idle'; wake(); };   // 放回屏幕中间，同时摊平
window.rugSetIcons = (list) => {
  icons = list.map(([x, y]) => { const p = toWorld(x, y); return { x: p.x, y: p.y }; });
  buildStacks();
  // 图标位置更新不能把用户叠好的布清掉：平铺时直接吸附到新的鼓包，叠着时让布按重力重新落稳
  if (phase === 'idle' && !deformed) snapToRest();
  else if (phase !== 'drag') { phase = 'falling'; phaseT = 0; calmMs = 0; }
  wake();
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

// 参考视频里的全部动作，按帧号记光标位置（换算到 f0700 画面的像素，逐帧读图，误差约 10 像素）。
// 每段是一次按下到松开；opt 表示这段时间按着 Option。图标是演示者在 Finder 里拖的，应用不动文件，这里没有。
const VIDEO_REF = { cx: 648, cy: 554, w: 769, deg: 4 };   // f0236 抓之前的地毯：中心、宽度、逆时针角度
const VIDEO_STEPS = [
  { name: '抓右上角对折到左下', keys: [[238, 970, 330], [242, 917, 384], [248, 853, 456], [254, 759, 524], [260, 683, 614], [266, 610, 674], [272, 570, 695], [278, 555, 692], [293, 555, 692]] },
  { name: '抓折角尖，把地毯拖过图标堆', keys: [[430, 556, 749], [438, 619, 717], [444, 758, 663], [450, 837, 555], [456, 943, 489], [462, 1007, 455], [468, 1033, 421], [474, 1064, 389], [480, 1095, 382], [488, 1118, 355], [497, 1159, 296], [503, 1165, 292], [515, 1165, 292], [518, 1164, 307]] },
  { name: '拉右下角', keys: [[527, 1099, 665], [530, 1096, 680], [539, 1096, 680], [545, 1105, 669], [551, 1119, 656], [557, 1135, 643], [566, 1135, 643], [572, 1150, 645], [578, 1190, 660], [584, 1210, 670], [588, 1212, 676], [592, 1213, 666]] },
  { name: '掀开右上角露出文件', keys: [[744, 1162, 262], [748, 1162, 270], [756, 1030, 438], [764, 892, 582], [772, 878, 600], [782, 916, 570]] },
  { name: '把掀开的角翻回去', keys: [[920, 880, 612], [930, 1020, 485], [936, 1090, 395], [942, 1170, 300], [948, 1168, 285], [957, 1168, 285]] },
  { name: '按住 Option，从角外拖着旋转', opt: true, keys: [[1180, 1297, 698], [1190, 1393, 709], [1205, 1397, 613], [1214, 1405, 585], [1220, 1376, 642], [1235, 1323, 736], [1250, 1317, 721]] },
  { name: '按住 Option，按在角点上放大', opt: true, keys: [[1300, 1275, 703], [1313, 1289, 695], [1325, 1341, 740], [1340, 1371, 740]] },
  { name: '抓中间拖来拖去', keys: [[1414, 855, 449], [1424, 742, 308], [1432, 740, 310], [1444, 992, 514], [1458, 992, 514], [1470, 1153, 548], [1478, 1153, 548]] },
];
const VIDEO_OPT = [1033, 1342];   // 按着 Option 的帧
const VIDEO_END = 1563;
// 某一帧光标在哪、是否按着：关键帧之间用 Catmull-Rom 曲线插值，速度连续
function videoCursor(f) {
  for (const st of VIDEO_STEPS) {
    const k = st.keys;
    if (f < k[0][0] || f > k[k.length - 1][0]) continue;
    let i = 0; while (i < k.length - 2 && f > k[i + 1][0]) i++;
    const p0 = k[Math.max(i - 1, 0)], p1 = k[i], p2 = k[i + 1], p3 = k[Math.min(i + 2, k.length - 1)];
    const t = (f - p1[0]) / Math.max(p2[0] - p1[0], 1), t2 = t * t, t3 = t2 * t;
    const cr = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
    return { down: true, step: st, x: cr(p0[1], p1[1], p2[1], p3[1]), y: cr(p0[2], p1[2], p2[2], p3[2]) };
  }
  return { down: false };
}
// 视频坐标换到屏幕：按开始时地毯的摆放，把视频里的地毯对到我们的地毯上
function videoMapper() {
  const [cx, cy] = toScreen(place.cx, place.cy, 0);
  const k = place.width / VIDEO_REF.w, d = place.angle - (VIDEO_REF.deg * Math.PI) / 180;
  const c = Math.cos(d), s = Math.sin(d);
  return (x, y) => { const dx = (x - VIDEO_REF.cx) * k, dy = (y - VIDEO_REF.cy) * k; return [cx + dx * c + dy * s, cy - dx * s + dy * c]; };
}
// 走到第 f 帧：按下、拖动、松开、Option 都按视频来
let vidPrev = { down: false }, vidOpt = false;
function videoDrive(f, map) {
  const opt = f >= VIDEO_OPT[0] && f < VIDEO_OPT[1];
  if (opt !== vidOpt) { vidOpt = opt; window.rugSetOption(opt); }
  const cur = videoCursor(f);
  if (cur.down) {
    const [x, y] = map(cur.x, cur.y);
    pointerX = x; pointerY = y;
    if (!vidPrev.down || vidPrev.step !== cur.step) {
      if (cur.step.opt) beginTransform(x, y);
      else if (!beginGrab(x, y)) console.log('没抓到布', cur.step.name, Math.round(x), Math.round(y));
      console.log('第', f, '帧', cur.step.name);
    } else if (mode === 'transform') moveTransform(x, y);
    else if (mode === 'cloth') moveGrab(x, y);
  } else if (vidPrev.down) {
    if (mode === 'cloth') endGrab(); else if (mode === 'transform') endTransform();
  }
  if (cur.down) touchLive();
  vidPrev = cur;
  return cur;
}

// 演示：照参考视频的动作走一遍（f0236 到 f1563，约 22 秒），用虚拟光标，不动真鼠标，不动文件
window.rugDemo = async () => {
  if (demoRunning) return;
  demoRunning = true; wake();
  try {
    await sleep(700);
    if (params.get('record')) startRecording();
    console.log('演示开始');
    const map = videoMapper();
    vidPrev = { down: false }; vidOpt = false;
    const t0 = performance.now();
    for (;;) {
      const f = 236 + Math.floor(((performance.now() - t0) / 1000) * 60);
      if (f > VIDEO_END) break;
      videoDrive(f, map);
      await sleep(0);
    }
    if (mode === 'cloth') endGrab(); else if (mode === 'transform') endTransform();
    if (vidOpt) { vidOpt = false; window.rugSetOption(false); }
    await waitIdle();
  } finally {
    if (params.get('record')) await stopRecording();
    demoRunning = false;
    post({ type: 'demoDone' });
    console.log('演示结束', JSON.stringify(window.rugState()));
  }
};


// ---------- 测试：掀起一角叠过去，检查点击穿透网格 ----------
// 原先地毯盖着的角落，布掀走之后必须穿透（文件才能拖进去）；叠在上面的那块和没动的底布必须接收鼠标。
window.rugTestSweep = async () => {
  demoRunning = true; wake();
  await sleep(500);
  let cs = cornersScreen();
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  const exposed = lerp(cs[2], cs[0], 0.06);       // 右下角往里一点：布被掀走后这里露出桌面
  const base = lerp(cs[0], cs[2], 0.12);          // 左上角往里一点：没动的底布
  beginGrab(cs[2][0] - 3, cs[2][1] - 3);
  await glide(cs[2], lerp(cs[2], cs[0], 0.62), 1300, moveGrab);
  await sleep(400);
  const lifting = lerp(cs[2], cs[0], 0.62);
  endGrab();
  await waitIdle(6000);
  await sleep(300);
  const tip = toScreen(pos[idx(NX, NY) * 3], pos[idx(NX, NY) * 3 + 1], pos[idx(NX, NY) * 3 + 2]);   // 被抓的角现在躺在哪里
  const m = window.__mask;
  const at = (p) => (m && m.bytes[Math.floor(p[1] / m.cell) * m.w + Math.floor(p[0] / m.cell)]) ? 1 : 0;
  const probes = [['露出的桌面（原右下角内侧）', exposed, 0], ['没动的底布（左上角内侧）', base, 1], ['叠在上面的布角', tip, 1]];
  for (const [name, p, expect] of probes) console.log('网格自检', name, '屏幕', Math.round(p[0]) + ',' + Math.round(p[1]), '接收鼠标=' + at(p), at(p) === expect ? '通过' : '不通过');
  post({ type: 'probe', pts: probes.map(([n, p, e]) => [n, p[0], p[1], e]) });
  // 网格的字符图：# 接收鼠标，. 穿透（每 3 格取一格）
  if (m) {
    const [x0, y0] = [Math.floor(Math.min(cs[0][0], cs[2][0]) / m.cell) - 2, Math.floor(Math.min(cs[0][1], cs[2][1]) / m.cell) - 2];
    const [x1, y1] = [Math.ceil(Math.max(cs[0][0], cs[2][0]) / m.cell) + 2, Math.ceil(Math.max(cs[0][1], cs[2][1]) / m.cell) + 2];
    const rows = [];
    for (let y = y0; y <= y1; y += 2) { let r = ''; for (let x = x0; x <= x1; x++) r += m.bytes[y * m.w + x] ? '#' : '.'; rows.push(r); }
    console.log('网格图\n' + rows.join('\n'));
  }
  await sleep(500);
  flatten(); await sleep(300); await waitIdle();
  demoRunning = false;
  post({ type: 'sweepDone' });
};
if (params.get('sweep')) setTimeout(() => window.rugTestSweep(), 800);

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
      drawSelUI(g, rx, ry);
      if (optionDown) {
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

// ---------- 调试用接口：脚本驱动抓取并量布的状态（--eval-file 用） ----------
window.__t = {
  beginGrab: (x, y) => { const r = beginGrab(x, y); touchLive(); return r; }, moveGrab, endGrab: () => { endGrab(); wake(); }, cornersScreen, sleep, glide, lerp2, waitIdle,
  flatten: () => flatten(),
  option: (b) => window.rugSetOption(b),
  beginTransform: (x, y) => { pointerX = x; pointerY = y; beginTransform(x, y); }, moveTransform: (x, y) => { pointerX = x; pointerY = y; moveTransform(x, y); }, endTransform,
  selNow: () => ({ ...selNow }),
  selUI: () => selUI(), cornerZone, hover: (x, y) => { pointerX = x; pointerY = y; updateHandles(); },
  tex: (name) => post({ type: 'snap', name, data: surface.canvas.toDataURL('image/png').split(',')[1] }),
  snap: (name, rect) => { snapQueue.push({ name, rect }); needsRender = true; wake(); },
  // 逐帧模式：停掉自动循环，之后每调一次 frame() 走 1/60 秒并画一帧
  offline: () => { offline = true; simNow = performance.now(); lastT = simNow; },
  frame: () => { simNow += 1000 / 60; loop(simNow); },
  videoDrive: (f, map) => videoDrive(f, map || (window.__vmap ||= videoMapper())), videoCursor,
  rugSet: (x, y, w, deg) => { const p = toWorld(x, y); place = { cx: p.x, cy: p.y, angle: (deg * Math.PI) / 180, width: w }; snapToRest(); phase = 'idle'; needsRender = true; },
  quit: () => post({ type: 'quit' }),
  state: () => ({ phase, deformed, place: { ...place } }),
  info: () => ({ grabK, target: grabTarget && grabTarget.toArray(), p: Array.from(pos.slice(grabK * 3, grabK * 3 + 3)), inv: inv[grabK] }),
  metrics() {
    // 最大伸长比（相邻点距离相对静止长度）、被折得很陡的点所占比例、翻面点数
    let maxStretch = 0, sum = 0, nrm = geo.attributes.normal.array, steep = 0, flips = 0;
    for (let c = 0; c < NC; c++) {
      if (CS[c] < 0.5) continue;
      const a = CA[c] * 3, b = CB[c] * 3;
      const d = Math.hypot(pos[a] - pos[b], pos[a + 1] - pos[b + 1], pos[a + 2] - pos[b + 2]) / (CL[c] * place.width);
      if (d > maxStretch) maxStretch = d;
      sum += d;
    }
    for (let k = 0; k < N; k++) { if (Math.abs(nrm[k * 3 + 2]) < 0.7) steep++; if (nrm[k * 3 + 2] < -0.15) flips++; }
    return { maxStretch: +maxStretch.toFixed(3), steepFrac: +(steep / N).toFixed(3), flips, cover: +coverFrac().toFixed(3) };
  },
};
