import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { LANGUAGE_LABELS, setLanguage, t } from './i18n.ts';
import type { Language } from './i18n.ts';
import type PickmePlugin from './main.ts';
import type { ChatTransport } from './model/client.ts';
import { DEFAULT_TAG } from './core/anchor.ts';
import { ConfirmModal } from './ui/confirmModal.ts';

export interface PickmeSettings {
	/** 批注目录，默认在插件目录下，完全隐藏 */
	annotationDir: string;
	/** 模板目录 */
	templateDir: string;
	/** 批注索引笔记路径，留空表示不生成 */
	/** 锚点标签名 */
	tagName: string;
	/** OpenAI 兼容接口地址 */
	apiBaseUrl: string;
	apiKey: string;
	model: string;
	temperature: number;
	/** 单次提问送出的选区最大字符数 */
	maxSelectionChars: number;
	/** 随选区一起送出的上下文最大字符数 */
	contextChars: number;
	/** 默认是否附带上下文 */
	includeContextByDefault: boolean;
	/** 添加批注后是否自动打开侧边栏 */
	openSidebarOnAnnotate: boolean;
	/** 交互是否都收在页面内完成（PDF 页面 / 阅读视图），侧边栏退化为查看 */
	inlineAsk: boolean;
	/** 请求通道：auto 先用 fetch 保流式，被跨域拦下时自动改用 requestUrl */
	transport: ChatTransport;
	/** 高亮样式 */
	highlightColor: string;
	/** 是否流式输出 */
	stream: boolean;
	/** 是否在启用时补齐默认模板 */
	autoEnsureTemplates: boolean;
	/** 提问面板模板下拉里隐藏掉的模板名 */
	hiddenTemplates: string[];
	/** 用自带 pdf.js 查看器接管 PDF 打开 */
	pdfViewerEnabled: boolean;
	/** 目录面板开着没有（有目录的 PDF 才显示这个开关） */
	pdfTocOpen: boolean;
	/** PDF 页面上是否画出已有批注的高亮框（关掉就是原始 PDF 的样子） */
	showMarks: boolean;
	/** 框选时保存区域截图 */
	pdfSaveScreenshot: boolean;
	/** 区域截图的最大边长，0 表示不限制 */
	pdfScreenshotMaxSize: number;
	/** PDF 默认缩放 */
	pdfDefaultScale: number;
	/** 侧边栏模型下拉里可选的模型，留空则只用默认模型 */
	modelOptions: string[];
	/** 视觉模型，留空时用默认模型 */
	visionModel: string;
	/** 是否允许把区域截图作为图片送给模型 */
	visionEnabled: boolean;
	/** 正文（content）的最大输出长度；深度思考的额度另算 */
	maxOutputTokens: number;
	/** 深度思考开关：开启时单独给思考预算，不占正文额度 */
	deepThinking: boolean;
	/** 界面语言，默认英文 */
	language: Language;
	/** 请求超时秒数，0 表示不限制 */
	requestTimeoutSec: number;
	/** 视觉标记样式 */
	markStyle: MarkStyle;
	/** 是否为没有批注的文档创建批注文件 */
	createEmptyAnnotationFile: boolean;
	/** 上一次的锚点标签名，用于批量替换 */
	previousTagName: string;
}

/** 视觉标记样式 */
export type MarkStyle = 'background' | 'underline' | 'border';

export const DEFAULT_SETTINGS: PickmeSettings = {
	// 空字符串表示「放在插件自己的目录里」，加载设置时按 manifest.dir 补全；
	// 不写死 .obsidian/plugins/<id>/... —— 用户改了插件目录名也不会错（官方 lint 规则 hardcoded-config-path）
	annotationDir: '',
	templateDir: '',
	tagName: DEFAULT_TAG,
	apiBaseUrl: 'https://api.openai.com/v1',
	apiKey: '',
	model: 'gpt-4o-mini',
	temperature: 0.3,
	maxSelectionChars: 2000,
	contextChars: 1500,
	includeContextByDefault: true,
	openSidebarOnAnnotate: true,
	inlineAsk: true,
	transport: 'auto',
	// 用户定的默认高亮色：RGB 152,203,237
	highlightColor: '#98cbed',
	stream: true,
	autoEnsureTemplates: true,
	hiddenTemplates: [],
	pdfViewerEnabled: true,
	pdfTocOpen: true,
	showMarks: true,
	pdfSaveScreenshot: true,
	pdfScreenshotMaxSize: 1200,
	pdfDefaultScale: 1.2,
	modelOptions: [],
	visionModel: '',
	visionEnabled: true,
	// 这个额度只管正文：深度思考开启时，思考另有 REASONING_BUDGET 的独立预算
	maxOutputTokens: 4096,
	deepThinking: true,
	language: 'en',
	requestTimeoutSec: 120,
	markStyle: 'background',
	createEmptyAnnotationFile: false,
	previousTagName: '',
};

