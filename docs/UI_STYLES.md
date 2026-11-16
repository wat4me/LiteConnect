# 界面基础样式

公共样式在 `src/styles/main.css`；常规设置的布局规则在 `src/styles/settings.css`，限定于 `.settings-page`。AI 设置与聊天组件保留各自的容器查询，适配 SSH 侧栏及独立 LiteAI 窗口。

## 文字与间距

| 用途 | 变量 | 默认值 |
| --- | --- | --- |
| 页面内容标题 | `--font-title` | 20px |
| 分组标题 | `--font-section` | 14px |
| 正文、表单标签 | `--font-ui` | 13px |
| 说明、紧凑控件 | `--font-ui-sm` | 12px |
| 时间、数量等元信息 | `--font-caption` | 11px |
| 控件行高 | `--line-ui` | 1.4 |
| 说明段落行高 | `--line-reading` | 1.6 |

`--space-1…5` 对应 4、8、12、16、24px。正文和重要状态不使用 10px 字号。字号、标准控件高度和图标随现有 `--ui-scale` 密度变量变化；终端、SQL 编辑器和文件列表保留各自的用户字号设置。

## 按钮

新功能的按钮一律使用下面的公共类。组件样式里只写布局（外边距、宽度、对齐、定位）和业务状态，不要重新声明边框、背景、圆角、高度、字号或悬停颜色。

### 三个级别

边框只出现在中间一级。按操作的重要程度选级别，不按位置或个人喜好选。

| 级别 | 类名 | 外观 | 用在哪里 |
| --- | --- | --- | --- |
| 主操作 | `ui-btn ui-btn-primary` | 强调色实心底，白字，无边框 | 一个区域最多一个：保存、连接、执行、发送、创建 |
| 次操作 | `ui-btn` | 中性描边，`--bg-primary` 底 | 表单、对话框、卡片里的取消、测试连接、全选、清空、导入 |
| 轻操作 | `ui-btn ui-btn-ghost` | 无边框，悬停出现浅底 | 面板标题栏、工具栏、列表行、"展开更多"等文字操作 |

危险操作是变体，不是新级别：可撤销的删除、断开用 `ui-btn ui-btn-danger`（红字描边）；需要确认的不可逆操作在确认对话框里用 `ui-btn ui-btn-danger-solid`。

### 图标按钮

- 一律使用 `ui-icon-btn`，**不带边框**，悬停出现 `--tab-hover-surface` 浅底。`ui-icon-btn-ghost` 是旧写法的兼容别名，新代码不需要写。
- 开关型按钮（面板已打开、筛选已生效）加 `.active` 或 `aria-pressed="true"`，显示中性的选中底色，不使用强调色。
- 关闭和删除图标加 `ui-icon-btn-close` 或 `ui-icon-btn-danger`，悬停时变红。
- 只有图标的按钮必须有 `aria-label` 和 `title`。

### 成组控件

步进器（`− 14 +`）和分段切换由 `ui-btn-group` 包住，组内按钮不带边框。数值放在 `ui-btn-group-value` 里。

- **步进器**：组上画一道描边，看起来像一个输入框。
- **分段切换**（标准／紧凑、列表／卡片）：组内按钮必须带 `.active` 或 `aria-pressed`。组会自动变成凹下去的浅灰底槽，选中项是浮起的白色（深色主题为浅灰）小块，文字加粗；未选中项用次要文字色。颜色来自 `--segment-track`、`--segment-selected`、`--segment-selected-shadow`，不要在组件里另写选中样式。

```html
<div class="ui-btn-group">
  <button class="ui-icon-btn ui-icon-btn-sm" aria-label="减小">−</button>
  <span class="ui-btn-group-value">14</span>
  <button class="ui-icon-btn ui-icon-btn-sm" aria-label="增大">+</button>
</div>
```

### 尺寸

| 场景 | 文字按钮 | 图标按钮 | 圆角 |
| --- | --- | --- | --- |
| 面板标题栏、工具栏、列表行 | `ui-btn-xs`（26px） | `ui-icon-btn-sm`（28px） | 6px |
| 面板内容、卡片 | `ui-btn-sm`（32px） | `ui-icon-btn`（32px） | 6–8px |
| 表单、对话框底部 | `ui-btn`（36px） | `ui-icon-btn`（32px） | 8px |

