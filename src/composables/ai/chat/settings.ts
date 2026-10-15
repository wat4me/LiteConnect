import { computed, ref } from 'vue'
import type { AiSettings } from '@shared/types/ai'
import { firstAiModelId, resolveModelContextWindow } from '@shared/aiContext'

function emptyAiSettings(): AiSettings {
  return {
    providers: [],
    activeProviderId: null,
    activeModel: '',
    systemPrompt: '',
    toolPermission: 'ask',
  }
}

/** One copy for every sidebar instance — providers are app-wide, not per SSH session. */
export const settings = ref<AiSettings>(emptyAiSettings())

let settingsEpoch = 0

export function replaceAiSettings(next: AiSettings) {
  settingsEpoch += 1
  settings.value = next
}

export async function refreshAiSettings(): Promise<AiSettings> {
  const epoch = ++settingsEpoch
  const next = await window.LiteConnect.getAiSettings()
  if (epoch !== settingsEpoch) return settings.value
  settings.value = next
  return next
}

export function useAiModelSelection() {
  const activeProvider = computed(() =>
    settings.value.providers.find((p) => p.id === settings.value.activeProviderId) || settings.value.providers[0] || null
  )

  const displayModelName = computed(() => {
    if (!activeProvider.value) return ''
    return settings.value.activeModel || firstAiModelId(activeProvider.value.models)
  })

  const activeContextWindowTokens = computed(() =>
    resolveModelContextWindow({
      model: displayModelName.value,
      models: activeProvider.value?.models,
      fallback: settings.value.contextWindowTokens,
    }),
  )

  return { activeProvider, displayModelName, activeContextWindowTokens }
}
