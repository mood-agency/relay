import React, { useState, useEffect, useRef, useMemo } from "react"
import { ArrowRight, Search, FileText, ArrowUp, ArrowDown, ArrowUpDown, Copy, Filter } from "lucide-react"

import {
    Table,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
    TableCell,
    PaginationFooter,
    EmptyState,
    ScrollArea,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    Badge,
    cn,
    tableStyles,
    useCursorTooltip,
    CursorTooltip,
    HighlightableTableRow,
    useElementHeight,
    useVirtualization
} from "@/components/queue/QueueTableBase"
import { Button } from "@/components/ui/button"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"

import { toast } from "@/components/ui/sonner"
import { ActivityLogEntry } from "./types"
import { getActionBadge } from "./helpers"
import { syntaxHighlightJson } from "@/components/queue/types"

// ============================================================================
// Sort Types and Helpers
// ============================================================================

type SortColumn = 'message_id' | 'timestamp' | 'action' | 'queue' | 'consumer_id' | 'payload'
type SortDirection = 'asc' | 'desc'

interface SortState {
    column: SortColumn | null
    direction: SortDirection
}

const SortableHeader = ({
    column,
    label,
    currentSort,
    onSort,
    className
}: {
    column: SortColumn
    label: string
    currentSort: SortState
    onSort: (column: SortColumn) => void
    className?: string
}) => {
    const isActive = currentSort.column === column
    return (
        <TableHead
            className={cn(tableStyles.TABLE_HEADER_SORTABLE, className)}
            onClick={() => onSort(column)}
        >
            <div className={tableStyles.FLEX_INLINE}>
                <span>{label}</span>
                {isActive ? (
                    currentSort.direction === 'asc' ? (
                        <ArrowUp className={tableStyles.SORT_ICON} />
                    ) : (
                        <ArrowDown className={tableStyles.SORT_ICON} />
                    )
                ) : (
                    <ArrowUpDown className={tableStyles.SORT_ICON_INACTIVE} />
                )}
            </div>
        </TableHead>
    )
}

// ============================================================================
// Payload Cell with Cursor Tooltip for Activity Logs
// ============================================================================

const ActivityPayloadCell = React.memo(({ payload }: { payload: any }) => {
    const { isHovered, mousePos, handlers } = useCursorTooltip()

    return (
        <>
            <TableCell className={cn("max-w-[200px]", tableStyles.TABLE_CELL_PAYLOAD)} {...handlers}>
                <div className={tableStyles.FLEX_INLINE}>
                    <span className={cn("truncate", tableStyles.TEXT_PAYLOAD)}>
                        {JSON.stringify(payload)}
                    </span>
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
                            toast.success("Payload copied to clipboard")
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

// ============================================================================
// Activity Log Row Component
// ============================================================================

const ActivityLogRow = React.memo(({
    log,
    formatTime,
    onViewMessageHistory,
    isHighlighted = false
}: {
    log: ActivityLogEntry,
    formatTime: (ts?: number) => string,
    onViewMessageHistory?: (messageId: string) => void,
    isHighlighted?: boolean
}) => (
    <HighlightableTableRow
        isHighlighted={isHighlighted}
        isCritical={log.anomaly?.severity === 'critical'}
    >
        <TableCell className={cn("max-w-[120px]", tableStyles.TABLE_CELL_ID)}>
            {log.message_id ? (
                <div className={tableStyles.FLEX_INLINE}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => onViewMessageHistory?.(log.message_id!)}
                                className={tableStyles.TEXT_ID_LINK}
                                title={log.message_id}
                            >
                                {log.message_id}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="font-mono text-xs">{log.message_id}</p>
                            <p className="text-xs text-muted-foreground mt-1">Click to view full history</p>
                        </TooltipContent>
                    </Tooltip>
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            navigator.clipboard.writeText(log.message_id!)
                            toast.success("ID copied to clipboard")
                        }}
                        className={tableStyles.BUTTON_COPY_ID}
                        tabIndex={-1}
                        title="Copy ID"
                    >
                        <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                </div>
            ) : (
                <span className={tableStyles.TEXT_MUTED}>—</span>
            )}
        </TableCell>
        <TableCell className={tableStyles.TABLE_CELL_TIME}>
            {formatTime(log.timestamp)}
        </TableCell>
        <TableCell>{getActionBadge(log.action)}</TableCell>
        <TableCell className={tableStyles.TEXT_PRIMARY}>
            {log.source_queue && log.dest_queue ? (
                <span className="flex items-center gap-1">
                    <span>{log.source_queue}</span>
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <span>{log.dest_queue}</span>
                </span>
            ) : (
                log.queue
            )}
        </TableCell>
        <TableCell className={cn(tableStyles.TEXT_MONO, "text-foreground")} title={log.consumer_id || ''}>
            {log.consumer_id || '—'}
        </TableCell>
        {log.payload ? (
            <ActivityPayloadCell payload={log.payload} />
        ) : (
            <TableCell className={cn("max-w-[200px]", tableStyles.TABLE_CELL_PAYLOAD)}>
                <span className={tableStyles.TEXT_MUTED}>—</span>
            </TableCell>
        )}
    </HighlightableTableRow>
))

