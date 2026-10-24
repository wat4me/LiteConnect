import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ESLint } from 'eslint'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const eslint = new ESLint({ cwd: root })
let checked = 0

async function check(filePath, code, expectedRule) {
  const [result] = await eslint.lintText(code, { filePath: resolve(root, filePath) })
  assert.equal(result.fatalErrorCount, 0, `${filePath}: probe must parse`)
  assert.deepEqual(result.messages.map(message => message.ruleId), expectedRule ? [expectedRule] : [],
    `${filePath}: ${code}\n${JSON.stringify(result.messages)}`)
  checked++
}

const pureRule = 'architecture/pure-platform-imports'
for (const file of ['shared/transferCancellation.ts', 'src/domain/terminal/types.ts']) {
  for (const module of ['fs', 'fs/promises', 'node:fs', 'node:fs/promises', 'node:test', 'electron', 'electron/main', 'vue', 'vue/dist/vue.esm-bundler.js', '@vue/reactivity', 'vue-i18n']) {
    await check(file, `import * as dependency from '${module}'`, pureRule)
  }
  for (const code of [
    "export { readFile } from 'node:fs/promises'",
    "export * from 'vue'",
    "const dependency = import('node:fs')",
    'const dependency = import(`vue`)',
    "const dependency = require('fs')",
    'const dependency = require(`electron`)',
    "import dependency = require('node:fs')",
    "import type { Ref } from 'vue'",
    "type Dependency = import('vue').Ref<string>",
  ]) await check(file, code, pureRule)
  await check(file, 'export const normalize = (value: string) => value.trim()')
}
await check('shared/aiContext.test.ts', "import { readFile } from 'node:fs/promises'")
await check('src/domain/database/dbFormat.test.ts', "import { ref } from 'vue'")
await check('electron/mcp/fileTransfers.ts', "import { mkdir } from 'node:fs/promises'")
await check('src/composables/ai/useAiChat.ts', "import { ref } from 'vue'")
await check('src/domain/ai/chat.ts', "import type { AiHistoryRecord } from '@shared/types/ai'")
await check('shared/aiContext.ts', "import { aiImageTokens } from './aiImages'")

const zoneRule = 'import/no-restricted-paths'
for (const file of [
  'electron/ai/settingsValidation.ts', 'electron/mcp/runtime.ts', 'electron/ssh/manager.ts',
  'electron/docker/service.ts', 'electron/db/manager.ts', 'electron/store/settingsStore.ts',
  'electron/ipc/registerAiHandlers.ts',
]) await check(file, "import { DeferredServices } from '../application/deferredServices'", zoneRule)
await check('electron/application/aiExecution.ts', "import { AiExecutionService } from '../ai/execution/executionService'")
await check('electron/ipc/registerAiHandlers.ts', "import type { AiExecutionService } from '../ai/execution/executionService'")
for (const file of ['electron/mcp/fileTransfers.ts', 'electron/mcp/fileTransfers.test.ts']) {
  await check(file, "import type { SSHManager } from '../ssh/manager'", zoneRule)
  await check(file, "import { TransferRunner } from '../ssh/transfer/transferRunner'", zoneRule)
  await check(file, "const manager = import('../ssh/manager')", zoneRule)
  await check(file, "const manager = require('../ssh/manager')", zoneRule)
}
await check('electron/mcp/tools/sftp.ts', "import type { SSHManager } from '../../ssh/manager'", zoneRule)
await check('electron/mcp/bind.ts', "import type { SSHManager } from '../ssh/manager'")
await check('electron/mcp/bind.test.ts', "import { SSHManager } from '../ssh/manager'")
await check('electron/mcp/ports.ts', "import type { SessionExecResult } from '../ssh/sessionExec'")
await check('electron/mcp/ports.ts', "import type { SessionSnapshot } from '../ssh/types'")
await check('electron/mcp/ports.ts', "import { type SessionSnapshot } from '../ssh/types'")
await check('electron/mcp/ports.ts', "export type { SessionSnapshot } from '../ssh/types'")
await check('electron/mcp/execJobs.ts', "import { executeSessionExec } from '../ssh/sessionExec'", '@typescript-eslint/no-restricted-imports')
await check('electron/mcp/execJobs.ts', "const execution = import('../ssh/sessionExec')", 'no-restricted-syntax')
await check('electron/mcp/execJobs.ts', "const execution = require('../ssh/sessionExec')", 'no-restricted-syntax')
await check('electron/mcp/execJobs.ts', "import execution = require('../ssh/sessionExec')", '@typescript-eslint/no-restricted-imports')
await check('electron/mcp/tools/search.ts', "import { shellQuote } from '../../ssh/shellQuote'")
await check('electron/mcp/fileTransfers.ts', "import { TransferCancelledError } from '../../shared/transferCancellation'")
await check('electron/mcp/fileTransfers.ts', "import type { McpFileTransferPort } from './ports'")
await check('src/composables/ai/useAiChat.ts', "import { useTransfers } from '../sftp/useTransfers'", zoneRule)
await check('electron/ai/tools/userQuestion.ts', "import type { AiToolExecutionContext } from './toolExecution'", zoneRule)
await check('electron/ai/tools/userQuestion.ts', "import type { AiToolExecutionContext } from './toolExecutionContext'")
await check('electron/ai/tools/toolExecutionContext.ts', "import { executeAiToolCall } from './toolExecution'", zoneRule)

console.log(`Architecture rule checks passed (${checked} allowed/forbidden import probes; no fixture files written).`)
