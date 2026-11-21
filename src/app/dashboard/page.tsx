import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense, cache } from "react";
import { buttonVariants } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { AccountMenu } from "./account-menu";
import { FilterIcon, LayersIcon } from "./icons";
import { NewTaskButton } from "./task-dialog";
import { TaskFilters as TaskFiltersForm } from "./task-filters";
import { TaskItem } from "./task-item";
import { TaskStats, TaskStatsProvider } from "./task-stats";
import type { Task, TaskFilters } from "./tasks";

export const metadata: Metadata = {
  title: "My Tasks · TaskFlow",
};

const PAGE_SIZE = 10;
// Upper bound for ?page= so offsets stay small and conversions exact.
const MAX_PAGE = 100_000;

type SearchParams = PageProps<"/dashboard">["searchParams"];

// "/dashboard?page=N": missing means 1; anything that is not a plain
// positive integer up to MAX_PAGE is invalid (null).
function parsePage(value: string | string[] | undefined): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return null;
  const page = Number(value);
  return page <= MAX_PAGE ? page : null;
}

function pageHref(page: number) {
  return page <= 1 ? "/dashboard" : `/dashboard?page=${page}`;
}

async function readPage(searchParams: SearchParams) {
  const page = parsePage((await searchParams).page);
  if (page === null) redirect("/dashboard");
  return page;
}

// Loads everything the dashboard shows for one page. React cache shares one
// result per request (keyed by page) between the header, filters and list;
// nothing is shared between requests or users.
const loadDashboard = cache(async (page: number) => {
  const user = await requireUser();
  const supabase = await createClient();

  // Saved filters; no row yet means the defaults (all tasks).
  const { data: prefs, error: prefsError } = await supabase
    .from("user_preferences")
    .select("status_filter, date_from, date_to")
    .eq("user_id", user.id)
    .maybeSingle()
    .overrideTypes<TaskFilters | null, { merge: false }>();
  const filters: TaskFilters = prefs ?? {
    status_filter: null,
    date_from: null,
    date_to: null,
  };

  // One request returns the page of rows and the exact count of all rows
  // matching the same filters. RLS limits rows to the owner; the user_id
  // filter also matches the indexes. gte/lte never match a NULL due_date, so
  // tasks without one are excluded whenever a date bound is set. id breaks
  // created_at ties so pages never overlap or skip rows.
  const fetchRange = (from: number, to: number) => {
    let query = supabase
      .from("tasks")
      .select("id, title, description, status, due_date, created_at", {
        count: "exact",
      })
      .eq("user_id", user.id);
    if (filters.status_filter) query = query.eq("status", filters.status_filter);
    if (filters.date_from) query = query.gte("due_date", filters.date_from);
    if (filters.date_to) query = query.lte("due_date", filters.date_to);
    return (
      query
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to)
        // status is TEXT + CHECK in the database, so narrow it to TaskStatus.
        .overrideTypes<Task[], { merge: false }>()
    );
  };

  const from = (page - 1) * PAGE_SIZE;
  const result = await fetchRange(from, from + PAGE_SIZE - 1);

  // PGRST103: the offset is past the last row (e.g. ?page=99, or the last
  // task on the last page was deleted). Count with a 1-row request and go
  // to the last page that exists.
  if (result.error?.code === "PGRST103") {
    const probe = await fetchRange(0, 0);
    if (!probe.error) {
      redirect(pageHref(Math.ceil((probe.count ?? 0) / PAGE_SIZE)));
    }
  }

  const total = result.count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (!result.error && page > totalPages) redirect(pageHref(totalPages));

  return {
    user,
    filters,
    prefsFailed: Boolean(prefsError),
    filtered: Boolean(
      filters.status_filter || filters.date_from || filters.date_to,
    ),
    tasks: result.error ? null : result.data,
    page,
    total,
    totalPages,
    // Request time is guaranteed (requireUser awaits connection()). Overdue
    // is judged against the server's UTC date.
    today: new Date().toISOString().slice(0, 10),
  };
});

