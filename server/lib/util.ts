import crypto from 'node:crypto';
import { z, type ZodTypeAny } from 'zod';

export const newId = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
export const today = () => new Date().toISOString().slice(0, 10);
export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = () => crypto.randomBytes(32).toString('base64url');

export class HttpError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export const notFound = (what = 'Resource') => new HttpError(404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission to perform this action.') => new HttpError(403, msg);
export const badRequest = (msg: string) => new HttpError(400, msg);

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const r = schema.safeParse(data);
  if (!r.success) {
    const issue = r.error.issues[0];
    const field = issue?.path.join('.');
    throw new HttpError(400, field ? `${field}: ${issue.message}` : (issue?.message ?? 'Invalid input'), r.error.flatten().fieldErrors);
  }
  return r.data;
}

// Reusable field schemas
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a date (YYYY-MM-DD)');
export const zDateTime = z.string().refine((s) => !Number.isNaN(Date.parse(s)), 'Expected a date/time');
export const zText = (max = 200) => z.string().trim().min(1, 'Required').max(max);
export const zOptText = (max = 5000) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));
export const zId = z.string().uuid('Invalid id');
export const zEmail = z.string().trim().toLowerCase().email('Enter a valid email address').max(254);
export const zPassword = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200)
  .refine((p) => /[A-Za-z]/.test(p) && /\d/.test(p), 'Use letters and at least one number');
export const zVisibility = z.enum(['internal', 'client']);
export const zBoolInt = z.union([z.boolean(), z.literal(0), z.literal(1)]).transform((v) => (v ? 1 : 0));

export const APP_URL =
  process.env.APP_URL ??
  (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : 'http://localhost:5173');
