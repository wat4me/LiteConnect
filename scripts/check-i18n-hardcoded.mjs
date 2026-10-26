import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parse } from '@vue/compiler-sfc'

const HAN = /\p{Script=Han}/u
const SKIP_DIRS = new Set(['i18n', '__tests__', '__fixtures__', 'fixtures'])
const MATCHING_DATA = new Map([
  ['src/composables/sftp/useSftpNavigation.ts', new Set(['权限', '拒绝', '不存在', '会话', '未初始化'])],
  ['electron/ipc/settings/x11.ts', new Set(['取消', '已取消'])],
])

function isSearchAlias(file, node) {
  if (file !== 'src/composables/settings/settingsSearchCatalog.ts') return false
  let parent = node.parent
  while (parent && !ts.isSourceFile(parent)) {
    if (ts.isPropertyAssignment(parent) && parent.name.getText() === 'keywords') return true
    parent = parent.parent
  }
  return false
}

/** Comments, regexes and translated catalogs are not application text. */
export function scanHardcodedChinese(file, source) {
  const found = []
  const add = (line, text, kind) => found.push({ file, line, text: text.trim().slice(0, 180), kind })
  const scanScript = (text, lineOffset = 0) => {
    const ast = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    const visit = node => {
      const literal = ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)
        || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)
      if (literal && HAN.test(node.text) && !MATCHING_DATA.get(file)?.has(node.text) && !isSearchAlias(file, node)) {
        add(ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1 + lineOffset, node.text, 'string')
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  if (!file.endsWith('.vue')) {
    scanScript(source)
    return found
  }
  const { descriptor, errors } = parse(source, { filename: file })
  if (errors.length) throw new Error(`Cannot audit ${file}: ${errors[0]}`)
  for (const block of [descriptor.script, descriptor.scriptSetup]) {
    if (block) scanScript(block.content, source.slice(0, block.loc.start.offset).split('\n').length - 1)
  }
  const template = descriptor.template
  if (template?.ast) {
    const offset = source.slice(0, template.loc.start.offset).split('\n').length - 1
    const visit = node => {
      if (node.type === 2 && HAN.test(node.content)) add(node.loc.start.line + offset, node.content, 'template text')
      if (node.type === 6 && node.value && HAN.test(node.value.content)) add(node.loc.start.line + offset, node.value.content, 'template attribute')
      if (node.type === 5) scanScript(`(${node.content.content})`, node.loc.start.line + offset - 1)
      if (node.type === 7 && node.exp) scanScript(`(${node.exp.content})`, node.loc.start.line + offset - 1)
      for (const prop of node.props || []) visit(prop)
      for (const child of node.children || []) visit(child)
    }
    visit(template.ast)
  }
  return found
}

function selfTest() {
  const script = scanHardcodedChinese('example.ts', '// 中文注释\nconst matcher = /取消/; const label = `新提示 ${count}`')
  const vue = scanHardcodedChinese('Example.vue', '<template><button title="未翻译">中文 {{ ok ? "硬编码" : t("common.ok") }}</button></template>')
  const aliases = scanHardcodedChinese('src/composables/settings/settingsSearchCatalog.ts', 'const items = [{ keywords: ["中文"] }]; const label = "漏译"')
  if (script.length !== 1 || vue.length !== 3 || aliases.length !== 1) throw new Error('Hardcoded text detector self-test failed')
}

export function reportHardcodedChinese(roots = ['src', 'electron', 'shared']) {
  selfTest()
  const results = []
  const walk = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name)
      if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(file); continue }
      if (!/\.(ts|vue)$/.test(file) || /\.(test|spec|d)\.ts$/.test(file)) continue
      results.push(...scanHardcodedChinese(file.replaceAll('\\', '/'), fs.readFileSync(file, 'utf8')))
    }
  }
  for (const root of roots) walk(root)
  console.log('\n######## hardcoded application Chinese ########')
  console.log(`Unlisted strings: ${results.length}`)
  console.log('Exclusions: catalogs, comments, regexes, search aliases and explicit OS/server error matching data')
  for (const result of results) console.log(`${result.file}:${result.line} [${result.kind}] ${JSON.stringify(result.text)}`)
  return results.length
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (reportHardcodedChinese()) process.exitCode = 1
}
