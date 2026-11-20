// Creates/updates the schema in the database pointed to by DATABASE_URL (e.g. Supabase),
// and the private storage bucket when SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are set.
//   npm run db:push            (reads .env)
import { ready, scalar } from '../server/db.ts';
import { saveObject, usesSupabase } from '../server/lib/storage.ts';

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set (see .env.example).');
  process.exit(1);
}
await ready();
const users = await scalar<number>('SELECT COUNT(*) FROM users');
console.log(`✓ Schema ready (${users} users in database).`);
if (usesSupabase) {
  await saveObject(Buffer.from('ok'), 'text/plain'); // creates the private bucket if needed
  console.log('✓ Supabase Storage bucket ready.');
}
process.exit(0);