export class PickmeSettingTab extends PluginSettingTab {
	private plugin: PickmePlugin;

	constructor(app: App, plugin: PickmePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * Obsidian 打开设置页时调用的入口。
	 * 官方检查指明 display() 自 1.13 起已废弃，所以它只做转发，
	 * 插件内部的「改完设置重建这一页」统一走 renderSettings()。
	 */
	override display(): void {
		this.renderSettings();
	}

	renderSettings(): void {
		const { containerEl } = this;
		containerEl.empty();
		// 官方规范：设置页不加顶级标题（General / Settings / 插件名），通用设置直接放最上面
		new Setting(containerEl)
			.setName(t('界面语言'))
			.setDesc(t('设置面板与插件提示的语言。默认英文。'))
			.addDropdown((dropdown) => {
				dropdown.addOption('en', LANGUAGE_LABELS.en).addOption('zh', LANGUAGE_LABELS.zh);
				dropdown.setValue(this.plugin.settings.language).onChange(async (value) => {
					this.plugin.settings.language = value === 'zh' ? 'zh' : 'en';
					setLanguage(this.plugin.settings.language);
					await this.plugin.saveSettings();
					await this.plugin.refreshUiText();
					this.renderSettings();
				});
			});

		new Setting(containerEl).setName(t('批注存放')).setHeading();
		new Setting(containerEl)
			.setName(t('批注目录'))
			.setDesc(t('默认放在插件目录下，Obsidian 不索引隐藏目录，批注不可搜索；改成库内目录后可用 Dataview 与双链。'))
			.addText((text) => {
				const before = this.plugin.settings.annotationDir;
				text
					.setPlaceholder(DEFAULT_SETTINGS.annotationDir)
					.setValue(before)
					.onChange(async (value) => {
						this.plugin.settings.annotationDir = value.trim();
						await this.plugin.saveSettings();
					});
				// 一个字符一个字符改路径时不打扰，等失焦（或按回车）再问要不要搬
				text.inputEl.addEventListener('blur', () => {
					if (text.inputEl.value.trim() === before) return;
					void this.plugin.askMigrate(before);
				});
				text.inputEl.addEventListener('keydown', (event) => {
					if (event.key === 'Enter') text.inputEl.blur();
				});
			});
		new Setting(containerEl)
			.setName(t('迁移批注目录'))
			.setDesc(t('把批注文件从上一次的目录搬到上面设置的目录，保持镜像结构。逐文件「写新的、删旧的」，不会两处各留一份；搬完原目录会剩下空文件夹，可以自己删。'))
			.addButton((button) =>
				button.setButtonText(t('迁移')).onClick(async () => {
					await this.plugin.migrateAnnotations();
				}),
			);
		new Setting(containerEl)
			.setName(t('为没有批注的文档也建批注文件'))
			.setDesc(t('默认关闭：只有真正加了批注才生成文件，避免文件浏览器噪音。'))
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.createEmptyAnnotationFile)
					.onChange(async (value) => {
						this.plugin.settings.createEmptyAnnotationFile = value;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl).setName(t('模板')).setHeading();
		// 模板目录固定在插件目录下（隐藏，不占库结构），只给一个打开的入口
		new Setting(containerEl)
			.setName(t('模板目录'))
			.setDesc(t('模板放在插件自己的目录里，不用改。目录里每个 .md 就是一个模板，文件名就是下拉里显示的名字。想自己加模板，点右边打开目录，或者用下面的「新建模板」。'))
			.addText((text) => {
				text.setValue(this.plugin.settings.templateDir);
				text.setDisabled(true);
			})
			.addButton((button) =>
				button.setButtonText(t('打开模板目录')).onClick(() => this.plugin.openTemplateDir()),
			);
		new Setting(containerEl)
			.setName(t('恢复默认模板'))
			.setDesc(t('把内置的 3 个模板（解释、摘要、翻译）重新写进模板目录，已经存在的不覆盖。删掉的、改坏了的，用这个找回来。'))
			.addButton((button) =>
				button.setButtonText(t('恢复')).onClick(async () => {
					await this.plugin.ensureDefaultTemplates(true);
					this.renderSettings();
				}),
			);
		// 模板清单：勾上就在提问面板的下拉里出现（取消勾选只是隐藏，文件不删）；自建模板排在内置的下面
		const templateList = containerEl.createDiv({ cls: 'pickme-template-list' });
		void (async () => {
			const builtin = this.plugin.templates.builtinNames();
			const names = this.plugin.templates.order(await this.plugin.templates.listAll());
			if (names.length === 0) {
				templateList.createDiv({
					cls: 'setting-item-description',
					text: t('模板目录里还没有模板，点上面的「恢复默认模板」生成内置的 3 个。'),
				});
				return;
			}
			templateList.createDiv({
				cls: 'setting-item-description',
				text: t('勾上就在提问面板的下拉里出现；取消勾选只是藏起来，文件不删。新建的模板排在最后。'),
			});
			for (const name of names) {
				new Setting(templateList)
					.setName(name)
					.setDesc(builtin.includes(name) ? t('内置模板') : '')
					.addToggle((toggle) =>
						toggle.setValue(!this.plugin.settings.hiddenTemplates.includes(name)).onChange(async (value) => {
							const hidden = new Set(this.plugin.settings.hiddenTemplates);
							if (value) hidden.delete(name);
							else hidden.add(name);
							this.plugin.settings.hiddenTemplates = [...hidden];
							await this.plugin.saveSettings();
							await this.plugin.refreshViews();
						}),
					)
					.addExtraButton((button) =>
						button
							.setIcon('trash')
							.setTooltip(t('删除模板'))
							.onClick(() => {
								new ConfirmModal(
									this.app,
									builtin.includes(name)
										? t('删除内置模板「{name}」？文件会被删掉，需要时可以用「恢复默认模板」找回来。', { name })
										: t('删除模板「{name}」？文件会被删掉。', { name }),
									() => {
										void (async () => {
											await this.plugin.deleteTemplate(name);
											this.renderSettings();
										})();
									},
								).open();
							}),
					);
			}
		})();
		new Setting(containerEl)
			.setName(t('新建模板'))
			.setDesc(t('在模板目录里建一个新模板文件，建好的排在下面清单的最后。文件名就是模板名，正文写提示词，可用的变量都列在文件里。'))
			.addButton((button) =>
				button.setButtonText(t('新建')).onClick(async () => {
					await this.plugin.createTemplate();
					this.renderSettings();
				}),
			);

		new Setting(containerEl).setName(t('模型通道')).setHeading();
		new Setting(containerEl)
			.setName(t('接口地址'))
			.setDesc(t('OpenAI 兼容接口的 base url，例如 https://api.openai.com/v1。'))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.apiBaseUrl)
					.setValue(this.plugin.settings.apiBaseUrl)
					.onChange(async (value) => {
						this.plugin.settings.apiBaseUrl = value.trim();
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName('API key')
			.setDesc(t('保存在本机插件配置里，不会随库同步。'))
			.addText((text) => {
				text.inputEl.type = 'password';
				text.setPlaceholder(t('形如 sk-… 的密钥'))
					.setValue(this.plugin.settings.apiKey)
					.onChange(async (value) => {
						this.plugin.settings.apiKey = value.trim();
						await this.plugin.saveSettings();
					});
			});
		new Setting(containerEl)
			.setName(t('默认模型'))
			.setDesc(t('模板里没有指定 pickme_model、侧边栏也没有另选模型时使用。'))
			.addText((text) =>
				text
					.setPlaceholder(DEFAULT_SETTINGS.model)
					.setValue(this.plugin.settings.model)
					.onChange(async (value) => {
						this.plugin.settings.model = value.trim();
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName(t('温度'))
			.setDesc(t('0 到 1 之间，越小回答越稳、越确定，越大越发散。批注问答建议 0.2~0.4；模板文件里能用 pickme_temperature 单独覆盖。'))
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.1)
					.setValue(this.plugin.settings.temperature)
					.onChange(async (value) => {
						this.plugin.settings.temperature = value;
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName(t('流式输出'))
			.setDesc(t('边生成边显示，回答一个字一个字地出来；关掉则等全部生成完再显示。流式只在浏览器请求通道可用。'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.stream).onChange(async (value) => {
					this.plugin.settings.stream = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName(t('深度思考'))
			.setDesc(t('开启后模型先推理再作答，质量更好也更慢。思考有独立预算，不占「最大输出长度」；提问面板上可以按次取消。'))
			.setDesc(
				t('开启后先让模型推理再作答（质量更好、更慢）。思考内容有独立预算，不占用「最大输出长度」。'),
			)
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.deepThinking).onChange(async (value) => {
					this.plugin.settings.deepThinking = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName(t('侧边栏可选模型'))
			.setDesc(t('每行一个，或用逗号分隔。侧边栏的下拉会列出这些模型，留空则只能使用默认模型。'))
			.addTextArea((area) => {
				area.inputEl.rows = 3;
				area.setValue(this.plugin.settings.modelOptions.join('\n')).onChange(async (value) => {
					this.plugin.settings.modelOptions = value
						.split(/[\n,，]/)
						.map((item) => item.trim())
						.filter((item) => item !== '');
					await this.plugin.saveSettings();
				});
			})
			.addButton((button) =>
				button.setButtonText(t('从接口拉取')).onClick(async () => {
					await this.plugin.fetchModelList();
					this.renderSettings();
				}),
			);
		new Setting(containerEl)
			.setName(t('视觉模型'))
			.setDesc(t('PDF 区域截图走这个模型，留空表示用默认模型（默认模型本身支持图片即可）。'))
			.addText((text) =>
				text
					.setPlaceholder(t('留空则用默认模型'))
					.setValue(this.plugin.settings.visionModel)
					.onChange(async (value) => {
						this.plugin.settings.visionModel = value.trim();
						await this.plugin.saveSettings();
					}),
			);
		new Setting(containerEl)
			.setName(t('允许图片输入'))
			.setDesc(t('关闭后 PDF 区域批注只用命中文本提问，不发送截图。'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.visionEnabled).onChange(async (value) => {
					this.plugin.settings.visionEnabled = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName(t('最大输出长度'))
			.setDesc(t('单次回答的 token 上限。注意推理型模型的思考内容也计入这里：给得太小，思考还没结束就被截断，正文会是空的（批注里会写明原因）。'))
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxOutputTokens)).onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isNaN(parsed) && parsed >= 0) {
						this.plugin.settings.maxOutputTokens = parsed;
						await this.plugin.saveSettings();
					}
				}),
			);
		new Setting(containerEl)
			.setName(t('请求超时（秒）'))
			.setDesc(t('超时后中止请求，已生成的部分会保留在批注文件里。0 表示不限制。'))
			.addText((text) =>
				text.setValue(String(this.plugin.settings.requestTimeoutSec)).onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isNaN(parsed) && parsed >= 0) {
						this.plugin.settings.requestTimeoutSec = parsed;
						await this.plugin.saveSettings();
					}
				}),
			);
		new Setting(containerEl)
			.setName(t('测试连接'))
			.setDesc(t('按上面的地址与密钥发一次最小请求，确认能不能通。'))
			.addButton((button) =>
				button.setButtonText(t('测试')).onClick(async () => {
					await this.plugin.testConnection();
				}),
			);

		new Setting(containerEl).setName(t('选区与上下文')).setHeading();
		new Setting(containerEl)
			.setName(t('选区上限（字符）'))
			.setDesc(t('一次最多送多少字给模型，超出会被截断并加一行提示。PDF 框选是取区域内的文字，同样受这个上限管。'))
			.addText((text) =>
				text.setValue(String(this.plugin.settings.maxSelectionChars)).onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isNaN(parsed)) {
						this.plugin.settings.maxSelectionChars = parsed;
						await this.plugin.saveSettings();
					}
				}),
			);
		new Setting(containerEl)
			.setName(t('上下文上限（字符）'))
			.setDesc(t('取选区前后各一部分正文作为上下文。'))
			.addText((text) =>
				text.setValue(String(this.plugin.settings.contextChars)).onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isNaN(parsed)) {
						this.plugin.settings.contextChars = parsed;
						await this.plugin.saveSettings();
					}
				}),
			);
		new Setting(containerEl)
			.setName(t('默认附带上下文'))
			.setDesc(t('打开提问面板时，「带上下文」是否默认勾上。模板里能用 pickme_context 覆盖。'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.includeContextByDefault).onChange(async (value) => {
					this.plugin.settings.includeContextByDefault = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName(t('在页面内提问'))
			.setDesc(t('开启后 PDF 框选、点批注框、点正文高亮，提问面板都直接开在页面上，不必打开侧边栏；' +
					'侧边栏只用来查看已有哪些批注。关闭则回到「提问在侧边栏」的老方式。'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.inlineAsk).onChange(async (value) => {
					this.plugin.settings.inlineAsk = value;
					await this.plugin.saveSettings();
					await this.plugin.refreshViews();
				}),
			);
		new Setting(containerEl)
			.setName(t('添加批注后自动打开提问面板'))
			.setDesc(t('关闭后，添加批注不会自动弹出面板，需要点批注标记再打开。'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.openSidebarOnAnnotate).onChange(async (value) => {
					this.plugin.settings.openSidebarOnAnnotate = value;
					await this.plugin.saveSettings();
				}),
			);

		new Setting(containerEl).setName('PDF').setHeading();
		new Setting(containerEl)
			.setName(t('用自带查看器打开 PDF'))
			.setDesc(t('开启后 PDF 由 Pick Me 的 pdf.js 查看器打开，才能框选区域提问。核心查看器已占用 pdf 扩展名时，改为打开后自动切换到自带查看器（会闪一下内置查看器）。'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.pdfViewerEnabled).onChange(async (value) => {
					this.plugin.settings.pdfViewerEnabled = value;
					await this.plugin.saveSettings();
					this.plugin.applyPdfViewerSetting();
					new Notice(value ? t('pickme：已接管 PDF 打开') : t('pickme：已交还内置查看器，下次打开 PDF 生效'));
				}),
			);
		new Setting(containerEl)
			.setName(t('显示批注高亮'))
			.setDesc(t('PDF 页面上画出已有批注的框。关掉就是原始 PDF 的样子，工具栏上也有一个按钮可以随时切换。'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.showMarks).onChange(async (value) => {
					this.plugin.settings.showMarks = value;
					await this.plugin.saveSettings();
					await this.plugin.refreshViews();
				}),
			);
		new Setting(containerEl)
			.setName(t('保存区域截图'))
			.setDesc(t('框选时把这块区域裁成 PNG 存在批注旁边，提问时作为图片送给模型。不需要图文问答就关掉，能省下这些图占的空间。'))
			.addToggle((toggle) =>
				toggle.setValue(this.plugin.settings.pdfSaveScreenshot).onChange(async (value) => {
					this.plugin.settings.pdfSaveScreenshot = value;
					await this.plugin.saveSettings();
				}),
			);
		new Setting(containerEl)
			.setName(t('截图最大边长（像素）'))
			.setDesc(t('截图等比缩到这个边长再存：越小越省 token，字也越小。0 表示不缩放。'))
			.addText((text) =>
				text.setValue(String(this.plugin.settings.pdfScreenshotMaxSize)).onChange(async (value) => {
					const parsed = Number(value);
					if (!Number.isNaN(parsed)) {
						this.plugin.settings.pdfScreenshotMaxSize = parsed;
						await this.plugin.saveSettings();
					}
				}),
			);
		new Setting(containerEl)
			.setName(t('PDF 默认缩放'))
			.setDesc(t('自带查看器打开 PDF 时的初始缩放倍数，1 是原始大小。'))
			.addSlider((slider) =>
				slider
					.setLimits(0.6, 3, 0.2)
					.setValue(this.plugin.settings.pdfDefaultScale)
					.onChange(async (value) => {
						this.plugin.settings.pdfDefaultScale = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl).setName(t('锚点与外观')).setHeading();
		new Setting(containerEl)
			.setName(t('锚点标签名'))
			.setDesc(t('正文里写成一对尖括号标签，默认 pickme。改动标签名后，已有锚点需要重新插入才能识别。'))
			.addText((text) =>
				text
					.setValue(this.plugin.settings.tagName)
					.onChange(async (value) => {
						const previous = this.plugin.settings.tagName;
						const next = value.trim() || DEFAULT_TAG;
						if (next === previous) return;
						this.plugin.settings.previousTagName = previous;
						this.plugin.settings.tagName = next;
						await this.plugin.saveSettings();
						new ConfirmModal(
							this.app,
							t('锚点标签名已从 {previous} 改为 {next}。已有批注的锚点还是旧标签名，是否现在批量替换？', { previous, next }),
							() => {
								void this.plugin.replaceTagName(previous, next);
							},
						).open();
					}),
			);
		new Setting(containerEl)
			.setName(t('视觉标记样式'))
			.setDesc(t('阅读视图里批注范围怎么标出来。'))
			.addDropdown((dropdown) =>
				dropdown
					.addOption('background', t('底色'))
					.addOption('underline', t('下划线'))
					.addOption('border', t('左边框'))
					.setValue(this.plugin.settings.markStyle)
					.onChange(async (value) => {
						this.plugin.settings.markStyle = value as MarkStyle;
						await this.plugin.saveSettings();
						this.plugin.applyMarkStyle();
					}),
			);
		new Setting(containerEl)
			.setName(t('高亮颜色'))
			.setDesc(t('正文里批注范围的底色，或下划线、左边框的颜色。'))
			.addColorPicker((picker) =>
				picker.setValue(this.plugin.settings.highlightColor).onChange(async (value) => {
					this.plugin.settings.highlightColor = value;
					await this.plugin.saveSettings();
					this.plugin.applyHighlightColor();
				}),
			);
	}
}
