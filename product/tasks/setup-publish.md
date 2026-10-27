---
name: 配置网站的文章发布
description: 看一个网站的 CMS（没有博客就搭一个），写这个网站的发布脚本（字段映射），试发确认后标成能发；发布失败时也按它修
---

参数：`channel_id` 是要配置的网站；`note` 可能有：用户这次的要求，或者上次发布失败的报错（那就是来修的）。

每个网站的文章字段都不一样，所以发布靠你给这个网站写一个**发布脚本** `local/pub_<channel_id>.ts`：文章的哪一项填进 CMS 的哪个字段、正文要 HTML 还是 Markdown、封面和分类怎么填、文章地址怎么拼。
配好之后，用户在文章页点「发布」就直接执行这个脚本，不再经过你。**脚本里只写看过、确认过的东西，不要猜字段。**

**配好的标准是：有文章集合、脚本按集合的字段写好了映射。** 真发一篇能不能成功是之后的事：发布失败时用户会带着报错再点「让 AI 修」，按最后一节修。
所以集合里还没有文章、详情页因此打不开、没有文章可以试发，都不妨碍标成能发。

## 1. 看这个网站

用 `db_query` 读 `channels` 里这个网站：`type`、`project_id` / `site_id`（creght 站点）或 `preview_url` / `wp_user`（WordPress）、`publisher`、`publish_note`、`cms_config`（旧的配置，可以参考）。

**creght 站点**（`site_ref` 是 `<project_id>/<site_id>`）：

```bash
creght cms collections --site_id=<site_ref>                          # 有哪些集合，找博客 / 文章类的
creght cms collection get --site_id=<site_ref> --key=<集合>           # 字段：json_schema.properties，每个字段的类型、是否必填、说明（正文是 HTML 还是 Markdown）
creght content list --site_id=<site_ref> --collection=<集合> --limit 3   # 已有文章每个字段怎么填的、slug 什么风格
```

再确认文章页的地址：有已有文章就抓站点首页或列表页（`curl -s <preview_url>` 找文章链接）；没有的话把站点代码拉到 `$HOME/.shuttle/sites/<site_id>` 看详情页的页面文件（比如 `pages/blog/[slug].tsx` 对应 `/blog/<slug>`），按路由拼地址。

**WordPress**：`curl -s <站点>/wp-json/wp/v2/posts?per_page=2` 看已有文章，分类、标签在 `/wp-json/wp/v2/categories`、`/tags`。

## 2. 网站没有博客（creght 站点）

没有文章类的集合时，直接给它搭一个，不用问：

1. 建集合：标题、slug、摘要、正文（HTML）、封面图、发布日期，按需要加标签；`creght cms collection create --help` 看怎么写。
2. 把站点代码拉到 `$HOME/.shuttle/sites/<site_id>`（拉过就 `creght pull` 更新），照站点现有页面的风格加文章列表页和文章详情页，读这个集合；在导航里加入口。
3. `creght push` 推到预览，确认列表页能打开。集合里还没有文章时详情页打不开是正常的，不用为此卡住。
4. 不主动 `creght publish`：在最后的回复里告诉用户站点发布之后，正式域名上才看得到，问要不要发布；用户说发布就直接发布，不再确认。

## 3. 写发布脚本 local/pub_<channel_id>.ts

照 `local/_publish.ts` 开头的例子写，外面用 `publishTo` 包一层（发布状态、发布记录、效果追踪它都管了）。能用的：
`slugOf(a)`、`markdown(ctx, html)`、`plainText(ctx, html)`、`imagesIn(ctx, html)`、`today()`、`creght.create / update / contents`、`wp(ctx, ch, path, { method, body })`。

- CMS 里每个**必填**字段都要有值；文章里没有对应内容的（比如必填的封面而文章里没有图），**抛出一句说清楚的错**（缺什么、怎么补），不要编一个值填进去；
- 正文格式照字段说明：要 Markdown 就 `markdown(ctx, a.body)`；
- **正文里的图片不用管**：这台电脑上的图（`/_annulo/uploaded/…`、`local:…`）`publishTo` 在调脚本之前已经传到网站（creght 站点的素材库、WordPress 的媒体库），`a.body` 里都换成了网站上的地址，封面照常从 `imagesIn` 取；不要在脚本里再传图、改图片地址；
- 引用别的集合的字段（分类、标签、作者）：先查那个集合拿 id，查不到按网站已有的做法处理，脚本里写清楚；
- 再次发布同一篇（`prev?.cms_id` 有值）是更新，不是新建；slug 沿用 `prev?.slug`；
- `dry` 时只返回要发出去的内容（集合、slug、每个字段、地址），不要真的调接口；
- 返回 `{ cms_id, collection, slug, url }`，`url` 是这篇在这个网站上的真实访问地址。

## 4. 试发（有文章才做）

`db_query` 读 `articles`，有文章就挑一篇试发；没有就跳过这一步，直接标成能发：

```bash
annulo run pub_<channel_id>.publish --input '{"article_id":"<id>","dry":true}'
```

试发不传图：输出里的 `local_images` 是真发时要传到网站的图，正文里还是本机地址、封面可能是空的，这是正常的。逐个字段对照第 1 步看到的 CMS 结构：必填的都有、格式对；集合里有已有文章的话，slug 风格、地址也要和它们一样。不对就改脚本再试。只看 dry 的输出，不用去访问地址验证。

## 5. 标成能发

```bash
annulo run publishing.ready --input '{"channel_id":"<id>","publisher":"pub_<channel_id>","collection":"<creght 的文章集合，WordPress 不填>","note":"一句话：发到哪个集合、字段怎么对应、文章地址是什么样"}'
annulo push -m '配置「<网站名>」的文章发布'
```

`note` 会显示在网站页面上，用用户看得懂的话写，比如「发到 posts 集合；标题、摘要、正文（Markdown）、封面取正文第一张图；地址 /blog/<slug>」。

## 6. 回复用户

说清楚：发布脚本怎么映射的（就是 note）、试发看到的结果（没试发就说还没有文章，第一次发布时会真正验证）、有没有搭博客页面（搭了就问要不要发布站点）。之后在文章页勾选这个网站就能发。

## 修发布失败

`note` 里是发布报错时：先读现有的 `local/pub_<channel_id>.ts` 和报错，再看网站的 CMS 现在的样子（字段可能改了），改脚本、按第 4 步试发，好了再按第 5 步标成能发。
