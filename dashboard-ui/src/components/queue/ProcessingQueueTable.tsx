import React, { useState, useEffect, useCallback } from "react"

import {
    BaseQueueTableProps,
    useTableVirtualization,
    PayloadCell,
    ActionsCell,
    SelectCell,
    IdCell,
    TypeCell,
    PriorityCell,
    AttemptsCell,
    TimeCell,
    EmptyTableBody,
    Table,
    TableBody,
    TableHead,
    TableHeader,
    TableRow,
    TableCell,
    SortableHeader,
    PaginationFooter,
    ScrollArea,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    Copy,
    cn,
    Message,
    QueueConfig
} from "./QueueTableBase"

// ============================================================================
// Processing Queue Specific Cells
// ============================================================================

const ConsumerCell = React.memo(({ consumerId }: { consumerId?: string | null }) => (
    <TableCell className="text-xs text-foreground whitespace-nowrap">
        <span className="font-mono" title={consumerId || 'Not specified'}>
            {consumerId ? (
                consumerId.length > 20
                    ? `${consumerId.substring(0, 20)}...`
                    : consumerId
            ) : (
                <span className="text-muted-foreground italic">—</span>
            )}
        </span>
    </TableCell>
))

const LockTokenCell = React.memo(({ lockToken }: { lockToken?: string }) => {
    if (!lockToken) {
        return (
            <TableCell className="text-xs text-foreground whitespace-nowrap">
                <span className="text-muted-foreground italic">—</span>
            </TableCell>
        )
    }

    return (
        <Tooltip>
            <TooltipTrigger asChild>
                <TableCell className="text-xs text-foreground whitespace-nowrap cursor-default group/lock">
                    <div className="flex items-center gap-1">
                        <span className="font-mono">
                            {lockToken.substring(0, 8)}...
                        </span>
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                e.preventDefault();
                                navigator.clipboard.writeText(lockToken);
                                (e.target as HTMLElement).closest('button')?.blur();
                            }}
                            className="opacity-0 group-hover/lock:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded flex-shrink-0"
                            tabIndex={-1}
                        >
                            <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                        </button>
                    </div>
                </TableCell>
            </TooltipTrigger>
            <TooltipContent side="top" className="font-mono text-xs">
                <p>{lockToken}</p>
            </TooltipContent>
        </Tooltip>
    )
})

const TimeRemainingCell = React.memo(({ remaining }: { remaining: React.ReactNode }) => (
    <TableCell className="text-xs text-foreground whitespace-nowrap">
        {remaining}
    </TableCell>
))

// ============================================================================
// Processing Queue Row Component
// ============================================================================

const ProcessingQueueRow = React.memo(({
    msg,
    isHighlighted,
    isSelected,
    config,
    onEdit,
    formatTime,
    calculateTimeRemaining,
    onToggleSelect
}: {
    msg: Message,
    isHighlighted: boolean,
    isSelected: boolean,
    config?: QueueConfig | null,
    onEdit?: (message: Message) => void,
    formatTime: (ts?: number) => string,
    calculateTimeRemaining: (m: Message) => React.ReactNode,
    onToggleSelect: (id: string, shiftKey?: boolean) => void
}) => (
    <TableRow className={cn("group transition-colors duration-150 border-muted/30", isHighlighted && "animate-highlight")}>
        <SelectCell id={msg.id} isSelected={isSelected} onToggleSelect={onToggleSelect} />
        <IdCell id={msg.id} msg={msg} onEdit={onEdit} />
        <TypeCell type={msg.type} />
        <PriorityCell priority={msg.priority} />
        <PayloadCell payload={msg.payload} />
        <TimeCell timestamp={msg.dequeued_at || msg.processing_started_at} formatTime={formatTime} />
        <AttemptsCell
            attemptCount={msg.attempt_count}
            maxAttempts={msg.custom_max_attempts ?? config?.max_attempts}
        />
        <ConsumerCell consumerId={msg.consumer_id} />
        <LockTokenCell lockToken={msg.lock_token} />
        <TimeRemainingCell remaining={calculateTimeRemaining(msg)} />
    </TableRow>
))

