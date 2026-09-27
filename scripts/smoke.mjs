// 冒烟测试：用 obsidian 桩件真跑插件 onload 与批注仓库的完整流程
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Module, { createRequire } from 'node:module';
import { createObsidianStub } from './obsidian-stub.mjs';

const root = path.resolve(import.meta.dirname, '..');
const built = path.join(root, 'main.js');
if (!fs.existsSync(built)) {
	console.error('没有找到 main.js，请先运行 npm run build');
	process.exit(1);
}

const workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'pickme-smoke-'));
const cjsFile = path.join(workdir, 'main.cjs');
fs.copyFileSync(built, cjsFile);

const obsidian = createObsidianStub();
const bodyClasses = new Set();
globalThis.document = {
	body: {
		style: { setProperty() {} },
		addClass: (name) => bodyClasses.add(name),
		removeClass: (...names) => names.forEach((name) => bodyClasses.delete(name)),
	},
	createElement: () => ({
		style: {},
		classList: { add() {}, remove() {} },
		setAttribute() {},
		appendChild() {},
	}),
	createTreeWalker: () => ({ nextNode: () => null }),
};

// 页面内面板的最小 DOM 桩件：Obsidian 给 HTMLElement 挂的 createDiv/createEl 等方法
function makeEl(tag = 'div', opts = {}) {
	const el = {
		tag: String(tag).toLowerCase(),
		classes: [],
		attrs: {},
		text: '',
		style: {},
		children: [],
		parent: null,
		checked: false,
		value: '',
		onclick: null,
		onchange: null,
	};
	Object.defineProperty(el, 'className', {
		get: () => el.classes.join(' '),
		set: (value) => {
			el.classes = String(value)
				.split(/\s+/)
				.filter((item) => item !== '');
		},
	});
	el.addClass = (...names) => names.forEach((name) => el.classes.push(name));
	el.removeClass = (...names) => {
		el.classes = el.classes.filter((item) => !names.includes(item));
	};
	el.setAttribute = (key, value) => {
		el.attrs[key] = String(value);
	};
	el.getAttribute = (key) => (key in el.attrs ? el.attrs[key] : null);
	el.setCssProps = (props) => Object.assign(el.style, props);
	el.empty = () => {
		el.children = [];
		el.text = '';
	};
	el.setText = (value) => {
		el.text = String(value);
		el.children = [];
	};
	el.appendChild = (child) => {
		child.parent = el;
		el.children.push(child);
		return child;
	};
	el.createDiv = (o) => el.appendChild(makeEl('div', o));
	el.createSpan = (o) => el.appendChild(makeEl('span', o));
	el.createEl = (t, o) => el.appendChild(makeEl(t, o));
	// 只支持单个类名或标签名的选择器，够插件用了
	const matches = (node, selector) =>
		selector.startsWith('.') ? node.classes.includes(selector.slice(1)) : node.tag === selector.toLowerCase();
	const walk = (node, selector, out) => {
		for (const child of node.children) {
			if (matches(child, selector)) out.push(child);
			walk(child, selector, out);
		}
		return out;
	};
	el.querySelectorAll = (selector) => walk(el, selector, []);
	el.querySelector = (selector) => walk(el, selector, [])[0] ?? null;
	el.contains = (node) => {
		let cursor = node;
		while (cursor) {
			if (cursor === el) return true;
			cursor = cursor.parent ?? null;
		}
		return false;
	};
	el.remove = () => {
		if (el.parent) el.parent.children = el.parent.children.filter((child) => child !== el);
		el.parent = null;
	};
	el.getBoundingClientRect = () => ({
		left: 0,
		top: 0,
		right: 400,
		bottom: 300,
		width: 400,
		height: 300,
	});
	el.listeners = [];
	el.addEventListener = (type, fn) => {
		el.listeners.push({ type, fn });
	};
	el.removeEventListener = (type, fn) => {
		el.listeners = el.listeners.filter((item) => item.fn !== fn);
	};
	/** 把事件喂给这个元素上注册的监听器 */
	el.fire = (type, event) => {
		for (const item of el.listeners.filter((entry) => entry.type === type)) item.fn(event);
	};
	el.focus = () => {};
	if (opts.cls) el.className = opts.cls;
	if (opts.text !== undefined) el.text = String(opts.text);
	if (opts.value !== undefined) el.value = opts.value;
	if (opts.type) el.attrs.type = opts.type;
	if (opts.attr) Object.assign(el.attrs, opts.attr);
	return el;
}

function walk(el, visit) {
	visit(el);
	for (const child of el.children) walk(child, visit);
}

function findByClass(root, cls) {
	let hit = null;
	walk(root, (el) => {
		if (!hit && el.classes.includes(cls)) hit = el;
	});
	return hit;
}

function findAllByTag(root, tag) {
	const hits = [];
	walk(root, (el) => {
		if (el.tag === tag) hits.push(el);
	});
	return hits;
}

function collectText(root) {
	const parts = [];
	walk(root, (el) => {
		if (el.text) parts.push(el.text);
	});
	return parts.join(' ');
}

globalThis.window = {
	getComputedStyle: () => ({ position: 'static' }),
	listeners: [],
	addEventListener(type, fn, capture) {
		this.listeners.push({ type, fn, capture });
	},
	removeEventListener(type, fn) {
		this.listeners = this.listeners.filter((item) => item.fn !== fn);
	},
	/** 把事件喂给已注册的监听器，用于验证「哪些滚动该重算位置」 */
	fire(type, event) {
		for (const item of this.listeners.filter((entry) => entry.type === type)) item.fn(event);
	},
	setTimeout: (fn, ms) => setTimeout(fn, ms),
	devicePixelRatio: 1,
};

// CodeMirror 桩件：插件只用到 ViewPlugin/Decoration/RangeSetBuilder 这几个入口
const cmViewStub = {
	ViewPlugin: { fromClass: (cls, spec) => ({ cls, spec }) },
	Decoration: {
		mark: (spec) => ({ kind: 'mark', spec }),
		widget: (spec) => ({ kind: 'widget', spec }),
		none: [],
	},
	EditorView: class {},
	WidgetType: class {},
};
const cmStateStub = {
	RangeSetBuilder: class {
		add() {}
		finish() {
			return [];
		}
	},
	StateField: { define: (spec) => spec },
};
const genericStub = new Proxy(
	{},
	{ get: () => class {} },
);

const load = Module._load;
Module._load = function patched(request, ...rest) {
	if (request === 'obsidian') return obsidian;
	if (request === '@codemirror/view') return cmViewStub;
	if (request === '@codemirror/state') return cmStateStub;
	if (request.startsWith('@codemirror/') || request.startsWith('@lezer/')) return genericStub;
	if (request === 'electron') return {};
	return load.apply(this, [request, ...rest]);
};

const require = createRequire(import.meta.url);
const PickmePlugin = require(cjsFile).default;
assert.equal(typeof PickmePlugin, 'function', '默认导出应当是插件类');

const vault = new obsidian.Vault();
const app = { vault, workspace: obsidian.workspace, metadataCache: { getFileCache: () => null } };
const plugin = new PickmePlugin(app, { id: 'pickme', name: 'Pick me', version: '0.1.0' });

await plugin.onload();

