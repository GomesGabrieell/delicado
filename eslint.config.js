const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  { ignores: ['dist/**', 'supabase/functions/**'] },
  {
    files: ['src/**/*.tsx'],
    rules: {
      // Request effects set loading state before awaiting Supabase.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
]);
