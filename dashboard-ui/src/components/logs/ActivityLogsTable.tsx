import React, { useState, useEffect, useRef, useMemo } from "react"
import { ArrowRight, Search, FileText, ArrowUp, ArrowDown, ArrowUpDown } from "lucide-react"

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

import { ActivityLogEntry } from "./types"
import { getActionBadge, getSeverityBadge } from "./helpers"

// ============================================================================
// Sort Types and Helpers
// ============================================================================

type SortColumn = 'message_id' | 'timestamp' | 'action' | 'queue' | 'consumer_id' | 'timing' | 'severity' | 'type' | 'payload'
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
        <TableCell className="max-w-[120px]">
            {log.message_id ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <button
                            onClick={() => onViewMessageHistory?.(log.message_id!)}
                            className="text-xs text-foreground font-mono hover:text-primary hover:underline cursor-pointer truncate block max-w-full"
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
        <TableCell className="text-xs text-foreground whitespace-nowrap">
            {log.time_in_queue_ms !== null && log.processing_time_ms !== null ? (
                <span>{Math.round(log.time_in_queue_ms)}ms / {Math.round(log.processing_time_ms)}ms</span>
            ) : log.time_in_queue_ms !== null ? (
                <span>{Math.round(log.time_in_queue_ms)}ms</span>
            ) : log.processing_time_ms !== null ? (
                <span>{Math.round(log.processing_time_ms)}ms</span>
            ) : (
                <span className="text-muted-foreground">—</span>
            )}
        </TableCell>
        <TableCell>
            {log.anomaly ? (
                getSeverityBadge(log.anomaly.severity)
            ) : (
                <span className="text-muted-foreground text-xs">—</span>
            )}
        </TableCell>
        <TableCell>
            {log.anomaly ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-xs cursor-help">{log.anomaly.type}</span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-sm">
                        <p className="font-medium">{log.anomaly.type}</p>
                        <p className="text-xs text-muted-foreground">{log.anomaly.description}</p>
                    </TooltipContent>
                </Tooltip>
            ) : (
                <span className="text-muted-foreground text-xs">—</span>
            )}
        </TableCell>
        <TableCell className="max-w-[200px]">
            {log.payload ? (
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span className="text-xs font-mono truncate block cursor-help opacity-70 hover:opacity-100 transition-opacity">
                            {JSON.stringify(log.payload)}
                        </span>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-[500px] overflow-auto max-h-[300px]">
                        <pre className="text-[10px] font-mono whitespace-pre-wrap">
                            {JSON.stringify(log.payload, null, 2)}
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
    onViewMessageHistory
}: ActivityLogsTableProps) => {
    const logsList = Array.isArray(logs) ? logs : []
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const viewportHeight = useElementHeight(scrollContainerRef)
    const [scrollTop, setScrollTop] = useState(0)
    const [sort, setSort] = useState<SortState>({ column: null, direction: 'desc' })
    const colSpan = 9

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
                case 'timing':
                    const aTime = (a.time_in_queue_ms ?? 0) + (a.processing_time_ms ?? 0)
                    const bTime = (b.time_in_queue_ms ?? 0) + (b.processing_time_ms ?? 0)
                    comparison = aTime - bTime
                    break
                case 'severity':
                    const severityOrder: Record<string, number> = { critical: 3, warning: 2, info: 1 }
                    const aSev = a.anomaly?.severity ? severityOrder[a.anomaly.severity] || 0 : 0
                    const bSev = b.anomaly?.severity ? severityOrder[b.anomaly.severity] || 0 : 0
                    comparison = aSev - bSev
                    break
                case 'type':
                    comparison = (a.anomaly?.type || '').localeCompare(b.anomaly?.type || '')
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
        rowHeight: 44,
        overscan: 8,
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
                scrollBarClassName="mt-12 h-[calc(100%-3rem)]"
                onScroll={shouldVirtualize ? (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop) : undefined}
            >
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            <SortableHeader column="message_id" label="Message ID" currentSort={sort} onSort={handleSort} className="w-[120px]" />
                            <SortableHeader column="timestamp" label="Timestamp" currentSort={sort} onSort={handleSort} className="w-[180px]" />
                            <SortableHeader column="action" label="Action" currentSort={sort} onSort={handleSort} className="w-[90px]" />
                            <SortableHeader column="queue" label="Queue" currentSort={sort} onSort={handleSort} className="w-[100px]" />
                            <SortableHeader column="consumer_id" label="Consumer" currentSort={sort} onSort={handleSort} className="w-[180px]" />
                            <SortableHeader column="timing" label="Timing" currentSort={sort} onSort={handleSort} className="w-[100px]" />
                            <SortableHeader column="severity" label="Severity" currentSort={sort} onSort={handleSort} className="w-[70px]" />
                            <SortableHeader column="type" label="Type" currentSort={sort} onSort={handleSort} className="w-[120px]" />
                            <SortableHeader column="payload" label="Payload" currentSort={sort} onSort={handleSort} />
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
                                <TableRow className="hover:bg-transparent" style={{ height: virtual.topSpacerHeight }}>
                                    <TableCell colSpan={colSpan} className="p-0" />
                                </TableRow>
                                {virtual.visibleItems.map(renderRow)}
                                <TableRow className="hover:bg-transparent" style={{ height: virtual.bottomSpacerHeight }}>
                                    <TableCell colSpan={colSpan} className="p-0" />
                                </TableRow>
                            </>
                        ) : (
                            sortedLogs.map(renderRow)
                        )}
                    </TableBody>
                </Table>
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
