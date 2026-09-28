import { FileView, Notice, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import { t, tKey } from '../i18n.ts';
import type PickmePlugin from '../main.ts';
import { loadPdf, renderPage } from './pdfjs.ts';
import type { PDFDocumentProxy, PDFPageProxy, RenderTaskHandle } from './pdfjs.ts';
import { decideWheel } from './paging.ts';
import { flattenOutline } from './outline.ts';
import type { RawOutlineItem, TocEntry } from './outline.ts';
import { dragRect, hasMinimumSize, itemBox, linesText, strokeToLines, textInRect } from '../core/pdftext.ts';
import type { LineBox, Point, RawTextItem, StrokePoint } from '../core/pdftext.ts';
import { pdfToScreenRect, screenToPdfPoint, screenToPdfRect, toNormalized } from '../core/pdfgeom.ts';
import type { Rect } from '../core/pdfgeom.ts';
import { fingerprint, newAnchorId } from '../core/anchor.ts';
import { nowIso } from '../util.ts';
import { shapeKindLabel, shapesOf } from '../core/types.ts';
import type { AnnotationEntry, PdfAnchorInfo, PdfShape } from '../core/types.ts';
import { askPanelOf, openAskPanel as mountAskPanel } from '../ui/askPanel.ts';
import type { AskPanelAnchor } from '../ui/askPanel.ts';

export const VIEW_TYPE_PICKME_PDF = 'pickme-pdf-view';

/** 单页渲染的上限，超过就当这次渲染没成，把状态栏交给用户手动重试 */
const RENDER_TIMEOUT_MS = 20000;
/** 视口外上下各多渲染几页，滚动时不至于看到空白 */
const RENDER_MARGIN = 1;
/** 离视口超过这么多页就把画布释放掉（回到附近再画），避免几十页画布一起吃内存 */
const KEEP_MARGIN = 4;

/** 一页的槽位：容器、画布、标记层与渲染状态 */
interface PageSlot {
	index: number;
	sheet: HTMLElement;
	canvas: HTMLCanvasElement;
	overlay: HTMLElement;
	marquee: HTMLElement;
	page: PDFPageProxy | null;
	/** scale = 1 时的 PDF 尺寸（pt），已含页面旋转 */
	base: [number, number];
	/** 未旋转的 PDF 用户空间尺寸：文字项坐标在这个空间里，旋转页的换算必须用它 */
	viewSize: [number, number];
	/** 页面旋转角，0/90/180/270 */
	rotation: number;
	/** 荧光笔拖动的实时吸附预览层 */
	preview: HTMLElement;
	/** 该页的文字项：框选后用来把区域里的文字摘出来，随截图一起送给模型 */
	text: RawTextItem[];
	rendered: boolean;
	rendering: boolean;
	failed: boolean;
	task: RenderTaskHandle | null;
}

/** 焦点在输入框里时别把按键抢走（页码框里要能正常按左右键） */
function isEditableElement(el: Element | null): boolean {
	return el instanceof HTMLElement && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = window.setTimeout(() => reject(new Error(message)), ms);
		promise.then(
			(value) => {
				window.clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				window.clearTimeout(timer);
				reject(error instanceof Error ? error : new Error(String(error)));
			},
		);
	});
}

/**
 * 自带 pdf.js 查看器：像原生 PDF 阅读器一样把所有页竖着排在一个滚动条里（连续滚动），
 * 只渲染视口附近的页、离远了释放画布；矩形框选直接生成 PDF 批注。
 */
export class PickmePdfView extends FileView {
	private plugin: PickmePlugin;
	private pdf: PDFDocumentProxy | null = null;
	/** 视口顶部所在的页（1 起） */
	private pageNumber = 1;
	private scale = 1.2;
	private slots: PageSlot[] = [];
	/** 每页在滚动内容里的纵向位置与高度，重建/缩放后重算（不在滚动时反复读布局） */
	private tops: number[] = [];
	private heights: number[] = [];
	private scrollEl: HTMLElement | null = null;
	private stageEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private pageInput: HTMLInputElement | null = null;
	private dragSlot: PageSlot | null = null;
	private dragStart: Point | null = null;
	/** 荧光笔这一笔的屏幕采样点：吸附预览与建批注都用它 */
	private strokePoints: Point[] = [];
	/** 拖动预览合并到一帧里重算 */
	private previewScheduled = false;
	/** 这次按下的落点在已有的框上——抬手时要开这条批注而不是新建 */
	private pendingMarkId: string | null = null;
	private panelEntryId: string | null = null;
	/** 面板序号：旧面板被顶掉时的回调不能把新面板的状态清掉 */
	private panelSeq = 0;
	/** 刚框出来的那一次：按「哪一页 + 页内矩形」记，滚动后还能换算成屏幕位置 */
	private panelAnchorSlot: PageSlot | null = null;
	private panelAnchorRect: Rect | null = null;
	/** 待渲染队列与泵状态（串行渲染，避免同时开好几张画布） */
	private renderQueue: PageSlot[] = [];
	private pumping = false;
	private wheelAccum = 0;
	private wheelDir = 0;
	/** 键盘只绑一次 */
	private keysBound = false;
	/** 滚动事件合并到一帧里处理 */
	private scrollScheduled = false;

	/**
	 * 工具栏上的图标按钮：图标按钮没有可见文字，标签挂在 aria-label/title 上，
	 * 切语言时按登记的顺序重写（key 给函数是因为有的按钮文案随状态变）。
	 */
	private labelButtons: Array<{ el: HTMLElement; key: () => string }> = [];
	/** 工具栏右侧的「共 N 页」 */
	private pageTotalEl: HTMLElement | null = null;
	/** 缩放百分比按钮，点一下回到 100% */
	private zoomButton: HTMLButtonElement | null = null;
	/** 「显示/隐藏高亮」按钮，图标与文案随开关状态变 */
	private markButton: HTMLButtonElement | null = null;
	/** 标注方式按钮：荧光笔 / 框选，互斥 */
	private highlighterButton: HTMLButtonElement | null = null;
	private areaButton: HTMLButtonElement | null = null;
	/** 目录面板与它的开关按钮（PDF 没目录时按钮不显示） */
	private tocEl: HTMLElement | null = null;
	private tocButton: HTMLButtonElement | null = null;
	private tocEntries: TocEntry[] = [];
	private tocItems: HTMLElement[] = [];
	private tocOpen = true;

	constructor(leaf: WorkspaceLeaf, plugin: PickmePlugin) {
		super(leaf);
		this.plugin = plugin;
		// 窗口在后台时 pdf.js 不出帧、渲染画不出来；回到前台补一次可见页的渲染，
		// 省得用户以为 PDF 坏了（配合渲染超时守卫使用）
		this.registerDomEvent(document, 'visibilitychange', () => {
			if (!document.hidden) this.updateViewport(true);
		});
	}

	getViewType(): string {
		return VIEW_TYPE_PICKME_PDF;
	}

