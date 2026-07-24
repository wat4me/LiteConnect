<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { CustomColors, TerminalPaletteId, Theme } from '../composables/useTheme'
import { getTerminalColors } from '../composables/useTheme'

const props = defineProps<{
  theme: Theme
  customColors: CustomColors
  palette: TerminalPaletteId
  fontSize: number
  fontFamily: string
}>()

const containerRef = ref<HTMLElement | null>(null)
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null

const SAMPLE = [
  '\x1b[32muser@host\x1b[0m:\x1b[34m~/proj\x1b[0m$ ls -la',
  '\x1b[36mdrwxr-xr-x\x1b[0m  5 user staff  160 Jul  9 10:00 src',
  '\x1b[33m-rw-r--r--\x1b[0m  1 user staff 1204 Jul  9 10:00 README.md',
  '\x1b[32muser@host\x1b[0m:\x1b[34m~/proj\x1b[0m$ ',
].join('\r\n')

function writeSample() {
  if (!terminal) return
  terminal.reset()
  terminal.write(SAMPLE)
}

function applyOptions() {
  if (!terminal) return
  terminal.options.fontSize = props.fontSize
  terminal.options.fontFamily = props.fontFamily
  terminal.options.theme = getTerminalColors(props.theme, props.customColors, props.palette)
  requestAnimationFrame(() => {
    fitAddon?.fit()
    writeSample()
  })
}

onMounted(() => {
  if (!containerRef.value) return

  terminal = new Terminal({
    cursorBlink: true,
    disableStdin: true,
    fontSize: props.fontSize,
    fontFamily: props.fontFamily,
    theme: getTerminalColors(props.theme, props.customColors, props.palette),
    scrollback: 20,
    convertEol: true,
    allowTransparency: false,
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(containerRef.value)
  fitAddon.fit()
  writeSample()

  resizeObserver = new ResizeObserver(() => {
    fitAddon?.fit()
  })
  resizeObserver.observe(containerRef.value)
})

watch(
  () => [props.theme, props.customColors.bgColor, props.customColors.fontColor, props.palette, props.fontSize, props.fontFamily] as const,
  () => applyOptions(),
)

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  terminal?.dispose()
  terminal = null
  fitAddon = null
})
</script>

<template>
  <div class="terminal-preview-wrap">
    <div ref="containerRef" class="terminal-preview-xterm" />
  </div>
</template>

<style scoped>
.terminal-preview-wrap {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.25);
  min-height: 200px;
  height: 220px;
  background: #0d1117;
}

.terminal-preview-xterm {
  width: 100%;
  height: 100%;
  padding: 8px 10px 4px;
  box-sizing: border-box;
}

.terminal-preview-xterm :deep(.xterm) {
  height: 100%;
}

.terminal-preview-xterm :deep(.xterm-viewport) {
  overflow-y: hidden !important;
}
</style>
