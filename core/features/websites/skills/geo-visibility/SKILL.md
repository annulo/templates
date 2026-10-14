---
name: geo-visibility
description: AI 搜索检测（GEO / AEO）：拿问题在本机问 ChatGPT、DeepSeek、豆包、Kimi、元宝（网页版在用户自己的 Chrome 里问，或者 ChatGPT 接口联网搜索），看三件事：AI 怎么介绍这家公司（品牌问题，回答原文摆给用户看）、买家问问题时 AI 推荐了谁、可见度。结果在运营后台的 geo_questions / geo_runs / geo_results。用户说「GEO 检测」「AEO」「AI 搜索」「AI 引用」「ChatGPT 怎么说我们」「AI 说错了」「AI 回答里有没有我们」时用它。
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

- `annulo run geo.check --input '{"channel_id":"<id>"}'` 问「检测设置」里打开的所有 AI（同时问，每个 AI 一条 `geo_runs`，`batch_id` 一样）；
  `"engines":["deepseek","doubao"]` 只问这几个，`"model"` 临时换接口引擎的模型。一个问题半分钟到一分多钟，品牌问题先问。一个 AI 都没打开会报错：让用户在页面上选，不要替他打开。
- **引擎**（`geo_engines`，默认一个都不开，由用户挑自己的买家在用的）：
  - 网页版 `chatgpt` / `deepseek` / `doubao` / `kimi` / `yuanbao`：在用户自己的 Chrome 里问（`local/aichat.ts`，复制自 github.com/annulo/references 的 `aichat/`，用户要装 Annulo 浏览器插件、在 Chrome 里登录这些网站）。
    网站改版问不出来时，照 references 里 `aichat/MAINTAIN.md` 修 `local/_aichat_<网站>.ts`（先和 references 最新的比）。第一次用某个网站要在页面上「试一下」（`geo.testEngine`），Chrome 会弹窗请用户允许，定时任务弹不了。
  - 接口 `openai`：用 Annulo 设置 → 模型 里用户选的服务商和模型（`provider` 是服务商 id），`ctx.llm({ web_search: true })`，
    **模板不存 key，不要让用户另填 key、也不要让用户把 key 发在对话里**。服务商要支持 Responses（OpenAI 官方、兼容的代理、creght 平台、本机 Codex）。
  - `annulo run geo.engines` 看各引擎开没开、能不能用（`reason`）；用户让你打开某个时 `annulo run geo.saveEngine --input '{"engine":"deepseek","enabled":true}'`，网页版接着 `geo.testEngine`。
- 品牌问题不做自动核对，回答原文在 `geo_results.answer`。用户问「AI 说得对不对」时，你可以把回答和资料对照着给他看，但要说明资料可能过时、最终由他判断，不要替他下结论写进表。
- 推荐类：`cited` = 引用链接命中站点域名；`mentioned` = 正文提到了品牌或域名但没给链接；`urls` 是回答引用的全部网址，`answer` 是完整回答。
- 每条结果有 `engine`：不同 AI 的结果分开看，和「上一次」比也只和同一个 AI 的上一次比。品牌问题的回答用户看过 `seen_at` 有值（页面上点开那一行时记）。

`geo_runs` / `geo_results` 是历史流水，不要改（`fix_note` 除外，用 `geo.saveFix` 写）；问题库可以改、可以暂停。

## 用户就一条回答问你

用户在某个 AI 的回答下面点「问助手」（为什么没引用我们、怎么让它推荐、这里说错了、这个说法从哪来……），照任务 `tasks/geo-ask.md`：
`geo.askContext` 拿上下文（这家的回答、引用、搜了什么，别的 AI 对同一个问题怎么答的，用户标过的说错 `report`，公司资料），只回答他问的，
`geo.saveFix` 把结论存回这条回答，页面显示在下面。只写建议，用户确认后再改站点、写文章。

## 收尾

回复用户时按三块的顺序说：品牌问题各家 AI 是怎么介绍的（摘要，哪家和别家说法不一样，提醒用户到页面上看原文、自己判断对错）；推荐类问题各家 AI 主要引用了哪些网站、本站被引用了几个；每个 AI 的可见度。
没被引用的推荐类问题可以在页面上「写成选题」（`topics`，`source=geo`）。

每 7 天自动检测一次所有准备好问题的独立站（`schedules/geo.check.json`）。改完内容隔一两周再看，别当天连着重复检测。
