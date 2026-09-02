/**
 * Architecture-first ESLint config.
 * Focus: dependency direction only (not style / empty catch / control regex).
 * See ARCHITECTURE.md.
 */
import js from '@eslint/js'
import globals from 'globals'
import pluginVue from 'eslint-plugin-vue'
import importPlugin from 'eslint-plugin-import'
import tseslint from 'typescript-eslint'
import vueParser from 'vue-eslint-parser'

function peerZone(targetDir, fromDir, message) {
  return {
    target: `./src/composables/${targetDir}/**/*`,
    from: `./src/composables/${fromDir}/**/*`,
    message,
  }
}

/** Peer features must not import each other's composables. Use domain ports / App composition. */
const rendererPeerFeatures = [
  'terminal',
  'sftp',
  'docker',
  'database',
  'ai',
  'snippets',
  'connections',
  'monitor',
]

const rendererPeerZones = []
for (const a of rendererPeerFeatures) {
  for (const b of rendererPeerFeatures) {
    if (a === b) continue
    rendererPeerZones.push(
      peerZone(a, b, `${a} composables must not import ${b} composables (use domain ports or App.vue wiring)`),
    )
  }
}

for (const peer of rendererPeerFeatures) {
  rendererPeerZones.push(
    peerZone('session', peer, 'session must not import feature composables (depend on domain ports)'),
  )
  rendererPeerZones.push(
    peerZone(
      'workspace',
      peer,
      'workspace composables must not import feature composables (App.vue / SshWorkspace compose them)',
    ),
  )
}

for (const peer of ['sftp', 'docker', 'terminal', 'ai', 'snippets', 'connections', 'monitor', 'session']) {
  rendererPeerZones.push(
    peerZone(
      'settings',
      peer,
      'settings may compose database defaults, but must not import other feature composables',
    ),
  )
}

