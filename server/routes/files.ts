import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { all, get, insert, update, type Param } from '../db.ts';
import { requireAuth } from '../lib/auth.ts';
import { projectAccess, scopedRow, type Access } from '../lib/access.ts';
import { logActivity, notify, staffUserIds } from '../lib/notify.ts';
import { MAX_UPLOAD_BYTES, readObject, saveObject } from '../lib/storage.ts';
import { HttpError, badRequest, forbidden, newId, now, parse, zId, zVisibility } from '../lib/util.ts';
import { FILE_CATEGORIES, type FileItem } from '../../shared/domain.ts';

export const filesRouter = Router();
filesRouter.use(requireAuth);
const P = (v: unknown) => String(v);

// Files are buffered in memory and written to storage (Supabase Storage or disk) by storeFiles().
export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 10 } });

const latestOnly = `NOT EXISTS (SELECT 1 FROM files n WHERE n.supersedes_id = f.id AND n.deleted_at IS NULL)`;

export function listFiles(access: Access, where: string, ...params: Param[]): Promise<FileItem[]> {
  return all<FileItem>(
    `SELECT f.*, u.name AS uploader_name FROM files f LEFT JOIN users u ON u.id = f.uploaded_by
      WHERE f.project_id = ? AND f.deleted_at IS NULL AND ${where} ${access.caps.staff ? '' : "AND f.visibility = 'client'"}
      ORDER BY f.created_at DESC`,
    access.project.id,
    ...params,
  );
}

/** Stores uploaded files and records them as project files. Uploads happen before the
 *  DB transaction so storage latency never holds database locks. */
export async function storeFiles(
  access: Access,
  files: Express.Multer.File[],
  opts: { category: string; visibility: 'internal' | 'client'; task_id?: string | null; deliverable_version_id?: string | null; supersedes?: FileItem | null },
): Promise<FileItem[]> {
  const stored: FileItem[] = [];
  for (const f of files) {
    const mime = (f.mimetype || 'application/octet-stream').slice(0, 120);
    const key = await saveObject(f.buffer, mime);
    const id = newId();
    // multer decodes names as latin1; restore UTF-8 names.
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8').replace(/[\\/\0]/g, '_').slice(0, 255);
    await insert('files', {
      id, project_id: access.project.id, category: opts.category, name, mime, size: f.size, storage_key: key, uploaded_by: access.user.id,
      visibility: opts.visibility, task_id: opts.task_id ?? null, deliverable_version_id: opts.deliverable_version_id ?? null,
      version: opts.supersedes ? opts.supersedes.version + 1 : 1, supersedes_id: opts.supersedes?.id ?? null, created_at: now(),
    });
    stored.push((await get<FileItem>('SELECT * FROM files WHERE id = ?', id))!);
  }
  return stored;
}

