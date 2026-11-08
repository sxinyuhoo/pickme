import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import type { SettingDefinitionItem } from 'obsidian';
import { LANGUAGE_LABELS, setLanguage, t, templateLabel } from './i18n.ts';
import type { Language } from './i18n.ts';
import type PickmePlugin from './main.ts';
import type { ChatTransport } from './model/client.ts';
import type { PdfAnnotateMode } from './core/types.ts';
import { DEFAULT_TAG } from './core/anchor.ts';
import { ConfirmModal } from './ui/confirmModal.ts';

export interface PickmeSettings {
	/** 批注目录，默认在插件目录下，完全隐藏 */
	annotationDir: string;
	/** 源文档被删除后，自动清理它留下的批注文件（含区域截图） */
	pruneOrphanAnnotations: boolean;
	/** 孤儿批注的首次发现时间（按批注文件路径记），用来要求「连续两次都判定为孤儿」才清理 */
	orphanFirstSeen: Record<string, string>;
	/** 模板目录 */
	templateDir: string;
	/** 批注索引笔记路径，留空表示不生成 */
	/** 锚点标记属性名（写成 <span data-<这个名字>="id">） */
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
	/** 每个 PDF 上次读到第几页，按文件路径记，重开时回到原处 */
	pdfLastPage: Record<string, number>;
	/** 目录面板开着没有（有目录的 PDF 才显示这个开关） */
	pdfTocOpen: boolean;
	/** PDF 页面上是否画出已有批注的高亮框（关掉就是原始 PDF 的样子） */
	showMarks: boolean;
	/** 批注索引里是否列出「锚点丢失」的批注（关掉就只剩有效的，失效的仍留在文件里） */
	showStaleInIndex: boolean;
	/** PDF 标注方式：荧光笔（拖一笔吸附到文字行）/ 框选（拖一块区域）/ 便利贴（点一下放图标） */
	pdfAnnotateMode: PdfAnnotateMode;
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
	/** 上次的锚点标签名，用于批量替换 */
	previousTagName: string;
	/** 上次加载时的插件版本：和当前不一致＝刚更新过，用来触发老锚点的自动迁移 */
	lastVersion: string;
	/** 更新后检测到老格式锚点时自动迁移（会先备份） */
	autoMigrateAnchors: boolean;
	/** 手机上那条「怎么点开批注」的提示只弹一次 */
	mobileHintShown: boolean;
}

/** 视觉标记样式 */
export type MarkStyle = 'background' | 'underline' | 'border';

export const DEFAULT_SETTINGS: PickmeSettings = {
	// 空字符串表示「放在插件自己的目录里」，加载设置时按 manifest.dir 补全；
	// 不写死 .obsidian/plugins/<id>/... —— 用户改了插件目录名也不会错（官方 lint 规则 hardcoded-config-path）
	annotationDir: '',
	pruneOrphanAnnotations: true,
	orphanFirstSeen: {},
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
	pdfLastPage: {},
	pdfTocOpen: true,
	showMarks: true,
	showStaleInIndex: true,
	pdfAnnotateMode: 'highlight',
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
	mobileHintShown: false,
	lastVersion: '',
	autoMigrateAnchors: true,
};

/** 设置项的存储键：就是 PickmeSettings 的字段名，交给 SettingDefinitionItem<K> 做编译期检查 */
type SettingsKey = keyof PickmeSettings;

/** 界面语言下拉：值与显示文案 */
const LANGUAGE_OPTIONS: Record<string, string> = {
	en: LANGUAGE_LABELS.en,
	zh: LANGUAGE_LABELS.zh,
};

export class PickmeSettingTab extends PluginSettingTab {
	private plugin: PickmePlugin;

