import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Eye, FolderClosed, History, Lock, MoreHorizontal, Search, Trash2, Upload, UploadCloud, FolderInput, Unlock } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { api, fileUrl } from '../lib/api';
import { useAction, useFiles, useMe } from '../lib/queries';
import { useWorkspace } from '../lib/workspace';
import { fileSize, fmtDate, fmtDateTime } from '../lib/format';
import { FileIcon, FilePreviewModal, canPreview } from '../components/files';
import { VisibilityBadge } from '../components/status';
import { Badge, Button, EmptyState, ErrorState, Field, IconButton, Input, Menu, MenuItem, Modal, PageHeader, Segmented, Select, Skeleton, cx, useConfirm } from '../components/ui';
import { FILE_CATEGORIES, type FileItem, type Visibility } from '../../shared/domain';

function UploadModal({ open, onClose, defaultCategory, supersedes }: { open: boolean; onClose: () => void; defaultCategory: string; supersedes?: FileItem | null }) {
  const { pid, caps } = useWorkspace();
  const [files, setFiles] = useState<File[]>([]);
  const [category, setCategory] = useState(defaultCategory);
  const [visibility, setVisibility] = useState<Visibility>('internal');
  const [drag, setDrag] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) (setFiles([]), setCategory(supersedes?.category ?? (defaultCategory || 'Documents')), setVisibility(supersedes?.visibility ?? 'internal'));
  }, [open, defaultCategory, supersedes]);
  const save = useAction(
    () => {
      const fd = new FormData();
      files.forEach((f) => fd.append('files', f));
      fd.append('category', category);
      if (caps.staff) fd.append('visibility', visibility);
      if (supersedes) fd.append('supersedes_id', supersedes.id);
      return api.post<FileItem[]>(`/projects/${pid}/files`, fd);
    },
    { success: (r) => (supersedes ? `Version ${r[0].version} uploaded` : `${r.length} file${r.length > 1 ? 's' : ''} uploaded`), onSuccess: onClose },
  );
  return (
    <Modal open={open} onClose={onClose} title={supersedes ? `New version of ${supersedes.name}` : 'Upload files'} description={supersedes ? `Current version: v${supersedes.version}. Previous versions stay available in the history.` : undefined}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={!files.length} loading={save.isPending} onClick={() => save.mutate()}>Upload</Button></>}>
      <div className="flex flex-col gap-4">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          onDragOver={(e) => (e.preventDefault(), setDrag(true))}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => (e.preventDefault(), setDrag(false), setFiles(Array.from(e.dataTransfer.files).slice(0, supersedes ? 1 : 10)))}
          className={cx('flex flex-col items-center gap-1.5 rounded-lg border border-dashed px-4 py-8 text-center transition-colors', drag ? 'border-brand bg-brand-50' : 'border-line-strong hover:border-brand hover:bg-brand-50/40')}
        >
          <UploadCloud className="size-5 text-muted" />
          <span className="text-13 font-medium">{files.length ? `${files.length} file${files.length > 1 ? 's' : ''} ready` : 'Drop files here or click to browse'}</span>
          <span className="max-w-full truncate text-xs text-muted">{files.length ? files.map((f) => f.name).join(', ') : `${supersedes ? 'One file' : 'Up to 10 files'}, 50 MB max each`}</span>
        </button>
        <input ref={ref} type="file" multiple={!supersedes} hidden onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        {!supersedes && (
          <Field label="Category">
            <Select value={category} onChange={(e) => setCategory(e.target.value)}>{FILE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select>
          </Field>
        )}
        {caps.staff && !supersedes && (
          <Field label="Visibility" hint={visibility === 'internal' ? 'Only the RIXZA team can see these files.' : 'The client can see and download these files.'}>
            <Segmented value={visibility} onChange={setVisibility} options={[{ value: 'internal', label: 'Internal only', icon: <Lock className="size-3" /> }, { value: 'client', label: 'Client visible' }]} />
          </Field>
        )}
        {!caps.staff && <p className="text-xs text-muted">Files you upload are shared with your RIXZA project team.</p>}
      </div>
    </Modal>
  );
}

