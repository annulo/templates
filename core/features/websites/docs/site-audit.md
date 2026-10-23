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