// 1 插件表面
assert.ok(plugin.commands.length >= 13, `命令数量不足：${plugin.commands.length}`);
// 官方提交要求：命令 id 不要带插件 id（Obsidian 会自动加前缀）
for (const command of plugin.commands) {
	assert.ok(
		!String(command.id).startsWith(`${plugin.manifest.id}-`),
		`命令 id 不该带插件 id 前缀：${command.id}`,
	);
}
const commandNames = plugin.commands.map((command) => command.name);
// 命令名跟随界面语言，默认英文
for (const expected of ['Ask or annotate the selection', 'Annotate a region in the PDF', 'New prompt template', 'Replace anchor tag name in bulk', 'Go to anchor']) {
	assert.ok(commandNames.includes(expected), `缺少命令：${expected}（实际：${commandNames.join('｜')}）`);
}
assert.ok(bodyClasses.has('pickme-mark-background'), '启动时应当应用默认的标记样式');
assert.equal(plugin.ribbons.length, 1, '应当注册一个功能区图标');
assert.ok(plugin.views.has('pickme-sidebar'), '应当注册侧边栏视图');
assert.ok(plugin.views.has('pickme-pdf-view'), '应当注册 PDF 查看器');
assert.equal(plugin.extensionsMap.get('pdf'), 'pickme-pdf-view', '默认应由自带查看器接管 PDF');
assert.equal(plugin.settings.pdfViewerEnabled, true);
assert.equal(plugin.settings.pdfSaveScreenshot, true);
assert.equal(plugin.extensions.length, 1, '应当注册编辑器扩展');
assert.equal(plugin.postProcessors.length, 1, '应当注册阅读视图后处理器');
assert.equal(plugin.settingTabs.length, 1, '应当注册设置面板');
assert.equal(plugin.settings.annotationDir, '.obsidian/plugins/pickme/annotations');
console.log(`插件表面检查通过：${plugin.commands.length} 个命令、1 个视图、1 个设置面板`);

// 1.1 核心查看器已经占用 pdf 扩展名时，onload 不能抛错（Obsidian 真机上曾因此整个插件加载失败）
const occupiedApp = {
	vault: new obsidian.Vault(),
	workspace: obsidian.workspace,
	metadataCache: { getFileCache: () => null },
	viewRegistry: { isExtensionRegistered: (extension) => extension === 'pdf' },
};
const occupiedPlugin = new PickmePlugin(occupiedApp, {
	id: 'pickme',
	name: 'Pick me',
	version: '0.1.0',
});
await occupiedPlugin.onload();
assert.equal(
	occupiedPlugin.extensionsMap.has('pdf'),
	false,
	'pdf 已被占用时不应再注册扩展名（否则会抛 Attempting to register an existing file extension）',
);
assert.equal(occupiedPlugin.views.has('pickme-pdf-view'), true, '仍然要注册自带查看器视图');
console.log('pdf 扩展名被占用时仍能加载检查通过（退回接管方式，不再抛错）');

// 2 选区插锚点与批注写入
const ID = 'k7f3q2';
const TAG = `<pickme id="${ID}"></pickme>`;
const SELECTION = '本体驱动的全路网空间检索引擎';
const source = await vault.create(
	'10-项目/论文/测试文档.md',
	`前言。${TAG}${SELECTION}${TAG}是核心。后记。`,
);
assert.equal(plugin.settings.tagName, 'pickme');

const entry = {
	id: ID,
	kind: 'text',
	selection: SELECTION,
	fingerprint: 'abc12345',
	status: 'ok',
	created: '2026-09-24T20:00:00+08:00',
	qas: [
		{
			question: '这句话的核心贡献是什么？',
			template: '解释',
			answer: '结论：它是全路网检索引擎的核心机制。',
			created: '2026-09-24T20:01:00+08:00',
		},
	],
};
await plugin.repository.addEntry(source, entry);

const sidecarPath = '.obsidian/plugins/pickme/annotations/10-项目/论文/测试文档.md';
const sidecar = vault.files.get(sidecarPath);
assert.ok(sidecar, `批注文件没有落在 ${sidecarPath}`);
for (const expected of ['类型: pickme 批注', '源路径: 10-项目/论文/测试文档.md', '批注条数: 1', `## 锚点 ${ID}`, '状态：有效', '### 提问', '### 回答']) {
	assert.ok(sidecar.content.includes(expected), `批注文件缺少：${expected}`);
}
console.log('批注文件写入检查通过（目录镜像、中文 frontmatter、问答段落齐备）');

// 3 锚点状态同步：正常与损坏
await plugin.repository.syncStatuses(source);
assert.equal(vault.files.get(sidecarPath).content.includes('状态：有效'), true, '正常锚点应为有效');

await vault.modify(source, source.content.replace(TAG, ''));
const damaged = await plugin.repository.syncStatuses(source);
assert.equal(damaged.entries[0].status, 'stale', '删掉一个标签后该锚点应失效');
assert.ok(vault.files.get(sidecarPath).content.includes('状态：失效'), '批注文件应当记录失效');
console.log('锚点状态同步检查通过（删一个标签只坏这一条，其余不受影响）');

// 4 索引笔记
const indexResult = await plugin.repository.buildIndex(plugin.indexFilePath());
assert.equal(indexResult.rows, 1, `索引应当有 1 行，实际 ${indexResult.rows}`);
const index = vault.files.get(plugin.indexFilePath());
assert.ok(index.content.includes('[[测试文档]]'), '索引应回指源文档');
assert.ok(index.content.includes(`\`${ID}\``), '索引应列出锚点 id');
assert.ok(index.content.includes('失效'), '索引应显示失效状态');

// 索引侧边栏用的数据（不经过生成的 md，直接读批注文件，所以永远最新）
const indexGroups = await plugin.repository.indexData();
assert.equal(indexGroups.length, 1, `索引数据应当有 1 个源文档分组，实际 ${indexGroups.length}`);
assert.ok(indexGroups[0].sourceName, '分组应当带上源文档名');
assert.equal(indexGroups[0].entries.length, 1, '分组里应当有 1 条批注');
assert.ok(indexGroups[0].entries[0].id, '条目应当带锚点 id');
assert.equal(typeof plugin.openIndexView, 'function', '应当有打开索引侧边栏的入口');
assert.equal(typeof plugin.openEntryAt, 'function', '应当能从索引跳到某条批注');
console.log('索引笔记与索引数据检查通过');

// 5 删除批注：清理原文锚点与批注文件
const restored = await vault.create('10-项目/论文/测试文档.md.bak', '');
await vault.modify(source, `前言。${TAG}${SELECTION}${TAG}是核心。后记。`);
await plugin.repository.deleteEntry(source, ID);
assert.equal(source.content.includes(TAG), false, '删除后原文不应残留锚点标签');
assert.equal(source.content.includes(SELECTION), true, '删除后原文文字必须保留');
assert.equal(vault.files.has(sidecarPath), false, '最后一条批注删除后批注文件应被清理');
vault.files.delete(restored.path);
console.log('删除批注检查通过（锚点清理、原文文字保留、批注文件回收）');

// 5.5 PDF 批注：字段落盘、缩略图、索引行
const pdfSource = await vault.create('标准/公路路线设计规范.pdf', '%PDF-1.4 fake');
const pdfEntry = {
	id: 'm1p8x4',
	kind: 'pdf',
	selection: '',
	fingerprint: 'f0e1d2c3',
	status: 'ok',
	created: '2026-09-24T20:10:00+08:00',
	qas: [
		{
			question: '这里对最大纵坡的要求是什么？',
			template: '',
			answer: '截图显示要求不超过 3%。',
			created: '2026-09-24T20:11:00+08:00',
		},
	],
	pdf: {
		page: 12,
		pageSize: [595, 842],
		rect: [100, 200, 300, 260],
		normRect: [0.1681, 0.2375, 0.5042, 0.3088],
		hitText: '最大纵坡不应大于',
		image: '30-批注/_assets/公路路线设计规范.pdf.md/1.png',
	},
};
await plugin.repository.addEntry(pdfSource, pdfEntry);

