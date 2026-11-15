/**
 * 剧场式场景底板（Scene）
 * ---------------------------------------------------------------------------
 * 纯 CSS 绘制的「海边露台 + 暖棕木桌面 + 木质地面」，放在整个界面最底层
 * （App 负责 position:absolute / inset:0 / z-index:0，并且座位、手牌、按钮都叠在
 * 它上面）。组件本身不含任何文字、按钮、事件与状态：整棵树 aria-hidden，
 * 对读屏器和键盘来说完全不存在，也不会拦住任何点击（scene.css 里 pointer-events:none）。
 *
 * DOM 层级与画面对应（顺序即 App 接线时的顺序，勿改）：
 *   .scene
 *     ├─ .scene__sky          天空（0 ~ 22%）
 *     ├─ .scene__sea          海面（容器 12% ~ 34.5%，可见水线 20%~34.5%）
 *     ├─ .scene__horizon      海平线（20% ~ 22.4%）
 *     ├─ .scene__railing      露台栏杆（28% ~ 40.5%）
 *     ├─ .scene__table        暖棕木椭圆桌面（top 10%，96vw × 64dvh）
 *     ├─ .scene__table-center 桌面中央的淡回纹 + 水波纹
 *     └─ .scene__ground       木质地面（66% ~ 100%，z 比桌面高 → 截断桌沿）
 *
 * 所有图形都来自 CSS 渐变、伪元素与一条 <1KB 的内联 SVG data-uri；
 * 没有外链图片、没有第三方动画库、没有大面积 filter:blur（手机性能）。
 */

import type { ReactElement } from 'react';

import '../styles/scene.css';

/** 场景底板：无 props、无状态，任何时候渲染出来都一样 */
export function Scene(): ReactElement {
  return (
    <div className="scene" aria-hidden="true">
      <div className="scene__sky" />
      <div className="scene__sea" />
      <div className="scene__horizon" />
      <div className="scene__railing" />
      <div className="scene__table" />
      <div className="scene__table-center" />
      <div className="scene__ground" />
    </div>
  );
}
