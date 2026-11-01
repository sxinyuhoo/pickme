# Changelog

Release notes shown on GitHub are taken from the section of this file that matches the tag.

## 1.4.0

- 新增「浏览态」：再点一下当前工具就取消选中，指针回到普通箭头，只用来阅读和点批注；隐藏批注时也会自动切回浏览态（设置里的「默认标注方式」多了「浏览」选项）
- 举着工具时批注不拦指针：可以直接在已有的框上划荧光笔、框选或放便利贴（之前移到框上只会打开那条批注）
- 几条约批注叠在同一处时，在同一处再点一下依次切换（先最上层，再往下），状态栏会写「这里叠了 N 条批注（荧光 → 框选）」

## 1.3.0

- 修「索引里第二条批注要点两次才生效」：鼠标按下的那一刻会切焦点，索引跟着重建，把按住的那一行换掉——浏览器就再也不发 click 事件了。现在重建会避让进行中的点击，数据没变也直接跳过重建
- 从索引打开批注时不再对已打开的文件重复 openFile：之前每次点击都会让阅读器重载一遍（看起来像页面刷新），也会连带重建列表
- 内置模板名跟随界面语言：英文界面下显示 Explain / Summarize / Translate（文件本身不动，只换显示名）
- 回答语言跟随界面语言：英文界面默认英文作答、中文界面默认中文作答；你在提问里自己指定了语言（如「请用中文回答」「translate to Japanese」）就不再追加语言指令
- 系统提示不再自称「中文助手」（这条会让英文界面下的模型默认用中文回答）

## 1.2.10

- 修「闪烁只在框的左上角冒一个圆点」：临时框里那层子元素是绝对定位，没给 inset 就塌成 0×0，描边只能画出左上角一个点；补上 `inset: 0` 之后整块区域一起闪
- 冷启动（文件还没打开时）第一次点击就会正确闪烁，不再需要点第二次

## 1.2.9

- 修「闪烁只出现在页面左上角的一个小圆点」：定位闪烁用的临时框自己带 `position: absolute` 才能用 left/top 定位，之前漏了，于是框一直蹲在页面左上角（1.2.8 引入）
- 清掉官方扫描器的报错：浏览器请求入口改用 DOM 类型里的 `window.fetch`（去掉 `any` 与 eslint-disable 注释）、移除一处 console.log

## 1.2.8

- 定位闪烁改成**独立绘制的临时框**：不再依赖常驻标记元素，页面或标记怎么重绘都不会把闪烁冲掉（只活一秒多，不吃鼠标事件、不碰数据）
- 点同一页里的另一条批注不再把页面滚回页首：目标页已经看得见时就只做页内定位，不再有「跳一下」的重新载入感
- 「待闪烁」请求与兜底保险也统一走这套几何闪烁

## 1.2.7

- 闪烁改回原来的细描边呼吸（0.42s × 2），去掉 1.2.6 那层偏重的填充
- 单文档批注侧边栏的「全部批注（索引）」文字链接改成右上角一个小图标按钮，点它直接打开批注索引
- 修「部分批注点了不跳不闪」：批注文件里记的源路径过期时（文档在插件监听之外被移动过），跳转会按 id 跨文档找到它，并顺手把批注文件搬到新路径（自愈）；两边文件都已存在、搬不动的情况，就在页面上临时画一个框闪两下做定位
- 启动时会静默自愈一遍这类过期源路径（只认「同名且唯一」的文档，不会搬错）

## 1.2.6

- 闪烁做得更醒目：在描边之外再叠一层强调色填充呼吸（任何标注类型都盖得住，一眼可见）
- 闪烁节奏拉长（0.55s × 2），并在跳转/滚动落定后 150ms 才开始闪，避免被同时发生的位置变化盖掉

## 1.2.5

- 闪烁加了一道兜底保险：把闪烁交给阅读器之后 1.8 秒仍未被兑现（没建出视图、渲染卡住、实例被换掉等任何一条岔路），插件自己找到标记再闪一次——「点了就该闪」不再依赖单一路径
- 说明：1.2.4 已修掉「同文档第二次点击不闪」的根因（视图尚未创建完成时那次请求被丢掉），这版是把这种情况彻底兜住