const pdfSidecarPath = '.obsidian/plugins/pickme/annotations/标准/公路路线设计规范.pdf.md';
const pdfSidecar = vault.files.get(pdfSidecarPath);
assert.ok(pdfSidecar, `PDF 批注文件没有落在 ${pdfSidecarPath}`);
for (const expected of [
	'类型：PDF 区域',
	'页码：12',
	'页面尺寸：595x842',
	'矩形：100,200,300,260',
	'归一化矩形：0.1681,0.2375,0.5042,0.3088',
	'命中文本：最大纵坡不应大于',
	'![[30-批注/_assets/公路路线设计规范.pdf.md/1.png]]',
]) {
	assert.ok(pdfSidecar.content.includes(expected), `PDF 批注文件缺少：${expected}`);
}
const reloaded = await plugin.repository.loadFor(pdfSource);
assert.equal(reloaded.doc.entries[0].kind, 'pdf');
assert.deepEqual(reloaded.doc.entries[0].pdf?.rect, [100, 200, 300, 260]);
assert.equal(reloaded.doc.entries[0].pdf?.page, 12);
assert.equal(reloaded.doc.entries[0].pdf?.image, '30-批注/_assets/公路路线设计规范.pdf.md/1.png');
console.log('PDF 批注检查通过（页码、矩形、归一化矩形、命中文本、区域截图引用齐备）');

// 上一步已经把文本批注删掉了，此时索引里只剩这条 PDF 批注
const pdfIndex = await plugin.repository.buildIndex(plugin.indexFilePath());
assert.equal(pdfIndex.rows, 1, `索引应有 1 行（PDF 批注），实际 ${pdfIndex.rows}`);
const pdfIndexText = vault.files.get(plugin.indexFilePath()).content;
assert.ok(pdfIndexText.includes('第 12 页区域'), '索引应标明 PDF 页码');
assert.ok(
	pdfIndexText.includes('[[公路路线设计规范.pdf]]'),
	'索引应回指 PDF 源文件（保留 .pdf 后缀才是可点的双链）',
);
console.log('索引含 PDF 批注检查通过');

// 6 模板补齐
const templateNames = await plugin.templates.list();
assert.equal(templateNames.length, 3, `默认模板应有 3 个，实际 ${templateNames.length}`);
assert.ok(
	templateNames.includes('解释') && templateNames.includes('摘要') && templateNames.includes('翻译'),
	'默认模板名不全',
);
const created = await plugin.templates.ensureDefaults();
assert.equal(created, 0, '启用时已写入模板，重复补齐不应重复创建');
const again = await plugin.templates.ensureDefaults();
assert.equal(again, 0, '补齐命令同样不应覆盖已有模板');
console.log(`模板检查通过：${templateNames.length} 个默认模板（${templateNames.join('、')}），重复补齐幂等`);

// 7 模板读取与配置覆盖
const template = await plugin.templates.read('解释');
assert.ok(template.prompt.includes('{{选区}}'), '模板正文应当含选区变量');
assert.equal(template.config.context, true, '解释模板默认带上下文');
assert.equal(template.config.includeNote, false, '解释模板默认不送整篇笔记');
const translate = await plugin.templates.read('翻译');
assert.equal(translate.config.context, false, '翻译模板默认不带上下文');
const again2 = await plugin.templates.list();
assert.equal(again2.length, 3, '模板数量应当仍是 3');

// 8 设置持久化
plugin.settings.model = 'test-model';
await plugin.saveSettings();
assert.equal(plugin.data.model, 'test-model', '设置应当写入插件数据');

// ---------- 9 提问链路：历史问答、模型覆盖、最大输出、图片入参 ----------
await vault.create('30-批注/_assets/公路路线设计规范.pdf.md/1.png', 'fake-png-bytes');
app.workspace.getActiveFile = () => pdfSource;
// 假接口配置，只为让请求走到 fetch
plugin.settings.apiBaseUrl = 'https://api.example.invalid/v1';
plugin.settings.apiKey = 'smoke-test-key';
plugin.settings.model = 'smoke-model';

const requests = [];
const encoder = new TextEncoder();
function sseFrom(chunks) {
	let index = 0;
	return new ReadableStream({
		pull(controller) {
			if (index < chunks.length) {
				const payload = { choices: [{ delta: { content: chunks[index++] } }] };
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
				return;
			}
			controller.enqueue(encoder.encode('data: [DONE]\n\n'));
			controller.close();
		},
	});
}
globalThis.fetch = async (url, init) => {
	requests.push({ url, body: init.body });
	return new Response(sseFrom(['最大', '纵坡', '为 3%。']), { status: 200 });
};

const streamed = [];
const fakeSidebar = {
	async setFile() {},
	setActiveEntry() {},
	streamKey: (id, index) => `${id}#${index}`,
	beginStream() {},
	appendStream(text) {
		streamed.push(text);
	},
	endStream() {},
	currentStreamText: () => streamed[streamed.length - 1] ?? '',
	async reload() {},
};
plugin.openSidebar = async () => fakeSidebar;

await plugin.ask({
	question: '再解释一下这条要求',
	templateName: '解释',
	withContext: true,
	entryId: 'm1p8x4',
	modelOverride: 'vision-model-x',
});

assert.equal(
	requests.length,
	1,
	`应当发出一次请求，实际 ${requests.length}，提示：${obsidian.Notice.messages.join('｜')}`,
);
assert.ok(requests[0].url.endsWith('/chat/completions'), '应当请求 chat completions');
const firstBody = JSON.parse(requests[0].body);
assert.equal(firstBody.model, 'vision-model-x', '侧边栏选的模型应当覆盖默认模型');
assert.equal(
	firstBody.max_tokens,
	plugin.settings.maxOutputTokens + 8192,
	'最大输出长度是正文额度，深度思考的预算另加（默认开着）',
);
assert.equal(firstBody.stream, true, '应当走流式');
const historyJson = JSON.stringify(firstBody.messages);
assert.ok(historyJson.includes('这里对最大纵坡的要求是什么？'), '追问应当带上上一轮的提问');
assert.ok(historyJson.includes('截图显示要求不超过 3%。'), '追问应当带上上一轮的回答');
assert.ok(historyJson.includes('最大纵坡不应大于'), `模板变量 {{选区}} 应当填入命中文本；实际最后一条：${JSON.stringify(firstBody.messages[firstBody.messages.length - 1]).slice(0, 400)}`);
const lastUser = firstBody.messages[firstBody.messages.length - 1];
assert.ok(
	Array.isArray(lastUser.content) && lastUser.content.some((part) => part.type === 'image_url'),
	'PDF 批注提问应当带上区域截图',
);

const asked = await plugin.repository.loadFor(pdfSource);
assert.equal(asked.doc.entries[0].qas.length, 2, '应当追加一条问答');
const askedText = vault.files.get(pdfSidecarPath).content;
assert.ok(askedText.includes('### 追问 1'), '新问答应当写成追问段落');
assert.ok(askedText.includes('最大纵坡为 3%。'), '流式结果应当落盘');
console.log('提问链路检查通过（追问带历史、模型覆盖、最大输出、区域截图入参、落盘为追问段落）');

// ---------- 10 关闭图片输入后不再发送截图 ----------
plugin.settings.visionEnabled = false;
streamed.length = 0;
await plugin.ask({
	question: '只用文字再答一次',
	templateName: '',
	withContext: false,
	entryId: 'm1p8x4',
});
const secondBody = JSON.parse(requests[1].body);
const secondUser = secondBody.messages[secondBody.messages.length - 1];
assert.equal(
	typeof secondUser.content,
	'string',
	'关闭图片输入后用户消息应当是纯文本，不带 image_url 部件',
);
assert.ok(
	obsidian.Notice.messages.some((message) => message.includes('no region screenshot was sent')),
	'应当提示这次没有发送截图',
);
plugin.settings.visionEnabled = true;
console.log('图片开关检查通过（关闭后只送命中文本，并给出提示）');

