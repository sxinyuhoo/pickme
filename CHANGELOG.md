# Changelog

Release notes shown on GitHub are taken from the section of this file that matches the tag.

## 1.6.10

- **批注框只剩一套逻辑**：没有内容时直接给输入框；有内容时先按 Markdown 渲染出来看，点「编辑」就地变回输入框（不再「输入框 + 已保存回显」两套并存）。渲染用的是 Obsidian 自己的渲染器，所以加粗、列表、链接、行内代码都和正文一致
- **修回归：选中正文不冒浮出按钮 / 点高亮不开面板**
  - 浮出按钮原来把「任意 `.pickme-panel`」都当成挡路的：插件重载留下的不可见旧面板会让它永远不出现。现在只认真正挂在上面的面板
  - 原来「点过的那段文字」会长期静默（同一段再选也不会出现），改成点完只静默 1.2 秒
- 删掉上一版那三条只用于旧按钮的英文译文

## 1.6.9

- **批注与问 AI 的内容彻底分开**：AI 的问答记录只出现在「问 AI」那一栏，批注栏不再显示；状态行也跟着当前栏走（原来两栏共用一条，会出现「显示了 Note saved、但内容看着不对」的错位）
- **保存后看得见、改得动**：批注输入框始终是这条批注唯一的编辑处；保存后框下会回显「已保存的批注」，带一个「编辑」按钮把焦点送回输入框，改完再保存即更新
- **按钮统一**：两栏的删除按钮都叫「删除」（具体删什么写在确认框里，不再出现 "Delete this highlight" 与 "Delete" 两种叫法）
- **批注索引每个文档可折叠**：折叠开关在条数标记右边，打开索引时默认全部折叠

## 1.6.8

- **正文批注面板同时支持「批注」与「问 AI」**：面板顶部一排切换（文字批注默认落在「批注」，之后沿用上次选的那一栏），两块内容互斥显示，切换时只换类名、不重建 DOM，所以不会闪。PDF 那边默认栏不变（荧光笔/便利贴默认批注、框选默认问 AI），只是也多出这排切换
- **点正文里的批注不再整篇重排**：「闪一下」的真因是点击后走了 `jumpToAnchor` → `openFile` 把文档又打开了一次，阅读视图整篇重绘。现在人手点在标记上只开面板、不跳转（从侧边栏/索引点进去时照旧跳转 + 闪烁）
- 文字批注的删除按钮文案改为「删除这条批注」（之前误写成「删除这条高亮」）
- 从索引/侧边栏跳转时，若文档已经开着就直接用那个叶子，不再 `openFile` 重开

## 1.6.7

- **修「点过批注按钮之后，它又冒出来、还飘到屏幕边上」**：批注面板一开，浮出按钮就不该再出现——现在面板开着时一律不显示；另外记住「刚点过的那段文字」，只要选区还是它就不再冒头（换一段选区或把选区清掉才恢复），面板关掉后也不会立刻又弹回来

## 1.6.6

- **修「浮出的提问按钮透出正文、两段字叠在一起」**：启用「半透明界面」（translucency，Baseline 等主题常见）时主题的背景色带透明度，浮框于是能看穿到下面的正文。现在浮框会量一次主题底色、把 alpha 抹掉做不透明底（优先 `--background-primary`，取不到再退次级背景）；换主题/切深浅时自动重算。顺带把浮框按钮的选择器权重提上去（主题对 `button` 的样式原本会盖掉我们的底色），并禁止标签换行

## 1.6.5

- **荧光笔划线不再被系统当成「拉出侧边栏」**：翻 Obsidian 自己的手势代码发现，它的滑动识别在 `touchstart` 时沿祖先链检查 `data-ignore-swipe`（值要是真值；`toggleAttribute` 设出来的空字符串会被当成假值，等于没设）——它自家的画布、缩放手柄用的就是这个开关。现在举着标注工具时给视图容器挂上它，工具态下系统完全不再识别滑动；浏览态照旧（想滑动拉出侧栏不受影响）
- **批注输入框改回左对齐**：上一版给页码框定的样式被误并进了「所有输入框」那条规则（宽 38px、居中），导致面板里“写点什么”的占位文字和光标都居中；已拆成独立规则，页码框单独管

## 1.6.4

手机端三处：

