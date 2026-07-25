# Zotero Better Notes Auto Sync

把 Codex 写好的 Zotero 阅读笔记，交给 Better Notes 同步到 Obsidian。

这个仓库不是一个新的 Zotero 插件，也不是 Obsidian 插件。它更像一段桥接工作流：

```text
Codex / pyzotero
  -> 给 Zotero 条目或笔记加队列标签
  -> Zotero 里的 Actions & Tags 脚本接手
  -> 调用 Better Notes 注册 Markdown 同步
  -> 后续由 Better Notes 负责 Zotero note 和 .md 文件的双向同步
```

我做它的出发点很简单：读文献时，笔记最好仍然挂在 Zotero 条目下面；但写作、整理和双链又更适合放在 Obsidian 里。Better Notes 已经能做 Zotero note 和 Markdown 的同步，这个项目只负责把 Codex 生成的 note 放进这条同步链路。

## 适合谁

- 你平时用 Zotero 管文献，用 Obsidian 管知识库。
- 你想让 Codex 帮你批量读文献、写阅读卡、整理初稿笔记。
- 你希望每篇文献的主笔记仍然是 Zotero child note，而不是散落在某个文件夹里的孤立 Markdown。
- 你已经在用 Better Notes，希望少一点手动导出、手动绑定、手动点菜单。

## 不适合谁

- 你想要一个安装即用、长期无人值守的正式 Zotero 插件。
- 你有很大的团队库，或者需要多人同时维护同一批同步笔记。
- 你不想依赖 Better Notes / Actions & Tags 这类插件内部 API。
- 你希望 pyzotero 直接操作 Better Notes。这个做不到；Better Notes API 只在 Zotero 桌面端里。

如果只是个人项目、小批量文献、自己能接受备份和偶尔排查，这套流程已经够用。重要库、长期后台运行、多人协作，建议等真正的 Zotero bridge plugin。

## 需要安装

- Zotero desktop
- Better Notes / Knowledge4Zotero
- Actions & Tags
- Python 3
- pyzotero
- 一个可写入的 Obsidian vault 或普通 Markdown 文件夹

Python 依赖：

```powershell
pip install -r requirements.txt
```

静态回归检查：

```powershell
python tests/static_checks.py
node tests/safety_logic_checks.js
```

## 安装到 Codex

把整个目录复制到你的 Codex skills 目录，例如：

```powershell
Copy-Item -Recurse . "$env:USERPROFILE\.codex\skills\zotero-better-notes-obsidian-sync"
```

重启 Codex 后，可以用：

```text
Use $zotero-better-notes-obsidian-sync ...
```

## 配置 Zotero 侧脚本

打开下面两个脚本之一，把顶部常量改成你的项目值：

```js
const PROJECT_ID = "axi-gold";
const ROOT_DIR = "D:\\ObsidianVault\\BetterNotesSync\\axi-gold";
const TEMPLATE_NAME = "";
```

默认安全开关：

```js
const FORCE_EXPORT_EXISTING = false;
const RECREATE_MISSING_MARKDOWN = true;
const ALLOW_CROSS_PROJECT_MIGRATION = false;
```

保持 `FORCE_EXPORT_EXISTING = false` 可以避免重新排队已同步 note 时，把 Zotero note 的旧内容强制覆盖到 Obsidian Markdown。只有你明确要用 Zotero 端覆盖 Markdown 时，才临时改成 `true`。

保持 `ALLOW_CROSS_PROJECT_MIGRATION = false` 可以避免同一 Zotero note 被多个项目轮流改写 Better Notes 的唯一同步绑定。更推荐每个项目使用独立 child note；只有你明确要迁移这条 note 到新的 `ROOT_DIR` 时，才临时改成 `true`。

脚本：

- `scripts/actions-tags-bn-autosync-selected.js`：手动选中 Zotero item/note 后同步。
- `scripts/actions-tags-bn-queue-daemon.js`：Zotero 启动后定时搜索队列标签，适合 Codex 自动化。

Windows 路径请使用反斜杠，例如 `D:\\Vault\\Folder`。不要写成 `D:/Vault/Folder`，Zotero 的 Firefox runtime 可能会报 `NS_ERROR_FILE_UNRECOGNIZED_PATH`。

