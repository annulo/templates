// 本机函数共用的工具（文件名以 _ 开头：不作为可调用的函数，只给别的文件 import）。

import { L } from "./_i18n";
import { liveURL } from "./_creght";

/** 调一次模型，要它按 JSON 回答，解析出来。模型偶尔会包一层 ```json 或者前后带话，这里都兼容 */
export async function askJSON<T = any>(
  ctx: any,
  system: string,
  prompt: string,
): Promise<T> {
  const text: string = await ctx.llm({
    system: system + "\n\n只输出 JSON，不要任何解释，不要 Markdown 代码块。",
    prompt,
  });
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const raw = (fenced ?? text).trim();
  const start = raw.search(/[[{]/);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start < 0 || end < start)
    throw new Error(
      L(
        ctx,
        "模型没有按要求返回结构化结果，再试一次",
        "The model did not return a structured result — try again",
      ),
    );
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    throw new Error(
      L(
        ctx,
        "模型返回的结果解析不了，再试一次",
        "Couldn't parse the model's result — try again",
      ),
    );
  }
}

/** 渠道站点的访问地址：发布过就用正式域名（自定义域名优先），没发布过用预览地址 */
export async function siteBase(
  ch: { id?: string; project_id?: string; site_id?: string; preview_url?: string; live_url?: string },
  ctx: any,
): Promise<string> {
  if (ch.project_id && ch.site_id) {
    try {
      const live = await liveURL(ctx, ch);
      if (live) return live;
    } catch {
      // 读不到发布状态就用预览地址
    }
  }
  return (ch.preview_url ?? "").replace(/\/$/, "");
}

/** 读站点首页和几个站内页面的标题、描述、正文开头：给模型了解「这个站讲什么」用 */
export async function siteDigest(
  base: string,
  ctx: any,
  pages = 5,
): Promise<string> {
  if (!base) return "";
  const home = await fetch(base + "/").catch(() => null);
  if (!home?.ok) return "";
  const doc = ctx.html(await home.text());
  const host = /^https?:\/\/([^/]+)/.exec(base)?.[1] ?? "";
  const links = [
    ...new Set(
      doc
        .find("a[href]")
        .map((a: any) => {
          try {
            const u = new URL(a.attrs.href, base);
            return u.hostname === host && u.pathname !== "/"
              ? `${u.protocol}//${u.host}${u.pathname}`
              : "";
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    ),
  ].slice(0, pages) as string[];
  const one = (d: any, url: string) =>
    `## ${url}\n标题：${d.find("title")[0]?.text ?? ""}\n描述：${d.find('meta[name="description" i]')[0]?.attrs.content ?? ""}\n正文：${d.text().slice(0, 600)}`;
  const parts = [one(doc, base + "/")];
  const rs = await ctx.fetchAll(links);
  for (let i = 0; i < links.length; i++) {
    if (rs[i]?.ok) parts.push(one(ctx.html(await rs[i].text()), links[i]));
  }
  return parts.join("\n\n");
}

/** 项目资料：profile 表那一行（多行时取最早建的），还没填返回 { name: '' } */
export function profile(ctx: any): {
  goal?: string;
  signup_event?: string;
  activation_event?: string;
  paid_event?: string;
  id?: string;
  name: string;
  positioning?: string;
  business?: string;
  advantages?: string;
  company_role?: string;
  cooperation?: string;
  customer_types?: string;
  markets?: string;
  buyer_concerns?: string;
  profile?: string;
  audience?: string;
  tone?: string;
  keywords?: string;
  brand_terms?: string;
  created_at?: string;
} {
  let list: any[] = [];
  try {
    list = ctx.db.query("profile", { limit: 20 }).list ?? [];
  } catch {
    // 表还没建时当作没填
  }
  const at = (p: any) => Date.parse(p?.created_at || "") || 0;
  return [...list].sort((a, b) => at(a) - at(b))[0] ?? { name: "" };
}

/** 项目定位写成给模型看的一段话 */
export function projectBrief(p: any): string {
  const lines = [`产品：${p?.name ?? ""}`];
  for (const [key, label] of [
    ["positioning", "价值主张"],
    ["business", "解决的问题"],
    ["advantages", "可核实优势"],
    ["customer_types", "目标用户"],
    ["markets", "市场与语言"],
    ["buyer_concerns", "用户问题"],
    ["goal", "增长目标"],
    ["signup_event", "注册定义"],
    ["activation_event", "激活定义"],
    ["paid_event", "付费定义"],
    ["pricing", "价格与来源"],
    ["competitors", "竞品与替代方案"],
    ["tone", "内容语气"],
    ["keywords", "候选关键词"],
    ["source_url", "事实来源"],
    ["verified_at", "核实时间"],
  ])
    if (p?.[key]) lines.push(`${label}：${p[key]}`);
  return lines.join("\n");
}
