"use client";

import { useActionState, useRef, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { deleteTask, setTaskStatus } from "./actions";
import { CalendarIcon, DotsIcon } from "./icons";
import { TaskDialog } from "./task-dialog";
import { useReloadTaskStats } from "./task-stats";
import {
  STATUS_BADGE_CLASSES,
  STATUS_DOT_CLASSES,
  STATUS_LABELS,
  TASK_STATUSES,
  formatDueDate,
  type Task,
  type TaskFormState,
  type TaskStatus,
} from "./tasks";

// `today` (YYYY-MM-DD) comes from the server so server and client agree.
export function TaskItem({ task, today }: { task: Task; today: string }) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // Dialogs opened from the menu return focus to the menu button.
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  // Successful changes also refresh the task statistics.
  const reloadStats = useReloadTaskStats();
  const withStats =
    (action: typeof setTaskStatus) =>
    async (prev: TaskFormState, formData: FormData) => {
      const result = await action(prev, formData);
      if (result.ok) reloadStats();
      return result;
    };
  const [statusState, statusAction, statusPending] = useActionState(
    withStats(setTaskStatus),
    {},
  );
  const [deleteState, deleteAction, deletePending] = useActionState(
    withStats(deleteTask),
    {},
  );
  const [, startTransition] = useTransition();

  function changeStatus(status: TaskStatus) {
    if (status === task.status) return;
    const formData = new FormData();
    formData.set("id", task.id);
    formData.set("status", status);
    startTransition(() => statusAction(formData));
  }

  const done = task.status === "done";
  const overdue = !done && task.due_date !== null && task.due_date < today;

  return (
    <li className="flex items-start gap-3 px-4 py-3 transition-colors duration-150 hover:bg-accent/40 has-[[data-popup-open]]:bg-accent/40 sm:items-center sm:gap-4 sm:px-6">
      <span
        aria-hidden="true"
        className={`mt-1.5 size-3 shrink-0 rounded-full sm:mt-0 ${STATUS_DOT_CLASSES[task.status]}`}
      />

      <div className="min-w-0 flex-1 sm:flex sm:items-center sm:gap-6">
        <div className="min-w-0 flex-1">
          <h3
            className={`font-medium break-words ${done ? "text-muted-foreground line-through decoration-muted-foreground/50" : ""}`}
          >
            {task.title}
          </h3>
          {task.description && (
            <p className="mt-0.5 line-clamp-2 text-sm break-words whitespace-pre-line text-muted-foreground">
              {task.description}
            </p>
          )}
          {statusState.error && (
            <p role="alert" className="mt-1 text-sm text-destructive">
              {statusState.error}
            </p>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-2 sm:mt-0 sm:shrink-0 sm:flex-nowrap">
          {task.due_date && (
            <span
              className={`flex items-center gap-1.5 text-sm whitespace-nowrap tabular-nums ${overdue ? "font-medium text-destructive" : "text-muted-foreground"}`}
            >
              <CalendarIcon className="size-4" />
              {overdue && "Overdue · "}
              <time dateTime={task.due_date}>
                {formatDueDate(task.due_date)}
              </time>
            </span>
          )}
          <span
            className={`inline-flex min-w-24 justify-center rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap transition-opacity duration-150 ${STATUS_BADGE_CLASSES[task.status]} ${statusPending ? "opacity-60" : ""}`}
          >
            {statusPending ? "Updating…" : STATUS_LABELS[task.status]}
          </span>
        </div>
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger
          ref={menuButtonRef}
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              className="-my-1 shrink-0 text-muted-foreground hover:text-foreground data-popup-open:bg-accent data-popup-open:text-foreground"
              aria-label={`Actions for ${task.title}`}
            />
          }
        >
          <DotsIcon className="size-5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onClick={() => setEditOpen(true)}>
            Edit
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={task.status}
              onValueChange={(value) => changeStatus(value as TaskStatus)}
            >
              {TASK_STATUSES.map((s) => (
                <DropdownMenuRadioItem key={s} value={s}>
                  {STATUS_LABELS[s]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            variant="destructive"
            onClick={() => setDeleteOpen(true)}
          >
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <TaskDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        task={task}
        finalFocus={menuButtonRef}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent finalFocus={menuButtonRef}>
          <DialogHeader>
            <DialogTitle>Delete task?</DialogTitle>
            <DialogDescription className="break-words">
              &ldquo;{task.title}&rdquo; will be permanently deleted. This
              can&apos;t be undone.
            </DialogDescription>
          </DialogHeader>
          {deleteState.error && (
            <p role="alert" className="text-sm text-destructive">
              {deleteState.error}
            </p>
          )}
          <DialogFooter>
            <DialogClose
              render={<Button variant="outline" disabled={deletePending} />}
            >
              Cancel
            </DialogClose>
            <form action={deleteAction}>
              <input type="hidden" name="id" value={task.id} />
              <Button
                type="submit"
                variant="destructive"
                className="w-full"
                disabled={deletePending}
              >
                {deletePending ? "Deleting…" : "Delete task"}
              </Button>
            </form>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}
