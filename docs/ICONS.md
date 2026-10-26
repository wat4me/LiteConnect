# 图标来源与按需复用

应用通过 `src/components/icons/AppIcon.vue` 统一渲染图标，保留现有名称、尺寸 token、主题颜色、描边变量和无障碍设置。

## 第一批 Lucide SVG

本批次导入 13 个官方 SVG，映射到 14 个现有图标名称（`delete` 与 `trash` 共用同一图形）。只复制 SVG 内部几何元素，没有增加图标库运行时依赖。

- 上游：[lucide-icons/lucide](https://github.com/lucide-icons/lucide)
- 固定源码提交：[`1ef60af944de207e0d5176905a0759ba12e6ee8d`](https://github.com/lucide-icons/lucide/tree/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons)
- 导入日期：2026-10-17
- 完整上游许可：[Lucide-LICENSE.txt](../public/third-party/Lucide-LICENSE.txt)，包含 ISC 许可和 Feather 衍生图标的 MIT 声明。
- `public/third-party/` 随 Vite 构建复制到 `dist/third-party/`；安装包的 `dist/**/*` 白名单包含该许可文件。

| AppIcon 名称 | 上游 SVG |
| --- | --- |
| `close` | [`x.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/x.svg) |
| `plus` | [`plus.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/plus.svg) |
| `minus` | [`minus.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/minus.svg) |
| `search` | [`search.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/search.svg) |
| `edit` | [`pencil.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/pencil.svg) |
| `delete` | [`trash.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/trash.svg) |
| `trash` | [`trash.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/trash.svg) |
| `copy` | [`copy.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/copy.svg) |
| `refresh` | [`rotate-cw.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/rotate-cw.svg) |
| `settings` | [`settings.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/settings.svg) |
| `chevron-right` | [`chevron-right.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/chevron-right.svg) |
| `chevron-down` | [`chevron-down.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/chevron-down.svg) |
| `chevron-up` | [`chevron-up.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/chevron-up.svg) |
| `chevron-left` | [`chevron-left.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/chevron-left.svg) |

每个替换分支保留上游名称注释。SVG 内部路径保持官方源码；外层继续使用应用的 24×24 viewBox、`currentColor`、尺寸 token 和 `--icon-stroke`（默认 1.8），以适配现有界面。

## 第二批：区分操作语义

导入日期：2026-10-19。沿用上面的固定源码提交和完整许可；按需复制 9 个官方 SVG，其中新增 7 个名称，替换 `clear` 与 `select-all` 的图形。

| AppIcon 名称 | 上游 SVG | 使用语义 |
| --- | --- | --- |
| `bell` | [`bell.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/bell.svg) | 通知入口与通知设置 |
| `calendar-clock` | [`calendar-clock.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/calendar-clock.svg) | 定时巡检 |
| `models` | [`boxes.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/boxes.svg) | 模型管理（首页、聊天空状态、设置分类） |
| `unplug` | [`unplug.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/unplug.svg) | 断开 SSH；关闭会话仍用 close |
| `broadcast` | [`radio-tower.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/radio-tower.svg) | 同步输入，将输入广播到多个终端 |
| `clear` | [`eraser.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/eraser.svg) | 清空终端或日志显示 |
| `select-all` | [`square-dashed.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/square-dashed.svg) | 全选文本；区别于首页和卡片视图 |
| `plug` | [`plug.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/plug.svg) | 连接服务器、AI 提供商接口 |
| `skip` | [`circle-slash.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/circle-slash.svg) | 传输已跳过；区别于清空 |

服务器实体保留 `server`。提供商连接测试使用已有 `circle-check`，与服务器连接测试一致。

## 第三批：只读、分屏、文件类型和后台任务

导入日期：2026-10-19。继续沿用同一固定源码提交及许可，新增 11 个名称，替换 `split-exit` 的图形。

| AppIcon 名称 | 上游 SVG | 使用语义 |
| --- | --- | --- |
| `lock-open` | [`lock-open.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/lock-open.svg) | 解除终端只读；开启只读仍使用 lock |
| `split-left` | [`panel-left.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/panel-left.svg) | 向左放置的分屏预览 |
| `split-right` | [`panel-right.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/panel-right.svg) | 向右放置的分屏预览 |
| `split-top` | [`panel-top.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/panel-top.svg) | 向上放置的分屏预览 |
| `split-bottom` | [`panel-bottom.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/panel-bottom.svg) | 向下放置的分屏预览 |
| `split-exit` | [`panel-top-close.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/panel-top-close.svg) | 退出上下分屏，保留两个终端 |
| `split-exit-v` | [`panel-left-close.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/panel-left-close.svg) | 退出左右分屏，保留两个终端 |
| `background-tasks` | [`list-todo.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/list-todo.svg) | 后台任务列表、结果卡和标签页运行提示 |
| `file-cog` | [`file-cog.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/file-cog.svg) | SFTP 配置文件 |
| `file-code` | [`file-code.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/file-code.svg) | SFTP 源代码文件 |
| `file-archive` | [`file-archive.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/file-archive.svg) | SFTP 压缩文件 |
| `file` | [`file.svg`](https://github.com/lucide-icons/lucide/blob/1ef60af944de207e0d5176905a0759ba12e6ee8d/icons/file.svg) | SFTP 其他文件 |

四个分屏预览在官方路径底层加了透明度 14% 的同色目标区域，以突出放置方向。退出分屏使用与当前布局方向匹配的收拢箭头，操作仍只恢复单窗显示，不关闭任何终端。

SFTP 的 `FileTypeIcon.vue` 保留文件类型判断、尺寸和颜色，统一委托 `AppIcon` 渲染；文件夹、链接、图片、文本和数据库复用已有图形，配置文件改用文件加齿轮。后台任务使用任务列表图形，任务状态、计时和结果提示沿用各自原有显示。

## 后续图标

数据库、服务器、AI 等历史分支中已有 Lucide 来源注释；本次只规范上述批次的分支，其他图形保持现有实现。SQL 选中/当前语句/全部执行、查询计划及实心选中态暂保留定制图形。Docker 品牌标识单独维护。

后续导入官方图标时，补充此映射、固定源码版本并同步许可文件；避免仅按本地名称匹配上游名称，例如本地 `shield` 表达 shield-check、本地 `alert-circle` 实际绘制圆圈叉号。

同步输入入口使用定制的 `terminal-sync`（两个叠放的终端窗口），沿用统一描边、24×24 viewBox 和尺寸 token，表达同一输入发送到多个终端。原有 `broadcast` 无线电塔图形保留用于广播语义。

下列定制图形同样使用统一的尺寸、描边和主题色，区分入口用途与操作结果：

| AppIcon 名称 | 图形 | 使用语义 |
| --- | --- | --- |
| `monitor-activity` | 屏幕内的监控曲线 | 服务器资源监控 |
| `batch-command` | 命令符号向两个目标分发 | 批量执行；区别于实时同步输入 |
| `terminal-history` | 终端与时钟 | 查看命令执行记录 |
| `file-terminal` | 带命令符号的文档 | 命令片段与保存为片段 |
| `connection-test` | 插头与检测波形 | 发起连接或接口测试；成功结果仍用对勾 |

取消批量执行使用已有的 `stop` 方块，保留“取消”文字，不再显示刷新动画。
