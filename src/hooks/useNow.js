/** 只在需要计时的时候每秒刷新一次当前时间。 */

import { React } from '../runtime.js'

export function useNow(enabled) {
  const [now, setNow] = React.useState(() => Date.now())
  React.useEffect(() => {
    if (!enabled) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [enabled])
  return now
}