	getDisplayText(): string {
		return this.file?.basename ?? 'Pick Me PDF';
	}

	getIcon(): string {
		return 'file-text';
	}

	canAcceptExtension(extension: string): boolean {
		return extension === 'pdf';
	}

	async onLoadFile(file: TFile): Promise<void> {
		this.scale = this.plugin.settings.pdfDefaultScale;
		this.pageNumber = 1;
		this.buildShell();
		this.bindKeys();
		await this.loadDocument(file);
	}

	async onUnloadFile(): Promise<void> {
		// 视图卸载不是用户取消：刚划的批注要留着
		askPanelOf(this.contentEl)?.close('handover');
		this.panelEntryId = null;
		this.panelAnchorSlot = null;
		this.panelAnchorRect = null;
		this.renderQueue = [];
		for (const slot of this.slots) {
			try {
				slot.task?.cancel();
			} catch {
				// 取消失败不影响卸载
			}
		}
		try {
			await this.pdf?.destroy();
		} catch {
			// 销毁失败不影响卸载
		}
		this.pdf = null;
		this.slots = [];
		this.tops = [];
		this.tocEntries = [];
		this.tocItems = [];
		this.contentEl.empty();
	}

	/** 命令「在 PDF 上框选批注」的落点：把查看器拿到前台并提示操作方式 */
	async focusSelectionMode(): Promise<void> {
		await this.app.workspace.revealLeaf(this.leaf);
		this.setAnnotateMode('area');
	}

	/** 跳到某条批注：滚到对应页并闪一下它的框 */
	async focusEntry(id: string): Promise<void> {
		const file = this.file;
		if (!file) return;
		const doc = await this.plugin.loadDoc(file);
		const entry = doc.entries.find((item) => item.id === id);
		if (!entry?.pdf) return;
		const slot = this.slots[entry.pdf.page - 1];
		if (slot) {
			this.scrollToPage(entry.pdf.page);
			// 目标页可能还没画，先把渲染排到队首
			this.queueRenders([slot], true);
		}
		const mark = slot?.overlay.querySelector(`[data-pickme-id="${id}"]`);
		if (mark instanceof HTMLElement) {
			mark.addClass('is-flash');
			window.setTimeout(() => mark.removeClass('is-flash'), 1200);
		}
	}

	/**
	 * 在当前 PDF 页面内打开提问面板。
	 * 交互全部留在页面上，侧边栏只负责查看已有批注，日常不必打开。
	 */
	openAskPanel(entryId: string, anchorSlot?: PageSlot | null, screenRect?: Rect, fresh = false): void {
		const file = this.file;
		if (!file) return;
		this.panelSeq += 1;
		const seq = this.panelSeq;
		// 面板一开就说明用户已经在这条上干活了，Esc 不再收回它
		this.freshHighlight = null;
		this.panelEntryId = entryId;
		this.panelAnchorSlot = anchorSlot ?? null;
		this.panelAnchorRect = screenRect ?? null;
		// 正在读的这条完整显形，同页其它批注退到背景（样式见 styles.css 的 is-active）
		this.applyActiveMark();
		mountAskPanel({
			plugin: this.plugin,
			host: this.contentEl,
			file,
			entryId,
			fresh,
			resolveAnchor: this.resolvePanelAnchor,
			onClose: () => {
				// 已经有更新的面板接管了（点同一条再看一眼、或换了一条）：
				// 这时候不能把状态清掉，否则选中态会莫名消失
				if (this.panelSeq !== seq) return;
				this.panelEntryId = null;
				this.panelAnchorSlot = null;
				this.panelAnchorRect = null;
				this.applyActiveMark();
			},
		});
	}

	/** 高亮按钮的文案跟着开关状态走 */
	private refreshMarkButton(): void {
		const button = this.markButton;
		if (!button) return;
		const on = this.plugin.settings.showMarks;
		setIcon(button, on ? 'eye' : 'eye-off');
		button.toggleClass('is-off', !on);
		this.applyButtonLabel(button, on ? tKey('隐藏高亮') : tKey('显示高亮'));
	}

	/** 批注增删改后重画页面上的标记（删除批注时要把高亮一起收掉） */
	async refreshMarks(): Promise<void> {
		this.refreshMarkButton();
		await this.drawAllMarks();
	}

	/** 切语言后刷新工具栏按钮文案 */
	refreshLabels(): void {
		for (const item of this.labelButtons) this.applyButtonLabel(item.el, item.key());
		this.refreshMarkButton();
		this.refreshModeButtons();
		this.refreshTocButton();
		this.refreshZoomLabel();
		this.setStatus(this.readyStatusText());
	}

	/** 图标按钮的可见文字就是 aria-label / 悬停提示 */
	private applyButtonLabel(el: HTMLElement, key: string): void {
		el.setAttribute('aria-label', t(key));
		el.setAttribute('title', t(key));
	}

	/** 工具栏分组之间的一条细线 */
	private addToolbarSep(parent: HTMLElement): void {
		parent.createDiv({ cls: 'pickme-pdf-sep' });
	}

	/** 工具栏上的图标按钮：少占地方，也不随语言换字宽 */
	private iconButton(
		parent: HTMLElement,
		icon: string,
		key: string | (() => string),
		onClick: () => void,
		extraCls = '',
	): HTMLButtonElement {
		const button = parent.createEl('button', { cls: `pickme-icon-button ${extraCls}`.trim() });
		setIcon(button, icon);
		button.onclick = onClick;
		const keyOf = typeof key === 'function' ? key : () => key;
		this.labelButtons.push({ el: button, key: keyOf });
		this.applyButtonLabel(button, keyOf());
		return button;
	}

	private refreshZoomLabel(): void {
		this.zoomButton?.setText(`${Math.round(this.scale * 100)}%`);
	}

	/** 工具栏上的「/ 共 N 页」（文档没加载完时留空） */
	private refreshPageTotal(): void {
		const total = this.slots.length;
		this.pageTotalEl?.setText(total > 0 ? `/ ${total}` : '');
		this.pageTotalEl?.setAttribute('title', t('共 {v0} 页', { v0: total }));
	}

	/** 面板定位：优先贴着该批注的框，退回到刚框出来的矩形（都按屏幕坐标算） */
	private resolvePanelAnchor = (): AskPanelAnchor | null => {
		const hostRect = this.contentEl.getBoundingClientRect();
		const slot = this.panelAnchorSlot;
		if (this.panelEntryId) {
			for (const item of this.slots) {
				const mark = item.overlay.querySelector(`[data-pickme-id="${this.panelEntryId}"]`);
				if (!mark) continue;
				const rect = mark.getBoundingClientRect();
				return {
					left: rect.left - hostRect.left,
					top: rect.top - hostRect.top,
					width: rect.width,
					height: rect.height,
				};
			}
		}
		const local = this.panelAnchorRect;
		if (!local || !slot) return null;
		const sheetRect = slot.sheet.getBoundingClientRect();
		return {
			left: sheetRect.left - hostRect.left + local[0],
			top: sheetRect.top - hostRect.top + local[1],
			width: local[2] - local[0],
			height: local[3] - local[1],
		};
	};

