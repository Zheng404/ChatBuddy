import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.ts'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname
      }
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      // Bug prevention: catch missing switch cases, invalid await, redundant return await
      '@typescript-eslint/switch-exhaustiveness-check': 'warn',
      '@typescript-eslint/await-thenable': 'warn',
      'no-return-await': 'warn',
      // Complexity guardrails: flag extreme hotspots (inherent complexity left as-is)
      'complexity': ['warn', 40],
      'max-depth': ['warn', 5]
    }
  },
  {
    files: ['src/test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    ignores: ['out/', 'node_modules/', '*.js', '*.cjs']
  }
);
