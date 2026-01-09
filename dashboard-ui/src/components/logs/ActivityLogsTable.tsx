import React, { useState, useRef, useCallback } from "react"
import {
    Loader2,
    Filter,
    Search,
    ArrowRightLeft,
    Clock,
    Zap,
    FileText
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import {
    PaginationFooter,
    EmptyState,
    useElementHeight,
    useVirtualization
} from "@/components/ui/data-table"

import {
    ActivityLogEntry,
    ActivityLogsResponse,
    ActivityLogsFilter,
    ACTION_OPTIONS
} from "./types"
import { getActionBadge, getSeverityBadge } from "./helpers"

// ============================================================================
// Activity Log Row Component
// ============================================================================

const ActivityLogRow = React.memo(({
    log,
    formatTime,
    onViewMessageHistory,
    getActionBadge,
    getSeverityBadge
}: {
    log: ActivityLogEntry,
    formatTime: (ts?: number) => string,
    onViewMessageHistory?: (messageId: string) => void,
    getActionBadge: (action: string) => React.ReactNode,
    getSeverityBadge: (severity: string) => React.ReactNode
}) => {
    return (
        <TableRow className={cn(
            "hover:bg-muted/50",
            log.anomaly && log.anomaly.severity === 'critical' && "bg-destructive/5"
        )}>
            <TableCell className="text-xs font-mono text-muted-foreground">
                {formatTime(log.timestamp)}
            </TableCell>
            <TableCell>{getActionBadge(log.action)}</TableCell>
            <TableCell className="font-mono text-xs">
                {log.message_id ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => onViewMessageHistory?.(log.message_id!)}
                                className="truncate max-w-[200px] block text-left hover:text-primary hover:underline cursor-pointer"
                            >
                                {log.message_id.substring(0, 12)}...
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="font-mono text-xs">{log.message_id}</p>
                            <p className="text-xs text-muted-foreground mt-1">Click to view full history</p>
                        </TooltipContent>
                    </Tooltip>
                ) : (
                    <span className="text-muted-foreground">—</span>
                )}
            </TableCell>
            <TableCell className="text-xs">
                {log.source_queue && log.dest_queue ? (
                    <span className="flex items-center gap-1">
                        <span>{log.source_queue}</span>
                        <ArrowRightLeft className="h-3 w-3 text-muted-foreground" />
                        <span>{log.dest_queue}</span>
                    </span>
                ) : (
                    log.queue
                )}
            </TableCell>
            <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-[100px]" title={log.consumer_id || ''}>
                {log.consumer_id?.substring(0, 12) || '—'}
            </TableCell>
            <TableCell className="text-xs">
                {log.time_in_queue_ms !== null && (
                    <span className="text-muted-foreground" title="Time in queue">
                        <Clock className="h-3 w-3 inline mr-1" />
                        {log.time_in_queue_ms}ms
                    </span>
                )}
                {log.processing_time_ms !== null && (
                    <span className="text-muted-foreground ml-2" title="Processing time">
                        <Zap className="h-3 w-3 inline mr-1" />
                        {log.processing_time_ms}ms
                    </span>
                )}
            </TableCell>
            <TableCell>
                {log.anomaly ? (
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <div className="flex items-center gap-1 cursor-help">
                                {getSeverityBadge(log.anomaly.severity)}
                                <span className="text-xs truncate max-w-[100px]">{log.anomaly.type}</span>
                            </div>
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
            <TableCell />
        </TableRow>
    )
})

// ============================================================================
// Activity Logs Table Component
// ============================================================================

export interface ActivityLogsTableProps {
    logs: ActivityLogsResponse | null
    loading: boolean
    filter: ActivityLogsFilter
    setFilter: React.Dispatch<React.SetStateAction<ActivityLogsFilter>>
    onRefresh: () => void
    formatTime: (ts?: number) => string
    onViewMessageHistory?: (messageId: string) => void
}

export function ActivityLogsTable({
    logs,
    loading,
    filter,
    setFilter,
    onRefresh,
    formatTime,
    onViewMessageHistory
}: ActivityLogsTableProps) {
    const [filterOpen, setFilterOpen] = useState(false)
    const isFilterActive = filter.action !== '' || filter.message_id !== '' || filter.has_anomaly !== null

    const getSeverityBadgeMemo = useCallback((severity: string) => getSeverityBadge(severity), [])
    const getActionBadgeMemo = useCallback((action: string) => getActionBadge(action), [])

    const currentPage = Math.floor(filter.offset / filter.limit) + 1
    const totalPages = logs ? Math.ceil(logs.pagination.total / filter.limit) : 0
    const logsList = logs?.logs || []

    // Virtualization
    const shouldVirtualize = logsList.length >= 100
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const viewportHeight = useElementHeight(scrollContainerRef)
    const [scrollTop, setScrollTop] = useState(0)

    const virtual = useVirtualization({
        items: logsList,
        scrollTop,
        viewportHeight,
        rowHeight: 44,
        overscan: 8,
        enabled: shouldVirtualize
    })

    const colSpan = 8

    // Pagination adapter for offset-based pagination
    const handleSetCurrentPage = useCallback((page: number) => {
        setFilter(prev => ({ ...prev, offset: (page - 1) * prev.limit }))
    }, [setFilter])

    const handleSetPageSize = useCallback((size: string) => {
        setFilter(prev => ({ ...prev, limit: Number(size), offset: 0 }))
    }, [setFilter])

    return (
        <div className="flex flex-col flex-1 min-h-0">
            <ScrollArea
                viewportRef={scrollContainerRef}
                className="relative flex-1 min-h-0"
                scrollBarClassName="mt-12 h-[calc(100%-3rem)]"
                onScroll={shouldVirtualize ? (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop) : undefined}
            >
                {loading && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                )}
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[180px]">Timestamp</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[90px]">Action</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Message ID</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[100px]">Queue</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[100px]">Consumer</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[120px]">Timing</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Anomaly</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card text-right pr-2">
                                <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={cn("h-7 w-7 relative", isFilterActive && "bg-primary/10 text-primary")}
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
                                                <h4 className="font-medium text-sm">Filters</h4>
                                                {isFilterActive && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => {
                                                            setFilter(prev => ({ ...prev, action: '', message_id: '', has_anomaly: null, offset: 0 }))
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
                                                        type="text"
                                                        placeholder="Filter by ID..."
                                                        value={filter.message_id}
                                                        onChange={(e) => setFilter(prev => ({ ...prev, message_id: e.target.value, offset: 0 }))}
                                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-8 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                                                    />
                                                </div>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Action</label>
                                                <Select value={filter.action || 'all'} onValueChange={(val) => setFilter(prev => ({ ...prev, action: val === 'all' ? '' : val, offset: 0 }))}>
                                                    <SelectTrigger className="w-full h-9">
                                                        <SelectValue placeholder="All Actions" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">All Actions</SelectItem>
                                                        {ACTION_OPTIONS.map((action) => (
                                                            <SelectItem key={action} value={action}>{action}</SelectItem>
                                                        ))}
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Anomaly</label>
                                                <Select 
                                                    value={filter.has_anomaly === null ? 'all' : filter.has_anomaly ? 'yes' : 'no'} 
                                                    onValueChange={(val) => setFilter(prev => ({ ...prev, has_anomaly: val === 'all' ? null : val === 'yes', offset: 0 }))}
                                                >
                                                    <SelectTrigger className="w-full h-9">
                                                        <SelectValue placeholder="All" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">All</SelectItem>
                                                        <SelectItem value="yes">With Anomaly</SelectItem>
                                                        <SelectItem value="no">No Anomaly</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {logsList.length === 0 ? (
                            !loading && (
                                <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={colSpan} className="h-[400px] p-0">
                                        <EmptyState
                                            icon={FileText}
                                            title="No activity logs found"
                                            description="Activity will appear here as queue operations occur"
                                            isFilterActive={isFilterActive}
                                        />
                                    </TableCell>
                                </TableRow>
                            )
                        ) : shouldVirtualize && virtual ? (
                            <>
                                {virtual.topSpacerHeight > 0 && (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={colSpan} className="p-0" style={{ height: virtual.topSpacerHeight }} />
                                    </TableRow>
                                )}
                                {virtual.visibleItems.map((log: ActivityLogEntry) => (
                                    <ActivityLogRow
                                        key={log.log_id}
                                        log={log}
                                        formatTime={formatTime}
                                        onViewMessageHistory={onViewMessageHistory}
                                        getActionBadge={getActionBadgeMemo}
                                        getSeverityBadge={getSeverityBadgeMemo}
                                    />
                                ))}
                                {virtual.bottomSpacerHeight > 0 && (
                                    <TableRow className="hover:bg-transparent">
                                        <TableCell colSpan={colSpan} className="p-0" style={{ height: virtual.bottomSpacerHeight }} />
                                    </TableRow>
                                )}
                            </>
                        ) : (
                            logsList.map((log: ActivityLogEntry) => (
                                <ActivityLogRow
                                    key={log.log_id}
                                    log={log}
                                    formatTime={formatTime}
                                    onViewMessageHistory={onViewMessageHistory}
                                    getActionBadge={getActionBadgeMemo}
                                    getSeverityBadge={getSeverityBadgeMemo}
                                />
                            ))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>

            {/* Pagination Footer */}
            {(logs?.pagination.total || 0) > 0 && (
                <PaginationFooter
                    pageSize={String(filter.limit)}
                    setPageSize={handleSetPageSize}
                    currentPage={currentPage}
                    totalPages={Math.max(1, totalPages)}
                    setCurrentPage={handleSetCurrentPage}
                    totalItems={logs?.pagination.total || 0}
                    pageSizeOptions={[25, 50, 100, 250, 500]}
                />
            )}
        </div>
    )
}
