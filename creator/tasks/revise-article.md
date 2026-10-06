---
name: 改文章
description: 按用户的要求改一篇文章（在用户手动改过的基础上继续改），content.update 存回去
---

参数：`article_id` 是要改的文章，`note` 是用户这次的要求。

## 1. 读当前的文章

用 `db_query` 读 `articles` 表里这篇（`where: {"id": "<article_id>"}`）。**以表里现在的内容为准**：用户可能刚在后台手动改过标题、摘要或正文，
这些改动是用户的意思，没被这次的要求提到的就原样保留，不要改回去、也不要借机大改。

再运行 `annulo run content.revisionContext --input '{"article_id":"<article_id>"}'`，读取我的定位（`project`）和能配的图（`images`）。用到个人经历只能用定位里写了的。

写文章的写法（用户改过的 `user/prompts/write-article.md`，没改过的 `prompts/write-article.md`）改的时候也照样遵守。

## 2. 怎么写

照这件任务的写法写：用户改过的在 `user/prompts/revise-article.md`，没改过用模板默认的 `prompts/revise-article.md`（开任务时会告诉你用哪份；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/revise-article.md`）。

## 3. 规则

写法归用户（页面上的「AI 要求」改的就是它）；和下面的规则冲突时，以规则为准。

- 当次要求里提到的都改到；只改要求涉及的部分，别的段落一字不动；
- 正文仍然是 HTML（`<h2> <h3> <p> <ul> <ol> <li> <strong> <a> <code> <pre> <img>`），不要 Markdown；正文里原有的 `<img>` 原样保留；
- 要求里让你配图、换图：只用 `images`（资料库的图）里的地址，单独一个 `<img src="…" alt="图上是什么">` 放在两段之间；
- 不编造数据、案例和引用；要求里让你补的信息你查不到，就在回复里说明，不要瞎写。

## 4. 存

只传改了的字段，写成 JSON 文件再存：

```bash
cat > /tmp/article-update.json <<'JSON'
{ "article_id": "<id>", "title": "…", "summary": "…", "body": "<h2>…</h2><p>…</p>" }
JSON
annulo run content.update --input @/tmp/article-update.json
```

存完回复用户：改了哪几处（一两句），请在内容详情里看一眼。
