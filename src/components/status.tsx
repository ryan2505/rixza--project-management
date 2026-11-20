import { Eye, Lock } from 'lucide-react';
import { Badge, type Tone } from './ui';
import {
  DELIVERABLE_STATUS_LABEL,
  HEALTH_LABEL,
  PHASE_STATUS_LABEL,
  PRIORITY_LABEL,
  PROJECT_STATUS_LABEL,
  TASK_STATUS_LABEL,
  type DeliverableStatus,
  type PhaseDisplayStatus,
  type Priority,
  type ProjectHealth,
  type ProjectStatus,
  type TaskStatus,
  type Visibility,
} from '../../shared/domain';

const taskTone: Record<TaskStatus, Tone> = {
  backlog: 'muted',
  todo: 'neutral',
  in_progress: 'brand',
  in_review: 'warning',
  approved: 'success',
  completed: 'dark',
};
export const TaskStatusBadge = ({ status }: { status: TaskStatus }) => <Badge tone={taskTone[status]}>{TASK_STATUS_LABEL[status]}</Badge>;

const deliverableTone: Record<DeliverableStatus, Tone> = {
  draft: 'muted',
  submitted: 'brandSolid',
  awaiting_feedback: 'warning',
  changes_requested: 'danger',
  approved: 'success',
  finalized: 'dark',
};
export const DeliverableStatusBadge = ({ status, clientView }: { status: DeliverableStatus; clientView?: boolean }) => (
  <Badge tone={deliverableTone[status]}>
    {clientView && (status === 'submitted' || status === 'awaiting_feedback') ? 'Awaiting your review' : DELIVERABLE_STATUS_LABEL[status]}
  </Badge>
);

const phaseTone: Record<PhaseDisplayStatus, Tone> = { upcoming: 'muted', in_progress: 'brand', completed: 'dark', delayed: 'danger' };
export const PhaseStatusBadge = ({ status }: { status: PhaseDisplayStatus }) => <Badge tone={phaseTone[status]}>{PHASE_STATUS_LABEL[status]}</Badge>;

const projectTone: Record<ProjectStatus, Tone> = { onboarding: 'neutral', active: 'brand', on_hold: 'warning', completed: 'dark' };
export const ProjectStatusBadge = ({ status }: { status: ProjectStatus }) => <Badge tone={projectTone[status]} dot>{PROJECT_STATUS_LABEL[status]}</Badge>;

const healthTone: Record<ProjectHealth, Tone> = { on_track: 'success', at_risk: 'warning', off_track: 'danger' };
export const HealthBadge = ({ health }: { health: ProjectHealth }) => <Badge tone={healthTone[health]} dot>{HEALTH_LABEL[health]}</Badge>;

const prioColor: Record<Priority, string> = { urgent: 'bg-danger', high: 'bg-ink', medium: 'bg-subtle', low: 'bg-line-strong' };
export function PriorityMark({ priority, withLabel }: { priority: Priority; withLabel?: boolean }) {
  const bars = { low: 1, medium: 2, high: 3, urgent: 3 }[priority];
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted" title={`${PRIORITY_LABEL[priority]} priority`}>
      <span className="flex h-2.5 items-end gap-[2px]">
        {[1, 2, 3].map((b) => (
          <span key={b} className={`w-[3px] rounded-[1px] ${b <= bars ? prioColor[priority] : 'bg-line'}`} style={{ height: `${b * 33}%` }} />
        ))}
      </span>
      {withLabel && PRIORITY_LABEL[priority]}
    </span>
  );
}

export function VisibilityBadge({ visibility, compact }: { visibility: Visibility; compact?: boolean }) {
  return visibility === 'internal' ? (
    <Badge tone="outline" className="gap-1">
      <Lock className="size-2.5" /> {!compact && 'Internal'}
    </Badge>
  ) : (
    <Badge tone="brand" className="gap-1">
      <Eye className="size-2.5" /> {!compact && 'Client visible'}
    </Badge>
  );
}
