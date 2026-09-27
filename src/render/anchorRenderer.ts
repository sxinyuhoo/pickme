import { editorInfoField } from 'obsidian';
import type { Editor, MarkdownPostProcessorContext, MarkdownView } from 'obsidian';
import { Decoration, EditorView, ViewPlugin, WidgetType } from '@codemirror/view';
import type { DecorationSet, PluginValue, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { scanAnchors } from '../core/anchor.ts';
import type PickmePlugin from '../main.ts';

class AnchorWidget extends WidgetType {
	constructor(private readonly id: string) {
		super();
	}

	eq(other: AnchorWidget): boolean {
		return other.id === this.id;
	}

	toDOM(): HTMLElement {
		const span = document.createElement('span');
		span.className = 'pickme-anchor-widget';
		span.setAttribute('data-pickme-id', this.id);
		return span;
	}
}

const MARK_CLASS = 'pickme-mark';

/** 实时预览：按锚点 id 给两个空标签之间的文字加装饰，并处理点击 */
export function buildEditorExtension(plugin: PickmePlugin): Extension {
	return ViewPlugin.fromClass(
		class implements PluginValue {
			decorations: DecorationSet;

			constructor(view: EditorView) {
				this.decorations = this.build(view);
			}

			update(update: ViewUpdate): void {
				if (update.docChanged || update.viewportChanged) {
					this.decorations = this.build(update.view);
				}
			}

			private build(view: EditorView): DecorationSet {
				const tag = plugin.settings.tagName;
				const text = view.state.doc.toString();
				const scan = scanAnchors(text, tag);
				if (scan.pairs.length === 0) {
					return Decoration.none;
				}
				const builder = new RangeSetBuilder<Decoration>();
				for (const pair of scan.pairs) {
					if (pair.end <= pair.start) continue;
					const widget = Decoration.widget({
						widget: new AnchorWidget(pair.id),
						side: -1,
					});
					builder.add(pair.start, pair.start, widget);
					builder.add(
						pair.start,
						pair.end,
						Decoration.mark({
							class: MARK_CLASS,
							attributes: { 'data-pickme-id': pair.id },
						}),
					);
				}
				return builder.finish();
			}
		},
		{
			decorations: (value) => value.decorations,
			eventHandlers: {
				click(event: MouseEvent): boolean {
					const target = event.target as HTMLElement | null;
					const holder = target?.closest(`.${MARK_CLASS}`) ?? target?.closest('.pickme-anchor-widget');
					const id = holder?.getAttribute('data-pickme-id');
					if (!id) return false;
					void plugin.activateEntry(id, holder);
					// 返回 false，让 Obsidian 继续处理这次点击（光标定位、选择等）
					return false;
				},
			},
		},
	);
}

/** 阅读视图：把两个锚点标签之间的文字包进带类名的 span */
export function buildPostProcessor(plugin: PickmePlugin) {
	return (el: HTMLElement, ctx: MarkdownPostProcessorContext): void => {
		const tag = plugin.settings.tagName;
		const tags = Array.from(el.querySelectorAll(tag));
		if (tags.length === 0) return;

		const byId = new Map<string, HTMLElement[]>();
		for (const node of tags) {
			const id = node.getAttribute('id') ?? '';
			if (!id) continue;
			const list = byId.get(id) ?? [];
			list.push(node as HTMLElement);
			byId.set(id, list);
		}

		for (const [id, nodes] of byId) {
			if (nodes.length !== 2) continue;
			const [start, end] = nodes;
			wrapBetween(start, end, id);
		}

		el.addEventListener('click', (event) => {
			const target = event.target as HTMLElement | null;
			const holder = target?.closest(`.${MARK_CLASS}`);
			const id = holder?.getAttribute('data-pickme-id');
			if (id) void plugin.activateEntry(id, holder);
		});

		void ctx;
	};
}

function wrapBetween(start: HTMLElement, end: HTMLElement, id: string): void {
	const root = start.parentElement;
	if (!root || end.parentElement !== root) return;
	const range = document.createRange();
	range.setStartAfter(start);
	range.setEndBefore(end);

	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const targets: Text[] = [];
	let node = walker.nextNode();
	while (node) {
		const text = node as Text;
		if (text.data.trim() !== '' && range.intersectsNode(text)) {
			const parent = text.parentElement;
			if (parent && !parent.closest('code, pre, .pickme-mark')) {
				targets.push(text);
			}
		}
		node = walker.nextNode();
	}

	for (const text of targets) {
		const parent = text.parentElement;
		if (!parent) continue;
		const span = document.createElement('span');
		span.className = MARK_CLASS;
		span.setAttribute('data-pickme-id', id);
		parent.insertBefore(span, text);
		span.appendChild(text);
	}
}

/** 取编辑器底层的 CM6 EditorView，Obsidian 未公开但稳定存在 */
export function cmView(editor: Editor): EditorView {
	return (editor as unknown as { cm: EditorView }).cm;
}

/** 从编辑器取当前选区偏移 */
export function selectionOffsets(view: MarkdownView): { from: number; to: number } | null {
	const editor = view.editor;
	const from = editor.posToOffset(editor.getCursor('from'));
	const to = editor.posToOffset(editor.getCursor('to'));
	if (to <= from) return null;
	return { from, to };
}

export function editorContext(view: MarkdownView): string {
	const info = cmView(view.editor).state.field(editorInfoField, false);
	return info?.file?.path ?? '';
}
