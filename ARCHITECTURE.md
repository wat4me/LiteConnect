# LiteConnect Architecture

## Layers

```text
UI (components / views)
  → composables (orchestration, Vue state)
    → domain (pure types & domain helpers)
    → utils/<domain> (pure helpers)
      → shared/ (main + renderer pure logic, no Electron/DOM)
```

**Main process** is organized by service domain under `electron/` (`ssh`, `docker`, `db`, `ipc`, `store`, `window`). `electron/main.ts` is the entry composition root; `electron/application/` contains its delayed service assembly and shutdown coordination. IPC registration receives constructed services.

## Electron directory map

| Area | Path | Owns |
|------|------|------|
| Composition root | `electron/main.ts` | Wire stores/services/IPC; teardown order |
| Application lifecycle | `electron/application/` | Delayed AI/MCP/Docker assembly, scheduler construction/start, bounded shutdown |
| SSH core | `electron/ssh/` | `manager`, `connectionService`, `types`, `auth`, `localForwards` |
| SSH trust | `electron/ssh/trust/` | known_hosts, host-key verify |
| SSH SFTP | `electron/ssh/sftp/` | SFTP session ops |
| SSH transfer | `electron/ssh/transfer/` | upload/download runners |
| SSH X11 | `electron/ssh/x11/` | local X server + forwarding |
| SSH monitor | `electron/ssh/monitor/` | host metrics collector |
| SSH diagnosis | `electron/ssh/diagnosis/` | test connection + latency diagnose |
| Docker | `electron/docker/` | Engine over SSH socket (keep interface seam) |
| DB core | `electron/db/` | `manager`, `driver`, `types`, `common`, `drivers/*` |
| DB tunnel | `electron/db/tunnel/` | dedicated SSH port-forward client |
| DB SQL policy | `electron/db/sql/` | limit / prepare / re-exports of shared sql* |
| DB export | `electron/db/export/` | table export + script import |
| DB browse | `electron/db/browse/` | filter + pagination helpers |
| IPC edge | `electron/ipc/` | thin `ipcMain` registration |
| Persistence | `electron/store/` | credentials, settings, histories |
| SSH MCP runtime | `electron/mcp/` | Tool runtime + policy over open `SSHManager` sessions |
| SSH MCP HTTP | `electron/mcp/http*.ts` | Optional 127.0.0.1 Streamable HTTP gateway (Bearer, off by default) |
| AI conversation | `electron/ai/execution/chatStream.ts`, `chatCompletion.ts` | Request/turn orchestration and canonical transcripts |
| AI protocols | `electron/ai/providers/` | Typed adapter contracts, registry, OpenAI/Anthropic codecs, SSE transport |
| AI provider service | `electron/ai/providers/providerService.ts` | Model discovery pagination, connection probes, timeouts |
| AI tools | `electron/ai/tools/toolExecution.ts`, `streamControl.ts` | Scope/policy/approval/execution and request ownership/cancellation |
| AI tool catalog | `shared/aiToolCatalog.ts`, `aiSidebarPrompt.ts`, `aiWorkspacePrompt.ts` | Core/optional tool groups, local capability loading and shared request-budget projection; external MCP retains its full catalog |

Import the real subpath (e.g. `ssh/trust/knownHosts`, `db/tunnel/sshTunnel`). Root-level re-export shells were removed.

Internal AI requests start with common tools plus `load_tools`; optional transfer, PTY and job-overview schemas are loaded per conversation. Loaded groups persist in thread metadata independently of compaction and history pruning. A load performs no remote operation, and other calls from the same preplanned batch are deferred until the model reads the new schemas. `chatStream` uses the current advertised catalog for execution admission and context budgeting; `toolExecution` still applies scope, permissions and approval to actual operations. The renderer estimates against the same selected catalog. This adaptation does not alter external MCP tool definitions.

## Enforced boundaries (ESLint)

```bash
npm run lint   # architecture-focused ESLint (dependency zones)
```

`import/no-restricted-paths` zones (see `eslint.config.mjs`):

| Zone | Forbidden import | Why |
|------|------------------|-----|
| `src/utils/**` | `composables`, `components`, `views` | pure helpers stay below UI |
| `src/domain/**` | `composables`, `components`, `views` | domain models stay pure |
| `shared/**` | `src/**`, `electron/**` | dual-process pure only |
| `electron/**` | `src/**` | main ↛ renderer |
| `src/**` | `electron/**` | renderer ↛ main (use preload IPC) |
| Peer composables (`terminal`, `sftp`, `docker`, `database`, `ai`, `snippets`, `connections`, `monitor`) | each other's `composables/` | features meet at domain ports / App composition |
| `composables/session`, `workspace` | peer feature composables | session/workspace depend on domain types, not feature internals |
| `composables/settings` | peer composables except `database` | settings may apply DB defaults; not other features |
| `electron/ssh` | `docker`, `db`, `mcp`, `ai` | interactive SSH does not own those modes |
| `electron/docker` | `ssh`, `db`, `mcp`, `ai` | Docker uses `DockerSshBackend` / `DockerSessionHost` |
| `electron/db` | `docker`, `mcp`, `ai`; `ssh` except `trust` / `auth` / `loadSsh2` | tunnel is a dedicated ssh2 client |
| `electron/mcp` | `docker`, `db`, `ai`; SSH implementations outside `bind.ts` | Only `bind.ts` (and its integration test) adapts `SSHManager`; other MCP modules may import `ssh/types` / `ssh/sessionExec` as types and the pure `ssh/shellQuote` helper |
| `electron/ai` | `ssh`, `docker`, `db` | AI tools go through MCP runtime |
| `electron/store` | `ssh`, `docker`, `mcp`, `ai` | persistence stays below services |
| Production services and `electron/ipc` | `electron/application`, `electron/main.ts` | composition roots own assembly; lower modules cannot call back into them |
| `electron/ai/providers` | AI orchestration/tools/history; `ipc`, `store`, `mcp` | protocol codecs stay below application services |
| OpenAI / Anthropic adapter | each other's implementation | share canonical validation rather than another wire format |

