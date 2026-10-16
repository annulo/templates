# Annulo 模板开发

本仓库（github.com/annulo/templates）是 Annulo 公开模板的源码，`main` 上改、在这里提 PR。用户看到的模板是组装好的成品，在 `release` 分支上，由发布脚本提交，不在那里改。

- `<模板>/`：一个模板就是一个完整的运营后台，发到用户项目里的东西都在这里。现在有空白 `blank/`、自媒体 `creator/`、产品运营 `product/`。**改模板的页面、业务本机函数、任务、表、定时任务都在这里改**；
- `core/`：几个模板共用的代码，发布时拷进每个模板的产物（路径和产物里一样；空白模板不带，`publish/targets.json` 里 `"core": false`）：
  公共脚本（`core/local/`）、通用 skill（`core/skills/`）、几个模板都有的组件和页面（`core/components/`，内容中心 `core/components/views/Content.tsx` 和它的发布、改写、编辑组件都在这里）、
  `core/lib/`、表、文案（`core/messages/*.json` 和模板的按键合并，同一个键只能在一处）；
  模板自己业务的 skill 放模板里（产品运营的增长方法在 `product/skills/`），不要往通用 skill 里写某个模板的业务；
- `core/features/<模块>/` 是部分模板才用的共用模块（现在有网站运营 `websites/`），`targets.json` 里 `features: ["websites"]` 的模板才组装进去，放到产物根目录；模块不能覆盖模板或 core 同路径的文件；
- **core 还有一个不在本仓库的用户**：私有的外贸模板（Annulo 团队的 `shuttle-template` 仓库）也用这里的 `core/`，发布时从本仓库已推送的提交里取。改 core 要照「core 里的代码要在每个带 core 的模板里都能跑」写，外贸那边由 Annulo 团队验证；
- 社媒平台不在这个仓库：是 Annulo 插件 **social**（github.com/annulo/plugins），模板在 `annulo.json` 的 `"plugins"` 里声明，项目新建、升级时 Annulo 装进 `plugins/social/`。
  改社媒平台的脚本、写作任务、写法、定时任务、skill 都在插件仓库里改，不要在模板里另写一份；
- **参考代码**（没有稳定接口、只能操作网页的东西，比如在 AI 网页上提问）在 github.com/annulo/references：复制进用它的模板或共用模块的 `local/`，文件头记下复制自哪个提交，references 更新了在这里同步、发版。网站运营的 AI 搜索检测用它的 `aichat/`（`core/features/websites/local/aichat.ts`、`_aichat_*.ts`）；
- `publish/`：组装、试用、发布脚本（`publish.py`，公共部分在 `lib.py`，外贸的发布脚本也 import 它）、`targets.json`（每个模板带不带 core、启用哪些模块）、测试（`tests/`）。其余（本文件、README）不会发出去。

## 试用、提交、发布

1. 在模板目录或 `core/` 里改，不用先提交；
2. `python3 publish/publish.py <模板> --local [项目目录]` 把工作区的改动用到本地 Annulo 项目（默认 Annulo 当前打开的项目）：只写模板改了的文件，项目自己也改过、按行合不上的列出来不动；
   本机函数马上生效（`annulo run`），页面在 Annulo 里自动刷新；改了 `backend/func` 才加 `--push`。对着真实页面、真实账号试，要改就回第 1 步。不要在项目里改完再搬回来；
3. 跑测试：`python3 -m unittest discover -s publish/tests -p 'test_*.py'`，`node --test publish/tests/*.test.mjs`（要 esbuild，没全局装就用 `ESBUILD_MODULE=<esbuild 包目录>` 指过去）；
4. `git commit` 自己改的文件（别 `git add -A`：常有别人同时在改），`git push`，或者提 PR；
5. 发版（维护者）：**每个模板自己发版本、自己的版本号**（和插件仓库一样），tag 是 `<模板>/vX.Y.Z`。先在模板的 `changelog.yaml` 最上面写这一版（`version` 加 `zh`、`en`… 各语言一段；写短：一两句话说最重要的变化，中文大概 60 字以内，不逐条列细节），提交推送，
   再 `python3 publish/publish.py <模板> --note "<English note>" --tag vX.Y.Z`（先 `--dry-run`：看 release 分支会改什么、这个模板现在是哪一版；新版本要比它高）。
   脚本只发已推到 `origin/main` 的提交：组装这个模板、换掉 `release` 分支上它的目录（别的模板不动）、打 `<模板>/vX.Y.Z`，再同步官网的帮助手册（官网仓库 shuttle-site 有别的没发布的改动时它会停下）。
   改了 core 的，每个用到这处改动的模板各发一版；不带目录的 `vX.Y.Z` 是 2026-10-15 前几个模板一起发的老版本，不再打。
   tag 说明和 `--note` 只写英文；提交和 tag 用 GitHub 作者名 bysir，不带 Claude 署名。
   **发完版本就停**，不替用户升级项目：升级由用户在 设置 → 项目 里点。

Annulo 只读 tag，不读 `main`：tag 上的目录原样复制给用户，所以 tag 只打在 `release` 分支上。有 `<模板>/vX.Y.Z` 的模板 Annulo 只认这些，再加上老的仓库级 `vX.Y.Z` 里比它低的当历史（Annulo 的 `internal/wsgit/gitsource.go`）。

## 写模板的约定

**core 放几个模板共用、会一起迭代的东西**（内容中心、基础组件、公共脚本、通用 skill）：改一次，几个模板一起拿到。
core 里的代码要在每个带 core 的模板里都能跑：某个模板才有的东西（网站、产品）在 core 里按「有就用」写（读不到表当空的），或者从模板自己的文件取。
模板里的文件和 core 同路径，组装直接报错：core 的文件不许被模板盖掉，要不一样就改 core（每个模板都拿到），或者在模板里换个名字另写。
两个模板里改成一样的文件，就挪进 `core/`；一个模板要和 core 里的不一样，先想能不能在 core 里按模板区分，实在不行再挪回模板各写一份。

**模板不写 `user/` 目录**：`user/` 放用户自己定制的东西（比如改过的任务写法 `user/prompts/<id>.md`），模板给默认、用户的存到 `user/` 下、有就优先用，升级永远不会和用户的定制冲突。

模板用到了某个 Annulo 能力版本才有的原语，把模板的 `annulo.json` 里 `min_annulo_api` 调到那个版本。模板缺 Annulo 本身的能力（原语、系统提示、界面），到 Annulo 仓库提 issue 商量，不在模板里绕过去。

改某块功能前，先看 `<模板>/docs/` 里有没有它的设计文档（比如起步向导 `onboarding-wizard.md`），照着做；改了设计就同步改文档。
几个模板共用的设计（内容中心、产物、发布这类 core 的东西）写在仓库根目录的 `docs/`（不发进项目），比如 `docs/artifacts.md`。
**模板可以有自己的内容中心**：一个模板的用法和别的不一样时，不硬塞进 core，在模板里另写一份（比如自媒体的内容文件夹：`creator/components/views/CreatorContent.tsx`，设计见 `creator/docs/content-model.md`），别的模板照旧用 core 的。