// ---------- 11 超时中止：保留已完成的部分 ----------
plugin.settings.requestTimeoutSec = 0.05;
let aborted = false;
globalThis.fetch = async (url, init) => {
	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(
				encoder.encode(
					`data: ${JSON.stringify({ choices: [{ delta: { content: '半截回答' } }] })}\n\n`,
				),
			);
			init.signal.addEventListener('abort', () => {
				aborted = true;
				try {
					controller.error(new Error('aborted'));
				} catch {
					// 已经关闭就不用再报错
				}
			});
		},
	});
	return new Response(stream, { status: 200 });
};
streamed.length = 0;
await plugin.ask({
	question: '超时测试',
	templateName: '',
	withContext: false,
	entryId: 'm1p8x4',
});
assert.ok(aborted, '超过设定时长应当真的中止请求');
const afterTimeout = await plugin.repository.loadFor(pdfSource);
const lastQa = afterTimeout.doc.entries[0].qas.at(-1);
assert.ok(lastQa.answer.includes('半截回答'), '中止后应当保留已经生成的部分');
// 这句是 core/qa.ts 里写进批注文件的内容（属于笔记正文，不随界面语言变）
assert.ok(lastQa.answer.includes('已中止，以上为已完成部分'), '应当标注这是中断的结果');
assert.ok(!lastQa.answer.includes('(request failed'), '中止不该被当成失败丢掉内容');
plugin.settings.requestTimeoutSec = 120;
console.log('超时中止检查通过（保留已完成部分并标注中断）');

// ---------- 12 冷启动：库索引未就绪、目录已存在时，onload 仍须活下来 ----------
// 真机现象：插件比库索引先就绪，那一刻 getAbstractFileByPath 对已存在的目录也返回 null，
// 旧实现据此调 createFolder 抛 `Error: Folder already exists.`，整个插件加载失败。
{
	const coldVault = new obsidian.Vault();
	coldVault.indexStale = true;
	// 目录早已存在（上一轮session 建过），但索引此刻看不见
	coldVault.folders.add('.obsidian/plugins/pickme/annotations');
	coldVault.folders.add('.obsidian/plugins/pickme/templates');
	const coldApp = {
		vault: coldVault,
		workspace: obsidian.workspace,
		metadataCache: { getFileCache: () => null },
	};
	const coldPlugin = new PickmePlugin(coldApp, { id: 'pickme', name: 'Pick me', version: '0.1.0' });
	let failed = null;
	try {
		await coldPlugin.onload();
	} catch (error) {
		failed = error;
	}
	assert.equal(failed, null, `冷启动时 onload 不该抛错，实际：${failed && failed.message}`);
	assert.ok(coldVault.files.size >= 3, `冷启动应当把 3 个默认模板写进库，实际 ${coldVault.files.size} 个文件`);
	assert.equal(coldPlugin.settings.tagName, 'pickme', '冷启动后设置应当可用');

	// 再跑一次（目录与文件都在、索引依旧不可见）必须幂等且不抛错
	let failed2 = null;
	try {
		await coldPlugin.onload();
	} catch (error) {
		failed2 = error;
	}
	assert.equal(failed2, null, `重复启动不该抛错，实际：${failed2 && failed2.message}`);
	console.log('冷启动检查通过（索引未就绪 + 目录已存在时不抛错，模板补齐幂等）');
}

// ---------- 13 页面内提问：结果回填到面板，不再打开侧边栏 ----------
globalThis.fetch = async (url, init) => {
	requests.push({ url, body: init.body });
	return new Response(sseFrom(['面板', '里', '的回答']), { status: 200 });
};
const panelStreamed = [];
const fakePanel = {
	setActiveEntry() {},
	streamKey: (id, index) => `${id}#${index}`,
	beginStream() {},
	appendStream(text) {
		panelStreamed.push(text);
	},
	endStream() {},
	currentStreamText: () => panelStreamed[panelStreamed.length - 1] ?? '',
	async reload() {},
};
streamed.length = 0;
await plugin.ask(
	{ question: '在页面里问一次', templateName: '', withContext: false, entryId: 'm1p8x4' },
	fakePanel,
);
assert.ok(panelStreamed.length > 0, '指定面板作为 sink 时结果应当回填到面板');
assert.equal(streamed.length, 0, '指定了面板就不该再往侧边栏回填');
const panelQa = (await plugin.repository.loadFor(pdfSource)).doc.entries[0].qas.at(-1);
assert.ok(panelQa.answer.includes('面板里的回答'), '页面内这次问答应当落盘');
console.log('页面内提问检查通过（指定 sink 时结果只回填面板，侧边栏不参与）');

// ---------- 14 请求通道：fetch 被跨域拦下时自动改用 requestUrl ----------
// 真机现象：中转站的非流式响应回一个空的 access-control-allow-origin（同时带
// allow-credentials），Chromium 判为 InvalidAllowOriginValue 直接掐断请求，
// fetch 抛 TypeError: Failed to fetch，而同一接口的流式响应回 * 却能通过。
globalThis.fetch = async () => {
	throw new TypeError('Failed to fetch');
};
obsidian.requestUrlCalls.length = 0;
const fallbackAnswer = '走 Obsidian 通道拿到的回答';
obsidian.setRequestUrlHandler(async () => ({
	status: 200,
	headers: {},
	text: JSON.stringify({ choices: [{ message: { content: fallbackAnswer } }] }),
	json: { choices: [{ message: { content: fallbackAnswer } }] },
	arrayBuffer: new ArrayBuffer(0),
}));
await plugin.ask({ question: '跨域测试', templateName: '', withContext: false, entryId: 'm1p8x4' });
assert.equal(
	obsidian.requestUrlCalls.length,
	1,
	`fetch 被拦后应当改用 requestUrl 重发一次，实际 ${obsidian.requestUrlCalls.length}`,
);
assert.equal(
	obsidian.requestUrlCalls[0].url,
	'https://api.example.invalid/v1/chat/completions',
	'回退时应当打到同一个接口地址',
);
const fallbackQa = (await plugin.repository.loadFor(pdfSource)).doc.entries[0].qas.at(-1);
assert.ok(fallbackQa.answer.includes(fallbackAnswer), '回退通道拿到的回答应当落盘');
assert.ok(!fallbackQa.answer.includes('request failed'), '回退成功就不该落成失败');
console.log('请求通道回退检查通过（fetch 被跨域拦下时自动改用 requestUrl）');

// 显式选 Obsidian 通道时完全不碰 fetch
let fetchCalled = false;
globalThis.fetch = async () => {
	fetchCalled = true;
	throw new TypeError('Failed to fetch');
};
plugin.settings.transport = 'requestUrl';
obsidian.requestUrlCalls.length = 0;
await plugin.ask({ question: '强制通道', templateName: '', withContext: false, entryId: 'm1p8x4' });
assert.equal(fetchCalled, false, '选了 Obsidian 通道就不该再走浏览器 fetch');
assert.equal(obsidian.requestUrlCalls.length, 1, '应当只发一次 requestUrl');
console.log('强制通道检查通过（Obsidian 通道下完全不碰 fetch）');

