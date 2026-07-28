<script setup lang="ts">
import AppIcon from '../icons/AppIcon.vue'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatSize } from '../../utils/format'

const { t } = useI18n()

const props = defineProps<{
  visible: boolean
  sessionId: string
  remotePath: string
  fileName: string
  initialPermissions: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'refresh'): void
}>()

interface FileStat {
  mode: string
  size: number
  uid: number
  gid: number
  atime: number
  mtime: number
  owner: string
  group: string
}

const loading = ref(false)
const error = ref('')
const stat = ref<FileStat | null>(null)
const chmodMode = ref('')
const chownOwner = ref('')
const chownGroup = ref('')
const saving = ref(false)
const recursive = ref(false)
const isDirectory = ref(false)

watch(() => props.visible, async (val) => {
  if (val) {
    await loadStat()
  }
})

async function loadStat() {
  loading.value = true
  error.value = ''
  stat.value = null
  try {
    const result = await window.LiteConnect.sftpStat(props.sessionId, props.remotePath)
    stat.value = result
    chmodMode.value = result.mode
    chownOwner.value = result.owner
    chownGroup.value = result.group
    isDirectory.value = props.fileName.endsWith('/') || result.mode === '755' || result.mode === '777' || result.mode === '700'
    try {
      const typeResult = await window.LiteConnect.sshExec(props.sessionId, `stat -c '%F' "${props.remotePath}"`)
      isDirectory.value = typeResult.trim() === 'directory'
    } catch {}
  } catch (err: any) {
    error.value = err.message || t('sftp.propsGetFailed')
  } finally {
    loading.value = false
  }
}

async function applyChmod() {
  if (!chmodMode.value || chmodMode.value === stat.value?.mode) return
  saving.value = true
  error.value = ''
  try {
    await window.LiteConnect.sftpChmod(props.sessionId, props.remotePath, chmodMode.value, recursive.value)
    await loadStat()
    emit('refresh')
  } catch (err: any) {
    error.value = err.message || t('sftp.propsChmodFailed')
  } finally {
    saving.value = false
  }
}

async function applyChown() {
  if (!chownOwner.value) return
  saving.value = true
  error.value = ''
  try {
    await window.LiteConnect.sftpChown(props.sessionId, props.remotePath, chownOwner.value, chownGroup.value || undefined, recursive.value)
    await loadStat()
    emit('refresh')
  } catch (err: any) {
    error.value = err.message || t('sftp.propsChownFailed')
  } finally {
    saving.value = false
  }
}

function formatTime(ts: number): string {
  if (!ts) return '--'
  return new Date(ts * 1000).toLocaleString()
}

function getPermissionBits(mode: string): { r: boolean; w: boolean; x: boolean }[] {
  const bits: { r: boolean; w: boolean; x: boolean }[] = []
  const padded = mode.padStart(3, '0')
  for (let i = 0; i < 3; i++) {
    const n = parseInt(padded[i], 10)
    bits.push({ r: (n & 4) !== 0, w: (n & 2) !== 0, x: (n & 1) !== 0 })
  }
  return bits
}

function toggleBit(pos: number, bit: 'r' | 'w' | 'x') {
  const padded = chmodMode.value.padStart(3, '0')
  const chars = padded.split('')
  const bitMap = { r: 0, w: 1, x: 2 }
  const idx = pos * 3 + bitMap[bit]
  const current = chars[pos] || '0'
  let n = parseInt(current, 10)
  const mask = bit === 'r' ? 4 : bit === 'w' ? 2 : 1
  n = (n & mask) ? n & ~mask : n | mask
  chars[pos] = String(n)
  chmodMode.value = chars.join('')
}

const permRoleLabels = computed(() => [
  t('sftp.propsOwner'),
  t('sftp.propsGroup'),
  t('sftp.propsOthers'),
])

function bitLabel(bit: string): string {
  return bit === 'r' ? t('sftp.propsRead') : bit === 'w' ? t('sftp.propsWrite') : t('sftp.propsExec')
}
</script>

