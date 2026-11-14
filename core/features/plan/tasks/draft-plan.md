---
name: 起草 90 天增长计划
description: 按网站现在的数据、公司和产品资料，起草 90 天增长计划：判断从哪个阶段开始、给保守 / 正常 / 激进三档目标、三个阶段的重点、开始阶段每周要做的事和后两个月的事、每周固定节奏，按推荐的那档开始执行
prompt: draft-plan
---

参数：`requirements`（可选）是用户这次在弹窗里写的额外要求，在写法之上照它做，冲突以它为准；只用于这一次。

## 1. 拿上下文

```bash
annulo run plan.context --input '{}'
```

输出里：

- `profile`、`products`：公司资料和产品（主营、市场、客户、关键词）。两个都是空的：告诉用户先到「公司与产品」把资料补上，不往下做；
- `sites`、`social_accounts`：网站（`gsc` 是否连了谷歌数据）和社媒账号；
- `metrics`：现在的各项指标，`metric_defs` 是每个指标的名字、属于哪一层（`process` 做了多少 / `leading` 先行指标 / `result` 结果）、越大越好还是越小越好。`null` 是拿不到（没连谷歌、没做过 AI 搜索检测），不是 0；
- `stage`：按已有数据算的建议起点（`phase` 1/2/3、`reasons`、`facts`：谷歌数据有几天、发了几篇、多少展示和点击）；
- `keywords`、`competitors`、`growth`：关键词做到哪了、在盯的竞品、这周的增长机会；
- `catalog`：计划项能用的动作。`views` 是能去的页面（`view` + `params`），`tasks` 是能交给助手的任务。**只能用这里列的**；
- `previous`：上一份计划（90 天结束后起草下一份时有），照它的检查点结论接着排，有效的做法沿用、没起色的换掉。

## 2. 判断从哪个阶段开始

新项目从第 1 阶段开始。已经运营了一段时间的，看 `stage` 的建议和 `facts`，自己再判断一次：

- 第 1 阶段（Day 1–30 打地基）：谷歌数据不到 4 周、文章很少、关键词还没布局；
- 第 2 阶段（Day 31–60 放量优化）：已经有一批文章、谷歌有展示了，接下来是快赢词补内容、改标题描述、继续写主题、社媒分发带外链；
- 第 3 阶段（Day 61–90 转化）：已经有稳定的点击，重点放到落地页、询盘入口、掉量页面刷新、询盘来源分析。

和 `stage.phase` 不一样时，`reason` 里写清为什么。

## 3. 定目标：三档

