---
name: search-console
description: 搜索表现和改站复查：独立站在 Google 搜索里的点击、曝光、排名（Search Console，本机函数 gsc.*，表 search_pages、search_daily），找出点击率偏低的页面改标题和描述、差一点上首页的页面补内容，有搜索需求没页面的词进选题；上线过的改动（体检修复、新文章、改标题）17 天后自动对比前后数据（review.*，表 site_changes）。用户说「GSC」「Search Console」「搜索表现」「点击率」「排名」「关键词」「改标题」「补内容」「改完有没有效果」「复查」「挖关键词」「长尾词」时用它。
---

# 搜索表现（GSC）和改站复查

页面：后台左侧「搜索表现」（外贸叫「谷歌排名」），里面几个 tab：搜索表现、关键词、改动复查（外贸还有流量下滑、GA4）。

## 连接和关联

- Google 的授权在 Shuttle 的 **设置 → 连接** 里（「连接 Google」，只读）。本机函数用 `ctx.oauth('google')` 拿 token，你不用碰 token。连接按项目分开：这个项目只用得到这个项目里连的 Google 账号，别的项目连的看不到。一个项目可以连多个 Google 账号：属性列表合并这个项目所有账号的，每个属性自动用能看到它的那个账号；用户的网站在另一个 Google 账号下、列表里没有时，让用户在 设置 → 连接 里点「再连一个账号」（在别的项目里连过也要在这个项目里再连一次）。
  没连接时函数会抛「到 设置 → 连接 里连接 Google」，原样告诉用户。
- 每个独立站渠道要关联一个 Search Console 属性（`channels.gsc_property`，`sc-domain:example.com` 或 `https://example.com/`）：
  `annulo run gsc.properties` 看这个 Google 账号能看哪些属性；`annulo run gsc.link --input '{"channel_id":"…"}'` 按站点域名自动匹配，或带上 `"property"` 指定。
  站点还没加进 Search Console 的，要用户自己去 search.google.com/search-console 添加并验证（creght 站点可以用 DNS 或 HTML 标签验证，改标签属于改站代码）。
- GSC 只统计正式域名。站点没发布（只有预览地址）就不会有数据。

## 数据

- `annulo run gsc.sync --input '{"channel_id":"…","manual":true}'`：拉最近 28 天（结束日是 3 天前，GSC 有延迟）和上一个 28 天的页面数据、曝光前 50 的页面的主要搜索词，写进 `search_pages`（每个渠道每个页面一行）；
  同时按天拉最近 180 天写进 `search_daily`（每个渠道每天一行；已有的日期只更新最近 7 天，更早的留着当历史），
  并把「有搜索需求、没有页面」的词加进选题（见下面）。返回里的 `new_topics` 是这次新加了几个选题。
  定时任务每天跑一次（`schedules/gsc.sync.json`）；不带 `manual` 时没连 Google 会安静地跳过。
- `annulo run gsc.summary --input '{}'`：项目近 28 天点击、曝光、点击率、平均排名（按曝光加权）和上一周期（全站原始口径）。
- `annulo run gsc.range --input '{"channel_id":"…","start":"YYYY-MM-DD","end":"YYYY-MM-DD"}'`：直接读 GSC 指定起止日期的页面指标、按天趋势和前一段等长时间的指标，不写表。页面顶部的 7/30/90 天与自定义日期使用它；结束日期最晚为 3 天前。机会页面与选题仍使用每天同步的近 28 天数据。
- **噪音搜索词不算需求**：带搜索指令的（`site:`、`inurl:`、`intitle:`、`intext:`、`cache:`、`related:`、`info:`、`link:`、`filetype:`）和包含品牌词的（不区分大小写，≥ 3 个字符）。
  品牌词 = 属性域名的主体（`www.creght.com` → `creght`）+ 项目资料的 `profile.brand_terms`（逗号分隔，项目设置页可填）。
  `search_pages` 的 `nb_clicks / nb_impressions / nb_ctr / nb_position` 是去掉噪音词后的「非品牌」口径（`noise_impressions` 是去掉的曝光），
  机会、期望点击率、`top_queries` 都按这个口径；`clicks / impressions / ctr / position` 仍是原始数据。讲某个页面的表现时用 nb_*（没有就用原字段）。
- 机会（`search_pages.opportunity`）的口径，按排名的经验期望点击率（1 位约 28%、2 位 15%、3 位 10%、4–5 位 6%、6–10 位 3%）：
  - `low_ctr`：曝光 ≥ 100、排名在首页（≤ 10），点击率不到期望的一半 → 标题和描述没吸引人点，改标题描述；
  - `striking_distance`：排名 8–20、曝光 ≥ 50 → 差一点上首页，补内容（小节、FAQ、内链）比改标题更有用。
  期望值只用来挑明显偏低的页面，不要当成承诺给用户。
- 搜索词选题：当前 28 天按搜索词看，非噪音、曝光 ≥ 30、平均排名 > 15（站内没有排得上的页面）的词，每次同步按曝光最多加 10 个进 `topics`
  （`source: 'search'`，`search_query / search_impressions / search_position`）；同一个搜索词已有选题（任何状态）就不再加，还是 idea 的会更新曝光和排名。

## 关键词机会（挖词、筛词、分桶）