Also: `src/composables/**` must not import `*.vue` SFCs (`no-restricted-imports`).
Production `shared/**` and `src/domain/**` cannot import Node built-ins (bare or
`node:`), Electron, Vue, `@vue/*` or vue-i18n, including type imports, re-exports,
literal dynamic imports and require. Test files retain access to test-platform APIs.
`npm run check:architecture` verifies allowed/forbidden imports against the real
ESLint configuration without writing fixture modules; `npm run lint` runs it in CI.

`npm run typecheck` checks both renderer/shared (`vue-tsc`) and Electron main/shared
(`tsc -p tsconfig.node.json --noEmit`). CI and `build` run both checks; Vite bundling
alone does not validate main-process types. Main-process incremental metadata stays
under `node_modules/.cache/litessh/` rather than the runtime output directory.
Both renderer/shared and main/shared checks enforce unused locals and parameters.
Unused exports still require a separate reference audit.
An imported file may contain obsolete exports or test-only copies of production logic.

## Renderer directory map

| Area | Path | Owns |
|------|------|------|
| App shell | `components/app`, `composables/app` | Titlebar, dialogs, theme, navigation, security UI |
| SSH workspace | `components/workspace`, `composables/workspace` | `SshWorkspace`, sidebars, panel exclusivity |
| Connections | `components/connections`, `composables/connections` | Host list, groups, batch test |
| Session | `composables/session`, `domain/session`, `utils/session` | Session graph, reconnect, display helpers |
| Terminal | `components/terminal`, `composables/terminal`, `domain/terminal`, `utils/terminal` | xterm, paste, shell suggest, CWD port |
| SFTP | `components/sftp`, `composables/sftp`, `utils/sftp` | File browser, transfers |
| Docker | `components/docker`, `composables/docker`, `utils/docker` | Containers, logs, exec |
| Database | `components/database`, `composables/database`, `domain/database`, `utils/database` | SQL workspace |
| Monitor | `components/monitor`, `composables/monitor` | Host metrics dock |
| Snippets / batch | `components/snippets`, `composables/snippets`, `utils/snippets` | Command snippets, broadcast, snippet hotkeys |
| AI | `views/AiWorkspaceView.vue`, `components/ai`, `composables/ai` | Standalone LiteAI workspace and SSH chat sidebar |
| Settings | `components/settings`, `composables/settings` | Settings panels |
| Shared UI | `composables/shared`, `utils/shared` | Cross-cutting pure/UI helpers |

## Dependency rules

### LiteAI modules

```text
electron/ai/
  execution/       # Turn loop, checkpoints, context packing, background continuation
  tools/           # Routing, policy, approval/cancellation, tool execution and diff
  providers/       # Protocol adapters, HTTP/SSE, model discovery and connection probes
  history/         # Host history identity, conversation persistence and image storage
  workspace/       # Connection leases, immutable scopes and conversation index
  schedules/       # Scheduler, multi-host inspection orchestration and Webhook delivery
  tests/           # Cross-module provider/stream integration contracts
  settingsValidation.ts  # Configuration normalization consumed by the settings boundary
```

`execution` composes tool and provider modules. Tool implementations do not import
execution, history, workspace services or providers; routing consumes shared target
types and MCP ports. History and workspace modules cannot call the turn loop.
Within history, `historyModel.ts` owns normalization, retention and recovery rules;
`historyCodec.ts` decodes stored values and migrates legacy JSON/JSONL;
`historyStore.ts` owns serialized database writes and conversation operations.
Model and codec cannot import database storage, image files or the history service.
Idle write chains are released after their last task settles.
Schedulers consume injected execution/persistence/notification ports rather than
importing the execution service. Application assembly wires these services together; IPC adapts calls and OS approval
notifications belong to `electron/ipc/aiApprovalNotification.ts`. Tests stay next
to their owning module; cross-module provider scenarios live in `tests/`.