在 Actions & Tags 里添加 custom script：

- manual action：event 选择 none，operation 选择 custom script。
- queue daemon：event 选择 mainWindowLoad，operation 选择 custom script。

更详细的安装说明见 `references/actions-tags-setup.md`。

## Better Notes 自动同步设置

脚本不会静默修改 Better Notes 的全局设置。

你需要自己确认 Better Notes 的 linked-note auto-sync 已开启。脚本只会读取：

```text
extensions.zotero.Knowledge4Zotero.sync.autoSyncLinkedNotes
```

如果它是关闭状态，脚本仍可调用 `syncMDBatch` 做注册/导出，但后续 Zotero note 与 Markdown 的周期性双向同步可能不会自动运行。

## 配置 pyzotero

在环境变量中提供 Zotero API 信息：

```powershell
$env:ZOTERO_LIBRARY_ID="your-library-id"
$env:ZOTERO_LIBRARY_TYPE="user"
$env:ZOTERO_API_KEY="your-zotero-api-key"
$env:ZOTERO_BN_PROJECT_ID="axi-gold"
```

不要把真实 API key 写进仓库。

`ZOTERO_LIBRARY_TYPE=group` 可以让 Python 给 group library 项目加队列标签；但 Zotero 侧 daemon 默认只扫描个人库。要处理 group library，需要在 `scripts/actions-tags-bn-queue-daemon.js` 中配置 `LIBRARY_IDS` 为 Zotero 内部 library ID。

## 队列用法

给单个 Zotero note 或 item 加队列标签：

```powershell
python scripts/queue_zotero_items.py NOTE_OR_ITEM_KEY --project-id axi-gold
```

给一个 collection 的前 N 条 item 加队列标签：

```powershell
python scripts/queue_zotero_items.py --collection-key COLLECTION_KEY --limit 5 --project-id axi-gold
```

失败修复后显式重试 error-tagged 项目：

```powershell
python scripts/queue_zotero_items.py NOTE_OR_ITEM_KEY --project-id axi-gold --retry-errors
```

Zotero 桌面端同步到这个标签后，queue daemon 会逐 note 处理。显式排队会先清除旧的项目错误 marker 并保存 note，然后检查 Better Notes sync status 的 `path + filename`：

- 如果 note 尚未登记到当前 `ROOT_DIR`，脚本调用 `syncMDBatch()` 注册/导出。
- 如果 Better Notes `getSyncStatus()` 或 `isSyncNote()` 不可用/抛错，脚本会报 `sync_status_check_failed` 并保留队列，不会把“状态未知”当作“尚未登记”来导出。
- 在任何导出前，脚本先调用 Better Notes `getMDFileName(noteID, ROOT_DIR)`，拒绝目录分隔符、绝对路径、`..` 和非 `.md` 文件名；导出后仍会再次验证 `path + filename`。
- 如果已有项目 note 非空但缺少 marker 或正文较短，脚本只补项目 marker 和标签，不用 fallback 覆盖原内容；纯图片、纯表格、纯链接、citation/annotation 等结构化内容也视为非空。只有真正空 note 才会被模板/fallback 初始化。
- 如果 note 已登记到当前 `ROOT_DIR` 且 Markdown 文件存在，默认不再调用 `syncMDBatch()`，避免覆盖 Obsidian 端尚未回写到 Zotero 的修改。状态中的 `path` 必须严格等于 `ROOT_DIR`，不会接受 `ROOT_DIR\..\outside` 这类词法前缀路径。
- 如果文件存在性检查本身失败，例如权限、网络盘、同步盘或系统 IO 异常，脚本会报 `sync_file_check_failed` 并保留队列，不会把“无法检查”当作“文件缺失”来重建。
- 如果 note 已登记但 Markdown 文件缺失，默认会重新导出以修复缺失文件；如果你把 `RECREATE_MISSING_MARKDOWN` 改成 `false`，脚本会报错并保留队列，而不是贴成功标签。
- 如果 note 已登记到其他目录，或带有其他项目的 `Codex/BN-Synced/*` / `Codex/BN-Note/*` / queue/error/initializing 标签或 marker，默认报 `cross_project_note_conflict` 并保留队列。只有显式启用 `ALLOW_CROSS_PROJECT_MIGRATION` 才会迁移绑定；迁移成功会清理 note 上其他项目的所有权标签和 marker，但旧目录中的旧 Markdown 副本仍不会自动删除。

