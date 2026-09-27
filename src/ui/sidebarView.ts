import { ItemView, MarkdownRenderer, Notice, TFile, WorkspaceLeaf } from 'obsidian';
import { t } from '../i18n.ts';
import type PickmePlugin from '../main.ts';
import type { AnnotationDoc, AnnotationEntry } from '../core/types.ts';
import type { AskSink } from './askPanel.ts';
import { ConfirmModal } from './confirmModal.ts';

export const VIEW_TYPE_PICKME = 'pickme-sidebar';

/**
 * 侧边栏：查看当前文档已有哪些批注（跳转 / 重新绑定 / 删除）。
 * 提问本身在页面上完成——PDF 页面与阅读视图都有页面内面板，
 * 所以日常不必打开这里；只有关掉「页面内提问」时才在这里输入。
 */
export class PickmeSidebarView extends ItemView implements AskSink {
	private plugin: PickmePlugin;
	private file: TFile | null = null;
	private doc: AnnotationDoc | null = null;
	private activeId: string | null = null;
	private streamId: string | null = null;
	private streamText = '';
	private templateName = '';
	private templateNames: string[] = [];
	private modelOverride = '';
	private questionInput: HTMLTextAreaElement | null = null;
	private contextToggle: HTMLInputElement | null = null;
	private thinkToggle: HTMLInputElement | null = null;
	private statusEl: HTMLElement | null = null;
	private answerEls = new Map<string, HTMLElement>();

	constructor(leaf: WorkspaceLeaf, plugin: PickmePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_PICKME;
	}

	getDisplayText(): string {
		return t('Pick Me 批注');
	}

	getIcon(): string {
		return 'ghost';
	}

