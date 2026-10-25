'use client';

import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Lock, ArrowRight, AlertCircle, Building2 } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get('redirect') || '/';

  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!password.trim()) {
      setError('请输入密码');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error || '密码错误');
        setLoading(false);
        return;
      }

      router.push(redirect);
      router.refresh();
    } catch {
      setError('网络错误，请重试');
      setLoading(false);
    }
  }

  const [noPasswordSet, setNoPasswordSet] = useState(false);
  useEffect(() => {
    fetch('/api/auth/login', { method: 'POST', body: JSON.stringify({ password: '__check__' }) })
      .then((r) => r.json())
      .then((d) => {
        if (d.error?.includes('ADMIN_PASSWORD')) {
          setNoPasswordSet(true);
        }
      })
      .catch(() => {});
  }, []);

  if (noPasswordSet) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
        <div className="w-full max-w-md rounded-2xl border border-amber-200 bg-white p-8 shadow-lg">
          <div className="mb-6 flex items-center justify-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-50">
              <AlertCircle size={28} className="text-amber-600" />
            </div>
          </div>
          <h1 className="mb-2 text-center text-xl font-semibold text-slate-800">需要配置管理员密码</h1>
          <p className="mb-4 text-center text-sm text-slate-500">
            请在项目根目录的 <code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">.env</code> 文件中添加：
          </p>
          <pre className="rounded-lg bg-slate-900 p-4 text-sm text-green-400">
            ADMIN_PASSWORD=你的密码
          </pre>
          <p className="mt-4 text-center text-xs text-slate-400">
            保存后重启服务即可访问
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-8 flex flex-col items-center">
          <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-lg shadow-indigo-500/20">
            <Building2 size={28} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-800">催收薪酬核算系统</h1>
          <p className="mt-1 text-sm text-slate-400">PAYROLL LEDGER · 管理后台</p>
        </div>

        <form onSubmit={handleSubmit}>
          <label className="mb-1.5 block text-sm font-medium text-slate-600">管理员密码</label>
          <div className="relative mb-2">
            <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="password"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                setError('');
              }}
              placeholder="请输入密码"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-[15px] text-slate-800 outline-none transition-colors focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
              autoFocus
            />
          </div>

          {error && (
            <div className="mb-3 flex items-center gap-1.5 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">
              <AlertCircle size={14} />
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-indigo-500 to-indigo-600 py-3 text-[15px] font-medium text-white shadow-lg shadow-indigo-500/20 transition-all hover:from-indigo-600 hover:to-indigo-700 hover:shadow-indigo-500/30 active:scale-[0.98] disabled:opacity-60 disabled:active:scale-100"
          >
            {loading ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                登录中...
              </>
            ) : (
              <>
                进入系统
                <ArrowRight size={16} />
              </>
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          财务 / 管理员统一操作 · 单角色登录
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-indigo-500" />
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
