/**
 * 展示页的共享 UI 状态。
 *
 * 只放「多个模块都要读写」的少量字段；轮播下标、布局缓存这类私有状态
 * 留在各自模块里，避免状态对象变成第二个全局命名空间。
 */
export const state = {
  lang: 'zh',
  theme: 'dark',
  motionMode: 'on',
  filter: 'all',
  selectedModelId: 'sdxl-lightning',
  selectedSampleFile: null,
  wfMode: 'studio',
  wfStudioShot: 'studio-light',
  instTab: 'gui',
  cliProfile: 'desktop',
  lightboxIdx: -1,
};

export function isMotionEnabled() {
  return state.motionMode !== 'off';
}