	// ---------- 界面 ----------

	private buildShell(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('pickme-pdf');

		// 工具栏按功能分段，段与段之间一条细线：目录 ｜ 翻页 ｜ 缩放 ｜ 显示，状态提示靠最右
		const toolbar = root.createDiv({ cls: 'pickme-pdf-toolbar' });
		this.labelButtons = [];

		// 目录放最左：它是「看全文结构」的入口，比翻页更宏观；PDF 没书签时整个按钮藏掉
		this.tocOpen = this.plugin.settings.pdfTocOpen;
		this.tocButton = this.iconButton(
			toolbar,
			'list-tree',
			() => (this.tocOpen ? tKey('隐藏目录') : tKey('目录')),
			() => this.toggleToc(),
			'pickme-pdf-toc-toggle',
		);
		this.addToolbarSep(toolbar);

		// 翻页：两个箭头夹一个页码框，右边跟「/ 共 N 页」
		this.iconButton(toolbar, 'chevron-left', tKey('上一页'), () => this.scrollToPage(this.pageNumber - 1));
		this.pageInput = toolbar.createEl('input', { cls: 'pickme-pdf-page', type: 'text' });
		this.pageInput.value = String(this.pageNumber);
		this.pageInput.onchange = () => {
			const parsed = Number(this.pageInput?.value ?? '1');
			this.scrollToPage(Number.isFinite(parsed) ? parsed : 1);
		};
		this.pageTotalEl = toolbar.createSpan({ cls: 'pickme-pdf-total' });
		this.iconButton(toolbar, 'chevron-right', tKey('下一页'), () => this.scrollToPage(this.pageNumber + 1));
		this.addToolbarSep(toolbar);

		// 缩放：减 / 百分比（点一下回 100%）/ 加 / 适应宽度，都是图标
		this.iconButton(toolbar, 'zoom-out', tKey('缩小'), () => this.setScale(this.scale - 0.2));
		this.zoomButton = toolbar.createEl('button', { cls: 'pickme-pdf-zoom' });
		this.zoomButton.onclick = () => this.setScale(1);
		this.labelButtons.push({ el: this.zoomButton, key: () => tKey('点击恢复 100%') });
		this.iconButton(toolbar, 'zoom-in', tKey('放大'), () => this.setScale(this.scale + 0.2));
		this.iconButton(toolbar, 'chevrons-left-right', tKey('适应宽度'), () => void this.fitWidth());
		this.addToolbarSep(toolbar);

		// 标注方式：荧光笔（拖一笔吸附到文字行）｜框选（拖出一块区域）
		this.highlighterButton = this.iconButton(toolbar, 'highlighter', tKey('荧光笔批注'), () => this.setAnnotateMode('highlight'), 'pickme-pdf-mode');
		this.areaButton = this.iconButton(toolbar, 'box-select', tKey('框选批注'), () => this.setAnnotateMode('area'), 'pickme-pdf-mode');
		this.addToolbarSep(toolbar);

		// 显示：高亮总开关（关掉就是原样的 PDF，只看内容时不被标记打扰）
		this.markButton = this.iconButton(
			toolbar,
			'eye',
			() => (this.plugin.settings.showMarks ? tKey('隐藏高亮') : tKey('显示高亮')),
			() => {
				this.plugin.settings.showMarks = !this.plugin.settings.showMarks;
				void this.plugin.saveSettings();
				void this.plugin.refreshViews();
			},
		);

		this.statusEl = toolbar.createDiv({
			cls: 'pickme-pdf-status',
			text: this.readyStatusText(),
		});
		this.refreshMarkButton();
		this.refreshModeButtons();
		this.refreshZoomLabel();
		this.refreshPageTotal();

		const body = root.createDiv({ cls: 'pickme-pdf-body' });
		this.tocEl = body.createDiv({ cls: 'pickme-pdf-toc' });
		const scroll = body.createDiv({ cls: 'pickme-pdf-scroll' });
		this.scrollEl = scroll;
		this.registerDomEvent(scroll, 'scroll', () => this.onScroll(), { passive: true });
		// 触控板横向滑动＝整页跳；纵向交给原生滚动（连续滚动本来就是一根滚动条）
		this.registerDomEvent(scroll, 'wheel', (event) => this.onWheel(event), { passive: false });
		this.stageEl = scroll.createDiv({ cls: 'pickme-pdf-stage' });
	}

	// ---------- 目录 ----------

	/** 读 PDF 自己的大纲（目录），解析每项的目标页后铺成左侧面板 */
	private async buildToc(): Promise<void> {
		const pdf = this.pdf;
		if (!pdf) return;
		let outline: RawOutlineItem[] | null = null;
		try {
			outline = await pdf.getOutline();
		} catch {
			outline = null;
		}
		if (!outline || outline.length === 0) {
			this.tocEntries = [];
			this.renderToc();
			return;
		}
		// dest 是异步解析的，先按节点对象记下页码，再交给纯函数摊平
		const pages = new Map<RawOutlineItem, number | null>();
		const walk = async (items: RawOutlineItem[]): Promise<void> => {
			for (const item of items) {
				pages.set(item, await this.resolveDestPage(item.dest));
				if (item.items && item.items.length > 0) await walk(item.items);
			}
		};
		await walk(outline);
		this.tocEntries = flattenOutline(outline, (item) => pages.get(item) ?? null);
		this.renderToc();
	}

	/** 把一项的 dest 解析成页码（1 起）；命名目标、外部链接都返回 null */
	private async resolveDestPage(dest: unknown): Promise<number | null> {
		const pdf = this.pdf;
		if (!pdf || dest === null || dest === undefined) return null;
		try {
			const explicit = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
			if (!Array.isArray(explicit) || explicit.length === 0) return null;
			const index = await pdf.getPageIndex(explicit[0] as Parameters<typeof pdf.getPageIndex>[0]);
			return Number.isFinite(index) ? index + 1 : null;
		} catch {
			return null;
		}
	}

	private renderToc(): void {
		const toc = this.tocEl;
		if (!toc) return;
		toc.empty();
		this.tocItems = [];
		for (const entry of this.tocEntries) {
			const item = toc.createDiv({ cls: 'pickme-pdf-toc-item' });
			item.setText(entry.title);
			// 注意：setCssProps 传 camelCase 键在这个版本不落地（内联样式为空），直接赋 style 才稳
			item.style.paddingLeft = `${8 + entry.depth * 12}px`;
			item.setAttribute('data-page', entry.page === null ? '' : String(entry.page));
			item.setAttribute('title', entry.page === null ? entry.title : `${entry.title} · ${t('第 {v0} 页', { v0: entry.page })}`);
			if (entry.page === null) item.addClass('is-nolink');
			item.onclick = () => {
				if (entry.page !== null) this.scrollToPage(entry.page);
			};
			this.tocItems.push(item);
		}
		this.refreshTocButton();
		this.applyTocVisibility();
		this.highlightToc();
	}