// 设置页的「测试连接」走同一条链路，不再报 Failed to fetch
plugin.settings.transport = 'auto';
obsidian.requestUrlCalls.length = 0;
await plugin.testConnection();
assert.equal(obsidian.requestUrlCalls.length, 1, '测试连接应当回退到 requestUrl');
assert.ok(
	obsidian.Notice.messages.some((message) => message.includes('connection OK')),
	`测试连接应当报成功，实际提示：${obsidian.Notice.messages.slice(-3).join('｜')}`,
);
console.log('测试连接检查通过（fetch 被拦时自动回退，不再报 Failed to fetch）');

// ---------- 15 页面内面板：真的画出来，同宿主只留一个，能关掉 ----------
// 真机上曾因为 open() 里一道多余的空守卫，layer 建了但面板本体从不渲染。
{
	const host = makeEl('div');
	const fakeView = { containerEl: host, editor: null, file: pdfSource };
	let sidebarOpened = 0;
	const origOpenSidebar = plugin.openSidebar;
	plugin.openSidebar = async () => {
		sidebarOpened += 1;
		return fakeSidebar;
	};

	const opened = plugin.openEntryPanel('m1p8x4', pdfSource, fakeView);
	assert.equal(opened, true, '有可用的 Markdown 视图时应当能开在页面内');

	let panel = null;
	for (let i = 0; i < 40 && !panel; i += 1) {
		await new Promise((r) => setTimeout(r, 25));
		panel = findByClass(host, 'pickme-panel');
	}
	assert.ok(findByClass(host, 'pickme-inline-layer'), '应当在宿主里建出 pickme-inline-layer');
	assert.ok(panel, '面板本体必须真的渲染出来（曾经因为 open() 里的空守卫整个不渲染）');
	assert.ok(collectText(panel).includes('m1p8x4'), '面板头应当显示这条批注的 id');
	assert.ok(findByClass(panel, 'pickme-question'), '面板里应当有提问输入框');
	assert.ok(findAllByTag(panel, 'select').length >= 2, '面板里应当有模板与模型两个下拉');
	const buttonTexts = findAllByTag(panel, 'button').map((b) => b.text);
	// 界面语言默认英文，所以这里断言的是英文文案
	assert.ok(
		buttonTexts.includes('Send') && buttonTexts.includes('Stop'),
		`面板里应当有发送与停止按钮，实际 ${buttonTexts.join('｜')}`,
	);
	assert.ok(collectText(panel).includes('PDF page'), '默认英文下 PDF 页码文案应当是英文');
	const boxes = findAllByTag(panel, 'label').filter((el) => el.classes.includes('pickme-checkbox'));
	assert.equal(boxes.length, 2, `面板里应当有「带上下文」与「深度思考」两个开关，实际 ${boxes.length}`);
	assert.ok(collectText(boxes[1]).includes('Deep thinking'), '深度思考开关应当带文案');
	assert.equal(sidebarOpened, 0, '在页面内提问时不该打开侧边栏');

	// 同一宿主再开一次：旧的关掉，只留一个
	plugin.openEntryPanel('m1p8x4', pdfSource, fakeView);
	await new Promise((r) => setTimeout(r, 200));
	const layers = host.children.filter((child) => child.classes.includes('pickme-inline-layer'));
	assert.equal(layers.length, 1, `同一宿主只应有一个 layer，实际 ${layers.length}`);
	assert.equal(
		findAllByTag(host, 'div').filter((el) => el.classes.includes('pickme-panel')).length,
		1,
		'同一宿主只应有一个面板',
	);

	// 关闭按钮真的能把面板摘掉（要用当前那个面板的按钮，旧面板已被替换掉）
	const livePanel = findByClass(host, 'pickme-panel');
	assert.ok(livePanel, '替换后应当仍有一个面板');
	const closeButton = findAllByTag(livePanel, 'button').find((b) => b.text === '×');
	assert.ok(closeButton, '面板应当有关闭按钮');
	closeButton.onclick();
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(findByClass(host, 'pickme-panel'), null, '点关闭后面板应当从 DOM 里摘掉');
	assert.equal(findByClass(host, 'pickme-inline-layer'), null, '点关闭后 layer 也应当清掉');

	plugin.openSidebar = origOpenSidebar;
	console.log('页面内面板检查通过（真的渲染、含输入框与两个下拉、同宿主只留一个、可关闭）');
}

// ---------- 16 面板位置：贴着被点的标记，不靠光标猜 ----------
// 阅读模式下没有 CodeMirror 视图，取光标位置会失手，真机上会掉到视图左上角。
{
	const host = makeEl('div');
	host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
	const markEl = makeEl('span');
	markEl.getBoundingClientRect = () => ({ left: 300, top: 200, right: 380, bottom: 220, width: 80, height: 20 });

	plugin.openEntryPanel('m1p8x4', pdfSource, { containerEl: host }, markEl);
	let panel = null;
	for (let i = 0; i < 40 && !panel; i += 1) {
		await new Promise((r) => setTimeout(r, 25));
		panel = findByClass(host, 'pickme-panel');
	}
	assert.ok(panel, '带元素锚点时面板也应当渲染出来');
	assert.equal(panel.style.left, '392px', '面板应当贴在标记右侧（380 + 12）');
	assert.equal(panel.style.top, '220px', '面板顶边应当对齐标记底边');

	// 标记量不出尺寸时（后台标签页）当作没锚点，退到左上角，而不是画到 0 宽的边上
	const hidden = makeEl('span');
	hidden.getBoundingClientRect = () => ({ left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 });
	plugin.openEntryPanel('m1p8x4', pdfSource, { containerEl: host, editor: null }, hidden);
	await new Promise((r) => setTimeout(r, 200));
	const fallback = findByClass(host, 'pickme-panel');
	assert.equal(fallback.style.left, '12px', '量不到尺寸时应当退到左上角');

	// 点击标记必须把元素带下去，否则上面那套位置根本用不上
	let forwarded = null;
	const origOpenEntryPanel = plugin.openEntryPanel.bind(plugin);
	plugin.openEntryPanel = (...args) => {
		forwarded = args;
		return origOpenEntryPanel(...args);
	};
	const prevInlineAsk = plugin.settings.inlineAsk;
	plugin.settings.inlineAsk = true;
	const originalActiveFile = plugin.activeFile.bind(plugin);
	plugin.activeFile = () => pdfSource;
	const pending = plugin.activateEntry('m1p8x4', markEl);
	assert.equal(forwarded && forwarded[3], markEl, 'activateEntry 应当把被点击的标记元素传给 openEntryPanel');
	await pending.catch(() => {});
	plugin.openEntryPanel = origOpenEntryPanel;
	plugin.activeFile = originalActiveFile;
	plugin.settings.inlineAsk = prevInlineAsk;

	console.log('面板定位检查通过（贴住标记、量不到就退左上角、点击会把元素带下去）');
}