- **页码看得清了**：Obsidian 给输入框的默认内边距是 `4px 16px`，38px 宽下只剩几个像素装数字，数字被切掉一半——改成定高 28px、左右各 2px、居中
- **画批注不再被系统手势抢走**：举着标注工具时单指手势全部归插件（此前「左划」会被当成从边缘拉出侧边栏）；浏览态不受影响，照常滚动
- **面板固定不动、并抬到 Obsidian 底栏之上**：去掉拖动与顶部抓手（上一版的拖动做得太灵敏），底部按 Obsidian 自己那条工具栏的高度（自动量，找不到时保守取 52px）留出空间，不再和它叠在一起

## 1.6.3

- **手机上面板真能拖了**：顶部那道小横杠现在可抓——按住往下甩就收起（等同点 ×），往上拖展开到更高
- **手机工具栏补回翻页**：上一版为腾地方把翻页一起收掉了，现在恢复「上一页 / 页码框 / 下一页」，只收起缩放（捏合更快）；顺带修掉页码框被 Obsidian 的 `input[type=text]{width:100%}` 拉满整条工具栏的问题，状态文字单独占一行 → 工具栏从 163px 降到 70px

## 1.6.2

修「PDF 页面没法缩放，一直是某个固定比例」：

- 手机上支持**双指捏合缩放**（0.4×–4×）：捏合时只改尺寸、不重画，松手后按最终比例重画，文字重新变清晰；浏览器自带的整页缩放不再抢这个手势
- 桌面上**触控板捏合**（Ctrl / ⌘ + 滚轮）也用于缩放，不再被当成翻页
- 缩放时保持当前页与页内位置，视线不会跳走

## 1.6.1

修手机上「工具栏被目录和翻页键占满、标注工具点不到，随手一点却多出一条便利贴」：

- 手机上工具栏只留「目录 / 荧光笔 / 框选 / 便利贴 / 高亮开关」，翻页与缩放收起来（手指滚动、双指缩放就够）——390 宽下 5 颗按钮全部在行内，58px 高
- 手机上每次打开 PDF 先回到浏览态：上次选的工具不再「粘」在那里，避免随手一点就落一条批注（只改内存，不动你存下来的偏好）
- 「适应宽度」在量不到宽度时会自动补试，避免刚进页面时页宽还是默认值

## 1.6.0

手机端（iOS / Android）可用，桌面端行为不变：

- `isDesktopOnly` 关掉，手机上可以直接安装
- 触屏交互：点批注的边框、荧光带或便利贴图标即可打开（和桌面同一套命中区域，不再依赖悬停）；举着标注工具时页面接管手势，单指划线、双指缩放，浏览态正常滚动
- 提问面板在手机上变成贴底抽屉，并跟随软键盘抬起；工具栏改单行横向滚动（原来换行要吃掉近五分之一的屏幕），打开 PDF 自动适应宽度
- 选中正文后浮出「提问或批注」小按钮（手机没有右键菜单；桌面也少记一个入口），阅读视图同样可用
- 手机上请求直接走 `requestUrl`（浏览器 fetch 在 WebView 里必被跨域拦，先去试只是白等一轮）
- 所有提问的系统提示都加了一条「回答要精炼」：先给结论、一般不超过一百二十字，需要展开时再要
- 顺手消掉社区扫描器的两条隐患：去掉 5 处 `console.*` 调用

## 1.5.6

- 彻底消掉 `no-static-styles-assignment`：社区规则只允许 `setCssProps` 写**自定义属性**（`--` 开头），写 `left` / `width` / `z-index` 这类真实属性同样算违规
  - 批注位置与尺寸（`pdfView.ts`、`pdfjs.ts`、`askPanel.ts` 共 15 处）改为传 `--pk-l` / `--pk-t` / `--pk-w` / `--pk-h`，由样式表统一消费
  - 批注层级不再写内联 `z-index`，改为类名 `is-mark-band` / `is-mark-box` / `is-mark-sticky`
  - 目录缩进改为 `--pk-pad`，样式表里 `padding-left: var(--pk-pad, 8px)`

## 1.5.5

- **修数据合并 bug**：在框选批注上画荧光笔时，这一笔会被「续划合并」并进那条框（变成同一条批注的第二个形状）——于是删框会把荧光一起删掉，颜色也叠成一块。现在只允许并进**荧光高亮**之间，框上画荧光一律新建独立批注，删谁都互不影响
- 框选不再铺底色（只留描边）：框和荧光带叠在一起时，两边的颜色都与单独存在时完全一致

## 1.5.4