	constructor(app: App, plugin: PickmePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	/**
	 * 声明式设置页（Obsidian 1.13+）。框架按这份描述渲染每一行、读写并保存，
	 * 不再需要 display()。这里只拼描述、不做 IO —— 它每次 update 都会被调用，
	 * 还会用来建全局设置搜索的索引，所以必须便宜。
	 * 写回时的副作用（切语言、改样式、刷视图、弹确认框）都在 setControlValue 里。
	 */
	override getSettingDefinitions(): SettingDefinitionItem<SettingsKey>[] {
		return [
			// 通用项放最上面、不加标题：官方规范要求设置页不出现顶级标题
			{
				name: t('界面语言'),
				desc: t('设置面板与插件提示的语言。默认英文。'),
				aliases: ['language', 'locale', 'english', 'chinese'],
				control: {
					type: 'dropdown',
					key: 'language',
					defaultValue: DEFAULT_SETTINGS.language,
					options: LANGUAGE_OPTIONS,
				},
			},
			{
				type: 'group',
				heading: t('批注存放'),
				items: [
					{
						name: t('批注目录'),
						desc: t(
							'默认放在插件目录下，Obsidian 不索引隐藏目录，批注不可搜索；改成库内目录后可用 Dataview 与双链。',
						),
						aliases: ['annotation folder', 'annotation directory'],
						// 改完路径要等失焦再问「要不要把旧批注搬过来」，得拿到输入框的 blur；
						// 声明式的 text 控件给不了这个时机，所以这一行用 render 补齐
						render: (setting) => {
							setting.addText((text) => {
								const before = this.plugin.settings.annotationDir;
								text
									.setPlaceholder(DEFAULT_SETTINGS.annotationDir)
									.setValue(before)
									.onChange(async (value) => {
										this.plugin.settings.annotationDir = value.trim();
										await this.plugin.saveSettings();
									});
								text.inputEl.addEventListener('blur', () => {
									if (text.inputEl.value.trim() === before) return;
									void this.plugin.askMigrate(before);
								});
								text.inputEl.addEventListener('keydown', (event) => {
									if (event.key === 'Enter') text.inputEl.blur();
								});
							});
						},
					},
					{
						name: t('迁移批注目录'),
						desc: t(
							'把批注文件从上一次的目录搬到上面设置的目录，保持镜像结构。逐文件「写新的、删旧的」，不会两处各留一份；搬完原目录会剩下空文件夹，可以自己删。',
						),
						aliases: ['migrate', 'move annotations'],
						action: () => {
							void this.plugin.migrateAnnotations();
						},
					},
					{
						name: t('为没有批注的文档也建批注文件'),
						desc: t('默认关闭：只有真正加了批注才生成文件，避免文件浏览器噪音。'),
						control: {
							type: 'toggle',
							key: 'createEmptyAnnotationFile',
							defaultValue: DEFAULT_SETTINGS.createEmptyAnnotationFile,
						},
					},
					{
						name: t('源文档删除后清理批注'),
						desc: t('源文档被删除时，自动收掉它留下的批注文件与区域截图（移动或改名的文档不受影响）。'),
						control: {
							type: 'toggle',
							key: 'pruneOrphanAnnotations',
							defaultValue: DEFAULT_SETTINGS.pruneOrphanAnnotations,
						},
					},
				],
			},
			{
				type: 'group',
				heading: t('模板'),
				items: [
					{
						// 模板目录固定在插件目录下（隐藏，不占库结构），这里只读展示
						name: t('模板目录'),
						desc: t(
							'模板放在插件自己的目录里，不用改。目录里每个 .md 就是一个模板，文件名就是下拉里显示的名字。想自己加模板，用下面的「打开模板目录」或「新建模板」。',
						),
						aliases: ['template folder', 'template directory'],
						control: {
							type: 'text',
							key: 'templateDir',
							defaultValue: DEFAULT_SETTINGS.templateDir,
							disabled: true,
						},
					},
					{
						name: t('打开模板目录'),
						aliases: ['open folder', 'finder'],
						action: () => this.plugin.openTemplateDir(),
					},
					{
						name: t('恢复默认模板'),
						desc: t(
							'把内置的 3 个模板（解释、摘要、翻译）重新写进模板目录，已经存在的不覆盖。删掉的、改坏了的，用这个找回来。',
						),
						aliases: ['restore', 'reset templates'],
						action: () => {
							void (async () => {
								await this.plugin.ensureDefaultTemplates(true);
								this.update();
							})();
						},
					},
					{
						name: t('新建模板'),
						desc: t(
							'在模板目录里建一个新模板文件，建好的排在下面清单的最后。文件名就是模板名，正文写提示词，可用的变量都列在文件里。',
						),
						aliases: ['new template', 'create template'],
						action: () => {
							void (async () => {
								await this.plugin.createTemplate();
								this.update();
							})();
						},
					},
					{
						// 清单要读模板目录（异步），而 getSettingDefinitions 必须同步且便宜，
						// 所以这一块只能在 render 里补齐；每行的开关与删除照旧
						name: t('模板清单'),
						desc: t('勾上就在提问面板的下拉里出现；取消勾选只是藏起来，文件不删。新建的模板排在最后。'),
						aliases: ['templates', 'template list'],
						render: (setting) => {
							// 清单比一行宽，把这一行改成纵向排列，让下面的列表铺满（样式走 CSS 类，别写内联）
							setting.settingEl.addClass('pickme-setting-stack');
							const host = setting.settingEl.createDiv({ cls: 'pickme-template-list' });
							void (async () => {
								const builtin = this.plugin.templates.builtinNames();
								const names = this.plugin.templates.order(await this.plugin.templates.listAll());
								if (names.length === 0) {
									host.createDiv({
										cls: 'setting-item-description',
										text: t('模板目录里还没有模板，点上面的「恢复默认模板」生成内置的 3 个。'),
									});
									return;
								}
								for (const name of names) {
									new Setting(host)
										.setName(templateLabel(name))
										.setDesc(builtin.includes(name) ? t('内置模板') : '')
										.addToggle((toggle) =>
											toggle
												.setValue(!this.plugin.settings.hiddenTemplates.includes(name))
												.onChange(async (value) => {
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
															? t(
																	'删除内置模板「{name}」？文件会被删掉，需要时可以用「恢复默认模板」找回来。',
																	{ name },
																)
															: t('删除模板「{name}」？文件会被删掉。', { name }),
														() => {
															void (async () => {
																await this.plugin.deleteTemplate(name);
																this.update();
															})();
														},
													).open();
												}),
										);
								}
							})();
						},
					},
				],
			},
			{
				type: 'group',
				heading: t('模型通道'),
				items: [
					{
						name: t('接口地址'),
						desc: t('OpenAI 兼容接口的 base url，例如 https://api.openai.com/v1。'),
						aliases: ['api', 'base url', 'endpoint'],
						control: {
							type: 'text',
							key: 'apiBaseUrl',
							defaultValue: DEFAULT_SETTINGS.apiBaseUrl,
							placeholder: DEFAULT_SETTINGS.apiBaseUrl,
						},
					},
					{
						// 密钥输入框要用密码框（type=password），声明式控件没有这个类型，用 render 补齐
						name: 'API key',
						desc: t('保存在本机插件配置里，不会随库同步。'),
						aliases: ['key', 'token', 'secret'],
						render: (setting) => {
							setting.addText((text) => {
								text.inputEl.type = 'password';
								text
									.setPlaceholder(t('形如 sk-… 的密钥'))
									.setValue(this.plugin.settings.apiKey)
									.onChange(async (value) => {
										this.plugin.settings.apiKey = value.trim();
										await this.plugin.saveSettings();
									});
							});
						},
					},
					{
						name: t('默认模型'),
						desc: t('模板里没有指定 pickme_model、侧边栏也没有另选模型时使用。'),
						aliases: ['model', 'default model'],
						control: {
							type: 'text',
							key: 'model',
							defaultValue: DEFAULT_SETTINGS.model,
							placeholder: DEFAULT_SETTINGS.model,
						},
					},
					{
						name: t('温度'),
						desc: t(
							'0 到 1 之间，越小回答越稳、越确定，越大越发散。批注问答建议 0.2~0.4；模板文件里能用 pickme_temperature 单独覆盖。',
						),
						aliases: ['temperature', 'creativity'],
						control: {
							type: 'slider',
							key: 'temperature',
							defaultValue: DEFAULT_SETTINGS.temperature,
							min: 0,
							max: 1,
							step: 0.1,
						},
					},
					{
						name: t('流式输出'),
						desc: t('边生成边显示，回答一个字一个字地出来；关掉则等全部生成完再显示。流式只在浏览器请求通道可用。'),
						aliases: ['stream', 'streaming'],
						control: { type: 'toggle', key: 'stream', defaultValue: DEFAULT_SETTINGS.stream },
					},
					{
						name: t('深度思考'),
						desc: t('开启后先让模型推理再作答（质量更好、更慢）。思考内容有独立预算，不占用「最大输出长度」。'),
						aliases: ['thinking', 'reasoning'],
						control: { type: 'toggle', key: 'deepThinking', defaultValue: DEFAULT_SETTINGS.deepThinking },
					},
					{
						name: t('侧边栏可选模型'),
						desc: t('每行一个，或用逗号分隔。侧边栏的下拉会列出这些模型，留空则只能使用默认模型。'),
						aliases: ['models', 'model list'],
						// 存的是数组，控件是文本框：读写时在 getControlValue / setControlValue 里换行 ↔ 数组
						control: { type: 'textarea', key: 'modelOptions', rows: 3 },
					},
					{
						name: t('从接口拉取'),
						aliases: ['fetch models', 'list models'],
						action: () => {
							void (async () => {
								await this.plugin.fetchModelList();
								this.update();
							})();
						},
					},
					{
						name: t('视觉模型'),
						desc: t('PDF 区域截图走这个模型，留空表示用默认模型（默认模型本身支持图片即可）。'),
						aliases: ['vision', 'image model'],
						control: {
							type: 'text',
							key: 'visionModel',
							defaultValue: DEFAULT_SETTINGS.visionModel,
							placeholder: t('留空则用默认模型'),
						},
					},
					{
						name: t('允许图片输入'),
						desc: t('关闭后 PDF 区域批注只用命中文本提问，不发送截图。'),
						aliases: ['image', 'screenshot'],
						control: { type: 'toggle', key: 'visionEnabled', defaultValue: DEFAULT_SETTINGS.visionEnabled },
					},
					{
						name: t('最大输出长度'),
						desc: t(
							'单次回答的 token 上限。注意推理型模型的思考内容也计入这里：给得太小，思考还没结束就被截断，正文会是空的（批注里会写明原因）。',
						),
						aliases: ['max tokens', 'output tokens'],
						control: {
							type: 'number',
							key: 'maxOutputTokens',
							defaultValue: DEFAULT_SETTINGS.maxOutputTokens,
							min: 0,
							step: 1,
						},
					},
					{
						name: t('请求超时（秒）'),
						desc: t('超时后中止请求，已生成的部分会保留在批注文件里。0 表示不限制。'),
						aliases: ['timeout'],
						control: {
							type: 'number',
							key: 'requestTimeoutSec',
							defaultValue: DEFAULT_SETTINGS.requestTimeoutSec,
							min: 0,
							step: 1,
						},
					},
					{
						name: t('测试连接'),
						desc: t('按上面的地址与密钥发一次最小请求，确认能不能通。'),
						aliases: ['test', 'connection'],
						action: () => {
							void this.plugin.testConnection();
						},
					},
				],
			},
			{
				type: 'group',
				heading: t('选区与上下文'),
				items: [
					{
						name: t('选区上限（字符）'),
						desc: t(
							'一次最多送多少字给模型，超出会被截断并加一行提示。PDF 框选是取区域内的文字，同样受这个上限管。',
						),
						aliases: ['selection', 'characters'],
						control: {
							type: 'number',
							key: 'maxSelectionChars',
							defaultValue: DEFAULT_SETTINGS.maxSelectionChars,
							min: 0,
							step: 1,
						},
					},
					{
						name: t('上下文上限（字符）'),
						desc: t('取选区前后各一部分正文作为上下文。'),
						aliases: ['context', 'characters'],
						control: {
							type: 'number',
							key: 'contextChars',
							defaultValue: DEFAULT_SETTINGS.contextChars,
							min: 0,
							step: 1,
						},
					},
					{
						name: t('默认附带上下文'),
						desc: t('打开提问面板时，「带上下文」是否默认勾上。模板里能用 pickme_context 覆盖。'),
						control: {
							type: 'toggle',
							key: 'includeContextByDefault',
							defaultValue: DEFAULT_SETTINGS.includeContextByDefault,
						},
					},
					{
						name: t('在页面内提问'),
						desc: t(
							'开启后 PDF 框选、点批注框、点正文高亮，提问面板都直接开在页面上，不必打开侧边栏；' +
								'侧边栏只用来查看已有哪些批注。关闭则回到「提问在侧边栏」的老方式。',
						),
						aliases: ['inline', 'sidebar'],
						control: { type: 'toggle', key: 'inlineAsk', defaultValue: DEFAULT_SETTINGS.inlineAsk },
					},
					{
						name: t('添加批注后自动打开提问面板'),
						desc: t('关闭后，添加批注不会自动弹出面板，需要点批注标记再打开。'),
						control: {
							type: 'toggle',
							key: 'openSidebarOnAnnotate',
							defaultValue: DEFAULT_SETTINGS.openSidebarOnAnnotate,
						},
					},
				],
			},
			{
				type: 'group',
				heading: 'PDF',
				items: [
					{
						name: t('用自带查看器打开 PDF'),
						desc: t(
							'开启后 PDF 由 Pick Me 的 pdf.js 查看器打开，才能框选区域提问。核心查看器已占用 pdf 扩展名时，改为打开后自动切换到自带查看器（会闪一下内置查看器）。',
						),
						aliases: ['pdf', 'viewer'],
						control: {
							type: 'toggle',
							key: 'pdfViewerEnabled',
							defaultValue: DEFAULT_SETTINGS.pdfViewerEnabled,
						},
					},
					{
						name: t('显示批注高亮'),
						desc: t('PDF 页面上画出已有批注的框。关掉就是原始 PDF 的样子，工具栏上也有一个按钮可以随时切换。'),
						aliases: ['marks', 'highlight'],
						control: { type: 'toggle', key: 'showMarks', defaultValue: DEFAULT_SETTINGS.showMarks },
					},
					{
						name: t('默认标注方式'),
						desc: t('荧光笔：拖一笔划过文字就自动吸附到行；框选：拖出一块区域。随时可在 PDF 工具栏切换。'),
						aliases: ['annotate mode', 'highlight', 'area'],
						control: {
							type: 'dropdown',
							key: 'pdfAnnotateMode',
							defaultValue: DEFAULT_SETTINGS.pdfAnnotateMode,
							options: {
								highlight: t('荧光笔'),
								area: t('框选'),
								none: t('浏览（不预设工具）'),
							},
						},
					},
					{
						name: t('保存区域截图'),
						desc: t(
							'框选时把这块区域裁成 PNG 存在批注旁边，提问时作为图片送给模型。不需要图文问答就关掉，能省下这些图占的空间。',
						),
						aliases: ['screenshot', 'region'],
						control: {
							type: 'toggle',
							key: 'pdfSaveScreenshot',
							defaultValue: DEFAULT_SETTINGS.pdfSaveScreenshot,
						},
					},
					{
						name: t('截图最大边长（像素）'),
						desc: t('截图等比缩到这个边长再存：越小越省 token，字也越小。0 表示不缩放。'),
						aliases: ['screenshot size', 'pixels'],
						control: {
							type: 'number',
							key: 'pdfScreenshotMaxSize',
							defaultValue: DEFAULT_SETTINGS.pdfScreenshotMaxSize,
							min: 0,
							step: 1,
						},
					},
					{
						name: t('PDF 默认缩放'),
						desc: t('自带查看器打开 PDF 时的初始缩放倍数，1 是原始大小。'),
						aliases: ['zoom', 'scale'],
						control: {
							type: 'slider',
							key: 'pdfDefaultScale',
							defaultValue: DEFAULT_SETTINGS.pdfDefaultScale,
							min: 0.6,
							max: 3,
							step: 0.2,
						},
					},
				],
			},
			{
				type: 'group',
				heading: t('锚点与外观'),
				items: [
					{
						name: t('锚点标记名'),
						desc: t(
							'正文里写成一对方括号里的属性，形如 span data-锚点名="id"，默认 pickme。改名后要把已有锚点一起替换（命令面板里的「批量替换锚点标签名」）。',
						),
						aliases: ['anchor', 'tag'],
						control: {
							type: 'text',
							key: 'tagName',
							defaultValue: DEFAULT_SETTINGS.tagName,
						},
					},
					{
						name: t('更新后自动迁移老格式锚点'),
						desc: t(
							'老格式（自定义标签写法）的锚点在阅读视图里画不出来。插件更新后如果检测到它们，会自动迁到新格式——迁移前先把涉及的文档备份到插件目录，迁完再复核一遍。关掉就只在命令面板里手动跑。',
						),
						aliases: ['migrate', 'anchor', 'version'],
						control: {
							type: 'toggle',
							key: 'autoMigrateAnchors',
							defaultValue: DEFAULT_SETTINGS.autoMigrateAnchors,
						},
					},
					{
						name: t('立即迁移老格式锚点'),
						desc: t('先扫全库报个数（不改文件），确认后再迁移；迁移前会自动备份。'),
						aliases: ['migrate', 'anchor'],
						render: (setting) => {
							setting.addButton((button) => {
								button.setButtonText(t('扫描并迁移')).onClick(() => {
									void (async () => {
										const { files, total } = await this.plugin.scanLegacyAnchors();
										if (total === 0) {
											new Notice(t('pickme：没有需要迁移的锚点'));
											return;
										}
										new ConfirmModal(
											this.plugin.app,
											t(
												'把 {v0} 个文档里的 {v1} 个旧格式锚点迁成新格式（只动标记写法，不动选区内文字）。迁移前会把这些文档备份到插件目录。',
												{ v0: files.length, v1: total },
											),
											() => {
												void this.plugin.migrateAnchorFormat();
											},
										).open();
									})();
								});
							});
						},
					},
					{
						name: t('索引里显示「锚点丢失」的批注'),
						desc: t(
							'原文改动后锚点找不回的批注不会删，只会在索引里收成一条可展开的记录。不想看到它们就关掉——批注仍在批注文件里，随时可以打开这个开关或用「重新绑定失效锚点」救回。',
						),
						aliases: ['stale', 'broken anchor', 'index'],
						control: {
							type: 'toggle',
							key: 'showStaleInIndex',
							defaultValue: DEFAULT_SETTINGS.showStaleInIndex,
						},
					},
					{
						name: t('视觉标记样式'),
						desc: t('阅读视图里批注范围怎么标出来。'),
						aliases: ['mark style', 'appearance'],
						control: {
							type: 'dropdown',
							key: 'markStyle',
							defaultValue: DEFAULT_SETTINGS.markStyle,
							options: {
								background: t('底色'),
								underline: t('下划线'),
								border: t('左边框'),
							},
						},
					},
					{
						name: t('高亮颜色'),
						desc: t('正文里批注范围的底色，或下划线、左边框的颜色。'),
						aliases: ['colour', 'color', 'highlight'],
						control: {
							type: 'color',
							key: 'highlightColor',
							defaultValue: DEFAULT_SETTINGS.highlightColor,
						},
					},
				],
			},
		];
	}

