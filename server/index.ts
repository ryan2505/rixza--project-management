// Long-running server (local development, `npm start`, any Node host).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { app, errorHandler, initialize } from './app.ts';

// Serve the built SPA when present.
const dist = path.resolve('dist');
if (fs.existsSync(path.join(dist, 'index.html'))) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use(errorHandler);

await initialize();
const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => console.log(`RIXZA API listening on http://localhost:${PORT}`));