- 按官方扫描器整改：
  - 目录缩进与 pdf.js 画布尺寸改为 `setCssProps`（不再直写 `element.style`）
  - 去掉一处多余的类型断言
  - 去掉样式表里重复的 `border-radius`
  - 「减少动效」块改用提高特异性而非强改符
  - 去掉两处 `:has`（会触发大范围选择器失效）：批注的「悬停压暗 / 选中压暗」改由 JS 在 overlay 上挂 `has-hover` / `has-active` 状态类

## 1.5.3

- 修「举着荧光笔 / 便利贴 / 框选时，指针移到框的边框上不变手型」：模式光标（笔刷 / 十字 / 便利贴）的选择器权重和「悬停手型」一样高，谁写在后面谁赢；现在把悬停手型的规则排到模式光标之后，并逐模式提高特异性，四种模式下边框、荧光带、便利贴都会变手型
- 开始落笔时先清掉悬停态，不会画到一半还停着「手型」

## 1.5.2

- 修「举着工具（荧光笔 / 框选 / 便利贴）时，指针移到框的边框上没有任何反应、也点不开」：悬停判定以前只在浏览态跑（荧光带和便利贴靠 CSS 的 :hover 还能有反馈，框的边框走几何判定就被漏掉了）。现在**任何模式下四条边框都会高亮、都能点开**
- 边框命中容差 5px → 6px，细边框也好瞄

## 1.5.1

- 去掉 1.5.0 的小圆把手（不好看），改成：**荧光笔**把指针移到划过的文字上就能高亮并点击；**框选**把指针移**到边框上**才显示信息并支持点击，框内部不可点（随时可以在框里落笔）
- 修「荧光笔和框选叠在一起时，框选区域整块变深」：绘制层级写在批注自己身上（荧光在下、框在上、便利贴再上）。之前层级写在子形状上，而批注被压暗/放大时会新建层叠上下文，层级的比较被局限在各自那一层里，叠放时框仍会被荧光乘暗
- 顺带修一个静默失效：`setCssProps` 只认 kebab-case 名（驼峰会被忽略）

## 1.5.0

- 批注多了个**把手**：每条荧光 / 框选批注的左边缘有一个小圆点，点它才打开这条批注（便利贴仍是点它自己的图标）
- 批注本体永远不吃指针：任何模式下都能直接在已有的高亮或框上落笔，不用来回切模式
- 指针停在把手上会亮起对应那条批注并显示「第 N 页 · 类型」，其它批注退到背景
- 浏览态下在页面上拖动不再产生任何批注（之前空白处拖动会走到创建逻辑）

## 1.4.1

- 浏览态改成「悬停即当前」：指针停在哪条批注上就亮哪条（其它条退到背景），点开的就是亮着的那条；优先级按看到的层次来——便利贴 > 荧光带 > 框（框是一大块透明区域，不该盖住它上面的荧光带）
- 修「在框上划荧光笔后那块明显发深」：荧光带用正片叠底和纸面相乘，如果框画在带子下面，带子会把框也一起乘暗。现在给三种形状定了绘制层级（带子在最下、框在其上、便利贴再上），带子只跟纸面和文字相乘

## 1.4.0

- 新增「浏览态」：再点一下当前工具就取消选中，指针回到普通箭头，只用来阅读和点批注；隐藏批注时也会自动切回浏览态（设置里的「默认标注方式」多了「浏览」选项）
- 举着工具时批注不拦指针：可以直接在已有的框上划荧光笔、框选或放便利贴（之前移到框上只会打开那条批注）
- 几条约批注叠在同一处时，在同一处再点一下依次切换（先最上层，再往下），状态栏会写「这里叠了 N 条批注（荧光 → 框选）」

## 1.3.0

- 修「索引里第二条批注要点两次才生效」：鼠标按下的那一刻会切焦点，索引跟着重建，把按住的那一行换掉——浏览器就再也不发 click 事件了。现在重建会避让进行中的点击，数据没变也直接跳过重建
- 从索引打开批注时不再对已打开的文件重复 openFile：之前每次点击都会让阅读器重载一遍（看起来像页面刷新），也会连带重建列表
- 内置模板名跟随界面语言：英文界面下显示 Explain / Summarize / Translate（文件本身不动，只换显示名）
- 回答语言跟随界面语言：英文界面默认英文作答、中文界面默认中文作答；你在提问里自己指定了语言（如「请用中文回答」「translate to Japanese」）就不再追加语言指令
- 系统提示不再自称「中文助手」（这条会让英文界面下的模型默认用中文回答）

## 1.2.10

- 修「闪烁只在框的左上角冒一个圆点」：临时框里那层子元素是绝对定位，没给 inset 就塌成 0×0，描边只能画出左上角一个点；补上 `inset: 0` 之后整块区域一起闪
- 冷启动（文件还没打开时）第一次点击就会正确闪烁，不再需要点第二次

