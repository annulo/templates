---
name: 生成 GEO 问题
description: 按项目定位和站点内容，写出还不知道你的人（外贸、产品是买家和用户，自媒体是读者）会问 AI 搜索的问题（看 AI 推荐了谁），存进这个网站的问题库
---

参数：`channel_id` 是要准备问题的网站。`requirements`（可选）见第 2 步。

## 1. 拿上下文

```bash
annulo run geo.questionsContext --input '{"channel_id":"<id>"}'
```

输出里：`brief` 是项目定位、目标客户、关键词；`site.digest` 是站点首页和几个页面的内容；`existing` 是问题库里已有的问题（不要重复）。

## 2. 怎么写

照这件任务的写法写：用户改过的在 `user/prompts/geo-questions.md`，没改过用模板默认的 `prompts/geo-questions.md`（开任务时会告诉你用哪份；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/geo-questions.md`）。

参数里有 `requirements` 时，它是用户在弹窗里写的这一批的额外要求：在写法之上照它做，两者冲突以它为准；它只用于这一批，不存成默认写法。

## 3. 规则

写法归用户（页面上的「AI 要求」改的就是它）；和下面的规则冲突时，以规则为准。

- 只写这个站点的内容有可能回答的问题，不要凭空编行业；不要和 `existing` 重复；
- **问题里不要出现公司名、人名、品牌词、网站**：带品牌的问题系统会按项目资料自动生成（`intent=brand`，看 AI 怎么介绍你），这里只写还不知道你的人会问的；
- 每个问题写 `question`、`intent`（`commercial` 想买、想找人做 / `comparison` 对比选择 / `informational` 想了解）、`keywords`（2~4 个关键词，逗号分隔）。

## 4. 存

```bash
cat > /tmp/geo-q.json <<'JSON'
{ "channel_id": "<id>", "questions": [ { "question": "…", "intent": "commercial", "keywords": "…" } ] }
JSON
annulo run geo.saveQuestions --input @/tmp/geo-q.json
```

存进去的问题直接启用（下次检测就会问）。返回的 `skipped` 是重复没存的。
存完回复用户：列出存了哪些问题，不想要的可以在 GEO 页面里暂停或删除，然后点「开始检测」。