filesRouter.get('/projects/:pid/files', async (req, res) => {
  const access = await projectAccess(req.user!, P(req.params.pid));
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const category = typeof req.query.category === 'string' ? req.query.category : '';
  let where = latestOnly;
  const params: Param[] = [];
  if (q) {
    where += ` AND f.name ILIKE ? ESCAPE '\\'`;
    params.push(`%${q.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
  }
  if (category) {
    where += ' AND f.category = ?';
    params.push(category);
  }
  res.json(await listFiles(access, where, ...params));
});

filesRouter.post('/projects/:pid/files', upload.array('files', 10), async (req, res) => {
  const uploaded = (req.files as Express.Multer.File[]) ?? [];
  const access = await projectAccess(req.user!, P(req.params.pid));
  if (!uploaded.length) throw badRequest('Choose at least one file to upload.');
  const body = parse(
    z.object({ category: z.enum(FILE_CATEGORIES).default('Other'), visibility: zVisibility.optional(), task_id: zId.optional(), supersedes_id: zId.optional() }),
    req.body,
  );
  // Clients' files are always shared with their team. Staff default to Internal Only.
  const visibility = access.caps.staff ? (body.visibility ?? 'internal') : 'client';
  if (body.task_id) {
    const t = await get<any>('SELECT visibility FROM tasks WHERE id = ? AND project_id = ?', body.task_id, access.project.id);
    if (!t || (!access.caps.staff && t.visibility !== 'client')) throw badRequest('Task not found.');
  }
  let supersedes: FileItem | null = null;
  if (body.supersedes_id) {
    supersedes = (await get<FileItem>('SELECT * FROM files WHERE id = ? AND project_id = ? AND deleted_at IS NULL', body.supersedes_id, access.project.id)) ?? null;
    if (!supersedes || (!access.caps.staff && supersedes.visibility !== 'client')) throw badRequest('Original file not found.');
    if (uploaded.length !== 1) throw badRequest('Upload exactly one file for a new version.');
  }
  const stored = await storeFiles(access, uploaded, {
    category: supersedes?.category ?? body.category,
    visibility: supersedes && !access.caps.staff ? supersedes.visibility : visibility,
    task_id: body.task_id ?? supersedes?.task_id,
    supersedes,
  });
  const names = stored.map((f) => f.name).join(', ');
  await logActivity({
    projectId: access.project.id, actorId: req.user!.id, action: supersedes ? 'file.version' : 'file.uploaded',
    summary: supersedes ? `New version of ${names} uploaded (v${stored[0].version})` : `${stored.length > 1 ? `${stored.length} files` : 'New document'} uploaded: ${names}`,
    entityType: 'file', entityId: stored[0].id, entityLabel: names, visibility: stored[0].visibility,
  });
  if (!access.caps.staff)
    await notify(await staffUserIds(access.project.id), { projectId: access.project.id, type: 'file.uploaded', title: `${req.user!.name} uploaded ${stored.length > 1 ? `${stored.length} files` : stored[0].name}`, link: `files?category=${encodeURIComponent(stored[0].category)}` });
  res.status(201).json(stored);
});

/** Unattached uploads used as comment attachments. */
filesRouter.post('/projects/:pid/attachments', upload.array('files', 10), async (req, res) => {
  const uploaded = (req.files as Express.Multer.File[]) ?? [];
  const access = await projectAccess(req.user!, P(req.params.pid));
  if (!uploaded.length) throw badRequest('Choose a file to attach.');
  res.status(201).json(await storeFiles(access, uploaded, { category: 'Other', visibility: access.caps.staff ? 'internal' : 'client' }));
});

filesRouter.get('/files/:id/versions', async (req, res) => {
  const { row, access } = await scopedRow<FileItem>(req.user!, 'files', P(req.params.id), 'File');
  const chain: FileItem[] = [];
  let cur: FileItem | undefined = row;
  while (cur && chain.length < 100) {
    chain.push(cur);
    cur = cur.supersedes_id ? await get<FileItem>('SELECT * FROM files WHERE id = ? AND deleted_at IS NULL', cur.supersedes_id) : undefined;
  }
  const visible = chain.filter((f) => access.caps.staff || f.visibility === 'client');
  res.json(await Promise.all(visible.map(async (f) => ({ ...f, uploader_name: (await get<{ name: string }>('SELECT name FROM users WHERE id = ?', f.uploaded_by))?.name ?? null }))));
});

const INLINE_SAFE = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'video/mp4', 'audio/mpeg']);

filesRouter.get('/files/:id/download', async (req, res) => {
  const { row } = await scopedRow<FileItem & { storage_key: string; deleted_at: string | null }>(req.user!, 'files', P(req.params.id), 'File');
  if (row.deleted_at) throw new HttpError(404, 'File not found');
  const data = await readObject(row.storage_key);
  if (!data) throw new HttpError(404, 'File content is missing.');
  const inline = req.query.inline === '1' && INLINE_SAFE.has(row.mime);
  res.set({
    'Content-Type': inline ? row.mime : 'application/octet-stream',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name)}`,
    'Content-Length': String(data.length),
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
    'Cache-Control': 'private, no-store',
  });
  res.end(data);
});

filesRouter.patch('/files/:id', async (req, res) => {
  const { row, access } = await scopedRow<FileItem>(req.user!, 'files', P(req.params.id), 'File');
  const body = parse(z.object({ category: z.enum(FILE_CATEGORIES).optional(), visibility: zVisibility.optional() }), req.body);
  if (!access.caps.staff && (row.uploaded_by !== req.user!.id || body.visibility)) throw forbidden();
  if (body.visibility && !access.caps.manage) throw forbidden('Only project managers can change file visibility.');
  await update('files', row.id, body);
  if (body.visibility && body.visibility !== row.visibility)
    await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'file.visibility', summary: `${row.name} ${body.visibility === 'client' ? 'shared with the client' : 'made internal'}`, entityType: 'file', entityId: row.id, entityLabel: row.name, visibility: body.visibility === 'client' ? 'client' : 'internal' });
  else await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'file.updated', summary: `${row.name} moved to ${body.category ?? row.category}`, entityType: 'file', entityId: row.id, visibility: row.visibility });
  res.json({ ok: true });
});

filesRouter.delete('/files/:id', async (req, res) => {
  const { row, access } = await scopedRow<FileItem>(req.user!, 'files', P(req.params.id), 'File');
  if (!(access.caps.manage || row.uploaded_by === req.user!.id)) throw forbidden('You can only remove files you uploaded.');
  if (row.deliverable_version_id && !access.caps.manage) throw forbidden('Deliverable files are part of the approval record.');
  await update('files', row.id, { deleted_at: now() });
  await logActivity({ projectId: row.project_id, actorId: req.user!.id, action: 'file.deleted', summary: `${row.name} removed`, entityType: 'file', entityId: row.id, entityLabel: row.name, visibility: row.visibility });
  res.json({ ok: true });
});
