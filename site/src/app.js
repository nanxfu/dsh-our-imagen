/**
 * 展示页入口。源码在 site/src/js/，构建时由 esbuild 打包成 dist/app.js。
 * GSAP / ScrollTrigger / Flip 随包内联，页面运行时仍然零外部请求。
 */
import { boot } from './js/main.js';

boot();
