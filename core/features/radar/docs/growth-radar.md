# 增长雷达（工作台 → 增长机会）

参考 TradeMax「增长雷达：汇总全系统信号，生成每周增长机会清单，每条附带下一步动作」（2026-10-19）。

## 怎么算（`local/growth.ts`）

全是确定的规则、只读业务表，不调模型（和 `today.ts` 一样秒出、每次一样）；要 AI 分析、排计划交给每周总结（`reports.data` 带上 `growth`，任务里写了优先从这里挑）。

| kind | 信号 | 优先级 |
|---|---|---|
| `leads_high` | 高意向的新询盘（真实的） | 优先 |
| `leads_stale` | 已联系 / 已报价 / 谈判中 3 天没动 | 有报价、谈判的优先，否则值得做 |
| `decay` | `content_decay` 少掉点击最多的 5 页（`docs/content-decay.md`） | 少 30 次以上优先 |
| `low_ctr`、`striking` | `search_pages` 还没动过的机会页，各取曝光最高的 3 个 | 值得做 |
| `search_gap` | 搜索来的选题（`topics.source=search`，还是 idea） | 值得做 |
| `keyword_quick_win` | 筛过的关键词里本站已经排在 Google 4~30 位的（`keywords.bucket=quick_win`，core 网站模块的 `docs/keywords.md`） | 值得做 |
| `keyword_open` | 查过 Google 结果页、前 10 里论坛 / 社媒 / B2B 平台多的词（`keywords.bucket=open`），还没转成选题 | 值得做 |
| `keyword_competitor` | 查 Google 结果页时在盯的竞品排在前 10、本站不在的词（`keywords.serp_competitors`），还没转成选题 | 值得做 |
| `competitor` | 竞品近 7 天的新页面，还没转选题；AI 推荐的竞品等确认（`competitor_suggested`） | 有产品页值得做，否则有空做；等确认的值得做 |
| `geo_gap` | 每个网站最近一次 AI 搜索检测里，推荐类问题没引用我们、引用了别家 | 值得做 |
| `geo_drop` | 同一个引擎可见度比上一次掉了 10 以上 | 值得做 |
| `audit` | 开着的严重网站问题 | 优先 |
| `change_worse` | 最近 14 天复查出「变差」的改动 | 值得做 |
| `unpublished` | 写好没发的内容 | 有空做 |
| `setup` | 没关联 Search Console、30 天没做 AI 搜索检测、没有在盯的竞品（动作是直接交给任务 `competitor-suggest`） | 有空做 |

分数 = 优先级底分（300 / 200 / 100）+ 这件事的量（询盘数、少掉的点击、曝光……，封顶 99），按分数排。

## 存（`growth_items`）

一件事一个 `key`（比如 `decay:<页面>`、`leads_high`），每次 `scan` 更新同一行，信号没了就删。
「做完了」记 `status=done` 和这周周一（`status_week`），下一周信号还在就恢复成新的；「不用管」记当时的数量（`status_value`），数量变多才恢复。
`seen` 是「新」标识：页面打开就 `markSeen`，侧栏「增长机会」后面写没看过的条数。

定时任务每周一次（`schedules/growth.scan.json`）。页面打开时从没算过（刚升级上来）就先算一次。`scan` 只用 `ctx.db`，手机上也能点。

## 动作

每条一个 `action`：现在都是 `{ kind: 'go', view, params }` 去对应页面做（页面上有现成的按钮和任务）；也支持 `{ kind: 'task' }` 直接交给助手，以后有不需要先看数据的事再用。
