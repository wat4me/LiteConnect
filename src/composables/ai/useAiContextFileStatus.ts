import { ref, watch, type ComputedRef } from 'vue'
import type { AiConversationContextFile } from '@shared/types/ai'

type SourceStatus = 'checking' | 'available' | 'missing' | 'unavailable'

export function useAiContextFileStatus(options: {
  sessionId: () => string
  active: () => boolean
  openGeneration: () => number
  files: ComputedRef<AiConversationContextFile[]>
}) {
  const contextFileSourceStatus = ref<Record<string, SourceStatus>>({})
  const contextFileKey = (file: AiConversationContextFile) => `${file.source}:${file.path}`
  let checkVersion = 0

  async function checkContextFileSource(): Promise<void> {
    const version = ++checkVersion
    if (!options.active()) {
      contextFileSourceStatus.value = {}
      return
    }
    const files = [...options.files.value]
    contextFileSourceStatus.value = Object.fromEntries(files.map(file => [contextFileKey(file), 'checking']))
    await Promise.all(files.map(async file => {
      let status: Exclude<SourceStatus, 'checking'>
      try {
        if (file.source === 'local') status = await window.LiteConnect.aiCheckLocalContextFile(file.path)
        else {
          const stat = await window.LiteConnect.sftpStat(options.sessionId(), file.path)
          status = stat.isDirectory ? 'missing' : 'available'
        }
      } catch (error: any) {
        status = file.source === 'ssh' && /no such file|not found|does not exist|不存在/i.test(String(error?.message || ''))
          ? 'missing' : 'unavailable'
      }
      if (version === checkVersion) contextFileSourceStatus.value[contextFileKey(file)] = status
    }))
  }

  watch([options.files, options.active, options.openGeneration, options.sessionId], () => {
    void checkContextFileSource()
  }, { immediate: true })

  return { contextFileSourceStatus, contextFileKey, checkContextFileSource }
}
