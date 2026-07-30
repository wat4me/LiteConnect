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
