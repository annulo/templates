# 空白项目

这是一个从空白模板建的项目：用户会告诉你想要什么工具，你在这个项目里把它做出来。

## 现在有什么

- `pages/index.tsx`：首页。显示 `notes` 表里的记录，能新增、删除；一个按钮跑本机函数 `notes.stats`；一组「交给助手」的示例。
- `tables/notes.json`：示例表（备忘）。
- `local/notes.ts`：示例本机函数（统计备忘条数）。
- `lib/annulo.ts`：页面调本机接口的封装（读写表、跑本机函数、交给助手）。
- `messages/zh.json`、`messages/en.json`：页面文案，中英双语。

## 加东西的做法

- 用户要一个新页面：加 `pages/<名字>.tsx`，在首页或导航里放入口。
- 要存数据：加 `tables/<表>.json`（一张表一个文件），页面用 `lib/annulo.ts` 的 `db` 读写。
- 确定的、要反复跑的活（同步、检测、调外部接口）：写成 `local/<文件>.ts` 本机函数，页面按钮用 `runLocal` 调，定时跑就加 `schedules/<id>.json`。
- 要 AI 读东西、写东西的活：写成 `tasks/<id>.md` 任务，按钮用 `runTask` 交给助手。
- 示例（备忘）用不上了就删掉：页面、表、函数一起删。
- 改完用 page_errors 确认页面没有报错。
