import React, { useState, useEffect, useCallback } from "react"
import { useTranslation } from "react-i18next"
import { Search } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
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
    HighlightableTableRow,
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
    QueueConfig,
    tableStyles,
    FilterBar
} from "./QueueTableBase"
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
// Processing Queue Specific Cells
// ============================================================================

const ConsumerCell = React.memo(({ consumerId }: { consumerId?: string | null }) => (
    <TableCell className={tableStyles.TABLE_CELL_TIME}>
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
            <TableCell className="min-w-[180px]">
                <span className="text-muted-foreground italic">—</span>
            </TableCell>
        )
    }

    return (
        <TableCell className="min-w-[180px] group/lock">
            <div className={tableStyles.FLEX_INLINE}>
                <span className="font-mono text-xs">
                    {lockToken}
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
    )
})

const TimeRemainingCell = React.memo(({ remaining }: { remaining: React.ReactNode }) => (
    <TableCell className={cn(tableStyles.TABLE_CELL_TIME, tableStyles.TABLE_CELL_LAST)}>
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
    <HighlightableTableRow isHighlighted={isHighlighted} isSelected={isSelected}>
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
    </HighlightableTableRow>
))

// ============================================================================
// Processing Queue Table Component
// ============================================================================

export interface ProcessingQueueTableProps extends BaseQueueTableProps {
    // Filter props (optional - filter column only shows when these are provided)
    search?: string
    setSearch?: (value: string) => void
    filterType?: string
    setFilterType?: (value: string) => void
    filterPriority?: string
    setFilterPriority?: (value: string) => void
    startDate?: Date | undefined
    setStartDate?: (date: Date | undefined) => void
    endDate?: Date | undefined
    setEndDate?: (date: Date | undefined) => void
    availableTypes?: string[]
    // Selection action handlers (optional - shown in filter bar when items are selected)
    onMoveSelected?: () => void
    onDeleteSelected?: () => void
}

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
    isLoading,
    // Filter props
    search,
    setSearch,
    filterType,
    setFilterType,
    filterPriority,
    setFilterPriority,
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    availableTypes,
    // Selection action handlers
    onMoveSelected,
    onDeleteSelected
}: ProcessingQueueTableProps) => {
    const { t } = useTranslation()
    const { shouldVirtualize, scrollContainerRef, setScrollTop, virtual } = useTableVirtualization(messages, scrollResetKey)
    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.has(msg.id))

    // Check if filter props are provided - if so, show filter bar
    const hasFilterProps = setSearch !== undefined && setFilterType !== undefined
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
        if (!startTime) return <span className="text-muted-foreground italic">—</span>

        if (!config) return <span className="text-muted-foreground">...</span>

        const now = currentTime / 1000
        const timeoutSeconds = m.custom_ack_timeout || config.ack_timeout_seconds
        const deadline = startTime + timeoutSeconds
        const remaining = deadline - now

        if (remaining <= 0) return <span className="bg-destructive/15 text-destructive text-xs font-medium px-2 py-0.5 rounded-full">Timeout</span>

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
        <div className={tableStyles.TABLE_CONTAINER}>
            {hasFilterProps && (
                <FilterBar
                    isFilterActive={isFilterActive ?? false}
                    onClearFilters={() => {
                        setSearch!("")
                        setFilterType!("all")
                        setFilterPriority!("")
                        setStartDate!(undefined)
                        setEndDate!(undefined)
                    }}
                    selectionActions={{
                        selectedCount: selectedIds.size,
                        onMoveSelected,
                        onDeleteSelected
                    }}
                >
                    {/* Search */}
                    <div className={cn(tableStyles.FILTER_BAR_ITEM, "relative")}>
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                            placeholder={t('table.searchIdPayload')}
                            value={search}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch!(e.target.value)}
                            className={cn(tableStyles.FILTER_BAR_TEXT_INPUT, "w-[200px] pl-8")}
                        />
                    </div>

                    {/* Message Type */}
                    <div className={tableStyles.FILTER_BAR_ITEM}>
                        <span className={tableStyles.FILTER_LABEL}>{t('fields.type')}:</span>
                        <MultipleSelector
                            defaultOptions={(availableTypes || []).map(typ => ({ label: typ, value: typ }))}
                            value={
                                filterType === "all" || !filterType
                                    ? []
                                    : filterType.split(",").map(typ => ({ label: typ, value: typ }))
                            }
                            onChange={(selected: Option[]) => {
                                if (selected.length === 0) {
                                    setFilterType!("all")
                                } else {
                                    setFilterType!(selected.map(s => s.value).join(","))
                                }
                            }}
                            hideClearAllButton
                            placeholder={t('common.all')}
                            className="w-[150px]"
                            badgeClassName="rounded-full border border-border text-foreground font-medium bg-transparent hover:bg-transparent"
                            emptyIndicator={
                                <p className="text-center text-sm text-muted-foreground">{t('table.noTypesFound')}</p>
                            }
                        />
                    </div>

                    {/* Priority */}
                    <div className={tableStyles.FILTER_BAR_ITEM}>
                        <span className={tableStyles.FILTER_LABEL}>{t('fields.priority')}:</span>
                        <Select value={filterPriority || "any"} onValueChange={(val: string) => setFilterPriority!(val === "any" ? "" : val)}>
                            <SelectTrigger className={tableStyles.FILTER_BAR_SELECT}>
                                <SelectValue placeholder={t('common.any')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="any">{t('common.any')}</SelectItem>
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
                                    <SelectItem key={p} value={String(p)}>{p}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Date Range */}
                    <div className={tableStyles.FILTER_BAR_ITEM}>
                        <span className={tableStyles.FILTER_LABEL}>{t('table.started')}:</span>
                        <DateTimePicker
                            date={startDate}
                            setDate={setStartDate!}
                            placeholder={t('common.from')}
                            className={tableStyles.FILTER_BAR_DATE}
                        />
                        <span className="text-muted-foreground">-</span>
                        <DateTimePicker
                            date={endDate}
                            setDate={setEndDate!}
                            placeholder={t('table.to')}
                            className={tableStyles.FILTER_BAR_DATE}
                        />
                    </div>
                </FilterBar>
            )}
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
                                <TableHead className={cn(tableStyles.TABLE_HEADER_CHECKBOX, "w-[32px]", tableStyles.TABLE_HEADER_FIRST)}>
                                    <Checkbox
                                        checked={allSelected}
                                        onCheckedChange={() => onToggleSelectAll(messages.map(m => m.id))}
                                    />
                                </TableHead>
                                <SortableHeader label={t('table.columns.messageId')} field="id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[120px]" />
                                <SortableHeader label={t('table.columns.type')} field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[120px]" />
                                <SortableHeader label={t('table.columns.priority')} field="priority" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[70px]" />
                                <SortableHeader label={t('table.columns.payload')} field="payload" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[180px]" />
                                <SortableHeader label={t('table.columns.startedAt')} field="dequeued_at" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[180px]" />
                                <SortableHeader label={t('table.columns.attempts')} field="attempt_count" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[80px]" />
                                <SortableHeader label={t('table.columns.consumer')} field="consumer_id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[140px]" />
                                <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[100px]")}>{t('table.columns.lockToken')}</TableHead>
                                <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, tableStyles.TABLE_HEADER_LAST)}>{t('table.columns.remaining')}</TableHead>
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
