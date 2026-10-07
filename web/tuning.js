// 本地逐帧爬坡选定的参数。URL 查询参数优先，便于不改默认值做对照。
// 由 scripts/score/sweep.py 维护完整对象；每次保留前必须通过真实重放和回归。
export default {
  "optmatch": 0.9375,
  "foldfric": 4,
  "damp": 0.9,
  "fdamp": 0.95,
  "grabweight": 1.5
};
