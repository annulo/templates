---
name: site-audit
description: 给独立站（creght 站点）做 SEO / GEO 体检：抓取页面、按清单找问题、写进运营后台的体检记录，并按问题修站、复查。用户说「体检」「检查 SEO」「站点有什么问题」「修复体检问题」时用它。
---

# 站点体检

体检（抓取 → 按清单检查 → 打分 → 记录）是确定的活，写成了本机函数 `local/audit.ts`。**不要自己抓页面、自己判断、自己写表**：

- 用户在「站点体检」页点「开始体检 / 重新体检」就是在跑它，十几秒到一分钟，不经过你。
- 每 7 天自动体检一次所有独立站（`schedules/audit.run.json`），不用每次都等用户点。
- 用户让你体检时：`annulo run audit.run --input '{"channel_id":"<渠道 id>"}'`，输出里有得分、各级问题数、最该先修的几条。
  可选 `max`（最多抓多少页，默认 40）、`dry: true`（只检查不写表，排查用）。
- 检查清单、严重程度、打分规则、和已有问题的合并方式都写在 `local/audit.ts` 里。用户要调规则（比如「描述长度放宽到 200」）就改那个文件，
  `annulo run audit.run --input '{"channel_id":"…","dry":true}'` 验证后再 push。
- 跑完回复用户：得分、问题数（按严重程度）、最该先修的 2~3 个，并说明「体检」页刷新就能看到。

问题记录在 `site_issues`（每个渠道每个 check 一条，`status`：open / fixing / fixed / ignored），体检记录在 `audit_runs`。

## 修复 WordPress 站点（渠道 type 是 wordpress）

WordPress 没有预览环境，改了就上线。每个改动先告诉用户改哪页、改成什么，用户确认后再改；不用标 `fixing`，改完直接重新体检（`audit.run`），修好的会变成 `fixed` 并进改站复查。
- 标题、摘要、正文、图片 alt：`annulo run channels.wpRequest --input '{"id":"<渠道 id>","path":"/wp/v2/posts/<id>"}'`（页面是 `/wp/v2/pages/<id>`）读出来，改完带 `"method":"POST","body":{…}` 写回去；按 slug 找：`/wp/v2/posts?slug=<slug>`。你的命令行里没有应用密码，只能这样调。
- meta description、结构化数据、sitemap、robots.txt 多半由 SEO 插件（Yoast、Rank Math）管，REST 不一定改得了：告诉用户在插件里怎么改，不要去改主题代码。
- 页面太慢、主题问题：只给建议。

## 修复 creght 站点（用户要求时）

1. 把渠道站点拉到单独目录：`creght pull --site_id=<site_ref> --dir="$HOME/.shuttle/sites/<site_id>"`（拉过就在里面 `creght pull`）。**不要改运营后台的工作目录。**
2. 读 creght skill 里对应的参考（seo.md、site-code.md、platform-endpoints.md），按问题修：
   - title / description / og：页面导出的 `metadata`，或 `talizen.config.ts` 的 metadata 模板；
   - H1、alt、内容：页面组件；CMS 驱动的内容用 `creght content update`；
   - 结构化数据：metadata 里的 JSON-LD 或 head 注入；
   - sitemap / robots / llms.txt：`sitemap.ts`、`robots.ts`、`llms.ts`（先读 platform-endpoints.md）；
   - 页面太慢：先找原因（SSR 里请求了慢接口、图片过大），给用户说明，不确定就不改。
3. `creght push` 只更新预览。把修改涉及的问题 status 改成 `fixing`（`annulo run records.patch --input '{"table":"site_issues","id":"<id>","data":{"status":"fixing"}}'`），告诉用户在渠道的预览地址确认，确认后在「站点体检」页点「确认上线」（**不要自己 publish**）。
4. 「确认上线」跑的是本机函数 `audit.publish`：发布站点 → 按线上地址再体检一次 → 修好的变成 `fixed` 并自动进「改动复查」（17 天后对比修复前后的搜索点击 / 访问，见 search-console skill），
   没修好的从 `fixing` 退回 `open`。用户在别处发布了的话，点「重新体检」效果一样。
