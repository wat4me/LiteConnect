<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  listInstalledFontFamilyPresets,
  pickInstalledFontFamily,
} from '@/composables/app/useTheme'
import { DB_PAGE_SIZE_OPTIONS } from '@/utils/database/dbSettingsDefaults'
import type { SettingsDraft } from '@/composables/settings/useSettingsDraft'
import {
  QUERY_MAX_ROWS_MAX,
  QUERY_MAX_ROWS_MIN,
  QUERY_TIMEOUT_SEC_MAX,
  QUERY_TIMEOUT_SEC_MIN,
  clampQueryMaxRows,
  clampQueryTimeoutSec,
  type QueryDefaultRunScopePref,
} from '@/utils/database/queryTabOptions'

const props = defineProps<{
  draft: SettingsDraft
  isDirty: boolean
}>()

const { t } = useI18n()

const availableFonts = ref(listInstalledFontFamilyPresets())

async function refreshAvailableFonts() {
  try {
    await document.fonts?.ready
  } catch {
    // ignore
  }
  availableFonts.value = listInstalledFontFamilyPresets()
  const next = pickInstalledFontFamily(props.draft.dbFontFamily)
  if (next !== props.draft.dbFontFamily) {
    props.draft.dbFontFamily = next
  }
}

onMounted(() => {
  void refreshAvailableFonts()
})

watch(
  () => props.draft.dbFontFamily,
  (v) => {
    if (!availableFonts.value.some((f) => f.value === v)) {
      props.draft.dbFontFamily = pickInstalledFontFamily(v)
    }
  },
)

const runScopeOptions: { value: QueryDefaultRunScopePref; labelKey: string }[] = [
  { value: 'smart', labelKey: 'settingsDatabase.runScopeSmart' },
  { value: 'selection', labelKey: 'settingsDatabase.runScopeSelection' },
  { value: 'statement', labelKey: 'settingsDatabase.runScopeStatement' },
  { value: 'all', labelKey: 'settingsDatabase.runScopeAll' },
]

function updateDbFontSize(delta: number) {
  const next = props.draft.dbFontSize + delta
  if (next < 10 || next > 24) return
  props.draft.dbFontSize = next
}

function onDefaultMaxRowsInput(ev: Event) {
  const raw = (ev.target as HTMLInputElement).value
  props.draft.dbDefaultMaxRows = clampQueryMaxRows(raw === '' ? NaN : Number(raw))
}

function onDefaultTimeoutSecInput(ev: Event) {
  const raw = (ev.target as HTMLInputElement).value
  props.draft.dbDefaultQueryTimeoutSec = clampQueryTimeoutSec(raw === '' ? NaN : Number(raw))
}
</script>

