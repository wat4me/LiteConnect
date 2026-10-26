import { sharedT, type SharedTranslate } from './i18n'

export interface AiNotificationInput { enabled: boolean; url: string; mode: 'issues' | 'all'; token?: string }
export interface AiNotificationSettings { enabled: boolean; url: string; mode: 'issues' | 'all'; hasToken: boolean }
export function validateAiNotification(input: AiNotificationInput, translate: SharedTranslate = sharedT): AiNotificationInput {
  if (!input || typeof input.enabled !== 'boolean' || !['issues', 'all'].includes(input.mode) || typeof input.url !== 'string' || input.url.length > 4096 ||
    (input.token !== undefined && (typeof input.token !== 'string' || input.token.length > 4096 || /[\r\n]/.test(input.token)))) throw new Error(translate('sharedText.notificationInvalid'))
  const value = input.url.trim()
  if (!value && !input.enabled) return { ...input, url: '' }
  let url: URL
  try { url = new URL(value) } catch { throw new Error(translate('sharedText.notificationUrlRequired')) }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) throw new Error(translate('sharedText.notificationUrlInvalid'))
  return { enabled: input.enabled, url: url.toString(), mode: input.mode, token: input.token }
}