照这件任务的写法定（用户改过的在 `user/prompts/draft-plan.md`，没改过用模板默认的 `prompts/draft-plan.md`；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/draft-plan.md`）。

每档的 `targets` 是 90 天结束时每个指标要到的**数值**（不是增量），指标只能用 `metric_defs` 里的，三层都要有：做了多少（比如 `pages_published`）、先行指标（比如 `impressions_28d`、`keywords_top30`）、结果（`clicks_28d`，有询盘功能的加 `leads_28d`）。
现在是 `null` 的指标（没连谷歌）也可以定目标，`note` 里写「连上谷歌数据后才开始算」。从现在的数出发定：现在展示 200，激进也别写 50000。`note` 一两句说这一档要投入什么。推荐一档放进 `recommended`。

## 4. 排计划

- `phases`：三个阶段，每个 `title`、`focus`（这一阶段的重点，一两句）、`goals`（两三条阶段目标）；
- `items`：
  - **开始阶段按周排**（第 1 阶段是第 1~4 周，第 2 阶段第 5~8 周，第 3 阶段第 9~13 周），每周 3~5 件；
  - **后面的阶段按月先排粗的**：每个月 3~5 件，`scope` 写 `"month"`，`week` 写那个月的第一周（第 2 个月 5、第 3 个月 9）。到了检查点再按数据换成每周的。这样用户一开始就能看到完整的 90 天；
- 每件事：`week`、`area`（keywords / competitors / site / content / links / data / leads）、`who`、`title`、`why`（为什么做，带上数据）、`action`（`{"kind":"go","view":"…","params":{…}}` 或 `{"kind":"task","task":"…","input":{}}`）；
- `who` 是谁来做，看板上分两栏：
  - `"you"`：要用户本人的，比如要登录用户自己的账号（Search Console 里提交网址、B2B 平台、社媒主页）、要付费、要对外发言（发帖、回复、外联邮件）、要拍板（选哪几个主题、要不要改价格）；
  - `"ai"`：助手能自己做完的，比如挖词筛词、写文章和落地页、改标题描述、跑检测、写竞品分析。动作一般是交给助手的任务（`kind: task`）；
- `weekly`：每周固定节奏，3~4 件每周都做的事（比如「周一看谷歌数据，改展示多点击少的页面标题」「周三发 1 篇文章」「周五跟进询盘」），每件 `who`、`title`，能对应页面或任务的加 `action`；
- 能按数据判断做完的加 `check`：`{"metric":"pages_published","gte":4,"delta":true}` 是比开始时多发 4 篇；`{"metric":"issues_high_open","gte":0}` 是严重问题清零。判断不了的（比如「看一遍竞对总览」）不加，用户手动标；
- 第 1 阶段一定要有：关键词布局（挖词 → 筛词归主题 → 每个主题定一个要做的页面，进度在「增长计划 → 关键词地图」看，`{"kind":"go","view":"plan","params":{"tab":"map"}}`）、竞品分析（没竞品先让 AI 推荐）、修严重网站问题、连上谷歌数据（没连的话放第 1 周）、写核心页面、外链起步（社媒主页填上网站链接、每篇文章发社媒带链接；B2B 平台店铺、行业目录里的公司介绍写上网站，做好了在「增长计划 → 外链」登记，`{"kind":"go","view":"plan","params":{"tab":"links"}}`）；
- 可以用的自动判断：`clusters_live`（已有页面的关键词主题数）、`backlinks_live`（在线外链数），比如「再做 3 个主题的页面」写 `{"metric":"clusters_live","gte":3,"delta":true}`。

## 5. 存

```bash
cat > /tmp/plan.json <<'JSON'
{
  "stage": { "phase": 1, "reason": "…" },
  "summary": "这 90 天的打法，两三句",
  "phases": [ { "phase": 1, "title": "打地基", "focus": "…", "goals": ["…"] }, { "phase": 2, … }, { "phase": 3, … } ],
  "options": [
    { "level": "conservative", "note": "…", "targets": { "pages_published": 8, "impressions_28d": 1500, "keywords_top30": 5, "clicks_28d": 30, "leads_28d": 2 } },
    { "level": "normal", … },
    { "level": "aggressive", … }
  ],
  "recommended": "normal",
  "items": [
    { "week": 1, "area": "keywords", "who": "ai", "title": "…", "why": "…", "action": { "kind": "task", "task": "keyword-research", "input": {} } },
    { "week": 1, "area": "data", "who": "you", "title": "…", "why": "…", "action": { "kind": "go", "view": "overview" } },
    { "week": 5, "scope": "month", "area": "content", "who": "ai", "title": "…", "why": "…" }
  ],
  "weekly": [ { "who": "you", "title": "周一：看谷歌数据，改展示多、点击少的页面标题", "action": { "kind": "go", "view": "search" } } ]
}
JSON
annulo run plan.saveDraft --input @/tmp/plan.json
```

报错就按报错改了再存。存完**按推荐的那档开始执行**（用户在看板顶部随时能换档）：

```bash
annulo run plan.activate --input '{"level":"<recommended>"}'
```

回复用户：从哪个阶段开始、为什么，按哪档目标开始的、三档各是什么，第 1 周你要做的和 AI 要做的各有哪几件；计划在「增长计划」页，想换一档目标在看板顶部换。
用户在这段对话里接着提意见：只换目标档位用 `plan.setLevel`；要改计划项（「第 2 周加上做落地页」），重新存一份 `plan.saveDraft` 再 `plan.activate`（会替换执行中的这份，第 1 天从今天算），或者告诉用户到检查点再调。

## 规则

- 数字从 `metrics` 来，不编；不知道搜索量就不写搜索量；
- 说清预期：新站 90 天里谷歌主要看收录和展示，点击和询盘慢；IG / FB 的链接对谷歌排名直接帮助不大，价值是品牌、引流、让谷歌更快发现新页面；
- 计划项给用户看，用他们的话（「谷歌展示次数」不说「GSC 曝光」，「网站和账号」不说「渠道」）；
- 用界面语言写。
