import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown, Mail, MessagesSquare } from 'lucide-react';
import { useWorkspace } from '../lib/workspace';
import { Avatar, Button, PageHeader, Panel, cx } from '../components/ui';

const FAQ = [
  { q: 'How is my project’s progress calculated?', a: 'Progress is calculated automatically from the actual work in your project: the share of tasks that are approved or completed across all phases. It updates in real time as your team moves work forward — it’s never entered manually.' },
  { q: 'What’s the difference between a comment and an approval?', a: 'Comments are for questions and discussion. An approval is a formal decision: it is recorded with your name, the date and the exact version you approved. To approve or request changes, use the buttons on the deliverable page.' },
  { q: 'What happens when I request changes?', a: 'Your request becomes a formal revision request linked to the deliverable. Your team is notified immediately, prepares a revised version and submits it back to you for review. You can follow each version in the deliverable’s history.' },
  { q: 'Who can see the files I upload?', a: 'Files you upload are shared only with your RIXZA project team and the people from your organisation who have access to this project. Nobody else can access them.' },
  { q: 'Why don’t I see every task on the board?', a: 'Your board shows the tasks relevant to you. Some purely internal work (technical setup, internal reviews) is tracked by the team separately — it still counts towards your progress percentage.' },
  { q: 'How do I control email notifications?', a: 'Go to Account settings and turn email updates on or off. In-app notifications are always available from the bell icon.' },
];

export function HelpPage() {
  const { base, detail } = useWorkspace();
  const [open, setOpen] = useState<number | null>(0);
  const pm = detail.manager;
  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Help & Support" description="Answers to common questions, and direct access to your team." />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Panel title="Frequently asked questions" bodyClassName="p-0">
          <ul>
            {FAQ.map((f, i) => (
              <li key={f.q} className="border-b border-line last:border-0">
                <button className="flex w-full items-center gap-3 px-4 py-3.5 text-left" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                  <span className="flex-1 text-13 font-medium">{f.q}</span>
                  <ChevronDown className={cx('size-4 text-muted transition-transform', open === i && 'rotate-180')} />
                </button>
                {open === i && <p className="px-4 pb-4 text-13 leading-6 text-ink-2">{f.a}</p>}
              </li>
            ))}
          </ul>
        </Panel>
        <div className="flex flex-col gap-6">
          {pm && (
            <Panel title="Your project manager">
              <div className="flex items-center gap-3">
                <Avatar name={pm.name} size={40} />
                <div className="min-w-0">
                  <p className="truncate text-13 font-medium">{pm.name}</p>
                  <p className="truncate text-xs text-muted">{pm.title ?? 'Project Manager'}</p>
                </div>
              </div>
              <div className="mt-4 flex flex-col gap-2">
                <Link to={`${base}/discussions`}><Button variant="primary" className="w-full" icon={<MessagesSquare className="size-3.5" />}>Message the team</Button></Link>
                {pm.email && <a href={`mailto:${pm.email}`}><Button className="w-full" icon={<Mail className="size-3.5" />}>Email {pm.name.split(' ')[0]}</Button></a>}
              </div>
            </Panel>
          )}
          <Panel title="Response times">
            <p className="text-13 leading-6 text-ink-2">Your team replies to messages within one business day. For anything urgent on a live project, mention it in the subject of your discussion.</p>
          </Panel>
        </div>
      </div>
    </div>
  );
}
