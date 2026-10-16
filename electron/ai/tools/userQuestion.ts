import { validateAiQuestions, AI_QUESTION_TOOL } from '../../../shared/aiQuestions'
import type { AiFunctionToolCall } from '../../../shared/types/ai'
import type { AiToolExecutionContext } from './toolExecution'
import { waitForUserAnswer } from './streamControl'

export async function executeUserQuestion(call: AiFunctionToolCall, opts: AiToolExecutionContext) {
  const result = (content: string, isError = false) => {
    const run = { id: call.id, name: AI_QUESTION_TOOL, args: call.function.arguments, content, isError, status: 'done' as const, risk: 'read' as const }
    opts.send({ type: 'tool', value: { ...run, phase: 'done' } })
    return { run, message: { role: 'tool' as const, toolCallId: call.id, content } }
  }
  if (opts.allowQuestions === false || opts.foregroundOnly) return result('QUESTION_UNAVAILABLE: Interactive questions are unavailable in this unattended run. Report missing information without waiting for a user.', true)
  let questions
  try { questions = validateAiQuestions(JSON.parse(call.function.arguments)) } catch (error) {
    return result(`INVALID_QUESTIONS: ${error instanceof Error ? error.message : String(error)}`, true)
  }
  call = { ...call, function: { ...call.function, arguments: JSON.stringify({ questions }) } }
  // Register before publishing so an immediate answer cannot race the waiter.
  const answer = waitForUserAnswer(opts.requestId, call.id, questions, opts.signal)
  opts.send({ type: 'tool', value: { id: call.id, name: AI_QUESTION_TOOL, args: call.function.arguments, risk: 'read', phase: 'question' } })
  await opts.checkpoint?.()
  const response = await answer
  if (!response || opts.signal.aborted) return undefined
  return result(JSON.stringify(response))
}
