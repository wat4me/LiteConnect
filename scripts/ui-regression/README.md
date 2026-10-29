# UI regression checks

Run `npm run test:ui` after installing the project's existing dependencies.
Run `npm run test:ui -- --settings` for the real settings page and SSH tool rail:
failed initial read/retry/leave, advanced database settings search/reveal/save, monitor entry hide/show and panel
close, remote-window notifications, partial saves preserving external changes,
dirty-draft rebasing and blocking close/edit actions while saving. Covers two languages, three themes and
two widths with mocked settings persistence; no real SSH connection is opened.
Run `npm run test:ui -- --navigation` for the main-window SSH/DB/AI rail:
in-place switching from the rail and every titlebar module entry, lazy mounting, retained DOM/drafts/scroll position,
current-module reselect, pointer/keyboard activation, settings close decisions,
and blocked global palette / notification side effects after a cancelled leave,
and dedicated-window layout. Uses the actual shell and navigation composable
with fixture workspace fields, two languages, three themes, two widths and
two UI scales; no real SSH/DB connection is opened.
Run `npm run test:ui -- --images` for the button-free image composer: empty
attachments stay hidden, paste/drop adds thumbnails, preview/removal works,
unsupported models warn without accepting the image, and image-only sending
retains the attachment in history. Covers sidebar/LiteAI, three themes and
300px/440px widths, with mocked AI requests.
Run `npm run test:ui -- --knowledge` for per-server knowledge management with
actual isolated SQLite storage: enable consent/cancel, Markdown editing/import/
export, stale revision protection, history restoration, server/scope isolation,
and opening the saved document from an AI tool result. Linked memory checks cover
standalone notes before any source exists, per-record include choices without
duplicate memory entries, choosing optional sources, renames retaining stable IDs,
exported source IDs and visible missing references after deletion. It checks both languages,
three themes and narrow/wide windows. File dialogs and model results are mocked;
the actual terminal/LiteAI composer also checks zero, single-digit, double-digit
and capped knowledge counts: content stays inside the button, adjacent controls
align without overlap, and opening/closing restores focus.
External switches cover first-enable consent/cancel, direct re-enable, retained
documents and blocked AI reads while off, failure rollback, stale scope/consent,
busy state and per-server multi-host management. The suite does not access user
knowledge or connect to a real AI service.
Run `npm run test:ui -- --background-timing` for background task elapsed-time
checks: sidebar/LiteAI layouts across three themes, collapsed live overview,
terminal duration freezing, pause/resume, and updates without IPC polling.
The LiteAI rail checks cover direct close buttons, closing from home or another
conversation, preservation of SSH connections/history, and busy/failure handling.
The clear action checks cover confirmation/cancellation, persisted current-message
removal, retained drafts/other history/SSH connections, and the disabled empty state.
Scope details show an explanatory heading and fit inside a compact popover.
Model-menu checks cover menu semantics, initial focus, arrow/Home/End navigation,
Escape focus return and native Tab exit. Narrow chats default to a collapsed rail;
manual rail choices remain persistent. Chat viewport checks retain the 200-turn
timeline and stream follow/pause behavior. Composable tests additionally cover
KeepAlive reading-position restoration and pending viewport-work disposal.

Run `npm run test:ui:questions` for AI question-card checks: single choice,
multiple choice, free text, explicit custom answers, compact arrow pager, unanswered
indicators, cross-page draft retention, final batch submission, explicit skip,
failed-submit draft retention, and 300px/440px layouts across light, dark and
eyecare themes, including the real terminal/LiteAI sidebar with its floating
composer, visible answer/actions, stop control, and composer restoration. Answers are mocked;
the suite never sends an answer to a real conversation or runs SSH commands.

Run `npm run test:ui -- --ai-retention` for question drafts across component
recreation and session switches, failed/successful answers, skip and offscreen
completion cleanup. It also checks lazy multi-host Markdown mounting and code
copying with 20 hosts, plus disclosure cleanup after removing message parts or
switching threads. Unsubmitted answers stay in renderer memory only.

Run `npm run test:ui -- --workspace-disconnect` for the visible per-server
disconnect actions in card/list views across three themes and widths. It checks
confirmation/cancellation, selection and double-click isolation, target-only
disconnect, connected filters, and staying on the host browser.

Run `npm run test:ui -- --workspace-pending` for shared pending-action badges,
question/approval/mixed descriptions, exact conversation navigation and retained
answer drafts, completion cleanup, and expanded/collapsed rail layouts.

Run `npm run test:ui -- --ai-transfers` for shared SFTP download/upload progress,
speed, server grouping, conversation/thread isolation, cancellation, opening a
completed download folder, offscreen completion, and narrow/theme layouts.

Run `npm run test:ui:docker` for the focused Docker checks. They cover toolbar
alignment, list column alignment and overflow across three themes and widths,
history reading without stopping reception, jumping to the latest logs, search
navigation, copying while searching, independent receive/scroll controls,
auto-scroll at buffer capacity, and clearing only the display. Docker IPC is
mocked; no remote containers are changed. Screenshots are saved in the printed
temporary artifact directory.

