import coreWebVitals from 'eslint-config-next/core-web-vitals';
import tseslint from 'typescript-eslint';

/** @type {import('eslint').Linter.Config[]} */
const config = [
  ...coreWebVitals,
  {
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: {
      // These patterns — syncing external SDK state into React state inside useEffect — are
      // intentional in this codebase (see AGENTS.md StrictMode Guard and Hook Ownership).
      // The rule fires on all synchronous setState calls in effect bodies, including the
      // initial-value and derived-state patterns that eslint-config-next 16 now flags as errors.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
];

export default config;
