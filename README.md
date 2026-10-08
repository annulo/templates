# Annulo templates

Starting points for [Annulo](https://github.com/annulo) projects. *A home for what AI builds you, ring by ring.*

Each directory is one template, ready to use as is. A project created from a template keeps upgrading with it: Annulo merges each new version into the project and keeps the project's own changes, including everything under `user/`.

| Template | What you get |
|---|---|
| [`blank`](blank) | A home page, one sample table and one local function. Tell the assistant what you need and it builds from there. |
| [`creator`](creator) | Creator studio: set your positioning, get topics from it, write long-form articles, image posts or videos and publish each to the platforms that take its type (X, LinkedIn, Xiaohongshu, Zhihu…) now or on a schedule, rewrite a piece into another type with saved rewrite presets, with an asset library, a publishing calendar, followers and engagement collected, and a weekly summary. Uses the [social plugin](https://github.com/annulo/plugins/tree/main/social). |

## Use a template

New project → pick a template. Templates in this repository are built into Annulo.

To use templates from your own repository: New project → **Add a git template**, then enter `<repository>#<directory>` (leave out `#<directory>` when the template is the whole repository), for example `https://github.com/you/templates#crm`. Annulo reads the repository first and only adds it if it finds a version tag with a template in it. Private repositories work with the credentials your git already has.

## Versions

A version is a semver tag (`v1.2.0`) on this repository; pre-releases (`v1.3.0-beta.1`) are not offered. The tag message is the upgrade note users see. Every tag must contain finished templates: Annulo copies the directory as it is at the tag.

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
