import common from './zh-CN/common'
import dialog from './zh-CN/dialog'
import app from './zh-CN/app'
import settings from './zh-CN/settings'
import settingsNetwork from './zh-CN/settingsNetwork'
import settingsMcp from './zh-CN/settingsMcp'
import settingsTerminal from './zh-CN/settingsTerminal'
import connectionForm from './zh-CN/connectionForm'
import connections from './zh-CN/connections'
import x11 from './zh-CN/x11'
import shellSuggest from './zh-CN/shellSuggest'
import terminal from './zh-CN/terminal'
import sftp from './zh-CN/sftp'
import groups from './zh-CN/groups'
import credentials from './zh-CN/credentials'
import theme from './zh-CN/theme'
import toolbar from './zh-CN/toolbar'
import docker from './zh-CN/docker'
import batch from './zh-CN/batch'
import snippets from './zh-CN/snippets'
import monitor from './zh-CN/monitor'
import connectionTags from './zh-CN/connectionTags'
import settingsFiles from './zh-CN/settingsFiles'
import settingsAppearance from './zh-CN/settingsAppearance'
import settingsDatabase from './zh-CN/settingsDatabase'
import settingsShortcuts from './zh-CN/settingsShortcuts'
import database from './zh-CN/database'
import ai from './zh-CN/ai'
import about from './zh-CN/about'

export default {
  ...common,
  ...dialog,
  ...app,
  ...settings,
  ...settingsNetwork,
  ...settingsMcp,
  ...settingsTerminal,
  ...connectionForm,
  ...connections,
  ...x11,
  ...shellSuggest,
  ...terminal,
  ...sftp,
  ...groups,
  ...credentials,
  ...theme,
  ...toolbar,
  ...docker,
  ...batch,
  ...snippets,
  ...monitor,
  ...connectionTags,
  ...settingsFiles,
  ...settingsAppearance,
  ...settingsDatabase,
  ...settingsShortcuts,
  ...database,
  ...ai,
  ...about,
} as const

export type MessageSchema = typeof import('./zh-CN').default