<template>
  <div v-if="visible" class="ui-modal-overlay" @click.self="emit('close')">
    <div class="ui-modal-card props-modal">
      <div class="props-header">
        <h3 class="props-title">{{ t('sftp.propsTitle') }}</h3>
        <button type="button" class="ui-modal-close" @click="emit('close')" :title="t('common.close')">
          <AppIcon name="close" size="sm" />
        </button>
      </div>

      <div class="props-body">
        <div class="props-file-info">
          <div class="props-file-name">{{ fileName }}</div>
          <div class="props-file-path">{{ remotePath }}</div>
        </div>

        <div v-if="error" class="props-error">{{ error }}</div>

        <div v-if="loading" class="props-loading">{{ t('sftp.loadingEllipsis') }}</div>

        <template v-else-if="stat">
          <div class="props-section">
            <div class="props-section-title">{{ t('sftp.propsBasic') }}</div>
            <div class="props-row">
              <span class="props-label">{{ t('sftp.propsSize') }}</span>
              <span class="props-value">{{ t('sftp.sizeWithBytes', { size: formatSize(stat.size), n: stat.size.toLocaleString() }) }}</span>
            </div>
            <div class="props-row">
              <span class="props-label">{{ t('sftp.propsMtime') }}</span>
              <span class="props-value">{{ formatTime(stat.mtime) }}</span>
            </div>
            <div class="props-row">
              <span class="props-label">{{ t('sftp.propsAtime') }}</span>
              <span class="props-value">{{ formatTime(stat.atime) }}</span>
            </div>
          </div>

          <div class="props-section">
            <div class="props-section-title">{{ t('sftp.propsPermissions') }}</div>
            <div class="props-row">
              <span class="props-label">{{ t('sftp.propsCurrentMode') }}</span>
              <span class="props-value props-mode">{{ stat.mode }}</span>
            </div>
            <div class="props-perm-grid">
              <div class="props-perm-header">
                <span></span>
                <span>{{ t('sftp.propsRead') }}</span>
                <span>{{ t('sftp.propsWrite') }}</span>
                <span>{{ t('sftp.propsExec') }}</span>
              </div>
              <div v-for="(label, pos) in permRoleLabels" :key="pos" class="props-perm-row">
                <span class="props-perm-label">{{ label }}</span>
                <template v-for="bit in ['r', 'w', 'x']" :key="bit">
                  <button
                    class="props-perm-cell"
                    :class="{ active: getPermissionBits(chmodMode)[pos][bit as 'r'|'w'|'x'] }"
                    @click="toggleBit(pos, bit as 'r'|'w'|'x')"
                    :title="`${label} ${bitLabel(bit)}`"
                  >
                    {{ getPermissionBits(chmodMode)[pos][bit as 'r'|'w'|'x'] ? bit : '-' }}
                  </button>
                </template>
              </div>
            </div>
            <div class="props-row">
              <span class="props-label">{{ t('sftp.propsOctal') }}</span>
              <input
                v-model="chmodMode"
                class="ui-input ui-input-sm ui-input-mono props-mode-input"
                maxlength="4"
                pattern="[0-7]{3,4}"
              />
              <button
                type="button"
                class="ui-btn ui-btn-xs ui-btn-primary"
                :disabled="saving || chmodMode === stat.mode"
                @click="applyChmod"
              >
                {{ t('sftp.propsApply') }}
              </button>
            </div>
            <div v-if="isDirectory" class="props-row props-recursive-row">
              <label class="props-recursive-label">
                <input type="checkbox" v-model="recursive" class="props-recursive-check" />
                <span>{{ t('sftp.propsRecursive') }}</span>
              </label>
            </div>
          </div>

          <div class="props-section">
            <div class="props-section-title">{{ t('sftp.propsOwner') }}</div>
            <div class="props-row">
              <span class="props-label">{{ t('sftp.propsUser') }}</span>
              <span class="props-value">{{ stat.owner }}</span>
            </div>
            <div class="props-row">
              <span class="props-label">{{ t('sftp.propsGroup') }}</span>
              <span class="props-value">{{ stat.group }}</span>
            </div>
            <div class="props-chown-row">
              <input
                v-model="chownOwner"
                class="ui-input ui-input-sm props-chown-input"
                :placeholder="t('sftp.propsOwner')"
              />
              <span class="props-chown-sep">:</span>
              <input
                v-model="chownGroup"
                class="ui-input ui-input-sm props-chown-input"
                :placeholder="t('sftp.propsGroup')"
              />
              <button
                type="button"
                class="ui-btn ui-btn-xs ui-btn-primary"
                :disabled="saving || !chownOwner || (chownOwner === stat.owner && chownGroup === stat.group)"
                @click="applyChown"
              >
                {{ t('sftp.propsApply') }}
              </button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.props-modal {
  width: 420px;
  max-width: calc(100vw - 48px);
  max-height: calc(100vh - 48px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  position: relative;
}

.props-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-color);
}

.props-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.props-body {
  padding: 16px 18px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.props-file-info {
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.props-file-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  word-break: break-all;
}

.props-file-path {
  font-size: 11px;
  color: var(--text-secondary);
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  margin-top: 4px;
  word-break: break-all;
}

.props-error {
  padding: 8px 12px;
  font-size: 12px;
  color: var(--danger);
  background: rgba(248, 81, 73, 0.1);
  border-radius: 6px;
}

.props-loading {
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 20px;
}

.props-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.props-section-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.props-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.props-label {
  width: 70px;
  flex-shrink: 0;
  font-size: 12px;
  color: var(--text-secondary);
}

.props-value {
  font-size: 12px;
  color: var(--text-primary);
  flex: 1;
  min-width: 0;
  word-break: break-all;
}

.props-mode {
  font-family: 'Cascadia Code', 'Fira Code', 'Consolas', monospace;
  font-weight: 600;
}

.props-perm-grid {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px;
  background: var(--bg-primary);
  border-radius: 8px;
}

.props-perm-header,
.props-perm-row {
  display: grid;
  grid-template-columns: 60px 1fr 1fr 1fr;
  gap: 4px;
  align-items: center;
}

.props-perm-header {
  font-size: 10px;
  color: var(--text-secondary);
  text-align: center;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border-color);
}

.props-perm-label {
  font-size: 11px;
  color: var(--text-secondary);
}

.props-perm-cell {
  height: 28px;
  border: 1px solid var(--border-color);
  border-radius: 4px;
  background: var(--bg-secondary);
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.props-perm-cell:hover {
  border-color: var(--accent);
}

.props-perm-cell.active {
  background: var(--accent-bg);
  border-color: var(--accent);
  color: var(--accent);
}

.props-mode-input {
  width: 72px;
  text-align: center;
}

.props-chown-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.props-chown-input {
  flex: 1;
  min-width: 0;
}

.props-chown-sep {
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 600;
}

.props-recursive-row {
  padding-top: 4px;
}

.props-recursive-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
}

.props-recursive-label:hover {
  color: var(--text-primary);
}

.props-recursive-check {
  accent-color: var(--accent);
  cursor: pointer;
}
</style>
