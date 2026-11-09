# 内容衰减雷达（谷歌排名 → 流量下滑）

参考 TradeMax「内容衰减雷达：用双数据源找出曾经带流量、现在下滑的文章，排队刷新」（2026-10-19）。

## 怎么算（`local/decay.ts`）

- 最近 168 天切成 6 个 28 天（结束在 3 天前，GSC 有延迟），每段按页面读一次 GSC。最近一段和之前 5 段里点击最多的那段（高峰）比：
  高峰至少 10 次点击、少了三成以上、少了至少 5 次，算下滑（`detect`）。只和上一个 28 天比太容易被波动带偏，所以用高峰。
- 首页不算：点击几乎都是搜公司名。其余候选（按少掉的点击排，最多 20 个）再按「页面 + 搜索词」读高峰和现在两段，去掉品牌词和 `site:` 查询重算一遍，
  去掉以后不算下滑的（点击全靠品牌词）丢掉。展示的数字仍是页面总数（搜索词数据有匿名长尾，加起来比页面总数少）。
- 原因（`causeOf`）：排名掉了 2 位以上 → `rank`；曝光还在八成以上、点击率掉了两成以上 → `ctr`；其余 → `demand`（搜的人少了、季节性、丢了词）。
- 写进 `content_decay`，一页一行；回升了、页面没了就删掉。`status=dismissed` 是用户点了「不用管」，还在下滑就一直留着。
- 定时任务每周一次（`schedules/decay.scan.json`），没关联 Search Console 时安静跳过；页面上「重新查找」带 `manual`，没关联就报错。

TradeMax 说的「双数据源」还有 GA4。这一版只用 GSC：外贸要的是搜索流量，GA4 的落地页会话混着广告和社媒；以后要加，在 `scanChannel` 里按页面读 GA4 的两段会话，作为第二个判断。

## 怎么改（复用谷歌排名的流程）

每行挂在 `search_pages` 同一个页面的记录上（`search_page_id`），后面的事和「值得改的页面」是一套：

- `ctr`：任务 `search-meta` 写新标题描述 →「交给助手改站」→ `fixing` →「已上线，开始复查」（`search-verify-live`，`kind=search_meta`）。
- `rank`、`demand`：任务 `tasks/refresh-page.md` 读 `decay.context` 和 `gsc.pageContext`，按掉的搜索词写刷新要点，用 `gsc.saveBrief` 存进 `search_pages.expand_brief`
  →「交给助手改页面」（`search.refresh_prompt`）→ 复查 `kind=search_content`。
- 最近 28 天没曝光的页面没有 `search_pages` 记录，只提示先同步，不给按钮。

## 页面

`components/views/Search.tsx` 的 `Decay` / `DecayRow`（页签 `tab=decay`）。「新」照全站约定：打开这一页就 `decay.markSeen`，这次还标着，下次不标。增长雷达把下滑最多的 5 页列成机会（`docs/growth-radar.md`）。
