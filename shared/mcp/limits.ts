/** Agent-facing exec / SFTP limits. Stricter than renderer IPC. */

export const MCP_MAX_COMMAND_CHARS = 5_000
export const MCP_MAX_STDOUT_CHARS = 128 * 1024
export const MCP_MAX_STDERR_CHARS = 64 * 1024
/** Hard cap inside the exec collector so a runaway stream cannot OOM main. */
export const MCP_EXEC_HARD_CAP_CHARS = 1_024 * 1024
/** Default/max slice for read_file. Agents page with startLine; do not dump whole files. */
export const MCP_READ_DEFAULT_LINES = 200
export const MCP_READ_MAX_LINES = 500
export const MCP_READ_MAX_LINE_CHARS = 2_000
export const MCP_READ_MAX_BYTES = 50 * 1024
/** What we actually hand the model after any tool. Longer output is cut and the model is told to page/grep. */
export const MCP_AI_RESULT_MAX_CHARS = 32 * 1024
export const MCP_AI_RESULT_MAX_LINES = 200
export const MCP_READ_CHUNK_BYTES = 8 * 1024
export const MCP_MAX_READ_FILE_BYTES = MCP_READ_MAX_BYTES
export const MCP_MAX_WRITE_FILE_BYTES = 256 * 1024
export const MCP_GREP_MAX_MATCHES = 100
export const MCP_GREP_MAX_LINE_CHARS = 2_000
export const MCP_GLOB_MAX_RESULTS = 100
export const MCP_SEARCH_TIMEOUT_MS = 15_000
export const MCP_SEARCH_PATTERN_MAX = 200
export const MCP_MAX_STDIN_CHARS = 64 * 1024
export const MCP_MAX_TRANSFER_BYTES = 64 * 1024 * 1024
export const MCP_MAX_DIR_ENTRIES = 400
export const MCP_DEFAULT_TIMEOUT_MS = 30_000
export const MCP_MIN_TIMEOUT_MS = 1_000
/** Foreground exec: enough for short deploys; use background for longer work. */
export const MCP_MAX_TIMEOUT_MS = 600_000
export const MCP_DEFAULT_JOB_TIMEOUT_MS = 30 * 60 * 1000
export const MCP_MAX_JOB_TIMEOUT_MS = 2 * 60 * 60 * 1000
export const MCP_MAX_JOBS = 64
export const MCP_JOB_TTL_MS = 15 * 60 * 1000
export const MCP_MAX_FANOUT = 32
export const MCP_DEFAULT_FANOUT_CONCURRENCY = 4
export const MCP_MAX_FANOUT_CONCURRENCY = 8
export const MCP_MIN_IDLE_DISCONNECT_MS = 60_000
export const MCP_TAIL_DEFAULT_LINES = 100
export const MCP_TAIL_MAX_LINES = 2_000
export const MCP_TAIL_MAX_BYTES = 256 * 1024
export const MCP_SERVICE_UNIT_MAX = 128
export const MCP_PTY_DEFAULT_COLS = 120
export const MCP_PTY_DEFAULT_ROWS = 40
export const MCP_PTY_MAX_COLS = 300
export const MCP_PTY_MAX_ROWS = 80
export const MCP_PTY_MAX_PER_SESSION = 2
export const MCP_PTY_BUFFER_CHARS = 256 * 1024
export const MCP_PTY_WRITE_MAX_CHARS = 16 * 1024
export const MCP_PTY_IDLE_MS = 10 * 60 * 1000
export const MCP_PTY_WAIT_IDLE_MAX_MS = 5_000
export const MCP_PTY_READ_TIMEOUT_MS = 8_000

export const MCP_HTTP_DEFAULT_PORT = 17420
export const MCP_HTTP_MIN_PORT = 1024
export const MCP_HTTP_MAX_PORT = 65535
export const MCP_HTTP_RATE_LIMIT = 120
export const MCP_HTTP_RATE_WINDOW_MS = 60_000
export const MCP_HTTP_MAX_BODY_BYTES = 1_048_576

export function sanitizeMcpHttpPort(raw: unknown): number {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return MCP_HTTP_DEFAULT_PORT
  const n = Math.floor(raw)
  if (n < MCP_HTTP_MIN_PORT || n > MCP_HTTP_MAX_PORT) return MCP_HTTP_DEFAULT_PORT
  return n
}