async function load(searchParams: SearchParams) {
  return loadDashboard(await readPage(searchParams));
}

// Static shell: header, headings, the New task button and fallbacks.
// Everything user-specific (and the page number) streams in per request
// behind Suspense.
export default function DashboardPage({ searchParams }: PageProps<"/dashboard">) {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col px-4 sm:px-8 fit:h-dvh fit:flex-none fit:overflow-hidden">
      <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b sm:h-16">
        <p className="flex items-center gap-2.5 text-lg font-semibold tracking-tight">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-sm shadow-primary/30">
            <LayersIcon className="size-[18px]" />
          </span>
          TaskFlow
        </p>
        <Suspense fallback={null}>
          <Account />
        </Suspense>
      </header>

      <main className="flex flex-1 flex-col gap-6 py-6 sm:gap-7 sm:py-8 fit:min-h-0 fit:gap-4 fit:py-5">
        <TaskStatsProvider>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 flex-col gap-0.5">
              <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl fit:text-2xl">
                My Tasks
              </h1>
              <p className="text-sm text-muted-foreground sm:text-base fit:text-sm">
                Organize your work, stay focused.
              </p>
            </div>
            <NewTaskButton />
          </div>

          {/* All tasks, ignoring filters and pagination. */}
          <section aria-label="Task statistics">
            <TaskStats />
          </section>

          <section aria-labelledby="filters-heading" className="flex flex-col gap-2.5">
            <h2
              id="filters-heading"
              className="flex items-center gap-2 text-base font-medium"
            >
              <FilterIcon className="size-4 text-muted-foreground" />
              Filters
            </h2>
            <Suspense fallback={<FiltersSkeleton />}>
              <Filters searchParams={searchParams} />
            </Suspense>
          </section>

          <section
            aria-labelledby="tasks-heading"
            className="overflow-hidden rounded-xl border bg-card shadow-xs fit:flex fit:min-h-0 fit:flex-initial fit:flex-col"
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b bg-muted/40 px-4 py-3 sm:px-6">
              <h2 id="tasks-heading" className="text-base font-semibold">
                All tasks
              </h2>
              <Suspense fallback={null}>
                <TaskCount searchParams={searchParams} />
              </Suspense>
            </div>
            <Suspense fallback={<ListSkeleton />}>
              <TaskList searchParams={searchParams} />
            </Suspense>
          </section>
        </TaskStatsProvider>
      </main>
    </div>
  );
}

async function Account() {
  const user = await requireUser();
  return <AccountMenu email={user.email ?? "Unknown user"} />;
}

async function TaskCount({ searchParams }: { searchParams: SearchParams }) {
  const { tasks, total, filtered } = await load(searchParams);
  if (!tasks) return null;
  const noun = total === 1 ? "task" : "tasks";
  return (
    <span className="text-sm text-muted-foreground tabular-nums">
      {total} {filtered ? `matching ${noun}` : noun}
    </span>
  );
}

async function Filters({ searchParams }: { searchParams: SearchParams }) {
  const { filters, prefsFailed } = await load(searchParams);
  return (
    <div className="flex flex-col gap-3">
      {prefsFailed && (
        <p role="alert" className="text-sm text-destructive">
          Couldn&apos;t load your saved filters. Showing all tasks.{" "}
          <a href="/dashboard" className="underline underline-offset-4">
            Reload the page
          </a>{" "}
          to try again.
        </p>
      )}
      <TaskFiltersForm
        key={`${filters.status_filter}|${filters.date_from}|${filters.date_to}`}
        filters={filters}
        // Saving now could overwrite preferences we failed to read.
        disabled={prefsFailed}
      />
    </div>
  );
}

