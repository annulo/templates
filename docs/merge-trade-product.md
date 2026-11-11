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
- 另外每一批跑一次 `npm run check`和 `publish/tests/` 里相关的测试；动了页面或本机函数的，用 `--local` 在一个外贸项目、一个产品运营项目上各点一遍。
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
4. 本机函数：`_ai` `_checklist` `_research` `profile` `products` `topics` `today` `reports` `content-workspace`，最后 `content.ts`（差 1000 行）；
   要顺手统一的：产品运营 `topics.context` 返回 `existing_topics`、`sites`，任务里写的是 `existing`、`site.digest`（任务里暂时两种名字都写了）；
5. 页面和外壳：`components/views/types.ts`、`ContentPerformance.tsx`、`pages/Index.tsx`、`lib/shuttle.ts`、`lib/edition.ts`（只留导航、渠道、向导）、`backend/func/db.ts`、`talizen.config.ts`；
6. 文案和帮助：`messages/*.json`、`help/*` 拆成 core + 行业差异。

## 第 3 步：收尾

- 模板目录只剩行业文件；`docs/` 里的设计文档挪到对应模块；
- 两个仓库的 AGENTS.md 改成新结构，去掉冻结说明；
- 写清楚加一个新行业怎么做：建模板目录、写行业文件、`targets.json` 选模块。

## 进度

- [x] 第 0 步：`publish/merge_check.py`，基准 2026-11-11（含当时工作区里别人没提交的 core 改动）
- [x] 第 1 步（2026-11-11）：外贸 6 个、产品运营 3 个模块，四个模板的产物和基准一样，`npm run check` 通过；外贸和本仓库的测试改成按 `targets.json` 拷模块，失败的和挪之前一样（外贸 `onboarding` 1 个；本仓库 7 个是测试本身的问题：缺 esbuild、社媒插件的替身少了导出、自媒体测试缺 `_site`，另有别人还没提交的 `instagram-publish-prepare`）
- [ ] 第 2 步
  - [x] 第 3 批（2026-11-11）：产品运营 `growth.*` 改名 `campaigns.*`；Creght 产品运营上 `campaigns.context` `topics.context` `marketing.context` `inspiration.list` 正常，老名字报「没有 local/growth.ts」
  - [x] 第 2 批（2026-11-11）：`topics` `articles` `assets` `reports` 进 `business`；两个实验项目上 `content.context` `topics.context` `today.list` 正常
  - [x] 第 1 批（2026-11-11）：四个任务合进 `business` 模块；`--local` 到 pofungfurniture 运营（外贸）、Creght 产品运营，两边的上下文函数核对过字段；**等在 App 里各跑一次写文章、出选题再发版**
- [ ] 第 3 步
