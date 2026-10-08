---
name: 改写文章
description: 把一篇文章改写成另一种类型（或同类型的另一个写法）的新文章：content.rewriteContext 拿原文和目标类型的限制，按用户的改写要求写，content.save 另存一篇（原文不动）
---

参数：`article_id` 是原文，`type` 是改写成的类型（`article` 长文、`post` 图文笔记、`video` 视频），`note` 是用户这次的改写要求（可能来自用户存的改写预设，比如「简短，200 字以内」）。

## 1. 拿上下文

```bash
annulo run content.rewriteContext --input '{"article_id":"<article_id>","type":"<type>"}'
```

输出里：`source` 是原文（`type`、`title`、`text` 纯文字、长文还有 `html`、`images` 原文的配图、`tags`、`video`）；
`type_note` 说明目标类型的字段怎么填；`limits` 是目标类型在用户各账号平台上的限制（标题、正文字数、话题个数、配图张数），**照最严的那个写**；
`project` 是我的定位；`images` 是资料库里能配的图，视频类型还有 `videos`。

## 2. 怎么写

照 `note` 写，`note` 和下面的规则冲突时以规则为准。按目标类型改的不只是长短，是写法：

- 改成图文笔记：一个点讲透，开头一句话抓人，分短段，口语；配图优先用原文的 `images`，按内容挑、第一张做封面；
- 改成长文：把要点展开成有小标题的文章，原文的图放到对得上的段落之间；
- 改成视频：写视频标题和简介（简介讲清这条视频看什么），视频沿用原文的 `video`，没有就从 `videos` 里挑对得上的，都没有就留空、提醒用户补。

## 3. 规则

- 只用原文和定位里有的信息：不编造数据、案例、引用和经历；
- 字段格式照 `type_note`：长文正文是 HTML；图文笔记、视频简介是纯文字（不要 HTML、不要 Markdown 标记），配图放 `images`；
- 正文字数、标题长度、话题个数不超过 `limits` 里最严的那个；
- 配图只用原文的 `images` 和资料库 `images` 里的地址，不去外站找图。

## 4. 存

另存一篇新的（带上 `source_id`），原文不动。写成 JSON 文件再存，字段按目标类型，没有的不传：

```bash
cat > /tmp/rewrite.json <<'JSON'
{
  "type": "<type>",
  "source_id": "<article_id>",
  "title": "标题",
  "summary": "长文才要",
  "tags": ["话题"],
  "body": "…",
  "images": ["图文笔记的配图"],
  "cover_text": "图文笔记没配图时的封面大字",
  "video": "视频地址"
}
JSON
annulo run content.save --input @/tmp/rewrite.json
```

content.save 报错就按报错改了再存。存完回复用户：改写成了什么、多长、配了几张图，请在「内容中心」里看（新文章已经在列表里，详情里能看到改写自哪篇）。
