---
name: AI 全站 SEO 审查
description: 每类页面挑几页真正读一遍，找规则查不出来的 SEO 问题（标题说没说清给谁、分类介绍是不是套话、产品文案对不对得上、案例够不够具体、页面之间连没连起来），记进网站检查的问题清单，再写一份按优先级排好的优化方案
---

参数：`channel_id` 是要审查的网站（独立站渠道）。

网站检查的规则只能查「有没有」（标题、描述、H1、结构化数据有没有写，链接通不通）。这件任务查「好不好」：像一个懂外贸 SEO 的人那样，把每类页面打开读，判断写得对不对买家、能不能被搜到、会不会被当成重复。

## 1. 拿数据

```bash
annulo run audit.samples --input '{"channel_id":"<channel_id>"}'
annulo run audit.report --input '{"channel_id":"<channel_id>"}'
```

`audit.samples` 输出：
- `groups` 是 sitemap 里每类页面（路径第一段：product、products、blog、project…）有多少页；
- `pages` 是每类挑的几页代表页，现读的：`title`、`description`、`h1`、`h2`、`text`（页面文字开头，含导航）、`own_words`（去掉导航页脚和同类页面套话后自己的词数）、`repeated_share`（同类页面套话占比）、`schema`（结构化数据类型）、`images_empty_alt`、`search`（最近 28 天的谷歌数据和主要搜索词，有才给）；
- `known_issues` 是规则已经查出来的问题：**不要再报一遍**，挑规则查不到的。

`audit.report` 是总分、收录、搜索表现和按影响排好的规则问题，写方案时用。

光看 `text` 判断不了的（版式、图片、某段在页面哪里、产品选项对不对），用 `curl -sL <网址>` 或浏览器打开看。项目定位、产品资料用 `db_query` 查 `profile`、`products`，企业资料用 `annulo run knowledge.search`；网站上写的和产品资料对不上，就是问题。

## 2. 逐类审查

每类页面都看，至少这几项：
- **标题和描述**：有没有说清是什么、给谁（批发商、设计师、酒店项目…）、凭什么找你；是不是只有品类名、型号，或者一个模板只换了名字；
- **分类页**：介绍是这个分类自己的（材质、尺寸怎么选、能定制什么、采购流程），还是所有分类通用的一段；产品很多时有没有能被抓取的分页、筛选；
- **产品页**：文案和这个产品对得上吗（比如石材桌出现了面料选项）；有没有买家要的具体信息（尺寸、材质、可选项、包装、交期、起订量）；和同类产品有什么不同；
- **文章**：回答的是不是买家真会搜的问题，有没有链到相关分类、产品和询价；
- **案例**：有没有写清需求、供货范围、定制了什么、用了哪些产品（带链接），还是只有图和一段话；
- **页面之间的路径**：采购指南 → 分类 → 产品 → 案例 → 询价能不能走通；重要页面从首页几步能到；
- **信任**：关于我们、工厂、认证、联系方式是不是具体、和资料一致。

## 3. 记问题

每个问题写一条，一样的问题在几类页面都有就写成一条、`pages` 里列这些页面：

```bash
cat > /tmp/seo-findings.json <<'JSON'
{ "channel_id": "<channel_id>", "findings": [
  { "area": "content", "key": "category_intro_generic", "severity": "high",
    "title": "分类页的介绍是所有分类通用的一段话",
    "detail": "餐桌、沙发、餐椅三个分类页的介绍都是「…」，没有讲这个品类自己的材质、尺寸、定制范围。建议每个分类写 150~300 词：…",
    "pages": ["https://…/products/dining-table", "https://…/products/sofa"] }
] }
JSON
annulo run audit.saveFindings --input @/tmp/seo-findings.json
```

- `area`：tech 技术 / page 页面（标题、描述、标题结构、图片）/ content 内容 / ai AI 可读；`key` 英文小写短名，同一个问题下次审查用同一个 key（这次没再提到的会标成已解决）；
- `severity`：high 影响一整类页面被搜到或被收录，medium 影响一部分页面，low 小修；
- `detail` 写具体：哪几页、现在写的是什么（引原文）、为什么是问题、改成什么样（举一个改好的例子）。**每条都要有你在页面上看到的证据，看不到的不写**，不编搜索量、排名；
- 一般 4~10 条。只写这个网站自己能做的事，不写买外链、刷点击。

## 4. 写方案

照这件任务的写法写：用户改过的在 `user/prompts/seo-review.md`，没改过用模板默认的 `prompts/seo-review.md`（开任务时会告诉你用哪份；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/seo-review.md`）。写法归用户（页面上的「AI 要求」改的就是它）；和上面的规则冲突时，以规则为准。

方案把第 3 步的发现和 `audit.report` 里的规则问题放在一起排优先级（收录、坏链会挡住整站，放前面）。`index` 是 `null` 时，在 设置 → 连接 里连 Google、在「谷歌排名」里关联 Search Console 是第一条。用界面语言写，Markdown。

```bash
cat > /tmp/seo-plan.json <<'JSON'
{ "channel_id": "<channel_id>", "plan": "<Markdown 全文>" }
JSON
annulo run audit.savePlan --input @/tmp/seo-plan.json
```

存完回复用户：这次发现了几个规则查不出的问题、最先该做的三件事（一句话一件），请到「网站检查」里看问题清单和「SEO 报告」里的完整方案。要动手的可以在网站检查里点「交给助手修」，或直接在这段对话里说改哪条。

用户在这段对话里接着提意见（补一条、改优先级、某条写细一点），改完重新存：问题用 `saveFindings`（要传这次的全部发现，没传的会标成已解决），方案用 `savePlan`。**这件任务只审查和写方案，不去改站点代码。**
