export const DEFAULT_SFTP_FONT_SIZE = 12
export const MIN_SFTP_FONT_SIZE = 10
export const MAX_SFTP_FONT_SIZE = 24

export function sanitizeSftpFontSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_SFTP_FONT_SIZE
  return Math.max(MIN_SFTP_FONT_SIZE, Math.min(MAX_SFTP_FONT_SIZE, Math.round(value)))
}