Renderer entry points are `useAiChat.ts` and `workspace/useAiWorkspace.ts`.
`chat/sessionState.ts` alone owns the session map, disposal and resource probe;
`chat/history.ts` owns history loading, deduplication and persistence;
`chat/settings.ts` owns the app-wide settings epoch and model selection.
`src/domain/ai/chat.ts` defines UI types, and
`src/utils/ai/chatHistoryProjection.ts` converts reactive display records to plain
IPC/history payloads. Components import domain types rather than the orchestrator
for types, and use the public chat facade instead of its private state modules.
`useAiComposerImages.ts` owns file/paste/drop input and attachment preparation,
while draft images stay in the conversation state. Preparation verifies its host,
thread and component lifetime before committing a batch.
`useAiSidebarContextFiles.ts` owns context-file selection, preview, refresh and removal;
it captures the host/thread before asynchronous file reads or confirmation.
`useAiSidebarModelMenu.ts` owns settings/model-menu visibility and popup positioning,
including cancellation of pending animation frames. `useAiMessageActions.ts` adapts
message mutations to the public chat facade and prevents old stream projections or
confirmations from updating a different host/thread. These composables own UI state,
not a second conversation store.
`useAiSidebarSession.ts` projects the public chat state, deduplicates initial loads,
and binds streaming callbacks, selection requests and failed draft restoration to
their originating host/thread. The input reads and writes the canonical draft.
`useAiNewConversation.ts` snapshots target sessions/jobs before asynchronous reads,
and revalidates the originating conversation after confirmation and job cleanup.
`AiToolApprovals.vue` owns approval presentation and its scoped styles; approval
resolution still uses the public chat facade. `useAiSidebarHistory.ts` captures
confirmation targets, rejects stale search responses and serializes thread switches.
`useAiChatViewport.ts` owns follow-scroll, KeepAlive reading-position restoration,
timeline sizing and navigation; deactivation/disposal cancels pending viewport work.
`AiWorkspaceView.vue` renders the workspace; its composable owns event subscriptions,
connection lifetime, selection and navigation. Workspace host grouping lives in a
pure helper used by both the browser and picker. Scoped styles remain beside the view.
`workspace/useAiWorkspaceHosts.ts` owns browsing filters, selections and the host
picker, consuming the workspace's single connection map and operation lock.
`workspace/useAiWorkspaceRail.ts` observes the actual workspace width and defaults
narrow chats to a collapsed rail; an explicit saved user preference takes priority.

These directions are enforced in `eslint.config.mjs`, including the prohibition on
private chat modules importing their public facade or IPC adapters being imported
by main-process AI services. Existing IPC channels, history formats and shared type
locations remain the cross-process contract; directory grouping does not introduce
root re-export shells or a second session store.

### General rules

1. **`components` → `composables` → `domain` / `utils` → `shared`** only. Never reverse.
2. **`utils/**` must not import `composables/**` or `components/**` (or `*.vue`).
3. **`composables/**` must not import `*.vue` SFCs. Domain types live in `domain/` or `env.d.ts`, not under `components/`.
4. Prefer **`@/`** (renderer) and **`@shared/`** (dual-process pure modules) over deep relative paths.
5. Cross-feature product seams (terminal CWD → SFTP follow, Docker over SSH) should depend on **small types/ports**, not peer feature internals.
   - Terminal CWD: `src/domain/terminal/types.ts` (`TerminalPwdTracker`)
   - Split layout: `src/domain/terminal/types.ts` (`SplitMode` / `SplitSide`)
   - Docker over SSH: `electron/docker/types.ts` (`DockerSessionHost` / `DockerSshBackend`)
   - MCP over SSH: `electron/mcp/ports.ts` + `electron/mcp/bind.ts` (only `bind.ts` may import `SSHManager`)

## Electron: three SSH-related modes

Do not merge these — they have different lifecycles and security boundaries:

| Mode | Location | Role |
|------|----------|------|
| Interactive session | `electron/ssh` + `SSHManager` | Shell, SFTP, transfers, X11, monitor |
| Docker host | `DockerSessionHost` / `DockerSshSessionHost` | StreamLocal/nc to docker.sock only |
| DB tunnel | `electron/db` tunnel service | Dedicated `ssh2` client for port forward |

## Shared pure modules (`shared/`)

| Module | Purpose |
|--------|---------|
| `types/connection.ts` | SSH `Connection` / groups / credentials (main + renderer) |
| `types/database.ts` | DB connection / query / browse IPC types |
| `types/ai.ts` | AI settings, history, stream payloads |
| `types/docker.ts` | Docker IPC types (not main-only transport classes) |
| `types/settings.ts` | `AppSettingsAll` / bootstrap / workspace tabs |
| `sqlReadOnly.ts` | Read-only SQL classification (main + renderer) |
| `sqlRisk.ts` | Dangerous SQL risk assessment (main + renderer) |
| `dbConnectionUrl.ts` | Connection URL / JDBC / Easy Connect parsing |
| `formatBytes.ts` | Compact byte formatting shared by resource stats, monitor, SFTP and DB UI |
| `sqlIdent.ts` | SQL identifier quoting for main-process drivers and renderer SQL helpers |
| `mcp/*` | SSH tool schemas, command classification, output truncation |
| `mcp/bashParse.ts` | Bash AST → flat command list (pure; the parser is injected) |