	async onOpen(): Promise<void> {
		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				const current = this.plugin.activeFile();
				if (current?.path !== this.file?.path) {
					void this.setFile(current);
				}
			}),
		);
		await this.setFile(this.plugin.activeFile());
	}

	async setFile(file: TFile | null): Promise<void> {
		this.file = file;
		this.activeId = null;
		await this.reload();
	}

	/** 重新从仓库读取批注并刷新界面 */
	async reload(): Promise<void> {
		this.templateNames = await this.plugin.templates.list();
		if (!this.file) {
			this.doc = null;
			this.render();
			return;
		}
		// 先让仓库重新扫描源文档，刷新锚点状态，再读取结果
		await this.plugin.repository.syncStatuses(this.file);
		this.doc = (await this.plugin.repository.loadFor(this.file)).doc;
		this.render();
	}

	currentFilePath(): string | null {
		return this.file?.path ?? null;
	}

	setActiveEntry(id: string | null): void {
		this.activeId = id;
		this.render();
	}

	beginStream(id: string): void {
		this.streamId = id;
		this.streamText = '';
		this.answerEls.delete(id);
		this.render();
		this.statusEl?.setText(t('正在生成：{v0}', { v0: id.split('#')[0] }));
	}

	appendStream(text: string): void {
		this.streamText = text;
		const holder = this.answerEls.get(this.streamId ?? '');
		if (holder) {
			holder.setText(text);
		}
	}

	endStream(): void {
		this.streamId = null;
		this.streamText = '';
		this.statusEl?.setText(t('已结束，可继续提问'));
	}

	/** 已经流式生成的部分，中止或失败时用于落盘 */
	currentStreamText(): string {
		return this.streamText;
	}

	selectedTemplate(): string {
		return this.templateName;
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('pickme-sidebar');
		this.answerEls.clear();

		if (!this.file) {
			root.createDiv({ cls: 'pickme-empty', text: t('当前没有打开 Markdown 或 PDF 文档。') });
			return;
		}

		const header = root.createDiv({ cls: 'pickme-header' });
		header.createDiv({ cls: 'pickme-file', text: this.file.basename });
		header.createDiv({
			cls: 'pickme-count',
			text: t('{v0} 条批注', { v0: this.doc?.entries.length ?? 0 }),
		});
		// 想一次看全库的批注，走索引侧边栏
		const toIndex = header.createEl('a', { cls: 'pickme-index-link', text: t('全部批注（索引）') });
		toIndex.setAttribute('title', t('打开批注索引'));
		toIndex.onclick = (event) => {
			event.preventDefault();
			void this.plugin.openIndexView();
		};

		this.renderComposerIfNeeded(root);
		this.renderEntries(root);
	}

	/** 只在关掉「页面内提问」时才在这里给输入框，否则这里纯粹是查看 */
	private renderComposerIfNeeded(root: HTMLElement): void {
		if (this.plugin.settings.inlineAsk) {
			root.createDiv({
				cls: 'pickme-hint',
				text: t('提问在页面上完成：PDF 里框选或点批注框，正文里点高亮文字。这里只用来查看和跳转。'),
			});
			return;
		}
		this.renderComposer(root);
	}

	private renderComposer(root: HTMLElement): void {
		const box = root.createDiv({ cls: 'pickme-composer' });
		const templateNames = this.templateNames;
		if (this.templateName === '' && templateNames.length > 0) {
			this.templateName = templateNames[0];
		}

		const row = box.createDiv({ cls: 'pickme-row' });
		const select = row.createEl('select', { cls: 'dropdown' });
		select.createEl('option', { text: t('直接提问'), value: '' });
		for (const name of templateNames) {
			select.createEl('option', { text: name, value: name });
		}
		select.value = this.templateName;
		select.onchange = () => {
			this.templateName = select.value;
		};

		// 模型下拉：默认 + 设置里配置的可选模型
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
			attr: { rows: '3', placeholder: t('输入问题，或选择上面的模板后直接发送') },
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

		// 勾选即记住，与页面内面板保持一致
		this.contextToggle?.addEventListener('change', () => {
			this.plugin.settings.includeContextByDefault = this.contextToggle?.checked ?? true;
			void this.plugin.saveSettings();
		});
		this.thinkToggle.addEventListener('change', () => {
			this.plugin.settings.deepThinking = this.thinkToggle?.checked ?? false;
			void this.plugin.saveSettings();
		});

		const send = actions.createEl('button', { cls: 'mod-cta', text: t('发送') });
		send.onclick = () => {
			void this.submit();
		};
		const cancel = actions.createEl('button', { text: t('停止') });
		cancel.onclick = () => {
			this.plugin.abortCurrent();
		};

		// 选中已有批注时提示会带上历史问答
		const activeEntry = this.doc?.entries.find((entry) => entry.id === this.activeId) ?? null;
		const rounds = activeEntry ? activeEntry.qas.filter((qa) => qa.answer.trim() !== '').length : 0;
		this.statusEl = box.createDiv({
			cls: 'pickme-status',
			text: this.activeId
				? rounds > 0
					? t('目标批注：{id}（追问，带上已有 {rounds} 轮问答）', {
							id: this.activeId,
							rounds,
						})
					: t('目标批注：{id}', { id: this.activeId })
				: t('目标：当前选区'),
		});
	}

	private async submit(): Promise<void> {
		const question = this.questionInput?.value ?? '';
		const withContext = this.contextToggle?.checked ?? true;
		const deepThinking = this.thinkToggle?.checked ?? this.plugin.settings.deepThinking;
		await this.plugin.ask({
			question,
			templateName: this.templateName,
			withContext,
			entryId: this.activeId,
			modelOverride: this.modelOverride,
			deepThinking,
			// 带上侧边栏当前这条批注所属的文件，别靠活动文档猜
			file: this.file ?? undefined,
		});
		if (this.questionInput) this.questionInput.value = '';
	}

	private renderEntries(root: HTMLElement): void {
		const entries = this.doc?.entries ?? [];
		const list = root.createDiv({ cls: 'pickme-entries' });
		if (entries.length === 0) {
			list.createDiv({ cls: 'pickme-empty', text: t('还没有批注。选中文字后右键，或用命令「对选区提问或批注」。') });
			return;
		}
		for (const entry of entries) {
			this.renderEntry(list, entry);
		}
	}

	private renderEntry(list: HTMLElement, entry: AnnotationEntry): void {
		const card = list.createDiv({ cls: 'pickme-card' });
		if (entry.id === this.activeId) card.addClass('is-active');
		if (entry.status === 'stale') card.addClass('is-stale');

		const head = card.createDiv({ cls: 'pickme-card-head' });
		head.createSpan({ cls: 'pickme-tag', text: entry.id });
		head.createSpan({
			cls: 'pickme-kind',
			text:
				entry.kind === 'pdf'
					? t('PDF 第 {page} 页', { page: entry.pdf?.page ?? '?' })
					: t('文本'),
		});
		head.createSpan({
			cls: `pickme-status-dot ${entry.status === 'ok' ? 'is-ok' : 'is-stale'}`,
			text: entry.status === 'ok' ? t('有效') : t('失效'),
		});
		head.onclick = () => {
			this.setActiveEntry(entry.id);
		};

		const selection = entry.kind === 'pdf' ? entry.pdf?.hitText ?? '' : entry.selection;
		if (selection) {
			card.createDiv({ cls: 'pickme-selection', text: shorten(selection, 120) });
		}

		// PDF 批注显示框选区域的缩略图
		if (entry.kind === 'pdf' && entry.pdf?.image) {
			const thumb = card.createEl('img', { cls: 'pickme-thumb' });
			thumb.onclick = () => {
				this.setActiveEntry(entry.id);
			};
			// 批注目录可能在配置目录里，取 url 的方式由 io 决定
			void this.plugin.repository.io.resourceUrl(entry.pdf.image).then((url) => {
				if (url) thumb.src = url;
			});
		}

		const actions = card.createDiv({ cls: 'pickme-row pickme-actions' });
		const open = actions.createEl('button', { text: t('打开') });
		open.onclick = () => {
			// 页面内打开这条批注的面板（PDF 页面 / 阅读视图）
			void this.plugin.activateEntry(entry.id);
		};
		if (!this.plugin.settings.inlineAsk) {
			const askHere = actions.createEl('button', { text: t('在此提问') });
			askHere.onclick = () => {
				this.setActiveEntry(entry.id);
				this.questionInput?.focus();
			};
		}
		const jump = actions.createEl('button', { text: t('跳转') });
		jump.onclick = () => {
			void this.plugin.jumpToAnchor(entry.id);
		};
		if (entry.status === 'stale') {
			const rebind = actions.createEl('button', { text: t('重新绑定') });
			rebind.onclick = () => {
				void this.plugin.rebindEntry(entry.id);
			};
		}
		const remove = actions.createEl('button', { text: t('删除') });
		remove.addClass('mod-warning');
		remove.onclick = () => {
			const detail =
				entry.kind === 'pdf'
					? t('将删除批注 {v0} 与它的区域截图。', { v0: entry.id })
					: t('将删除批注 {v0}，并从原文里移除这一对锚点标签（选区内文字不动）。', { v0: entry.id });
			new ConfirmModal(this.app, detail, () => {
				void this.plugin.deleteEntry(entry.id);
			}).open();
		};

		entry.qas.forEach((qa, index) => {
			const block = card.createEl('details', { cls: 'pickme-qa' });
			if (index === entry.qas.length - 1) block.setAttribute('open', '');
			block.createEl('summary', { text: qa.question ? shorten(qa.question, 40) : t('第 {v0} 次提问', { v0: index + 1 }) });
			if (qa.question) block.createDiv({ cls: 'pickme-q', text: t('问：{v0}', { v0: qa.question }) });
			if (qa.template) block.createDiv({ cls: 'pickme-meta', text: t('模板：{v0}', { v0: qa.template }) });
			const answer = block.createDiv({ cls: 'pickme-a' });
			if (this.streamId === `${entry.id}#${index}`) {
				answer.setText(this.streamText);
				this.answerEls.set(`${entry.id}#${index}`, answer);
			} else {
				void MarkdownRenderer.render(this.app, qa.answer, answer, entry.kind === 'pdf' ? '' : this.file?.path ?? '', this);
			}
		});
	}

	/** 流式输出时定位到对应回答块 */
	streamKey(entryId: string, index: number): string {
		return `${entryId}#${index}`;
	}
}

function shorten(text: string, limit: number): string {
	const single = text.replace(/\s+/g, ' ').trim();
	return single.length > limit ? `${single.slice(0, limit)}…` : single;
}

export async function activateSidebar(plugin: PickmePlugin): Promise<PickmeSidebarView> {
	const existing = plugin.app.workspace.getLeavesOfType(VIEW_TYPE_PICKME);
	if (existing.length > 0) {
		await plugin.app.workspace.revealLeaf(existing[0]);
		return existing[0].view as PickmeSidebarView;
	}
	const leaf = plugin.app.workspace.getRightLeaf(false);
	if (!leaf) {
		new Notice(t('pickme：无法创建侧边栏'));
		throw new Error('no leaf');
	}
	await leaf.setViewState({ type: VIEW_TYPE_PICKME, active: true });
	await plugin.app.workspace.revealLeaf(leaf);
	return leaf.view as PickmeSidebarView;
}
