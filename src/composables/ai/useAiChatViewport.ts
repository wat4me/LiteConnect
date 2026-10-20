import { computed, nextTick, onActivated, onDeactivated, onScopeDispose, ref, watch } from 'vue'
import type { ChatItem } from '@/domain/ai/chat'
import { activeTimelineTurnId, collectChatTimelineTurns, overviewChatTimelineTurns } from '@/utils/ai/chatTimeline'

/** Owns viewport position and timeline navigation, independently of message rendering. */
export function useAiChatViewport(deps: {
  messages: () => ChatItem[]
  loading: () => boolean | undefined
  layoutSignature: () => string
}) {
  /**
   * KeepAlive detaches/re-attaches this panel when switching SSH sessions.
   * Browsers reset scrollTop to 0 on re-attach, so we save/restore explicitly.
   */
  let visible = true
  let disposed = false
  const frames = new Set<number>()
  function scheduleFrame(callback: FrameRequestCallback) {
    if (!visible || disposed) return 0
    const id = requestAnimationFrame(time => {
      frames.delete(id)
      if (visible && !disposed) callback(time)
    })
    frames.add(id)
    return id
  }
  const listRef = ref<HTMLElement | null>(null)
  /** When on, stream updates pin the viewport to the latest output (default). */
  const followLatest = ref(true)
  let savedScrollTop = 0
  let isProgrammaticScroll = false
  let scrollRaf = 0
  const NEAR_BOTTOM_PX = 48

  const timelineTurns = computed(() => collectChatTimelineTurns(deps.messages()))
  const showTimeline = computed(() => timelineTurns.value.length > 0 && deps.messages().length > 1)
  const activeTurnId = ref('')
  const timelineRef = ref<HTMLElement | null>(null)
  const timelineHovered = ref(false)
  const timelineKeyboardFocus = ref(false)
  const timelineExpanded = computed(() => timelineHovered.value || timelineKeyboardFocus.value)
  const timelineCapacity = ref(12)
  const visibleTimelineTurns = computed(() => timelineExpanded.value ? timelineTurns.value : overviewChatTimelineTurns(timelineTurns.value, activeTurnId.value, timelineCapacity.value))
  let expandedTimelineScroll = 0
  watch(timelineRef, (element, _previous, onCleanup) => {
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const style = getComputedStyle(element)
      const configuredInset = parseFloat(style.getPropertyValue('--ai-composer-overlay-inset'))
      const inset = Number.isFinite(configuredInset) ? configuredInset : 150
      const maxHeight = Math.max(48, (element.parentElement?.clientHeight || 0) - 2 * inset + 8)
      if (Number.isFinite(maxHeight)) timelineCapacity.value = Math.max(3, Math.min(12, Math.floor((maxHeight - 6) / 10)))
    })
    observer.observe(element)
    if (element.parentElement) observer.observe(element.parentElement)
    onCleanup(() => observer.disconnect())
  })
  function setTimelineHovered(hovered: boolean) {
    if (!hovered && timelineRef.value) expandedTimelineScroll = timelineRef.value.scrollTop
    timelineHovered.value = hovered
  }
  function onTimelineFocus(event: FocusEvent) {
    timelineKeyboardFocus.value = event.target instanceof HTMLElement && event.target.matches(':focus-visible')
  }
  function onTimelineBlur(event: FocusEvent) {
    if (event.relatedTarget instanceof Node && timelineRef.value?.contains(event.relatedTarget)) return
    if (timelineRef.value) expandedTimelineScroll = timelineRef.value.scrollTop
    timelineKeyboardFocus.value = false
  }
  watch(timelineExpanded, async expanded => {
    await nextTick()
    if (visible && !disposed && expanded && timelineRef.value) timelineRef.value.scrollTop = expandedTimelineScroll
  })
  let jumpScrollTimer: ReturnType<typeof setTimeout> | null = null

  function captureScroll() {
    const el = listRef.value
    if (el) savedScrollTop = el.scrollTop
  }

  function restoreScroll() {
    const el = listRef.value
    if (!el) return
    const max = Math.max(0, el.scrollHeight - el.clientHeight)
    el.scrollTop = Math.min(Math.max(0, savedScrollTop), max)
  }

  function isNearBottom(el: HTMLElement, threshold = NEAR_BOTTOM_PX): boolean {
    return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold
  }

  function scrollToBottom() {
    const el = listRef.value
    if (!el) return
    isProgrammaticScroll = true
    el.scrollTop = el.scrollHeight
    savedScrollTop = el.scrollTop
    scheduleFrame(() => {
      isProgrammaticScroll = false
    })
  }

  function scheduleScrollToBottom() {
    if (!visible || disposed || !followLatest.value) return
    if (scrollRaf) { cancelAnimationFrame(scrollRaf); frames.delete(scrollRaf) }
    scrollRaf = scheduleFrame(() => {
      scrollRaf = 0
      scrollToBottom()
    })
  }

  function updateActiveTurn() {
    const el = listRef.value
    const turns = timelineTurns.value
    if (!el || !turns.length) {
      activeTurnId.value = ''
      return
    }
    if (followLatest.value) {
      activeTurnId.value = turns[turns.length - 1]?.id || ''
      return
    }
    const rows = new Map(Array.from(el.querySelectorAll<HTMLElement>('[data-message-id]')).map(row => [row.dataset.messageId, row]))
    const measured = turns.map((turn) => {
      const row = rows.get(turn.id)
      return { id: turn.id, top: row ? row.offsetTop : 0 }
    })
    activeTurnId.value = activeTimelineTurnId(measured, el.scrollTop)
  }

  function jumpToTurn(id: string) {
    const el = listRef.value
    if (!el) return
    const row = el.querySelector(`[data-message-id="${CSS.escape(id)}"]`) as HTMLElement | null
    if (!row) return
    followLatest.value = false
    activeTurnId.value = id
    isProgrammaticScroll = true
    const top = Math.max(0, row.offsetTop - 8)
    el.scrollTo({ top, behavior: 'smooth' })
    savedScrollTop = top
    if (jumpScrollTimer) clearTimeout(jumpScrollTimer)
    jumpScrollTimer = setTimeout(() => {
      isProgrammaticScroll = false
      captureScroll()
      updateActiveTurn()
      jumpScrollTimer = null
    }, 420)
  }

  function onListScroll() {
    if (isProgrammaticScroll) {
      captureScroll()
      updateActiveTurn()
      return
    }
    captureScroll()
    const el = listRef.value
    if (!el) return
    // Manual scroll away from tail pauses follow; return to bottom re-enables.
    if (followLatest.value && !isNearBottom(el)) {
      followLatest.value = false
    } else if (!followLatest.value && isNearBottom(el)) {
      followLatest.value = true
    }
    updateActiveTurn()
  }

  function toggleFollowLatest() {
    followLatest.value = !followLatest.value
    if (followLatest.value) {
      void nextTick(() => scheduleScrollToBottom())
    }
  }

  /** Cheap signature so streaming token updates trigger follow-scroll. */
  const messagesSignature = computed(() =>
    deps.messages()
      .map(
        (m) =>
          `${m.id}:${m.content.length}:${(m.reasoningContent || '').length}:${m.streaming ? 1 : 0}:${(m.segments || [])
            .map((s) => (s.kind === 'tool' ? `t${s.runId}` : `${s.kind}${s.text.length}`))
            .join(',')}:${(m.toolRuns || [])
            .map((r) => `${r.id}:${r.content.length}:${r.isError ? 1 : 0}:${r.status || ''}`)
            .join(',')}`,
      )
      .join('|'),
  )

  watch(
    [messagesSignature, deps.layoutSignature, deps.loading, () => deps.messages().length],
    async () => {
      await nextTick()
      updateActiveTurn()
      if (!visible || disposed || !followLatest.value) return
      scheduleScrollToBottom()
    },
    { immediate: true },
  )

  onActivated(() => {
    visible = true
    nextTick(() => {
      if (!visible || disposed) return
      if (followLatest.value) {
        scheduleScrollToBottom()
        scheduleFrame(() => {
          if (followLatest.value) scrollToBottom()
          updateActiveTurn()
        })
        return
      }
      restoreScroll()
      scheduleFrame(() => {
        restoreScroll()
        updateActiveTurn()
      })
    })
  })

  onDeactivated(() => { visible = false; captureScroll(); cancelFrames() })
  function handleViewportInsetChange() {
    if (followLatest.value) scheduleScrollToBottom()
  }
  function cancelFrames() {
    for (const frame of frames) cancelAnimationFrame(frame)
    frames.clear()
    scrollRaf = 0
    isProgrammaticScroll = false
    if (jumpScrollTimer) clearTimeout(jumpScrollTimer)
    jumpScrollTimer = null
  }
  onScopeDispose(() => { disposed = true; cancelFrames() })
  return { listRef, followLatest, timelineRef, showTimeline, activeTurnId,
    timelineExpanded, visibleTimelineTurns, setTimelineHovered, onTimelineFocus,
    onTimelineBlur, jumpToTurn, onListScroll, toggleFollowLatest, handleViewportInsetChange }
}
