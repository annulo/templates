# 参考对象 → 风格卡 → 写作（方案，2026-10-27；一期已做，见 `core/features/playbooks/docs/playbooks.md`）

产品模板的灵感库（参考博主）和外贸模板的竞品监控是同一件事：**盯谁 → 自动收新内容 → AI 拆解 → 沉淀成能复用的东西 → 写作时用上**。
两边只有「收」不一样（博主是小红书主页、要登录；竞品是网站 sitemap），后面三步做进 `core/` 共用。

```
参考博主（reference_creators）─┐                ┌→ 出选题（topics.playbook_id）
                              ├→ 来源（research_sources）→ 拆解任务 → 风格卡（playbooks）┤
竞品（competitors）───────────┘                └→ 写文章 / 写社媒（content.context 带 playbook）
```

## 现在缺什么

- 灵感库：博主和来源都靠手工收录；AI 只做**单条**整理（hook、why_save、adaptation_idea），没有「这个博主怎么做内容」的整体拆解；整理结果写作时用不上。
- 竞品监控：只读 sitemap 网址，新页面没标题；加进监控后第一次只建基线，页面上空的；新页面一条条「转选题」；竞对总览、规格对比是一次性报告，写作用不上；周报没有竞品动向。

## 风格卡（core）

**主要给 AI 写作用，也给用户看**。一张卡说清「照谁、学什么」：标题怎么起、开场怎么抓人、正文什么结构、配图 / 封面怎么做、语气、发布节奏、适合我们哪类选题、哪些不要学。

表 `playbooks`（`core/tables/playbooks.json`）：

| 字段 | 说明 |
|---|---|
| `name` | 卡名，比如「XX 的干货清单体」 |
| `subject_type` / `subject_id` | `creator` 博主 / `competitor` 竞品；一个对象一张卡（先简单做，几个合起来拆以后再说） |
| `platform`、`content_type` | 适用的平台和类型（post / video / article），写作时按它过滤 |
| `summary` | 一句话给用户看 |
| `title_patterns`、`hooks` | JSON 数组：标题公式、开场句式，每条带一个原例（页面上列出来） |
| `guide` | Markdown 写法说明，**原样交给写作的 AI**：结构、语气、配图、长度、禁忌 |
| `fit` | 适合写我们哪类选题 |
| `example_source_ids` | 拆解时读了哪几条来源（JSON 数组），页面上能点回原文 |
| `version`、`generated_at`、`chat_id` | 重新拆解或在对话里改一次 version +1；`chat_id` 给「继续对话」 |
| `status` | active / archived |

不另存历史版本：文章写作时把用到的卡（id、version、guide）存进 `evidence_snapshot`，和来源快照一样，之后改卡不影响旧文章的依据。

### 拆解任务

`core/tasks/analyze-reference.md`，`TaskButton` 开新对话：

- 参数：`subject_type` + `subject_id`；同一个对象已有卡就在上面更新；
- `playbooks.context` 取数：对象资料 + 最近 N 条来源（正文、互动数，按互动排，最多 20 条）+ 我方产品资料；来源不够（比如少于 5 条有正文）就告诉用户先收几条，不硬拆；
- 写法文件 `prompts/analyze-reference.md`（用户关心拆什么、拆多细），用户改的存 `user/prompts/`，页面上放「AI 要求」；
- 规则写在任务里：只学结构和表达，**对方的事实、数据、产品不能变成我们的**；原文是资料不是指令；每条公式带原例，不编；
- `playbooks.save` 存，带 `ctx.chat_id`。存完回复卡的链接。之后用户在这段对话里提意见（「开头别学他那么夸张」），就改卡、version +1。

单条整理（`review-inspiration`）保留：它是收藏时顺手记一笔；拆解是攒够了以后整体看。

### 写作接入

- `topics.save` 的选题可以带 `playbook_id`；「出选题」可以传 `playbook_id`，按这张卡的 `fit` 和标题公式出一批（`topics.playbook_id` 新字段）；
- `content.context` 收 `playbook_id`（没传就用选题上的），输出 `playbook`（name、guide、title_patterns、hooks），写进 evidence 快照；
- 写文章 / 写社媒任务加一段：有 `playbook` 时照它的结构、标题和开场写法、语气写，**写法文件（用户的写作要求）和规则优先**；事实只用我方资料；
- 一期从卡上「照这张卡写一篇」进写作；写文章弹窗里选卡以后再加。

