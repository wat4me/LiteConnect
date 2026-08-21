export type KeyboardPrompt = {
  prompt: string
  echo: boolean
}

const OTP_RE = /otp|totp|mfa|2fa|verification|verify\s*code|authenticator|token|challenge|验证码|动态口令|校验码|短信|谷歌/
const PASS_RE = /password|passwd|passphrase|口令|密码|pass word/

export function isOtpLikePrompt(prompt: string): boolean {
  return OTP_RE.test(String(prompt || '').toLowerCase())
}

export function isPasswordLikePrompt(prompt: string): boolean {
  const p = String(prompt || '').toLowerCase()
  if (isOtpLikePrompt(p)) return false
  return PASS_RE.test(p)
}

/**
 * Auto-answer only when every prompt is a password prompt and we have a password.
 * OTP / unknown prompts must go to the UI.
 */
export function autoAnswerKeyboardPrompts(
  prompts: KeyboardPrompt[],
  password: string,
): { complete: true; answers: string[] } | { complete: false } {
  if (!Array.isArray(prompts) || prompts.length === 0) {
    return { complete: true, answers: [] }
  }
  if (!password) return { complete: false }

  const answers: string[] = []
  for (const item of prompts) {
    const text = item?.prompt || ''
    if (isOtpLikePrompt(text)) return { complete: false }
    if (isPasswordLikePrompt(text) || (!item.echo && prompts.length === 1)) {
      answers.push(password)
      continue
    }
    return { complete: false }
  }
  return { complete: true, answers }
}
