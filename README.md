# LiteConnect

LiteConnect 是一个基于 Electron、Vue 3 和 TypeScript 的多协议连接管理客户端。集成 SSH 终端、SFTP、服务器监控、Docker 管理、MySQL / PostgreSQL / Oracle 数据库工具与 AI 对话面板，适合日常运维与开发联调。

当前版本：**1.0.5**

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

### AI 面板

- 调用 OpenAI-compatible Chat Completions 接口
- 配置 Base URL、模型、API Key、系统提示词和温度
- 支持流式文本、Markdown、思考内容和 token 用量展示
- 同一 SSH 会话内支持多线程对话；消息可重新生成、编辑和删除
- 可将终端选中文本或上下文发送到当前会话对应的 AI 对话（解释 / 建议等）
- 对话按 SSH 会话隔离，并以 JSONL 保存到本地

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

## 本地数据

应用数据保存在 Electron `userData` 目录。Windows 默认位于 `%APPDATA%\lite-connect\`（由 `package.json` 的 `name` 决定，不是界面上的产品名）。

从旧版安装升级时，NSIS 安装包会在目标目录尚无 `connections.json` / `db-connections.json` / `groups.json` 的情况下，将 `%APPDATA%\lite-ssh` 复制到 `%APPDATA%\lite-connect`（不覆盖已有连接数据；便携/绿色版不走此逻辑）。

| 文件或目录 | 内容 |
|---|---|
| `connections.json` / `groups.json` | SSH 连接和分组（含置顶、排序与使用统计） |
| `saved-credentials.json` | 可复用凭据 |
| `settings.json` | 应用设置 |
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

安装包输出目录为 `release/`（见 `electron-builder.yml`）。Windows 默认打 NSIS x64 安装包。

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
