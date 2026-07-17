/**
 * Local ESLint rules that enforce project standards no published plugin covers.
 * Registered as the `local` plugin in eslint.config.js.
 */

const SECTION_ORDER = ['arrange', 'act', 'assert']

/** @type {import('eslint').Rule.RuleModule} */
const requireAaaComments = {
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'Unit tests must mark their sections with // Arrange, // Act, // Assert comments, in order (docs/dev/testing.md)',
    },
    messages: {
      missing: 'Unit test is missing the "// {{section}}" section comment.',
      outOfOrder: 'AAA section comments are out of order: "// {{section}}" appears too early.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode

    function testCalleeName(callee) {
      if (callee.type === 'Identifier') return callee.name
      if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier') {
        return callee.object.name
      }
      return null
    }

    return {
      CallExpression(node) {
        const name = testCalleeName(node.callee)
        if (name !== 'it' && name !== 'test') return
        const fn = node.arguments.find(
          (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
        )
        if (!fn || fn.body.type !== 'BlockStatement') return

        const [start, end] = fn.body.range
        const sections = sourceCode
          .getAllComments()
          .filter((c) => c.range[0] > start && c.range[1] < end)
          .map((c) => c.value.trim().toLowerCase().split(/[\s:]/)[0])
          .filter((first) => SECTION_ORDER.includes(first))

        let cursor = 0
        for (const section of SECTION_ORDER) {
          const at = sections.indexOf(section, cursor)
          if (at === -1) {
            const report = sections.includes(section) ? 'outOfOrder' : 'missing'
            context.report({
              node,
              messageId: report,
              data: { section: section[0].toUpperCase() + section.slice(1) },
            })
            return
          }
          cursor = at + 1
        }
      },
    }
  },
}

export default {
  meta: { name: 'eslint-plugin-local' },
  rules: {
    'require-aaa-comments': requireAaaComments,
  },
}
