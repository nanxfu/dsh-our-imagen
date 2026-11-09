/** 剪贴板写入，失败时交由调用方走选中文本兜底。 */

export async function copyToClipboard(text) {
  try {
    if (
      typeof navigator !== 'undefined' &&
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === 'function'
    ) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 权限缺失或非安全上下文：交给选中文本的兜底路径
  }
  return false
}

/**
 * 轮询 Host 状态：有进行中的 job 时 2s，否则 10s；
 * document.hidden 时暂停，恢复可见立即拉一次。
 */
