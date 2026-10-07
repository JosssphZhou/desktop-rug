// 真实抓取路径：对折后不输入任何摊平动作，折叠必须保留，不能为提高分数自动展开。
(async () => {
 const t=window.__t, out=(...a)=>console.log('[回归]',...a);
 try {
  await t.sleep(300);t.offline();await t.sleep(80);t.offline();
  t.rugSet(648+449,554+180,769,4);t.frame();t.frame();
  for(let f=236;f<=600;f++) {
   if(f<=294)t.videoDrive(f,(x,y)=>[x+449,y+180]);
   t.frame();await t.sleep(0);
  }
  const m=t.metrics(),ui=t.selUI();
  const ok=m.flips>200 && m.cover<.85;
  out('无新手势时大折叠仍保留',ok?'通过':'不通过',JSON.stringify(m));
  t.option(true);
  for(let f=0;f<150;f++){t.frame();await t.sleep(0);}
  const controls=t.selUI(), visible=!!controls.handles && !!controls.pill;
  out('选中动效结束后四角和操作条可用',visible?'通过':'不通过');
  out(ok&&visible?'全部通过':'有不通过的项');
 }catch(e){out('脚本出错 不通过',e.stack);}
 t.quit();
})();
