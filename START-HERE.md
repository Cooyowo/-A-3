# 葵A葵3 v1 · 新会话入口（START-HERE）

> **用法**：在新对话里只发这一句，让 AI 自己来读本文件：
>
> ```
> 请先完整阅读本目录的 START-HERE.md，然后按里面的要求开始工作。
> ```

---

## 一、这是什么

**葵A葵3**：四人扑克（家乡玩法）的 Web 版 v1。

- 全新项目，从零开始，**不继承旧项目代码**；
- 目标：本地能完整玩一局 → 部署到阿里云 ECS 给朋友玩；
- 旧项目 `D:\Project2026\A3` 是上一版实现（旧规则），**只读参考，禁止修改**。

---

## 二、规则唯一事实来源

按顺序读：

| 文件 | 作用 |
|---|---|
| `docs/玩法说明.md` | **规则的唯一事实来源**：牌型、比较、流程、胜负、供牌、明牌、提前锁定 |
| `docs/开发文档.md` | 技术实现规范：数据模型、牌型识别、比较算法、状态机、供牌流程、测试用例 |

- 两份文档冲突时，**以《玩法说明.md》为准**；
- 文档没写到的边角情况：按最合理的默认值实现，记入 `docs/open-questions.md`（状态 `DEFAULT`），**并在本轮汇报里明确告诉用户**；
- **不得自行修改规则**；用户口头规则与文档冲突时，以用户最新说法为准，并同步改文档 + 代码 + 测试。

---

## 三、用户背景（重要）

- 用户是产品负责人，**没有前端基础**；
- 所有操作必须给「复制即用」的说明：在哪个目录、完整命令、访问哪个地址、预期看到什么、怎么停止；
- 全程中文，简洁，**先说结论**；
- 需要用户做选择时：给 1–3 个选项 + 推荐项 + 各自代价，不要只抛问题。

---

## 四、技术栈（已定，不许更换）

| 层 | 选型 |
|---|---|
| 语言 | TypeScript（全栈） |
| 工程 | npm workspaces（`packages/*` + `apps/*`） |
| 规则引擎 | `@a3/core`：纯函数、零依赖、零 IO |
| 前端 | React 19 + Vite + Zustand + CSS |
| 测试 | Vitest（黄金用例 + 自对弈不变量） |
| 在线（M3） | Node + Fastify + `ws` + zod，服务端权威 |
| 部署（M4） | Docker Compose + Caddy（自动 HTTPS） |

Windows 环境固定写法：

- npm 命令一律 **`npm.cmd`**（本机 PowerShell 是 Restricted，`npm.ps1` 跑不了）；
- 安装依赖加 **`--cache .npm-cache`**，缓存只放在项目内；
- 中文文件**必须用编辑工具写**，不能用 PowerShell 的 `Set-Content`（会乱码）。

---

## 五、目标目录结构

```
项目根（D:\Project2026\a3-v1）\
├─ START-HERE.md            # 本文件
├─ docs\
│  ├─ 玩法说明.md            # 规则唯一事实来源（已存在）
│  ├─ 开发文档.md            # 技术规范（已存在）
│  └─ open-questions.md     # 待确认问题（开工后建）
├─ packages\
│  └─ core\                 # 规则引擎（纯函数）
│     ├─ src\  cards / patterns / compare / legality / teams / settle / state / index
│     └─ tests\
├─ apps\
│  ├─ web\                  # React 客户端（M2 热座，M3 与在线共用）
│  └─ server\               # Fastify + ws（M3 才创建）
├─ tools\selfplay\          # 自对弈 CLI
├─ deploy\                  # Dockerfile / compose.yaml / Caddyfile / DEPLOY.md（M4）
├─ package.json
└─ .gitignore
```

---

## 六、里程碑与验收（按顺序做，一次只做一个）

| 里程碑 | 做什么 | 验收标准（必须能复现） |
|---|---|---|
| **M0 脚手架** | npm workspaces、core 空包 + 1 个冒烟用例、web 空页面能启动、`.gitignore`、`git init` | `npm.cmd install --cache .npm-cache` 成功；`npm.cmd test` 绿；`npm.cmd run dev --workspace @a3/web` 后浏览器打开 `http://localhost:5173` 有页面 |
| **M1 规则引擎** | 牌 / 牌型识别 / 比较 / 合法动作 / 状态机（发牌、三条阶段、顺风、结算、供牌、明牌、提前锁定） | 每条规则至少 1 正例 + 1 反例；`npm.cmd test` 全绿；自对弈 1000 局无死锁、牌数守恒 |
| **M2 本地热座** | 一个页面摆四家牌，能完整打完一局（发牌→明牌→供牌/回牌→锁定窗口→出牌→结算→下一局） | 浏览器里能手动打完一整局，结算数字正确；手机竖屏基本可用 |
| **M3 在线对战** | 房间创建/加入、邀请码、4 人各自设备、服务端权威裁判、断线 30s 内重连 | 4 个浏览器窗口（或手机）能打完一局；抓包/看前端内存都看不到别家手牌 |
| **M4 部署上线** | Docker 多阶段构建、compose（app + caddy）、`deploy/DEPLOY.md` | 按 DEPLOY.md 在阿里云 ECS 上一次成功；`https://域名` 能打开并打完一局 |

每个里程碑完成后：跑 `npm.cmd test` + `npm.cmd run typecheck`，提交 git，更新 `docs/git-history.md`（没有就建一个）。

---

## 七、部署目标（M4 用）

- 服务器：阿里云 ECS，Ubuntu，**域名已 ICP 备案**（80/443 可直接用）；
- 方式：Docker Compose 起两个容器：`caddy`（HTTPS + 静态文件）+ `app`（Node 服务）；
- **不上传 `node_modules`、不本地打包整包上传**：源码进 git，服务器上 `docker compose up -d --build` 构建；
- 数据/日志放 volume，不进镜像；
- 产出 `deploy/DEPLOY.md`：从「空服务器」到「域名可访问」的完整步骤，命令可直接复制。

---

## 八、工作纪律

- 小步提交，中文 commit 信息：改了什么 + 为什么；
- 每完成一个可验证节点就提交一次；
- 汇报固定四段：**做了什么 / 怎么验证（命令+输出）/ 下一步 / 需要用户决定什么**；
- 不许自己加需求、不许换技术栈、不许动工作区外的文件；
- 出问题先自己定位，同一问题试 3 次仍不行再问用户，并说明试过什么。

---

## 九、环境坑速查

| 现象 | 原因 | 处理 |
|---|---|---|
| `无法加载文件 npm.ps1` | PowerShell 执行策略 | 用 `npm.cmd` |
| vitest 报 `spawn EPERM` | 沙箱禁止 spawn | 放宽沙箱权限（用户会看到授权弹窗） |
| 中文文件乱码 | 用 PowerShell 写了 UTF-8 | 用编辑工具重写该文件 |
| 端口被占用 | 5173 / 3000 已被旧项目占用 | 换端口或先关掉旧进程 |

---

## 十、开工第一步（AI 照做）

1. 读 `docs/玩法说明.md` 和 `docs/开发文档.md`；
2. `git init`（若尚未初始化），建 `.gitignore`（`node_modules/`、`dist/`、`.npm-cache/`、`data/`、`*.log`）；
3. 用一两句话说明本轮要做什么、验收标准是什么；
4. 从 **M0** 开始，不要跳步。
