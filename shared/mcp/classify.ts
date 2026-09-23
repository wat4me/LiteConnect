import type { BashFlatCommand, BashParseResult } from './bashParse'
import { stripQuotes } from './bashParse'
import { MCP_MAX_COMMAND_CHARS } from './limits'
import type { CommandClass, CommandClassification, CommandUncertainty } from './types'

const CLASS_RANK: Record<CommandClass, number> = {
  'read-only': 0,
  safe: 1,
  destructive: 2,
  privileged: 3,
  forbidden: 4,
}

const READ_ONLY_BINARIES = new Set([
  'ls',
  'dir',
  'pwd',
  'whoami',
  'id',
  'hostname',
  'uname',
  'date',
  'uptime',
  'df',
  'du',
  'free',
  'ps',
  'pgrep',
  'top',
  'vmstat',
  'mpstat',
  'iostat',
  'pidstat',
  'sar',
  'cat',
  'head',
  'tail',
  'less',
  'more',
  'wc',
  'file',
  'stat',
  'readlink',
  'realpath',
  'basename',
  'dirname',
  'find',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'ack',
  'awk',
  'sed',
  'cut',
  'sort',
  'uniq',
  'tr',
  'echo',
  'printf',
  'printenv',
  'which',
  'type',
  'whereis',
  'getent',
  'groups',
  'last',
  'lastlog',
  'who',
  'w',
  'users',
  'ip',
  'ifconfig',
  'ss',
  'netstat',
  'route',
  'ping',
  'traceroute',
  'tracepath',
  'nslookup',
  'dig',
  'host',
  'lscpu',
  'lsmem',
  'lsblk',
  'lsusb',
  'lspci',
  'lsmod',
  'mount',
  'findmnt',
  'dmesg',
  'sysctl',
  'lsb_release',
  'timedatectl',
  'hostnamectl',
  'true',
  'false',
  'test',
  '[',
  ':',
  'nproc',
  'arch',
  'getconf',
  'locale',
  'ulimit',
  'umask',
  'history',
  'alias',
  'jobs',
  'tree',
  'nl',
  'od',
  'hexdump',
  'xxd',
  'md5sum',
  'sha1sum',
  'sha256sum',
  'sha512sum',
  'cksum',
  'diff',
  'cmp',
  'comm',
  'column',
  'paste',
  'expand',
  'unexpand',
  'tac',
  'rev',
  'strings',
  'jq',
  'yq',
  // Shell builtins that only touch the current shell's own state.
  'cd',
  'pushd',
  'popd',
  'dirs',
  'export',
  'unset',
  'set',
  'shopt',
  'let',
  'shift',
  'times',
  'wait',
  'disown',
  'sleep',
  'declare',
  'local',
  'readonly',
  'typeset',
  'enable',
  'hash',
])

/** Shells whose `-c` payload we re-parse; anything else about them is handled by bashParse. */
const SHELL_BINARIES = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'ash', 'csh', 'tcsh', 'fish'])

/** Public policy catalogue used by Settings so the UI cannot drift from the classifier. */
export const MCP_PRIVILEGE_WRAPPER_NAMES = ['sudo', 'doas', 'pkexec', 'su', 'runuser'] as const

const PRIVILEGE_WRAPPERS = new Set<string>(MCP_PRIVILEGE_WRAPPER_NAMES)

const TRANSPARENT_WRAPPERS = new Set([
  'env',
  'nohup',
  'time',
  'timeout',
  'nice',
  'ionice',
  'setsid',
  'stdbuf',
  'command',
  'builtin',
  'exec',
  'xargs',
])

/** Binaries classified as destructive unless a more specific read-only rule matches first. */
export const MCP_DESTRUCTIVE_BINARY_NAMES = [
  'rm',
  'rmdir',
  'unlink',
  'shred',
  'wipe',
  'srm',
  'mkfs',
  'mke2fs',
  'mkfs.ext4',
  'mkfs.xfs',
  'mkfs.btrfs',
  'mkswap',
  'dd',
  'chmod',
  'chown',
  'chgrp',
  'chattr',
  'setfacl',
  'kill',
  'killall',
  'pkill',
  'skill',
  'truncate',
  'fallocate',
  'useradd',
  'userdel',
  'usermod',
  'groupadd',
  'groupdel',
  'passwd',
  'chpasswd',
  'visudo',
  'umount',
  'swapon',
  'swapoff',
  'fdisk',
  'parted',
  'gdisk',
  'wipefs',
  'partprobe',
  'losetup',
  'cryptsetup',
  'lvremove',
  'vgremove',
  'pvremove',
  'iptables',
  'ip6tables',
  'nft',
  'ufw',
  'firewall-cmd',
  'reboot',
  'shutdown',
  'halt',
  'poweroff',
  'telinit',
  'init',
  'systemctl',
  'service',
  'journalctl',
  'crontab',
  'at',
  'tee',
  'install',
  'mv',
] as const

const DESTRUCTIVE_BINARIES = new Set<string>(MCP_DESTRUCTIVE_BINARY_NAMES)

const SAFE_BINARIES = new Set([
  'mkdir',
  'touch',
  'cp',
  'ln',
  'git',
  'npm',
  'yarn',
  'pnpm',
  'pip',
  'pip3',
  'make',
  'cmake',
  'cargo',
  'go',
  'javac',
  'rustc',
  'gcc',
  'g++',
  'clang',
  'tar',
  'gzip',
  'gunzip',
  'bzip2',
  'xz',
  'unzip',
  'zip',
  'rsync',
  'scp',
  'curl',
  'wget',
  'apt',
  'apt-get',
  'yum',
  'dnf',
  'apk',
  'pacman',
  'brew',
  'docker',
  'podman',
  'kubectl',
  'helm',
  'terraform',
  'ansible',
])

/**
 * Programs that execute code handed to them. We cannot read that code, so the
 * only honest verdict is "ask" — which is also what safecmd and
 * agent-permissions settled on. They used to sit in `SAFE_BINARIES`, where a
 * single `python3 -c "import shutil; shutil.rmtree('/')"` rode through `auto`.
 */
