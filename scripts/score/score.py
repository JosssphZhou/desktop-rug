#!/usr/bin/env python3
"""固定参考视频的逐帧轮廓及动效评分。公式与测量限制见 README.md。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time

import cv2
import numpy as np

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
F0, F1 = 236, 1563
SIZE = (831, 540)  # 空间缩小一半，时间不抽帧。
VIDEO_SHA = 'a3e6f65d1f429b50456b997fb2fd59b25dc29b242b6fd8fcbc2e45007da27a20'
DEFAULT_VIDEO = Path.home() / 'Movies/Replay/2C19C24B-6712-48F3-8273-873E5258F308.mp4'
SEGMENTS = {'第一次对折': (236, 420), '拖过图标堆': (430, 518),
            '翻回去': (920, 957), '抓中间': (1414, 1478)}
# 短暂停顿同样计分，不把真实的持续蠕动裁掉。519..523 和 958..1027 是截尾观察。
RELEASES = [(294, 420), (519, 523), (593, 739), (783, 919), (958, 1027), (1479, 1563)]
ACTIONS = [(238, 420), (430, 523), (527, 739), (744, 919),
           (920, 1027), (1033, 1346), (1414, 1563)]
KEYS = [236, 250, 276, 298, 358, 418, 450, 466, 518, 782, 942, 957,
        1044, 1054, 1080, 1424, 1444, 1478]
SYNC = {524, 740, 1028, 1405}


def disk_guard():
    free = os.statvfs('/').f_bavail * os.statvfs('/').f_frsize / 1e9
    if free < 11:
        raise RuntimeError(f'内置盘剩余 {free:.2f} GB，低于本任务 11 GB 停止线')


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for b in iter(lambda: f.read(1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def dump(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def camera():
    mats = json.loads((HERE / 'camera.json').read_text())['T']
    scale = np.diag([.5, .5, 1])
    return {int(f): (scale @ np.array(m) @ np.linalg.inv(scale))[:2] for f, m in mats.items()}


def valid_region(im, frame):
    """先排除人像、按键提示和蓝色标签对应的桌面图标，评分双方用同一遮挡区。"""
    valid = np.full(im.shape[:2], 255, np.uint8)
    valid[:16] = 0
    cv2.circle(valid, (734, 443), 85, 0, -1)
    if 1033 <= frame <= 1436:
        valid[452:514, 385:447] = 0
    h, s, v = cv2.split(cv2.cvtColor(im, cv2.COLOR_BGR2HSV))
    blue = ((h >= 95) & (h <= 130) & (s > 140) & (v > 100)).astype(np.uint8)
    blue = cv2.morphologyEx(blue, cv2.MORPH_CLOSE, np.ones((3, 5), np.uint8))
    n, _, stats, _ = cv2.connectedComponentsWithStats(blue)
    for x, y, w, h, area in stats[1:]:
        if area >= 12 and 8 <= w <= 120 and 2 <= h <= 50:
            # 标签上方最多 45 像素包含该图标；保守剔除遮挡而不补画不可见的地毯。
            valid[max(0, y-45):min(SIZE[1], y+h+2), max(0,x-2):min(SIZE[0],x+w+2)] = 0
    return valid


def foreground(im, frame):
    """红色和深蓝边框组成的最大连通区域，填充内部花纹孔洞；不用凸包。"""
    b, g, r = cv2.split(im)
    h, s, v = cv2.split(cv2.cvtColor(im, cv2.COLOR_BGR2HSV))
    labels = (h >= 95) & (h <= 130) & (s > 140) & (v > 90)
    m = ((g < 100) & (s > 45) & ((h < 9) | (h > 160) | ((r < 90) & (b > g * .92))) & ~labels)
    m = m.astype(np.uint8) * 255
    m[:16] = 0  # 菜单栏
    cv2.circle(m, (734, 443), 85, 0, -1)  # 人像小窗，固定于源画面
    if 1033 <= frame <= 1436:
        m[452:514, 385:447] = 0  # 录屏软件的 Option 按键提示，不是地毯 UI
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    contours, _ = cv2.findContours(m, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise ValueError('没有分割到地毯')
    contour = max(contours, key=cv2.contourArea)
    out = np.zeros(m.shape, np.uint8)
    cv2.drawContours(out, [contour], -1, 255, -1)
    if cv2.countNonZero(out) < 20000:
        raise ValueError('地毯遮罩面积异常，拒绝计分')
    return out


def option_features(im, mask, floor):
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    contour = max(contours, key=cv2.contourArea)
    rect = cv2.minAreaRect(contour)
    width, height = sorted(rect[1], reverse=True)
    corners = cv2.boxPoints(rect)
    hsv = cv2.cvtColor(im, cv2.COLOR_BGR2HSV)
    white = ((hsv[..., 1] < 50) & (hsv[..., 2] > 210)).astype(np.uint8)
    dots, dot_area = 0, 0
    for x, y in corners:
        area = np.zeros(mask.shape, np.uint8)
        cv2.circle(area, (round(float(x)), round(float(y))), 8, 1, -1)
        n, labels, stats, centers = cv2.connectedComponentsWithStats(white * area)
        candidates = [int(stats[k, cv2.CC_STAT_AREA]) for k in range(1, n)
                      if 3 <= stats[k, cv2.CC_STAT_AREA] <= 45
                      and .4 < stats[k, cv2.CC_STAT_WIDTH] / stats[k, cv2.CC_STAT_HEIGHT] < 2.5]
        if candidates:
            dots += 1
            dot_area += max(candidates)
    # 抬起不能从俯视视频还原世界 z；用布外 3..25 像素的投影暗度作为可见代理。
    near = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7)))
    far = cv2.dilate(mask, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (51, 51)))
    ring = (far > 0) & (near == 0)
    lum = cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).astype(float)
    bg = cv2.cvtColor(floor, cv2.COLOR_BGR2GRAY).astype(float)
    darkness = float(np.maximum(0, (bg[ring] - lum[ring]) / np.maximum(bg[ring], 1)).mean())
    return [float(width * 2), float(height * 2), darkness, dots, dot_area * 4]


def video_frames(path):
    cap = cv2.VideoCapture(str(path))
    if not cap.isOpened() or abs(cap.get(cv2.CAP_PROP_FPS) - 60) > .01:
        raise ValueError('参考视频必须可读且为 60 fps')
    cap.set(cv2.CAP_PROP_POS_FRAMES, F0)
    try:
        for frame in range(F0, F1 + 1):
            ok, im = cap.read()
            if not ok:
                raise ValueError(f'参考视频缺少 f{frame:04d}')
            yield frame, cv2.resize(im, SIZE, interpolation=cv2.INTER_AREA)
    finally:
        cap.release()


def reference(video, cache):
    identity = {'video': sha(video), 'scorer': sha(Path(__file__)),
                'camera': sha(HERE / 'camera.json'), 'floor': sha(HERE / 'floor.png')}
    if identity['video'] != VIDEO_SHA:
        raise ValueError('视频 SHA256 与固定参考不一致，不能套用本次镜头标定')
    meta = cache / 'reference.json'
    if meta.exists():
        data = json.loads(meta.read_text())
        if data['identity'] == identity and all((cache / f'f{f:04d}.png').exists() and (cache / f'v{f:04d}.png').exists() for f in range(F0, F1 + 1)):
            return data
    cache.mkdir(parents=True, exist_ok=True)
    floor = cv2.resize(cv2.imread(str(HERE / 'floor.png')), SIZE)
    matrices = camera()
    changes, options, areas = [], [], []
    prev = previous_valid = None
    sheet = []
    for f, im in video_frames(video):
        mask = foreground(im, f)
        stable = cv2.warpAffine(mask, matrices[f], SIZE, flags=cv2.INTER_NEAREST)
        valid = cv2.warpAffine(valid_region(im, f), matrices[f], SIZE, flags=cv2.INTER_NEAREST)
        common = cv2.bitwise_and(valid, previous_valid) if previous_valid is not None else valid
        changes.append(change(prev, stable, common))
        areas.append(cv2.countNonZero(cv2.bitwise_and(stable, valid)))
        prev, previous_valid = stable, valid
        cv2.imwrite(str(cache / f'f{f:04d}.png'), stable)
        cv2.imwrite(str(cache / f'v{f:04d}.png'), valid)
        if 1030 <= f <= 1100:
            # 此时镜头静止；和地板的微小配准偏差会记入代理测量的限制。
            canonical = cv2.warpAffine(im, matrices[f], SIZE)
            options.append(option_features(canonical, stable, floor))
        if f in KEYS:
            overlay = im.copy()
            source_valid = valid_region(im, f)
            selected = (mask > 0) & (source_valid > 0)
            overlay[selected] = overlay[selected] * .55 + np.array([0, 200, 0]) * .45
            overlay[source_valid == 0] = overlay[source_valid == 0] * .4
            cv2.putText(overlay, f'f{f:04d}', (15, 35), cv2.FONT_HERSHEY_SIMPLEX, 1, (255, 255, 255), 2)
            sheet.append(cv2.resize(overlay, (415, 270)))
    cv2.imwrite(str(cache / 'reference-masks.jpg'), np.vstack([np.hstack(sheet[i:i+3]) for i in range(0, 18, 3)]))
    data = {'identity': identity, 'motion': changes, 'option': options, 'area': areas}
    dump(meta, data)
    return data


def change(a, b, valid=None):
    if a is None:
        return 0.0
    if valid is not None:
        a, b = cv2.bitwise_and(a, valid), cv2.bitwise_and(b, valid)
    return cv2.countNonZero(cv2.bitwise_xor(a, b)) / max(cv2.countNonZero(cv2.bitwise_or(a, b)), 1)


def tempo(a, b, lo, hi):
    start, end = lo - F0, hi - F0 + 1
    # 三帧对称均值过滤视频编码和边缘二值化的单帧噪声，不做时移匹配。
    a, b = np.convolve(a, np.ones(3)/3, 'same'), np.convolve(b, np.ones(3)/3, 'same')
    keep = [f - F0 for f in range(lo, hi + 1) if all(abs(f - s) > 1 for s in SYNC)]
    if not keep:
        return 0.0
    error = np.mean(np.abs(a[keep] - b[keep]))
    scale = max(float(np.mean(a[start:end])), .002)
    return float(np.exp(-error / scale))


def settle(curve, lo, hi, threshold):
    # 六帧持续低于阈值才算停稳。后续六帧平均变化量超阈值才算再次运动，
    # 单帧编码、光标或分割抖动不能把已静止的参考推迟到数秒后。
    values = np.asarray(curve[lo-F0:hi-F0+1])
    if len(values) >= 6:
        smooth_values = np.convolve(np.pad(values, (1, 1), mode='edge'), np.ones(3)/3, 'valid')
        sustained = np.convolve(values, np.ones(6)/6, 'valid')
        for i in range(len(values) - 5):
            if np.all(smooth_values[i:i+6] <= threshold) and np.all(sustained[i:] <= threshold):
                return {'frames': i, 'censored': False, 'window': [lo, hi]}
    return {'frames': len(values), 'censored': True, 'window': [lo, hi]}


def option_score(ref, ours):
    r, o = np.asarray(ref, float), np.asarray(ours, float)
    # 尺寸相对各自 f1030，避免把之前积累的平移当作选中弹开。
    rn, on = r[:, :2] / r[0, :2], o[:, :2] / o[0, :2]
    rs, os_ = r[:, 2] - r[0, 2], o[:, 2] - o[0, 2]
    def facts(x, norm):
        plateau = np.median(norm[24:41], axis=0)
        peak = norm[:35].max(axis=0)
        def first(condition):
            where = np.flatnonzero(condition)
            return int(where[0] + 1030) if len(where) else 1101
        return {'plateau_ratio': plateau.tolist(), 'peak_ratio': peak.tolist(),
                'peak_frame': (norm[:35].argmax(axis=0) + 1030).tolist(),
                'straightened_frame': first(np.all(np.abs(norm - plateau) < .01, axis=1)),
                'four_dots_frame': first(x[:, 3] == 4),
                'max_dot_count': int(x[:, 3].max()), 'max_dot_area_px': float(x[:, 4].max()),
                'lift_shadow_peak': float((x[:, 2]-x[0, 2]).max())}
    rf, of = facts(r, rn), facts(o, on)
    dimension = float(np.exp(-np.abs(rn-on).mean() / .025))
    peak_err = np.abs(np.array(rf['peak_ratio']) - of['peak_ratio']).mean() / .025
    time_err = np.abs(np.array(rf['peak_frame']) - of['peak_frame']).mean() / 12
    straight_err = abs(rf['straightened_frame'] - of['straightened_frame']) / 12
    overshoot = float(np.exp(-(peak_err + time_err + straight_err)/3))
    lift = float(np.exp(-np.abs(rs-os_).mean() / .05))
    dot_error = np.abs(r[:, 3]-o[:, 3]).mean() / 4 + np.abs(r[:, 4]-o[:, 4]).mean()/320
    dot_time = abs(rf['four_dots_frame']-of['four_dots_frame'])/12
    dots = float(np.exp(-(dot_error + dot_time)/2))
    return {'score': float(np.mean([dimension, overshoot, lift, dots])),
            'dimensions': dimension, 'overshoot_timing': overshoot, 'lift_proxy': lift,
            'dots': dots, 'reference': rf, 'candidate': of}


def capture(binary, out, queries):
    frames = out / 'frames'
    frames.mkdir()
    cmd = [str(binary), '--material', 'persian', '--rug', '1280,780,680',
           '--level', '-2147483648', '--eval-file', str(HERE / 'replay.js'),
           '--snap-dir', str(frames), '--quit-after', '600']
    for query in queries:
        cmd.extend(['--q', query])
    # 低于桌面的临时窗口，不抢真鼠标；RUG_ROOT 只读取当前任务工作树资源。
    home = str(ROOT / '.score-cache/home')
    env = dict(os.environ, RUG_ROOT=str(ROOT), HOME=home, CFFIXED_USER_HOME=home)
    with (out / 'replay.log').open('w') as log:
        process = subprocess.Popen(cmd, stdout=log, stderr=subprocess.STDOUT, env=env)
        try:
            deadline = time.monotonic() + 630
            while process.poll() is None:
                disk_guard()
                if time.monotonic() > deadline:
                    raise TimeoutError('重放超过 630 秒')
                time.sleep(2)
            rc = process.returncode
        except BaseException:
            process.terminate()
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            raise
    text = (out / 'replay.log').read_text()
    if rc or '[评分重放] COMPLETE 1328' not in text or '[评分重放] ERROR' in text:
        raise RuntimeError(f'逐帧重放未完成，见 {out / "replay.log"}')
    if '没抓到布' in text:
        raise RuntimeError(f'动作抓空，拒绝给分，见 {out / "replay.log"}')
    missing = [f for f in range(F0, F1+1) if not (frames / f'f{f:04d}.png').is_file()]
    if missing:
        raise RuntimeError(f'重放缺帧：{missing[:10]}')
    return frames


def compare(video, frames, cache, ref, out, evidence):
    floor = cv2.resize(cv2.imread(str(HERE / 'floor.png')), SIZE)
    matrices = camera()
    ious, motion, options = [], [], []
    prev, previous_valid, keys = None, None, []
    cmd = ['ffmpeg', '-v', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgr24', '-s', '1662x580',
           '-r', '60', '-i', '-', '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21',
           '-pix_fmt', 'yuv420p', str(out / 'comparison.mp4')]
    encoder = subprocess.Popen(cmd, stdin=subprocess.PIPE) if evidence else None
    try:
        for f, ref_im in video_frames(video):
            disk_guard()
            path = frames / f'f{f:04d}.png'
            rgba = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
            if rgba is None or rgba.shape not in [(1080, 1662, 4), (540, 831, 4)]:
                raise ValueError(f'重放帧尺寸或透明通道错误：{path}')
            rgba = cv2.resize(rgba, SIZE, interpolation=cv2.INTER_AREA)
            alpha = rgba[..., 3:4].astype(float) / 255
            ours = (rgba[..., :3] * alpha + floor * (1-alpha)).astype(np.uint8)
            mask = foreground(ours, f)
            target = cv2.imread(str(cache / f'f{f:04d}.png'), cv2.IMREAD_GRAYSCALE)
            valid = cv2.imread(str(cache / f'v{f:04d}.png'), cv2.IMREAD_GRAYSCALE)
            ious.append(1-change(target, mask, valid))
            common = cv2.bitwise_and(valid, previous_valid) if previous_valid is not None else valid
            motion.append(change(prev, mask, common))
            prev, previous_valid = mask, valid
            if 1030 <= f <= 1100:
                options.append(option_features(ours, mask, floor))
            inverse = cv2.invertAffineTransform(matrices[f])
            shown = cv2.warpAffine(ours, inverse, SIZE, borderValue=(40,40,40))
            title = np.zeros((40, 1662, 3), np.uint8)
            cv2.putText(title, f'Reference f{f:04d} | IoU {ious[-1]:.4f}', (12,28), cv2.FONT_HERSHEY_SIMPLEX, .7, (255,255,255), 1)
            cv2.putText(title, 'Candidate: same virtual cursor; no desktop files', (843,28), cv2.FONT_HERSHEY_SIMPLEX, .6, (255,255,255), 1)
            pair = np.vstack([title, np.hstack([ref_im, shown])])
            if encoder:
                encoder.stdin.write(pair.tobytes())
            if f in KEYS:
                keys.append(cv2.resize(pair, (831,290)))
            # 只删除本次 mkdtemp 目录中、已经计分并录入视频的临时 PNG；不删除外部素材。
            path.unlink()
        if encoder:
            encoder.stdin.close()
            if encoder.wait(timeout=120):
                raise RuntimeError('并排录像编码失败')
    except BaseException:
        if encoder:
            if encoder.stdin and not encoder.stdin.closed:
                encoder.stdin.close()
            if encoder.poll() is None:
                encoder.terminate()
            encoder.wait()
        raise
    cv2.imwrite(str(out / 'keyframes.jpg'), np.vstack([np.hstack(keys[i:i+2]) for i in range(0,18,2)]))
    # 阈值只从参考第一次对折静止段取，不随候选变化。
    threshold = max(.0005, float(np.percentile(ref['motion'][300-F0:421-F0], 95)) * 2)
    settling = []
    for lo, hi in RELEASES:
        r, o = settle(ref['motion'], lo, hi, threshold), settle(motion, lo, hi, threshold)
        # 同为截尾不代表同时停稳。无法看到真实终点时比较可见窗口内的运动曲线。
        score = tempo(ref['motion'], motion, lo, hi) if r['censored'] or o['censored'] else float(np.exp(-abs(r['frames']-o['frames'])/30))
        settling.append({'reference': r, 'candidate': o, 'score': score})
    I = float(np.mean(ious))
    T = float(np.mean([tempo(ref['motion'], motion, lo, hi) for lo,hi in ACTIONS]))
    S = float(np.mean([s['score'] for s in settling]))
    option = option_score(ref['option'], options)
    result = {'total': .55*I + .20*T + .15*S + .10*option['score'], 'iou': I,
              'tempo': T, 'settle': S, 'option': option, 'settle_threshold': threshold,
              'settling': settling, 'segments': {}, 'frames': F1-F0+1, 'fps': 60}
    for name, (lo, hi) in SEGMENTS.items():
        result['segments'][name] = {'iou': float(np.mean(ious[lo-F0:hi-F0+1])),
                                   'tempo': tempo(ref['motion'], motion, lo, hi)}
    dump(out / 'curves.json', {'iou': ious, 'motion': motion, 'option': options})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference', type=Path, default=DEFAULT_VIDEO)
    parser.add_argument('--prepare-reference', action='store_true')
    parser.add_argument('--label', default='candidate')
    parser.add_argument('--q', action='append', default=[], help='只覆盖本次运行的参数，例如 fric=0.06')
    parser.add_argument('--evidence', action='store_true', help='最终交付时导出60fps并排视频')
    args = parser.parse_args()
    disk_guard()
    cache = ROOT / '.score-cache/reference'
    ref = reference(args.reference, cache)
    if args.prepare_reference:
        print(f'已处理参考 f0236..f1563，共 1328 帧，60 fps；遮罩检查图：{cache / "reference-masks.jpg"}')
        return
    out = Path(tempfile.mkdtemp(prefix=time.strftime('%Y%m%d-%H%M%S-') + args.label + '-', dir=ROOT / '.score-cache'))
    binary = Path(os.environ['RUG_BIN']).resolve()
    metadata = {'label': args.label, 'commit': subprocess.check_output(['git','rev-parse','HEAD'], cwd=ROOT, text=True).strip(),
                'rug_sha256': sha(ROOT / 'web/rug.js'), 'host_sha256': sha(binary), 'queries': args.q,
                'tuning_sha256': sha(ROOT / 'web/tuning.js') if (ROOT / 'web/tuning.js').exists() else None,
                'reference_identity': ref['identity'], 'replay_sha256': sha(HERE / 'replay.js')}
    dump(out / 'provenance.json', metadata)
    print(f'运行目录：{out}', flush=True)
    try:
        frames = capture(binary, out, args.q)
        result = compare(args.reference, frames, cache, ref, out, args.evidence)
    finally:
        # 成功、中断、缺帧都清理本次原始截图，用户素材与参考缓存不动。
        for path in (out / 'frames').glob('f*.png'):
            path.unlink()
    dump(out / 'score.json', result)
    print(f"总分 {result['total']:.6f} | IoU {result['iou']:.6f} | 节奏 {result['tempo']:.6f} | 停稳 {result['settle']:.6f} | Option {result['option']['score']:.6f}")
    for name, score in result['segments'].items():
        print(f"{name}：IoU {score['iou']:.6f}，节奏 {score['tempo']:.6f}")
    print(f'证据：{out}')


if __name__ == '__main__':
    main()
