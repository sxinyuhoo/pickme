import { App, SuggestModal } from 'obsidian';
import { t } from '../i18n.ts';
import type { AnnotationEntry } from '../core/types.ts';

interface AnchorChoice {
	entry: AnnotationEntry;
	source: string;
}

/** 输入锚点 id 或选区片段，跳到原文对应位置 */
export class AnchorSuggestModal extends SuggestModal<AnchorChoice> {
	private choices: AnchorChoice[];
	private onChoose: (entry: AnnotationEntry) => void;

	constructor(app: App, choices: AnchorChoice[], onChoose: (entry: AnnotationEntry) => void) {
		super(app);
		this.choices = choices;
		this.onChoose = onChoose;
		this.setPlaceholder(t('输入锚点 id 或选区片段'));
	}

	getSuggestions(query: string): AnchorChoice[] {
		const needle = query.trim().toLowerCase();
		if (!needle) return this.choices;
		return this.choices.filter(
			(choice) =>
				choice.entry.id.includes(needle) ||
				choice.entry.selection.toLowerCase().includes(needle) ||
				choice.source.toLowerCase().includes(needle),
		);
	}

	renderSuggestion(choice: AnchorChoice, el: HTMLElement): void {
		el.createDiv({ text: `${choice.entry.id}　${choice.source}` });
		const preview = choice.entry.kind === 'pdf' ? `第 ${choice.entry.pdf?.page ?? '?'} 页区域` : choice.entry.selection;
		el.createDiv({ text: preview.slice(0, 80), cls: 'pickme-suggest-preview' });
	}

	onChooseSuggestion(choice: AnchorChoice): void {
		this.onChoose(choice.entry);
	}
}
