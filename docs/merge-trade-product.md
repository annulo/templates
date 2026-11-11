# 外贸和产品运营合成一份源码

外贸（私有仓库 `shuttle-template/templates/trade`）和产品运营（本仓库 `product/`）是从同一套运营后台分出去的，到 2026-11-11 两边同名文件 45 个、41 个已经改得不一样，一个功能常要两边各做一遍。
这篇是把它们合成一份源码的计划和进度。合并期间改这两个模板先读这篇。

## 定下来的（2026-11-11）

1. **一份源码，仍发两个模板**。共用的进 `core/`，各自独有的功能做成 `core/features/<模块>/`，模板目录只剩行业文件：
   `annulo.json` / `shuttle.json`、`ANNULO.md` / `SHUTTLE.md`、`lib/edition.ts`（导航、渠道、向导）、文案里的行业差异、入门任务。
   不做「一个模板、向导里选行业」：那样老项目要换模板（`template/switch`），还要改 Annulo 的默认模板。
   产物里的文件路径不变，用户照常在 设置 → 项目 里升级，不用改 Annulo。
2. **外贸独有的功能（线索、潜客、竞品…）可以放进本仓库（公开）的 `core/features/`**。私有仓库最后只剩外贸的行业文件和发布到 creght 的脚本。
3. **`growth` 重名：外贸保留 `growth.*`**（增长雷达：`scan`、`list`、`mark`、`markSeen`，定时任务 `growth.scan`），
   **产品运营的改名为 `campaigns.*`**（函数名不变，只换前缀；原本想拆成 `opportunities.*` / `campaigns.*`，但 `context` 一次给两边的数据、好几处都靠它，拆开要复制或互相引用，就整个改名），文案命名空间 `growth` 也改成 `campaigns`。产品运营用户少，改名的影响小。
4. **合并期间两个模板都不开发新功能**，只修 bug（修在哪份就按当时的进度修，合过的修 core）。

## 怎么保证没改坏

`publish/merge_check.py`：把 blank、creator、product、trade 按发布的方式组装（工作区的文件，和 `--local` 一样），和存下的基准比。

```bash
python3 publish/merge_check.py save                        # 存基准（.build/merge-baseline/）
python3 publish/merge_check.py diff                        # 和基准比，列出产物里多了、少了、变了的文件
python3 publish/merge_check.py diff trade --show local/content.ts
```

- 挪文件（第 1 步）：**产物一个文件都不许变**（JSON 按内容比，文案挪进模块后键的顺序会变，不算）。
- 合并文件（第 2 步）：只许变这次要合的文件，变的内容逐个看过；看过、确认要这么变了，再 `save` 更新基准。
- 另外每一批跑一次 `npm run check`（外贸要点名：`npm run check trade`，它 2026-11-11 前没做过类型检查，老错误合并时都修了，2026-11-11 起四个模板都没有类型错误）和 `publish/tests/` 里相关的测试；动了页面或本机函数的，用 `--local` 在一个外贸项目、一个产品运营项目上各点一遍。
- 基准包括工作区里别人还没提交的改动：别人提交、改了 core 之后，先 `diff` 确认变的都是他们的，再 `save`。

## 第 1 步：独有功能挪进模块（产物不变）

模块里的文件挪到 `core/features/<模块>/` 下的同一路径，文案按命名空间挪进模块的 `messages/*.json`（括号里是挪的命名空间），模板的 `targets.json` 启用它。
模块之间、模块和模板之间的依赖照现在的写，「有就用」的改写放到第 2 步。

外贸的：

