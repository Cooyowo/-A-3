# 提交历史 · 里程碑记录

> 每完成一个可验证节点就记一条，最新在最上面。
> 详细改动看 `git log`，这里只记「做了什么 + 怎么验证的」，方便回看每个里程碑当时的验收证据。

---

## M0 脚手架 —— 2026-11-15

**提交**：`769e4f2` chore: M0 脚手架完成（npm workspaces + @a3/core + @a3/web）

**做了什么**

- 根工程：`npm workspaces`（`packages/*` + `apps/*`），统一 `vitest` 跑各 workspace 的测试。
- `.gitignore`：`node_modules/`、`dist/`、`.npm-cache/`、`data/`、`*.log` 等。
- `@a3/core`：空包 + 牌面编码 `cards.ts`（点数/花色/牌 id，完全对齐《开发文档》2.1）+ 4 条冒烟用例。
- `@a3/web`：React 19 + Vite 8 + TS 空页面，页面里直接引用 `@a3/core` 验证 workspace 内 TS 源码可被前端消费。
- 统一 `tsconfig.base.json`（strict、`noUncheckedIndexedAccess`、`verbatimModuleSyntax`）。

**怎么验证（本机实测）**

| 验收项 | 命令 | 结果 |
|---|---|---|
| 安装 | `npm.cmd install --cache .npm-cache` | exit 0，0 vulnerabilities |
| 测试 | `npm.cmd test` | 1 个测试文件 / 4 条用例全绿 |
| 类型 | `npm.cmd run typecheck` | 两个 workspace 均通过 |
| 开发服务器 | `npm.cmd run dev --workspace @a3/web` | `http://localhost:5173/` 返回 200，标题「葵A葵3 · 四人扑克」 |
| 生产构建 | `npm.cmd run build --workspace @a3/web` | 成功，18 modules，dist 有 index.html + css + js |
| 干净安装 | `npm.cmd ci --cache .npm-cache` | 成功（46 packages），确认 lockfile 可复现（M4 Docker 会用到） |

**本机环境坑（已解决/已规避）**

1. 工作区 Windows 文件权限缺「完全控制」→ 已用权限诊断脚本修复（有备份与回滚脚本）。
2. `git` 的 schannel TLS 后端报 `SEC_E_NO_CREDENTIALS` → 仓库内固定 `http.sslBackend=openssl`。
3. vitest 默认 `forks` 池 fork 子进程报 `spawn EPERM` → `vitest.config.ts` 固定 `pool: 'threads'`。
4. npm 默认缓存在工作区外不可写 → 所有 npm 命令统一带 `--cache .npm-cache`。
5. `git push` 走 Git Credential Manager，受限模式下无法创建命名管道 → 推送时需要临时放宽权限（用户会看到授权弹窗）。
6. `npm ls` 会报 workspace 链接 `invalid`/`extraneous`（npm 11 的展示噪音），`npm ci` / `test` / `build` 均正常，暂不处理。

**下一步**：M1 规则引擎（牌型识别 / 比较 / 合法动作 / 状态机 / 供牌 / 结算 / 明牌 / 提前锁定）。
