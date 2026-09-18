# -*- coding: utf-8 -*-
"""One-shot migration helper for database i18n. Run from repo root."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def patch_file(rel: str, replacements: list[tuple[str, str]], inserts: list[tuple[str, str]] | None = None):
    path = ROOT / rel
    text = path.read_text(encoding="utf-8")
    if inserts:
        for old, new in inserts:
            if old not in text:
                print(f"  INSERT MISS in {rel}: {old[:60]!r}")
            elif new.split("\n")[0] in text and old not in new:
                # already done-ish
                if new not in text:
                    text = text.replace(old, new, 1)
                    print(f"  INSERT OK {rel}")
                else:
                    print(f"  INSERT SKIP {rel}")
            else:
                text = text.replace(old, new, 1)
                print(f"  INSERT OK {rel}")
    for old, new in replacements:
        count = text.count(old)
        if count == 0:
            print(f"  MISS in {rel}: {old[:70]!r}")
        else:
            text = text.replace(old, new)
            print(f"  OK x{count} {rel}: {old[:40]!r}")
    path.write_text(text, encoding="utf-8")


def main():
    # DatabaseView.vue
    patch_file(
        "src/views/DatabaseView.vue",
        [
            (
                "{{ session ? engineLabel(session.engine || 'mysql') : '数据库' }}",
                "{{ session ? engineLabel(session.engine || 'mysql') : t('database.title') }}",
            ),
            (
                '<span v-else class="bk-top-meta">数据库导航</span>',
                '<span v-else class="bk-top-meta">{{ t(\'database.navTitle\') }}</span>',
            ),
            (
                '<AppIcon name="plus" :size="14" /> 新建查询',
                '<AppIcon name="plus" :size="14" /> {{ t(\'database.newQuery\') }}',
            ),
            ("            刷新\n", "            {{ t('database.refresh') }}\n"),
            (
                ':title="`仅断开当前连接「${session.connectionName}」`"',
                ':title="t(\'database.disconnectCurrentTitle\', { name: session.connectionName })"',
            ),
            ("            断开当前\n", "            {{ t('database.disconnectCurrent') }}\n"),
            (
                '<p class="welcome-title">展开左侧连接</p>',
                '<p class="welcome-title">{{ t(\'database.welcomeTitle\') }}</p>',
            ),
            (
                '<p class="welcome-desc">点击连接旁的箭头或连接名，连接并浏览库表（类似 DBeaver）</p>',
                '<p class="welcome-desc">{{ t(\'database.welcomeDesc\') }}</p>',
            ),
            (
                '<button type="button" class="ui-btn ui-btn-primary" @click="openCreate">新建连接</button>',
                '<button type="button" class="ui-btn ui-btn-primary" @click="openCreate">{{ t(\'database.newConnection\') }}</button>',
            ),
            (
                "{{ tab.kind === 'query' ? '查' : '表' }}",
                "{{ tab.kind === 'query' ? t('database.tabQuery') : t('database.tabTable') }}",
            ),
            ('title="新建查询"', ':title="t(\'database.newQuery\')"'),
            (
                "              双击左侧表查看数据，或新建查询\n",
                "              {{ t('database.emptyTabs') }}\n",
            ),
        ],
        inserts=[
            (
                "import { useDbWorkspace } from '../composables/database/useDbWorkspace'\n\nconst {",
                "import { useI18n } from 'vue-i18n'\nimport { useDbWorkspace } from '../composables/database/useDbWorkspace'\n\nconst { t } = useI18n()\n\nconst {",
            ),
        ],
    )

    # DbNavTree
    patch_file(
        "src/components/database/DbNavTree.vue",
        [
            ("      <span>数据库</span>", "      <span>{{ t('database.nav.title') }}</span>"),
            ('title="导入连接"', ':title="t(\'database.nav.import\')"'),
            ('title="导出连接"', ':title="t(\'database.nav.export\')"'),
            ('title="新建连接"', ':title="t(\'database.nav.create\')"'),
            (
                'placeholder="筛选连接 / 库 / 表…"',
                ':placeholder="t(\'database.nav.filterPlaceholder\')"',
            ),
            ('class="nav-muted">加载中…</div>', 'class="nav-muted">{{ t(\'database.nav.loading\') }}</div>'),
            ("无匹配项", "{{ t('database.nav.noMatch') }}"),
            ("还没有连接", "{{ t('database.nav.empty') }}"),
            (
                '            新建连接\n',
                "            {{ t('database.nav.create') }}\n",
            ),
            (
                ":title=\"`${conn.host}:${conn.port}${conn.sshConnectionId ? ' · SSH 隧道' : ''}`\"",
                ":title=\"`${conn.host}:${conn.port}${conn.sshConnectionId ? t('database.nav.sshTunnelSuffix') : ''}`\"",
            ),
            ('title="SSH 隧道"', ':title="t(\'database.nav.sshTunnel\')"'),
            ('title="已连接"', ':title="t(\'database.nav.connected\')"'),
            ('title="连接中…"', ':title="t(\'database.nav.connecting\')"'),
            ('title="编辑"', ':title="t(\'database.nav.edit\')"'),
            ('title="删除"', ':title="t(\'database.nav.delete\')"'),
            ("暂无库或加载中…", "{{ t('database.nav.noDatabases') }}"),
            ('title="加载中…"', ':title="t(\'database.nav.loading\')"'),
            ("                暂无表\n", "                {{ t('database.nav.noTables') }}\n"),
            ("                重新加载表\n", "                {{ t('database.nav.reloadTables') }}\n"),
            ("          连接中…\n", "          {{ t('database.nav.connecting') }}\n"),
        ],
        inserts=[
            (
                "import { computed, ref } from 'vue'\n",
                "import { computed, ref } from 'vue'\nimport { useI18n } from 'vue-i18n'\n",
            ),
            (
                "const props = defineProps<{",
                "const { t } = useI18n()\n\nconst props = defineProps<{",
            ),
        ],
    )

    # DbNavContextMenu
    patch_file(
        "src/components/database/DbNavContextMenu.vue",
        [
            (
                "{{ isConnActive(menu.conn.id) ? '重新连接' : '连接并展开' }}",
                "{{ isConnActive(menu.conn.id) ? t('database.menu.reconnect') : t('database.menu.connectExpand') }}",
            ),
            (">断开此连接</button>", ">{{ t('database.menu.disconnect') }}</button>"),
            (">新建查询</button>", ">{{ t('database.menu.newQuery') }}</button>"),
            (">刷新数据库列表</button>", ">{{ t('database.menu.refreshDatabases') }}</button>"),
            (">复制主机地址</button>", ">{{ t('database.menu.copyHost') }}</button>"),
            (">编辑连接</button>", ">{{ t('database.menu.editConnection') }}</button>"),
            (">删除连接</button>", ">{{ t('database.menu.deleteConnection') }}</button>"),
            (
                'class="ctx-primary" @click="emit(\'dbNewQuery\')">新建查询</button>',
                'class="ctx-primary" @click="emit(\'dbNewQuery\')">{{ t(\'database.menu.newQuery\') }}</button>',
            ),
            (
                '将使用库「{{ menu.database }}」',
                "{{ t('database.menu.useDatabaseHint', { database: menu.database }) }}",
            ),
            (">展开 / 刷新表</button>", ">{{ t('database.menu.expandRefreshTables') }}</button>"),
            (">刷新表列表</button>", ">{{ t('database.menu.refreshTables') }}</button>"),
            (">生成 USE 语句</button>", ">{{ t('database.menu.generateUse') }}</button>"),
            (">复制库名</button>", ">{{ t('database.menu.copyDbName') }}</button>"),
            (">查看数据</button>", ">{{ t('database.menu.viewData') }}</button>"),
            (">查看结构</button>", ">{{ t('database.menu.viewStructure') }}</button>"),
            (">复制表名</button>", ">{{ t('database.menu.copyTableName') }}</button>"),
            (">复制 库.表</button>", ">{{ t('database.menu.copyQualified') }}</button>"),
            (">复制 SELECT SQL</button>", ">{{ t('database.menu.copySelect') }}</button>"),
        ],
        inserts=[
            (
                "import type { NavMenu } from './types'\n\ndefineProps<{",
                "import { useI18n } from 'vue-i18n'\nimport type { NavMenu } from './types'\n\nconst { t } = useI18n()\n\ndefineProps<{",
            ),
        ],
    )

    # DbTableWorkspace
    patch_file(
        "src/components/database/DbTableWorkspace.vue",
        [
            ("        数据\n", "        {{ t('database.data.panelData') }}\n"),
            ("        结构\n", "        {{ t('database.data.panelStructure') }}\n"),
        ],
        inserts=[
            (
                "import { computed } from 'vue'\n",
                "import { computed } from 'vue'\nimport { useI18n } from 'vue-i18n'\n",
            ),
            (
                "const props = defineProps<{",
                "const { t } = useI18n()\n\nconst props = defineProps<{",
            ),
        ],
    )

    # DbStructureTab
    patch_file(
        "src/components/database/DbStructureTab.vue",
        [
            ('<span class="tag">结构</span>', '<span class="tag">{{ t(\'database.structure.tag\') }}</span>'),
            (
                '<span class="tag">字段 / 索引 / DDL</span>',
                '<span class="tag">{{ t(\'database.structure.tagDetail\') }}</span>',
            ),
            (
                "@click=\"emit('refresh')\">刷新</button>",
                "@click=\"emit('refresh')\">{{ t('database.structure.refresh') }}</button>",
            ),
            ('class="grid-empty">加载中…</div>', 'class="grid-empty">{{ t(\'database.structure.loading\') }}</div>'),
            ("        <h4>字段</h4>", "        <h4>{{ t('database.structure.columns') }}</h4>"),
            ("                <th>字段名</th>", "                <th>{{ t('database.structure.colName') }}</th>"),
            ("                <th>类型</th>", "                <th>{{ t('database.structure.colType') }}</th>"),
            ("                <th>可空</th>", "                <th>{{ t('database.structure.colNullable') }}</th>"),
            ("                <th>键</th>", "                <th>{{ t('database.structure.colKey') }}</th>"),
            ("                <th>默认值</th>", "                <th>{{ t('database.structure.colDefault') }}</th>"),
            ("                <th>额外</th>", "                <th>{{ t('database.structure.colExtra') }}</th>"),
            ("                <th>注释</th>", "                <th>{{ t('database.structure.colComment') }}</th>"),
            ("        <h4>索引 / 约束</h4>", "        <h4>{{ t('database.structure.indexes') }}</h4>"),
            (
                'class="grid-empty small">无索引信息</div>',
                'class="grid-empty small">{{ t(\'database.structure.noIndexes\') }}</div>',
            ),
            ("                <th>名称</th>", "                <th>{{ t('database.structure.idxName') }}</th>"),
            ("                <th>列</th>", "                <th>{{ t('database.structure.idxColumns') }}</th>"),
            # second type/unique/primary/comment for indexes - already partially replaced for columns
            ("                <th>唯一</th>", "                <th>{{ t('database.structure.idxUnique') }}</th>"),
            ("                <th>主键</th>", "                <th>{{ t('database.structure.idxPrimary') }}</th>"),
            ("        <h4>建表语句</h4>", "        <h4>{{ t('database.structure.createSql') }}</h4>"),
        ],
        inserts=[
            (
                "import type { StructureTab } from './types'\n",
                "import { useI18n } from 'vue-i18n'\nimport type { StructureTab } from './types'\n",
            ),
            (
                "withDefaults(\n  defineProps<{",
                "const { t } = useI18n()\n\nwithDefaults(\n  defineProps<{",
            ),
        ],
    )

    # DbResultGrid
    patch_file(
        "src/components/database/DbResultGrid.vue",
        [
            ("emptyText: '无返回行',", "emptyText: undefined,"),
            (
                ":title=\"formatCell(cellValue(row, col)) + (copyable ? '（双击复制）' : '')\"",
                ":title=\"formatCell(cellValue(row, col)) + (copyable ? t('database.grid.dblClickCopy') : '')\"",
            ),
            (
                "{{ filterActive ? '无匹配行' : emptyText }}",
                "{{ filterActive ? t('database.grid.noMatch') : (emptyText ?? t('database.grid.emptyRows')) }}",
            ),
        ],
        inserts=[
            (
                "import type { GridSort } from './types'\n",
                "import { useI18n } from 'vue-i18n'\nimport type { GridSort } from './types'\n",
            ),
            (
                "const props = withDefaults(",
                "const { t } = useI18n()\n\nconst props = withDefaults(",
            ),
        ],
    )

    print("batch1 done")


if __name__ == "__main__":
    main()