## 1.2.4

- 修「同一文档只有第一次点击会闪烁」：从索引点进去时阅读器视图可能还没创建完，那次闪烁请求现在会挂起，由先画完这一页的视图兑现（视图中途被替换也不会丢）
- 连点同一条批注也会重新播闪烁（先摘类、强制重排再挂上）

## 1.2.3

- 修批注索引点进去不闪烁：以前标记元素一出现就闪，而那时页面还是白纸——现在等这一页真正渲染完成（或渲染失败）再闪
- 修批注索引没有滚动条：视图容器的 overflow 是 hidden，内容超出的部分既看不见也滚不动
- PDF 闪烁统一由阅读器自己在「渲染完成」后触发（正文批注仍由插件在跳转后触发）

## 1.2.2

- 修「便利贴批注点击不闪烁」：闪烁规则漏了便利贴这一种标注（只覆盖了行带、框、页码标签）
- 闪烁等标记真正画出来之后再闪（翻页重绘期间元素尺寸为 0 时不算到位），新建出来的阅读器会先切到前台再闪
- 闪烁更明显：描边 3px、偏移 2px
- 修社区扫描器的报错：styles.css 里一个空规则（选择器以逗号结尾、没有声明块）、设置页两处内联样式改为 CSS 类、`createEl('span')` 改用 `createSpan`、全局 fetch 引用收敛成一处显式入口

## 1.2.1

- 从批注索引点进某条批注也会闪烁定位了（PDF 冷启动要等渲染，重试窗口从 1.2 秒放宽到 6 秒）
- 「失效」统一改叫「锚点丢失」：说明白这是你自己的批注（锚点找不到了），不是坏数据
- 新增设置「索引里显示『锚点丢失』的批注」：不想看到就关掉，批注仍在文件里，随时能开回来或重新绑定

## 1.2.0

- 设置页改用 Obsidian 的声明式设置 API：全部 37 项都能在「设置搜索」里搜到，分组与说明重写；**最低 Obsidian 版本因此提高到 1.13.0**
- 点击批注索引或侧边栏里的任意一条，跳过去后目标标记会**连闪两下**（0.42s × 2），同一页批注再多也能一眼找到；PDF 标记是异步渲染的，加了重试不会漏；尊重系统「减少动态效果」设置
- 批注索引的边距与单文档侧边栏完全对齐（视图 12/12/32、子项同一竖线），并修掉一条把索引内边距压成 0 的规则
- README 索引与多选截图重拍

## 1.1.5

- 批注索引：统计文字与标题、文档名严格左对齐（去掉 2px 缩进）

## 1.1.4

- 批注索引留白重排：四周留出内边距，标题与统计分成两行，搜索框变矮、不再贴边
- 全内容统一到一条左基线（标题/统计/搜索框/文档名/缩略图同一竖线），行的高亮底色向两侧各溢出 8px
- 文档分组之间改用留白分隔，去掉分隔线；修掉索引分组被侧边栏卡片规则误画的一道多余横线
- README 索引与多选截图重拍

## 1.1.3

- 批注索引：页码与类型拆成两个元素 —— 页码淡灰做定位，类型带标签底色，扫读时先看类型
- 单文档侧边栏整体对齐索引的语言：去掉「卡中卡」，改成一行的行式列表（左侧强调条 + 行间内缩细线）
- 锚点 id 不再套胶囊；类型标签与索引同款；状态不再用主题的青色（那套主题的 faint 就是青色）
- 操作按钮收小成描边小按钮；区域截图压到 72px 高；问题与回答用竖线分层，字号 10.5px 统一
- 说明文字改成左侧竖线引用样式，不再抢眼
- README 索引与多选截图重拍

## 1.1.2

