"""模板组装和试用的公共部分：本仓库的 publish.py 用，私有的外贸模板仓库（shuttle-template）的发布脚本也 import 这里。

组装：模板目录 + core/（路径和产物里一样）+ 模板启用的 core/features/<模块>/；core/messages/*.json 和模板的按键合并。
模板里的文件和 core 同路径就报错：core 的文件不许被模板悄悄盖掉，要不一样就改 core，或者在模板里换个名字另写。
"""

import io
import json
import os
import re
import shutil
import subprocess
import tarfile
from pathlib import Path

CORE = 'core/'  # 模板共用的：公共脚本、通用 skill、几个模板都有的页面和组件
MERGED = ('messages/zh.json', 'messages/en.json')  # 这几个文件 core 和模板按键合并，不算同路径冲突
# 本仓库（github.com/annulo/templates）的根目录：外贸的发布脚本从这里取 core
REPO = Path(__file__).resolve().parents[1]


def run(args, cwd, capture=True, check=True, env=None):
    r = subprocess.run([str(a) for a in args], cwd=cwd, text=True, capture_output=capture, env={**os.environ, **env} if env else None)
    if check and r.returncode != 0:
        raise SystemExit(f'命令失败：{" ".join(map(str, args))}\n{(r.stderr or r.stdout or "").strip()}')
    return (r.stdout or '').strip()


def warn(msg):
    print(f'\n!! {msg}', flush=True)


def commit_files(repo, rev, paths=None):
    """某个提交的文件 {路径: bytes}（只取已提交的，发出去的东西只由这个提交决定）；paths 只取这些目录"""
    data = subprocess.run(['git', 'archive', rev, *(paths or [])], cwd=repo, capture_output=True, check=True).stdout
    out = {}
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for m in tar.getmembers():
            if m.isfile():
                out[m.name] = tar.extractfile(m).read()
    return out


def worktree_files(repo, paths):
    """工作区里这些目录的文件（已跟踪的 + 没被 .gitignore 忽略的新文件；删掉还没提交的不算），--local 用"""
    out = {}
    for p in run(['git', 'ls-files', '-co', '--exclude-standard', '--', *paths], cwd=repo).splitlines():
        f = Path(repo) / p
        if f.is_file():
            out[p] = f.read_bytes()
    return out


def merge_json(a, b, path, clash):
    """core 和模板的文案按键合并：同一个叶子两边都有算冲突（core 的文案不许被模板悄悄盖掉）"""
    out = dict(a)
    for k, v in b.items():
        if k not in out:
            out[k] = v
        elif isinstance(out[k], dict) and isinstance(v, dict):
            out[k] = merge_json(out[k], v, f'{path}.{k}', clash)
        else:
            clash.append(f'{path}.{k}')
    return out


def compose(pre, cfg, everything, where):
    """生成一个模板的全部文件：everything 里 pre（模板目录，带结尾的 /）下的文件 + core/。
    everything 是 {路径: bytes}（某个提交的，或工作区的），core 的路径以 core/ 开头。
    cfg 是 targets.json 里这个模板的配置："core": false 不带 core（空白模板），"features": [...] 启用的 core/features/<模块>/"""
    files = {p[len(pre):]: d for p, d in everything.items() if p.startswith(pre)}
    if not files:
        raise SystemExit(f'{where}里没有 {pre}')
    clash = []
    use_core = cfg.get('core', True)
    features = cfg.get('features', [])
    for feature in features:
        if not re.fullmatch(r'[a-z][a-z0-9-]*', feature):
            raise SystemExit(f'无效的共用模块：{feature}')
        if not any(p.startswith(f'{CORE}features/{feature}/') for p in everything):
            raise SystemExit(f'{where}里没有共用模块 core/features/{feature}/')
    for p, d in everything.items():
        if not use_core or not p.startswith(CORE):
            continue
        rel = p[len(CORE):]
        if rel.startswith('features/'):
            _, feature, rel = rel.split('/', 2)
            if feature not in features:
                continue
        if rel in MERGED and rel in files:
            keys = []
            merged = merge_json(json.loads(d), json.loads(files[rel]), rel, keys)
            if keys:
                clash.append(f'{pre}{rel} 和 {p} 都有：' + '、'.join(keys[:10]))
            files[rel] = (json.dumps(merged, ensure_ascii=False, indent=2) + '\n').encode()
            continue
        if rel in files:
            clash.append(f'{pre}{rel} 和 {p}')
        files[rel] = d
    if clash:
        raise SystemExit('模板里的文件和 core 同路径（core 的文件不许被模板盖掉：要不一样就改 core，或者在模板里换个名字）：\n' + '\n'.join('   ' + c for c in clash))
    return files


