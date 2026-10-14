import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Archive,
  ExternalLink,
  Lightbulb,
  Link2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Upload,
  UserRound,
} from "lucide-react";
import { runLocal } from "../lib/shuttle";
import { tr, numLocale } from "../lib/i18n";
import {
  Badge,
  Button,
  Dialog,
  Field,
  Notice,
  Segmented,
  Skeleton,
  cx,
  inputCls,
} from "./ui";
import Select from "./Select";
import { TaskLaunchButton } from "./Task";
import type { Ctx } from "./views/types";

type Row = { id: string; [key: string]: any };
type Library = {
  sources: Row[];
  creators: Row[];
  topics: Row[];
  articles: Row[];
};
const r = (key: string, vars?: Record<string, unknown>) =>
  tr("inspiration." + key, vars);
const parse = (v: unknown): any[] => {
  try {
    return Array.isArray(v) ? v : JSON.parse(String(v || "[]"));
  } catch {
    return [];
  }
};
const listText = (v: unknown) =>
  parse(v)
    .map((x: any) => (typeof x === "string" ? x : x.url))
    .filter(Boolean)
    .join("\n");
const options = (prefix: string, values: string[]) =>
  values.map((value) => ({ value, label: r(prefix + "_" + value) }));
const platforms = () =>
  options("platform", ["xiaohongshu", "douyin", "x", "other"]);
const sourceStates = () => options("state", ["inbox", "ready", "archived"]);
const creatorStates = () =>
  options("state", ["watching", "active", "paused", "archived"]);
const blankSource = {
  title: "",
  url: "",
  platform: "xiaohongshu",
  format: "post",
  library_status: "inbox",
  priority: "normal",
};
const blankCreator = {
  nickname: "",
  profile_url: "",
  platform: "xiaohongshu",
  status: "watching",
  priority: "normal",
  creator_type: "other",
};
const safeLink = (value: unknown) =>
  /^https?:\/\//i.test(String(value || "")) ? String(value) : "";

function External({ url, label }: { url?: string; label: string }) {
  const href = safeLink(url);
  return href ? (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-sm text-primary-text hover:underline"
    >
      <ExternalLink className="size-3.5" />
      {label}
    </a>
  ) : null;
}
function Observation({ label, value }: { label: string; value?: string }) {
  return value ? (
    <div className="space-y-1.5">
      <h3 className="text-sm font-medium">{label}</h3>
      <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground">
        {value}
      </p>
    </div>
  ) : null;
}

