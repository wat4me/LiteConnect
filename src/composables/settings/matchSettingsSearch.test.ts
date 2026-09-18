import { describe, expect, it } from 'vitest'
import { matchSettingsSearch, normalizeSettingsQuery } from './matchSettingsSearch'

const items = [
  {
    id: 'about.updates',
    title: '应用更新',
    hint: '默认关闭：不少网络访问不了 GitHub Releases',
    tabLabel: '关于',
    keywords: ['自动更新', '升级', '检查更新', 'github'],
  },
  {
    id: 'appearance.closeToTray',
    title: '关闭窗口时最小化到托盘',
    hint: '开启后点关闭按钮会隐藏到系统托盘',
    tabLabel: '外观',
    keywords: ['托盘', '最小化', '关闭窗口'],
  },
  {
    id: 'terminal.fontSize',
    title: '字体大小',
    tabLabel: '终端',
    keywords: ['字号', '大小'],
  },
  {
    id: 'database.fontSize',
    title: '字体大小',
    tabLabel: '数据库',
    keywords: ['字号'],
  },
]

describe('matchSettingsSearch', () => {
  it('normalizes spaces', () => {
    expect(normalizeSettingsQuery(' 自动  更新 ')).toBe('自动更新')
  })

  it('finds auto-update by keyword', () => {
    const hits = matchSettingsSearch(items, '自动更新')
    expect(hits.map((h) => h.id)).toEqual(['about.updates'])
  })

  it('finds tray by a short keyword', () => {
    const hits = matchSettingsSearch(items, '托盘')
    expect(hits[0]?.id).toBe('appearance.closeToTray')
  })

  it('ranks title match above same-named items only by query in title', () => {
    const hits = matchSettingsSearch(items, '字体')
    expect(hits.map((h) => h.id)).toEqual(['terminal.fontSize', 'database.fontSize'])
  })

  it('returns nothing for empty query', () => {
    expect(matchSettingsSearch(items, '   ')).toEqual([])
  })
})
