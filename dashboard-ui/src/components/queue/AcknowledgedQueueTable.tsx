import React from "react"

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
    AckTimeoutCell,
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
    cn,
    Message
} from "./QueueTableBase"

// ============================================================================
// Acknowledged Queue Row Component
// ============================================================================

const AcknowledgedQueueRow = React.memo(({
    msg,
    isHighlighted,
    isSelected,
    config,
    onEdit,
    formatTime,
    onToggleSelect
}: {
    msg: Message,
    isHighlighted: boolean,
    isSelected: boolean,
    config?: { max_attempts?: number, ack_timeout_seconds?: number } | null,
    onEdit?: (message: Message) => void,
    formatTime: (ts?: number) => string,
    onToggleSelect: (id: string, shiftKey?: boolean) => void
}) => (
    <TableRow className={cn("group transition-colors duration-150 border-muted/30", isHighlighted && "animate-highlight")}>
        <SelectCell id={msg.id} isSelected={isSelected} onToggleSelect={onToggleSelect} />
        <IdCell id={msg.id} msg={msg} onEdit={onEdit} />
        <TypeCell type={msg.type} />
        <PriorityCell priority={msg.priority} />
        <PayloadCell payload={msg.payload} />
        <TimeCell timestamp={msg.acknowledged_at} formatTime={formatTime} />
        <AttemptsCell
            attemptCount={msg.attempt_count}
            maxAttempts={msg.custom_max_attempts ?? config?.max_attempts}
        />
        <AckTimeoutCell customTimeout={msg.custom_ack_timeout} configTimeout={config?.ack_timeout_seconds} />
    </TableRow>
))

// ============================================================================
// Acknowledged Queue Table Component
// ============================================================================

export interface AcknowledgedQueueTableProps extends BaseQueueTableProps { }

export const AcknowledgedQueueTable = React.memo(({
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
}: AcknowledgedQueueTableProps) => {
    const { shouldVirtualize, scrollContainerRef, setScrollTop, virtual } = useTableVirtualization(messages, scrollResetKey)
    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.has(msg.id))
    const colSpan = 8

    const renderRow = (msg: Message) => (
        <AcknowledgedQueueRow
            key={msg.id}
            msg={msg}
            isHighlighted={highlightedIds.has(msg.id)}
            isSelected={selectedIds.has(msg.id)}
            config={config}
            onEdit={onEdit}
            formatTime={formatTime}
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
                                <SortableHeader label="Ack At" field="acknowledged_at" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <SortableHeader label="Attempts" field="attempt_count" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Ack Timeout</TableHead>
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
