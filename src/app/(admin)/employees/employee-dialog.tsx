'use client';

import { useEffect, useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { Employee, StageConfig, DepartmentConfig, SalaryRule, CommissionPlan, StageGroup } from '@/lib/types';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  employee: Employee | null;
  onSaved: () => void;
}

type PlanOption = {
  value: CommissionPlan;
  label: string;
  ruleNames: string[]; // 引擎按该部门+类型实际匹配到的规则名
  configured: boolean; // 是否有配置
};

export function EmployeeDialog({ open, onOpenChange, employee, onSaved }: Props) {
  const [employeeId, setEmployeeId] = useState('');
  const [employeeName, setEmployeeName] = useState('');
  const [department, setDepartment] = useState('');
  const [defaultStage, setDefaultStage] = useState('');
  const [commissionPlan, setCommissionPlan] = useState<'A' | 'B' | 'NONE'>('A');
  const [hasDailyCommission, setHasDailyCommission] = useState(true);
  const [mergeGroupIds, setMergeGroupIds] = useState<number[]>([]); // 多合并组（新）
  const [stageGroups, setStageGroups] = useState<StageGroup[]>([]);
  const [status, setStatus] = useState<'active' | 'resigned'>('active');
  const [selectedStages, setSelectedStages] = useState<string[]>([]);
  const [stages, setStages] = useState<StageConfig[]>([]);
  const [departments, setDepartments] = useState<DepartmentConfig[]>([]);
  const [rules, setRules] = useState<SalaryRule[]>([]);
  const [saving, setSaving] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState('');
  const qrFileRef = useRef<HTMLInputElement>(null);

  // 首次打开时加载阶段 + 部门 + 提成规则
  useEffect(() => {
    if (open) {
      fetch('/api/stages?enabled=true', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => setStages((j.data as StageConfig[]) ?? []))
        .catch(() => {});
      fetch('/api/departments?enabled=true', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => setDepartments((j.data as DepartmentConfig[]) ?? []))
        .catch(() => {});
      fetch('/api/rules', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => setRules((j.data as SalaryRule[]) ?? []))
        .catch(() => {});
      fetch('/api/stage-groups', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => setStageGroups((j.data as StageGroup[]) ?? []))
        .catch(() => {});
    }
  }, [open]);

  // 根据部门 + 参与阶段，从规则列表中找出引擎实际会匹配的规则
  // 引擎优先级：部门精确+阶段精确 > 部门精确+ALL > 无部门+阶段精确 > 无部门+ALL
  const matchRules = (
    type: string,
    deptName: string,
    stageName: string
  ): SalaryRule | null => {
    const candidates = rules.filter((r) => r.rule_type === type && r.enabled !== false);
    const find = (d: string | null, s: string) =>
      candidates.find((r) => (r.dept_name ?? null) === d && r.stage_name === s);
    return (
      find(deptName || null, stageName) ||
      find(deptName || null, 'ALL') ||
      find(null, stageName) ||
      find(null, 'ALL') ||
      null
    );
  };

  // 模拟引擎 VirtualStage 构建：
  // 1) 有 mergeGroupIds → 合并组名当作虚拟阶段
  // 2) 同时 selectedStages 中不在任何合并组里的 → 独立阶段
  const mergedStageNames = new Set<string>();
  const activeGroups = mergeGroupIds.length > 0
    ? stageGroups.filter((g) => mergeGroupIds.includes(g.group_id))
    : [];
  activeGroups.forEach((g) => g.stage_names.forEach((s) => mergedStageNames.add(s)));

  const virtualStageLabels: string[] = [
    ...activeGroups.map((g) => g.group_name), // 合并组 → 用组名匹配规则
    ...selectedStages.filter((s) => !mergedStageNames.has(s)), // 不在任何合并组里的独立阶段
  ];

  // 月度总回款提点 匹配的规则（MONTHLY_TOTAL_TIER，stage 固定 ALL）
  const monthlyRule = matchRules('MONTHLY_TOTAL_TIER', department, 'ALL');
  // 月度超额累进（独立并行，不受 commission_plan 控制）
  // 引擎逻辑：先 ALL 整月规则，再 VirtualStages 各匹配精确阶段规则
  const progressiveAllRule = matchRules('MONTHLY_PROGRESSIVE_TIER', department, 'ALL');
  const progressiveStageRules = virtualStageLabels
    .map((s) => matchRules('MONTHLY_PROGRESSIVE_TIER', department, s))
    .filter((r): r is SalaryRule => Boolean(r));
  const progressiveRules = [progressiveAllRule, ...progressiveStageRules].filter(
    (r): r is SalaryRule => Boolean(r)
  );
  const progressiveRuleNames = [...new Set(progressiveRules.map((r) => r.rule_name))];
  // 分阶段金额提点：虚拟阶段（合并组名 + 独立阶段）各匹配各的
  const stageTierRules = virtualStageLabels
    .map((s) => matchRules('STAGE_AMOUNT_TIER', department, s))
    .filter((r): r is SalaryRule => Boolean(r));
  // 日提成规则：同上
  const dailyRules = virtualStageLabels
    .map((s) => matchRules('DAILY_STEP', department, s))
    .filter((r): r is SalaryRule => Boolean(r));

  const planOptions: PlanOption[] = [
    {
      value: 'A',
      label: '月度总回款提点',
      ruleNames: monthlyRule ? [monthlyRule.rule_name] : [],
      configured: Boolean(monthlyRule),
    },
    {
      value: 'B',
      label: '分阶段金额提点',
      ruleNames: stageTierRules.map((r) => r.rule_name),
      configured: stageTierRules.length > 0,
    },
    {
      value: 'NONE',
      label: '无（仅日提成）',
      ruleNames: [],
      configured: true,
    },
  ];

  useEffect(() => {
    if (open && employee) {
      setEmployeeId(employee.employee_id);
      setEmployeeName(employee.employee_name);
      setDepartment(employee.department ?? '');
      setDefaultStage(employee.default_stage);
      setCommissionPlan(employee.commission_plan);
      setHasDailyCommission(employee.has_daily_commission !== false);
      // 优先 merge_group_ids（新），fallback stage_group_id（旧，向后兼容）
      const newIds = (employee as any).employee_stage_group?.map((r: any) => r.group_id);
      if (Array.isArray(newIds) && newIds.length > 0) {
        setMergeGroupIds(newIds);
      } else if ((employee as any).stage_group_id) {
        setMergeGroupIds([(employee as any).stage_group_id]);
      } else {
        setMergeGroupIds([]);
      }
      setStatus(employee.status);
      setQrCodeUrl((employee as any).salary_qr_code_url ?? '');
      const empStages = employee.stages?.map((s) => s.stage_name) ?? [];
      setSelectedStages(
        empStages.length > 0 ? empStages : [employee.default_stage]
      );
    } else if (open) {
      setEmployeeId('');
      setEmployeeName('');
      setDepartment('');
      setDefaultStage('');
      setCommissionPlan('A');
      setHasDailyCommission(true);
      setMergeGroupIds([]);
      setStatus('active');
      setSelectedStages([]);
      setQrCodeUrl('');
    }
  }, [open, employee]);

  // 主阶段必须包含在参与阶段内
  useEffect(() => {
    if (defaultStage && !selectedStages.includes(defaultStage)) {
      setSelectedStages((prev) => [...prev, defaultStage]);
    }
  }, [defaultStage]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleStage = (code: string, checked: boolean) => {
    setSelectedStages((prev) => {
      if (checked) return [...new Set([...prev, code])];
      if (code === defaultStage) return prev;
      return prev.filter((c) => c !== code);
    });
  };

  // QR 上传：本地图片 → base64 DataURL（直接存 DB 无需 Storage）
  const handleQrUpload = (file: File) => {
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      const result = e.target?.result as string;
      if (result && result.length < 2_000_000) {
        setQrCodeUrl(result);
      } else {
        alert('图片太大（>2MB），请用更小的图片或用在线链接');
      }
    };
    reader.readAsDataURL(file);
  };

  const save = async () => {
    if (!employeeId.trim() || !employeeName.trim() || !defaultStage) {
      return;
    }
    setSaving(true);

    const payload = {
      employee_id: employeeId.trim(),
      employee_name: employeeName.trim(),
      department: department.trim() || null,
      default_stage: defaultStage,
      commission_plan: commissionPlan,
      has_daily_commission: hasDailyCommission,
      merge_group_ids: mergeGroupIds,
      status,
      stages: selectedStages,
      salary_qr_code_url: qrCodeUrl.trim() || null,
    };
    const url = employee ? `/api/employees/${employee.employee_id}` : '/api/employees';
    const method = employee ? 'PUT' : 'POST';
    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    setSaving(false);
    if (json.success) {
      onSaved();
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[580px]">
        <DialogHeader>
          <DialogTitle>{employee ? '编辑员工' : '新增员工'}</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4 py-2">
          <div className="space-y-1.5">
            <Label>工号</Label>
            <Input
              value={employeeId}
              onChange={(e) => setEmployeeId(e.target.value)}
              disabled={Boolean(employee)}
              placeholder="E001"
            />
          </div>
          <div className="space-y-1.5">
            <Label>姓名</Label>
            <Input
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>所属部门</Label>
            {departments.length > 0 ? (
              <Select value={department} onValueChange={setDepartment}>
                <SelectTrigger>
                  <SelectValue placeholder="选择部门" />
                </SelectTrigger>
                <SelectContent>
                  {departments.map((d) => (
                    <SelectItem key={d.dept_name} value={d.dept_name}>
                      {d.dept_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="请先在部门管理创建"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>主阶段</Label>
            <Select value={defaultStage} onValueChange={setDefaultStage}>
              <SelectTrigger>
                <SelectValue placeholder="选择主阶段" />
              </SelectTrigger>
              <SelectContent>
                {stages.map((s) => (
                  <SelectItem key={s.stage_name} value={s.stage_name}>
                    {s.stage_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>月度提成方式</Label>
            <Select
              value={commissionPlan}
              onValueChange={(v) => setCommissionPlan(v as 'A' | 'B' | 'NONE')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {planOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                    {opt.configured ? (
                      <span className="ml-1 text-xs text-muted-foreground">
                        · {opt.ruleNames.join(' / ')}
                      </span>
                    ) : (
                      <span className="ml-1 text-xs text-destructive/70">
                        · 未配置
                      </span>
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* 日提成开关 */}
          <div className="rounded-md border border-border bg-background/60 px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label htmlFor="daily-switch" className="text-[13.5px] font-medium">
                  参与日提成（日达成阶梯）
                </Label>
                <p className="text-[11.5px] text-muted-foreground">
                  开启后，系统会自动匹配 <strong>日达成阶梯规则</strong>（DAILY_STEP），
                  按每日运营数据计算日提成，与月度提成<strong>独立并行</strong>。
                </p>
              </div>
              <Switch
                id="daily-switch"
                checked={hasDailyCommission}
                onCheckedChange={setHasDailyCommission}
              />
            </div>
          </div>

          {/* 阶段合并组（多选） */}
          <div className="rounded-md border border-border bg-background/60 px-3 py-2.5">
            <div className="space-y-2">
              <Label className="text-[13.5px] font-medium">
                阶段合并组（可多选）
              </Label>
              <p className="text-[11.5px] text-muted-foreground">
                勾选后，该合并组内的阶段 日提成/月B 按总额合并匹配一条规则。未在任何组内的阶段继续独立计算。
              </p>
              {stageGroups.length === 0 ? (
                <p className="text-[12px] text-muted-foreground italic">
                  暂无合并组，请在「阶段管理 → 合并组」中先创建
                </p>
              ) : (
                <div className="flex flex-wrap gap-3 rounded-md border border-border bg-muted/20 p-3 max-h-[180px] overflow-y-auto">
                  {stageGroups.map((g) => {
                    const checked = mergeGroupIds.includes(g.group_id);
                    return (
                      <label key={g.group_id} className="flex items-center gap-1.5 cursor-pointer text-[12.5px] select-none">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setMergeGroupIds([...mergeGroupIds, g.group_id]);
                            } else {
                              setMergeGroupIds(mergeGroupIds.filter((id) => id !== g.group_id));
                            }
                          }}
                        />
                        {g.group_name}
                        <span className="text-muted-foreground text-[11px]">
                          ({g.stage_names.join('+')})
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>状态</Label>
            <Select
              value={status}
              onValueChange={(v) => setStatus(v as 'active' | 'resigned')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">在职</SelectItem>
                <SelectItem value="resigned">离职</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* 参与阶段 */}
        <div className="space-y-1.5 rounded-md border border-border bg-[#faf8f3] p-3">
          <Label className="text-[13px]">
            参与阶段（可多选 · 日提成 + 分阶段金额提点按此核算）
          </Label>
          <div className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
            {stages.length > 0 ? (
              stages.map((s) => {
                const checked = selectedStages.includes(s.stage_name);
                return (
                  <label
                    key={s.stage_name}
                    className="flex cursor-pointer items-center gap-1.5 text-[13px]"
                  >
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => toggleStage(s.stage_name, Boolean(v))}
                    />
                    {s.stage_name}
                    {s.stage_name === defaultStage && (
                      <span className="text-[11px] text-gold">主</span>
                    )}
                  </label>
                );
              })
            ) : (
              <span className="text-[12.5px] text-muted-foreground">
                暂无可选阶段，请先在「阶段管理」中创建
              </span>
            )}
          </div>
        </div>

        {/* 工资收款二维码 */}
        <div className="rounded-md border border-border bg-background/60 p-3 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-[13px] font-medium">工资收款二维码</Label>
            {qrCodeUrl && (
              <button
                type="button"
                onClick={() => setQrCodeUrl('')}
                className="text-[11px] text-muted-foreground hover:text-destructive"
              >
                清除
              </button>
            )}
          </div>
          <div className="flex gap-3 items-start">
            {qrCodeUrl ? (
              <div className="relative w-24 h-24 rounded border border-border overflow-hidden bg-white shrink-0">
                <img src={qrCodeUrl} alt="QR" className="w-full h-full object-contain" />
              </div>
            ) : (
              <div className="w-24 h-24 rounded border border-dashed border-border bg-muted/30 shrink-0 flex items-center justify-center">
                <span className="text-[10px] text-muted-foreground text-center">暂无二维码</span>
              </div>
            )}
            <div className="flex-1 space-y-2">
              <div className="flex gap-2">
                <input
                  ref={qrFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) handleQrUpload(f);
                    if (qrFileRef.current) qrFileRef.current.value = '';
                  }}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => qrFileRef.current?.click()}
                >
                  📷 上传图片
                </Button>
              </div>
              <Input
                value={qrCodeUrl.startsWith('data:') ? '' : qrCodeUrl}
                onChange={(e) => setQrCodeUrl(e.target.value)}
                placeholder="或粘贴图片 URL（https://...）"
                className="h-8 text-[12px]"
              />
            </div>
          </div>
        </div>

        {/* 提成方案实时预览 */}
        {department && (
          <div className="rounded-md border border-border bg-[#f0ecdf] p-2.5 text-[12px]">
            <div className="mb-1.5 font-medium text-foreground">
              当前配置将匹配以下提成规则
              <span className="ml-1 text-[11px] text-muted-foreground">
                （来自 [提成方案] 模块）
              </span>
            </div>
            <ul className="space-y-0.5 pl-4 list-disc marker:text-gold/60">
              <li>
                日提成（总是并行）：
                {dailyRules.length > 0 ? (
                  <span className="font-medium text-foreground">
                    {dailyRules.map((r) => r.rule_name).join('、')}
                  </span>
                ) : (
                  <span className="text-destructive/70">未配置</span>
                )}
              </li>
              <li>
                月度超额累进提成（独立并行）：
                {progressiveRuleNames.length > 0 ? (
                  <span className="font-medium text-foreground">
                    {progressiveRuleNames.join('、')}
                  </span>
                ) : (
                  <span className="text-destructive/70">未配置</span>
                )}
              </li>
              <li>
                月度提成：
                {commissionPlan === 'NONE' ? (
                  <span className="font-medium text-foreground">无（仅日提成）</span>
                ) : commissionPlan === 'A' ? (
                  monthlyRule ? (
                    <span className="font-medium text-foreground">{monthlyRule.rule_name}</span>
                  ) : (
                    <span className="text-destructive/70">未配置 MONTHLY_TOTAL_TIER</span>
                  )
                ) : stageTierRules.length > 0 ? (
                  <span className="font-medium text-foreground">
                    {stageTierRules.map((r) => r.rule_name).join('、')}
                  </span>
                ) : (
                  <span className="text-destructive/70">未配置 STAGE_AMOUNT_TIER</span>
                )}
              </li>
            </ul>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
