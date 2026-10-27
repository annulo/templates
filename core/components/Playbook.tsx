import { useCallback, useEffect, useState } from "react";
import { Lightbulb, MessageCircle, PenLine, Sparkles, WandSparkles } from "lucide-react";
import { openChat, runLocal } from "../lib/shuttle";
import { tr, numLocale } from "../lib/i18n";
import { Badge, Button, Notice, Skeleton } from "./ui";
import Markdown from "./Markdown";
import { TaskLaunchButton } from "./Task";

// 参考博主的风格卡（表 playbooks，任务 tasks/analyze-reference.md，设计见 core/features/playbooks/docs/playbooks.md）：
// 没有卡给「拆解风格」，有卡显示标题公式、开场、写法说明，能照它出选题、写一篇，回到拆它的那段对话接着改。

type Pattern = { pattern: string; example?: string; source_id?: string };
type Card = {
  id: string;
  name: string;
  summary?: string;
  platform?: string;
  content_type?: string;
  title_patterns: Pattern[];
  hooks: Pattern[];
  guide: string;
  fit?: string;
  avoid?: string;
  version?: number;
  chat_id?: string;
  generated_at?: string;
  uses: number;
  new_sources?: number;
};
const p = (key: string, vars?: Record<string, unknown>) =>
  tr("playbook." + key, vars);

function Patterns({
  label,
  list,
  onSource,
}: {
  label: string;
  list: Pattern[];
  onSource: (id: string) => void;
}) {
  if (!list.length) return null;
  return (
    <div className="space-y-2">
      <h4 className="text-sm font-medium">{label}</h4>
      <ul className="space-y-2">
        {list.map((x, i) => (
          <li key={i} className="rounded-lg bg-muted/50 px-3 py-2 text-sm">
            <div className="break-words">{x.pattern}</div>
            {x.example && (
              <div className="mt-1 break-words text-xs text-muted-foreground">
                {p("example")}「{x.example}」
                {x.source_id && (
                  <button
                    type="button"
                    onClick={() => onSource(x.source_id!)}
                    className="ml-1 cursor-pointer text-primary-text hover:underline"
                  >
                    {p("open_example")}
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function CreatorPlaybook({
  creatorId,
  subjectType = "creator",
  workspace,
  onSource,
  onChanged,
}: {
  /** 参考对象的 id：参考博主，或者 subjectType 是 competitor 时的竞品 */
  creatorId: string;
  subjectType?: "creator" | "competitor";
  workspace?: "website" | "social";
  /** 点标题公式、开场例子的「看原文」：博主是来源 id，竞品是页面网址 */
  onSource: (id: string) => void;
  onChanged: () => void;
}) {
  const site = subjectType === "competitor";
  const [card, setCard] = useState<Card | null | undefined>(undefined);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    runLocal<{ playbooks: Card[] }>("playbooks.list", { subject_id: creatorId })
      .then((r) => {
        setCard(r.playbooks[0] ?? null);
        setError("");
      })
      .catch((e) => setError(e.message));
  }, [creatorId]);
  useEffect(load, [load]);
  const changed = () => {
    load();
    onChanged();
  };
  const taskProps = {
    onFinished: changed,
    reqTitle: tr("inspiration.requirements"),
    reqHint: p("req_hint"),
    startLabel: tr("inspiration.start"),
    variant: "outline" as const,
  };
  const analyze = (
    <TaskLaunchButton
      {...taskProps}
      task="analyze-reference"
      input={{ subject_type: subjectType, subject_id: creatorId }}
      match={(run) => run.input?.subject_id === creatorId}
      title={p(card ? "reanalyze" : "analyze")}
      desc={p(site ? "analyze_desc_competitor" : "analyze_desc")}
      icon={WandSparkles}
      variant={card ? "outline" : "default"}
    >
      {p(card ? "reanalyze" : "analyze")}
    </TaskLaunchButton>
  );

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold">{p(site ? "title_competitor" : "title")}</h3>
      {error && <Notice tone="error">{error}</Notice>}
      {card === undefined && !error && <Skeleton className="h-24 rounded-xl" />}
      {card === null && (
        <div className="space-y-3 rounded-xl border border-dashed border-border p-5">
          <p className="text-sm text-muted-foreground">{p(site ? "empty_competitor" : "empty")}</p>
          {analyze}
        </div>
      )}
      {card && (
        <div className="space-y-5 rounded-xl border border-border p-5">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-words text-base font-semibold">
                {card.name}
              </span>
              {card.uses > 0 && (
                <Badge tone="ok">{p("uses", { n: card.uses })}</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                v{card.version ?? 1}
                {card.generated_at &&
                  ` · ${new Date(card.generated_at).toLocaleDateString(numLocale())}`}
              </span>
            </div>
            {card.summary && (
              <p className="break-words text-sm text-muted-foreground">
                {card.summary}
              </p>
            )}
          </div>
          {(card.new_sources ?? 0) > 0 && (
            <Notice tone="info">{p("new_sources", { n: card.new_sources })}</Notice>
          )}
          <div className="flex flex-wrap gap-2">
            <TaskLaunchButton
              {...taskProps}
              task="suggest-topics"
              reqKey="topic_requirements"
              input={{ playbook_id: card.id, ...(workspace || site ? { workspace: workspace ?? "website" } : {}) }}
              match={(run) => run.input?.playbook_id === card.id}
              title={p("topics")}
              desc={p("topics_desc")}
              icon={Lightbulb}
              variant="default"
            >
              {p("topics")}
            </TaskLaunchButton>
            <TaskLaunchButton
              {...taskProps}
              task="write-article"
              reqKey="notes"
              input={{
                playbook_id: card.id,
                type: card.content_type === "video" || card.content_type === "article" ? card.content_type : site ? "article" : "post",
              }}
              match={(run) => run.input?.playbook_id === card.id}
              title={p("write")}
              desc={p("write_desc")}
              icon={PenLine}
            >
              {p("write")}
            </TaskLaunchButton>
            {card.chat_id && (
              <Button size="sm" variant="outline" onClick={() => openChat(card.chat_id!)}>
                <MessageCircle />
                {p("continue")}
              </Button>
            )}
            {analyze}
          </div>
          <Patterns label={p("title_patterns")} list={card.title_patterns} onSource={onSource} />
          <Patterns label={p("hooks")} list={card.hooks} onSource={onSource} />
          <div className="space-y-2">
            <h4 className="flex items-center gap-1.5 text-sm font-medium">
              <Sparkles className="size-3.5" />
              {p("guide")}
            </h4>
            <Markdown text={card.guide} className="text-sm" />
          </div>
          {card.fit && (
            <div className="space-y-1.5">
              <h4 className="text-sm font-medium">{p("fit")}</h4>
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{card.fit}</p>
            </div>
          )}
          {card.avoid && (
            <div className="space-y-1.5">
              <h4 className="text-sm font-medium">{p("avoid")}</h4>
              <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{card.avoid}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
