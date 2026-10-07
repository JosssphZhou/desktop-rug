// 回归测试：照参考视频 f1414 到 f1478 的动作抓地毯中间拖来拖去再松手（逐帧模式，和真实时间无关）。
// 参考视频松手后 0.3 秒内基本摊开，只在右边留一道折（f1478 盖住的面积约为摊平的 89%），之后不动。
// 老版本在这里把布揉成一团（盖住的面积约 34%），松手 5 秒后还是一团。
// 参考 f1478 松手后约 19 帧只有微小蠕动，之后不动。上一版布料模拟（64d544a）松手后 113 帧才停，「20 帧内停稳」在它上面不通过。
// 参考 f1424 到 f1458 右半块被拖起叠到左半块上，整块沿长边变短到约 85%，左边缘不动；拉开以后右边留一道折。
// 4c7a2e2 在 f1436 整块跟着光标挪、长度只缩到 95%，后两项不通过。
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
    let maxStretch = 0, at1436 = null;
    const p0 = t.state().place;
    for (let f = 1405; f <= 1479; f++) {
      t.videoDrive(f, map); t.frame(); maxStretch = Math.max(maxStretch, t.metrics().maxStretch);
      if (f === 1436) at1436 = t.extent(p0);
    }
    let idleAt = -1;
    for (let i = 1; i <= 300; i++) { t.frame(); if (idleAt < 0 && t.state().phase === 'idle') idleAt = i; }
    const m = t.metrics();
    ok.push(['拖动中任何一格的伸长不超过 10%', maxStretch <= 1.10, maxStretch]);
    ok.push(['松手 20 帧内停稳', idleAt > 0 && idleAt <= 20, idleAt]);
    ok.push(['停稳后盖住的面积不少于摊平时的 80%', m.cover >= 0.8, m.cover]);
    const W0 = p0.width, len = (at1436.a1 - at1436.a0) / W0, left = (at1436.a0 + W0 / 2) / W0;
    ok.push(['f1436 叠成两层：沿长边缩到九成以下，左边缘挪动不到毯宽 3%', len < 0.9 && Math.abs(left) < 0.03, `长度 ${len.toFixed(3)}，左边缘 ${left.toFixed(3)}`]);
    const e = t.extent(p0), right = (W0 / 2 - e.a1) / W0;
    ok.push(['拉开停稳后右边仍留着一道折（有翻面的点，右边缘比摊平时短毯宽 0.5% 以上）', right > 0.005 && m.flips > 0 && t.state().deformed, `右边缘缩进 ${right.toFixed(3)}，翻面 ${m.flips} 点`]);
  } catch (e) { ok.push(['脚本出错', false, String(e && e.message)]); }
  for (const [name, pass, v] of ok) out(name, pass ? '通过' : '不通过', v);
  out(ok.every((x) => x[1]) ? '全部通过' : '有不通过的项');
  t.quit();
})();