/** Interpreters whose script body must be inspectable before it can run without a gate. */
export const MCP_INTERPRETER_NAMES = [
  'python',
  'python2',
  'python3',
  'perl',
  'ruby',
  'php',
  'node',
  'nodejs',
  'lua',
  'luajit',
  'tclsh',
  'wish',
  'osascript',
  'deno',
  'bun',
  'rscript',
  'julia',
  'groovy',
] as const

const INTERPRETERS = new Set<string>(MCP_INTERPRETER_NAMES)

/** Flags that make an interpreter treat the next token as code. */
const INLINE_CODE_FLAGS = new Set(['-c', '-e', '-E', '-r', '--eval', '--exec'])

/**
 * Flags that only ever print something.
 *
 * A program invoked with nothing but these has no operand to act on, so it
 * cannot reach the filesystem through its arguments. For a program we have no
 * entry for, that is the strongest evidence available — and refusing to use it
 * is what produced cards that accused the model of lying about `nginx -v`.
 *
 * Note the empty case is *not* covered: a bare `reboot`, `shutdown` or `nginx`
 * really does start something, so the flag set must be non-empty.
 */
const INFORMATIONAL_FLAGS = new Set([
  '--version',
  '-version',
  '-V',
  '--help',
  '-help',
  '-h',
  '-?',
  '--usage',
])

function isInformationalProbe(args: string[]): boolean {
  const tokens = args.map(stripQuotes).filter((token) => token.length > 0)
  if (!tokens.length) return false
  if (tokens.every((token) => INFORMATIONAL_FLAGS.has(token.toLowerCase()))) return true
  // `-v` is `--version` for nginx and "verbose" for sshd, so it is not
  // informational in general — but alone it still cannot be pointed at a target.
  return tokens.length === 1 && tokens[0].toLowerCase() === '-v'
}

function hasInlineCode(args: string[]): boolean {
  return args.some((arg) => INLINE_CODE_FLAGS.has(stripQuotes(arg)))
}

/**
 * The directory prefixes a naive write can brick: shell redirects and `tee`
 * into these are treated as forbidden rather than merely destructive.
 */
const CRITICAL_WRITE_PREFIX = /^\/(etc|boot|sys|proc|dev)\//i
const AUTHORIZED_KEYS = /(^|\/)\.ssh\/authorized_keys$/i

const CATASTROPHIC_DELETE_BINARIES = new Set(['rm', 'rmdir', 'shred', 'wipe', 'srm'])
const CATASTROPHIC_TARGETS = new Set([
  '/',
  '/*',
  '/.',
  '~',
  '~/',
  '$home',
  '${home}',
  '/etc',
  '/usr',
  '/var',
  '/boot',
  '/root',
  '/home',
  '/bin',
  '/sbin',
  '/lib',
  '/lib64',
])

const AWK_BINARIES = new Set(['awk', 'gawk', 'mawk', 'nawk'])

