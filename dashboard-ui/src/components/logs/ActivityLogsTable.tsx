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
    cn
} from "@/components/queue/QueueTableBase"
import {
    useElementHeight,
    useVirtualization
} from "@/components/ui/data-table"
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
            className={cn(
                "sticky top-0 z-20 bg-card font-semibold text-foreground text-xs cursor-pointer select-none hover:bg-muted/50 transition-colors",
                className
            )}
            onClick={() => onSort(column)}
        >
            <div className="flex items-center gap-1">
                <span>{label}</span>
                {isActive ? (
                    currentSort.direction === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                    ) : (
                        <ArrowDown className="h-3 w-3" />
                    )
                ) : (
                    <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
                )}
            </div>
        </TableHead>
    )
}

// ============================================================================
// Activity Log Row Component
// ============================================================================

const ActivityLogRow = React.memo(({
    log,
    formatTime,
    onViewMessageHistory
}: {
    log: ActivityLogEntry,
    formatTime: (ts?: number) => string,
    onViewMessageHistory?: (messageId: string) => void
}) => (
    <TableRow className={cn(
        "group transition-colors duration-150 border-muted/30",
        log.anomaly && log.anomaly.severity === 'critical' && "bg-destructive/5"
    )}>
        <TableCell className="max-w-[120px] group/id">
            {log.message_id ? (
                <div className="flex items-center gap-1">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => onViewMessageHistory?.(log.message_id!)}
                                className="text-xs text-foreground font-mono hover:text-primary hover:underline cursor-pointer truncate"
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
                        className="opacity-0 group-hover/id:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded flex-shrink-0"
                        tabIndex={-1}
                        title="Copy ID"
                    >
                        <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                </div>
            ) : (
                <span className="text-muted-foreground text-xs">—</span>
            )}
        </TableCell>
        <TableCell className="text-xs text-foreground whitespace-nowrap">
            {formatTime(log.timestamp)}
        </TableCell>
        <TableCell>{getActionBadge(log.action)}</TableCell>
        <TableCell className="text-xs text-foreground">
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
        <TableCell className="text-xs font-mono text-foreground" title={log.consumer_id || ''}>
            {log.consumer_id || '—'}
        </TableCell>
        <TableCell className="max-w-[200px] cursor-default group/payload">
            {log.payload ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <div className="flex items-center gap-1">
                            <span className="text-xs font-mono truncate text-muted-foreground group-hover/payload:text-foreground transition-colors">
                                {JSON.stringify(log.payload)}
                            </span>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation()
                                    e.preventDefault()
                                    navigator.clipboard.writeText(JSON.stringify(log.payload, null, 2))
                                    toast.success("Payload copied to clipboard")
                                }}
                                className="opacity-0 group-hover/payload:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded flex-shrink-0"
                                tabIndex={-1}
                                title="Copy payload"
                            >
                                <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                            </button>
                        </div>
                    </TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[400px] max-h-[300px] overflow-auto p-0">
                        <pre className="text-xs p-3 rounded-md bg-slate-950 text-slate-50 overflow-auto">
                            <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(JSON.stringify(log.payload, null, 2)) }} />
                        </pre>
                    </TooltipContent>
                </Tooltip>
            ) : (
                <span className="text-muted-foreground text-xs">—</span>
            )}
        </TableCell>
    </TableRow>
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
        />
    )

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <ScrollArea
                viewportRef={scrollContainerRef}
                className="relative flex-1 min-h-0"
                viewportClassName="bg-card"
                scrollBarClassName="mt-12 h-[calc(100%-3rem)]"
                onScroll={shouldVirtualize ? (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop) : undefined}
            >
                <div
                    style={shouldVirtualize && virtual ? { height: virtual.totalHeight + 48 } : undefined}
                >
                    <Table>
                        <TableHeader>
                            <TableRow className="hover:bg-transparent border-b border-border/50">
                                <SortableHeader column="message_id" label="Message ID" currentSort={sort} onSort={handleSort} className="w-[120px]" />
                                <SortableHeader column="timestamp" label="Timestamp" currentSort={sort} onSort={handleSort} className="w-[180px]" />
                                <SortableHeader column="action" label="Action" currentSort={sort} onSort={handleSort} className="w-[90px]" />
                                <SortableHeader column="queue" label="Queue" currentSort={sort} onSort={handleSort} className="w-[100px]" />
                                <SortableHeader column="consumer_id" label="Consumer" currentSort={sort} onSort={handleSort} className="w-[180px]" />
                                <SortableHeader column="payload" label="Payload" currentSort={sort} onSort={handleSort} />
                                {hasFilterProps && (
                                    <TableHead className="sticky top-0 z-20 bg-card text-right pr-2 w-[50px]">
                                        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className={cn("h-7 w-7 relative", isFilterActive && "bg-primary/10 text-primary")}
                                                    aria-label="Log Filters"
                                                >
                                                    <Filter className="h-3.5 w-3.5" />
                                                    {isFilterActive && (
                                                        <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full" />
                                                    )}
                                                </Button>
                                            </PopoverTrigger>
                                            <PopoverContent className="w-72 p-4" align="end">
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
                                                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                                            >
                                                                Clear all
                                                            </Button>
                                                        )}
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="text-xs font-medium text-foreground/80">Message ID</label>
                                                        <div className="relative">
                                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                            <input
                                                                placeholder="Search by message ID..."
                                                                value={filterMessageId || ''}
                                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterMessageId!(e.target.value)}
                                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-8 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="text-xs font-medium text-foreground/80">Action</label>
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
                                                        <label className="text-xs font-medium text-foreground/80">Has Anomaly</label>
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
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={colSpan} className="h-[400px] p-0">
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
                                        <TableRow className="hover:bg-transparent" style={{ height: virtual.topSpacerHeight }}>
                                            <TableCell colSpan={colSpan} className="p-0 h-auto" />
                                        </TableRow>
                                    )}
                                    {virtual.visibleItems.map(renderRow)}
                                    {virtual.bottomSpacerHeight > 0 && (
                                        <TableRow className="hover:bg-transparent" style={{ height: virtual.bottomSpacerHeight }}>
                                            <TableCell colSpan={colSpan} className="p-0 h-auto" />
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
