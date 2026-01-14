import React, { useState } from "react"
import { Filter, Search } from "lucide-react"

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

// ============================================================================
// Main Queue Row Component
// ============================================================================

const MainQueueRow = React.memo(({
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
    <TableRow className={cn("group transition-colors duration-150 border-muted/30", isHighlighted && "animate-highlight", isSelected && "bg-primary/10")}>
        <SelectCell id={msg.id} isSelected={isSelected} onToggleSelect={onToggleSelect} />
        <IdCell id={msg.id} msg={msg} onEdit={onEdit} />
        <TypeCell type={msg.type} />
        <PriorityCell priority={msg.priority} />
        <PayloadCell payload={msg.payload} />
        <TimeCell timestamp={msg.created_at} formatTime={formatTime} />
        <AttemptsCell
            attemptCount={msg.attempt_count}
            maxAttempts={msg.custom_max_attempts ?? config?.max_attempts}
            defaultAttempts={0}
        />
        <AckTimeoutCell customTimeout={msg.custom_ack_timeout} configTimeout={config?.ack_timeout_seconds} />
    </TableRow>
))

// ============================================================================
// Main Queue Table Component
// ============================================================================

export interface MainQueueTableProps extends BaseQueueTableProps {
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

export const MainQueueTable = React.memo(({
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
}: MainQueueTableProps) => {
    const [filterOpen, setFilterOpen] = useState(false)
    const { shouldVirtualize, scrollContainerRef, setScrollTop, virtual } = useTableVirtualization(messages, scrollResetKey)
    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.has(msg.id))

    // Check if filter props are provided - if so, show filter column
    const hasFilterProps = setSearch !== undefined && setFilterType !== undefined
    const colSpan = hasFilterProps ? 9 : 8

    const renderRow = (msg: Message) => (
        <MainQueueRow
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
                                <SortableHeader label="Created At" field="created_at" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <SortableHeader label="Attempts" field="attempt_count" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} />
                                <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Ack Timeout</TableHead>
                                {hasFilterProps && (
                                    <TableHead className="sticky top-0 z-20 bg-card text-right pr-2 w-[50px]">
                                        <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                                            <PopoverTrigger asChild>
                                                <Button
                                                    variant="ghost"
                                                    size="icon"
                                                    className={cn("h-7 w-7 relative", isFilterActive && "bg-primary/10 text-primary")}
                                                    aria-label="Message Filters"
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
                                                                className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                                            >
                                                                Clear all
                                                            </Button>
                                                        )}
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="text-xs font-medium text-foreground/80">Search</label>
                                                        <div className="relative">
                                                            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                                                            <input
                                                                placeholder="Search ID, payload..."
                                                                value={search}
                                                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch!(e.target.value)}
                                                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 pl-8 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="space-y-2">
                                                        <label className="text-xs font-medium text-foreground/80">Message Type</label>
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
                                                        <label className="text-xs font-medium text-foreground/80">Priority</label>
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
                                                        <label className="text-xs font-medium text-foreground/80">Min Attempts</label>
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
                                                        <label className="text-xs font-medium text-foreground/80">Created At</label>
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
