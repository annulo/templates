// 模板的类型检查：npm run check [模板…]（不写就查 targets.json 里的全部）。
// 每个模板按发布时怎么组装（publish/lib.py compose）生成一份 tsconfig，放在 .build/ 下：
// rootDirs 把 core/、启用的 core/features/<模块>/、模板目录叠成一个目录，和产物里的路径一样；没启用的模块、不带 core 的模板不查那些文件
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const targets = JSON.parse(readFileSync(join(root, 'publish/targets.json'), 'utf8'))
const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(targets)
const tsc = join(root, 'node_modules/.bin/tsc')
if (!existsSync(tsc)) { console.error('先在仓库根目录 npm install'); process.exit(1) }
const allFeatures = readdirSync(join(root, 'core/features'))
const out = join(root, '.build')
mkdirSync(out, { recursive: true })
const rel = (p) => relative(out, join(root, p))
// 插件（social、docs…）装在项目的 plugins/<插件>/ 下，源码在同级的插件仓库（github.com/annulo/plugins）：
// 在 .build/ 里软链成 plugins/，叠进 rootDirs，模板 import '../plugins/social/local/x' 就找得到
const pluginsRepo = join(root, '../annulo-plugins-public')
if (!existsSync(pluginsRepo)) { console.error(`没找到插件仓库 ${pluginsRepo}：在模板仓库旁边 git clone https://github.com/annulo/plugins annulo-plugins-public`); process.exit(1) }
const pluginsRoot = join(out, 'check-plugins')
mkdirSync(pluginsRoot, { recursive: true })
if (!existsSync(join(pluginsRoot, 'plugins'))) symlinkSync(pluginsRepo, join(pluginsRoot, 'plugins'))

let failed = []
for (const name of names) {
  const cfg = targets[name]
  if (!cfg) { console.error(`targets.json 里没有模板 ${name}`); process.exit(1) }
  const features = cfg.features ?? []
  const dirs = cfg.core === false ? [name] : ['core', ...features.map((f) => `core/features/${f}`), name]
  const exclude = cfg.core === false ? [] : allFeatures.filter((f) => !features.includes(f)).map((f) => rel(`core/features/${f}`))
  const file = join(out, `tsconfig.${name}.json`)
  writeFileSync(file, JSON.stringify({ extends: rel('tsconfig.base.json'), compilerOptions: { rootDirs: [...dirs.map(rel), relative(out, pluginsRoot)] }, include: dirs.map(rel), exclude }, null, 2) + '\n')
  const r = spawnSync(tsc, ['-p', file, '--pretty', 'false'], { cwd: root, encoding: 'utf8' })
  const errors = (r.stdout + r.stderr).split('\n').filter((l) => /error TS\d+/.test(l))
  console.log(`${name}：${errors.length ? `${errors.length} 个错误` : '没有错误'}`)
  if (errors.length) { console.log(errors.map((l) => '  ' + l).join('\n')); failed.push(name) }
}
if (failed.length) process.exit(1)
