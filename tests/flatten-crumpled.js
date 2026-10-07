// 回归测试：照参考视频的动作把地毯掀皱（f0236 到 f1032），再按 Option 选中（选中会先放平）。
// 放平时地毯不能突然转个大角度或跳走。老版本在这里转了约 83 度、中心挪了约 330 点。
// 用法：scripts/test-flatten.sh（逐帧模式，和真实时间无关，结果写到标准输出）
(async () => {
  const t = window.__t, out = (...a) => console.log('[回归]', ...a);
  const ok = [];
  try {
    await t.sleep(300);
    t.offline();
    t.rugSet(648 + 449, 554 + 180, 769, 4);
    t.frame();
    const map = (x, y) => [x + 449, y + 180];
    for (let f = 236; f < 1033; f++) { t.videoDrive(f, map); t.frame(); }
    const a = t.state();
    ok.push(['选中前布是皱的', a.deformed, a.phase]);
    t.videoDrive(1033, map); t.frame();
    for (let i = 0; i < 90; i++) t.frame();
    const b = t.state();
    const dA = Math.abs(((b.place.angle - a.place.angle) * 180) / Math.PI), dC = Math.hypot(b.place.cx - a.place.cx, b.place.cy - a.place.cy);
    ok.push(['放平时角度变化不超过 20 度', dA < 20, dA.toFixed(1)]);
    ok.push(['放平时中心挪动不超过毯宽的 15%', dC < a.place.width * 0.15, Math.round(dC)]);
  } catch (e) { ok.push(['脚本出错', false, String(e && e.message)]); }
  for (const [name, pass, v] of ok) out(name, pass ? '通过' : '不通过', v);
  out(ok.every((x) => x[1]) ? '全部通过' : '有不通过的项');
  t.quit();
})();
