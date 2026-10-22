# 选题的出处：从哪来、写成了什么

选题可以从很多地方来：AI 搜索里没被引用的问题、谷歌搜索词、关键词、竞品新页面、灵感、增长机会、营销计划，或者用户手动加、助手在对话里出。
目标是**任何一个选题都能回答「它是从哪来的」，任何一个出处都能回答「它写成了什么、发出去之后怎么样」**。

## 数据

一条链，每一环只存「往上一环」的 id：

```
出处记录（geo_questions / keywords / competitor_pages / research_sources …）
   ↑ topics.origins
选题 topics ── chat_id：出它的对话
   ↑ articles.topic_id
文章 articles ←─ articles.source_id（改写的新文章指向原文）
   ↑ publications.article_id / social_posts.article_id
发布记录
```

- `topics.origins`：JSON 数组 `[{ type, id, label, channel_id? }]`。`type` 见 `core/lib/origins.ts` 的 `OriginType`，`id` 是那张表里的记录（谷歌搜索词没有表，`id` 就是词），`label` 是生成时的快照（问题原文、关键词、页面标题），原记录删了也看得懂。一个选题可以有几个出处（一篇文章回答几个相近的问题），一个出处也可以写成几个选题。
- `topics.chat_id`：出这个选题的对话（`ctx.chat_id`），选题详情里能「查看对话」。
- `topics.source` 照旧是粗分类，只给页面上的小标签用；追溯看 `origins`。
- 老数据里各模块自己存的字段（`campaign_id`、`opportunity_id`、`marketing_plan_id`、`search_query`）由 `originsOf()` 一起读出来，不用迁移。灵感来源除了 `origins`，还照旧在 `content_references`（kind=source）存完整快照。

为什么放在选题的字段里，而不是 `content_references` 这类关联表：页面本来就整表读 topics，反查（这个问题写成了哪些选题）在内存里过滤就够了；字段在每个模板里都能用，不依赖 websites 模块的表。

## 谁写

| 入口 | 函数 | origins |
|---|---|---|
| AI 搜索「写成选题」（一个或一批问题） | `topics.save`，`source=geo` | `geo_question`：**每个选题必须带 `question_ids`**，没带报错 |
| 谷歌搜索词（每天同步） | `gsc.sync` | `search_query` |
| 关键词「转成选题」 | `keywords.toTopic` | `keyword`（一个主题的几个词）；已有同名选题的把词并进去 |
| 竞品新发现「转选题」（外贸） | `competitors.toTopic` | `competitor_page` + `competitor` |
| 竞对总览、规格对比里出的（外贸） | `topics.save`，`source=competitor` | 任务里写 `origins: [{ type: 'competitor', id }]` |
| 从灵感生成（产品运营） | `topics.save` 带 `source_ids` | `inspiration_source` |
| 增长机会、主题计划、营销计划（产品运营） | `growth.*`、`marketing.*` | 老字段，`originsOf()` 读 |
| 手动添加 | 页面 `dbCreate` | 无（`source=manual`） |

`topics.save` 里助手给的出处由 `checkOrigins()`（`core/features/websites/local/_origins.ts`）查实：种类不认识、记录不存在直接报错，别让断了的链接进表。
标题和已有选题重复时不另建，把这次的出处并进已有的那个（返回 `linked`），这样从出处那边也能找到它。

## 谁读

- **选题详情**（`WritingBriefDialog`）和**文章详情**（`ArticleDetail` 底部）：「来源」一行（`core/components/Origins.tsx`），每个出处点了回到那一页（AI 搜索问题定位到那一行：`?view=geo&q=<问题 id>`），助手出的能打开对话；文章先显示「选题：xxx」，改写的顺着 `source_id` 往上找到选题。
- **AI 搜索页**每个推荐类问题下面：写成的选题 → 文章（草稿 / 已发布）→ 发布后几个 AI 引用了本站（发布时间之后的检测结果）。有链接就不再按关键词猜「相关文章」。
- **出选题的上下文**（`topics.context` 的 `geo_questions`）：已经写成过选题的问题带 `topic_titles`，助手别再出重复的。

## 新加一个能出选题的地方

1. 往 topics 插记录时带上 `origins: originsJson([{ type, id, label }])` 和 `chat_id`（有的话）；
2. 新的出处种类加进 `core/lib/origins.ts` 的 `OriginType`、`_origins.ts` 的表映射、`Origins.tsx` 的跳转和 `core/messages` 的 `origin.t_<种类>`；
3. 出处那一页想显示「写成了什么」，用 `topicsFrom(topics, type, id)`。
