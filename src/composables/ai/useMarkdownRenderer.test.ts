import { describe, expect, it } from 'vitest'
import { useMarkdownRenderer } from './useMarkdownRenderer'

const { parseMarkdown } = useMarkdownRenderer()

const USER_SAMPLE = `活动。
13:10:57 那次的报错日志，是某个脚本/人又启动了一个 ES，第二个实例抢不到锁（ES 默认 node.max_local_storage_nodes=1）后自行退出了。curl 返回 401 也是因为 ES 开了安全认证，反而证明服务是活的。
要不要处理

如果 ES 功能正常（OA 检索、IK 分词都在用），这份报错可以忽略，当前实例没受影响。
如果你当时是想重启 ES，那问题在于：没停旧的就直接起了新的。正确顺序是：先停 → 再启，且用同一种方式（PID 29151 是用 -d -p pid 前台式 tar 包启动的，建议走致远的管理脚本或 deployer-tools，不要裸 kill）。
建议的下一步（按需执行）

\`\`\`bash
ls /data/Seeyon/Comi/elasticsearch/ # 找 start.sh/stop.sh
ls /data/Seeyon/Comi/elasticsearch/bin/ 2>/dev/null
\`\`\`

先确认这次是不是你/某个部署脚本触发的：查一下 13:10 前后有没有 cron 或启动动作在拉起 ES。若是脚本在重复拉起，要修脚本的幂等判断。
若确实要重启 ES（例如内存参数 2g 想调），先找到它的启停入口，例如：
停旧再启，不要同时起两个。重启属服务变更，如需我协助先确认入口，我可以继续查，但不会直接替你 kill/重启。
需要我帮你找出这套 ES 的官方启停脚本，确认它是怎么被拉起来的吗？`

describe('parseMarkdown code fences', () => {
  it('renders the typical 建议的下一步 bash block and keeps following prose as html', () => {
    const blocks = parseMarkdown(USER_SAMPLE)
    const code = blocks.filter((b) => b.type === 'code')
    const html = blocks.filter((b) => b.type === 'html')
    expect(code).toHaveLength(1)
    expect(code[0].language).toBe('bash')
    expect(code[0].content).toContain('ls /data/Seeyon/Comi/elasticsearch/')
    expect(code[0].content).toContain('# 找 start.sh/stop.sh')
    expect(html.some((b) => b.content.includes('<h3>') && b.content.includes('建议的下一步'))).toBe(
      true,
    )
    expect(html.some((b) => b.content.includes('官方启停脚本'))).toBe(true)
    expect(html.some((b) => b.content.includes('要不要处理'))).toBe(true)
    expect(html.some((b) => b.content.includes('node.max_local_storage_nodes=1'))).toBe(true)
    expect(html.some((b) => b.content.includes('<em>'))).toBe(false)
    expect(html.some((b) => b.content.includes('<h1>'))).toBe(false)
    expect(code[0].content).not.toContain('先确认这次是不是')
    const captionIdx = blocks.findIndex(
      (b) => b.type === 'html' && b.content.includes('建议的下一步'),
    )
    const codeIdx = blocks.findIndex((b) => b.type === 'code')
    expect(captionIdx).toBeGreaterThanOrEqual(0)
    expect(codeIdx).toBe(captionIdx + 1)
  })

  it('accepts an info string with a space (``` bash)', () => {
    const blocks = parseMarkdown('``` bash\nls /tmp\n```\nafter')
    expect(blocks[0]).toMatchObject({ type: 'code', language: 'bash', content: 'ls /tmp' })
    expect(blocks.some((b) => b.type === 'html' && b.content.includes('after'))).toBe(true)
  })

  it('does not treat ```bash inside a markdown fence as the closer', () => {
    const src = '```markdown\n建议的下一步\n\n```bash\nls /tmp\n```\n\n后面的说明\n```'
    const blocks = parseMarkdown(src)
    const code = blocks.filter((b) => b.type === 'code')
    expect(code.some((b) => b.language === 'bash' && b.content.includes('ls /tmp'))).toBe(true)
    expect(blocks.some((b) => b.type === 'html' && b.content.includes('后面的说明'))).toBe(true)
  })

  it('allows up to 3 spaces before a fence', () => {
    const blocks = parseMarkdown('   ```sh\necho hi\n   ```')
    expect(blocks[0]).toMatchObject({ type: 'code', language: 'sh', content: 'echo hi' })
  })

  it('does not swallow a fullwidth closing paren into an autolink', () => {
    const note = '（提示：如果只是例行巡检，这个占用率完全健康）'
    expect(parseMarkdown(note)[0].content).toContain(note)

    const withUrl = parseMarkdown(`${note.slice(0, -1)} https://example.com/a）`)
    expect(withUrl[0].content).toContain('>https://example.com/a</a>）')
    expect(withUrl[0].content).toContain('（提示：如果只是例行巡检，这个占用率完全健康')
    expect(withUrl[0].content).not.toContain('%EF%BC%89')

    const glued = parseMarkdown('见 https://example.com/x（提示：健康）')
    expect(glued[0].content).toContain('>https://example.com/x</a>（提示：健康）')
    expect(glued[0].content).not.toContain('%EF%BC%88')
  })

  it('does not italicize identifiers that contain underscores', () => {
    const blocks = parseMarkdown(
      '第二个实例抢不到锁（ES 默认 node.max_local_storage_nodes=1）后自行退出了。',
    )
    expect(blocks[0].content).not.toContain('<em>')
    expect(blocks[0].content).toContain('node.max_local_storage_nodes=1')
  })

  it('does not turn a bash # comment into a heading when fences are nested', () => {
    const src = [
      '```markdown',
      '建议的下一步（按需执行）',
      '',
      '```bash',
      'ls /data/es/ # 找 start.sh',
      '```',
      '',
      '先确认入口。',
      '```',
    ].join('\n')
    const blocks = parseMarkdown(src)
    expect(blocks.some((b) => b.type === 'html' && b.content.includes('<h1>'))).toBe(false)
    expect(blocks.some((b) => b.type === 'code' && b.content.includes('# 找 start.sh'))).toBe(true)
    expect(blocks.some((b) => b.type === 'html' && b.content.includes('先确认入口'))).toBe(true)
  })
})
