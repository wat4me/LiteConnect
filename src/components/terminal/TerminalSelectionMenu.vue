<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '../icons/AppIcon.vue'

defineProps<{
  visible: boolean
  x: number
  y: number
  selectedText: string
  readOnly: boolean
}>()

const emit = defineEmits<{
  (e: 'copy'): void
  (e: 'paste'): void
  (e: 'select-all'): void
  (e: 'clear-screen'): void
  (e: 'clear-scrollback'): void
  (e: 'toggle-read-only'): void
  (e: 'send-to-ai', mode: 'send' | 'insert'): void
  (e: 'save-as-snippet'): void
  (e: 'set-ref', el: HTMLElement | null): void
}>()

const { t } = useI18n()
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      class="ui-menu"
      :style="{ left: x + 'px', top: y + 'px' }"
      :ref="(el) => emit('set-ref', (el as HTMLElement | null) || null)"
      @click.stop
    >
      <button
        v-if="selectedText"
        class="ui-menu-item"
        @click="emit('copy')"
      >
        <AppIcon name="copy" size="sm" />
        <span>{{ t('terminal.copy') }}</span>
      </button>
      <button type="button" class="ui-menu-item" @click="emit('paste')">
        <AppIcon name="paste" size="sm" />
        <span>{{ t('terminal.paste') }}</span>
      </button>
      <button type="button" class="ui-menu-item" @click="emit('select-all')">
        <AppIcon name="select-all" size="sm" />
        <span>{{ t('terminal.selectAll') }}</span>
      </button>
      <button
        class="ui-menu-item"
        :title="t('terminal.clearScreenTitle')"
        @click="emit('clear-screen')"
      >
        <AppIcon name="clear" size="sm" />
        <span>{{ t('terminal.clearScreen') }}</span>
      </button>
      <button
        class="ui-menu-item"
        :title="t('terminal.clearScrollbackTitle')"
        @click="emit('clear-scrollback')"
      >
        <AppIcon name="delete" size="sm" />
        <span>{{ t('terminal.clearScrollback') }}</span>
      </button>
      <button
        class="ui-menu-item"
        :class="{ active: readOnly }"
        :title="t('terminal.readOnlyTitle')"
        @click="emit('toggle-read-only')"
      >
        <AppIcon :name="readOnly ? 'lock' : 'eye'" size="sm" />
        <span>{{ readOnly ? t('terminal.readOnlyOffMenu') : t('terminal.readOnlyOnMenu') }}</span>
      </button>
      <template v-if="selectedText">
        <div class="ui-menu-sep" role="separator"></div>
        <button type="button" class="ui-menu-item" @click="emit('send-to-ai', 'send')">
          <AppIcon name="send" size="sm" />
          <span>{{ t('terminal.sendToAi') }}</span>
        </button>
        <button type="button" class="ui-menu-item" @click="emit('send-to-ai', 'insert')">
          <AppIcon name="ai-chat" size="sm" />
          <span>{{ t('terminal.insertToAi') }}</span>
        </button>
        <button type="button" class="ui-menu-item" @click="emit('save-as-snippet')">
          <AppIcon name="file-text" size="sm" />
          <span>{{ t('terminal.saveAsSnippet') }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>
