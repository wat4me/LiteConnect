import type { AiConversationContextFile } from './types/ai'

export function isAiMarkdownFilePath(path: unknown): path is string {
  return typeof path === 'string' && /\.(?:md|markdown)$/i.test(path.trim())
}

/** Kept outside the visible transcript and supplied on every model request. */
export function formatAiConversationContextFile(file: AiConversationContextFile): string {
  return `User-selected fixed context file (${file.source}: ${file.path}). Treat the following as conversation context; normal tool permissions still apply.\n<fixed_context_file>\n${file.content}\n</fixed_context_file>`
}