def changelog_has(text, version):
    """changelog.yaml 的内容里有没有这一版的升级说明（Annulo 的 internal/wsgit/changelog.go 读它）"""
    want = re.compile(r'^-\s+version:\s*["\']?v?' + re.escape(version) + r'["\']?\s*$', re.M)
    return bool(want.search(text.decode('utf-8', 'replace') if isinstance(text, bytes) else text))


def sync_site_help(parent):
    """发完版本把帮助手册同步到官网并上线（官网仓库在同级的 shuttle-site，见那里的 scripts/sync-help.py）。
    官网有别的没发布的改动时它会停下，这里只提醒，不影响模板已经发好的版本。"""
    script = Path(os.environ.get('SHUTTLE_SITE', Path(parent) / 'shuttle-site')) / 'scripts' / 'sync-help.py'
    if not script.exists():
        warn(f'没找到官网的同步脚本 {script}：官网的帮助手册要手动同步')
        return
    print('\n== 同步帮助手册到官网', flush=True)
    r = subprocess.run(['python3', str(script)], cwd=script.parents[1])
    if r.returncode != 0:
        warn('官网的帮助手册没同步上（模板版本已经发好了）：处理完上面的问题后到官网仓库运行 python3 scripts/sync-help.py')


def shuttle_bin():
    return shutil.which('annulo') or shutil.which('shuttle') or '/Applications/Annulo.app/Contents/Resources/bin/annulo'


def current_project():
    """Annulo 当前打开的项目目录（同 Annulo 的 config.DirFor；老的数据目录是 ~/.shuttle）"""
    home = Path(os.environ.get('ANNULO_DIR') or (os.path.expanduser('~/.annulo') if os.path.isdir(os.path.expanduser('~/.annulo')) else os.path.expanduser('~/.shuttle')))
    cfg = json.loads((home / 'config.json').read_text()) if (home / 'config.json').exists() else {}
    legacy = home / 'backend'
    state = legacy / '.creght' / 'state.json'
    legacy_id = json.loads(state.read_text()).get('site_id', '').split('/')[0] if state.exists() else ''
    pid = cfg.get('backend') or legacy_id
    if not pid:
        raise SystemExit('读不到 Annulo 当前打开的项目，用 --local <项目目录> 指定')
    return legacy if pid == legacy_id else home / 'backends' / pid


