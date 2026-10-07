---
name: 写每周总结
description: 用 reports.data 拿这一期的全部数字，和上一期比，写结论、正文和下周建议，用 reports.save 存进 reports 表（「每周总结」页和总览显示）
---

「每周总结」页和总览读 `reports` 表，只写在对话里用户在后台看不到。每期总结要写进这张表。

## 1. 拿数字

```bash
annulo run reports.data --input '{"days":7}'
```

**总结里的数字只能来自这份输出**，别自己查表加总，也别另外去跑别的函数凑数：这份输出和各页面显示的是同一份。
输出里的内容：

- `period_start` / `period_end`：这一期的周期（截到今天的近 7 天），存的时候原样用；
- `channels.social`：每个社媒账号的粉丝、粉丝增量、这一期的浏览 / 点赞 / 评论增量、表现好的几条；`failed` 是读失败的；
- `content`：这一期发出去的帖子条数（按账号分），还有多少在待审；
- `previous_report`：上一期总结的 summary、highlights、suggestions，没有就是 null。

## 2. 怎么写

照这件任务的写法写：用户改过的在 `user/prompts/weekly-report.md`，没改过用模板默认的 `prompts/weekly-report.md`（开任务时会告诉你用哪份；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/weekly-report.md`）。

## 3. 规则

写法归用户（页面上的「AI 要求」改的就是它）；和下面的规则冲突时，以规则为准。

- **各账号分开说**：不同平台的浏览、点赞口径不同，不要加在一起比；
- **没有的数据写「没有」**：`failed` 里的、每天的数据还没开始记录的（看 `note`），都照实说，不写 0；
- 看上一期建议做没做：对照 `previous_report.suggestions` 和这一期的 content；
- 建议里能在后台直接做的，写清按钮在哪：
  - 内容中心「出一批选题」「AI 写文章」，内容详情里「添加账号」给各平台生成版本；
  - 内容中心里待审的版本；
  - 社交媒体页登录过期、发布失败的账号（重新登录、交给助手修）；
- 「怎么写」里要用外部服务的（比如写完发到邮箱），缺密钥或连接就照常把总结存好，在最后的回复里说明要到哪里配什么。

## 4. 存

写成 JSON 文件再存（正文里有换行、引号，直接写在命令行里容易坏）：

```bash
cat > /tmp/report.json <<'JSON'
{
  "period_start": "<reports.data 给的>", "period_end": "<reports.data 给的>",
  "title": "每周总结 · 9/20–9/26",
  "summary": "一两句话的结论，给总览卡片",
  "body": "Markdown 正文：## 小标题、列表、表格、**加粗**、[链接](https://…)",
  "highlights": [{ "label": "X 新增粉丝", "value": "86", "delta": "+12%" }],
  "suggestions": [{ "title": "多写工具测评", "why": "这周两条工具测评的点赞是平时的 3 倍…", "action": "内容中心 → 出选题", "link": { "view": "content" } }]
}
JSON
annulo run reports.save --input @/tmp/report.json
```

- `highlights` 放 4~8 个最关键的数字，`value` 是显示用的字符串，`delta` 可省。
- 同一周期再存一次会更新那一期，不会重复建；用户让你改总结就改完再存一次。
- 每条建议带 `link`，页面上 `action` 那行做成链接、点了直接过去：
  - 起步配置里没做完的那几项（`annulo run today.list` 的 `setup`，`key` 是 `profile`、`account`、`article`、`first-post`）写 `{ "setup": "<key>" }`；
  - 其余写页面：`{ "view": "<页面>" }`，页面是 `overview` 运营总览、`content` 内容中心、`calendar` 发布日历、`social` 社交媒体、`company` 我的定位、`assets` 资料库、`channels` 账号；
  - `action` 里的页面名照侧栏写（上面那些中文名），别写侧栏里没有的叫法。
- 存完回复用户：结论 + 下周建议的标题，并说「每周总结页刷新就能看到」。
