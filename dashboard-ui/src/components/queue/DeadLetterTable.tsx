import React, { useState, useEffect, useCallback, useRef } from "react"
import { Search, XCircle, Filter } from "lucide-react"

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
import { DateTimePicker } from "@/components/ui/date-time-picker"
import MultipleSelector, { Option } from "@/components/ui/multi-select"
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
import * as tableStyles from "@/components/ui/table-styles"

import { Message, QueueConfig } from "./types"
import { IdCell, PayloadCell, HighlightableTableRow } from "./QueueTableBase"

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
    const errorText = msg.error_message || msg.last_error || "Unknown error"
    return (
        <HighlightableTableRow isHighlighted={isHighlighted} isSelected={isSelected}>
            <TableCell>
                <input
                    type="checkbox"
                    className={tableStyles.INPUT_CHECKBOX}
                    checked={isSelected}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                        e.stopPropagation()
                        onToggleSelect(msg.id, (e.nativeEvent as any)?.shiftKey === true)
                    }}
                />
            </TableCell>
            <IdCell id={msg.id} msg={msg} onEdit={onEdit} />
            <TableCell><Badge variant="outline" className={tableStyles.BADGE_TYPE}>{msg.type}</Badge></TableCell>
            <TableCell className="text-left">{getPriorityBadge(msg.priority)}</TableCell>
            <PayloadCell payload={msg.payload} />
            <TableCell className={tableStyles.TABLE_CELL_TIME}>
                {formatTime(msg.dequeued_at || msg.created_at)}
            </TableCell>
            <TableCell>
                <div className="text-xs font-medium max-w-[300px] truncate" title={errorText}>
                    {errorText}
                </div>
            </TableCell>
            <TableCell>
                <span className={cn(tableStyles.TEXT_PRIMARY, "pl-4 block")}>
                    {msg.attempt_count || 1}
                    {config?.max_attempts && <span className="text-muted-foreground"> / {config.max_attempts}</span>}
                </span>
            </TableCell>
            <TableCell className={tableStyles.TABLE_CELL_TIME}>
                {msg.custom_ack_timeout ?? config?.ack_timeout_seconds ?? 60}s
            </TableCell>
        </HighlightableTableRow>
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
    // Filter props (optional - filter column only shows when these are provided)
    search?: string
    setSearch?: (value: string) => void
    filterType?: string
    setFilterType?: (value: string) => void
    filterPriority?: string
    setFilterPriority?: (value: string) => void
    filterAttempts?: string
    setFilterAttempts?: (value: string) => void
    startDate?: Date | undefined
    setStartDate?: (date: Date | undefined) => void
    endDate?: Date | undefined
    setEndDate?: (date: Date | undefined) => void
    availableTypes?: string[]
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
    isLoading,
    // Filter props
    search,
    setSearch,
    filterType,
    setFilterType,
    filterPriority,
    setFilterPriority,
    filterAttempts,
    setFilterAttempts,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    availableTypes
}: DeadLetterTableProps) => {
    const [filterOpen, setFilterOpen] = useState(false)
    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.has(msg.id))

    // Check if filter props are provided - if so, show filter column
    const hasFilterProps = setSearch !== undefined && setFilterType !== undefined

    const getPriorityBadge = useCallback((p: number) => (
        <span className={tableStyles.TEXT_PRIMARY}>
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
        rowHeight: 24,
        overscan: 8,
        enabled: shouldVirtualize
    })

    const colSpan = hasFilterProps ? 10 : 9

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
                            <TableHead className={tableStyles.TABLE_HEADER_CHECKBOX}>
                                <input
                                    type="checkbox"
                                    className={tableStyles.INPUT_CHECKBOX}
                                    checked={allSelected}
                                    onChange={() => onToggleSelectAll(messages.map(m => m.id))}
                                />
                            </TableHead>
                            <SortableHeader label="ID" field="id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Type" field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Priority" field="priority" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Payload" field="payload" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Failed At" field="created_at" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Error Reason" field="error_message" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <SortableHeader label="Attempts" field="attempt_count" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                            <TableHead className={tableStyles.TABLE_HEADER_BASE}>Ack Timeout</TableHead>
                            {hasFilterProps && (
                                <TableHead className={tableStyles.TABLE_HEADER_FILTER}>
                                    <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                                        <PopoverTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className={cn(tableStyles.BUTTON_FILTER, isFilterActive && tableStyles.BUTTON_FILTER_ACTIVE)}
                                                aria-label="Message Filters"
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
                                                    <h4 className="font-medium text-sm">Message Filters</h4>
                                                    {isFilterActive && (
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            onClick={() => {
                                                                setSearch!("")
                                                                setFilterType!("all")
                                                                setFilterPriority!("")
                                                                setFilterAttempts!("")
                                                                setStartDate!(undefined)
                                                                setEndDate!(undefined)
                                                            }}
                                                            className={tableStyles.FILTER_CLEAR_BUTTON}
                                                        >
                                                            Clear all
                                                        </Button>
                                                    )}
                                                </div>

                                                <div className="space-y-2">
                                                    <label className={tableStyles.FILTER_LABEL}>Search</label>
                                                    <div className="relative">
                                                        <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                        <input
                                                            placeholder="Search ID, payload..."
                                                            value={search}
                                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch!(e.target.value)}
                                                            className={tableStyles.FILTER_INPUT}
                                                        />
                                                    </div>
                                                </div>

                                                <div className="space-y-2">
                                                    <label className={tableStyles.FILTER_LABEL}>Message Type</label>
                                                    <MultipleSelector
                                                        defaultOptions={(availableTypes || []).map(t => ({ label: t, value: t }))}
                                                        value={
                                                            filterType === "all" || !filterType
                                                                ? []
                                                                : filterType.split(",").map(t => ({ label: t, value: t }))
                                                        }
                                                        onChange={(selected: Option[]) => {
                                                            if (selected.length === 0) {
                                                                setFilterType!("all")
                                                            } else {
                                                                setFilterType!(selected.map(s => s.value).join(","))
                                                            }
                                                        }}
                                                        hideClearAllButton
                                                        badgeClassName="rounded-full border border-border text-foreground font-medium bg-transparent hover:bg-transparent"
                                                        emptyIndicator={
                                                            <p className="text-center text-sm text-muted-foreground">No types found</p>
                                                        }
                                                    />
                                                </div>

                                                <div className="space-y-2">
                                                    <label className={tableStyles.FILTER_LABEL}>Priority</label>
                                                    <Select value={filterPriority || "any"} onValueChange={(val: string) => setFilterPriority!(val === "any" ? "" : val)}>
                                                        <SelectTrigger className="w-full">
                                                            <SelectValue placeholder="Any" />
                                                        </SelectTrigger>
                                                        <SelectContent>
                                                            <SelectItem value="any">Any</SelectItem>
                                                            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
                                                                <SelectItem key={p} value={String(p)}>{p}</SelectItem>
                                                            ))}
                                                        </SelectContent>
                                                    </Select>
                                                </div>

                                                <div className="space-y-2">
                                                    <label className={tableStyles.FILTER_LABEL}>Min Attempts</label>
                                                    <input
                                                        type="number"
                                                        min="0"
                                                        step="1"
                                                        placeholder="Any"
                                                        value={filterAttempts}
                                                        onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                                                            const val = e.target.value
                                                            if (val === "" || /^\d+$/.test(val)) {
                                                                setFilterAttempts!(val)
                                                            }
                                                        }}
                                                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                                    />
                                                </div>

                                                <div className="space-y-2">
                                                    <label className={tableStyles.FILTER_LABEL}>Failed At</label>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] text-muted-foreground">From</label>
                                                            <DateTimePicker
                                                                date={startDate}
                                                                setDate={setStartDate!}
                                                                placeholder="From"
                                                            />
                                                        </div>
                                                        <div className="space-y-1">
                                                            <label className="text-[10px] text-muted-foreground">To</label>
                                                            <DateTimePicker
                                                                date={endDate}
                                                                setDate={setEndDate!}
                                                                placeholder="To"
                                                            />
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        </PopoverContent>
                                    </Popover>
                                </TableHead>
                            )}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {messages.length === 0 ? (
                            !isLoading && (
                                <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                    <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_EMPTY}>
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
                                    <TableRow className={tableStyles.TABLE_ROW_SPACER} style={{ height: virtual.topSpacerHeight }}>
                                        <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_SPACER} />
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
                                    <TableRow className={tableStyles.TABLE_ROW_SPACER} style={{ height: virtual.bottomSpacerHeight }}>
                                        <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_SPACER} />
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
