export type X11Mode = 'auto' | 'off' | 'custom'

/** Legacy false was the form default, not an explicit opt-out of automatic X11. */
export function resolveX11Mode(profile: { x11Mode?: X11Mode; x11Forwarding?: boolean }): X11Mode {
  if (profile.x11Mode === 'off' || profile.x11Mode === 'custom') return profile.x11Mode
  if (profile.x11Mode === 'auto') return 'auto'
  if (profile.x11Forwarding) return 'custom'
  return 'auto'
}