| 模块 | 文件 |
|---|---|
| `leads` 询盘（`leads` `formhook`） | `backend/func/leads_hook.ts`、`components/FormHookCard.tsx`、`views/Leads.tsx`、`local/leads.ts`、表 `leads` `lead_hooks`、定时 `leads.sync` `leads.judge`、skill `leads`、任务 `reply-lead` `research-lead`、写法 `reply-lead`、`docs/leads.md` |
| `prospects` 潜客（`prospects`） | `views/Prospects.tsx`、`local/prospects.ts` `_apollo.ts` `_webfind.ts`、表 `prospects` `prospect_batches`、任务 `draft-icp`、`docs/prospects.md`（用 `leads` 表） |
| `competitors` 竞品（`competitors`） | `views/Competitors.tsx`、`local/competitors.ts`、表 `competitors` `competitor_pages`、定时 `competitors.scan`、任务 `competitor-*`、`docs/competitors.md` |
| `knowledge` 知识库（`knowledge`） | `views/Knowledge.tsx`、`local/knowledge.ts`、`lib/extract.ts`、任务 `summarize-knowledge`、`docs/knowledge.md` |
| `radar` 增长雷达（`growth`） | `views/Growth.tsx`、`local/growth.ts`、表 `growth_items`、定时 `growth.scan`、`docs/growth-radar.md` |
| `dashboard` 看板（`board`） | `components/Dashboard.tsx`、`local/dashboard.ts`、`docs/dashboard.md`（`pages/Index.canvas.tsx` 是首页的预览，留在模板） |
| 待定 | `local/images.ts`（AI 配图）、`_overlap.ts`（内容去重）、`_catalog.ts`（产品目录）：内容中心在用，第 2 步跟 `content.ts` 一起看是进 core 还是进模块 |

产品运营的（`growth` 的改名放在第 2 步，这一步只挪）：

| 模块 | 文件 |
|---|---|
| `campaigns` 增长机会和运营主题（`growth` `marketing`） | `views/Campaigns.tsx` `GrowthPlanning.tsx` `Opportunities.tsx`、`MarketingWorkspace.tsx`、`local/growth.ts` `_growth.ts` `marketing.ts`、表 `campaigns` `channel_strategies` `growth_opportunities` `growth_reviews` `marketing_plans` `seo_targets`、任务和写法 `plan-/produce-/review-campaign` `seo-research` `seo-page-plan` `seo-page-implement`、定时 `marketing.planReviews`、skill `product-growth` `product-seo`、`docs/product-growth.md` `marketing-workflow.md` |
| `inspiration` 灵感库 | `local/inspiration.ts`、表 `reference_creators`、定时 `inspiration.sync`、任务和写法 `review-inspiration`、`docs/content-inspiration.md`（和 `playbooks` 一起用） |
| `metrics` 转化指标 | `views/ProductMetrics.tsx`、`local/metrics.ts`、表 `product_metrics_daily` |

产品运营的 `_growth.ts` 被 `products`、`profile`、`today`、`reports` 引用，挪进 `campaigns` 模块后这几处暂时还依赖它，第 2 步拆。
`GrowthDashboard.tsx`（首页的数据看板）留在产品运营，第 2 步和外贸的 `dashboard` 模块、首页一起看。
`radar` 和 `campaigns` 的文案都在 `growth` 命名空间下（两个模板各用一个，现在不冲突），第 2 步产品运营改名时把它的挪到新名字下，之后两个模块才能在同一个模板里一起启用。

## 第 2 步：合并分叉的文件

**以外贸那份为底**，把产品运营的差异补进去，合好的放进共用模块 **`core/features/business/`**（外贸和产品运营都启用，两个模板删掉自己那份）。
不放 `core/`：自媒体模板也有同名的任务、本机函数，放进 core 会和它同路径冲突。外贸老用户多，以它为底，改过这些文件的用户升级时冲突最少。
数据表取两边字段的并集，只加字段，不改名、不删。行业不一样的地方按「有这个模块 / 有这个字段就用」写，实在分不开的放进 `lib/edition.ts` 这类行业文件。

合并任务的写法：外贸的内容全留着；只有一边有的（产品运营的运营主题、灵感、平台表现，外贸的查重、企业资料、竞品）写成「上下文里有 X 时 / 项目里有 X 时」，
每个项目只走到自己有的那部分；行业用词换成两边都通的（买家 → 客户）。

**写法文件（`prompts/`）不合**：写法是「怎么写」，内容就是行业的（外贸写给买家、讲起订量交期认证，产品运营写给用户、讲功能和场景），留在各模板当行业文件。

从小到大，每一批合完发一版两个模板：

1. 任务：`write-article` `suggest-topics` `revise-article` `rewrite-article`（已合）；
   `weekly-report` `draft-profile` `import-products` 依赖各自的周报数据和资料字段（询盘、公司角色、起订量 / 注册激活、定价、功能），等第 2、4 批合完数据表和函数再看，可能一直是行业文件；
