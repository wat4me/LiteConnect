<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/icons/AppIcon.vue'
import { WORKSPACE_TOOLS, type WorkspaceEdge, type WorkspaceTool } from '@shared/workspaceLayout'

const props = withDefaults(defineProps<{
  aiActive: boolean; filesActive: boolean; monitorActive: boolean; batchActive: boolean; snippetsActive: boolean
  monitorEnabled?: boolean; syncActive?: boolean; showAiUnread?: boolean; showAiApproval?: boolean
  backgroundTaskCount?: number; scheduledTaskCount?: number; activeTransfers?: number; dockerActive?: boolean; dockerDisabled?: boolean
  sidePanelsDisabled?: boolean
  edge?: WorkspaceEdge; toolIds?: WorkspaceTool[]; rearrange?: boolean; locked?: boolean
  dropMarker?: { id: WorkspaceTool; after: boolean }
}>(), { edge: 'left', toolIds: () => [...WORKSPACE_TOOLS], rearrange: false, locked: false })
const emit = defineEmits<{
  (e: 'toggle-ai'): void; (e: 'toggle-files'): void; (e: 'toggle-monitor'): void
  (e: 'toggle-batch'): void; (e: 'toggle-sync'): void; (e: 'toggle-snippets'): void; (e: 'toggle-docker'): void
  (e: 'tool-menu', id: WorkspaceTool | undefined, event: MouseEvent): void
  (e: 'tool-drag', id: WorkspaceTool, event: DragEvent): void; (e: 'tool-drag-end'): void
}>()
const { t } = useI18n()
const aiTaskSummary = computed(() => [
  props.backgroundTaskCount ? t('ai.backgroundTaskCount', { count: props.backgroundTaskCount }) : '',
  props.scheduledTaskCount ? t('ai.scheduledTaskCount', { count: props.scheduledTaskCount }) : '',
].filter(Boolean).join(' · '))
const definitions = computed(() => ({
  ai: { icon: 'ai-chat', active: props.aiActive, disabled: props.sidePanelsDisabled, label: aiTaskSummary.value || t('toolbar.ai'), tooltip: aiTaskSummary.value || t('toolbar.aiShortcut') },
  files: { icon: 'folder', active: props.filesActive, disabled: props.sidePanelsDisabled, label: props.activeTransfers ? t('toolbar.sftpAriaActive', { count: props.activeTransfers }) : t('toolbar.sftpAria'), tooltip: props.activeTransfers ? t('toolbar.sftpActive', { count: props.activeTransfers }) : t('toolbar.sftp') },
  monitor: { icon: 'monitor-activity', active: props.monitorActive, disabled: props.sidePanelsDisabled, label: t('toolbar.monitor'), tooltip: t('toolbar.monitorShortcut') },
  batch: { icon: 'batch-command', active: props.batchActive, disabled: props.sidePanelsDisabled, label: t('toolbar.batch'), tooltip: t('toolbar.batchShortcut') },
  sync: { icon: 'terminal-sync', active: props.syncActive, disabled: props.sidePanelsDisabled, label: t('terminal.syncTitle'), tooltip: t('terminal.syncTitle') },
  snippets: { icon: 'file-terminal', active: props.snippetsActive, disabled: props.sidePanelsDisabled, label: t('toolbar.snippets'), tooltip: t('toolbar.snippetsShortcut') },
  docker: { icon: 'docker', active: props.dockerActive, disabled: props.dockerDisabled, label: t('toolbar.docker'), tooltip: props.dockerDisabled ? t('toolbar.dockerDisabled') : props.dockerActive ? t('toolbar.dockerActive') : t('toolbar.dockerShortcut') },
} as const))
const tools = computed(() => props.toolIds.filter(id => id !== 'monitor' || props.monitorEnabled !== false).map(id => ({ id, ...definitions.value[id] })))
const tooltipPlacement = computed(() => props.edge === 'left' ? 'right' : 'left')
function toggle(id: WorkspaceTool) {
  switch (id) {
    case 'ai': emit('toggle-ai'); break
    case 'files': emit('toggle-files'); break
    case 'monitor': emit('toggle-monitor'); break
    case 'batch': emit('toggle-batch'); break
    case 'sync': emit('toggle-sync'); break
    case 'snippets': emit('toggle-snippets'); break
    case 'docker': emit('toggle-docker'); break
  }
}
function menu(id: WorkspaceTool | undefined, event: MouseEvent) {
  if (!props.rearrange) return
  event.preventDefault(); event.stopPropagation(); emit('tool-menu', id, event)
}
</script>