成功后：

- 移除 `Codex/Queue/BN-Sync/PROJECT_ID`
- 移除 `Codex/BN-Sync-Error/PROJECT_ID`
- 添加或保留 `Codex/BN-Note/PROJECT_ID`
- 添加 `Codex/BN-Synced/PROJECT_ID`
- 旧的错误 HTML marker 已在导出前清除，因此导出的 Markdown 不会携带历史错误 marker
- 验证 Better Notes sync status 中的 `path` 严格等于 `ROOT_DIR`，且安全 `filename` 拼出的真实文件位于 `ROOT_DIR`
- 在 `ROOT_DIR` 下创建或更新 Better Notes 管理的 Markdown 文件

失败时：

- 保留 `Codex/Queue/BN-Sync/PROJECT_ID`
- 添加或保留 `Codex/BN-Note/PROJECT_ID`
- 添加 `Codex/BN-Sync-Error/PROJECT_ID`
- 移除 `Codex/BN-Synced/PROJECT_ID`
- 在 note 中写入一条 HTML comment 形式的错误 marker，只记录脱敏后的短错误信息；本地目录、用户目录和 stack 只进入 `Zotero.debug`
- 如果 Markdown 同步已成功但 Zotero 状态保存失败，脚本会恢复原有队列标签并报告 `sync_succeeded_state_save_failed`
- 默认跳过 error-tagged item，直到你清除错误标签后重试；也可以用 Python helper 的 `--retry-errors` 在重新排队时同时移除当前项目错误标签

## 重要限制

- pyzotero 不能直接调用 Better Notes API；Better Notes API 只存在于 Zotero 桌面端进程里。
- 所以必须有一个 Zotero 侧桥：Actions & Tags 脚本，或者将来做成专门的 Zotero bridge plugin。
- Better Notes 的自动同步不是实时文件监听，通常按周期同步；默认可能是约 30 秒。
- 真正的双向同步由 Better Notes 管理，本项目只负责把 Codex 生成的 Zotero note 注册进 Better Notes 同步体系。
- 重新排队已经同步且 Markdown 文件存在的 note 时，默认只确认绑定关系并清理队列标签，不强制刷新导出。这样更适合双向同步；如果要用 Zotero 覆盖 Markdown，需要显式打开 `FORCE_EXPORT_EXISTING`。
- 同一 Zotero note 默认只能属于一个 Better Notes 同步项目，因为 Better Notes 对每个 note 只有一份 sync status。多项目阅读时，使用各自的 child note 更安全。
- queue daemon 使用 Zotero tag search 查找队列标签，并默认每 30 秒处理最多 8 条；这比全库扫描轻，但仍不是大型库的最佳长期方案。
- 多个项目 daemon 可以同时常驻；timer 和 busy lock 按 `PROJECT_ID` 隔离。同一 `PROJECT_ID` 的脚本重新执行时会重载 timer，使新的 `ROOT_DIR` / `POLL_SECONDS` / `LIBRARY_IDS` 生效。

## 验证

处理一篇文献后检查：

- Zotero item 下存在目标 child note。
- note 有 `Codex/BN-Note/PROJECT_ID` 标签。
- note 有 `Codex/BN-Synced/PROJECT_ID` 标签。
- note 没有 `Codex/Queue/BN-Sync/PROJECT_ID` 标签。
- note 没有 `Codex/BN-Sync-Error/PROJECT_ID` 标签。
- Better Notes `getSyncStatus(noteID)` 中的 `path` 严格等于 `ROOT_DIR`，`filename` 不含路径分隔符、绝对路径或 `..`，组合后的文件存在。
- `ROOT_DIR` 下存在对应 `.md` 文件。
- Markdown YAML 中包含 `$itemKey`，并对应 Zotero note key。

不要只用“成功标签存在”判断同步完成；标签必须和 Better Notes sync status / Markdown 文件一起验证。

故障排查见 `references/troubleshooting.md`。

兼容性和本机验证版本见 `COMPATIBILITY.md`。
