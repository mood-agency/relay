/**
 * Centralized table styling constants for consistent visual appearance.
 * Import these constants in all table components to ensure uniform styling.
 */

// ============================================================================
// Table Header Styles
// ============================================================================

/** Base sticky header style - use for all table headers */
export const TABLE_HEADER_BASE = "sticky top-0 z-20 bg-card font-semibold text-foreground text-xs"

/** First column header style - extra left padding for alignment with header/filter */
export const TABLE_HEADER_FIRST = "pl-6"

/** Last column header style - extra right padding for alignment */
export const TABLE_HEADER_LAST = "pr-6"

/** Sortable header style - extends base with hover effects */
export const TABLE_HEADER_SORTABLE = `${TABLE_HEADER_BASE} cursor-pointer select-none hover:bg-muted/50 transition-colors`

/** Checkbox column header style */
export const TABLE_HEADER_CHECKBOX = "sticky top-0 z-20 bg-card w-[40px] text-xs"

/** Filter column header style (right-aligned) */
export const TABLE_HEADER_FILTER = "sticky top-0 z-20 bg-card text-right pr-2 w-[50px]"

// ============================================================================
// Table Row Styles
// ============================================================================

/** Header row style - no hover effect */
export const TABLE_ROW_HEADER = "hover:bg-transparent border-b border-border/50"

/** Data row base style */
export const TABLE_ROW_BASE = "group transition-colors duration-150 border-muted/30"

/** Spacer row style (for virtualization) */
export const TABLE_ROW_SPACER = "hover:bg-transparent"

/** Empty state row style */
export const TABLE_ROW_EMPTY = "hover:bg-transparent"

/** Filler row style (fills remaining space) */
export const TABLE_ROW_FILLER = "hover:bg-transparent border-0"

// ============================================================================
// Table Row State Classes (to be combined with cn())
// ============================================================================

/** Highlighted row state */
export const TABLE_ROW_HIGHLIGHTED = "animate-highlight"

/** Selected row state */
export const TABLE_ROW_SELECTED = "bg-primary/10"

/** Critical/error row state */
export const TABLE_ROW_CRITICAL = "bg-destructive/5"

// ============================================================================
// Table Cell Styles
// ============================================================================

/** First column cell style - extra left padding for alignment */
export const TABLE_CELL_FIRST = "pl-6"

/** Last column cell style - extra right padding for alignment */
export const TABLE_CELL_LAST = "pr-6"

/** Base cell style with mono font for IDs */
export const TABLE_CELL_ID = "group/id"

/** Payload cell style with max width */
export const TABLE_CELL_PAYLOAD = "max-w-[150px] cursor-default group/payload"

/** Time/timestamp cell style */
export const TABLE_CELL_TIME = "text-xs text-foreground whitespace-nowrap"

/** Right-aligned actions cell */
export const TABLE_CELL_ACTIONS = "text-right pr-6"

/** Empty state cell style */
export const TABLE_CELL_EMPTY = "h-[400px] p-0"

/** Virtualization spacer cell style */
export const TABLE_CELL_SPACER = "p-0 h-auto"

/** Filler cell style */
export const TABLE_CELL_FILLER = "p-0 h-full"

// ============================================================================
// Text Styles
// ============================================================================

/** Primary text - IDs, main content */
export const TEXT_PRIMARY = "text-xs text-foreground"

/** Muted text - secondary information */
export const TEXT_MUTED = "text-xs text-muted-foreground"

/** Mono font text - for IDs, code, technical values */
export const TEXT_MONO = "text-xs font-mono"

/** ID text style (clickable) */
export const TEXT_ID_LINK = "text-xs text-foreground font-mono hover:underline hover:text-primary focus:outline-none text-left truncate"

/** Payload preview text */
export const TEXT_PAYLOAD = "text-xs font-mono text-muted-foreground group-hover/payload:text-foreground transition-colors"

// ============================================================================
// Interactive Element Styles
// ============================================================================

/** Checkbox input style */
export const INPUT_CHECKBOX = "h-4 w-4 rounded border-gray-500 bg-gray-600 text-primary focus:ring-primary focus:ring-offset-background cursor-pointer align-middle accent-primary"

/** Copy button style (appears on hover) */
export const BUTTON_COPY = "opacity-0 transition-opacity p-0.5 hover:bg-muted rounded flex-shrink-0"

/** Copy button visible on ID hover */
export const BUTTON_COPY_ID = `${BUTTON_COPY} group-hover/id:opacity-100`

/** Copy button visible on payload hover */
export const BUTTON_COPY_PAYLOAD = `${BUTTON_COPY} group-hover/payload:opacity-100`

/** Action button in table row */
export const BUTTON_ACTION = "text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all rounded-full h-8 w-8"

/** Filter button style */
export const BUTTON_FILTER = "h-7 w-7 relative"

/** Filter button active state */
export const BUTTON_FILTER_ACTIVE = "bg-primary/10 text-primary"

