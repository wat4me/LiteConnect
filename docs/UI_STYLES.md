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

## 控件

- 按钮使用 `ui-btn`，紧凑操作使用 `ui-btn-sm`；主操作增加 `ui-btn-primary`。
- 图标按钮使用 `ui-icon-btn`（32px）或 `ui-icon-btn-sm`（28px）；组件只增加布局及业务状态样式。
- 输入框、下拉和多行输入分别使用 `ui-input`、`ui-select`、`ui-textarea`。默认高度 36px，`ui-input-sm` 高 32px。
- 表单标签用 `ui-form-field`，说明用 `ui-form-hint`。标签位于输入框上方，错误提示保留错误颜色与相应语义。
- 旧常规设置的 `settings-input` 和 `settings-select` 接入公共控件外观；逐步迁移时不要重新声明完整边框、字体和背景。

## 主题与浮层

使用主题颜色变量；文件类型通过 `--file-folder/archive/image/code/database` 适配浅色、深色、护眼模式，文本与配置文件使用 `--text-secondary`。

公共菜单使用 `--shadow-menu`、`--radius-md` 和 `--menu-padding`；对话框使用 `--shadow-dialog` 和 `--radius-dialog`。普通对话框使用 `--z-dialog`，其弹出菜单使用 `--z-menu-backdrop`、`--z-menu`；模型选择等需覆盖菜单的独立模态层使用 `--z-dialog-blocking`。组件内部相对定位的提示与预览保留局部层级。

圆角优先使用 `--radius-sm/md/lg`（6/8/12px）。聊天气泡、圆形按钮、上下文进度圈等特殊形状不强制改为普通矩形。

## 文案

工具或任务的运行状态使用“执行中”，终止任务使用“停止任务／正在停止／已停止”。生成回复使用“停止生成”；关闭会话、断开连接与删除历史分别保留各自含义。无待保存修改时使用“无未保存更改”，保存成功后才提示“已保存”。