	/** 滚动时把当前所在的那一项点亮 */
	private highlightToc(): void {
		if (!this.tocItems.length) return;
		let current: HTMLElement | null = null;
		for (const item of this.tocItems) {
			const page = Number(item.getAttribute('data-page') ?? '');
			item.toggleClass('is-current', false);
			if (Number.isFinite(page) && page <= this.pageNumber) current = item;
		}
		current?.toggleClass('is-current', true);
	}

	private refreshTocButton(): void {
		const button = this.tocButton;
		if (!button) return;
		// 没目录就不摆这个按钮
		const usable = this.tocEntries.length > 0;
		button.toggleClass('is-hidden', !usable);
		button.toggleClass('is-active', usable && this.tocOpen);
		this.applyButtonLabel(button, this.tocOpen ? tKey('隐藏目录') : tKey('目录'));
	}

	private applyTocVisibility(): void {
		this.tocEl?.toggleClass('is-hidden', !this.tocOpen || this.tocEntries.length === 0);
	}

	/** 目录开关：记住选择，下次打开 PDF 沿用 */
	private toggleToc(): void {
		this.tocOpen = !this.tocOpen;
		this.plugin.settings.pdfTocOpen = this.tocOpen;
		void this.plugin.saveSettings();
		this.applyTocVisibility();
		this.refreshTocButton();
		this.measureTops();
		this.updateViewport(true);
	}

	/** 状态文案随标注方式变，切换方式时也用它提示操作 */
	private readyStatusText(): string {
		return this.plugin.settings.pdfAnnotateMode === 'highlight'
			? t('拖一笔划过文字即可批注；左右滑动翻页')
			: t('拖动框选提问；左右滑动翻页');
	}

	// ---------- 文档 ----------

	private async loadDocument(file: TFile): Promise<void> {
		this.setStatus(t('正在载入 PDF…'));
		try {
			const data = await this.app.vault.readBinary(file);
			const loaded = await loadPdf(data);
			this.pdf = loaded.doc;
			await this.buildSheets();
			this.refreshPageTotal();
			this.refreshZoomLabel();
			this.setStatus(this.readyStatusText());
			this.updateViewport(true);
			this.restoreLastPage();
			void this.buildToc();
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(t('载入失败：{v0}', { v0: message }));
			new Notice(t('pickme：PDF 载入失败 {v0}', { v0: message }));
		}
	}

	/**
	 * 建出所有页的槽位并撑起滚动条：先把每页的原始尺寸都取到，滚动条长度一开始就是对的，
	 * 之后滚到哪渲染哪。
	 */
	private async buildSheets(): Promise<void> {
		const stage = this.stageEl;
		const pdf = this.pdf;
		if (!stage || !pdf) return;
		stage.empty();
		this.slots = [];
		const sizes: Array<[number, number]> = [];
		const views: Array<[number, number]> = [];
		const rotations: number[] = [];
		for (let index = 1; index <= pdf.numPages; index += 1) {
			const page = await pdf.getPage(index);
			const base = page.getViewport({ scale: 1 });
			sizes.push([base.width, base.height]);
			// 文字项的 transform 在未旋转的用户空间里，旋转页必须按 view 尺寸与 rotate 换算
			const view = page.view;
			views.push([view[2] - view[0], view[3] - view[1]]);
			rotations.push(((page.rotate % 360) + 360) % 360);
		}
		for (let index = 1; index <= pdf.numPages; index += 1) {
			const base = sizes[index - 1] ?? [595, 842];
			const sheet = stage.createDiv({ cls: 'pickme-pdf-sheet' });
			sheet.setAttribute('data-page', String(index));
			const canvas = sheet.createEl('canvas', { cls: 'pickme-pdf-canvas' });
			const overlay = sheet.createDiv({ cls: 'pickme-pdf-overlay' });
			const marquee = overlay.createDiv({ cls: 'pickme-pdf-marquee' });
			marquee.hide();
			const preview = overlay.createDiv({ cls: 'pickme-pdf-preview' });
			preview.hide();
			const slot: PageSlot = {
				index,
				sheet,
				canvas,
				overlay,
				marquee,
				preview,
				viewSize: views[index - 1] ?? base,
				rotation: rotations[index - 1] ?? 0,
				page: null,
				base,
				text: [],
				rendered: false,
				rendering: false,
				failed: false,
				task: null,
			};
			this.slots.push(slot);
			this.applySlotSize(slot);
			overlay.addEventListener('pointerdown', (event) => this.onPointerDown(slot, event));
			overlay.addEventListener('pointermove', (event) => this.onPointerMove(slot, event));
			overlay.addEventListener('pointerup', (event) => void this.onPointerUp(slot, event));
			overlay.addEventListener('pointercancel', () => {
				this.pendingMarkId = null;
				this.resetDrag();
			});
		}
		this.measureTops();
		await this.drawAllMarks();
	}

	/** 某一页在当前缩放下的显示尺寸（CSS px）——框选坐标换算也用它，保证与 DOM 一致 */
	private slotSize(slot: PageSlot): [number, number] {
		return [Math.floor(slot.base[0] * this.scale), Math.floor(slot.base[1] * this.scale)];
	}

	/** 把槽位的显示尺寸按当前缩放写到 DOM 上（画布没渲染也要占对位置） */
	private applySlotSize(slot: PageSlot): void {
		const [width, height] = this.slotSize(slot);
		slot.sheet.setCssProps({ width: `${width}px`, height: `${height}px` });
		slot.canvas.setCssProps({ width: `${width}px`, height: `${height}px` });
		slot.overlay.setCssProps({ width: `${width}px`, height: `${height}px` });
	}

	/** 记录每页在滚动内容里的位置与高度（只在这里读布局，滚动过程中不再读） */
	private measureTops(): void {
		const scroll = this.scrollEl;
		if (!scroll) return;
		const scrollRect = scroll.getBoundingClientRect();
		this.tops = [];
		this.heights = [];
		for (const slot of this.slots) {
			const rect = slot.sheet.getBoundingClientRect();
			this.tops.push(rect.top - scrollRect.top + scroll.scrollTop);
			this.heights.push(rect.height);
		}
	}

	// ---------- 渲染 ----------

	private onScroll(): void {
		if (this.scrollScheduled) return;
		this.scrollScheduled = true;
		window.requestAnimationFrame(() => {
			this.scrollScheduled = false;
			this.updateViewport();
			this.syncPageInput();
		});
	}

	/** 视口顶部所在的页 = 最后一个顶部不超过视口顶部的页 */
	private currentPageFromScroll(): number {
		const scroll = this.scrollEl;
		if (!scroll || !this.tops.length) return 1;
		// 滚到底时最后一页的顶部永远到不了视口顶部（下面没有内容了），
		// 这时直接算最后一页：否则「翻到最后一页」会被读成上一页，
		// 阅读位置的记忆也就跟着记错。
		const max = scroll.scrollHeight - scroll.clientHeight;
		if (max > 0 && scroll.scrollTop >= max - 2) return this.tops.length;
		const probe = scroll.scrollTop + 16;
		let current = 1;
		for (let i = 0; i < this.tops.length; i += 1) {
			if ((this.tops[i] ?? 0) <= probe) current = i + 1;
			else break;
		}
		return current;
	}

