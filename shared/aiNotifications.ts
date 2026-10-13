export interface AiNotificationInput { enabled: boolean; url: string; mode: 'issues' | 'all'; token?: string }
export interface AiNotificationSettings { enabled: boolean; url: string; mode: 'issues' | 'all'; hasToken: boolean }
export function validateAiNotification(input: AiNotificationInput): AiNotificationInput {
  if (!input || typeof input.enabled !== 'boolean' || !['issues', 'all'].includes(input.mode) || typeof input.url !== 'string' || input.url.length > 4096 ||
    (input.token !== undefined && (typeof input.token !== 'string' || input.token.length > 4096 || /[\r\n]/.test(input.token)))) throw new Error('通知配置无效。')
  const value = input.url.trim()
  if (!value && !input.enabled) return { ...input, url: '' }
  let url: URL
  try { url = new URL(value) } catch { throw new Error('请输入完整的 HTTP 或 HTTPS Webhook 地址。') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error('Webhook 地址仅支持 HTTP/HTTPS，不能包含用户密码或片段。')
  return { enabled: input.enabled, url: url.toString(), mode: input.mode, token: input.token }
}