const architectureZones = [
  {
    target: './src/utils/**/*',
    from: './src/composables/**/*',
    message: 'utils must not import composables (keep pure helpers below orchestration)',
  },
  {
    target: './src/utils/**/*',
    from: './src/components/**/*',
    message: 'utils must not import components',
  },
  {
    target: './src/utils/**/*',
    from: './src/views/**/*',
    message: 'utils must not import views',
  },
  {
    target: './src/domain/**/*',
    from: './src/composables/**/*',
    message: 'domain must not import composables',
  },
  {
    target: './src/domain/**/*',
    from: './src/components/**/*',
    message: 'domain must not import components',
  },
  {
    target: './src/domain/**/*',
    from: './src/views/**/*',
    message: 'domain must not import views',
  },
  {
    target: './shared/**/*',
    from: './src/**/*',
    message: 'shared must not import renderer (src) code',
  },
  {
    target: './shared/**/*',
    from: './electron/**/*',
    message: 'shared must not import electron main code',
  },
  {
    target: './electron/**/*',
    from: './src/**/*',
    message: 'electron main must not import renderer (src) modules',
  },
  {
    target: './src/**/*',
    from: './electron/**/*',
    message: 'renderer must not import electron main modules (use preload IPC)',
  },

  ...rendererPeerZones,

  {
    target: './electron/ssh/**/*',
    from: './electron/docker/**/*',
    message: 'ssh must not import docker (Docker consumes a host port, not the reverse)',
  },
  {
    target: './electron/ssh/**/*',
    from: './electron/db/**/*',
    message: 'ssh must not import db',
  },
  {
    target: './electron/ssh/**/*',
    from: './electron/mcp/**/*',
    message: 'ssh must not import mcp',
  },
  {
    target: './electron/ssh/**/*',
    from: './electron/ai/**/*',
    message: 'ssh must not import ai',
  },
  {
    target: './electron/db/**/*',
    from: './electron/docker/**/*',
    message: 'db must not import docker',
  },
  {
    target: './electron/db/**/*',
    from: './electron/mcp/**/*',
    message: 'db must not import mcp',
  },
  {
    target: './electron/db/**/*',
    from: './electron/ai/**/*',
    message: 'db must not import ai',
  },
  {
    target: './electron/db/**/*',
    from: './electron/ssh/**/*',
    except: ['**/electron/ssh/trust/**', '**/electron/ssh/auth*', '**/electron/ssh/loadSsh2*'],
    message: 'db tunnel may reuse ssh auth/trust/loadSsh2, not SSHManager sessions',
  },
  {
    target: './electron/docker/**/*',
    from: './electron/ssh/**/*',
    message: 'docker must use DockerSshBackend / DockerSessionHost, not import electron/ssh',
  },
  {
    target: './electron/docker/**/*',
    from: './electron/db/**/*',
    message: 'docker must not import db',
  },
  {
    target: './electron/docker/**/*',
    from: './electron/mcp/**/*',
    message: 'docker must not import mcp',
  },
  {
    target: './electron/docker/**/*',
    from: './electron/ai/**/*',
    message: 'docker must not import ai',
  },
  {
    target: './electron/mcp/**/*',
    from: './electron/docker/**/*',
    message: 'mcp must not import docker (interactive SSH sessions only)',
  },
  {
    target: './electron/mcp/**/*',
    from: './electron/db/**/*',
    message: 'mcp must not import db',
  },
  {
    target: './electron/mcp/**/*',
    from: './electron/ai/**/*',
    message: 'mcp must not import ai',
  },
  {
    target: './electron/ai/**/*',
    from: './electron/ssh/**/*',
    message: 'ai talks to SSH via MCP runtime, not electron/ssh directly',
  },
  {
    target: './electron/ai/**/*',
    from: './electron/docker/**/*',
    message: 'ai must not import docker',
  },
  {
    target: './electron/ai/**/*',
    from: './electron/db/**/*',
    message: 'ai must not import db',
  },
  {
    target: './electron/store/**/*',
    from: './electron/docker/**/*',
    message: 'store must not import docker',
  },
  {
    target: './electron/store/**/*',
    from: './electron/mcp/**/*',
    message: 'store must not import mcp',
  },
  {
    target: './electron/store/**/*',
    from: './electron/ai/**/*',
    message: 'store must not import ai',
  },
  {
    target: './electron/store/**/*',
    from: './electron/ssh/**/*',
    message: 'store must not import ssh',
  },
]

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'node_modules/**',
      'website/**',
      'scripts/**',
      '**/*.config.js',
      '**/*.config.mjs',
      '**/*.config.ts',
      '**/vite.config.ts',
      '**/vitest.config.ts',
      'eslint.config.mjs',
    ],
  },

  {
    files: ['src/**/*.{ts,vue}', 'electron/**/*.ts', 'shared/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
      parser: vueParser,
      parserOptions: {
        parser: tseslint.parser,
        ecmaVersion: 2022,
        sourceType: 'module',
        extraFileExtensions: ['.vue'],
      },
    },
    plugins: {
      import: importPlugin,
      vue: pluginVue,
      '@typescript-eslint': tseslint.plugin,
    },
    settings: {
      'import/resolver': {
        typescript: {
          alwaysTryTypes: true,
          project: ['./tsconfig.json'],
          noWarnOnMultipleProjects: true,
        },
        node: true,
      },
    },
    rules: {
      // Disable noisy baseline rules — this config is architecture-only
      ...Object.fromEntries(
        Object.keys(js.configs.recommended.rules || {}).map((k) => [k, 'off']),
      ),
      'no-unused-vars': 'off',
      'no-undef': 'off',
      'no-empty': 'off',
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      'no-useless-catch': 'off',
      'no-irregular-whitespace': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      'vue/multi-word-component-names': 'off',
      'vue/no-mutating-props': 'off',

      'import/no-restricted-paths': [
        'error',
        {
          zones: architectureZones,
        },
      ],
    },
  },

  {
    files: ['src/composables/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/*.vue', './**/*.vue', '../**/*.vue', '@/components/**', '@/views/**'],
              message: 'composables must not import Vue SFCs (use domain types / props instead)',
            },
          ],
        },
      ],
    },
  },
)
