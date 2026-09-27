import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import { t } from '../i18n.ts';
import type PickmePlugin from '../main.ts';
import type { IndexGroup } from '../store/repository.ts';
import type { AnnotationEntry } from '../core/types.ts';

export const VIEW_TYPE_PICKME_INDEX = 'pickme-index-view';

/**
 * 批注索引：把全部文档的批注集中在一个侧边栏里看。
 * 取代以前那张「写进库里」的 Markdown 索引表——表还在生成（在插件目录里，给 Dataview 与备份用），
 * 但日常查看走这里：点文档名打开原文，点某一行直接跳过去。
 */
export class PickmeIndexView extends ItemView {
	private plugin: PickmePlugin;
	private groups: IndexGroup[] = [];
	private filter = '';
	/** 哪些文档的「失效」折叠块被点开过（刷新后仍然记得） */
	private openedStale = new Set<string>();

	constructor(leaf: WorkspaceLeaf, plugin: PickmePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_PICKME_INDEX;
	}

	getDisplayText(): string {
		return t('Pick Me：批注索引');
	}

	getIcon(): string {
		return 'ghost';
	}

	async onOpen(): Promise<void> {
		await this.reload();
	}

	async reload(): Promise<void> {
		this.groups = await this.plugin.repository.indexData();
		this.render();
	}

	private totals(): { entries: number; files: number } {
		let entries = 0;
		for (const group of this.groups) entries += group.entries.length;
		return { entries, files: this.groups.length };
	}

	/** 过滤只看「命中的条目」，文档名命中时整篇都留 */
	private visible(): IndexGroup[] {
		const needle = this.filter.trim().toLowerCase();
		if (!needle) return this.groups;
		const out: IndexGroup[] = [];
		for (const group of this.groups) {
			if (group.sourceName.toLowerCase().includes(needle)) {
				out.push(group);
				continue;
			}
			const entries = group.entries.filter((entry) => this.haystack(group, entry).includes(needle));
			if (entries.length > 0) out.push({ ...group, entries });
		}
		return out;
	}

	private haystack(group: IndexGroup, entry: AnnotationEntry): string {
		const what = entry.kind === 'pdf' ? `第 ${entry.pdf?.page ?? ''} 页` : entry.selection;
		return `${group.sourceName} ${entry.id} ${what}`.toLowerCase();
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('pickme-sidebar');
		root.addClass('pickme-index');

		const { entries, files } = this.totals();
		const header = root.createDiv({ cls: 'pickme-header' });
		header.createDiv({ cls: 'pickme-file', text: t('批注索引') });
		header.createDiv({
			cls: 'pickme-count',
			text: t('{v0} 条批注 · {v1} 个文档', { v0: entries, v1: files }),
		});

		const tools = root.createDiv({ cls: 'pickme-row pickme-index-tools' });
		const search = tools.createEl('input', {
			cls: 'pickme-index-filter',
			type: 'text',
			placeholder: t('过滤：文档名、选区或锚点 id'),
		});
		search.value = this.filter;
		const refresh = tools.createEl('button', { cls: 'pickme-icon-button' });
		setIcon(refresh, 'refresh-cw');
		refresh.setAttribute('aria-label', t('刷新'));
		refresh.setAttribute('title', t('刷新'));
		refresh.onclick = () => void this.reload();

		const list = root.createDiv({ cls: 'pickme-index-list' });
		search.oninput = () => {
			this.filter = search.value;
			this.renderList(list);
		};
		this.renderList(list);
	}

