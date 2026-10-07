// 回归测试：抓住地毯右边中点往外拉 420 点。地毯要整块跟着走，布不能被拉长，松手后是平的。
// 老版本（97f541d）在这一步把布拉长到 7.8 倍，松手后留下一块皱成破布的地毯。
// 用法：scripts/test-drag.sh（由宿主 --eval-file 注入，结果写到标准输出）
(async () => {
  const t = window.__t, out = (...a) => console.log('[回归]', ...a);
  const ok = [];
  try {
    const cs = t.cornersScreen();
    const p = [(cs[1][0] + cs[2][0]) / 2 - 4, (cs[1][1] + cs[2][1]) / 2];
    const cx0 = t.state().place.cx;
    t.beginGrab(p[0], p[1]);
    let maxStretch = 0;
    await t.glide(p, [p[0] + 420, p[1] + 30], 900, (x, y) => { t.moveGrab(x, y); maxStretch = Math.max(maxStretch, t.metrics().maxStretch); });
    await t.sleep(300);
    maxStretch = Math.max(maxStretch, t.metrics().maxStretch);
    t.endGrab();
    await t.waitIdle(6000);
    const m = t.metrics(), moved = t.state().place.cx - cx0;
    ok.push(['拖动中任何一格的伸长不超过 8%', maxStretch <= 1.08, maxStretch]);
    ok.push(['地毯整块跟着移动了 300 点以上', moved > 300, Math.round(moved)]);
    ok.push(['松手后没有翻面的布', m.flips === 0, m.flips]);
    ok.push(['松手后布是平的', m.steepFrac < 0.01, m.steepFrac]);
  } catch (e) { ok.push(['脚本出错', false, String(e)]); }
  for (const [name, pass, v] of ok) out(name, pass ? '通过' : '不通过', v);
  out(ok.every((x) => x[1]) ? '全部通过' : '有不通过的项');
  t.quit();
})();