	/** 回到这个文件上次读到的页码（没有记录、或记录就是第一页，就不动） */
	private restoreLastPage(): void {
		const file = this.file;
		if (!file || !this.slots.length) return;
		const saved = Math.round(Number(this.plugin.settings.pdfLastPage[file.path] ?? 1));
		if (!Number.isFinite(saved) || saved <= 1) return;
		this.scrollToPage(Math.min(saved, this.slots.length));
	}

	private syncPageInput(): void {
		const page = this.currentPageFromScroll();
		this.pageNumber = page;
		// 读到哪记到哪：下次打开这个 PDF 从这一页接着看
		if (this.file) this.plugin.rememberPdfPage(this.file.path, page);
		// 用户正在页码框里打字时不要覆盖
		if (this.pageInput && document.activeElement !== this.pageInput) {
			this.pageInput.value = String(page);
		}
		this.highlightToc();
	}

	/**
	 * 按视口范围决定渲染哪些页、释放哪些页：
	 * 视口内的页上下各多渲染 RENDER_MARGIN 页；离视口超过 KEEP_MARGIN 页就把画布释放掉。
	 */
	private updateViewport(force = false): void {
		const scroll = this.scrollEl;
		if (!scroll || !this.slots.length) return;
		const top = scroll.scrollTop;
		const bottom = top + scroll.clientHeight;
		let first = -1;
		let last = -1;
		for (let i = 0; i < this.slots.length; i += 1) {
			const slotTop = this.tops[i] ?? 0;
			if (slotTop > bottom) break;
			if (slotTop + (this.heights[i] ?? 0) < top) continue;
			if (first < 0) first = i;
			last = i;
		}
		if (first < 0) {
			// 视口落在页间空隙里：按当前页算
			const current = this.currentPageFromScroll() - 1;
			first = current;
			last = current;
		}
		const wanted: PageSlot[] = [];
		for (let i = 0; i < this.slots.length; i += 1) {
			const slot = this.slots[i];
			if (!slot) continue;
			if (i >= first - RENDER_MARGIN && i <= last + RENDER_MARGIN) wanted.push(slot);
			else if (i < first - KEEP_MARGIN || i > last + KEEP_MARGIN) this.unrenderSlot(slot);
		}
		this.queueRenders(wanted, force);
	}

	private queueRenders(slots: PageSlot[], front = false): void {
		const pending = slots.filter((slot) => !slot.rendered && !slot.rendering);
		if (!pending.length) return;
		const rest = this.renderQueue.filter((slot) => !pending.includes(slot));
		this.renderQueue = front ? [...pending, ...rest] : [...rest, ...pending];
		void this.pumpQueue();
	}

	private async pumpQueue(): Promise<void> {
		if (this.pumping) return;
		this.pumping = true;
		try {
			while (this.renderQueue.length) {
				const slot = this.renderQueue.shift();
				if (!slot || slot.rendered || !this.pdf) continue;
				await this.renderSlot(slot);
			}
		} finally {
			this.pumping = false;
		}
	}

	/** 画一页：pdf.js 的渲染是分片推进的（requestAnimationFrame 驱动），窗口在后台时不出帧，
	 * 所以给个上限，超时就把这一页标成失败并提示，而不是永远卡住 */
	private async renderSlot(slot: PageSlot): Promise<void> {
		const pdf = this.pdf;
		if (!pdf || slot.rendered || slot.rendering) return;
		slot.rendering = true;
		try {
			const rendered = await withTimeout(
				renderPage(pdf, slot.index, this.scale, slot.canvas, (task) => {
					slot.task = task;
				}),
				RENDER_TIMEOUT_MS,
				t('渲染超时（窗口在后台时 pdf.js 不会出帧）。把窗口切到前台后会自动重画'),
			);
			slot.page = rendered.page;
			slot.base = rendered.pageSize;
			slot.task = null;
			slot.rendered = true;
			slot.failed = false;
			this.applySlotSize(slot);
			const content = await rendered.page.getTextContent();
			slot.text = [];
			for (const item of content.items) {
				if ('str' in item) {
					// pdf.js 给的内容项在这个版本是 any，显式收口成已知字段，别让 any 顺着 push 渗进来
					const textItem = item as { str: string; transform: number[]; width: number; height: number };
					slot.text.push({
						str: textItem.str,
						transform: textItem.transform,
						width: textItem.width,
						height: textItem.height,
					});
				}
			}
			await this.drawMarksFor(slot);
		} catch (error) {
			slot.failed = true;
			const message = error instanceof Error ? error.message : String(error);
			this.setStatus(t('渲染失败：{v0}', { v0: message }), true);
		} finally {
			slot.rendering = false;
			slot.task = null;
		}
	}

	/** 释放一页的画布（尺寸保留，滚动条不跳），滚动回来会重画 */
	private unrenderSlot(slot: PageSlot): void {
		if (!slot.rendered || slot.rendering) return;
		try {
			slot.page?.cleanup();
		} catch {
			// cleanup 失败不影响
		}
		slot.canvas.width = 0;
		slot.canvas.height = 0;
		slot.rendered = false;
		slot.text = [];
	}

	/** 手动重试：把失败的页清掉重排 */
	async retryRender(): Promise<void> {
		for (const slot of this.slots) {
			if (slot.failed) {
				slot.failed = false;
				slot.rendered = false;
			}
		}
		this.updateViewport(true);
	}

	// ---------- 翻页 / 缩放 ----------

	/** 滚到某一页的顶部（页码框、上下页按钮、横向滑动都走这里） */
	scrollToPage(page: number): void {
		const scroll = this.scrollEl;
		if (!scroll || !this.slots.length) return;
		const target = Math.min(Math.max(1, Math.floor(page)), this.slots.length);
		this.pageNumber = target;
		if (this.pageInput) this.pageInput.value = String(target);
		if (this.file) this.plugin.rememberPdfPage(this.file.path, target);
		if (this.tops.length !== this.slots.length) this.measureTops();
		const top = this.tops[target - 1];
		if (top !== undefined) scroll.scrollTop = top;
		this.updateViewport(true);
		// 版面还没铺完（比如刚从后台标签切过来）时 scrollTop 会被夹住，
		// 下一帧量一次再补滚一次；用户自己滚过就不动
		window.requestAnimationFrame(() => {
			if (this.pageNumber !== target || scroll.scrollTop > 4) return;
			this.measureTops();
			const again = this.tops[target - 1];
			if (again !== undefined && again > 4) scroll.scrollTop = again;
		});
	}

	private flipPage(dir: 1 | -1): void {
		this.scrollToPage(this.currentPageFromScroll() + dir);
	}

