---
name: geo-visibility
description: AI 搜索检测（GEO / AEO）：拿问题在本机问 ChatGPT（联网搜索），看三件事：AI 怎么介绍这家公司（品牌问题，回答原文摆给用户看）、买家问问题时 AI 推荐了谁、可见度。结果在运营后台的 geo_questions / geo_runs / geo_results。用户说「GEO 检测」「AEO」「AI 搜索」「AI 引用」「ChatGPT 怎么说我们」「AI 说错了」「AI 回答里有没有我们」时用它。
---

# AI 搜索检测

按重要程度分三件事（页面「AI 搜索推荐」也是这个顺序，第 3 件并在第 2 块顶上）：

1. **AI 怎么介绍你**：买家知道公司名、产品或官网后让 AI 帮他了解、对比。品牌问题（`intent=brand`）只记事实：回答原文、引用的网址。
   **不判断对错**：什么是对的系统不知道，资料也可能过时（比如产品少录了一个），由用户看了判断；用户标出说错的地方（`geo_results.user_report`）后再交给你查。说错会让客户流失，最要紧。
2. **AI 推荐了谁**：还不知道这家公司的买家问的问题（其余 intent），回答引用了哪些网站。AI 引用谁大多和谷歌排名一样取决于页面质量和排名，页面上对照 GSC 排名和本站文章。
3. **可见度**：只按第 2 类问题算，回答引用了本站的比例。

业务表读用 `db_query` / `db_aggregate` 工具。**检测必须在本机发起**（`annulo run`），不要在 creght 的 Func 里发请求。

## 问题（geo_questions）

字段：`channel_id`、`question`、`intent`（`brand` 品牌问题 / `commercial` / `comparison` / `informational`）、`keywords`、`status`（active / paused）、`source`（auto / agent / manual）、`auto_key`。

- **品牌问题按资料套常见问法**：`annulo run geo.brandQuestions --input '{"channel_id":"<id>"}'`（页面「添加常见品牌问题」，先 `"preview": true` 列出来、用户勾选后带 `keys` 加），按公司名 / 品牌词、产品拼几个固定句式，语言跟重点市场，已有的不重复。检测只问启用的问题，不自动加。
  资料没填（`profile` 的 name / brand_terms）会报错，让用户先到「公司与产品」填。
- **推荐类问题交给你写**：照任务 `tasks/geo-questions.md`（页面「生成问题」）。写法归用户（`user/prompts/geo-questions.md`，没改过用 `prompts/geo-questions.md`），问题里不要带公司名。

## 检测：本机函数 geo.check

已经写成 `local/geo.ts`，**不要自己用 curl 一条条问、也不要自己写表**：

- `annulo run geo.check --input '{"channel_id":"<id>"}'`，可以加 `"model"` 临时换模型。一个问题半分钟到一分多钟，品牌问题先问。
- 用 Shuttle 设置 → 模型 里用户在页面「检测设置」选的服务商和模型（存 `geo_engines`，`provider` 是服务商 id），通过 `ctx.llm.fetch` 调 OpenAI Responses 的 `/responses` + `web_search`，
  **模板不存 key，不要让用户另填 key、也不要让用户把 key 发在对话里**。服务商要支持 Responses（OpenAI 官方、兼容的代理）；没选或不支持时函数会报错，带着去「检测设置」的入口。
  `annulo run geo.engines` 看设置和可选的服务商，改用 `annulo run geo.saveEngine --input '{"engine":"openai","provider":"<服务商 id>","model":"…"}'`。
- 品牌问题不做自动核对，回答原文在 `geo_results.answer`。用户问「AI 说得对不对」时，你可以把回答和资料对照着给他看，但要说明资料可能过时、最终由他判断，不要替他下结论写进表。
- 推荐类：`cited` = 引用链接命中站点域名；`mentioned` = 正文提到了品牌或域名但没给链接；`urls` 是回答引用的全部网址，`answer` 是完整回答。

`geo_runs` / `geo_results` 是历史流水，不要改（`fix_note` 除外，用 `geo.saveFix` 写）；问题库可以改、可以暂停。

## 修正 AI 说错的地方

用户在品牌问题下面写了「哪里说错了」、点「查原因」，照任务 `tasks/geo-fix-facts.md`：`geo.factsContext` 拿上下文（`report` 是用户写的，判断以它为准），
查这个说法从哪来（本站没写清楚 / 别家页面过时 / 系统里的资料没更新），`geo.saveFix` 存修正建议，页面显示在下面。只写建议，用户确认后再改站点。

## 收尾

回复用户时按三块的顺序说：品牌问题 AI 是怎么介绍的（摘要，提醒用户到页面上看原文、自己判断对错）；推荐类问题 AI 主要引用了哪些网站、本站被引用了几个；可见度。
没被引用的推荐类问题可以在页面上「写成选题」（`topics`，`source=geo`）。

每 7 天自动检测一次所有准备好问题的独立站（`schedules/geo.check.json`）。改完内容隔一两周再看，别当天连着重复检测。