export default function InspirationLibrary({
  ctx,
  params,
  setParam,
  onChanged,
}: {
  ctx: Ctx;
  params: Record<string, string>;
  setParam: (k: string, v: string) => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<Library | null>(null);
  const [error, setError] = useState("");
  const [q, setQ] = useState("");
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [edit, setEdit] = useState<{
    kind: "source" | "creator";
    row?: Row;
  } | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [linking, setLinking] = useState(false);
  const [topicId, setTopicId] = useState("");
  const tab = params.library === "creators" ? "creators" : "sources";
  const request = useRef(0);
  const load = useCallback(() => {
    const n = ++request.current;
    runLocal<Library>("inspiration.list", {})
      .then((value) => {
        if (n === request.current) {
          setData(value);
          setError("");
        }
      })
      .catch((e) => {
        if (n === request.current) setError(e.message);
      });
  }, []);
  useEffect(() => {
    load();
    return () => {
      request.current++;
    };
  }, [load]);
  useEffect(() => {
    if (ctx.rev) load();
  }, [ctx.rev, load]);
  const changed = () => {
    load();
    onChanged();
  };
  const go = (extra: Record<string, string> = {}) =>
    ctx.go("content", { tab: "inspiration", ...extra });
  const openUse = (use: Row) =>
    ctx.go(
      "content",
      use.type === "article"
        ? { article: use.id }
        : { tab: "topics", topic: use.id },
    );
  const source = data?.sources.find((s) => s.id === params.source);
  const creator = data?.creators.find((c) => c.id === params.creator);
  const archive = async (kind: string, row: Row) => {
    await runLocal("inspiration.archive", {
      kind,
      id: row.id,
      restore:
        (kind === "source" ? row.library_status : row.status) === "archived",
    });
    changed();
  };
  const matches = (row: Row) =>
    (!platform || row.platform === platform) &&
    (!status ||
      (tab === "sources" ? row.library_status || "inbox" : row.status) ===
        status) &&
    (!q ||
      [
        row.title,
        row.nickname,
        row.summary,
        row.author_name,
        row.content_focus,
        row.tags,
        ...data!.creators
          .filter((c) => c.id === row.creator_id)
          .map((c) => c.nickname),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q.toLowerCase()));
  const visibleSources = data?.sources.filter(matches) || [];
  const creatorGroups = new Map<string, Row[]>();
  for (const c of data?.creators || []) {
    const key = c.person_key ? "person:" + c.person_key : c.id;
    creatorGroups.set(key, [...(creatorGroups.get(key) || []), c]);
  }
  const visibleGroups = [...creatorGroups.values()].filter((group) =>
    group.some(matches),
  );
  const taskProps = {
    onFinished: changed,
    reqTitle: r("requirements"),
    reqHint: r("snapshot_hint"),
    startLabel: r("start"),
    icon: Sparkles,
    variant: "outline" as const,
  };

  return (
    <div className="min-w-0 space-y-5">
      {error && <Notice tone="error">{error}</Notice>}
      {!data && !error && <Skeleton className="h-40 rounded-xl" />}
      {data && (
        <>
          {source || creator ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => go(creator ? { library: "creators" } : {})}
                >
                  <ArrowLeft />
                  {r("back")}
                </Button>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setEdit({
                        kind: source ? "source" : "creator",
                        row: source || creator,
                      })
                    }
                  >
                    <Pencil />
                    {tr("common.edit")}
                  </Button>
                  <Button
                    fn="inspiration.archive"
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      archive(
                        source ? "source" : "creator",
                        (source || creator)!,
                      )
                    }
                  >
                    <Archive />
                    {(source ? source.library_status : creator!.status) ===
                    "archived"
                      ? r("restore")
                      : r("archive")}
                  </Button>
                </div>
              </div>
              {source && (
                <>
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge>
                        {r("platform_" + (source.platform || "other"))}
                      </Badge>
                      <Badge>
                        {r("state_" + (source.library_status || "inbox"))}
                      </Badge>
                      {source.uses.length > 0 && (
                        <Badge tone="ok">
                          {r("used_count", { n: source.uses.length })}
                        </Badge>
                      )}
                    </div>
                    <h2 className="break-words text-2xl font-semibold">
                      {source.title}
                    </h2>
                    <div className="flex flex-wrap items-center gap-4">
                      <External url={source.url} label={r("open_source")} />
                      {source.creator_id ? (
                        <button
                          className="cursor-pointer text-sm text-primary-text hover:underline"
                          onClick={() =>
                            go({
                              library: "creators",
                              creator: source.creator_id,
                            })
                          }
                        >
                          {data.creators.find((c) => c.id === source.creator_id)
                            ?.nickname || source.author_name}
                        </button>
                      ) : (
                        source.author_name && (
                          <span className="text-sm text-muted-foreground">
                            {source.author_name}
                          </span>
                        )
                      )}
                      <span className="text-xs text-muted-foreground">
                        {r("collected_at")}{" "}
                        {source.collected_at
                          ? new Date(source.collected_at).toLocaleDateString(
                              numLocale(),
                            )
                          : "—"}
                      </span>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <TaskLaunchButton
                      {...taskProps}
                      task="review-inspiration"
                      input={{ source_id: source.id }}
                      match={(run) => run.input?.source_id === source.id}
                      title={r("review")}
                      desc={r("review_desc")}
                    >
                      {r("review")}
                    </TaskLaunchButton>
                    <TaskLaunchButton
                      {...taskProps}
                      task="suggest-topics"
                      reqKey="topic_requirements"
                      input={{ source_ids: [source.id] }}
                      match={(run) =>
                        run.input?.source_ids?.includes(source.id)
                      }
                      title={r("generate")}
                      desc={r("generate_desc")}
                    >
                      {r("generate")}
                    </TaskLaunchButton>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setTopicId("");
                        setLinking(true);
                      }}
                    >
                      <Link2 />
                      {r("link_topic")}
                    </Button>
                  </div>
                  <div className="space-y-5 rounded-xl border border-border p-5">
                    <Observation label={r("summary")} value={source.summary} />
                    <Observation label={r("hook")} value={source.hook} />
                    <Observation
                      label={r("why_save")}
                      value={source.why_save}
                    />
                    <Observation
                      label={r("adaptation_idea")}
                      value={source.adaptation_idea}
                    />
                    <Observation label={r("content")} value={source.content} />
                    <Observation label={r("notes")} value={source.notes} />
                    {![
                      source.summary,
                      source.content,
                      source.why_save,
                      source.adaptation_idea,
                      source.hook,
                      source.notes,
                    ].some(Boolean) && (
                      <p className="text-sm text-muted-foreground">
                        {r("review_desc")}
                      </p>
                    )}
                  </div>
                  {(parse(source.images).length > 0 ||
                    parse(source.videos).length > 0) && (
                    <div className="space-y-3">
                      <p className="text-xs text-muted-foreground">
                        {r("media_hint")}
                      </p>
                      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                        {parse(source.images)
                          .filter((m) => safeLink(m.url || m))
                          .map((m, i) => (
                            <a
                              key={i}
                              href={safeLink(m.url || m)}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <img
                                src={safeLink(m.url || m)}
                                alt={m.alt || m.name || source.title}
                                loading="lazy"
                                className="aspect-[3/4] w-full rounded-lg border border-border object-cover"
                              />
                            </a>
                          ))}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {parse(source.videos).map((m, i) => (
                          <External
                            key={i}
                            url={m.url || m}
                            label={
                              m.fileName || `${r("format_video")} ${i + 1}`
                            }
                          />
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold">
                      {r("linked_content")}
                    </h3>
                    {!source.uses.length ? (
                      <Notice>{r("not_used")}</Notice>
                    ) : (
                      <div className="divide-y divide-border rounded-xl border border-border">
                        {source.uses.map((use: Row) => (
                          <button
                            key={use.type + use.id}
                            onClick={() => openUse(use)}
                            className="flex w-full min-w-0 cursor-pointer items-start gap-3 px-4 py-3 text-left hover:bg-accent"
                          >
                            <Badge>{r(use.type)}</Badge>
                            <span className="min-w-0 break-words text-sm">
                              {use.title}
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
              {creator &&
                (() => {
                  const group = creator.person_key
                    ? data.creators.filter(
                        (c) => c.person_key === creator.person_key,
                      )
                    : [creator];
                  const sources = data.sources.filter((s) =>
                    group.some((c) => c.id === s.creator_id),
                  );
                  return (
                    <>
                      <div className="flex items-start gap-4">
                        {safeLink(creator.avatar_url) ? (
                          <img
                            src={safeLink(creator.avatar_url)}
                            alt={creator.nickname}
                            className="size-14 shrink-0 rounded-full object-cover"
                          />
                        ) : (
                          <UserRound className="size-10 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <h2 className="break-words text-2xl font-semibold">
                            {creator.nickname}
                          </h2>
                          <p className="mt-1 break-words text-sm text-muted-foreground">
                            {creator.content_focus || creator.bio}
                          </p>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold">
                          {r("group_accounts")}
                        </h3>
                        {group.map((c) => (
                          <div
                            key={c.id}
                            className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-4 py-3"
                          >
                            <Badge>{r("platform_" + c.platform)}</Badge>
                            <span className="text-sm">{c.nickname}</span>
                            <External
                              url={c.profile_url}
                              label={r("open_profile")}
                            />
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() =>
                                setEdit({ kind: "creator", row: c })
                              }
                            >
                              {tr("common.edit")}
                            </Button>
                            {c.snapshot_at && (
                              <p className="w-full text-xs text-muted-foreground">
                                {r("followers_count")}{" "}
                                {c.followers_count ?? "—"} · {r("likes_count")}{" "}
                                {c.likes_count ?? "—"} ·{" "}
                                {new Date(c.snapshot_at).toLocaleDateString(
                                  numLocale(),
                                )}
                              </p>
                            )}
                          </div>
                        ))}
                      </div>
                      <Observation
                        label={r("observations")}
                        value={creator.notes}
                      />
                      <div className="space-y-3">
                        <h3 className="text-sm font-semibold">
                          {r("creator_sources")} {sources.length}
                        </h3>
                        <SourceRows
                          sources={sources}
                          creators={data.creators}
                          onOpen={(s) => go({ source: s.id })}
                        />
                        {!sources.length && (
                          <Notice>{r("no_creator_sources")}</Notice>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setEdit({
                              kind: "source",
                              row: {
                                ...blankSource,
                                id: "",
                                creator_id: creator.id,
                              },
                            })
                          }
                        >
                          <Plus />
                          {r("add_source")}
                        </Button>
                      </div>
                    </>
                  );
                })()}
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <Segmented
                  value={tab}
                  onChange={(v) => {
                    setParam("library", v);
                    setStatus("");
                  }}
                  options={[
                    {
                      value: "sources",
                      label: `${r("sources")} ${data.sources.length}`,
                    },
                    {
                      value: "creators",
                      label: `${r("creators")} ${creatorGroups.size}`,
                    },
                  ]}
                />
                <div className="flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      setEdit({
                        kind: tab === "sources" ? "source" : "creator",
                      })
                    }
                  >
                    <Plus />
                    {r(tab === "sources" ? "add_source" : "add_creator")}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setImportOpen(true)}
                  >
                    <Upload />
                    {r("import")}
                  </Button>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-48 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <input
                    aria-label={r("search")}
                    placeholder={r("search")}
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    className={cx(inputCls, "pl-9")}
                  />
                </div>
                <Select
                  variant="inline"
                  ariaLabel={r("platform")}
                  value={platform}
                  onChange={setPlatform}
                  options={[
                    { value: "", label: r("all_platforms") },
                    ...platforms(),
                  ]}
                />
                <Select
                  variant="inline"
                  ariaLabel={r("status")}
                  value={status}
                  onChange={setStatus}
                  options={[
                    { value: "", label: r("all_statuses") },
                    ...(tab === "sources" ? sourceStates() : creatorStates()),
                  ]}
                />
              </div>
              {tab === "sources" ? (
                <>
                  <SourceRows
                    sources={visibleSources}
                    creators={data.creators}
                    onOpen={(s) => go({ source: s.id })}
                  />
                  {!visibleSources.length && (
                    <Notice>
                      {r(data.sources.length ? "no_matches" : "empty_sources")}
                    </Notice>
                  )}
                </>
              ) : (
                <>
                  <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
                    {visibleGroups.map((group) => {
                      const c = group.find(matches)!;
                      const n = data.sources.filter((s) =>
                        group.some((a) => a.id === s.creator_id),
                      ).length;
                      return (
                        <button
                          key={c.person_key || c.id}
                          onClick={() =>
                            go({ library: "creators", creator: c.id })
                          }
                          className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-2 px-4 py-4 text-left hover:bg-accent sm:flex-row sm:gap-4"
                        >
                          {safeLink(c.avatar_url) ? (
                            <img
                              src={safeLink(c.avatar_url)}
                              alt={c.nickname}
                              className="size-10 shrink-0 rounded-full object-cover"
                            />
                          ) : (
                            <UserRound className="hidden size-8 shrink-0 text-muted-foreground sm:block" />
                          )}
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-sm font-medium">
                              {c.nickname}
                            </p>
                            <p className="mt-1 line-clamp-2 break-words text-xs text-muted-foreground">
                              {c.content_focus || c.bio}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {group.map((a) => (
                                <Badge key={a.id}>
                                  {r("platform_" + a.platform)}
                                </Badge>
                              ))}
                              <span className="text-xs text-muted-foreground">
                                {r("related_count", { n })}
                              </span>
                            </div>
                          </div>
                          <Badge>{r("state_" + c.status)}</Badge>
                        </button>
                      );
                    })}
                  </div>
                  {!visibleGroups.length && (
                    <Notice>
                      {r(
                        data.creators.length ? "no_matches" : "empty_creators",
                      )}
                    </Notice>
                  )}
                </>
              )}
            </>
          )}
          {edit && (
            <LibraryForm
              key={edit.kind + (edit.row?.id || "")}
              kind={edit.kind}
              row={edit.row}
              creators={data.creators}
              onClose={() => setEdit(null)}
              onSaved={(row) => {
                setEdit(null);
                changed();
                go(
                  edit.kind === "source"
                    ? { source: row.id }
                    : { library: "creators", creator: row.id },
                );
              }}
            />
          )}
          <Dialog
            open={linking}
            onClose={() => setLinking(false)}
            title={r("link_topic")}
            footer={
              <>
                <Button variant="ghost" onClick={() => setLinking(false)}>
                  {tr("common.cancel")}
                </Button>
                <Button
                  fn="inspiration.link"
                  disabled={!topicId}
                  onClick={async () => {
                    await runLocal("inspiration.link", {
                      source_id: source!.id,
                      target_type: "topic",
                      target_id: topicId,
                    });
                    setLinking(false);
                    changed();
                  }}
                >
                  {r("link")}
                </Button>
              </>
            }
          >
            <Field label={r("select_topic")}>
              <Select
                ariaLabel={r("select_topic")}
                value={topicId}
                onChange={setTopicId}
                options={data.topics.map((t) => ({
                  value: t.id,
                  label: t.title,
                }))}
              />
            </Field>
          </Dialog>
          {importOpen && (
            <ImportDialog
              onClose={() => setImportOpen(false)}
              onImported={changed}
            />
          )}
        </>
      )}
    </div>
  );
}

function SourceRows({
  sources,
  creators,
  onOpen,
}: {
  sources: Row[];
  creators: Row[];
  onOpen: (row: Row) => void;
}) {
  if (!sources.length) return null;
  return (
    <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
      {sources.map((s) => (
        <button
          key={s.id}
          onClick={() => onOpen(s)}
          className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-2 px-4 py-4 text-left hover:bg-accent sm:flex-row sm:gap-4"
        >
          <Lightbulb className="mt-0.5 hidden size-5 shrink-0 text-muted-foreground sm:block" />
          <div className="w-full min-w-0 flex-1">
            <p className="line-clamp-2 break-words text-sm font-medium">
              {s.title}
            </p>
            {(s.summary || s.why_save) && (
              <p className="mt-1 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground">
                {s.why_save || s.summary}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge>{r("platform_" + (s.platform || "other"))}</Badge>
              <span className="max-w-full shrink-0 text-xs text-muted-foreground">
                {creators.find((c) => c.id === s.creator_id)?.nickname ||
                  s.author_name ||
                  r("no_creator")}
              </span>
              {s.uses?.length > 0 && (
                <span className="text-xs text-primary-text">
                  {r("used_count", { n: s.uses.length })}
                </span>
              )}
            </div>
          </div>
          <Badge>{r("state_" + (s.library_status || "inbox"))}</Badge>
        </button>
      ))}
    </div>
  );
}

function LibraryForm({
  kind,
  row,
  creators,
  onClose,
  onSaved,
}: {
  kind: "source" | "creator";
  row?: Row;
  creators: Row[];
  onClose: () => void;
  onSaved: (row: Row) => void;
}) {
  const [draft, setDraft] = useState<Record<string, any>>(() => ({
    ...(kind === "source" ? blankSource : blankCreator),
    ...row,
    tags: parse(row?.tags).join(", "),
    images: listText(row?.images),
    videos: listText(row?.videos),
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const source = kind === "source";
  const change = (key: string, value: unknown) =>
    setDraft((old) => ({ ...old, [key]: value }));
  const field = (
    key: string,
    multiline = false,
    type = "text",
    required = false,
  ) => (
    <Field key={key} label={r(key)}>
      <>
        {multiline ? (
          <textarea
            aria-label={r(key)}
            value={draft[key] || ""}
            onChange={(e) => change(key, e.target.value)}
            rows={key === "content" ? 6 : 3}
            className={cx(inputCls, "py-2")}
          />
        ) : (
          <input
            aria-label={r(key)}
            required={required}
            type={type}
            value={draft[key] ?? ""}
            onChange={(e) => change(key, e.target.value)}
            className={inputCls}
          />
        )}
      </>
    </Field>
  );
  const select = (
    key: string,
    values: { value: string; label: string }[],
    label = key,
  ) => (
    <Field key={key} label={r(label)}>
      <Select
        ariaLabel={r(label)}
        value={draft[key] || ""}
        onChange={(v) => change(key, v)}
        options={values}
      />
    </Field>
  );
  const save = async () => {
    setSaving(true);
    setError("");
    try {
      const media = (key: string) => {
        const links = String(draft[key] || "")
          .split("\n")
          .map((url) => url.trim())
          .filter(Boolean);
        return links.map(
          (url) =>
            parse(row?.[key]).find((m) => (m.url || m) === url) || { url },
        );
      };
      const value = await runLocal<Row>(
        source ? "inspiration.saveSource" : "inspiration.saveCreator",
        {
          ...draft,
          ...(source
            ? {
                title: draft.title || "",
                images: media("images"),
                videos: media("videos"),
              }
            : {}),
        },
      );
      onSaved(value);
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => !saving && onClose()}
      title={r((row?.id ? "edit_" : "add_") + kind)}
      width={760}
      footer={
        <>
          <Button variant="ghost" disabled={saving} onClick={onClose}>
            {tr("common.cancel")}
          </Button>
          <Button
            fn={source ? "inspiration.saveSource" : "inspiration.saveCreator"}
            disabled={
              saving || !(source ? draft.title : draft.nickname)?.trim()
            }
            onClick={save}
          >
            {tr("common.save")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Notice tone="error">{error}</Notice>}
        {!source && field("nickname", false, "text", true)}
        {source && (
          <Field label={r("source_title")}>
            <input
              aria-label={r("source_title")}
              value={draft.title || ""}
              onChange={(e) => change("title", e.target.value)}
              className={inputCls}
            />
          </Field>
        )}
        {!source && field("profile_url", false, "url")}
        {source && (
          <Field label={r("source_url")}>
            <input
              aria-label={r("source_url")}
              value={draft.url || ""}
              onChange={(e) => change("url", e.target.value)}
              className={inputCls}
            />
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {select("platform", platforms())}
          {source
            ? select(
                "format",
                options("format", [
                  "post",
                  "article",
                  "video",
                  "image",
                  "thread",
                  "other",
                ]),
              )
            : select(
                "creator_type",
                options("type", [
                  "official_brand",
                  "founder",
                  "designer",
                  "ai_creator",
                  "growth_marketer",
                  "competitor",
                  "media",
                  "other",
                ]),
              )}
        </div>
        {source ? (
          <>
            {select(
              "creator_id",
              [
                { value: "", label: r("no_creator") },
                ...creators.map((c) => ({
                  value: c.id,
                  label: `${c.nickname} · ${r("platform_" + c.platform)}`,
                })),
              ],
              "creator",
            )}
            {field("content", true)}
            {field("why_save", true)}
            {field("adaptation_idea", true)}
          </>
        ) : (
          <>
            {field("content_focus")}
            {field("person_key")}
            <p className="text-xs text-muted-foreground">{r("person_hint")}</p>
            {field("bio", true)}
          </>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {select(
            source ? "library_status" : "status",
            source ? sourceStates() : creatorStates(),
            source ? "status" : "watch_status",
          )}
          {select("priority", options("priority", ["low", "normal", "high"]))}
        </div>
        {field("tags")}
        <details className="rounded-lg border border-border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            {r("more_fields")}
          </summary>
          <div className="mt-4 space-y-4">
            {source ? (
              <>
                {field("summary", true)}
                {field("hook", true)}
                {field("author_name")}
                {field("images", true)}
                {field("videos", true)}
                <p className="text-xs text-muted-foreground">
                  {r("media_hint")}
                </p>
              </>
            ) : (
              <>
                {field("handle")}
                {field("avatar_url")}
                <div className="grid gap-4 sm:grid-cols-2">
                  {field("followers_count", false, "number")}
                  {field("likes_count", false, "number")}
                </div>
                {field("snapshot_at")}
                <p className="text-xs text-muted-foreground">
                  {r("unknown_metrics")}
                </p>
              </>
            )}
            {field("notes", true)}
          </div>
        </details>
      </div>
    </Dialog>
  );
}

function ImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: () => void;
}) {
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const change = (value: string) => {
    setRaw(value);
    setResult(null);
    setError("");
  };
  const run = async (preview: boolean) => {
    setBusy(true);
    setError("");
    try {
      const result = await runLocal("inspiration.importLegacy", {
        ...JSON.parse(raw),
        preview,
      });
      setResult(result);
      if (!preview) onImported();
    } catch (e) {
      setError((e as Error).message);
      setResult(null);
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => !busy && onClose()}
      title={r("import")}
      width={700}
      footer={
        <>
          <Button variant="ghost" disabled={busy} onClick={onClose}>
            {tr("common.close")}
          </Button>
          <Button
            fn="inspiration.importLegacy"
            variant="outline"
            disabled={busy || !raw.trim()}
            onClick={() => run(true)}
          >
            {r("check_import")}
          </Button>
          <Button
            fn="inspiration.importLegacy"
            disabled={busy || !result?.preview}
            onClick={() => run(false)}
          >
            {r("apply_import")}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">{r("import_hint")}</p>
        <input
          type="file"
          accept="application/json,.json"
          ref={file}
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 20 * 1024 * 1024) {
              setError(r("import_too_large"));
              return;
            }
            change(await f.text());
          }}
        />
        <Button
          variant="outline"
          size="sm"
          onClick={() => file.current?.click()}
        >
          <Upload />
          {r("choose_file")}
        </Button>
        <Field label={r("raw_json")}>
          <textarea
            aria-label={r("raw_json")}
            value={raw}
            onChange={(e) => change(e.target.value)}
            rows={9}
            placeholder={
              '{"origin":"https://old-library.example/","creators":[],"inspirations":[]}'
            }
            className={cx(inputCls, "py-2 font-mono text-xs")}
          />
        </Field>
        {error && <Notice tone="error">{error}</Notice>}
        {result && (
          <Notice tone={result.preview ? undefined : "ok"}>
            {r(result.preview ? "import_preview" : "import_done", result)}
            {result.warnings?.map((w: string, i: number) => (
              <p key={i} className="mt-2 text-xs">
                {w}
              </p>
            ))}
          </Notice>
        )}
      </div>
    </Dialog>
  );
}

export function InspirationReferences({
  ctx,
  targetType,
  targetId,
  onChanged,
}: {
  ctx: Ctx;
  targetType: "topic" | "article";
  targetId: string;
  onChanged?: () => void;
}) {
  const [data, setData] = useState<{
    sources: Row[];
    links: Row[];
    captured_at: string;
  } | null>(null);
  const [library, setLibrary] = useState<Library | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [sourceId, setSourceId] = useState("");
  const load = useCallback(() => {
    runLocal<any>("inspiration.references", {
      target_type: targetType,
      target_id: targetId,
    })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [targetType, targetId]);
  useEffect(load, [load, ctx.rev]);
  const add = async () => {
    setError("");
    try {
      setLibrary(await runLocal<Library>("inspiration.list", {}));
      setSourceId("");
      setAdding(true);
    } catch (e) {
      setError((e as Error).message);
      return false;
    }
  };
  const changed = () => {
    load();
    onChanged?.();
  };
  return (
    <div className="space-y-3 rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{r("references")}</h3>
        <Button fn="inspiration.list" size="sm" variant="outline" onClick={add}>
          <Plus />
          {r("add_reference")}
        </Button>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {r("snapshot_hint")}
      </p>
      {error && <Notice tone="error">{error}</Notice>}
      {data && !data.sources.length && (
        <p className="text-sm text-muted-foreground">{r("no_references")}</p>
      )}
      {data?.sources.map((s) => {
        const direct = data.links.find(
          (link) => link.source_id === s.source_id,
        );
        return (
          <div
            key={s.source_id}
            className="space-y-2 border-t border-border pt-3"
          >
            <button
              type="button"
              onClick={() =>
                ctx.go("content", { tab: "inspiration", source: s.source_id })
              }
              className="cursor-pointer break-words text-left text-sm font-medium text-primary-text hover:underline"
            >
              {s.title}
            </button>
            <p className="text-xs text-muted-foreground">
              {s.creator?.nickname} · {r("version")} {s.version}
            </p>
            <Observation label={r("why_save")} value={s.why_save} />
            <Observation
              label={r("adaptation_idea")}
              value={s.adaptation_idea}
            />
            <div className="flex flex-wrap items-center gap-3">
              <External url={s.url} label={r("open_source")} />
              {direct && !data.captured_at && (
                <Button
                  fn="inspiration.unlink"
                  size="sm"
                  variant="ghost"
                  onClick={async () => {
                    await runLocal("inspiration.unlink", { id: direct.id });
                    changed();
                  }}
                >
                  {r("remove_reference")}
                </Button>
              )}
            </div>
          </div>
        );
      })}
      <Dialog
        open={adding}
        onClose={() => setAdding(false)}
        title={r("add_reference")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setAdding(false)}>
              {tr("common.cancel")}
            </Button>
            <Button
              fn="inspiration.link"
              disabled={!sourceId}
              onClick={async () => {
                await runLocal("inspiration.link", {
                  source_id: sourceId,
                  target_type: targetType,
                  target_id: targetId,
                });
                setAdding(false);
                changed();
              }}
            >
              {r("link")}
            </Button>
          </>
        }
      >
        <Field label={r("select_source")}>
          <Select
            ariaLabel={r("select_source")}
            value={sourceId}
            onChange={setSourceId}
            options={(library?.sources || [])
              .filter(
                (s) =>
                  s.library_status !== "archived" &&
                  !data?.sources.some((ref) => ref.source_id === s.id),
              )
              .map((s) => ({ value: s.id, label: s.title }))}
          />
        </Field>
      </Dialog>
    </div>
  );
}
