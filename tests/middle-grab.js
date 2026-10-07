// 回归测试：照参考视频 f1414 到 f1478 的动作抓地毯中间拖来拖去再松手（逐帧模式，和真实时间无关）。
// 参考视频松手后 0.3 秒内基本摊开，只在右边留一道折（f1478 盖住的面积约为摊平的 89%），之后不动。
// 老版本在这里把布揉成一团（盖住的面积约 34%），松手 5 秒后还是一团。
// 用法：scripts/test-middle.sh
(async () => {
  const t = window.__t, out = (...a) => console.log('[回归]', ...a);
  const ok = [];
  try {
    await t.sleep(300);
    t.offline();
    t.rugSet(917 + 449, 496 + 180, 868, 3);   // f1405 时视频里的地毯
    t.frame();
    const map = (x, y) => [x + 449, y + 180];
    let maxStretch = 0;
    for (let f = 1405; f <= 1479; f++) { t.videoDrive(f, map); t.frame(); maxStretch = Math.max(maxStretch, t.metrics().maxStretch); }
    let idleAt = -1;
    for (let i = 1; i <= 300; i++) { t.frame(); if (idleAt < 0 && t.state().phase === 'idle') idleAt = i; }
    const m = t.metrics();
    ok.push(['拖动中任何一格的伸长不超过 10%', maxStretch <= 1.10, maxStretch]);
    ok.push(['松手 3 秒内停稳', idleAt > 0 && idleAt <= 180, idleAt]);
    ok.push(['停稳后盖住的面积不少于摊平时的 80%', m.cover >= 0.8, m.cover]);
  } catch (e) { ok.push(['脚本出错', false, String(e && e.message)]); }
  for (const [name, pass, v] of ok) out(name, pass ? '通过' : '不通过', v);
  out(ok.every((x) => x[1]) ? '全部通过' : '有不通过的项');
  t.quit();
})();
