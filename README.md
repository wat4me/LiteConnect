<h1 align="center">LiteConnect</h1>

<p align="center"><strong>把 SSH、文件传输、数据库和 AI 辅助运维放进同一个桌面工作区。</strong></p>

<p align="center">面向开发者与运维人员的开源跨平台客户端。连接服务器后即可使用终端、SFTP、资源监控和 Docker 管理，也可以让 AI 基于真实命令输出协助排障。</p>

<p align="center">
  <a href="https://github.com/wat4me/LiteConnect/releases/latest"><img src="https://img.shields.io/github/v/release/wat4me/LiteConnect?style=flat-square" alt="Latest Release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-GPL--3.0-green?style=flat-square" alt="License" /></a>
  <a href="https://github.com/wat4me/LiteConnect/releases"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blue?style=flat-square" alt="Platforms" /></a>
</p>

<p align="center">
  <a href="https://github.com/wat4me/LiteConnect/releases/latest">下载最新版本</a> ·
  <a href="docs/AI.md">AI 使用指南</a> ·
  <a href="docs/SSH.md">SSH 使用指南</a> ·
  <a href="docs/DEVELOPMENT.md">开发指南</a>
</p>

## 为什么是 LiteConnect？

- **一个连接，完整工作流**：终端、SFTP、监控和 Docker 共用现有 SSH 会话，不必在多个工具之间重复配置。
- **能实际协助排障的 AI**：结合终端上下文和真实工具输出分析问题，支持多服务器协同、后台任务与定时巡检。
- **操作边界清晰可见**：默认只读自动执行，修改与提权需要审批；命令还会经过应用侧独立判级。
- **接入现有 AI 客户端**：可选的本机 MCP 服务，将 SSH 工具提供给支持 Streamable HTTP 的外部客户端。

## 下载与安装

