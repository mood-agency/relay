import React, { useState, useEffect, useRef, useCallback } from "react"
import { createPortal } from "react-dom"
import { Edit, Copy, Search, Inbox, Filter, Loader2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    SortableHeader,
    PaginationFooter,
    EmptyState,
    useElementHeight,
    useVirtualization,
    StaticHeader
} from "@/components/ui/data-table"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Badge } from "@/components/ui/badge"
import { toast } from "@/components/ui/sonner"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import * as tableStyles from "@/components/ui/table-styles"

import { Message, QueueConfig, syntaxHighlightJson } from "./types"

// ============================================================================
// Shared Types
// ============================================================================

export interface BaseQueueTableProps {
    messages: Message[]
    config?: QueueConfig | null
    onDelete: (id: string) => void
    onEdit?: (message: Message) => void
    onViewPayload: (payload: any) => void
    formatTime: (ts?: number) => string
    pageSize: string
    setPageSize: (size: string) => void
    selectedIds: Set<string>
    onToggleSelect: (id: string, shiftKey?: boolean) => void
    onToggleSelectAll: (ids: string[]) => void
    currentPage: number
    setCurrentPage: (page: number) => void
    totalPages: number
    totalItems: number
    sortBy: string
    sortOrder: string
    onSort: (field: string) => void
    scrollResetKey: number
    highlightedIds: Set<string>
    isFilterActive?: boolean
    activeFiltersDescription?: string
    isLoading?: boolean
}

// ============================================================================
// Shared Hooks
// ============================================================================

export function useTableVirtualization(
    messages: Message[],
    scrollResetKey: number
) {
    const shouldVirtualize = messages.length >= 100
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const viewportHeight = useElementHeight(scrollContainerRef)
    const [scrollTop, setScrollTop] = useState(0)

    useEffect(() => {
        setScrollTop(0)
        if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
    }, [scrollResetKey])

    const virtual = useVirtualization({
        items: messages,
        scrollTop,
        viewportHeight,
        rowHeight: 24,
        overscan: 28,
        enabled: shouldVirtualize
    })

    return {
        shouldVirtualize,
        scrollContainerRef,
        setScrollTop,
        virtual
    }
}

export const getPriorityBadge = (p: number) => (
    <span className={tableStyles.TEXT_PRIMARY}>
        {p ?? 0}
    </span>
)

// ============================================================================
// Cursor-Following Tooltip Hook
// ============================================================================

export function useCursorTooltip(delay: number = 200) {
    const [isHovered, setIsHovered] = useState(false)
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 })
    const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

    const handleMouseEnter = useCallback(() => {
        hoverTimeoutRef.current = setTimeout(() => {
            setIsHovered(true)
        }, delay)
    }, [delay])

    const handleMouseLeave = useCallback(() => {
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current)
            hoverTimeoutRef.current = null
        }
        setIsHovered(false)
    }, [])

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        setMousePos({ x: e.clientX, y: e.clientY })
    }, [])

    useEffect(() => {
        return () => {
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current)
            }
        }
    }, [])

    return {
        isHovered,
        mousePos,
        handlers: {
            onMouseEnter: handleMouseEnter,
            onMouseLeave: handleMouseLeave,
            onMouseMove: handleMouseMove,
        }
    }
}

// ============================================================================
// Cursor-Following Tooltip Component
// ============================================================================

export const CursorTooltip = ({
    isVisible,
    mousePos,
    children
}: {
    isVisible: boolean
    mousePos: { x: number; y: number }
    children: React.ReactNode
}) => {
    if (!isVisible) return null

    return createPortal(
        <div
            className="fixed z-[100] overflow-hidden rounded-md border bg-popover shadow-md pointer-events-none"
            style={{
                left: mousePos.x + 12,
                top: mousePos.y + 12,
                maxWidth: 400,
                maxHeight: 300,
            }}
        >
            {children}
        </div>,
        document.body
    )
}

// ============================================================================
// Loading Overlay Component
// ============================================================================

export const LoadingOverlay = () => (
    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
    </div>
)

// ============================================================================
// Filter Popover Component
// ============================================================================

