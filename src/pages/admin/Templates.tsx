import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Copy, LayoutTemplate, Lock, Plus, Trash2, X } from 'lucide-react';
import { api } from '../../lib/api';
import { useAction, useMe } from '../../lib/queries';
import { Badge, Button, Checkbox, EmptyState, ErrorState, Field, IconButton, Input, Modal, PageHeader, Panel, Select, Skeleton, cx, useConfirm } from '../../components/ui';
import { can, type ProjectTemplate, type TemplateDefinition } from '../../../shared/domain';

type Def = TemplateDefinition;
const blankPhase = (): Def['phases'][number] => ({ name: 'New phase', description: '', durationDays: 10, tasks: [], milestones: [] });

function TemplateEditor({ open, onClose, template }: { open: boolean; onClose: () => void; template?: ProjectTemplate | null }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('');
  const [description, setDescription] = useState('');
  const [def, setDef] = useState<Def>({ phases: [] });
  const [openPhase, setOpenPhase] = useState<number | null>(0);
  useEffect(() => {
    if (!open) return;
    setName(template?.name ?? '');
    setType(template?.project_type ?? '');
    setDescription(template?.description ?? '');
    setDef(template ? structuredClone(template.definition) : { phases: [blankPhase()] });
    setOpenPhase(0);
  }, [open, template]);
  const save = useAction(
    () => {
      const body = { name, project_type: type, description: description || null, definition: def };
      return template?.id ? api.put(`/admin/templates/${template.id}`, body) : api.post('/admin/templates', body);
    },
    { success: 'Template saved', onSuccess: onClose },
  );
  const setPhase = (i: number, p: Partial<Def['phases'][number]>) => setDef({ phases: def.phases.map((x, j) => (j === i ? { ...x, ...p } : x)) });
  const total = def.phases.reduce((s, p) => s + (p.durationDays || 0), 0);

  return (
    <Modal open={open} onClose={onClose} size="lg" title={template?.id ? 'Edit template' : 'New template'} description="Phases are laid out in order. Durations scale to fit each project’s dates."
      footer={<><span className="mr-auto text-xs text-muted">{def.phases.length} phases · ~{total} days</span><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={save.isPending} disabled={!name.trim() || !type.trim() || !def.phases.length} onClick={() => save.mutate()}>Save template</Button></>}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Project type"><Input value={type} onChange={(e) => setType(e.target.value)} /></Field>
          <Field label="Description" optional className="sm:col-span-2"><Input value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        </div>
        <div className="flex flex-col gap-2">
          {def.phases.map((p, i) => (
            <div key={i} className="rounded-lg border border-line">
              <div className="flex items-center gap-2 px-3 py-2">
                <span className="w-5 text-2xs font-medium text-subtle tabular">{String(i + 1).padStart(2, '0')}</span>
                <Input value={p.name} onChange={(e) => setPhase(i, { name: e.target.value })} className="h-7 flex-1" aria-label="Phase name" />
                <Input type="number" min={1} max={365} value={p.durationDays} onChange={(e) => setPhase(i, { durationDays: Math.max(1, Number(e.target.value) || 1) })} className="h-7 w-16" aria-label="Duration in days" />
                <span className="text-xs text-muted">days</span>
                <IconButton size="sm" label="Toggle details" onClick={() => setOpenPhase(openPhase === i ? null : i)}><ChevronDown className={cx('size-3.5 transition-transform', openPhase === i && 'rotate-180')} /></IconButton>
                <IconButton size="sm" label="Remove phase" onClick={() => setDef({ phases: def.phases.filter((_, j) => j !== i) })}><Trash2 className="size-3.5" /></IconButton>
              </div>
              {openPhase === i && (
                <div className="flex flex-col gap-3 border-t border-line px-3 py-3">
                  <Input value={p.description ?? ''} onChange={(e) => setPhase(i, { description: e.target.value })} placeholder="Phase description (shown to the client)" />
                  <div>
                    <div className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle">Suggested tasks</div>
                    <ul className="flex flex-col gap-1.5">
                      {p.tasks.map((t, k) => (
                        <li key={k} className="flex flex-wrap items-center gap-2">
                          <Input value={t.title} onChange={(e) => setPhase(i, { tasks: p.tasks.map((x, m) => (m === k ? { ...x, title: e.target.value } : x)) })} className="h-7 min-w-40 flex-1" />
                          <Select value={t.visibility} onChange={(e) => setPhase(i, { tasks: p.tasks.map((x, m) => (m === k ? { ...x, visibility: e.target.value as any, client_action: e.target.value === 'internal' ? false : x.client_action } : x)) })} className="w-32">
                            <option value="internal">Internal</option>
                            <option value="client">Client visible</option>
                          </Select>
                          <Checkbox checked={!!t.client_action} disabled={t.visibility !== 'client'} onChange={(v) => setPhase(i, { tasks: p.tasks.map((x, m) => (m === k ? { ...x, client_action: v } : x)) })} label={<span className="text-xs">Client action</span>} />
                          <IconButton size="sm" label="Remove task" onClick={() => setPhase(i, { tasks: p.tasks.filter((_, m) => m !== k) })}><X className="size-3.5" /></IconButton>
                        </li>
                      ))}
                    </ul>
                    <Button size="xs" variant="ghost" className="mt-1.5" icon={<Plus className="size-3" />} onClick={() => setPhase(i, { tasks: [...p.tasks, { title: 'New task', visibility: 'internal' }] })}>Add task</Button>
                  </div>
                  <div>
                    <div className="mb-1.5 text-2xs font-medium uppercase tracking-wide text-subtle">Milestones (at phase end)</div>
                    <ul className="flex flex-col gap-1.5">
                      {p.milestones.map((m, k) => (
                        <li key={k} className="flex items-center gap-2">
                          <Input value={m.title} onChange={(e) => setPhase(i, { milestones: p.milestones.map((x, n) => (n === k ? { ...x, title: e.target.value } : x)) })} className="h-7 flex-1" />
                          <IconButton size="sm" label="Remove milestone" onClick={() => setPhase(i, { milestones: p.milestones.filter((_, n) => n !== k) })}><X className="size-3.5" /></IconButton>
                        </li>
                      ))}
                    </ul>
                    <Button size="xs" variant="ghost" className="mt-1.5" icon={<Plus className="size-3" />} onClick={() => setPhase(i, { milestones: [...p.milestones, { title: 'New milestone' }] })}>Add milestone</Button>
                  </div>
                </div>
              )}
            </div>
          ))}
          <Button variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => (setDef({ phases: [...def.phases, blankPhase()] }), setOpenPhase(def.phases.length))}>Add phase</Button>
        </div>
      </div>
    </Modal>
  );
}