<template>
  <div class="left-toolbar" :class="`toolbar-${edge}`" role="toolbar" :aria-label="t('toolbar.aria')" aria-orientation="vertical" :data-dock-edge="edge" @contextmenu.self="menu(undefined, $event)">
    <template v-for="tool in tools" :key="tool.id">
      <div v-if="tool.id === 'docker' && tools.length > 1" class="toolbar-divider" role="separator" aria-hidden="true"></div>
      <el-tooltip :content="tool.tooltip" :placement="tooltipPlacement" :show-after="300">
        <button class="toolbar-icon-btn" type="button" :class="{ active: tool.active }" :aria-label="tool.label" :aria-pressed="!!tool.active" :disabled="!!tool.disabled" :data-tool-id="tool.id" :data-drop-marker="dropMarker?.id === tool.id ? dropMarker.after ? 'after' : 'before' : undefined"
          :draggable="rearrange && !locked" @click="toggle(tool.id)" @contextmenu="menu(tool.id, $event)" @keydown.shift.f10.prevent="menu(tool.id, $event as unknown as MouseEvent)"
          @dragstart="emit('tool-drag', tool.id, $event)" @dragend="emit('tool-drag-end')">
          <AppIcon :name="tool.icon" size="lg" />
          <span v-if="tool.id === 'ai' && backgroundTaskCount" class="ai-task-count-badge">{{ backgroundTaskCount }}</span>
          <span v-else-if="tool.id === 'ai' && scheduledTaskCount" class="ai-task-count-badge scheduled" :aria-label="t('ai.scheduledTaskCount', { count: scheduledTaskCount })">{{ scheduledTaskCount }}</span>
          <span v-if="tool.id === 'ai' && (showAiApproval || showAiUnread)" class="ai-reply-badge" :class="{ approval: showAiApproval }" :aria-label="showAiApproval ? t('toolbar.aiApproval') : t('toolbar.aiUnread')"></span>
          <span v-if="tool.id === 'files' && !filesActive && activeTransfers" class="transfer-count-badge" :aria-label="t('toolbar.transferring', { count: activeTransfers })">{{ activeTransfers > 99 ? '99+' : activeTransfers }}</span>
        </button>
      </el-tooltip>
    </template>
    <slot />
  </div>
</template>

<style scoped>
.left-toolbar {
  width: var(--left-toolbar-width, 40px);
  flex-shrink: 0;
  min-height: 0;
  overflow: auto;
  box-sizing: border-box;
  min-width: var(--left-toolbar-width, 40px);
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 8px;
  gap: 4px;
}

.toolbar-right { border-right: 0; border-left: 1px solid var(--border-color); }
.toolbar-icon-btn { flex-shrink: 0; }
.left-toolbar .app-icon:not([data-size]) {
  font-size: var(--icon-lg);
}

.toolbar-divider {
  width: 20px;
  height: 1px;
  margin: 4px 0;
  background: var(--border-color);
  flex-shrink: 0;
}

.toolbar-icon-btn {
  width: var(--icon-btn-md);
  height: var(--icon-btn-md);
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 6px;
  transition: background 0.15s, color 0.15s, opacity 0.15s;
  position: relative;
}

.toolbar-icon-btn:hover:not(:disabled) {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.toolbar-icon-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.toolbar-icon-btn.active {
  color: var(--accent);
  background: var(--accent-bg);
}

.toolbar-icon-btn[data-drop-marker]::before {
  content: '';
  position: absolute;
  z-index: 1;
  pointer-events: none;
  inset-inline: 3px;
  height: 2px;
  border-radius: 2px;
  background: var(--accent);
}
.toolbar-icon-btn[data-drop-marker='before']::before { top: -3px; }
.toolbar-icon-btn[data-drop-marker='after']::before { bottom: -3px; }

.toolbar-icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.ai-reply-badge {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--danger);
  box-shadow: 0 0 0 2px var(--bg-secondary);
  animation: ai-reply-pulse 1.6s ease-in-out infinite;
}

.ai-reply-badge.approval {
  background: var(--warning);
}

.ai-task-count-badge {
  position: absolute;
  bottom: 0;
  right: 0;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border: 1px solid var(--accent);
  border-radius: 7px;
  background: var(--bg-primary);
  color: var(--accent);
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  pointer-events: none;
}

/* Pending scheduled commands are not activity: a dashed, muted badge instead of the accent count. */
.ai-task-count-badge.scheduled {
  border-style: dashed;
  border-color: var(--text-secondary);
  color: var(--text-secondary);
}

.transfer-count-badge {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 14px;
  height: 14px;
  padding: 0 3px;
  border-radius: 7px;
  background: var(--accent);
  color: #fff;
  font-size: 9px;
  font-weight: 700;
  line-height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 0 0 1.5px var(--bg-secondary);
  font-variant-numeric: tabular-nums;
  pointer-events: none;
}

@keyframes ai-reply-pulse {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.7; transform: scale(0.92); }
}
</style>
