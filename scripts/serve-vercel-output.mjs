// Serves .vercel/output locally the way Vercel does (static files + the bundled API
// function), to test the exact production bundle before deploying.
//   npm run build:vercel && npm run serve:vercel-output
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve('.vercel/output');
const handler = (await import(pathToFileURL(path.join(root, 'functions/api.func/index.mjs')).href)).default;
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return handler(req, res);
  let file = path.join(root, 'static', path.normalize(url.pathname).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(path.join(root, 'static')) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'static/index.html');
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => console.log(`Vercel output served on http://localhost:${port}`));
