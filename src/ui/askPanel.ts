import { Component, MarkdownRenderer, TFile } from 'obsidian';
import { t } from '../i18n.ts';
import type PickmePlugin from '../main.ts';
import { parseAnnotationDoc } from '../core/annotationDoc.ts';
import { ConfirmModal } from './confirmModal.ts';
import type { AnnotationDoc, AnnotationEntry } from '../core/types.ts';

/**
 * 提问结果回填的目标。
 * 侧边栏与页面内面板都实现它，这样主流程不关心结果画在哪。
 */
export interface AskSink {
	beginStream(key: string): void;
	appendStream(text: string): void;
	endStream(): void;
	currentStreamText(): string;
	streamKey(entryId: string, index: number): string;
	reload(): Promise<void>;
	setActiveEntry(id: string | null): void;
}

/** 面板相对宿主视图左上角的位置 */
export interface AskPanelAnchor {
	left: number;
	top: number;
	width: number;
	height: number;
}

export interface AskPanelOptions {
	plugin: PickmePlugin;
	/** 挂载到哪个视图元素里 */
	host: HTMLElement;
	file: TFile;
	entryId: string;
	/** 每次需要定位时回调，返回 null 表示用默认位置 */
	resolveAnchor?: () => AskPanelAnchor | null;
	/**
	 * 这条批注是刚框选出来的（还不是既有批注）。
	 * 关掉面板时如果一个问题都没问，就把它连同高亮一起撤销——用户看到的是「取消」。
	 */
	fresh?: boolean;
	onClose?: () => void;
}

const PANEL_WIDTH = 380;

/** 每个宿主视图只留一个面板 */
const panels = new WeakMap<HTMLElement, AskPanel>();

/**
 * 在页面内打开提问面板（不打开侧边栏）。
 * 同一个视图里再打开时会先关掉上一个。
 */
export function openAskPanel(options: AskPanelOptions): AskPanel {
	panels.get(options.host)?.close();
	// 插件被重载/禁用时，旧实例挂在宿主里的浮层没人清理，会一直留在 DOM 上
	// （堆叠的面板还会抢走点击与滚动）。开新面板前先扫掉。
	for (const stale of Array.from(options.host.querySelectorAll('.pickme-inline-layer'))) {
		stale.remove();
	}
	const panel = new AskPanel(options);
	panels.set(options.host, panel);
	void panel.open();
	return panel;
}

/** 取某个宿主当前的面板（没有则返回 null） */
export function askPanelOf(host: HTMLElement): AskPanel | null {
	return panels.get(host) ?? null;
}

/**
 * 页面内提问面板：选区就在当前页面上，问题、模板、模型、答案都在这里完成，
 * 不需要跳到侧边栏。侧边栏退化为「查看已有哪些批注」。
 */
export class AskPanel implements AskSink {
	private plugin: PickmePlugin;
	private host: HTMLElement;
	private file: TFile;
	private entryId: string;
	private resolveAnchor: () => AskPanelAnchor | null;
	private onClose: () => void;

	private layer: HTMLElement | null = null;
	private root: HTMLElement | null = null;
	private doc: AnnotationDoc | null = null;
	private entry: AnnotationEntry | null = null;
	private loadError: string | null = null;
	private templateName = '';
	private templateNames: string[] = [];
	private modelOverride = '';
	private streamId: string | null = null;
	private streamText = '';
	private questionInput: HTMLTextAreaElement | null = null;
	private contextToggle: HTMLInputElement | null = null;
	private thinkToggle: HTMLInputElement | null = null;
	private statusEl: HTMLElement | null = null;
	private answerEls = new Map<string, HTMLElement>();
	private closed = false;
	private fresh = false;
	/** 面板当前贴在锚点的哪一侧；定下来就不再随锚点微动而翻边 */
	private side: 'right' | 'left' | null = null;
	/**
	 * 上一次量到的落点。锚点一时量不出来（标记被重画、视图正在重排）时沿用这个位置，
	 * 而不是掉到左上角——真机上表现为「回答出来后面板自己弹到左上角」。
	 */
	private lastPosition: { left: number; top: number } | null = null;

