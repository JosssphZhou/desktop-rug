// 回归测试：抓短边中点往地毯里横拉，不能折出一整条平躺的翻面矩形。
// 老板反馈「现在有两张地毯同时存在」：他存着的摆放转了约 173°，抓短边中点往右拉约 500 点，
// 对折重写（89a13b9）把这种拉法也写成平躺的对折，翻过去的矩形片和剩下的半块倾斜方向相反、背面贴图和正面相同，看起来像两张地毯。
// 在 89a13b9 上第一项不通过（翻面约 1300 点，很陡的点只有约 0.8%）。抓角往里拉仍要折成平躺的对折。
// 走画布上真实的 pointerdown、pointermove、pointerup 处理。用法：scripts/test-edge.sh
(async () => {
  const t = window.__t, out = (...a) => console.log('[回归]', ...a);
  const ok = [];
  const cv = document.querySelector('canvas');
  const ev = (type, x, y) => cv.dispatchEvent(new PointerEvent(type, { clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, bubbles: true, buttons: type === 'pointerup' ? 0 : 1 }));
  const drag = async (a, b, ms) => { ev('pointerdown', a[0], a[1]); await t.glide(a, b, ms, (x, y) => ev('pointermove', x, y)); await t.sleep(120); ev('pointerup', b[0], b[1]); await t.waitIdle(6000); };
  const center = () => { const c = t.cornersScreen(); return t.lerp2(c[0], c[2], 0.5); };
  const N = 71 * 45;
  try {
    await t.sleep(300);
    const [W, H] = t.screen();
    // 1. 抓屏幕上靠左的短边中点，往右拉 500 点
    t.rugSet(W / 2, H / 2, 632, 173.2);
    await t.sleep(200);
    const L = [...t.cornersScreen()].sort((p, q) => p[0] - q[0]);
    const a = t.lerp2(t.lerp2(L[0], L[1], 0.5), center(), 0.02);
    await drag(a, [a[0] + 500, a[1]], 900);
    const m = t.metrics();
    ok.push(['抓边横拉不折出平躺的翻面矩形', m.flips < N * 0.05 || m.steepFrac >= 0.03, `翻面 ${m.flips} 点，很陡的点 ${m.steepFrac}`]);
    // 2. 对照：抓角往中间拉，仍然折成平躺的对折
    t.rugSet(W / 2, H / 2, 632, 173.2);
    await t.sleep(200);
    const c = [...t.cornersScreen()].sort((p, q) => p[0] + p[1] - q[0] - q[1])[0];
    const b = t.lerp2(c, center(), 0.02);
    await drag(b, t.lerp2(b, center(), 0.8), 700);
    const n = t.metrics();
    ok.push(['抓角往里拉仍折成平躺的对折', n.flips > N * 0.05 && n.steepFrac < 0.03, `翻面 ${n.flips} 点，很陡的点 ${n.steepFrac}`]);
  } catch (e) { ok.push(['脚本出错', false, String(e && e.message)]); }
  for (const [name, pass, v] of ok) out(name, pass ? '通过' : '不通过', v);
  out(ok.every((x) => x[1]) ? '全部通过' : '有不通过的项');
  t.quit();
})();
