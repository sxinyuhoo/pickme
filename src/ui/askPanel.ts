import { Component, MarkdownRenderer, Platform, TFile } from 'obsidian';
import { t, templateLabel } from '../i18n.ts';
import type PickmePlugin from '../main.ts';
import { parseAnnotationDoc } from '../core/annotationDoc.ts';
import { ConfirmModal } from './confirmModal.ts';
import { shapesOf } from '../core/types.ts';
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
	/**
	 * 面板形态：'note' = 简单批注框，'ask' = AI 问答面板。
	 * 不传就按批注自己判断——荧光笔高亮给批注框，框选区域给问答。
	 */
	mode?: 'ask' | 'note';
	onClose?: () => void;
}

/** 点开写备注的那两类：纯荧光笔高亮（全是 line），或纯便利贴（全是 note） */
function isNoteBoxEntry(entry: AnnotationEntry | null): boolean {
	if (!entry || entry.kind !== 'pdf' || !entry.pdf) return false;
	const shapes = shapesOf(entry.pdf);
	return shapes.length > 0 && shapes.every((shape) => shape.kind === 'line' || shape.kind === 'note');
}

/** 便利贴：全页只有一个 note 形状没有色带 —— 文案上要说「便利贴」而不是「高亮」 */
function isStickyEntry(entry: AnnotationEntry | null): boolean {
	if (!entry || entry.kind !== 'pdf' || !entry.pdf) return false;
	const shapes = shapesOf(entry.pdf);
	return shapes.length > 0 && shapes.every((shape) => shape.kind === 'note');
}

const PANEL_WIDTH = 380;

/** 上一次用的是哪一栏（批注 / 问 AI）：同一会话里沿用，省得每次都要切一下 */
let lastPane: 'note' | 'ask' | null = null;

/** 关面板的原因：用户主动取消，还是被新面板顶掉 */
export type PanelCloseReason = 'user' | 'handover';

/** 每个宿主视图只留一个面板 */
const panels = new WeakMap<HTMLElement, AskPanel>();

/**
 * 在页面内打开提问面板（不打开侧边栏）。
 * 同一个视图里再打开时会先关掉上一个。
 */