async function TaskList({ searchParams }: { searchParams: SearchParams }) {
  const { tasks, filtered, today, page, total, totalPages } =
    await load(searchParams);

  if (!tasks) {
    return (
      <p role="alert" className="px-6 py-12 text-center text-sm text-destructive">
        Couldn&apos;t load your tasks.{" "}
        <a href="/dashboard" className="underline underline-offset-4">
          Reload the page
        </a>{" "}
        to try again.
      </p>
    );
  }

  if (tasks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 px-6 py-12 text-center">
        <span className="mb-2 flex size-11 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/15">
          {filtered ? (
            <FilterIcon className="size-5" />
          ) : (
            <LayersIcon className="size-5" />
          )}
        </span>
        <p className="font-medium">
          {filtered ? "No matching tasks" : "No tasks yet"}
        </p>
        <p className="max-w-xs text-sm text-muted-foreground">
          {filtered
            ? "Adjust or reset the filters above to see more tasks."
            : "Use “New task” to create your first one."}
        </p>
      </div>
    );
  }

  const first = (page - 1) * PAGE_SIZE + 1;
  const last = first + tasks.length - 1;

  return (
    <>
      {/* In the fit layout only this area scrolls; tabIndex lets keyboard
          users focus it and scroll with the arrow keys. */}
      <div
        role="region"
        aria-label="Task list"
        tabIndex={0}
        className="outline-none focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset fit:min-h-0 fit:flex-initial fit:overflow-y-auto"
      >
        <ul className="divide-y">
          {tasks.map((task) => (
            <TaskItem key={task.id} task={task} today={today} />
          ))}
        </ul>
      </div>
      {totalPages > 1 && (
        <nav
          aria-label="Pagination"
          className="flex shrink-0 items-center justify-between gap-3 border-t px-4 py-2.5 sm:px-6"
        >
          <p className="text-sm text-muted-foreground tabular-nums">
            <span className="hidden sm:inline">
              Showing {first}–{last} of {total} ·{" "}
            </span>
            Page {page} of {totalPages}
          </p>
          <div className="flex gap-2">
            <PageLink page={page - 1} enabled={page > 1}>
              Previous
            </PageLink>
            <PageLink page={page + 1} enabled={page < totalPages}>
              Next
            </PageLink>
          </div>
        </nav>
      )}
    </>
  );
}

// A real link when the page exists; otherwise a non-focusable, disabled-
// looking label so there is no dead control at the boundaries.
function PageLink({
  page,
  enabled,
  children,
}: {
  page: number;
  enabled: boolean;
  children: string;
}) {
  const className = buttonVariants({ variant: "outline", size: "sm" });
  if (!enabled) {
    return (
      <span aria-disabled="true" className={`${className} opacity-50`}>
        {children}
      </span>
    );
  }
  return (
    <Link
      href={pageHref(page)}
      className={className}
      aria-label={`${children} page, page ${page}`}
    >
      {children}
    </Link>
  );
}

function FiltersSkeleton() {
  return (
    <div
      aria-hidden="true"
      className="grid gap-3 motion-safe:animate-pulse sm:grid-cols-3 lg:grid-cols-[1.15fr_1fr_1fr_auto]"
    >
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-[50px] rounded-lg border bg-muted/40" />
      ))}
      <div className="h-10 rounded-lg bg-muted/40 sm:col-span-3 lg:col-span-1 lg:w-52 lg:self-center" />
    </div>
  );
}

function ListSkeleton() {
  return (
    <div role="status" className="divide-y motion-safe:animate-pulse">
      <span className="sr-only">Loading tasks…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-5 sm:px-6">
          <div className="size-3 rounded-full bg-muted" />
          <div className="flex flex-1 flex-col gap-2">
            <div className="h-3.5 w-1/3 rounded bg-muted" />
            <div className="h-3 w-1/2 rounded bg-muted/60" />
          </div>
          <div className="hidden h-5 w-24 rounded-full bg-muted/60 sm:block" />
        </div>
      ))}
    </div>
  );
}
