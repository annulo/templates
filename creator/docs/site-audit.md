# 站点体检：站点文件检测

`local/audit.ts` 为渠道体检和任意网址体检共用的检测规则。

- 首页/内容页从输入 URL 开始抓取；robots.txt、llms.txt 和默认 sitemap.xml 从该 URL 的域名根目录读取，不拼在页面路径或查询参数后面。
- robots.txt 按指令内容识别，llms.txt 接受非空文本/Markdown；内容类型错标成 text/html 的纯文本仍可识别。HTML 页面、挑战页、JSON 响应不作为 llms.txt。
- 仅 HTTP 404/410 或成功返回空内容时报告文件缺失。
- 网络错误、其他 HTTP 错误、响应截断、非预期内容先重试一次；仍失败则报告「无法确认」，包含请求地址和原因，不声称文件不存在。
- 沿用 robots / llms_txt 检查键，避免重复创建同类问题；无法确认时保留该问题，避免把旧问题错误标记为已解决。

验证：`node --test publish/tests/audit.test.mjs`；在本地项目通过 `annulo run audit.inspect` 检查真实网站。`llms.txt` 的文件名带 s。

## 关键词检查

体检顺带查关键词的页面问题（`_audit_keywords.ts`）：页面的主词没用在标题和 H1 里（`keyword_missing`）、几个页面在抢同一个词（`keyword_cannibal`）。没挖过关键词的项目没有这两项。规则见 `docs/keywords.md`「页面体检」。

## AI 爬虫准入

robots.txt 读到了，再逐个看几个 AI 爬虫（`AI_BOTS`：OAI-SearchBot、ChatGPT-User、PerplexityBot、Claude-SearchBot 是搜索类，GPTBot、ClaudeBot、Google-Extended、Bytespider、CCBot 是训练类），记成一个站点级问题 `ai_crawlers`：
- 有专门写给这个爬虫的组就用那组，没有就用 `*`；`Disallow: /`（或 `/*`）没有 Allow 算整站禁止，同时放行了部分路径算部分放行；只禁止后台、购物车这类路径不算拦（几乎每个站都这样，不影响 AI 读内容）。
- 搜索类被整站禁止是 high（AI 搜索时读不到这个站），只部分放行是 medium；只拦了训练类是 low，说明里写「有意拦的可以忽略」。
- 没有 robots.txt、读不到的不判断（前者等于全放行，后者已经有「无法确认」）。
- 预览地址不判断（渠道还没发布、用预览地址体检时，或者网址是 `*.preview.*`）：creght 的预览本来就是 `Disallow: /`，第一次本机试的时候就误报成了严重问题。

这是 AI 引用分的第三种分（设计见仓库根目录 `docs/ai-citation-score.md`），这一版只记问题，不单独打 0–100 分：网站检查的总分已经按它扣了。

## 全站检查

渠道体检（`audit.run`）抓全站：sitemap 全读（数出一共多少页，存 `audit_runs.sitemap_pages`），最多抓 300 页（`FULL_MAX`）；只读体检（任意网址、起步向导）还是 40 页。
sitemap 比 300 多时各类页面（路径第一段：product、products、blog、project…）轮着取（`spread`）：外贸站几百个产品页排在前面，只取前 300 个就抓不到分类页和案例。
- 地址会跳转（不带 www 跳到 www、http 跳到 https）时按跳转后的地址抓（`resolveBase`，没响应重试 3 次——有一次就是这一步没成，整份结果全是误报）：渠道记的正式地址常常是不带 www 的，不这样每一页都算成「要跳转」、canonical 也都对不上（第一次在外贸项目试就是这样）；
- 请求失败的页面（超时、断开，不是 404）最后再试一次：抓得多的时候网站偶尔顶不住。重试还失败的不算「打不开」（curl 一看都是好的），大半页面都这样才报；sitemap 读不到（不是 404）也不说「没有 sitemap」；
- creght 站点首字节常常 2~3 秒，300 页大约 5 分钟。每周定时检查在后台跑，按钮上有进度。

全站才看得出的问题：站内链接指向打不开的页面（`broken_links`）、要跳转的链接（`redirect_links`）、sitemap 里列了打不开 / 跳转 / noindex 的页面（`sitemap_bad`）、有链接却不在 sitemap 里（`missing_from_sitemap`）、
没有任何页面链到的页面（`orphan`，**sitemap 抓全了才判断**：链到它的分类页可能在没抓的那部分里，第一次试时 249 个误报）、canonical 写成首页（`canonical_home`，high）或别的页面（`canonical_other`）、
多语言没有 hreflang（`hreflang`）、https 页面用 http 资源（`mixed_content`）。比地址时不管结尾的 `/`。

`ctx.html` 只给看得见的文字，`<script>` 里的 JSON-LD 从源码里读（以前一直误报「首页缺少结构化数据」，外贸项目里的助手先修了，2026-10-24 收进模板）。

## 内容质量：查「好不好」，不只查「有没有」

