# LiteConnect Architecture

## Layers

```text
UI (components / views)
  → composables (orchestration, Vue state)
    → domain (pure types & domain helpers)
    → utils/<domain> (pure helpers)
      → shared/ (main + renderer pure logic, no Electron/DOM)
```

**Main process** is organized by service domain under `electron/` (`ssh`, `docker`, `db`, `ipc`, `store`, `window`). `electron/main.ts` is the only composition root.

## Electron directory map

| Area | Path | Owns |
|------|------|------|
| Composition root | `electron/main.ts` | Wire stores/services/IPC; teardown order |
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

Import the real subpath (e.g. `ssh/trust/knownHosts`, `db/tunnel/sshTunnel`). Root-level re-export shells were removed.

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
| `electron/mcp` | `docker`, `db`, `ai` | MCP may import `ssh` types/`sessionExec`; only `bind.ts` should take `SSHManager` |
| `electron/ai` | `ssh`, `docker`, `db` | AI tools go through MCP runtime |
| `electron/store` | `ssh`, `docker`, `mcp`, `ai` | persistence stays below services |

Also: `src/composables/**` must not import `*.vue` SFCs (`no-restricted-imports`).

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
| AI | `components/ai`, `composables/ai` | Chat sidebar |
| Settings | `components/settings`, `composables/settings` | Settings panels |
| Shared UI | `composables/shared`, `utils/shared` | Cross-cutting pure/UI helpers |

## Dependency rules

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
| `mcp/*` | SSH tool schemas, command classification, output truncation |
| `mcp/bashParse.ts` | Bash AST → flat command list (pure; the parser is injected) |

Renderer `Window.LiteConnect` lives in `src/types/liteConnectApi.ts`. `src/env.d.ts` only declares `Window` and re-exports shared types.

AI chat IPC wiring is `electron/ipc/registerAiHandlers.ts`; HTTP/parse lives in `electron/ai/providerHttp.ts`, session persistence in `electron/ai/historyStore.ts`, tool loop in `electron/ai/chatStream.ts`. `electron/mcp/bashParser.ts` installs the wasm bash parser into `shared/mcp/classify.ts` at startup (started from `electron/main.ts`, awaited in `SshMcpRuntime.call`); the grammar is vendored at `shared/mcp/vendor/tree-sitter-bash.wasm` and copied next to `main.js` by `scripts/copy-bash-wasm.mjs`. `electron/ai/commandFloor.ts` is the escalate-only floor that stops a model from labelling a destructive command as `read`.

All main-process application data is stored in `liteconnect.sqlite`, managed by `electron/store/appDatabase.ts`. The database uses WAL, foreign-key enforcement, full synchronous commits, schema versions, and transactional legacy migration. Collection rows are updated only when their order or payload changes. JSON/JSONL remains an import/export format and a one-time upgrade source, not a live application store.

Settings IPC is composed from `electron/ipc/settings/*.ts`. New settings go through `settings:getAll` / `settings:setMany` (`AppSettingsAll` + `SettingsStore.applyMany`), not a new one-off get/set channel.
`electron/store/settingsPatch.ts` owns the synchronous validation and normalization for `setMany`; `SettingsStore` owns persistence and the public getter/setter API.
`electron/store/aiSettingsService.ts` owns AI provider normalization, model selection, and resolved runtime configuration. `electron/store/settingsSecrets.ts` holds the Electron safeStorage boundary shared by AI keys and the MCP HTTP token; `SettingsStore` retains migration and persistence ownership.

SSH MCP tool implementations live under `electron/mcp/tools/` (sessions, exec, sftp, pty, service). `electron/mcp/runtime.ts` is dispatch + session guards.
Interactive SSH connection authentication, keyboard prompts, and host-verifier configs live in `electron/ssh/connectionAuth.ts`; X11 readiness policy lives in `electron/ssh/connectionX11.ts`. `ConnectionService` retains session generation, shell, jump transport, and resource cleanup. Single-file SFTP stream execution lives in `electron/ssh/transfer/fileTransfer.ts`; `TransferRunner` retains transfer registration, cancellation, and directory-job orchestration.

DB query-tab run/export orchestration is `src/composables/database/useDbQueryRun.ts` and `useDbResultExport.ts`. Engine metadata/browse SQL lives in `electron/db/drivers/{postgres,mysql,oracle}Browse.ts` (class files stay the `DbDriver` entry and keep a private `warmExactCount` wrapper for tests).
`DatabaseView.vue` loads `DbQueryTab.vue` (including CodeMirror) and `DbTableWorkspace.vue` only when the corresponding tab is opened; the database shell remains a separate lazy view from `App.vue`.

App-shell wiring extracted from `App.vue`: snippet hotkeys (`useSnippetHotkeys`), Docker SSH session listeners (`useDockerSshBridge`), SFTP/batch toasts (`useTransferToasts`).
Terminal split pane geometry lives in `src/utils/terminal/splitPaneLayout.ts`, split shortcuts in `useTerminalSplitKeyboard.ts`, and xterm input classification/writes in `useTerminalUserInput.ts`. Terminal components keep mounted xterm instances and visual coordination.
`src/composables/app/useAppWindowRouting.ts` owns launch URL parsing and SSH/DB window entry policy; `App.vue` remains the composition root.

MySQL streaming row caps and connection discard behavior live in `electron/db/drivers/mysqlQueryStream.ts`; PostgreSQL result mapping and cursor reads live in `postgresQueryExecution.ts`. Driver classes retain the query/session lifecycle and cancellation state.

AI sidebar context-file availability checks live in `src/composables/ai/useAiContextFileStatus.ts`; its scoped presentation rules live in `src/components/ai/AiSidebar.css`.
AI sidebar history filtering and mutations live in `src/composables/ai/useAiSidebarHistory.ts`.
AI chat message footer display and controls live in `src/components/ai/AiMessageFooter.vue`; `AiChatView.vue` keeps scroll and timeline coordination, with scoped rules in `AiChatView.css`.
SFTP bookmark dialogs and mutations live in `src/composables/sftp/useSftpBookmarkActions.ts`; `FileSidebar.vue` keeps navigation sequencing and uses `FileSidebar.css` for scoped presentation rules.

UI-only helpers stay in `src/utils/**`, never in `shared/`.

## Intentional coupling (keep)

- Docker → SSH via `DockerSshBackend` / `DockerSessionHost` (adapter in `docker/sshSessionHost.ts`; no `electron/ssh` import)
- DB tunnel auth via injected stores + independent tunnel client
- SFTP path follow via terminal PWD tracker / pause helpers
- Window close → disconnect owned SSH sessions (composition root)
- SSH MCP runtime → interactive `SSHManager` sessions only (not Docker sock, not DB tunnels)
- MCP HTTP gateway (optional) → same runtime; loopback + Bearer only; default off

## Out of scope for casual refactors

- Preload channel names / `window.LiteConnect` shape
- Routing DB tunnels through interactive `SSHManager` sessions
- Flattening `electron/docker` (already well factored)