// ============================================================================
// Processing Queue Table Component
// ============================================================================

export interface ProcessingQueueTableProps extends BaseQueueTableProps { }

export const ProcessingQueueTable = React.memo(({
    messages,
    config,
    onDelete,
    onEdit,
    onViewPayload,
    formatTime,
    pageSize,
    setPageSize,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,
    currentPage,
    setCurrentPage,
    totalPages,
    totalItems,
    sortBy,
    sortOrder,
    onSort,
    scrollResetKey,
    highlightedIds,
    isFilterActive,
    activeFiltersDescription,
    isLoading
}: ProcessingQueueTableProps) => {
    const { shouldVirtualize, scrollContainerRef, setScrollTop, virtual } = useTableVirtualization(messages, scrollResetKey)
    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.has(msg.id))
    const colSpan = 10

    // Live timer for time remaining
    const [currentTime, setCurrentTime] = useState(Date.now())

    useEffect(() => {
        setCurrentTime(Date.now())
    }, [])

    useEffect(() => {
        if (messages.length === 0) return

        setCurrentTime(Date.now())
        const interval = setInterval(() => {
            setCurrentTime(Date.now())
        }, 1000)

        return () => clearInterval(interval)
    }, [messages.length])

    const calculateTimeRemaining = useCallback((m: Message) => {
        const startTime = m.dequeued_at || m.processing_started_at
        console.log(`[TimeRemaining] Message ${m.id}: dequeued_at=${m.dequeued_at}, processing_started_at=${m.processing_started_at}, startTime=${startTime}, config=${!!config}`)
        if (!startTime) return <span className="text-muted-foreground italic">—</span>

        if (!config) return <span className="text-muted-foreground">...</span>

        const now = currentTime / 1000
        const timeoutSeconds = m.custom_ack_timeout || config.ack_timeout_seconds
        const deadline = startTime + timeoutSeconds
        const remaining = deadline - now

        if (remaining <= 0) return <span className="text-destructive font-medium">Overdue</span>

        return <span className="text-primary font-mono">{Math.ceil(remaining)}s</span>
    }, [config, currentTime])

    const renderRow = (msg: Message) => (
        <ProcessingQueueRow
            key={msg.id}
            msg={msg}
            isHighlighted={highlightedIds.has(msg.id)}
            isSelected={selectedIds.has(msg.id)}
            config={config}
            onEdit={onEdit}
            formatTime={formatTime}
            calculateTimeRemaining={calculateTimeRemaining}
            onToggleSelect={onToggleSelect}
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
                                <TableHead className="sticky top-0 z-20 bg-card w-[40px] text-xs">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                                        checked={allSelected}
                                        onChange={() => onToggleSelectAll(messages.map(m => m.id))}
                                    />
                                </TableHead>
                                <SortableHeader label="Message ID" field="id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <SortableHeader label="Type" field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <SortableHeader label="Priority" field="priority" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <SortableHeader label="Payload" field="payload" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <SortableHeader label="Started At" field="processing_started_at" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <SortableHeader label="Attempts" field="attempt_count" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <SortableHeader label="Consumer" field="consumer_id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Lock Token</TableHead>
                                <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Time Remaining</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {messages.length === 0 ? (
                                <EmptyTableBody
                                    colSpan={colSpan}
                                    isLoading={isLoading}
                                    isFilterActive={isFilterActive}
                                    activeFiltersDescription={activeFiltersDescription}
                                />
                            ) : shouldVirtualize && virtual ? (
                                <>
                                    {virtual.topSpacerHeight > 0 && (
                                        <TableRow className="hover:bg-transparent" style={{ height: virtual.topSpacerHeight }}>
                                            <TableCell colSpan={colSpan} className="p-0" />
                                        </TableRow>
                                    )}
                                    {virtual.visibleItems.map(renderRow)}
                                    {virtual.bottomSpacerHeight > 0 && (
                                        <TableRow className="hover:bg-transparent" style={{ height: virtual.bottomSpacerHeight }}>
                                            <TableCell colSpan={colSpan} className="p-0" />
                                        </TableRow>
                                    )}
                                </>
                            ) : (
                                messages.map(renderRow)
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
