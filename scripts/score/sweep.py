#!/usr/bin/env python3
"""串行粗扫、细调及保留。每个候选走完整逐帧入口，保留前再用原分辨率确认并运行五项回归。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[2]
CACHE = ROOT / '.score-cache/round2'
TUNING = ROOT / 'web/tuning.js'
HEADER = ('// 本地逐帧爬坡选定的参数。URL 查询参数优先，便于不改默认值做对照。\n'
          '// 由 scripts/score/sweep.py 维护完整对象；每次保留前必须通过真实重放和回归。\n')
# 先处理动画与布料逻辑，再把原有物理参数全部扫一遍；每个参数含4到5个粗值。
PLAN = {
 'optmatch': (0, [0,.25,.5,.75,1]),
 'crease': (1, [.03,.15,.35,.65,1]),
 'foldfric': (1, [1,2,4,8,16]),
 'tent': (0, [0,.25,.5,.75,1]),
 'bend2': (.5, [.1,.3,.5,.75,1]),
 'bend4': (.15, [.02,.08,.15,.3,.5]),
 'strain': (1.04, [1.015,1.03,1.04,1.055,1.07]),
 'iter': (8, [4,6,8,12,16]),
 'damp': (.965, [.9,.94,.965,.98,.995]),
 'fdamp': (.8, [.3,.5,.8,.95,1]),
 'fric': (.09, [.015,.045,.09,.18,.36]),
 'relax': (.45, [.25,.35,.45,.55,.65]),
 'grabweight': (1, [.2,.5,1,1.5,2]),
 'thickness': (1, [.5,.8,1,1.5,2]),
 'gravity': (4200, [2000,3200,4200,6500,9000]),
}
NAMES = {'optmatch':'Option曲线匹配','crease':'折痕弯曲比例','foldfric':'翻面贴地摩擦倍率','tent':'中间帐篷与定向滑动',
 'bend2':'短程弯曲刚度','bend4':'长程弯曲刚度','strain':'伸长上限','iter':'约束迭代','damp':'整体阻尼',
 'fdamp':'松手后阻尼','fric':'拖动摩擦','relax':'舒展阈值','grabweight':'抓点附近逆质量','thickness':'厚度倍率','gravity':'重力'}
CAPS = {'第一次对折':.03, '拖过图标堆':.03, '翻回去':.10, '抓中间':.03}
JOURNAL = Path.home() / '.claude/state/handoffs/桌面地毯小样/爬坡记录.md'


def disk_guard():
 s=os.statvfs('/'); free=s.f_bavail*s.f_frsize/1e9
 if free<11: raise RuntimeError(f'内置盘剩余{free:.2f}GB，低于11GB停止线')


def read_tuning():
 return json.loads(TUNING.read_text().split('export default ',1)[1].rsplit(';',1)[0])


def write_tuning(values):
 # 此文件只含本脚本拥有的完整参数对象，不修改任何其他源码或用户文件。
 if not TUNING.read_text().startswith(HEADER): raise RuntimeError('参数文件归属变化，拒绝覆盖')
 temp=TUNING.with_suffix('.js.tmp');temp.write_text(HEADER+'export default '+json.dumps(values,ensure_ascii=False,indent=2)+';\n');temp.replace(TUNING)


def eligible(score, baseline):
 return score['total'] > baseline['total'] and all(score['segments'][k]['iou'] >= baseline['segments'][k]['iou']-limit for k,limit in CAPS.items())


def visual_strip(path, label):
 p=path/'keyframes.jpg'
 if not p.exists(): return None
 im=cv2.imread(str(p)); panels=[]
 # f0298、f0942、f1424、f1478、f1054。每块都是参考与候选并排。
 for index in [3,10,15,17,13]:
  y,x=(index//2)*290,(index%2)*831
  panels.append(cv2.resize(im[y:y+290,x:x+831],(415,145)))
 strip=np.hstack(panels); title=np.full((28,strip.shape[1],3),24,np.uint8)
 cv2.putText(title,label,(10,20),cv2.FONT_HERSHEY_SIMPLEX,.5,(255,255,255),1)
 p.unlink() # 候选原图看板只在内存里合并，本轮只留下一个待自查的对比图。
 return np.vstack([title,strip])


def main():
 parser=argparse.ArgumentParser(description=__doc__)
 parser.add_argument('--cycle',required=True,type=int)
 parser.add_argument('--params',default=','.join(PLAN))
 parser.add_argument('--recheck',action='store_true',help='补充同一整轮中已扫参数的细值，不增加整轮计数')
 args=parser.parse_args()
 os.chdir(ROOT);CACHE.mkdir(parents=True,exist_ok=True)
 if subprocess.check_output(['git','branch','--show-current'],text=True).strip()!='astra-爬坡':raise RuntimeError('不在授权任务分支')
 env=dict(os.environ,BUILDQ_MIN_FREE_GB='10',PYTHONPYCACHEPREFIX=str(ROOT/'.score-cache/pycache'))
 env.setdefault('RUG_SCORE_PYTHON',sys.executable)
 state_path=CACHE/'sweep-state.json'
 state=json.loads(state_path.read_text()) if state_path.exists() else {'cache':{},'cycles':{},'counter':0}
 logic=hashlib.sha256(b''.join((ROOT/p).read_bytes() for p in ['web/rug.js','scripts/score/score.py','scripts/score/replay.js'])).hexdigest()
 cycle=state['cycles'].setdefault(str(args.cycle),{'visited':[],'kept':[]})
 def save():state_path.write_text(json.dumps(state,ensure_ascii=False,indent=2)+'\n')
 def evaluate(config,label,fast=True):
  disk_guard()
  effective={k:config.get(k,v[0]) for k,v in PLAN.items()}
  key=hashlib.sha256(json.dumps([logic,effective,fast],sort_keys=True).encode()).hexdigest()
  if key in state['cache']:
   row=state['cache'][key]
   print('缓存',label,row.get('total'),flush=True)
   return row
  state['counter']+=1
  tag=f"r2-c{args.cycle}-{state['counter']:03d}-{label}"
  cmd=[str(ROOT/'scripts/score.sh'),'--label',tag]
  for k,v in effective.items():cmd+=['--q',f'{k}={v}']
  if fast:cmd+=['--q','scoreRaster=2']
  log=CACHE/f'{tag}.log'
  with log.open('w') as output:
   rc=subprocess.run(cmd,env=env,stdout=output,stderr=subprocess.STDOUT).returncode
  disk_guard()
  text=log.read_text(); match=re.search(r'运行目录：(.+)',text)
  if not match:raise RuntimeError(f'入口未启动，见{log}')
  path=Path(match[1].strip())
  row={'path':str(path),'config':effective,'fast':fast,'label':tag,'valid':rc==0}
  if rc==0:
   row['score']=json.loads((path/'score.json').read_text());row['total']=row['score']['total']
  else:row['error']=text[-1000:]
  state['cache'][key]=row;save()
  print(label,'总分',row.get('total','无效'),flush=True)
  return row

 if 'baseline' not in state:
  baseline=evaluate(read_tuning(),'baseline',False)
  if not baseline['valid']:raise RuntimeError('基线失败')
  state['baseline']=baseline;save()
 for param in args.params.split(','):
  if param not in PLAN:raise ValueError(param)
  if param in cycle['visited'] and not args.recheck:raise RuntimeError(f'本轮已扫过{param}，不要重复登记')
  config=read_tuning();initial=config.get(param,PLAN[param][0]);images=[]
  official=evaluate(config,f'{param}-current-full',False)
  base=evaluate(config,f'{param}-current',True)
  if not official['valid'] or not base['valid']:raise RuntimeError('当前保留版本失败')
  candidates=[]
  def test_value(value):
   cfg=dict(config);cfg[param]=value
   row=evaluate(cfg,f'{param}-{value:g}')
   candidates.append(row)
   if row['valid']:
    image=visual_strip(Path(row['path']),f'{param}={value:g} total={row["total"]:.6f}')
    if image is not None:images.append(image)
   return row
  for value in PLAN[param][1]:test_value(value)
  valid=[r for r in candidates if r['valid']]
  # 粗扫的最高分即使卡在分段门槛外，也要探查附近；最终保留仍严格检查门槛。
  center=max(valid,key=lambda r:r['total'])['config'][param] if valid else initial
  coarse=PLAN[param][1];step=min(b-a for a,b in zip(coarse,coarse[1:]))/4
  if param=='iter':step=max(1,step) # 整数参数必须实际测试相邻整数，不能舍入回原值。
  fine=set()
  for delta in [-step,-step/2,step/2,step]:
   value=round(center+delta,6)
   if param in ['iter','gravity']:value=round(value)
   if min(coarse)<=value<=max(coarse) and value not in coarse and value!=initial:fine.add(value)
  for value in sorted(fine):test_value(value)
  usable=sorted([r for r in candidates if r['valid'] and eligible(r['score'],base['score']) and all(r['score']['segments'][k]['iou']>=state['baseline']['score']['segments'][k]['iou']-cap for k,cap in CAPS.items())],key=lambda r:r['total'],reverse=True)
  accepted=None
  for candidate in usable:
   value=candidate['config'][param];cfg=dict(config);cfg[param]=value
   exact=evaluate(cfg,f'{param}-{value:g}-confirm',False)
   if exact['valid']:
    image=visual_strip(Path(exact['path']),f'FULL {param}={value:g} total={exact["total"]:.6f}')
    if image is not None:images.append(image)
   if not exact['valid'] or not eligible(exact['score'],official['score']):
    candidate['exact_rejected']=str(exact['path']);save();continue
   if any(exact['score']['segments'][k]['iou']<state['baseline']['score']['segments'][k]['iou']-cap for k,cap in CAPS.items()):continue
   before=TUNING.read_text();write_tuning(cfg)
   testdir=CACHE/f'regress-c{args.cycle}-{param}-{value:g}'
   try:
    result=subprocess.run([str(Path.home()/'.claude/bin/testq'),'--',str(ROOT/'scripts/score/regress.sh'),str(testdir)],env=env)
    if result.returncode:
     TUNING.write_text(before)
     candidate['regression_rejected']=str(testdir);save();continue
    disk_guard()
    subprocess.run(['git','add','web/tuning.js'],check=True)
    message=f'修复：{NAMES[param]}调至{value:g}，总分{official["total"]:.6f}升至{exact["total"]:.6f}'
    subprocess.run(['git','commit','-m',message],check=True)
   except BaseException:
    TUNING.write_text(before);raise
   accepted=exact
   cycle['kept'].append({'param':param,'from':initial,'to':value,'total':exact['total'],'testdir':str(testdir),'commit':subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip()})
   print('保留',message,flush=True)
   break
  if param not in cycle['visited']:cycle['visited'].append(param)
  save()
  if images:
   cv2.imwrite(str(CACHE/f'cycle{args.cycle}-{param}-review.jpg'),np.vstack(images))
  # 当前版本对比图也属于本轮临时截图，看板之外不重复保留。
  for row in [base,official]:
   (Path(row['path'])/'keyframes.jpg').unlink(missing_ok=True)
  with JOURNAL.open('a') as f:
   for row in candidates:
    value=row['config'][param]
    if row['valid']:
     r=row['score'];vals=' | '.join(f'{v:.6f}' for v in [r['total'],*[v['iou'] for v in r['segments'].values()]])
     result='候选；以原分辨率确认结果为准' if accepted and value==accepted['config'][param] else '未保留'
     if not accepted or value!=accepted['config'][param]:
      drops=[k for k,cap in CAPS.items() if r['segments'][k]['iou']<base['score']['segments'][k]['iou']-cap or r['segments'][k]['iou']<state['baseline']['score']['segments'][k]['iou']-cap]
      result='分段下降超限：'+','.join(drops) if drops else '总分未提升'
     if row.get('exact_rejected'):result='原分辨率确认未达保留条件'
     if row.get('regression_rejected'):result='回归失败，退回'
     f.write(f'| 二轮{args.cycle} | {param}={value:g} | {vals} | {result} |\n')
    else:f.write(f'| 二轮{args.cycle} | {param}={value:g} | 无分数 | — | — | — | — | 重放抓空或失败，未保留 |\n')
   if accepted:f.write(f'\n本参数最终保留 `{param}={accepted["config"][param]:g}`，原分辨率总分 {accepted["total"]:.6f}，五项回归通过。\n\n')
  print('完成参数',param,'本轮已保留',len(cycle['kept']),flush=True)
 print(json.dumps(cycle,ensure_ascii=False,indent=2),flush=True)


if __name__=='__main__':main()