Renderer `Window.LiteConnect` lives in `src/types/liteConnectApi.ts`. `src/env.d.ts` only declares `Window` and re-exports shared types.

SFTP's 28 public methods are defined once in `shared/ipc/sftp.ts`; `LiteConnectApi`
extends that contract. It covers 17 invoke channels, 6 send-only commands and 5 event
subscriptions without changing their names or positional payloads. The preload
adapter is `electron/preload/sftpApi.ts`; `electron/ipc/sftpContract.ts` checks main
handler arguments/results and transfer events. MCP transfer events and upload-conflict
prompts use the same event tuples. Electron's untyped invoke result is asserted only
at the preload transport boundary; runtime input validation stays in main handlers.
`npm run typecheck:contracts` checks positive/negative fixtures in
`scripts/typechecks/` and runs as part of typecheck, build and CI.

AI chat IPC wiring is `electron/ipc/registerAiHandlers.ts`; it adapts Electron events to the transport-independent `electron/ai/execution/executionService.ts`. The execution service owns request serialization, persistence, cancellation, approval routing and background-result continuation. Settings/history ports and optional observers allow unattended read-only execution without a renderer; explicit history/thread identities remain separate from SSH session and caller identities. Protocol codecs live in `electron/ai/providers/`, discovery/probing in `electron/ai/providers/providerService.ts`, request packing in `electron/ai/execution/requestContext.ts`, settings validation in `electron/ai/settingsValidation.ts`, and session persistence in `electron/ai/history/historyStore.ts`. The turn loop in `electron/ai/execution/chatStream.ts` delegates individual calls to `toolExecution.ts`; `streamControl.ts` owns cancellation and pending approvals. See `docs/AI-RUNTIME.md` for the execution contract. `electron/mcp/bashParser.ts` installs the wasm bash parser into `shared/mcp/classify.ts` at startup (started from `electron/main.ts`, awaited in `SshMcpRuntime.call`); the grammar is vendored at `shared/mcp/vendor/tree-sitter-bash.wasm` and copied next to `main.js` by `scripts/copy-bash-wasm.mjs`. `electron/ai/tools/commandFloor.ts` is the escalate-only floor that stops a model from labelling a destructive command as `read`.

All main-process application data is stored in `liteconnect.sqlite`, managed by `electron/store/appDatabase.ts`. The database uses WAL, foreign-key enforcement, full synchronous commits, schema versions, and transactional legacy migration. Collection rows are updated only when their order or payload changes. JSON/JSONL remains an import/export format and a one-time upgrade source, not a live application store.

Settings IPC is composed from `electron/ipc/settings/*.ts`. New settings go through `settings:getAll` / `settings:setMany` (`AppSettingsAll` + `SettingsStore.applyMany`), not a new one-off get/set channel.
`electron/store/settingsPatch.ts` owns the synchronous validation and normalization for `setMany`; `SettingsStore` owns persistence and the public getter/setter API.
`electron/store/aiSettingsService.ts` owns AI provider normalization, model selection, and resolved runtime configuration. `electron/store/settingsSecrets.ts` holds the Electron safeStorage boundary shared by AI keys and the MCP HTTP token; `SettingsStore` retains migration and persistence ownership.

SSH MCP tool implementations live under `electron/mcp/tools/` (sessions, exec, sftp, pty, service). `electron/mcp/runtime.ts` is dispatch + session guards.
`SshMcpRuntime.dispose()` is idempotent: it unsubscribes session teardown, disposes
background jobs and agent PTYs, and clears tool activity state. Job disposal detaches
observers before cancellation so shutdown cannot enqueue AI continuations. Late exec
handles are cancelled; late PTY channels are destroyed. Disposal rejects new tool calls
and approvals granted after shutdown. Main stops the AI executor and HTTP gateway
before disposing MCP, then the SSH owner closes its connections and foreground exec
channels. Runtime disposal itself does not disconnect user SSH sessions.
Interactive SSH connection authentication, keyboard prompts, and host-verifier configs live in `electron/ssh/connectionAuth.ts`; X11 readiness policy lives in `electron/ssh/connectionX11.ts`. `ConnectionService` retains session generation, shell, jump transport, and resource cleanup. Single-file SFTP stream execution lives in `electron/ssh/transfer/fileTransfer.ts`; `TransferRunner` retains transfer registration, cancellation, and directory-job orchestration.

DB query-tab run/export orchestration is `src/composables/database/useDbQueryRun.ts` and `useDbResultExport.ts`. Engine metadata/browse SQL lives in `electron/db/drivers/{postgres,mysql,oracle}Browse.ts`; driver classes remain the `DbDriver` entry. Background COUNT tests call the production Browse implementation instead of private wrappers on driver classes. Query execution tests drive `useDbQueryRun` and its IPC boundary rather than unused action-mapping replicas.
`DatabaseView.vue` loads `DbQueryTab.vue` (including CodeMirror) and `DbTableWorkspace.vue` only when the corresponding tab is opened; the database shell remains a separate lazy view from `App.vue`.

