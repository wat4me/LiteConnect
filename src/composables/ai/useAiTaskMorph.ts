import { nextTick, onScopeDispose, ref, watch, type Ref } from 'vue'

/** Animate the card's actual bounds so command text never stretches. */
export function useAiTaskMorph(options: {
  expanded: Ref<boolean>
  active: () => boolean
  surface: Ref<HTMLElement | null>
  trigger: Ref<HTMLElement | null>
  panel: Ref<HTMLElement | null>
}) {
  const rendered = ref(false)
  let revision = 0
  let animations: Animation[] = []
  const cancel = () => { animations.forEach(animation => animation.cancel()); animations = [] }

  watch([options.expanded, options.active], async ([open, active]) => {
    const currentRevision = ++revision
    const previous = options.panel.value
    const startRect = previous?.getBoundingClientRect()
    const previousRadius = previous ? getComputedStyle(previous).borderRadius : undefined
    const contentSelectors = '[data-task-content]'
    const previousOpacity = previous ? [...previous.querySelectorAll<HTMLElement>(contentSelectors)].map(node => getComputedStyle(node).opacity) : []
    const previousIcon = previous?.querySelector<HTMLElement>('.background-heading-toggle .app-icon')
    const previousTransform = previousIcon ? getComputedStyle(previousIcon).transform : undefined
    cancel()
    if (!active || (!open && !rendered.value)) { rendered.value = false; return }
    if (open) rendered.value = true
    await nextTick()
    if (currentRevision !== revision) return
    const element = options.panel.value
    const surface = options.surface.value
    const trigger = options.trigger.value
    if (!element || !surface || !trigger) { rendered.value = false; return }
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { rendered.value = open; return }

    const fullRect = element.getBoundingClientRect()
    const circleRect = trigger.getBoundingClientRect()
    const surfaceRect = surface.getBoundingClientRect()
    const radius = getComputedStyle(element).borderRadius
    const frame = (rect: DOMRect, borderRadius: string) => ({
      left: `${rect.left - surfaceRect.left}px`, top: `${rect.top - surfaceRect.top}px`, bottom: 'auto',
      width: `${rect.width}px`, height: `${rect.height}px`, borderRadius,
    })
    const duration = open ? 220 : 180
    const shape = element.animate([
      frame(startRect || circleRect, previousRadius || '20px'),
      frame(open ? fullRect : circleRect, open ? radius : '20px'),
    ], { duration, easing: 'cubic-bezier(.22, 1, .36, 1)' })
    animations.push(shape)
    element.querySelectorAll<HTMLElement>(contentSelectors).forEach((node, index) => {
      animations.push(node.animate([
        { opacity: previousOpacity[index] || '0' }, { opacity: open ? 1 : 0 },
      ], { duration: open ? 140 : 60, delay: open && !startRect ? 80 : 0, fill: 'both', easing: 'ease-out' }))
    })
    const icon = element.querySelector<HTMLElement>('.background-heading-toggle .app-icon')
    if (icon) {
      // The header icon carries the circle's glyph into the expanded title.
      const iconRect = icon.getBoundingClientRect()
      const currentRect = element.getBoundingClientRect()
      const circleIcon = `translate(${circleRect.width / 2 - (iconRect.left - currentRect.left + iconRect.width / 2)}px, ${circleRect.height / 2 - (iconRect.top - currentRect.top + iconRect.height / 2)}px) scale(1.25)`
      animations.push(icon.animate([
        { transform: previousTransform || circleIcon }, { transform: open ? 'none' : circleIcon },
      ], { duration, easing: 'cubic-bezier(.22, 1, .36, 1)' }))
    }
    try { await shape.finished } catch { return }
    if (currentRevision !== revision) return
    rendered.value = open
    cancel()
  })
  onScopeDispose(() => { revision++; cancel() })
  return { rendered }
}
