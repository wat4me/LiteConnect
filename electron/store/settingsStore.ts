import { app, safeStorage } from 'electron'
import { mkdir, readFile, writeFile } from 'fs/promises'
import { join, dirname } from 'path'
import { randomBytes } from 'crypto'
import { DecryptionError } from '../utils/validation'
import { getDefaultAiSystemPrompt, LEGACY_AI_SYSTEM_PROMPT } from '../utils/constants'
import { t } from '../i18n'
import {
  DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS as PASTE_MAX_CHARS_DEFAULT,
  sanitizeTerminalPasteConfirmMaxChars,
  TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS as PASTE_MAX_CHARS_OPTIONS,
} from './pasteConfirmMaxChars'
import {
  DB_DEFAULT_MAX_ROWS,
  DB_DEFAULT_QUERY_TIMEOUT_SEC,
  sanitizeDbDefaultMaxRows,
  sanitizeDbDefaultQueryTimeoutSec,
  sanitizeDbDefaultRunScope,
  type DbDefaultRunScope,
} from './dbQueryTabDefaults'

export class SettingsStore {
  private settingsPath: string
  private settings: Record<string, any> = {}
  private readonly recentConnectionsLimit = 5
  private initialized = false
  private initPromise: Promise<void> | null = null

  constructor() {
    const userData = app.getPath('userData')
    this.settingsPath = join(userData, 'settings.json')
  }

  async init(): Promise<void> {
    if (this.initialized) return
    if (!this.initPromise) {
      this.initPromise = this.load().then(() => {
        this.initialized = true
      })
    }
    await this.initPromise
  }

  private async load(): Promise<void> {
    try {
      const data = await readFile(this.settingsPath, 'utf-8')
      this.settings = JSON.parse(data)
    } catch {
      this.settings = {}
    }

    // 移除已废弃的「启动恢复工作区连接」配置
    if ('workspaceLayout' in this.settings) {
      delete this.settings.workspaceLayout
      await this.save()
    }

    if (this.needsLegacyAiMigration()) {
      await this.migrateLegacyAi()
    } else if (this.needsApiKeyMigration()) {
      await this.migrateApiKey()
    }
  }

  private needsLegacyAiMigration(): boolean {
    const ai = this.settings.ai
    if (!ai || typeof ai !== 'object') return false
    return typeof ai.baseUrl === 'string' && !Array.isArray(ai.providers)
  }

  private async migrateLegacyAi(): Promise<void> {
    const ai = this.settings.ai
    if (!ai || typeof ai !== 'object') return
    const rawApiKey = typeof ai.apiKey === 'string' ? ai.apiKey : ''
    const apiKey = ai.apiKeyEncrypted ? this.decryptOrEmpty(rawApiKey) : rawApiKey
    const baseUrl = typeof ai.baseUrl === 'string' && ai.baseUrl.trim() ? ai.baseUrl : 'https://api.openai.com/v1'
    const model = typeof ai.model === 'string' && ai.model.trim() ? ai.model : 'gpt-4o-mini'
    const providerId = 'default'
    this.settings.ai = {
      providers: [
        {
          id: providerId,
          name: 'OpenAI',
          baseUrl,
          apiKey: this.encrypt(apiKey),
          apiKeyEncrypted: safeStorage.isEncryptionAvailable() && !!apiKey,
          models: [model],
        },
      ],
      activeProviderId: providerId,
      activeModel: model,
      systemPrompt: typeof ai.systemPrompt === 'string' && ai.systemPrompt !== LEGACY_AI_SYSTEM_PROMPT
        ? ai.systemPrompt
        : getDefaultAiSystemPrompt(),
    }
    await this.save()
  }

  private needsApiKeyMigration(): boolean {
    const ai = this.settings.ai
    if (!ai || typeof ai !== 'object') return false
    if (!Array.isArray(ai.providers)) return false
    return ai.providers.some((p: any) => typeof p.apiKey === 'string' && p.apiKey && !p.apiKeyEncrypted)
  }