App-shell wiring extracted from `App.vue`: snippet hotkeys (`useSnippetHotkeys`), Docker SSH session listeners (`useDockerSshBridge`), SFTP/batch toasts (`useTransferToasts`).
Terminal split pane geometry lives in `src/utils/terminal/splitPaneLayout.ts`, split shortcuts in `useTerminalSplitKeyboard.ts`, and xterm input classification/writes in `useTerminalUserInput.ts`. Terminal components keep mounted xterm instances and visual coordination.
`src/composables/app/useAppWindowRouting.ts` owns launch URL parsing and SSH/DB window entry policy; `App.vue` remains the composition root.

MySQL streaming row caps and connection discard behavior live in `electron/db/drivers/mysqlQueryStream.ts`; PostgreSQL result mapping and cursor reads live in `postgresQueryExecution.ts`. Driver classes retain the query/session lifecycle and cancellation state.

AI sidebar context-file availability checks live in `src/composables/ai/useAiContextFileStatus.ts`; its scoped presentation rules live in `src/components/ai/AiSidebar.css`.
AI sidebar history filtering and mutations live in `src/composables/ai/useAiSidebarHistory.ts`.
`src/views/AiWorkspaceView.vue` reuses the chat sidebar in the standalone LiteAI module. `electron/ai/workspace/workspaceConnections.ts` owns dedicated SSH transports per window and saved connection, while `registerSshConnectHandlers.ts` adapts saved credentials, host verification and keyboard authentication. Module switching retains connections; explicit disconnect and window destruction release only the workspace-owned transports.
`electron/ai/schedules/scheduler.ts` owns persisted interval/daily/weekly local plans and bounded, serialized inspection runs. `shared/aiSchedules.ts` validates timing and calculates the next local-calendar occurrence, including DST and timezone changes. `electron/ipc/aiScheduleExecutor.ts` creates a dedicated saved-profile SSH transport and temporary history for each read-only execution. `electron/application/aiSchedules.ts` binds persistence, notification and execution ports; `registerAiScheduleHandlers.ts` registers IPC against the constructed scheduler/notifier. `components/ai/AiSchedulePanel.vue` configures plans and shows reports. The scheduler runs while the app is alive, skips catch-up bursts and aborts work at shutdown.
`electron/ai/schedules/orchestrator.ts` runs selected-host inspections serially or with bounded parallelism and synthesizes reports through ports; each host retains its own context and transport. Plans may pin a provider/model or fall back to the active pair. `electron/ai/schedules/notifications.ts` handles opt-in generic JSON Webhooks with encrypted endpoint/token storage, bounded requests and delivery state independent of inspection results. Notification settings never enter model context. Windows window/taskbar icon lookup lives in `electron/window/appIcon.ts`; development shortcut registration and legacy Electron shortcut conflict handling live in `electron/window/developmentTaskbar.ts`.
AI chat message footer display and controls live in `src/components/ai/AiMessageFooter.vue`; `AiChatView.vue` keeps scroll and timeline coordination, with scoped rules in `AiChatView.css`.
SFTP bookmark dialogs and mutations live in `src/composables/sftp/useSftpBookmarkActions.ts`; `FileSidebar.vue` keeps navigation sequencing and uses `FileSidebar.css` for scoped presentation rules.

UI-only helpers stay in `src/utils/**`, never in `shared/`.

## AI provider and tool boundaries

AI providers implement the contract in `electron/ai/providers/types.ts` and register
once in `providers/registry.ts`. Conversation orchestration consumes canonical
messages, deltas, usage and adapter capabilities; it must not branch on Claude
content blocks or vendor names. `providers/http.ts` owns only URL validation,
HTTP error reading and SSE framing. Each provider owns its authentication,
endpoints, message/tool/image encoding, response parsing and model-page schema.

`shared/aiMessages.ts` owns canonical transcript normalization and repair of
incomplete tool turns, without generating an OpenAI request. Shared image
availability/size checks live in `shared/aiImages.ts`; both providers call them
directly. `shared/anthropicContent.ts` remains shared because the renderer's IPC
projection and local history both need lossless validation of signed blocks.
`shared/types/ai.ts` is the single runtime configuration definition, also used by
the settings store. Protocol adapters cannot import AI orchestration/tool/history
services or each other's codecs; ESLint enforces those dependency directions.

## Intentional coupling (keep)

- Docker → SSH via `DockerSshBackend` / `DockerSessionHost` (adapter in `docker/sshSessionHost.ts`; no `electron/ssh` import)
- DB tunnel auth via injected stores + independent tunnel client
- SFTP path follow via terminal PWD tracker / pause helpers
- Window close → disconnect owned SSH sessions (composition root)
- SSH MCP runtime → interactive `SSHManager` sessions only (not Docker sock, not DB tunnels)
- MCP HTTP gateway (optional) → same runtime; loopback + Bearer only; default off
- MCP file transfers → `McpFileTransferPort` in `electron/mcp/ports.ts`, adapted in
  `bind.ts`; SSH, MCP and IPC share `shared/transferCancellation.ts` for cancellation.

## Out of scope for casual refactors

- Preload channel names / `window.LiteConnect` shape
- Routing DB tunnels through interactive `SSHManager` sessions
- Flattening `electron/docker` (already well factored)

## Governance status and next steps

