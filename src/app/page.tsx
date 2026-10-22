'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Users, Wallet, BadgeCheck, Banknote, ArrowRight } from 'lucide-react';
import { useMonth } from '@/components/month-context';
import { formatTHB } from '@/lib/format';
import { Card, CardContent } from '@/components/ui/card';

interface Overview {
  month: string;
  active_employees: number;
  settled_employees: number;
  finalized_employees: number;
  total_salary: number;
  total_recovered: number;
}

export default function DashboardPage() {
  const { month } = useMonth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch(`/api/overview?month=${month}`, { cache: 'no-store' });
    const json = await res.json();
    if (json.success) setData(json.data as Overview);
    setLoading(false);
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const cards = [
    {
      label: '在职员工',
      value: data?.active_employees ?? 0,
      unit: '人',
      icon: Users,
    },
    {
      label: `${month} 月度总回款`,
      value: formatTHB(data?.total_recovered ?? 0),
      unit: '฿',
      icon: Wallet,
    },
    {
      label: '已核算 / 已终审',
      value: `${data?.settled_employees ?? 0} / ${data?.finalized_employees ?? 0}`,
      unit: '人',
      icon: BadgeCheck,
    },
    {
      label: '当月应发工资总额',
      value: formatTHB(data?.total_salary ?? 0),
      unit: '฿',
      icon: Banknote,
      highlight: true,
    },
  ];

  const steps = [
    { href: '/employees', title: '维护员工档案', desc: '工号、姓名、所属部门、默认阶段与提成方案（A/B）' },
    { href: '/rules', title: '配置薪酬规则', desc: '底薪、月度绩效门槛、日阶梯、月度总额与多阶段阶梯' },
    { href: '/import', title: '导入业务数据', desc: '下载模板 → 填写 → 上传每日明细与月度考核数据' },
    { href: '/settlements', title: '核算与导出', desc: '一键计算全员薪资，复核明细，终审后导出泰铢报表' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground">总览看板</h1>
        <p className="mt-1 text-[13px] text-muted-foreground">
          {month} 薪酬周期 · 数据来源于 Excel 导入，币种为泰铢
        </p>
      </div>

      <div className="grid grid-cols-4 gap-4">
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <Card key={c.label} className="border-border shadow-none">
              <CardContent className="p-5">
                <div className="flex items-center justify-between">
                  <span className="text-[12.5px] text-muted-foreground">{c.label}</span>
                  <Icon
                    size={17}
                    className={c.highlight ? 'text-primary' : 'text-gold'}
                  />
                </div>
                <div className="mt-3 flex items-baseline gap-1.5">
                  <span
                    className={`font-mono text-[24px] font-bold tabular-nums ${
                      c.highlight ? 'text-primary' : 'text-foreground'
                    }`}
                  >
                    {loading ? '...' : c.value}
                  </span>
                  <span className="text-[12px] text-muted-foreground">{c.unit}</span>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-border shadow-none">
        <CardContent className="p-6">
          <h2 className="text-[15px] font-semibold">月度核算流程</h2>
          <div className="mt-5 grid grid-cols-4 gap-4">
            {steps.map((s, i) => (
              <Link
                key={s.href}
                href={s.href}
                className="group relative rounded-md border border-border bg-paper-soft p-4 transition-colors hover:border-gold/50 hover:bg-gold-soft"
              >
                <div className="flex items-center justify-between">
                  <span className="flex h-6 w-6 items-center justify-center rounded bg-primary text-[12px] font-semibold text-white">
                    {i + 1}
                  </span>
                  <ArrowRight
                    size={15}
                    className="text-muted-foreground transition-colors group-hover:text-gold"
                  />
                </div>
                <div className="mt-3 text-[13.5px] font-semibold">{s.title}</div>
                <div className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {s.desc}
                </div>
              </Link>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
