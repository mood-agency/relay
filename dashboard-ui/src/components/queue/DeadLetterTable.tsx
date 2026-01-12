import React, { useState, useEffect, useCallback, useRef } from "react"
import { Pencil, Copy, Search, XCircle } from "lucide-react"

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
    useVirtualization
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
import { cn } from "@/lib/utils"

import { Message, QueueConfig, syntaxHighlightJson } from "./types"
import { IdCell } from "./QueueTableBase"

// ============================================================================
// Dead Letter Row Component
// ============================================================================

export const DeadLetterRow = React.memo(({
    msg,
    isHighlighted,
    isSelected,
    config,
    onDelete,
    onEdit,
    onViewPayload,
    formatTime,
    getPriorityBadge,
    onToggleSelect
}: {
    msg: Message,
    isHighlighted: boolean,
    isSelected: boolean,
    config?: QueueConfig | null,
    onDelete: (id: string) => void,
    onEdit?: (message: Message) => void,
    onViewPayload: (payload: any) => void,
    formatTime: (ts?: number) => string,
    getPriorityBadge: (p: number) => React.ReactNode,
    onToggleSelect: (id: string, shiftKey?: boolean) => void
}) => {
    const payloadText = JSON.stringify(msg.payload)
    const errorText = msg.error_message || msg.last_error || "Unknown error"
    return (
        <TableRow key={msg.id} className={cn("group transition-colors duration-150 border-muted/30", isHighlighted && "animate-highlight")}>
            <TableCell>
                <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                    checked={isSelected}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        e.stopPropagation()
                        onToggleSelect(msg.id, (e.nativeEvent as any)?.shiftKey === true)
                    }}
                />
            </TableCell>
            <IdCell id={msg.id} msg={msg} onEdit={onEdit} />
            <TableCell><Badge variant="outline" className="font-medium whitespace-nowrap">{msg.type}</Badge></TableCell>
            <TableCell className="text-left">{getPriorityBadge(msg.priority)}</TableCell>
            <Tooltip>
                <TooltipTrigger asChild>
                    <TableCell className="max-w-[150px] cursor-default group/payload">
                        <div className="flex items-center gap-1">
                            <div className="truncate text-xs font-mono text-muted-foreground group-hover/payload:text-foreground transition-colors">
                                {payloadText}
                            </div>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    e.preventDefault();
                                    navigator.clipboard.writeText(JSON.stringify(msg.payload, null, 2));
                                    (e.target as HTMLElement).closest('button')?.blur();
                                }}
                                className="opacity-0 group-hover/payload:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded flex-shrink-0"
                                tabIndex={-1}
                            >
                                <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                            </button>
                        </div>
                    </TableCell>
                </TooltipTrigger>
                <TooltipContent side="top" className="max-w-[400px] max-h-[300px] overflow-auto p-0">
                    <pre className="text-xs p-3 rounded-md bg-slate-950 text-slate-50 overflow-auto">
                        <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(JSON.stringify(msg.payload, null, 2)) }} />
                    </pre>
                </TooltipContent>
            </Tooltip>
            <TableCell className="text-xs text-foreground whitespace-nowrap">
                {formatTime(msg.failed_at || msg.processing_started_at)}
            </TableCell>
            <TableCell>
                <div className="text-xs font-medium max-w-[300px] truncate" title={errorText}>
                    {errorText}
                </div>
            </TableCell>
            <TableCell>
                <span className="text-xs text-foreground pl-4 block">
                    {msg.attempt_count || 1}
                    {config?.max_attempts && <span className="text-muted-foreground"> / {config.max_attempts}</span>}
                </span>
            </TableCell>
            <TableCell className="text-xs text-foreground whitespace-nowrap">
                {msg.custom_ack_timeout ?? config?.ack_timeout_seconds ?? 60}s
            </TableCell>

        </TableRow>
    )
})

// ============================================================================
// Dead Letter Table Component
// ============================================================================

export interface DeadLetterTableProps {
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

export const DeadLetterTable = React.memo(({
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
}: DeadLetterTableProps) => {
    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.has(msg.id))

    const getPriorityBadge = useCallback((p: number) => (
        <span className="text-xs text-foreground">
            {p ?? 0}
        </span>
    ), [])

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
        rowHeight: 44,
        overscan: 8,
        enabled: shouldVirtualize
    })

    const colSpan = 9

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
                            <SortableHeader label="ID" field="id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Type" field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Priority" field="priority" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Payload" field="payload" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Failed At" field="failed_at" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Error Reason" field="error_message" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Attempts" field="attempt_count" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Ack Timeout</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {messages.length === 0 ? (
                            !isLoading && (
                                <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={colSpan} className="h-[400px] p-0">
                                        <EmptyState
                                            icon={isFilterActive ? Search : XCircle}
                                            title="No failed messages found"
                                            description="There are no failed messages at the moment."
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
                                        <TableCell colSpan={colSpan} className="p-0" />
                                    </TableRow>
                                )}
                                {virtual.visibleItems.map((msg: Message) => (
                                    <DeadLetterRow
                                        key={msg.id}
                                        msg={msg}
                                        isHighlighted={highlightedIds.has(msg.id)}
                                        isSelected={selectedIds.has(msg.id)}
                                        config={config}
                                        onDelete={onDelete}
                                        onEdit={onEdit}
                                        onViewPayload={onViewPayload}
                                        formatTime={formatTime}
                                        getPriorityBadge={getPriorityBadge}
                                        onToggleSelect={onToggleSelect}
                                    />
                                ))}
                                {virtual.bottomSpacerHeight > 0 && (
                                    <TableRow className="hover:bg-transparent" style={{ height: virtual.bottomSpacerHeight }}>
                                        <TableCell colSpan={colSpan} className="p-0" />
                                    </TableRow>
                                )}
                            </>
                        ) : (
                            messages.map((msg: Message) => (
                                <DeadLetterRow
                                    key={msg.id}
                                    msg={msg}
                                    isHighlighted={highlightedIds.has(msg.id)}
                                    isSelected={selectedIds.has(msg.id)}
                                    config={config}
                                    onDelete={onDelete}
                                    onEdit={onEdit}
                                    onViewPayload={onViewPayload}
                                    formatTime={formatTime}
                                    getPriorityBadge={getPriorityBadge}
                                    onToggleSelect={onToggleSelect}
                                />
                            ))
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
