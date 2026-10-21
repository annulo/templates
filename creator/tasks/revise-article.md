---
name: 改文章
description: 按用户的要求改一篇文章（在用户手动改过的基础上继续改，类型不变），content.update 存回去
---

参数：`article_id` 是要改的文章，`note` 是用户这次的要求。

## 1. 读当前的文章

```bash
annulo run content.revisionContext --input '{"article_id":"<article_id>"}'
```

`article` 是表里现在的这篇，**以它为准**：用户可能刚在后台手动改过标题、正文或配图，这些改动是用户的意思，没被这次的要求提到的就原样保留，不要改回去、也不要借机大改。
`type` 是文章类型，`type_note` 说明这种类型的字段怎么填，`limits` 是它在用户各账号平台上的限制；`project` 是我的定位，`images` 是能配的图。用到个人经历只能用定位里写了的。

写文章的写法（用户改过的 `user/prompts/write-article.md`，没改过的 `prompts/write-article.md`，看和这篇类型对应的那一节）改的时候也照样遵守。

## 2. 怎么写

照这件任务的写法写：用户改过的在 `user/prompts/revise-article.md`，没改过用模板默认的 `prompts/revise-article.md`（开任务时会告诉你用哪份；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/revise-article.md`）。

## 3. 规则

写法归用户（页面上的「改文章的要求」改的就是它）；和下面的规则冲突时，以规则为准。

- 当次要求里提到的都改到；只改要求涉及的部分，别的段落一字不动；
- 要换成别的样子发（长文要发小红书、做成视频）不在这里改：照 `tasks/work-on-content.md` 在这条内容的文件夹里另做一份文案、图或视频，发布时挑；
- 字段格式照 `type_note`：长文正文是 HTML，原有的 `<img>` 原样保留；图文笔记、视频简介是纯文字，配图在 `images`；
- 正文字数、话题个数不超过 `limits` 里最严的那个；
- 要求里让你配图、换图：只用 `images`（资料库的图）里的地址；
- 不编造数据、案例和引用；要求里让你补的信息你查不到，就在回复里说明，不要瞎写。

## 4. 存

只传改了的字段，写成 JSON 文件再存：

```bash
cat > /tmp/article-update.json <<'JSON'
{ "article_id": "<id>", "title": "…", "body": "…" }
JSON
annulo run content.update --input @/tmp/article-update.json
```

能改的字段：`title`、`summary`、`body`、`tags`（数组），图文笔记还有 `images`（数组）、`cover_text`，视频还有 `video`、`category`。
存完回复用户：改了哪几处（一两句），提到这篇就写成链接 `[打开「标题」](/?view=content&article=<article_id>)`。

## 视频封面

视频的独立封面用 `video_cover` 保存，图片必须来自资料库或本机上传。沿用同一视频时保留原封面；换了视频要重新核对封面。没有合适的图片就留空，不编造图片地址，不用 `cover_text` 代替。只修改文案时不要清空已有封面。
