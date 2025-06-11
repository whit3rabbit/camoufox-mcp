// @ts-check
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  eslint.configs.recommended,
  tseslint.configs.recommended,
  // Optionally, restrict to TypeScript files only
  {
    files: ['**/*.ts'],
    rules: {
      // Add or override rules as needed
    },
  }
);