  private async migrateApiKey(): Promise<void> {
    const ai = this.settings.ai
    if (!ai || !Array.isArray(ai.providers)) return
    let changed = false
    for (const provider of ai.providers) {
      if (typeof provider.apiKey === 'string' && provider.apiKey && !provider.apiKeyEncrypted) {
        provider.apiKey = this.encrypt(provider.apiKey)
        provider.apiKeyEncrypted = safeStorage.isEncryptionAvailable() && !!provider.apiKey
        changed = true
      }
    }
    if (changed) await this.save()
  }

  private async save(): Promise<void> {
    try {
      await mkdir(dirname(this.settingsPath), { recursive: true })
      await writeFile(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (err) {
      console.error('Failed to save settings:', err)
    }
  }

  /** Resolved download directory (custom or OS default). */
  getDownloadPath(): string {
    return this.settings.downloadPath || app.getPath('downloads')
  }

  /** Always the OS "Downloads" folder (Electron app.getPath('downloads')). */
  getDefaultDownloadPath(): string {
    return app.getPath('downloads')
  }

  /**
   * User-configured path only; empty string means "use system default".
   * Prefer this when the UI needs to know whether a custom path is set.
   */
  getConfiguredDownloadPath(): string {
    const p = this.settings.downloadPath
    return typeof p === 'string' && p.trim() ? p.trim() : ''
  }

  async setDownloadPath(dirPath: string): Promise<void> {
    this.settings.downloadPath = dirPath
    await this.save()
  }

  getRecentConnectionIds(): string[] {
    const ids = this.settings.recentConnectionIds
    if (!Array.isArray(ids)) return []
    return ids.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
  }

  async recordRecentConnection(connectionId: string): Promise<void> {
    const trimmedId = connectionId.trim()
    if (!trimmedId) return

    const ids = this.getRecentConnectionIds().filter((id) => id !== trimmedId)
    ids.unshift(trimmedId)
    this.settings.recentConnectionIds = ids.slice(0, this.recentConnectionsLimit)
    await this.save()
  }

  async pruneRecentConnectionIds(validIds: string[]): Promise<void> {
    const validSet = new Set(validIds)
    const filtered = this.getRecentConnectionIds().filter((id) => validSet.has(id))
    this.settings.recentConnectionIds = filtered
    await this.save()
  }

  getTerminalFontSize(): number {
    return this.settings.terminalFontSize || 14
  }

  async setTerminalFontSize(size: number): Promise<void> {
    this.settings.terminalFontSize = Math.max(10, Math.min(24, size))
    await this.save()
  }

  getTerminalFontFamily(): string {
    const val = this.settings.terminalFontFamily
    return typeof val === 'string' && val.trim() ? val.trim() : 'Cascadia Code, Fira Code, Consolas, Courier New, monospace'
  }

  async setTerminalFontFamily(family: string): Promise<void> {
    this.settings.terminalFontFamily = typeof family === 'string' && family.trim()
      ? family.trim()
      : 'Cascadia Code, Fira Code, Consolas, Courier New, monospace'
    await this.save()
  }

  /** Database client: SQL editor / grid monospace font (independent of terminal). */
  getDbFontFamily(): string {
    const val = this.settings.dbFontFamily
    return typeof val === 'string' && val.trim()
      ? val.trim()
      : 'Cascadia Code, Fira Code, Consolas, Courier New, monospace'
  }

  async setDbFontFamily(family: string): Promise<void> {
    this.settings.dbFontFamily = typeof family === 'string' && family.trim()
      ? family.trim()
      : 'Cascadia Code, Fira Code, Consolas, Courier New, monospace'
    await this.save()
  }

  getDbFontSize(): number {
    const n = this.settings.dbFontSize
    if (typeof n !== 'number' || Number.isNaN(n)) return 13
    return Math.max(10, Math.min(24, Math.round(n)))
  }

  async setDbFontSize(size: number): Promise<void> {
    this.settings.dbFontSize = Math.max(10, Math.min(24, Math.round(size)))
    await this.save()
  }

  /** Default rows-per-page when opening a table data tab. */
  getDbPageSize(): number {
    const n = this.settings.dbPageSize
    const allowed = [50, 100, 200, 500]
    if (typeof n === 'number' && allowed.includes(n)) return n
    return 100
  }

  async setDbPageSize(size: number): Promise<void> {
    const allowed = [50, 100, 200, 500]
    this.settings.dbPageSize = allowed.includes(size) ? size : 100
    await this.save()
  }

  /** Confirm DROP/TRUNCATE/UPDATE|DELETE without WHERE before run (DB-009). Default true. */
  getDbConfirmDangerousSql(): boolean {
    return this.settings.dbConfirmDangerousSql !== false
  }

  async setDbConfirmDangerousSql(enabled: boolean): Promise<void> {
    this.settings.dbConfirmDangerousSql = !!enabled
    await this.save()
  }

  /**
   * Global default max rows for newly created query tabs (1..100000).
   * Does not hot-overwrite open tabs or drafts with explicit values.
   */
  static readonly DEFAULT_DB_DEFAULT_MAX_ROWS = DB_DEFAULT_MAX_ROWS
  static sanitizeDbDefaultMaxRows = sanitizeDbDefaultMaxRows

  getDbDefaultMaxRows(): number {
    return sanitizeDbDefaultMaxRows(this.settings.dbDefaultMaxRows)
  }

  async setDbDefaultMaxRows(n: number): Promise<void> {
    this.settings.dbDefaultMaxRows = sanitizeDbDefaultMaxRows(n)
    await this.save()
  }

  /**
   * Global default query timeout for newly created query tabs (seconds, 1..600).
   * Product default 120s; backend clamp remains authoritative at execute time.
   */
  static readonly DEFAULT_DB_DEFAULT_QUERY_TIMEOUT_SEC = DB_DEFAULT_QUERY_TIMEOUT_SEC
  static sanitizeDbDefaultQueryTimeoutSec = sanitizeDbDefaultQueryTimeoutSec

  getDbDefaultQueryTimeoutSec(): number {
    return sanitizeDbDefaultQueryTimeoutSec(this.settings.dbDefaultQueryTimeoutSec)
  }

  async setDbDefaultQueryTimeoutSec(sec: number): Promise<void> {
    this.settings.dbDefaultQueryTimeoutSec = sanitizeDbDefaultQueryTimeoutSec(sec)
    await this.save()
  }

  /**
   * Global default run scope for newly created query tabs.
   * Per-tab popover still overrides; only seeds new tabs / legacy draft gaps.
   */
  static sanitizeDbDefaultRunScope = sanitizeDbDefaultRunScope

  getDbDefaultRunScope(): DbDefaultRunScope {
    return sanitizeDbDefaultRunScope(this.settings.dbDefaultRunScope)
  }

  async setDbDefaultRunScope(scope: string): Promise<void> {
    this.settings.dbDefaultRunScope = sanitizeDbDefaultRunScope(scope)
    await this.save()
  }

  /** UI theme follows data-theme; terminal palette can diverge (e.g. Dracula on dark UI). */
  getTerminalPalette(): string {
    const val = this.settings.terminalPalette
    const allowed = ['auto', 'dark', 'light', 'eyecare', 'dracula', 'solarized-dark', 'solarized-light', 'monokai']
    return typeof val === 'string' && allowed.includes(val) ? val : 'auto'
  }

  async setTerminalPalette(palette: string): Promise<void> {
    this.settings.terminalPalette = palette
    await this.save()
  }

  /** xterm scrollback lines (2k–20k). */
  getTerminalScrollback(): number {
    const n = this.settings.terminalScrollback
    if (typeof n !== 'number' || Number.isNaN(n)) return 5000
    return Math.max(2000, Math.min(20000, Math.round(n)))
  }

  async setTerminalScrollback(n: number): Promise<void> {
    this.settings.terminalScrollback = Math.max(2000, Math.min(20000, Math.round(n)))
    await this.save()
  }

  /** Confirm before pasting multi-line / long clipboard text. Default on. */
  getTerminalPasteConfirmEnabled(): boolean {
    return this.settings.terminalPasteConfirmEnabled !== false
  }

  async setTerminalPasteConfirmEnabled(enabled: boolean): Promise<void> {
    this.settings.terminalPasteConfirmEnabled = enabled
    await this.save()
  }

  /** Single-line paste confirm threshold (chars). Multiline always confirms when master switch on. */
  static readonly TERMINAL_PASTE_CONFIRM_MAX_CHARS_OPTIONS = PASTE_MAX_CHARS_OPTIONS
  static readonly DEFAULT_TERMINAL_PASTE_CONFIRM_MAX_CHARS = PASTE_MAX_CHARS_DEFAULT
  static sanitizeTerminalPasteConfirmMaxChars = sanitizeTerminalPasteConfirmMaxChars

  getTerminalPasteConfirmMaxChars(): number {
    return sanitizeTerminalPasteConfirmMaxChars(this.settings.terminalPasteConfirmMaxChars)
  }

  async setTerminalPasteConfirmMaxChars(n: number): Promise<void> {
    this.settings.terminalPasteConfirmMaxChars = sanitizeTerminalPasteConfirmMaxChars(n)
    await this.save()
  }

  /** Default strategy when a local download path already exists. */
  getDownloadConflictStrategy(): 'overwrite' | 'skip' | 'rename' {
    const v = this.settings.downloadConflictStrategy
    if (v === 'overwrite' || v === 'skip' || v === 'rename') return v
    return 'rename'
  }

  async setDownloadConflictStrategy(strategy: string): Promise<void> {
    if (strategy !== 'overwrite' && strategy !== 'skip' && strategy !== 'rename') {
      throw new Error('Invalid download conflict strategy')
    }
    this.settings.downloadConflictStrategy = strategy
    await this.save()
  }

  /** Concurrent files for directory SFTP transfer (default 3, clamp 1–8). */
  getDirTransferConcurrency(): number {
    const n = this.settings.dirTransferConcurrency
    if (typeof n !== 'number' || !Number.isFinite(n)) return 3
    return Math.max(1, Math.min(8, Math.round(n)))
  }

  async setDirTransferConcurrency(n: number): Promise<void> {
    if (typeof n !== 'number' || !Number.isFinite(n)) {
      throw new Error('Invalid directory transfer concurrency')
    }
    this.settings.dirTransferConcurrency = Math.max(1, Math.min(8, Math.round(n)))
    await this.save()
  }

  /** On single-file failure during directory transfer: stop or continue. Default stop. */
  getDirTransferFailPolicy(): 'continue' | 'stop' {
    const v = this.settings.dirTransferFailPolicy
    if (v === 'continue' || v === 'stop') return v
    return 'stop'
  }

  async setDirTransferFailPolicy(policy: string): Promise<void> {
    if (policy !== 'continue' && policy !== 'stop') {
      throw new Error('Invalid directory transfer fail policy')
    }
    this.settings.dirTransferFailPolicy = policy
    await this.save()
  }

  getAutoReconnectEnabled(): boolean {
    return this.settings.autoReconnectEnabled !== false
  }

  async setAutoReconnectEnabled(enabled: boolean): Promise<void> {
    this.settings.autoReconnectEnabled = enabled
    await this.save()
  }

  /** When X11 forwarding is on and no local X is listening, try to start VcXsrv/Xming. Default on. */
  getX11AutoStartEnabled(): boolean {
    return this.settings.x11AutoStartEnabled !== false
  }

  async setX11AutoStartEnabled(enabled: boolean): Promise<void> {
    this.settings.x11AutoStartEnabled = enabled
    await this.save()
  }

  /** Optional full path to vcxsrv.exe / Xming.exe. Empty → auto-detect common install dirs. */
  getX11ServerPath(): string {
    const v = this.settings.x11ServerPath
    return typeof v === 'string' ? v.trim() : ''
  }

  async setX11ServerPath(path: string): Promise<void> {
    this.settings.x11ServerPath = typeof path === 'string' ? path.trim() : ''
    await this.save()
  }

  getAutoReconnectMaxRetries(): number {
    const n = this.settings.autoReconnectMaxRetries
    if (typeof n !== 'number' || n < 0) return 5
    return Math.min(20, Math.round(n))
  }

  async setAutoReconnectMaxRetries(n: number): Promise<void> {
    this.settings.autoReconnectMaxRetries = Math.max(0, Math.min(20, Math.round(n)))
    await this.save()
  }

  getCommandSnippets(): Array<{
    id: string
    name: string
    command: string
    group?: string
    pinned?: boolean
    sortOrder?: number
    sendMode?: 'run' | 'fill'
    hotkey?: string
    useCount?: number
    lastUsedAt?: number
    createdAt: number
    updatedAt: number
  }> {
    const list = this.settings.commandSnippets
    if (!Array.isArray(list)) return []
    return list
      .filter((s: any) => s && typeof s.id === 'string' && typeof s.command === 'string')
      .map((s: any, index: number) => this.normalizeSnippetRecord(s, index, false))
  }

  private normalizeSnippetRecord(s: any, index: number, bumpUpdatedAt: boolean) {
    const now = Date.now()
    const sendMode = s?.sendMode === 'fill' ? 'fill' : 'run'
    const hotkey =
      typeof s?.hotkey === 'string' && s.hotkey.trim() ? s.hotkey.trim().slice(0, 40) : undefined
    return {
      id: typeof s?.id === 'string' && s.id ? s.id : randomBytes(6).toString('hex'),
      name: typeof s?.name === 'string' && s.name.trim() ? s.name.trim().slice(0, 80) : t('common.unnamed'),
      command: typeof s?.command === 'string' ? s.command.trim().slice(0, 8000) : '',
      group: typeof s?.group === 'string' && s.group.trim() ? s.group.trim().slice(0, 40) : undefined,
      pinned: s?.pinned === true,
      sortOrder: typeof s?.sortOrder === 'number' && Number.isFinite(s.sortOrder) ? s.sortOrder : index,
      sendMode: sendMode as 'run' | 'fill',
      hotkey,
      useCount: typeof s?.useCount === 'number' && s.useCount > 0 ? Math.round(s.useCount) : 0,
      lastUsedAt: typeof s?.lastUsedAt === 'number' ? s.lastUsedAt : undefined,
      createdAt: typeof s?.createdAt === 'number' ? s.createdAt : now,
      updatedAt: bumpUpdatedAt
        ? now
        : typeof s?.updatedAt === 'number'
          ? s.updatedAt
          : now,
    }
  }

  async setCommandSnippets(
    snippets: Array<{
      id?: string
      name: string
      command: string
      group?: string
      pinned?: boolean
      sortOrder?: number
      sendMode?: 'run' | 'fill'
      hotkey?: string
      useCount?: number
      lastUsedAt?: number
      createdAt?: number
      updatedAt?: number
    }>,
  ): Promise<
    Array<{
      id: string
      name: string
      command: string
      group?: string
      pinned?: boolean
      sortOrder?: number
      sendMode?: 'run' | 'fill'
      hotkey?: string
      useCount?: number
      lastUsedAt?: number
      createdAt: number
      updatedAt: number
    }>
  > {
    const normalized = (Array.isArray(snippets) ? snippets : [])
      .filter((s) => s && typeof s.command === 'string' && s.command.trim())
      .slice(0, 200)
      .map((s, index) => this.normalizeSnippetRecord(s, index, true))
    this.settings.commandSnippets = normalized
    await this.save()
    return normalized
  }

  getRecentDownloadPaths(): string[] {
    const paths = this.settings.recentDownloadPaths
    if (!Array.isArray(paths)) return []
    return paths.filter((p): p is string => typeof p === 'string' && p.length > 0)
  }

  getCredentialAutoFillEnabled(): boolean {
    return this.settings.credentialAutoFillEnabled === true
  }

  async setCredentialAutoFillEnabled(enabled: boolean): Promise<void> {
    this.settings.credentialAutoFillEnabled = enabled
    await this.save()
  }

  async addRecentDownloadPath(dirPath: string): Promise<void> {
    const paths = this.getRecentDownloadPaths().filter((p) => p !== dirPath)
    paths.unshift(dirPath)
    this.settings.recentDownloadPaths = paths.slice(0, 5)
    await this.save()
  }

  getLatencyEnabled(): boolean {
    return this.settings.latencyEnabled !== false
  }

  async setLatencyEnabled(enabled: boolean): Promise<void> {
    this.settings.latencyEnabled = enabled
    await this.save()
  }

  getLatencyIntervalMs(): number {
    const val = this.settings.latencyIntervalMs
    if (typeof val !== 'number' || val < 1000) return 10000
    if (val > 60000) return 60000
    return val
  }

  async setLatencyIntervalMs(intervalMs: number): Promise<void> {
    this.settings.latencyIntervalMs = Math.max(1000, Math.min(60000, Math.round(intervalMs)))
    await this.save()
  }

  getMonitorEnabled(): boolean {
    return this.settings.monitorEnabled !== false
  }

  async setMonitorEnabled(enabled: boolean): Promise<void> {
    this.settings.monitorEnabled = enabled
    await this.save()
  }

  getMonitorIntervalMs(): number {
    const val = this.settings.monitorIntervalMs
    if (typeof val !== 'number' || val < 2000) return 5000
    if (val > 30000) return 30000
    return val
  }

  async setMonitorIntervalMs(intervalMs: number): Promise<void> {
    this.settings.monitorIntervalMs = Math.max(2000, Math.min(30000, Math.round(intervalMs)))
    await this.save()
  }

  getAutoUpdateEnabled(): boolean {
    // Default off: GitHub releases are often unreachable in restricted networks.
    return this.settings.autoUpdateEnabled === true
  }

  async setAutoUpdateEnabled(enabled: boolean): Promise<void> {
    this.settings.autoUpdateEnabled = enabled
    await this.save()
  }

  getSkippedUpdateVersion(): string {
    return this.settings.skippedUpdateVersion || ''
  }

  async setSkippedUpdateVersion(version: string): Promise<void> {
    this.settings.skippedUpdateVersion = version
    await this.save()
  }

  getTheme(): string {
    const t = this.settings.theme
    return t === 'light' || t === 'eyecare' || t === 'custom' ? t : 'dark'
  }

  async setTheme(theme: string): Promise<void> {
    this.settings.theme = theme
    await this.save()
  }

  getCustomColors(): { fontColor: string; bgColor: string } | null {
    const c = this.settings.customColors
    if (!c || typeof c !== 'object') return null
    if (typeof c.fontColor !== 'string' || typeof c.bgColor !== 'string') return null
    return { fontColor: c.fontColor, bgColor: c.bgColor }
  }

  async setCustomColors(colors: { fontColor: string; bgColor: string }): Promise<void> {
    this.settings.customColors = colors
    await this.save()
  }

  private encrypt(value: string): string {
    if (!value) return value
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(value).toString('base64')
    }
    return value
  }

  private decrypt(value: string): string {
    if (!value) return value
    if (safeStorage.isEncryptionAvailable()) {
      try {
        return safeStorage.decryptString(Buffer.from(value, 'base64'))
      } catch {
        throw new DecryptionError(t('crypto.apiKeyDecryptFailed'), 'apiKey')
      }
    }
    return value
  }

  private decryptOrEmpty(value: string): string {
    try {
      return this.decrypt(value)
    } catch {
      return ''
    }
  }

  getAiSettings(): {
    providers: any[]
    activeProviderId: string | null
    activeModel: string
    systemPrompt: string
    temperature: number
  } {
    const ai = this.settings.ai
    if (!ai || !Array.isArray(ai.providers) || ai.providers.length === 0) {
      return this.getDefaultAiSettings()
    }
    const providers = ai.providers.map((p: any) => this.normalizeAiProvider(p))
    const activeProviderId = typeof ai.activeProviderId === 'string' && ai.activeProviderId
      ? ai.activeProviderId
      : (providers[0]?.id ?? null)
    const activeProvider = providers.find((p: any) => p.id === activeProviderId) || providers[0]
    const activeModel = typeof ai.activeModel === 'string' && ai.activeModel.trim()
      ? ai.activeModel
      : (activeProvider?.models[0] || 'gpt-4o-mini')
    return {
      providers,
      activeProviderId,
      activeModel,
      systemPrompt: typeof ai.systemPrompt === 'string' && ai.systemPrompt !== LEGACY_AI_SYSTEM_PROMPT
        ? ai.systemPrompt
        : getDefaultAiSystemPrompt(),
      temperature: this.clampAiTemperature(ai.temperature),
    }
  }

  private clampAiTemperature(raw: unknown): number {
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (Number.isNaN(n)) return 0.7
    return Math.max(0, Math.min(2, Math.round(n * 100) / 100))
  }

  private getDefaultAiSettings() {
    return {
      providers: [],
      activeProviderId: null,
      activeModel: '',
      systemPrompt: getDefaultAiSystemPrompt(),
      temperature: 0.7,
    }
  }

  private normalizeAiProvider(p: any): any {
    const rawApiKey = typeof p.apiKey === 'string' ? p.apiKey : ''
    const apiKey = p.apiKeyEncrypted ? this.decryptOrEmpty(rawApiKey) : rawApiKey
    const models = Array.isArray(p.models)
      ? p.models.filter((m: any) => typeof m === 'string' && m.trim()).map((m: string) => m.trim())
      : []
    return {
      id: typeof p.id === 'string' && p.id ? p.id : randomBytes(6).toString('hex'),
      name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : t('common.unnamedProvider'),
      baseUrl: typeof p.baseUrl === 'string' && p.baseUrl.trim() ? p.baseUrl.trim() : 'https://api.openai.com/v1',
      apiKey,
      models,
    }
  }

  async setAiSettings(settings: any): Promise<void> {
    const providers = Array.isArray(settings.providers) ? settings.providers : []
    this.settings.ai = {
      providers: providers.map((p: any) => ({
        id: typeof p.id === 'string' && p.id ? p.id : randomBytes(6).toString('hex'),
        name: typeof p.name === 'string' && p.name.trim() ? p.name.trim() : t('common.unnamedProvider'),
        baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl.trim() : '',
        apiKey: this.encrypt(typeof p.apiKey === 'string' ? p.apiKey : ''),
        apiKeyEncrypted: safeStorage.isEncryptionAvailable() && !!p.apiKey,
        models: Array.isArray(p.models)
          ? p.models.filter((m: any) => typeof m === 'string' && m.trim()).map((m: string) => m.trim())
          : [],
      })),
      activeProviderId: typeof settings.activeProviderId === 'string' ? settings.activeProviderId : (providers[0]?.id ?? null),
      activeModel: typeof settings.activeModel === 'string' ? settings.activeModel.trim() : '',
      systemPrompt: typeof settings.systemPrompt === 'string' ? settings.systemPrompt : getDefaultAiSystemPrompt(),
      temperature: this.clampAiTemperature(settings.temperature),
    }
    await this.save()
  }

  async switchAiModel(providerId: string, model: string): Promise<any> {
    const ai = this.settings.ai
    if (!ai || !Array.isArray(ai.providers)) return this.getAiSettings()
    const provider = ai.providers.find((p: any) => p.id === providerId)
    if (!provider) return this.getAiSettings()
    ai.activeProviderId = providerId
    ai.activeModel = model.trim() || (provider.models[0] || '')
    await this.save()
    return this.getAiSettings()
  }

  getAiResolvedConfig(): {
    baseUrl: string
    model: string
    apiKey: string
    systemPrompt: string
    temperature: number
  } {
    const settings = this.getAiSettings()
    const provider = settings.providers.find((p: any) => p.id === settings.activeProviderId) || settings.providers[0]
    if (!provider) {
      return {
        baseUrl: '',
        model: '',
        apiKey: '',
        systemPrompt: settings.systemPrompt,
        temperature: settings.temperature,
      }
    }
    return {
      baseUrl: provider.baseUrl,
      model: settings.activeModel || provider.models[0] || '',
      apiKey: provider.apiKey,
      systemPrompt: settings.systemPrompt,
      temperature: settings.temperature,
    }
  }
}
