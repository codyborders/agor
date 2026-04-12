import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    index: 'src/index.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  splitting: false,
  shims: true,
  // Pi SDK is Node-only
  external: ['@mariozechner/pi-coding-agent'],
});
