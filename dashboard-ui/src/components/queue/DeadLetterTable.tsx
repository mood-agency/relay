import React, { useState, useEffect, useCallback, useRef } from "react"
import { useTranslation } from "react-i18next"
import { Search, XCircle } from "lucide-react"

import { Checkbox } from "@/components/ui/checkbox"
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
    // Table components
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    ScrollArea,
    Badge,
    cn,
    tableStyles,
    // Data table components
    SortableHeader,
    PaginationFooter,
    EmptyState,
    useElementHeight,
    useVirtualization,
    // Queue table components
    IdCell,
    PayloadCell,
    HighlightableTableRow,
    FilterBar,
    Message,
    QueueConfig
} from "./QueueTableBase"

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
                <Checkbox
                    checked={isSelected}
                    onCheckedChange={(_, shiftKey) => onToggleSelect(msg.id, shiftKey)}
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
                {msg.custom_ack_timeout ?? config?.ack_timeout_seconds ?? 60}
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
    startDate?: Date | undefined
    setStartDate?: (date: Date | undefined) => void
    endDate?: Date | undefined
    setEndDate?: (date: Date | undefined) => void
    availableTypes?: string[]
    // Selection action handlers (optional - shown in filter bar when items are selected)
    onMoveSelected?: () => void
    onDeleteSelected?: () => void
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
    startDate,
    setStartDate,
    endDate,
    setEndDate,
    availableTypes,
    // Selection action handlers
    onMoveSelected,
    onDeleteSelected
}: DeadLetterTableProps) => {
    const { t } = useTranslation()
    const allSelected = messages.length > 0 && messages.every(msg => selectedIds.has(msg.id))

    // Check if filter props are provided - if so, show filter bar
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

    const colSpan = 9

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
                        <span className={tableStyles.FILTER_LABEL}>{t('table.failed')}:</span>
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
                            <SortableHeader label={t('table.columns.id')} field="id" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[120px]" />
                            <SortableHeader label={t('table.columns.type')} field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[120px]" />
                            <SortableHeader label={t('table.columns.priority')} field="priority" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[70px]" />
                            <SortableHeader label={t('table.columns.payload')} field="payload" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[180px]" />
                            <SortableHeader label={t('table.columns.failedAt')} field="created_at" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[180px]" />
                            <SortableHeader label={t('table.columns.errorReason')} field="error_message" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[180px]" />
                            <SortableHeader label={t('table.columns.attempts')} field="attempt_count" currentSort={sortBy} currentOrder={sortOrder} onSort={onSort} className="w-[80px]" />
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, tableStyles.TABLE_HEADER_LAST)}>{t('table.columns.ackTimeout')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {messages.length === 0 ? (
                            !isLoading && (
                                <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                    <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_EMPTY}>
                                        <EmptyState
                                            icon={isFilterActive ? Search : XCircle}
                                            title={t('table.noFailedMessagesFound')}
                                            description={t('table.noFailedMessagesDescription')}
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
