/**
 * 风格试印条：五种风格的灰度小样。
 *
 * 风格预设不是抽象色块，而是暗房里先试印出来的一小片相纸：每种风格画一张
 * 64×64 的单色示意图，选风格时看到的是「这个风格长什么样」，不是「这个按钮
 * 是什么颜色」。全部为内联 SVG，不引入任何位图资产，也不使用彩色。
 *
 * 每个小样以 style id 作为 id 前缀，保证渐变 / 滤镜 id 唯一。
 */

const SPECIMENS = {
  // 写实摄影：天空柔光 + 两道山脊的景深
  film: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f5f5f7" />
          <stop offset="62%" stopColor="#c5c5cd" />
          <stop offset="100%" stopColor="#9b9ba4" />
        </linearGradient>
        <linearGradient id={`${uid}-far`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#8f8f99" />
          <stop offset="100%" stopColor="#5b5b64" />
        </linearGradient>
        <linearGradient id={`${uid}-near`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#33333a" />
          <stop offset="100%" stopColor="#151519" />
        </linearGradient>
        <radialGradient id={`${uid}-sun`}>
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${uid}-sky)`} />
      <circle cx="42" cy="27" r="15" fill={`url(#${uid}-sun)`} />
      <path d="M0 38 L12 33 L21 37 L33 30 L45 36 L56 32 L64 35 V64 H0Z" fill={`url(#${uid}-far)`} />
      <path d="M0 64 V47 L16 42 L30 48 L46 43 L64 46 V64Z" fill={`url(#${uid}-near)`} />
    </>
  ),

  // 概念原画：压暗的场景 + 一道边缘光
  concept: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor="#565661" />
          <stop offset="52%" stopColor="#2b2b32" />
          <stop offset="100%" stopColor="#141417" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${uid}-bg)`} />
      <circle cx="46" cy="15" r="10" fill="#ffffff" opacity="0.08" />
      <circle cx="46" cy="15" r="5.6" fill="#dcdce4" opacity="0.94" />
      <path d="M0 64 V46 L11 33 L18 40 L27 21 L34 32 L40 17 L48 29 L56 24 L64 32 V64Z" fill="#0d0d10" />
      <path
        d="M11 33 L18 40 M27 21 L34 32 M40 17 L48 29"
        fill="none"
        stroke="#f2f2f7"
        strokeWidth="1"
        strokeLinecap="round"
        opacity="0.75"
      />
      <rect y="50" width="64" height="3" fill="#ffffff" opacity="0.08" />
    </>
  ),

  // 赛博朋克：两柱灯牌立在楼群剪影里，湿地面留下反光（仍然是单色）
  cyberpunk: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2c2c34" />
          <stop offset="100%" stopColor="#0d0d10" />
        </linearGradient>
        <linearGradient id={`${uid}-refl`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.42" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <filter id={`${uid}-glow`} x="-70%" y="-25%" width="240%" height="160%">
          <feGaussianBlur stdDeviation="2.6" />
        </filter>
      </defs>
      <rect width="64" height="64" fill={`url(#${uid}-bg)`} />
      <g filter={`url(#${uid}-glow)`} opacity="0.9">
        <rect x="13" y="17" width="4.2" height="28" rx="1.2" fill="#f4f4f8" />
        <rect x="42" y="11" width="5.2" height="34" rx="1.4" fill="#fbfbfd" />
        <rect x="22" y="27" width="2.4" height="18" rx="1" fill="#cfcfda" />
      </g>
      <path d="M0 64 V41 H7.4 V64Z M7.4 64 V33 H18.6 V64Z M28 64 V46 H36 V64Z M46 64 V36 H64 V64Z" fill="#09090c" />
      <rect y="50" width="64" height="14" fill="#08080b" />
      <g opacity="0.5">
        <rect x="13" y="50" width="4.2" height="11" fill={`url(#${uid}-refl)`} />
        <rect x="42" y="50" width="5.2" height="12" fill={`url(#${uid}-refl)`} />
      </g>
    </>
  ),

  // 水墨写意：两笔淡墨山影、一条水线与一处留白
  ink: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-wash`} x1="0" y1="0" x2="0.3" y2="1">
          <stop offset="0%" stopColor="#2a2a30" stopOpacity="0.88" />
          <stop offset="100%" stopColor="#2a2a30" stopOpacity="0.14" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" fill="#fbfbfc" />
      <path d="M2 44 C 10 33 17 28 26 24 C 21 31 15 38 8 45 Z" fill={`url(#${uid}-wash)`} />
      <path d="M30 47 C 37 40 44 36 55 32 C 48 39 42 44 36 49 Z" fill="#3a3a42" opacity="0.7" />
      <path d="M0 52 C 16 49 34 51 64 45" fill="none" stroke="#8e8e98" strokeWidth="0.8" opacity="0.5" />
      <circle cx="48" cy="17" r="2.4" fill="#a0a0aa" />
      <path d="M6 58 C 20 56 36 57 58 52" fill="none" stroke="#c4c4cc" strokeWidth="0.7" opacity="0.65" />
    </>
  ),

  // 3D 渲染：柔和棚拍光下的一颗黏土球
  clay: (uid) => (
    <>
      <defs>
        <linearGradient id={`${uid}-bg`} x1="0" y1="0" x2="0.6" y2="1">
          <stop offset="0%" stopColor="#f8f8fa" />
          <stop offset="100%" stopColor="#dcdce2" />
        </linearGradient>
        <radialGradient id={`${uid}-ball`} cx="36%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#fdfdfe" />
          <stop offset="52%" stopColor="#cfcfd7" />
          <stop offset="100%" stopColor="#8b8b96" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill={`url(#${uid}-bg)`} />
      <ellipse cx="32" cy="51" rx="19" ry="5" fill="#26262c" opacity="0.16" />
      <circle cx="32" cy="30" r="17.5" fill={`url(#${uid}-ball)`} />
      <ellipse cx="25" cy="23" rx="5.4" ry="3.4" fill="#ffffff" opacity="0.62" transform="rotate(-24 25 23)" />
      <path d="M20 44 C 26 47 38 47 44 43" fill="none" stroke="#6f6f79" strokeWidth="0.9" opacity="0.32" />
    </>
  ),
}

/** 传 { id }：风格 id 对应 STYLE_CAPSULES 的 id。 */
export function StylePlate(props) {
  const draw = SPECIMENS[props.id]
  if (!draw) return null
  return (
    <svg className="ofs-plate" viewBox="0 0 64 64" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">
      {draw(`ofs-plate-${props.id}`)}
    </svg>
  )
}