页面：「谷歌排名」里的「关键词」tab。表 `keywords`，本机函数 `keywords.*`（`local/keywords.ts`），设计见 `docs/keywords.md`。

- 用户要「挖关键词」「哪些词能做起来」「找长尾词」时，照任务 `tasks/keyword-research.md` 做（页面上的「挖一批关键词」就是它）：
  `keywords.expand` 扩词（下拉联想 + GSC 搜索词）→ `keywords.context` 拿待筛的词 → 你判断相关性、意图、主题 → `keywords.save` 存回。
- 分桶（`bucket`）由 `keywords.refresh` 按 GSC 算，只看事实：排前 3 是 `ranking`，排 4~30 且曝光 ≥ 10 是 `quick_win`，其余 `unchecked`。不要编搜索量、难度、排名。
- 快赢的词给它曝光最多的页面（`gsc_page` / `search_page_id`）补内容，走下面「补内容」的流程；还没排名的按主题 `keywords.toTopic` 转成选题（`topics.source=keyword`）。

回答「搜索表现怎么样」「哪些词带来流量」这类问题，用 `db_query` / `db_aggregate` 查 `search_pages`、`search_daily`，或者跑 gsc.summary，不要自己调 GSC 接口。

## 改标题和描述的流程

1. 页面上点「生成标题和描述」= 按任务 `tasks/search-meta.md` 开一段对话交给你：`gsc.pageContext` 读页面现有的 title / description 和它的搜索词，按写法写一版建议，`gsc.saveSuggestion` 存进 `search_pages.suggestion`（这一步只存建议，不改站）。
2. 用户点「交给助手改站」，你收到带着 search_pages id、页面和建议的一句话：
   - 按 websites skill 的「改站代码」把渠道站点拉到 `$HOME/.shuttle/sites/<site_id>`，只改这个页面的 `<title>` 和 meta description（creght 站点在页面的 metadata / head 里，见 creght skill），不动正文和别的页面；
   - `creght push` 推预览，把 `search_pages` 这条的 `status` 改成 `fixing`（update 传完整 body），告诉用户去预览确认；**不要 publish**。
3. 用户发布后在页面上点「已上线，开始复查」= `review.track({ kind: 'search_meta', ref_id, channel_id })`，status 变成 `live`，进改动复查。

## 补内容的流程（striking_distance）

1. 页面上点「补内容」= 按任务 `tasks/search-expand.md` 开一段对话交给你：`gsc.pageContext`（`related: true`）读页面的标题、H1、正文、小标题、非品牌搜索词和同渠道相关的页面，写一份要点，`gsc.saveBrief` 存进 `search_pages.expand_brief`：
   `{ gaps（没回答好的搜索意图）, sections: [{ heading, what }], faq, internal_links: [{ from, anchor }]（哪些站内页面该加链接指过来）, summary }`。
2. 用户点「交给助手改页面」，你收到带着页面 URL、site_ref、要点全文的一句话：
   - 按 websites skill 的「改站代码」把渠道站点拉到 `$HOME/.shuttle/sites/<site_id>`，按要点改这个页面的内容（加小节、FAQ），在要点列的页面里加内链；**不改页面 URL**，不编造页面和项目资料里没有的事实；
   - `creght push` 推预览，把这条 search_pages 的 status 改成 `fixing`，告诉用户去预览确认；**不要 publish**。用户发布后在页面上点「已上线，开始复查」（`review.track` 的 kind 是 `search_content`）：复查从真正上线的时间算起。

## 改站复查（site_changes）

一条改动上线后，过 17 天（GSC 延迟 3 天 + 改动后 14 天）对比改动前后各 14 天的数据，写结论。**上线的时刻自动记录**：

- 体检：`audit.run` 发现之前的问题没了（标成 fixed）时记一条 `issue_fix`（体检用的是预览地址、站点还没发布时不记）；
- 文章：第一次发到一个网站成功时记一条 `article`（`local/_publish.ts` 的 `publishTo`）；
- 改标题描述：用户点「已上线」时记 `search_meta`；
- 补内容：用户上线后点「已上线，开始复查」记 `search_content`（和 `search_meta` 一样对比这个页面前后的点击、排名）。
- 其他改动（你改了站、用户发布了）要进复查：`annulo run review.track --input '{"kind":"issue_fix","ref_id":"<相关记录 id>","channel_id":"…","title":"一句话说改了什么","pages":["https://…"],"live_at":"上线时间 ISO8601"}'`。同一个 ref 已有等数据的就不会重复建。

`review.check` 每天 9 点跑（也可以 `--input '{"id":"…"}'` 立刻复查某一条），口径写在 `local/review.ts` 开头：

- 优先 GSC（渠道关联了属性、连了 Google）：涉及页面的点击、曝光、点击率、排名；没有 GSC 用 creght 访问统计里这些页面的 PV；
- 主指标（点击 / PV）变化 > +15% 是 `better`，< -15% 是 `worse`，其余 `flat`；点击掉了但点击率没掉（曝光跟着掉）算 `flat`：是搜索量整体变了；
- 样本太少（前后加起来点击或 PV < 10）是 `no_data`。

结论是统计上的粗判断，同期还有别的因素（季节、别的改动、算法更新）。给用户讲复查结果时说清楚是前后对比，不要说成因果。
