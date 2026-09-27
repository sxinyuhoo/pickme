import { MarkdownView, Notice } from 'obsidian';
import { t } from './i18n.ts';
import type PickmePlugin from './main.ts';
import { ConfirmModal } from './ui/confirmModal.ts';
import { AnchorSuggestModal } from './ui/anchorSuggest.ts';

export function registerCommands(plugin: PickmePlugin): void {
	plugin.addCommand({
		id: 'open-pdf-viewer',
		name: t('在 Pick Me 查看器中打开当前 PDF'),
		callback: () => {
			void plugin.openPdfInPickmeView();
		},
	});

	plugin.addCommand({
		id: 'pdf-select',
		name: t('在 PDF 上框选批注'),
		callback: () => {
			void (async () => {
				const file = plugin.activeFile();
				if (!file || file.extension !== 'pdf') {
					new Notice(t('pickme：请先打开一个 PDF'));
					return;
				}
				await plugin.openPdfInPickmeView(file);
				await plugin.focusPdfSelection(file.path);
			})();
		},
	});

	plugin.addCommand({
		id: 'open-sidebar',
		name: t('打开批注侧边栏'),
		callback: () => {
			void plugin.openSidebar();
		},
	});

	plugin.addCommand({
		id: 'open-index',
		name: t('打开批注索引'),
		callback: () => {
			void plugin.openIndexView();
		},
	});

	plugin.addCommand({
		id: 'ask-selection',
		name: t('对选区提问或批注'),
		editorCheckCallback: (checking, editor, view) => {
			if (!editor.getSelection()) return false;
			if (!checking && view instanceof MarkdownView) {
				void plugin.askSelection(view);
			}
			return true;
		},
	});

	plugin.addCommand({
		id: 'jump-anchor',
		name: t('跳转到锚点'),
		callback: () => {
			void (async () => {
				const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
				const file = view?.file ?? plugin.activeFile();
				if (!file) {
					new Notice(t('pickme：当前没有打开的文档'));
					return;
				}
				const doc = await plugin.loadDoc(file);
				if (doc.entries.length === 0) {
					new Notice(t('pickme：当前文档还没有批注'));
					return;
				}
				new AnchorSuggestModal(
					plugin.app,
					doc.entries.map((entry) => ({ entry, source: file.basename })),
					(entry) => {
						void plugin.focusEntry(entry.id);
					},
				).open();
			})();
		},
	});

	plugin.addCommand({
		id: 'rebind-anchor',
		name: t('重新绑定失效锚点'),
		callback: () => {
			void (async () => {
				const file = plugin.activeFile();
				if (!file) return;
				const doc = await plugin.loadDoc(file);
				const stale = doc.entries.filter((entry) => entry.status === 'stale');
				if (stale.length === 0) {
					new Notice(t('pickme：没有失效的锚点'));
					return;
				}
				const staleSet = new Set(stale.map((entry) => entry.id));
				new AnchorSuggestModal(
					plugin.app,
					stale.map((entry) => ({ entry, source: file.basename })),
					(entry) => {
						if (staleSet.has(entry.id)) void plugin.rebindEntry(entry.id);
					},
				).open();
			})();
		},
	});

	plugin.addCommand({
		id: 'migrate-annotations',
		name: t('迁移批注目录'),
		callback: () => {
			void plugin.migrateAnnotations();
		},
	});

	plugin.addCommand({
		id: 'new-template',
		name: t('新建提问模板'),
		callback: () => {
			void plugin.createTemplate();
		},
	});

	plugin.addCommand({
		id: 'ensure-templates',
		name: t('恢复默认模板'),
		callback: () => {
			void plugin.ensureDefaultTemplates(true);
		},
	});

	plugin.addCommand({
		id: 'delete-doc-annotations',
		name: t('删除当前文档的全部批注'),
		callback: () => {
			void (async () => {
				const file = plugin.activeFile();
				if (!file) return;
				const doc = await plugin.loadDoc(file);
				if (doc.entries.length === 0) {
					new Notice(t('pickme：当前文档没有批注'));
					return;
				}
				new ConfirmModal(
					plugin.app,
					t('将删除 {v0} 的 {v1} 条批注，并从原文里移除对应的锚点标签。', { v0: file.basename, v1: doc.entries.length }),
					() => {
						void plugin.deleteAllEntries();
					},
				).open();
			})();
		},
	});

	plugin.addCommand({
		id: 'replace-tag-name',
		name: t('批量替换锚点标签名'),
		callback: () => {
			void (async () => {
				const from = plugin.settings.previousTagName || plugin.settings.tagName;
				const to = plugin.settings.tagName;
				if (from === to) {
					new Notice(t('pickme：没有需要替换的标签名（先在设置里改过锚点标签名才会记录旧值）'));
					return;
				}
				const count = (await plugin.repository.annotationFiles()).length;
				new ConfirmModal(
					plugin.app,
					t('把 {v0} 个批注文档里的锚点标签从 {v1} 换成 {v2}。这会改动原文，但只动标签、不动选区内文字。', { v0: count, v1: from, v2: to }),
					() => {
						void plugin.replaceTagName(from, to);
					},
				).open();
			})();
		},
	});

	plugin.addCommand({
		id: 'open-settings',
		name: t('打开设置'),
		callback: () => {
			// app.setting 是未公开 API，取不到时降级为提示
			const appWithSetting = plugin.app as unknown as {
				setting?: { open(): void; openTabById(id: string): void };
			};
			if (appWithSetting.setting) {
				appWithSetting.setting.open();
				appWithSetting.setting.openTabById('pickme');
			} else {
				new Notice(t('pickme：请在设置里手动打开 Pick Me 面板'));
			}
		},
	});
}
