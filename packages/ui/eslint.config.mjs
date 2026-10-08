import base from '../../eslint.config.mjs';

export default [
  ...base,
  {
    files: ['scripts/brand.mjs', 'scripts/tokens.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly' } },
  },
  {
    // Service worker template: __PRECACHE__ is filled in by brand.mjs.
    files: ['scripts/sw.template.js'],
    languageOptions: {
      globals: {
        self: 'readonly',
        caches: 'readonly',
        fetch: 'readonly',
        URL: 'readonly',
        __PRECACHE__: 'readonly',
      },
    },
  },
];
