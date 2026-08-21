import { MCP_MAX_COMMAND_CHARS } from './limits'
import type { CommandClass, CommandClassification } from './types'

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
  'env',
  'printenv',
  'which',
  'type',
  'command',
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
  'uname',
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
])

const PRIVILEGED_BINARIES = new Set(['sudo', 'su', 'doas', 'pkexec', 'runuser', 'ksu'])

const DESTRUCTIVE_BINARIES = new Set([
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
])

const SAFE_BINARIES = new Set([
  'mkdir',
  'touch',
  'cp',
  'ln',
  'git',
  'npm',
  'npx',
  'yarn',
  'pnpm',
  'pip',
  'pip3',
  'python',
  'python3',
  'node',
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
  'systemctl',
])

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

const DESTRUCTIVE_GIT = /\bgit\s+(reset\s+--hard|clean\s|push\s+--force|push\s+-f)\b/i
const DESTRUCTIVE_SED = /\bsed\s+[^\n]*-i\b/
const DESTRUCTIVE_FIND = /\bfind\b[\s\S]*\s(-delete|-exec\s+rm\b)/i
const DESTRUCTIVE_SYSTEMCTL =
  /\bsystemctl\s+(start|stop|restart|reload|enable|disable|mask|unmask|isolate|kill|reset-failed)\b/i
const READONLY_SYSTEMCTL = /\bsystemctl\s+(status|show|cat|is-active|is-enabled|is-failed|list-units|list-unit-files|list-jobs)\b/i
const READONLY_JOURNALCTL = /\bjournalctl\b(?![\s\S]*--vacuum)/i
const DESTRUCTIVE_DOCKER = /\b(docker|podman)\s+(rm|rmi|kill|stop|run|exec|compose\s+down|system\s+prune)\b/i
const READONLY_DOCKER = /\b(docker|podman)\s+(ps|logs|inspect|images|info|version|stats|top|port|diff)\b/i

export type CommandValidation =
  | { ok: true; command: string }
  | { ok: false; reason: string }

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
  const normalized = normalizeCommand(command)
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

  if (PRIVILEGED_BINARIES.has(binary)) {
    return { class: 'privileged', binary, reason: `privileged wrapper (${binary})` }
  }

  if (DESTRUCTIVE_GIT.test(segment)) {
    return { class: 'destructive', binary, reason: 'destructive git command' }
  }
  if (DESTRUCTIVE_SED.test(segment)) {
    return { class: 'destructive', binary, reason: 'in-place sed' }
  }
  if (DESTRUCTIVE_FIND.test(segment)) {
    return { class: 'destructive', binary, reason: 'find delete/exec rm' }
  }
  if (hasWriteRedirect(segment)) {
    return { class: 'destructive', binary, reason: 'shell write redirection' }
  }

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
    if (READONLY_JOURNALCTL.test(segment)) {
      return { class: 'read-only', binary, reason: 'journalctl read' }
    }
    return { class: 'destructive', binary, reason: 'journalctl vacuum/mutate' }
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

  return { class: 'safe', binary, reason: 'unlisted command treated as safe mutation' }
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

function commandBinary(segment: string): string {
  let rest = segment.trim()
  while (/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/.test(rest)) {
    rest = rest.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S*\s+/, '')
  }
  const match = rest.match(/^("([^"]+)"|'([^']+)'|(\S+))/)
  const raw = match?.[2] || match?.[3] || match?.[4] || ''
  const base = raw.split(/[/\\]/).pop() || raw
  return base.toLowerCase()
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