## 1.2.9

- 修「闪烁只出现在页面左上角的一个小圆点」：定位闪烁用的临时框自己带 `position: absolute` 才能用 left/top 定位，之前漏了，于是框一直蹲在页面左上角（1.2.8 引入）
- 清掉官方扫描器的报错：浏览器请求入口改用 DOM 类型里的 `window.fetch`（去掉 `any` 与 eslint-disable 注释）、移除一处 console.log

## 1.2.8

- 定位闪烁改成**独立绘制的临时框**：不再依赖常驻标记元素，页面或标记怎么重绘都不会把闪烁冲掉（只活一秒多，不吃鼠标事件、不碰数据）
- 点同一页里的另一条批注不再把页面滚回页首：目标页已经看得见时就只做页内定位，不再有「跳一下」的重新载入感
- 「待闪烁」请求与兜底保险也统一走这套几何闪烁

## 1.2.7

- 闪烁改回原来的细描边呼吸（0.42s × 2），去掉 1.2.6 那层偏重的填充
- 单文档批注侧边栏的「全部批注（索引）」文字链接改成右上角一个小图标按钮，点它直接打开批注索引
- 修「部分批注点了不跳不闪」：批注文件里记的源路径过期时（文档在插件监听之外被移动过），跳转会按 id 跨文档找到它，并顺手把批注文件搬到新路径（自愈）；两边文件都已存在、搬不动的情况，就在页面上临时画一个框闪两下做定位
- 启动时会静默自愈一遍这类过期源路径（只认「同名且唯一」的文档，不会搬错）

## 1.2.6

- 闪烁做得更醒目：在描边之外再叠一层强调色填充呼吸（任何标注类型都盖得住，一眼可见）
- 闪烁节奏拉长（0.55s × 2），并在跳转/滚动落定后 150ms 才开始闪，避免被同时发生的位置变化盖掉

## 1.2.5

- 闪烁加了一道兜底保险：把闪烁交给阅读器之后 1.8 秒仍未被兑现（没建出视图、渲染卡住、实例被换掉等任何一条岔路），插件自己找到标记再闪一次——「点了就该闪」不再依赖单一路径
- 说明：1.2.4 已修掉「同文档第二次点击不闪」的根因（视图尚未创建完成时那次请求被丢掉），这版是把这种情况彻底兜住

## 1.2.4

- 修「同一文档只有第一次点击会闪烁」：从索引点进去时阅读器视图可能还没创建完，那次闪烁请求现在会挂起，由先画完这一页的视图兑现（视图中途被替换也不会丢）
- 连点同一条批注也会重新播闪烁（先摘类、强制重排再挂上）

## 1.2.3

- 修批注索引点进去不闪烁：以前标记元素一出现就闪，而那时页面还是白纸——现在等这一页真正渲染完成（或渲染失败）再闪
- 修批注索引没有滚动条：视图容器的 overflow 是 hidden，内容超出的部分既看不见也滚不动
- PDF 闪烁统一由阅读器自己在「渲染完成」后触发（正文批注仍由插件在跳转后触发）

## 1.2.2

- 修「便利贴批注点击不闪烁」：闪烁规则漏了便利贴这一种标注（只覆盖了行带、框、页码标签）
- 闪烁等标记真正画出来之后再闪（翻页重绘期间元素尺寸为 0 时不算到位），新建出来的阅读器会先切到前台再闪
- 闪烁更明显：描边 3px、偏移 2px
- 修社区扫描器的报错：styles.css 里一个空规则（选择器以逗号结尾、没有声明块）、设置页两处内联样式改为 CSS 类、`createEl('span')` 改用 `createSpan`、全局 fetch 引用收敛成一处显式入口

## 1.2.1

- 从批注索引点进某条批注也会闪烁定位了（PDF 冷启动要等渲染，重试窗口从 1.2 秒放宽到 6 秒）
- 「失效」统一改叫「锚点丢失」：说明白这是你自己的批注（锚点找不到了），不是坏数据
- 新增设置「索引里显示『锚点丢失』的批注」：不想看到就关掉，批注仍在文件里，随时能开回来或重新绑定

## 1.2.0

