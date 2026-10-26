// 网站运营（core/features/websites）用到的类型和本机函数封装：渠道里的网站、访问统计、网站检查、AI 搜索、Google 搜索表现。
// 每个启用这个模块的模板的 lib/shuttle.ts 整个导出这个文件（export * from './sites'），页面照旧从 lib/shuttle 引。
import { tr } from "./i18n";
import { runLocal, type Channel, type KeyRow } from "./shuttle";

/** 添加渠道时可选的 creght 站点 */
export type CreghtSite = {
  project_id: string;
  site_id: string;
  project_name: string;
  site_name: string;
  added: boolean;
};

export type DayRow = {
  day: string;
  pv_count: number;
  uv_count: number;
  ip_count: number;
};

export type VisitOverview = {
  summary: { pv_count: number; uv_count: number; ip_count: number };
  trend: DayRow[];
  breakdowns: Partial<
    Record<
      | "country"
      | "city"
      | "device_type"
      | "browser"
      | "os"
      | "referrer_host"
      | "channel"
      | "url",
      KeyRow[]
    >
  >;
};

/** 把一个 creght 站点作为独立站渠道加进运营后台 */
export const addSiteChannel = (project_id: string, site_id: string) =>
  runLocal<Channel>("channels.add", {
    type: "creght_site",
    project_id,
    site_id,
  });

/** WordPress：规范站点地址，给出应用密码该存的本机密钥名、现在有没有存 */
export const wpPrepare = (url: string) =>
  runLocal<{
    url: string;
    secret: string;
    has_secret: boolean;
    added: boolean;
  }>("channels.wpPrepare", { url });

/** 把一个 WordPress 站点加成渠道：先用应用密码验证一次 */
export const addWordPressChannel = (url: string, username: string) =>
  runLocal<Channel>("channels.add", { type: "wordpress", url, username });

/** 用现在存的应用密码验证一次已添加的 WordPress 渠道 */
export const wpVerify = (id: string) =>
  runLocal<{ ok: boolean; user?: string }>("channels.wpVerify", { id });

/** 当前 creght 账号下可以添加为独立站的站点 */
export const listCreghtSites = () =>
  runLocal<{ list: CreghtSite[] }>("channels.sites", {}).then((r) => r.list);

/** 一个独立站最近 days 天的访问概览：汇总、按天趋势、各维度 Top N。site 写成 <project_id>/<site_id> */
export const visitOverview = (site: string, days: number) =>
  runLocal<VisitOverview>("channels.overview", { site, days });

export type Severity = "high" | "medium" | "low";
export type IssueStatus = "open" | "fixing" | "fixed" | "ignored";
export type SiteIssue = {
  id: string;
  channel_id: string;
  run_id?: string;
  check: string;
  severity: Severity;
  title: string;
  detail?: string;
  /** JSON 数组字符串 */
  pages?: string;
  status: IssueStatus;
  updated_at?: string;
};
export type AuditRun = {
  id: string;
  channel_id: string;
  target_url?: string;
  pages_checked?: number;
  score?: number;
  issues?: number;
  /** 这次检查了、没发现问题的项，JSON：[{ check, name }] */
  passed?: string;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
};

// ---- GEO 可见度 ----

export type GeoQuestionStatus = "active" | "paused";
/** 拿来问 AI 的真实买家问题 */
export type GeoQuestion = {
  id: string;
  channel_id: string;
  question: string;
  /** commercial / comparison / informational / brand */
  intent?: string;
  keywords?: string;
  status: GeoQuestionStatus;
  /** auto 按资料自动生成 / agent / manual */
  source?: string;
  /** 自动生成的品牌问题的句式 key */
  auto_key?: string;
  created_at?: string;
  updated_at?: string;
};

