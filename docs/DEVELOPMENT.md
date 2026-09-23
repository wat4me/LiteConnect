# 开发与发布指南

本文面向 LiteConnect 开发者。产品功能与使用方法见 [README](../README.md)。

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

开发版默认使用独立数据目录，不会读取或修改已安装正式版的连接、凭据、设置、AI 历史、日志和数据库。默认位置为：

- Windows：`%APPDATA%\LiteConnect-Dev\`
- macOS：`~/Library/Application Support/LiteConnect-Dev/`
- Linux：Electron `appData` 目录下的 `LiteConnect-Dev/`

测试数据迁移或需要一次性独立配置时，可使用仓库内的隔离数据目录：

```bash
npm run dev:isolated
```

`dev:isolated` 默认使用仓库根目录下的 `.liteconnect-dev-data/`（已加入 `.gitignore`）。也可以指定其他目录；相对路径按仓库根目录解析：

```powershell
$env:LITECONNECT_DEV_USER_DATA_DIR = "$PWD\\tmp\\migration-profile"
npm run dev:isolated
```

把待迁移的旧版 JSON/JSONL 测试数据放入该目录后启动应用，即可验证自动迁移。该开关仅在开发版生效，打包后的应用会忽略它；不要使用 Electron 的 `--user-data-dir` 代替，因为它不保证改变 LiteConnect 的业务数据目录。若需要清空普通开发环境，关闭开发版后删除 `LiteConnect-Dev` 目录即可，不会影响正式版。

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
git tag v1.0.0
git push origin v1.0.0
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
| `npm run dev` | 使用系统 `LiteConnect-Dev` 独立目录启动 Vite 和 Electron |
| `npm run dev:isolated` | 使用仓库内 `.liteconnect-dev-data/` 启动一次性隔离环境 |
| `npm run typecheck` | 运行 Vue/TypeScript 类型检查 |
| `npm test` | 运行 Vitest 测试 |
| `npm run test:watch` | 以 watch 模式运行测试 |
| `npm run build` | 类型检查并构建 renderer 和 Electron 代码 |
| `npm run preview` | 预览 renderer 构建结果 |
| `npm run electron:build` | 构建并使用 electron-builder 打包 |

## AI 工具申请协议

每次侧栏工具调用都必须在 JSON 参数中携带 `risk` 和 `explanation`。例如，申请重启服务：

```json
{
  "command": "systemctl restart nginx",
  "risk": "write",
  "explanation": "重启 nginx 以应用配置，可能短暂影响网站连接。"
}
```

`risk` 只能是 `read`（只读）、`write`（修改）或 `privileged`（提权）。模型需用中文解释操作目的、涉及的资源和预期影响；`explanation` 必须是 1–500 字符的非空说明。缺少或无效的字段会导致本次不执行，要求模型补全申请。这两个字段用于应用审批，不会传给远端命令。

## Oracle 集成验收

**集成验收建议**

- [ ] 12c+ / 19c / 21c 直连，Service Name 与完整 connectString
- [ ] SSH 隧道到内网 Oracle（主机填 SSH 侧可达地址）
- [ ] `SELECT 1 FROM DUAL`、表树展开、分页、查询取消、事务提交/回滚、表导出取消
- [ ] 错误信息无明文密码 / connect string 泄露

