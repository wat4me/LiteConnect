import { expect, it } from 'vitest'
import { validateAiQuestions, validateAiUserAnswer, AI_QUESTION_TOOL } from './aiQuestions'
import { sshToolsForChat } from './aiSidebarPrompt'
import { workspaceToolsForChat } from './aiWorkspacePrompt'
import { sshMcpToolsAsOpenAiFunctions } from './mcp/tools'
import { formatToolRunDisplay, serializeToolRunForHistory } from './aiToolRunDisplay'

const questions = [{ id: 'scope', question: '处理哪些服务？', options: [{ label: 'Web', description: '检查网站服务' }, { label: '数据库' }] }]
it('offers a chat-only application tool without SSH routing or permission declarations', () => {
  for (const catalog of [sshToolsForChat(), workspaceToolsForChat()]) {
    const tool = catalog.find(item => item.function.name === AI_QUESTION_TOOL)!
    expect(tool.function.parameters.required).toEqual(['questions'])
    expect(tool.function.parameters.properties).not.toHaveProperty('connectionId')
    expect(tool.function.parameters.properties).not.toHaveProperty('risk')
  }
  expect(sshMcpToolsAsOpenAiFunctions().some(tool => tool.function.name === AI_QUESTION_TOOL)).toBe(false)
})
it('validates single/multiple choices and free text without choosing on behalf of the user', () => {
  const parsed = validateAiQuestions({ questions })
  const answer = { cancelled: false, answers: [{ id: 'scope', selected: ['Web'], text: '只检查生产环境' }] }
  expect(validateAiUserAnswer(answer, parsed)).toEqual(answer)
  expect(validateAiUserAnswer({ cancelled: true }, parsed)).toEqual({ cancelled: true, answers: [] })
  expect(validateAiUserAnswer({ cancelled: false, answers: [{ id: 'scope', selected: [], text: '自定义答案' }] }, parsed).answers[0].text).toBe('自定义答案')
  expect(() => validateAiUserAnswer({ cancelled: false, answers: [{ id: 'scope', selected: ['Web', '数据库'], text: '' }] }, parsed)).toThrow()
  expect(validateAiUserAnswer({ cancelled: false, answers: [{ id: 'scope', selected: ['Web', '数据库'], text: '' }] }, [{ ...parsed[0], multiple: true }]).answers[0].selected).toHaveLength(2)
})
it('rejects invalid, duplicated and oversized questions and forged answers', () => {
  for (const raw of [{ questions: [] }, { questions: Array(4).fill(questions[0]) }, { questions: [questions[0], questions[0]] }, { questions: [{ ...questions[0], id: '__proto__' }] }, { questions: [{ ...questions[0], question: 'x'.repeat(1001) }] }, { questions: [{ ...questions[0], options: [{ label: 'same' }, { label: 'same' }] }] }]) expect(() => validateAiQuestions(raw)).toThrow()
  for (const answer of [{ cancelled: false, answers: [] }, { cancelled: false, answers: [{ id: 'scope', selected: [], text: '' }] }, { cancelled: false, answers: [{ id: 'scope', selected: ['不存在'], text: '' }] }, { cancelled: false, answers: [{ id: 'other', selected: [], text: 'answer' }] }]) expect(() => validateAiUserAnswer(answer, questions)).toThrow()
})
it('keeps structured answers in history and displays readable question/answer text', () => {
  const args = JSON.stringify({ questions })
  const content = JSON.stringify({ cancelled: false, answers: [{ id: 'scope', selected: ['Web'], text: '生产环境' }] })
  expect(serializeToolRunForHistory({ name: AI_QUESTION_TOOL, args, content, isError: false })).toEqual({ args, content })
  const view = formatToolRunDisplay({ name: AI_QUESTION_TOOL, args, content })
  expect(view.hint).toContain('处理哪些服务')
  expect(view.body).toContain('Web\n生产环境')
})
