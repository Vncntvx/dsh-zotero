/** React hook contracts for production components and their browser fixtures. */
import babelParser from '@babel/eslint-parser'
import reactHooks from 'eslint-plugin-react-hooks'

export default [
  {
    files: ['src/client/**/*.{ts,tsx}', 'tests/client/**/*.{ts,tsx}'],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        requireConfigFile: false,
        babelOptions: {
          babelrc: false,
          configFile: false,
          parserOpts: { plugins: ['typescript'] },
        },
      },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    files: ['src/client/**/*.tsx', 'tests/client/**/*.tsx'],
    languageOptions: {
      parserOptions: { babelOptions: { parserOpts: { plugins: ['typescript', 'jsx'] } } },
    },
  },
]
