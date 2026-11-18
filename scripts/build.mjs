import { build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('out', { recursive: true, force: true });
mkdirSync('out/renderer', { recursive: true });

const common = { bundle: true, logLevel: 'warning', sourcemap: false, legalComments: 'none' };

// Main and preload run in Node inside Electron.
await build({
  ...common,
  entryPoints: { 'main/index': 'src/main/index.ts', 'preload/index': 'src/preload/index.ts' },
  outdir: 'out',
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
});

// The two windows and the speech worker run in Chromium.
await build({
  ...common,
  entryPoints: {
    dashboard: 'src/renderer/dashboard/main.tsx',
    copilot: 'src/renderer/copilot/main.tsx',
    'asr.worker': 'src/renderer/audio/asr.worker.ts',
  },
  outdir: 'out/renderer',
  platform: 'browser',
  format: 'esm',
  target: 'chrome130',
  jsx: 'automatic',
  minify: true,
  loader: { '.woff': 'file', '.woff2': 'file' },
  assetNames: 'fonts/[name]-[hash]',
  define: { 'process.env.NODE_ENV': '"production"' },
});

for (const file of ['dashboard.html', 'copilot.html', 'audio/capture.worklet.js']) {
  cpSync(`src/renderer/${file}`, `out/renderer/${file.split('/').pop()}`);
}
// The speech engine's WebAssembly files ship with the app (no CDN at run time).
for (const file of ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']) {
  cpSync(`node_modules/@huggingface/transformers/dist/${file}`, `out/renderer/${file}`);
}
