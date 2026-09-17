export default [
  {
    ignores: ['node_modules/**'],
  },
  {
    files: ['**/*.mjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
      },
    },
    rules: {
      'no-constant-binary-expression': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-useless-assignment': 'error',
      eqeqeq: ['error', 'always'],
      'prefer-const': 'error',
    },
  },
];
