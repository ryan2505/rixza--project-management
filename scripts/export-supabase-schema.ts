// Writes the schema as a Supabase migration (supabase/migrations/…_init.sql), so it can be
// applied with the Supabase CLI (`supabase db push`) or pasted into the SQL editor.
//   npm run db:export
import fs from 'node:fs';
import { SCHEMA } from '../server/schema.ts';

const file = 'supabase/migrations/20261120000000_rixza_init.sql';
fs.mkdirSync('supabase/migrations', { recursive: true });
fs.writeFileSync(
  file,
  `-- RIXZA Client Portal — initial schema (generated from server/schema.ts; do not edit by hand).
-- Row Level Security is enabled on every table WITHOUT policies: Supabase's public Data API
-- (anon / authenticated keys) cannot read or write anything. Only the application server,
-- connecting with DATABASE_URL as the table owner, accesses data and enforces permissions.
${SCHEMA.trim()}
`,
);
console.log(`✓ ${file}`);