<template>
  <section class="settings-content" data-setting="database">
    <header class="content-header">
      <h3>{{ t('settingsDatabase.title') }}</h3>
      <p>{{ t('settingsDatabase.intro') }}</p>
    </header>

    <div class="content-grid">
      <div class="settings-card">
        <div class="settings-label" data-setting="database.fontFamily">{{ t('settingsDatabase.fontFamily') }}</div>
        <select v-model="draft.dbFontFamily" class="settings-select">
          <option v-for="item in availableFonts" :key="item.id" :value="item.value">
            {{ item.label }}
          </option>
        </select>

        <div class="settings-label" style="margin-top: 14px" data-setting="database.fontSize">{{ t('settingsDatabase.fontSize') }}</div>
        <div class="font-size-row">
          <button type="button" class="font-size-btn" @click="updateDbFontSize(-1)">−</button>
          <span class="font-size-value">{{ draft.dbFontSize }}px</span>
          <button type="button" class="font-size-btn" @click="updateDbFontSize(1)">+</button>
        </div>

        <div class="settings-label" style="margin-top: 14px" data-setting="database.pageSize">{{ t('settingsDatabase.pageSize') }}</div>
        <select v-model.number="draft.dbPageSize" class="settings-select">
          <option v-for="n in DB_PAGE_SIZE_OPTIONS" :key="n" :value="n">
            {{ t('settingsDatabase.rowsPerPage', { n }) }}
          </option>
        </select>
        <div class="settings-hint">{{ t('settingsDatabase.pageSizeHint') }}</div>

        <div class="settings-label" style="margin-top: 14px">{{ t('settingsDatabase.queryDefaults') }}</div>
        <div class="settings-label-sub" data-setting="database.defaultMaxRows">{{ t('settingsDatabase.defaultMaxRows') }}</div>
        <input
          type="number"
          class="settings-input"
          :min="QUERY_MAX_ROWS_MIN"
          :max="QUERY_MAX_ROWS_MAX"
          :value="draft.dbDefaultMaxRows"
          @change="onDefaultMaxRowsInput"
        />
        <div class="settings-hint">{{ t('settingsDatabase.defaultMaxRowsHint') }}</div>

        <div class="settings-label-sub" style="margin-top: 12px" data-setting="database.defaultTimeoutSec">{{ t('settingsDatabase.defaultTimeoutSec') }}</div>
        <input
          type="number"
          class="settings-input"
          :min="QUERY_TIMEOUT_SEC_MIN"
          :max="QUERY_TIMEOUT_SEC_MAX"
          :value="draft.dbDefaultQueryTimeoutSec"
          @change="onDefaultTimeoutSecInput"
        />
        <div class="settings-hint">{{ t('settingsDatabase.defaultTimeoutSecHint') }}</div>

        <div class="settings-label-sub" style="margin-top: 12px" data-setting="database.defaultRunScope">{{ t('settingsDatabase.defaultRunScope') }}</div>
        <select v-model="draft.dbDefaultRunScope" class="settings-select">
          <option v-for="opt in runScopeOptions" :key="opt.value" :value="opt.value">
            {{ t(opt.labelKey) }}
          </option>
        </select>
        <div class="settings-hint">{{ t('settingsDatabase.defaultRunScopeHint') }}</div>

        <div class="settings-label" style="margin-top: 14px" data-setting="database.confirmDangerousSql">{{ t('settingsDatabase.safety') }}</div>
        <label class="settings-check">
          <input v-model="draft.dbConfirmDangerousSql" type="checkbox" />
          {{ t('settingsDatabase.confirmDangerousSql') }}
        </label>
        <div class="settings-hint">{{ t('settingsDatabase.confirmDangerousSqlHint') }}</div>
      </div>

      <div class="preview-card">
        <div class="preview-label">
          {{ t('settingsDatabase.preview') }}
          <span v-if="isDirty" class="preview-badge">{{ t('settingsDatabase.draftBadge') }}</span>
        </div>
        <div
          class="db-preview"
          :style="{
            fontFamily: draft.dbFontFamily,
            fontSize: draft.dbFontSize + 'px',
          }"
        >
          <div class="db-preview-sql">
            <span class="db-kw">SELECT</span> id, name, created_at<br />
            <span class="db-kw">FROM</span> users<br />
            <span class="db-kw">WHERE</span> status = <span class="db-str">'active'</span><br />
            <span class="db-kw">LIMIT</span> {{ draft.dbPageSize }};<br />
            <span class="db-preview-sample">0O l1I | [] {} /* font */</span>
          </div>
          <div class="db-preview-grid">
            <div class="db-preview-row head">
              <span>id</span><span>name</span><span>created_at</span>
            </div>
            <div class="db-preview-row">
              <span>1</span><span>alice</span><span>2026-01-02</span>
            </div>
            <div class="db-preview-row">
              <span>2</span><span>bob</span><span>2026-03-15</span>
            </div>
          </div>
        </div>
        <div class="settings-hint" style="margin-top: 8px">
          {{ t('settingsDatabase.previewHint') }}
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.db-preview-sample {
  color: var(--text-secondary);
  opacity: 0.9;
}

.db-preview {
  border: 1px solid var(--border-color);
  border-radius: 10px;
  overflow: hidden;
  background: var(--bg-primary);
  color: var(--text-primary);
}

.db-preview-sql {
  padding: 12px 14px;
  line-height: 1.55;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  white-space: pre-wrap;
}

.db-kw {
  color: var(--accent);
  font-weight: 600;
}

.db-str {
  color: var(--success);
}

.db-preview-grid {
  display: flex;
  flex-direction: column;
}

.db-preview-row {
  display: grid;
  grid-template-columns: 48px 1fr 1fr;
  gap: 8px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--border-color);
  color: var(--text-primary);
}

.db-preview-row:last-child {
  border-bottom: none;
}

.db-preview-row.head {
  background: var(--bg-tertiary);
  color: var(--text-secondary);
  font-weight: 600;
}
</style>