/** 一次 GEO 检测的结果。可见度 = cited / questions */
export type GeoRun = {
  id: string;
  channel_id: string;
  engine?: string;
  model?: string;
  questions?: number;
  cited?: number;
  mentioned?: number;
  visibility?: number;
  /** 问了几个品牌问题 */
  fact_questions?: number;
  note?: string;
  /** 用的服务商 id；provider_name 是给人看的「谁在答」（ChatGPT · creght 平台、Claude（本机 Claude Code）） */
  provider?: string;
  provider_name?: string;
  /** 同一次检测的几个引擎各一条，batch_id 一样；老数据没有 */
  batch_id?: string;
  /** 这次检测的结论，JSON（GeoSummary） */
  summary?: string;
  /** 用户看过结果的时间；空 = 还没看 */
  seen_at?: string;
  started_at?: string;
  finished_at?: string;
  created_at?: string;
};

/** 一次检测的结论（local/geo.ts summarize） */
export type GeoSummary = {
  asker: string;
  brand_asked: number;
  brand_cited: number;
  questions: number;
  cited: number;
  mentioned: number;
  visibility: number;
  prev_visibility: number | null;
  failed: { question_id: string; question: string; error: string }[];
  gained: string[];
  lost: string[];
  fresh: string[];
};

export function geoSummary(r?: GeoRun | null): GeoSummary | null {
  try {
    const v = JSON.parse(r?.summary || "");
    return v && typeof v === "object" ? v : null;
  } catch {
    return null;
  }
}

/** 跑完的提示里那句话：「AI 搜索检测完成：推荐问题引用本站 2/8，可见度 25%，1 个没问成」 */
export function geoDoneText(r?: GeoRun | null): string {
  const sm = geoSummary(r);
  const text = !sm
    ? ""
    : (sm.questions
        ? tr("nav.geo_done_rec", {
            c: sm.cited,
            n: sm.questions,
            v: sm.visibility,
          })
        : tr("nav.geo_done_brand", { n: sm.brand_asked })) +
      (sm.failed.length
        ? tr("nav.geo_done_failed", { n: sm.failed.length })
        : "");
  return tr("nav.geo_done", { text });
}

/** 一次检测（几个 AI 同时问，每个一条 geo_runs、batch_id 一样）跑完的提示：一个 AI 和原来一样；几个时列出每个的推荐引用数 */
export function geoBatchDoneText(runs: GeoRun[]): string {
  if (runs.length <= 1) return geoDoneText(runs[0]);
  const list = runs
    .map((r) => {
      const sm = geoSummary(r);
      const who = (r.provider_name || r.engine || "").split(" · ")[0];
      return sm?.questions ? `${who} ${sm.cited}/${sm.questions}` : who;
    })
    .join(tr("nav.geo_done_sep"));
  const failed = runs.reduce((n, r) => n + (geoSummary(r)?.failed.length ?? 0), 0);
  return tr("nav.geo_done", {
    text: tr("nav.geo_done_multi", { n: runs.length, list }) + (failed ? tr("nav.geo_done_failed", { n: failed }) : ""),
  });
}

/** 一次检测的几条 geo_runs：和 r 的 batch_id 一样的；老数据没有 batch_id，就是它自己 */
export const geoBatchOf = (r: GeoRun, runs: GeoRun[]) =>
  r.batch_id ? runs.filter((x) => x.batch_id === r.batch_id) : [r];

/** 跑完了、有结论、用户还没看过的检测（侧栏标点、跑完的提示用）；老数据没有 summary 的不算 */
export const geoUnseen = (r?: GeoRun | null) =>
  !!r && !!r.finished_at && !!r.summary && !r.seen_at;

