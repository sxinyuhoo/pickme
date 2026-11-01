import { ItemView, Notice, setIcon, TFile, WorkspaceLeaf } from 'obsidian';
import { t } from '../i18n.ts';
import type PickmePlugin from '../main.ts';
import type { IndexGroup } from '../store/repository.ts';
import { shapeKindLabel } from '../core/types.ts';
import type { AnnotationEntry } from '../core/types.ts';
import { ConfirmModal } from './confirmModal.ts';

export const VIEW_TYPE_PICKME_INDEX = 'pickme-index-view';

/** 形状短称：这里静态写 t()，i18n 覆盖测试才认得出这几个词 */
function shapeWord(entry: AnnotationEntry): string {
	const kind = entry.pdf ? shapeKindLabel(entry.pdf) : '框选';
	if (kind === '框+线') return t('框+线');
	return kind === '荧光' ? t('荧光') : t('框选');
}

/**
 * 一行对应的批注。行的稳定身份是「源路径 + 锚点 id」，
 * 文档移动/改名或刷新之后依然点得回同一条，被删掉的自然消失。
 */
interface RowRef {
	group: IndexGroup;
	entry: AnnotationEntry;
}

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

	/** 是否处于多选模式：视图根元素挂 pickme-index-selmode，工具条按钮挂 is-active */
	private selecting = false;
	/** 已勾选的批注，key = 源路径 + 锚点 id：刷新后仍在，被删掉的自然消失 */
	private picked = new Set<string>();
	/** 键盘光标所在的行 key（视觉上给一行 is-cursor 即可） */
	private cursorKey: string | null = null;

	/** 当前渲染出来的行：key → 行元素，供勾选与键盘就地更新，不用整屏重画 */
	private rowEls = new Map<string, HTMLElement>();
	/** 行 key 的显示顺序，供 ↑↓ 在行间移动 */
	private rowOrder: string[] = [];
	/** 选择条上要就地更新的两处：已选数字与删除按钮的可用状态 */
	private selCountEl: HTMLElement | null = null;
	private selDelBtn: HTMLButtonElement | null = null;

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
		this.prunePicked();
		this.render();
	}

	private totals(): { entries: number; files: number } {
		const countStale = this.showStale();
		let entries = 0;
		for (const group of this.groups) {
			entries += countStale ? group.entries.length : group.entries.filter((entry) => entry.status === 'ok').length;
		}
		return { entries, files: this.groups.length };
	}

	/** 是否在索引里列出「锚点丢失」的批注（设置项，默认开） */
	private showStale(): boolean {
		return this.plugin.settings.showStaleInIndex !== false;
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

	/** 行的稳定身份：源路径 + 锚点 id */
	private pickKey(group: IndexGroup, entry: AnnotationEntry): string {
		return `${group.sourcePath}::${entry.id}`;
	}

	private render(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('pickme-sidebar');
		root.addClass('pickme-index');
		root.toggleClass('pickme-index-selmode', this.selecting);
		// 键盘操作挂在视图根上：行、勾选框上的按键都会冒泡到这里
		root.onkeydown = (event) => this.onKeyDown(event);

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
			placeholder: t('过滤批注…'),
		});
		search.value = this.filter;
		const refresh = tools.createEl('button', { cls: 'pickme-icon-button' });
		setIcon(refresh, 'refresh-cw');
		refresh.setAttribute('aria-label', t('刷新'));
		refresh.setAttribute('title', t('刷新'));
		refresh.onclick = () => void this.reload();
		// 多选：进/出选择模式的开关，开着的时候按钮自己挂 is-active
		const multi = tools.createEl('button', { cls: 'pickme-index-selmode-toggle', text: t('多选') });
		multi.toggleClass('is-active', this.selecting);
		multi.setAttribute('aria-pressed', this.selecting ? 'true' : 'false');
		multi.setAttribute('title', t('多选'));
		multi.onclick = () => this.toggleSelectMode();

		// 选择条就摆在工具条正下方（只有选择模式里才有）
		this.renderSelBar(root);

		const list = root.createDiv({ cls: 'pickme-index-list' });
		search.oninput = () => {
			this.filter = search.value;
			this.renderList(list);
		};
		this.renderList(list);
	}

	/** 选择条：已选 N 条 / 全选 / 取消选择 / 删除所选（0 条时删除禁用） */
	private renderSelBar(root: HTMLElement): void {
		this.selCountEl = null;
		this.selDelBtn = null;
		if (!this.selecting) return;
		const bar = root.createDiv({ cls: 'pickme-index-selbar' });
		const status = bar.createSpan({ cls: 'pickme-index-selstatus' });
		// 「已选 N 条」整句走 i18n，数字单独包一层：占位符当切口，词序不同的语言也不会错位
		const marker = '\u0000';
		const [before, after = ''] = t('已选 {v0} 条', { v0: marker }).split(marker);
		status.appendText(before);
		this.selCountEl = status.createSpan({ cls: 'pickme-index-selcount', text: String(this.picked.size) });
		status.appendText(after);

		const all = bar.createEl('button', { cls: 'pickme-index-selall', text: t('全选') });
		all.onclick = () => this.pickAll();
		const none = bar.createEl('button', { cls: 'pickme-index-selnone', text: t('取消选择') });
		none.onclick = () => this.pickNone();
		const del = bar.createEl('button', { cls: 'pickme-index-del', text: t('删除所选') });
		del.disabled = this.picked.size === 0;
		del.onclick = () => this.confirmDeletePicked();
		this.selDelBtn = del;
	}

	private renderList(list: HTMLElement): void {
		list.empty();
		this.rowEls = new Map();
		this.rowOrder = [];
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
			const shown = this.showStale() ? group.entries.length : group.entries.filter((entry) => entry.status === 'ok').length;
			head.createSpan({ cls: 'pickme-count', text: t('{v0} 条', { v0: shown }) });

			// 有效的照常列出；失效的默认折起来，免得看着像一堆坏数据。
			// 「索引里显示锚点丢失的批注」关掉后整段不渲染（数据仍在批注文件里，不会丢）
			const live = group.entries.filter((entry) => entry.status === 'ok');
			const stale = group.entries.filter((entry) => entry.status !== 'ok');
			for (const entry of live) this.renderEntry(card, group, entry);
			if (this.showStale() && stale.length > 0) this.renderStale(card, group, stale);
		}
	}

	/** 失效的批注：一条可点开的「失效（N）」，展开才逐条列出，并写明为什么失效 */
	private renderStale(parent: HTMLElement, group: IndexGroup, stale: AnnotationEntry[]): void {
		const expanded = this.openedStale.has(group.sourcePath);
		const toggle = parent.createDiv({ cls: 'pickme-index-stale-toggle' });
		toggle.setAttribute('tabindex', '0');
		toggle.setAttribute('role', 'button');
		toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
		const toggleText = t('锚点丢失（{v0}）', { v0: stale.length });
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
		const key = this.pickKey(group, entry);
		const row = parent.createDiv({ cls: stale ? 'pickme-index-entry is-stale' : 'pickme-index-entry' });
		row.toggleClass('is-picked', this.selecting && this.picked.has(key));
		row.toggleClass('is-cursor', this.cursorKey === key);
		if (!this.selecting) row.setAttribute('title', t('打开源文档并跳到这条批注'));
		// 一条一行，键盘也能开
		row.setAttribute('tabindex', '0');
		row.setAttribute('role', 'button');
		this.rowEls.set(key, row);
		this.rowOrder.push(key);

		// 选择模式：行最左侧一个勾选框，点它或点整行都切换这一条
		if (this.selecting) {
			const check = row.createSpan({ cls: 'pickme-index-check' });
			check.setAttribute('role', 'checkbox');
			check.setAttribute('aria-checked', this.picked.has(key) ? 'true' : 'false');
			check.setAttribute('tabindex', '-1');
			setIcon(check, 'check');
			check.onclick = (event) => {
				event.stopPropagation();
				this.togglePick(key);
			};
		}

		const open = () => void this.openEntry(group, entry);
		row.onclick = () => {
			if (this.selecting) this.togglePick(key);
			else open();
		};
		row.onkeydown = (event) => {
			// 只认落在行本身上面的按键：行里的删除按钮要保留自己的回车/空格行为
			if (event.target !== row) return;
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				if (this.selecting) this.togglePick(key);
				else open();
			}
		};

		// PDF 批注带框选区域的小图，一眼认得出是哪张
		if (entry.kind === 'pdf' && entry.pdf?.image) {
			const thumb = row.createEl('img', { cls: 'pickme-index-thumb' });
			// 截图文件可能已经不在（清理过、或手动删过）：换成类型图标，槽位不留空、也不出破图标
			thumb.addEventListener(
				'error',
				() => {
					const fallback = createDiv({ cls: 'pickme-index-kind' });
					setIcon(fallback, 'highlighter');
					row.insertBefore(fallback, thumb);
					thumb.remove();
				},
				{ once: true },
			);
			thumb.setAttribute('alt', '');
			void this.plugin.repository.io.resourceUrl(entry.pdf.image).then((url) => {
				if (url) thumb.src = url;
			});
		} else {
			// 没有截图的行也占住同一块「预览槽」，否则同一组里正文左边界会跳来跳去
			setIcon(row.createDiv({ cls: 'pickme-index-kind' }), entry.kind === 'pdf' ? 'highlighter' : 'quote');
		}

		const body = row.createDiv({ cls: 'pickme-index-body' });
		const what = body.createDiv({ cls: 'pickme-index-what' });
		if (entry.kind === 'pdf' && entry.pdf) {
			// 页码淡、类型上色：扫读时先看类型，需要精确定位再看页码
			what.createSpan({ cls: 'pickme-index-page', text: t('第 {v0} 页', { v0: entry.pdf.page }) });
			what.createSpan({ cls: 'pickme-index-shape', text: shapeWord(entry) });
		} else {
			what.createSpan({ cls: 'pickme-index-text', text: shorten(entry.selection, 48) });
		}
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

		// 单条删除入口：与批量删除走同一条确认 + deleteEntry 流程
		const del = row.createEl('button', { cls: 'pickme-icon-button pickme-index-rowdel' });
		setIcon(del, 'trash-2');
		del.setAttribute('aria-label', t('删除'));
		del.setAttribute('title', t('删除'));
		del.onclick = (event) => {
			event.stopPropagation();
			this.confirmDelete([{ group, entry }]);
		};
	}

	// ---------- 多选与批量删除 ----------

	/** 进/出选择模式：退出时清掉勾选与光标（原型就是退出即取消） */
	private toggleSelectMode(): void {
		this.selecting = !this.selecting;
		if (!this.selecting) {
			this.picked.clear();
			this.cursorKey = null;
		}
		this.render();
	}

	private exitSelect(): void {
		this.selecting = false;
		this.picked.clear();
		this.cursorKey = null;
		this.render();
	}

	/** 切换一条的勾选：就地更新行与选择条，不整屏重画，键盘焦点不丢 */
	private togglePick(key: string): void {
		if (this.picked.has(key)) this.picked.delete(key);
		else this.picked.add(key);
		const row = this.rowEls.get(key);
		if (row) {
			row.toggleClass('is-picked', this.picked.has(key));
			row.querySelector<HTMLElement>('.pickme-index-check')?.setAttribute(
				'aria-checked',
				this.picked.has(key) ? 'true' : 'false',
			);
		}
		this.updateSelBar();
	}

	private pickAll(): void {
		this.picked.clear();
		for (const key of this.rowOrder) this.picked.add(key);
		for (const [key, row] of this.rowEls) row.toggleClass('is-picked', this.picked.has(key));
		this.updateSelBar();
	}

	private pickNone(): void {
		this.picked.clear();
		for (const row of this.rowEls.values()) row.removeClass('is-picked');
		this.updateSelBar();
	}

	private updateSelBar(): void {
		if (this.selCountEl) this.selCountEl.setText(String(this.picked.size));
		if (this.selDelBtn) this.selDelBtn.disabled = this.picked.size === 0;
	}

	/** 已勾选的行，按数据顺序取全集（过滤只影响显示，不影响「删除所选」的覆盖范围） */
	private pickedRows(): RowRef[] {
		const out: RowRef[] = [];
		if (this.picked.size === 0) return out;
		for (const group of this.groups) {
			for (const entry of group.entries) {
				if (this.picked.has(this.pickKey(group, entry))) out.push({ group, entry });
			}
		}
		return out;
	}

	/** 刷新数据后把已经不存在的勾选丢掉，已选计数与删除范围才不会对不上 */
	private prunePicked(): void {
		if (this.picked.size === 0) return;
		const alive = new Set<string>();
		for (const group of this.groups) for (const entry of group.entries) alive.add(this.pickKey(group, entry));
		for (const key of [...this.picked]) if (!alive.has(key)) this.picked.delete(key);
	}

	private confirmDeletePicked(): void {
		this.confirmDelete(this.pickedRows());
	}

	/** 删除前的确认：把后果说清楚，走的是与单条删除同一条确认 + deleteEntry 流程 */
	private confirmDelete(rows: RowRef[]): void {
		if (rows.length === 0) return;
		new ConfirmModal(
			this.plugin.app,
			t('删除 {v0} 条批注？正文里对应的锚点标签会一并移除，原文其它内容不会改动；PDF 批注的区域截图会一起删掉。', {
				v0: rows.length,
			}),
			() => {
				void this.runDelete(rows);
			},
		).open();
	}

	/** 逐条调用 deleteEntry，删完统一刷新并提示一次，然后退出选择模式 */
	private async runDelete(rows: RowRef[]): Promise<void> {
		let removed = 0;
		for (const { group, entry } of rows) {
			const file = this.plugin.resolveSourceFile(group.sourcePath);
			if (!(file instanceof TFile)) continue;
			await this.plugin.deleteEntry(entry.id, file);
			removed += 1;
		}
		await this.plugin.refreshViews();
		if (removed > 0) new Notice(t('已删除 {v0} 条批注', { v0: removed }));
		this.exitSelect();
	}

	// ---------- 键盘 ----------

	/** 视图根上的键盘：↑↓ 移动、Space 勾选、Mod+A 全选、Delete/Backspace 删除所选的都拦下来 */
	private onKeyDown(event: KeyboardEvent): void {
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault();
			event.stopPropagation();
			this.moveCursor(event.key === 'ArrowDown' ? 1 : -1);
			return;
		}
		if (!this.selecting) return;
		if (event.key === ' ' || event.key === 'Spacebar') {
			if (!this.cursorKey) return;
			event.preventDefault();
			event.stopPropagation();
			this.togglePick(this.cursorKey);
			return;
		}
		if ((event.metaKey || event.ctrlKey) && (event.key === 'a' || event.key === 'A')) {
			event.preventDefault();
			event.stopPropagation();
			this.pickAll();
			return;
		}
		if (event.key === 'Delete' || event.key === 'Backspace') {
			if (this.picked.size === 0) return;
			event.preventDefault();
			event.stopPropagation();
			this.confirmDeletePicked();
		}
	}

	private moveCursor(delta: number): void {
		if (this.rowOrder.length === 0) return;
		const at = this.cursorKey ? this.rowOrder.indexOf(this.cursorKey) : -1;
		const start = at === -1 ? (delta > 0 ? 0 : this.rowOrder.length - 1) : at + delta;
		const next = Math.max(0, Math.min(this.rowOrder.length - 1, start));
		const key = this.rowOrder[next];
		if (this.cursorKey && this.cursorKey !== key) this.rowEls.get(this.cursorKey)?.removeClass('is-cursor');
		this.cursorKey = key;
		const row = this.rowEls.get(key);
		if (row) {
			row.addClass('is-cursor');
			row.scrollIntoView({ block: 'nearest' });
		}
	}

	// ---------- 跳转 ----------

	private async openSource(group: IndexGroup): Promise<void> {
		const file = this.plugin.resolveSourceFile(group.sourcePath);
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