- 设置页改用 Obsidian 的声明式设置 API：全部 37 项都能在「设置搜索」里搜到，分组与说明重写；**最低 Obsidian 版本因此提高到 1.13.0**
- 点击批注索引或侧边栏里的任意一条，跳过去后目标标记会**连闪两下**（0.42s × 2），同一页批注再多也能一眼找到；PDF 标记是异步渲染的，加了重试不会漏；尊重系统「减少动态效果」设置
- 批注索引的边距与单文档侧边栏完全对齐（视图 12/12/32、子项同一竖线），并修掉一条把索引内边距压成 0 的规则
- README 索引与多选截图重拍

## 1.1.5

- 批注索引：统计文字与标题、文档名严格左对齐（去掉 2px 缩进）

## 1.1.4

- 批注索引留白重排：四周留出内边距，标题与统计分成两行，搜索框变矮、不再贴边
- 全内容统一到一条左基线（标题/统计/搜索框/文档名/缩略图同一竖线），行的高亮底色向两侧各溢出 8px
- 文档分组之间改用留白分隔，去掉分隔线；修掉索引分组被侧边栏卡片规则误画的一道多余横线
- README 索引与多选截图重拍

## 1.1.3

- 批注索引：页码与类型拆成两个元素 —— 页码淡灰做定位，类型带标签底色，扫读时先看类型
- 单文档侧边栏整体对齐索引的语言：去掉「卡中卡」，改成一行的行式列表（左侧强调条 + 行间内缩细线）
- 锚点 id 不再套胶囊；类型标签与索引同款；状态不再用主题的青色（那套主题的 faint 就是青色）
- 操作按钮收小成描边小按钮；区域截图压到 72px 高；问题与回答用竖线分层，字号 10.5px 统一
- 说明文字改成左侧竖线引用样式，不再抢眼
- README 索引与多选截图重拍

## 1.1.2

- 批注索引排版重做：文档组标题降到小字 + 计数胶囊，批注标题成为行内主体，四级层级一眼可辨
- 每行左侧统一「预览槽」：有截图给缩略图，没有就给类型图标（文本批注 / 高亮），正文左边界不再跳；截图文件缺失时换成图标而不是留空洞
- 元信息（提问数 · 锚点 id · 时间）改用轻点分隔、时间推到行尾对齐；不再跟随主题的 faint 色（有的主题把它做成青色），改为按正文色取中性灰
- 行间细线内缩，组间分隔加重；文档名去掉主题加的下划线
- README 的索引与多选截图按新版重拍

## 1.1.1

- 修下拉框：模板、模型两个选择框的箭头会压住文字 / 看不见，现在箭头自己画、右侧留出内边距
- README 截图按 1.1.0 的新界面全部重拍，并补上批注索引多选与批量删除的截图

## 1.1.0

界面全线重做，功能不变。

- 统一设计语言：字号、间距、圆角、过渡全量对齐 TLT；颜色改为令牌化管理，深浅两套随 Obsidian 主题自动切换（也会跟随你换的主题）
- 批注索引：新增多选与批量删除（勾选框、已选计数、全选/取消、删除所选，0 条时删除按钮禁用），支持 ↑↓ / Space / ⌘A / Del 键盘操作；删除前确认并说明会一并移除正文锚点标签
- 索引行内删除按钮平时收起、悬停才出现；截图缺失时不再显示破图标
- PDF 阅读器工具条按 V2 密度重排，标注方式选中态用底色 + 描边 + 图标同色三重确认
- PDF 纸面固定白纸：深色主题下荧光带不再被压低对比度而看不清
- 问答/批注面板、侧边栏、设置页跟着同一套令牌走

## 1.0.17

### Changed

- **Annotation files now move with their source document** (the change 1.0.16 was leading up to). Moving or renaming a note or PDF moves its annotation file, and its region screenshots, to the matching place inside the plugin folder, and rewrites the paths that point at those screenshots. The mirrored-path invariant therefore holds again, which means reading no longer has to guess and — more importantly — a move or a rename can no longer be mistaken for a deletion.
- The delete handler waits a moment and then double-checks: if **another** document with the same name exists (the copy-then-delete way of moving a file in Finder), the annotations are kept. Previously the check ran while the vault index had not caught up, so a real deletion could never be cleaned.
- The startup sweep now asks for the same judgement twice: an orphan is only cleaned if a previous run already saw it as an orphan (and at least a minute has passed), which covers renames done while Obsidian was closed and vaults that have not finished syncing. A delete that goes through Obsidian still cleans up immediately.
- Fixed a file-name match that only stripped `.md`: documents like `.pdf` never matched when resolving by name, so the guard above would not have held for them.

## 1.0.16

### Added