同一行的按钮使用同一尺寸。对话框底部按钮右对齐，主操作在最右侧，取消在它左边。

### 快速判断

1. 这是该区域最重要的那一个操作吗？是就用主操作。
2. 按钮在标题栏、工具栏或列表行里吗？是就用轻操作或图标按钮，不带边框。
3. 其余情况（表单、对话框、卡片里的普通操作）用次操作，带边框。

聊天发送、终端重连遮罩等有特殊形状的按钮可以保留自定义样式，但颜色仍按上面三个级别取值。

## 控件

- 输入框、下拉和多行输入分别使用 `ui-input`、`ui-select`、`ui-textarea`。默认高度 36px，`ui-input-sm` 高 32px。
- 表单标签用 `ui-form-field`，说明用 `ui-form-hint`。标签位于输入框上方，错误提示保留错误颜色与相应语义。
- 旧常规设置的 `settings-input` 和 `settings-select` 接入公共控件外观；逐步迁移时不要重新声明完整边框、字体和背景。

## 配色

深色主题使用暖中性色。浅色主题使用 [Radix Colors](https://www.radix-ui.com/docs/colors/palette-composition/composing-a-palette) 的 sand 灰阶，这是 Radix 为橙、棕色强调色推荐的配对灰：内容区 `#ffffff`，外框 step 2 `#f9f9f8`，浮起层 step 3 `#f1f0ef`，边框 step 5 `#e2e1de`，次要文字 step 11 `#63635e`，正文 step 12 `#21201c`。两个主题都只用一个陶土色强调色（深色 `#d97757`，浅色 `#c4623f`）。浅色不要再加米黄底色，以免和护眼主题混淆。

列表里每一行都会重复出现的元素（数量徽标、行内"连接"等操作）使用中性色，强调色只在悬停的那一行出现。列表卡片放在内容面上，用 `--bg-primary` 加描边，悬停时变为 `--bg-secondary`；不要在白底上再铺一层半透明灰。`--bg-secondary` 是外框（标题栏、模块栏、工具栏、停靠面板），`--bg-primary` 是内容面（终端、输入卡片、菜单），`--bg-tertiary` 是浮起层。

强调色只用于主操作按钮、焦点、拖放目标和需要注意的状态徽标。选中的模块、工具、标签页和列表行使用中性的 `--tab-selected-surface / -edge / -shadow`，悬停使用 `--tab-hover-surface`，不要再用 `--accent-bg` 表示"当前选中"。正常延迟等常态信息使用 `--text-secondary`，只有异常时才上色。

空状态标题使用 `--font-serif`；正文字体统一为 `--font-sans`。终端外边距由 `.terminal-wrapper` 提供，并用 xterm 当前背景色（`--terminal-bg`）填充。

## 主题与浮层

使用主题颜色变量；文件类型通过 `--file-folder/archive/image/code/database` 适配浅色、深色、护眼模式，文本与配置文件使用 `--text-secondary`。

公共菜单使用 `--shadow-menu`、`--radius-md` 和 `--menu-padding`；对话框使用 `--shadow-dialog` 和 `--radius-dialog`。普通对话框使用 `--z-dialog`，其弹出菜单使用 `--z-menu-backdrop`、`--z-menu`；模型选择等需覆盖菜单的独立模态层使用 `--z-dialog-blocking`。组件内部相对定位的提示与预览保留局部层级。

圆角优先使用 `--radius-sm/md/lg`（6/8/12px）。聊天气泡、圆形按钮、上下文进度圈等特殊形状不强制改为普通矩形。

## 文案

工具或任务的运行状态使用“执行中”，终止任务使用“停止任务／正在停止／已停止”。生成回复使用“停止生成”；关闭会话、断开连接与删除历史分别保留各自含义。无待保存修改时使用“无未保存更改”，保存成功后才提示“已保存”。
