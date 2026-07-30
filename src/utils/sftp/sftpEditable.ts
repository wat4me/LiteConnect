/** Text / config extensions safe for the built-in SFTP editor */
export const SFTP_EDITABLE_EXTENSIONS = [
  '.txt', '.md', '.markdown', '.log', '.conf', '.cfg', '.ini',
  '.sh', '.bash', '.zsh', '.fish', '.bat', '.cmd', '.ps1',
  '.py', '.rb', '.pl', '.lua', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.json', '.xml', '.yaml', '.yml', '.toml', '.csv',
  '.html', '.htm', '.css', '.scss', '.sass', '.less', '.vue', '.svelte',
  '.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.cs', '.java', '.kt', '.swift',
  '.go', '.rs', '.php', '.sql', '.env', '.gitignore', '.dockerignore',
  '.rst', '.tex', '.makefile', '.dockerfile', '.vagrantfile', '.jenkinsfile',
]

export const SFTP_EDITABLE_NAMES = [
  'makefile', 'dockerfile', 'vagrantfile', 'jenkinsfile',
  'readme', 'license', 'changelog', '.gitignore', '.gitattributes',
  '.dockerignore', '.eslintrc', '.prettierrc', '.npmrc', '.nvmrc',
]

export function canEditSftpFile(fileName: string): boolean {
  const lower = fileName.toLowerCase()
  if (SFTP_EDITABLE_NAMES.includes(lower)) return true
  const dotIdx = lower.lastIndexOf('.')
  if (dotIdx === -1) return false
  return SFTP_EDITABLE_EXTENSIONS.includes(lower.slice(dotIdx))
}

export function isSftpArchiveName(name: string): boolean {
  const lower = name.toLowerCase()
  return (
    lower.endsWith('.tar.gz') ||
    lower.endsWith('.tgz') ||
    lower.endsWith('.tar.bz2') ||
    lower.endsWith('.tbz2') ||
    lower.endsWith('.tbz') ||
    lower.endsWith('.tar.xz') ||
    lower.endsWith('.txz') ||
    lower.endsWith('.tar') ||
    lower.endsWith('.zip') ||
    lower.endsWith('.7z') ||
    (lower.endsWith('.gz') && !lower.endsWith('.tar.gz'))
  )
}

export function localBaseName(filePath: string): string {
  const cleaned = filePath.replace(/[/\\]+$/, '')
  const parts = cleaned.split(/[/\\]/)
  return parts[parts.length - 1] || cleaned
}
