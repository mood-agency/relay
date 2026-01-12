import React, { useState, useEffect, useRef, useCallback } from "react"
import { Pencil, Copy, Search, Inbox } from "lucide-react"

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
        rowHeight: 44,
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
    <span className="text-xs text-foreground">
        {p ?? 0}
    </span>
)

// ============================================================================
// Shared Components
// ============================================================================

export const PayloadCell = React.memo(({ payload }: { payload: any }) => {
    const payloadText = JSON.stringify(payload)
    return (
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
                                navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
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
                    <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(JSON.stringify(payload, null, 2)) }} />
                </pre>
            </TooltipContent>
        </Tooltip>
    )
})

export const ActionsCell = React.memo(({
    msg,
    onEdit
}: {
    msg: Message,
    onEdit?: (message: Message) => void
}) => (
    <TableCell className="text-right pr-6">
        <div className="flex justify-end gap-1">
            {onEdit && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={(e: React.MouseEvent) => {
                        e.stopPropagation()
                        onEdit(msg)
                    }}
                    className="text-muted-foreground hover:text-primary hover:bg-primary/10 transition-all rounded-full h-8 w-8"
                    title="Edit Message"
                >
                    <Pencil className="h-4 w-4" />
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
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
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
    <TableCell>
        {onEdit && msg ? (
            <button
                onClick={(e) => {
                    e.stopPropagation()
                    onEdit(msg)
                }}
                className="text-xs text-foreground font-mono hover:underline hover:text-primary focus:outline-none text-left"
                title={`Edit ${id}`}
            >
                {id}
            </button>
        ) : (
            <span className="text-xs text-foreground font-mono" title={id}>
                {id}
            </span>
        )}
    </TableCell>
))

export const TypeCell = React.memo(({ type }: { type: string }) => (
    <TableCell className="text-left">
        <Badge variant="outline" className="font-medium whitespace-nowrap">{type}</Badge>
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
        <span className="text-xs text-foreground pl-4 block">
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
    <TableCell className="text-xs text-foreground whitespace-nowrap">
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
    <TableCell className="text-xs text-foreground whitespace-nowrap">
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
        className="relative flex-1 min-h-0"
        scrollBarClassName="mt-12 h-[calc(100%-3rem)]"
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
        <TableRow className="hover:bg-transparent">
            <TableCell colSpan={colSpan} className="h-[400px] p-0">
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
    <TableRow className="hover:bg-transparent border-0">
        <TableCell colSpan={colSpan} className="p-0 h-full" style={{ height: '100%' }} />
    </TableRow>
)

// Re-export commonly used components
export {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    SortableHeader,
    PaginationFooter,
    EmptyState,
    ScrollArea,
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    Button,
    Badge,
    Copy,
    Pencil,
    cn
}

export type { Message, QueueConfig }