function VersionsModal({ file, onClose, onPreview }: { file: FileItem | null; onClose: () => void; onPreview: (f: FileItem) => void }) {
  const q = useQuery({ queryKey: ['file-versions', file?.id], queryFn: () => api.get<FileItem[]>(`/files/${file!.id}/versions`), enabled: !!file });
  return (
    <Modal open={!!file} onClose={onClose} title="Version history" description={file?.name}>
      {q.isLoading ? <Skeleton className="h-24" /> : (
        <ul className="flex flex-col">
          {q.data?.map((f, i) => (
            <li key={f.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-0">
              <Badge tone={i === 0 ? 'brand' : 'neutral'}>v{f.version}</Badge>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-13">{f.name}</span>
                <span className="block text-xs text-muted">{fmtDateTime(f.created_at)} · {f.uploader_name ?? '—'} · {fileSize(f.size)}</span>
              </span>
              {canPreview(f) && <IconButton label="Preview" onClick={() => onPreview(f)}><Eye className="size-4" /></IconButton>}
              <a href={fileUrl(f.id)} className="inline-flex size-8 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink" aria-label="Download"><Download className="size-4" /></a>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

export function FilesPage() {
  const { pid, caps } = useWorkspace();
  const me = useMe().data!.user!;
  const confirm = useConfirm();
  const [params, setParams] = useSearchParams();
  const category = params.get('category') ?? '';
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);
  const q = useFiles(pid, category, debounced);
  const all = useFiles(pid, '', '');
  const [upload, setUpload] = useState<{ open: boolean; supersedes?: FileItem | null }>({ open: false });
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [versions, setVersions] = useState<FileItem | null>(null);
  const patch = useAction(({ id, body }: { id: string; body: Record<string, string> }) => api.patch(`/files/${id}`, body), { success: 'File updated' });
  const del = useAction((id: string) => api.del(`/files/${id}`), { success: 'File removed' });

  const setCategory = (c: string) => {
    const p = new URLSearchParams(params);
    if (c) p.set('category', c);
    else p.delete('category');
    setParams(p, { replace: true });
  };
  const counts = new Map<string, number>();
  all.data?.forEach((f) => counts.set(f.category, (counts.get(f.category) ?? 0) + 1));

  return (
    <div>
      <PageHeader
        title="Files"
        description="Every document for your project, organised and versioned."
        actions={<Button variant="primary" size="sm" icon={<Upload className="size-3.5" />} onClick={() => setUpload({ open: true })}>Upload</Button>}
      />
      <div className="grid gap-6 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block" aria-label="File categories">
          <ul className="flex flex-col gap-px">
            {['', ...FILE_CATEGORIES].map((c) => (
              <li key={c || 'all'}>
                <button onClick={() => setCategory(c)} className={cx('flex h-8 w-full items-center gap-2 rounded-md px-2.5 text-left text-13', category === c ? 'bg-brand-50 font-medium text-brand' : 'text-ink-2 hover:bg-hover')}>
                  <FolderClosed className={cx('size-3.5', category === c ? 'text-brand' : 'text-muted')} />
                  <span className="flex-1 truncate">{c || 'All files'}</span>
                  <span className="text-2xs text-muted tabular">{c ? (counts.get(c) ?? 0) : (all.data?.length ?? 0)}</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <div className="min-w-0">
          <div className="mb-3 flex flex-wrap gap-2">
            <div className="relative min-w-0 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search files" className="pl-8" aria-label="Search files" />
            </div>
            <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-44 lg:hidden" aria-label="Category">
              <option value="">All files</option>
              {FILE_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
            </Select>
          </div>
          {q.isLoading ? (
            <Skeleton className="h-64" />
          ) : q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <div className="rounded-lg border border-line bg-surface">
              <EmptyState icon={<FolderClosed />} title={search ? 'No files match your search' : category ? `No files in ${category} yet` : 'No files yet'} description={search ? 'Try another name.' : 'Upload briefs, brand assets and documents to share them with your team.'} action={!search && <Button variant="primary" icon={<Upload className="size-3.5" />} onClick={() => setUpload({ open: true })}>Upload files</Button>} />
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-line bg-surface">
              <div className="hidden grid-cols-[minmax(0,1fr)_140px_80px_150px_40px] gap-3 border-b border-line bg-canvas px-4 py-2 text-2xs font-medium uppercase tracking-wide text-muted md:grid">
                <span>Name</span><span>Category</span><span className="text-right">Size</span><span>Uploaded</span><span />
              </div>
              <ul>
                {q.data.map((f) => {
                  const mine = f.uploaded_by === me.id;
                  return (
                    <li key={f.id} className="grid grid-cols-[minmax(0,1fr)_40px] items-center gap-3 border-b border-line px-4 py-2.5 last:border-0 hover:bg-canvas md:grid-cols-[minmax(0,1fr)_140px_80px_150px_40px]">
                      <button className="flex min-w-0 items-center gap-3 text-left" onClick={() => (canPreview(f) ? setPreview(f) : (window.location.href = fileUrl(f.id)))}>
                        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-line bg-surface text-muted"><FileIcon mime={f.mime} name={f.name} /></span>
                        <span className="min-w-0">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-13 font-medium hover:underline">{f.name}</span>
                            {f.version > 1 && <Badge tone="neutral">v{f.version}</Badge>}
                            {caps.staff && f.visibility === 'internal' && <VisibilityBadge visibility="internal" compact />}
                          </span>
                          <span className="block truncate text-xs text-muted md:hidden">{f.category} · {fileSize(f.size)} · {fmtDate(f.created_at)}</span>
                        </span>
                      </button>
                      <span className="hidden truncate text-xs text-ink-2 md:block">{f.category}</span>
                      <span className="hidden text-right text-xs text-muted tabular md:block">{fileSize(f.size)}</span>
                      <span className="hidden min-w-0 md:block">
                        <span className="block truncate text-xs text-ink-2">{f.uploader_name ?? '—'}</span>
                        <span className="block text-2xs text-muted">{fmtDate(f.created_at)}</span>
                      </span>
                      <Menu trigger={({ toggle }) => <IconButton label={`Actions for ${f.name}`} onClick={toggle}><MoreHorizontal className="size-4" /></IconButton>}>
                        {(close) => (
                          <>
                            {canPreview(f) && <MenuItem icon={<Eye />} onClick={() => (close(), setPreview(f))}>Preview</MenuItem>}
                            <MenuItem icon={<Download />} onClick={() => (close(), (window.location.href = fileUrl(f.id)))}>Download</MenuItem>
                            <MenuItem icon={<Upload />} onClick={() => (close(), setUpload({ open: true, supersedes: f }))}>Upload new version</MenuItem>
                            <MenuItem icon={<History />} onClick={() => (close(), setVersions(f))}>Version history</MenuItem>
                            {(caps.staff || mine) && (
                              <div className="my-1 border-t border-line pt-1">
                                <div className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-subtle">Move to</div>
                                <div className="max-h-40 overflow-y-auto">
                                  {FILE_CATEGORIES.filter((c) => c !== f.category).map((c) => (
                                    <MenuItem key={c} icon={<FolderInput />} onClick={() => (close(), patch.mutate({ id: f.id, body: { category: c } }))}>{c}</MenuItem>
                                  ))}
                                </div>
                              </div>
                            )}
                            {caps.manage && !f.deliverable_version_id && (
                              <MenuItem icon={f.visibility === 'internal' ? <Unlock /> : <Lock />} onClick={async () => {
                                close();
                                const toClient = f.visibility === 'internal';
                                if (await confirm({ title: toClient ? 'Share this file with the client?' : 'Make this file internal?', description: toClient ? 'The client will be able to see and download it.' : 'The client will no longer see this file.', confirmLabel: toClient ? 'Share with client' : 'Make internal' }))
                                  patch.mutate({ id: f.id, body: { visibility: toClient ? 'client' : 'internal' } });
                              }}>
                                {f.visibility === 'internal' ? 'Share with client' : 'Make internal'}
                              </MenuItem>
                            )}
                            {(caps.manage || (mine && !f.deliverable_version_id)) && (
                              <MenuItem icon={<Trash2 />} danger onClick={async () => (close(), (await confirm({ title: `Remove ${f.name}?`, description: 'The file will no longer be available in the project.', danger: true, confirmLabel: 'Remove' })) && del.mutate(f.id))}>Remove</MenuItem>
                            )}
                          </>
                        )}
                      </Menu>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      </div>
      <UploadModal open={upload.open} supersedes={upload.supersedes} defaultCategory={category} onClose={() => setUpload({ open: false })} />
      <FilePreviewModal file={preview} onClose={() => setPreview(null)} />
      <VersionsModal file={versions} onClose={() => setVersions(null)} onPreview={(f) => (setVersions(null), setPreview(f))} />
    </div>
  );
}
