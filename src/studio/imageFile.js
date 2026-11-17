/**
 * 浏览器侧的文件读取辅助。
 *
 * `FileReader` 只在事件回调（拖放 / 选择文件 / 粘贴）里用到，单独成模块便于
 * `ImageDropzone`（舞台导入）与参考图槽（左栏导入）共用同一份读取逻辑；
 * 测试里通过替换 `globalThis.FileReader` 驱动。
 */

/**
 * File → dataURL。
 *
 * @param {object} file 浏览器 File 对象
 * @returns {Promise<string>} 读取失败时 reject（调用方按导入失败提示）
 */
export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'function') {
      reject(new Error('FileReader unavailable'))
      return
    }
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error || new Error('read failed'))
    reader.readAsDataURL(file)
  })
}
