# Better Notes reading card template

This repository ships a project-oriented Better Notes item template:

```text
[item]Codex 中英文献精读卡
```

Use it as the default reading-card template for Codex-created Zotero child notes.

## What it is for

The template is designed for:

- Chinese and English literature reading cards.
- Zotero child notes that remain the source note for Better Notes sync.
- AI-readable review sections that Codex can update later.
- Evidence candidates that stay at `needs_review` until a human checks the PDF.
- Zotero/PDF links that let you jump back from Obsidian Markdown to Zotero.

It is not a final manuscript evidence table. Treat every generated claim, page
reference, figure reference, and data interpretation as pending review.

## Import into Better Notes

1. Open `templates/codex-literature-reading-card.better-notes.yml`.
2. Copy the whole file content, including `name:` and `content:`.
3. In Zotero, use Better Notes' template import flow:
   - Tools -> New Template from Clipboard.
4. Confirm the imported template name is:

```text
[item]Codex 中英文献精读卡
```

If clipboard import fails in your Better Notes version, create a new item
template manually with the same name and paste only the indented body under
`content: |-` into the template editor.

## Connect it to Actions & Tags

In both Zotero-side scripts, set:

```js
const TEMPLATE_NAME = "[item]Codex 中英文献精读卡";
```

Relevant scripts:

- `scripts/actions-tags-bn-autosync-selected.js`
- `scripts/actions-tags-bn-queue-daemon.js`

When a queued Zotero item has no existing project reading note, the bridge
creates a child note and asks Better Notes to run this item template. If the
template is missing or fails, the bridge falls back to its built-in HTML note.

## Sections

The template creates these sections:

- `文献信息`: title, authors, year, source, DOI, URL, Zotero item link, PDF link, citekey, tags.
- `一句话定位`: what the paper studies and how it relates to the project.
- `摘要与研究问题`: abstract, AI/human summary, research questions, study object and area.
- `方法与数据`: samples, methods, key indicators, and limits.
- `核心结论`: author conclusions, project-relevant conclusions, and cautious-use conclusions.
- `证据候选表`: evidence snippets, location, supported claim, Zotero deep link, review status.
- `标注与摘录整理`: important excerpts and potentially reusable wording.
- `我的判断`: reliability, consistency with existing work, project implications, follow-up literature.
- `待人工复核`: checklist before evidence is promoted.
- `Codex 状态`: machine-readable project/status block.

## How Codex should use it

For new notes, leave blank/default fields as `needs_review` unless the source has
actually been read. For rereads, append or revise the relevant sections instead
of creating a duplicate child note.

When using `scripts/export_zotero_evidence_pack.py`, map annotation records into
the `证据候选表` with:

- `evidence_id`
- annotation text/comment
- page label or figure/table location
- Zotero PDF deep link
- `needs_review`

Do not promote generated candidate evidence to `checked` without manual review.
