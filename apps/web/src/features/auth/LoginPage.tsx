import { useEffect, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DutyDeskLogo } from '@/components/brand/DutyDeskLogo';
import { useAuthStore } from '@/stores/auth-store';
import { useThemeStore } from '@/stores/theme-store';

export function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const login = useAuthStore((s) => s.login);
  const error = useAuthStore((s) => s.error);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    await login(username, password);
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-2" style={{ background: 'var(--bg)' }}>
      <div
        className="relative hidden flex-col justify-between p-12 text-white lg:flex"
        style={{ background: 'linear-gradient(145deg, #0d1420 0%, #1b4f8a 55%, #0d1420 100%)' }}
      >
        <div>
          <DutyDeskLogo variant="login" />
          <p className="mt-6 max-w-md text-lg text-white/70">
            Trinidad &amp; Tobago customs classification with {6101}+ official tariff entries, AI-assisted
            invoice parsing, and team-learned codes.
          </p>
        </div>
        <p className="text-sm text-white/35">T&amp;T Customs Act Chap. 78:01 · Authorised personnel only</p>
      </div>

      <div className="flex flex-col items-center justify-center p-6">
        <DutyDeskLogo variant="login-mobile" className="mb-6 lg:hidden" />
        <form onSubmit={submit} className="dd-card w-full max-w-md p-8">
          <div className="mb-1 text-xl font-semibold" style={{ color: 'var(--text)' }}>
            Sign in to DutyDesk
          </div>
          <p className="mb-6 text-sm" style={{ color: 'var(--text2)' }}>
            Customs tariff classification for Trinidad &amp; Tobago
          </p>

          {error && <div className="dd-notif-error mb-4">{error}</div>}

          <div className="mb-4">
            <label className="dd-label" htmlFor="username">
              Username
            </label>
            <input id="username" className="dd-input" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </div>

          <div className="mb-6">
            <label className="dd-label" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <input
                id="password"
                className="dd-input pr-10"
                type={show ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
              <button
                type="button"
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 border-none bg-transparent p-1"
                style={{ color: 'var(--text2)' }}
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>

          <Button type="submit" className="w-full" style={{ background: 'var(--accent)', color: '#fff' }}>
            Sign In →
          </Button>
        </form>
      </div>
    </div>
  );
}
