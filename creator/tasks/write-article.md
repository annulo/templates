---
name: 写文章
description: 把选题池里的一个选题写成一篇完整的文章：content.context 拿上下文，按要求写，content.save 存成文章（之后在内容详情里改写成各社媒账号的版本）
---

参数里有 `topic_id` 就写这个选题，没有就从选题池里挑一个。

## 1. 拿上下文

```bash
annulo run content.context --input '{"topic_id":"<参数里的，没有就不传>"}'
```

输出里：`project` 是我的定位（写什么、写给谁、风格、关于我、不写什么），`topic` 是要写的选题（`brief` 是用户在选题里填的简报：读者、要回答的问题、大纲、语言、要发的平台、结尾引导、待补的信息）；
`topic` 为 null 时从 `ideas`（选题池）里挑一个现在最值得写的：和定位最贴、最具体的，在回复里说一句为什么挑它；
`images` 是能配进文章的图（资料库的图片，`name` / `text` / `tags` 说明图上是什么）；`written_titles` 是写过的标题（不要重复）。

不要编造数据、案例和引用。用到个人经历只能用定位里「关于我」「专长和经历」写了的，照原样，不添油加醋。

## 2. 怎么写

若参数里有 `writing_requirements`，它就是用户在这次弹窗里确认的完整写作要求，本次以它为准，不再把写法文件作为额外要求叠加。没有这个参数时，照用户改过的 `user/prompts/write-article.md` 写；没有用户版就用默认的 `prompts/write-article.md`。弹窗里的临时要求不保存成默认写法；用户明确要以后每次都这样写，才更新 `user/prompts/write-article.md`。

## 3. 规则

写法归用户（页面上的「写作要求」改的就是它）；和下面的规则冲突时，以规则为准。

- 不编造数据、案例和引用；看不出来的信息宁可不写；简报里 `gaps`（待补的信息）不能当成已经证实的事实；
- **配图**：从 `images` 里挑和内容对得上的图插进正文（一般 1~3 张），在两个段落之间单独写一个 `<img src="…" alt="图上是什么">`（不要包在 `<p>` 里）；
  只用 `images` 里的地址，不去外站找图、不自己编图片地址；没有对得上的就不配，在回复里提醒用户可以在编辑器里「上传图片」或先往资料库传图；
- 正文用 HTML（见下面「存」）。

## 4. 存

正文用 HTML（`<h2> <h3> <p> <ul> <ol> <li> <strong> <a> <code> <pre> <img>`），不要 Markdown，不要 `<html>` `<body>` 外壳。写成 JSON 文件再存：

```bash
cat > /tmp/article.json <<'JSON'
{
  "topic_id": "<选题 id>",
  "title": "标题",
  "summary": "1~2 句摘要",
  "keywords": "关键词，逗号分隔",
  "body": "<h2>…</h2><p>…</p>"
}
JSON
annulo run content.save --input @/tmp/article.json
```

content.save 报错（比如正文是 Markdown、太短）就按报错改了再存。存完回复用户：标题、一句话讲了什么、配了几张图，请在「内容中心」里看，满意了再在「媒体版本」里给各账号生成帖子。