export function TemplatesPage() {
  const me = useMe().data!.user!;
  const manage = can(me.role, 'templates.manage');
  const confirm = useConfirm();
  const q = useQuery({ queryKey: ['admin', 'templates'], queryFn: () => api.get<ProjectTemplate[]>('/admin/templates') });
  const [editing, setEditing] = useState<{ open: boolean; t?: ProjectTemplate | null }>({ open: false });
  const del = useAction((id: string) => api.del(`/admin/templates/${id}`), { success: 'Template deleted' });
  return (
    <div>
      <PageHeader title="Project templates" description="Reusable structures with phases, suggested tasks and default milestones. Projects stay fully editable after creation." actions={manage && <Button variant="primary" size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEditing({ open: true, t: null })}>New template</Button>} />
      {q.isLoading ? <Skeleton className="h-64" /> : q.error ? <ErrorState error={q.error} /> : !q.data?.length ? (
        <Panel><EmptyState icon={<LayoutTemplate />} title="No templates yet" /></Panel>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((t) => {
            const tasks = t.definition.phases.reduce((s, p) => s + p.tasks.length, 0);
            const internal = t.definition.phases.reduce((s, p) => s + p.tasks.filter((x) => x.visibility === 'internal').length, 0);
            return (
              <div key={t.id} className="flex flex-col rounded-lg border border-line bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">{t.name}</h3>
                    <p className="mt-0.5 text-xs text-muted">{t.description}</p>
                  </div>
                  <Badge tone="neutral">{t.project_type}</Badge>
                </div>
                <ol className="mt-4 flex flex-1 flex-col gap-1">
                  {t.definition.phases.slice(0, 6).map((p, i) => (
                    <li key={i} className="flex items-center gap-2 text-xs text-ink-2"><span className="w-4 text-subtle tabular">{i + 1}</span><span className="flex-1 truncate">{p.name}</span><span className="text-subtle tabular">{p.durationDays}d</span></li>
                  ))}
                  {t.definition.phases.length > 6 && <li className="pl-6 text-xs text-subtle">+{t.definition.phases.length - 6} more</li>}
                </ol>
                <div className="mt-4 flex items-center gap-3 border-t border-line pt-3 text-xs text-muted">
                  <span>{tasks} tasks</span>
                  <span className="flex items-center gap-1"><Lock className="size-3" />{internal} internal</span>
                  <span className="flex-1" />
                  {manage && (
                    <>
                      <IconButton size="sm" label="Duplicate" onClick={() => setEditing({ open: true, t: { ...t, id: '', name: `${t.name} (copy)` } })}><Copy className="size-3.5" /></IconButton>
                      <IconButton size="sm" label="Delete" onClick={async () => (await confirm({ title: `Delete “${t.name}”?`, description: 'Existing projects created from it are not affected.', danger: true, confirmLabel: 'Delete' })) && del.mutate(t.id)}><Trash2 className="size-3.5" /></IconButton>
                      <Button size="xs" onClick={() => setEditing({ open: true, t })}>Edit</Button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      <TemplateEditor open={editing.open} template={editing.t} onClose={() => setEditing({ open: false })} />
    </div>
  );
}
