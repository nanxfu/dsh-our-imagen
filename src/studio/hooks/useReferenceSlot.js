/**
 * 左栏参考图槽的导入动作（阶段十五 Phase C2）。
 *
 * 从电脑拖入 / 选择文件时不能直接把文件塞进请求体：模型原生参考图只认
 * 「工作区已落盘作品路径」（Host 协议见 SPEC §2.2）。因此先进现有 `POST /imagen-api/import`
 * 落盘为独立 `v1`，再把返回条目的 path 追加进参考槽；槽位本体与脏判定在 `useStudioForm`。
 *
 * 依赖入参：{ t, alive, ui, form, library }。library 只用于导入成功后刷新一次历史，
 * 让新落盘的作品出现在胶片条里（不切换舞台焦点，浏览中的作品保持不动）。
 */

import React from 'react'

import { importImageFile } from '../../api/resources.js'
import { formatText } from '../../logic/format.js'
import { importPrecheckOf } from '../../logic/import.js'
import {
  referenceFileErrorOf,
  referenceListOf,
  referenceMaxCount,
} from '../../logic/reference.js'
import { readFileAsDataUrl } from '../imageFile.js'

export function useReferenceSlot({ t, alive, ui, form, library }) {
  const [busy, setBusy] = React.useState(false)
  // 事件回调里判重入：拖入 / 选择可能在同一帧连续触发（一次拖入多张）。
  const busyRef = React.useRef(false)

  function toast(key, params) {
    if (!ui || typeof ui.showToast !== 'function') return
    ui.showToast(formatText(t(key), params))
  }

  /** 剩余名额：满额时直接提示，不再上传。 */
  function remainingOf() {
    return referenceMaxCount() - referenceListOf(form.form.references).length
  }

  /**
   * 上传一组本地文件 → 逐个预检 / 落盘 → 追加进参考槽。
   *
   * 逐张处理而不是并成一个请求：`/import` 一次只收一张，且失败/重复/满额要按张给提示。
   * 返回实际加入槽位的张数（0 表示全部失败或被挡下）。
   *
   * @param {Array<object>|object} files 浏览器 File 列表（或单个 File）
   * @returns {Promise<number>}
   */
  async function uploadFiles(files) {
    const list = (Array.isArray(files) ? files : [files]).filter(Boolean)
    if (list.length === 0 || busyRef.current) return 0
    let remaining = remainingOf()
    if (remaining <= 0) {
      toast('studio.reference.full', { max: referenceMaxCount() })
      return 0
    }
    busyRef.current = true
    setBusy(true)
    let added = 0
    try {
      if (list.length > remaining) toast('studio.reference.limit', { max: referenceMaxCount() })
      for (const file of list) {
        if (remaining <= 0) break
        // 参考图上限比导入上限更紧（4 MiB vs 8 MiB）：先按参考图口径挡掉，
        // 避免「导入成功、生成时才失败」。
        const fileError = referenceFileErrorOf(file)
        if (fileError) {
          toast(fileError.key, fileError.params)
          continue
        }
        const dataUrl = await readFileAsDataUrl(file).catch(() => '')
        if (!dataUrl) {
          toast('studio.reference.importFailed')
          continue
        }
        const precheck = importPrecheckOf({ file, dataUrl })
        if (!precheck.ok) {
          toast(precheck.errorKey, precheck.params)
          continue
        }
        const result = await alive(importImageFile({ data: precheck.dataUrl, name: precheck.name || undefined }))
        if (!result) return added
        const entry = result.ok && result.data ? result.data.entry : null
        if (!entry) {
          toast('studio.reference.importFailed')
          continue
        }
        // 用 entry.image 入槽：path 是已落盘的作品路径，宽高供缩略图按比例呈现。
        const outcome = form.addReference(entry)
        if (outcome.ok) {
          added += 1
          remaining -= 1
          continue
        }
        if (outcome.reason === 'duplicate') toast('studio.reference.duplicate')
        else if (outcome.reason === 'full') toast('studio.reference.full', { max: referenceMaxCount() })
        else toast('studio.reference.invalidPath')
      }
      if (added > 0) {
        toast('studio.reference.added', { count: added })
        // 新导入的图已经落盘成独立作品：刷新历史让它出现在胶片条里；
        // 不切舞台焦点，浏览中的作品保持不动（SPEC §5.21）。
        if (library && typeof library.loadHistory === 'function') library.loadHistory()
      }
    } catch {
      toast('studio.reference.importFailed')
    } finally {
      busyRef.current = false
      setBusy(false)
    }
    return added
  }

  return { busy, uploadFiles }
}