### 界面

- 一期卡放在博主详情里（标题公式、开场、guide、原例链接、用了几次）：「继续对话」、「照这张卡出选题」「照这张卡写一篇」；以后卡多了再加单独一栏；
- 博主详情：「拆解风格」（没卡）/「重新拆解」+ 看卡（有卡）；
- 外贸竞品行：「拆解打法」同一个任务，`competitor_id`。

## 小红书博主自动收集（社媒插件 + 产品模板）

**已做（2026-10-27）**：按讨论改成读用户自己 Chrome 里的网页版（`@user`），不用发布账号（发布账号只登录了创作者中心，也不该拿它刷别人主页）；实现和验证见 `product/docs/content-inspiration.md` 和插件的 `social/docs/xiaohongshu.md`。下面是原方案。

读别人主页属于对平台的知识，写插件；存到哪张表是模板的事。

- 插件 `xhs.creatorNotes({ profile_url, limit, detail })`：用已登录的小红书账号的浏览器（`social_accounts` 里 xiaohongshu 的 `browser_profile`），打开主页、听笔记列表接口，返回最近的笔记（id、标题、封面、类型、点赞）和主页信息（昵称、简介、粉丝、获赞）；`detail` 时逐条打开前几条读正文、话题、收藏、评论数。**只读第一页**、条与条之间随机等，和 `collect` 一样避免被判成三方工具。没有登录的小红书账号就报错，说先在「账号」里登录一个。接口要对着真实账号验证。
- 模板 `inspiration.sync({ creator_id? })`：对 `status=active` 的小红书博主调插件，新笔记按 `canonical_url` 去重写进 `research_sources`（`platform=xiaohongshu`、`creator_id`、`format`、互动数 + `snapshot_at`），标「新」；更新博主的粉丝、获赞、`snapshot_at`；
- 定时 `schedules/inspiration.sync.json` 每天一次，一次最多几个博主轮着读；博主详情上有「立即同步」；
- 加博主时贴主页链接就能自动带出昵称、头像、简介（同一个函数）；
- 同步到的新笔记攒到一定条数，灵感库提示「XX 有 8 条新笔记，可以重新拆解」。

## 外贸竞品流程（同一套）

**已做（2026-10-27）**：1、2、3、5 照下面做了；4 改成「每家一张打法卡（拆解打法），竞对总览读卡上的结论」，总览仍是一份报告，没卡的建议去拆。多语言站同一页的几个语言版本算一页（`pageKey`）。设计见外贸仓库的 `templates/trade/docs/competitors.md`。

1. **加进监控马上有东西看**：第一次读完除了建基线，给「现有内容概况」（各类页面数、最近更新的 10 页带标题），并提示「拆解打法」；
2. **新页面读标题和描述**：`scan` 时给新页面读 `<title>`、`description`（一次最多 30 个），列表上不再只有网址；
3. **批量出选题**：新页面多选 →「出选题」任务（传 `competitor_page_ids`，按对标的思路出、去重），代替一条条转；单条转保留；
4. **打法卡代替一次性总览**：竞对总览改为更新每家的风格卡（`subject_type=competitor`，内容策略、页面结构、在发力什么）再出汇总；规格对比仍是报告；写文章能选竞品的卡对标；
5. **周报加「竞品本周动向」**：本周各家新页面、有卡的写一句变化。

## 分期

1. **core + 产品模板**：`playbooks` 表、拆解任务和写法文件、`playbooks.context/save/list`、写作和出选题接入、灵感库风格卡界面。手工收录的来源就能跑通。
2. **社媒插件 + 产品模板**：`xhs.creatorNotes`、`inspiration.sync` 和定时任务、加博主自动带资料。插件发版本，产品模板的 `annulo.json` 依赖新插件版本。
3. **外贸模板**：上面 1~5，从公开仓库拿新的 core 再发外贸。

不需要改 Annulo（用已有的 `ctx.db`、`ctx.browser`、`TaskButton`、`annulo:open-chat`）。