2. 数据表：`topics` / `articles` 取并集（外贸为底，加上产品运营的 `campaign_id` `opportunity_id` `product_id` `account_role_key` `plan_key` `marketing_plan_id`），`assets` / `reports` 两边一样，都进 `business`（已合）。
   **`profile` / `products` 留在各模板当行业文件**（2026-11-11 看过以后改的）：它们就是行业的数据模型（外贸：公司角色、合作方式、型号、规格、起订量、交期、认证；产品运营：激活 / 注册 / 付费事件、定价、功能、能力边界、案例），
   连同名字段的说明都按行业写；合成并集会让外贸的表里出现「注册事件」，助手读表结构会被带偏。两边同名的字段保持同名，合本机函数时公共字段统一处理、行业字段有就用。
   业务表每行是一份 JSON（`internal/localdb`），表文件只是声明，加字段不用迁移；
3. 产品运营 `growth` 改名（已做）：`local/growth.ts` → `campaigns.ts`，页面、任务、skill、测试、`ANNULO.md` 里的 `growth.*` 改成 `campaigns.*`，文案命名空间一起改；`changelog.yaml` 写了；`_growth.ts`（取行、报错、校验网址和日期的小工具，外贸没有同名文件）先不动，第 4 批合函数时挪；
4. 本机函数（`business/local/`）：以外贸为底；只有一边有的模块用「有就用」：`require('./market' + 'ing.ts')` 这样拼出路径，没有这个文件的模板打包不报错（照 `websites/local/geo.ts` 的 `_geo_brand`）；
   按行业写的部分放 **行业文件**，每个模板一份：`local/_industry.ts`（项目资料拼给模型的标签）、`local/_checklist.ts`（起步步骤 `setupSteps`、每天的待办 `dailyItems`）。
   - 已合：`content-workspace`、`_ai`、`_research`、`lib/contentWorkspace`、`today`（外贸的清单引擎，产品运营收起清单记的 `hidden` 也认）；
   - **`profile.ts`、`products.ts` 不合，和资料、产品表一起是行业的**：两边同名不同义（外贸 `products.context` 读网站准备导入、`save` 一次一批、有分页 `page`；产品运营按 id 取一个、存一个、还有 `saveUseCase`；
     `profile.context` 外贸读全部网站、产品运营读一个网址带产品和用户场景，`save` 一个只存非空、一个能清空还校验），页面、向导、任务都依赖各自的行为，硬合要重新设计接口、改两边所有调用；
   - `topics`（已合）：外贸为底；标题去重改成不分大小写、只和同一工作区（或没归属）的比（产品运营的做法，外贸以前是全局按原文比）；网站选题和已有文章查重（外贸的 `_overlap`，产品运营新得到）；
     上下文是外贸那套（资料、已有选题和文章、网站摘要）加上运营主题模块的；灵感来源、竞品新页面有模块才用；网站选题记 `target_platform: website`、社媒记 `content_type: post`。`_catalog`、`_overlap` 一起进 `business`；
   - `reports`（已合）：外贸为底，询盘、竞品、转化、运营主题有模块才带；`save` 的 summary 改成可选（产品运营以前不要求）；
     产品运营的周报数据多了体检、改站复查、AI 搜索、关键词，「发布的内容」换成外贸的格式，上一期周报改用外贸的取法（最近的一期，周期重叠也算）；
   - `content`（已合）：两边的都叠上——外贸的长文查重（`existing_posts`、`overlap`、`duplicate_of`）、产品按相关度和最近用过几次排（`recent_uses`）、存完长文的 `checks`、保存时给工作区和目标账号；
     产品运营的选题类型跟选题走、运营主题 / 增长机会 / 账号策略 / 营销计划 / 用户场景（有运营主题模块才给）、改写也留写作依据、灵感来源、视频封面、简报保留营销计划带进来的字段；
     社媒限制按内容类型取（插件 0.9.0 起的 `fieldsFor`，外贸 B 站长文以前误用了视频的限制）；新文章只记有值的关联字段；产品字段空的不给（两个行业的字段不一样，库里读出来缺的是 null）；
     测试 `publish/tests/business/content.test.mjs`（内存里的假数据库，外贸和产品运营的产物各跑一遍）；
   - `_growth.ts`（取行、报错、校验网址和日期）只有产品运营的文件用，留在 `campaigns` 模块；
   - **测存表的函数别在用户项目里直接写再删**：2026-11-11 测 `topics.save` 时，临时脚本「恢复」时把两个实验项目的全部选题写了一遍（`updated_at` 变了、没出处的多了空 `origins`），
     从 SQLite 的 WAL 里取回测试前的版本才恢复。要测写入就用测试（`publish/tests/`）或一次性项目；
   - 要顺手统一的：产品运营 `topics.context` 返回 `existing_topics`、`sites`，任务里写的是 `existing`、`site.digest`（任务里暂时两种名字都写了）；