The 2026-10-19 cleanup removes unused imports, obsolete query action mappings,
test-only copies of Docker stale-result decisions, private DB COUNT wrappers,
and unused main-process port-summary/extract-command helpers. Docker late-result
tests continue to exercise real composables; COUNT and query tests exercise their
production modules. Renderer/shared and main/shared unused local and parameter checks run as
part of the existing typecheck/build/CI commands.

Docker state/action labels are resolved through `components/docker/dockerUiHelpers.ts`
at call time to preserve locale changes. The three Docker transport channels use
the same complete error-code guard in `electron/docker/errorClassify.ts`.
`utils/terminal/shellText.ts` supplies the identical text-splitting behavior needed
by terminal CWD tracking and container-entry hints. It is not a security parser;
MCP classification continues to use its own command policy and Bash AST engine.

The second cleanup batch completes MCP disposal, extracts the sidebar's context-file, model-menu
and message actions, and converges on npm with `package-lock.json` as the sole lockfile.
`scripts/check-dependency-baseline.mjs` rejects competing lockfiles and mismatched root
versions/dependency declarations; lint and production builds run it automatically.
Validate clean dependencies in a separate directory instead of replacing a running
development environment's dependencies.

Future cleanup candidates are shared xterm settings application and command-snippet
variable resolution. Split other components by responsibility, not total template/style
line count; keep one AI session store and separate SSH, Docker and DB lifecycles.

Architecture rules and progress stay in this document. User behavior belongs in
`docs/AI.md` / `docs/SSH.md`, development and release commands in
`docs/DEVELOPMENT.md`, and UI/icon contracts in `docs/UI_STYLES.md` / `docs/ICONS.md`.
Historical release notes and third-party provenance remain versioned records.
Avoid creating standalone audit or plan documents that duplicate these sources.

### 2026-10-22 架构治理扫描基线

本轮基于当前工作区（包含未提交的新功能）扫描，不等同于已发布版本。
检查范围为源码依赖、IPC 契约、装配与释放流程、前端职责、现有质量门禁；
没有运行真实 SSH、数据库、模型请求或安装包验收。下列观察记录扫描时状态，
后续实施情况见本节末尾的交付记录。

**总体判断：继续现有分层，以契约、依赖约束和生命周期治理为先。**
SSH / Docker / DB 的不同连接生命周期、AI 执行服务与协议适配器分离、
共享纯逻辑、双端严格类型检查和现有回归测试均应保留。

| 基线 | 当前观察与口径 |
| --- | --- |
| 生产源码 | `src/`、`electron/`、`shared/` 共 610 个 `.ts` / `.vue` 文件，约 12.6 万物理行，包含声明、模板、样式与空行，排除 `.test.ts` |
| 测试文件 | 源码及脚本目录扫描到 326 个 `.test` / `.spec` 文件；文件数不代表覆盖率 |
| 跨进程 API | preload 与 `LiteConnectApi` 各 324 个成员，名称集合一致；这不证明参数、返回值或事件载荷一致 |
| UI 直接 IPC | `components/` 和 `views/` 中有 38 个文件包含 `window.LiteConnect`；其中简单展示操作与业务编排需分别评估 |
| 依赖环 | 本地静态导入、导出与字面量动态导入扫描仅发现 `toolExecution.ts` ↔ `userQuestion.ts`；反向边为 `import type`，不能据此认定运行时循环故障 |

#### 优先治理项

| 顺序 | 证据与影响 | 建议与验收 |
| --- | --- | --- |
| 1. 补齐可执行边界 | `eslint.config.mjs` 已限制本地跨层路径，但未限制纯层的平台依赖。内存 lint 探针确认 `shared` 导入 `node:fs`、`src/domain` 导入 Vue `ref` 都不会报错；正常的 AI → SFTP composable 越界能被拦截 | 明确纯层允许的运行时依赖，覆盖 Node 内置模块两种写法、Electron 和 Vue 状态依赖；添加正反例规则验证。探针是约束缺口证据，并非断言当前生产纯层已有这些违规 |
| 2. 收紧 MCP 适配边界 | 文档约定仅 `bind.ts` 接触 `SSHManager`，但没有相应 lint 限制；当前未提交的 `electron/mcp/fileTransfers.ts` 用 `Pick<SSHManager, ...>` 并导入 SSH 的传输异常 | 为文件传输定义最小端口，将具体 SSH 实现的适配归入明确的适配文件；统一取消语义。允许的适配路径应显式列入规则，保持 AI 和 SFTP 进度、取消、冲突处理行为不变 |
| 3. 统一 IPC 契约来源 | `electron/preload.ts:6` 直接暴露对象，`src/types/liteConnectApi.ts:65` 独立声明接口；主进程另行维护通道和载荷，preload 有 `any` 且 invoke 返回值没有跨端类型约束 | 将 API / 通道契约按域放入 `shared`，preload 实现校验其形状，typed invoke/handle 绑定参数和结果。保持现有通道名与 `window.LiteConnect` 形状；选择 SFTP 传输作为首个纵向试点，保留 IPC 入口的运行时校验 |
| 4. 明确装配与释放所有权 | `main.ts` 被定义为唯一装配根，但 `registerAiHandlers.ts:49` 构造执行服务，`registerAiScheduleHandlers.ts:19` 构造调度器并在注册末尾启动。退出路径的 `dispose()` / `disconnectAll()` 与 HTTP stop 混合使用同步取消及未等待的异步清理 | 把服务构造、start 和 stop 收敛至 main 调用的装配模块，IPC 接收已构造服务。定义停止接单→取消→限时等待任务/持久化→关闭存储的顺序；覆盖退出期间流式回复、后台续答和延迟初始化。当前是生命周期风险，尚未复现退出丢数据 |
| 5. 按职责收敛前端 | `App.vue` 约 840 行 script，同时承担导航、分屏、会话、功能面板和事件生命周期；`AiSchedulePanel.vue:147` 起直接维护巡检 IPC 操作、请求版本及事件订阅 | 先提取巡检用例与订阅生命周期到 composable，再拆 App 的导航/会话命令和启动订阅；组件保留渲染与交互。为迟到响应、切换目标和卸载后回调保留行为测试，不建立第二份 AI 会话状态 |
| 6. 让门禁覆盖治理成果 | CI 已含 typecheck、依赖 lint、i18n、单测、构建及加载/打包检查；现有 UI 回归未接入工作流。两个 tsconfig 都排除了 `.test.ts` | 按变更路径接入关键 UI smoke；增加独立测试类型检查配置（Vitest 转译运行不等于类型检查）。将依赖边界负例和 IPC 契约测试纳入 CI，区分静态检查、mock 回归和真实集成验收 |

