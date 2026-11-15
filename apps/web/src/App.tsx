import { CORE_VERSION } from '@a3/core';

export default function App() {
  return (
    <main className="app">
      <p className="badge">M0 · 脚手架</p>
      <h1 className="title">葵A葵3</h1>
      <p className="subtitle">四人扑克 · 家乡玩法 · Web 版 v1</p>

      <section className="panel">
        <p className="ok">✅ 工程已跑通</p>
        <ul className="checks">
          <li>npm workspaces 已生效</li>
          <li>
            规则引擎 <code>@a3/core</code> 已联通，版本 <code>{CORE_VERSION}</code>
          </li>
          <li>React 19 + Vite 页面渲染正常</li>
        </ul>
      </section>

      <p className="hint">下一步 M1：牌型识别 / 大小比较 / 状态机 / 供牌 / 结算</p>
    </main>
  );
}
