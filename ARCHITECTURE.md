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

Import the real subpath (e.g. `ssh/trust/knownHosts`, `db/tunnel/sshTunnel`). Root-level re-export shells were removed.

## Enforced boundaries (ESLint)

```bash
npm run lint   # architecture-focused ESLint (dependency zones)
```

`import/no-restricted-paths` zones (see `eslint.config.js`):

| Zone | Forbidden import | Why |
|------|------------------|-----|
| `src/utils/**` | `composables`, `components`, `views` | pure helpers stay below UI |
| `src/domain/**` | `composables`, `components`, `views` | domain models stay pure |
| `shared/**` | `src/**`, `electron/**` | dual-process pure only |
| `electron/**` | `src/**` | main ↛ renderer |
| `src/**` | `electron/**` | renderer ↛ main (use preload IPC) |

Also: `src/composables/**` must not import `*.vue` SFCs (`no-restricted-imports`).

## Renderer directory map

| Area | Path | Owns |
|------|------|------|
| App shell | `components/app`, `composables/app` | Titlebar, dialogs, theme, navigation, security UI |
| SSH workspace | `components/workspace`, `composables/workspace` | `SshWorkspace`, sidebars, panel exclusivity |
| Connections | `components/connections`, `composables/connections` | Host list, groups, batch test |
| Session | `composables/session`, `domain/session`, `utils/session` | Session graph, reconnect, display helpers |
| Terminal | `components/terminal`, `composables/terminal`, `utils/terminal` | xterm, paste, shell suggest |
| SFTP | `components/sftp`, `composables/sftp`, `utils/sftp` | File browser, transfers |
| Docker | `components/docker`, `composables/docker`, `utils/docker` | Containers, logs, exec |
| Database | `components/database`, `composables/database`, `domain/database`, `utils/database` | SQL workspace |
| Monitor | `components/monitor`, `composables/monitor` | Host metrics dock |
| Snippets / batch | `components/snippets`, `composables/snippets`, `utils/snippets` | Command snippets, broadcast |
| AI | `components/ai`, `composables/ai` | Chat sidebar |
| Settings | `components/settings`, `composables/settings` | Settings panels |
| Shared UI | `composables/shared`, `utils/shared` | Cross-cutting pure/UI helpers |

## Dependency rules

1. **`components` → `composables` → `domain` / `utils` → `shared`** only. Never reverse.
2. **`utils/**` must not import `composables/**` or `components/**` (or `*.vue`).
3. **`composables/**` must not import `*.vue` SFCs. Domain types live in `domain/` or `env.d.ts`, not under `components/`.
4. Prefer **`@/`** (renderer) and **`@shared/`** (dual-process pure modules) over deep relative paths.
5. Cross-feature product seams (terminal CWD → SFTP follow, Docker over SSH) should depend on **small types/ports**, not peer feature internals.

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
| `sqlReadOnly.ts` | Read-only SQL classification (main + renderer) |
| `sqlRisk.ts` | Dangerous SQL risk assessment (main + renderer) |
| `dbConnectionUrl.ts` | Connection URL / JDBC / Easy Connect parsing |

UI-only helpers stay in `src/utils/**`, never in `shared/`.

## Intentional coupling (keep)

- Docker → SSH via `DockerSessionHost` interface
- DB tunnel auth via injected stores + independent tunnel client
- SFTP path follow via terminal PWD tracker / pause helpers
- Window close → disconnect owned SSH sessions (composition root)

## Out of scope for casual refactors

- Preload channel names / `window.LiteConnect` shape
- Routing DB tunnels through interactive `SSHManager` sessions
- Flattening `electron/docker` (already well factored)
