import React, { useState } from 'react';
import { Lock, Mail, User as UserIcon, ArrowRight, AlertCircle } from 'lucide-react';
import {
  loginWithEmail,
  loginWithGoogle,
  registerWithEmail,
  resetPassword,
  syncFirebaseUserProfile,
} from '../services/firebase.ts';
import { audioEngine } from '../services/audio.ts';
import type { UserProfile } from '../game/types.ts';

interface AuthScreenProps {
  onAuthenticated: (token: string, profile: UserProfile, isFirebase: boolean) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthenticated }) => {
  const [mode, setMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');
  const [guestName, setGuestName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const handleGoogle = async () => {
    audioEngine.playClick();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const user = await loginWithGoogle();
      const token = await user.getIdToken();
      const profile = await syncFirebaseUserProfile(user);
      onAuthenticated(token, profile, true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Google sign-in failed.';
      setError(msg.includes('popup-closed') ? 'Sign-in window was closed.' : msg);
    } finally {
      setLoading(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    audioEngine.playClick();
    setError(null);
    setInfo(null);

    if (!email.trim()) {
      setError('Please enter your email address.');
      return;
    }

    setLoading(true);
    try {
      if (mode === 'forgot') {
        await resetPassword(email.trim());
        setInfo('Password reset link sent to your email.');
        setMode('login');
      } else if (mode === 'register') {
        if (password.length < 6) {
          setError('Password must be at least 6 characters.');
          setLoading(false);
          return;
        }
        const user = await registerWithEmail(email.trim(), password);
        const token = await user.getIdToken();
        const profile = await syncFirebaseUserProfile(user, username.trim() || undefined);
        onAuthenticated(token, profile, true);
      } else {
        const user = await loginWithEmail(email.trim(), password);
        const token = await user.getIdToken();
        const profile = await syncFirebaseUserProfile(user);
        onAuthenticated(token, profile, true);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Authentication failed.';
      if (msg.includes('operation-not-allowed') || msg.includes('admin-restricted-operation')) {
        setError(
          'Email/Password sign-in is not enabled yet in Firebase Console (Authentication -> Sign-in method -> Email/Password). You can use Google Sign-In or Guest Login right now.',
        );
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleGuest = async () => {
    audioEngine.playClick();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/guest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: guestName.trim() || undefined }),
      });
      if (!res.ok) throw new Error('Could not create guest session.');
      const data = (await res.json()) as { token: string; profile: UserProfile };
      onAuthenticated(data.token, data.profile, false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Guest login failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#07150f] text-slate-100 relative flex items-center justify-center p-4 sm:p-8 overflow-y-auto">
      <div
        className="fixed inset-0 bg-cover bg-center opacity-50"
        style={{ backgroundImage: 'url(/src/assets/images/club_lounge_bg_1795666735542.jpg)' }}
      />
      <div className="fixed inset-0 bg-gradient-to-r from-[#06130d]/95 via-[#07150f]/80 to-[#07150f]/60" />

      <div className="relative z-10 w-full max-w-5xl grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
        {/* Left: Brand Identity */}
        <div className="lg:col-span-6 space-y-5 text-left">
          <div className="inline-flex items-center gap-3">
            <svg viewBox="0 0 64 64" className="w-12 h-12 shrink-0" aria-hidden="true">
              <circle cx="32" cy="32" r="29" fill="#064e3b" stroke="#d4af37" strokeWidth="2.5" />
              <circle cx="32" cy="32" r="20" fill="#09090b" />
              <circle cx="32" cy="32" r="8.5" fill="#f8fafc" />
              <text x="32" y="35.5" textAnchor="middle" fill="#09090b" fontSize="11" fontWeight="800">
                8
              </text>
            </svg>
            <div>
              <h1 className="font-display text-3xl sm:text-4xl font-extrabold text-amber-300 tracking-wide">
                POOL MASTER ONLINE
              </h1>
              <p className="text-xs sm:text-sm text-emerald-200/80">
                Luxury 8-Ball & 9-Ball Multiplayer Club
              </p>
            </div>
          </div>

          <p className="text-slate-300 text-sm sm:text-base max-w-md leading-relaxed">
            Step onto championship custom cloth. Play live 8-Ball or 9-Ball with anyone via room
            link, or challenge our Pro Computer AI with customizable precision cues.
          </p>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-amber-200/80">
            <span>Mabar Link Rooms</span>
            <span aria-hidden="true">·</span>
            <span>8-Ball & 9-Ball</span>
            <span aria-hidden="true">·</span>
            <span>Pro Computer AI</span>
          </div>
        </div>

        {/* Right: Sign-In & Guest Access Card */}
        <div className="lg:col-span-6 glass-panel rounded-3xl p-6 sm:p-7 space-y-5">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <h2 className="font-display text-xl font-bold text-slate-100">
              {mode === 'login' ? 'Member Sign In' : mode === 'register' ? 'Create Club Account' : 'Reset Password'}
            </h2>
            <div className="flex items-center gap-1 neu-inset p-1 rounded-xl">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                  mode === 'login' ? 'bg-emerald-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Login
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                  mode === 'register' ? 'bg-emerald-700 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                Register
              </button>
            </div>
          </div>

          {error && (
            <div className="flex items-start gap-2.5 p-3 rounded-lg bg-red-950/70 border border-red-500/40 text-xs text-red-200">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
              <span>{error}</span>
            </div>
          )}

          {info && (
            <div className="p-3 rounded-lg bg-emerald-950/70 border border-emerald-500/40 text-xs text-emerald-200">
              {info}
            </div>
          )}

          {/* Primary Google Sign-In */}
          <button
            type="button"
            disabled={loading}
            onClick={handleGoogle}
            data-testid="google-login-btn"
            className="w-full py-2.5 px-4 rounded-xl bg-white text-slate-900 font-semibold text-sm flex items-center justify-center gap-2.5 hover:bg-slate-100 transition-colors disabled:opacity-60"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z"
              />
              <path
                fill="#34A853"
                d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z"
              />
              <path
                fill="#FBBC05"
                d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z"
              />
              <path
                fill="#EA4335"
                d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z"
              />
            </svg>
            <span>Continue with Google</span>
          </button>

          <div className="flex items-center gap-3 text-xs text-slate-400">
            <div className="flex-1 h-px bg-white/10" />
            <span>or email</span>
            <div className="flex-1 h-px bg-white/10" />
          </div>

          {/* Email Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-3">
            {mode === 'register' && (
              <div>
                <label htmlFor="auth-username" className="block text-xs font-medium text-slate-300 mb-1">
                  Username
                </label>
                <div className="relative">
                  <UserIcon className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-username"
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Cueist_Pro"
                    maxLength={24}
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#07150f] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>
            )}

            <div>
              <label htmlFor="auth-email" className="block text-xs font-medium text-slate-300 mb-1">
                Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  id="auth-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="player@club.com"
                  className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#07150f] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                />
              </div>
            </div>

            {mode !== 'forgot' && (
              <div>
                <label htmlFor="auth-password" className="block text-xs font-medium text-slate-300 mb-1">
                  Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    id="auth-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full pl-9 pr-3 py-2 rounded-lg bg-[#07150f] border border-white/15 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
                  />
                </div>
              </div>
            )}

            <div className="flex items-center justify-between text-xs">
              {mode === 'login' ? (
                <button
                  type="button"
                  onClick={() => {
                    setMode('forgot');
                    setError(null);
                  }}
                  className="text-amber-300 hover:underline"
                >
                  Forgot Password?
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className="text-amber-300 hover:underline"
                >
                  Back to Login
                </button>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 rounded-xl neu-btn-emerald font-semibold text-sm disabled:opacity-60"
            >
              {mode === 'login' ? 'Sign In' : mode === 'register' ? 'Create Account' : 'Send Reset Link'}
            </button>
          </form>

          {/* Instant Guest Access */}
          <div className="pt-3 border-t border-white/10 space-y-2.5">
            <div className="flex items-center gap-2">
              <input
                type="text"
                aria-label="Guest nickname"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                placeholder="Optional guest nickname"
                maxLength={20}
                className="flex-1 px-3 py-2 rounded-xl neu-inset text-xs text-white placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
              />
              <button
                type="button"
                disabled={loading}
                onClick={handleGuest}
                data-testid="guest-login-btn"
                data-start="true"
                className="px-4 py-2 rounded-xl neu-btn-gold font-bold text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0"
              >
                <span>Guest Login</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