	/**
	 * 面板自己的组件容器。官方检查要求：不能直接把主插件实例当组件传给
	 * MarkdownRenderer——它的生命周期跟插件一样长，渲染出来的 DOM 会被它一直记着，
	 * 面板关了也回收不掉。
	 */
	private readonly child: Component = new Component();

	constructor(options: AskPanelOptions) {
		this.plugin = options.plugin;
		this.host = options.host;
		this.file = options.file;
		this.entryId = options.entryId;
		this.resolveAnchor = options.resolveAnchor ?? (() => null);
		this.fresh = options.fresh ?? false;
		this.onClose = options.onClose ?? (() => undefined);
		this.child.load();
	}

	async open(): Promise<void> {
		this.ensureLayer();
		if (this.closed) return;
		this.templateNames = await this.plugin.templates.list();
		// reload 内部会 render，this.root 到这里才建好
		await this.reload();
		this.applyPosition();
		window.addEventListener('scroll', this.onViewportChange, true);
		window.addEventListener('resize', this.onViewportChange);
		this.questionInput?.focus();
	}

	close(): void {
		if (this.closed) return;
		this.closed = true;
		window.removeEventListener('scroll', this.onViewportChange, true);
		window.removeEventListener('resize', this.onViewportChange);
		this.layer?.remove();
		this.layer = null;
		this.root = null;
		this.child.unload();
		this.onClose();
		void this.discardIfUntouched();
	}

	/**
	 * 刚框出来的批注、且一次都没问过：关掉面板就等于取消，
	 * 把它和页面上的高亮一起撤掉，不留半条空批注。
	 */
	private async discardIfUntouched(): Promise<void> {
		if (!this.fresh) return;
		this.fresh = false;
		try {
			const doc = (await this.plugin.repository.loadFor(this.file)).doc;
			const entry = doc.entries.find((item) => item.id === this.entryId);
			if (!entry) return;
			const asked = entry.qas.some((qa) => qa.question.trim() !== '' || qa.answer.trim() !== '');
			if (asked) return;
			await this.plugin.deleteEntry(this.entryId, this.file);
		} catch {
			// 撤销失败不该影响关面板
		}
	}

	isClosed(): boolean {
		return this.closed;
	}

	// ---------- 数据 ----------

	async reload(): Promise<void> {
		if (this.closed) return;
		try {
			this.doc = (await this.plugin.repository.loadFor(this.file)).doc;
			this.entry = this.doc.entries.find((item) => item.id === this.entryId) ?? null;
			this.loadError = null;
		} catch (err) {
			// 读不出批注文件时不能把面板停在半截（曾经因为未捕获的读取异常整个面板不渲染）
			this.doc = parseAnnotationDoc('', '');
			this.entry = null;
			this.loadError = err instanceof Error ? err.message : String(err);
		}
		this.render();
	}

	setActiveEntry(id: string | null): void {
		if (id) this.entryId = id;
		this.render();
	}

	// ---------- 流式回填 ----------

	streamKey(entryId: string, index: number): string {
		return `${entryId}#${index}`;
	}

	beginStream(key: string): void {
		this.streamId = key;
		this.streamText = '';
		this.answerEls.delete(key);
		this.render();
		this.setStatus(t('正在生成…'));
	}

	appendStream(text: string): void {
		this.streamText = text;
		const holder = this.answerEls.get(this.streamId ?? '');
		if (holder) holder.setText(text);
	}

	endStream(): void {
		this.streamId = null;
		this.streamText = '';
		this.setStatus(t('已完成'));
	}

	currentStreamText(): string {
		return this.streamText;
	}

	// ---------- 界面 ----------

	private ensureLayer(): void {
		if (this.layer) return;
		// 宿主视图可能是 static 定位，补一个相对定位容器，面板才能贴着选区浮在上面
		const style = window.getComputedStyle(this.host);
		if (style.position === 'static') this.host.addClass('pickme-ask-host-relative');
		const layer = this.host.createDiv({ cls: 'pickme-inline-layer' });
		// 面板是浮层，不是文档的一部分：内容滚到头以后，滚轮不该继续传给底下的文档。
		// 否则文档一动，面板就跟着锚点跑，用户看到的是「在框里滚动，框自己动了」。
		layer.addEventListener('wheel', this.onWheel, { passive: false });
		this.layer = layer;
	}

