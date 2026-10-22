# 关键词机会：哪些词能做起来

页面「谷歌排名 / 搜索表现 → 关键词」（`components/Keywords.tsx`，外贸和产品运营的 `Search.tsx` 各加一个 tab）、本机函数 `local/keywords.ts`（纯函数在 `_keywords.ts`，测试 `publish/tests/keywords.test.mjs`）、
表 `keywords`、任务 `tasks/keyword-research.md`、写法 `prompts/keyword-research.md`、定时任务 `schedules/keywords.refresh.json`。改这块之前先读这篇；改了设计就同步改这里。

## 要回答什么

一个词值得做，三条同时满足：**有人搜**（有需求）、**能赢**（排得上去）、**和业务相关**（有采购或使用意图，我们真有这个产品）。
以前只有 GSC 里已经有曝光的词（`gsc.sync` 的搜索词选题），新站几乎没有；也没有「能不能赢」的判断。TradeMax 有关键词排名追踪（`serp`），我们没有（外贸 `docs/trademax.md`）。

## 原则：只摆事实，判断交给助手和用户

和 AI 搜索检测一样（`ai-search.md`）：能机械算出来的才自动算（GSC 排名第几、曝光多少、联想里有没有这个词），要「理解」的（相不相关、什么意图、归哪个主题）交给助手按任务做，过程看得见。
不编搜索量、不编难度：页面上没有「月搜索量」这一栏，因为没有付费接口就没有可信的数字。

## 流程

```
种子词 → 扩词（expand，函数）→ 筛词归主题（任务，助手）→ 分桶（refresh，函数，每周）→ 快赢补页面 / 其余转选题 → 在做的每周看排名
```

1. **扩词** `keywords.expand`：种子默认取项目资料 `keywords`、产品的关键词和名称、产品分类（助手可以自己挑种子再跑）。
   每个种子词本身 + 拼上修饰词去拉下拉联想：外贸（产品有起订量、交期、认证）默认 manufacturer / supplier / factory / wholesale / OEM / custom / price…，其它业务默认 best / vs / alternative / pricing…；写法里给了 `modifiers` 就用写法的。
   再把本站 GSC 最近 28 天曝光前 30 的非品牌搜索词带进来（`sources` 记 `gsc`）。新词 `status=raw`，按小写去重，一次最多新加 300 个。
2. **筛词** 任务 `keyword-research`：助手拿 `keywords.context`（待筛的词、已有主题、不要过的词、项目资料、产品、站内有曝光的页面），每个词给结论（`keep`、`intent`、`cluster`、`note`、可选 `target_page`），`keywords.save` 存回，可以补少量它确定买家会搜的词（`sources=agent`）。
   「需求」类任务：写法（目标市场、要哪类词、修饰词）用户能改，在页面「挖一批关键词」弹窗里。保存时存 `ctx.chat_id`，页面「继续对话」回到这段对话接着调。
3. **分桶** `keywords.refresh`（扩词后顺手跑一次，之后每周一次）：GSC 最近 28 天按 `query` 和 `query + page` 各读一次，词完全一样（小写、合并空白）才算。
   - `ranking`：排前 3；
   - `quick_win`：排 4~30、曝光 ≥ 10 —— 已经有页面在排，补内容最快见效；
   - `unchecked`：没数据、排太后、曝光太少。
   `score` 只用来在桶里排序：快赢按曝光乘离首页远近（4~10 位 ×1，11~20 ×0.7，21~30 ×0.4）。新进快赢的词标「新」。
4. **落地**：快赢的词有 `search_page_id`（曝光最多的页面在 `search_pages` 里的记录）就直接「写补内容要点」（复用 `search-expand` 任务，后面改页面、复查和谷歌排名一套）；
   别的按主题「转成选题」（`keywords.toTopic`：一个主题一个选题，标题用曝光最多的词，`topics.source=keyword`），这几个词标成在做。
5. **增长雷达**（外贸）：有快赢的词时出一条 `keyword_quick_win`，去这个页签。

## Google 访问不了怎么办

国内网络连 `suggestqueries.google.com` 常常一直等不报错：先用 Google 问第一条，8 秒没回来或失败就整批换 Bing（`api.bing.com/osjson.aspx`，返回格式一样），`keywords.suggest_engine` 记着用的哪个。
Bing 的联想和 Google 不完全一样，但「有人这么搜」这个事实成立，拿来扩长尾词够用。两个都不通时只用 GSC 的词，返回里 `engine` 是空的，助手会告诉用户。

## 第二期（还没做）：查 Google 搜索结果页，分出「新机会」和「难」

`unchecked` 的词光看 GSC 判断不了能不能赢。第二期在用户自己的 Chrome 里打开 Google 搜索结果页（`ctx.browser.open({ profile: '@user' })`，和 aichat 一样，用户已经能上 Google），记前 10 名的事实：
域名、页面类型（产品页、分类页、文章、论坛、B2B 平台、大品牌）、有没有在盯的竞品、我们排第几。按规则把 `unchecked` 分成 `open`（前 10 里有论坛、B2B 平台、内容薄的小站）和 `hard`（大品牌、Amazon 霸屏）。
读结果页的代码做成参考代码（`annulo/references` 加 `serp/google/`，验证日期和 `MAINTAIN.md`），复制进 `local/`。量要小（一次几十个词）、间隔长，遇到验证码就停下来提示用户。
在做的词 GSC 没曝光的，每周用它抽查排名，存每周快照画趋势。

## 以后

- 付费的搜索量、难度接口（DataForSEO 等）：用户自己填 key，没填不显示。先不做。
- 竞品 sitemap 里的产品和分类名当种子；GEO 推荐里被引用的别家页面当关键词缺口。
