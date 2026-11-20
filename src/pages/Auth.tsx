import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { api } from '../lib/api';
import { useMe } from '../lib/queries';
import { Logo } from '../components/Shell';
import { Button, Field, Input, Skeleton } from '../components/ui';

function AuthLayout({ title, subtitle, children }: { title: ReactNode; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <aside className="relative hidden flex-col justify-between overflow-hidden bg-ink p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <Logo compact />
          <span className="text-[13px] font-bold tracking-[0.14em]">RIXZA</span>
        </div>
        <div className="relative z-10 max-w-md">
          <div className="mb-6 h-px w-12 bg-brand" />
          <p className="text-[28px] leading-[1.2] font-medium tracking-tight">
            One workspace.
            <br />
            Complete visibility.
            <br />
            <span className="text-[#8c8cff]">Total alignment.</span>
          </p>
          <p className="mt-5 text-13 leading-6 text-white/55">
            Follow your project in real time, review deliverables, share files and work directly with your RIXZA team — in one private workspace.
          </p>
        </div>
        <div className="text-xs text-white/40">© {new Date().getFullYear()} RIXZA · Client Portal</div>
        {/* Precise grid, not decoration for its own sake: echoes the structured, engineered brand. */}
        <svg className="pointer-events-none absolute inset-0 h-full w-full opacity-[0.07]" aria-hidden>
          <defs>
            <pattern id="g" width="48" height="48" patternUnits="userSpaceOnUse">
              <path d="M48 0H0V48" fill="none" stroke="white" strokeWidth="0.5" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#g)" />
        </svg>
        <div className="pointer-events-none absolute -right-24 top-1/3 size-72 rounded-full bg-brand opacity-30 blur-[120px]" aria-hidden />
      </aside>
      <main className="flex flex-col items-center justify-center px-5 py-12 sm:px-10">
        <div className="w-full max-w-[360px]">
          <div className="mb-10 lg:hidden">
            <Logo />
          </div>
          <h1 className="text-[22px] leading-8 font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1.5 text-13 text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
        </div>
      </main>
    </div>
  );
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null;
  return <div className="rounded-md border border-danger/20 bg-danger-bg px-3 py-2 text-13 text-danger" role="alert">{error}</div>;
}

export function LoginPage() {
  const me = useMe();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (me.data?.user) return <Navigate to="/" replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.post('/auth/login', { email, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthLayout title="Sign in to your workspace" subtitle="Welcome back. Use the email address your RIXZA team invited.">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormError error={error} />
        <Field label="Email" htmlFor="email">
          <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" autoFocus />
        </Field>
        <Field
          label={
            <span className="flex w-full justify-between">
              Password
              <Link to="/forgot" className="font-normal text-brand hover:underline">Forgot password?</Link>
            </span>
          }
          htmlFor="password"
        >
          <Input id="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
        </Field>
        <Button type="submit" variant="primary" size="lg" loading={loading} className="mt-2 w-full">
          Sign in
        </Button>
      </form>
      <p className="mt-8 text-xs leading-5 text-muted">
        Access is by invitation only. If you’re a RIXZA client and haven’t received your invitation, contact your project manager.
      </p>
    </AuthLayout>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/forgot', { email });
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout title="Reset your password" subtitle={sent ? undefined : 'Enter your email and we’ll send you a secure link to choose a new password.'}>
      {sent ? (
        <div className="flex flex-col gap-4">
          <div className="flex gap-3 rounded-lg border border-line bg-surface p-4">
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-brand" />
            <p className="text-13 text-ink-2">If an account exists for <strong className="font-medium text-ink">{email}</strong>, you’ll receive an email with a reset link in a moment. The link is valid for one hour.</p>
          </div>
          <Link to="/login" className="text-13 font-medium text-brand hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormError error={error} />
          <Field label="Email" htmlFor="email">
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-10" autoFocus />
          </Field>
          <Button type="submit" variant="primary" size="lg" loading={loading} className="w-full">Send reset link</Button>
          <Link to="/login" className="text-center text-13 text-muted hover:text-ink">Back to sign in</Link>
        </form>
      )}
    </AuthLayout>
  );
}

function PasswordFields({ password, setPassword, confirm, setConfirm }: { password: string; setPassword: (v: string) => void; confirm: string; setConfirm: (v: string) => void }) {
  const checks = [
    { ok: password.length >= 10, label: 'At least 10 characters' },
    { ok: /[A-Za-z]/.test(password) && /\d/.test(password), label: 'Letters and at least one number' },
    { ok: password.length > 0 && password === confirm, label: 'Passwords match' },
  ];
  return (
    <>
      <Field label="New password" htmlFor="pw">
        <Input id="pw" type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} className="h-10" />
      </Field>
      <Field label="Confirm password" htmlFor="pw2">
        <Input id="pw2" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="h-10" />
      </Field>
      <ul className="flex flex-col gap-1">
        {checks.map((c) => (
          <li key={c.label} className={`flex items-center gap-2 text-xs ${c.ok ? 'text-ink-2' : 'text-subtle'}`}>
            <span className={`size-1.5 rounded-full ${c.ok ? 'bg-brand' : 'bg-line-strong'}`} /> {c.label}
          </li>
        ))}
      </ul>
    </>
  );
}

