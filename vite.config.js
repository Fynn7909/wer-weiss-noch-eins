import { defineConfig } from 'vite';

// base './' damit es auch in einem Unterordner läuft (GitHub Pages).
export default defineConfig({
  base: './',
  test: { include: ['tests/**/*.test.js'] },
});
