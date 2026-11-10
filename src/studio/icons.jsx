/**
 * 工作台图标：一套 24×24、1.6px 圆角描边的单色线稿。
 */

const SHAPES = {
  // 胶片与时装：风格预设用
  film: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.8" />
      <path d="M7.5 5.5v13M16.5 5.5v13" />
      <path d="M3.6 8.6h3.9M3.6 12h3.9M3.6 15.4h3.9M16.5 8.6h3.9M16.5 12h3.9M16.5 15.4h3.9" />
    </>
  ),
  palette: (
    <>
      <path d="M12 3.6a8.4 8.4 0 0 0 0 16.8h1.1a2 2 0 0 0 1.5-3.3 2 2 0 0 1 1.5-3.3h1.5a3.8 3.8 0 0 0 3.8-3.8c0-3.6-4.2-6.4-9.4-6.4z" />
      <circle cx="8.4" cy="9.2" r="1.05" />
      <circle cx="12" cy="7.4" r="1.05" />
      <circle cx="15.6" cy="9.2" r="1.05" />
    </>
  ),
  skyline: (
    <>
      <path d="M3.5 20.2V11.4l3.8-1.9v10.7" />
      <path d="M7.3 20.2V6.6l4.6-1.9v15.5" />
      <path d="M11.9 20.2V13l3.8-1.9v9.1" />
      <path d="M15.7 20.2V9.6l4.8 2.2v8.4" />
      <path d="M2.6 20.2h18.8" />
    </>
  ),
  mountains: (
    <>
      <path d="M3.2 17.6 8.6 9.8l3.1 4.1 2.2-2.8 5.9 6.5z" />
      <path d="M3.2 20.2h17.6" />
      <path d="M6.4 12.9l1.7 1.1 1.3-1.6" />
    </>
  ),
  cube: (
    <>
      <path d="M12 3.4 19.6 7.6v8.8L12 20.6 4.4 16.4V7.6z" />
      <path d="M4.4 7.6 12 11.8l7.6-4.2M12 11.8v8.8" />
    </>
  ),

  // 提示词动作
  expandText: (
    <>
      <path d="M4 6.6h9.4M4 11h6.2M4 15.4h9.4" />
      <path d="M17.8 17.4V8.2" />
      <path d="M15.1 10.8l2.7-2.7 2.7 2.7" />
    </>
  ),
  focus: (
    <>
      <path d="M4 8.6V6.2a2.2 2.2 0 0 1 2.2-2.2h2.4M15.4 4h2.4A2.2 2.2 0 0 1 20 6.2v2.4M20 15.4v2.4a2.2 2.2 0 0 1-2.2 2.2h-2.4M8.6 20H6.2A2.2 2.2 0 0 1 4 17.8v-2.4" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M12 3.2v2.1M12 18.7v2.1M3.2 12h2.1M18.7 12h2.1M5.7 5.7l1.5 1.5M16.8 16.8l1.5 1.5M18.3 5.7l-1.5 1.5M7.2 16.8l-1.5 1.5" />
    </>
  ),

  // 通用
  star: (
    <path d="M12 4.4l2.35 4.76 5.25.77-3.8 3.7.9 5.24L12 16.39l-4.7 2.48.9-5.24-3.8-3.7 5.25-.77z" />
  ),
  starFilled: (
    <path
      d="M12 4.4l2.35 4.76 5.25.77-3.8 3.7.9 5.24L12 16.39l-4.7 2.48.9-5.24-3.8-3.7 5.25-.77z"
      fill="currentColor"
      stroke="none"
    />
  ),
  alert: (
    <>
      <path d="M12 4.6 20.2 19H3.8z" />
      <path d="M12 9.8v4.1M12 16.7v.1" />
    </>
  ),
  chevronDown: <path d="M6.4 9.6 12 15.2l5.6-5.6" />,
  arrowUp: (
    <>
      <path d="M12 19.4V4.9" />
      <path d="M5.9 11 12 4.9 18.1 11" />
    </>
  ),
  copy: (
    <>
      <rect x="8.4" y="8.4" width="11.2" height="11.2" rx="2" />
      <path d="M15.6 5.2H6.6a1.4 1.4 0 0 0-1.4 1.4v9" />
    </>
  ),
  reroll: (
    <>
      <path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2" />
      <path d="M19.8 4.6v4.8h-4.8" />
    </>
  ),
  sliders: (
    <>
      <path d="M4 8.4h8.4M17.2 8.4h2.8M4 15.6h2.8M11.6 15.6h8.4" />
      <circle cx="14.8" cy="8.4" r="1.9" />
      <circle cx="9.2" cy="15.6" r="1.9" />
    </>
  ),
  image: (
    <>
      <rect x="3.4" y="5" width="17.2" height="14" rx="2" />
      <path d="M3.4 15.3 8 11l3.4 2.9 3-2.4 5.2 4.6" />
      <circle cx="8.6" cy="9.4" r="1.25" />
    </>
  ),
  folder: (
    <path d="M3.4 7.4a2 2 0 0 1 2-2h3.5l1.8 2.2h7.9a2 2 0 0 1 2 2v7.9a2 2 0 0 1-2 2H5.4a2 2 0 0 1-2-2z" />
  ),
  close: <path d="M6.2 6.2 17.8 17.8M17.8 6.2 6.2 17.8" />,
  dot: <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />,

  // 导航与面板
  sparkles: (
    <>
      <path d="M11.4 4.2 12.9 8l3.8 1.5-3.8 1.5-1.5 3.8-1.5-3.8L6.1 9.5 9.9 8z" />
      <path d="M17.6 14.4l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
      <path d="M5.4 15.6l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5-1.5-.6 1.5-.6z" />
    </>
  ),
  message: (
    <>
      <path d="M4.4 7.2a2.8 2.8 0 0 1 2.8-2.8h9.6a2.8 2.8 0 0 1 2.8 2.8v6.2a2.8 2.8 0 0 1-2.8 2.8H9.6l-3.7 3v-3h-.7a.8.8 0 0 1-.8-.8z" />
      <path d="M8.4 9.6h7.2M8.4 12.8h4.4" />
    </>
  ),
  images: (
    <>
      <rect x="6.4" y="5.2" width="13.4" height="11.4" rx="2.2" />
      <path d="M3.6 8.6v8.6a2.2 2.2 0 0 0 2.2 2.2h9" />
      <path d="M6.4 13.4 9.8 10l2.6 2.4 2.1-1.7 3.7 3.3" />
      <circle cx="15.2" cy="8.6" r="1.1" />
    </>
  ),
  expand: (
    <>
      <path d="M4.4 9V5.6a1.2 1.2 0 0 1 1.2-1.2H9M15 4.4h3.4a1.2 1.2 0 0 1 1.2 1.2V9M19.6 15v3.4a1.2 1.2 0 0 1-1.2 1.2H15M9 19.6H5.6a1.2 1.2 0 0 1-1.2-1.2V15" />
    </>
  ),
  dots: (
    <>
      <circle cx="6.2" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="17.8" cy="12" r="1.4" fill="currentColor" stroke="none" />
    </>
  ),
  plus: <path d="M12 5.4v13.2M5.4 12h13.2" />,
  search: (
    <>
      <circle cx="10.9" cy="10.9" r="6.1" />
      <path d="M15.4 15.4 20 20" />
    </>
  ),
  refresh: (
    <>
      <path d="M19.4 12a7.4 7.4 0 1 1-2.2-5.2" />
      <path d="M19.8 4.6v4.8h-4.8" />
    </>
  ),
  check: <path d="M5.4 12.6 9.6 16.8 18.6 7.8" />,
  chevronRight: <path d="M9.6 6.4 15.2 12l-5.6 5.6" />,
  cloud: (
    <path d="M7.4 18.2a3.8 3.8 0 0 1-.5-7.6 5.2 5.2 0 0 1 10-1.2 4.3 4.3 0 0 1 .9 8.4" />
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="7.8" />
      <path d="M12 7.6V12l3 1.8" />
    </>
  ),
}

export function Icon(props) {
  const name = props.name
  const size = props.size || 16
  const shape = SHAPES[name] || null
  if (!shape) return null
  return (
    <svg
      className={props.className ? `ofs-icon ${props.className}` : 'ofs-icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {shape}
    </svg>
  )
}