// ---------- 17 推理型模型：正文为空、只有思考内容 ----------
// 真机现象：deepseek 的 v4.x 把思考放在 delta.reasoning_content 里，思考同样计入 max_tokens。
// 思考吃满上限时 delta.content 全程是空串，旧实现只写「（模型没有返回内容）」，看不出真实原因。
{
	globalThis.fetch = async () => {
		const chunks = [
			{ choices: [{ delta: { role: 'assistant', content: '' } }] },
			{ choices: [{ delta: { content: '', reasoning_content: '先看选区，' } }] },
			{ choices: [{ delta: { content: '', reasoning_content: '再决定怎么说……' } }] },
			{ choices: [{ delta: { content: '' }, finish_reason: 'length' }] },
		];
		const stream = new ReadableStream({
			pull(controller) {
				const payload = chunks.shift();
				if (!payload) {
					controller.enqueue(encoder.encode('data: [DONE]\n\n'));
					controller.close();
					return;
				}
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
			},
		});
		return new Response(stream, { status: 200 });
	};
	plugin.settings.transport = 'fetch';
	await plugin.ask({ question: '这条选区说了什么？', templateName: '', withContext: false, entryId: 'm1p8x4' });
	const reasoningQa = (await plugin.repository.loadFor(pdfSource)).doc.entries[0].qas.at(-1);
	assert.ok(reasoningQa, '这次问答应当落盘');
	assert.ok(
		!reasoningQa.answer.includes('模型没有返回内容'),
		'正文为空但拿到了思考内容时，不能只报「没有返回内容」',
	);
	assert.ok(reasoningQa.answer.includes('思考过程'), '应当说明只拿到了思考过程');
	assert.ok(reasoningQa.answer.includes('最大输出长度'), '应当给出调大上限的指引');
	assert.ok(reasoningQa.answer.includes('先看选区'), '思考内容本身要留下来');
	plugin.settings.transport = 'auto';
	console.log('推理型模型检查通过（正文为空时接住思考内容并说明原因）');
}

// ---------- 18 框内滚动不该把面板挪走 ----------
// 真机现象：面板自己就是滚动容器（overflow: auto），在它里面滚动会走捕获阶段
// 命中挂在 window 上的 scroll 监听，于是重算位置——锚点稍微一动就左右翻边。
{
	const host = makeEl('div');
	host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
	// 锚点靠右：面板只能落在左侧
	const markEl = makeEl('span');
	markEl.getBoundingClientRect = () => ({ left: 500, top: 200, right: 600, bottom: 220, width: 100, height: 20 });

	plugin.openEntryPanel('m1p8x4', pdfSource, { containerEl: host }, markEl);
	let panel = null;
	for (let i = 0; i < 40 && !panel; i += 1) {
		await new Promise((r) => setTimeout(r, 25));
		panel = findByClass(host, 'pickme-panel');
	}
	assert.ok(panel, '面板应当渲染出来');
	assert.equal(panel.style.left, '108px', '右侧放不下时应当落在锚点左侧（500 - 380 - 12）');

	// 打哨兵：框内滚动若触发重算，哨兵就会被覆盖
	panel.style.left = '123px';
	panel.style.top = '234px';
	window.fire('scroll', { target: panel });
	assert.equal(panel.style.left, '123px', '在面板内部滚动不该重算位置');
	assert.equal(panel.style.top, '234px', '在面板内部滚动不该重算位置');

	// 面板里的输入框等子元素上滚动，同样不该重算
	window.fire('scroll', { target: findByClass(panel, 'pickme-question') ?? panel });
	assert.equal(panel.style.left, '123px', '面板子元素上的滚动也不该重算位置');

	// 对照：别处滚动（比如正文滚动容器）仍然要重算
	window.fire('scroll', { target: makeEl('div') });
	assert.notEqual(panel.style.left, '123px', '面板之外的滚动仍然要重新定位');

	// 定过的边不再来回翻：锚点小幅右移，右侧仍放不下 → 继续留在左侧
	markEl.getBoundingClientRect = () => ({ left: 520, top: 200, right: 620, bottom: 220, width: 100, height: 20 });
	window.fire('scroll', { target: makeEl('div') });
	assert.equal(panel.style.left, '128px', '锚点小幅移动应当只是平移，不换边（520 - 380 - 12）');

	// 滚轮到面板头上就喂给面板；面板滚不动了要掐掉，别穿透到底下的文档
	// （穿透会让文档滚动、锚点位移，面板跟着跑，用户看到的就是「在框里滚动，框自己动了」）
	const layer = findByClass(host, 'pickme-inline-layer');
	assert.ok(layer, '应当有浮层容器');
	panel.scrollHeight = 1000;
	panel.clientHeight = 400;
	const wheelPrevented = (deltaY) => {
		let prevented = false;
		layer.fire('wheel', { deltaY, preventDefault: () => { prevented = true; } });
		return prevented;
	};
	panel.scrollTop = 200;
	assert.equal(wheelPrevented(100), false, '面板还能往下滚时不该拦滚轮');
	assert.equal(wheelPrevented(-100), false, '面板还能往上滚时不该拦滚轮');
	panel.scrollTop = 600;
	assert.equal(wheelPrevented(100), true, '面板滚到底了就不该让滚轮穿透到文档');
	panel.scrollTop = 0;
	assert.equal(wheelPrevented(-100), true, '面板滚到顶了也不该让滚轮穿透到文档');
	panel.scrollHeight = 300;
	panel.clientHeight = 400;
	assert.equal(wheelPrevented(100), true, '内容不足一屏时滚轮同样不该穿透到文档');

	// 插件重载会留下没人清理的旧浮层，开新面板时要顺手扫掉
	const staleHost = makeEl('div');
	staleHost.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
	const staleLayer = staleHost.createDiv({ cls: 'pickme-inline-layer' });
	staleLayer.createDiv({ cls: 'pickme-panel' });
	plugin.openEntryPanel('m1p8x4', pdfSource, { containerEl: staleHost }, markEl);
	await new Promise((r) => setTimeout(r, 250));
	assert.equal(
		staleHost.querySelectorAll('.pickme-inline-layer').length,
		1,
		'开新面板时应当扫掉宿主里遗留的旧浮层',
	);
	assert.equal(staleHost.querySelectorAll('.pickme-panel').length, 1, '宿主里只该剩一个面板');

	console.log('框内滚动检查通过（内部滚动不重算位置、面板之外照旧重算、滚轮不穿透、旧浮层会扫掉）');
}

// ---------- 19 深度思考：思考走独立预算，不占正文额度 ----------
// 实测服务端把思考也算进 max_tokens（max_tokens=16 时 reasoning_tokens=16、正文 0 字），
// 且要求 max_tokens >= thinking.budget_tokens。所以「最大输出长度只管正文」要错位换算：
// 请求发 max_tokens = 正文额度 + 思考预算，正文才拿得到完整的 maxOutputTokens。
{
	const askedBody = () => JSON.parse(obsidian.requestUrlCalls.at(-1).body);
	plugin.settings.transport = 'requestUrl';
	plugin.settings.maxOutputTokens = 4096;

	obsidian.requestUrlCalls.length = 0;
	plugin.settings.deepThinking = true;
	await plugin.ask({ question: '深度思考开', templateName: '', withContext: false, entryId: 'm1p8x4' });
	const on = askedBody();
	assert.deepEqual(
		on.thinking,
		{ type: 'enabled', budget_tokens: 8192 },
		`开启深度思考时应当单独给思考预算，实际 ${JSON.stringify(on.thinking)}`,
	);
	assert.equal(on.max_tokens, 4096 + 8192, '正文额度要完整保留，思考用另一份预算');

	obsidian.requestUrlCalls.length = 0;
	plugin.settings.deepThinking = false;
	await plugin.ask({ question: '深度思考关', templateName: '', withContext: false, entryId: 'm1p8x4' });
	const off = askedBody();
	assert.deepEqual(off.thinking, { type: 'disabled' }, '关闭时应当显式告诉服务端别思考');
	assert.equal(off.max_tokens, 4096, '关掉思考后，最大输出长度就只管正文本身');

	// 单次提问可以覆盖设置（面板上的勾选框走的就是这条）
	obsidian.requestUrlCalls.length = 0;
	await plugin.ask({
		question: '这一次要深想',
		templateName: '',
		withContext: false,
		entryId: 'm1p8x4',
		deepThinking: true,
	});
	assert.equal(askedBody().thinking.type, 'enabled', '单次提问的勾选应当盖过设置里的默认值');

	// 通用 OpenAI 兼容接口不认 thinking 字段（官方接口会对未知参数报 400）：
	// 去掉这个字段重发一次，别让一个开关把请求打死
	let attempt = 0;
	obsidian.requestUrlCalls.length = 0;
	obsidian.setRequestUrlHandler(async () => {
		attempt += 1;
		if (attempt === 1) {
			const body = JSON.stringify({ error: { message: 'Unrecognized request argument supplied: thinking' } });
			return { status: 400, headers: {}, text: body, json: JSON.parse(body), arrayBuffer: new ArrayBuffer(0) };
		}
		const ok = JSON.stringify({ choices: [{ message: { content: '去掉 thinking 也拿到了回答' } }] });
		return { status: 200, headers: {}, text: ok, json: JSON.parse(ok), arrayBuffer: new ArrayBuffer(0) };
	});
	plugin.settings.deepThinking = true;
	await plugin.ask({ question: '不认 thinking 的接口', templateName: '', withContext: false, entryId: 'm1p8x4' });
	assert.equal(attempt, 2, `接口报 400 后应当去掉 thinking 重发一次，实际发了 ${attempt} 次`);
	assert.ok(!('thinking' in askedBody()), '重发时不该再带 thinking 字段');
	const recovered = (await plugin.repository.loadFor(pdfSource)).doc.entries[0].qas.at(-1);
	assert.ok(recovered.answer.includes('去掉 thinking 也拿到了回答'), '兜底重发拿到的回答应当落盘');

	console.log('深度思考检查通过（思考独立预算、关闭时只管正文、单次可覆盖、接口不认时自动去掉重发）');
}