只查标题、描述、H1 有没有写，一个建得规整的站几乎挑不出问题（外贸项目的站页面分 100），可在对话里让助手看，它能说出一大堆。这几项是能自动查的那部分：
- **自己的内容**（`contentOf`）：页面文字按 8 个词（中文 16 个字）一组，40% 以上页面都有的是全站模板（导航、页脚、询价表单），同一类页面里 3 页以上（小类三成、大类一成）都有的是这一类的套话。
  去掉这两种剩下的才是「自己的内容」：`thin_content` 按它算（150 词 / 300 字以下），联系、隐私这类功能页和文章分类、标签这类列表页不算；
  `content_template` 是套话占自己以外文字四成以上的页面（每个分类页同一段介绍、每个产品页同一段卖点）。两项都按页面类型汇总说（「/product 232 页，平均 80 个词」），举例给页面上的原文；
- **描述是模板套的**（`desc_template`）：同一类一半以上页面的描述，六成以上的词是这一类大多数页面都有的（只换了名称、型号）；
- **域名不统一**：链到本站别的域名（`other_domain_links`：预览、creght 系统域名、绑过的别的域名、www 的另一个写法）；结构化数据的 url / @id 不是本站（`schema_domain`；图片、sameAs 指外站是正常的，creght 的 `window.__DATA__` 不是结构化数据）；
- **图片**：按 2000 像素以上要图又没有 srcset（`image_size`，列表缩略图用 `w=3072` 是手机慢的大头）、一页 120 张以上（`image_many`）、alt 为空（`img_alt_empty`：每页都有的菜单、页脚图只算一次）；
- **按页面类型的结构化数据**：Product 缺 image / description / brand / sku / offers 里两个以上（`product_schema`）、文章没有 Article / BlogPosting（`article_schema`）。

规则查不出来的（标题说没说清给谁、分类介绍对不对这个品类、产品文案和产品对不对得上、案例够不够具体、页面之间连没连起来）交给「AI 全站审查」，见下面「SEO 报告」。

## 谷歌收录

`_audit_index.ts`：关联了 Search Console（`channels.gsc_property`）的正式站点，体检时用网址检查（URL Inspection，`webmasters.readonly` 就能用）查页面有没有被 Google 收录，每页一条存 `index_status`。
- 配额每个属性每天 2000 次：每次最多查 80 页；GSC 里有曝光的页面直接算已收录，7 天内查过的不重查，先查从没查过的、再查最久没查的，几次体检轮完全站；
- `coverageState` 归成几类：indexed、crawled（抓了没收录，high：内容薄或重复）、discovered（发现了没抓：链接少、站慢）、unknown（Google 不知道）、duplicate（Google 认了别的页面当正式版）、alternate（按 canonical 正常排除，不算问题）、excluded（其他）。
  每类记成一个体检问题 `index_*`；再看 Search Console 里提交过 sitemap 没有、有没有错误（`sitemap_unsubmitted`、`sitemap_errors`）。sitemap 接口的 `contents[].indexed` 谷歌已经不填了（总是 0），不用；
- 这次没查成（没关联、读失败、预览地址）时，已有的收录问题原样留着，不标成已解决。

## SEO 报告

网站检查页的「SEO 报告」标签（`components/SeoReport.tsx`，数据是 `audit.report`），只给自己看，不做导出：
- 总分和四类得分（`audit.ts` 的 `CATEGORY`：技术、页面、内容、AI 可读，同一套扣分只算这一类，存 `audit_runs.categories`）；
- 谷歌收录概况（`audit_runs.index`）、最近 28 天搜索表现（`search_pages`：差一点进首页、点击率偏低的页面数，点了去谷歌排名）；
- 全站建议：没处理的问题按「要做的一件事」归组（`GROUPS`：收录、坏链、内容、站内链接、页面、速度、多语言、AI），按严重程度 × 涉及页面占比 × 组权重排序（收录 2、坏链 1.5：它们挡住整站）。文案在 messages 的 `audit.sg_<key>`；
- AI 全站审查：「让 AI 审查全站」按任务 `tasks/seo-review.md` 开对话。`audit.samples` 每类页面挑几页（第一页、中间、最后，有曝光的优先，最多 24 页）现读，给标题、描述、H1/H2、自己的词数、套话占比、结构化数据、正文开头和谷歌数据；
  助手照任务里的清单逐类读、对照产品资料，把规则查不出的问题用 `audit.saveFindings` 记进 `site_issues`（check 是 `ai.<类>.<名字>`，和规则问题一个清单、一样修；规则体检不会把它们标成已解决，下次审查没再提到才算），
  再把这些和规则问题放一起排优先级写方案（写法 `prompts/seo-review.md` 用户可改），`audit.savePlan` 存在最近一次体检上（`plan`、`plan_chat_id`），要改点「继续对话」。
  为什么要这一步：第一版只让 AI 读报告里的数字写方案，它就只会复述「2 个页面没收录、11 个页面慢」；同一个站在对话里让助手自己去看页面，说出的是分类介绍通用、产品文案套模板、案例太薄——这些才是要改的。
