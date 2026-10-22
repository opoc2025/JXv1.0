import type { Metadata } from 'next';
import './globals.css';
import { MonthProvider } from '@/components/month-context';
import { AdminShell } from '@/components/admin-shell';
import { Toaster } from '@/components/ui/sonner';

export const metadata: Metadata = {
  title: '金融催收员工工资计算系统',
  description: '面向金融催收团队的内部薪酬核算管理系统',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body suppressHydrationWarning>
        <MonthProvider>
          <AdminShell>{children}</AdminShell>
        </MonthProvider>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