	/** 读当前值。modelOptions 存的是数组，文本框要的是换行分隔的字符串 */
	override getControlValue(key: string): unknown {
		if (key === 'modelOptions') return this.plugin.settings.modelOptions.join('\n');
		return (this.plugin.settings as unknown as Record<string, unknown>)[key];
	}

	/**
	 * 写回并保存。覆盖了框架默认的写入路径，所以要自己调 saveSettings()；
	 * 需要即时生效的项（语言、标记样式、荧光色、PDF 查看器、视图开关）在这里顺手做副作用。
	 */
	override async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings;
		const record = settings as unknown as Record<string, unknown>;
		switch (key) {
			case 'language': {
				const next: Language = value === 'zh' ? 'zh' : 'en';
				settings.language = next;
				setLanguage(next);
				await this.plugin.saveSettings();
				await this.plugin.refreshUiText();
				// 文案变了，整页的描述都要重算
				this.update();
				return;
			}
			case 'modelOptions': {
				settings.modelOptions = String(value ?? '')
					.split(/[\n,，]/)
					.map((item) => item.trim())
					.filter((item) => item !== '');
				break;
			}
			case 'tagName': {
				const previous = settings.tagName;
				const next = String(value ?? '').trim() || DEFAULT_TAG;
				if (next === previous) return;
				settings.previousTagName = previous;
				settings.tagName = next;
				await this.plugin.saveSettings();
				new ConfirmModal(
					this.app,
					t('锚点标签名已从 {previous} 改为 {next}。已有批注的锚点还是旧标签名，是否现在批量替换？', {
						previous,
						next,
					}),
					() => {
						void this.plugin.replaceTagName(previous, next);
					},
				).open();
				return;
			}
			case 'markStyle': {
				settings.markStyle = value as MarkStyle;
				await this.plugin.saveSettings();
				this.plugin.applyMarkStyle();
				return;
			}
			case 'highlightColor': {
				settings.highlightColor = String(value ?? '');
				await this.plugin.saveSettings();
				this.plugin.applyHighlightColor();
				return;
			}
			case 'pdfAnnotateMode': {
				settings.pdfAnnotateMode = value === 'area' ? 'area' : 'highlight';
				await this.plugin.saveSettings();
				void this.plugin.refreshViews();
				return;
			}
			case 'pdfViewerEnabled': {
				const enabled = Boolean(value);
				settings.pdfViewerEnabled = enabled;
				await this.plugin.saveSettings();
				this.plugin.applyPdfViewerSetting();
				new Notice(enabled ? t('pickme：已接管 PDF 打开') : t('pickme：已交还内置查看器，下次打开 PDF 生效'));
				return;
			}
			case 'showMarks': {
				settings.showMarks = Boolean(value);
				await this.plugin.saveSettings();
				await this.plugin.refreshViews();
				return;
			}
			case 'inlineAsk': {
				settings.inlineAsk = Boolean(value);
				await this.plugin.saveSettings();
				await this.plugin.refreshViews();
				return;
			}
			case 'showStaleInIndex': {
				settings.showStaleInIndex = Boolean(value);
				await this.plugin.saveSettings();
				await this.plugin.refreshViews();
				return;
			}
			case 'apiBaseUrl':
			case 'apiKey':
			case 'model':
			case 'visionModel':
			case 'annotationDir':
			case 'templateDir': {
				record[key] = String(value ?? '').trim();
				break;
			}
			case 'temperature':
			case 'maxOutputTokens':
			case 'requestTimeoutSec':
			case 'maxSelectionChars':
			case 'contextChars':
			case 'pdfScreenshotMaxSize':
			case 'pdfDefaultScale': {
				const parsed = Number(value);
				// 空串、乱输一律不写回，保留原来的数值
				if (Number.isNaN(parsed) || parsed < 0) return;
				record[key] = parsed;
				break;
			}
			default:
				record[key] = value;
		}
		await this.plugin.saveSettings();
	}
}
