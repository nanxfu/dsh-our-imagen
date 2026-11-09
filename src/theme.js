/**
 * 颜色 token 与少量仍需内联的样式。
 *
 * 工作台主体已改用 src/styles.css；这里只保留对话页徽章（StatusChip）需要的那份样式，
 * 以及状态色 token。新增 UI 请优先写进 styles.css，不要再往这个对象里堆。
 */

export const token = {
  bg: 'var(--dsw-alias-bg-layer-1)',
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
    width: 7,
    height: 7,
    minWidth: 7,
    borderRadius: 99,
    background: color,
    display: 'inline-block',
  }),
  headerChip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    maxWidth: 96,
    minWidth: 0,
    fontSize: 11,
    color: token.textSub,
    padding: '1px 8px',
    border: `1px solid ${token.border}`,
    borderRadius: 999,
    background: token.bg,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
  },
  headerChipText: { overflow: 'hidden', textOverflow: 'ellipsis' },
}