	private render(): void {
		const layer = this.layer;
		if (!layer || this.closed) return;
		layer.empty();
		this.answerEls.clear();

		const entry = this.entry;
		const root = layer.createDiv({ cls: 'pickme-panel' });
		this.root = root;
		// 面板每次重画都是新元素，不先把上次落点写上去就会闪回左上角
		// （真机上表现为「发送后框自己跳到左上角」——回答落盘会触发一次 reload）
		if (this.lastPosition) {
			root.setCssProps({ left: `${this.lastPosition.left}px`, top: `${this.lastPosition.top}px` });
		}

		const head = root.createDiv({ cls: 'pickme-panel-head' });
		head.createSpan({ cls: 'pickme-tag', text: entry?.id ?? this.entryId });
		head.createSpan({
			cls: 'pickme-kind',
			text: entry
				? entry.kind === 'pdf'
					? t('PDF 第 {v0} 页', { v0: entry.pdf?.page ?? '?' })
					: t('正文选区')
				: t('未找到批注'),
		});
		if (entry) {
			head.createSpan({
				cls: `pickme-status-dot ${entry.status === 'ok' ? 'is-ok' : 'is-stale'}`,
				text: entry.status === 'ok' ? t('有效') : t('失效'),
			});
		}
		const close = head.createEl('button', { cls: 'pickme-panel-close', text: '×' });
		close.setAttribute('aria-label', t('关闭'));
		close.onclick = () => this.close();

		if (!entry) {
			root.createDiv({
				cls: 'pickme-empty',
				text: this.loadError ? t('批注文件读不出来：{v0}', { v0: this.loadError }) : t('这条批注已经不在了。'),
			});
			return;
		}

		const selection = entry.kind === 'pdf' ? entry.pdf?.hitText ?? '' : entry.selection;
		if (selection) {
			root.createDiv({ cls: 'pickme-selection', text: shorten(selection, 160) });
		}

		this.renderComposer(root, entry);
		this.renderHistory(root, entry);
		// 内容变了尺寸也变，重排后按锚点再校一次位置
		this.applyPosition();
	}

	private renderComposer(root: HTMLElement, entry: AnnotationEntry): void {
		const box = root.createDiv({ cls: 'pickme-composer' });

		const row = box.createDiv({ cls: 'pickme-row' });
		// 默认「直接提问」（空值）。曾经这里会把模板强制设成列表里的第一个，
		// 结果用户自己打字提问也被套上翻译模板的提示词，批注里还记成「模板：翻译」。
		const select = row.createEl('select', { cls: 'dropdown' });
		select.createEl('option', { text: t('直接提问'), value: '' });
		for (const name of this.templateNames) {
			select.createEl('option', { text: name, value: name });
		}
		select.value = this.templateName;
		select.onchange = () => {
			this.templateName = select.value;
		};

		const models = this.plugin.settings.modelOptions ?? [];
		const modelSelect = row.createEl('select', { cls: 'dropdown pickme-model' });
		modelSelect.createEl('option', {
			text: t('默认（{v0}）', { v0: this.plugin.settings.model || t('未设置') }),
			value: '',
		});
		for (const name of models) {
			modelSelect.createEl('option', { text: name, value: name });
		}
		if (this.modelOverride && !models.includes(this.modelOverride)) {
			modelSelect.createEl('option', { text: this.modelOverride, value: this.modelOverride });
		}
		modelSelect.value = this.modelOverride;
		modelSelect.onchange = () => {
			this.modelOverride = modelSelect.value;
		};

		this.questionInput = box.createEl('textarea', {
			cls: 'pickme-question',
			attr: {
				rows: '3',
				placeholder: t('输入问题，或选模板后直接发送（⌘/Ctrl + Enter）'),
			},
		});
		this.questionInput.addEventListener('keydown', (event) => {
			if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
				event.preventDefault();
				void this.submit();
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
			}
		});

