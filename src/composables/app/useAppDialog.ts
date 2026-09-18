import { reactive, readonly } from 'vue'
import { t } from '@/i18n'

export type AppDialogMode = 'confirm' | 'prompt'

export type AppConfirmResult = 'confirm' | 'tertiary'

export interface AppConfirmOptions {
  title: string
  message: string
  /** Secondary description under the main message */
  detail?: string
  confirmText?: string
  cancelText?: string
  /**
   * Optional third action between cancel and confirm
   * (e.g. "仍然保存" while confirm goes to settings).
   * Resolves the promise with `'tertiary'`.
   */
  tertiaryText?: string
  /** Use danger styling on confirm button */
  danger?: boolean
  /** 'warning' | 'danger' | 'info' — icon tone */
  tone?: 'warning' | 'danger' | 'info'
}

export interface AppPromptOptions {
  title: string
  message?: string
  detail?: string
  confirmText?: string
  cancelText?: string
  inputValue?: string
  inputPlaceholder?: string
  inputType?: 'text' | 'password'
  /** Return true if valid, or an error string */
  validate?: (value: string) => true | string
  /** Simple non-empty check when validate not provided */
  required?: boolean
  requiredMessage?: string
  maxLength?: number
}

interface DialogState {
  visible: boolean
  mode: AppDialogMode
  title: string
  message: string
  detail: string
  confirmText: string
  cancelText: string
  tertiaryText: string
  danger: boolean
  tone: 'warning' | 'danger' | 'info'
  inputValue: string
  inputPlaceholder: string
  inputType: 'text' | 'password'
  inputError: string
  maxLength: number
  validate: ((value: string) => true | string) | null
  required: boolean
  requiredMessage: string
}

type Resolver = {
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

const state = reactive<DialogState>({
  visible: false,
  mode: 'confirm',
  title: '',
  message: '',
  detail: '',
  confirmText: t('common.ok'),
  cancelText: t('common.cancel'),
  tertiaryText: '',
  danger: false,
  tone: 'info',
  inputValue: '',
  inputPlaceholder: '',
  inputType: 'text',
  inputError: '',
  maxLength: 200,
  validate: null,
  required: true,
  requiredMessage: t('dialog.requiredEmpty'),
})

let pending: Resolver | null = null

function resetPending(reject = true) {
  if (pending && reject) {
    pending.reject('cancel')
  }
  pending = null
}

function openBase(partial: Partial<DialogState>) {
  // Close any previous dialog as cancelled
  if (state.visible) {
    resetPending(true)
  }
  Object.assign(state, {
    visible: true,
    mode: 'confirm',
    title: '',
    message: '',
    detail: '',
    confirmText: t('common.ok'),
    cancelText: t('common.cancel'),
    tertiaryText: '',
    danger: false,
    tone: 'info',
    inputValue: '',
    inputPlaceholder: '',
    inputType: 'text',
    inputError: '',
    maxLength: 200,
    validate: null,
    required: true,
    requiredMessage: t('dialog.requiredEmpty'),
    ...partial,
  })
}

export function appConfirm(options: AppConfirmOptions): Promise<AppConfirmResult> {
  return new Promise((resolve, reject) => {
    pending = {
      resolve: (value) => resolve((value as AppConfirmResult) || 'confirm'),
      reject,
    }
    openBase({
      mode: 'confirm',
      title: options.title,
      message: options.message,
      detail: options.detail || '',
      confirmText: options.confirmText || (options.danger ? t('common.delete') : t('common.ok')),
      cancelText: options.cancelText || t('common.cancel'),
      tertiaryText: options.tertiaryText || '',
      danger: !!options.danger,
      tone: options.tone || (options.danger ? 'danger' : 'warning'),
    })
  })
}

export function appPrompt(options: AppPromptOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    pending = {
      resolve: (v) => resolve(String(v ?? '')),
      reject,
    }
    openBase({
      mode: 'prompt',
      title: options.title,
      message: options.message || '',
      detail: options.detail || '',
      confirmText: options.confirmText || t('common.ok'),
      cancelText: options.cancelText || t('common.cancel'),
      danger: false,
      tone: 'info',
      inputValue: options.inputValue || '',
      inputPlaceholder: options.inputPlaceholder || '',
      inputType: options.inputType || 'text',
      inputError: '',
      maxLength: options.maxLength ?? 200,
      validate: options.validate || null,
      required: options.required !== false,
      requiredMessage: options.requiredMessage || t('dialog.requiredEmpty'),
    })
  })
}

export function appDialogConfirm() {
  if (state.mode === 'prompt') {
    const value = state.inputValue
    if (state.required && !value.trim()) {
      state.inputError = state.requiredMessage
      return
    }
    if (state.validate) {
      const result = state.validate(value)
      if (result !== true) {
        state.inputError = typeof result === 'string' ? result : t('dialog.invalidInput')
        return
      }
    }
    const resolver = pending
    pending = null
    state.visible = false
    resolver?.resolve(value.trim())
    return
  }

  const resolver = pending
  pending = null
  state.visible = false
  resolver?.resolve('confirm')
}

/** Middle action for confirm dialogs that set `tertiaryText`. */
export function appDialogTertiary() {
  if (state.mode !== 'confirm' || !state.tertiaryText) return
  const resolver = pending
  pending = null
  state.visible = false
  resolver?.resolve('tertiary')
}

export function appDialogCancel() {
  const resolver = pending
  pending = null
  state.visible = false
  resolver?.reject('cancel')
}

export function useAppDialogState() {
  return readonly(state)
}

/** Mutable input binding for the host component */
export function useAppDialogMutable() {
  return state
}
