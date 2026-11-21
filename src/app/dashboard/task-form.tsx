"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { createTask, updateTask } from "./actions";
import { useReloadTaskStats } from "./task-stats";
import {
  STATUS_LABELS,
  TASK_STATUSES,
  type Task,
  type TaskFields,
  type TaskFormState,
} from "./tasks";

// Matches the shadcn Input so native selects look and focus the same way.
export const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:bg-input/30";

// Create form when `task` is omitted, edit form otherwise. `onDone` runs after
// a successful save and from the Cancel button (used to close the dialog);
// `onSaved` runs only after a successful save.
export function TaskForm({
  task,
  onDone,
  onSaved,
}: {
  task?: Task;
  onDone?: () => void;
  onSaved?: () => void;
}) {
  const reloadStats = useReloadTaskStats();
  const [state, formAction, pending] = useActionState(
    async (prev: TaskFormState, formData: FormData) => {
      const result = await (task ? updateTask : createTask)(prev, formData);
      if (result.ok) {
        reloadStats();
        onDone?.();
        onSaved?.();
      }
      return result;
    },
    {},
  );

  // After a failed submit, show what the user typed; otherwise the saved task.
  const value = (field: TaskFields) =>
    state.values?.[field] ?? (task?.[field] ?? "");
  const fieldId = (field: TaskFields) => `${task?.id ?? "new"}-${field}`;
  const errorProps = (field: TaskFields) => ({
    "aria-invalid": Boolean(state.fieldErrors?.[field]),
    "aria-describedby": state.fieldErrors?.[field]
      ? `${fieldId(field)}-error`
      : undefined,
  });
  const fieldError = (field: TaskFields) =>
    state.fieldErrors?.[field] && (
      <p id={`${fieldId(field)}-error`} className="text-xs text-destructive">
        {state.fieldErrors[field]}
      </p>
    );

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {task && <input type="hidden" name="id" value={task.id} />}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("title")}>Title</Label>
        <Input
          id={fieldId("title")}
          name="title"
          required
          maxLength={200}
          placeholder="What needs to be done?"
          defaultValue={value("title")}
          {...errorProps("title")}
        />
        {fieldError("title")}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={fieldId("description")}>
          Description{" "}
          <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={fieldId("description")}
          name="description"
          maxLength={2000}
          rows={3}
          placeholder="Add details…"
          defaultValue={value("description")}
          {...errorProps("description")}
        />
        {fieldError("description")}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={fieldId("status")}>Status</Label>
          <select
            id={fieldId("status")}
            name="status"
            defaultValue={value("status") || "todo"}
            className={selectClassName}
            {...errorProps("status")}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABELS[s]}
              </option>
            ))}
          </select>
          {fieldError("status")}
        </div>

        <div className="flex min-w-0 flex-col gap-1.5">
          <Label htmlFor={fieldId("due_date")}>
            Due date{" "}
            <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id={fieldId("due_date")}
            name="due_date"
            type="date"
            defaultValue={value("due_date")}
            {...errorProps("due_date")}
          />
          {fieldError("due_date")}
        </div>
      </div>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        {onDone && (
          <Button
            type="button"
            variant="outline"
            onClick={onDone}
            disabled={pending}
          >
            Cancel
          </Button>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : task ? "Save changes" : "Create task"}
        </Button>
      </div>
    </form>
  );
}
