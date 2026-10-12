---
name: websites
description: 外贸模板的网站渠道：creght 独立站和 WordPress 站怎么操作、给网站发文章（发布脚本、publications）、改站代码、看访问数据的口径。用户提到网站、独立站、「我的站」、发到网站、改网站、访问量时用它（后台通用做法见 ops-backend，写内容见 content-studio）。
---

# 网站渠道

渠道存在 `channels` 表（界面上叫「网站和账号」），增删由用户在后台操作，不要直接改。用户提到某个网站、「我的站」时，先 `db_query` 查 `channels` 对上是哪个渠道。

## 渠道有哪些

渠道是用户要运营的地方，由用户在后台里主动添加，存在运营后台项目的 `channels` 表里：
- `creght_site`：独立站，用户从自己 creght 账号下的站点里选一个；
- `wordpress`：WordPress 独立站，用户填站点地址、用户名，应用密码存成本机密钥（名字 `WP_<域名>_APP_PASSWORD`，渠道上只记 `wp_user`、`wp_secret`），见下文；
- 社媒账号不在 `channels`，在社媒插件的 `social_accounts`（见 `plugins/social/PLUGIN.md`），这个模板能加哪些看 `lib/edition.ts` 的 CHANNELS；
- `wechat_mp`：公众号，还没接入。

用户 creght 账号下的其他站点不会自动出现，只有添加为渠道的才算。

## 两类站点，先分清

| | 运营后台 | 渠道（独立站） |
|---|---|---|
| 是什么 | 用户看数据、管内容的后台 | 用户要运营的网站 |
| 在哪 | 工作目录（当前 cwd） | 另一个 creght 站点，channels 表里的 `project_id/site_id` |
| 什么时候动 | 用户要改后台的页面、加功能 | 写文章、改站、SEO 修复 |

**给渠道干活时绝不改工作目录里的文件。**

用户在后台点「交给助手…」按钮时，会发来一句带着 id 的话（比如「修复渠道「X」（site_ref …）体检发现的问题「…」（site_issues 表 id …）」）。
照着里面的 id 去读表、干活，干完把状态写回表里，后台刷新就能看到。

## 操作渠道

1. 读 channels 表找到渠道，拿到 `type` 和 `project_id/site_id`。用户说的名字和渠道名对不上、或有多个可能时，先问清楚。
2. 看访问数据用运营后台的本机函数，不要自己拼平台接口：
   `annulo run channels.stats --input '{"days":30}'`（所有渠道的汇总：`list` 是网站的访问量，`social` 是社媒的粉丝和互动，见 SHUTTLE.md「看数据」）、
   `annulo run channels.overview --input '{"site":"<project_id>/<site_id>","days":30}'`（单个站点：汇总、按天趋势、来源/页面/地区 Top 20）。
3. 按类型处理：

### 独立站（creght_site）

**写文章 / 发内容**：优先走站点已有的 CMS，不改代码。
- 写文章按 **content-studio** skill，发到网站见下文「发布到网站」。
- 看站点的 CMS：`creght cms collections --site_id=<site_ref>`、`creght cms collection get --site_id=<site_ref> --key=<集合 key>`、
  `creght content list --site_id=<site_ref> --collection=<key>`。
- 正文字段是 HTML 不是 Markdown（见 creght skill 的 cms.md）。
- 写好的文章存进 articles 表等用户审核，不要直接写进站点 CMS。
  临时文件放 `/tmp`，不要放工作目录。
- 站点没有文章类集合：告诉用户，给出两个选项让用户选（新建一个 CMS 集合并加文章页 / 只把文章写给用户看），不要擅自建。

### WordPress 独立站（wordpress）

走 WordPress 自带的 REST（`<站点>/wp-json/wp/v2/...`），代码在 `local/_wp.ts`。站点地址在 `preview_url`（就是线上地址，没有预览环境）。
- 添加：渠道页「添加渠道 → WordPress 网站」，用户在弹窗里填地址、用户名、应用密码；页面把密码写进本机密钥（`setSecret`，调 `PUT local/secrets`），
  再跑 `channels.add`（type wordpress）用它调一次 `/users/me` 验证。密码失效时在渠道页「更新应用密码」，存完跑 `channels.wpVerify`。
