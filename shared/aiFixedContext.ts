export function isAiMarkdownFilePath(path: unknown): path is string {
  return typeof path === 'string' && /\.(?:md|markdown)$/i.test(path.trim())
}
