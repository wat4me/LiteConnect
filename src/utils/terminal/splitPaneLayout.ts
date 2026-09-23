import type { SplitMode, SplitSide } from '@/domain/terminal/types'

export type SplitPaneLayoutState = {
  dividerSize: number
  splitRatio: number
  splitMode: SplitMode
  secondarySide: SplitSide
  splitHasSecondary: boolean
  maximizedSessionId: string | null
  primarySessionId: string | null
  secondarySessionId: string | null
}

/**
 * Absolute layout so panes never move TerminalTab between different parents
 * (DOM moves would remount xterm and drop scrollback).
 * splitRatio always represents the primary pane's share; the secondary pane
 * takes the opposite side per secondarySide.
 */
export function getSessionPaneStyle(sessionId: string, state: SplitPaneLayoutState): Record<string, string> {
  const half = state.dividerSize / 2
  const ratio = state.splitRatio
  const secRatio = 100 - ratio

  if (state.splitHasSecondary && state.maximizedSessionId) {
    if (sessionId !== state.maximizedSessionId) return { display: 'none' }
    return { top: '0', left: '0', right: '0', bottom: '0' }
  }

  if (!state.splitHasSecondary) {
    if (sessionId !== state.primarySessionId) {
      return { display: 'none' }
    }
    return { top: '0', left: '0', right: '0', bottom: '0' }
  }

  const side = state.secondarySide
  const isVertical = state.splitMode === 'vertical'
  const primaryIsLeft = isVertical && side === 'right'
  const primaryIsRight = isVertical && side === 'left'
  const primaryIsTop = !isVertical && side === 'bottom'
  const primaryIsBottom = !isVertical && side === 'top'

  if (sessionId === state.primarySessionId) {
    if (primaryIsLeft) {
      return { top: '0', left: '0', bottom: '0', width: `calc(${ratio}% - ${half}px)` }
    }
    if (primaryIsRight) {
      return { top: '0', right: '0', bottom: '0', width: `calc(${ratio}% - ${half}px)` }
    }
    if (primaryIsTop) {
      return { top: '0', left: '0', right: '0', height: `calc(${ratio}% - ${half}px)` }
    }
    // primaryIsBottom
    return { bottom: '0', left: '0', right: '0', height: `calc(${ratio}% - ${half}px)` }
  }

  if (sessionId === state.secondarySessionId) {
    if (primaryIsLeft) {
      // secondary on right
      return { top: '0', right: '0', bottom: '0', width: `calc(${secRatio}% - ${half}px)` }
    }
    if (primaryIsRight) {
      // secondary on left
      return { top: '0', left: '0', bottom: '0', width: `calc(${secRatio}% - ${half}px)` }
    }
    if (primaryIsTop) {
      // secondary on bottom
      return { bottom: '0', left: '0', right: '0', height: `calc(${secRatio}% - ${half}px)` }
    }
    // secondary on top
    return { top: '0', left: '0', right: '0', height: `calc(${secRatio}% - ${half}px)` }
  }

  // Mounted but hidden (other tabs) - preserve xterm instance & scrollback
  return { display: 'none' }
}

export function getDividerStyle(state: SplitPaneLayoutState): Record<string, string> {
  const half = state.dividerSize / 2
  const ratio = state.splitRatio
  const side = state.secondarySide
  if (state.splitMode === 'vertical') {
    if (side === 'left') {
      // secondary on left => divider sits at (100 - ratio)% from left
      return { top: '0', bottom: '0', left: `calc(${100 - ratio}% - ${half}px)`, width: `${state.dividerSize}px` }
    }
    // secondary on right (default) => divider at ratio% from left
    return { top: '0', bottom: '0', left: `calc(${ratio}% - ${half}px)`, width: `${state.dividerSize}px` }
  }
  // horizontal
  if (side === 'top') {
    return { left: '0', right: '0', top: `calc(${100 - ratio}% - ${half}px)`, height: `${state.dividerSize}px` }
  }
  // secondary on bottom (default)
  return { left: '0', right: '0', top: `calc(${ratio}% - ${half}px)`, height: `${state.dividerSize}px` }
}
