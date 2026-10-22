'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { currentMonth } from '@/lib/format';

interface MonthCtx {
  month: string;
  setMonth: (m: string) => void;
}

const STORAGE_KEY = 'jx:selected-month';

const Ctx = createContext<MonthCtx>({ month: currentMonth(), setMonth: () => {} });

function loadInitialMonth(): string {
  if (typeof window === 'undefined') return currentMonth();
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved && /^\d{4}-\d{2}$/.test(saved)) return saved;
  } catch {}
  return currentMonth();
}

export function MonthProvider({ children }: { children: ReactNode }) {
  const [month, setMonth] = useState<string>(loadInitialMonth);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, month);
    } catch {}
  }, [month]);

  return <Ctx.Provider value={{ month, setMonth }}>{children}</Ctx.Provider>;
}

export function useMonth(): MonthCtx {
  return useContext(Ctx);
}