	private renderList(list: HTMLElement): void {
		list.empty();
		const groups = this.visible();
		if (groups.length === 0) {
			list.createDiv({
				cls: 'pickme-empty',
				text: this.filter ? t('没有匹配的批注。') : t('还没有批注。选中正文或框选 PDF 之后，这里就有条目了。'),
			});
			return;
		}
		for (const group of groups) {
			const card = list.createDiv({ cls: 'pickme-card pickme-index-group' });
			const head = card.createDiv({ cls: 'pickme-index-source' });
			const name = head.createEl('a', { cls: 'pickme-index-name', text: group.sourceName });
			name.setAttribute('title', t('打开源文档'));
			name.setAttribute('tabindex', '0');
			name.onclick = (event) => {
				event.preventDefault();
				void this.openSource(group);
			};
			name.onkeydown = (event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					void this.openSource(group);
				}
			};
			head.createSpan({ cls: 'pickme-count', text: t('{v0} 条', { v0: group.entries.length }) });

			// 有效的照常列出；失效的默认折起来，免得看着像一堆坏数据
			const live = group.entries.filter((entry) => entry.status === 'ok');
			const stale = group.entries.filter((entry) => entry.status !== 'ok');
			for (const entry of live) this.renderEntry(card, group, entry);
			if (stale.length > 0) this.renderStale(card, group, stale);
		}
	}

	/** 失效的批注：一条可点开的「失效（N）」，展开才逐条列出，并写明为什么失效 */
	private renderStale(parent: HTMLElement, group: IndexGroup, stale: AnnotationEntry[]): void {
		const expanded = this.openedStale.has(group.sourcePath);
		const toggle = parent.createDiv({ cls: 'pickme-index-stale-toggle' });
		toggle.setAttribute('tabindex', '0');
		toggle.setAttribute('role', 'button');
		toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
		const toggleText = t('失效（{v0}）', { v0: stale.length });
		toggle.setText(`${expanded ? '▾' : '▸'} ${toggleText}`);
		toggle.setAttribute('title', t('这些批注的锚点在原文里找不到了，点开查看'));
		const flip = () => {
			if (expanded) this.openedStale.delete(group.sourcePath);
			else this.openedStale.add(group.sourcePath);
			this.render();
		};
		toggle.onclick = flip;
		toggle.onkeydown = (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				flip();
			}
		};
		if (!expanded) return;
		for (const entry of stale) this.renderEntry(parent, group, entry);
	}

	private renderEntry(parent: HTMLElement, group: IndexGroup, entry: AnnotationEntry): void {
		const stale = entry.status !== 'ok';
		const row = parent.createDiv({ cls: stale ? 'pickme-index-entry is-stale' : 'pickme-index-entry' });
		row.setAttribute('title', t('打开源文档并跳到这条批注'));
		// 一条一行，键盘也能开
		row.setAttribute('tabindex', '0');
		row.setAttribute('role', 'button');
		const open = () => void this.openEntry(group, entry);
		row.onclick = open;
		row.onkeydown = (event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				open();
			}
		};

		// PDF 批注带框选区域的小图，一眼认得出是哪张
		if (entry.kind === 'pdf' && entry.pdf?.image) {
			const thumb = row.createEl('img', { cls: 'pickme-index-thumb' });
			thumb.setAttribute('alt', '');
			void this.plugin.repository.io.resourceUrl(entry.pdf.image).then((url) => {
				if (url) thumb.src = url;
			});
		}

		const body = row.createDiv({ cls: 'pickme-index-body' });
		const what =
			entry.kind === 'pdf' ? t('第 {v0} 页区域', { v0: entry.pdf?.page ?? '?' }) : entry.selection;
		body.createDiv({ cls: 'pickme-index-what', text: shorten(what, 48) });
		const meta = body.createDiv({ cls: 'pickme-index-meta' });
		if (stale) meta.createSpan({ cls: 'pickme-index-warn', text: t('失效') });
		if (entry.qas.length > 0) meta.createSpan({ text: t('{v0} 问', { v0: entry.qas.length }) });
		meta.createSpan({ text: `#${entry.id}` });
		const created = entry.created ? shortDate(entry.created) : '';
		if (created) meta.createSpan({ text: created });
		if (stale) {
			body.createDiv({ cls: 'pickme-index-reason', text: t('原文已改动，锚点找不到了') });
			body.createDiv({ cls: 'pickme-index-reason', text: t('用命令「重新绑定失效锚点」可以把它挂回原文') });
		}
	}

	private async openSource(group: IndexGroup): Promise<void> {
		const file = this.plugin.app.vault.getAbstractFileByPath(group.sourcePath);
		if (!(file instanceof TFile)) {
			new Notice(t('pickme：找不到源文档 {v0}', { v0: group.sourcePath }));
			return;
		}
		await this.plugin.app.workspace.getLeaf(false).openFile(file);
	}

	private async openEntry(group: IndexGroup, entry: AnnotationEntry): Promise<void> {
		await this.plugin.openEntryAt(group.sourcePath, entry.id);
	}
}

function shorten(text: string, limit: number): string {
	const single = text.replace(/\s+/g, ' ').trim();
	if (single.length <= limit) return single;
	return `${single.slice(0, limit)}…`;
}

/** ISO 时间戳只留到分钟，索引里不需要秒 */
function shortDate(value: string): string {
	const date = new Date(value);
	// 脏数据（比如写坏了的时间戳）宁可不显示，也别在界面上摆个 undefined
	if (!value || Number.isNaN(date.getTime())) return '';
	const pad = (n: number) => String(n).padStart(2, '0');
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
