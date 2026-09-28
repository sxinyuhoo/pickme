# Changelog

Release notes shown on GitHub are taken from the section of this file that matches the tag.

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
