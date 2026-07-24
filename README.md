# Zotero Better Notes Auto Sync

这是一个给 Codex 使用的 Zotero → Better Notes → Obsidian 自动同步工作流 skill。

它解决的问题很具体：

1. Codex 通过 Zotero Web API / pyzotero 读取文献、PDF 元数据和已有笔记。
2. Codex 在 Zotero 条目下面创建或更新一条结构化 child note。
3. Codex 给 note 或 item 加上项目隔离的队列标签，例如 `Codex/Queue/BN-Sync/PROJECT_ID`。
4. Zotero 桌面端里的 Actions & Tags 脚本检测到队列标签。
5. 脚本调用 Better Notes 的 `syncMDBatch`，把 Zotero note 注册成可自动同步的 Markdown。
6. Better Notes 负责 Zotero note 和本地 `.md` 文件之间的后续双向同步。

换句话说，这不是一个新的 Zotero 插件，也不是 Obsidian 插件；它是 Codex + pyzotero + Actions & Tags + Better Notes 之间的轻量桥。

## 当前定位

这个项目适合小规模个人工作流、项目级文献阅读卡、以及 Zotero/Obsidian 自动化实验。它已经避免了“同步失败但提前贴成功标签”和“一个坏 note 阻塞整批任务”这类高风险状态机问题。

但它仍然不是无人值守的大型 Zotero 基础设施。长期、大库、多项目、多用户场景更适合做成专门的 Zotero bridge plugin，通过 Zotero notifier 事件驱动，而不是依赖 Actions & Tags 轮询脚本。

## 适用场景

- 你想让 Codex 读 Zotero 文献，并按固定模板写阅读卡。
- 你希望阅读卡先成为 Zotero child note，而不是只生成孤立 Markdown。
- 你希望 Better Notes 管理 Zotero note 与 Obsidian Markdown 的双向同步关系。
- 你不想每篇文献都手动点 Better Notes 导出。

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

Zotero 桌面端同步到这个标签后，queue daemon 会逐 note 调用 Better Notes。成功后：

- 移除 `Codex/Queue/BN-Sync/PROJECT_ID`
- 移除 `Codex/BN-Sync-Error/PROJECT_ID`
- 添加 `Codex/BN-Synced/PROJECT_ID`
- 验证 Better Notes sync status 的 path 位于 `ROOT_DIR`
- 在 `ROOT_DIR` 下创建或更新 Better Notes 管理的 Markdown 文件

失败时：

- 保留 `Codex/Queue/BN-Sync/PROJECT_ID`
- 添加 `Codex/BN-Sync-Error/PROJECT_ID`
- 移除 `Codex/BN-Synced/PROJECT_ID`
- 在 note 中写入一条 HTML comment 形式的错误 marker
- 默认跳过 error-tagged item，直到你清除错误标签后重试

## 重要限制

- pyzotero 不能直接调用 Better Notes API；Better Notes API 只存在于 Zotero 桌面端进程里。
- 所以必须有一个 Zotero 侧桥：Actions & Tags 脚本，或者将来做成专门的 Zotero bridge plugin。
- Better Notes 的自动同步不是实时文件监听，通常按周期同步；默认可能是约 30 秒。
- 真正的双向同步由 Better Notes 管理，本项目只负责把 Codex 生成的 Zotero note 注册进 Better Notes 同步体系。
- queue daemon 使用 Zotero tag search 查找队列标签，并默认每 30 秒处理最多 8 条；这比全库扫描轻，但仍不是大型库的最佳长期方案。

## 验证

处理一篇文献后检查：

- Zotero item 下存在目标 child note。
- note 有 `Codex/BN-Synced/PROJECT_ID` 标签。
- note 没有 `Codex/Queue/BN-Sync/PROJECT_ID` 标签。
- note 没有 `Codex/BN-Sync-Error/PROJECT_ID` 标签。
- Better Notes `getSyncStatus(noteID).path` 位于 `ROOT_DIR`。
- `ROOT_DIR` 下存在对应 `.md` 文件。
- Markdown YAML 中包含 `$itemKey`，并对应 Zotero note key。

不要只用“成功标签存在”判断同步完成；标签必须和 Better Notes sync status / Markdown 文件一起验证。

故障排查见 `references/troubleshooting.md`。

兼容性和本机验证版本见 `COMPATIBILITY.md`。