	private setScale(scale: number): void {
		const next = Math.min(Math.max(0.4, Number(scale.toFixed(2))), 4);
		if (next === this.scale) return;
		const scroll = this.scrollEl;
		// 缩放前记下锚点（当前页 + 页内偏移），缩放后按比例还原，视线不跑
		const anchorPage = this.currentPageFromScroll();
		const anchorOffset = scroll ? scroll.scrollTop - (this.tops[anchorPage - 1] ?? 0) : 0;
		const ratio = next / this.scale;
		this.scale = next;
		for (const slot of this.slots) {
			this.applySlotSize(slot);
			this.unrenderSlot(slot);
		}
		this.measureTops();
		if (scroll) scroll.scrollTop = (this.tops[anchorPage - 1] ?? 0) + anchorOffset * ratio;
		this.updateViewport(true);
		this.refreshZoomLabel();
	}

	private async fitWidth(): Promise<void> {
		const scroll = this.scrollEl;
		if (!scroll || !this.slots.length) return;
		const first = this.slots[0];
		if (!first) return;
		const available = scroll.clientWidth - 32;
		this.setScale(available > 0 ? available / first.base[0] : 1.2);
	}

	// ---------- 键盘与滚轮 ----------

	/**
	 * 键盘：← → 整页跳（连续滚动下纵向滚动条已经覆盖全文，PageUp/PageDown/Home/End
	 * 留给原生滚动更顺手）。这一版 Obsidian 的 View 上没有 scope（typings 里声明了、
	 * 运行时对象上不存在），所以自己监听 document 的 keydown 并限定作用范围。
	 */
	private bindKeys(): void {
		if (this.keysBound) return;
		this.keysBound = true;
		this.registerDomEvent(
			document,
			'keydown',
			(event) => {
				if (!this.pdf || this.dragStart) return;
				if (this.app.workspace.getActiveViewOfType(PickmePdfView) !== this) return;
				const active = document.activeElement;
				if (isEditableElement(active)) return;
				if (active && active !== document.body && !this.containerEl.contains(active)) return;
				// Esc 收回刚划的高亮（面板开着时 Esc 归面板：关闭面板）
				const fresh = this.freshHighlight;
				if (event.key === 'Escape') {
					if (!this.panelEntryId && fresh && Date.now() - fresh.at < 15000) {
						this.freshHighlight = null;
						void this.undoFreshHighlight(fresh);
					}
					return;
				}
				const scroll = this.scrollEl;
				// 放大到横向要滚动时，左右键留给原生滚动
				if (scroll && scroll.scrollWidth > scroll.clientWidth + 1) return;
				if (event.key === 'ArrowRight') this.flipPage(1);
				else if (event.key === 'ArrowLeft') this.flipPage(-1);
				else return;
				event.preventDefault();
			},
			{ capture: true },
		);
	}

	/** 触控板横向滑动＝整页跳；纵向滚动交给原生（连续滚动下那就是浏览文档本身） */
	private onWheel(event: WheelEvent): void {
		if (!this.pdf || this.slots.length <= 1 || this.dragStart) return;
		const decision = decideWheel({
			deltaX: event.deltaX,
			deltaY: event.deltaY,
			accum: this.wheelAccum,
			dir: this.wheelDir,
		});
		this.wheelAccum = decision.accum;
		this.wheelDir = decision.dir;
		if (!decision.consume) return;
		event.preventDefault();
		if (!decision.flip) return;
		this.flipPage(decision.flip);
	}

	// ---------- 标记 ----------

	/** 重画所有页上的批注框（关掉高亮开关时只清不画） */
	private async drawAllMarks(): Promise<void> {
		for (const slot of this.slots) await this.drawMarksFor(slot);
	}

	/** 画出某一页已有的批注：一条批注是一组形状（框 + 若干荧光行），都装在它的外接矩形里 */
	private async drawMarksFor(slot: PageSlot): Promise<void> {
		slot.overlay.querySelectorAll('.pickme-pdf-mark').forEach((node) => node.remove());
		// 关掉高亮时只清不画，页面回到原始 PDF 的样子
		if (!this.plugin.settings.showMarks) return;
		const file = this.file;
		if (!file) return;
		const doc = await this.plugin.loadDoc(file);
		const size = this.slotSize(slot);
		for (const entry of doc.entries) {
			if (entry.kind !== 'pdf' || !entry.pdf || entry.pdf.page !== slot.index) continue;
			const pdf = entry.pdf;
			// 老批注没有 rotation 字段：按 0 算，坐标与修复前逐位一致
			const rotation = pdf.rotation ?? 0;
			const outer = pdfToScreenRect(pdf.rect, size, pdf.pageSize, rotation);
			const mark = slot.overlay.createDiv({ cls: 'pickme-pdf-mark' });
			mark.setAttribute('data-pickme-id', entry.id);
			mark.setCssProps({
				left: `${outer[0]}px`,
				top: `${outer[1]}px`,
				width: `${Math.max(6, outer[2] - outer[0])}px`,
				height: `${Math.max(6, outer[3] - outer[1])}px`,
			});
			if (entry.status === 'stale') mark.addClass('is-stale');
			if (entry.id === this.panelEntryId) mark.addClass('is-active');
			mark.setAttribute('title', entry.qas[0]?.question ?? entry.id);

			for (const shape of shapesOf(pdf)) {
				const screen = pdfToScreenRect(shape.rect, size, pdf.pageSize, rotation);
				// 子形状相对外接矩形定位：外接矩形自己不收指针事件，空白处点不开批注
				const box = mark.createDiv({ cls: shape.kind === 'line' ? 'pickme-pdf-band' : 'pickme-pdf-box' });
				box.setCssProps({
					left: `${screen[0] - outer[0]}px`,
					top: `${screen[1] - outer[1]}px`,
					width: `${Math.max(2, screen[2] - screen[0])}px`,
					height: `${Math.max(2, screen[3] - screen[1])}px`,
				});
			}
			// 页码与形状标签：只在选中或悬停时显示，静止态保持页面干净
			const label = mark.createDiv({ cls: 'pickme-pdf-label' });
			label.setText(t('第 {v0} 页 · {v1}', { v0: pdf.page, v1: this.shapeWord(pdf) }));
		}
	}

	// ---------- 框选 ----------

	private onPointerDown(slot: PageSlot, event: PointerEvent): void {
		if (event.button !== 0) return;
		// 点在已有的框上：这是「打开这条批注看问答」，不是要新框一块
		const mark = (event.target as HTMLElement | null)?.closest('.pickme-pdf-mark');
		const markId = mark?.getAttribute('data-pickme-id');
		if (markId) {
			this.pendingMarkId = markId;
			return;
		}
		this.pendingMarkId = null;
		this.dragSlot = slot;
		const point = this.relativePoint(slot, event);
		this.dragStart = point;
		if (this.plugin.settings.pdfAnnotateMode === 'highlight') {
			// 荧光笔：预览的是吸附后的行带，不是矩形选框
			this.strokePoints = [point];
			slot.preview.empty();
			slot.preview.hide();
		} else {
			this.strokePoints = [];
			slot.marquee.show();
			this.updateMarquee(slot, point, point);
		}
		// 合成事件或异常指针 id 时捕获会抛错，捕获失败不影响框选
		try {
			slot.overlay.setPointerCapture(event.pointerId);
		} catch {
			// 忽略
		}
	}

