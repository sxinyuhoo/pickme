import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import { setLanguage, t } from './i18n.ts';
import { DEFAULT_SETTINGS, PickmeSettingTab } from './settings.ts';
import type { PickmeSettings } from './settings.ts';
import { AnnotationRepository } from './store/repository.ts';
import { TemplateStore } from './store/templateStore.ts';
import { activateSidebar, PickmeSidebarView, VIEW_TYPE_PICKME } from './ui/sidebarView.ts';
import { PickmeIndexView, VIEW_TYPE_PICKME_INDEX } from './ui/indexView.ts';
import { openAskPanel } from './ui/askPanel.ts';
import type { AskPanelAnchor, AskSink } from './ui/askPanel.ts';
import { PickmePdfView, VIEW_TYPE_PICKME_PDF } from './pdf/pdfView.ts';
import { buildEditorExtension, buildPostProcessor, cmView, selectionOffsets } from './render/anchorRenderer.ts';
import { registerCommands } from './commands.ts';
import { chat, buildSystemPrompt, listModels } from './model/client.ts';
import { DEFAULT_TAG } from './core/anchor.ts';
import {
	anchorTag,
	fingerprint,
	insertAnchors,
	newAnchorId,
	removeAnchors,
	scanAnchors,
	stripAnchors,
} from './core/anchor.ts';
import type { AnnotationDoc, AnnotationEntry } from './core/types.ts';
import { TEMPLATE_SKELETON, renderPrompt, trimSelection } from './core/template.ts';
import { buildAnswerText, buildHistoryMessages, historyText } from './core/qa.ts';
import { arrayBufferToBase64, nowIso } from './util.ts';

export interface AskParams {
	question: string;
	templateName: string;
	withContext: boolean;
	entryId: string | null;
	/** 侧边栏临时指定的模型，优先于模板与设置 */
	modelOverride?: string;
	/** 提问针对的文档，页面内面板会显式传入 */
	file?: TFile;
	/** 本次提问是否深度思考，缺省用设置里的开关 */
	deepThinking?: boolean;
}

/** 老版本的默认位置，用来做一次性迁移 */
const LEGACY_TEMPLATE_DIR = '90-模板/pickme';
/** 索引表文件名：它是插件内部产物，路径固定为「插件目录/这个文件名」，不给用户改 */
const INDEX_FILE_NAME = 'annotations-index.md';
/** 孤儿批注的宽限期：首次发现后至少隔这么久、且再判定一次仍是孤儿才清理 */
const ORPHAN_GRACE_MS = 60_000;

export default class PickmePlugin extends Plugin {
	settings: PickmeSettings = DEFAULT_SETTINGS;
	repository!: AnnotationRepository;
	templates!: TemplateStore;
	private abortController: AbortController | null = null;
	/** PDF 打开方式：registry 注册扩展名 / intercept 打开后换视图 / off 不接管 */
	private pdfTakeover: 'registry' | 'intercept' | 'off' = 'off';
	private lastAnnotationDir = '';
	/** 批注变动后合并写索引笔记的定时器 */
	private indexTimer: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();
		setLanguage(this.settings.language);
		this.repository = new AnnotationRepository(this.app, () => this.settings);
		this.templates = new TemplateStore(this.app, () => this.settings);
		this.lastAnnotationDir = this.settings.annotationDir;
		// 批注增删改之后自动更新索引笔记（合并成一次，别一边点一边写文件）
		this.repository.onChanged = () => this.scheduleIndexRefresh();

		this.registerView(VIEW_TYPE_PICKME, (leaf) => new PickmeSidebarView(leaf, this));
		this.registerView(VIEW_TYPE_PICKME_INDEX, (leaf) => new PickmeIndexView(leaf, this));
		this.registerView(VIEW_TYPE_PICKME_PDF, (leaf) => new PickmePdfView(leaf, this));
		this.applyPdfViewerSetting();
		this.registerEditorExtension(buildEditorExtension(this));
		this.registerMarkdownPostProcessor(buildPostProcessor(this));
		this.addSettingTab(new PickmeSettingTab(this.app, this));
		this.addRibbonIcon('ghost', t('Pick Me：批注列表（查看）'), () => {
			void this.openSidebar();
		});
		registerCommands(this);
		this.applyHighlightColor();
		this.applyMarkStyle();

