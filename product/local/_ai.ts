// 本机函数共用的工具（文件名以 _ 开头：不作为可调用的函数，只给别的文件 import）。

import { L } from "./_i18n";
// 网站地址、读网站讲什么在网站运营共用模块（local/_site.ts），这里转出去，老代码照旧从 _ai 引
export { siteBase, siteDigest } from "./_site";

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