/** High-risk patterns. Class `forbidden` means always confirm — not hard-deny. */
const FORBIDDEN_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\brm\s+(-[a-zA-Z]*\s+)*-r[a-zA-Z]*f[a-zA-Z]*\s+\/(\s|\*|\/|\.|$|['"])/i, reason: 'recursive delete of /' },
  { re: /\brm\s+(-[a-zA-Z]*\s+)*-f[a-zA-Z]*r[a-zA-Z]*\s+\/(\s|\*|\/|\.|$|['"])/i, reason: 'recursive delete of /' },
  { re: /\brm\s+-[^\n]*\s+\/\s*$/i, reason: 'delete of /' },
  { re: /\bmkfs(\.|$|\s)/i, reason: 'filesystem format' },
  { re: /\bdd\b[\s\S]*\bof=\/dev\//i, reason: 'raw disk write' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, reason: 'host power action' },
  { re: /\b(init|telinit)\s+[06]\b/i, reason: 'host power action' },
  { re: /\b(curl|wget)\b[\s\S]*\|\s*(ba)?sh\b/i, reason: 'download piped to a shell' },
  { re: /\|\s*(ba)?sh\b/i, reason: 'pipe to a shell' },
  { re: /\|\s*(zsh|dash|ksh|ash|fish|csh|tcsh)\b/i, reason: 'pipe to a shell' },
  { re: /:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;/i, reason: 'fork bomb' },
  { re: /\b(iptables|ip6tables)\s+-F\b/i, reason: 'flush firewall' },
  { re: /\bnft\s+flush\b/i, reason: 'flush firewall' },
  { re: /\bchmod\s+(-[a-zA-Z]*\s+)*777\s+\/(\s|$)/i, reason: 'chmod 777 /' },
  { re: /\bchmod\s+(-[a-zA-Z]*\s+)*-R\b[\s\S]*\s\/(\s|$)/i, reason: 'recursive chmod of /' },
  { re: /\bchown\s+(-[a-zA-Z]*\s+)*-R\b[\s\S]*\s\/(\s|$)/i, reason: 'recursive chown of /' },
  { re: /(>|>>)\s*\/etc\/(passwd|shadow|sudoers|ssh\/sshd_config)\b/i, reason: 'overwrite of a critical file' },
  { re: /(>|>>)\s*[^;\n]*authorized_keys\b/i, reason: 'write to authorized_keys' },
  { re: /\btee\b[\s\S]*authorized_keys\b/i, reason: 'write to authorized_keys' },
  { re: /\bcrontab\s+-(?!l\b)/i, reason: 'replace crontab' },
]

const DESTRUCTIVE_GIT = /\bgit\s+(reset\s+--hard|push\b[^\n]*(?:--force(?:-with-lease|-if-includes)?|-f(?:\s|$)))/i
const DESTRUCTIVE_SED = /\bsed\s+[^\n]*(?:-i(?:\b|[^A-Za-z])|--in-place(?:=|\b))/
const DESTRUCTIVE_FIND = /\bfind\b[\s\S]*\s(-delete|-exec(dir)?\s|-ok(dir)?\s|-f(print|ls)\s)/
const DESTRUCTIVE_RSYNC = /\brsync\b[\s\S]*\s--delete\b/
const AWK_EXECUTES = /\bsystem\s*\(|\|\s*"/
const AWK_WRITES_FILE = /\b(print|printf)\b[^;}\n]*>{1,2}\s*["']/
const DESTRUCTIVE_SYSTEMCTL =
  /\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask|isolate|kill|reset-failed)\b/i
const READONLY_SYSTEMCTL = /\bsystemctl\s+(status|show|cat|is-active|is-enabled|is-failed|list-units|list-unit-files|list-jobs)\b/i
const MUTATING_JOURNALCTL = /\bjournalctl\b[\s\S]*(--vacuum(?:-[a-z]+)?|--rotate|--flush|--sync|--relinquish-var|--smart-relinquish-var)\b/i
const DESTRUCTIVE_DOCKER = /\b(docker|podman)\s+(rm|rmi|kill|stop|run|exec|compose\s+down|system\s+prune)\b/i
const READONLY_DOCKER = /\b(docker|podman)\s+(ps|logs|inspect|images|info|version|stats|top|port|diff)\b/i

const CURL_MUTATING_FLAGS = new Set([
  '-d', '--data', '--data-ascii', '--data-binary', '--data-raw', '--data-urlencode', '--json',
  '-F', '--form', '--form-string', '-T', '--upload-file', '-Q', '--quote', '--ftp-create-dirs',
])
const CURL_LOCAL_WRITE_FLAGS = new Set([
  '-o', '--output', '-O', '--remote-name', '--remote-name-all', '--output-dir', '--create-dirs',
  '-c', '--cookie-jar', '-D', '--dump-header', '--etag-save', '--trace', '--trace-ascii',
])
const CURL_READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS', 'TRACE'])

function normalizedArgs(args: string[]): string[] {
  return args.map((arg) => stripQuotes(arg.trim())).filter(Boolean)
}

function hasFlag(args: string[], flags: Set<string>): boolean {
  return args.some((arg) => {
    const [name] = arg.split('=', 1)
    if (flags.has(name)) return true
    // curl's common short options are often combined (`-sSLo`). Uppercase is meaningful.
    return /^-[^-]{2,}/.test(arg) && [...flags].some((flag) => /^-[A-Za-z]$/.test(flag) && arg.slice(1).includes(flag[1]))
  })
}

function optionValue(args: string[], shortName: string, longName: string): string | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]
    if (arg === shortName || arg === longName) return args[index + 1] ?? ''
    if (arg.startsWith(`${longName}=`)) return arg.slice(longName.length + 1)
    if (shortName && arg.startsWith(shortName) && arg.length > shortName.length) return arg.slice(shortName.length)
  }
  return null
}

function classifyCurl(args: string[]): CommandClassification {
  const tokens = normalizedArgs(args)
  const method = optionValue(tokens, '-X', '--request')?.toUpperCase()
  if (hasFlag(tokens, CURL_MUTATING_FLAGS) || hasFlag(tokens, CURL_LOCAL_WRITE_FLAGS)) {
    return { class: 'safe', binary: 'curl', reason: 'curl sends data or writes a local file' }
  }
  if (method != null && !CURL_READ_METHODS.has(method)) {
    return { class: 'safe', binary: 'curl', reason: `curl ${method || 'custom'} request` }
  }
  if (tokens.includes('-K') || tokens.some((arg) => arg === '--config' || arg.startsWith('--config='))) {
    return { class: 'safe', binary: 'curl', reason: 'curl behavior comes from a config file' }
  }
  return { class: 'read-only', binary: 'curl', reason: 'curl download/HTTP query to stdout' }
}

function classifyWget(args: string[]): CommandClassification {
  const tokens = normalizedArgs(args)
  const method = optionValue(tokens, '', '--method')?.toUpperCase()
  const sendsData = tokens.some((arg) => ['--post-data', '--post-file', '--body-data', '--body-file'].some((flag) => arg === flag || arg.startsWith(`${flag}=`)))
  if (sendsData || (method != null && !CURL_READ_METHODS.has(method))) {
    return { class: 'safe', binary: 'wget', reason: `wget ${method || 'data'} request` }
  }
  const output = optionValue(tokens, '-O', '--output-document')
  const stdoutOnly = output === '-' || output === '/dev/null' || tokens.some((arg) => /^-[^-]*O-$/.test(arg))
  if (tokens.includes('--spider') || stdoutOnly) {
    return { class: 'read-only', binary: 'wget', reason: 'wget probe/output to stdout' }
  }
  return { class: 'safe', binary: 'wget', reason: 'wget writes downloaded content' }
}

function gitSubcommand(args: string[]): { name: string; rest: string[] } {
  const tokens = normalizedArgs(args)
  const valueOptions = new Set(['-C', '-c', '--git-dir', '--work-tree', '--namespace', '--super-prefix'])
  let index = 0
  while (index < tokens.length && tokens[index].startsWith('-')) {
    const option = tokens[index]
    index += valueOptions.has(option) && !option.includes('=') ? 2 : 1
  }
  return { name: (tokens[index] || '').toLowerCase(), rest: tokens.slice(index + 1) }
}

function classifyGit(args: string[]): CommandClassification {
  const { name, rest } = gitSubcommand(args)
  if (rest.some((arg) => arg === '--output' || arg.startsWith('--output='))) {
    return { class: 'safe', binary: 'git', reason: 'git writes an output file' }
  }
  const alwaysRead = new Set([
    'status', 'log', 'diff', 'show', 'shortlog', 'describe', 'rev-parse', 'rev-list', 'ls-files',
    'ls-tree', 'cat-file', 'grep', 'blame', 'count-objects', 'fsck', 'verify-commit', 'verify-tag',
  ])
  if (alwaysRead.has(name)) {
    if (name === 'fsck' && rest.includes('--lost-found')) return { class: 'safe', binary: 'git', reason: 'git fsck writes lost-found objects' }
    return { class: 'read-only', binary: 'git', reason: `git ${name} query` }
  }
  if (name === 'clean') {
    const dryRun = rest.some((arg) => arg === '-n' || arg === '--dry-run' || /^-[^-]*n/.test(arg))
    return { class: dryRun ? 'read-only' : 'destructive', binary: 'git', reason: dryRun ? 'git clean dry run' : 'git clean removes files' }
  }
  if (name === 'branch' && (rest.length === 0 || rest.some((arg) => ['--list', '--show-current', '--contains', '--no-contains', '--merged', '--no-merged'].includes(arg)))) {
    return { class: 'read-only', binary: 'git', reason: 'git branch query' }
  }
  if (name === 'tag' && (rest.length === 0 || rest.some((arg) => ['-l', '--list', '--contains', '--no-contains'].includes(arg)))) {
    return { class: 'read-only', binary: 'git', reason: 'git tag query' }
  }
  if ((name === 'stash' || name === 'worktree') && ['list', 'show'].includes((rest[0] || '').toLowerCase())) {
    return { class: 'read-only', binary: 'git', reason: `git ${name} query` }
  }
  if (name === 'remote' && (rest.length === 0 || rest.some((arg) => ['-v', '--verbose', 'show', 'get-url'].includes(arg)))) {
    return { class: 'read-only', binary: 'git', reason: 'git remote query' }
  }
  if (name === 'config' && rest.some((arg) => ['--get', '--get-all', '--get-regexp', '--list', '-l'].includes(arg))) {
    return { class: 'read-only', binary: 'git', reason: 'git config query' }
  }
  return { class: 'safe', binary: 'git', reason: 'git mutation or network operation' }
}

function firstNonOption(args: string[]): string {
  return normalizedArgs(args).find((arg) => !arg.startsWith('-'))?.toLowerCase() || ''
}

function classifyPackageManager(binary: string, args: string[]): CommandClassification | null {
  const subcommand = firstNonOption(args)
  const readCommands: Record<string, Set<string>> = {
    npm: new Set(['list', 'ls', 'view', 'info', 'show', 'search', 'outdated', 'root', 'prefix', 'bin', 'whoami', 'ping', 'fund']),
    yarn: new Set(['list', 'info', 'why', 'outdated', 'search']),
    pnpm: new Set(['list', 'ls', 'why', 'view', 'info', 'search', 'outdated', 'root']),
    pip: new Set(['list', 'show', 'check', 'freeze', 'index', 'debug']),
    pip3: new Set(['list', 'show', 'check', 'freeze', 'index', 'debug']),
    apt: new Set(['list', 'show', 'search', 'policy']),
    'apt-get': new Set(['check']),
    yum: new Set(['list', 'info', 'search', 'check-update', 'repolist']),
    dnf: new Set(['list', 'info', 'search', 'check-update', 'repolist']),
    apk: new Set(['info', 'search', 'list', 'version', 'policy']),
    brew: new Set(['list', 'info', 'search', 'outdated', 'deps', 'uses', 'config']),
  }
  const commands = readCommands[binary]
  if (!commands) return null
  if (commands.has(subcommand)) return { class: 'read-only', binary, reason: `${binary} metadata query` }
  return null
}

function classifyAdminQuery(binary: string, args: string[]): CommandClassification | null {
  const tokens = normalizedArgs(args).map((arg) => arg.toLowerCase())
  if (binary === 'sysctl') {
    const mutates = tokens.some((arg) => ['-w', '--write', '-p', '--load', '--system'].includes(arg) || arg.startsWith('--load=') || /^[^-=]+=[\s\S]*$/.test(arg))
    return { class: mutates ? 'destructive' : 'read-only', binary, reason: mutates ? 'sysctl writes kernel settings' : 'sysctl query' }
  }
  if (binary === 'timedatectl') {
    const query = new Set(['status', 'show', 'timesync-status', 'show-timesync', 'list-timezones'])
    const operands = tokens.filter((arg) => !arg.startsWith('-'))
    const reads = operands.length === 0 || query.has(operands[0])
    return { class: reads ? 'read-only' : 'destructive', binary, reason: reads ? 'timedatectl query' : 'timedatectl changes host settings' }
  }
  if (binary === 'hostnamectl') {
    const operands = tokens.filter((arg) => !arg.startsWith('-'))
    const reads = operands.length === 0 || (operands[0] === 'status' && operands.length === 1)
    return { class: reads ? 'read-only' : 'destructive', binary, reason: reads ? 'hostnamectl query' : 'hostnamectl changes host settings' }
  }
  if (binary === 'systemctl') {
    const mutating = new Set(['start', 'stop', 'restart', 'reload', 'enable', 'disable', 'mask', 'unmask', 'isolate', 'kill', 'reset-failed'])
    const reading = new Set(['status', 'show', 'cat', 'is-active', 'is-enabled', 'is-failed', 'list-units', 'list-unit-files', 'list-jobs'])
    if (tokens.some((arg) => mutating.has(arg))) return { class: 'destructive', binary, reason: 'systemctl mutation' }
    if (tokens.some((arg) => reading.has(arg))) return { class: 'read-only', binary, reason: 'systemctl status/query' }
    return { class: 'destructive', binary, reason: 'systemctl (not a query)' }
  }
  if (binary === 'ip') {
    const mutates = tokens.some((arg) => ['add', 'delete', 'del', 'set', 'change', 'replace', 'flush', 'append', 'prepend', 'update', 'remove', 'exec'].includes(arg))
    return { class: mutates ? 'destructive' : 'read-only', binary, reason: mutates ? 'ip changes network state' : 'ip network query' }
  }
  if (binary === 'route') {
    const mutates = tokens.some((arg) => ['add', 'delete', 'del', 'flush'].includes(arg))
    return { class: mutates ? 'destructive' : 'read-only', binary, reason: mutates ? 'route changes network state' : 'route query' }
  }
  if (binary === 'ifconfig') {
    const mutates = tokens.some((arg) => ['up', 'down', 'netmask', 'broadcast', 'pointopoint', 'hw', 'mtu', 'add', 'del', 'promisc', '-promisc', 'arp', '-arp', 'txqueuelen'].includes(arg)) || tokens.some((arg) => /^\d{1,3}(?:\.\d{1,3}){3}$/.test(arg) || arg.includes(':'))
    return { class: mutates ? 'destructive' : 'read-only', binary, reason: mutates ? 'ifconfig changes network state' : 'ifconfig query' }
  }
  return null
}

function classifyKnownArguments(binary: string, args: string[]): CommandClassification | null {
  if (binary === 'curl') return classifyCurl(args)
  if (binary === 'wget') return classifyWget(args)
  if (binary === 'git') return classifyGit(args)
  const packageManager = classifyPackageManager(binary, args)
  if (packageManager) return packageManager
  return classifyAdminQuery(binary, args)
}

function hasAnyArg(args: string[], values: Set<string>): boolean {
  return normalizedArgs(args).some((arg) => {
    const lower = arg.toLowerCase()
    return [...values].some((value) => {
      const expected = value.toLowerCase()
      if (lower === expected || lower.startsWith(`${expected}=`)) return true
      return /^-[a-z]$/.test(expected) && /^-[^-]{2,}/.test(lower) && lower.slice(1).includes(expected[1])
    })
  })
}

function isSignalZeroProbe(args: string[]): boolean {
  const tokens = normalizedArgs(args).map((arg) => arg.toLowerCase())
  return tokens.includes('-0') || tokens.includes('--signal=0') || tokens.some((arg, index) => (arg === '-s' || arg === '--signal') && tokens[index + 1] === '0')
}

function classifyCliQuery(binary: string, args: string[]): CommandClassification | null {
  const tokens = normalizedArgs(args).map((arg) => arg.toLowerCase())
  const subcommand = tokens.find((arg) => !arg.startsWith('-')) || ''
  if (binary === 'kubectl') {
    const reads = new Set(['get', 'describe', 'logs', 'explain', 'diff', 'top', 'api-resources', 'api-versions', 'cluster-info', 'version'])
    if (reads.has(subcommand)) return { class: 'read-only', binary, reason: `kubectl ${subcommand} query` }
    if (subcommand === 'config' && tokens.some((arg) => ['view', 'current-context', 'get-contexts'].includes(arg))) {
      return { class: 'read-only', binary, reason: 'kubectl config query' }
    }
    if (subcommand === 'auth' && tokens.includes('can-i')) return { class: 'read-only', binary, reason: 'kubectl authorization query' }
  }
  if (binary === 'helm') {
    const reads = new Set(['list', 'status', 'get', 'history', 'show', 'search', 'template', 'version', 'env'])
    if (reads.has(subcommand)) {
      if (tokens.some((arg) => arg === '--output-dir' || arg.startsWith('--output-dir='))) return { class: 'safe', binary, reason: 'helm writes rendered files' }
      return { class: 'read-only', binary, reason: `helm ${subcommand} query` }
    }
  }
  if (binary === 'terraform') {
    const reads = new Set(['show', 'output', 'validate', 'version', 'providers'])
    if (reads.has(subcommand)) return { class: 'read-only', binary, reason: `terraform ${subcommand} query` }
    if (subcommand === 'state' && ['list', 'show', 'pull'].includes(tokens[tokens.indexOf(subcommand) + 1] || '')) {
      return { class: 'read-only', binary, reason: 'terraform state query' }
    }
  }
  if (binary === 'tar' && hasAnyArg(args, new Set(['-t', '--list']))) {
    const writes = hasAnyArg(args, new Set(['-x', '--extract', '--get', '-c', '--create', '-r', '--append', '-u', '--update', '--delete']))
    if (!writes) return { class: 'read-only', binary, reason: 'tar archive listing' }
  }
  if ((binary === 'gzip' || binary === 'gunzip') && hasAnyArg(args, new Set(['-l', '--list', '-t', '--test']))) {
    return { class: 'read-only', binary, reason: `${binary} archive query` }
  }
  return null
}

export type CommandValidation =
  | { ok: true; command: string }
  | { ok: false; reason: string }

/**
 * The AST engine is installed at runtime (it needs a wasm parser). Until then —
 * and in unit tests that only exercise the text helpers — classification falls
 * back to the older text splitter. The fallback is strictly weaker, so callers
 * that care should `await ensureBashAstReady()` first (electron/mcp/bashParser).
 */
export type CommandFlattener = (command: string) => BashParseResult | null

let commandFlattener: CommandFlattener | null = null

export function setCommandFlattener(flattener: CommandFlattener | null): void {
  commandFlattener = flattener
}

export function hasCommandFlattener(): boolean {
  return commandFlattener !== null
}

export function validateMcpCommand(command: unknown): CommandValidation {
  if (typeof command !== 'string' || !command.trim()) {
    return { ok: false, reason: 'Command is empty' }
  }
  if (command.includes('\0')) {
    return { ok: false, reason: 'Command contains a NUL byte' }
  }
  if (command.length > MCP_MAX_COMMAND_CHARS) {
    return { ok: false, reason: `Command exceeds ${MCP_MAX_COMMAND_CHARS} characters` }
  }
  return { ok: true, command }
}

export function classifyCommand(command: string): CommandClassification {
  if (!command.trim()) {
    return { class: 'forbidden', binary: '', reason: 'empty command' }
  }

  const flattened = flattenSafely(command)
  if (flattened) return classifyFlattened(flattened)

  return classifyByText(normalizeCommand(command))
}

function flattenSafely(command: string): BashParseResult | null {
  if (!commandFlattener) return null
  try {
    return commandFlattener(command)
  } catch {
    // A parser failure must never turn into a silent "allow".
    return null
  }
}

function classifyFlattened(flat: BashParseResult): CommandClassification {
  const rootBinary = firstBinaryOf(flat)

  for (const haystack of flat.forbiddenHaystack) {
    for (const rule of FORBIDDEN_PATTERNS) {
      if (rule.re.test(haystack)) {
        return { class: 'forbidden', binary: rootBinary, reason: rule.reason }
      }
    }
  }

  for (const rawTarget of flat.writeTargets) {
    const target = stripQuotes(rawTarget)
    if (CRITICAL_WRITE_PREFIX.test(target) || AUTHORIZED_KEYS.test(target)) {
      return { class: 'forbidden', binary: rootBinary, reason: `write to a critical path (${target})` }
    }
  }

  let worst: CommandClassification = {
    class: 'read-only',
    binary: rootBinary,
    reason: 'allowlisted read-only command',
  }
  for (const command of flat.commands) {
    const next = classifyFlatCommand(command)
    const rank = CLASS_RANK[next.class]
    const worstRank = CLASS_RANK[worst.class]
    // Same class can come from different evidence. `ls; mystery-daemon` ranks
    // both nodes `destructive`, but only one of them was actually observed, so
    // prefer that one: the card must not blame the model on a guess.
    if (rank > worstRank || (rank === worstRank && !next.uncertainty && worst.uncertainty)) {
      worst = next
    }
  }

  const writeTarget = flat.writeTargets[0]
  // Observed writes still outrank a read-only chain. Do not, however, promote
  // the whole `&&` list just because tree-sitter left an ERROR node somewhere
  // (long pipelines do that constantly) or because `cat < file` is an input
  // redirect — that used to make an honest `risk: read` look like a lie.
  if (writeTarget && CLASS_RANK[worst.class] < CLASS_RANK.destructive) {
    return {
      class: 'destructive',
      binary: worst.binary || rootBinary,
      reason: `shell write redirection (${stripQuotes(writeTarget)})`,
    }
  }

  if (flat.commands.length === 0) {
    return {
      class: 'destructive',
      binary: rootBinary,
      reason: flat.opaque[0] || 'command could not be parsed',
      uncertainty: 'unparsed',
    }
  }

  if (stdinFeedsUnreadableCode(flat) && CLASS_RANK[worst.class] < CLASS_RANK.destructive) {
    const target = stripQuotes(flat.readTargets[0] || '')
    return {
      class: 'destructive',
      binary: worst.binary || rootBinary,
      reason: target
        ? `shell/interpreter reads a script from stdin (${target})`
        : 'shell/interpreter reads a script from stdin',
      uncertainty: 'uninspectable',
    }
  }

  return worst
}

/** `bash < deploy.sh` / `python < x.py` hide the program; `cat < log` does not. */
function stdinFeedsUnreadableCode(flat: BashParseResult): boolean {
  if (flat.readTargets.length === 0) return false
  return flat.commands.some((command) => {
    const binary = command.binary
    if (SHELL_BINARIES.has(binary)) {
      const hasInline = command.args.some((arg) => /^-[A-Za-z]*c$/.test(arg))
      return !hasInline && !command.expanded
    }
    if (INTERPRETERS.has(binary)) {
      const hasInline = command.args.some((arg) => INLINE_CODE_FLAGS.has(arg))
      return !hasInline && !command.expanded
    }
    return false
  })
}

function classifyFlatCommand(command: BashFlatCommand): CommandClassification {
  const binary = command.binary
  if (command.dynamicName) {
    return {
      class: 'destructive',
      binary: '',
      reason: 'command name is computed at runtime',
      uncertainty: 'runtime-name',
    }
  }
  if (command.opaqueReason) {
    return { class: 'destructive', binary, reason: command.opaqueReason, uncertainty: 'uninspectable' }
  }
  if (!binary) {
    return { class: 'read-only', binary: '', reason: 'variable assignment only' }
  }
  if (PRIVILEGE_WRAPPERS.has(binary)) {
    return { class: 'privileged', binary, reason: `privileged wrapper (${binary})` }
  }
  if (SHELL_BINARIES.has(binary)) {
    return { class: 'read-only', binary, reason: `${binary} running inspectable code` }
  }
  if (TRANSPARENT_WRAPPERS.has(binary)) {
    return command.expanded
      ? { class: 'read-only', binary, reason: `transparent wrapper (${binary})` }
      : {
          class: 'destructive',
          binary,
          reason: `cannot inspect what ${binary} runs`,
          uncertainty: 'uninspectable',
        }
  }
  // `nginx -v`, `java -version`, `sshd --help` — printing usage is the one thing
  // we can establish about a program without knowing anything else about it.
  if (isInformationalProbe(command.args)) {
    return { class: 'read-only', binary, reason: `${binary}: version/help probe (no operands)` }
  }
  if (CATASTROPHIC_DELETE_BINARIES.has(binary) && deletesCatastrophicTarget(command.args)) {
    return { class: 'forbidden', binary, reason: `recursive delete of a system path (${binary})` }
  }
  if (DESTRUCTIVE_GIT.test(command.maskedText)) {
    return { class: 'destructive', binary, reason: 'destructive git command' }
  }
  if (DESTRUCTIVE_SED.test(command.maskedText)) {
    return { class: 'destructive', binary, reason: 'in-place sed' }
  }
  if (DESTRUCTIVE_FIND.test(command.maskedText)) {
    return { class: 'destructive', binary, reason: 'find delete/exec' }
  }
  if (DESTRUCTIVE_RSYNC.test(command.maskedText)) {
    return { class: 'destructive', binary, reason: 'rsync --delete' }
  }
  if (AWK_BINARIES.has(binary) && (AWK_EXECUTES.test(command.text) || AWK_WRITES_FILE.test(command.text))) {
    return { class: 'destructive', binary, reason: 'awk executes a command or writes a file' }
  }
  if (binary === 'yq' && hasAnyArg(command.args, new Set(['-i', '--inplace']))) {
    return { class: 'destructive', binary, reason: 'in-place yq' }
  }
  if (binary === 'sort' && hasAnyArg(command.args, new Set(['-o', '--output']))) {
    return { class: 'destructive', binary, reason: 'sort writes an output file' }
  }
  if (binary === 'kill' && isSignalZeroProbe(command.args)) {
    return { class: 'read-only', binary, reason: 'kill -0 process existence query' }
  }

  const argumentAware = classifyKnownArguments(binary, command.args) || classifyCliQuery(binary, command.args)
  if (argumentAware) return argumentAware

  if (binary === 'systemctl') {
    if (READONLY_SYSTEMCTL.test(command.maskedText)) {
      return { class: 'read-only', binary, reason: 'systemctl status/query' }
    }
    if (DESTRUCTIVE_SYSTEMCTL.test(command.maskedText)) {
      return { class: 'destructive', binary, reason: 'systemctl mutation' }
    }
    return { class: 'destructive', binary, reason: 'systemctl (not a query)' }
  }

  if (binary === 'journalctl') {
    if (MUTATING_JOURNALCTL.test(command.maskedText)) return { class: 'destructive', binary, reason: 'journalctl mutation' }
    return { class: 'read-only', binary, reason: 'journalctl read' }
  }

  if (binary === 'docker' || binary === 'podman') {
    if (READONLY_DOCKER.test(command.maskedText)) return { class: 'read-only', binary, reason: `${binary} inspect/list` }
    if (DESTRUCTIVE_DOCKER.test(command.maskedText)) return { class: 'destructive', binary, reason: `${binary} mutation` }
    return { class: 'safe', binary, reason: `${binary} command` }
  }

  if (binary === 'mount') {
    const rest = command.maskedText.replace(/^mount\s*/, '').trim()
    if (!rest || /^-l\b/.test(rest) || /^--show/.test(rest)) {
      return { class: 'read-only', binary, reason: 'list mounts' }
    }
    return { class: 'destructive', binary, reason: 'mount filesystem' }
  }

  if (binary === 'crontab' && /\bcrontab\s+-l\b/.test(command.maskedText)) {
    return { class: 'read-only', binary, reason: 'crontab -l' }
  }

  if (DESTRUCTIVE_BINARIES.has(binary)) {
    return { class: 'destructive', binary, reason: `destructive binary (${binary})` }
  }
  if (READ_ONLY_BINARIES.has(binary)) {
    return { class: 'read-only', binary, reason: 'allowlisted read-only command' }
  }
  if (SAFE_BINARIES.has(binary)) {
    return { class: 'safe', binary, reason: `non-destructive mutation (${binary})` }
  }
  if (INTERPRETERS.has(binary)) {
    return hasInlineCode(command.args)
      ? {
          class: 'destructive',
          binary,
          reason: `${binary}: code passed inline`,
          uncertainty: 'inline-script',
        }
      : {
          class: 'destructive',
          binary,
          reason: `${binary}: script body is not readable from here`,
          uncertainty: 'uninspectable',
        }
  }
  // Fail closed: we do not know this program, so a human should look at it.
  return {
    class: 'destructive',
    binary,
    reason: `unrecognised command (${binary})`,
    uncertainty: 'unknown-program',
  }
}

function deletesCatastrophicTarget(args: string[]): boolean {
  let recursive = false
  const targets: string[] = []
  for (const raw of args) {
    const arg = stripQuotes(raw)
    if (!arg) continue
    if (arg.startsWith('-') && arg.length > 1) {
      if (/^-[A-Za-z]*[rR]/.test(arg)) recursive = true
      continue
    }
    targets.push(arg)
  }
  if (!recursive) return false
  return targets.some((target) => CATASTROPHIC_TARGETS.has(target.replace(/\/+$/, '') || '/'))
}

function firstBinaryOf(flat: BashParseResult): string {
  const root = flat.commands.find((c) => c.origin === 'root' && c.binary)
  if (root) return root.binary
  return flat.commands.find((c) => c.binary)?.binary ?? ''
}

function classifyByText(normalized: string): CommandClassification {
  if (!normalized) {
    return { class: 'forbidden', binary: '', reason: 'empty command' }
  }

  for (const rule of FORBIDDEN_PATTERNS) {
    if (rule.re.test(normalized)) {
      return { class: 'forbidden', binary: firstBinary(normalized), reason: rule.reason }
    }
  }

  const segments = splitCommandSegments(normalized)
  let worst: CommandClassification = {
    class: 'read-only',
    binary: firstBinary(normalized),
    reason: 'allowlisted read-only command',
  }

  for (const segment of segments) {
    const next = classifySegment(segment)
    if (CLASS_RANK[next.class] > CLASS_RANK[worst.class]) {
      worst = next
    }
  }

  return worst
}

function classifySegment(segment: string): CommandClassification {
  const binary = commandBinary(segment)
  if (!binary) {
    return { class: 'safe', binary: '', reason: 'unparsed command' }
  }

  if (PRIVILEGE_WRAPPERS.has(binary)) {
    return { class: 'privileged', binary, reason: `privileged wrapper (${binary})` }
  }

  if (/[$`]/.test(binary)) {
    return {
      class: 'destructive',
      binary: '',
      reason: 'command name is computed at runtime',
      uncertainty: 'runtime-name',
    }
  }

  if (!hasWriteRedirect(segment) && isInformationalProbe(segmentArgs(segment))) {
    return { class: 'read-only', binary, reason: `${binary}: version/help probe (no operands)` }
  }

  if (DESTRUCTIVE_GIT.test(segment)) {
    return { class: 'destructive', binary, reason: 'destructive git command' }
  }
  if (DESTRUCTIVE_SED.test(segment)) {
    return { class: 'destructive', binary, reason: 'in-place sed' }
  }
  if (DESTRUCTIVE_FIND.test(segment)) {
    return { class: 'destructive', binary, reason: 'find delete/exec' }
  }
  if (DESTRUCTIVE_RSYNC.test(segment)) {
    return { class: 'destructive', binary, reason: 'rsync --delete' }
  }
  if (AWK_BINARIES.has(binary) && (AWK_EXECUTES.test(segment) || AWK_WRITES_FILE.test(segment))) {
    return { class: 'destructive', binary, reason: 'awk executes a command or writes a file' }
  }
  if (hasWriteRedirect(segment)) {
    return { class: 'destructive', binary, reason: 'shell write redirection' }
  }

  const args = segmentArgs(segment)
  if (binary === 'yq' && hasAnyArg(args, new Set(['-i', '--inplace']))) {
    return { class: 'destructive', binary, reason: 'in-place yq' }
  }
  if (binary === 'sort' && hasAnyArg(args, new Set(['-o', '--output']))) {
    return { class: 'destructive', binary, reason: 'sort writes an output file' }
  }
  if (binary === 'kill' && isSignalZeroProbe(args)) {
    return { class: 'read-only', binary, reason: 'kill -0 process existence query' }
  }

  const argumentAware = classifyKnownArguments(binary, args) || classifyCliQuery(binary, args)
  if (argumentAware) return argumentAware

  if (binary === 'systemctl') {
    if (READONLY_SYSTEMCTL.test(segment)) {
      return { class: 'read-only', binary, reason: 'systemctl status/query' }
    }
    if (DESTRUCTIVE_SYSTEMCTL.test(segment)) {
      return { class: 'destructive', binary, reason: 'systemctl mutation' }
    }
    return { class: 'destructive', binary, reason: 'systemctl (not a query)' }
  }

  if (binary === 'journalctl') {
    if (MUTATING_JOURNALCTL.test(segment)) return { class: 'destructive', binary, reason: 'journalctl mutation' }
    return { class: 'read-only', binary, reason: 'journalctl read' }
  }

  if (binary === 'docker' || binary === 'podman') {
    if (READONLY_DOCKER.test(segment)) return { class: 'read-only', binary, reason: `${binary} inspect/list` }
    if (DESTRUCTIVE_DOCKER.test(segment)) return { class: 'destructive', binary, reason: `${binary} mutation` }
    return { class: 'safe', binary, reason: `${binary} command` }
  }

  if (binary === 'mount') {
    const rest = segment.replace(/^mount\s*/, '').trim()
    if (!rest || /^-l\b/.test(rest) || /^--show/.test(rest)) {
      return { class: 'read-only', binary, reason: 'list mounts' }
    }
    return { class: 'destructive', binary, reason: 'mount filesystem' }
  }

  if (binary === 'crontab' && /\bcrontab\s+-l\b/.test(segment)) {
    return { class: 'read-only', binary, reason: 'crontab -l' }
  }

  if (DESTRUCTIVE_BINARIES.has(binary)) {
    return { class: 'destructive', binary, reason: `destructive binary (${binary})` }
  }

  if (READ_ONLY_BINARIES.has(binary) && !hasWriteRedirect(segment)) {
    return { class: 'read-only', binary, reason: 'allowlisted read-only command' }
  }

  if (SAFE_BINARIES.has(binary)) {
    return { class: 'safe', binary, reason: `non-destructive mutation (${binary})` }
  }

  if (INTERPRETERS.has(binary)) {
    return hasInlineCode(segmentArgs(segment))
      ? { class: 'destructive', binary, reason: `${binary}: code passed inline`, uncertainty: 'inline-script' }
      : {
          class: 'destructive',
          binary,
          reason: `${binary}: script body is not readable from here`,
          uncertainty: 'uninspectable',
        }
  }

  // Fail closed: an unknown program gets a human look.
  return {
    class: 'destructive',
    binary,
    reason: `unrecognised command (${binary})`,
    uncertainty: 'unknown-program',
  }
}

function normalizeCommand(command: string): string {
  return command.replace(/\\\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
}

export function splitCommandSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: "'" | '"' | null = null
  let escape = false

  const push = () => {
    const trimmed = current.trim()
    if (trimmed) segments.push(trimmed)
    current = ''
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (escape) {
      current += ch
      escape = false
      continue
    }
    if (quote) {
      if (quote === '"' && ch === '\\') {
        current += ch
        escape = true
        continue
      }
      if (ch === quote) quote = null
      current += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      current += ch
      continue
    }
    if (ch === '\\') {
      current += ch
      escape = true
      continue
    }
    if (ch === ';' || ch === '\n' || ch === '\r') {
      push()
      continue
    }
    if (ch === '&' && command[i + 1] === '&') {
      push()
      i++
      continue
    }
    if (ch === '|' && command[i + 1] === '|') {
      push()
      i++
      continue
    }
    if (ch === '|' || ch === '&') {
      push()
      continue
    }
    current += ch
  }
  push()
  return segments
}

const ASSIGNMENT_PREFIX = /^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/

function stripAssignmentPrefix(segment: string): string {
  let rest = segment.trim()
  while (ASSIGNMENT_PREFIX.test(rest)) rest = rest.replace(ASSIGNMENT_PREFIX, '')
  return rest
}

function commandWord(segment: string): string {
  const match = stripAssignmentPrefix(segment).match(/^("([^"]+)"|'([^']+)'|(\S+))/)
  return match?.[2] || match?.[3] || match?.[4] || ''
}

function commandBinary(segment: string): string {
  const raw = commandWord(segment)
  const base = raw.split(/[/\\]/).pop() || raw
  return base.toLowerCase()
}

/** Everything after the command word, quotes preserved. */
function segmentArgs(segment: string): string[] {
  const rest = stripAssignmentPrefix(segment)
  const match = rest.match(/^("([^"]+)"|'([^']+)'|(\S+))/)
  if (!match) return []
  return rest.slice(match[0].length).trim().split(/\s+/).filter(Boolean)
}

function firstBinary(command: string): string {
  const first = splitCommandSegments(command)[0] || command
  return commandBinary(first)
}

function hasWriteRedirect(segment: string): boolean {
  let quote: "'" | '"' | null = null
  let escape = false
  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]
    if (escape) {
      escape = false
      continue
    }
    if (quote) {
      if (quote === '"' && ch === '\\') {
        escape = true
        continue
      }
      if (ch === quote) quote = null
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (ch !== '>') continue
    // `2>&1`, `>&2`, `2>&-` duplicate or close a descriptor; nothing is written.
    if (segment[i + 1] === '&') continue
    const prev = i > 0 ? segment[i - 1] : ''
    if (prev === '2' || prev === '1' || prev === '&') {
      const rest = segment.slice(i + 1).trim()
      if (rest.startsWith('/dev/null')) continue
    }
    const rest = segment.slice(i + 1).trim()
    if (rest.startsWith('/dev/null')) continue
    return true
  }
  return false
}

export function maxClass(a: CommandClass, b: CommandClass): CommandClass {
  return CLASS_RANK[a] >= CLASS_RANK[b] ? a : b
}