def apply_local(name, theirs, target, push, sites, build):
    """把工作区里的模板改动试到本地项目：不用提交、不发版，改完就能在本地看效果。

    theirs 是用工作区文件组装好的产物，sites 是这个模板的模板站点（项目 template 分支的「模板站点」trailer 要是其中之一），
    build 是放上一轮记录的目录。对每个文件三方比较：
    基准 = 项目当前的模板内容（项目 git 里 Annulo 记的 template 分支；上次 --local 用过的，以上次用到的为准），
    我方 = 项目里现在的文件，对方 = 新产物。模板没改的不碰；项目没动过的直接换成新的；两边都改了用 git merge-file 按行合并，
    合并不干净就不写、列出来。只写文件不提交：本机函数马上生效（annulo run），页面也是（Annulo 在本机渲染项目目录，保存就刷新）；
    改了 backend/func（平台上的 Func）才要推（--push 或 annulo push）。
    之后正式发版、项目升级时，这些文件和新版本一样，合并不会冲突。
    """
    dir = Path(target).expanduser() if target else current_project()
    if not (dir / '.git').exists():
        raise SystemExit(f'{dir} 不是 Annulo 的项目目录（没有 .git）')
    g = lambda *a, check=True: run(['git', *a], cwd=dir, check=check)
    tip = g('rev-parse', '--verify', '-q', 'refs/heads/template', check=False)
    if not tip:
        raise SystemExit(f'{dir} 里没有 template 分支：这个项目还没从模板升级过，先在 设置 → 项目 里升级一次')
    site = re.search(r'^模板站点: (\S+)$', g('log', '-1', '--format=%B', tip), re.M)
    if site and site.group(1) not in sites:
        raise SystemExit(f'{dir} 跟的模板是 {site.group(1)}，不是 {name}（{", ".join(sites)}）')
    # 上次 --local 用到这个项目的产物：项目的模板没再升级过就以它为基准（连着试几轮不会自己跟自己冲突）
    snap = Path(build) / 'local' / dir.name
    snap_files = {}
    if (snap / 'template').exists() and (snap / 'template').read_text().strip() == tip:
        snap_files = {f.relative_to(snap / 'files').as_posix(): f.read_bytes() for f in (snap / 'files').rglob('*') if f.is_file()}
        absent = set(json.loads((snap / 'absent.json').read_text())) if (snap / 'absent.json').exists() else set()
    else:
        absent = set()
    tpl_paths = set(g('ls-tree', '-r', '--name-only', tip).splitlines())

    def ours(p):
        f = dir / p
        return f.read_bytes() if f.is_file() else None

    def base(p):
        t0 = subprocess.run(['git', 'show', f'{tip}:{p}'], cwd=dir, capture_output=True).stdout if p in tpl_paths else None
        # 项目里的文件就是模板那一版（比如在 设置 → 项目 里恢复过模板文件）：以模板为基准，上一轮 --local 的记录不算
        if ours(p) == t0:
            return t0
        if p in snap_files:
            return snap_files[p]
        if p in absent:
            return None
        return t0

    wrote, removed, merged, conflicts, aligned = [], [], [], [], {}
    for p in sorted(set(theirs) | tpl_paths | set(snap_files)):
        b, o, t = base(p), ours(p), theirs.get(p)
        if t == b or o == t:
            aligned[p] = t if o == t else b
            continue
        if o == b:
            f = dir / p
            if t is None:
                f.unlink()
                removed.append(p)
            else:
                f.parent.mkdir(parents=True, exist_ok=True)
                f.write_bytes(t)
                wrote.append(p)
            aligned[p] = t
            continue
        if None not in (b, o, t):
            tmp = Path(build) / 'local' / '.merge'
            tmp.mkdir(parents=True, exist_ok=True)
            for k, v in (('ours', o), ('base', b), ('theirs', t)):
                (tmp / k).write_bytes(v)
            r = subprocess.run(['git', 'merge-file', '-p', tmp / 'ours', tmp / 'base', tmp / 'theirs'], capture_output=True)
            if r.returncode == 0:
                (dir / p).write_bytes(r.stdout)
                merged.append(p)
                aligned[p] = t
                continue
        conflicts.append(p)
        aligned[p] = b
    # 记下这一轮项目对齐到的产物（冲突的文件还是原来的基准）
    if snap.exists():
        shutil.rmtree(snap)
    (snap / 'files').mkdir(parents=True)
    for p, d in aligned.items():
        if d is not None:
            (snap / 'files' / p).parent.mkdir(parents=True, exist_ok=True)
            (snap / 'files' / p).write_bytes(d)
    (snap / 'absent.json').write_text(json.dumps(sorted(p for p, d in aligned.items() if d is None), ensure_ascii=False))
    (snap / 'template').write_text(tip)

    print(f'用到 {dir}：写入 {len(wrote)}、按行合并 {len(merged)}、删除 {len(removed)}、冲突没动 {len(conflicts)}')
    for tag, ps in (('写入', wrote), ('合并', merged), ('删除', removed)):
        for p in ps:
            print(f'    {tag}  {p}')
    if conflicts:
        warn('这些文件项目里也改过、和模板的改动合不到一起，没动（项目里的改动留着；要用模板的就先手动处理）：\n' + '\n'.join('   ' + p for p in conflicts))
    if not (wrote or merged or removed):
        return
    if push:
        run([shuttle_bin(), 'push', '--dir', dir, '-m', f'试用模板 {name} 的改动（还没发版）'], cwd=dir, capture=False)
    else:
        print(f'本机函数和页面都已经生效（页面在 Annulo 里自动刷新）；改了 backend/func 要推到 creght：加 --push 再跑一次，或 annulo push --dir {dir}')
