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

## 后续图标

数据库、服务器、AI 等历史分支中已有 Lucide 来源注释；本次只规范上述第一批分支，其他图形保持现有实现。SQL 选中/当前语句/全部执行、查询计划、退出分屏及实心选中态暂保留定制图形。Docker 品牌标识单独维护。

后续导入官方图标时，补充此映射、固定源码版本并同步许可文件；避免仅按本地名称匹配上游名称，例如本地 `shield` 表达 shield-check、本地 `alert-circle` 实际绘制圆圈叉号。
