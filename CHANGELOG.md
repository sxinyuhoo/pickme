# Changelog

Release notes shown on GitHub are taken from the section of this file that matches the tag.

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
