/**
 * 模型预设目录 —— 数据已上移到 `shared/contract.js`（唯一数据来源）。
 *
 * 这里只保留宿主侧惯用的取用函数，避免调用方为了重构改 import 路径；
 * 新增预设请改 `shared/contract.js`，不要在本文件重新定义数据。
 */

import { DEFAULT_PRESET, PRESETS, presetById as findPreset } from '../shared/contract.js'

export { DEFAULT_PRESET, PRESETS }

/** 按 id 取预设；未知 id 回退到默认项。 */
export function presetById(id) {
  return findPreset(id)
}

/** 面向 Client 的精简视图（去掉下发远端用的 pipeline 细节，避免双份真相）。 */
export function publicPresets() {
  return PRESETS.map(({ pipeline, ...rest }) => rest)
}