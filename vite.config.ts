import { defineConfig } from 'vite';

// GitHub Pages serves the site from /<repo-name>/; the dev server stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/realms-of-fortune/' : '/',
}));
