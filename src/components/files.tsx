import { useState } from 'react';
import { Download, Eye, File, FileArchive, FileCode2, FileImage, FileSpreadsheet, FileText, FileVideo } from 'lucide-react';
import { fileUrl } from '../lib/api';
import { fileSize, fmtDate } from '../lib/format';
import { Button, IconButton, Modal, cx } from './ui';
import type { FileItem } from '../../shared/domain';

export function FileIcon({ mime, name, className }: { mime: string; name: string; className?: string }) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  const cls = cx('size-4', className);
  if (mime.startsWith('image/')) return <FileImage className={cls} />;
  if (mime.startsWith('video/')) return <FileVideo className={cls} />;
  if (/zip|rar|7z|tar|gz/.test(ext)) return <FileArchive className={cls} />;
  if (/csv|xls|xlsx|numbers/.test(ext)) return <FileSpreadsheet className={cls} />;
  if (/js|ts|tsx|html|css|json|py|php/.test(ext)) return <FileCode2 className={cls} />;
  if (/pdf|doc|docx|txt|md|rtf|pages/.test(ext) || mime.startsWith('text/')) return <FileText className={cls} />;
  return <File className={cls} />;
}

export const canPreview = (f: Pick<FileItem, 'mime'>) =>
  ['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'application/pdf', 'text/plain', 'video/mp4'].includes(f.mime);

export function FilePreviewModal({ file, onClose }: { file: FileItem | null; onClose: () => void }) {
  return (
    <Modal
      open={!!file}
      onClose={onClose}
      size="lg"
      title={file?.name}
      description={file ? `${fileSize(file.size)} · uploaded ${fmtDate(file.created_at)}${file.uploader_name ? ` by ${file.uploader_name}` : ''}${file.version > 1 ? ` · version ${file.version}` : ''}` : undefined}
      footer={file && <a href={fileUrl(file.id)}><Button variant="primary" icon={<Download className="size-3.5" />}>Download</Button></a>}
    >
      {file && (
        <div className="overflow-hidden rounded-md border border-line bg-canvas">
          {file.mime.startsWith('image/') ? (
            <img src={fileUrl(file.id, true)} alt={file.name} className="mx-auto max-h-[65vh] w-auto" />
          ) : file.mime.startsWith('video/') ? (
            <video src={fileUrl(file.id, true)} controls className="max-h-[65vh] w-full" />
          ) : (
            <iframe src={fileUrl(file.id, true)} title={file.name} className="h-[65vh] w-full bg-white" sandbox="" />
          )}
        </div>
      )}
    </Modal>
  );
}

export function FileChip({ file, onPreview }: { file: FileItem; onPreview?: (f: FileItem) => void }) {
  const [preview, setPreview] = useState<FileItem | null>(null);
  const open = onPreview ?? setPreview;
  return (
    <div className="group flex min-w-0 items-center gap-2 rounded-md border border-line bg-surface py-1.5 pr-1 pl-2.5">
      <FileIcon mime={file.mime} name={file.name} className="shrink-0 text-muted" />
      <button className="min-w-0 flex-1 text-left" onClick={() => (canPreview(file) ? open(file) : (window.location.href = fileUrl(file.id)))}>
        <span className="block truncate text-xs font-medium text-ink hover:underline">{file.name}</span>
        <span className="block text-2xs text-muted">{fileSize(file.size)}</span>
      </button>
      {canPreview(file) && (
        <IconButton size="sm" label="Preview" onClick={() => open(file)}>
          <Eye className="size-3.5" />
        </IconButton>
      )}
      <a href={fileUrl(file.id)} aria-label={`Download ${file.name}`} title="Download" className="inline-flex size-6 items-center justify-center rounded-md text-muted hover:bg-hover hover:text-ink">
        <Download className="size-3.5" />
      </a>
      {!onPreview && <FilePreviewModal file={preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
