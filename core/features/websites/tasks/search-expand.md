---
name: 写补内容的要点
description: 页面在 Google 排名 8~20、差一点上首页：读页面和它的搜索词，写出要补的搜索意图、小节、FAQ、站内内链，存成要点（搜索表现页上确认后再交给助手改页面）
---

参数：`id` 是 search_pages 表里这个页面的记录。

## 1. 拿上下文

```bash
annulo run gsc.pageContext --input '{"id":"<id>","related":true}'
```

输出里：`page`、`title`、`h1`、`headings`（已有的小标题）、`body`（正文开头）是页面现在的内容，`queries` 是主要搜索词（已去掉品牌词），
`site_pages` 是站内相关页面（内链只能从这里选），`project` 是项目定位。

## 2. 写要点

问题不在标题，而在内容没把搜这些词的人想要的答全。给出改写要点，交给编辑去改页面：

- `gaps`：搜这些词的人想知道、但页面现在没回答或没回答好的问题（搜索意图），3~6 条，每条一句话；
- `sections`：建议新增或加强的小节，每节 `{ "heading": 小节标题, "what": 这一节写什么（一两句，说清楚要覆盖的点） }`，3~6 节；已有的小节写得够好就不要重复；
- `faq`：值得在页面末尾加的常见问题，3~6 个，只写问题；
- `internal_links`：站内哪些页面应该加一个链接指向这个页面，每条 `{ "from": 页面 URL, "anchor": 锚文本 }`，`from` 只能从 `site_pages` 里选、原样照抄 URL，锚文本用自然的搜索词说法；没有相关的就给空数组；
- `summary`：一两句总结最该补的是什么；
- 小标题、FAQ、锚文本的语言和页面现有语言一致；`gaps`、`summary`、`what` 给用户看，用界面语言写；
- 只基于页面已有的信息和项目资料提建议，不编造页面没有的事实（价格、数据、认证、案例），需要补事实的地方写成「补充 xxx（需要你提供）」。

## 3. 存

```bash
cat > /tmp/brief.json <<'JSON'
{ "id": "<id>", "gaps": ["…"], "sections": [{ "heading": "…", "what": "…" }], "faq": ["…"], "internal_links": [{ "from": "…", "anchor": "…" }], "summary": "…" }
JSON
annulo run gsc.saveBrief --input @/tmp/brief.json
```

存完回复用户：最该补的是什么（summary），请到「搜索表现」里看要点，确认了点「交给助手改页面」。**这一步只存要点，不要去改站点代码。**
