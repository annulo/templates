---
name: content-studio
description: 内容生产：出选题、按项目资料写文章（长文、图文笔记、视频）、改文章、改写成别的类型、发布到社媒账号。用户说「出几个选题」「写一篇」「改改这篇」「改成小红书」「发到 X / 小红书」时用它。
---

# 内容

数据在业务表里，读用 `db_query` / `db_aggregate`，写调本机函数（`annulo run <文件>.<函数> --input '<JSON>'`，见 ops-backend skill「读写业务表」）。

- `profile`：项目资料（只有一行：定位、写给谁、语气、关键词……，字段含义见 ANNULO.md / SHUTTLE.md）。**写任何内容前先读它**，写出来的东西要符合它。
- `topics`：选题，也是选题记忆。`status`：`idea` → `writing` → `done`（或 `dropped`）；选题的详情（读者、大纲、结尾引导……，界面上在「编辑选题」里）在 `brief`，用 `content.saveBrief` 更新。
- `articles`：文章，一篇一种类型（`type`：`article` 长文、`post` 图文笔记、`video` 视频；空的按长文看），字段见 ANNULO.md「文章类型」。`status` 只有 `draft` 和 `published`，老数据里的 `pending_review`、`rejected` 当 `draft`。`source_id` 是改写自哪篇。
- `rewrite_presets`：用户存的改写预设（`type` + `prompt`）。
- `social_posts`（社媒插件的表）：发布记录，一篇文章发到一个账号一条，`article_id` 指回文章，有状态、排期、链接和互动数据。内容是发布时从文章复制的。
- 模板有网站渠道的：长文还能发到网站，在 `publish.prepare` 里和社媒账号一起选，记录在 `publications`（见 SHUTTLE.md「内容架构」和 websites skill）。

## 一篇文章，直接发

界面上只有「选题」和「文章」两个概念，跟用户说话也只用这两个词（不说写作计划、简报、初稿、稿件、版本）。文章就是要发的内容：
文章页点「发布」勾选支持这种类型的账号，马上发或排期。不再按账号各写一版；同一篇要发到不支持它类型的平台（比如长文要发小红书），就改写成那种类型的新文章再发。

用户在对话里让你发：先确认是哪篇、发到哪些账号（只能选支持这篇类型的），然后

```bash
annulo run publish.prepare --input '{"article_id":"<id>","channel_ids":["<账号 id>"]}'
```

`problems` 里是没通过平台规格检查的账号（照着改文章再发）；`ready` 里每条再 `annulo run social/social.publish --input '{"post_id":"<post_id>"}'` 发出去（要排期就传 `scheduled_at`，到点自动发，不用再调 publish；网站也一样，到点由定时任务 `publishing.publishScheduled` 发）。
没审核过、用户没明确要求，**不要发布**。

## 出选题

照任务 `tasks/suggest-topics.md` 做（内容中心「出一批选题」也是按它开对话交给你）：`topics.context` 拿上下文，按里面的要求出，`topics.save` 存。

## 写文章

照任务 `tasks/write-article.md` 做（「AI 写文章」「写成文章」也是按它开对话交给你，参数 `type` 是文章类型）：`content.context` 拿上下文，按「怎么写」写，`content.save` 存成文章。

## 改写成别的类型

照任务 `tasks/rewrite-article.md` 做（文章页「改写」按它开对话，参数 `article_id`、`type`、`note`）：`content.rewriteContext` 拿原文和目标类型的限制，`content.save` 带 `source_id` 另存一篇，原文不动。
用户说「把这篇改成小红书」「写一条推文版」：就是改写成图文笔记。

## 改文章

用户可以在文章页手动改，也可以点「AI 修改」写一句要求，交给你按任务 `tasks/revise-article.md` 改（在表里当前的内容上改，手动改过的地方保留），改完 `content.update` 存。
用户在对话里让你改某篇，也照这个任务做。

## 写法归用户

每个任务「怎么写」单独一个文件：默认 `prompts/<id>.md`，用户改过的在 `user/prompts/<id>.md`（有就用它）。用户要改写法，把改后的完整写法存到 `user/prompts/<id>.md`，不要改任务文件和 `prompts/` 下的默认。
改写没有写法文件：用户每次在弹窗里写要求，常用的存成改写预设（`rewrite_presets`）。

## 发布状态

`articles.status` 不表示有没有发出去：查 `article_id` 等于文章 id 的 `social_posts`（有网站的模板还有 `publications`）的 `status`、`post_url` / `url`；至少一条 published，列表和详情就显示已发布。
不要因文章是 draft 就判断从没发过，也不要因此自动重发。社媒的发布、排期细节按 `plugins/social/PLUGIN.md` 和插件的 skill 做。
公众号还没接入：用户要发时按公众号的格式写好给用户，说明目前要自己发。
