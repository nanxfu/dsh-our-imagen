/**
 * 模型预设目录 —— 数据与取用函数已上移到 `shared/contract.js`（唯一来源）。
 *
 * 这里只做薄 re-export，避免调用方为了重构改 import 路径；
 * 新增预设请改 `models/*.json`，不要在本文件重新定义数据。
 */

export { DEFAULT_PRESET, PRESETS, presetById, publicPresets } from '../shared/contract.js'