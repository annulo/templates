---
name: 做落地页
description: 为一个目标在网站上做一个落地页：写简报，直接改网站代码做出页面，推到预览给用户看；用户在这段对话里提意见接着改，说上线才上线
prompt: landing-page
---

参数：`id` 是 landing_pages 表里这一条（用户新建时已经写了 `goal` 这页要做什么，可能还有 `note` 其他要求、推的产品、主关键词）。

## 1. 拿上下文

```bash
annulo run landing.context --input '{"id":"<id>"}'
```

- `page`：这一条；`goal`、`note` 是用户的原话，照它做。
- `site`：做在哪个网站。`type` 是 `creght_site`（`site_ref`、`site_id`、`preview_url`、`live_url`）或 `wordpress`（`url`）；`base` 是现在能打开的地址；
  creght 站点带 `forms`：站点已有的表单（询盘、联系），**页面上的表单用这里的**，没有就先问用户要不要新建一个，不要做一个提交了没人收的假表单。
- `project`：项目资料（定位、受众、语气、不写什么）；`products`：这页推的产品，参数、起订量、认证、价格只用这里的；
- `from`：从哪来的（关键词、选题、增长机会），有就按它的搜索意图和依据做；
- `images`：能用的图（资料库、产品图），只用这里的地址，或者自己做（见第 3 步）；
- `others`：这个网站上已有的落地页，不要做成和它们重复的页面。

先把网站现在的样子看一遍：打开 `site.base`（首页、一两个产品页、已有的落地页），记下导航、配色、字体、按钮、页脚长什么样。

## 2. 写简报，存一次

照「写法」（用户能在落地页页面上改）想清楚这页怎么做，写成简报（Markdown，给用户看，用界面语言写）：

- **给谁、要他做什么**：访客是谁、从哪来（搜什么词、点了哪个广告）、主按钮是什么；
- **结构**：一屏一屏往下（首屏、卖点、产品、证明、FAQ、行动），每屏一两句说放什么；
- **用到的真实资料**：产品参数、认证、案例、图片从哪来；
- **还缺什么**：没有的资料（客户案例、价格、视频）写成「需要你提供：…」，页面上先不放，**不编**。

定路径：照网站现有的路由风格（英文小写短横线），和 `others`、网站已有页面不重名。页面文字的语言用 `page.language`，空的跟网站一致。

```bash
cat > /tmp/landing.json <<'JSON'
{ "id": "<id>", "title": "<页面名，给运营看>", "brief": "<简报 Markdown>", "path": "/<路径>" }
JSON
annulo run landing.save --input @/tmp/landing.json
```

## 3. 做页面

**creght 站点**：代码拉到单独的目录（`creght pull --site_id=<site_ref> --dir="$HOME/.shuttle/sites/<site_id>"`，拉过就进去 `creght pull`），照站点现有的页面写一个新页面（路由对应 `path`），复用站点自己的布局、组件和样式。

- SEO：`title`、`description`、`canonical`、`og:image` 都写；主关键词自然地出现在标题、首屏和一两个小标题里，不堆；
- 表单：用 `site.forms` 里的表单，提交后有成功提示；
- 图片：用 `images` 里的；要新做的图（首屏大图、示意图）可以自己做或用项目的生图通道，做好 `annulo upload <图>` 拿地址再用，同时 `annulo run assets.add` 存进资料库；
- 不要动导航、首页和别的页面，除非用户要求；要在别处加入口，在回复里提一句问用户。

改完 `creght push`（只更新预览），用 `site.preview_url` + `path` 打开看一遍：电脑和手机宽度下各看一次首屏、表单能不能提交、有没有报错。

**WordPress**：用 `annulo run channels.wpRequest` 建页面（`POST /wp/v2/pages`，`status: "draft"`，`content` 是 HTML，区块用网站已有的样式类），草稿的预览地址给用户。密钥只在本机函数里，不要在命令行里直接调 WordPress。

## 4. 存进度，回复

```bash
annulo run landing.save --input '{"id":"<id>","status":"preview","preview_url":"<能打开的预览网址>","summary":"<一句话：这页长什么样、做了哪几块>"}'
```

回复用户：预览地址、这页的结构（一两句）、还缺哪些资料要他提供，再说一句「要改就在这里直接说；要上线跟我说一声」。

## 5. 用户在这段对话里接着说

用户在落地页页面点「继续对话」回到的就是这里。

- **改页面**：照意见改代码，`creght push`，自己再打开预览看一遍，`landing.save` 更新 `summary`（结构变了也更新 `brief`）；
- **上线**：用户说了「上线」「发布」才做。creght 站点 `creght publish`（整个站点一起发布：预览里还有别的没上线的改动也会一起上线，知道有的先告诉用户）；
  WordPress 把页面 `status` 改成 `publish`。上线后打开线上地址确认能访问，再存：

  ```bash
  annulo run landing.save --input '{"id":"<id>","status":"live","url":"<线上完整网址>"}'
  ```

  它会记一次上线的改动，过两周左右在「谷歌排名」里能看到前后对比。
- **不要了**：`landing.save` 把 `status` 标成 `archived`；网站上的页面要不要删问用户，删之前确认。

## 规则

- 资料只用上下文里有的和用户给的；参数、价格、认证、客户名、数字都不编，缺的写进简报「还缺什么」。
- 不把页面做成和网站风格不一样的一套，也不批量做只换关键词的近似页面。
- 一次只做这一页；用户要再做一个，让他在落地页页面新建一个。
