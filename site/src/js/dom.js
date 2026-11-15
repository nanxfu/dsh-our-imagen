/**
 * 站点脚本用不到框架，但渲染列表的地方不少。
 * 这里只保留三个最小的 DOM 工具：查询、元素工厂、rAF 节流。
 */

export const $ = (selector, scope = document) => scope.querySelector(selector);

export const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));

/**
 * 元素工厂：createElement + 属性 + 结构化子节点。
 *
 * options: { class, text, attrs, props, dataset, style, on }
 * - attrs 写 HTML 属性（role、aria-*、data-*）；
 * - props 写 DOM 属性（src、type、loading 等）；
 * - on 的键是事件名（click、pointerenter…）。
 */
export function h(tag, options = {}, ...children) {
  const node = document.createElement(tag);

  if (options.class) node.className = options.class;
  if (options.text != null) node.textContent = String(options.text);
  if (options.dataset) Object.assign(node.dataset, options.dataset);
  if (options.style) Object.assign(node.style, options.style);
  if (options.props) Object.assign(node, options.props);
  if (options.attrs) {
    for (const [name, value] of Object.entries(options.attrs)) {
      if (value == null || value === false) continue;
      node.setAttribute(name, value === true ? '' : String(value));
    }
  }
  if (options.on) {
    for (const [type, handler] of Object.entries(options.on)) {
      node.addEventListener(type, handler);
    }
  }

  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  return node;
}

/** 下一帧执行一次，同一帧内的重复调用合并。 */
export function rafThrottle(fn) {
  let frame = 0;
  let latestArgs;
  return (...args) => {
    latestArgs = args;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      fn(...latestArgs);
    });
  };
}
