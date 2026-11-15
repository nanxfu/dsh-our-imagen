/**
 * 系统默认浏览器的拉起与降级判定。
 *
 * 本模块负责：判断当前环境是否值得尝试拉起浏览器（`canOpenBrowser`）、各平台的打开命令
 * （`browserCommand`）、以及 spawn 系统命令的打开器（`createDefaultBrowserOpener`）。
 * 打开失败（命令不存在 / spawn 超时）返回 false，由登录管理器降级为 manual 模式。
 *
 * 从 `lib/kaggle-oauth.js` 拆出：与 OAuth 协议和登录状态机无关，只有进程与平台判断。
 */

import { spawn } from 'node:child_process'

import { createLogger } from '../../log.js'
import { nonEmptyString, sanitizeMessage } from './text.js'

/** 拉起浏览器的判定超时：spawn 事件不来时不阻塞登录流程（降级 manual）。 */
const BROWSER_OPEN_TIMEOUT_MS = 1500

/** 判断当前环境是否值得尝试拉起浏览器（对齐 kagglesdk `_can_open_browser`，kaggle_oauth.py:108-116）。 */
export function canOpenBrowser({ platform = process.platform, env = process.env } = {}) {
  if (platform === 'win32' || platform === 'darwin') return true
  if (platform === 'linux') return Boolean(nonEmptyString(env?.DISPLAY) || nonEmptyString(env?.WAYLAND_DISPLAY))
  return false
}

/**
 * 各平台打开浏览器的命令（可注入，便于测试与无头环境降级）。
 *
 * Windows 不走 `cmd.exe /c start`：Node 的 spawn 只对含空格的参数加引号，授权链接里没有空格，
 * 于是链接中的 `&` 会被 cmd 当成命令分隔符把 URL 截断——Kaggle 侧表现为
 * `400 Must specify State`（实战踩坑）。`rundll32 url.dll,FileProtocolHandler` 把 URL 当普通
 * 参数交给系统默认浏览器，不经过 cmd 解析，跨 shell 特殊字符安全。
 */
export function browserCommand(platform, url) {
  if (platform === 'win32') {
    return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', String(url)] }
  }
  if (platform === 'darwin') return { command: 'open', args: [String(url)] }
  return { command: 'xdg-open', args: [String(url)] }
}

/**
 * 默认浏览器打开器：spawn 系统命令，`spawn` 事件到来即视为成功（不等待浏览器进程退出）。
 * 失败（命令不存在 / spawn 超时）返回 false，由登录管理器降级为 manual 模式。
 *
 * @param {{ platform?: string, spawnFn?: Function, log?: object }} [options]
 * @returns {(url: string) => Promise<boolean>}
 */
export function createDefaultBrowserOpener({ platform = process.platform, spawnFn = spawn, log = createLogger({ scope: 'kaggle-login' }) } = {}) {
  return function openBrowser(url) {
    return new Promise((resolvePromise) => {
      let settled = false
      let timer = null
      const done = (value) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolvePromise(value)
      }
      let child
      try {
        const { command, args } = browserCommand(platform, url)
        child = spawnFn(command, args, { windowsHide: true, detached: true, stdio: 'ignore' })
      } catch (error) {
        log.debug('打开浏览器失败（spawn 抛错），降级 manual', sanitizeMessage(error?.message ?? error))
        return done(false)
      }
      if (!child || typeof child.once !== 'function') return done(false)
      timer = setTimeout(() => done(false), BROWSER_OPEN_TIMEOUT_MS)
      timer.unref?.()
      child.once('error', (error) => {
        log.debug('打开浏览器失败（进程错误），降级 manual', sanitizeMessage(error?.message ?? error))
        done(false)
      })
      child.once('spawn', () => {
        try {
          child.unref?.()
        } catch {}
        done(true)
      })
    })
  }
}
