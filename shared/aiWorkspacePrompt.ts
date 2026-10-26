import type { AiWorkspaceTarget } from './aiWorkspace'
import { sshToolsForChat, sshToolSystemAddendum } from './aiSidebarPrompt'
import { AI_QUESTION_TOOL } from './aiQuestions'
import { AI_LOAD_TOOLS, type AiToolGroup } from './aiToolCatalog'
import { sharedT, type SharedTranslate } from './i18n'

export function workspaceToolsForChat(groups: readonly AiToolGroup[] = []) {
  return sshToolsForChat(groups).map(tool => [AI_QUESTION_TOOL, AI_LOAD_TOOLS].includes(tool.function.name) ? tool : ({
    ...tool,
    function: {
      ...tool.function,
      description: `${tool.function.description.replace('current sidebar host', 'selected workspace server')} Specify connectionId from the conversation scope.`,
      parameters: {
        ...tool.function.parameters,
        properties: {
          ...(tool.function.parameters.properties as Record<string, unknown>),
          connectionId: { type: 'string', description: 'Saved connection id from the workspace scope; never a session id.' },
        },
        required: [...(tool.function.parameters.required as string[]), 'connectionId'],
      },
    },
  }))
}

export function workspaceToolSystemAddendum(targets: AiWorkspaceTarget[], translate: SharedTranslate = sharedT, allowQuestions = true) {
  // Reuse operating/risk guidance, replacing ONLY the single-host routing instructions.
  const guidance = sshToolSystemAddendum({ sessionId: '' }, translate, { workspace: true, allowQuestions })
  return [
    translate('sharedText.promptWorkspaceBound'),
    translate('sharedText.promptWorkspaceRouting'),
    translate('sharedText.promptWorkspaceCompare'),
    ...(targets.length > 1 ? [translate('sharedText.promptWorkspaceFormat')] : []),
    translate('sharedText.promptWorkspaceServers'),
    JSON.stringify(targets.map(({ connectionId, name, host, port, username, note, group }) => ({ connectionId, name, host, port, username, note, group }))),
    guidance,
  ].join('\n')
}