- 批注索引排版重做：文档组标题降到小字 + 计数胶囊，批注标题成为行内主体，四级层级一眼可辨
- 每行左侧统一「预览槽」：有截图给缩略图，没有就给类型图标（文本批注 / 高亮），正文左边界不再跳；截图文件缺失时换成图标而不是留空洞
- 元信息（提问数 · 锚点 id · 时间）改用轻点分隔、时间推到行尾对齐；不再跟随主题的 faint 色（有的主题把它做成青色），改为按正文色取中性灰
- 行间细线内缩，组间分隔加重；文档名去掉主题加的下划线
- README 的索引与多选截图按新版重拍

## 1.1.1

- 修下拉框：模板、模型两个选择框的箭头会压住文字 / 看不见，现在箭头自己画、右侧留出内边距
- README 截图按 1.1.0 的新界面全部重拍，并补上批注索引多选与批量删除的截图

## 1.1.0

界面全线重做，功能不变。

- 统一设计语言：字号、间距、圆角、过渡全量对齐 TLT；颜色改为令牌化管理，深浅两套随 Obsidian 主题自动切换（也会跟随你换的主题）
- 批注索引：新增多选与批量删除（勾选框、已选计数、全选/取消、删除所选，0 条时删除按钮禁用），支持 ↑↓ / Space / ⌘A / Del 键盘操作；删除前确认并说明会一并移除正文锚点标签
- 索引行内删除按钮平时收起、悬停才出现；截图缺失时不再显示破图标
- PDF 阅读器工具条按 V2 密度重排，标注方式选中态用底色 + 描边 + 图标同色三重确认
- PDF 纸面固定白纸：深色主题下荧光带不再被压低对比度而看不清
- 问答/批注面板、侧边栏、设置页跟着同一套令牌走

## 1.0.17

### Changed

- **Annotation files now move with their source document** (the change 1.0.16 was leading up to). Moving or renaming a note or PDF moves its annotation file, and its region screenshots, to the matching place inside the plugin folder, and rewrites the paths that point at those screenshots. The mirrored-path invariant therefore holds again, which means reading no longer has to guess and — more importantly — a move or a rename can no longer be mistaken for a deletion.
- The delete handler waits a moment and then double-checks: if **another** document with the same name exists (the copy-then-delete way of moving a file in Finder), the annotations are kept. Previously the check ran while the vault index had not caught up, so a real deletion could never be cleaned.
- The startup sweep now asks for the same judgement twice: an orphan is only cleaned if a previous run already saw it as an orphan (and at least a minute has passed), which covers renames done while Obsidian was closed and vaults that have not finished syncing. A delete that goes through Obsidian still cleans up immediately.
- Fixed a file-name match that only stripped `.md`: documents like `.pdf` never matched when resolving by name, so the guard above would not have held for them.

## 1.0.16

### Added

- **Annotations for a deleted document are cleaned up automatically.** Deleting a note or PDF used to leave its annotation file (and region screenshots) behind, still listed in the index. Now the plugin reacts to the delete, removes that file's annotations together with their screenshots, and sweeps anything left over from earlier at startup. The sweep only treats a document as gone when **both** its stored path and its file name resolve to nothing — so a moved or renamed document keeps its annotations (that is what 1.0.15 was about). A notice tells you how many were removed, and the whole behaviour has a setting (on by default).

## 1.0.15

### Fixed

