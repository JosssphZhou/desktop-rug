// 回归测试：地毯能放到盖住整块主屏的大小。老板反馈「只能盖住那块区域，图标多了还是盖不住」：
// 地毯窗口本身铺满主屏，原因是毯宽在宽屏上最多 720 点（2560 点宽的屏只占 28%），放大上限也只到屏宽的 90%，
// 老板保存的毯宽一直是老默认值 680 点。老版本这里每一项都不通过。
// 用法：scripts/test-fullscreen.sh（由宿主 --eval-file 注入，不读也不写老板平时用的本地存储）
(async () => {
  const t = window.__t, out = (...a) => console.log('[回归]', ...a);
  const ok = [];
  const ASPECT = 44 / 70;
  try {
    await t.sleep(300);
    const [W, H] = t.screen ? t.screen() : [innerWidth, innerHeight];
    const load = t.loadPlace || (() => ({ width: NaN }));
    // 1. 新装或「放回屏幕中间」时的默认大小按参考视频：毯宽占屏宽 46%
    const def = load(null);
    ok.push(['默认毯宽占屏宽 46%', Math.abs(def.width - W * 0.46) < 1, Math.round(def.width) + ' / ' + W]);
    // 2. 老板现在存着的摆放（宽 680 点，转了 132 度，在屏幕右下）：放大到默认宽度，角度不变，整块留在屏幕里
    const boss = { cx: 506.5, cy: -169.7, angle: 2.3083, width: 680 };
    const m = load(boss);
    const c = Math.abs(Math.cos(m.angle)), s = Math.abs(Math.sin(m.angle)), h = m.width * ASPECT;
    const ex = (c * m.width + s * h) / 2, ey = (s * m.width + c * h) / 2;
    ok.push(['老默认宽度 680 点放大到默认宽度', Math.abs(m.width - W * 0.46) < 1, Math.round(m.width)]);
    ok.push(['放大后角度不变', Math.abs(m.angle - boss.angle) < 1e-6, m.angle]);
    ok.push(['放大后整块在屏幕里', Math.abs(m.cx) + ex <= W / 2 + 0.5 && Math.abs(m.cy) + ey <= H / 2 + 0.5, [Math.round(m.cx), Math.round(m.cy)].join(',')]);
    // 3. 失败路径：用户自己放大或缩小过的宽度不动
    for (const w of [500, 900, 1600]) {
      const u = load({ cx: 10, cy: 20, angle: 0.3, width: w });
      ok.push([`自己调过的宽度 ${w} 点保持不变`, u.width === w && u.cx === 10 && u.cy === 20, Math.round(u.width)]);
    }
    // 4. 按住 Option 拖右下角角点往外放大：能放到盖住整块屏幕
    t.rugSet(W / 2, H / 2, W * 0.46, 0);
    t.option(true);
    await t.sleep(200);
    const cs = t.cornersScreen(), k = cs[2];
    t.beginTransform(k[0], k[1]);
    t.moveTransform(k[0] + W * 3, k[1] + H * 3);
    t.endTransform();
    t.option(false);
    const p = t.state().place;
    ok.push(['放大上限能盖住整块屏幕', p.width >= W - 0.5 && p.width * ASPECT >= H - 0.5, `${Math.round(p.width)} × ${Math.round(p.width * ASPECT)}，屏幕 ${W} × ${H}`]);
  } catch (e) { ok.push(['脚本出错', false, String(e && e.message)]); }
  for (const [name, pass, v] of ok) out(name, pass ? '通过' : '不通过', v);
  out(ok.every((x) => x[1]) ? '全部通过' : '有不通过的项');
  t.quit();
})();
