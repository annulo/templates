---
name: 改写页面标题和描述
description: 页面在 Google 有曝光但点击率偏低：读页面和它的搜索词，写新的 title 和 meta description，存成建议（搜索表现页上确认后再交给助手改站）
---

参数：`id` 是 search_pages 表里这个页面的记录。

## 1. 拿上下文

```bash
annulo run gsc.pageContext --input '{"id":"<id>"}'
```

输出里：`page` 是页面地址，`title` / `description` 是现在的标题和描述，`h1`、`headings`、`body` 是页面内容，
`queries` 是它最近 28 天的主要搜索词（曝光、点击、排名，已去掉品牌词），`project` 是项目定位。

## 2. 怎么写

照这件任务的写法写：用户改过的在 `user/prompts/search-meta.md`，没改过用模板默认的 `prompts/search-meta.md`（开任务时会告诉你用哪份；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/search-meta.md`）。

## 3. 规则

写法归用户（页面上的「AI 要求」改的就是它）；和下面的规则冲突时，以规则为准。

- 长度：标题英文 ≤ 60 个字符、中文 ≤ 30 个汉字；描述英文 ≤ 155 个字符、中文 ≤ 80 个汉字（超了 Google 会截断）；
- 语言和页面现有语言一致；
- 不夸大、不编造页面里没有的信息；
- `reason`：一两句话说为什么这样改（针对哪些搜索词、原来的问题），给用户看，用界面语言写。

## 4. 存

```bash
cat > /tmp/meta.json <<'JSON'
{ "id": "<id>", "title": "…", "description": "…", "reason": "…", "current_title": "<上下文里的 title>", "current_description": "<上下文里的 description>" }
JSON
annulo run gsc.saveSuggestion --input @/tmp/meta.json
```

存完回复用户：新标题、新描述、为什么这样改，请到「搜索表现」里看，确认了点「交给助手改站」。**这一步只存建议，不要去改站点代码。**
