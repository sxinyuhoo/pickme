// 供冒烟测试使用的 obsidian 模块桩件：只实现插件实际用到的部分
export function createObsidianStub() {
	const norm = (p) => String(p).replace(/^\/+|\/+$/g, '');

	class TAbstractFile {
		constructor(path) {
			this.path = norm(path);
			this.name = this.path.split('/').pop() ?? this.path;
			this.parent = null;
		}
	}

	class TFile extends TAbstractFile {
		constructor(path, content = '') {
			super(path);
			this.content = content;
			const match = this.name.match(/\.([^.]+)$/);
			this.extension = match ? match[1] : '';
			const base = match ? this.name.slice(0, -(match[1].length + 1)) : this.name;
			this.basename = base;
		}
	}

	class TFolder extends TAbstractFile {
		constructor(path) {
			super(path);
			this.children = [];
		}
	}

	class Vault {
	/** 冷启动时库索引尚未就绪：getAbstractFileByPath 对已存在文件/目录也返回 null */
	indexStale = false;

		constructor() {
			this.files = new Map();
			this.folders = new Set(['']);
			this.adapter = {
				exists: async (p) => this.files.has(norm(p)) || this.folders.has(norm(p)),
				// 与真实 Obsidian 一致：只返回直接子项，不是全部后代
				list: async (p) => {
					const base = norm(p);
					const prefix = base ? `${base}/` : '';
					const files = [];
					const folders = new Set();
					for (const key of this.files.keys()) {
						if (prefix && !key.startsWith(prefix)) continue;
						const rest = prefix ? key.slice(prefix.length) : key;
						const cut = rest.indexOf('/');
						if (cut < 0) {
							if (prefix) files.push(key);
							continue;
						}
						folders.add(`${prefix}${rest.slice(0, cut)}`);
					}
					for (const folder of this.folders) {
						if (!folder || (prefix && !folder.startsWith(prefix))) continue;
						const rest = prefix ? folder.slice(prefix.length) : folder;
						if (rest && !rest.includes('/')) folders.add(folder);
					}
					return { files, folders: [...folders] };
				},
				getResourcePath: (p) => `app://local/${norm(p)}`,
				readBinary: async (p) => new TextEncoder().encode(this.files.get(norm(p))?.content ?? '').buffer,
				writeBinary: async (p, data) => {
					const text = new TextDecoder().decode(data);
					this.files.set(norm(p), new TFile(p, text));
				},
				read: async (p) => this.files.get(norm(p))?.content ?? '',
				write: async (p, content) => {
					const key = norm(p);
					const existing = this.files.get(key);
					if (existing) existing.content = content;
					else this.files.set(key, new TFile(key, content));
				},
				remove: async (p) => {
					this.files.delete(norm(p));
				},
				mkdir: async (p) => {
					this.folders.add(norm(p));
				},
				// 与真实 Obsidian 一致：recursive 为 false 时目录非空就抛错
				rmdir: async (p, recursive = false) => {
					const key = norm(p);
					if (!this.folders.has(key)) return;
					const prefix = key ? `${key}/` : '';
					const hasChild = [...this.files.keys()].some((f) => f.startsWith(prefix))
						|| [...this.folders].some((f) => f !== key && f.startsWith(prefix));
					if (hasChild && !recursive) throw new Error('Directory not empty');
					if (!key) return;
					this.folders.delete(key);
				},
			};
			this.configDir = '.obsidian';
		}

		getRoot() {
			return new TFolder('');
		}

		getAbstractFileByPath(path) {
			if (this.indexStale) return null;
			const key = norm(path);
			if (this.files.has(key)) return this.files.get(key);
			if (this.folders.has(key)) return new TFolder(key);
			return null;
		}

		async createFolder(path) {
			const key = norm(path);
			// 真实 Obsidian 对已存在的目录会抛这个错
			if (this.folders.has(key)) throw new Error('Folder already exists.');
			this.folders.add(key);
		}

		async create(path, content) {
			const file = new TFile(path, content);
			if (this.files.has(file.path)) throw new Error(`已存在：${file.path}`);
			this.files.set(file.path, file);
			return file;
		}

		async modify(file, content) {
			file.content = content;
			this.files.set(file.path, file);
		}

		async read(file) {
			return file.content;
		}

		async cachedRead(file) {
			return file.content;
		}

		async readBinary(file) {
			return new TextEncoder().encode(file.content).buffer;
		}

		async process(file, fn) {
			const next = fn(file.content);
			if (typeof next === 'string') file.content = next;
			return file.content;
		}

		async trash(file) {
			this.files.delete(file.path);
		}

		async rename(file, newPath) {
			this.files.delete(file.path);
			const target = norm(newPath);
			file.path = target;
			file.name = target.split('/').pop() ?? target;
			this.files.set(target, file);
		}

		getMarkdownFiles() {
			return [...this.files.values()].filter((file) => file.extension === 'md');
		}
	}

	/** 真的记录并派发事件：插件挂在 workspace 上的菜单项、生命周期回调才测得到 */
	class Events {
		constructor() {
			this.listeners = [];
		}

		on(type, fn) {
			this.listeners.push({ type, fn });
			return { type, fn };
		}

		off(type, fn) {
			this.listeners = this.listeners.filter(
				(item) => !(item.type === type && (!fn || item.fn === fn)),
			);
		}

		trigger(type, ...args) {
			for (const item of this.listeners.filter((entry) => entry.type === type)) {
				item.fn(...args);
			}
		}
	}

	const workspace = new Events();
	workspace.getActiveViewOfType = () => null;
	workspace.getLeavesOfType = () => [];
	workspace.getRightLeaf = () => null;
	workspace.getActiveFile = () => null;
	workspace.getLeaf = () => null;
	workspace.revealLeaf = () => {};

	class Plugin {
		constructor(app, manifest) {
			this.app = app;
			this.manifest = manifest;
			this.commands = [];
			this.views = new Map();
			this.ribbons = [];
			this.events = [];
			this.extensions = [];
			this.postProcessors = [];
			this.settingTabs = [];
			this.extensionsMap = new Map();
			this.data = {};
		}

		async loadData() {
			return this.data;
		}

		async saveData(data) {
			this.data = data;
		}

		addCommand(command) {
			this.commands.push(command);
			return command;
		}

		registerView(type, factory) {
			this.views.set(type, factory);
		}

		registerExtensions(extensions, viewType) {
			for (const extension of extensions) this.extensionsMap.set(extension, viewType);
		}

		registerEditorExtension(extension) {
			this.extensions.push(extension);
		}

		registerMarkdownPostProcessor(processor) {
			this.postProcessors.push(processor);
		}

		addSettingTab(tab) {
			this.settingTabs.push(tab);
		}

		addRibbonIcon(icon, title, callback) {
			this.ribbons.push({ icon, title, callback });
		}

		registerEvent(event) {
			this.events.push(event);
		}

		registerInterval() {}

		registerDomEvent() {}
	}

	class ItemView {
		constructor(leaf) {
			this.leaf = leaf;
			this.app = leaf.app;
		}

		getViewType() {
			return 'stub';
		}
	}

	class FileView extends ItemView {
		constructor(leaf) {
			super(leaf);
			this.file = null;
		}
	}

	class Modal {}
	class SuggestModal extends Modal {}
	class PluginSettingTab {
		constructor(app, plugin) {
			this.app = app;
			this.plugin = plugin;
		}
	}
	class Setting {}
	class Notice {
		constructor(message) {
			Notice.messages.push(String(message));
		}
	}
	Notice.messages = [];
	class Component {
		load() {
			this.loaded = true;
		}

		unload() {
			this.loaded = false;
		}
	}

	class MarkdownRenderer {
		static async render() {}
	}
	class MarkdownView {}

	/** requestUrl 桩件：记录调用，响应内容可由测试替换 */
	const requestUrlCalls = [];
	let requestUrlHandler = async () => ({
		status: 200,
		headers: {},
		text: '{}',
		json: {},
		arrayBuffer: new ArrayBuffer(0),
	});
	const requestUrl = (param) => {
		requestUrlCalls.push(param);
		return requestUrlHandler(param);
	};

	return {
		norm,
		TAbstractFile,
		TFile,
		TFolder,
		Vault,
		Plugin,
		ItemView,
		Modal,
		SuggestModal,
		PluginSettingTab,
		Setting,
		Notice,
		FileView,
		Component,
		MarkdownRenderer,
		MarkdownView,
		editorInfoField: { name: 'editorInfo' },
		normalizePath: (p) => norm(p),
		apiVersion: '1.6.0',
		workspace,
		requestUrl,
		requestUrlCalls,
		setRequestUrlHandler: (fn) => {
			requestUrlHandler = fn;
		},
	};
}