// ============================================================================
// Activity Logs Table Component
// ============================================================================

export interface ActivityLogsTableProps {
    logs: ActivityLogEntry[] | null | undefined
    loading: boolean
    formatTime: (ts?: number) => string
    pageSize: string
    setPageSize: (size: string) => void
    currentPage: number
    setCurrentPage: (page: number) => void
    totalPages: number
    totalItems: number
    scrollResetKey?: number
    isFilterActive?: boolean
    activeFiltersDescription?: string
    onViewMessageHistory?: (messageId: string) => void
    highlightedIds?: Set<string>
    // Filter props
    filterAction?: string
    setFilterAction?: (value: string) => void
    filterMessageId?: string
    setFilterMessageId?: (value: string) => void
    filterHasAnomaly?: boolean | null
    setFilterHasAnomaly?: (value: boolean | null) => void
}

export const ActivityLogsTable = React.memo(({
    logs,
    loading,
    formatTime,
    pageSize,
    setPageSize,
    currentPage,
    setCurrentPage,
    totalPages,
    totalItems,
    scrollResetKey,
    isFilterActive,
    activeFiltersDescription,
    onViewMessageHistory,
    highlightedIds,
    // Filter props
    filterAction,
    setFilterAction,
    filterMessageId,
    setFilterMessageId,
    filterHasAnomaly,
    setFilterHasAnomaly
}: ActivityLogsTableProps) => {
    const [filterOpen, setFilterOpen] = useState(false)
    const logsList = Array.isArray(logs) ? logs : []
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const viewportHeight = useElementHeight(scrollContainerRef)
    const [scrollTop, setScrollTop] = useState(0)
    const [sort, setSort] = useState<SortState>({ column: null, direction: 'desc' })

    // Check if filter props are provided
    const hasFilterProps = setFilterAction !== undefined && setFilterMessageId !== undefined
    const colSpan = hasFilterProps ? 7 : 6

    const handleSort = (column: SortColumn) => {
        setSort(prev => ({
            column,
            direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
        }))
    }

    const sortedLogs = useMemo(() => {
        if (!sort.column) return logsList

        return [...logsList].sort((a, b) => {
            let comparison = 0
            const dir = sort.direction === 'asc' ? 1 : -1

            switch (sort.column) {
                case 'message_id':
                    comparison = (a.message_id || '').localeCompare(b.message_id || '')
                    break
                case 'timestamp':
                    comparison = (a.timestamp || 0) - (b.timestamp || 0)
                    break
                case 'action':
                    comparison = (a.action || '').localeCompare(b.action || '')
                    break
                case 'queue':
                    comparison = (a.queue || '').localeCompare(b.queue || '')
                    break
                case 'consumer_id':
                    comparison = (a.consumer_id || '').localeCompare(b.consumer_id || '')
                    break
                case 'payload':
                    comparison = JSON.stringify(a.payload || '').localeCompare(JSON.stringify(b.payload || ''))
                    break
            }
            return comparison * dir
        })
    }, [logsList, sort])

    const shouldVirtualize = sortedLogs.length >= 100

    useEffect(() => {
        setScrollTop(0)
        if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
    }, [scrollResetKey, sort])

    const virtual = useVirtualization({
        items: sortedLogs,
        scrollTop,
        viewportHeight,
        rowHeight: 24,
        overscan: 28,
        enabled: shouldVirtualize
    })

    const renderRow = (log: ActivityLogEntry) => (
        <ActivityLogRow
            key={log.log_id}
            log={log}
            formatTime={formatTime}
            onViewMessageHistory={onViewMessageHistory}
            isHighlighted={highlightedIds?.has(log.log_id) ?? false}
        />
    )

    return (
        <div className={tableStyles.TABLE_CONTAINER}>
            <ScrollArea
                viewportRef={scrollContainerRef}
                className={tableStyles.SCROLL_AREA}
                viewportClassName={tableStyles.SCROLL_AREA_VIEWPORT}
                scrollBarClassName={tableStyles.SCROLL_BAR}
                onScroll={shouldVirtualize ? (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop) : undefined}
            >
                <div
                    style={shouldVirtualize && virtual ? { height: virtual.totalHeight + 48 } : undefined}
                >
                    <Table>
                        <TableHeader>
                            <TableRow className={tableStyles.TABLE_ROW_HEADER}>
                                <SortableHeader column="message_id" label="Message ID" currentSort={sort} onSort={handleSort} className="w-[120px]" />
                                <SortableHeader column="timestamp" label="Timestamp" currentSort={sort} onSort={handleSort} className="w-[180px]" />
                                <SortableHeader column="action" label="Action" currentSort={sort} onSort={handleSort} className="w-[90px]" />
                                <SortableHeader column="queue" label="Queue" currentSort={sort} onSort={handleSort} className="w-[100px]" />
                                <SortableHeader column="consumer_id" label="Actor" currentSort={sort} onSort={handleSort} className="w-[180px]" />
                                <SortableHeader column="payload" label="Payload" currentSort={sort} onSort={handleSort} />
                                {hasFilterProps && (
                                    <TableHead className={tableStyles.TABLE_HEADER_FILTER}>
                                        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className={cn(tableStyles.BUTTON_FILTER, isFilterActive && tableStyles.BUTTON_FILTER_ACTIVE)}
                                                    aria-label="Log Filters"
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
                                                        <h4 className="font-medium text-sm">Log Filters</h4>
                                                        {isFilterActive && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => {
                                                                    setFilterAction!("")
                                                                    setFilterMessageId!("")
                                                                    setFilterHasAnomaly!(null)
                                                                }}
                                                                className={tableStyles.FILTER_CLEAR_BUTTON}
                                                            >
                                                                Clear all
                                                            </Button>
                                                        )}
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className={tableStyles.FILTER_LABEL}>Message ID</label>
                                                        <div className="relative">
                                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                            <input
                                                                placeholder="Search by message ID..."
                                                                value={filterMessageId || ''}
                                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterMessageId!(e.target.value)}
                                                                className={tableStyles.FILTER_INPUT}
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className={tableStyles.FILTER_LABEL}>Action</label>
                                                        <Select value={filterAction || "any"} onValueChange={(val: string) => setFilterAction!(val === "any" ? "" : val)}>
                                                            <SelectTrigger className="w-full">
                                                                <SelectValue placeholder="Any" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="any">Any</SelectItem>
                                                                <SelectItem value="enqueue">Enqueue</SelectItem>
                                                                <SelectItem value="dequeue">Dequeue</SelectItem>
                                                                <SelectItem value="ack">Acknowledge</SelectItem>
                                                                <SelectItem value="nack">Negative Ack</SelectItem>
                                                                <SelectItem value="requeue">Requeue</SelectItem>
                                                                <SelectItem value="move">Move</SelectItem>
                                                                <SelectItem value="delete">Delete</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className={tableStyles.FILTER_LABEL}>Has Anomaly</label>
                                                        <Select
                                                            value={filterHasAnomaly === null ? "any" : filterHasAnomaly ? "yes" : "no"}
                                                            onValueChange={(val: string) => setFilterHasAnomaly!(val === "any" ? null : val === "yes")}
                                                        >
                                                            <SelectTrigger className="w-full">
                                                                <SelectValue placeholder="Any" />
                                                            </SelectTrigger>
                                                            <SelectContent>
                                                                <SelectItem value="any">Any</SelectItem>
                                                                <SelectItem value="yes">Yes</SelectItem>
                                                                <SelectItem value="no">No</SelectItem>
                                                            </SelectContent>
                                                        </Select>
                                                    </div>
                                                </div>
                                            </PopoverContent>
                                        </Popover>
                                    </TableHead>
                                )}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedLogs.length === 0 ? (
                                !loading && (
                                    <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                        <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_EMPTY}>
                                            <EmptyState
                                                icon={isFilterActive ? Search : FileText}
                                                title="No activity logs found"
                                                description="Activity will appear here as queue operations occur"
                                                isFilterActive={isFilterActive}
                                                activeFiltersDescription={activeFiltersDescription}
                                            />
                                        </TableCell>
                                    </TableRow>
                                )
                            ) : shouldVirtualize && virtual ? (
                                <>
                                    {virtual.topSpacerHeight > 0 && (
                                        <TableRow className={tableStyles.TABLE_ROW_SPACER} style={{ height: virtual.topSpacerHeight }}>
                                            <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_SPACER} />
                                        </TableRow>
                                    )}
                                    {virtual.visibleItems.map(renderRow)}
                                    {virtual.bottomSpacerHeight > 0 && (
                                        <TableRow className={tableStyles.TABLE_ROW_SPACER} style={{ height: virtual.bottomSpacerHeight }}>
                                            <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_SPACER} />
                                        </TableRow>
                                    )}
                                </>
                            ) : (
                                sortedLogs.map(renderRow)
                            )}
                        </TableBody>
                    </Table>
                </div>
            </ScrollArea>
            {totalPages > 0 && (
                <PaginationFooter
                    pageSize={pageSize}
                    setPageSize={setPageSize}
                    currentPage={currentPage}
                    totalPages={totalPages}
                    setCurrentPage={setCurrentPage}
                    totalItems={totalItems}
                />
            )}
        </div>
    )
})
