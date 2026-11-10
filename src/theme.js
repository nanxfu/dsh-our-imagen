/**
 * 对话页徽章的内联样式。
 *
 * 工作台主体样式在 src/styles/ 下的 CSS 模块里；这里只保留对话页头部徽章
 * 需要的那份内联样式，以及语义状态色 token。新增 UI 请优先写进 CSS 模块。
 *
 * 约定：token 只引用宿主 CSS 变量（不带 fallback），宿主深色主题会一起切换。
 */

export const token = {
  bg: 'var(--dsw-alias-bg-layer-2)',
  border: 'var(--dsw-alias-border-l1)',
  text: 'var(--dsw-alias-label-primary)',
  textSub: 'var(--dsw-alias-label-secondary)',
  ok: 'var(--dsw-alias-state-success-primary)',
  warn: 'var(--dsw-alias-state-warn-primary)',
  error: 'var(--dsw-alias-state-error-primary)',
  idle: 'var(--dsw-alias-state-idle-primary)',
  brand: 'var(--dsw-alias-brand-primary)',
}

export const styles = {
  dot: (color) => ({
    width: 6,
    height: 6,
    minWidth: 6,
    borderRadius: 99,
    background: color,
    display: 'inline-block',
  }),
  headerChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    maxWidth: 112,
    minWidth: 0,
    fontSize: 11,
    fontWeight: 550,
    color: token.textSub,
    padding: '2px 9px 2px 8px',
    border: `1px solid color-mix(in oklab, ${token.border} 72%, transparent)`,
    borderRadius: 999,
    background: `color-mix(in oklab, ${token.bg} 78%, transparent)`,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  headerChipText: { overflow: 'hidden', textOverflow: 'ellipsis' },
}