Run `npm run test:ui -- --performance` for connection lists of 100, 500 and 2000
items in both densities. It checks bounded DOM size in the main list and group
sidebar, full-data search, keyboard reveal/connection, dragging across virtual
windows, measured multiline errors, resizing, performance diagnostics lifecycle,
and idle cursor scheduling. Timings are observational development-renderer
measurements, not production startup or physical display FPS. The temporary
artifact directory includes metrics.json and a diagnostics screenshot.

Run `npm run test:ui -- --connections-layout` for the connection page's tag
filter menu, independent navigation/list search, usage metadata, untagged/gray
markers, persistent shortcuts/actions, three themes, two densities and three
window widths. It also checks the All connections navigation entry, scoped
heading/counts, query preservation when changing scope, restoring the same
group, persisted sort choices, credentials in the Tools menu, and English
labels, and captures preview screenshots.

Run `npm run test:ui -- --tool-rows` for single-line AI tool outcomes, output
truncation notices and file/match counts at 280–440px in both languages and
three themes, including expanded rows and long target/description text. It also
checks that elapsed-time ticks do not rerender the full chat/tool list.

Run `npm run test:ui -- --drag` for real browser mouse dragging of connection
names, card whitespace, group headers and sidebar connections. It intercepts
Chromium's native drag payloads and checks reorder/move persistence, hierarchy
protection, controls/rename protection and double-click connection behavior.

Run `npm run test:ui -- --large-views` for large SFTP trees/searches,
database result grids and Docker logs. It checks 5,000 file/table rows and
10,000 log lines with bounded DOM, offscreen locate/keyboard/search,
stable table columns and row numbers, raw cell copying, complete CSV/log
copying, history anchoring during log-buffer rotation, and wrapped-log following.
`npm run test:ui -- --docker` also checks the integrated log toolbar and receiving
lifecycle across window sizes and themes.

The script starts a temporary Vite server without the application's Electron
plugin, then opens an invisible Electron window with actual Vue components.
It uses a temporary profile and mocked connection IPC; it never connects to a
server or reads/writes real connection settings. The window closes after the
checks, and the server is shut down even when a check fails.

The checks cover automatic expansion of the initially selected group, manual
collapse and expansion when selecting another group, current/all-group search, Enter to
connect, toolbar menu dismissal and focus return, sidebar pointer/keyboard
resize, narrow window overflow, and selection/tag colors across dark, light,
eyecare and custom themes (including live accent token overrides). They also cover
dragging a card's text into a collapsed group, preventing drags from
action buttons, bookmark rename, AI stage/delay rendering, SFTP edit conflict
and explicit overwrite with optional backup, directory upload selection, and
long text/count layout. Token accounting checks cover visible cached/uncached input and output, exact reasoning/request details, missing-provider and partial statistics, and 300px sidebar wrapping. LiteAI checks also cover manual multi-server scope selection from both server cards/list rows and the new-chat dialog, selection persistence across search/view changes, pinned selection actions, target counts and connection ratios, selection-only compact cards, summary tables with collapsible per-host details and code copying, legacy and scoped history restoration, scoped background task cards and reconnecting without replacing the transcript. SFTP tree overflow is checked with long names; the tree must retain the
requested pane width, keep actions inside the pane, truncate long names, and
preserve the full path for hover at widths from 280 to 600 pixels. Bookmark layout
is checked with Chinese, Latin, mixed, and long names at three widths and three
zoom factors. A screenshot is retained in the temporary artifact directory
printed at completion.

These checks validate renderer interactions and layout. Real SSH/SFTP network
operations, native OS dragging, and tooltips still need integration/manual QA.

AI settings coverage includes category navigation, a searchable model dialog
with focus trapping and Escape focus return, advanced parameter disclosure,
provider-only saving while preserving other drafts, general saving without
applying retention changes, and retention preview/cancel/confirmation flows.
Settings and history IPC are mocked; the UI suite never prunes real history.
Embedded LiteSSH settings use a separate category overview and child pages.
Checks at 300px and 440px cover category visibility, child-page/footer overflow,
back-navigation focus, and retaining unsaved drafts across categories.
The LiteAI home model button opens settings without starting a connection or
conversation, preserves host selection on return, and fits at 520–1050px.
Background completion cards reuse tool-result rows, distinguish failed exit
codes, timeouts and cancellation, and retain truncation notices. Collapsed and
expanded layouts are checked at 300px/440px in light, dark and eyecare themes.

The `--ai-transfers` suite also checks the global upload-conflict dialog at
360px and 1080px in all three themes: long paths wrap, keep-both is selected
initially, decisions include apply-to-all, and cancelling targets the current
batch. Closing the file/AI panel does not hide the conflict dialog.
