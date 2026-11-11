#!/usr/bin/env python3
"""外贸和产品运营模板合并期间的回归检查（docs/merge-trade-product.md 第 0 步）。

把每个模板按发布时的方式组装一遍（lib.compose，用工作区的文件，和 --local 一样），和存下来的基准比，列出产物里哪些文件多了、少了、变了。
挪文件进 core/features 这种「行为不变」的步骤，产物应该一个文件都不变；合并分叉文件时，只该变这次要合的那几个。

  python3 publish/merge_check.py save              组装全部模板，存成基准（.build/merge-baseline/<模板>/）
  python3 publish/merge_check.py diff              和基准比，列出变化；有变化时退出码 1
  python3 publish/merge_check.py diff --show <路径> 打印某个产物文件的 diff（路径是产物里的，如 local/content.ts）
  python3 publish/merge_check.py diff trade        只比某几个模板

外贸在私有仓库（默认同级的 shuttle-template，或者用环境变量 SHUTTLE_TEMPLATE 指定），没有就跳过外贸。
"""

import argparse
import difflib
import json
import os
import shutil
import sys
from pathlib import Path

import lib

ROOT = lib.REPO
BASE = ROOT / '.build' / 'merge-baseline'
PRIVATE = Path(os.environ.get('SHUTTLE_TEMPLATE', ROOT.parent / 'shuttle-template'))


def targets():
    """{模板: (组装出的文件 {路径: bytes})} 的生成函数"""
    out = {}
    pub = json.loads((ROOT / 'publish' / 'targets.json').read_text())
    for name, cfg in pub.items():
        out[name] = lambda name=name, cfg=cfg: lib.compose(
            f'{name}/', cfg, lib.worktree_files(ROOT, [f'{name}/', 'core/']), '公开仓库工作区')
    pt = PRIVATE / 'publish' / 'targets.json'
    if pt.exists():
        for name, cfg in json.loads(pt.read_text()).items():
            out[name] = lambda name=name, cfg=cfg: lib.compose(
                f'templates/{name}/', cfg,
                {**lib.worktree_files(PRIVATE, [f'templates/{name}/']), **lib.worktree_files(ROOT, ['core/'])},
                '私有仓库工作区')
    else:
        lib.warn(f'没找到私有模板仓库 {PRIVATE}，跳过外贸')
    return out


def read_dir(d):
    return {str(p.relative_to(d)): p.read_bytes() for p in d.rglob('*') if p.is_file()}


def same(path, a, b):
    """JSON 按内容比：文案挪进模块后按键合并的顺序会变，内容一样就算没变"""
    if a == b:
        return True
    if path.endswith('.json'):
        try:
            return json.loads(a) == json.loads(b)
        except ValueError:
            return False
    return False


def save(names):
    for name, build in names.items():
        files = build()
        d = BASE / name
        shutil.rmtree(d, ignore_errors=True)
        for rel, data in files.items():
            f = d / rel
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(data)
        print(f'{name}: {len(files)} 个文件 → {d.relative_to(ROOT)}')


def diff(names, show):
    changed_any = False
    for name, build in names.items():
        d = BASE / name
        if not d.exists():
            lib.warn(f'{name} 没有基准，先跑 save')
            changed_any = True
            continue
        old, new = read_dir(d), build()
        added = sorted(set(new) - set(old))
        removed = sorted(set(old) - set(new))
        changed = sorted(p for p in set(old) & set(new) if not same(p, old[p], new[p]))
        if not (added or removed or changed):
            print(f'{name}: 和基准一样（{len(new)} 个文件）')
            continue
        changed_any = True
        print(f'{name}: 新增 {len(added)}、删除 {len(removed)}、改动 {len(changed)}')
        for tag, ps in (('+', added), ('-', removed), ('~', changed)):
            for p in ps:
                print(f'  {tag} {p}')
        for p in show:
            if p in old or p in new:
                a = old.get(p, b'').decode('utf-8', 'replace').splitlines(keepends=True)
                b = new.get(p, b'').decode('utf-8', 'replace').splitlines(keepends=True)
                sys.stdout.writelines(difflib.unified_diff(a, b, f'基准/{name}/{p}', f'现在/{name}/{p}'))
    return 1 if changed_any else 0


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('cmd', choices=['save', 'diff'])
    ap.add_argument('names', nargs='*', help='只处理这几个模板（默认全部）')
    ap.add_argument('--show', action='append', default=[], help='打印这个产物文件的 diff（可以给多次）')
    a = ap.parse_args()
    all_targets = targets()
    unknown = [n for n in a.names if n not in all_targets]
    if unknown:
        raise SystemExit(f'没有这个模板：{"、".join(unknown)}（有：{"、".join(all_targets)}）')
    names = {n: all_targets[n] for n in (a.names or all_targets)}
    if a.cmd == 'save':
        save(names)
    else:
        sys.exit(diff(names, a.show))


if __name__ == '__main__':
    main()
