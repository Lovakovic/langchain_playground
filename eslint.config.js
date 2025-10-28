// @ts-check

import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import typescript from '@typescript-eslint/eslint-plugin';
import prettier from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: './tsconfig.json',
      },
      globals: {
        node: true,
        jest: true,
        console: 'readonly',
        process: 'readonly',
        module: 'readonly',
        require: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        Buffer: 'readonly',
        global: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        NodeJS: 'readonly',
        fetch: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': typescript,
      prettier,
    },
    rules: {
      // ====== HIGH VALUE - PREVENT REAL BUGS ======
      // TypeScript Type Safety (Critical)
      '@typescript-eslint/no-explicit-any': 'error', // Enforce strict no-any rule
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        {
          checksVoidReturn: {
            attributes: false,
          },
        },
      ],
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        {
          assertionStyle: 'as',
          objectLiteralTypeAssertions: 'never',
        },
      ],

      // Good Practices (Important)
      '@typescript-eslint/explicit-function-return-type': [
        'warn',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
          allowDirectConstAssertionInArrowFunctions: true,
        },
      ],
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/prefer-optional-chain': 'warn',
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        {
          prefer: 'type-imports',
          fixStyle: 'separate-type-imports',
        },
      ],
      '@typescript-eslint/no-import-type-side-effects': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],

      // ====== MEDIUM VALUE - GOOD PRACTICES ======
      // Async/Promise Rules
      '@typescript-eslint/require-await': 'warn',
      '@typescript-eslint/return-await': ['warn', 'in-try-catch'],

      // General JavaScript Rules
      'prefer-const': 'error',
      'no-var': 'error',
      curly: ['error', 'all'],
      eqeqeq: ['error', 'always', { null: 'ignore' }], // Allow == null for null/undefined check
      'no-eval': 'error',
      'object-shorthand': ['warn', 'always'],
      'prefer-arrow-callback': 'warn',
      'prefer-template': 'warn',
      'no-console': 'off', // Examples use console.log freely

      // ====== RELAXED/REMOVED - TOO STRICT ======
      // Disabled overly strict rules
      '@typescript-eslint/strict-boolean-expressions': 'off', // Too verbose
      '@typescript-eslint/no-unnecessary-condition': 'off', // Too aggressive
      '@typescript-eslint/no-unsafe-assignment': 'off', // Too strict for external APIs
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/explicit-module-boundary-types': 'off', // Redundant with return types
      '@typescript-eslint/prefer-readonly': 'off', // Nice but not critical
      '@typescript-eslint/member-ordering': 'off', // Too pedantic
      '@typescript-eslint/no-shadow': 'warn', // Warn is enough
      '@typescript-eslint/promise-function-async': 'off', // Not always necessary
      '@typescript-eslint/only-throw-error': 'warn',
      '@typescript-eslint/interface-name-prefix': 'off',

      '@typescript-eslint/no-deprecated': 'error',

      // Naming Conventions (Simplified)
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'typeLike',
          format: ['PascalCase'],
        },
        {
          selector: 'enumMember',
          format: ['UPPER_CASE', 'PascalCase'],
        },
      ],

      // Complexity Rules (More Reasonable)
      complexity: ['warn', 15], // Increased from 10
      'max-depth': ['warn', 4], // Increased from 3
      'max-lines-per-function': [
        'warn',
        {
          max: 100, // Increased from 50
          skipBlankLines: true,
          skipComments: true,
        },
      ],
      'max-params': ['warn', { max: 5 }], // Increased from 4
      'max-lines': [
        'warn',
        {
          max: 600, // Increased from 300
          skipBlankLines: true,
          skipComments: true,
        },
      ],

      // Disabled annoying rules
      'no-magic-numbers': 'off', // Too many false positives
      'sort-imports': 'off', // Let prettier/import plugin handle this
      'prefer-destructuring': [
        'warn',
        {
          array: true, // Enforce array destructuring
          object: false, // Don't enforce object destructuring for flexibility
        },
        {
          enforceForRenamedProperties: false,
        },
      ],
      'no-param-reassign': [
        'warn',
        {
          props: false, // Allow property modification
        },
      ],
      'no-nested-ternary': 'off', // Sometimes useful
      'no-else-return': 'off', // Sometimes else is clearer
      'consistent-return': 'off', // TypeScript handles this
      'no-unused-expressions': 'off', // Can conflict with optional chaining
      'max-nested-callbacks': ['warn', 5], // Increased from 3
      'max-statements-per-line': 'off',
      'require-atomic-updates': 'off', // Too many false positives
      'prefer-promise-reject-errors': 'warn',
      'no-unneeded-ternary': 'warn',
      radix: 'warn',
      'no-return-await': 'off',

      // TypeScript handles these
      '@typescript-eslint/no-inferrable-types': 'off',
      '@typescript-eslint/no-unnecessary-type-arguments': 'off',
      '@typescript-eslint/no-unnecessary-qualifier': 'off',
      '@typescript-eslint/prefer-reduce-type-parameter': 'off',
      '@typescript-eslint/prefer-return-this-type': 'off',
      '@typescript-eslint/prefer-string-starts-ends-with': 'off',
      '@typescript-eslint/prefer-includes': 'off',
      '@typescript-eslint/no-implied-eval': 'warn',
      '@typescript-eslint/unified-signatures': 'off',
      '@typescript-eslint/array-type': 'off',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'warn',
      '@typescript-eslint/no-unnecessary-boolean-literal-compare': 'off',
      '@typescript-eslint/no-confusing-void-expression': 'off',

      // Prettier Integration
      'prettier/prettier': ['error', {}, { usePrettierrc: true }],
    },
  },
  {
    ignores: [
      '.eslintrc.js',
      'dist/**',
      'node_modules/**',
      '**/vite.config.*.timestamp*',
      '**/vitest.config.*.timestamp*',
    ],
  },
];