从 [GitHub Releases](https://github.com/wat4me/LiteConnect/releases/latest) 下载适合当前系统的安装包：

| 平台 | 安装包 |
|---|---|
| Windows | NSIS 安装程序 |
| macOS | DMG / ZIP |
| Linux | AppImage / DEB |

> **注意**：安装包尚未签名。Windows 可能出现 SmartScreen 提示，macOS 可能需要右键选择「打开」。

## 快速开始

1. **新建连接**：添加 SSH 或数据库连接，填写地址与认证信息。
2. **进入工作区**：使用终端、SFTP、监控、Docker 或 SQL 工具。
3. **按需启用 AI**：在 AI 设置中配置 OpenAI 兼容或 Anthropic Messages 提供商，然后开始提问。

使用 AI 操作服务器时，所选模型需要支持工具调用。内置 AI 侧栏**不需要开启 MCP 服务**。

## 功能总览

| 能力 | 简介 |
|---|---|
| SSH 与终端 | 连接分组、密码 / 私钥 / SSH Agent、跳板机、端口转发、X11、多会话、分屏与批量命令 |
| SFTP | 文件及目录上传下载、断点续传、冲突处理、远端编辑与权限管理 |
| Docker | 通过现有 SSH 会话查看容器、日志和配置，启停容器或打开交互式终端 |
| 数据库 | MySQL、PostgreSQL、Oracle，支持 SSH 隧道、SQL 编辑、数据浏览、编辑与导出 |
| 监控与告警 | CPU、内存、磁盘、进程与主机信息，支持按服务器配置资源告警 |
| LiteAI | 单机排障、多服务器协同、服务器知识、统一任务入口、定时巡检、Webhook 通知与操作审批 |
| MCP | 可选的本机服务，向外部 AI 客户端提供 SSH 会话、命令、文件与监控工具 |

连接配置支持导入导出；密码、私钥和数据库密码在系统加密服务可用时加密保存。

## AI：从建议到实际排障

可以直接把终端选区或上下文发给 AI，也可以提出这样的任务：

- 「找出磁盘占用最多的目录。」
- 「定位这份日志中的错误，并解释可能原因。」
- 「检查这组应用、数据库和网关服务器，汇总异常。」
- 「解释当前配置，并给出修改建议。」

AI 可以查询系统状态、检索文件、读取日志、运行命令和执行后台任务，工具过程与结果会显示在对话时间线中。LiteAI 独立工作区支持按分组选择 1 至 20 台服务器进行协同查询，也可以配置只读定时巡检与通知。

### 权限与审批

| 权限模式 | 行为 |
|---|---|
| 只读自动，修改需确认（默认） | 只读操作自动执行；修改和提权暂停并等待允许 |
| 只允许只读 | 仅执行申报为只读的调用，拒绝修改和提权 |
| 自动执行 | 合法申报的操作可自动执行；明确高危命令仍需确认 |

权限模式同时参考 AI 申报的级别和应用对命令的独立判级。审批绑定具体请求与 SSH 会话，拒绝、取消或超时后，未获批准的调用不会执行。

> 「只允许只读」不是系统级只读隔离，远端操作仍受 SSH 登录账号的实际权限约束。对话内容和用于分析的工具结果会发送到你配置的模型提供商。

服务器知识支持关闭、只读和可更新模式；后台命令与 AI 上传下载共用可拖动的任务入口。更多配置、图片输入、上下文压缩与任务说明见 [AI 使用指南](docs/AI.md)。

## MCP：让外部 AI 客户端使用 SSH 工具

LiteConnect 提供可选的本机 MCP 服务。外部客户端可以发现已保存连接、连接服务器、执行命令、检索文件和管理后台任务。

**服务默认关闭，仅监听本机 loopback，LiteConnect 必须保持运行。**

1. 打开「设置 → MCP」，启用服务并完成确认。
2. 复制服务地址和 Bearer Token。
3. 在同一台电脑上支持 **MCP Streamable HTTP** 的客户端中添加服务。

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

| 项目 | 内置 AI | 外部 MCP 客户端 |
|---|---|---|
| 模型配置 | 在 LiteConnect 中配置 | 由外部客户端管理 |
| 需要开启 MCP 服务 | 否 | 是 |
| 主机范围 | 当前主机或 LiteAI 选定范围 | 可发现、连接多个主机并广播命令 |
| 操作控制 | 按权限模式自动执行或请求审批 | 默认 `deny-destructive` 命令策略 |

MCP 与内置 AI 共用工具运行时，但**修改内置 AI 的权限模式不会放开 MCP 的默认策略**。MCP 会拒绝被分类为破坏性、提权或高危的命令；这不等同于整个服务只读，文件写入、传输和连接管理等工具仍在开放范围内。

仅把 Token 配置给可信的本机客户端，不要提交到仓库、公开分享或配置给远程 Agent。网页版 AI 客户端通常无法访问本机 `127.0.0.1` 服务。

## 本地数据与安全

- 连接配置、应用设置、命令与查询历史、AI 对话和 MCP 审计记录保存在本机 SQLite 数据库中。
- Windows 默认数据目录为 `%APPDATA%\lite-connect\`。
- 主机密钥使用本地 `known_hosts` 管理；首次连接展示 SHA256 指纹，密钥变化时对比新旧指纹并要求确认。
- 应用运行时不要单独复制或删除 SQLite WAL / SHM 文件；旧版迁移备份会保留为 `*.pre-sqlite-v1.bak`。

## 当前边界

- Docker 模块暂不包含删除容器、镜像管理、Volume 管理或 Compose。
- MCP 不提供 Docker socket 或数据库隧道的专用工具。
- Oracle 表数据分页适用于 Oracle 12c 及以上版本。
- 监控字段取决于远端操作系统和可用命令；后台资源告警默认关闭。

## 开发与贡献

建议使用 Node.js 22 和 npm 9 或更高版本：

```bash
npm ci
npm run dev
```

源码结构、测试、构建与发版步骤见 [开发指南](docs/DEVELOPMENT.md)，模块职责与依赖边界见 [架构说明](ARCHITECTURE.md)。

## 致谢

本项目认可并感谢 [LINUX DO](https://linux.do) 社区。

## 许可

[GNU General Public License v3.0](LICENSE)