// ---------- 20 正文选区入口、取消即撤销、勾选记住 ----------
{
	// 正文里选中文字后右键：给「提问」与「添加批注」两项
	const items = [];
	const menu = {
		addItem(build) {
			const item = {
				title: '',
				setTitle(value) {
					this.title = value;
					return this;
				},
				setIcon() {
					return this;
				},
				onClick(fn) {
					this.click = fn;
					return this;
				},
			};
			build(item);
			items.push(item);
		},
	};
	const mdView = Object.assign(new obsidian.MarkdownView(), { file: source, editor: null });
	app.workspace.trigger('editor-menu', menu, { getSelection: () => SELECTION }, mdView);
	// 事件注册表是全局共用的，前面几组各建过插件实例、都会往菜单里加同样的项，
	// 所以这里看去重后的标题
	const titles = [...new Set(items.map((item) => item.title))];
	assert.equal(titles.length, 1, `选中文字后右键只该给一个入口（面板只有一个），实际 ${titles.join('｜')}`);
	assert.ok(titles[0] === 'Pick Me: Ask or annotate', `菜单项文案不对：${titles.join('｜')}`);

	items.length = 0;
	app.workspace.trigger('editor-menu', menu, { getSelection: () => '' }, mdView);
	assert.equal(items.length, 0, '没有选中文字时不该出现 Pick Me 菜单项');

	// 取消即撤销：刚建出来、一个问题都没问的批注，关掉面板就该消失
	const freshId = 'cncl01';
	await plugin.repository.addEntry(source, {
		id: freshId,
		kind: 'text',
		selection: SELECTION,
		fingerprint: 'ff00aa11',
		status: 'ok',
		created: '2026-09-26T01:00:00+08:00',
		qas: [],
	});
	const host = makeEl('div');
	const fakeView = { containerEl: host, editor: null, file: source };
	assert.equal(plugin.openEntryPanel(freshId, source, fakeView, null, true), true, '应当能在页面内开面板');
	let freshPanel = null;
	for (let i = 0; i < 40 && !freshPanel; i += 1) {
		await new Promise((r) => setTimeout(r, 25));
		freshPanel = findByClass(host, 'pickme-panel');
	}
	assert.ok(freshPanel, '面板应当渲染出来');
	const closeFresh = findAllByTag(freshPanel, 'button').find((b) => b.text === '×');
	assert.ok(closeFresh, '面板应当有关闭按钮');
	closeFresh.onclick();
	await new Promise((r) => setTimeout(r, 250));
	const afterCancel = (await plugin.repository.loadFor(source)).doc;
	assert.equal(
		afterCancel.entries.some((e) => e.id === freshId),
		false,
		'取消后面板对应的批注应当被撤销，页面上的高亮才收得掉',
	);
	assert.ok(
		obsidian.Notice.messages.every((message) => !message.includes(freshId)),
		'撤销是「取消」而不是「删除」，不该弹删除提示',
	);

	// 已经问过的批注：关掉面板要留着
	const askedId = 'ask001';
	await plugin.repository.addEntry(source, {
		id: askedId,
		kind: 'text',
		selection: SELECTION,
		fingerprint: 'ff00aa22',
		status: 'ok',
		created: '2026-09-26T01:05:00+08:00',
		qas: [{ question: '这句什么意思？', template: '', answer: '意思是……', created: '2026-09-26T01:06:00+08:00' }],
	});
	const host2 = makeEl('div');
	plugin.openEntryPanel(askedId, source, { containerEl: host2, editor: null, file: source }, null, true);
	let askedPanel = null;
	for (let i = 0; i < 40 && !askedPanel; i += 1) {
		await new Promise((r) => setTimeout(r, 25));
		askedPanel = findByClass(host2, 'pickme-panel');
	}
	findAllByTag(askedPanel, 'button').find((b) => b.text === '×').onclick();
	await new Promise((r) => setTimeout(r, 250));
	assert.equal(
		(await plugin.repository.loadFor(source)).doc.entries.some((e) => e.id === askedId),
		true,
		'问过的批注关掉面板要留着',
	);

	// 勾选即记住：面板上的「带上下文 / 深度思考」改动写回设置
	const host3 = makeEl('div');
	plugin.openEntryPanel(askedId, source, { containerEl: host3, editor: null, file: source }, null, false);
	let panel3 = null;
	for (let i = 0; i < 40 && !panel3; i += 1) {
		await new Promise((r) => setTimeout(r, 25));
		panel3 = findByClass(host3, 'pickme-panel');
	}
	const boxes = findAllByTag(panel3, 'label')
		.filter((el) => el.classes.includes('pickme-checkbox'))
		.map((label) => findAllByTag(label, 'input')[0]);
	assert.equal(boxes.length, 2, `面板里应当有两个勾选框，实际 ${boxes.length}`);
	plugin.settings.includeContextByDefault = true;
	boxes[0].checked = false;
	boxes[0].fire('change');
	plugin.settings.deepThinking = true;
	boxes[1].checked = false;
	boxes[1].fire('change');
	await new Promise((r) => setTimeout(r, 50));
	assert.equal(plugin.settings.includeContextByDefault, false, '取消「带上下文」应当记进设置');
	assert.equal(plugin.settings.deepThinking, false, '取消「深度思考」应当记进设置');
	const savedData = JSON.parse(plugin.data && typeof plugin.data === 'object' ? JSON.stringify(plugin.data) : '{}');
	assert.equal(savedData.includeContextByDefault, false, '设置应当落盘，下次打开还是这个选择');
	plugin.settings.includeContextByDefault = true;
	plugin.settings.deepThinking = true;
	await plugin.saveSettings();
	findAllByTag(panel3, 'button').find((b) => b.text === '×').onclick();
	await new Promise((r) => setTimeout(r, 200));

	console.log('正文选区入口检查通过（右键菜单给一个入口、没选中不给、取消即撤销、问过则保留、勾选写回设置）');
}

