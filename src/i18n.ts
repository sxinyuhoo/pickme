/**
 * 界面文案的中英双语。
 *
 * 以中文原文作为 key（gettext 式）：调用处写 t('发送')，英文界面查表换成 Send。
 * 表里没有的条目直接回落成中文原文，所以漏译只会显示中文，不会出现空串或 undefined。
 * 内容类文本（默认模板正文、批注文件里的字段名）不在这里，它们属于用户数据。
 */
export type Language = 'en' | 'zh';

/** 中文原文 → 英文译文（key 就是调用处写的中文原文） */
export const EN: Record<string, string> = {
	'OpenAI 兼容接口的 base url，例如 https://api.openai.com/v1。': 'Base URL of an OpenAI-compatible API, for example https://api.openai.com/v1.',
	'PDF 区域截图走这个模型，留空表示用默认模型（默认模型本身支持图片即可）。': 'Region screenshots from PDFs are sent to this model; leave empty to use the default model (it only needs to accept images).',
	'PDF 第 {page} 页': 'PDF page {page}',
	'PDF 第 {v0} 页': 'PDF page {v0}',
	'PDF 页面上画出已有批注的框。关掉就是原始 PDF 的样子，工具栏上也有一个按钮可以随时切换。': 'Draw boxes for existing annotations on the PDF page. Turn it off to see the plain PDF; the toolbar has a button to toggle this at any time.',
	'PDF 默认缩放': 'Default PDF zoom',


	'Pick Me：提问或批注': 'Pick Me: Ask or annotate',
	'Pick Me 批注': 'Pick Me annotation',
	'Pick Me：批注列表（查看）': 'Pick Me: annotation list (view)',
	'\n上下文：\n{v0}': '\n\nContext:\n{v0}',
	'pickme：PDF 载入失败 {v0}': 'Pick Me: failed to load the PDF {v0}',
	'pickme：区域截图保存失败 {v0}': 'Pick Me: failed to save the region screenshot {v0}',
	'pickme：原文里匹配到 {v0} 处，无法自动绑定，请手动处理': 'Pick Me: found {v0} matches in the source, cannot rebind automatically — please fix it by hand',
	'pickme：原文里找不到锚点 {v0}': 'Pick Me: anchor {v0} not found in the source',
	'pickme：已交还内置查看器，下次打开 PDF 生效': 'Pick Me: handing PDFs back to the built-in viewer, effective the next time you open a PDF',
	'pickme：已删除 {v0} 条批注': 'Pick Me: deleted {v0} annotations',
	'pickme：已删除批注 {v0}': 'Pick Me: deleted annotation {v0}',
	'pickme：已把 {v0} 个文档的锚点标签从 {v1} 换成 {v2}': 'Pick Me: changed the anchor tag from {v1} to {v2} in {v0} documents',
	'pickme：已拉取 {v0} 个模型，侧边栏下拉即可选择': 'Pick Me: fetched {v0} models — pick one from the sidebar dropdown',
	'pickme：已接管 PDF 打开': 'Pick Me: PDF opening intercepted',
	'pickme：已添加批注 {v0}': 'Pick Me: annotation {v0} added',
	'pickme：已重新绑定为 {v0}': 'Pick Me: rebound as {v0}',
	'pickme：当前文档没有批注': 'Pick Me: this document has no annotations',
	'pickme：当前文档还没有批注': 'Pick Me: this document has no annotations yet',
	'pickme：当前没有打开的文档': 'Pick Me: no document is open',
	'pickme：批注目录没有变化，无需迁移': 'Pick Me: annotation folder unchanged, nothing to migrate',
	'pickme：找不到批注 {v0}': 'Pick Me: annotation {v0} not found',
	'pickme：拉取模型列表失败 {v0}': 'Pick Me: failed to fetch the model list {v0}',
	'pickme：按设置只用命中文本提问，未发送区域截图': 'Pick Me: asking with the matched text only, per settings; no region screenshot was sent',
	'pickme：接口没有返回任何模型': 'Pick Me: the API returned no models',
	'pickme：新建 {v0} 个模板': 'Pick Me: created {v0} templates',
	'pickme：无法创建侧边栏': 'Pick Me: could not create the sidebar',
	'pickme：标签名没有变化': 'Pick Me: anchor tag name unchanged',
	'pickme：没有失效的锚点': 'Pick Me: no broken anchors',
	'pickme：没有需要替换的标签名（先在设置里改过锚点标签名才会记录旧值）': 'Pick Me: no tag name to replace (the old value is recorded only after you change the anchor tag name in settings)',
	'pickme：请先在设置里填写 API Key': 'Pick Me: set the API Key in settings first',
	'pickme：请先在设置里填写接口地址': 'Pick Me: set the API base URL in settings first',
	'pickme：请先在设置里填写模型名称': 'Pick Me: set the model name in settings first',
	'pickme：请先填写接口地址': 'Pick Me: set the API base URL first',
	'pickme：请先打开一个 PDF': 'Pick Me: open a PDF first',
	'pickme：请先打开一个文档': 'Pick Me: open a document first',
	'pickme：请先选中一段文字': 'Pick Me: select some text first',
	'pickme：请先选中文本，或在侧边栏点击一条批注': 'Pick Me: select text first, or click an annotation in the sidebar',
	'pickme：请在设置里手动打开 Pick Me 面板': 'Pick Me: open the Pick Me panel manually in settings',
	'pickme：请求失败 {v0}': 'Pick Me: request failed {v0}',
	'pickme：这条批注没有文本锚点': 'Pick Me: this annotation has no text anchor',
	'pickme：连接失败 {v0}': 'Pick Me: connection failed {v0}',
	'pickme：连接正常，返回「{v0}」': 'Pick Me: connection OK, it replied “{v0}”',
	'{v0} 条批注': '{v0} annotations',
	'{v0}\n\n整篇笔记：\n{v1}': '{v0}\n\nThe whole note:\n{v1}',
	'{v0}\n\n（请求中断：{v1}，以上为已完成部分）': '{v0}\n\n(request interrupted: {v1}; the text above is what was completed)',
	'{v0}\n\n（随附框选区域截图）': '{v0}\n\n(the screenshot of the selected region is attached)',
	'上一页': 'Previous page',
	'上下文上限（字符）': 'Context limit (characters)',
	'下一页': 'Next page',
	'下划线': 'Underline',
	'为没有批注的文档也建批注文件': 'Create files for unannotated notes',
	'对选区提问或批注': 'Ask or annotate the selection',
	'新建提问模板': 'New prompt template',
	'新建模板': 'New template',
	'新建': 'New',
	'框选时把这块区域裁成 PNG 存在批注旁边，提问时作为图片送给模型。不需要图文问答就关掉，能省下这些图占的空间。':
		'Cuts the region you select into a PNG stored next to the annotation, and sends it to the model as an image. Turn it off if you do not need image Q&A — that saves the space these files take.',
	'截图等比缩到这个边长再存：越小越省 token，字也越小。0 表示不缩放。':
		'Scales the screenshot so its longest side is this many pixels before saving. Smaller costs fewer tokens but the text gets smaller too. 0 means no scaling.',
	'pickme：{v0} 已改到插件自己的位置，旧文件没有动，需要的话自己清理':
		"Pick Me: moved {v0} to the plugin's own location. The old files were left untouched — clean them up yourself if you want.",
	'渲染超时（窗口在后台时 pdf.js 不会出帧）。把窗口切到前台后会自动重画':
		'Rendering timed out — pdf.js does not produce frames while its window is in the background. Bring the window to the front and it will redraw itself.',
	'重试': 'Retry',
	'pickme：已新建模板「{v0}」，在 {v1} 下，用访达打开就能编辑':
		'Pick Me: created template "{v0}" under {v1}. Open that folder in Finder to edit it.',
	'温度': 'Temperature',
	'0 到 1 之间，越小回答越稳、越确定，越大越发散。批注问答建议 0.2~0.4；模板文件里能用 pickme_temperature 单独覆盖。':
		'Between 0 and 1. Lower is steadier and more deterministic, higher is more varied. 0.2-0.4 works well for annotation Q&A. A template can override it with pickme_temperature.',
	'流式输出': 'Stream the answer',
	'边生成边显示，回答一个字一个字地出来；关掉则等全部生成完再显示。流式只在浏览器请求通道可用。':
		'Show the answer as it is generated, word by word. Turn it off to wait for the whole answer. Streaming is only available over the browser request path.',
	'深度思考': 'Deep thinking',
	'开启后模型先推理再作答，质量更好也更慢。思考有独立预算，不占「最大输出长度」；提问面板上可以按次取消。':
		'When on, the model reasons before answering: better quality, slower. Thinking has its own budget and does not eat into "Max output length". The ask panel can turn it off for one question.',
	'测试连接': 'Test connection',
	'按上面的地址与密钥发一次最小请求，确认能不能通。':
		'Sends one minimal request to the address and key above to check whether they work.',
	'一次最多送多少字给模型，超出会被截断并加一行提示。PDF 框选是取区域内的文字，同样受这个上限管。':
		'How many characters can be sent to the model at most. Anything longer is truncated with a note. Text taken from a PDF marquee counts against the same limit.',
	'打开提问面板时，「带上下文」是否默认勾上。模板里能用 pickme_context 覆盖。':
		'Whether "with context" is ticked by default when the ask panel opens. A template can override it with pickme_context.',
	'自带查看器打开 PDF 时的初始缩放倍数，1 是原始大小。':
		'Initial zoom factor when the bundled viewer opens a PDF. 1 is actual size.',
	'高亮颜色': 'Highlight colour',
	'正文里批注范围的底色，或下划线、左边框的颜色。':
		'Colour of the annotation range in notes: the highlight background, underline or left border.',
	'pickme：请先在设置里填写模板目录': 'Pick Me: set the template folder in settings first',
	'pickme：已新建模板「{v0}」，文件名就是模板名，正文就是提示词':
		'Pick Me: created template "{v0}". The file name is the template name; the body is the prompt.',
	'从接口拉取': 'Fetch from API',
	'你是一个中文技术助手，正在为阅读中的文档做批注。回答要具体、可核对，不要重复原文，不要编造原文里没有的信息。': 'You are a Chinese-language technical assistant annotating a document the user is reading. Answers must be specific and verifiable, do not repeat the source text, and do not invent information that is not in it.',
	'侧边栏可选模型': 'Models in the sidebar',
	'保存区域截图': 'Save region screenshots',
	'保存在本机插件配置里，不会随库同步。': 'Stored in this device\\\'s plugin configuration; not synced with the vault.',
	'停止': 'Stop',
	'允许图片输入': 'Allow image input',
	'拖动框选提问；左右滑动翻页': 'Drag to select, then ask; swipe sideways to flip pages',
	'关闭': 'Close',
	'关闭后 PDF 区域批注只用命中文本提问，不发送截图。': 'When off, region annotations in PDFs ask with the matched text only and send no screenshot.',
	'关闭后，添加批注不会自动弹出面板，需要点批注标记再打开。': 'When off, adding an annotation does not open the panel; click the annotation marker to open it.',
	'删除': 'Delete',
	'删除当前文档的全部批注': 'Delete all annotations in this document',
	'单次回答的 token 上限。注意推理型模型的思考内容也计入这里：给得太小，思考还没结束就被截断，正文会是空的（批注里会写明原因）。': 'Token limit for a single answer. Reasoning tokens count towards it too: set it too low and the answer is cut off before thinking finishes, leaving the body empty (the annotation records the reason).',
	'发送': 'Send',
	'取消': 'Cancel',
	'取选区前后各一部分正文作为上下文。': 'Takes part of the text before and after the selection as context.',
	'回复两个字：可用': 'Reply with one word: ok',
	'在 PDF 上框选批注': 'Annotate a region in the PDF',
	'在 Pick Me 查看器中打开': 'Open in Pick Me viewer',
	'在 Pick Me 查看器中打开当前 PDF': 'Open current PDF in Pick Me viewer',
	'在此提问': 'Ask here',
	'在页面内提问': 'Ask in place',
	'失效': 'Broken',
	'将删除 {v0} 的 {v1} 条批注，并从原文里移除对应的锚点标签。': 'This deletes {v1} annotations from {v0} and removes the matching anchor tags from the source.',
	'将删除批注 {v0} 与它的区域截图。': 'This deletes annotation {v0} together with its region screenshot.',
	'将删除批注 {v0}，并从原文里移除这一对锚点标签（选区内文字不动）。': 'This deletes annotation {v0} and removes its pair of anchor tags from the source (the selected text itself stays untouched).',
	'左边框': 'Left border',
	'已完成': 'Done',
	'已批注一块区域，可直接在面板里提问': 'Area annotated; you can ask in the panel',
	'已批注：{v0}': 'Annotated: {v0}',
	'已结束，可继续提问': 'Finished, you can keep asking',
	'已选中一块区域（未取到文字）': 'Area selected (no text found)',
	'已选中：{v0}': 'Selected: {v0}',
	'带上下文': 'With context',
	'底色': 'Background',
	'开启后 PDF 框选、点批注框、点正文高亮，提问面板都直接开在页面上，不必打开侧边栏；': 'When on, dragging a region in a PDF, clicking an annotation box or clicking a highlight in the text opens the ask panel right on the page, with no need to open the sidebar;',
	'开启后 PDF 由 Pick Me 的 pdf.js 查看器打开，才能框选区域提问。核心查看器已占用 pdf 扩展名时，改为打开后自动切换到自带查看器（会闪一下内置查看器）。': 'When on, PDFs open in Pick Me\\\'s pdf.js viewer, which is what allows region selection. If the core viewer already claims the pdf extension, Pick Me opens the PDF and then switches to its own viewer (the built-in viewer flashes briefly).',
	'开启后先让模型推理再作答（质量更好、更慢）。思考内容有独立预算，不占用「最大输出长度」。': 'Lets the model reason before answering (better quality, slower). The reasoning gets its own budget and never eats into Max output length.',
	'当前没有打开 Markdown 或 PDF 文档。': 'No Markdown or PDF document is open.',
	'截图最大边长（像素）': 'Screenshot max side (pixels)',
	'打开': 'Open',
	'打开批注侧边栏': 'Open annotation sidebar',
	'打开设置': 'Open settings',
	'批注存放': 'Annotation storage',
	'批注文件读不出来：{v0}': 'Cannot read the annotation file: {v0}',
	'批注目录': 'Annotation folder',
	'批量替换锚点标签名': 'Replace anchor tag name in bulk',
	'把 {v0} 个批注文档里的锚点标签从 {v1} 换成 {v2}。这会改动原文，但只动标签、不动选区内文字。': 'Change the anchor tags in {v0} annotation documents from {v1} to {v2}. This edits the source files, but only the tags — never the selected text.',
	'拖动鼠标框出一块区域即可提问': 'Drag to select an area, then ask',
	'按住鼠标拖出一块区域即可批注': 'Hold and drag to select an area to annotate',
	'接口地址': 'API base URL',
	'提问在页面上完成：PDF 里框选或点批注框，正文里点高亮文字。这里只用来查看和跳转。': 'Questions are asked on the page: drag a region in a PDF or click an annotation box, or click highlighted text in a note. This pane is only for browsing and jumping.',
	'放大': 'Zoom in',
	'文本': 'Text',
	'显示批注高亮': 'Show annotation highlights',
	'显示高亮': 'Show highlights',
	'最大输出长度': 'Max output length',
	'有效': 'Valid',
	'未找到批注': 'Annotation not found',
	'未设置': 'Not set',
	'框选模式：拖动鼠标框出一块区域': 'Region mode: drag to select an area',
	'模型通道': 'Model',
	'模板': 'Templates',
	'模板目录': 'Template folder',
	'模板里没有指定 pickme_model、侧边栏也没有另选模型时使用。': 'Used when the template does not set pickme_model and no other model is chosen in the sidebar.',
	'模板：{v0}': 'Template: {v0}',
	'正在生成…': 'Generating…',
	'正在生成：{v0}': 'Generating: {v0}',
	'正在载入 PDF…': 'Loading PDF…',
	'正文选区': 'Text selection',
	'正文里写成一对尖括号标签，默认 pickme。改动标签名后，已有锚点需要重新插入才能识别。': 'Written in the note as a pair of angle-bracket tags, pickme by default. After you change the tag name, existing anchors must be re-inserted to be recognized.',
	'每行一个，或用逗号分隔。侧边栏的下拉会列出这些模型，留空则只能使用默认模型。': 'One per line, or separated by commas. The sidebar dropdown lists these models; leave empty to use only the default model.',
	'测试': 'Test',
	'添加批注后自动打开提问面板': 'Auto-open ask panel after annotating',
	'渲染失败：{v0}': 'Render failed: {v0}',
	'用户会给出选区，可能还有上下文片段。': 'The user provides a selection, sometimes with a context snippet.',
	'用自带查看器打开 PDF': 'Open PDFs with the bundled viewer',
	'界面语言': 'Interface language',
	'留空则用默认模型': 'Leave empty to use the default model',
	'目标批注：{id}': 'Target annotation: {id}',
	'目标批注：{id}（追问，带上已有 {rounds} 轮问答）': 'Target annotation: {id} (follow-up, carrying the {rounds} earlier rounds)',
	'目标：当前选区': 'Target: current selection',
	'直接提问': 'Ask directly',
	'确认': 'Confirm',
	'第 {v0} 次提问': 'Question {v0}',
	'缩小': 'Zoom out',
	'视觉标记样式': 'Highlight style',
	'视觉模型': 'Vision model',
	'设置面板与插件提示的语言。默认英文。': 'Language of this settings panel and of the plugin\\\'s messages. Defaults to English.',
	'请求超时（秒）': 'Request timeout (seconds)',
	'请说明这段内容。': 'Explain this passage.',
	'超时后中止请求，已生成的部分会保留在批注文件里。0 表示不限制。': 'The request is aborted on timeout; whatever was generated is kept in the annotation file. 0 means no limit.',
	'跳转': 'Go to',
	'跳转到锚点': 'Go to anchor',
	'载入失败：{v0}': 'Load failed: {v0}',
	'输入锚点 id 或选区片段': 'Enter an anchor id or a fragment of the selection',
	'输入问题，或选择上面的模板后直接发送': 'Type a question, or pick a template above and send it right away',
	'输入问题，或选模板后直接发送（⌘/Ctrl + Enter）': 'Type a question, or pick a template and send it right away (⌘/Ctrl + Enter)',
	'迁移': 'Migrate',
	'迁移批注目录': 'Migrate annotation folder',
	'还没有批注。选中文字后右键，或用命令「对选区提问或批注」。':
		'No annotations yet. Select some text and right-click, or run the "Ask or annotate the selection" command.',
	'这条批注已经不在了。': 'This annotation no longer exists.',
	'追问：会带上已有 {v0} 轮问答': 'Follow-up: carries the {v0} earlier rounds',
	'适应宽度': 'Fit width',
	'选区上限（字符）': 'Selection limit (characters)',
	'选区与上下文': 'Selection and context',
	'选区：\n{v0}': 'Selection:\n{v0}',
	'重新绑定': 'Rebind',
	'重新绑定失效锚点': 'Rebind broken anchors',
	'锚点与外观': 'Anchors and appearance',
	'锚点标签名': 'Anchor tag name',
	'锚点标签名已从 {previous} 改为 {next}。已有批注的锚点还是旧标签名，是否现在批量替换？': 'The anchor tag name changed from {previous} to {next}. Existing annotations still use the old name — replace them all now?',
	'问：{v0}': 'Q: {v0}',
	'阅读视图里批注范围怎么标出来。': 'How annotated ranges are marked in reading view.',
	'隐藏高亮': 'Hide highlights',
	'首次提问': 'First question',
	'默认关闭：只有真正加了批注才生成文件，避免文件浏览器噪音。': 'Off by default: a file is created only when an annotation is actually added, keeping the file explorer clean.',
	'默认放在插件目录下，Obsidian 不索引隐藏目录，批注不可搜索；改成库内目录后可用 Dataview 与双链。': 'By default annotations live in the plugin folder: Obsidian does not index hidden folders, so they are not searchable. Point this to a folder in the vault to use Dataview and backlinks.',
	'默认模型': 'Default model',
	'默认附带上下文': 'Include context by default',
	'默认（{v0}）': 'Default ({v0})',
	'（请求失败：{v0}）': '(request failed: {v0})',
	// PDF 工具栏与目录
	'共 {v0} 页': '{v0} pages',
	'点击恢复 100%': 'Click to reset to 100%',
	// 批注索引侧边栏
	'Pick Me：批注索引': 'Pick Me: annotation index',
	'批注索引': 'Annotation index',
	'{v0} 条批注 · {v1} 个文档': '{v0} annotations · {v1} documents',
	'过滤：文档名、选区或锚点 id': 'Filter by document, selection or anchor id',
	'刷新': 'Refresh',
	'没有匹配的批注。': 'No annotations match.',
	'还没有批注。选中正文或框选 PDF 之后，这里就有条目了。':
		'No annotations yet. Select text, or drag over a PDF, and entries show up here.',
	'打开源文档': 'Open the source document',
	'打开源文档并跳到这条批注': 'Open the source document and jump to this annotation',
	'第 {v0} 页区域': 'Page {v0} area',
	'{v0} 条': '{v0}',
	'{v0} 问': '{v0} asked',
	'失效（{v0}）': 'Stale ({v0})',
	'这些批注的锚点在原文里找不到了，点开查看': "These annotations' anchors can no longer be found in the source. Click to show.",
	'原文已改动，锚点找不到了': "The source text changed; the anchor can't be found",
	'用命令「重新绑定失效锚点」可以把它挂回原文': 'Use the command "Rebind stale anchors" to attach it again',
	'pickme：找不到源文档 {v0}': 'Pick Me: source document not found — {v0}',
	'全部批注（索引）': 'All annotations (index)',
	'打开批注索引': 'Open annotation index',
	// PDF 目录面板
	'目录': 'Contents',
	'隐藏目录': 'Hide contents',
	'第 {v0} 页': 'Page {v0}',
	// 模板设置
	'打开模板目录': 'Open templates folder',
	'恢复默认模板': 'Restore default templates',
	'恢复': 'Restore',
	'内置模板': 'Built-in',
	'删除模板': 'Delete template',
	'删除内置模板「{name}」？文件会被删掉，需要时可以用「恢复默认模板」找回来。':
		'Delete built-in template "{name}"? The file will be deleted; "Restore default templates" can bring it back.',
	'删除模板「{name}」？文件会被删掉。': 'Delete template "{name}"? The file will be deleted.',
	'模板目录里还没有模板，点上面的「恢复默认模板」生成内置的 3 个。':
		'No templates in the folder yet — use "Restore default templates" above to create the 3 built-ins.',
	'模板放在插件自己的目录里，不用改。目录里每个 .md 就是一个模板，文件名就是下拉里显示的名字。想自己加模板，点右边打开目录，或者用下面的「新建模板」。':
		'Templates live in the plugin folder and do not need to change. Each .md file is one template; the file name is what shows in the dropdown. To add your own, open the folder on the right or use "New template" below.',
	'把内置的 3 个模板（解释、摘要、翻译）重新写进模板目录，已经存在的不覆盖。删掉的、改坏了的，用这个找回来。':
		'Rewrite the 3 built-in templates (Explain, Summarize, Translate) into the templates folder; existing files are kept. Use this to recover deleted or broken ones.',
	'勾上就在提问面板的下拉里出现；取消勾选只是藏起来，文件不删。新建的模板排在最后。':
		'Checked templates appear in the ask panel dropdown; unchecking only hides them, files are kept. New templates are listed last.',
	'在模板目录里建一个新模板文件，建好的排在下面清单的最后。文件名就是模板名，正文写提示词，可用的变量都列在文件里。':
		'Create a new template file in the templates folder; it is listed last below. The file name is the template name, the body is the prompt, and the available variables are listed in the file.',
	// 迁移 / 索引
	'把批注文件从上一次的目录搬到上面设置的目录，保持镜像结构。逐文件「写新的、删旧的」，不会两处各留一份；搬完原目录会剩下空文件夹，可以自己删。':
		'Move annotation files from the previous folder to the folder set above, keeping the mirrored structure. Each file is written to the new place and removed from the old one, so it never exists in both; empty folders are left behind and can be deleted.',
	'pickme：没找到模板「{v0}」': 'pickme: template "{v0}" not found',
	'pickme：已删除模板「{v0}」': 'pickme: deleted template "{v0}"',
	'pickme：还没有模板目录': 'pickme: no templates folder yet',
	'pickme：模板目录在 {v0}': 'pickme: templates folder is {v0}',
	'pickme：批注目录已改成 {v0}，现有批注还在旧目录——需要搬的话点设置里的「迁移」':
		'pickme: annotation folder is now {v0}; existing annotations are still in the old folder — use "Migrate" in settings to move them',
	'pickme：已迁移 {v0} 个文件到 {v1}，旧目录还剩 {v2} 个':
		'pickme: moved {v0} file(s) to {v1}; {v2} left in the old folder',
	'pickme：已迁移 {v0} 个文件到 {v1}，旧目录已空（空文件夹留着，可以自己删）':
		'pickme: moved {v0} file(s) to {v1}; the old folder is now empty (empty folders are left in place, delete them if you like)',
};

let current: Language = 'en';

/** 跟随设置切换语言；未知值一律当英文（默认语言） */
export function setLanguage(language: Language | string | undefined): void {
	current = language === 'zh' ? 'zh' : 'en';
}

/**
 * 登记一个「稍后再翻译」的 key，返回 key 本身。
 * 图标按钮的标签要跟着语言变（渲染时按当前语言取），调用点上放的是待翻译的原中文，
 * 用这个函数包一层，i18n 的覆盖检查单测才认得出这些 key。
 */
export function tKey(zh: string): string {
	return zh;
}

export function currentLanguage(): Language {
	return current;
}

/** 取当前语言下的文案；vars 用 {name} 占位 */
export function t(zh: string, vars?: Record<string, string | number>): string {
	const template = current === 'zh' ? zh : EN[zh] ?? zh;
	if (!vars) return template;
	return template.replace(/\{(\w+)\}/g, (all, key) =>
		key in vars ? String(vars[key]) : all,
	);
}

/** 语言下拉里的两个选项，任何语言下都按各自母语显示 */
export const LANGUAGE_LABELS: Record<Language, string> = {
	en: 'English',
	zh: '中文',
};