		const actions = box.createDiv({ cls: 'pickme-row pickme-actions' });
		const ctxLabel = actions.createEl('label', { cls: 'pickme-checkbox' });
		this.contextToggle = ctxLabel.createEl('input', { type: 'checkbox' });
		this.contextToggle.checked = this.plugin.settings.includeContextByDefault;
		ctxLabel.createSpan({ text: t('带上下文') });

		const thinkLabel = actions.createEl('label', { cls: 'pickme-checkbox' });
		this.thinkToggle = thinkLabel.createEl('input', { type: 'checkbox' });
		this.thinkToggle.checked = this.plugin.settings.deepThinking;
		thinkLabel.createSpan({ text: t('深度思考') });

		// 勾选即记住：下次打开面板/侧边栏沿用上次的选择，不用每次重勾
		this.contextToggle.addEventListener('change', () => {
			this.plugin.settings.includeContextByDefault = this.contextToggle?.checked ?? true;
			void this.plugin.saveSettings();
		});
		this.thinkToggle.addEventListener('change', () => {
			this.plugin.settings.deepThinking = this.thinkToggle?.checked ?? true;
			void this.plugin.saveSettings();
		});

		const send = actions.createEl('button', { cls: 'mod-cta', text: t('发送') });
		send.onclick = () => void this.submit();
		const stop = actions.createEl('button', { text: t('停止') });
		// 刚框出来、还没问过的批注不摆删除：这时候关掉面板就是撤销，用不着删
		const canDelete = (this.entry?.qas.length ?? 0) > 0 || !this.fresh;
		if (canDelete) {
			const remove = actions.createEl('button', { text: t('删除') });
			remove.addClass('mod-warning');
			remove.onclick = () => {
				const detail = this.entry?.kind === 'pdf'
					? t('将删除批注 {v0} 与它的区域截图。', { v0: this.entryId })
					: t('将删除批注 {v0}，并从原文里移除这一对锚点标签（选区内文字不动）。', { v0: this.entryId });
				new ConfirmModal(this.plugin.app, detail, () => {
					void this.plugin.deleteEntry(this.entryId, this.file).then(() => this.close());
				}).open();
			};
		}
		stop.onclick = () => this.plugin.abortCurrent();

