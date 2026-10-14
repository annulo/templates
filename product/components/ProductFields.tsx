import { useEffect, useState } from "react";
import { ArrowRight, Settings2 } from "lucide-react";
import { Button, cx, Field, inputCls, Notice, Skeleton } from "./ui";
import Select from "./Select";
import { TaskButton, TaskRequirements, useTask } from "./Task";
import { runLocal } from "../lib/shuttle";
import { tr } from "../lib/i18n";

export const g = (key: string, vars?: Record<string, unknown>) =>
  tr("growth." + key, vars);
export function TextFields({
  fields,
  value,
  onChange,
}: {
  fields: { key: string; long?: boolean; type?: string; hint?: string }[];
  value: any;
  onChange: (next: any) => void;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((f) => (
        <div key={f.key} className={f.long ? "sm:col-span-2" : ""}>
          <Field label={g("field_" + f.key)} hint={f.hint && g(f.hint)}>
            {f.long ? (
              <textarea
                aria-label={g("field_" + f.key)}
                rows={3}
                value={value[f.key] ?? ""}
                onChange={(e) =>
                  onChange({ ...value, [f.key]: e.target.value })
                }
                className={inputCls}
              />
            ) : (
              <input
                aria-label={g("field_" + f.key)}
                type={f.type || "text"}
                value={value[f.key] ?? ""}
                onChange={(e) =>
                  onChange({ ...value, [f.key]: e.target.value })
                }
                className={inputCls}
              />
            )}
          </Field>
        </div>
      ))}
    </div>
  );
}
export function Choice({
  name,
  value,
  options,
  onChange,
}: {
  name: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <Field label={g("field_" + name)}>
      <Select
        ariaLabel={g("field_" + name)}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={g("choose")}
      />
    </Field>
  );
}
export function TaskTools({
  task,
  label,
  input,
  onFinished,
  disabled = false,
  beforeRun,
}: {
  task: string;
  label: string;
  input?: unknown;
  onFinished?: () => void;
  disabled?: boolean;
  beforeRun?: () => Promise<unknown>;
}) {
  const [open, setOpen] = useState(false);
  const job = useTask(task);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <TaskButton
        task={task}
        input={input}
        beforeRun={beforeRun}
        disabled={disabled}
        onFinished={onFinished}
      >
        {g(label)}
      </TaskButton>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={g("requirements")}
        onClick={() => setOpen(true)}
        disabled={!job.task}
      >
        <Settings2 />
      </Button>
      <TaskRequirements
        task={job.task}
        onSaved={job.setTask}
        title={g("requirements")}
        hint={g("requirements_hint")}
        open={open}
        onOpenChange={setOpen}
      />
      {job.error && <Notice tone="error">{job.error}</Notice>}
    </div>
  );
}
export function useProductData<T>(fn: string, input: any, rev: number) {
  const [data, setData] = useState<T | null>(null),
    [error, setError] = useState("");
  const key = JSON.stringify(input);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    runLocal<T>(fn, JSON.parse(key)).then(
      (v) => {
        if (active) setData(v);
      },
      (e) => {
        if (active) setError(e.message);
      },
    );
    return () => {
      active = false;
    };
  }, [fn, key, rev, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}
export function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
      {g(text)}
    </div>
  );
}
export function DataState({
  loading,
  error,
}: {
  loading: boolean;
  error: string;
}) {
  return (
    <>
      {error && <Notice tone="error">{error}</Notice>}
      {loading && !error && <Skeleton className="h-40 rounded-xl" />}
    </>
  );
}
export function MetricCard({
  label,
  value,
  onClick,
}: {
  label: string;
  value: number | null | undefined;
  onClick?: () => void;
}) {
  const content = (
    <>
      <span className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        {label}
        {onClick && <ArrowRight aria-hidden="true" className="size-4 shrink-0" />}
      </span>
      <span className="mt-2 block text-2xl font-semibold tracking-tight tabular-nums">
        {value == null ? "—" : value.toLocaleString()}
      </span>
    </>
  );
  const className = "rounded-xl border border-border bg-background p-4";
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cx(className, "w-full cursor-pointer text-left transition-colors hover:border-primary/40 hover:bg-accent/50 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50")}
    >
      {content}
    </button>
  ) : (
    <div className={className}>{content}</div>
  );
}