5. 页面和外壳：
   - 已合进 `business`：`components/ContentPerformance.tsx`（营销复盘改成插槽 `reviews`，产品运营的内容页传 `GrowthReviews` 进来；页面组件不能按路径 require，有就用的东西用插槽）、
     `components/views/types.ts`（`View` 取两边的并集，实际有哪些页面看各模板的导航）、`lib/shuttle.ts`（类型取并集）、`backend/func/db.ts`（手机端开放的表取并集；改了要 `annulo push` 才到 creght，发版后项目升级带上）；
   - **留在模板的行业文件**：`lib/edition.ts`（导航、渠道、向导页）、`talizen.config.ts`（页面标题描述；importMap 只能写死的值，外贸多一个 `pdfjs-dist`）；
   - 外壳 `pages/Index.tsx`（已合，外贸的为底）：侧栏、顶栏、起步清单和向导、不在 Annulo 里时的电脑在线提示、AI 搜索检测完的提醒、新文章数；
     模板自己的部分放 **行业文件 `lib/views.tsx`**：认哪些页面（`VIEWS`）、每个页面渲染什么（`renderView`）、老链接 view=content 跳哪（`contentView`）、侧栏亮哪项（`navViewOf`）、
     侧栏上额外的数字（`useNavBadges`：外贸的增长雷达、产品运营的灵感库）、页面写表后要不要整个重拉（`REFRESH_ON_DB_CHANGE`，产品运营要）、侧栏折叠记在哪个键（`NAV_COLLAPSED`）。
     不放 `lib/edition.ts`：页面组件会 import edition（渠道列表），反过来会循环；也不放 `pages/`（那里的文件是路由）。
     产品运营的导航改成外贸的结构（组下的小标题标在第一项的 `section` 上），侧栏样式跟外贸一样（不再有组图标、缩进和顶上的模板名）；
6. 文案和帮助：`messages/*.json`、`help/*` 拆成 core + 行业差异。

## 第 3 步：收尾

- 模板目录只剩行业文件；`docs/` 里的设计文档挪到对应模块；
- 两个仓库的 AGENTS.md 改成新结构，去掉冻结说明；
- 写清楚加一个新行业怎么做：建模板目录、写行业文件、`targets.json` 选模块。

## 进度

- [x] 第 0 步：`publish/merge_check.py`，基准 2026-11-11（含当时工作区里别人没提交的 core 改动）
- [x] 第 1 步（2026-11-11）：外贸 6 个、产品运营 3 个模块，四个模板的产物和基准一样，`npm run check` 通过；外贸和本仓库的测试改成按 `targets.json` 拷模块，失败的和挪之前一样（外贸 `onboarding` 1 个；本仓库 7 个是测试本身的问题：缺 esbuild、社媒插件的替身少了导出、自媒体测试缺 `_site`，另有别人还没提交的 `instagram-publish-prepare`）
- [ ] 第 2 步
  - [~] 第 5 批：ContentPerformance、views/types、lib/shuttle、backend/func/db、外壳 pages/Index 合进 business；外贸的老类型错误修完；两个实验项目本机渲染 136～140 个模块都编译通过，**等在 App 里逐页点一遍**
  - [x] 第 4 批（2026-11-11）：content-workspace、_ai、_research、today、topics、reports、content 合进 business；profile、products 留在模板（行业的）；两个实验项目上只读调用前后对比，写入的用测试
  - [x] 第 3 批（2026-11-11）：产品运营 `growth.*` 改名 `campaigns.*`；Creght 产品运营上 `campaigns.context` `topics.context` `marketing.context` `inspiration.list` 正常，老名字报「没有 local/growth.ts」
  - [x] 第 2 批（2026-11-11）：`topics` `articles` `assets` `reports` 进 `business`；两个实验项目上 `content.context` `topics.context` `today.list` 正常
  - [x] 第 1 批（2026-11-11）：四个任务合进 `business` 模块；`--local` 到 pofungfurniture 运营（外贸）、Creght 产品运营，两边的上下文函数核对过字段；**等在 App 里各跑一次写文章、出选题再发版**
- [ ] 第 3 步
