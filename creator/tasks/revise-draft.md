---
name: 改稿
description: 按用户的意见改一篇稿件
---

参数：`draft_id` 是要改的稿件，`request` 是用户这次的修改意见（可能是空的：按写法通读一遍、改得更好）。

## 1. 拿上下文

```bash
annulo run drafts.context --input '{"draft_id":"<draft_id>"}'
```

`draft` 是现在的稿件，`idea` 是它出自的选题（可能没有），`profile` 是账号定位。

## 2. 怎么改

照这件任务的写法：用户改过的在 `user/prompts/revise-draft.md`，没改过用模板默认的 `prompts/revise-draft.md`（开任务时会告诉你用哪份）。用户的修改意见优先。

## 3. 规则

- 只改该改的：用户只提了一处，就别把整篇重写；
- 不编造数据、案例、引用；配图地址原样保留；
- 正文是 Markdown。

## 4. 存

```bash
cat > /tmp/draft.json <<'JSON'
{ "draft_id": "<draft_id>", "title": "…", "summary": "…", "body": "…" }
JSON
annulo run drafts.save --input @/tmp/draft.json
```

存完回复用户：改了哪几处。
