#!/usr/bin/env python3
"""真实参考视频回归：单帧遮罩抖动不能推迟已静止的对折与拉角。"""
import argparse
import importlib.util
import json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--scorer', type=Path, default=Path(__file__).with_name('score.py'))
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('score', args.scorer)
score = importlib.util.module_from_spec(spec)
spec.loader.exec_module(score)
root = Path(__file__).resolve().parents[2]
reference = json.loads((root / '.score-cache/reference/reference.json').read_text())
assert reference['identity']['video'] == score.VIDEO_SHA
curve = reference['motion']
threshold = max(.0005, float(score.np.percentile(curve[300-score.F0:421-score.F0], 95))*2)
fold = score.settle(curve, 294, 420, threshold)
pull = score.settle(curve, 593, 739, threshold)
print('真实参考第一次对折停稳帧数：', fold['frames'])
print('真实参考拉右下角停稳帧数：', pull['frames'])
assert not fold['censored'] and fold['frames'] <= 6, '已静止的对折被误判成持续运动'
assert not pull['censored'] and pull['frames'] <= 6, '图标或光标造成的短暂扰动被误判成持续运动'
print('参考视频停稳回归：通过')