/** 一个问题在一次检测里的结果 */
export type GeoResult = {
  id: string;
  channel_id: string;
  run_id?: string;
  /** 用户看过这条回答的时间；空 = 还没看（品牌问题的格子标「新」） */
  seen_at?: string;
  question_id?: string;
  question: string;
  engine?: string;
  model?: string;
  /** 回答里引用了本站（链接命中站点域名） */
  cited?: boolean;
  /** 回答正文提到了品牌或域名，但没有给链接 */
  mentioned?: boolean;
  /** 引用到的本站 URL，JSON 数组字符串 */
  cited_urls?: string;
  /** 回答引用的其他域名（竞品），JSON 数组字符串 */
  competitor_domains?: string;
  answer_excerpt?: string;
  /** 完整回答（Markdown）；老数据没有，只有 answer_excerpt */
  answer?: string;
  /** 回答引用的全部网址，JSON 数组字符串；老数据没有 */
  urls?: string;
  /** AI 这次联网搜索的过程，JSON：[{ type, queries, url?, sources }]；老数据没有 */
  searches?: string;
  /** facts 品牌问题 / recommend 推荐类；老数据没有 */
  kind?: "facts" | "recommend";
  /** 用户标出的 AI 说错的地方（品牌问题，对错由用户判断） */
  user_report?: string;
  reported_at?: string;
  /** 助手写的修正建议（Markdown） */
  fix_note?: string;
  fixed_at?: string;
  tokens?: number;
  created_at?: string;
};

// ---- 搜索表现（GSC）和改站复查 ----

export type SearchOpportunity = "" | "low_ctr" | "striking_distance";
export type SearchQuery = {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
};
/** gsc.suggest 生成的新标题和描述 */
export type SearchSuggestion = {
  title: string;
  description: string;
  reason: string;
  current_title?: string;
  current_description?: string;
  created_at?: string;
};
/** gsc.expand 生成的补内容要点 */
export type SearchExpandBrief = {
  /** 页面没回答好的搜索意图 */
  gaps: string[];
  sections: { heading: string; what: string }[];
  faq: string[];
  /** 哪些站内页面该加链接指过来（from 是页面 URL）、锚文本 */
  internal_links: { from: string; anchor: string }[];
  summary: string;
  created_at?: string;
};
/** 一个页面在 Google 搜索里最近 28 天（和上一个 28 天）的表现，gsc.sync 写入 */
export type SearchPage = {
  id: string;
  channel_id: string;
  page: string;
  period_start?: string;
  period_end?: string;
  clicks: number;
  impressions: number;
  /** 0~1 */
  ctr: number;
  position: number;
  prev_clicks?: number;
  prev_impressions?: number;
  prev_ctr?: number;
  prev_position?: number;
  /** 非品牌口径：去掉品牌词和 site: 这类搜索指令后的点击、曝光、点击率、排名（老数据没有，退回原字段） */
  nb_clicks?: number;
  nb_impressions?: number;
  nb_ctr?: number;
  nb_position?: number;
  /** 品牌词和 site: 查询的曝光 */
  noise_impressions?: number;
  /** JSON 数组字符串：SearchQuery[]（不含噪音词） */
  top_queries?: string;
  opportunity?: SearchOpportunity;
  expected_ctr?: number;
  /** JSON 字符串：SearchSuggestion */
  suggestion?: string;
  /** JSON 字符串：SearchExpandBrief */
  expand_brief?: string;
  /** '' / fixing（助手改完推到预览）/ live（已上线，进了复查） */
  status?: "" | "fixing" | "live";
  synced_at?: string;
};

/** 按天的搜索表现（GSC），gsc.sync 写入 */
export type SearchDaily = {
  id: string;
  channel_id: string;
  date: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  synced_at?: string;
};

export type ChangeKind =
  "issue_fix" | "search_meta" | "search_content" | "article";
export type ChangeMetrics = {
  source: "gsc" | "visits";
  start: string;
  end: string;
  clicks?: number;
  impressions?: number;
  ctr?: number;
  position?: number;
  pv?: number;
};
/** 上线过的一次改动，到期由 review.check 对比改动前后 14 天 */
export type SiteChange = {
  id: string;
  channel_id: string;
  kind: ChangeKind;
  ref_table?: string;
  ref_id: string;
  title: string;
  /** JSON 数组字符串 */
  pages?: string;
  live_at: string;
  review_at: string;
  status: "waiting" | "reviewed" | "no_data";
  /** JSON 字符串：ChangeMetrics */
  before?: string;
  after?: string;
  verdict?: "better" | "flat" | "worse";
  summary?: string;
  reviewed_at?: string;
  created_at?: string;
};
