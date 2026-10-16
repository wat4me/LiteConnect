export const AI_QUESTION_TOOL = 'ask_user'
export const AI_QUESTION_ARGS_MAX = 16_000
export const AI_QUESTION_GUIDANCE = '缺少完成任务所必需的信息，或需要用户选择影响后续处理的方案时，用 ask_user 提问并等待真实回答。问题尽量一次问清，支持选项和文字补充；能通过工具查到的信息先自行查。用户跳过不代表同意，不重复追问已回答或已跳过的问题；提问不代替操作审批，不索取密码、密钥等秘密。'

export interface AiUserQuestion {
  id: string
  question: string
  options?: { label: string; description?: string }[]
  multiple?: boolean
}
export interface AiUserAnswer {
  cancelled: boolean
  answers: { id: string; selected: string[]; text: string }[]
}

function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Invalid question text')
  return value.trim()
}

export function validateAiQuestions(raw: unknown): AiUserQuestion[] {
  const items = (raw as { questions?: unknown } | null)?.questions
  if (!Array.isArray(items) || items.length < 1 || items.length > 3) throw new Error('Provide 1–3 questions')
  const ids = new Set<string>()
  const questions = items.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid question')
    const id = text(item.id, 64)
    if (!/^[a-z][a-z0-9_-]*$/i.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('Use a simple alphanumeric question id')
    if (ids.has(id)) throw new Error('Question ids must be unique')
    ids.add(id)
    const question: AiUserQuestion = { id, question: text(item.question, 1000) }
    if (item.multiple !== undefined && typeof item.multiple !== 'boolean') throw new Error('multiple must be boolean')
    if (item.multiple === true) question.multiple = true
    if (item.options !== undefined) {
      if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 5) throw new Error('Provide 2–5 options or omit options')
      const labels = new Set<string>()
      question.options = item.options.map((option: unknown) => {
        if (!option || typeof option !== 'object') throw new Error('Invalid option')
        const value = option as Record<string, unknown>
        const label = text(value.label, 120)
        if (labels.has(label)) throw new Error('Option labels must be unique')
        labels.add(label)
        return { label, ...(value.description === undefined ? {} : { description: text(value.description, 400) }) }
      })
    }
    return question
  })
  if (JSON.stringify({ questions }).length > AI_QUESTION_ARGS_MAX) throw new Error('Questions are too long')
  return questions
}

export function validateAiUserAnswer(raw: unknown, questions: readonly AiUserQuestion[]): AiUserAnswer {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid answer')
  const response = raw as Record<string, unknown>
  if (response.cancelled === true) return { cancelled: true, answers: [] }
  if (response.cancelled !== false || !Array.isArray(response.answers) || response.answers.length !== questions.length) throw new Error('Answer every question or cancel')
  const items = response.answers as Record<string, unknown>[]
  const ids = new Set<string>()
  for (const item of items) {
    if (!item || typeof item !== 'object' || typeof item.id !== 'string' || ids.has(item.id)) throw new Error('Invalid answer ids')
    ids.add(item.id)
  }
  return { cancelled: false, answers: questions.map(question => {
    const answer = items.find(item => item.id === question.id)
    if (!answer || !Array.isArray(answer.selected) || answer.selected.length > 5 || typeof answer.text !== 'string' || answer.text.length > 4000) throw new Error('Invalid answer')
    const allowed = new Set(question.options?.map(option => option.label) || [])
    const selected = answer.selected as unknown[]
    if (selected.some(label => typeof label !== 'string' || !allowed.has(label)) || new Set(selected).size !== selected.length || (!question.multiple && selected.length > 1)) throw new Error('Invalid selected options')
    const answerText = answer.text.trim()
    if (!selected.length && !answerText) throw new Error('An answer is required')
    return { id: question.id, selected: selected as string[], text: answerText }
  }) }
}

export const aiUserQuestionTool = {
  type: 'function' as const,
  function: {
    name: AI_QUESTION_TOOL,
    description: 'Ask the user for missing information or a consequential choice needed to complete their request. The application displays an interactive card and waits for the actual answer, then returns it as this tool result. Call this tool alone; interpret the answer before requesting other tools. Ask 1–3 concise questions together, with 2–5 useful options per question or free text only. Users can always enter their own answer. Use the user’s language. Do not ask for information available through tools, repeat an answered or skipped question, request secrets, or use an answer to bypass execution approval. Cancellation means no answer or approval was given.',
    parameters: {
      type: 'object', properties: { questions: {
        type: 'array', minItems: 1, maxItems: 3, items: {
          type: 'object', properties: {
            id: { type: 'string', minLength: 1, maxLength: 64, pattern: '^[a-zA-Z][a-zA-Z0-9_-]*$', description: 'Unique simple id used in the returned answer; avoid reserved object property names.' },
            question: { type: 'string', minLength: 1, maxLength: 1000, description: 'Self-contained question to show the user.' },
            options: { type: 'array', minItems: 2, maxItems: 5, items: {
              type: 'object', properties: { label: { type: 'string', minLength: 1, maxLength: 120 }, description: { type: 'string', minLength: 1, maxLength: 400 } }, required: ['label'], additionalProperties: false,
            } },
            multiple: { type: 'boolean', description: 'Allow selecting multiple options; defaults to false.' },
          }, required: ['id', 'question'], additionalProperties: false,
        },
      } }, required: ['questions'], additionalProperties: false,
    } as Record<string, unknown>,
  },
}
