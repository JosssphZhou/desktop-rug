// 回归测试：按住 Option 时，角外一圈拖是旋转（宽度不变），按在角点上拖是缩放（角度不变、对角不动），参考视频 f1150 到 f1350。
// 老版本里拖角同时旋转和缩放，这里两项都会不通过。
// 用法：scripts/test-option.sh（由宿主 --eval-file 注入，结果写到标准输出）
(async () => {
  const t = window.__t, out = (...a) => console.log('[回归]', ...a);
  const ok = [];
  const deg = (a) => (a * 180) / Math.PI;
  const sel = () => (t.selUI ? t.selUI() : {});   // 老版本没有这些调试入口，让检查照常跑完并记为不通过
  try {
    t.option(true);
    await t.sleep(500);
    // 1. 右下角外侧 22 点处按下，绕中心往上拖：只转不缩
    let cs = t.cornersScreen(), c = cs[2];
    const st0 = t.state().place;
    const [cx, cy] = [(cs[0][0] + cs[2][0]) / 2, (cs[0][1] + cs[2][1]) / 2];
    const ux = (c[0] - cx) / Math.hypot(c[0] - cx, c[1] - cy), uy = (c[1] - cy) / Math.hypot(c[0] - cx, c[1] - cy);
    const p = [c[0] + ux * 22, c[1] + uy * 22];
    t.beginTransform(p[0], p[1]);
    await t.glide(p, [p[0] + 60, p[1] - 140], 700, t.moveTransform);
    const ui = sel();
    t.endTransform();
    const st1 = t.state().place;
    ok.push(['角外拖动时角度变了', Math.abs(deg(st1.angle - st0.angle)) > 5, deg(st1.angle - st0.angle).toFixed(1)]);
    ok.push(['角外拖动时宽度没变', Math.abs(st1.width - st0.width) < 0.5, (st1.width - st0.width).toFixed(1)]);
    ok.push(['旋转时光标旁有角度气泡', !!ui.bubble, ui.bubble && ui.bubble[2]]);
    // 2. 按在右下角角点上往外拖：只缩不转
    cs = t.cornersScreen(); c = cs[2];
    if (t.hover) t.hover(c[0] + 2, c[1] + 1);
    ok.push(['光标停在角点上时角点变蓝', sel().hot === 2, sel().hot]);
    t.beginTransform(c[0] + 2, c[1] + 1);
    await t.glide([c[0] + 2, c[1] + 1], [c[0] + 90, c[1] + 50], 700, t.moveTransform);
    t.endTransform();
    const st2 = t.state().place, opp = t.cornersScreen()[0];
    ok.push(['缩放时对角（左上角）不动', Math.hypot(opp[0] - cs[0][0], opp[1] - cs[0][1]) < 3, Math.hypot(opp[0] - cs[0][0], opp[1] - cs[0][1]).toFixed(1)]);
    ok.push(['角上拖动时宽度变大', st2.width - st1.width > 40, (st2.width - st1.width).toFixed(1)]);
    ok.push(['角上拖动时角度没变', Math.abs(deg(st2.angle - st1.angle)) < 0.05, deg(st2.angle - st1.angle).toFixed(2)]);
    // 3. 失败路径：在布外很远处按下不会开始变形
    ok.push(['离角 80 点的空白处不算角', !!t.cornerZone && t.cornerZone(c[0] + 80, c[1] + 80) === null, t.cornerZone && t.cornerZone(c[0] + 80, c[1] + 80)]);
    t.option(false);
  } catch (e) { ok.push(['脚本出错', false, String(e && e.message) + ' ' + String(e && e.stack)]); }
  for (const [name, pass, v] of ok) out(name, pass ? '通过' : '不通过', v);
  out(ok.every((x) => x[1]) ? '全部通过' : '有不通过的项');
  t.quit();
})();