- **A fast multi-line stroke no longer skips lines.** Sweeping the highlighter quickly across several lines can coalesce pointer events, and the lines in the middle were left out. Lines that fall between the first and last line actually touched are now filled in automatically — their band is interpolated from where the stroke crosses them — so a gap in your hand no longer becomes a gap in the highlight.
- **The annotation index survives moving or renaming the source.** Rows used to resolve their document by the path stored in the annotation file, so moving the note or PDF broke the jump with “source not found”. The index now falls back to resolving by file name (Obsidian's own link resolution first, then a unique match in the vault), and the annotation file is located the same way after a move.

### Changed

- **Smaller highlighter cursor, and it gets out of the way while you draw.** The pen cursor is smaller, and once the mouse is down it switches to a bare stroke without the pen body, so less of the text you are highlighting is covered.

## 1.0.14

### Fixed

- **A multi-line selection in a note no longer loses everything after the first line.** `- 选区：` is a single-line bullet, so a selection containing newlines used to be written across several physical lines, read back as its first line only, and the annotation was afterwards reported as stale — even though the note itself was never touched. Because every read wrote the truncated value back, the rest was gone for good. The selection is now escaped into a single line (newlines become a literal `\n`, backslashes are doubled) and restored on read; files without newlines stay byte-for-byte identical, so nothing needs migrating. Reported and fixed by @tyouter (#1, #2).
- Annotations that were already truncated cannot be repaired automatically, but the full text still sits between the anchor tags in your note — use the command **Rebind stale anchors** to attach a fresh anchor to it.

## 1.0.13

### Changed

- **Saving a sticky note closes its box.** Dropping a sticky, typing and hitting save (or `⌘/Ctrl + Enter`) is the whole interaction — the box closes by itself instead of waiting for you to press the close button. The box closing is the confirmation, so no status line is left behind.
- A highlight's note box still stays open after saving, so you can keep editing it or switch to the question composer with one click.

## 1.0.12

### Added

- **Sticky notes can be dragged.** Grab one and drop it wherever you want: the icon follows the pointer and the new position is written to the annotation file (the same gesture that used to be a click still opens the note — a drag only starts once the pointer actually moves). Works in every mode, so you do not have to switch back to the sticky tool to tidy up a page.

### Changed

- The sticky icon is a good deal paler: it is mixed from the theme's yellow and the page background, so it reads as a marker without shouting in either a light or a dark theme. Empty notes are paler still (and dashed).

## 1.0.11

### Added

- **Sticky notes.** A third annotation mode alongside the highlighter and the region tool: click anywhere on a PDF page and a small sticky-note icon is dropped there — the icon is all you see on the page, and clicking it opens what you wrote (hovering previews it). Notes can run several lines: the text is kept in full in the annotation file (`### 注释`) with a one-line summary in the bullets, so a long note survives a round trip through the file. The icon is filled when it has content and dashed while it is empty, and the box offers “Ask AI instead” exactly like a highlight's note.
- Note text is no longer folded to a single line: a note that contains line breaks is written out in full (a highlight's note benefits too).

## 1.0.10

### Added

- **Continued highlighting merges.** Start a stroke on an existing highlight (or on the line right above/below it) and that stroke is appended to it instead of creating a second annotation — so reading down a paragraph and swiping line by line builds one multi-line highlight. No panel opens for a continuation, because it is not a new annotation.
- **A mostly vertical stroke highlights the whole line.** Dragging straight down across a few lines used to leave a 4pt sliver on each; now each of those lines is highlighted end to end. Short horizontal swipes are unaffected and still cover exactly what you painted.

### Changed

- **Finishing a highlighter stroke opens nothing.** The default result of a stroke is a plain highlight; the note box appears when you click the highlight. (1.0.9 opened it automatically — that was one step too eager.)
- `Escape` right after a stroke undoes it: a new highlight is removed, while a merged stroke is rolled back out of the existing highlight without touching the rest of it.

## 1.0.9

### Added

- **Highlights take a note.** Finishing a highlighter stroke opens a small note box instead of the AI composer: type a line, then ⌘/Ctrl + Enter to save. The note lives with the highlight (`- 备注：…` in the annotation file), shows up in the annotation index and the sidebar, and comes back when you click the highlight. **Ask AI instead** switches that same panel into the question composer, so nothing is lost.

### Changed

- **The highlighter covers exactly what you painted.** The band spans the left and right end of your stroke (clamped to the text it touched) instead of snapping to the whole line — swiping across the middle of a sentence highlights just that stretch.
- **While you drag, you see your own stroke**: a translucent marker line at the text's height, which only turns into the clean band when you release.
- The page status line no longer promises “Esc to undo” on a fresh highlight: with the note box open, Esc means cancel (untouched highlights are still removed by it).

### Fixed

- The note box's save confirmation had nowhere to appear — the status element only existed in the question composer.

## 1.0.8

### Changed

- **The pointer tells you which mode you are in.** Region mode keeps the crosshair; highlighter mode uses a marker cursor (with a text-cursor fallback where custom cursors are unavailable), so you can see which tool is live before you press the button.
- **The active annotation mode is now clearly marked on the toolbar**: the selected button gets an accent background and outline, instead of relying on a slightly different icon shade. Screen readers get `aria-pressed` as well.

## 1.0.7

### Changed

- **The highlighter only highlights.** Finishing a stroke no longer opens the ask panel or jumps to the sidebar - the stroke snaps to the line and stops there, because the point of a highlighter is the mark itself. To ask about a passage you highlighted, click it: the panel opens the same way it does for any existing annotation.
- Pressing `Escape` within a few seconds of a stroke undoes that highlight, which keeps a mis-aimed stroke from having to be deleted through the panel.
- Region mode is unchanged: drag a box and the panel opens right away.

## 1.0.6

### Added

- **Highlighter annotations in PDFs.** Drag a free-hand stroke across text and it snaps to the lines underneath: the wobble is thrown away and you get a clean band hugging each line, spanning from the first character the stroke touched to the last. A stroke across several lines yields one band per line, and the text of every covered line is stored with the annotation, so the model reads what you meant.
- The PDF toolbar now has two mutually exclusive annotation modes - **Highlighter** and **Region** - and the choice is remembered between sessions. Both can be used on the same content: a box plus strokes on one annotation render as a band for the text and a thin outline for the area, so they never fight visually.
- Where you are in the document is now drawn on the page: the annotation you are reading keeps its full strength and gets a "Page N - Highlighter" (or "Region") tag, while the other annotations on that page fade to 15%.
- **PDFs remember where you stopped reading.** The page you are on is recorded as you scroll (per file, and only written to disk when it settles), so closing the tab or the app and coming back resumes at that page instead of page 1. The list is capped at the 200 most recently read files.

### Fixed

- **An annotation could be deleted by the act of reading it.** Closing a panel because a new one was taking over was treated as a cancel, so clicking a highlight you had just drawn removed it. Only an explicit cancel (the x button or Esc) undoes an annotation that was never asked about.
- The active-annotation state vanished as soon as it was set: the outgoing panel's callback cleared the view's current annotation id after the new panel had already claimed it.
- Rotated PDF pages are converted through the page's rotation instead of assuming it is upright, which had put annotations in the wrong place.
- Multi-line hit text was truncated to its first line when written to disk. The full text is kept in its own section, with the one-line bullet kept as a preview.
- A stroke drawn over an image or blank space no longer creates an empty annotation: it says so and leaves the page alone.

### Changed

- On the last page of a document the page counter now reads the last page when you scroll to the end. Before, the final page could never reach the top of the viewport (there is nothing below it to scroll), so scrolling to the end reported the second-to-last page — and that wrong number was what a remembered reading position was based on.
- The browser `fetch` call now lives in a single documented helper. It cannot be removed: Obsidian's `requestUrl` is issued from the main process and cannot see a streaming response body, so real streaming (and the "endpoint rejects the thinking parameter, so retry without it" logic) needs `fetch`; the `/models` probe also keeps a `fetch` fallback for relay endpoints that only answer browser-origin requests. Every request that does not need streaming still goes through `requestUrl` first.
- Highlighter annotations do not store a region screenshot - the text is enough, and it keeps the vault small. Region annotations still do.
- The annotation index, the sidebar and the anchor autocomplete now say which shape an annotation is ("Page 12 - Highlighter", "Page 12 - Region", "Page 12 - Region + strokes") instead of always saying "Region".

## 1.0.5

### Fixed

- The empty-folder cleanup shipped in 1.0.4 never actually ran. Obsidian's `adapter.rmdir` follows `fs.rm` semantics: passing `recursive: false` for a directory throws `EISDIR (is a directory)` even when the folder is empty, and the cleanup swallowed that error. Deleting or cancelling an annotation now really does remove the leftover `_assets/<document>.md/` folder.

### Changed

- The smoke-test stub for `adapter.rmdir` now mirrors the real behaviour (it throws unless `recursive` is set), so this class of stub-vs-reality mismatch fails the build instead of shipping.

## 1.0.4

### Fixed

- Deleting or cancelling a PDF annotation no longer leaves an empty `_assets/<document>.md/` folder behind. When the last region screenshot of a document goes away, the empty folder is removed with it; a folder that still holds screenshots is left untouched.

### Changed

- The generated `src/generated/pdfAssets.ts` is now committed to the repository. The automated plugin review runs its static analysis before any build step, and an import it cannot resolve degrades to `any` — which surfaced as ten spurious `unsafe-*` findings against the pdf.js resource lookups. Regeneration is deterministic and CI fails if it drifts from `pdfjs-dist`.
- The gzip header written by the asset packer no longer carries the platform byte, so the same source produces the same `main.js` on macOS and on Linux. Release artifacts are now byte-identical to a local build.

## 1.0.3

### Changed

- The inlined pdf.js resources (CMap tables and standard fonts) are now packed as one gzip stream per group instead of one base64 blob per file. `main.js` drops from **4.5 MB to 3.8 MB** (`-16%`), so installing and updating from the community plugin browser downloads less and is less likely to be cut off on a slow or unstable connection. Nothing about PDF rendering changes: the same 168 CMap tables and 16 standard fonts ship inside the file, and they are decompressed once, lazily, the first time a PDF actually needs them.

### Added

- A test that decompresses the packed resources and compares the result **byte for byte** with the original `pdfjs-dist` files, so a packing mistake cannot slip through silently.

## 1.0.2

### Fixed

- The ask panel no longer preselects the first template in the list. Opening it and typing your own question used to run that question through the translation template, and the annotation was recorded as `template: 翻译` even though no template was chosen. "Ask directly" is now the default, as the dropdown implies.
- The template dropdown is still there and still remembers your pick for the current panel; nothing else about templates changed.

## 1.0.1

Addresses the automatic review report. The review's own linter now reports **0 errors** for this plugin.

### Compatibility

- `minAppVersion` raised from `1.6.0` to **`1.7.2`**. The plugin calls `Workspace.revealLeaf`, which returns a promise from Obsidian 1.7.2 onward, so the declared minimum now matches what the code actually uses. Nothing changes for anyone on 1.7.2 or newer.

### Consistency with the plugin guidelines

- Closed the in-page ask panel's own component instead of borrowing the plugin instance as a component, so rendered answers are released when the panel closes.
- Replaced a direct `element.style` write with a CSS class.
- Use `Vault#configDir` instead of a hardcoded `.obsidian` path.
- Use `FileManager.trashFile()` so deleting an annotation respects your own "deleted files" preference.
- Use Obsidian's `createEl` / `createSpan` helpers instead of `document.createElement`.
- Use `window.setTimeout` / `window.clearTimeout` so timers keep working in popout windows.
- Declared `@codemirror/state` and `@codemirror/view` as direct dependencies.
- Removed a full-width space, an unnecessary regex escape, two unnecessary type assertions and two deprecated slider calls.
- Fixed two placeholders/labels to sentence case.

### Known, deliberate deviations

- The chat request still uses the browser `fetch` when streaming is on: Obsidian's `requestUrl` cannot stream a response body, and streaming is what keeps long answers from appearing all at once at the end. `requestUrl` remains the fallback channel, and the model list tries it first.
- The settings tab still uses the classic (`display()`) API instead of the declarative one: `getSettingDefinitions()` requires Obsidian 1.13, and adopting it would raise `minAppVersion` to 1.13.0 and cut off everyone on older versions.

## 1.0.0

First release.

- Ask about, or annotate, text selected in a note, or a region framed in a PDF — without leaving the page.
- Annotations live in their own Markdown files; the original document is never modified.
- Reverse navigation: in-place marks, an annotation index sidebar, and back links from the annotation file to the source document.
- Built-in pdf.js viewer: continuous scrolling, outline, region select, region screenshot and text extraction, multimodal questions.
- Bring your own OpenAI-compatible endpoint; streaming, deep-thinking (`reasoning_content`) and a local Markdown template library.
