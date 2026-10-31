import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './AuthContext';
import { DEMO_ACCOUNTS, SHOW_DEMO_ACCOUNTS } from './demo-accounts';
import { describeLoginError, validateLogin, type LoginErrors } from './login-form';

const FEATURES = [
  {
    title: 'Performa & revenue per karyawan',
    text: 'Skor KPI terhubung dengan pendapatan cabang yang sudah terverifikasi.',
    icon: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  },
  {
    title: 'Rekonsiliasi transaksi',
    text: 'Cocokkan catatan internal dan mutasi pihak ketiga, lihat anomali seketika.',
    icon: 'M4 7h16M4 12h10M4 17h7M17 14l2 2 4-4',
  },
  {
    title: 'Persetujuan anggaran',
    text: 'Alur persetujuan bertingkat dengan jejak audit yang tidak bisa diubah.',
    icon: 'M9 12l2 2 4-4M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4z',
  },
];

function Icon({ d, className = 'h-5 w-5' }: { d: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function LoginPage() {
  const { status, login, lastLogoutReason } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [errors, setErrors] = useState<LoginErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [demoHint, setDemoHint] = useState<string | null>(null);

  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const ids = { email: useId(), password: useId(), emailErr: useId(), passwordErr: useId(), caps: useId() };

  // Setelah percobaan pertama, error hilang begitu isian diperbaiki.
  useEffect(() => {
    if (submitted) setErrors(validateLogin({ email, password }));
  }, [email, password, submitted]);

  useEffect(() => {
    if (serverError) alertRef.current?.focus();
  }, [serverError]);

  if (status === 'authenticated') return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitted(true);
    setServerError(null);
    const found = validateLogin({ email, password });
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return passwordRef.current?.focus();
    setSubmitting(true);
    try {
      await login(email, password);
      navigate(from, { replace: true });
    } catch (err) {
      setServerError(describeLoginError(err));
      setPassword('');
      passwordRef.current?.focus();
    } finally {
      setSubmitting(false);
    }
  }

  function onPasswordKey(e: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(e.getModifierState?.('CapsLock') ?? false);
  }

  function pickDemo(account: string) {
    setEmail(account);
    setServerError(null);
    setDemoHint(account);
    passwordRef.current?.focus();
  }

  const inputBase =
    'block w-full rounded-lg border bg-white px-3.5 py-2.5 text-base text-slate-900 shadow-sm outline-none transition placeholder:text-slate-400 focus:ring-4';
  const inputState = (invalid: boolean) =>
    invalid
      ? 'border-red-400 focus:border-red-500 focus:ring-red-100'
      : 'border-slate-300 focus:border-blue-600 focus:ring-blue-100';

  return (
    <div className="min-h-screen bg-slate-100 lg:grid lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      {/* Panel informasi */}
      <aside className="relative hidden overflow-hidden bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white/10 ring-1 ring-white/20">
            <Icon d="M4 20V10l8-6 8 6v10M9 20v-6h6v6" />
          </span>
          <span className="text-lg font-semibold tracking-tight">Support Function Platform</span>
        </div>
        <div className="max-w-md">
          <h2 className="text-3xl font-semibold leading-tight">Satu tempat untuk HR, Finance, dan para manager.</h2>
          <ul className="mt-8 space-y-6">
            {FEATURES.map((f) => (
              <li key={f.title} className="flex gap-4">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-500/20 text-blue-200">
                  <Icon d={f.icon} />
                </span>
                <div>
                  <p className="font-medium">{f.title}</p>
                  <p className="mt-1 text-sm text-slate-300">{f.text}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
        <p className="flex items-center gap-2 text-sm text-slate-300">
          <Icon d="M12 3l7 4v5c0 4.5-3 8-7 9-4-1-7-4.5-7-9V7l7-4z" className="h-4 w-4" />
          Data yang tampil otomatis dibatasi sesuai peran dan cabang Anda.
        </p>
      </aside>

      {/* Formulir */}
      <main className="flex min-h-screen items-start justify-center px-4 py-10 sm:items-center sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white">
              <Icon d="M4 20V10l8-6 8 6v10M9 20v-6h6v6" />
            </span>
            <span className="text-lg font-semibold text-slate-900">Support Function Platform</span>
          </div>

          <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
            <h1 className="text-2xl font-semibold text-slate-900">Masuk ke akun Anda</h1>
            <p className="mt-1.5 text-sm text-slate-600">Gunakan email kantor dan kata sandi yang diberikan admin.</p>

            {lastLogoutReason === 'expired' && !serverError && (
              <div className="mt-5 flex gap-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900 ring-1 ring-blue-200" role="status">
                <Icon d="M12 8v4l2.5 2.5M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z" className="h-5 w-5 shrink-0" />
                Sesi Anda telah berakhir demi keamanan. Silakan masuk kembali.
              </div>
            )}

            {serverError && (
              <div
                ref={alertRef}
                tabIndex={-1}
                role="alert"
                className="mt-5 flex gap-3 rounded-lg bg-red-50 p-3 text-sm text-red-800 outline-none ring-1 ring-red-200"
              >
                <Icon d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" className="h-5 w-5 shrink-0" />
                {serverError}
              </div>
            )}

            <form className="mt-6 space-y-5" onSubmit={onSubmit} noValidate>
              <div>
                <label htmlFor={ids.email} className="block text-sm font-medium text-slate-800">
                  Email
                </label>
                <input
                  ref={emailRef}
                  id={ids.email}
                  type="email"
                  inputMode="email"
                  autoComplete="username"
                  autoFocus
                  placeholder="nama@example.test"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? ids.emailErr : undefined}
                  className={`mt-1.5 ${inputBase} ${inputState(Boolean(errors.email))}`}
                />
                {errors.email && (
                  <p id={ids.emailErr} className="mt-1.5 text-sm text-red-700">
                    {errors.email}
                  </p>
                )}
              </div>

              <div>
                <label htmlFor={ids.password} className="block text-sm font-medium text-slate-800">
                  Kata sandi
                </label>
                <div className="relative mt-1.5">
                  <input
                    ref={passwordRef}
                    id={ids.password}
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    onKeyDown={onPasswordKey}
                    onKeyUp={onPasswordKey}
                    onBlur={() => setCapsLock(false)}
                    aria-invalid={Boolean(errors.password)}
                    aria-describedby={[errors.password ? ids.passwordErr : '', capsLock ? ids.caps : ''].join(' ').trim() || undefined}
                    className={`${inputBase} ${inputState(Boolean(errors.password))} pr-28`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-pressed={showPassword}
                    aria-controls={ids.password}
                    className="absolute inset-y-1.5 right-1.5 flex items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
                  >
                    <Icon
                      d={showPassword ? 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.1A9.8 9.8 0 0 1 12 5c5 0 9 5 9 7a11 11 0 0 1-2.4 3.3M6.6 6.6C4.3 8 3 10.3 3 12c0 2 4 7 9 7a9.6 9.6 0 0 0 4.4-1.1' : 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zm10 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6z'}
                      className="h-4 w-4"
                    />
                    {showPassword ? 'Sembunyikan' : 'Tampilkan'}
                  </button>
                </div>
                {capsLock && (
                  <p id={ids.caps} className="mt-1.5 text-sm text-amber-700">
                    Caps Lock sedang aktif.
                  </p>
                )}
                {errors.password && (
                  <p id={ids.passwordErr} className="mt-1.5 text-sm text-red-700">
                    {errors.password}
                  </p>
                )}
                {demoHint && !errors.password && (
                  <p className="mt-1.5 text-sm text-slate-600">
                    Akun demo dipilih. Kata sandi demo adalah nilai <code className="rounded bg-slate-100 px-1">DEMO_PASSWORD</code> di file <code className="rounded bg-slate-100 px-1">.env</code>.
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={submitting}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-blue-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-200 disabled:cursor-wait disabled:opacity-80"
              >
                {submitting && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden="true" />}
                {submitting ? 'Sedang masuk…' : 'Masuk'}
              </button>

              <p className="text-center text-sm text-slate-600">Lupa kata sandi? Hubungi admin organisasi Anda.</p>
            </form>
          </div>

          {SHOW_DEMO_ACCOUNTS && (
            <details className="group mt-6 rounded-2xl bg-white p-5 ring-1 ring-slate-200">
              <summary className="flex cursor-pointer list-none items-center justify-between text-sm font-medium text-slate-800">
                <span>Akun demo untuk presentasi</span>
                <span className="text-slate-500 transition group-open:rotate-180" aria-hidden="true">
                  ▾
                </span>
              </summary>
              <p className="mt-2 text-sm text-slate-600">Pilih salah satu untuk mengisi email secara otomatis.</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {DEMO_ACCOUNTS.map((a) => (
                  <li key={a.email}>
                    <button
                      type="button"
                      onClick={() => pickDemo(a.email)}
                      aria-label={`Pakai akun ${a.label} (${a.email})`}
                      className={`w-full rounded-lg border px-3 py-2.5 text-left transition hover:border-blue-400 hover:bg-blue-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 ${
                        email === a.email ? 'border-blue-500 bg-blue-50' : 'border-slate-200'
                      }`}
                    >
                      <span className="block text-sm font-medium text-slate-900">{a.label}</span>
                      <span className="block text-xs text-slate-600">{a.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </main>
    </div>
  );
}