	private onPointerMove(slot: PageSlot, event: PointerEvent): void {
		if (!this.dragStart || this.dragSlot !== slot) return;
		const point = this.relativePoint(slot, event);
		if (this.plugin.settings.pdfAnnotateMode === 'highlight') {
			this.strokePoints.push(point);
			// 吸附比画矩形贵，但只跟这一页的文字项数量成正比，合并到一帧里重算就够
			if (this.previewScheduled) return;
			this.previewScheduled = true;
			window.requestAnimationFrame(() => {
				this.previewScheduled = false;
				if (this.dragSlot === slot) this.renderStrokePreview(slot);
			});
			return;
		}
		this.updateMarquee(slot, this.dragStart, point);
	}

	private async onPointerUp(slot: PageSlot, event: PointerEvent): Promise<void> {
		const start = this.dragSlot === slot ? this.dragStart : null;
		const pendingMark = this.pendingMarkId;
		this.pendingMarkId = null;
		this.resetDrag();
		// 点框：开这条批注的面板（回答落盘后重画标记也不影响，按 id 取）
		if (pendingMark) {
			this.openAskPanel(pendingMark);
			return;
		}
		if (!start) return;
		const end = this.relativePoint(slot, event);
		if (this.plugin.settings.pdfAnnotateMode === 'highlight') {
			this.strokePoints.push(end);
			const lines = this.snappedLines(slot);
			this.strokePoints = [];
			if (!lines.length) {
				// 划在图片或空白上：不建批注，也不偷偷退化成矩形
				this.setStatus(t('这里没有可取的文字，切到框选可框选区域'));
				return;
			}
			await this.createHighlightAnnotation(slot, lines);
			return;
		}
		const screenRect = dragRect(start, end);
		if (hasMinimumSize(screenRect, 8)) {
			await this.createAnnotation(slot, screenRect);
			return;
		}
		// 只点了一下、没有拖动：不建批注（批注一律靠框选），给一句提示
		this.setStatus(t('按住鼠标拖出一块区域即可批注'));
	}

	private resetDrag(): void {
		this.dragSlot?.marquee.hide();
		this.dragSlot?.preview.hide();
		this.dragSlot = null;
		this.dragStart = null;
	}

	private relativePoint(slot: PageSlot, event: PointerEvent): Point {
		const rect = slot.overlay.getBoundingClientRect();
		return { x: event.clientX - rect.left, y: event.clientY - rect.top };
	}

	private updateMarquee(slot: PageSlot, a: Point, b: Point): void {
		const rect = dragRect(a, b);
		slot.marquee.setCssProps({
			left: `${rect[0]}px`,
			top: `${rect[1]}px`,
			width: `${rect[2] - rect[0]}px`,
			height: `${rect[3] - rect[1]}px`,
		});
	}

	private async createAnnotation(slot: PageSlot, screenRect: Rect): Promise<void> {
		const file = this.file;
		if (!file) return;
		const size = this.slotSize(slot);
		const viewSize = this.viewSizeOf(slot);
		const rotation = this.rotationOf(slot);
		const rect = screenToPdfRect(screenRect, size, viewSize, rotation);
		const hitText = textInRect(slot.text, rect);
		this.setStatus(hitText ? t('已选中：{v0}', { v0: hitText.slice(0, 40) }) : t('已选中一块区域（未取到文字）'));

		const doc = await this.plugin.loadDoc(file);
		const id = newAnchorId();
		const image = await this.captureRegion(slot, screenRect, doc.entries.length + 1);

		const entry: AnnotationEntry = {
			id,
			kind: 'pdf',
			selection: '',
			fingerprint: fingerprint(hitText || `p${slot.index}:${rect.join(',')}`),
			status: 'ok',
			created: nowIso(),
			qas: [],
			pdf: {
				page: slot.index,
				pageSize: viewSize,
				rect,
				normRect: toNormalized(rect, viewSize),
				// 不旋转的页面不写这个字段，文件内容与修复前保持一致
				...(rotation ? { rotation } : {}),
				hitText,
				image,
			},
		};

		await this.plugin.repository.addEntry(file, entry);
		await this.drawMarksFor(slot);
		this.setStatus(hitText ? t('已批注：{v0}', { v0: hitText.slice(0, 40) }) : t('已批注一块区域，可直接在面板里提问'));

		// 框完就在页面上直接提问；关掉这个开关才回退到侧边栏
		if (this.plugin.settings.inlineAsk) {
			this.openAskPanel(id, slot, screenRect, true);
		} else {
			const sidebar = await this.plugin.openSidebar();
			await sidebar.setFile(file);
			sidebar.setActiveEntry(id);
		}
	}

	// ---------- 荧光笔 ----------

	/** 切换标注方式：荧光笔（拖一笔吸附到文字行）/ 框选（拖出一块区域） */
	private setAnnotateMode(mode: 'highlight' | 'area'): void {
		this.plugin.settings.pdfAnnotateMode = mode;
		void this.plugin.saveSettings();
		this.refreshModeButtons();
		this.setStatus(this.readyStatusText());
	}

	/** 两个方式按钮互斥高亮 */
	private refreshModeButtons(): void {
		const mode = this.plugin.settings.pdfAnnotateMode;
		this.highlighterButton?.toggleClass('is-active', mode === 'highlight');
		this.areaButton?.toggleClass('is-active', mode === 'area');
	}

	/** 正在读的那条批注完整显形，同页其它批注退到背景（样式见 styles.css 的 is-active） */
	private applyActiveMark(): void {
		for (const slot of this.slots) {
			for (const mark of slot.overlay.querySelectorAll<HTMLElement>('.pickme-pdf-mark')) {
				mark.toggleClass('is-active', mark.getAttribute('data-pickme-id') === this.panelEntryId);
			}
		}
	}

	/** 形状短称：这里静态写 t()，i18n 覆盖测试才认得出这几个词 */
	private shapeWord(pdf: PdfAnchorInfo): string {
		const kind = shapeKindLabel(pdf);
		if (kind === '框+线') return t('框+线');
		return kind === '荧光' ? t('荧光') : t('框选');
	}

	/** 这一页未旋转的用户空间尺寸；槽位还没量到尺寸时退回显示尺寸（那时也没有文字可吸附） */
	private viewSizeOf(slot: PageSlot): [number, number] {
		return slot.viewSize ?? slot.base;
	}

	private rotationOf(slot: PageSlot): number {
		return slot.rotation ?? 0;
	}

