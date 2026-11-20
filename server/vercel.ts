// Vercel serverless entry: the Express app handles every /api/* request.
// Bundled by scripts/build-vercel.mjs into .vercel/output/functions/api.func/index.mjs.
import { app, errorHandler } from './app.ts';

app.use(errorHandler);

export default app;
