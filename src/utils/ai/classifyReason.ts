type Translate = (key: string, params?: Record<string, unknown>) => string

const EXACT: Record<string, string> = {
  'unlisted command treated as safe mutation': 'ai.classifyUnlistedSafe',
  'allowlisted read-only command': 'ai.classifyReadOnly',
  'unparsed command': 'ai.classifyUnparsed',
  'empty command': 'ai.classifyEmpty',
  'destructive git command': 'ai.classifyDestructiveGit',
  'in-place sed': 'ai.classifySedInPlace',
  'find delete/exec rm': 'ai.classifyFindDelete',
  'shell write redirection': 'ai.classifyRedirect',
  'systemctl status/query': 'ai.classifySystemctlQuery',
  'systemctl mutation': 'ai.classifySystemctlMutate',
  'systemctl (not a query)': 'ai.classifySystemctlOther',
  'journalctl read': 'ai.classifyJournalRead',
  'journalctl vacuum/mutate': 'ai.classifyJournalMutate',
  'list mounts': 'ai.classifyMountList',
  'mount filesystem': 'ai.classifyMount',
  'crontab -l': 'ai.classifyCrontabList',
  'recursive delete of /': 'ai.classifyRmRoot',
  'delete of /': 'ai.classifyRmRoot',
  'filesystem format': 'ai.classifyMkfs',
  'raw disk write': 'ai.classifyDd',
  'host power action': 'ai.classifyPower',
  'download piped to a shell': 'ai.classifyPipeShell',
  'pipe to a shell': 'ai.classifyPipeShell',
  'fork bomb': 'ai.classifyForkBomb',
  'flush firewall': 'ai.classifyFirewall',
  'chmod 777 /': 'ai.classifyChmodRoot',
  'recursive chmod of /': 'ai.classifyChmodRoot',
  'recursive chown of /': 'ai.classifyChownRoot',
  'overwrite of a critical file': 'ai.classifyCriticalFile',
  'write to authorized_keys': 'ai.classifyAuthorizedKeys',
  'replace crontab': 'ai.classifyCrontabReplace',
}

const PATTERN: Array<[RegExp, string]> = [
  [/^privileged wrapper \((.+)\)$/, 'ai.classifyPrivileged'],
  [/^non-destructive mutation \((.+)\)$/, 'ai.classifySafeBinary'],
  [/^destructive binary \((.+)\)$/, 'ai.classifyDestructiveBinary'],
  [/^(.+) inspect\/list$/, 'ai.classifyDockerQuery'],
  [/^(.+) mutation$/, 'ai.classifyDockerMutate'],
  [/^(.+) command$/, 'ai.classifyGenericCommand'],
]

/** Map classifier English reasons to UI copy. Unknown strings pass through. */
export function formatClassifyReason(reason: string | undefined, t: Translate): string {
  const raw = String(reason || '').trim()
  if (!raw) return ''
  const exact = EXACT[raw]
  if (exact) return t(exact)
  for (const [re, key] of PATTERN) {
    const m = raw.match(re)
    if (m) return t(key, { binary: m[1] })
  }
  return raw
}
