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
   **产品运营的改名**：增长机会 `opportunities.*`、运营主题 `campaigns.*`，`_growth.ts` 跟着拆。产品运营用户少，改名的影响小。
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

一个模块一个提交。模块里的文件挪到 `core/features/<模块>/` 下的同一路径，文案挪进模块的 `messages/*.json`，模板的 `targets.json` 启用它。
模块之间、模块和模板之间的依赖照现在的写，「有就用」的改写放到第 2 步。

外贸的：

| 模块 | 文件 |
|---|---|
| `leads` 询盘 | `backend/func/leads_hook.ts`、`components/FormHookCard.tsx`、`views/Leads.tsx`、`local/leads.ts`、表 `leads` `lead_hooks`、定时 `leads.sync` `leads.judge`、skill `leads`、任务 `reply-lead` `research-lead`、写法 `reply-lead`、`docs/leads.md` |
| `prospects` 潜客 | `views/Prospects.tsx`、`local/prospects.ts` `_apollo.ts` `_webfind.ts`、表 `prospects` `prospect_batches`、任务 `draft-icp`、`docs/prospects.md`（用 `leads` 表） |
| `competitors` 竞品 | `views/Competitors.tsx`、`local/competitors.ts`、表 `competitors` `competitor_pages`、定时 `competitors.scan`、任务 `competitor-*`、`docs/competitors.md` |
| `knowledge` 知识库 | `views/Knowledge.tsx`、`local/knowledge.ts`、`lib/extract.ts`、任务 `summarize-knowledge`、`docs/knowledge.md` |
| `radar` 增长雷达 | `views/Growth.tsx`、`local/growth.ts`、表 `growth_items`、定时 `growth.scan`、`docs/growth-radar.md` |
| `dashboard` 看板 | `components/Dashboard.tsx`、`local/dashboard.ts`、`pages/Index.canvas.tsx`、`docs/dashboard.md` |
| 待定 | `local/images.ts`（AI 配图）、`_overlap.ts`（内容去重）、`_catalog.ts`（产品目录）：内容中心在用，第 2 步跟 `content.ts` 一起看是进 core 还是进模块 |

产品运营的（`growth` 的改名放在第 2 步，这一步只挪）：

| 模块 | 文件 |
|---|---|
| `campaigns` 增长机会和运营主题 | `views/Campaigns.tsx` `GrowthPlanning.tsx` `Opportunities.tsx`、`MarketingWorkspace.tsx`、`GrowthDashboard.tsx`、`local/growth.ts` `_growth.ts` `marketing.ts`、表 `campaigns` `channel_strategies` `growth_opportunities` `growth_reviews` `marketing_plans` `seo_targets`、任务和写法 `plan-/produce-/review-campaign` `seo-research` `seo-page-plan` `seo-page-implement`、定时 `marketing.planReviews`、skill `product-growth` `product-seo`、`docs/product-growth.md` `marketing-workflow.md` |
| `inspiration` 灵感库 | `local/inspiration.ts`、表 `reference_creators`、定时 `inspiration.sync`、任务和写法 `review-inspiration`、`docs/content-inspiration.md`（和 `playbooks` 一起用） |
| `metrics` 转化指标 | `views/ProductMetrics.tsx`、`local/metrics.ts`、表 `product_metrics_daily` |

产品运营的 `_growth.ts` 被 `products`、`profile`、`today`、`reports` 引用，挪进 `campaigns` 模块后这几处暂时还依赖它，第 2 步拆。

## 第 2 步：合并分叉的文件

**以外贸那份为底**，把产品运营的差异补进去，合好的放进 `core/`（两个模板都删掉自己那份）。外贸老用户多，以它为底，改过这些文件的用户升级时冲突最少。
数据表取两边字段的并集，只加字段，不改名、不删。行业不一样的地方按「有这个模块 / 有这个字段就用」写，实在分不开的放进 `lib/edition.ts` 这类行业文件。

从小到大，每一批合完发一版两个模板：

1. 任务和写法（差几十行以内）：`tasks/rewrite-article` `revise-article` `write-article` `suggest-topics` `weekly-report` `draft-profile` `import-products`、`prompts/*`；
2. 数据表：`profile`（外贸的 `company_role` `cooperation`…，产品运营的 `pricing` `signup_event` `activation_event`…）、`products`（外贸的 `moq` `lead_time` `certs` `specs`，产品运营的 `features` `limitations` `proof`）、`topics` / `articles`（产品运营多出的 `campaign_id` `opportunity_id` 等关联字段）；
3. 产品运营 `growth` 改名：`growth.*` → `opportunities.*` / `campaigns.*`，`_growth.ts` 拆开；页面、任务、定时任务、skill 里的调用一起改，`changelog.yaml` 写明（用户自己写的代码调了老名字的要改）；
4. 本机函数：`_ai` `_checklist` `_research` `profile` `products` `topics` `today` `reports` `content-workspace`，最后 `content.ts`（差 1000 行）；
5. 页面和外壳：`components/views/types.ts`、`ContentPerformance.tsx`、`pages/Index.tsx`、`lib/shuttle.ts`、`lib/edition.ts`（只留导航、渠道、向导）、`backend/func/db.ts`、`talizen.config.ts`；
6. 文案和帮助：`messages/*.json`、`help/*` 拆成 core + 行业差异。

## 第 3 步：收尾

- 模板目录只剩行业文件；`docs/` 里的设计文档挪到对应模块；
- 两个仓库的 AGENTS.md 改成新结构，去掉冻结说明；
- 写清楚加一个新行业怎么做：建模板目录、写行业文件、`targets.json` 选模块。

## 进度

- [x] 第 0 步：`publish/merge_check.py`，基准 2026-11-11（含当时工作区里别人没提交的 core 改动）
- [ ] 第 1 步
- [ ] 第 2 步
- [ ] 第 3 步
