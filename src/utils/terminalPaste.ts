import { t } from '../i18n'

/** Default single-line paste confirm threshold; multiline always confirms when master switch is on. */
export const PASTE_CONFIRM_MAX_CHARS = 400
export const PASTE_CONFIRM_MAX_CHARS_OPTIONS = [100, 200, 400, 800, 1600] as const
export type PasteConfirmMaxChars = (typeof PASTE_CONFIRM_MAX_CHARS_OPTIONS)[number]
export const PASTE_PREVIEW_MAX_CHARS = 480

export function normalizePasteConfirmMaxChars(n: unknown): PasteConfirmMaxChars {
  if (typeof n === 'number' && (PASTE_CONFIRM_MAX_CHARS_OPTIONS as readonly number[]).includes(n)) {
    return n as PasteConfirmMaxChars
  }
  return PASTE_CONFIRM_MAX_CHARS
}

export function normalizeTerminalText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

export function shouldConfirmPaste(text: string, maxChars: number = PASTE_CONFIRM_MAX_CHARS): boolean {
  if (!text) return false
  if (text.includes('\n') || text.includes('\r')) return true
  const threshold = normalizePasteConfirmMaxChars(maxChars)
  return text.length > threshold
}

export function countPasteLines(text: string): number {
  if (!text) return 0
  const normalized = normalizeTerminalText(text)
  return normalized.split('\n').length
}

export function buildPastePreview(text: string, maxChars = PASTE_PREVIEW_MAX_CHARS): string {
  const normalized = normalizeTerminalText(text)
  if (normalized.length <= maxChars) return normalized
  return `${normalized.slice(0, maxChars)}…`
}

/** Patterns that often destroy data / lock out access when run on a remote host. */
const DANGEROUS_COMMAND_PATTERNS: Array<{ re: RegExp; labelKey?: string; label?: string }> = [
  { re: /\brm\s+-[^\n]*f/i, label: 'rm -f / rm -rf' },
  { re: /\bmkfs(\.|$|\s)/i, label: 'mkfs' },
  { re: /\bdd\s+[^\n]*\bof=\/dev\//i, labelKey: 'terminal.risk.ddDevice' },
  { re: />\s*\/dev\/sd[a-z]/i, labelKey: 'terminal.risk.redirectBlock' },
  { re: /\b(shutdown|reboot|halt|poweroff)\b/i, labelKey: 'terminal.risk.power' },
  { re: /\b(userdel|deluser)\b/i, labelKey: 'terminal.risk.delUser' },
  { re: /\bpasswd\b/i, labelKey: 'terminal.risk.passwd' },
  { re: /\bchmod\s+(-R\s+)?777\b/i, label: 'chmod 777' },
  { re: /\bchown\s+-R\b/i, labelKey: 'terminal.risk.chownR' },
  { re: /\b(iptables|nft)\b[^\n]*\b(-F|--flush)\b/i, labelKey: 'terminal.risk.flushFw' },
  { re: /\bsystemctl\s+(stop|disable|mask)\b/i, labelKey: 'terminal.risk.stopService' },
  { re: /\b(killall|pkill)\b/i, labelKey: 'terminal.risk.killAll' },
  { re: /\bcurl\b[^\n]+\|\s*(ba)?sh\b/i, label: 'curl|sh' },
  { re: /\bwget\b[^\n]+\|\s*(ba)?sh\b/i, label: 'wget|sh' },
  { re: /\b:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;/i, label: 'fork bomb' },
  { re: />\s*\/etc\//i, labelKey: 'terminal.risk.writeEtc' },
  { re: /\bmv\s+[^\n]+\s+\/dev\/null\b/i, labelKey: 'terminal.risk.mvNull' },
  { re: /\btruncate\b/i, label: 'truncate' },
  { re: /\b(drop|truncate)\s+(table|database)\b/i, label: 'DROP/TRUNCATE' },
]

export type CommandRisk = {
  dangerous: boolean
  reasons: string[]
}

export function assessCommandRisk(text: string): CommandRisk {
  const normalized = normalizeTerminalText(text)
  if (!normalized.trim()) return { dangerous: false, reasons: [] }
  const reasons: string[] = []
  const seen = new Set<string>()
  for (const item of DANGEROUS_COMMAND_PATTERNS) {
    const label = item.labelKey ? t(item.labelKey) : (item.label || '')
    if (item.re.test(normalized) && label && !seen.has(label)) {
      seen.add(label)
      reasons.push(label)
    }
  }
  return { dangerous: reasons.length > 0, reasons }
}

/** AI fill/run: always confirm; stronger copy when risky. */
export function buildAiTerminalConfirmCopy(
  action: 'fill' | 'run',
  text: string
): {
  title: string
  message: string
  detail: string
  confirmText: string
  danger: boolean
  tone: 'warning' | 'danger'
} {
  const normalized = normalizeTerminalText(text)
  const lines = countPasteLines(normalized)
  const risk = assessCommandRisk(normalized)
  const actionLabel = action === 'run' ? t('terminal.aiConfirm.run') : t('terminal.aiConfirm.fill')
  const riskHint = risk.dangerous
    ? t('terminal.aiConfirm.riskHint', {
        reasons:
          risk.reasons.slice(0, 4).join('、') + (risk.reasons.length > 4 ? '…' : ''),
      })
    : ''
  const base =
    action === 'run'
      ? t('terminal.aiConfirm.runBase', { lines, chars: normalized.length })
      : t('terminal.aiConfirm.fillBase', { lines, chars: normalized.length })
  return {
    title: risk.dangerous
      ? t('terminal.aiConfirm.titleDanger', { action: actionLabel })
      : t('terminal.aiConfirm.titleSafe', { action: actionLabel }),
    message: riskHint ? `${base}\n${riskHint}` : base,
    detail: buildPastePreview(normalized),
    confirmText:
      action === 'run'
        ? risk.dangerous
          ? t('terminal.aiConfirm.stillRun')
          : t('terminal.aiConfirm.run')
        : risk.dangerous
          ? t('terminal.aiConfirm.stillFill')
          : t('terminal.aiConfirm.fill'),
    danger: risk.dangerous,
    tone: risk.dangerous ? 'danger' : 'warning',
  }
}
