import { useState } from 'react';
import { ApiError, api } from '../api';
import { Button, Field, inputClass } from '../components/ui';

export function Login({ onSignedIn }: { onSignedIn: (expiresAt: number) => void }) {
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        className="w-full max-w-sm space-y-4 rounded-lg border border-rule bg-surface p-6 shadow-sm"
        onSubmit={(e) => {
          e.preventDefault();
          if (!key) return;
          setBusy(true);
          setError(null);
          api
            .login(key)
            .then((s) => {
              setKey(''); // the key is not kept anywhere after login
              onSignedIn(s.expiresAt);
            })
            .catch((err: unknown) =>
              setError(err instanceof ApiError ? err.message : 'Sign-in failed.'),
            )
            .finally(() => setBusy(false));
        }}
      >
        <div>
          <h1 className="text-lg font-semibold">License Admin</h1>
          <p className="text-sm text-muted">IndiaMART Smart Lead Intelligence</p>
        </div>
        <Field label="Admin key">
          {(id) => (
            <input
              id={id}
              type="password"
              autoComplete="current-password"
              value={key}
              onChange={(e) => setKey(e.currentTarget.value)}
              className={inputClass}
            />
          )}
        </Field>
        {error && (
          <p role="alert" className="text-sm text-bad">
            {error}
          </p>
        )}
        <Button kind="primary" type="submit" disabled={busy || !key}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </main>
  );
}
