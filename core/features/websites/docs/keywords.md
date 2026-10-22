# 关键词机会：哪些词能做起来

页面「谷歌排名 / 搜索表现 → 关键词」（`components/Keywords.tsx`，外贸和产品运营的 `Search.tsx` 各加一个 tab）、本机函数 `local/keywords.ts`（纯函数在 `_keywords.ts`，测试 `publish/tests/keywords.test.mjs`）、
表 `keywords`、任务 `tasks/keyword-research.md`、写法 `prompts/keyword-research.md`、定时任务 `schedules/keywords.refresh.json`、查 Google 结果页的参考代码 `local/serp.ts`。改这块之前先读这篇；改了设计就同步改这里。

## 要回答什么

一个词值得做，三条同时满足：**有人搜**（有需求）、**能赢**（排得上去）、**和业务相关**（有采购或使用意图，我们真有这个产品）。
以前只有 GSC 里已经有曝光的词（`gsc.sync` 的搜索词选题），新站几乎没有；也没有「能不能赢」的判断。TradeMax 有关键词排名追踪（`serp`），我们没有（外贸 `docs/trademax.md`）。

## 原则：只摆事实，判断交给助手和用户

和 AI 搜索检测一样（`ai-search.md`）：能机械算出来的才自动算（GSC 排名第几、曝光多少、联想里有没有这个词），要「理解」的（相不相关、什么意图、归哪个主题）交给助手按任务做，过程看得见。
不编搜索量、不编难度：页面上没有「月搜索量」这一栏，因为没有付费接口就没有可信的数字。

## 流程

```
种子词 → 扩词（expand，函数）→ 筛词归主题（任务，助手）→ 分桶（refresh 每周按 GSC；serp 用户点了查 Google 结果页）→ 快赢补页面 / 新机会转选题 → 在做的看排名历史
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
5. **增长雷达**（外贸）：有快赢的词时出一条 `keyword_quick_win`、有新机会没写的出一条 `keyword_open`，去这个页签。

## Google 访问不了怎么办

国内网络连 `suggestqueries.google.com` 常常一直等不报错：先用 Google 问第一条，8 秒没回来或失败就整批换 Bing（`api.bing.com/osjson.aspx`，返回格式一样），`keywords.suggest_engine` 记着用的哪个。
Bing 的联想和 Google 不完全一样，但「有人这么搜」这个事实成立，拿来扩长尾词够用。两个都不通时只用 GSC 的词，返回里 `engine` 是空的，助手会告诉用户。

## 查 Google 结果页：分出新机会、有竞争、难（第二期）

`unchecked` 的词光看 GSC 判断不了能不能赢。「查 Google 结果页」（`keywords.serp`）在用户自己的 Chrome 里打开 Google 搜这个词（`serp.ts`、`_serp_*.ts`，复制自 annulo/references 的 `serp/`，
文件头记着提交；`ctx.browser.open({ profile: '@user' })`，要装 Annulo 浏览器插件，第一次要用户在 Chrome 里允许 www.google.com），只记前 10 名的事实：

- 每条的域名、类型：本站（GSC 属性、访问地址、GSC 里出现过的页面的域名）、在盯的竞品（外贸的 `competitors`）、B2B 平台、零售电商、论坛问答、社媒、百科、其它网站（类型按域名，列表在 `_serp_common.ts`）；
- 本站排第几（`serp_position`，不在前 10 是 0），弱位置（论坛问答、社媒、B2B 平台商品页）几个、强站（零售电商、百科）几个。

分桶仍是 `bucketOf`，GSC 有排名时以 GSC 为准；没有的按结果页：本站在前 3 是 `ranking`、4~10 是 `quick_win`；不在前 10 时弱位置 ≥ 3 是 `open`（Google 没找到像样的专门页面，认真写一篇有机会），
弱位置 ≤ 1 且强站 ≥ 4 是 `hard`，其余 `mixed`。前 10 名在页面上点开能看，用户自己判断规则说得对不对。

- **查哪些**：筛过的词里 GSC 分不出快赢、已排上的，和 GSC 没有排名的在做的词；没查过的先查，查过的 28 天后再查；一次最多 20 个。
- **慢慢查**：同一个窗口依次查，每个之间歇 6~10 秒；碰到人机验证就停，已经查到的存好，报错写着查了几个、让用户在 Chrome 里做完验证再来。
- **不放进定时任务**：会在用户屏幕上开 Chrome 窗口，定时任务碰到没允许的网站也直接报错。按钮由用户点。
- **排名历史**（`rank_history`）：在做的词每次 `refresh`（GSC 有排名时）和 `serp` 各记一条，同一天同一来源只留一条，最多 26 条；页面上显示最近两次的变化。

## 闭环：词 → 页面上线 → 这个词涨没涨

转成选题、补内容之后要能看出这个词有没有因此涨上来，所以挂在已有的「改动复查」上（`_review.ts`、`review.ts`），不另起一套：

- **上线时挂词**（`_keyword_track.ts` 的 `linkKeywords`，`trackChange` 建好改动后调）：
  发布文章 → 文章的 `topic_id` 就是转成选题的那个，这个选题的词挂上（记 `article_id`）；改标题描述、补内容 → 这个页面的词（`search_page_id` 一样，或者目标页面、曝光最多的页面就是它）挂上。
  挂上的词记 `change_id`、`live_at`、目标页面（没有的话用上线的页面），标成在做，以前的复查结论清掉。体检修复多是全站的事，不按词算。
- **复查时每个词各出结论**（`reviewKeywords`，`review.check` 复查页面时调）：和页面同样的两段时间（上线前 14 天、上线 3 天后起 14 天），按搜索词读 GSC（`_gsc.query` 的 `query` 过滤），
  规则在 `keywordVerdict`：以前没曝光、现在有了算变好；排名往前 2 位以上变好、往后 2 位以上变差，其余没变化（不看曝光：曝光跟着搜的人多少走，不是改动的效果，和页面复查同一个口径）；前后都没曝光是 `no_data`。结论写 `review_*`，标「新」。
- 页面上每个词写着目标页面、哪天上线、哪天复查，复查过的写结论和前后的排名、曝光、点击。
- 外贸的周报（`reports.data` 的 `keywords`）说这一期排名涨了、掉了的词和复查出结论的词；增长机会提醒快赢（`keyword_quick_win`）和新机会还没写的（`keyword_open`）。

## 以后

- 付费的搜索量、难度接口（DataForSEO 等）：用户自己填 key，没填不显示。先不做。
- 竞品 sitemap 里的产品和分类名当种子；GEO 推荐里被引用的别家页面当关键词缺口。
