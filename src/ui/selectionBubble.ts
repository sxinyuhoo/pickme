import { MarkdownView, setIcon } from 'obsidian';
import type PickmePlugin from '../main.ts';
import { t } from '../i18n.ts';
import { cmView } from '../render/anchorRenderer.ts';

/**
 * 选中正文后浮在选区旁边的一枚小按钮：点它就是「提问或批注」。
 *
 * 桌面原本只有右键菜单这一个入口，手机上没有右键，而这个按钮两边都能用，
 * 于是手机有入口、桌面也省得记菜单在哪。
 * 位置跟着选区走，选区没了/滚走了/点到别处就收起来。
 */
export class SelectionBubble {
	private plugin: PickmePlugin;
	private host: HTMLElement;
	private button: HTMLElement;
	private view: MarkdownView | null = null;
	private timer: number | null = null;

	constructor(plugin: PickmePlugin) {
		this.plugin = plugin;
		this.host = document.body.createDiv({ cls: 'pickme-selection-bubble' });
		this.button = this.host.createEl('button', {
			cls: 'pickme-selection-ask',
			attr: { type: 'button', 'aria-label': t('Pick Me：提问或批注') },
		});
		setIcon(this.button.createSpan({ cls: 'pickme-selection-icon' }), 'ghost');
		this.button.createSpan({ cls: 'pickme-selection-label', text: t('Pick Me：提问或批注') });

		// 按下时别把选区弄丢：浏览器默认会在 mousedown 时收起选区
		this.button.addEventListener('pointerdown', (event) => event.preventDefault());
		this.button.addEventListener('click', () => this.ask());

		plugin.registerDomEvent(document, 'selectionchange', () => this.schedule());
		plugin.registerDomEvent(document, 'pointerup', () => this.schedule());
		plugin.registerDomEvent(document, 'keydown', (event) => {
			if (event.key === 'Escape') this.hide();
		});
		plugin.registerDomEvent(document, 'pointerdown', (event) => {
			if (!this.host.contains(event.target as Node)) this.hide();
		}, true);
		plugin.registerDomEvent(document, 'scroll', () => this.hide(), true);
		plugin.registerDomEvent(window, 'resize', () => this.hide());
		plugin.registerEvent(
			plugin.app.workspace.on('active-leaf-change', () => this.hide()),
		);
	}

	destroy(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.host.remove();
	}

	/** selectionchange 触发得非常密，合并成一帧之后再看 */
	private schedule(): void {
		if (this.timer !== null) window.clearTimeout(this.timer);
		this.timer = window.setTimeout(() => {
			this.timer = null;
			this.refresh();
		}, 120);
	}

	private refresh(): void {
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		if (!view || !view.file) {
			this.hide();
			return;
		}
		const selection = window.getSelection();
		const domText = selection && !selection.isCollapsed && selection.rangeCount > 0 ? selection.toString().trim() : '';
		if (!domText) {
			// 编辑态里 DOM 选区有时是空的（编辑器没拿到焦点），退回编辑器自己的选区
			this.showForEditor(view);
			return;
		}
		if (!selection) {
			this.showForEditor(view);
			return;
		}
		const range = selection.getRangeAt(0);
		// 只认正文里的选区：面板、侧边栏、索引里的选中不该冒出这个按钮
		const container = range.commonAncestorContainer;
		const element = container instanceof HTMLElement ? container : container.parentElement;
		if (!element || element.closest('.pickme-panel, .pickme-sidebar, .pickme-index, .pickme-selection-bubble')) {
			this.hide();
			return;
		}
		const inPreview = element.closest('.markdown-preview-view');
		const inEditor = element.closest('.cm-editor');
		if (!inPreview && !inEditor) {
			this.hide();
			return;
		}
		this.view = view;
		this.show(range);
	}

	/** 编辑器选区 → 屏幕坐标（CM6 的 coordsAtPos 给的是一行内的高亮矩形） */
	private showForEditor(view: MarkdownView): void {
		const editor = view.editor;
		const from = editor.posToOffset(editor.getCursor('from'));
		const to = editor.posToOffset(editor.getCursor('to'));
		if (to <= from) {
			this.hide();
			return;
		}
		const cm = cmView(editor);
		const head = cm.coordsAtPos(from);
		const tail = cm.coordsAtPos(to);
		if (!head || !tail) {
			this.hide();
			return;
		}
		this.view = view;
		const left = Math.min(head.left, tail.left);
		const right = Math.max(head.right, tail.right);
		const top = Math.min(head.top, tail.top);
		const bottom = Math.max(head.bottom, tail.bottom);
		this.place({ left, top, width: right - left, height: bottom - top, bottom });
	}

	private show(range: Range): void {
		const rect = range.getBoundingClientRect();
		this.place({ left: rect.left, top: rect.top, width: rect.width, height: rect.height, bottom: rect.bottom });
	}

	private place(rect: { left: number; top: number; width: number; height: number; bottom: number }): void {
		if (rect.width === 0 && rect.height === 0) {
			this.hide();
			return;
		}
		this.host.addClass('is-visible');
		const width = this.host.offsetWidth;
		const height = this.host.offsetHeight;
		const margin = 8;
		let left = rect.left + rect.width / 2 - width / 2;
		left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
		// 默认放选区上方；上面放不下就挪到下方
		let top = rect.top - height - 8;
		if (top < margin) top = rect.bottom + 8;
		if (top + height > window.innerHeight - margin) top = Math.max(margin, window.innerHeight - height - margin);
		this.host.setCssProps({ '--pk-l': `${Math.round(left)}px`, '--pk-t': `${Math.round(top)}px` });
	}

	private hide(): void {
		this.host.removeClass('is-visible');
	}

	private ask(): void {
		const view = this.view;
		this.hide();
		if (!view) return;
		void this.plugin.askSelection(view);
	}
}
