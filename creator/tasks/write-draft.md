---
name: 写初稿
description: 把一个选题写成一篇完整的稿件（Markdown），存进稿件列表
---

参数：`idea_id` 是要写的选题。

## 1. 拿上下文

```bash
annulo run drafts.context --input '{"idea_id":"<idea_id>"}'
```

`profile` 是账号定位，`idea` 是选题（`title`、`angle`、`notes`）。

## 2. 怎么写

照这件任务的写法：用户改过的在 `user/prompts/write-draft.md`，没改过用模板默认的 `prompts/write-draft.md`（开任务时会告诉你用哪份）。

## 3. 规则

写法归用户；和下面的规则冲突时以规则为准。

- 正文是 Markdown：小标题用 `##`，配图写成 `![说明](图片地址)`：用户给的地址，或者本机的图用 `annulo upload <文件>` 拿到的地址原样写（没有现成的图就不放，不要编图片地址、不要写本机路径）；
- 不编造数据、案例、引用；用到定位里「我是谁」的经历要照原样，不添油加醋；
- `summary` 一两句话，说清楚这篇讲什么、给谁看。

## 4. 存

写成 JSON 文件再存：

```bash
cat > /tmp/draft.json <<'JSON'
{ "idea_id": "<idea_id>", "title": "…", "summary": "…", "body": "…" }
JSON
annulo run drafts.save --input @/tmp/draft.json
```

存完回复用户：标题、大概写了什么，请到「稿件」页看、改，定稿后发到社媒。