	/** 屏幕点 → PDF 用户空间点（带页面旋转换算） */
	private toPdfPoint(slot: PageSlot, point: Point): StrokePoint {
		return screenToPdfPoint(point, this.slotSize(slot), this.viewSizeOf(slot), this.rotationOf(slot));
	}

	/** 这一笔吸附出来的行框（PDF 用户空间）：预览与建批注走同一个函数，所见即所得 */
	private snappedLines(slot: PageSlot): LineBox[] {
		const items = slot.text.map(itemBox);
		const points = this.strokePoints.map((point) => this.toPdfPoint(slot, point));
		return strokeToLines(items, points);
	}

	/** 行框换算成屏幕矩形 */
	private lineScreenRect(slot: PageSlot, line: LineBox): Rect {
		return pdfToScreenRect(line.rect, this.slotSize(slot), this.viewSizeOf(slot), this.rotationOf(slot));
	}

	/** 拖动过程中实时画吸附结果：松手不改变已经看到的东西 */
	private renderStrokePreview(slot: PageSlot): void {
		slot.preview.empty();
		const lines = this.snappedLines(slot);
		if (!lines.length) {
			slot.preview.hide();
			return;
		}
		slot.preview.show();
		for (const line of lines) {
			const rect = this.lineScreenRect(slot, line);
			const band = slot.preview.createDiv({ cls: 'pickme-pdf-band' });
			band.setCssProps({
				left: `${rect[0]}px`,
				top: `${rect[1]}px`,
				width: `${Math.max(2, rect[2] - rect[0])}px`,
				height: `${Math.max(2, rect[3] - rect[1])}px`,
			});
		}
	}

	/** 荧光笔建批注：每行一个 line 形状，外接矩形留给面板定位、索引与老版本回显 */
	private async createHighlightAnnotation(slot: PageSlot, lines: LineBox[]): Promise<void> {
		const file = this.file;
		if (!file) return;
		const viewSize = this.viewSizeOf(slot);
		const rotation = this.rotationOf(slot);
		const shapes: PdfShape[] = lines.map((line) => ({
			kind: 'line',
			rect: line.rect,
			norm: toNormalized(line.rect, viewSize),
		}));
		const box: Rect = [
			Math.min(...shapes.map((shape) => shape.rect[0])),
			Math.min(...shapes.map((shape) => shape.rect[1])),
			Math.max(...shapes.map((shape) => shape.rect[2])),
			Math.max(...shapes.map((shape) => shape.rect[3])),
		];
		const hitText = linesText(lines);
		const preview = hitText.replace(/\s+/g, ' ').slice(0, 40);
		this.setStatus(t('已高亮：{v0}（Esc 撤销）', { v0: preview }));

		const id = newAnchorId();
		const entry: AnnotationEntry = {
			id,
			kind: 'pdf',
			selection: '',
			fingerprint: fingerprint(hitText || `p${slot.index}:${box.join(',')}`),
			status: 'ok',
			created: nowIso(),
			qas: [],
			pdf: {
				page: slot.index,
				pageSize: viewSize,
				rect: box,
				normRect: toNormalized(box, viewSize),
				shapes,
				// 不旋转的页面不写这个字段，文件内容与修复前保持一致
				...(rotation ? { rotation } : {}),
				hitText,
				// 荧光笔是文字批注：不截图，省空间也省一次画布裁切
				image: '',
			},
		};

		await this.plugin.repository.addEntry(file, entry);
		await this.drawMarksFor(slot);
		// 荧光笔的语义就是「高亮」本身：不弹提问面板，也不跳侧边栏。
		// 想就这一段问点什么，点一下这条高亮即可（和点已有批注是同一条路）。
		// 记下它只是为了刚划完的十几秒里能用 Esc 收回一次笔误。
		this.freshHighlight = { id, slot, at: Date.now() };
	}

	/** 刚划完的那条高亮：只为 Esc 撤销而记，过了时间窗或已被问过就不动它 */
	private freshHighlight: { id: string; slot: PageSlot; at: number } | null = null;

	/** Esc 撤销刚划的高亮。只认「刚划且没问过」的那条，绝不碰旧批注 */
	private async undoFreshHighlight(fresh: { id: string; slot: PageSlot }): Promise<void> {
		const file = this.file;
		if (!file) return;
		const { doc } = await this.plugin.repository.loadFor(file);
		const entry = doc.entries.find((item) => item.id === fresh.id);
		if (!entry || entry.qas.length) return;
		await this.plugin.deleteEntry(fresh.id, file);
		await this.drawMarksFor(fresh.slot);
		this.setStatus(t('已撤销这次高亮'));
	}

	/** 把框选区域从这一页的画布上裁下来存成 PNG */
	private async captureRegion(slot: PageSlot, screenRect: Rect, index: number): Promise<string> {
		const file = this.file;
		const canvas = slot.canvas;
		if (!file || !this.plugin.settings.pdfSaveScreenshot) return '';
		if (!slot.rendered || !canvas.width) return '';

		const ratio = window.devicePixelRatio || 1;
		const sourceWidth = Math.max(1, Math.round(screenRect[2] - screenRect[0]));
		const sourceHeight = Math.max(1, Math.round(screenRect[3] - screenRect[1]));
		let outWidth = Math.round(sourceWidth * ratio);
		let outHeight = Math.round(sourceHeight * ratio);

		const max = this.plugin.settings.pdfScreenshotMaxSize;
		if (max > 0 && Math.max(outWidth, outHeight) > max) {
			const k = max / Math.max(outWidth, outHeight);
			outWidth = Math.max(1, Math.round(outWidth * k));
			outHeight = Math.max(1, Math.round(outHeight * k));
		}

		const offscreen = createEl('canvas');
		offscreen.width = outWidth;
		offscreen.height = outHeight;
		const context = offscreen.getContext('2d');
		if (!context) return '';
		context.drawImage(
			canvas,
			Math.round(screenRect[0] * ratio),
			Math.round(screenRect[1] * ratio),
			Math.round(sourceWidth * ratio),
			Math.round(sourceHeight * ratio),
			0,
			0,
			outWidth,
			outHeight,
		);

		const blob = await new Promise<Blob | null>((resolve) => offscreen.toBlob(resolve, 'image/png'));
		if (!blob) return '';
		const buffer = await blob.arrayBuffer();
		const path = this.plugin.repository.assetPathFor(file.path, index);
		try {
			await this.plugin.repository.io.writeBinary(path, buffer);
			return path;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			new Notice(t('pickme：区域截图保存失败 {v0}', { v0: message }));
			return '';
		}
	}

	private setStatus(text: string, retryable = false): void {
		const el = this.statusEl;
		if (!el) return;
		el.setText(text);
		// 窄了会省略号，鼠标停上去还能看全
		el.setAttribute('title', text);
		if (!retryable) return;
		const retry = el.createEl('button', { text: t('重试') });
		retry.addClass('pickme-status-retry');
		retry.onclick = () => {
			retry.remove();
			void this.retryRender();
		};
	}
}