		const rounds = entry.qas.filter((qa) => qa.answer.trim() !== '').length;
		this.statusEl = box.createDiv({
			cls: 'pickme-status',
			text: rounds > 0 ? t('追问：会带上已有 {v0} 轮问答', { v0: rounds }) : t('首次提问'),
		});
	}

	private renderHistory(root: HTMLElement, entry: AnnotationEntry): void {
		if (entry.qas.length === 0) return;
		const list = root.createDiv({ cls: 'pickme-panel-history' });
		entry.qas.forEach((qa, index) => {
			const block = list.createEl('details', { cls: 'pickme-qa' });
			if (index === entry.qas.length - 1) block.setAttribute('open', '');
			block.createEl('summary', {
				text: qa.question ? shorten(qa.question, 40) : t('第 {v0} 次提问', { v0: index + 1 }),
			});
			if (qa.question) block.createDiv({ cls: 'pickme-q', text: t('问：{v0}', { v0: qa.question }) });
			if (qa.template) block.createDiv({ cls: 'pickme-meta', text: t('模板：{v0}', { v0: qa.template }) });
			const answer = block.createDiv({ cls: 'pickme-a' });
			const key = this.streamKey(entry.id, index);
			if (this.streamId === key) {
				answer.setText(this.streamText);
				this.answerEls.set(key, answer);
			} else {
				void MarkdownRenderer.render(
					this.plugin.app,
					qa.answer,
					answer,
					entry.kind === 'pdf' ? '' : this.file.path,
					this.child,
				);
			}
		});
	}

	private async submit(): Promise<void> {
		const question = this.questionInput?.value ?? '';
		const withContext = this.contextToggle?.checked ?? true;
		const deepThinking = this.thinkToggle?.checked ?? this.plugin.settings.deepThinking;
		if (this.questionInput) this.questionInput.value = '';
		await this.plugin.ask(
			{
				question,
				templateName: this.templateName,
				withContext,
				entryId: this.entryId,
				modelOverride: this.modelOverride,
				deepThinking,
				// 必须带上这条批注所属的文件：不带就得靠「当前活动文档」猜，
				// 面板开着的时候切到别的文档再提问就会提示「找不到批注」
				file: this.file,
			},
			this,
		);
	}

	private setStatus(text: string): void {
		this.statusEl?.setText(text);
	}

	// ---------- 定位 ----------

	/** 滚轮先喂给面板自己；面板滚不动了就把默认行为掐掉，别穿透到文档 */
	private onWheel = (event: WheelEvent): void => {
		const root = this.root;
		if (!root) return;
		const max = root.scrollHeight - root.clientHeight;
		const atTop = root.scrollTop <= 0;
		const atBottom = root.scrollTop >= max - 1;
		const stuck = max <= 0 || (event.deltaY < 0 && atTop) || (event.deltaY > 0 && atBottom);
		if (stuck) event.preventDefault();
	};

	private onViewportChange = (event?: Event): void => {
		// 面板自己就是滚动容器，捕获阶段会收到所有元素上的 scroll：
		// 在面板里滚动不该把它挪走（真机上表现为「一滚就跳」）。
		const target = event?.target as Node | null | undefined;
		if (target && this.layer && typeof this.layer.contains === 'function' && this.layer.contains(target)) {
			return;
		}
		this.applyPosition();
	};

	private applyPosition(): void {
		const root = this.root;
		if (!root) return;
		const anchor = this.resolveAnchor();
		const hostRect = this.host.getBoundingClientRect();
		if (hostRect.width <= 0 || hostRect.height <= 0) {
			// 视图正在重建、这一帧还量不到宿主尺寸：先不挪，否则会被夹到左上角去
			const fallback = this.lastPosition ?? { left: 12, top: 12 };
			root.setCssProps({ left: `${fallback.left}px`, top: `${fallback.top}px` });
			return;
		}
		if (!anchor) {
			// 沿用上次落点；确实没有过落点（首次打开且量不到锚点）才退回左上角
			const fallback = this.lastPosition ?? { left: 12, top: 12 };
			root.setCssProps({ left: `${fallback.left}px`, top: `${fallback.top}px` });
			return;
		}
		const width = Math.min(PANEL_WIDTH, Math.max(240, hostRect.width - 24));
		root.setCssProps({ width: `${width}px` });

		// 面板放在锚点哪一侧，只在「这一侧真的放不下、另一侧放得下」时才换。
		// 锚点稍微动一下就左右翻边，比贴着锚点更让人看不清——阅读滚动时尤其明显。
		const toRight = anchor.left + anchor.width + 12;
		const toLeft = anchor.left - width - 12;
		const fitsRight = toRight + width <= hostRect.width - 8;
		const fitsLeft = toLeft >= 8;
		if (this.side === null) this.side = fitsRight || !fitsLeft ? 'right' : 'left';
		if (this.side === 'right' && !fitsRight && fitsLeft) this.side = 'left';
		if (this.side === 'left' && !fitsLeft && fitsRight) this.side = 'right';

		let left = this.side === 'right' ? toRight : toLeft;
		const minLeft = 8;
		const maxLeft = Math.max(minLeft, hostRect.width - width - 8);
		if (left < minLeft) left = minLeft;
		if (left > maxLeft) left = maxLeft;

		let top = anchor.top;
		const height = root.offsetHeight || 0;
		const maxTop = height > 0 ? hostRect.height - height - 8 : hostRect.height - 80;
		if (top > maxTop) top = maxTop;
		if (top < 8) top = 8;

		this.lastPosition = { left: Math.round(left), top: Math.round(top) };
		root.setCssProps({ left: `${this.lastPosition.left}px`, top: `${this.lastPosition.top}px` });
	}
}

function shorten(text: string, limit: number): string {
	const single = text.replace(/\s+/g, ' ').trim();
	return single.length > limit ? `${single.slice(0, limit)}…` : single;
}