#### 建议的增量交付顺序

1. **边界基线 PR**：补纯层依赖规则、明确 MCP 适配白名单；迁移传输端口；
   将 `AiToolExecutionContext` 移至工具契约模块以消除类型反向依赖。
   验收为原有 lint/typecheck 和相关回归通过，新增禁止导入的负例确实失败。
2. **IPC 试点 PR**：从 SFTP 传输请求、进度、取消、冲突决策开始建立共享契约；
   同时校验 preload 和 main handler，既有 UI 与 AI 调用保持兼容，再逐域扩展。
   仅给暴露对象加 `satisfies` 不能消除 `invoke(): Promise<any>` 带来的返回值盲区。
3. **生命周期 PR**：明确 AI/MCP/调度器的装配和停止接口，补退出与延迟启动竞态测试。
   保留 SSH、Docker、DB 各自的关闭策略，并确保最终存储关闭发生在允许的收尾之后。
4. **前端职责 PR**：先巡检面板，再 App 编排；关联关键 UI smoke。
   每次仅迁移一个责任，保持现有 facade、状态所有者和跨会话隔离语义。

不按总行数机械拆组件：例如 `GroupPanel.vue` 的 1324 行包含约 517 行样式，
`MonitorPanel.vue` 的 1071 行包含约 505 行样式；文件长度只是定位线索。
本轮没有充分依据要求引入微服务、全局状态框架或重新组织整个目录树。

#### 本轮验证

- `npm run typecheck`：renderer/shared 与 main/shared 均通过。
- `npm run lint`：依赖基线、架构规则与统一图标检查通过。
- `npm run i18n:check`：缺失 key 为 0，消息编译错误为 0。
- 架构规则探针使用 ESLint `lintText`，没有向源码目录写入伪造模块。
- `npm test -- --maxWorkers=4 --reporter=dot`：首轮 311/326 个文件通过，
  2282 项通过、80 项失败、1 项跳过，并有 1 项未处理错误；失败涉及沙箱内
  loopback 连接 `EACCES` 与临时文件重命名 `EPERM`。在沙箱外仅复跑这 15 个
  失败文件，147 项全部通过，无未处理错误；确认首轮这些失败与运行环境有关。
  合并两轮，326 个文件均有通过记录，2362 项通过、1 项跳过，非单次全绿运行。
- 本轮未执行构建和 UI 回归；文档修改通过 `git diff --check`。

#### 第一批交付：边界规则与 MCP 传输端口

- 已补齐生产 shared/domain 的平台导入限制，并收紧 MCP → SSH 依赖。
  `bind.ts` 是 SSH 具体实现适配点，`bind.test.ts` 预留适配集成测试入口；
  其他模块仅可复用 SSH 类型契约和纯 `shellQuote`，不能运行时加载类型契约模块。
- `McpFileTransferPort` 由 MCP 声明所需的上传、下载、取消和连接名称查询能力，
  `fileTransfers.ts` 不再引用 `SSHManager` 或 SSH 传输实现。`bind.ts` 显式委托并保留 manager 的方法接收者。
- `TransferCancelledError` 移到共享纯模块，SSH、MCP、IPC 及测试直接使用同一类型，
  不留旧路径转导出；消息、异常名称与取消判定保持不变。
- 工具上下文和审批观察者类型移到 `toolExecutionContext.ts`，提问处理器不再反向导入
  `toolExecution.ts`；新增依赖规则阻止这个反向边重新出现。