export function openAskPanel(options: AskPanelOptions): AskPanel {
	// 被新面板顶掉不算「取消」：用户是去开另一条批注了，刚划的那条要留下
	panels.get(options.host)?.close('handover');
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
	/** 当前形态：用户点过「改问 AI」就固定成 'ask' */
	private mode: 'ask' | 'note' | null = null;
	/** 「问 AI」栏的默认提示（首次提问 / 追问），切栏时写进共用的状态行 */
	private askHint = '';
	/** 批注栏最近一次的状态（保存成功之类），切回来时恢复 */
	private noteStatus = '';
	private noteTab: HTMLElement | null = null;
	private askTab: HTMLElement | null = null;
	private noteInput: HTMLTextAreaElement | null = null;
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
		this.mode = options.mode ?? null;
		this.child.load();
	}

	async open(): Promise<void> {
		this.ensureLayer();
		if (this.closed) return;
		this.templateNames = await this.plugin.templates.list();
		// reload 内部会 render，this.root 到这里才建好
		await this.reload();
		this.applyPosition();
		this.applyKeyboardInset();
		window.addEventListener('scroll', this.onViewportChange, true);
		window.addEventListener('resize', this.onViewportChange);
		// 手机上是底部抽屉：软键盘弹起时可视区会变矮，抽屉得跟着抬起来，否则输入框被盖住
		window.visualViewport?.addEventListener('resize', this.onKeyboardChange);
		window.visualViewport?.addEventListener('scroll', this.onKeyboardChange);
		this.applyKeyboardInset();
		(this.noteInput ?? this.questionInput)?.focus();
	}

	/**
	 * 关面板。reason='user' 是用户主动取消（× / Esc / 删除），
	 * reason='handover' 是被新面板顶掉或视图卸载——那种情况不能算取消，
	 * 否则「划一笔 → 点同一条再看一眼」会把自己这条批注删掉。
	 */
	close(reason: PanelCloseReason = 'user'): void {
		if (this.closed) return;
		this.closed = true;
		window.removeEventListener('scroll', this.onViewportChange, true);
		window.removeEventListener('resize', this.onViewportChange);
		window.visualViewport?.removeEventListener('resize', this.onKeyboardChange);
		window.visualViewport?.removeEventListener('scroll', this.onKeyboardChange);
		this.layer?.remove();
		this.layer = null;
		this.root = null;
		this.child.unload();
		this.onClose();
		if (reason === 'user') void this.discardIfUntouched();
	}

	/**
	 * 刚框出来的批注、且一次都没问过：用户主动关掉面板就等于取消，
	 * 把它和页面上的高亮一起撤掉，不留半条空批注。
	 * 只在 close('user') 时走到这里——被新面板顶掉时批注要留着。
	 */
	private async discardIfUntouched(): Promise<void> {
		if (!this.fresh) return;
		this.fresh = false;
		// 写过批注的高亮不能因为关面板被撤销
		try {
			const doc = (await this.plugin.repository.loadFor(this.file)).doc;
			const entry = doc.entries.find((item) => item.id === this.entryId);
			if (!entry) return;
			// 写过高亮批注：用户认下了这条高亮，关面板不能把它撤掉
			if (entry.note?.trim()) return;
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
			root.setCssProps({ '--pk-l': `${this.lastPosition.left}px`, '--pk-t': `${this.lastPosition.top}px` });
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

		// 批注与「问 AI」都摆进同一个弹框：上面一排切换，下面两块，切换时只换类名不重建 DOM
		const pane = this.resolvePane(entry);
		this.renderPaneSwitch(root);
		const notePane = root.createDiv({ cls: 'pickme-pane pickme-pane-note' });
		this.renderNoteBox(notePane, entry);
		const askPane = root.createDiv({ cls: 'pickme-pane pickme-pane-ask' });
		this.renderComposer(askPane, entry);
		// 状态行两栏共用一条：各自建一条的话，setStatus 只会写到最后建的那条上
		this.statusEl = root.createDiv({ cls: 'pickme-status' });
		// AI 问答只属于「问 AI」那一栏：批注栏里不摆它，两个功能的内容分开
		if (entry.qas.length) this.renderHistory(askPane, entry);
		this.setPane(pane);
		// 内容变了尺寸也变，重排后按锚点再校一次位置
		this.applyPosition();
	}

	/**
	 * 荧光笔的批注框：一句话备注就够，不牵扯 AI。
	 * 想交给 AI 就点「改问 AI」，面板原地换成问答形态。
	 */
	private renderNoteBox(root: HTMLElement, entry: AnnotationEntry): void {
		const box = root.createDiv({ cls: 'pickme-note' });
		// 展示态：把已保存的批注按 Markdown 渲染出来（和正文用同一个渲染器）
		const view = box.createDiv({ cls: 'pickme-note-view' });
		// 编辑态：这条批注唯一的编辑处
		const input = box.createEl('textarea', { cls: 'pickme-note-input' });
		this.noteInput = input;
		input.rows = 3;
		input.placeholder = isStickyEntry(entry) ? t('写点什么…（⌘/Ctrl + Enter 保存）') : t('写点批注…（⌘/Ctrl + Enter 保存）');
		input.value = entry.note ?? '';

		/**
		 * 只保留一套逻辑：没有内容时直接给输入框；有内容时先渲染出来看，点「编辑」就地变输入框。
		 * 以前是「输入框 + 已保存回显」同时摆着，两边内容一样，看着冗余。
		 */
		const setEditing = (editing: boolean): void => {
			box.toggleClass('is-editing', editing);
			box.toggleClass('is-viewing', !editing);
			if (editing) {
				input.focus();
				return;
			}
			view.empty();
			const text = (entry.note ?? '').trim();
			if (!text) {
				view.createDiv({ cls: 'pickme-note-empty', text: t('还没有批注内容') });
				return;
			}
			void MarkdownRenderer.render(this.plugin.app, text, view, entry.kind === 'pdf' ? '' : this.file.path, this.child);
		};

		const row = box.createDiv({ cls: 'pickme-row' });
		// 同一排里「保存批注」和「编辑」是同一个位置：编辑态给保存，展示态给编辑
		const save = row.createEl('button', { cls: 'mod-cta', text: t('保存批注') });
		const edit = row.createEl('button', { cls: 'pickme-note-edit', text: t('编辑') });
		edit.setAttribute('aria-label', t('就在这个框里改这条批注'));
		edit.onclick = () => setEditing(true);
		const ask = row.createEl('button', { text: t('改问 AI') });
		ask.setAttribute('aria-label', t('把这条高亮交给 AI 提问'));
		const sticky = isStickyEntry(entry);
		const isText = entry.kind === 'text';
		// 删除按钮两栏统一叫「删除」：具体删的是什么，交给确认框说明
		const remove = row.createEl('button', { cls: 'pickme-note-remove', text: t('删除') });
		remove.setAttribute('aria-label', sticky ? t('连同便利贴一起删掉') : isText ? t('连同锚点一起删掉') : t('连同这条高亮一起删掉'));



		const saveNote = async () => {
			const text = input.value.trim();
			await this.plugin.saveNote(this.entryId, this.file, text);
			// 存过就当成「认下了这条批注」：关面板不再撤销它
			this.fresh = false;
			entry.note = text || undefined;
			// 存完就切回「看」的状态：内容按 Markdown 渲染出来
			setEditing(false);
			// 便利贴是「贴完就走」：保存即完成，不用再去点一次关闭（框自己关掉就是反馈）
			if (isStickyEntry(entry)) {
				this.close();
				return;
			}
			// 高亮的备注框停在原地，方便接着改或者点「改问 AI」
			this.noteStatus = text ? t('批注已保存') : t('批注已清空');
			this.setStatus(this.noteStatus);
		};
		input.addEventListener('keydown', (event) => {
			// 面板的 Esc 监听挂在问答输入框上，批注框里没有那个元素，得自己接一个：
			// 否则「放下便利贴 → 不想写 → Esc」既关不掉面板，空便利贴也收不回去
			if (event.key === 'Escape') {
				event.preventDefault();
				this.close();
				return;
			}
			if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
				event.preventDefault();
				void saveNote();
			}
		});
		save.onclick = () => void saveNote();
		ask.onclick = () => this.setPane('ask');
		// 首次打开：还没有内容就直接给输入框；已经写过就先渲染出来看
		setEditing(!(entry.note ?? '').trim());
		remove.onclick = () => {
			new ConfirmModal(
				this.plugin.app,
				sticky ? t('删掉这张便利贴？') : isText ? t('连同正文里的锚点一起删掉这条批注？') : t('连同高亮删掉这条批注？'),
				() => {
					void this.plugin.deleteEntry(this.entryId, this.file).then(() => this.close('handover'));
				},
			).open();
		};
	}

	/** 先摆哪一栏：批注，还是问 AI */
	private resolvePane(entry: AnnotationEntry | null): 'note' | 'ask' {
		if (this.mode === 'note') return 'note';
		if (this.mode === 'ask') return 'ask';
		// 文字批注（Markdown 选区）两种都支持：第一次进来先给「批注」，之后沿用上次选的那一栏
		if (entry?.kind === 'text') return lastPane ?? 'note';
		return isNoteBoxEntry(entry) ? 'note' : 'ask';
	}

	/** 顶部那排切换：批注 ｜ 问 AI */
	private renderPaneSwitch(root: HTMLElement): void {
		const bar = root.createDiv({ cls: 'pickme-switch' });
		this.noteTab = bar.createEl('button', { cls: 'pickme-switch-item', text: t('批注') });
		this.askTab = bar.createEl('button', { cls: 'pickme-switch-item', text: t('问 AI') });
		this.noteTab.onclick = () => this.setPane('note');
		this.askTab.onclick = () => this.setPane('ask');
	}

	private setPane(pane: 'note' | 'ask'): void {
		lastPane = pane;
		const root = this.root;
		if (!root) return;
		root.toggleClass('is-pane-note', pane === 'note');
		root.toggleClass('is-pane-ask', pane === 'ask');
		this.noteTab?.toggleClass('is-active', pane === 'note');
		this.askTab?.toggleClass('is-active', pane === 'ask');
		this.noteTab?.setAttribute('aria-pressed', String(pane === 'note'));
		this.askTab?.setAttribute('aria-pressed', String(pane === 'ask'));
		// 状态行是两栏共用的：切栏时换回这一栏该显示的话
		this.setStatus(pane === 'ask' ? this.askHint : this.noteStatus);
	}

	private renderComposer(root: HTMLElement, entry: AnnotationEntry): void {
		const box = root.createDiv({ cls: 'pickme-composer' });

		const row = box.createDiv({ cls: 'pickme-row' });
		// 默认「直接提问」（空值）。曾经这里会把模板强制设成列表里的第一个，
		// 结果用户自己打字提问也被套上翻译模板的提示词，批注里还记成「模板：翻译」。
		const select = row.createEl('select', { cls: 'dropdown' });
		select.createEl('option', { text: t('直接提问'), value: '' });
		for (const name of this.templateNames) {
			// 内置模板（解释/摘要/翻译）按界面语言显示名字，自定义模板原样
			select.createEl('option', { text: templateLabel(name), value: name });
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
			const remove = actions.createEl('button', { cls: 'pickme-note-remove', text: t('删除') });
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
		this.askHint = rounds > 0 ? t('追问：会带上已有 {v0} 轮问答', { v0: rounds }) : t('首次提问');
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

	/** 手机软键盘的高度：可视区比窗口矮多少，抽屉就往上抬多少 */
	private onKeyboardChange = (): void => {
		this.applyKeyboardInset();
	};

	private applyKeyboardInset(): void {
		const root = this.root;
		if (!root || !Platform.isMobile) return;
		const viewport = window.visualViewport;
		const covered = viewport ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop) : 0;
		root.setCssProps({ '--pk-kb': `${Math.round(covered)}px`, '--pk-bar': `${this.mobileBottomBarHeight()}px` });
	}

	/**
	 * Obsidian 移动端的底部工具栏是浮在正文之上的，抽屉贴着屏幕底会被它压住。
	 * 量一下它有多高，把抽屉垫到它上面；实在找不到就给个保守值。
	 */
	private mobileBottomBarHeight(): number {
		let height = 0;
		for (const selector of ['.mobile-toolbar', '.mobile-navbar', '.mobile-nav-bar']) {
			const el = document.querySelector(selector);
			if (el instanceof HTMLElement && el.offsetParent !== null) {
				height = Math.max(height, el.getBoundingClientRect().height);
			}
		}
		return Math.round(Math.max(height + 8, 52));
	}

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
			root.setCssProps({ '--pk-l': `${fallback.left}px`, '--pk-t': `${fallback.top}px` });
			return;
		}
		if (!anchor) {
			// 沿用上次落点；确实没有过落点（首次打开且量不到锚点）才退回左上角
			const fallback = this.lastPosition ?? { left: 12, top: 12 };
			root.setCssProps({ '--pk-l': `${fallback.left}px`, '--pk-t': `${fallback.top}px` });
			return;
		}
		const width = Math.min(PANEL_WIDTH, Math.max(240, hostRect.width - 24));
		root.setCssProps({ '--pk-w': `${width}px` });

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
		root.setCssProps({ '--pk-l': `${this.lastPosition.left}px`, '--pk-t': `${this.lastPosition.top}px` });
	}
}

function shorten(text: string, limit: number): string {
	const single = text.replace(/\s+/g, ' ').trim();
	return single.length > limit ? `${single.slice(0, limit)}…` : single;
}