- **Annotations for a deleted document are cleaned up automatically.** Deleting a note or PDF used to leave its annotation file (and region screenshots) behind, still listed in the index. Now the plugin reacts to the delete, removes that file's annotations together with their screenshots, and sweeps anything left over from earlier at startup. The sweep only treats a document as gone when **both** its stored path and its file name resolve to nothing — so a moved or renamed document keeps its annotations (that is what 1.0.15 was about). A notice tells you how many were removed, and the whole behaviour has a setting (on by default).

## 1.0.15

### Fixed

- **A fast multi-line stroke no longer skips lines.** Sweeping the highlighter quickly across several lines can coalesce pointer events, and the lines in the middle were left out. Lines that fall between the first and last line actually touched are now filled in automatically — their band is interpolated from where the stroke crosses them — so a gap in your hand no longer becomes a gap in the highlight.
- **The annotation index survives moving or renaming the source.** Rows used to resolve their document by the path stored in the annotation file, so moving the note or PDF broke the jump with “source not found”. The index now falls back to resolving by file name (Obsidian's own link resolution first, then a unique match in the vault), and the annotation file is located the same way after a move.

### Changed

- **Smaller highlighter cursor, and it gets out of the way while you draw.** The pen cursor is smaller, and once the mouse is down it switches to a bare stroke without the pen body, so less of the text you are highlighting is covered.

## 1.0.14

### Fixed

- **A multi-line selection in a note no longer loses everything after the first line.** `- 选区：` is a single-line bullet, so a selection containing newlines used to be written across several physical lines, read back as its first line only, and the annotation was afterwards reported as stale — even though the note itself was never touched. Because every read wrote the truncated value back, the rest was gone for good. The selection is now escaped into a single line (newlines become a literal `\n`, backslashes are doubled) and restored on read; files without newlines stay byte-for-byte identical, so nothing needs migrating. Reported and fixed by @tyouter (#1, #2).
- Annotations that were already truncated cannot be repaired automatically, but the full text still sits between the anchor tags in your note — use the command **Rebind stale anchors** to attach a fresh anchor to it.

## 1.0.13

### Changed

- **Saving a sticky note closes its box.** Dropping a sticky, typing and hitting save (or `⌘/Ctrl + Enter`) is the whole interaction — the box closes by itself instead of waiting for you to press the close button. The box closing is the confirmation, so no status line is left behind.
- A highlight's note box still stays open after saving, so you can keep editing it or switch to the question composer with one click.

## 1.0.12

### Added

- **Sticky notes can be dragged.** Grab one and drop it wherever you want: the icon follows the pointer and the new position is written to the annotation file (the same gesture that used to be a click still opens the note — a drag only starts once the pointer actually moves). Works in every mode, so you do not have to switch back to the sticky tool to tidy up a page.

### Changed

- The sticky icon is a good deal paler: it is mixed from the theme's yellow and the page background, so it reads as a marker without shouting in either a light or a dark theme. Empty notes are paler still (and dashed).

## 1.0.11

### Added

- **Sticky notes.** A third annotation mode alongside the highlighter and the region tool: click anywhere on a PDF page and a small sticky-note icon is dropped there — the icon is all you see on the page, and clicking it opens what you wrote (hovering previews it). Notes can run several lines: the text is kept in full in the annotation file (`### 注释`) with a one-line summary in the bullets, so a long note survives a round trip through the file. The icon is filled when it has content and dashed while it is empty, and the box offers “Ask AI instead” exactly like a highlight's note.
- Note text is no longer folded to a single line: a note that contains line breaks is written out in full (a highlight's note benefits too).

## 1.0.10

### Added

- **Continued highlighting merges.** Start a stroke on an existing highlight (or on the line right above/below it) and that stroke is appended to it instead of creating a second annotation — so reading down a paragraph and swiping line by line builds one multi-line highlight. No panel opens for a continuation, because it is not a new annotation.
- **A mostly vertical stroke highlights the whole line.** Dragging straight down across a few lines used to leave a 4pt sliver on each; now each of those lines is highlighted end to end. Short horizontal swipes are unaffected and still cover exactly what you painted.

### Changed

- **Finishing a highlighter stroke opens nothing.** The default result of a stroke is a plain highlight; the note box appears when you click the highlight. (1.0.9 opened it automatically — that was one step too eager.)
- `Escape` right after a stroke undoes it: a new highlight is removed, while a merged stroke is rolled back out of the existing highlight without touching the rest of it.

## 1.0.9

### Added

- **Highlights take a note.** Finishing a highlighter stroke opens a small note box instead of the AI composer: type a line, then ⌘/Ctrl + Enter to save. The note lives with the highlight (`- 备注：…` in the annotation file), shows up in the annotation index and the sidebar, and comes back when you click the highlight. **Ask AI instead** switches that same panel into the question composer, so nothing is lost.

### Changed

- **The highlighter covers exactly what you painted.** The band spans the left and right end of your stroke (clamped to the text it touched) instead of snapping to the whole line — swiping across the middle of a sentence highlights just that stretch.
- **While you drag, you see your own stroke**: a translucent marker line at the text's height, which only turns into the clean band when you release.
- The page status line no longer promises “Esc to undo” on a fresh highlight: with the note box open, Esc means cancel (untouched highlights are still removed by it).

### Fixed

- The note box's save confirmation had nowhere to appear — the status element only existed in the question composer.

## 1.0.8

### Changed

- **The pointer tells you which mode you are in.** Region mode keeps the crosshair; highlighter mode uses a marker cursor (with a text-cursor fallback where custom cursors are unavailable), so you can see which tool is live before you press the button.
- **The active annotation mode is now clearly marked on the toolbar**: the selected button gets an accent background and outline, instead of relying on a slightly different icon shade. Screen readers get `aria-pressed` as well.

## 1.0.7

### Changed

- **The highlighter only highlights.** Finishing a stroke no longer opens the ask panel or jumps to the sidebar - the stroke snaps to the line and stops there, because the point of a highlighter is the mark itself. To ask about a passage you highlighted, click it: the panel opens the same way it does for any existing annotation.
- Pressing `Escape` within a few seconds of a stroke undoes that highlight, which keeps a mis-aimed stroke from having to be deleted through the panel.
- Region mode is unchanged: drag a box and the panel opens right away.

## 1.0.6

### Added

- **Highlighter annotations in PDFs.** Drag a free-hand stroke across text and it snaps to the lines underneath: the wobble is thrown away and you get a clean band hugging each line, spanning from the first character the stroke touched to the last. A stroke across several lines yields one band per line, and the text of every covered line is stored with the annotation, so the model reads what you meant.
- The PDF toolbar now has two mutually exclusive annotation modes - **Highlighter** and **Region** - and the choice is remembered between sessions. Both can be used on the same content: a box plus strokes on one annotation render as a band for the text and a thin outline for the area, so they never fight visually.
- Where you are in the document is now drawn on the page: the annotation you are reading keeps its full strength and gets a "Page N - Highlighter" (or "Region") tag, while the other annotations on that page fade to 15%.
- **PDFs remember where you stopped reading.** The page you are on is recorded as you scroll (per file, and only written to disk when it settles), so closing the tab or the app and coming back resumes at that page instead of page 1. The list is capped at the 200 most recently read files.

### Fixed

- **An annotation could be deleted by the act of reading it.** Closing a panel because a new one was taking over was treated as a cancel, so clicking a highlight you had just drawn removed it. Only an explicit cancel (the x button or Esc) undoes an annotation that was never asked about.
- The active-annotation state vanished as soon as it was set: the outgoing panel's callback cleared the view's current annotation id after the new panel had already claimed it.
- Rotated PDF pages are converted through the page's rotation instead of assuming it is upright, which had put annotations in the wrong place.
- Multi-line hit text was truncated to its first line when written to disk. The full text is kept in its own section, with the one-line bullet kept as a preview.
- A stroke drawn over an image or blank space no longer creates an empty annotation: it says so and leaves the page alone.

### Changed

- On the last page of a document the page counter now reads the last page when you scroll to the end. Before, the final page could never reach the top of the viewport (there is nothing below it to scroll), so scrolling to the end reported the second-to-last page — and that wrong number was what a remembered reading position was based on.
- The browser `fetch` call now lives in a single documented helper. It cannot be removed: Obsidian's `requestUrl` is issued from the main process and cannot see a streaming response body, so real streaming (and the "endpoint rejects the thinking parameter, so retry without it" logic) needs `fetch`; the `/models` probe also keeps a `fetch` fallback for relay endpoints that only answer browser-origin requests. Every request that does not need streaming still goes through `requestUrl` first.
- Highlighter annotations do not store a region screenshot - the text is enough, and it keeps the vault small. Region annotations still do.
- The annotation index, the sidebar and the anchor autocomplete now say which shape an annotation is ("Page 12 - Highlighter", "Page 12 - Region", "Page 12 - Region + strokes") instead of always saying "Region".

## 1.0.5

### Fixed

- The empty-folder cleanup shipped in 1.0.4 never actually ran. Obsidian's `adapter.rmdir` follows `fs.rm` semantics: passing `recursive: false` for a directory throws `EISDIR (is a directory)` even when the folder is empty, and the cleanup swallowed that error. Deleting or cancelling an annotation now really does remove the leftover `_assets/<document>.md/` folder.

### Changed

- The smoke-test stub for `adapter.rmdir` now mirrors the real behaviour (it throws unless `recursive` is set), so this class of stub-vs-reality mismatch fails the build instead of shipping.

## 1.0.4

### Fixed

- Deleting or cancelling a PDF annotation no longer leaves an empty `_assets/<document>.md/` folder behind. When the last region screenshot of a document goes away, the empty folder is removed with it; a folder that still holds screenshots is left untouched.

### Changed

- The generated `src/generated/pdfAssets.ts` is now committed to the repository. The automated plugin review runs its static analysis before any build step, and an import it cannot resolve degrades to `any` — which surfaced as ten spurious `unsafe-*` findings against the pdf.js resource lookups. Regeneration is deterministic and CI fails if it drifts from `pdfjs-dist`.
- The gzip header written by the asset packer no longer carries the platform byte, so the same source produces the same `main.js` on macOS and on Linux. Release artifacts are now byte-identical to a local build.

## 1.0.3

### Changed

- The inlined pdf.js resources (CMap tables and standard fonts) are now packed as one gzip stream per group instead of one base64 blob per file. `main.js` drops from **4.5 MB to 3.8 MB** (`-16%`), so installing and updating from the community plugin browser downloads less and is less likely to be cut off on a slow or unstable connection. Nothing about PDF rendering changes: the same 168 CMap tables and 16 standard fonts ship inside the file, and they are decompressed once, lazily, the first time a PDF actually needs them.

### Added

- A test that decompresses the packed resources and compares the result **byte for byte** with the original `pdfjs-dist` files, so a packing mistake cannot slip through silently.

## 1.0.2

### Fixed

- The ask panel no longer preselects the first template in the list. Opening it and typing your own question used to run that question through the translation template, and the annotation was recorded as `template: 翻译` even though no template was chosen. "Ask directly" is now the default, as the dropdown implies.
- The template dropdown is still there and still remembers your pick for the current panel; nothing else about templates changed.

## 1.0.1

Addresses the automatic review report. The review's own linter now reports **0 errors** for this plugin.

### Compatibility

- `minAppVersion` raised from `1.6.0` to **`1.7.2`**. The plugin calls `Workspace.revealLeaf`, which returns a promise from Obsidian 1.7.2 onward, so the declared minimum now matches what the code actually uses. Nothing changes for anyone on 1.7.2 or newer.

### Consistency with the plugin guidelines

- Closed the in-page ask panel's own component instead of borrowing the plugin instance as a component, so rendered answers are released when the panel closes.
- Replaced a direct `element.style` write with a CSS class.
- Use `Vault#configDir` instead of a hardcoded `.obsidian` path.
- Use `FileManager.trashFile()` so deleting an annotation respects your own "deleted files" preference.
- Use Obsidian's `createEl` / `createSpan` helpers instead of `document.createElement`.
- Use `window.setTimeout` / `window.clearTimeout` so timers keep working in popout windows.
- Declared `@codemirror/state` and `@codemirror/view` as direct dependencies.
- Removed a full-width space, an unnecessary regex escape, two unnecessary type assertions and two deprecated slider calls.
- Fixed two placeholders/labels to sentence case.

### Known, deliberate deviations

- The chat request still uses the browser `fetch` when streaming is on: Obsidian's `requestUrl` cannot stream a response body, and streaming is what keeps long answers from appearing all at once at the end. `requestUrl` remains the fallback channel, and the model list tries it first.
- The settings tab still uses the classic (`display()`) API instead of the declarative one: `getSettingDefinitions()` requires Obsidian 1.13, and adopting it would raise `minAppVersion` to 1.13.0 and cut off everyone on older versions.

## 1.0.0

First release.

- Ask about, or annotate, text selected in a note, or a region framed in a PDF — without leaving the page.
- Annotations live in their own Markdown files; the original document is never modified.
- Reverse navigation: in-place marks, an annotation index sidebar, and back links from the annotation file to the source document.
- Built-in pdf.js viewer: continuous scrolling, outline, region select, region screenshot and text extraction, multimodal questions.
- Bring your own OpenAI-compatible endpoint; streaming, deep-thinking (`reasoning_content`) and a local Markdown template library.
