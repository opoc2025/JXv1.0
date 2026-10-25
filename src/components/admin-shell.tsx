'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  LayoutDashboard,
  Users,
  ClipboardList,
  SlidersHorizontal,
  Upload,
  Calculator,
  Gauge,
  Layers,
  Building2,
  ChevronLeft,
  ChevronRight,
  Trophy,
  Gift,
  Wallet,
  Banknote,
  BarChart3,
  LogOut,
  UserCog,
} from 'lucide-react';
import { useMonth } from './month-context';

const NAV = [
  { href: '/', label: '总览看板', icon: LayoutDashboard },
  { href: '/employees', label: '员工管理', icon: Users },
  { href: '/departments', label: '部门管理', icon: Building2 },
  { href: '/performance', label: '绩效考核', icon: ClipboardList },
  { href: '/rules', label: '提成方案', icon: SlidersHorizontal },
  { href: '/metrics', label: '指标库', icon: Gauge },
  { href: '/stages', label: '阶段管理', icon: Layers },
  { href: '/import', label: '数据导入', icon: Upload },
  { href: '/settlements', label: '薪酬核算', icon: Calculator },
  { href: '/reward-plans', label: '奖励方案', icon: Gift },
  { href: '/rewards', label: '奖励中心', icon: Trophy },
  { href: '/reports', label: '报表管理', icon: BarChart3 },
  { href: '/loans', label: '借款管理', icon: Wallet },
  { href: '/disbursement', label: '发放管理', icon: Banknote },
];

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { month, setMonth } = useMonth();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function handleLogout() {
    if (!confirm('确定要退出登录吗？')) return;
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      router.push('/login');
      router.refresh();
    }
  }

  return (
    <div className="flex min-h-screen bg-paper">
      {/* 侧边导航 */}
      <aside className="fixed inset-y-0 left-0 z-20 flex w-[220px] flex-col bg-ledger text-ledger-foreground">
        <div className="border-b border-white/10 px-5 py-5">
          <div className="text-[15px] font-bold tracking-wide text-white">催收薪酬核算</div>
          <div className="mt-1 text-[11px] tracking-widest text-white/45">
            PAYROLL LEDGER
          </div>
        </div>
        <nav className="flex-1 space-y-1 px-3 py-4">
          {NAV.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-md px-3 py-2.5 text-[13.5px] transition-colors ${
                  active
                    ? 'bg-white/12 font-semibold text-white'
                    : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                <Icon size={16} strokeWidth={2} />
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-white/10 px-5 py-3 text-[11px] text-white/35">
          币种：泰铢 THB (฿)
        </div>
      </aside>

      {/* 主内容 */}
      <div className="ml-[220px] flex min-h-screen flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-white/90 px-6 backdrop-blur">
          <div className="text-[13px] text-muted-foreground">
            财务/管理员后台 · 单角色操作
          </div>
          <div className="flex items-center gap-3">
            {/* 月份选择 */}
            <div className="flex items-center gap-2">
              <span className="mr-1 text-[12.5px] text-muted-foreground">薪资月份</span>
              <button
                onClick={() => setMonth(shiftMonth(month, -1))}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted"
                aria-label="上个月"
              >
                <ChevronLeft size={15} />
              </button>
              <div className="w-[92px] text-center font-mono text-[14px] font-semibold text-primary">
                {month}
              </div>
              <button
                onClick={() => setMonth(shiftMonth(month, 1))}
                className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:bg-muted"
                aria-label="下个月"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            {/* 分隔线 */}
            <div className="h-6 w-px bg-border" />

            {/* 管理员 + 登出 */}
            <div className="flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5">
              <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500">
                <UserCog size={12} className="text-white" />
              </div>
              <span className="text-[12px] font-medium text-slate-700">管理员</span>
              <button
                onClick={handleLogout}
                disabled={loggingOut}
                className="ml-1 flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-slate-500 transition-colors hover:bg-white hover:text-red-500 disabled:opacity-50"
                title="退出登录"
              >
                <LogOut size={12} />
                退出
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 px-6 py-6">{children}</main>
      </div>
    </div>
  );
}
