import { describe, expect, it } from 'vitest'
import {
  autoAnswerKeyboardPrompts,
  isOtpLikePrompt,
  isPasswordLikePrompt,
} from './keyboardInteractive'

describe('keyboardInteractive', () => {
  it('classifies password vs otp prompts', () => {
    expect(isPasswordLikePrompt('Password:')).toBe(true)
    expect(isPasswordLikePrompt('密码:')).toBe(true)
    expect(isOtpLikePrompt('Verification code:')).toBe(true)
    expect(isOtpLikePrompt('请输入动态口令')).toBe(true)
    expect(isPasswordLikePrompt('Verification code:')).toBe(false)
  })

  it('auto-fills a single password prompt', () => {
    const r = autoAnswerKeyboardPrompts([{ prompt: 'Password:', echo: false }], 's3cret')
    expect(r).toEqual({ complete: true, answers: ['s3cret'] })
  })

  it('does not auto-fill OTP', () => {
    const r = autoAnswerKeyboardPrompts([{ prompt: 'OTP:', echo: true }], 's3cret')
    expect(r).toEqual({ complete: false })
  })

  it('does not auto-fill password+otp together', () => {
    const r = autoAnswerKeyboardPrompts(
      [
        { prompt: 'Password:', echo: false },
        { prompt: 'Verification code:', echo: true },
      ],
      's3cret',
    )
    expect(r).toEqual({ complete: false })
  })

  it('needs the user when password is empty', () => {
    expect(autoAnswerKeyboardPrompts([{ prompt: 'Password:', echo: false }], '')).toEqual({
      complete: false,
    })
  })
})