		// 老版本的默认位置改成插件自管的位置：只在用户没动过（还是老默认值）时改，
		// 旧文件一律不动，也不删——需要清理的话交给用户自己决定
		await this.migrateLegacyDefaults();
		if (this.settings.autoEnsureTemplates) {
			await this.ensureDefaultTemplates(false);
		}
		// 设置里写了索引笔记的路径，文件却不在——用户会以为坏了，启动时补一份
		await this.ensureIndexFile();

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				void this.onActiveLeafChange();
			}),
		);
		// file-open 在部分版本不触发，留着兜底；真正的接管靠 active-leaf-change
		this.registerEvent(
			this.app.workspace.on('file-open', (file) => {
				void this.takeOverPdfLeaf(file);
			}),
		);
		// 正文里选中文字后右键：一个入口就够（建批注 + 就地提问，用的是同一块面板）
		this.registerEvent(
			this.app.workspace.on('editor-menu', (menu, editor, info) => {
				if (!editor.getSelection()) return;
				const view = info instanceof MarkdownView ? info : this.markdownViewFor(this.activeFile()?.path ?? '');
				if (!view) return;
				menu.addItem((item) =>
					item
						.setTitle(t('Pick Me：提问或批注'))
						.setIcon('ghost')
						.onClick(() => {
							void this.askSelection(view);
						}),
				);
			}),
		);
		// 源文档移动/改名：批注文件跟着走，维持「批注路径 = 源路径镜像」这个不变量。
		// 文件夹改名时 Obsidian 会为里面每个文件各发一次，所以这里只处理文件即可。
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (!(file instanceof TFile)) return;
				if (this.repository.ownsFile(file.path) || this.repository.ownsFile(oldPath)) return;
				void this.moveAnnotationsWith(file.path, oldPath);
			}),
		);
		// 源文档被删除：它留下的批注文件不该继续占位（移动或改名不算删除，见 resolveSourceFile）
		this.registerEvent(
			this.app.vault.on('delete', (file) => {
				if (!(file instanceof TFile) || !this.settings.pruneOrphanAnnotations) return;
				// 批注文件自己的增删不是源文档事件
				if (this.repository.ownsFile(file.path)) return;
				// 延后一点再判定：删除事件触发时库索引往往还没更新，
				// 「复制+删除」式移动里那个同名副本可能也还没被索引到
				window.setTimeout(() => void this.pruneAnnotationsFor(file.path), 1200);
			}),
		);
		// 启动时再补扫一遍历史遗留。等布局就绪后再缓两秒，避免库还没加载完就把「暂时看不见」当成「文件没了」
		this.app.workspace.onLayoutReady(() => {
			// 源路径过期自愈与「清理孤儿」是两件事：前者是修正，后者是删除，先修正再清理
			window.setTimeout(() => void this.repairStaleSources(), 2500);
			if (!this.settings.pruneOrphanAnnotations) return;
			window.setTimeout(() => void this.pruneOrphanAnnotations(), 2000);
		});

		// 文件列表右键也能送进 Pick Me 查看器
		this.registerEvent(
			this.app.workspace.on('file-menu', (menu, file) => {
				if (!(file instanceof TFile) || file.extension !== 'pdf') return;
				menu.addItem((item) =>
					item
						.setTitle(t('在 Pick Me 查看器中打开'))
						.setIcon('ghost')
						.onClick(() => {
							void this.openPdfInPickmeView(file);
						}),
				);
			}),
		);
	}

	onunload(): void {
		// 滚动记忆是节流落盘的，退出前补一次，别把最后几页的进度丢了
		this.flushSettingsSave();
		// 卸载时把标记样式类摘掉，别留在 body 上
		document.body.removeClass(
			'pickme-mark-background',
			'pickme-mark-underline',
			'pickme-mark-border',
		);
		// 页面内提问面板是直接挂进视图容器的，插件卸载后不会自动消失
		for (const layer of Array.from(document.querySelectorAll('.pickme-inline-layer'))) {
			layer.remove();
		}
	}

	/** 语言切换后：重注册命令（命令名是注册时定下的），并刷新侧边栏与 PDF 视图 */
	async refreshUiText(): Promise<void> {
		// app.commands 不在公开类型里，按实际运行时形状取用
		const registry = (
			this.app as import('obsidian').App & {
				commands: { commands: Record<string, unknown>; removeCommand(id: string): void };
			}
		).commands;
		for (const id of Object.keys(registry.commands).filter((key) => key.startsWith('pickme:'))) {
			registry.removeCommand(id);
		}
		registerCommands(this);
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PICKME)) {
			const view = leaf.view;
			if (view instanceof PickmeSidebarView) await view.reload();
		}
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PICKME_PDF)) {
			const view = leaf.view;
			if (view instanceof PickmePdfView) view.refreshLabels();
		}
	}

	async loadSettings(): Promise<void> {
		const stored = ((await this.loadData()) ?? {}) as Partial<typeof DEFAULT_SETTINGS>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, stored);
		// 老版本把索引表路径存在设置里，现在它归插件自己管：顺手把这个死字段从 data.json 里抹掉
		delete (this.settings as unknown as Record<string, unknown>).indexPath;
		const before = `${this.settings.annotationDir}|${this.settings.templateDir}`;
		this.settings.annotationDir = this.resolvePluginDir(this.settings.annotationDir, 'annotations');
		this.settings.templateDir = this.resolvePluginDir(this.settings.templateDir, 'templates');
		if (`${this.settings.annotationDir}|${this.settings.templateDir}` !== before) {
			await this.saveSettings();
		}
	}

	/** 插件自己在库里的目录，例如 .obsidian/plugins/pickme */
	pluginDir(): string {
		const dir = this.manifest.dir ?? `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		return dir.replace(/\/+$/, '');
	}

	/**
	 * 把「插件目录下的相对位置」解析成完整路径。
	 * 空值取默认子目录；老版本写死的配置目录路径（含用户改过插件目录名的）一并换算到当前插件目录。
	 */
	resolvePluginDir(value: string, leaf: string): string {
		const pluginDir = this.pluginDir();
		const trimmed = value.trim().replace(/\/+$/, '');
		if (!trimmed) return `${pluginDir}/${leaf}`;
		const configDir = (this.app.vault.configDir || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		if (!configDir) return trimmed;
		const match = new RegExp(`^${configDir}[\\/]plugins[\\/][^\\/]+[\\/]?(.*)$`).exec(trimmed);
		if (!match) return trimmed;
		return match[1] ? `${pluginDir}/${match[1]}` : `${pluginDir}/${leaf}`;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	activeFile(): TFile | null {
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view?.file) return view.file;
		return this.app.workspace.getActiveFile();
	}

	sidebar(): PickmeSidebarView | null {
		const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PICKME)[0];
		const view = leaf?.view;
		// 只认自家的视图实例：盲转型会让 refreshViews 调到别的视图的 reload 上
		return view instanceof PickmeSidebarView ? view : null;
	}

	async openSidebar(): Promise<PickmeSidebarView> {
		const view = await activateSidebar(this);
		const file = this.activeFile();
		if (file && view.currentFilePath() !== file.path) {
			await view.setFile(file);
		}
		if (file && this.settings.createEmptyAnnotationFile) {
			await this.repository.ensureDoc(file);
		}
		return view;
	}

	/** 打开批注索引侧边栏（全局视角：所有文档的批注一屏看全） */
	async openIndexView(): Promise<PickmeIndexView> {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_PICKME_INDEX);
		if (existing.length > 0) {
			await this.app.workspace.revealLeaf(existing[0]);
			const view = existing[0].view;
			if (view instanceof PickmeIndexView) {
				await view.reload();
				return view;
			}
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (!leaf) {
			new Notice(t('pickme：无法创建侧边栏'));
			throw new Error('no leaf');
		}
		await leaf.setViewState({ type: VIEW_TYPE_PICKME_INDEX, active: true });
		await this.app.workspace.revealLeaf(leaf);
		const view = leaf.view;
		if (view instanceof PickmeIndexView) return view;
		throw new Error('unexpected view');
	}

	/** 源文档移动/改名：把它的批注文件搬到新位置（搬不动就维持原样，读取时有按名兜底） */
	private async moveAnnotationsWith(newPath: string, oldPath: string): Promise<void> {
		try {
			if (await this.repository.moveSidecarFor(oldPath, newPath)) await this.refreshViews();
		} catch {
			// 搬不动不算错，读取时的四层兜底仍然能用
		}
	}

	/**
	 * 源路径过期自愈：批注文件里记的路径已经不存在，但库里存在**同名且唯一**的文件时，
	 * 说明这个文档在插件监听之外被移动/改名过（iCloud 同步、系统文件夹里直接移动、插件没装时的历史操作），
	 * 就把批注文件按新路径搬过去。只认「唯一同名」，所以不会搬错。
	 */
	async repairStaleSources(): Promise<number> {
		try {
			const all = this.app.vault.getFiles();
			const groups = await this.repository.indexData();
			let moved = 0;
			for (const group of groups) {
				if (this.app.vault.getAbstractFileByPath(group.sourcePath)) continue;
				const name = group.sourcePath.split('/').pop() ?? group.sourcePath;
				const candidates = all.filter((file) => file.name === name);
				if (candidates.length !== 1) continue;
				if (await this.repository.moveSidecarFor(group.sourcePath, candidates[0].path)) moved += 1;
			}
			if (moved > 0) await this.refreshViews();
			return moved;
		} catch {
			return 0;
		}
	}

	/** 源文档被删掉了：按路径精确收掉它的批注文件与截图（只动这一个源文档的批注） */
	private async pruneAnnotationsFor(sourcePath: string): Promise<void> {
		try {
			// 「复制 + 删除」式的移动：旧路径没了但**另一个**同名文档还在，这种情况不能当作删除。
			// 注意解除引用：删除事件触发时库索引往往还没更新，这时按名会解析到「刚被删掉的那条路径」，
			// 那不算「还在」，否则真删除永远清不掉。
			const resolved = this.resolveSourceFile(sourcePath);
			if (resolved && resolved.path !== sourcePath) return;
			const removed = await this.repository.removeDocFor(sourcePath);
			if (removed > 0) new Notice(t('pickme：已删除 {v0} 条批注（源文档已不在）', { v0: removed }));
			await this.refreshViews();
		} catch {
			// 清理失败不影响其它功能
		}
	}

	/**
	 * 扫一遍批注目录：源文档已经不在库里的（删除过，且按文件名也找不到）连批注一起收掉。
	 * 只认「路径找不到 + 按名也找不到」，所以移动/改名的文档不会被误删。
	 */
	async pruneOrphanAnnotations(): Promise<string[]> {
		try {
			const removed = await this.repository.pruneOrphanDocs(
				(path) => this.resolveSourceFile(path),
				this.settings.orphanFirstSeen,
				ORPHAN_GRACE_MS,
			);
			await this.saveSettings();
			if (removed.length) {
				new Notice(t('pickme：已清理 {v0} 个已删除文档的批注', { v0: removed.length }));
				await this.refreshViews();
			}
			return removed;
		} catch {
			return [];
		}
	}

	/**
	 * 用索引里存下来的路径找源文档。文档被移动/改名后路径就失效了，
	 * 这时退回按文件名解析（先走 Obsidian 自己的链接解析，再退回全库唯一同名文件）。
	 */
	resolveSourceFile(path: string): TFile | null {
		const direct = this.app.vault.getAbstractFileByPath(path);
		if (direct instanceof TFile) return direct;
		// 剥掉最后一个后缀：Obsidian 的 basename 是不带后缀的（论文.pdf → 论文），
		// 只剥 .md 的话 .pdf 这类文件名永远比不中
		const fileName = path.split('/').pop() ?? '';
		const name = fileName.replace(/\.[^.]+$/, '');
		const linked =
			this.app.metadataCache.getFirstLinkpathDest(name, '') ??
			this.app.metadataCache.getFirstLinkpathDest(fileName, '') ??
			this.app.metadataCache.getFirstLinkpathDest(path, '');
		if (linked instanceof TFile) return linked;
		const sameName = this.app.vault.getFiles().filter((candidate) => candidate.basename === name);
		return sameName.length === 1 ? sameName[0] : null;
	}

	/** 从批注索引跳到某条批注：先打开源文档，再定位 */
	async openEntryAt(sourcePath: string, id: string): Promise<void> {
		const file = this.resolveSourceFile(sourcePath);
		if (!(file instanceof TFile)) {
			new Notice(t('pickme：找不到源文档 {v0}', { v0: sourcePath }));
			return;
		}
		await this.app.workspace.getLeaf(false).openFile(file);
		await this.jumpToAnchor(id, file);
	}

	async refreshViews(): Promise<void> {
		const view = this.sidebar();
		if (view) await view.reload();
		// 索引侧边栏开着的话也要跟着变
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PICKME_INDEX)) {
			const index = leaf.view;
			if (index instanceof PickmeIndexView) await index.reload();
		}
		// 页面上的标记不跟着变的话，删掉批注后高亮框还留在 PDF 上
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PICKME_PDF)) {
			const pdf = leaf.view;
			if (pdf instanceof PickmePdfView) await pdf.refreshMarks();
		}
	}

	applyHighlightColor(): void {
		document.body.style.setProperty('--pickme-highlight', this.settings.highlightColor);
	}

	/** 视觉标记样式：底色 / 下划线 / 左边框 */
	applyMarkStyle(): void {
		const style = this.settings.markStyle || 'background';
		document.body.removeClass('pickme-mark-background', 'pickme-mark-underline', 'pickme-mark-border');
		document.body.addClass(`pickme-mark-${style}`);
	}

	/**
	 * 按设置决定是否用自带查看器接管 PDF 打开。
	 * 核心查看器已经占了 pdf 扩展名，此时直接注册会抛
	 * 「Attempting to register an existing file extension "pdf"」把整个 onload 带崩，
	 * 所以先探测注册表，被占用时退回「打开后用换视图的方式接管」。
	 */
	applyPdfViewerSetting(): void {
		if (!this.settings.pdfViewerEnabled) {
			this.pdfTakeover = 'off';
			return;
		}
		// viewRegistry 是未公开 API，取不到就按「没被占用」处理
		const registry = (
			this.app as unknown as {
				viewRegistry?: { isExtensionRegistered?(extension: string): boolean };
			}
		).viewRegistry;
		const occupied = registry?.isExtensionRegistered?.('pdf') ?? false;
		if (!occupied) {
			try {
				this.registerExtensions(['pdf'], VIEW_TYPE_PICKME_PDF);
				this.pdfTakeover = 'registry';
				return;
			} catch (error) {
				// 注册失败不致命，继续走接管
				console.warn('pickme：注册 pdf 扩展名失败，改用接管方式', error);
			}
		}
		this.pdfTakeover = 'intercept';
	}

	/** 活动叶片变化：刷新侧边栏，必要时把 PDF 换成自带查看器 */
	private async onActiveLeafChange(): Promise<void> {
		await this.refreshViews();
		await this.takeOverPdfLeaf(this.app.workspace.getActiveFile());
	}

	/**
	 * 核心查看器占着 pdf 时，把当前叶片换成 Pick Me 查看器。
	 * 实测 active-leaf-change 触发时叶片已经是内置 pdf 视图，这里换视图不会打架：
	 * 换成 pickme-pdf-view 后再次触发时类型不匹配就直接返回，不会死循环。
	 */
	private async takeOverPdfLeaf(file: TFile | null): Promise<void> {
		if (this.pdfTakeover !== 'intercept') return;
		// activeLeaf 已废弃；取最近活跃的叶片，语义与此前一致
		const leaf = this.app.workspace.getMostRecentLeaf();
		const view = leaf?.view;
		if (!leaf || !view) return;
		if (view.getViewType() !== 'pdf') return;
		const opened = file && file.extension === 'pdf' ? file : null;
		const shown = (view as unknown as { file?: TFile }).file ?? null;
		const target = opened ?? (shown && shown.extension === 'pdf' ? shown : null);
		if (!target) return;
		try {
			await leaf.setViewState({
				type: VIEW_TYPE_PICKME_PDF,
				state: { file: target.path },
				active: true,
			});
		} catch (error) {
			console.warn('pickme：接管 PDF 打开失败，保持内置查看器', error);
		}
	}

	/** 在 Pick Me 的 pdf.js 查看器里打开一个 PDF */
	async openPdfInPickmeView(file?: TFile | null): Promise<void> {
		const target = file ?? this.app.workspace.getActiveFile();
		if (!target || target.extension !== 'pdf') {
			new Notice(t('pickme：请先打开一个 PDF'));
			return;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.setViewState({
			type: VIEW_TYPE_PICKME_PDF,
			active: true,
			state: { file: target.path },
		});
		await this.app.workspace.revealLeaf(leaf);
	}

	/** 当前打开着某个 PDF 的 Pick Me 查看器 */
	private pdfViewFor(path: string): PickmePdfView | null {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_PICKME_PDF)) {
			const view = leaf.view;
			if (view instanceof PickmePdfView && view.file?.path === path) return view;
		}
		return null;
	}

	/** 当前打开着某个文件的 Markdown 视图 */
	private markdownViewFor(path: string): MarkdownView | null {
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path) return view;
		}
		return null;
	}

	/**
	 * 把提问面板开在当前页面上（PDF 页面或正文阅读视图），不打开侧边栏。
	 * 找不到合适的宿主视图时返回 false，由调用方决定是否回退侧边栏。
	 */
	openEntryPanel(
		id: string,
		file?: TFile | null,
		mdView?: MarkdownView | null,
		anchorEl?: Element | null,
		fresh = false,
	): boolean {
		const target = file ?? this.activeFile();
		if (!target) return false;
		const pdfView = this.pdfViewFor(target.path);
		if (pdfView) {
			pdfView.openAskPanel(id, null, undefined, fresh);
			return true;
		}
		const view = mdView ?? this.markdownViewFor(target.path);
		if (view) {
			// 挂到视图容器上（它不滚动），面板就不会随正文一起滚走
			openAskPanel({
				plugin: this,
				host: view.containerEl,
				file: target,
				entryId: id,
				fresh,
				// 优先贴着被点的那个标记；阅读模式下没有 CodeMirror 视图，取光标位置会失手
				resolveAnchor: () => this.anchorFromElement(anchorEl, view.containerEl) ?? this.markdownAnchor(view),
			});
			return true;
		}
		return false;
	}

	/** 阅读视图里面板贴着编辑器光标定位 */
	private anchorFromElement(el: Element | null | undefined, host: HTMLElement): AskPanelAnchor | null {
		if (!el) return null;
		try {
			const rect = el.getBoundingClientRect();
			// 后台标签页里量出来全是 0，这种当作没拿到锚点
			if (!rect.width && !rect.height) return null;
			const hostRect = host.getBoundingClientRect();
			return {
				left: rect.left - hostRect.left,
				top: rect.bottom - hostRect.top,
				width: rect.width,
				height: 0,
			};
		} catch {
			return null;
		}
	}

	private markdownAnchor(view: MarkdownView): AskPanelAnchor | null {
		try {
			const editor = view.editor;
			const to = editor.posToOffset(editor.getCursor('to'));
			const coords = cmView(editor).coordsAtPos(to);
			if (!coords) return null;
			const hostRect = view.containerEl.getBoundingClientRect();
			return {
				left: coords.left - hostRect.left,
				top: coords.bottom - hostRect.top,
				width: Math.max(0, coords.right - coords.left),
				height: 0,
			};
		} catch {
			return null;
		}
	}

	/**
	 * 点击批注标记的统一入口：优先在页面内打开面板，页面不在前台时退回侧边栏。
	 */
	async activateEntry(id: string, anchorEl?: Element | null): Promise<void> {
		const file = this.activeFile();
		if (this.settings.inlineAsk && this.openEntryPanel(id, file, null, anchorEl)) {
			await this.jumpToAnchor(id, file);
			return;
		}
		await this.focusEntry(id);
	}

	/** 把某个 PDF 的查看器切到框选模式 */
	async focusPdfSelection(path: string): Promise<void> {
		const view = this.pdfViewFor(path);
		if (view) await view.focusSelectionMode();
	}

	/** 把批注附带的区域截图读成 data url，供多模态提问使用 */
	private async entryImages(entry: AnnotationEntry): Promise<Array<{ url: string }>> {
		if (entry.kind !== 'pdf' || !entry.pdf?.image) return [];
		try {
			const buffer = await this.repository.io.readBinary(entry.pdf.image);
			if (!buffer) return [];
			return [{ url: `data:image/png;base64,${arrayBufferToBase64(buffer)}` }];
		} catch {
			return [];
		}
	}

	/** 为当前编辑器选区插入锚点并创建批注条目 */
	/**
	 * 对当前选区直接提问：建批注 + 把提问面板开在当前视图上。
	 * 命令与编辑器右键菜单共用这一条流程。
	 */
	async askSelection(view: MarkdownView): Promise<void> {
		const entry = await this.annotateSelection(view, true);
		if (!entry) return;
		// 与 PDF 保持一致：刚建出来、一个问题都没问过时关掉面板＝撤销（面板里也不摆删除），
		// 问过之后才留下，并在面板里给出删除入口
		if (this.settings.inlineAsk && this.openEntryPanel(entry.id, view.file, view, null, true)) return;
		const sidebar = await this.openSidebar();
		await sidebar.setFile(view.file);
		sidebar.setActiveEntry(entry.id);
		if (!sidebar.currentFilePath()) new Notice(t('pickme：请先打开一个文档'));
	}

	async annotateSelection(view: MarkdownView, silent = false): Promise<AnnotationEntry | null> {
		const file = view.file;
		if (!file) return null;
		const offsets = selectionOffsets(view);
		if (!offsets) {
			if (!silent) new Notice(t('pickme：请先选中一段文字'));
			return null;
		}
		const text = view.editor.getValue();
		const selection = text.slice(offsets.from, offsets.to);
		const id = this.uniqueAnchorId(text);
		const tag = anchorTag(id, this.settings.tagName);

		cmView(view.editor).dispatch({
			changes: [
				{ from: offsets.from, insert: tag },
				{ from: offsets.to, insert: tag },
			],
		});

		const entry: AnnotationEntry = {
			id,
			kind: 'text',
			selection,
			fingerprint: fingerprint(selection),
			status: 'ok',
			created: nowIso(),
			qas: [],
		};
		await this.repository.addEntry(file, entry);

		if (this.settings.openSidebarOnAnnotate) {
			// 默认就在当前页面上提问；只有关掉页面内提问或找不到宿主时才开侧边栏
			if (!(this.settings.inlineAsk && this.openEntryPanel(id, file, view))) {
				const sidebar = await this.openSidebar();
				await sidebar.setFile(file);
				sidebar.setActiveEntry(id);
			}
		}
		if (!silent) new Notice(t('pickme：已添加批注 {v0}', { v0: id }));
		return entry;
	}

	private uniqueAnchorId(text: string): string {
		const existing = new Set(scanAnchors(text, this.settings.tagName).pairs.map((p) => p.id));
		let id = newAnchorId();
		while (existing.has(id)) id = newAnchorId();
		return id;
	}

	/** 提问：写入批注文件后调用模型，流式回填到 sink（默认侧边栏，PDF/阅读视图走页面内面板） */
	async ask(params: AskParams, sink?: AskSink | null): Promise<void> {
		const mdView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const file = params.file ?? mdView?.file ?? this.activeFile();
		if (!file) {
			new Notice(t('pickme：当前没有打开的文档'));
			return;
		}

		let entryId = params.entryId;
		if (!entryId) {
			if (!mdView) {
				new Notice(t('pickme：请先选中文本，或在侧边栏点击一条批注'));
				return;
			}
			const created = await this.annotateSelection(mdView, true);
			if (!created) {
				new Notice(t('pickme：请先选中文本，或在侧边栏点击一条批注'));
				return;
			}
			entryId = created.id;
		}

		const { doc } = await this.repository.loadFor(file);
		const entry = doc.entries.find((item) => item.id === entryId);
		if (!entry) {
			new Notice(t('pickme：找不到批注 {v0}', { v0: entryId }));
			return;
		}

		const template = params.templateName ? await this.templates.read(params.templateName) : null;
		const selection = entry.kind === 'pdf' ? entry.pdf?.hitText ?? '' : entry.selection;
		const withContext = params.withContext && (template ? template.config.context : true);
		const sourceText = entry.kind === 'pdf' ? '' : await this.repository.sourceTextOf(file);
		const context = withContext ? this.buildContext(sourceText, entry) : '';
		const trimmed = trimSelection(selection, this.settings.maxSelectionChars);

		const vars = {
			选区: trimmed,
			提问: params.question,
			笔记标题: file.basename,
			源路径: file.path,
			页码: entry.kind === 'pdf' ? String(entry.pdf?.page ?? '') : '',
			区域图片: entry.kind === 'pdf' && entry.pdf?.image ? `![[${entry.pdf.image}]]` : '',
			已有批注: historyText(entry.qas),
			上下文: context,
		};
		const body = template
			? renderPrompt(template.prompt, vars)
			: [
					params.question || t('请说明这段内容。'),
					'',
					trimmed ? t('选区：\n{v0}', { v0: trimmed }) : '',
					context ? t('\n上下文：\n{v0}', { v0: context }) : '',
				]
					.filter(Boolean)
					.join('\n');
		// pickme_include_note 打开时把整篇笔记一并送进去
		const noteText =
			template?.config.includeNote && sourceText
				? stripAnchors(sourceText, this.settings.tagName).slice(0, 20000)
				: '';
		const prompt = noteText ? t('{v0}\n\n整篇笔记：\n{v1}', { v0: body, v1: noteText }) : body;

		const index = entry.qas.length;
		const hasImage = entry.kind === 'pdf' && !!entry.pdf?.image;
		const wantImage = hasImage && this.settings.visionEnabled && (template?.config.vision ?? true);
		const images = wantImage ? await this.entryImages(entry) : [];
		if (hasImage && !wantImage) {
			new Notice(t('pickme：按设置只用命中文本提问，未发送区域截图'));
		}

		const defaultModel = (
			params.modelOverride ||
			template?.config.model ||
			this.settings.model ||
			''
		).trim();
		if (!defaultModel) {
			new Notice(t('pickme：请先在设置里填写模型名称'));
			return;
		}
		if (!this.settings.apiBaseUrl.trim()) {
			new Notice(t('pickme：请先在设置里填写接口地址'));
			return;
		}
		// 有截图时优先用视觉模型，没配就沿用默认模型
		const model =
			images.length > 0 ? this.settings.visionModel.trim() || defaultModel : defaultModel;

		entry.qas.push({
			question: params.question,
			template: params.templateName,
			answer: '',
			created: nowIso(),
		});
		await this.repository.save(doc);

		let sinkTarget: AskSink;
		if (sink) {
			sinkTarget = sink;
		} else {
			const sidebar = await this.openSidebar();
			await sidebar.setFile(file);
			sinkTarget = sidebar;
		}
		sinkTarget.setActiveEntry(entry.id);
		sinkTarget.beginStream(sinkTarget.streamKey(entry.id, index));

		const userPrompt = images.length > 0 ? t('{v0}\n\n（随附框选区域截图）', { v0: prompt }) : prompt;
		if (!this.settings.apiKey) {
			new Notice(t('pickme：请先在设置里填写 API Key'));
			sinkTarget.endStream();
			return;
		}

		this.abortController = new AbortController();
		try {
			const result = await chat(
				{
					baseUrl: this.settings.apiBaseUrl,
					apiKey: this.settings.apiKey,
					model,
					temperature: template?.config.temperature ?? this.settings.temperature,
					system: buildSystemPrompt(withContext),
					user: userPrompt,
					images,
					history: buildHistoryMessages(entry.qas.slice(0, index)),
					maxTokens: this.settings.maxOutputTokens,
					deepThinking: params.deepThinking ?? this.settings.deepThinking,
					timeoutSec: this.settings.requestTimeoutSec,
					stream: this.settings.stream,
					signal: this.abortController.signal,
					transport: this.settings.transport,
				},
				(_delta, full) => {
					sinkTarget.appendStream(full);
				},
			);

			const { doc: latest } = await this.repository.loadFor(file);
			const target = latest.entries.find((item) => item.id === entry.id);
			if (target) {
				const answer = buildAnswerText(result);
				target.qas[index] = {
					question: params.question,
					template: params.templateName,
					answer,
					created: target.qas[index]?.created ?? nowIso(),
				};
				await this.repository.save(latest);
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(t('pickme：请求失败 {v0}', { v0: message }));
			const { doc: latest } = await this.repository.loadFor(file);
			const target = latest.entries.find((item) => item.id === entry.id);
			// 断网或超时时把已经生成的部分留下来，不丢内容也不留半截
			const partial = sinkTarget.currentStreamText();
			if (target && target.qas[index] && !target.qas[index].answer) {
				target.qas[index].answer = partial
					? t('{v0}\n\n（请求中断：{v1}，以上为已完成部分）', { v0: partial, v1: message })
					: t('（请求失败：{v0}）', { v0: message });
				await this.repository.save(latest);
			}
		} finally {
			this.abortController = null;
			sinkTarget.endStream();
			await sinkTarget.reload();
			sinkTarget.setActiveEntry(entry.id);
		}
	}

	abortCurrent(): void {
		this.abortController?.abort();
		this.abortController = null;
	}

	/** 选区前后各取一段正文作为上下文 */
	private buildContext(sourceText: string, entry: AnnotationEntry): string {
		if (!sourceText || entry.kind !== 'text') return '';
		const at = sourceText.indexOf(entry.selection);
		if (at === -1) return '';
		const half = Math.floor(this.settings.contextChars / 2);
		const start = Math.max(0, at - half);
		const end = Math.min(sourceText.length, at + entry.selection.length + half);
		return stripAnchors(sourceText.slice(start, end), this.settings.tagName).trim();
	}

	/** 跳到锚点在原文里的位置并选中 */
	/**
	 * 待兑现的闪烁请求。
	 * 从索引点进来时阅读器视图可能刚在创建（翻页、渲染都在后面），
	 * 这时候谁都无法立刻闪——把请求挂在这里，让视图画完那一页之后自己兑现。
	 */
	pendingFlash: { id: string; filePath: string; until: number } | null = null;

	/**
	 * 兜底保险：把闪烁交给视图之后，过一会儿检查请求有没有被兑现。
	 * 视图没建出来、渲染卡住、实例被换掉……任何一条路走岔，这里都能补上一次闪烁，
	 * 保证「点了就该闪」这件事不依赖某一条代码路径。
	 */
	private armFlashFallback(id: string, file: TFile): void {
		window.setTimeout(() => {
			const pending = this.pendingFlash;
			if (!pending || pending.id !== id || pending.filePath !== file.path) return; // 已经闪过了
			const view = this.pdfViewFor(file.path);
			if (!view) return;
			this.pendingFlash = null;
			void view.flashVisualById(id);
		}, 1800);
	}

	/**
	 * 跳到批注之后让它闪两下。
	 * 同一页批注一多，光靠选区很难一眼找到位置；闪两下是最省事的定位手段。
	 * PDF 的标记是异步画出来的（翻页后要等渲染），所以要重试几次直到元素出现。
	 */
	private flashEntry(id: string, file: TFile, attempt = 0): void {
		const selector = `[data-pickme-id="${CSS.escape(id)}"]`;
		// PDF 不在这一层处理：那边要等页面真正渲染完再闪，见 PickmePdfView.flashWhenRendered
		if (file.extension === 'pdf') return;
		const found: HTMLElement[] = [];
		const visible = (el: HTMLElement) => {
			const rect = el.getBoundingClientRect();
			return rect.width > 0 && rect.height > 0;
		};
		for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || view.file?.path !== file.path) continue;
			view.containerEl.querySelectorAll<HTMLElement>(`.pickme-mark${selector}`).forEach((el) => {
				if (visible(el)) found.push(el);
			});
		}
		if (found.length === 0) {
			// 冷启动要等：从索引点进来时，视图可能刚创建、页面还没画完（实测最长 ~3 秒）
			if (attempt < 30) window.setTimeout(() => this.flashEntry(id, file, attempt + 1), 200);
			return;
		}
		for (const el of found) {
			el.addClass('is-flash');
			el.scrollIntoView({ block: 'center', behavior: 'smooth' });
		}
		// 0.42s × 2 次，留一点余量再摘掉类
		window.setTimeout(() => found.forEach((el) => el.removeClass('is-flash')), 1000);
	}

	async jumpToAnchor(id: string, file?: TFile | null): Promise<void> {
		const target = file ?? this.activeFile();
		if (!target) {
			new Notice(t('pickme：当前没有打开的文档'));
			return;
		}

		// PDF 批注没有正文锚点，跳到对应页并高亮矩形
		if (target.extension === 'pdf') {
			const { doc: pdfDoc } = await this.repository.loadFor(target);
			let detached = false;
			let pdfEntry = pdfDoc.entries.find((item) => item.id === id);
			if (!pdfEntry) {
				// 批注文件里记的源路径可能已经过期（文档被移动/改名过，且当时没有人在监听），
				// 这时按 id 在所有批注文件里找一遍：找到就把批注文件搬到新家（数据自愈），再照常跳转
				const groups = await this.repository.indexData();
				for (const group of groups) {
					const hit = group.entries.find((item) => item.id === id);
					if (!hit) continue;
					pdfEntry = hit;
					detached = true;
					if (group.sourcePath !== target.path) {
						try {
							if (await this.repository.moveSidecarFor(group.sourcePath, target.path)) await this.refreshViews();
						} catch {
							// 搬不动也没关系：下面走「临时框」定位
						}
					}
					break;
				}
			}
			if (!pdfEntry?.pdf) {
				new Notice(t('pickme：找不到批注 {v0}', { v0: id }));
				return;
			}
			// 先把「待闪烁」挂上：视图可能是新建的，画完那一页由它自己兑现
			this.pendingFlash = { id, filePath: target.path, until: Date.now() + 8000 };
			const openView = this.pdfViewFor(target.path);
			if (openView) {
				await this.app.workspace.revealLeaf(openView.leaf);
				if (detached) await openView.flashVisual(pdfEntry);
				else await openView.focusEntry(id);
				if (!detached) this.armFlashFallback(id, target);
				return;
			}
			if (this.settings.pdfViewerEnabled) {
				await this.openPdfInPickmeView(target);
				// openPdfInPickmeView 返回时视图往往还没建完，等一下再交给它
				for (let attempt = 0; attempt < 30; attempt++) {
					const created = this.pdfViewFor(target.path);
					if (created) {
						await this.app.workspace.revealLeaf(created.leaf);
						if (detached) await created.flashVisual(pdfEntry);
						else await created.focusEntry(id);
						if (!detached) this.armFlashFallback(id, target);
						return;
					}
					await new Promise((resolve) => window.setTimeout(resolve, 200));
				}
				return;
			}
			const pdfLeaf = this.app.workspace.getLeaf(false);
			await pdfLeaf.openFile(target, { eState: { subpath: `#page=${pdfEntry.pdf.page}` } });
			return;
		}

		const text = await this.repository.sourceTextOf(target);
		const pair = scanAnchors(text, this.settings.tagName).pairs.find((item) => item.id === id);
		if (!pair) {
			new Notice(t('pickme：原文里找不到锚点 {v0}', { v0: id }));
			return;
		}
		const leaf = this.app.workspace.getLeaf(false);
		await leaf.openFile(target);
		const view = leaf.view instanceof MarkdownView ? leaf.view : null;
		if (!view) return;
		const editor = view.editor;
		const from = editor.offsetToPos(pair.start);
		const to = editor.offsetToPos(pair.end);
		editor.setSelection(from, to);
		editor.scrollIntoView({ from, to }, true);
		this.flashEntry(id, target);
	}

	/** 侧边栏或正文里点击批注：跳转并高亮 */
	async focusEntry(id: string): Promise<void> {
		const sidebar = await this.openSidebar();
		sidebar.setActiveEntry(id);
		await this.jumpToAnchor(id);
	}

	/** 失效锚点按选区文本重新绑定 */
	async rebindEntry(id: string): Promise<void> {
		const file = this.activeFile();
		if (!file) return;
		const { doc } = await this.repository.loadFor(file);
		const entry = doc.entries.find((item) => item.id === id);
		if (!entry || entry.kind !== 'text') {
			new Notice(t('pickme：这条批注没有文本锚点'));
			return;
		}
		const text = await this.repository.sourceTextOf(file);
		const cleaned = removeAnchors(text, id, this.settings.tagName);
		const occurrences = countOccurrences(cleaned, entry.selection);
		if (occurrences !== 1) {
			new Notice(t('pickme：原文里匹配到 {v0} 处，无法自动绑定，请手动处理', { v0: occurrences }));
			return;
		}
		const newId = this.uniqueAnchorId(cleaned);
		const at = cleaned.indexOf(entry.selection);
		const updated = insertAnchors(cleaned, at, at + entry.selection.length, newId, this.settings.tagName);
		await this.app.vault.process(file, () => updated);
		await this.repository.rebindEntry(file, id, newId);
		new Notice(t('pickme：已重新绑定为 {v0}', { v0: newId }));
		await this.refreshViews();
	}

	/** 荧光笔高亮的简单批注：只改这条的备注，不牵扯 AI 问答 */
	async saveNote(id: string, file: TFile, note: string): Promise<void> {
		await this.repository.updateEntry(file, id, { note: note || undefined });
		await this.refreshViews();
	}

	async deleteEntry(id: string, source?: TFile): Promise<void> {
		const file = source ?? this.activeFile();
		if (!file) return;
		await this.repository.deleteEntry(file, id);
		if (!source) new Notice(t('pickme：已删除批注 {v0}', { v0: id }));
		await this.refreshViews();
	}

	async deleteAllEntries(): Promise<void> {
		const file = this.activeFile();
		if (!file) return;
		const { doc } = await this.repository.loadFor(file);
		for (const entry of doc.entries) {
			await this.repository.deleteEntry(file, entry.id);
		}
		new Notice(t('pickme：已删除 {v0} 条批注', { v0: doc.entries.length }));
		await this.refreshViews();
	}

	async ensureDefaultTemplates(notify: boolean): Promise<void> {
		const created = await this.templates.ensureDefaults();
		if (notify) new Notice(t('pickme：新建 {v0} 个模板', { v0: created }));
	}

	/**
	 * 把老版本的默认位置迁到插件自管的位置。
	 * 只认「还是老默认值」这一种情况——用户自己改过的目录不动。
	 */
	async migrateLegacyDefaults(): Promise<void> {
		const moved: string[] = [];
		if (this.settings.templateDir === LEGACY_TEMPLATE_DIR) {
			this.settings.templateDir = this.resolvePluginDir('', 'templates');
			moved.push(t('模板目录'));
		}
		if (moved.length === 0) return;
		await this.saveSettings();
		new Notice(
			t('pickme：{v0} 已改到插件自己的位置，旧文件没有动，需要的话自己清理', { v0: moved.join(', ') }),
		);
	}

	/**
	 * 在模板目录里新建一个模板文件并打开。
	 * 文件名就是模板名（面板下拉里显示的就是它），正文是提示词。
	 */
	async createTemplate(): Promise<void> {
		const dir = this.templates.dir();
		if (!dir) {
			new Notice(t('pickme：请先在设置里填写模板目录'));
			return;
		}
		await this.templates.io.ensureFolder(dir);
		const base = t('新建模板');
		let name = base;
		let index = 2;
		while ((await this.templates.io.readText(`${dir}/${name}.md`)) !== null) {
			name = `${base} ${index}`;
			index += 1;
		}
		const path = `${dir}/${name}.md`;
		await this.templates.io.writeText(path, TEMPLATE_SKELETON);
		const file = this.app.vault.getAbstractFileByPath(path);
		const leaf = file instanceof TFile ? this.app.workspace.getLeaf(false) : null;
		if (file instanceof TFile && leaf) {
			await leaf.openFile(file);
			new Notice(t('pickme：已新建模板「{v0}」，文件名就是模板名，正文就是提示词', { v0: name }));
			return;
		}
		// 模板目录在隐藏目录下时 Obsidian 不索引它，只能在访达/编辑器里改
		new Notice(t('pickme：已新建模板「{v0}」，在 {v1} 下，用访达打开就能编辑', { v0: name, v1: dir }));
	}

	/** 删掉一个模板文件；设置页已经问过一遍了 */
	async deleteTemplate(name: string): Promise<void> {
		const removed = await this.templates.remove(name);
		if (!removed) {
			new Notice(t('pickme：没找到模板「{v0}」', { v0: name }));
			return;
		}
		if (this.settings.hiddenTemplates.includes(name)) {
			this.settings.hiddenTemplates = this.settings.hiddenTemplates.filter((item) => item !== name);
			await this.saveSettings();
		}
		await this.refreshViews();
		new Notice(t('pickme：已删除模板「{v0}」', { v0: name }));
	}

	/** 在系统文件管理器里打开模板目录 */
	openTemplateDir(): void {
		const dir = this.templates.dir();
		if (!dir) {
			new Notice(t('pickme：还没有模板目录'));
			return;
		}
		const app = this.app as unknown as { showInFolder?: (path: string) => void };
		try {
			if (typeof app.showInFolder === 'function') {
				app.showInFolder(dir);
				return;
			}
		} catch {
			// 落到下面的兜底
		}
		new Notice(t('pickme：模板目录在 {v0}', { v0: dir }));
	}

	/** 改完批注目录、输入框失焦后再问要不要搬（一个字符一个字符改时不打扰） */
	async askMigrate(from: string): Promise<void> {
		const to = this.settings.annotationDir;
		if (!to || to === from || !(await this.hasAnnotationsToMigrate())) return;
		new Notice(
			t('pickme：批注目录已改成 {v0}，现有批注还在旧目录——需要搬的话点设置里的「迁移」', { v0: to }),
			8000,
		);
	}

	async migrateAnnotations(): Promise<void> {
		const from = this.lastAnnotationDir;
		const to = this.settings.annotationDir;
		if (!from || from === to) {
			new Notice(t('pickme：批注目录没有变化，无需迁移'));
			return;
		}
		// 逐文件「写新的、删旧的」：搬完只有新目录有，旧目录会剩下空文件夹
		const moved = await this.repository.migrate(from, to);
		this.lastAnnotationDir = to;
		const left = await this.repository.countFilesIn(from);
		new Notice(
			left > 0
				? t('pickme：已迁移 {v0} 个文件到 {v1}，旧目录还剩 {v2} 个', { v0: moved, v1: to, v2: left })
				: t('pickme：已迁移 {v0} 个文件到 {v1}，旧目录已空（空文件夹留着，可以自己删）', {
						v0: moved,
						v1: to,
					}),
		);
	}

	/**
	 * 索引表是插件内部产物，不对外暴露设置项：固定放在插件目录里（隐藏，不占库结构）。
	 * 用户看批注走命令「打开批注索引」那个侧边栏。
	 */
	indexFilePath(): string {
		return this.resolvePluginDir('', INDEX_FILE_NAME);
	}

	/** 批注变动后延迟合一次索引写入 */
	scheduleIndexRefresh(): void {
		if (this.indexTimer !== null) window.clearTimeout(this.indexTimer);
		this.indexTimer = window.setTimeout(() => {
			this.indexTimer = null;
			void this.repository.buildIndex(this.indexFilePath());
		}, 1200);
	}

	/** 索引表缺失时补一份（已经在的话不动，免得每次启动都重写） */
	async ensureIndexFile(): Promise<void> {
		const path = this.indexFilePath();
		if (!path) return;
		const exists = await this.app.vault.adapter.exists(path);
		if (exists) return;
		await this.repository.buildIndex(path);
	}

	/** 旧批注目录里还有文件吗，用于提示是否迁移 */
	async hasAnnotationsToMigrate(): Promise<boolean> {
		if (!this.lastAnnotationDir || this.lastAnnotationDir === this.settings.annotationDir) return false;
		return (await this.repository.countFilesIn(this.lastAnnotationDir)) > 0;
	}

	/** 锚点标签名批量替换：把已批注文档里的旧标签换成新标签 */
	async replaceTagName(from: string, to: string): Promise<void> {
		const oldTag = from.trim() || DEFAULT_TAG;
		const newTag = to.trim() || DEFAULT_TAG;
		if (oldTag === newTag) {
			new Notice(t('pickme：标签名没有变化'));
			return;
		}
		const pattern = new RegExp(`</?${escapeRegExp(oldTag)}(\\s+id="[^"]*")?\\s*/?>`, 'g');
		const sources = new Set<string>();
		for (const sidecar of await this.repository.annotationFiles()) {
			const sourcePath = this.repository.sourcePathOf(sidecar);
			if (sourcePath) sources.add(sourcePath);
		}
		let touched = 0;
		for (const path of sources) {
			const file = this.app.vault.getAbstractFileByPath(path);
			if (!(file instanceof TFile)) continue;
			const before = await this.repository.sourceTextOf(file);
			pattern.lastIndex = 0;
			if (!pattern.test(before)) continue;
			pattern.lastIndex = 0;
			await this.app.vault.process(file, (text) =>
				text.replace(pattern, (whole) => whole.replace(oldTag, newTag)),
			);
			touched += 1;
		}
		new Notice(t('pickme：已把 {v0} 个文档的锚点标签从 {v1} 换成 {v2}', { v0: touched, v1: oldTag, v2: newTag }));
		await this.refreshViews();
	}

	/** 从接口拉取模型列表，写进设置供侧边栏下拉使用 */
	async fetchModelList(): Promise<void> {
		if (!this.settings.apiBaseUrl.trim()) {
			new Notice(t('pickme：请先填写接口地址'));
			return;
		}
		try {
			const models = await listModels(
				this.settings.apiBaseUrl,
				this.settings.apiKey,
				this.settings.transport,
			);
			if (models.length === 0) {
				new Notice(t('pickme：接口没有返回任何模型'));
				return;
			}
			this.settings.modelOptions = models;
			await this.saveSettings();
			new Notice(t('pickme：已拉取 {v0} 个模型，侧边栏下拉即可选择', { v0: models.length }));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(t('pickme：拉取模型列表失败 {v0}', { v0: message }));
		}
	}

	async testConnection(): Promise<void> {
		try {
			const result = await chat({
				baseUrl: this.settings.apiBaseUrl,
				apiKey: this.settings.apiKey,
				model: this.settings.model,
				temperature: 0,
				system: '',
				user: t('回复两个字：可用'),
				stream: false,
				transport: this.settings.transport,
			});
			new Notice(t('pickme：连接正常，返回「{v0}」', { v0: result.text.trim().slice(0, 20) }));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(t('pickme：连接失败 {v0}', { v0: message }));
		}
	}

	/**
	 * 记住某个 PDF 读到第几页。滚动时调用很频繁，所以内存里立刻更新、落盘节流：
	 * 一个文件在设置里只占一行，超过 200 个文件就按「最久没读」丢掉。
	 */
	rememberPdfPage(path: string, page: number): void {
		const map = this.settings.pdfLastPage;
		if (map[path] === page) return;
		// 先删再写，让这个键移到队尾：对象键按插入顺序，淘汰时丢队首就是丢最久没读的
		if (path in map) delete map[path];
		map[path] = page;
		const keys = Object.keys(map);
		if (keys.length > 200) for (const key of keys.slice(0, keys.length - 200)) delete map[key];
		this.scheduleSettingsSave();
	}

	/** 节流的设置落盘：1.2 秒内的多次改动合成一次写盘 */
	private settingsSaveTimer: number | null = null;

	private scheduleSettingsSave(): void {
		if (this.settingsSaveTimer !== null) return;
		this.settingsSaveTimer = window.setTimeout(() => {
			this.settingsSaveTimer = null;
			void this.saveSettings();
		}, 1200);
	}

	/** 退出前把还没落盘的设置写掉 */
	flushSettingsSave(): void {
		if (this.settingsSaveTimer === null) return;
		window.clearTimeout(this.settingsSaveTimer);
		this.settingsSaveTimer = null;
		void this.saveSettings();
	}

	/** 供命令与侧边栏读取当前文档的批注 */
	async loadDoc(file: TFile): Promise<AnnotationDoc> {
		const { doc } = await this.repository.loadFor(file);
		return doc;
	}
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countOccurrences(text: string, needle: string): number {
	if (!needle) return 0;
	let count = 0;
	let index = text.indexOf(needle);
	while (index !== -1) {
		count += 1;
		index = text.indexOf(needle, index + needle.length);
	}
	return count;
}
