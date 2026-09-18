import { useI18n } from 'vue-i18n'

/**
 * Friendly display label for a tool name (exec → 工具调用).
 * Falls back to the raw name for unknown/MCP-provided tools.
 */
export function useAiToolNameLabel() {
  const { t, te } = useI18n()
  return (name: string): string => {
    const key = `ai.toolName.${name}`
    return te(key) ? t(key) : name
  }
}
