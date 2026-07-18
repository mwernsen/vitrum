import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import svelte from 'eslint-plugin-svelte'
import globals from 'globals'
import ts from 'typescript-eslint'

export default ts.config(
  {
    ignores: [
      '**/dist/',
      '**/out/',
      '**/coverage/',
      '**/playwright-report/',
      '**/test-results/',
      // Transient agent git worktrees/scratch — not project source, and gitignored.
      '**/.claude/',
    ],
  },
  js.configs.recommended,
  ...ts.configs.recommended,
  ...svelte.configs.recommended,
  prettier,
  ...svelte.configs.prettier,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
  {
    files: ['**/*.svelte', '**/*.svelte.ts'],
    languageOptions: {
      parserOptions: {
        parser: ts.parser,
        extraFileExtensions: ['.svelte'],
      },
    },
  },
  // Package dependency direction (F-001 FR-2): core ← ui ← desktop, no back-edges.
  {
    files: ['packages/core/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@vitrum/ui', '@vitrum/desktop', 'svelte', 'svelte/*', 'electron'],
              message: 'packages/core is pure domain logic and must not depend on UI layers.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/ui/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@vitrum/desktop', 'electron'],
              message: 'packages/ui must stay browser-compatible; no Electron dependencies.',
            },
          ],
        },
      ],
    },
  },
)