export interface FilterPopoverProps {
    isOpen: boolean
    onOpenChange: (open: boolean) => void
    isFilterActive: boolean
    onClearFilters: () => void
    title?: string
    children: React.ReactNode
}

export const FilterPopover = ({
    isOpen,
    onOpenChange,
    isFilterActive,
    onClearFilters,
    title = "Filters",
    children
}: FilterPopoverProps) => (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
            <Button
                variant="ghost"
                size="icon"
                className={cn(tableStyles.BUTTON_FILTER, isFilterActive && tableStyles.BUTTON_FILTER_ACTIVE)}
                aria-label={title}
            >
                <Filter className="h-3.5 w-3.5" />
                {isFilterActive && (
                    <span className={tableStyles.FILTER_INDICATOR_DOT} />
                )}
            </Button>
        </PopoverTrigger>
        <PopoverContent className={tableStyles.FILTER_POPOVER} align="end">
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <h4 className="font-medium text-sm">{title}</h4>
                    {isFilterActive && (
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={onClearFilters}
                            className={tableStyles.FILTER_CLEAR_BUTTON}
                        >
                            Clear all
                        </Button>
                    )}
                </div>
                {children}
            </div>
        </PopoverContent>
    </Popover>
)

// ============================================================================
// Table Container Component
// ============================================================================

export interface TableContainerProps {
    children: React.ReactNode
    loading?: boolean
    footer?: React.ReactNode
    className?: string
}

export const TableContainer = ({
    children,
    loading = false,
    footer,
    className
}: TableContainerProps) => (
    <div className={cn(tableStyles.TABLE_CONTAINER, className)}>
        {loading && <LoadingOverlay />}
        {children}
        {footer}
    </div>
)

// ============================================================================
// Summary Footer Component
// ============================================================================

export interface SummaryFooterItem {
    label: string
    value: string | number
    color?: string // Tailwind color class for indicator dot, e.g., "bg-destructive"
}

export interface SummaryFooterProps {
    items: SummaryFooterItem[]
    rightContent?: React.ReactNode
    className?: string
}

export const SummaryFooter = ({
    items,
    rightContent,
    className
}: SummaryFooterProps) => (
    <div className={cn(tableStyles.PAGINATION_FOOTER, className)}>
        <div className="flex items-center gap-6">
            {items.map((item, idx) => (
                <div key={idx} className="flex items-center gap-1.5">
                    {item.color && (
                        <span className={cn("h-2 w-2 rounded-full", item.color)} />
                    )}
                    <span className={item.color ? tableStyles.TEXT_MUTED : tableStyles.PAGINATION_LABEL}>
                        {item.label}:
                    </span>
                    <span className={item.color ? tableStyles.TEXT_MUTED : tableStyles.PAGINATION_INFO}>
                        {typeof item.value === 'number' ? item.value.toLocaleString() : item.value}
                    </span>
                </div>
            ))}
        </div>
        {rightContent}
    </div>
)

// ============================================================================
// Copyable ID Cell Component (for non-message contexts)
// ============================================================================

export interface CopyableIdCellProps {
    id: string
    truncateLength?: number
    className?: string
}

export const CopyableIdCell = React.memo(({
    id,
    truncateLength = 10,
    className
}: CopyableIdCellProps) => (
    <TableCell className={cn(tableStyles.TEXT_MONO, tableStyles.TABLE_CELL_ID, className)}>
        <div className={tableStyles.FLEX_INLINE}>
            <span className="truncate" title={id}>
                {truncateLength > 0 && id.length > truncateLength ? id.substring(0, truncateLength) : id}
            </span>
            <button
                onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    navigator.clipboard.writeText(id)
                    toast.success("ID copied to clipboard")
                }}
                className={tableStyles.BUTTON_COPY_ID}
                tabIndex={-1}
                title="Copy ID"
            >
                <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
            </button>
        </div>
    </TableCell>
))

// ============================================================================
// Shared Components
// ============================================================================

