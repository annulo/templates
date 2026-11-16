# 竞品监控

参考 TradeMax「竞对分析 / 竞品监控 → 输出内容」（2026-10 规划第三期）。

## 数据

- `competitors`：一家一行。起步向导确认过的竞品（`onboarding.competitors`）每次 `scan` 开头按域名去重带过来，`source=onboarding`；手动加的 `source=manual`；AI 推荐的 `source=agent`（在 AI 搜索回答里被引用过的是 `geo`）。
- 第一次读完记 `baseline_at`，那时已有的页面**只存指纹**（`known`，FNV-1a 32 位，几千个页面也就几十 KB），不写进页面表：在线项目的表一条条写很慢。
- `competitor_pages`：只放基线之后新出现的页面（`is_new`），`seen` 去掉「新」标识，`topic_id` 是转成的选题。一次最多记 300 个（改版、换域名时会一下冒出几千个）。
- 竞品分析存在 `research_findings`（`kind=competitor_report`，起步向导的竞品调研报告也是这个 kind），`competitors.reports` 列出来。

## 读完马上有东西看、新页面带标题

- 每次读完，最近更新的 10 个页面（按 sitemap 的 lastmod，去掉「其他」类）读出标题和描述，存在 `competitors.recent`：刚加进监控、还没有新页面时，「新发现」一栏列各家最近更新的页面，竞品那一行展开也有。上次读过的标题不重读。
- 新发现的页面一次最多读 30 个的标题和描述（`metaOf`：og:title 优先，再 `<title>`、meta description），之后转选题、出选题、周报都直接用。
- 多语言站同一页的几个语言版本（`/jp/x`、`/de/x`、`/x`）算一页（`pageKey` 去掉打头的语言段）：「最近更新」只留一个（没有语言段的、英文的优先），一次检查里新上的几个语言版本也只记一条。

## 从新发现出选题

新发现能多选，「从选中的 N 条出选题」交给助手（任务 `suggest-topics`，参数 `competitor_page_ids`）：`topics.context` 给这几页，助手按买家的问题出我们自己的选题（几页讲同一件事的合成一个），出处记 `competitor_page`、`competitor`，`topics.save` 把这几页标成已转选题、看过。单条「转选题」照旧。

## 打法卡（风格卡）

每家一张打法卡：竞品那一行点「打法卡」展开，「拆解打法」交给助手（共用模块 `core/features/playbooks`，任务 `analyze-reference`，`subject_type=competitor`）。
它读 `competitors.analysisContext`（概况、最近更新、新发现）再挑几页读正文，拆出在发力什么、产品页 / 方案页的结构、标题和开头怎么写、语气、不该学的，存成卡。
卡上能「照这张卡出选题」「照这张卡写一篇」（选题记 `playbook_id`，写的时候 `content.context` 带上卡）；拆完以后它又上了新页面，卡上提示重新拆解。竞对总览读各家的卡，没卡的建议去拆。

## 周报

`reports.data` 带 `competitors`（`competitors.week`：这一期各家新上的页面，按类型数、带标题），周报写一段「竞品本周动向」。

## 读法

robots.txt 里的 `Sitemap:` → 没有就试 `/sitemap.xml`、`/sitemap_index.xml`、`/wp-sitemap.xml`；sitemap 索引展开，最多 30 个 sitemap、8000 个页面。
页面类型按网址猜（`kindOf`）：`/product(s)/`、`/shop/` 这类是产品页，`/blog/`、`/news/`、`/case/` 是文章，一级路径和 `/solutions/`、`/industries/` 是落地页。猜不准不要紧，只是筛选用。
没有 sitemap 的站读不了，错误写在 `competitors.error` 上给用户看。以后要读 RSS 或首页链接，加在 `crawl` 里。

## 分析交给助手

竞对总览（`tasks/competitor-overview.md`）、规格对比（`tasks/competitor-compare.md`）要读很多页面、做判断，用户要看过程，写成任务；本机函数只给页面清单（`competitors.pages` 现读 sitemap）和存档（`saveReport`）。
这两件是按固定流程出分析，不是用户有写作偏好的产出，没有「AI 要求」写法文件。对标文章走现成的写文章任务。

## AI 推荐竞品

用户没有竞品（起步向导现在不再生成竞品），或者想多找几家：「AI 推荐竞品」交给助手按任务 `tasks/competitor-suggest.md` 做（要联网搜、打开官网核实、判断是不是同行，过程要看得见，所以是任务，不在函数里调模型）。

- `competitors.suggestContext` 给线索：项目资料、产品、自己的域名、已有的（含不要的）、AI 搜索检测里回答引用的别家域名（`geo_results.competitor_domains`，已去掉平台和媒体）、谷歌带来曝光的搜索词；
- `competitors.saveSuggestions` 存成 `status=suggested`（`kind` 分 direct / brand / channel，`reason`、`evidence`），已有的域名、自己的网站、平台和媒体（`NOT_COMPETITOR`）跳过；
- 推荐的不读、不算在盯（`watching`）：用户点「加进监控」（`accept`，改成 active 马上读一次）才开始；「不要」（`reject`）留着 `status=rejected`，下次推荐时按域名跳过。手动加一个推荐过或不要过的域名，直接转成在盯；
- 这是按固定流程找同行，不是用户有写作偏好的产出，没有「AI 要求」。增长雷达里：没有在盯的竞品给一条直接交给这个任务，有推荐没确认的提醒去看。

## 以后

- AI 搜索推荐（GEO）页上，回答里被推荐的竞品旁边直接「加进监控」（现在要走 AI 推荐竞品）。
- 竞品的社媒账号（LinkedIn、Facebook）也盯起来，复用产品模板参考博主的同步。