- 发文章：和 creght 站点一样，先按 `tasks/setup-publish.md` 配好发布脚本（分类、标签、特色图各站不同），之后在文章页勾选发布。
- 没有平台的访问统计：`channels.stats` 把它列在 `no_stats`，不要说成 0。关联了 GA4（`channels.ga4_property`）的，用 `annulo run ga4.overview --input '{"channel_id":"…","days":30}'` 看会话、用户、来源、转化；没关联的在「搜索表现 → GA4 访问数据」关联 GA4。询盘同步、搜索表现（GSC）还只支持 creght 站点。
- 你要直接调它的 REST（比如修体检问题）：你的命令行里没有应用密码（密钥只给本机函数），用
  `annulo run channels.wpRequest --input '{"id":"<渠道 id>","path":"/wp/v2/pages/12","method":"POST","body":{…}}'`（path 从 /wp-json 后面写起）。**改动立即上线**，每一处先跟用户确认。

### 独立站（creght_site）：改站代码

**改站代码**（SEO 修复、改文案、加页面）：
- 拉到单独的目录：`creght pull --site_id=<site_ref> --dir="$HOME/.shuttle/sites/<site_id>"`，已经拉过就进去 `creght pull` 更新。
- 在那个目录里改，`creght push` 只更新预览，把渠道的 `preview_url` 给用户看效果（渠道网站的预览地址是能打开的）。
- 发布上线（`creght publish`）：不主动做，改完把预览地址给用户，问一句要不要发布。**用户说了「发布」「上线」就直接发布**，不再追问、不要求先看预览；有风险（比如某个页面还是空的）在发布后的回复里提一句。

## 发布到网站（publications）

一篇文章可以发到多个网站。每个网站有一个**发布脚本** `local/pub_<网站 id>.ts`，字段怎么映射全写在里面；发布记录在 `publications` 表（一篇文章在一个网站上一行：状态、CMS 内容 id、地址）。
网站的 `publish_status` 是 `ready` 才能发；没配好的，用户在文章页、网站页点「让 AI 配置发布」，就是按任务 `tasks/setup-publish.md` 交给你配。**系统不替网站猜字段，没配好就是不能发。**

- 用户在对话里明确要求发布某篇到某个网站：`annulo run <publisher>.publish --input '{"article_id":"<id>"}'`（`publisher` 在 channels 表里），把返回的 `url` 给用户。再发一次就是更新。
- 不确定会发出去什么，先加 `"dry":true` 看。用户没明确要求，**不要发布**。
- 发布报错（字段变了、必填的没有）：按 `tasks/setup-publish.md` 的「修发布失败」改脚本，不要绕过脚本手动写 CMS。
- 第一次发到一个网站会自动进「改动复查」（site_changes）：17 天后看这篇带来了多少搜索点击 / 访问（见 search-console skill）。
- CMS 内容是实时的，站点已发布时马上就能看到；站点还没发布过（只有预览），告诉用户发布站点后才会出现在正式域名上，问要不要发布；不主动 `creght publish`，用户说发布就直接发布。
- 用户要给某个网站配发布、改映射：照 `tasks/setup-publish.md` 做。

## 访问数据的口径（channels.stats / channels.overview）

`overview` 返回 `summary {pv_count, uv_count, ip_count}`；`trend` 按天 `[{day:"20260924", pv_count, uv_count, ip_count}]`；
`breakdowns` 各维度 Top 20（`referrer_host`、`url`、`country`、`city`、`device_type`、`browser`、`os`、`channel`）。

- PV：浏览量；UV：按访客 cookie 去重；IP：独立 IP。只统计已发布站点的访问，预览不计。
- `trend` 里每天的 `uv_count` 是当天去重，跨天相加会重复计人，汇总用 `summary`。
- 平台目前没有「新访客」（首次访问）口径。用户说「每日新增访问」时，按每天的访问量理解（PV 为主，可同时画 UV），并在回复里说明口径。
