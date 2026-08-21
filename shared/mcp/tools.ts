import type { SshMcpToolDefinition } from './types'

const EMPTY_OBJECT = {
  type: 'object',
  properties: {},
  additionalProperties: false,
} as const

const SESSION_ID = {
  type: 'string',
  description: 'Open SSH session id from list_sessions or connect.',
} as const

const REMOTE_PATH = {
  type: 'string',
  description: 'Absolute remote path. Parent-directory segments (`..`) are rejected.',
} as const

const LOCAL_PATH = {
  type: 'string',
  description:
    'Absolute path on the machine running LiteConnect (the operator PC). Parent-directory segments are rejected.',
} as const

export const SSH_MCP_TOOLS: SshMcpToolDefinition[] = [
  {
    name: 'list_connections',
    title: 'List saved SSH connections',
    description:
      'List saved SSH hosts (id, name, host, port, username, group). Never includes passwords or keys. Use connect with a connection id to open a session. For a saved group, call list_groups then exec with group.',
    inputSchema: EMPTY_OBJECT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'list_groups',
    title: 'List connection groups',
    description:
      'List saved connection groups with member connection ids and how many currently have an open session. Pass group (id or name) to exec to fan out a command across open sessions in that group.',
    inputSchema: EMPTY_OBJECT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'list_sessions',
    title: 'List open SSH sessions',
    description:
      'List currently connected SSH sessions with health (healthy, lastToolAt, idleMs, hasSftp). Use connect if a host is missing. Use disconnect to close a session from the agent — do not leave unused sessions open.',
    inputSchema: EMPTY_OBJECT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'connect',
    title: 'Connect a saved SSH host',
    description:
      'Open an SSH session for a host already saved in LiteConnect. Pass connectionId from list_connections (preferred) or an exact saved name. Uses stored credentials; do not supply passwords. If that host is already connected, returns the existing sessionId. After success, use the returned sessionId for exec/read_file/write_file. The user may need to confirm a host key in the app UI.',
    inputSchema: {
      type: 'object',
      properties: {
        connectionId: {
          type: 'string',
          description: 'Saved connection UUID from list_connections.',
        },
        name: {
          type: 'string',
          description: 'Exact saved connection name, used only when connectionId is omitted.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'disconnect',
    title: 'Disconnect SSH session(s)',
    description:
      'Close open SSH sessions and remove their tabs in LiteConnect. Pass sessionId / sessionIds, or idleMs (milliseconds, minimum 60000) to close sessions that have had no MCP tool activity for at least that long. Always disconnect when you are done so sessions do not pile up.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        sessionIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Multiple session ids to close.',
        },
        idleMs: {
          type: 'integer',
          description:
            'If set (min 60000) without specific ids, close every session whose idleMs is greater than or equal to this value.',
        },
      },
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'exec',
    title: 'Run a remote command',
    description:
      'Run a non-interactive command (separate exec channel, not a PTY / user terminal). Not suitable for prompts that wait for a TTY. Feed a one-shot answer with stdin, or use noninteractive flags (e.g. DEBIAN_FRONTEND=noninteractive). sessionId from list_sessions/connect, or fan out with sessionIds / group. Foreground timeout 1s–10min (default 30s). For deploys/imports longer than a minute set background=true and poll get_job. Destructive/privileged commands are denied unless policy allows them.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        sessionIds: {
          type: 'array',
          items: { type: 'string' },
          description: 'Fan-out: run the same command on these open sessions (max 32).',
        },
        group: {
          type: 'string',
          description: 'Fan-out: group id or exact group name from list_groups. Default: only already-open sessions.',
        },
        connectMissing: {
          type: 'boolean',
          description: 'When fanning out by group/connection, connect hosts that have no open session. Default false.',
        },
        command: {
          type: 'string',
          description: 'Remote command. No NUL bytes. Max 5000 characters.',
        },
        stdin: {
          type: 'string',
          description: 'Bytes written to the command stdin, then EOF. Max 64 KiB. Not an interactive shell.',
        },
        timeoutMs: {
          type: 'integer',
          description: 'Foreground timeout in milliseconds (1000–600000). Default 30000. Ignored for background jobs (use jobTimeoutMs).',
        },
        background: {
          type: 'boolean',
          description: 'If true, return jobId(s) immediately. Poll get_job / list_jobs; cancel with cancel_job.',
        },
        jobTimeoutMs: {
          type: 'integer',
          description: 'Background job timeout in milliseconds (1000–7200000). Default 1800000 (30 min).',
        },
        concurrency: {
          type: 'integer',
          description: 'Fan-out concurrency (1–8). Default 4.',
        },
      },
      required: ['command'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'list_jobs',
    title: 'List background exec jobs',
    description: 'List recent background exec jobs (running and finished). Use get_job for full stdout/stderr.',
    inputSchema: EMPTY_OBJECT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'get_job',
    title: 'Get a background exec job',
    description: 'Return status and capped stdout/stderr for a background exec job from exec(background=true).',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job id returned by exec(background=true).' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'cancel_job',
    title: 'Cancel a background exec job',
    description: 'Abort a running background exec job and destroy its SSH exec channel.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', description: 'Job id returned by exec(background=true).' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'read_file',
    title: 'Read a remote file',
    description:
      'Read a remote file over SFTP. Large files are not rejected: pass offset/length to page through them (max 256 KiB per call). Response includes size, eof, and nextOffset. encoding=utf8 (default) or base64.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        path: REMOTE_PATH,
        offset: {
          type: 'integer',
          description: 'Byte offset to start reading (default 0).',
        },
        length: {
          type: 'integer',
          description: 'Max bytes to return (1–262144). Default 262144.',
        },
        encoding: {
          type: 'string',
          enum: ['utf8', 'base64'],
          description: 'Decode as UTF-8 text or return raw bytes as base64. Default utf8.',
        },
      },
      required: ['sessionId', 'path'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: 'write_file',
    title: 'Write a remote file',
    description:
      'Create or overwrite a remote file over SFTP. Max 256 KiB per call. encoding=utf8 (default) or base64. Use upload_file for larger local files on the operator PC. Parent directories must already exist.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        path: REMOTE_PATH,
        content: {
          type: 'string',
          description: 'File contents (utf8 text or base64, matching encoding).',
        },
        encoding: {
          type: 'string',
          enum: ['utf8', 'base64'],
          description: 'Default utf8.',
        },
      },
      required: ['sessionId', 'path', 'content'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'download_file',
    title: 'Download a remote file to the operator PC',
    description:
      'SFTP-download a remote file to an absolute local path on the machine running LiteConnect. Max 64 MiB. Use this for logs, configs, and artifacts instead of base64-in-exec.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        remotePath: REMOTE_PATH,
        localPath: LOCAL_PATH,
      },
      required: ['sessionId', 'remotePath', 'localPath'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'upload_file',
    title: 'Upload a local file to the remote host',
    description:
      'SFTP-upload an absolute local file from the machine running LiteConnect to a remote path. Max 64 MiB. Use this for deploy packages instead of piping base64 through exec.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        localPath: LOCAL_PATH,
        remotePath: REMOTE_PATH,
      },
      required: ['sessionId', 'localPath', 'remotePath'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'list_dir',
    title: 'List a remote directory',
    description: 'List entries in a remote directory over SFTP. Results are capped at 400 entries.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        path: REMOTE_PATH,
      },
      required: ['sessionId', 'path'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: 'stat_path',
    title: 'Stat a remote path',
    description: 'Return size, mode, and timestamps for a remote path over SFTP.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        path: REMOTE_PATH,
      },
      required: ['sessionId', 'path'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: 'tail_file',
    title: 'Read the last lines of a remote file',
    description:
      'Return the last N lines of a remote file over SFTP (default 100, max 2000, also capped at 256 KiB). This is a snapshot, not a follow/-f stream. For a long-running follow, use exec with background=true and a bounded command.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        path: REMOTE_PATH,
        lines: {
          type: 'integer',
          description: 'Number of lines from the end (1–2000). Default 100.',
        },
      },
      required: ['sessionId', 'path'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
  {
    name: 'service_control',
    title: 'systemd service status or lifecycle',
    description:
      'Run a bounded systemctl action on an open session. action=status is read-only. start/stop/restart/reload follow the same destructive policy as exec (denied by default). Unit names are restricted to [A-Za-z0-9:._@-]. This is not an interactive prompt.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        unit: {
          type: 'string',
          description: 'systemd unit name, e.g. nginx.service or sshd.',
        },
        action: {
          type: 'string',
          enum: ['status', 'start', 'stop', 'restart', 'reload'],
          description: 'Default status.',
        },
      },
      required: ['sessionId', 'unit'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'pty_open',
    title: 'Open an agent PTY shell',
    description:
      'Open a dedicated interactive PTY on an already-connected SSH session (a second shell channel, not the user-visible terminal). Use pty_write / pty_read / pty_resize / pty_close. This is how agents drive installers, prompts, and TUIs over MCP (poll, not a live stream). Bypasses exec command classification — only use on hosts you already connected. Max 2 PTYs per SSH session. Call pty_close when done.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
        cols: { type: 'integer', description: 'Terminal columns (default 120, max 300).' },
        rows: { type: 'integer', description: 'Terminal rows (default 40, max 80).' },
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'pty_write',
    title: 'Write to an agent PTY',
    description:
      'Send bytes to the PTY stdin. Default appends CR (Enter) if missing. raw=true sends exactly what you pass — use for arrows (\\u001b[A), Ctrl-C (\\u0003), Tab, space. Then pty_read with waitForIdleMs to see the new screen.',
    inputSchema: {
      type: 'object',
      properties: {
        ptyId: { type: 'string', description: 'Id from pty_open.' },
        data: { type: 'string', description: 'Text or control characters to send. Max 16 KiB.' },
        raw: {
          type: 'boolean',
          description: 'If true, do not append CR. Default false.',
        },
      },
      required: ['ptyId', 'data'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'pty_read',
    title: 'Read from an agent PTY',
    description:
      'Poll PTY output. mode=streaming returns and consumes new bytes (ANSI kept). mode=snapshot is the recent raw buffer without consuming. mode=screen is the AI-native view: rendered text grid as a human would see (prompts, htop, menus). waitForIdleMs (0–5000) waits for that many ms of silence first.',
    inputSchema: {
      type: 'object',
      properties: {
        ptyId: { type: 'string', description: 'Id from pty_open.' },
        mode: {
          type: 'string',
          enum: ['streaming', 'snapshot', 'screen'],
          description: 'Default streaming.',
        },
        waitForIdleMs: {
          type: 'integer',
          description: 'Wait for silence before reading (0–5000). Default 0.',
        },
        maxBytes: {
          type: 'integer',
          description: 'Max bytes for streaming/snapshot (default 65536).',
        },
      },
      required: ['ptyId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'pty_resize',
    title: 'Resize an agent PTY',
    description: 'Change the PTY rows/cols (e.g. before starting a TUI).',
    inputSchema: {
      type: 'object',
      properties: {
        ptyId: { type: 'string', description: 'Id from pty_open.' },
        cols: { type: 'integer', description: 'Columns (1–300).' },
        rows: { type: 'integer', description: 'Rows (1–80).' },
      },
      required: ['ptyId', 'cols', 'rows'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    },
  },
  {
    name: 'pty_close',
    title: 'Close an agent PTY',
    description: 'Destroy the agent PTY channel. Does not disconnect the SSH session or the user terminal.',
    inputSchema: {
      type: 'object',
      properties: {
        ptyId: { type: 'string', description: 'Id from pty_open.' },
      },
      required: ['ptyId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'pty_list',
    title: 'List agent PTYs',
    description: 'List open agent PTY shells (ptyId, sessionId, size, idle).',
    inputSchema: EMPTY_OBJECT,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false,
      idempotentHint: true,
    },
  },
  {
    name: 'get_metrics',
    title: 'Get cached host metrics',
    description:
      'Return the latest cached CPU/memory/disk/process snapshot for an open session. Requires the in-app monitor to have been started; otherwise use exec with df/free/uptime.',
    inputSchema: {
      type: 'object',
      properties: {
        sessionId: SESSION_ID,
      },
      required: ['sessionId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
      idempotentHint: true,
    },
  },
]

export function sshMcpToolsAsOpenAiFunctions(): Array<{
  type: 'function'
  function: { name: string; description: string; parameters: Record<string, unknown> }
}> {
  return SSH_MCP_TOOLS.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }))
}