// ---------- 21 面板重画不丢位置、删除按钮看时机 ----------
// 真机现象：框选后框先贴在选区右下，「发送」拿到回答后面板跳到左上角。
// 根因是 render() 每次都重建 DOM，而重建时既不写回上次落点、也不重算位置，
// 新元素就落回层的原点。回答落盘会触发一次 reload → render，所以症状出现在发送之后。
{
	globalThis.fetch = async () => new Response(sseFrom(['重画之后的回答']), { status: 200 });
	const posId = 'post01';
	await plugin.repository.addEntry(source, {
		id: posId,
		kind: 'text',
		selection: SELECTION,
		fingerprint: 'ab00cd11',
		status: 'ok',
		created: '2026-09-26T11:00:00+08:00',
		qas: [],
	});
	const host = makeEl('div');
	host.getBoundingClientRect = () => ({ left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600 });
	const markEl = makeEl('span');
	markEl.getBoundingClientRect = () => ({ left: 300, top: 200, right: 380, bottom: 220, width: 80, height: 20 });
	const buttonTexts = (panel) => findAllByTag(panel, 'button').map((b) => b.text);

	plugin.settings.inlineAsk = true;
	assert.equal(
		plugin.openEntryPanel(posId, source, { containerEl: host, editor: null, file: source }, markEl, true),
		true,
		'应当能在页面内开面板',
	);
	let panel = null;
	for (let i = 0; i < 40 && !panel; i += 1) {
		await new Promise((r) => setTimeout(r, 25));
		panel = findByClass(host, 'pickme-panel');
	}
	assert.equal(panel.style.left, '392px', '面板初始应当贴着被点的标记');
	// 刚框出来、一个问题都没问：不摆删除（这时候关掉面板就是撤销）
	assert.equal(
		buttonTexts(panel).includes('Delete'),
		false,
		`刚建出来还没问过的批注不该有删除按钮，实际 ${buttonTexts(panel).join('｜')}`,
	);

	// 发一次提问：回答落盘会重画面板，位置必须还在原地
	const box = findAllByTag(panel, 'textarea')[0];
	box.value = '重画测试';
	findAllByTag(panel, 'button')
		.find((b) => b.text === 'Send')
		.onclick();
	await new Promise((r) => setTimeout(r, 1500));
	const redrawn = findByClass(host, 'pickme-panel');
	assert.ok(redrawn, '回答之后面板应当还在');
	assert.equal(redrawn.style.left, '392px', `回答落盘重画后面板不该跳回左上角，实际 ${redrawn.style.left}`);
	assert.equal(redrawn.style.top, '220px', `回答落盘重画后面板顶边也应当没变，实际 ${redrawn.style.top}`);
	// 问过了才给删除
	assert.equal(
		buttonTexts(redrawn).includes('Delete'),
		true,
		`问过的批注应当有删除按钮，实际 ${buttonTexts(redrawn).join('｜')}`,
	);
	assert.equal(
		(await plugin.repository.loadFor(source)).doc.entries.find((e) => e.id === posId).qas.length,
		1,
		'这次提问应当落盘',
	);
	findAllByTag(redrawn, 'button')
		.find((b) => b.text === '×')
		.onclick();
	await new Promise((r) => setTimeout(r, 300));
	console.log('面板重画检查通过（回答落盘位置不跳、删除按钮只在问过之后出现）');
}

// ---------- 22 模板开关与新建模板 ----------
{
	const all = await plugin.templates.listAll();
	assert.ok(all.length >= 3, `模板目录里应当有内置的 3 个模板，实际 ${all.length}`);

	// 取消勾选 = 只在面板下拉里藏起来，文件不动
	plugin.settings.hiddenTemplates = [all[0]];
	await plugin.saveSettings();
	const visible = await plugin.templates.list();
	assert.equal(visible.includes(all[0]), false, '被隐藏的模板不该出现在面板下拉里');
	assert.ok(
		(await plugin.templates.listAll()).includes(all[0]),
		'隐藏只是藏起来，模板文件还得在',
	);
	plugin.settings.hiddenTemplates = [];
	await plugin.saveSettings();
	assert.ok((await plugin.templates.list()).includes(all[0]), '取消隐藏后应当回到下拉里');

	// 新建模板：骨架落地，文件名立刻可用
	await plugin.createTemplate();
	const after = await plugin.templates.listAll();
	const added = after.filter((name) => !all.includes(name));
	assert.equal(added.length, 1, `新建模板应当只多出一个模板，实际 ${added.join('｜')}`);
	const text = await plugin.templates.io.readText(`${plugin.settings.templateDir}/${added[0]}.md`);
	assert.ok(text && text.includes('{{选区}}'), '模板骨架里应当列好可用的变量');
	assert.ok(text.includes('pickme_context'), '模板骨架里应当带上可以覆盖的参数');
	assert.ok(
		(await plugin.templates.list()).includes(added[0]),
		'新建的模板应当立刻出现在提问面板的下拉里',
	);
	console.log('模板检查通过（隐藏只藏下拉、文件不动；新建模板骨架落地并立刻可用）');
}

// ---------- 23 老默认位置迁移到插件自管的位置 ----------
// 老版本的默认值把模板塞进用户的 90-模板；现在改成插件自己的隐藏目录，
// 但只在用户没动过（还是老默认值）时才迁，旧文件不动。
{
	const kept = { templateDir: plugin.settings.templateDir };
	plugin.settings.templateDir = '90-模板/pickme';
	obsidian.Notice.messages.length = 0;
	await plugin.migrateLegacyDefaults();
	assert.equal(plugin.settings.templateDir, '.obsidian/plugins/pickme/templates', '老模板目录应当迁到插件自管位置');
	assert.ok(
		obsidian.Notice.messages.some((message) => message.includes('Template folder')),
		`迁移应当提示一次，实际 ${JSON.stringify(obsidian.Notice.messages)}`,
	);

	// 用户自己改过的目录不能动
	plugin.settings.templateDir = '我的模板';
	obsidian.Notice.messages.length = 0;
	await plugin.migrateLegacyDefaults();
	assert.equal(plugin.settings.templateDir, '我的模板', '用户自己设的目录不该被迁移覆盖');
	assert.equal(obsidian.Notice.messages.length, 0, '没迁移就不该弹提示');

	plugin.settings.templateDir = kept.templateDir;
	await plugin.saveSettings();
	console.log('默认位置迁移检查通过（只认老默认值、用户改过的不动）');

	// 索引表是插件内部产物：路径固定算出来，且落在插件目录里
	assert.equal(
		plugin.indexFilePath(),
		`${plugin.pluginDir()}/annotations-index.md`,
		'索引表应当固定在插件目录里',
	);

	// 默认目录按插件自己的目录算，源码里不写死 .obsidian/plugins/<id>
	const pluginDir = plugin.pluginDir();
	assert.equal(plugin.resolvePluginDir('', 'annotations'), `${pluginDir}/annotations`, '空值应当落到插件目录下');
	assert.equal(
		plugin.resolvePluginDir('.obsidian/plugins/pickme/annotations', 'annotations'),
		`${pluginDir}/annotations`,
		'老版本写死的配置目录路径应当换算到当前插件目录',
	);
	assert.equal(
		plugin.resolvePluginDir('.obsidian/plugins/old-name/批注', 'annotations'),
		`${pluginDir}/批注`,
		'用户改过插件目录名时，子目录要跟着走',
	);
	assert.equal(plugin.resolvePluginDir('60-批注', 'annotations'), '60-批注', '库内目录原样保留');
	assert.equal(plugin.resolvePluginDir('', 'templates'), `${pluginDir}/templates`, '模板目录同理');
	console.log('默认目录解析检查通过（不写死 .obsidian 路径）');
}

console.log('\n全部冒烟检查通过。');
