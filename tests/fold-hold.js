// 真实抓取路径：对折后不输入任何摊平动作，折叠必须保留，不能为提高分数自动展开。
// 参考视频 f0293 松手后零帧回弹，翻过去的那片平躺在下面那片上。旧的布料模拟（64d544a）松手后 37 帧才停，
// 停下时仍有约 11.5% 的点折得很陡，后两项在旧代码上不通过。
(async () => {
 const t=window.__t, out=(...a)=>console.log('[回归]',...a);
 try {
  await t.sleep(300);t.offline();await t.sleep(80);t.offline();
  t.rugSet(648+449,554+180,769,4);t.frame();t.frame();
  let idleAt=-1, steepAt304=1;
  for(let f=236;f<=600;f++) {
   if(f<=294)t.videoDrive(f,(x,y)=>[x+449,y+180]);
   t.frame();await t.sleep(0);
   if(f>=294&&idleAt<0&&t.state().phase==='idle')idleAt=f-294;
   if(f===304)steepAt304=t.metrics().steepFrac;
  }
  out('松手后 10 帧内停住',idleAt>=0&&idleAt<=10?'通过':'不通过',idleAt);
  out('停住后翻过去的片平躺（折得很陡的点少于 3%）',steepAt304<0.03?'通过':'不通过',steepAt304);
  const m=t.metrics(),ui=t.selUI();
  const ok=m.flips>200 && m.cover<.85;
  out('无新手势时大折叠仍保留',ok?'通过':'不通过',JSON.stringify(m));
  t.option(true);
  for(let f=0;f<150;f++){t.frame();await t.sleep(0);}
  const controls=t.selUI(), visible=!!controls.handles && !!controls.pill;
  out('选中动效结束后四角和操作条可用',visible?'通过':'不通过');
  out(ok&&visible&&idleAt>=0&&idleAt<=10&&steepAt304<0.03?'全部通过':'有不通过的项');
 }catch(e){out('脚本出错 不通过',e.stack);}
 t.quit();
})();
