# 空白项目

这是一个从空白模板建的项目：用户会告诉你想要什么工具，你在这个项目里把它做出来。

## 现在有什么

- `pages/index.tsx`：首页。显示 `notes` 表里的记录，能新增、删除；一个按钮跑本机函数 `notes.stats`；一组「交给助手」的示例。
- `tables/notes.json`：示例表（备忘）。
- `local/notes.ts`：示例本机函数（统计备忘条数）。
- `lib/annulo.ts`：页面调本机接口的封装（读写表、跑本机函数、交给助手）。
- `components/ui/`：界面组件，照 shadcn/ui 的写法（`lib/utils.ts` 的 `cn` 合并 className）。
- `messages/zh.json`、`messages/en.json`：页面文案，中英双语。

## 加东西的做法

- 用户要一个新页面：加 `pages/<名字>.tsx`，在首页或导航里放入口。
- 要存数据：加 `tables/<表>.json`（一张表一个文件），页面用 `lib/annulo.ts` 的 `db` 读写。
- 确定的、要反复跑的活（同步、检测、调外部接口）：写成 `local/<文件>.ts` 本机函数，页面按钮用 `runLocal` 调，定时跑就加 `schedules/<id>.json`。
- 要 AI 读东西、写东西的活：写成 `tasks/<id>.md` 任务，按钮用 `runTask` 交给助手。
- 示例（备忘）用不上了就删掉：页面、表、函数一起删。
- 改完用 page_errors 确认页面没有报错。

## 界面组件

页面里的控件用 `components/ui/` 的组件，样子和 Annulo 外壳一致、深浅主题都跟着变。**不要用浏览器自带的**：系统的下拉、确认框、日期框各平台长得不一样，按钮还是英文的 Cancel / OK。

| 要做的 | 用 | 不要用 |
|---|---|---|
| 下拉选择 | `select.tsx`（`Select` / `SelectTrigger` / `SelectContent` / `SelectItem`） | `<select>` |
| 删除前确认 | `confirm.tsx`：`if (!(await confirm({ title, danger: true }))) return` | `window.confirm` |
| 提示、报错 | 写在页面上（按钮旁边、表单下面） | `alert` |
| 让用户填东西、看详情 | `dialog.tsx` 的 `Dialog`，里面放 `Input` | `prompt` |
| 选日期 | `date-picker.tsx` 的 `DatePicker`（值是 `YYYY-MM-DD`，和 `<input type="date">` 一样）；整块月历、选范围用 `calendar.tsx` | `<input type="date">` |
| 按钮、输入框 | `button.tsx`、`input.tsx`（`Input`、`Textarea`） | 每处手写一长串 className |
| 点按钮弹出小面板 | `popover.tsx` | |

要的组件这里没有（Tabs、Switch、Checkbox、Tooltip……）：照 shadcn/ui 的源码写一个放进 `components/ui/`，从 `radix-ui` 包里取原语（`import { Tabs as TabsPrimitive } from 'radix-ui'`），颜色用 `index.css` 里的变量（`bg-popover`、`border-input`、`text-muted-foreground`……），不要写死颜色。
页面默认能加载的包：`react`、`radix-ui`、`lucide-react`、`clsx`、`tailwind-merge`、`class-variance-authority`、`motion`、`react-markdown` 等。
要用别的包（shadcn 的 `cmdk`、`sonner`、`vaul` 这类），照 `react-day-picker` 的样子在 `talizen.config.ts` 的 `importMap` 里加一条：写死版本、`?bundle`、`external=react,react-dom`，先用 curl 看看那个地址能打开、文件里没有一长串 import 别的包。

