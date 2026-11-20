import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAction, useMe } from '../lib/queries';
import { Avatar, Badge, Button, Checkbox, Field, Input, PageHeader, Panel } from '../components/ui';
import { ROLE_LABEL } from '../../shared/domain';

export function AccountSettingsPage() {
  const me = useMe().data!;
  const user = me.user!;
  const [name, setName] = useState(user.name);
  const [title, setTitle] = useState(user.title ?? '');
  const [email, setEmail] = useState(!!user.email_notifications);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  useEffect(() => (setName(user.name), setTitle(user.title ?? ''), setEmail(!!user.email_notifications)), [user]);

  const saveProfile = useAction(() => api.patch('/auth/me', { name, title: title || null }), { success: 'Profile updated', refreshMe: true });
  const saveEmail = useAction((v: boolean) => api.patch('/auth/me', { email_notifications: v }), { success: 'Notification preferences saved', refreshMe: true });
  const changePw = useAction(() => api.post('/auth/password', { current: pw.current, next: pw.next }), {
    success: 'Password changed. Other sessions have been signed out.',
    onSuccess: () => setPw({ current: '', next: '', confirm: '' }),
  });
  const pwValid = pw.next.length >= 10 && /[A-Za-z]/.test(pw.next) && /\d/.test(pw.next) && pw.next === pw.confirm && pw.current;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Account settings" description="Your profile, notifications and security." />
      <div className="flex flex-col gap-6">
        <Panel title="Profile">
          <div className="mb-5 flex items-center gap-3">
            <Avatar name={user.name} role={user.role} size={44} />
            <div>
              <p className="text-13 font-medium">{user.email}</p>
              <Badge tone="neutral" className="mt-1">{ROLE_LABEL[user.role]}</Badge>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Job title" optional><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" loading={saveProfile.isPending} disabled={!name.trim() || (name === user.name && title === (user.title ?? ''))} onClick={() => saveProfile.mutate()}>Save profile</Button>
          </div>
        </Panel>

        <Panel title="Notifications">
          <Checkbox
            checked={email}
            onChange={(v) => (setEmail(v), saveEmail.mutate(v))}
            label="Email me about important updates"
            description="Deliverables to review, deadline changes, milestones, phase changes and replies in conversations you take part in. In-app notifications are always on."
          />
        </Panel>

        <Panel title="Password">
          <div className="grid gap-4">
            <Field label="Current password"><Input type="password" autoComplete="current-password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="New password" hint="At least 10 characters, with letters and a number."><Input type="password" autoComplete="new-password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} /></Field>
              <Field label="Confirm new password" error={pw.confirm && pw.confirm !== pw.next ? 'Passwords don’t match' : null}><Input type="password" autoComplete="new-password" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} /></Field>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button variant="primary" loading={changePw.isPending} disabled={!pwValid} onClick={() => changePw.mutate()}>Change password</Button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