const passwordValid = (p: string, c: string) => p.length >= 10 && /[A-Za-z]/.test(p) && /\d/.test(p) && p === c;

export function ResetPasswordPage() {
  const { token } = useParams();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/reset', { token, password });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout title={done ? 'Password updated' : 'Choose a new password'} subtitle={done ? 'You can now sign in with your new password. For your security, other sessions have been signed out.' : undefined}>
      {done ? (
        <Link to="/login"><Button variant="primary" size="lg" className="w-full">Sign in <ArrowRight className="size-4" /></Button></Link>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <FormError error={error} />
          <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} />
          <Button type="submit" variant="primary" size="lg" loading={loading} disabled={!passwordValid(password, confirm)} className="mt-2 w-full">Update password</Button>
        </form>
      )}
    </AuthLayout>
  );
}

export function AcceptInvitePage() {
  const { token } = useParams();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const invite = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ email: string; name: string; role: string; company: string | null }>(`/auth/invite/${token}`),
    retry: false,
  });
  const [name, setName] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (invite.isLoading)
    return (
      <AuthLayout title={<Skeleton className="h-7 w-56" />}>
        <Skeleton className="h-40" />
      </AuthLayout>
    );
  if (invite.error)
    return (
      <AuthLayout title="Invitation unavailable" subtitle={(invite.error as Error).message}>
        <Link to="/login" className="text-13 font-medium text-brand hover:underline">Go to sign in</Link>
      </AuthLayout>
    );

  const inv = invite.data!;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/auth/invite/accept', { token, name: name ?? inv.name, password });
      await qc.invalidateQueries({ queryKey: ['me'] });
      navigate('/', { replace: true });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthLayout
      title={inv.company ? `Welcome to your ${inv.company} workspace` : 'Join the RIXZA workspace'}
      subtitle="Set your password to activate your account. You’ll land directly in your project workspace."
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <FormError error={error} />
        <Field label="Email">
          <Input value={inv.email} disabled className="h-10" />
        </Field>
        <Field label="Full name" htmlFor="name">
          <Input id="name" required value={name ?? inv.name} onChange={(e) => setName(e.target.value)} className="h-10" />
        </Field>
        <PasswordFields password={password} setPassword={setPassword} confirm={confirm} setConfirm={setConfirm} />
        <Button type="submit" variant="primary" size="lg" loading={loading} disabled={!passwordValid(password, confirm)} className="mt-2 w-full">
          Activate my account
        </Button>
      </form>
    </AuthLayout>
  );
}
