import { defineConfig } from 'vitest/config';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.js'],
    include: ['tests/**/*.test.js'],
    globals: true,
  },
  resolve: {
    alias: {
      // js/mzta-prompts.js imports from "../../options/mzta-options-default.js"
      // which resolves outside the repo root in Node.js. This alias fixes it.
      '../../options/mzta-options-default.js': path.resolve(__dirname, 'options/mzta-options-default.js'),
    }
  }
});
