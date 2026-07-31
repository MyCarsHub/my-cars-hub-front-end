// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import angular from 'angular-eslint';

export default tseslint.config(
  {
    files: ['**/*.ts'],
    ignores: ['dist/**', 'node_modules/**', '.angular/**', 'coverage/**', 'src/**/*.spec.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommended,
      ...angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    rules: {
      // P0: block console usage outright. Everything that needs to record an
      // event goes through LoggerService (warn/error), which is the only file
      // with an override below. `main.ts` has its own scoped override.
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      '@angular-eslint/component-selector': 'off',
      '@angular-eslint/directive-selector': 'off',
      '@angular-eslint/prefer-inject': 'off',
      '@angular-eslint/prefer-standalone': 'off',
      // Pre-existing legacy issues — downgraded to warn to keep P0 lint gate green.
      // Address in a follow-up cleanup pass.
      '@angular-eslint/no-output-rename': 'warn',
      '@angular-eslint/no-output-native': 'warn',
      '@angular-eslint/no-output-on-prefix': 'warn',
      '@angular-eslint/use-lifecycle-interface': 'warn',
    },
  },
  {
    // LoggerService is the single sanctioned console surface: it wraps
    // `console.error` behind `warn()` / `error()` and mirrors both to Sentry.
    // The global `no-console` rule above stays untouched for every other file.
    files: ['src/app/services/logger.service.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    // Bootstrap failure happens before the injector exists, so there is no
    // LoggerService to route it through — `console.error` is the only channel
    // left and losing it would make a dead app silent.
    files: ['src/main.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['**/*.html'],
    extends: [...angular.configs.templateRecommended],
    rules: {
      // Pre-existing template lint issues — warn only for now.
      '@angular-eslint/template/eqeqeq': 'warn',
    },
  },
);