- 架构正反例通过真实 ESLint 配置检查，随 lint 进入现有 CI；不添加运行时依赖。
- 验证：双端 typecheck 通过；相关 44 个测试文件 411 项通过、1 项跳过。
  随后新增无 AI abort 信号的后端取消回归，文件传输测试 9 项全部通过。
  完整 lint（含依赖基线、74 个架构正反例、源码 ESLint 和图标检查）通过；
  AI tools 内部静态依赖图含类型导入无环，`git diff --check` 通过。
  未执行构建、UI 或真实服务回归。

#### 第二批交付：SFTP 跨进程契约

- 传输请求、取消、冲突决策、进度及结果事件，以及 SFTP 目录/编辑/属性查询，
  统一使用 `shared/ipc/sftp.ts`。渲染端 API 继承共享定义，preload 按通道绑定实现；
  主进程 handler 的参数和 Promise 返回值同样接受编译检查。
- 移除 preload、渲染端接口和传输 handler 中重复的 SFTP 参数声明。
  UI、MCP 发出的传输事件及 SSH 冲突提示复用同一事件载荷。
- 保持 IPC 通道名、API 方法名、参数顺序、send/invoke 语义、事件解绑及现有运行时校验；
  不修改传输队列、冲突归属、取消或重试策略，也不引入依赖。
- 新增独立契约类型检查，负例覆盖错误参数、返回值、错误通道类别与事件载荷，
  并随现有 typecheck/build/CI 执行。Electron 原始接口的 `any` 不再泄漏至 SFTP 调用方；
  这不是运行时 schema 校验，也不代表其他域的 IPC 已迁移。
- 新增 preload 回归覆盖实际桥接暴露、全部 SFTP 通道映射、参数顺序、返回/拒绝透传、
  事件过滤与单独解绑；与现有 SFTP/AI 传输回归合计 14 个文件、94 项通过。
- renderer/main 类型检查、15 个契约类型反例及相应正例、完整 lint 均通过。
  传输 UI 回归通过（18 个布局场景及取消、跨会话隔离、离开面板后完成等流程），
  `npm run build` 通过。构建后的 preload 在隔离 mock Electron 环境中成功暴露原有
  324 个 API，SFTP send/invoke 冒烟通过。
- 现有 `check-main-load.mjs` 的 TDZ 检查通过；它在普通 Node 中遇到 Electron 专属 API
  不可用后退出，不能视为完整桌面启动验收。本轮未访问真实 SSH/数据库/模型服务。

#### 第三批交付：服务装配与退出生命周期

- `main.ts` 调用 `application/deferredServices.ts` 装配延迟服务；AI 执行服务、巡检
  调度器和通知器由 application 工厂构造，IPC 注册函数只接收现成实例。
  调度器的 start 由装配层调用，SSH / Docker / DB 继续各自管理连接；新增 ESLint
  规则阻止生产服务和 IPC 反向依赖装配层，并用内存正反例检查该约束。
  DB 驱动的既有异步断连与隧道立即关闭策略保持不变。
- 退出先封闭 AI/MCP/巡检 IPC 接单、取消流式请求/后台续答/巡检/Webhook 并停止
  HTTP 入口和监控，再以共用的 5 秒预算等待这些服务已接请求、最终回复保存和临时资源收尾。
  随后封闭后续保存和审计回调、强制释放残留 HTTP socket、关闭 Docker/SSH/DB
  和会话日志；SQLite 最终在恢复退出后的 `will-quit` 关闭。
- 超时会记录错误并继续退出，不保证忽略取消的外部任务完成；保留最后成功保存的
  checkpoint，下一次启动仍沿用既有中断恢复。附件异步保存持有原数据库实例，
  不会在该实例关闭后提交；数据库迁移迟到也不能重新发布已关闭的存储。
- 迁移、动态导入、主题和初始 store 就绪后均检查退出状态，避免退出后再注册
  handler、开窗或启动后台监控。HTTP 设置操作串行执行，stop/dispose 使迟到的
  token/listen 启动失效；macOS 全窗口关闭仍保留可恢复的应用生命周期。
- 更新下载确认继续优先拦截退出；确认尚未完成时，重复退出同样被拦截。
  一旦进入正式退出收尾，恢复退出不会被新的下载状态再次拦截。
- 新增退出顺序、5 秒超时、重复退出、迁移/导入/主题迟到、回复最终落盘、后台续答、
  Webhook 释放、HTTP 取消和监听竞态回归。并行巡检等待所有主机的 finally 收尾，
  避免一台主机取消后调度器提前释放执行槽。
- 验证：renderer/main/契约 typecheck、完整 lint（83 个架构正反例）和生产构建通过。
  最终固定版本全量单测单次通过：334 个文件、2422 项通过、1 项跳过；另对
  11 个生命周期相关测试文件执行严格 TypeScript 检查，诊断为 0。
  构建产物在隔离 mock Electron 中完成初始装配与 ready 前退出，没有开窗或启动
  业务服务；普通 Node 加载检查仅确认未触发 TDZ，不代表完整桌面启动。
  本轮未执行 UI、安装包或真实 SSH/数据库/模型服务验收。

整体进度：第一、二、三批已实现；巡检面板/App 职责治理仍待后续交付。
