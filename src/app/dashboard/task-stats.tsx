"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { TaskSummary } from "@/app/api/tasks/summary/route";
import { Button } from "@/components/ui/button";
import { STATUS_DOT_CLASSES, STATUS_LABELS, TASK_STATUSES } from "./tasks";

type StatsState =
  | { status: "loading" }
  | { status: "ready"; data: TaskSummary }
  | { status: "error" };

const StateContext = createContext<StatsState>({ status: "loading" });
const ReloadContext = createContext<() => void>(() => {});

// Counts come from GET /api/tasks/summary (same-origin, session cookie, so
// always the signed-in user's own tasks; no-store, never cached). Loaded once
// on mount, then again only after a task is created, edited, deleted or
// changes status; filters and pagination never trigger a reload.
export function TaskStatsProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StatsState>({ status: "loading" });
  // Only the most recent request may update the numbers.
  const latest = useRef(0);

  const load = useCallback(async () => {
    const id = ++latest.current;
    let next: StatsState;
    try {
      const res = await fetch("/api/tasks/summary", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      next = { status: "ready", data: (await res.json()) as TaskSummary };
    } catch {
      next = { status: "error" };
    }
    if (id === latest.current) setState(next);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ReloadContext value={load}>
      <StateContext value={state}>{children}</StateContext>
    </ReloadContext>
  );
}

// Call after a successful task mutation to refresh the counts.
export function useReloadTaskStats() {
  return useContext(ReloadContext);
}

const ITEMS = [
  { key: "total", label: "Total", dot: "bg-primary" },
  ...TASK_STATUSES.map((s) => ({
    key: s,
    label: STATUS_LABELS[s],
    dot: STATUS_DOT_CLASSES[s],
  })),
] as const;

export function TaskStats() {
  const state = useContext(StateContext);
  const reload = useContext(ReloadContext);

  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="flex min-h-[50px] items-center justify-between gap-3 rounded-xl border bg-card px-4 py-2 text-sm text-muted-foreground"
      >
        Couldn&apos;t load task statistics.
        <Button variant="outline" size="sm" onClick={reload}>
          Retry
        </Button>
      </div>
    );
  }

  const loading = state.status === "loading";
  return (
    <>
      {loading && (
        <span role="status" className="sr-only">
          Loading task statistics…
        </span>
      )}
      <dl
        aria-busy={loading}
        className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border bg-border shadow-xs sm:grid-cols-4"
      >
        {ITEMS.map(({ key, label, dot }) => (
          <div
            key={key}
            className="flex items-center justify-between gap-3 bg-card px-4 py-2.5"
          >
            <dt className="flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
              <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${dot}`} />
              <span className="truncate">{label}</span>
            </dt>
            <dd className="text-lg leading-7 font-semibold tabular-nums">
              {loading ? (
                <span
                  aria-hidden="true"
                  className="block h-5 w-8 rounded bg-muted motion-safe:animate-pulse"
                />
              ) : (
                state.data[key]
              )}
            </dd>
          </div>
        ))}
      </dl>
    </>
  );
}
