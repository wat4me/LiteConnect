<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { CustomColors, TerminalPaletteId, Theme } from '@/composables/app/useTheme'
import { getTerminalColors, getTerminalMinimumContrastRatio } from '@/composables/app/useTheme'
import type { TerminalHighlightRule } from '@shared/terminalHighlight'
import { highlightTerminalText } from '@/utils/terminal/terminalHighlighter'

const props = defineProps<{
  theme: Theme
  customColors: CustomColors
  palette: TerminalPaletteId
  fontSize: number
  fontFamily: string
  highlightEnabled?: boolean
  highlightRules?: TerminalHighlightRule[]
}>()

const containerRef = ref<HTMLElement | null>(null)
let terminal: Terminal | null = null
let fitAddon: FitAddon | null = null
let resizeObserver: ResizeObserver | null = null
// The padded frame uses the same color as the xterm canvas, like the live terminal.
const previewBackground = computed(() => getTerminalColors(props.theme, props.customColors, props.palette).background)

// Glyphs that differ clearly across mono fonts (0O / l1I / brackets) + plain log lines for highlight preview.
const SAMPLE = [
  '\x1b[32muser@host\x1b[0m:\x1b[34m~/proj\x1b[0m$ ls -la',
  '\x1b[36mdrwxr-xr-x\x1b[0m  5 user staff  160 Jul  9 10:00 src',
  '  0O l1I | [] {} <> == !==  =>  /* font sample */',
  '10:01:02 WARN  slow query on 10.2.178.163:5432 (429)',
  '10:01:03 ERROR connection failed, fallback status: OK',
  '\x1b[32muser@host\x1b[0m:\x1b[34m~/proj\x1b[0m$ ',
].join('\r\n')

function writeSample() {
  if (!terminal) return
  terminal.reset()
  const rendered = props.highlightRules
    ? highlightTerminalText(SAMPLE, props.highlightRules, props.highlightEnabled !== false)
    : SAMPLE
  terminal.write(rendered)
}

function applyOptions() {
  if (!terminal) return
  terminal.options.fontSize = props.fontSize
  terminal.options.fontFamily = props.fontFamily
  terminal.options.theme = getTerminalColors(props.theme, props.customColors, props.palette)
  terminal.options.minimumContrastRatio = getTerminalMinimumContrastRatio(props.theme, props.customColors, props.palette)
  requestAnimationFrame(() => {
    fitAddon?.fit()
    writeSample()
  })
}

onMounted(() => {
  if (!containerRef.value) return

  terminal = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    cursorWidth: 2,
    cursorInactiveStyle: 'bar',
    disableStdin: true,
    fontSize: props.fontSize,
    fontFamily: props.fontFamily,
    theme: getTerminalColors(props.theme, props.customColors, props.palette),
    minimumContrastRatio: getTerminalMinimumContrastRatio(props.theme, props.customColors, props.palette),
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

watch(
  () => [props.highlightEnabled, props.highlightRules] as const,
  () => writeSample(),
  { deep: true },
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
  <div class="terminal-preview-wrap" :style="{ background: previewBackground }">
    <div ref="containerRef" class="terminal-preview-xterm" />
  </div>
</template>

<style scoped>
/*
 * Padding on the wrap (not the FitAddon host). Same reason as TerminalTab:
 * FitAddon ignores parent padding and would over-fit rows.
 */
.terminal-preview-wrap {
  border-radius: 10px;
  overflow: hidden;
  border: 1px solid rgba(128, 128, 128, 0.25);
  min-height: 200px;
  height: 220px;
  padding: 8px 10px 4px;
  box-sizing: border-box;
}

.terminal-preview-xterm {
  width: 100%;
  height: 100%;
  min-height: 0;
}

.terminal-preview-xterm :deep(.xterm) {
  height: 100%;
}

.terminal-preview-xterm :deep(.xterm-viewport) {
  overflow-y: hidden !important;
}
</style>
