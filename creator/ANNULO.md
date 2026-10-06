# 自媒体工作台

这是一个从「自媒体工作台」模板建的项目：用户是自媒体人，在这里按定位出选题、写稿、改稿，再把一篇稿件改写成各社媒平台的帖子，审核后发布或排期，看各账号的数据。

## 流程和数据

| 页面（`pages/index.tsx`，`?view=`） | 表 | 本机函数、任务 |
|---|---|---|
| 定位（`profile`） | `profile`（只有一行：我是谁、写给谁、主要写什么、风格、不写什么） | 页面直接读写 |
| 选题（`ideas`） | `ideas`（`status`：idea 待写 / drafting 已成稿 / dropped 不写了） | 任务 `suggest-ideas`（出一批选题）；`ideas.context` / `ideas.save` |
| 稿件（`drafts`，`?draft=<id>` 是一篇） | `drafts`（Markdown 正文，`status`：draft / ready / archived，`idea_id` 指回选题） | 任务 `write-draft`（选题写成稿件）、`revise-draft`（改稿）；`drafts.context` / `drafts.save` |
| 稿件里的「发到社媒」 | 社媒插件的 `social_posts`（`article_id` 是稿件 id） | 插件的任务 `social/write-<平台>`，参数 `{ source: { fn: "drafts.source", id: <稿件 id> }, channel_ids }`；发布 `social/social.publish` |
| 账号与数据（`accounts`） | 社媒插件的 `social_accounts`、`social_health` | `social/social.login` / `collect` / `probe` / `health`、`social/stats.summary`；修平台按插件的任务 `social/fix-platform` |

写稿、出选题、改写帖子这些要 AI 想的活都是任务（`tasks/<id>.md`），按钮开一段对话交给你。用户在对话里让你做同样的事，照同一份任务做。
任务的「怎么写」用户能在页面上改（「AI 要求」按钮）：默认在 `prompts/<id>.md`，用户改的在 `user/prompts/<id>.md`；社媒的写法是插件的，用户改的在 `user/plugins/social/prompts/`。

## 社媒插件

社媒（账号登录、发布、采集、自检、各平台的写法）是 Annulo 插件 **social**（`plugins/social/`，github.com/annulo/plugins），先读 `plugins/social/PLUGIN.md`。
插件不带页面：这个模板的 `lib/social.ts`、`components/views/Distribute.tsx`、`Accounts.tsx` 是接它的地方，要换样子直接改它们。
稿件内容给插件的写作任务用 `drafts.source`（标题、纯文本正文、链接、Markdown 里的图、定位）。

插件没装时页面会提示去 设置 → 项目 → 插件 装上（模板在 `annulo.json` 里声明了它，新建项目时会自动装）。

## 改这个项目

- 页面在 `pages/index.tsx`，各视图在 `components/views/`；控件用 `components/ui/`（照 shadcn/ui 的写法），不要用浏览器自带的 `<select>`、`confirm`、`alert`。
- 页面文案在 `messages/zh.json`、`messages/en.json`，两边都要写。
- 加表：`tables/<表>.json`；页面用 `lib/annulo.ts` 的 `db` 读写。确定的、反复跑的活写成 `local/<文件>.ts` 本机函数，按钮用 `components/RunButton.tsx`；要 AI 写的活写成任务，按钮用 `components/Task.tsx` 的 `TaskButton`，旁边放 `TaskRequirements`。
- 改完用 page_errors 确认页面没有报错（`{"reload":true,"path":"/?view=drafts"}`）。
