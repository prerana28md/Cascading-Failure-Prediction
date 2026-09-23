import React, { useState } from 'react';
import { X, User, Lock, ShieldCheck, UserPlus, LogIn, Sparkles, AlertCircle } from 'lucide-react';
import { api } from '../services/api';

export default function AuthModal({
  isOpen,
  onClose,
  onLoginSuccess
}) {
  const [tab, setTab] = useState('LOGIN'); // 'LOGIN' | 'REGISTER'
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('CUSTOMER');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      let res;
      if (tab === 'LOGIN') {
        res = await api.login(username, password);
      } else {
        res = await api.register(username, password, role === 'ADMIN' ? 'ADMIN' : 'USER');
      }

      setLoading(false);
      if (res.error) {
        setError(res.error);
      } else {
        const user = api.getCurrentUser() || { username, role };
        if (onLoginSuccess) onLoginSuccess(user);
        onClose();
      }
    } catch (err) {
      setLoading(false);
      setError(err.message || 'Authentication error');
    }
  };

  const handleDemoLogin = async (selectedRole) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.demoLogin(selectedRole);
      setLoading(false);
      const user = api.getCurrentUser() || res.data || { username: selectedRole.toLowerCase(), role: selectedRole };
      if (onLoginSuccess) onLoginSuccess(user);
      onClose();
    } catch (err) {
      setLoading(false);
      setError(err.message || 'Demo login failed');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl bg-slate-900 border border-slate-800 shadow-2xl overflow-hidden">
        
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-900/90">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-400">
              {tab === 'LOGIN' ? <LogIn className="w-5 h-5" /> : <UserPlus className="w-5 h-5" />}
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {tab === 'LOGIN' ? 'Sign In to OmniStore' : 'Create Customer Account'}
              </h2>
              <p className="text-xs text-slate-400">Real JWT Auth via Order Service (:8081)</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Toggle */}
        <div className="grid grid-cols-2 p-1.5 m-6 mb-2 bg-slate-950 rounded-xl border border-slate-800 text-xs font-semibold">
          <button
            onClick={() => { setTab('LOGIN'); setError(null); }}
            className={`py-2 rounded-lg transition ${
              tab === 'LOGIN'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Sign In
          </button>
          <button
            onClick={() => { setTab('REGISTER'); setError(null); }}
            className={`py-2 rounded-lg transition ${
              tab === 'REGISTER'
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Register
          </button>
        </div>

        {/* Error Alert */}
        {error && (
          <div className="mx-6 p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center space-x-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0 text-rose-400" />
            <span>{error}</span>
          </div>
        )}

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 pt-2 space-y-4 font-sans">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center">
              <User className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
              Username
            </label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. alice"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1 flex items-center">
              <Lock className="w-3.5 h-3.5 mr-1.5 text-indigo-400" />
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {tab === 'REGISTER' && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Account Role
              </label>
              <select
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-indigo-500"
              >
                <option value="CUSTOMER">Customer (Standard Shopping)</option>
                <option value="ADMIN">System Administrator (Full Microservices Access)</option>
              </select>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-indigo-600/30 transition flex items-center justify-center space-x-2"
          >
            <span>{loading ? 'Authenticating…' : tab === 'LOGIN' ? 'Sign In' : 'Create Account'}</span>
          </button>
        </form>

        {/* Quick Demo Instant Login Section */}
        <div className="p-6 pt-2 border-t border-slate-800/80 bg-slate-950/60 space-y-2.5">
          <div className="flex items-center space-x-1.5 text-[11px] font-semibold text-slate-400">
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Quick 1-Click Demo Login</span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleDemoLogin('CUSTOMER')}
              disabled={loading}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-emerald-500/50 text-slate-300 hover:text-emerald-300 text-xs font-medium transition text-left"
            >
              <span className="block font-bold text-emerald-400">Demo Customer</span>
              <span className="text-[10px] text-slate-500">alice &bull; Shopping Mode</span>
            </button>

            <button
              type="button"
              onClick={() => handleDemoLogin('ADMIN')}
              disabled={loading}
              className="px-3 py-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-indigo-500/50 text-slate-300 hover:text-indigo-300 text-xs font-medium transition text-left"
            >
              <span className="block font-bold text-indigo-400">Demo Admin</span>
              <span className="text-[10px] text-slate-500">admin &bull; Full Console</span>
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}
