# Annulo templates

Starting points for [Annulo](https://github.com/annulo) projects. *A home for what AI builds you, ring by ring.*

Each template directory holds that template's own files; shared code lives in [`core/`](core) and is copied into every template that uses it when a version is built. A project created from a template keeps upgrading with it: Annulo merges each new version into the project and keeps the project's own changes, including everything under `user/`.

| Template | What you get |
|---|---|
| [`blank`](blank) | A home page, one sample table and one local function. Tell the assistant what you need and it builds from there. |
| [`product`](product) | Product growth assistant: read your product website, research SEO opportunities, plan pages, create content for the website, Xiaohongshu, Douyin and X, and review sign-ups and activation every week. Uses the [social plugin](https://github.com/annulo/plugins/tree/main/social). |
| [`creator`](creator) | Creator studio: set your positioning, get topics from it, write long-form articles, image posts or videos and publish each to the platforms that take its type (X, LinkedIn, Xiaohongshu, Zhihu…) now or on a schedule, rewrite a piece into another type with saved rewrite presets, with an asset library, a publishing calendar, followers and engagement collected, and a weekly summary. Uses the [social plugin](https://github.com/annulo/plugins/tree/main/social). |

## Use a template

New project → pick a template. Templates in this repository are built into Annulo.

To use templates from your own repository: New project → **Add a git template**, then enter `<repository>#<directory>` (leave out `#<directory>` when the template is the whole repository), for example `https://github.com/you/templates#crm`. Annulo reads the repository first and only adds it if it finds a version tag with a template in it. Private repositories work with the credentials your git already has.

## Versions

Each template has its own versions: a tag `<template>/vX.Y.Z` (`creator/v0.14.0`), like the [plugins](https://github.com/annulo/plugins). Pre-releases (`v1.3.0-beta.1`) are not offered. Tags `vX.Y.Z` without a directory are the versions released before templates were versioned separately; Annulo still uses them as history.
Annulo reads only tags, never `main`, and copies the template directory as it is at the tag, so every tag must contain a finished template. That is why tags live on the [`release`](../../tree/release) branch: `main` holds the sources, and `python3 publish/publish.py <template> --note "…" --tag vX.Y.Z` assembles the template (its own files + `core/`), commits it to `release` and tags it `<template>/vX.Y.Z`. Nobody commits to `release` by hand.
Upgrade notes come from each template's `changelog.yaml` (newest first, one entry per version with a paragraph per language); the tag message is shown only when the file has no entry for that version.

## Contributing

Pull requests against `main` are welcome. Change a template in its own directory, or `core/` when the change is shared by several templates (the content center, base components, common scripts and skills). A template file may not have the same path as a file in `core/`: the build stops with an error instead of letting a template silently override shared code.

- Try a change in a real project before sending it: `python3 publish/publish.py <template> --local [project directory]` applies your working tree to a local Annulo project (the one open in Annulo by default), merging with the project's own changes.
- Tests: `python3 -m unittest discover -s publish/tests -p 'test_*.py'` and `node --test publish/tests/*.test.mjs` (they need `esbuild`; point `ESBUILD_MODULE` at it if it is not installed globally).
- Add an entry to the template's `changelog.yaml` when users will notice the change.

## Template layout

| Path | What it is |
|---|---|
| `annulo.json` | Name, description (`{"zh": …, "en": …}`) and `min_annulo_api`, the Annulo capability version the template needs |
| `ANNULO.md` | Notes for the assistant: what the project is and how to extend it |
| `pages/` | Pages (React), rendered by Annulo on your computer |
| `tables/<table>.json` | Data tables |
| `local/*.ts` | Local functions: deterministic scripts that pages and schedules run without the model |
| `schedules/`, `tasks/` | Scheduled jobs; long jobs handed to the assistant |
| `messages/` | UI text per language |

Never put files under `user/`: that directory belongs to the user, so upgrades never touch it.

## License

[Apache-2.0](LICENSE)