/** Filter indicator dot */
export const FILTER_INDICATOR_DOT = "absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full"

// ============================================================================
// Layout Styles
// ============================================================================

/** Table container wrapper */
export const TABLE_CONTAINER = "flex flex-col flex-1 min-h-0"

/** Scroll area for table */
export const SCROLL_AREA = "relative flex-1 min-h-0"

/** Scroll area viewport background */
export const SCROLL_AREA_VIEWPORT = "bg-card"

/** Scroll bar offset for sticky headers */
export const SCROLL_BAR = "mt-12 h-[calc(100%-3rem)]"

/** Flex container for inline elements */
export const FLEX_INLINE = "flex items-center gap-1"

/** Flex container for actions */
export const FLEX_ACTIONS = "flex justify-end gap-1"

// ============================================================================
// Sort Icon Styles
// ============================================================================

/** Sort icon base size */
export const SORT_ICON = "h-3 w-3"

/** Inactive sort icon */
export const SORT_ICON_INACTIVE = "h-3 w-3 text-muted-foreground opacity-50"

// ============================================================================
// Tooltip Styles
// ============================================================================

/** Payload tooltip content */
export const TOOLTIP_PAYLOAD = "max-w-[400px] max-h-[300px] overflow-auto p-0"

/** Code block inside tooltip */
export const TOOLTIP_CODE = "text-xs p-3 rounded-md bg-slate-950 text-slate-50 overflow-auto"

// ============================================================================
// Filter Popover Styles (legacy - for components still using popover)
// ============================================================================

/** Filter popover content */
export const FILTER_POPOVER = "w-72 p-4"

/** Filter label */
export const FILTER_LABEL = "text-xs font-medium text-foreground/80"

/** Filter input with search icon */
export const FILTER_INPUT = "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-8 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"

/** Clear filters button */
export const FILTER_CLEAR_BUTTON = "h-7 text-xs text-muted-foreground hover:text-foreground"

// ============================================================================
// Filter Bar Styles (expanded filter display above table)
// ============================================================================

/** Filter bar container */
export const FILTER_BAR = "flex flex-wrap items-center gap-3 px-6 py-3 border-b bg-muted/5"

/** Filter bar item wrapper */
export const FILTER_BAR_ITEM = "flex items-center gap-2"

/** Filter bar input (compact) */
export const FILTER_BAR_INPUT = "h-8 text-sm"

/** Filter bar search input with icon */
export const FILTER_BAR_SEARCH = "h-8 w-[200px] pl-8 text-sm"

/** Filter bar text input (standard text/number inputs) */
export const FILTER_BAR_TEXT_INPUT = "h-8 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"

/** Filter bar select trigger */
export const FILTER_BAR_SELECT = "h-8 w-[120px] text-sm"

/** Filter bar date picker */
export const FILTER_BAR_DATE = "h-8 w-[140px] text-sm"

/** Filter bar clear button */
export const FILTER_BAR_CLEAR = "h-8 text-xs text-muted-foreground hover:text-foreground"

/** Filter bar active indicator */
export const FILTER_BAR_ACTIVE = "flex items-center gap-2 text-xs text-primary"

// ============================================================================
// Badge Styles
// ============================================================================

/** Type badge style */
export const BADGE_TYPE = "font-medium whitespace-nowrap"

// ============================================================================
// Empty State Styles
// ============================================================================

/** Empty state container */
export const EMPTY_STATE_CONTAINER = "flex flex-col items-center justify-center py-20 px-4 text-center animate-in fade-in zoom-in duration-300"

/** Empty state icon container */
export const EMPTY_STATE_ICON_CONTAINER = "bg-muted/30 p-6 rounded-full mb-6 ring-8 ring-muted/10"

/** Empty state icon */
export const EMPTY_STATE_ICON = "h-10 w-10"

/** Empty state title */
export const EMPTY_STATE_TITLE = "text-xl font-bold text-foreground mb-2"

/** Empty state description */
export const EMPTY_STATE_DESCRIPTION = "text-sm text-muted-foreground max-w-[400px] mb-8 leading-relaxed"

/** Active filters indicator */
export const EMPTY_STATE_FILTERS_LABEL = "text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70"

/** Active filters value */
export const EMPTY_STATE_FILTERS_VALUE = "font-mono text-[11px] px-3 py-1 rounded-md border bg-muted/20 border-border/50 text-muted-foreground"

// ============================================================================
// Pagination Footer Styles
// ============================================================================

/** Pagination footer container */
export const PAGINATION_FOOTER = "shrink-0 flex items-center justify-between px-6 py-4 border-t bg-muted/5"

/** Pagination button */
export const PAGINATION_BUTTON = "h-8 w-8 p-0"

/** Pagination info text */
export const PAGINATION_INFO = "text-sm font-medium"

/** Rows per page label */
export const PAGINATION_LABEL = "text-sm font-medium text-muted-foreground"
