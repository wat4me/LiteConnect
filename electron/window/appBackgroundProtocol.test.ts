import { describe, expect, it } from 'vitest'
import {
  appBackgroundImageUrl,
  sanitizeWallpaperFileName,
  wallpaperStoredName,
} from './appBackgroundProtocol'

describe('appBackgroundProtocol names', () => {
  it('accepts only wallpaper.<ext>', () => {
    expect(sanitizeWallpaperFileName('wallpaper.png')).toBe('wallpaper.png')
    expect(sanitizeWallpaperFileName('wallpaper.JPEG')).toBe('wallpaper.jpeg')
    expect(sanitizeWallpaperFileName('../settings.json')).toBeNull()
    expect(sanitizeWallpaperFileName('wallpaper.png/../../x')).toBeNull()
    expect(sanitizeWallpaperFileName('other.png')).toBeNull()
  })

  it('builds a custom-scheme url', () => {
    expect(appBackgroundImageUrl('wallpaper.webp', 1)).toBe(
      'liteconnect-bg://wallpaper/wallpaper.webp?t=1',
    )
    expect(appBackgroundImageUrl('../x.png')).toBe('')
  })

  it('maps picker extensions to stored names', () => {
    expect(wallpaperStoredName('.png')).toBe('wallpaper.png')
    expect(wallpaperStoredName('.exe')).toBeNull()
  })
})
