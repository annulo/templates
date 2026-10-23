---
name: 挖关键词
description: 从种子词扩出一批关键词（搜索引擎下拉联想 + 本站 GSC 搜索词），筛掉不相关的，标搜索意图、归主题，存进关键词表；页面按 GSC 排名分出快赢、已排上、待查
---

参数：`channel_id` 是哪个独立站。`seeds`（可选）是用户指定的种子词，逗号分隔。`keyword_requirements`（可选）见第 3 步。

## 1. 扩词

```bash
annulo run keywords.expand --input '{"channel_id":"<id>"}'
```

不给 `seeds` 时用项目资料的关键词和产品当种子。用户给了种子词，或者你看了第 2 步的资料觉得默认种子不够（比如只有公司名、产品名太泛），自己挑 5~12 个目标客户会搜的产品词当种子再跑一次：
`{"channel_id":"<id>","seeds":["…","…"],"modifiers":["…"],"lang":"en","country":"us"}`。
`lang` / `country` 按写法里的目标市场填（默认英语、美国）；`modifiers` 是拼在每个种子词后面去拉联想的修饰词，写法里给了就照写法传，没给就不传（外贸默认 manufacturer、supplier、wholesale 这类，别的业务默认 best、vs、alternative、pricing 这类）。

**有在盯的竞品时**（第 2 步 `keywords.context` 的 `competitors` 不是空的；这一步可以在第 2 步之后回来做），再从竞品挖一批：竞品卖的产品，买家一定会搜。
每家竞品读一次它的产品页（没有产品页就读落地页）：

```bash
annulo run competitors.pages --input '{"id":"<competitors 里的 id>","kind":"product","limit":200}'
```

报「网站拦截了自动读取」时加 `"browser": true` 再读一次（用用户自己的浏览器读 sitemap）。

从网址的最后一段（slug）和标题里挑出 5~12 个**产品词**（去掉竞品的品牌名、型号编号、颜色尺寸这种变体），和我们的产品对得上的优先，再扩一次：
`{"channel_id":"<id>","seeds":["…"],"seed_source":"competitor"}`。扩出来的词来源会记成 `competitor`，筛的时候照常判断相不相关。
用户说「从竞品挖词」时就做这一步；`competitors` 是空的或者没有 `competitors.pages`（不是外贸模板）就跳过，告诉用户先在「竞品」里加几家在盯的。

联想出来的词会先过一遍降噪：和业务词汇（`vocabulary`：资料关键词、产品、GSC 的词、筛过留下的词里出现两次以上的词，加上你明确给的种子）一个词都不沾的不收，`filtered` 是挡掉了几个、`filtered_sample` 是举例。看例子里有该留的（业务词汇太窄），就把对应的产品词当种子再扩一次（给的种子的词会算进词汇），实在不行带 `"no_filter": true`。

返回里：`engine` 是联想用的哪个搜索引擎（`google`，访问不了时 `bing`；空的就是两个都访问不了，只有 GSC 的词），`added` 是新加了几个，`raw` 是现在待筛的总数，`gsc_error` 是读 GSC 出的错（没关联 Search Console 时没有排名数据，不影响筛词）。

## 2. 拿上下文

```bash
annulo run keywords.context --input '{"channel_id":"<id>"}'
```

输出里：`raw` 是待筛的词（`gsc_impressions` / `gsc_position` 是本站在 Google 已有的曝光和排名，`seed` 是从哪个种子扩出来的），`raw_total` 比 `raw` 多时分几批做；
`competitors` 是在盯的竞品（用法见第 1 步），`clusters` 是之前已经归好的主题（同一类的词沿用这些名字），`dismissed` 是之前不要的词（不要再加回来）；`profile`、`products` 是公司和产品，`site_pages` 是本站在 Google 有曝光的页面和它们的搜索词。

## 3. 怎么筛

照这件任务的写法筛：用户改过的在 `user/prompts/keyword-research.md`，没改过用模板默认的 `prompts/keyword-research.md`（开任务时会告诉你用哪份；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/keyword-research.md`）。
参数里有 `keyword_requirements` 时，它是用户这一次的额外要求：在写法之上照它做，两者冲突以它为准；只用于这一次，不存成默认写法。

## 4. 规则

写法归用户；和下面的规则冲突时，以规则为准。

- `raw` 里的每个词都要给结论：`keep: true` 留下，`keep: false` 不要（和公司产品无关、别人的品牌、找工作、看不懂的乱码，以及写法里说不要的），不要的也写一句 `note` 说为什么；
- 留下的写 `intent`：`buy`（要买、要找供应商：厂家、批发、定制、价格、下载、注册）/ `compare`（对比、选型、哪个好、替代品）/ `research`（是什么、怎么用、标准）/ `other`；
- 留下的写 `cluster`：同一个页面能一起做的词归一个主题，主题名用简短的产品或问题（「LED grow light manufacturer」「grow light vs HPS」），已有 `clusters` 里有合适的就用原名；
- 留下的写 `note`：一句话说为什么值得做、建议怎么做（新写一篇 / 补进哪个已有页面）；`target_page` 只在 `site_pages` 里确实有对得上的页面时填，原样照抄 URL；
- 可以补几个 `raw` 里没有、但你很确定目标客户会搜的词（`keyword` 写原文，不给 `id`），一次不超过 10 个，不要编搜索量；
- 不判断难度、不编搜索量和排名：排名只看 GSC 给的数字，页面会按它分桶；
- 词的原文不改（大小写、拼写都照抄），`note` 用界面语言写。

## 5. 存

写成 JSON 文件再存，一次可以存几百条：

```bash
cat > /tmp/keywords.json <<'JSON'
{ "channel_id": "<id>", "items": [
  { "id": "<raw 里的 id>", "keep": true, "intent": "buy", "cluster": "…", "note": "…" },
  { "id": "<id>", "keep": false, "note": "…" },
  { "keyword": "<你补的词>", "keep": true, "intent": "buy", "cluster": "…", "note": "…" }
] }
JSON
annulo run keywords.save --input @/tmp/keywords.json
```

返回的 `raw_left` 不是 0 就再拿一次上下文接着筛，直到筛完。存完回复用户：留下了几个、分成哪几个主题、哪几个已经有排名（快赢），请到「谷歌排名 → 关键词」里看，挑主题「转成选题」或者给已有页面补内容。

## 用户接着在这段对话里提意见

用户说某些词不要、某个主题拆开或合并、换个市场再挖：照着改，用 `keywords.save` 存回同样的 `id`（改 `keep` / `cluster` / `note`），换市场就带上新的 `lang` / `country` 重跑第 1 步。
