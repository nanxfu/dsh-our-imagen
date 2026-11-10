/**
 * 样式模块清单。
 *
 * 顺序就是层叠顺序：先变量与基础件，再各区域，最后响应式。
 * src/styles.js 按同一顺序静态 import（esbuild 的 text loader 要求静态路径），
 * tools/preview.mjs 按同一顺序从磁盘读取，两处必须保持一致。
 */
export const STYLE_FILES = [
  'tokens.css',
  'base.css',
  'shell.css',
  'panel.css',
  'stage.css',
  'filmstrip.css',
  'gallery.css',
  'chat.css',
  'responsive.css',
]