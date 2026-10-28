/** Native dragstart targets the draggable ancestor, so remember the pressed control. */
export function createRowDragGuard() {
  let pressedControl = false
  function isControl(target: EventTarget | null) {
    return target instanceof Element && !!target.closest(
      'button, a, input, textarea, select, [role="button"], [contenteditable]:not([contenteditable="false"]), .row-actions, .ui-menu',
    )
  }
  return {
    pointerDown(event: PointerEvent) {
      pressedControl = event.button !== 0 || isControl(event.target)
    },
    canStart(event: DragEvent) {
      if (pressedControl || isControl(event.target)) {
        event.preventDefault()
        return false
      }
      return true
    },
  }
}
