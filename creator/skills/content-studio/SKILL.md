---
name: content-studio
description: 内容生产：出选题、按项目资料写文章、改文章、把文章改写成各社媒账号的版本、审核和发布。用户说「出几个选题」「写一篇」「改改这篇」「发到 X / 小红书」时用它。
---

# 内容

数据在业务表里，读用 `db_query` / `db_aggregate`，写调本机函数（`annulo run <文件>.<函数> --input '<JSON>'`，见 ops-backend skill「读写业务表」）。

- `profile`：项目资料（只有一行：定位、写给谁、语气、关键词……，字段含义见 ANNULO.md / SHUTTLE.md）。**写任何内容前先读它**，写出来的东西要符合它。
- `topics`：选题，也是选题记忆。`status`：`idea` → `writing` → `done`（或 `dropped`）；选题的详情（读者、大纲、结尾引导……，界面上在「编辑选题」里）在 `brief`，用 `content.saveBrief` 更新。
- `articles`：文章，可以只有标题。`status` 只有 `draft` 和 `published`：文章本身不审核，审核在各个版本上。老数据里的 `pending_review`、`rejected` 当 `draft`。
- `social_posts`（社媒插件的表）：每个社媒账号一条版本，`article_id` 指回文章，各自有文案、图或视频、审核（`pending_review` → `approved`）、排期、发布和互动数据。
- 模板还能发到别的地方（比如网站）的，那些版本和发布见模板自己的 skill（ANNULO.md / SHUTTLE.md 的模块表里写着）。

## 一篇文章，多个版本

界面上只有「选题」和「文章」两个概念，跟用户说话也只用这两个词（不说写作计划、写作主题、简报、初稿、内容稿、稿件）。

「内容中心」是唯一的创作入口：先有文章，再按发布目标生成版本。用户要给某个社媒账号写内容，先找到或新建文章，再按社媒插件的任务 `social/write-<平台>` 写
（参数 `{ source: { fn: "content.socialSource", id: <文章 id> }, channel_ids }`）；不要建没有 `article_id` 的帖子。
用户要看或编辑内容，让他去「内容中心」的详情。已经发出去的版本保留原文和互动数据，要改就另建一个版本。

## 出选题

照任务 `tasks/suggest-topics.md` 做（内容中心「出一批选题」也是按它开对话交给你）：`topics.context` 拿上下文，按里面的要求出，`topics.save` 存。

## 写文章

照任务 `tasks/write-article.md` 做（「AI 写文章」「写成文章」也是按它开对话交给你）：`content.context` 拿上下文，按「怎么写」写，`content.save` 存成文章。

## 改文章

用户可以在文章页手动改，也可以点「让 AI 改」写一句要求，交给你按任务 `tasks/revise-article.md` 改（在表里当前的内容上改，手动改过的地方保留），改完 `content.update` 存。
用户在对话里让你改某篇，也照这个任务做。

## 写法归用户

每个任务「怎么写」单独一个文件：默认 `prompts/<id>.md`，用户改过的在 `user/prompts/<id>.md`（有就用它）。用户要改写法，把改后的完整写法存到 `user/prompts/<id>.md`，不要改任务文件和 `prompts/` 下的默认。
社媒帖子的写法是插件的，用户改的存 `user/plugins/social/prompts/write-<平台>.md`。

## 发布状态

`articles.status` 不表示有没有发出去：查 `article_id` 等于文章 id 的各个版本（`social_posts`，模板有网站的还有它的发布记录）的 `status`、`post_url`；至少一个版本 published，列表和详情就显示已发布。
不要因文章是 draft 就判断从没发过，也不要因此自动重发。没审核通过、用户没明确要求，**不要发布**；社媒的发布、排期按 `plugins/social/PLUGIN.md` 和插件的 skill 做。
公众号还没接入：用户要发时按公众号的格式写好给用户，说明目前要自己发。
