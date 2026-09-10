# LiteConnect

LiteConnect 是一个基于 Electron、Vue 3 和 TypeScript 的多协议连接管理客户端。集成 SSH 终端、SFTP、服务器监控、Docker 管理、MySQL / PostgreSQL / Oracle 数据库工具、带 SSH 工具调用的 AI 助手，以及可选的本机 MCP 服务，适合日常运维与开发联调。

当前版本：**1.0.12**

- [AI 助手](#ai-助手)：围绕当前 SSH 主机提问、调用工具、审批操作并保存对话。
- [MCP 接入](#mcp让外部-ai-客户端使用-ssh-工具)：把 SSH 工具提供给本机外部 AI 客户端。

## 功能

### SSH 连接

- 保存、分组、排序、置顶和测试 SSH 连接
- 按最近使用 / 常用频次整理连接列表（记录使用统计）
- 支持密码、私钥和系统 SSH Agent 认证；可管理常用登录账号
- 支持连接配置的导入与导出
- 支持跳板机、本地端口转发和 X11 转发（Windows 可自动检测 / 安装附带的 VcXsrv）
- 使用本地 `known_hosts` 记录主机密钥：首次连接展示大字 SHA256 指纹供确认；密钥变化时对比新旧指纹，可拒绝或在确认后信任新密钥
- 提供 TCP、SSH Ready、Shell 打开及首字节耗时诊断
- 支持意外断线后的有限次数自动重连
- 支持在独立窗口中打开 SSH 会话

### 终端

- 使用 `ssh2` 建立交互式 Shell，使用 xterm.js 渲染
- 支持多连接、多子会话和水平/垂直分屏
- 支持终端搜索、复制、粘贴确认、字体调整和远端尺寸同步
- 显示会话 RTT 延迟
- 支持批量命令广播
- 支持命令片段的分组、搜索、排序、导入导出和变量替换
- 按连接记录 Shell 命令历史，并提供命令补全建议
- 可将选中文本或终端上下文发送到 AI（解释 / 建议等）

### SFTP

- 目录树懒加载、路径导航和手动刷新
- 支持文件及目录上传、下载和传输进度
- 支持覆盖、跳过和重命名冲突策略
- 支持失败或取消后的断点续传
- 支持新建目录、重命名、删除、远端文本编辑、`chmod` 和 `chown`
- 支持调用远端工具解压常见压缩格式
- SFTP 状态按 SSH 会话分别保存

### Docker

- 经现有 SSH 会话访问远端 `/var/run/docker.sock`，不开放远端 TCP API
- 优先使用 OpenSSH StreamLocal；不支持时可回退到固定的 `nc -U` 通道
- 检测 Docker Engine 和 API 版本
- 查看并筛选全部、运行中和已停止容器
- 查看容器基本信息、网络、端口、挂载和原始 Inspect JSON
- 启动、停止和重启容器
- 查看容器日志，支持 tail、follow、搜索、暂停自动滚动和复制
- 支持容器交互式终端（`docker exec`，bash / sh，含尺寸同步与粘贴确认）
- SSH 断开或应用退出时关闭 Docker 代理、日志流、exec 流和远端通道

当前 Docker 模块不包含删除容器、镜像管理、Volume 管理或 Compose。

### 数据库

- 支持 MySQL、PostgreSQL 和 Oracle
- 支持直连及经独立 SSH 隧道连接
- 可粘贴 `mysql://`、`postgresql://`、JDBC 或 Oracle Easy Connect / 描述符，解析后填入连接表单
- 保存连接配置并测试连通性
- 支持多个数据库会话同时打开
- 浏览数据库、Schema、表和视图（Oracle 导航树中的「库」对应 Schema/Owner）
- SQL 编辑器提供语法高亮、表/列补全、选中执行和查询取消
- 查询标签草稿、查询历史和收藏的 SQL 脚本保存在本地
- 查询结果支持排序、筛选、复制和导出；表数据支持分页、服务端排序与全表流式导出（可取消）
- 满足主键条件时支持编辑、插入和删除
- 提供表结构和建表语句查看
- 支持显式事务状态和提交/回滚操作
- 可配置危险 SQL 二次确认与只读模式

#### Oracle 说明

| 项 | 说明 |
|---|---|
| 驱动 | [node-oracledb](https://node-oracledb.readthedocs.io/)（`oracledb`） |
| 默认模式 | **Thin**（无需安装 Oracle Instant Client） |
| 默认端口 | `1521` |
| 连接字段 `database` | **Service Name**（Easy Connect：`host:port/service`）；也可粘贴完整 connectString / 连接描述符 |
| 导航「库」 | Schema（owner），不是 PDB 列表 |
| 分页 | Oracle 12c+ `OFFSET … FETCH NEXT …` |
| 建库 | 无 MySQL 式 CREATE DATABASE；UI 提供 `CREATE USER` 示例，需 DBA 权限在服务端执行 |
| Thick / Wallet | 可选后续增强；当前优先 Thin |

**集成验收建议**

- [ ] 12c+ / 19c / 21c 直连，Service Name 与完整 connectString
- [ ] SSH 隧道到内网 Oracle（主机填 SSH 侧可达地址）
- [ ] `SELECT 1 FROM DUAL`、表树展开、分页、查询取消、事务提交/回滚、表导出取消
- [ ] 错误信息无明文密码 / connect string 泄露

### 服务器监控

- 底栏随窗口宽度自适应展示核心指标；可展开详情
- CPU 总体及每核使用情况
- 内存、缓存和 Swap
- 磁盘分区使用情况
- Top 进程
- 主机名、内核、架构和运行时长

监控数据通过 SSH 执行系统命令采集，具体可用字段取决于远端操作系统和命令环境。

### AI 助手

在 SSH 侧栏中直接提问，让 AI 结合当前服务器的实际输出分析问题。例如「找出磁盘占用最多的目录」「定位这份日志中的错误」「解释当前配置，并给出修改建议」。AI 可以查询、调用工具和申请执行操作，工具过程与结果会显示在对话时间线中。

#### 开始使用

1. 连接一台 SSH 主机，打开 AI 侧栏。
2. 在 AI 设置中添加兼容 Chat Completions 的提供商，填写 Base URL、API Key 和模型。需要操作服务器时，所选模型须支持工具调用。
3. 选择权限模式，默认是只读自动执行、修改和提权需审批。
4. 输入问题，或把终端选区发送给 AI。需要审批时，查看操作说明和参数，再选择「允许」或「拒绝」。

AI 侧栏直接使用应用内工具运行时，**不需要开启 MCP HTTP 服务**。对话内容和用于分析的工具结果会发送到你配置的模型提供商。

#### 对话与工具能力

- 支持多个模型提供商，以及系统提示词、上下文窗口和温度配置。
- 支持流式回答、推理过程、工具调用时间线和 token 用量；长对话可通过提问时间线定位。
- 按 SSH 会话隔离对话，同一主机可以创建多条对话线程；支持编辑消息、删除、重试与重新生成。
- 通过 `exec` 查询系统状态、运行命令；长任务可后台执行，再查询任务状态或取消。
- 通过 `glob` 找文件、`grep` 定位内容、`read_file` 分段读取日志和配置；也支持文件写入、目录查询、上传下载和服务操作。
- 交互式操作可使用独立 Agent PTY；支持读取已启动的监控快照。
- 回复中的代码块可复制、填入终端或按界面流程发送执行。

侧栏工具绑定当前 SSH 会话，不提供切换、连接其他主机或分组广播的入口。`exec` 使用独立通道，Agent PTY 也独立于用户终端；工具调用不会把命令直接写进你正在操作的 Shell。跨主机管理和广播属于下文的外部 MCP 能力。

#### 权限申请与用户审批

每次侧栏工具调用都必须在 JSON 参数中携带 `risk` 和 `explanation`。例如，申请重启服务：

```json
{
  "command": "systemctl restart nginx",
  "risk": "write",
  "explanation": "重启 nginx 以应用配置，可能短暂影响网站连接。"
}
```

`risk` 只能是 `read`（只读）、`write`（修改）或 `privileged`（提权）。模型需用中文解释操作目的、涉及的资源和预期影响；`explanation` 必须是 1–500 字符的非空说明。缺少或无效的字段会导致本次不执行，要求模型补全申请。这两个字段用于应用审批，不会传给远端命令。

| AI 权限模式 | 按模型申报的级别处理 |
|---|---|
| 只读自动，修改需确认（默认） | `read` 自动执行；`write`、`privileged` 暂停并等待用户允许 |
| 只允许只读 | 仅执行申报为 `read` 的调用，拒绝修改和提权申请 |
| 自动执行 | 合法申报的三种级别均可执行，不再弹出工具审批 |

应用校验申请格式并执行上述策略，**不再根据命令关键词重新判定侧栏调用的风险等级**。因此「只允许只读」依赖模型如实申报，并非操作系统级只读沙箱；「自动执行」也没有额外的高危命令确认。远端操作仍受 SSH 登录账号的实际权限约束。

审批绑定具体请求和 SSH 会话，切换到其他主机不会批准另一条请求；重新打开侧栏后仍可处理正在等待的审批。拒绝、等待超时（5 分钟）或取消请求后，未获批准的调用不会执行，待审批状态会结束。

#### 流式显示与历史保存

- 正在输出的正文和推理段以纯文本显示，结束后再渲染 Markdown、代码块和链接。
- 工具卡片默认折叠，点击展开后才格式化并显示参数和结果；超长内容限制展示长度，避免大量输出拖慢页面。
- 模型请求、工具执行和助手消息保存由主进程负责，前端负责显示。流式输出会定期保存检查点，工具执行前后也会保存，持续输出不会一直推迟中途保存。
- 展开或折叠卡片不影响历史保存。历史包含助手输出、工具参数、结果和状态；工具结果本身仍受采集及存储长度限制，不能把历史当作无限量的原始日志归档。
- 取消或异常结束时会保存已有内容，并结束残留的待审批状态。进程意外退出时，只能恢复最后成功写入的检查点。

### MCP：让外部 AI 客户端使用 SSH 工具

LiteConnect 提供可选的本机 MCP 服务，将 SSH 工具开放给支持 Streamable HTTP 的外部 AI 客户端。客户端可以发现已保存连接、连接服务器、执行命令、检索文件和管理后台任务。**默认关闭，LiteConnect 必须保持运行。**

#### 接入步骤

1. 打开「设置 → MCP」，启用服务并完成界面确认。
2. 在设置页复制服务地址和 Bearer Token，或复制通用 JSON / 接入说明。
3. 在同一台电脑上的 MCP 客户端中添加 HTTP 服务，配置地址和鉴权请求头。
4. 让客户端先调用 `list_connections` / `list_sessions`，再使用相应 ID 操作目标主机。

| 项 | 说明 |
|---|---|
| 传输 | Streamable HTTP，JSON-RPC 请求发送至 `POST /mcp` |
| 默认地址 | `http://127.0.0.1:17420/mcp`；端口可设为 1024–65535 |
| 鉴权 | `Authorization: Bearer <token>` |
| 健康检查 | `GET /health` |
| 监听范围 | 仅本机 loopback，校验 `Host` / `Origin`，带请求频率限制 |
| Token | 保存在应用设置中，可用时使用系统 `safeStorage` 加密；更换后旧 Token 失效 |

设置页提供的通用配置如下。不同客户端的外层配置格式可能不同，请将地址和请求头填入对应字段：

```json
{
  "name": "liteconnect-ssh",
  "transport": "http",
  "url": "http://127.0.0.1:17420/mcp",
  "headers": {
    "Authorization": "Bearer <token>"
  }
}
```

#### 工具一览

| 类别 | 工具与用途 |
|---|---|
| 主机与会话 | `list_connections`、`list_groups`、`list_sessions`、`connect`、`save_connection`、`disconnect` |
| 命令与任务 | `exec`、`list_jobs`、`get_job`、`cancel_job`；支持后台任务，以及按 `sessionIds` / `group` 广播 |
| 文件定位 | `glob` 查找路径、`grep` 检索内容 |
| 文件与传输 | `read_file`、`write_file`、`list_dir`、`stat_path`、`tail_file`、`upload_file`、`download_file` |
| 服务与监控 | `service_control`、`get_metrics` |
| Agent PTY | `pty_open`、`pty_write`、`pty_read`、`pty_resize`、`pty_close`、`pty_list` |

读取大日志时，先定位文件和行号，再分段读取；长时间运行的命令使用 `exec(background=true)`，通过 `get_job` 获取进度。需要安装向导、菜单或方向键交互时使用 Agent PTY（每个 SSH 会话最多 2 个）。

#### 与侧栏 AI 的区别

| 项目 | 内置 AI 侧栏 | 外部 MCP 客户端 |
|---|---|---|
| 模型配置 | 在 LiteConnect 中配置提供商和模型 | 由外部客户端管理 |
| 是否需要开启 MCP 服务 | 不需要 | 需要 |
| 主机范围 | 绑定当前 SSH 会话 | 可发现、连接多个主机，并广播命令 |
| 权限策略 | 模型提交 JSON 申请，按 AI 设置自动执行或等待用户审批 | 使用运行时默认 `deny-destructive` 命令策略 |
| 审批入口 | LiteConnect 对话中的允许 / 拒绝按钮 | 不会转入侧栏审批；被策略拒绝时向客户端返回错误 |

两种入口共用工具运行时，但侧栏会裁剪工具和路由参数，并增加权限申请字段。**修改侧栏 AI 的权限模式，不会放开外部 MCP 的默认策略。** MCP 命令策略会拒绝被分类为破坏性、提权或高危的命令；这不等同于整个 MCP 服务只读，文件写入、传输、连接管理等工具也在开放范围内。

MCP 操作现有 SSH 管理器中的会话，不提供 Docker socket 或数据库隧道的专用工具。执行通道与用户终端独立。

#### 使用边界

- 仅把 Token 配置给可信的本机客户端；持有 Token 的程序可以访问已保存连接，并调用开放的工具。
- 不要把 Token 提交到仓库、公开分享或配置给远程 Agent。停用 MCP 不影响内置 AI 侧栏。
- 单次 `exec` 命令最长 5000 字符；`read_file` 默认 200 行 / 50 KiB，支持 `startLine` 分页；单次写文件最多 256 KiB，本机上传下载最多 64 MiB。

### 工作区与交互

- 全局跳转面板：快速定位连接或打开设置
- 快捷键一览覆盖层（`Ctrl+/`）
- 首次使用与功能引导提示
- 支持多窗口：连接可在独立窗口中打开

### 设置

- 主题和自定义颜色
- 终端字体、字号及配色
- 默认下载目录
- 延迟和监控刷新间隔
- SSH 自动重连开关及最大次数
- X11 显示服务路径与自动启动（Windows：VcXsrv / Xming）
- 数据库查询标签默认行为、查询限制与危险 SQL 确认
- MCP 服务开关、端口和 Bearer Token
- 快捷键、粘贴确认和其他交互选项
- 安装包可通过 GitHub Releases 检查更新（electron-updater）

## 技术组成

| 部分 | 使用的库或技术 |
|---|---|
| 桌面运行时 | Electron 41 |
| 渲染层 | Vue 3、Vue I18n、Element Plus |
| 语言 | TypeScript |
| 构建与测试 | Vite、Vitest、vue-tsc、electron-builder |
| 自动更新 | electron-updater |
| SSH/SFTP | ssh2 |
| 终端 | xterm.js |
| SQL 编辑器 | CodeMirror 6 |
| MySQL | mysql2 |
| PostgreSQL | pg |
| Oracle | oracledb（Thin 优先） |

## 代码结构

```text
LiteConnect/
├── electron/                    # Electron 主进程
│   ├── db/                      # 数据库会话、驱动、SSH 隧道、查询与导出
│   │   └── drivers/             # MySQL / PostgreSQL / Oracle 驱动
│   ├── docker/                  # Docker API 传输、容器操作、日志与 exec
│   ├── ai/                      # Chat Completions 流式请求、工具循环、会话历史
│   ├── mcp/                     # SSH MCP runtime、HTTP 网关、工具实现
│   ├── ipc/                     # renderer/main IPC 注册与输入校验
│   ├── ssh/                     # SSH、SFTP、转发、监控和传输任务
│   ├── store/                   # 连接、凭据、设置、查询历史与命令历史
│   ├── utils/                   # 主进程通用工具
│   ├── window/                  # BrowserWindow 创建、多窗口注册
│   ├── main.ts                  # 主进程入口和退出清理
│   └── preload.ts               # 暴露给 renderer 的受控 API
├── shared/                      # main 与 renderer 共用的纯逻辑
├── src/                         # Vue renderer
│   ├── components/              # 按域划分的 UI 组件
│   │   ├── ai/                  # AI 侧栏与设置
│   │   ├── connections/         # 连接列表、表单与凭据
│   │   ├── database/            # 数据库工作区
│   │   ├── docker/              # Docker 工作区（含容器终端）
│   │   ├── sftp/                # SFTP 侧栏与传输
│   │   ├── settings/            # 设置子页
│   │   ├── terminal/            # 终端标签与分屏
│   │   └── icons/               # 应用图标组件
│   ├── composables/             # 会话和 UI 状态逻辑（按域分子目录）
│   ├── i18n/                    # renderer 国际化配置与文案
│   ├── styles/                  # 全局样式
│   ├── utils/                   # renderer 纯工具和策略
│   ├── views/                   # 连接、数据库和设置页面
│   ├── App.vue
│   └── main.ts                  # renderer 入口
├── scripts/                     # 仓库维护脚本
├── build/                       # electron-builder 资源与第三方安装器
├── public/                      # renderer 静态资源
├── electron-builder.yml
├── vite.config.ts
├── vitest.config.ts
└── package.json
```

### 主进程与渲染进程

- `electron/main.ts` 创建各 service/manager 并注册 IPC。
- `electron/preload.ts` 通过 context bridge 暴露有限的调用接口。
- `electron/ipc/` 负责 IPC 参数校验和调用主进程服务。
- `electron/window/` 管理主窗口与独立会话窗口。
- `src/components/` 和 `src/composables/` 负责界面及 renderer 状态。
- SSH、数据库和 Docker 的 socket、stream、日志、exec 及连接资源由主进程持有。
- 应用内 AI 与外部 MCP 客户端共用 `electron/mcp` 工具运行时；HTTP 网关仅绑定 loopback。

## 本地数据

应用数据保存在 Electron `userData` 目录。Windows 默认位于 `%APPDATA%\lite-connect\`（由 `package.json` 的 `name` 决定，不是界面上的产品名）。

从旧版安装升级时，NSIS 安装包会在目标目录尚无 `connections.json` / `db-connections.json` / `groups.json` 的情况下，将 `%APPDATA%\lite-ssh` 复制到 `%APPDATA%\lite-connect`（不覆盖已有连接数据；便携/绿色版不走此逻辑）。

| 文件或目录 | 内容 |
|---|---|
| `connections.json` / `groups.json` | SSH 连接和分组（含置顶、排序与使用统计） |
| `saved-credentials.json` | 可复用凭据 |
| `settings.json` | 应用设置（含 MCP 开关、端口与加密后的 Bearer Token） |
| `known_hosts.json` | SSH 主机密钥 |
| `db-connections.json` | 数据库连接配置 |
| `db-query-history.json` | 数据库查询历史 |
| `shell-command-history.json` | 按连接记录的 Shell 命令历史 |
| `ai-history/` | AI 对话历史 |

连接密码、私钥和数据库密码通过 Electron `safeStorage` 加密后保存；是否可用由当前操作系统环境决定。

## 开发

建议使用 Node.js 18 或更高版本及 npm 9 或更高版本。

安装依赖：

```bash
npm install
```

启动开发环境：

```bash
npm run dev
```

类型检查和测试：

```bash
npm run typecheck
npm test
```

构建应用：

```bash
npm run build
```

生成桌面安装包：

```bash
npm run electron:build
```

安装包输出目录为 `release/`（见 `electron-builder.yml`）。本机 `npm run electron:build` 只打当前操作系统的包。

## 发版

公开仓库用 GitHub Actions 标准 runner 打包（Windows / macOS / Linux 均免费）。推送与 `package.json` 一致的版本 tag：

```bash
# 先把 package.json 的 version 改成新版本并提交
git tag v1.0.12
git push origin v1.0.12
```

工作流见 `.github/workflows/release.yml`，三个任务并行：

| 平台 | 产物 |
|---|---|
| Windows x64 | NSIS `LiteConnect Setup *.exe`、`latest.yml` |
| macOS (Actions 为 Apple Silicon) | `.dmg`、`.zip`、`latest-mac.yml` |
| Linux x64 | `.AppImage`、`.deb`、`latest-linux.yml` |

未做代码签名：Windows 可能被 SmartScreen 拦截；macOS 需右键「打开」，或执行 `xattr -cr /Applications/LiteConnect.app`。VcXsrv 只打进 Windows 包。

也可在 Actions 里手动跑 **Release**（不打 tag）：只上传构建产物，不创建 GitHub Release。

## npm scripts

| 命令 | 作用 |
|---|---|
| `npm run dev` | 启动 Vite 和 Electron 开发环境 |
| `npm run typecheck` | 运行 Vue/TypeScript 类型检查 |
| `npm test` | 运行 Vitest 测试 |
| `npm run test:watch` | 以 watch 模式运行测试 |
| `npm run build` | 类型检查并构建 renderer 和 Electron 代码 |
| `npm run preview` | 预览 renderer 构建结果 |
| `npm run electron:build` | 构建并使用 electron-builder 打包 |

## 许可

MIT License
