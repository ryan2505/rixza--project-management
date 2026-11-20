import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { UPLOAD_DIR } from '../db.ts';

/**
 * File storage.
 *  - SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set → private Supabase Storage bucket.
 *    Objects are never public; downloads always go through the authorised API.
 *  - otherwise → local disk under DATA_DIR/uploads.
 * Keys stored in the database are opaque: "sb:<object>" or "<local file name>".
 */

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = process.env.SUPABASE_BUCKET ?? 'project-files';
export const usesSupabase = !!(SUPABASE_URL && SERVICE_KEY);

let bucketP: Promise<any> | null = null;
function supabase() {
  bucketP ??= (async () => {
    const { createClient } = await import('@supabase/supabase-js');
    const client = createClient(SUPABASE_URL!, SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await client.storage.getBucket(BUCKET);
    if (!data) {
      const { error } = await client.storage.createBucket(BUCKET, { public: false });
      if (error && !/already exists/i.test(error.message)) throw error;
    }
    return client.storage.from(BUCKET);
  })().catch((e) => {
    bucketP = null;
    throw e;
  });
  return bucketP;
}

export async function saveObject(data: Buffer, mime: string): Promise<string> {
  const name = crypto.randomBytes(24).toString('hex');
  if (usesSupabase) {
    const bucket = await supabase();
    const objectPath = `${name.slice(0, 2)}/${name}`;
    const { error } = await bucket.upload(objectPath, data, { contentType: mime || 'application/octet-stream', upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
    return `sb:${objectPath}`;
  }
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(UPLOAD_DIR, name), data);
  return name;
}

export async function readObject(key: string): Promise<Buffer | null> {
  if (key.startsWith('sb:')) {
    const bucket = await supabase();
    const { data, error } = await bucket.download(key.slice(3));
    if (error || !data) return null;
    return Buffer.from(await data.arrayBuffer());
  }
  const p = path.join(UPLOAD_DIR, path.basename(key));
  return fs.existsSync(p) ? fs.promises.readFile(p) : null;
}

export async function clearLocalObjects() {
  if (!fs.existsSync(UPLOAD_DIR)) return;
  for (const f of fs.readdirSync(UPLOAD_DIR)) fs.unlinkSync(path.join(UPLOAD_DIR, f));
}

/** Serverless platforms cap request bodies (~4.5 MB on Vercel). */
export const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_MB ?? (process.env.VERCEL ? 4 : 50)) * 1024 * 1024;
