/** localStorage keys for one-shot tips / onboarding */

export const ONBOARDING_TIPS_KEY = 'LiteConnect.onboardingTips.v1'
export const TIP_AI_KEY = 'LiteConnect.tip.ai.v1'
export const TIP_MONITOR_KEY = 'LiteConnect.tip.monitor.v1'

export const ALL_FEATURE_TIP_KEYS = [
  ONBOARDING_TIPS_KEY,
  TIP_AI_KEY,
  TIP_MONITOR_KEY,
] as const

export function hasSeenTip(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1'
  } catch {
    return true
  }
}

export function markTipSeen(key: string): void {
  try {
    localStorage.setItem(key, '1')
  } catch {
    // ignore quota / private mode
  }
}

/** Returns true if the tip has not been dismissed yet (does not mark seen). */
export function shouldShowTip(key: string): boolean {
  return !hasSeenTip(key)
}

export function resetAllFeatureTips(): void {
  for (const key of ALL_FEATURE_TIP_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // ignore
    }
  }
}
