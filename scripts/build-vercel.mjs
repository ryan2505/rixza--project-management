// Produces a Vercel Build Output API v3 bundle in .vercel/output:
//   static/           ← the Vite SPA (dist/)
//   functions/api.func ← the whole Express API bundled into one Node.js function
//   config.json       ← /api/* → function, everything else → SPA
// Run via `npm run build:vercel` (Vercel calls it automatically, see vercel.json).
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve('.vercel/output');
fs.rmSync(out, { recursive: true, force: true });

// 1. Static assets
if (!fs.existsSync('dist/index.html')) throw new Error('dist/ missing — run `vite build` first.');
fs.cpSync('dist', path.join(out, 'static'), { recursive: true });

// 2. API function
const fn = path.join(out, 'functions/api.func');
await build({
  entryPoints: ['server/vercel.ts'],
  outfile: path.join(fn, 'index.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: false,
  minify: false,
  // pg-native is optional; PGlite is only used locally (loaded via a non-literal import).
  external: ['pg-native', '@electric-sql/pglite'],
  // CommonJS dependencies (express…) call require() for Node built-ins.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning',
});
fs.writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));
fs.writeFileSync(
  path.join(fn, '.vc-config.json'),
  JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', shouldAddHelpers: false, supportsResponseStreaming: true, maxDuration: 30 }, null, 2),
);

// 3. Routing
fs.writeFileSync(
  path.join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api(/.*)?$', dest: '/api' },
        { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
        { handle: 'filesystem' },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

const size = (fs.statSync(path.join(fn, 'index.mjs')).size / 1024).toFixed(0);
console.log(`✓ Vercel output ready in .vercel/output (API bundle ${size} KB)`);
