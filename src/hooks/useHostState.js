/** 轮询 Host 状态；有进行中的任务时加快节奏。 */

import { TIMEOUTS } from '../../shared/contract.js'

import { React } from '../runtime.js'
import { fetchState } from '../api/resources.js'
import { activeJobOf } from '../logic/jobs.js'

export function useHostState() {
  const [state, setState] = React.useState(null)
  const [error, setError] = React.useState(null)
  const aliveRef = React.useRef(false)
  const refreshRef = React.useRef(() => {})

  React.useEffect(() => {
    aliveRef.current = true
    let timer = null

    const clear = () => {
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    }

    const tick = async () => {
      timer = null
      if (document.hidden) return
      const result = await fetchState()
      if (!aliveRef.current) return
      let delay = TIMEOUTS.clientStatePollMs
      if (result.ok && result.data && typeof result.data === 'object') {
        setState(result.data)
        setError(null)
        delay = activeJobOf(result.data) ? TIMEOUTS.clientStateActivePollMs : TIMEOUTS.clientStatePollMs
      } else {
        setError({ code: result.code, message: result.message })
      }
      timer = setTimeout(tick, delay)
    }

    const onVisible = () => {
      if (document.hidden) {
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
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      aliveRef.current = false
      clear()
      refreshRef.current = () => {}
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [])

  const refresh = React.useCallback(() => {
    refreshRef.current()
  }, [])

  return { state, error, refresh }
}
