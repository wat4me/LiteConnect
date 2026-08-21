import { onBeforeUnmount, onMounted, ref, watch, type Ref } from 'vue'

/**
 * Optional decorative cursor. Off by default via settings.
 * Restores the native cursor over text fields / terminal for precision work.
 */
export type FancyCursorStyle = 'ring' | 'dot' | 'trail' | 'cross'

export const FANCY_CURSOR_STYLES: FancyCursorStyle[] = ['ring', 'dot', 'trail', 'cross']

export function sanitizeFancyCursorStyle(v: unknown): FancyCursorStyle {
  if (v === 'dot' || v === 'trail' || v === 'cross' || v === 'ring') return v
  return 'ring'
}

const NATIVE_CURSOR_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '.xterm',
  '.xterm-helper-textarea',
  '.cm-editor',
  'iframe',
].join(',')

const INTERACTIVE_SELECTOR = [
  'a',
  'button',
  '[role="button"]',
  'label',
  'summary',
  '.drag-handle',
  '.sidebar-conn-handle',
  '.group-drag-handle',
  '[draggable="true"]',
].join(',')

const TRAIL_LEN = 5

export function useFancyCursor(
  enabled: Ref<boolean>,
  style: Ref<FancyCursorStyle> = ref('ring'),
) {
  const active = ref(false)
  let ring: HTMLDivElement | null = null
  let core: HTMLDivElement | null = null
  let cross: HTMLDivElement | null = null
  let trailEls: HTMLDivElement[] = []
  let host: HTMLDivElement | null = null
  let raf = 0
  let targetX = 0
  let targetY = 0
  let ringX = 0
  let ringY = 0
  let trail: Array<{ x: number; y: number }> = []
  let visible = false
  let overNative = false
  let overInteractive = false
  let pressed = false
  let idleFrames = 0

  function currentStyle(): FancyCursorStyle {
    return sanitizeFancyCursorStyle(style.value)
  }

  function ensureDom() {
    if (host) return
    host = document.createElement('div')
    host.className = 'fancy-cursor-host'
    host.setAttribute('aria-hidden', 'true')

    ring = document.createElement('div')
    ring.className = 'fancy-cursor-ring'
    core = document.createElement('div')
    core.className = 'fancy-cursor-core'
    cross = document.createElement('div')
    cross.className = 'fancy-cursor-cross'
    cross.innerHTML = '<i></i><i></i>'

    trailEls = []
    for (let i = 0; i < TRAIL_LEN; i++) {
      const d = document.createElement('div')
      d.className = 'fancy-cursor-trail-dot'
      d.style.setProperty('--trail-i', String(i))
      trailEls.push(d)
      host.appendChild(d)
    }

    host.append(ring, core, cross)
    document.body.appendChild(host)
    applyStyleClass()
  }

  function applyStyleClass() {
    const s = currentStyle()
    host?.setAttribute('data-style', s)
    document.documentElement.setAttribute('data-fancy-cursor-style', s)
  }

  function removeDom() {
    host?.remove()
    host = null
    ring = null
    core = null
    cross = null
    trailEls = []
    trail = []
    document.documentElement.removeAttribute('data-fancy-cursor-style')
  }

  function applyVisibility() {
    const show = visible && !overNative
    host?.classList.toggle('is-visible', show)
    host?.classList.toggle('is-interactive', overInteractive && !overNative)
    host?.classList.toggle('is-pressed', pressed && !overNative)
    document.documentElement.classList.toggle('fancy-cursor-on', show)
  }

  function setVisible(next: boolean) {
    visible = next
    applyVisibility()
  }

  function classifyTarget(target: EventTarget | null) {
    const el = target instanceof Element ? target : null
    overNative = !!(el && el.closest(NATIVE_CURSOR_SELECTOR))
    overInteractive = !!(el && el.closest(INTERACTIVE_SELECTOR))
    applyVisibility()
  }

  function onPointerMove(e: PointerEvent) {
    targetX = e.clientX
    targetY = e.clientY
    if (core) {
      core.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`
    }
    if (cross) {
      cross.style.transform = `translate3d(${targetX}px, ${targetY}px, 0)`
    }
    classifyTarget(e.target)
    if (!visible) setVisible(true)
    idleFrames = 0
    if (active.value && !raf) raf = requestAnimationFrame(tick)
  }

  function onPointerDown() {
    pressed = true
    applyVisibility()
  }

  function onPointerUp() {
    pressed = false
    applyVisibility()
  }

  function onPointerLeave() {
    setVisible(false)
  }

  function tick() {
    raf = 0
    if (!active.value) return

    const s = currentStyle()
    ringX += (targetX - ringX) * (s === 'dot' ? 0.18 : 0.28)
    ringY += (targetY - ringY) * (s === 'dot' ? 0.18 : 0.28)

    if (ring) {
      ring.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`
    }

    // Soft lagging “dot” reuses ring position for a single large blob
    if (s === 'dot' && core) {
      core.style.transform = `translate3d(${ringX}px, ${ringY}px, 0)`
    }

    if (s === 'trail') {
      trail.unshift({ x: targetX, y: targetY })
      if (trail.length > TRAIL_LEN) trail.length = TRAIL_LEN
      for (let i = 0; i < trailEls.length; i++) {
        const p = trail[i]
        if (!p) continue
        const el = trailEls[i]
        el.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`
        el.style.opacity = String(Math.max(0.12, 0.55 - i * 0.1))
      }
    }

    const settled = Math.abs(targetX - ringX) < 0.35 && Math.abs(targetY - ringY) < 0.35
    if (settled && s !== 'trail') idleFrames += 1
    else idleFrames = 0
    if (idleFrames > 24) {
      raf = 0
      return
    }

    raf = requestAnimationFrame(tick)
  }

  function start() {
    if (active.value) {
      applyStyleClass()
      return
    }
    active.value = true
    ensureDom()
    applyStyleClass()
    ringX = targetX
    ringY = targetY
    trail = []
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    window.addEventListener('pointerup', onPointerUp, { passive: true })
    window.addEventListener('pointercancel', onPointerUp, { passive: true })
    window.addEventListener('pointerleave', onPointerLeave, { passive: true })
    document.addEventListener('mouseleave', onPointerLeave, { passive: true })
    raf = requestAnimationFrame(tick)
  }

  function stop() {
    if (!active.value && !host) return
    active.value = false
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerdown', onPointerDown)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('pointerleave', onPointerLeave)
    document.removeEventListener('mouseleave', onPointerLeave)
    if (raf) {
      cancelAnimationFrame(raf)
      raf = 0
    }
    setVisible(false)
    document.documentElement.classList.remove('fancy-cursor-on')
    removeDom()
  }

  function sync() {
    if (enabled.value) start()
    else stop()
  }

  onMounted(() => {
    watch(enabled, sync, { immediate: true })
    watch(style, () => {
      if (!enabled.value) return
      applyStyleClass()
      // Restart lag positions cleanly when switching style
      ringX = targetX
      ringY = targetY
      trail = []
    })
  })

  onBeforeUnmount(() => {
    stop()
  })

  return { start, stop, sync }
}