export const PayloadCell = React.memo(({ payload, toastMessage = "Copied to clipboard" }: { payload: any, toastMessage?: string }) => {
    const payloadText = JSON.stringify(payload)
    const { isHovered, mousePos, handlers } = useCursorTooltip()

    return (
        <>
            <TableCell
                className={tableStyles.TABLE_CELL_PAYLOAD}
                {...handlers}
            >
                <div className={tableStyles.FLEX_INLINE}>
                    <div className={cn("truncate", tableStyles.TEXT_PAYLOAD)}>
                        {payloadText}
                    </div>
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            e.preventDefault();
                            navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
                            toast.success(toastMessage);
                            (e.target as HTMLElement).closest('button')?.blur();
                        }}
                        className={tableStyles.BUTTON_COPY_PAYLOAD}
                        tabIndex={-1}
                        title="Copy payload"
                    >
                        <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                </div>
            </TableCell>
            <CursorTooltip isVisible={isHovered} mousePos={mousePos}>
                <pre className={tableStyles.TOOLTIP_CODE}>
                    <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(JSON.stringify(payload, null, 2)) }} />
                </pre>
            </CursorTooltip>
        </>
    )
})

export const ActionsCell = React.memo(({
    msg,
    onEdit
}: {
    msg: Message,
    onEdit?: (message: Message) => void
}) => (
    <TableCell className={tableStyles.TABLE_CELL_ACTIONS}>
        <div className={tableStyles.FLEX_ACTIONS}>
            {onEdit && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation()
                        onEdit(msg)
                    }}
                    className={tableStyles.BUTTON_ACTION}
                    title="Edit Message"
                >
                    <Edit className="h-4 w-4" />
                    <span className="sr-only">Edit</span>
                </Button>
            )}
        </div>
    </TableCell>
))

export const SelectCell = React.memo(({
    id,
    isSelected,
    onToggleSelect
}: {
    id: string,
    isSelected: boolean,
    onToggleSelect: (id: string, shiftKey?: boolean) => void
}) => (
    <TableCell>
        <input
            type="checkbox"
            className={tableStyles.INPUT_CHECKBOX}
            checked={isSelected}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                e.stopPropagation()
                onToggleSelect(id, (e.nativeEvent as any)?.shiftKey === true)
            }}
        />
    </TableCell>
))

export const IdCell = React.memo(({
    id,
    msg,
    onEdit
}: {
    id: string,
    msg?: Message,
    onEdit?: (message: Message) => void
}) => (
    <TableCell className={tableStyles.TABLE_CELL_ID}>
        <div className={tableStyles.FLEX_INLINE}>
            {onEdit && msg ? (
                <button
                    onClick={(e) => {
                        e.stopPropagation()
                        onEdit(msg)
                    }}
                    className={tableStyles.TEXT_ID_LINK}
                    title={`Edit ${id}`}
                >
                    {id}
                </button>
            ) : (
                <span className={cn(tableStyles.TEXT_MONO, "text-foreground truncate")} title={id}>
                    {id}
                </span>
            )}
            <button
                onClick={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                    navigator.clipboard.writeText(id)
                    toast.success("ID copied to clipboard")
                }}
                className={tableStyles.BUTTON_COPY_ID}
                tabIndex={-1}
                title="Copy ID"
            >
                <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
            </button>
        </div>
    </TableCell>
))

export const TypeCell = React.memo(({ type }: { type: string }) => (
    <TableCell className="text-left">
        <Badge variant="outline" className={tableStyles.BADGE_TYPE}>{type}</Badge>
    </TableCell>
))

export const PriorityCell = React.memo(({ priority }: { priority: number }) => (
    <TableCell className="text-left">{getPriorityBadge(priority)}</TableCell>
))

export const AttemptsCell = React.memo(({
    attemptCount,
    maxAttempts,
    defaultAttempts = 1
}: {
    attemptCount?: number,
    maxAttempts?: number,
    defaultAttempts?: number
}) => (
    <TableCell>
        <span className={cn(tableStyles.TEXT_PRIMARY, "pl-4 block")}>
            {attemptCount || defaultAttempts}
            {maxAttempts && (
                <span className="text-muted-foreground"> / {maxAttempts}</span>
            )}
        </span>
    </TableCell>
))

