// 来自上一轮逐帧重放。固定初态、光标轨迹、四个对齐点；不按候选结果重新配准。
(async () => {
  const t = window.__t;
  try {
    if (innerWidth !== 2560 || innerHeight !== 1440) {
      throw new Error(`评分要求 2560×1440 点的测试视口，实际 ${innerWidth}×${innerHeight}`);
    }
    await t.sleep(400);
    t.offline();
    // 让此前排入队列的最后一次 requestAnimationFrame 结束，再重置模拟时钟。
    await t.sleep(80);
    t.offline();
    t.rugSet(648 + 449, 554 + 180, 769, 4);
    t.frame(); t.frame();
    const sync = {524: [840.6, 478.4, 765, 2.94], 740: [840.7, 478.3, 765, 2.95],
      1028: [868.5, 466.2, 765, 4.24], 1405: [917, 496.1, 868, 3.0]};
    const log = [];
    for (let f = 236; f <= 1563; f++) {
      if (sync[f]) { const [x, y, w, d] = sync[f]; t.rugSet(x + 449, y + 180, w, d); }
      const c = t.videoDrive(f, (x, y) => [x + 449, y + 180]);
      t.snap('f' + String(f).padStart(4, '0'), [449, 180, 1662, 1080]);
      t.frame();
      log.push({frame: f, down: c.down, x: c.x, y: c.y, state: t.state(), metrics: t.metrics()});
      // 宿主写出这一帧。物理时间始终只前进 1/60 秒。
      await t.sleep(0);
    }
    console.log('[评分重放] LOG', JSON.stringify(log));
    console.log('[评分重放] COMPLETE 1328');
  } catch (e) {
    console.error('[评分重放] ERROR', e.message, e.stack);
  } finally {
    t.quit();
  }
})();
