import { App, Modal } from 'obsidian';
import { t } from '../i18n.ts';

/** 简单的确认弹窗，用于删除这类会改动原文的操作 */
export class ConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void;

	constructor(app: App, message: string, onConfirm: () => void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		this.contentEl.createEl('p', { text: this.message });
		// 动作靠右：确认/取消按惯例摆在右下角
		const row = this.contentEl.createDiv({ cls: 'pickme-row pickme-confirm-actions' });
		const ok = row.createEl('button', { cls: 'mod-warning', text: t('确认') });
		ok.onclick = () => {
			this.close();
			this.onConfirm();
		};
		const cancel = row.createEl('button', { text: t('取消') });
		cancel.onclick = () => this.close();
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
