import type { SettingsDraft } from './useSettingsDraft'

/** Preserve unsaved fields while adopting another window's committed changes. */
export function rebaseSettingsDraft(draft: SettingsDraft, baseline: SettingsDraft, incoming: SettingsDraft): SettingsDraft {
  const result = { ...incoming, appBackground: { ...incoming.appBackground } }
  for (const key of Object.keys(draft) as Array<keyof SettingsDraft>) {
    if (key !== 'appBackground' && JSON.stringify(draft[key]) !== JSON.stringify(baseline[key])) Object.assign(result, { [key]: draft[key] })
  }
  for (const key of Object.keys(draft.appBackground) as Array<keyof SettingsDraft['appBackground']>) {
    if (draft.appBackground[key] !== baseline.appBackground[key]) Object.assign(result.appBackground, { [key]: draft.appBackground[key] })
  }
  return result
}
