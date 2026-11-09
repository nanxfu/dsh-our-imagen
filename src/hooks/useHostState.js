/** 轮询 Host 状态；有进行中的任务时加快节奏。 */

import { React } from '../runtime.js'
import { request } from '../api.js'
import { activeJobOf } from '../logic/jobs.js'

export function useHostState() {
  const [state, setState] = React.useState(null)
  const [error, setError] = React.useState(null)
  const aliveRef = React.useRef(false)
  const refreshRef = React.useRef(() => {})

  React.useEffect(() => {
    aliveRef.current = true
    let stopped = false
    let timer = null

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const tick = async () => {
      timer = null
      if (stopped) return
      if (typeof document !== 'undefined' && document.hidden) return
      const result = await request('imagen-api/state', { method: 'GET' })
      if (stopped || !aliveRef.current) return
      let delay = 10000
      if (result.ok && result.data && typeof result.data === 'object') {
        setState(result.data)
        setError(null)
        delay = activeJobOf(result.data) ? 2000 : 10000
      } else {
        setError({ code: result.code, message: result.message })
      }
      timer = setTimeout(tick, delay)
    }

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.hidden) {
        clear()
        return
      }
      clear()
      tick()
    }

    refreshRef.current = () => {
      clear()
      tick()
    }

    tick()
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible)
    return () => {
      stopped = true
      aliveRef.current = false
      clear()
      refreshRef.current = () => {}
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const refresh = React.useCallback(() => {
    refreshRef.current()
  }, [])

  const patch = React.useCallback((partial) => {
    setState((prev) => (prev ? { ...prev, ...partial } : prev))
  }, [])

  return { state, error, refresh, patch }
}
