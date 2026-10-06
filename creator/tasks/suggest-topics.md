---
name: 出选题
description: 按我的定位、已有选题和最近帖子的反响出一批新选题，写进选题池
---

参数：可以没有。`hint` 是用户这次额外的要求（比如「这周想写点 AI 工具」）。

## 1. 拿上下文

```bash
annulo run topics.context --input '{}'
```

输出里：`brief` 是我的定位（写什么、写给谁、风格、不写什么）；`existing` 是已有选题（包括写完的、放弃的）；
`recent_posts` 是最近发出去的帖子和它们的浏览、点赞、评论（看哪类内容反响好，多出那一类，但别重复同一个点）。
定位还没填（`brief` 里写着「还没填定位」）就在回复里提醒用户去「我的定位」填，照常按常识出一批。

## 2. 怎么写

照这件任务的写法写：用户改过的在 `user/prompts/suggest-topics.md`，没改过用模板默认的 `prompts/suggest-topics.md`（开任务时会告诉你用哪份；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/suggest-topics.md`）。

## 3. 规则

写法归用户（页面上的「AI 要求」改的就是它）；和下面的规则冲突时，以规则为准。

- 不要和 `existing` 里的选题重复或高度相似；和定位里「不写什么」冲突的不要出；
- 每个选题写 `title`、`angle`（切入点：写给谁、解决什么问题、和已有内容有什么不同）、`keywords`（关键词，逗号分隔）；
- 不编造数据、案例；需要事实支撑的在 `angle` 里写明要查证什么。

## 4. 存

写成 JSON 文件再存：

```bash
cat > /tmp/topics.json <<'JSON'
{ "ideas": [ { "title": "…", "angle": "…", "keywords": "…" } ] }
JSON
annulo run topics.save --input @/tmp/topics.json
```

返回的 `skipped` 是和已有选题重复、没存的。存完回复用户：列出存了哪些标题，请到「内容中心 → 选题」里挑着写。
