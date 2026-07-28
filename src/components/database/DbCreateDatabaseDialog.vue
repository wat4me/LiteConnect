<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'

type Engine = 'mysql' | 'postgres' | 'oracle'

const props = defineProps<{
  visible: boolean
  creating: boolean
  engine: Engine
  connectionName: string
}>()

const emit = defineEmits<{
  close: []
  create: [input: { name: string; charset?: string; collate?: string; encoding?: string }]
}>()

const { t } = useI18n()

const name = ref('')
const charset = ref('')
const collate = ref('')
const encoding = ref('')

const MYSQL_CHARSETS = [
  'utf8mb4',
  'utf8mb3',
  'utf8',
  'latin1',
  'ascii',
  'binary',
  'gbk',
  'gb2312',
  'big5',
]

const MYSQL_COLLATES_BY_CHARSET: Record<string, string[]> = {
  utf8mb4: ['utf8mb4_general_ci', 'utf8mb4_unicode_ci', 'utf8mb4_0900_ai_ci', 'utf8mb4_bin'],
  utf8mb3: ['utf8mb3_general_ci', 'utf8mb3_unicode_ci', 'utf8mb3_bin'],
  utf8: ['utf8_general_ci', 'utf8_unicode_ci', 'utf8_bin'],
  latin1: ['latin1_swedish_ci', 'latin1_general_ci', 'latin1_bin'],
  ascii: ['ascii_general_ci', 'ascii_bin'],
  binary: ['binary'],
  gbk: ['gbk_chinese_ci', 'gbk_bin'],
  gb2312: ['gb2312_chinese_ci', 'gb2312_bin'],
  big5: ['big5_chinese_ci', 'big5_bin'],
}

const PG_ENCODINGS = ['UTF8', 'LATIN1', 'SQL_ASCII', 'EUC_CN', 'GBK']

const mysqlCollateOptions = computed(() => {
  if (!charset.value) return [] as string[]
  return MYSQL_COLLATES_BY_CHARSET[charset.value] || []
})

const canCreate = computed(
  () => props.engine !== 'oracle' && name.value.trim().length > 0 && !props.creating,
)

watch(
  () => props.visible,
  (v) => {
    if (v) {
      name.value = ''
      charset.value = ''
      collate.value = ''
      encoding.value = ''
    }
  },
)

watch(charset, () => {
  collate.value = ''
})

function submit() {
  if (!canCreate.value) return
  const trimmed = name.value.trim()
  if (props.engine === 'postgres') {
    emit('create', {
      name: trimmed,
      encoding: encoding.value || undefined,
    })
    return
  }
  emit('create', {
    name: trimmed,
    charset: charset.value || undefined,
    collate: collate.value || undefined,
  })
}

async function copyOracleSql() {
  const sql = t('database.msg.createDatabaseOracleSql')
  try {
    await navigator.clipboard.writeText(sql)
  } catch {
    // ignore
  }
}
</script>

<template>
  <div v-if="visible" class="ui-modal-overlay" @click.self="emit('close')">
    <div class="ui-modal-card cdb-dialog" role="dialog" aria-labelledby="cdb-dialog-title">
      <header class="cdb-head">
        <h3 id="cdb-dialog-title">
          {{
            engine === 'oracle'
              ? t('database.msg.createDatabaseTitleOracle')
              : t('database.msg.createDatabaseTitle')
          }}
        </h3>
        <button type="button" class="ui-modal-close" :aria-label="t('common.close')" @click="emit('close')">
          <AppIcon name="close" size="sm" />
        </button>
      </header>

      <form class="cdb-body" @submit.prevent="submit">
        <p class="cdb-hint">
          {{
            engine === 'oracle'
              ? t('database.msg.createDatabaseHintOracle', { name: connectionName })
              : t('database.msg.createDatabaseHint', { name: connectionName })
          }}
        </p>

        <template v-if="engine === 'oracle'">
          <pre class="cdb-sql">{{ t('database.msg.createDatabaseOracleSql') }}</pre>
        </template>
        <template v-else>
        <label class="cdb-field">
          <span class="cdb-label">{{ t('database.msg.createDatabaseNameLabel') }}</span>
          <input
            v-model="name"
            class="ui-input"
            type="text"
            :placeholder="t('database.msg.createDatabaseNamePlaceholder')"
            maxlength="128"
            autofocus
          />
        </label>

        <template v-if="engine === 'postgres'">
          <label class="cdb-field">
            <span class="cdb-label">{{ t('database.msg.createDatabaseEncodingLabel') }}</span>
            <select v-model="encoding" class="ui-input">
              <option value="">（默认）</option>
              <option v-for="enc in PG_ENCODINGS" :key="enc" :value="enc">{{ enc }}</option>
            </select>
          </label>
        </template>
        <template v-else>
          <label class="cdb-field">
            <span class="cdb-label">{{ t('database.msg.createDatabaseCharsetLabel') }}</span>
            <select v-model="charset" class="ui-input">
              <option value="">（默认）</option>
              <option v-for="cs in MYSQL_CHARSETS" :key="cs" :value="cs">{{ cs }}</option>
            </select>
          </label>
          <label class="cdb-field">
            <span class="cdb-label">{{ t('database.msg.createDatabaseCollateLabel') }}</span>
            <select v-model="collate" class="ui-input" :disabled="!charset">
              <option value="">（默认）</option>
              <option v-for="col in mysqlCollateOptions" :key="col" :value="col">{{ col }}</option>
            </select>
          </label>
        </template>
        </template>

        <footer class="cdb-foot">
          <button type="button" class="ui-btn" :disabled="creating" @click="emit('close')">
            {{ t('database.connection.cancel') }}
          </button>
          <button
            v-if="engine !== 'oracle'"
            type="submit"
            class="ui-btn ui-btn-primary"
            :disabled="!canCreate"
          >
            {{ creating ? t('database.msg.createDatabaseCreating') : t('database.connection.ok') }}
          </button>
          <template v-else>
            <button type="button" class="ui-btn" @click="copyOracleSql">
              {{ t('common.copy') }}
            </button>
            <button type="button" class="ui-btn ui-btn-primary" @click="emit('close')">
              {{ t('database.connection.ok') }}
            </button>
          </template>
        </footer>
      </form>
    </div>
  </div>
</template>

<style scoped>
.cdb-dialog {
  width: min(440px, calc(100vw - 32px));
  padding: 0;
  overflow: hidden;
}

.cdb-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-primary);
}

.cdb-head h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.cdb-body {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 16px;
}

.cdb-hint {
  margin: 0 0 4px;
  font-size: 12px;
  color: var(--text-secondary);
}

.cdb-sql {
  margin: 0;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary, var(--bg-primary));
  font-size: 11px;
  line-height: 1.45;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--text-primary);
  max-height: 180px;
  overflow: auto;
}

.cdb-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cdb-label {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.cdb-foot {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 4px;
}
</style>
