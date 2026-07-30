/**
 * SVG icons extracted from src/components/icons/AppIcon.vue
 * for the static product demo (no Vue runtime).
 */
;(function (global) {
  const PATHS = {
    close: '<line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />',
    plus: '<line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />',
    search: '<circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />',
    download:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />',
    upload:
      '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />',
    'chevron-right': '<polyline points="9 18 15 12 9 6" />',
    'chevron-down': '<polyline points="6 9 12 15 18 9" />',
    'home-grid':
      '<rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" />',
    folder:
      '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />',
    'file-text':
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" /><line x1="8" y1="17" x2="13" y2="17" />',
    monitor:
      '<rect x="2" y="3" width="20" height="14" rx="2" ry="2" /><line x1="8" y1="21" x2="16" y2="21" /><line x1="12" y1="17" x2="12" y2="21" />',
    terminal: '<polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />',
    'ai-chat':
      '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /><path d="M12 7l1 2.5L15.5 10l-2.5 1L12 13.5 11 11l-2.5-1L11 9.5z" />',
    settings:
      '<circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />',
    history:
      '<path d="M3 3v5h5" /><path d="M3.05 13A9 9 0 1 0 5.64 6.64L3 8" /><path d="M12 7v5l3 2" />',
    stop: '<rect x="6" y="6" width="12" height="12" rx="1" />',
    play: '<polygon points="6 4 20 12 6 20 6 4" />',
    'play-all':
      '<polygon points="3 5 12 12 3 19 3 5" /><polygon points="12 5 21 12 12 19 12 5" />',
    'query-plan':
      '<rect x="3" y="3" width="7" height="5" rx="1" /><rect x="14" y="16" width="7" height="5" rx="1" /><rect x="3" y="16" width="7" height="5" rx="1" /><path d="M6.5 8v4h11v4" /><path d="M6.5 12v4" />',
    'help-circle':
      '<circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" />',
    'split-h':
      '<rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="12" x2="21" y2="12" />',
    'split-v':
      '<rect x="3" y="3" width="18" height="18" rx="2" /><line x1="12" y1="3" x2="12" y2="21" />',
    database:
      '<ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />',
    table:
      '<rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" />',
    refresh:
      '<polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />',
    docker:
      '<g fill="currentColor" stroke="none"><rect x="3" y="10" width="3.2" height="3.2" rx="0.45" /><rect x="7" y="10" width="3.2" height="3.2" rx="0.45" /><rect x="11" y="10" width="3.2" height="3.2" rx="0.45" /><rect x="15" y="10" width="3.2" height="3.2" rx="0.45" /><rect x="7" y="6" width="3.2" height="3.2" rx="0.45" /><rect x="11" y="6" width="3.2" height="3.2" rx="0.45" /><rect x="11" y="2" width="3.2" height="3.2" rx="0.45" /><path d="M2 14.2h16.1c.2-1.15.9-2.05 2.05-2.55.55-.24 1.2-.3 1.85-.16-.25 1.12-.83 1.96-1.73 2.52-.42 4.45-3.76 6.75-8.92 6.75H8.7C5.15 20.76 2.55 18.42 2 14.2Z" /></g><circle cx="5.15" cy="16.3" r="0.7" fill="var(--bg-primary, #0d1117)" stroke="none" /><path d="M18.15 11.2c.25-1.15 1.05-1.95 2.25-2.25" />',
  }

  /**
   * @param {string} name AppIcon name
   * @param {'xs'|'sm'|'md'|'lg'} [size]
   * @param {string} [extraClass]
   */
  function icon(name, size = 'sm', extraClass = '') {
    const inner = PATHS[name]
    if (!inner) {
      console.warn('[icons] unknown icon:', name)
      return ''
    }
    const cls = ['app-icon', extraClass].filter(Boolean).join(' ')
    return `<svg class="${cls}" data-size="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`
  }

  global.DemoIcons = { PATHS, icon }
  global.icon = icon
})(typeof window !== 'undefined' ? window : globalThis)
