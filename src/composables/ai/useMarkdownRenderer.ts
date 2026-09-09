export type MarkdownBlock =
  | { type: 'code'; content: string; language: string }
  | { type: 'html'; content: string }

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function sanitizeExternalUrl(value: string): string | null {
  try {
    const parsed = new URL(value)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

function renderInlineMarkdown(value: string): string {
  let rendered = escapeHtml(value)
  // Protect inline code first
  rendered = rendered.replace(/`([^`\n]+)`/g, '\x00code\x01$1\x00/code\x01')
  // Bold: ** or __
  rendered = rendered.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
  rendered = rendered.replace(/__([^_\n]+)__/g, '<strong>$1</strong>')
  // Italic: * or _ (avoid matching inside words for _)
  rendered = rendered.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>')
  rendered = rendered.replace(/(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g, '<em>$1</em>')
  // Strikethrough
  rendered = rendered.replace(/~~([^~\n]+)~~/g, '<del>$1</del>')
  // Images ![alt](url)
  rendered = rendered.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (match, alt: string, url: string) => {
    const safeUrl = sanitizeExternalUrl(url)
    if (!safeUrl) return match
    const a = escapeHtml(alt || 'image')
    return `<img class="md-image" src="${escapeHtml(safeUrl)}" alt="${a}" title="${a}" loading="lazy" />`
  })
  // Links
  rendered = rendered.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, url: string) => {
    const safeUrl = sanitizeExternalUrl(url)
    if (!safeUrl) return match
    return `<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noreferrer noopener">${label}</a>`
  })
  // Stop before ASCII `)` and CJK punctuation so `（… https://x.com）` keeps the closing `）`.
  rendered = rendered.replace(
    /(?<![="'])https?:\/\/[^\s<>"')（）【】《》「」『』。，、；：！？]+/g,
    (url: string) => {
      const safeUrl = sanitizeExternalUrl(url)
      if (!safeUrl) return url
      const escapedUrl = escapeHtml(safeUrl)
      return `<a href="${escapedUrl}" target="_blank" rel="noreferrer noopener">${escapedUrl}</a>`
    },
  )
  rendered = rendered.replace(/\x00/g, '<').replace(/\x01/g, '>')
  return rendered
}

function isTableSeparator(line: string): boolean {
  // |---|:---|---:| or ---|---
  const trimmed = line.trim()
  if (!trimmed.includes('-')) return false
  const cells = trimmed.replace(/^\|/, '').replace(/\|$/, '').split('|')
  if (cells.length < 1) return false
  return cells.every((cell) => /^\s*:?-{3,}:?\s*$/.test(cell))
}

function splitTableRow(line: string): string[] {
  let row = line.trim()
  if (row.startsWith('|')) row = row.slice(1)
  if (row.endsWith('|')) row = row.slice(0, -1)
  return row.split('|').map((c) => c.trim())
}

type FenceOpen = { char: '`' | '~'; length: number; info: string }

/**
 * CommonMark fenced code: 0–3 spaces, 3+ backticks/tildes, optional info string.
 * A closer must use the same marker, be at least as long, and have no info string
 * (` ```bash ` must not close an outer ` ```markdown ` fence).
 */
function parseFenceLine(line: string): FenceOpen | null {
  const m = line.match(/^( {0,3})(`{3,}|~{3,})(.*)$/)
  if (!m) return null
  const marker = m[2]
  const char = marker[0] as '`' | '~'
  const rest = m[3]
  if (char === '`' && rest.includes('`')) return null
  return { char, length: marker.length, info: rest.trim() }
}

function isClosingFence(line: string, open: FenceOpen): boolean {
  const parsed = parseFenceLine(line)
  if (!parsed) return false
  if (parsed.char !== open.char) return false
  if (parsed.length < open.length) return false
  return parsed.info.length === 0
}

function fenceLanguage(info: string): string {
  return (info.split(/\s+/)[0] || '')
}

/** Short line used as a section title immediately above a code fence (chat-model habit). */
function isCaptionLine(line: string): boolean {
  const t = line.trim()
  if (!t || t.length > 40) return false
  if (/[。！？]$/.test(t)) return false
  if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s)/.test(t)) return false
  return true
}

export function useMarkdownRenderer() {
  function parseMarkdown(markdown: string): MarkdownBlock[] {
    const lines = markdown.split(/\r?\n/)
    const blocks: MarkdownBlock[] = []
    let paragraph: string[] = []
    let listItems: Array<{ ordered: boolean; text: string; depth: number }> = []
    let code: string[] | null = null
    let codeLanguage = ''
    let openFence: FenceOpen | null = null

    const closeCodeFence = () => {
      if (!code) return
      const codeBody = code.join('\n')
      const lang = (codeLanguage || '').toLowerCase()
      // ```markdown / ```md is a demo of markdown — render as markdown, not a code card
      if (lang === 'markdown' || lang === 'md') {
        const nested = parseMarkdown(codeBody)
        blocks.push(...nested)
      } else {
        blocks.push({ type: 'code', content: codeBody, language: codeLanguage })
      }
      code = null
      codeLanguage = ''
      openFence = null
    }

    const flushParagraph = () => {
      if (paragraph.length === 0) return
      blocks.push({ type: 'html', content: `<p>${paragraph.map(renderInlineMarkdown).join('<br>')}</p>` })
      paragraph = []
    }

    const nextNonBlankIsFence = (fromIndex: number): boolean => {
      for (let i = fromIndex + 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue
        return !!parseFenceLine(lines[i])
      }
      return false
    }

    const emitCaption = (line: string) => {
      blocks.push({ type: 'html', content: `<h3>${renderInlineMarkdown(line.trim())}</h3>` })
    }

    /** Keep "建议的下一步" out of the preceding paragraph and render it as a heading. */
    const flushParagraphBeforeFence = () => {
      if (paragraph.length === 0) return
      const last = paragraph[paragraph.length - 1]
      if (isCaptionLine(last)) {
        paragraph.pop()
        flushParagraph()
        emitCaption(last)
        return
      }
      flushParagraph()
    }

    const flushList = () => {
      if (listItems.length === 0) return
      // Flat list by type; nested indent rendered with margin via data-depth class
      let html = ''
      let openTag: 'ul' | 'ol' | null = null

      const closeOpen = () => {
        if (openTag) {
          html += openTag === 'ol' ? '</ol>' : '</ul>'
          openTag = null
        }
      }

      for (const item of listItems) {
        const tag = item.ordered ? 'ol' : 'ul'
        if (openTag !== tag) {
          closeOpen()
          html += `<${tag}>`
          openTag = tag
        }
        const depthClass = item.depth > 0 ? ` class="md-li-depth-${Math.min(item.depth, 4)}"` : ''
        html += `<li${depthClass}>${renderInlineMarkdown(item.text)}</li>`
      }
      closeOpen()

      blocks.push({ type: 'html', content: html })
      listItems = []
    }

    const flushTable = (startIndex: number): number => {
      // lines[startIndex] is header, startIndex+1 is separator
      const header = splitTableRow(lines[startIndex])
      const rows: string[][] = []
      let i = startIndex + 2
      while (i < lines.length) {
        const line = lines[i]
        if (!line.trim() || !line.includes('|')) break
        if (line.match(/^```/)) break
        if (line.match(/^(#{1,6})\s+/)) break
        rows.push(splitTableRow(line))
        i++
      }
      const headHtml = header.map((c) => `<th>${renderInlineMarkdown(c)}</th>`).join('')
      const bodyHtml = rows
        .map((row) => {
          const cells = header.map((_, idx) => `<td>${renderInlineMarkdown(row[idx] ?? '')}</td>`).join('')
          return `<tr>${cells}</tr>`
        })
        .join('')
      blocks.push({
        type: 'html',
        content: `<div class="md-table-wrap"><table class="md-table"><thead><tr>${headHtml}</tr></thead><tbody>${bodyHtml}</tbody></table></div>`,
      })
      return i - 1
    }

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex]
      if (code && openFence) {
        if (isClosingFence(line, openFence)) {
          closeCodeFence()
          continue
        }
        code.push(line)
        continue
      }

      const fence = parseFenceLine(line)
      if (fence) {
        flushParagraphBeforeFence()
        flushList()
        code = []
        openFence = fence
        codeLanguage = fenceLanguage(fence.info)
        continue
      }

      if (!line.trim()) {
        if (nextNonBlankIsFence(lineIndex)) {
          flushParagraphBeforeFence()
        } else {
          flushParagraph()
        }
        flushList()
        continue
      }

      // GFM table: header + separator
      if (
        line.includes('|') &&
        lineIndex + 1 < lines.length &&
        isTableSeparator(lines[lineIndex + 1])
      ) {
        flushParagraph()
        flushList()
        lineIndex = flushTable(lineIndex)
        continue
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/)
      if (heading) {
        flushParagraph()
        flushList()
        const level = Math.min(heading[1].length, 6)
        blocks.push({ type: 'html', content: `<h${level}>${renderInlineMarkdown(heading[2])}</h${level}>` })
        continue
      }

      if (/^[-*_]{3,}\s*$/.test(line.trim())) {
        flushParagraph()
        flushList()
        blocks.push({ type: 'html', content: '<hr>' })
        continue
      }

      const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.+)$/)
      if (listMatch) {
        flushParagraph()
        const indent = listMatch[1].replace(/\t/g, '  ').length
        const depth = Math.floor(indent / 2)
        const marker = listMatch[2]
        const ordered = /^\d+\.$/.test(marker)
        listItems.push({ ordered, text: listMatch[3], depth })
        continue
      }

      if (line.startsWith('> ')) {
        flushParagraph()
        flushList()
        // consecutive blockquote lines
        const quoteLines = [line.slice(2)]
        while (lineIndex + 1 < lines.length && lines[lineIndex + 1].startsWith('> ')) {
          lineIndex++
          quoteLines.push(lines[lineIndex].slice(2))
        }
        blocks.push({
          type: 'html',
          content: `<blockquote>${quoteLines.map(renderInlineMarkdown).join('<br>')}</blockquote>`,
        })
        continue
      }

      paragraph.push(line)
    }

    // Streaming: unclosed fence — markdown/md still render as markdown
    if (code) closeCodeFence()
    flushParagraph()
    flushList()
    return blocks
  }

  return { parseMarkdown }
}
