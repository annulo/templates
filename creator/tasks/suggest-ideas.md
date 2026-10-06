---
name: 出一批选题
description: 按账号定位出一批值得写的选题，存进选题列表
---

参数：`hint` 是用户这次额外的要求（可能是空的，比如「这周想写点 AI 工具」）。

## 1. 拿上下文

```bash
annulo run ideas.context --input '{"hint":"<hint>"}'
```

`profile` 是账号定位（没填的话先提醒用户去「定位」页填，但照样按常识出一批）；`existing` 是已有的选题和稿件标题，不要和它们重复或换个说法再出一遍。

## 2. 怎么出

照这件任务的写法：用户改过的在 `user/prompts/suggest-ideas.md`，没改过用模板默认的 `prompts/suggest-ideas.md`（开任务时会告诉你用哪份）。

## 3. 规则

写法归用户；和下面的规则冲突时以规则为准。

- 每个选题要有 `title`（题目，像真的会发出去的标题）和 `angle`（一两句：为什么值得写、切入点是什么）；
- 不编造数据、案例、名人名言；需要事实支撑的写进 `notes` 提醒自己查证；
- 和定位里「不写什么」冲突的不要出。

## 4. 存

写成 JSON 文件再存：

```bash
cat > /tmp/ideas.json <<'JSON'
{ "ideas": [{ "title": "…", "angle": "…" }] }
JSON
annulo run ideas.save --input @/tmp/ideas.json
```

存完回复用户：出了几个、各是什么，请到「选题」页挑一个写成稿件。