export const AckTimeoutCell = React.memo(({
    customTimeout,
    configTimeout
}: {
    customTimeout?: number,
    configTimeout?: number
}) => (
    <TableCell className={tableStyles.TABLE_CELL_TIME}>
        {customTimeout ?? configTimeout ?? 60}s
    </TableCell>
))

export const TimeCell = React.memo(({
    timestamp,
    formatTime
}: {
    timestamp?: number,
    formatTime: (ts?: number) => string
}) => (
    <TableCell className={tableStyles.TABLE_CELL_TIME}>
        {formatTime(timestamp)}
    </TableCell>
))

// ============================================================================
// Table Wrapper Components
// ============================================================================

interface TableWrapperProps {
    children: React.ReactNode
    messages: Message[]
    colSpan: number
    isLoading?: boolean
    isFilterActive?: boolean
    activeFiltersDescription?: string
    shouldVirtualize: boolean
    scrollContainerRef: React.Ref<HTMLDivElement>
    setScrollTop: (top: number) => void
}

export const TableWrapper = ({
    children,
    messages,
    colSpan,
    isLoading,
    isFilterActive,
    activeFiltersDescription,
    shouldVirtualize,
    scrollContainerRef,
    setScrollTop
}: TableWrapperProps) => (
    <ScrollArea
        viewportRef={scrollContainerRef}
        className={tableStyles.SCROLL_AREA}
        scrollBarClassName={tableStyles.SCROLL_BAR}
        onScroll={shouldVirtualize ? (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop) : undefined}
    >
        <Table>
            {children}
        </Table>
    </ScrollArea>
)

interface EmptyTableBodyProps {
    colSpan: number
    isLoading?: boolean
    isFilterActive?: boolean
    activeFiltersDescription?: string
}

export const EmptyTableBody = ({
    colSpan,
    isLoading,
    isFilterActive,
    activeFiltersDescription
}: EmptyTableBodyProps) => (
    !isLoading ? (
        <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
            <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_EMPTY}>
                <EmptyState
                    icon={isFilterActive ? Search : Inbox}
                    title="No messages found"
                    description="There are no messages in this queue at the moment."
                    isFilterActive={isFilterActive}
                    activeFiltersDescription={activeFiltersDescription}
                />
            </TableCell>
        </TableRow>
    ) : null
)

// Filler row to fill remaining space at the bottom of the table
export const TableFillerRow = ({ colSpan }: { colSpan: number }) => (
    <TableRow className={tableStyles.TABLE_ROW_FILLER}>
        <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_FILLER} style={{ height: '100%' }} />
    </TableRow>
)

// ============================================================================
// Highlightable Table Row - Wrapper that applies highlight animation
// ============================================================================

export interface HighlightableTableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {
    isHighlighted?: boolean
    isSelected?: boolean
    isCritical?: boolean
    children: React.ReactNode
}

export const HighlightableTableRow = React.memo(React.forwardRef<HTMLTableRowElement, HighlightableTableRowProps>(({
    isHighlighted = false,
    isSelected = false,
    isCritical = false,
    className,
    children,
    ...props
}, ref) => (
    <TableRow
        ref={ref}
        className={cn(
            tableStyles.TABLE_ROW_BASE,
            isHighlighted && tableStyles.TABLE_ROW_HIGHLIGHTED,
            isSelected && tableStyles.TABLE_ROW_SELECTED,
            isCritical && tableStyles.TABLE_ROW_CRITICAL,
            className
        )}
        {...props}
    >
        {children}
    </TableRow>
)))

// Re-export commonly used components
export {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    SortableHeader,
    StaticHeader,
    PaginationFooter,
    EmptyState,
    ScrollArea,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    Button,
    Badge,
    Copy,
    Edit,
    Filter,
    Loader2,
    cn,
    // Hooks from data-table
    useElementHeight,
    useVirtualization
}

// Re-export Popover components
export { Popover, PopoverContent, PopoverTrigger }

export type { Message, QueueConfig }

// Re-export table styles for use in other components
export { tableStyles }
