---
name: 找外链机会
description: 按项目的行业、产品和目标市场，联网找能拿到外链的具体地方（展会参展商名录、行业目录和协会、设计 / 选品库、B2B 平台公司页、竞品的外链来源、客户和合作方），逐个打开核实，写清怎么申请、难不难、要不要钱，存成外链表里「打算做」的条目
---

## 1. 拿上下文

```bash
annulo run backlinks.context --input '{}'
```

输出里：

- `project`：项目定位，`markets` 重点市场，`customer_types` 客户类型，`products` 产品目录（名称、类目、关键词）；
- `own_sites`：自己网站的域名，`pages`：自己网站上谷歌有曝光的页面（挑「指向哪一页」用）；
- `existing`：已经登记的外链（域名、状态），这些网站**不要再推荐**；
- `competitors`：在盯的竞品，拿去查它们的外链从哪来。

`project` 和 `products` 都是空的：告诉用户先到「公司与产品」填公司资料或加几个产品，不往下做。

## 2. 找

用你自己的联网搜索，按下面几类找，用重点市场的语言（多半是英文）。每一类都要落到**一个具体的网站和页面**，不写「去找行业目录」这种空话：

1. **展会参展商名录**：这个行业在重点市场和国内的主要展会（比如家具的 CIFF、Index Dubai、High Point、Maison&Objet），参展商名录会链到官网。不知道用户参没参展：`how_to` 写「参展了就在参展商后台填官网地址；没参展的话，这个展是买家常去的，可以考虑」；
2. **行业目录和协会**：行业协会的会员名录、按行业分的供应商目录（比如 Europages、Kompass、ThomasNet，以及这个行业自己的目录），先找免费收录的；
3. **设计 / 选品库**：设计师、采购找产品的数据库（比如家具建材的 Archiproducts、Architonic、Houzz 商家页），要审核的写清门槛；
4. **B2B 平台的公司页**：Made-in-China、Global Sources 这类公司介绍里能填网站的（阿里巴巴一般不让放外部链接，不推荐）；
5. **竞品的外链来源**：对 `competitors` 里的竞品，搜 `"竞品品牌名" -site:竞品域名`，看哪些目录、媒体、展会页提到了它们，同样的地方我们也能去；
6. **客户和合作方**：经销商「我们代理的品牌」页、设计师和酒店项目的署名、上游材料品牌的合作工厂或案例页。这类没法查到具体页面时，`source_url` 填对方类型里最有代表性的一个真实网站，`how_to` 写交付时怎么开口要；
7. **内容和媒体**（最多两三条）：接受客座文章的行业博客、记者找素材的平台（比如 Qwoted），`how_to` 写投什么题目。

每个候选都要**打开核实**（`curl -sL <网址>` 或你的网页工具）：网站还在、和这个行业对口、真的能放公司网址。打不开、只是卖外链的、和行业无关的综合目录不要。

能看出来的顺便判断：链接是不是 nofollow（看页面上已有的公司链接的 `rel`），收不收费。

**项目里有 skills/product-growth/SKILL.md 时（产品运营：卖的是产品或软件）**，换成产品的外链渠道找：产品目录和对比站（Product Hunt、SaaSHub、AlternativeTo、G2、Capterra 这类，按品类挑）、集成和应用市场、GitHub 上的 awesome 列表、品类的 newsletter 和播客、用户社区里的「工具推荐」帖。

一共 8~15 条，先给容易做、对口的。挑多少、偏重哪类照这件任务的写法：用户改过的在 `user/prompts/backlink-opportunities.md`，没改过用模板默认的 `prompts/backlink-opportunities.md`（开任务时会告诉你用哪份；用户在对话里让你改写法，就把改后的完整写法存到 `user/prompts/backlink-opportunities.md`）。写法和下面的规则冲突时，以规则为准。

## 3. 存

```bash
cat > /tmp/backlink-ideas.json <<'JSON'
{ "items": [
  { "source_url": "https://www.europages.co.uk/", "platform": "Europages", "kind": "directory",
    "reason": "欧洲买家找供应商的目录，两家在盯的竞品都在上面",
    "how_to": "注册免费公司页 → 公司信息里填官网 → 审核 1~2 周；产品分类选 Furniture > Dining tables",
    "effort": "easy", "paid": false, "nofollow": false,
    "target_url": "https://www.example.com/" }
] }
JSON
annulo run backlinks.saveSuggestions --input @/tmp/backlink-ideas.json
```

- `source_url`：外链会在的那个网站或申请页（核实过能打开的真实地址），**同一个网站只写一条**；
- `kind`：b2b B2B 平台 / directory 行业目录、协会、展会名录、选品库 / article 媒体、客座文章、合作方网站 / forum 论坛问答 / social 社媒 / other；
- `reason`：为什么值得做，带证据（竞品也在上面、这个展是重点市场的买家常去的）；
- `how_to`：具体步骤：去哪个页面、填什么、要准备什么资料、大概多久上线，用户照着就能做；
- `effort`：easy 填个表 / medium 要准备资料或等审核 / hard 要参展、谈合作、写稿；`paid`：要不要花钱；`nofollow`：看不出来就不写；
- `target_url`：指向自己网站的哪一页，从 `pages` 和 `own_sites` 里挑最对口的（选品库指向对应分类、指南类文章指向文章），不知道就写首页；
- `reason`、`how_to` 用界面语言写。

输出的 `skipped` 是已经登记过或不能推荐的，不用管。

存完回复用户：找到了几条，最先做哪三条（一句话一条：做什么、为什么），请到「SEO 与关键词 → 外链」里看「打算做」的，去申请了点「已申请」，对方上线了点「上线了」并填上外链所在的页面。

用户在这段对话里接着说（「再找几个免费的」「不要展会」「帮我写申请的介绍」），照意见再找再存（已经登记过的会自动跳过）；要写申请材料、联系邮件，就直接在对话里写给用户。

## 规则

- **不编造网站和页面**：每条都要真的打开过；查不到申请方式的写「打开后找 Add your company / List your business，没有的话联系网站」，不编步骤；
- 不推荐买链接、站群、批量目录提交、外链套餐、在别人的博客评论区留链接，这些会被谷歌降权；
- 不替用户去注册、提交、发邮件；
- 用界面语言回复。
