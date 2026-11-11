# 主动获客

参考 TradeMax「LinkedIn 主动获客：Agent 分析 ICP、按 ICP 精筛客群、精准触达」（2026-10 规划第五期）。

## 流程

客户画像（任务 `tasks/draft-icp.md`，助手读公司资料、产品、企业资料，写画像、Google 搜索词、Apollo 条件）→ `prospects.saveIcp` 存成 `draft` 批次 → 用户在页面上选找法、改条件 →
`prospects.run`：找客户（批次的 `source`，见下）→ 评分（`ctx.llm`，一批 20 个，0~100、理由、一句英文开场白）→ `done`。
合格（≥ 60）的排前面；`convert` 转成询盘（`leads`，`source=prospect`，`intent` 按分数），之后在询盘的看板、背调、回复里跟。

评分放在本机函数里调模型：它是「后台自动的判断」（和询盘判断真假一样），一批上百人，不适合每个人开一段对话。

## 两种找法（批次的 `source`）

Apollo 的找人接口要付费套餐（免费账号建 API Key 时勾不了 `mixed_people/*`、`people/match`，2026-10-24 用户实测），所以加了不要任何账号的官网反查，新批次默认用它。

| | `web` 官网反查（默认） | `apollo` |
|---|---|---|
| 要什么 | 用户的 Chrome 装 Annulo 插件 | Apollo 付费套餐的 API Key |
| 一行是 | 一家公司（`name` = 公司名） | 一个人 |
| 联系方式 | 官网上公开的邮箱、电话、领英公司页（`email_status=public`） | 邮箱要 `enrich`，花积分 |
| 去重 | `company_domain`（还排除自己的站、竞品） | `apollo_id` |

老批次没有 `source`：有搜索词算 web，否则 apollo。

## 官网反查（`local/_webfind.ts`）

1. **搜**：`queries`（英文，「产品 + 买家类型 + 国家」，8~15 个）用 core 的 `serp.searchMany` 在用户的 Chrome 里一个个搜 Google，每个歇 6~10 秒。碰到人机验证停下，用已经搜到的，提醒写进批次的 `error`（`done` 也可能有）；
2. **挑官网**：`pickSites` 只留 `kindOf` 是 `site` 的（B2B 平台、电商、论坛、社媒去掉），再去掉政府、学校、目录站、建站平台二级域名，和已经找过的；最多 `limit` 家（默认 50）；
3. **读**：`ctx.fetchAll` 读首页，再读首页里最多两个联系页、关于页（各语言的 contact / kontakt / impressum / about…）。邮箱从 `mailto:`、Cloudflare 的 `data-cfemail`、正文里取，官网域名下的排前面，去掉 noreply、图片文件名这类；电话只认 `tel:` 链接。读不到的（被防火墙拦）只有搜索结果的标题和摘要，照样评分；
4. **评分**：模型认公司名、国家、一句话行业，按「会不会买我们的产品」打分（进口商、分销商、零售商、品牌商、集成商高；同行工厂、平台、媒体低）。评分失败的这批不存，「再找一批」还能再找到。

只读对方官网公开的页面，不自动发邮件；找到的公开邮箱多是 info@、sales@，开发信由用户自己发。

## Apollo

封装在 `local/_apollo.ts`，密钥 `APOLLO_API_KEY`（用户自己的账号）。找人先调 `/mixed_people/api_search`，404 时退回 `/mixed_people/search`；返回的字段名两种都兼容（`toPerson`）。
邮箱要 `/people/match`（每人 1 个积分），所以只对用户勾选的人取（`enrich`，一次最多 25 个），助手不自己去取。
**没有拿真 Key 跑过**（2026-10-16 写的时候没有账号），第一次用要对着真账号看一遍：接口地址、字段、限流。

## 领英

只存 Apollo 给的主页链接，用户在自己的浏览器里看、自己加好友。不用浏览器自动加人、发私信：领英对自动化封号很严，也容易被当成骚扰。

## 去重

同一个 Apollo 联系人（`apollo_id`）在所有批次里只出现一次；`run` 可以对同一个批次再跑（「再找一批」），只加新的人。
