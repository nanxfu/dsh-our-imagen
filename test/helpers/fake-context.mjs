/**
 * Host 测试共用的假 cordis Context、极简 HTTP 替身与请求工具。
 */

import { createServer } from 'node:http'

/** 只提供 workingDirectory 的最小宿主上下文。 */
export function workspaceContext(workspace) {
  return {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: workspace }
      return undefined
    },
  }
}

/** 极简 res 替身（用于直接调用路由 handler，不依赖真实 socket）。 */
export function makeRes() {
  const state = { code: null, headers: null, body: null }
  return {
    state,
    writeHead(code, headers) {
      state.code = code
      state.headers = headers
    },
    end(body) {
      state.body = body ? JSON.parse(Buffer.from(body).toString('utf8')) : null
    },
  }
}

/**
 * 创建假 cordis Context：收集注册的路由/工具/effect 清理函数，不执行外部命令。
 *
 * @param {string} workspace
 */
export function createFakeContext(workspace) {
  const routes = []
  const tools = []
  const cleanups = []
  let origin = ''
  let llm = null

  const ctx = {
    get(name) {
      if (name === 'workingDirectory') return { defaultDirectory: workspace }
      if (name === 'llm') return llm
      if (name === 'agentDefaultModel') {
        return llm ? { currentSelection: () => ({ provider: 'mock-provider', model: 'mock-model' }) } : undefined
      }
      return undefined
    },
    effect(fn, _label) {
      const disposer = fn()
      if (typeof disposer === 'function') cleanups.push(disposer)
      return disposer
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {
          const index = routes.indexOf(route)
          if (index >= 0) routes.splice(index, 1)
        }
      },
      getOrigin: () => origin,
    },
    subprocess: {
      async resolveExecutable(name) {
        throw new Error(`测试环境不执行外部命令：${name}`)
      },
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
  }

  return {
    ctx,
    routes,
    tools,
    setOrigin(value) {
      origin = value
    },
    /** 注入 / 移除宿主模型替身；传 null 表示「没有可用模型」。 */
    setLlm(next) {
      llm = next
    },
    dispose() {
      for (const cleanup of cleanups.reverse()) {
        try {
          cleanup()
        } catch {}
      }
    },
  }
}

function allows(method, allow) {
  const list = Array.isArray(allow) ? allow : [allow]
  return list.includes(method)
}

/** 把 route-kit 形状的路由挂到本机 HTTP 服务上。 */
export function startHost(routes) {
  const server = createServer((req, res) => {
    let pathname = '/'
    try {
      pathname = new URL(req.url, 'http://placeholder.local').pathname
    } catch {}
    const route = routes.find((item) => item.path === pathname)
    if (!route) {
      res.writeHead(404)
      return res.end()
    }
    if (route.method && !allows(req.method, route.method)) {
      res.writeHead(405, { allow: [].concat(route.method).join(', ') })
      return res.end()
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      if (!res.headersSent) res.writeHead(500, { 'content-type': 'text/plain' })
      res.end(String(error?.stack ?? error))
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, origin: `http://127.0.0.1:${server.address().port}` }))
  })
}

export async function closeServer(server) {
  server.closeAllConnections?.()
  await new Promise((resolve) => server.close(() => resolve()))
}

export async function json(base, path, options) {
  const res = await fetch(new URL(path, base), options)
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body, text, headers: res.headers }
}
