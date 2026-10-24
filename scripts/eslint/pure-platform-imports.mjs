import { isBuiltin } from 'node:module'

// Apply only to production shared/domain code. Test harnesses may use Node APIs.
export default {
  meta: {
    type: 'problem',
    schema: [],
    messages: { platform: 'Pure shared/domain modules must not import {{name}} (Node, Electron or Vue). Inject capabilities or move orchestration to its owning layer.' },
  },
  create(context) {
    function check(source) {
      if (source?.type === 'TSLiteralType') source = source.literal
      const name = source?.value ?? (source?.type === 'TemplateLiteral' && source.expressions.length === 0
        ? source.quasis[0].value.cooked : undefined)
      if (typeof name !== 'string') return
      if (name.startsWith('node:') || isBuiltin(name) || /^(?:electron|vue|vue-i18n)(?:\/|$)|^@vue\//u.test(name)) {
        context.report({ node: source, messageId: 'platform', data: { name } })
      }
    }
    return {
      ImportDeclaration: node => check(node.source),
      ExportNamedDeclaration: node => check(node.source),
      ExportAllDeclaration: node => check(node.source),
      ImportExpression: node => check(node.source),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node.arguments[0])
      },
      TSExternalModuleReference: node => check(node.expression),
      TSImportType: node => check(node.argument ?? node.parameter),
    }
  },
}
