import React, { useEffect, useRef, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { ArrowRight, Search, FileText, ArrowUp, ArrowDown, ArrowUpDown, Copy } from "lucide-react"

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
    cn,
    tableStyles,
    useCursorTooltip,
    CursorTooltip,
    HighlightableTableRow,
    useElementHeight,
    useVirtualization,
    FilterBar
} from "@/components/queue/QueueTableBase"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"

import { toast } from "@/components/ui/sonner"
import { ActivityLogEntry } from "./types"
import { getActionBadge } from "./helpers"
import { syntaxHighlightJson } from "@/components/queue/types"

// ============================================================================
// Sort Types and Helpers
// ============================================================================

type SortColumn = 'message_id' | 'timestamp' | 'action' | 'queue' | 'consumer_id' | 'payload'
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
            className={cn(tableStyles.TABLE_HEADER_SORTABLE, className)}
            onClick={() => onSort(column)}
        >
            <div className={tableStyles.FLEX_INLINE}>
                <span>{label}</span>
                {isActive ? (
                    currentSort.direction === 'asc' ? (
                        <ArrowUp className={tableStyles.SORT_ICON} />
                    ) : (
                        <ArrowDown className={tableStyles.SORT_ICON} />
                    )
                ) : (
                    <ArrowUpDown className={tableStyles.SORT_ICON_INACTIVE} />
                )}
            </div>
        </TableHead>
    )
}

// ============================================================================
// Payload Cell with Cursor Tooltip for Activity Logs
// ============================================================================

const ActivityPayloadCell = React.memo(({ payload }: { payload: any }) => {
    const { t } = useTranslation()
    const { isHovered, mousePos, handlers } = useCursorTooltip()

    return (
        <>
            <TableCell className={cn("max-w-[200px]", tableStyles.TABLE_CELL_PAYLOAD, tableStyles.TABLE_CELL_LAST)} {...handlers}>
                <div className={tableStyles.FLEX_INLINE}>
                    <span className={cn("truncate", tableStyles.TEXT_PAYLOAD)}>
                        {JSON.stringify(payload)}
                    </span>
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            navigator.clipboard.writeText(JSON.stringify(payload, null, 2))
                            toast.success(t('common.payloadCopied'))
                        }}
                        className={tableStyles.BUTTON_COPY_PAYLOAD}
                        tabIndex={-1}
                        title={t('common.copy')}
                    >
                        <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                </div>
            </TableCell>
            <CursorTooltip isVisible={isHovered} mousePos={mousePos}>
                <pre className={tableStyles.TOOLTIP_CODE}>
                    <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(JSON.stringify(payload, null, 2)) }} />
                </pre>
            </CursorTooltip>
        </>
    )
})

// ============================================================================
// Activity Log Row Component
// ============================================================================

const ActivityLogRow = React.memo(({
    log,
    formatTime,
    onViewMessageHistory,
    isHighlighted = false
}: {
    log: ActivityLogEntry,
    formatTime: (ts?: number) => string,
    onViewMessageHistory?: (messageId: string) => void,
    isHighlighted?: boolean
}) => {
    const { t } = useTranslation()
    return (
    <HighlightableTableRow
        isHighlighted={isHighlighted}
        isCritical={log.anomaly?.severity === 'critical'}
    >
        <TableCell className={cn("max-w-[120px]", tableStyles.TABLE_CELL_ID, tableStyles.TABLE_CELL_FIRST)}>
            {log.message_id ? (
                <div className={tableStyles.FLEX_INLINE}>
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => onViewMessageHistory?.(log.message_id!)}
                                className={tableStyles.TEXT_ID_LINK}
                                title={log.message_id}
                            >
                                {log.message_id}
                            </button>
                        </TooltipTrigger>
                        <TooltipContent>
                            <p className="font-mono text-xs">{log.message_id}</p>
                            <p className="text-xs text-muted-foreground mt-1">{t('activityLogs.clickToViewHistory')}</p>
                        </TooltipContent>
                    </Tooltip>
                    <button
                        onClick={(e) => {
                            e.stopPropagation()
                            e.preventDefault()
                            navigator.clipboard.writeText(log.message_id!)
                            toast.success(t('common.idCopied'))
                        }}
                        className={tableStyles.BUTTON_COPY_ID}
                        tabIndex={-1}
                        title={t('common.copyId')}
                    >
                        <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                    </button>
                </div>
            ) : (
                <span className={tableStyles.TEXT_MUTED}>—</span>
            )}
        </TableCell>
        <TableCell className={tableStyles.TABLE_CELL_TIME}>
            {formatTime(log.timestamp)}
        </TableCell>
        <TableCell>{getActionBadge(log.action)}</TableCell>
        <TableCell className={tableStyles.TEXT_PRIMARY}>
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
        <TableCell className={cn(tableStyles.TEXT_MONO, "text-foreground max-w-[192px] truncate")} title={log.consumer_id || ''}>
            {log.consumer_id || '—'}
        </TableCell>
        {log.payload ? (
            <ActivityPayloadCell payload={log.payload} />
        ) : (
            <TableCell className={cn("max-w-[200px]", tableStyles.TABLE_CELL_PAYLOAD, tableStyles.TABLE_CELL_LAST)}>
                <span className={tableStyles.TEXT_MUTED}>—</span>
            </TableCell>
        )}
    </HighlightableTableRow>
    )
})

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
    highlightedIds?: Set<string>
    // Filter props
    filterAction?: string
    setFilterAction?: (value: string) => void
    filterMessageId?: string
    setFilterMessageId?: (value: string) => void
    filterHasAnomaly?: boolean | null
    setFilterHasAnomaly?: (value: boolean | null) => void
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
    onViewMessageHistory,
    highlightedIds,
    // Filter props
    filterAction,
    setFilterAction,
    filterMessageId,
    setFilterMessageId,
    filterHasAnomaly,
    setFilterHasAnomaly
}: ActivityLogsTableProps) => {
    const { t } = useTranslation()
    const logsList = Array.isArray(logs) ? logs : []
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const viewportHeight = useElementHeight(scrollContainerRef)
    const [scrollTop, setScrollTop] = React.useState(0)
    const [sort, setSort] = React.useState<SortState>({ column: null, direction: 'desc' })

    // Check if filter props are provided
    const hasFilterProps = setFilterAction !== undefined && setFilterMessageId !== undefined
    const colSpan = 6

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
        rowHeight: 24,
        overscan: 28,
        enabled: shouldVirtualize
    })

    const renderRow = (log: ActivityLogEntry) => (
        <ActivityLogRow
            key={log.log_id}
            log={log}
            formatTime={formatTime}
            onViewMessageHistory={onViewMessageHistory}
            isHighlighted={highlightedIds?.has(log.log_id) ?? false}
        />
    )

    return (
        <div className={tableStyles.TABLE_CONTAINER}>
            {hasFilterProps && (
                <FilterBar
                    isFilterActive={isFilterActive ?? false}
                    onClearFilters={() => {
                        setFilterAction!("")
                        setFilterMessageId!("")
                        setFilterHasAnomaly!(null)
                    }}
                >
                    {/* Search by Message ID */}
                    <div className={cn(tableStyles.FILTER_BAR_ITEM, "relative")}>
                        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <input
                            placeholder={t('activityLogs.searchMessageId')}
                            value={filterMessageId || ''}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFilterMessageId!(e.target.value)}
                            className={cn(tableStyles.FILTER_BAR_TEXT_INPUT, "w-[180px] pl-8")}
                        />
                    </div>

                    {/* Action */}
                    <div className={tableStyles.FILTER_BAR_ITEM}>
                        <span className={tableStyles.FILTER_LABEL}>{t('activityLogs.filterAction')}:</span>
                        <Select value={filterAction || "any"} onValueChange={(val: string) => setFilterAction!(val === "any" ? "" : val)}>
                            <SelectTrigger className={tableStyles.FILTER_BAR_SELECT}>
                                <SelectValue placeholder={t('common.any')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="any">{t('common.any')}</SelectItem>
                                <SelectItem value="enqueue">{t('activityLogs.actions.enqueue')}</SelectItem>
                                <SelectItem value="dequeue">{t('activityLogs.actions.dequeue')}</SelectItem>
                                <SelectItem value="ack">{t('activityLogs.actions.ack')}</SelectItem>
                                <SelectItem value="nack">{t('activityLogs.actions.nack')}</SelectItem>
                                <SelectItem value="requeue">{t('activityLogs.actions.requeue')}</SelectItem>
                                <SelectItem value="move">{t('activityLogs.actions.move')}</SelectItem>
                                <SelectItem value="delete">{t('activityLogs.actions.delete')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    {/* Has Anomaly */}
                    <div className={tableStyles.FILTER_BAR_ITEM}>
                        <span className={tableStyles.FILTER_LABEL}>{t('activityLogs.filterAnomaly')}:</span>
                        <Select
                            value={filterHasAnomaly === null ? "any" : filterHasAnomaly ? "yes" : "no"}
                            onValueChange={(val: string) => setFilterHasAnomaly!(val === "any" ? null : val === "yes")}
                        >
                            <SelectTrigger className={tableStyles.FILTER_BAR_SELECT}>
                                <SelectValue placeholder={t('common.any')} />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="any">{t('common.any')}</SelectItem>
                                <SelectItem value="yes">{t('common.yes')}</SelectItem>
                                <SelectItem value="no">{t('common.no')}</SelectItem>
                            </SelectContent>
                        </Select>
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
                                <SortableHeader column="message_id" label={t('activityLogs.columns.messageId')} currentSort={sort} onSort={handleSort} className={cn("w-[120px]", tableStyles.TABLE_HEADER_FIRST)} />
                                <SortableHeader column="timestamp" label={t('activityLogs.columns.timestamp')} currentSort={sort} onSort={handleSort} className="w-[180px]" />
                                <SortableHeader column="action" label={t('activityLogs.columns.action')} currentSort={sort} onSort={handleSort} className="w-[100px]" />
                                <SortableHeader column="queue" label={t('activityLogs.columns.queue')} currentSort={sort} onSort={handleSort} className="w-[100px]" />
                                <SortableHeader column="consumer_id" label={t('activityLogs.columns.actor')} currentSort={sort} onSort={handleSort} className="w-[192px]" />
                                <SortableHeader column="payload" label={t('activityLogs.columns.payload')} currentSort={sort} onSort={handleSort} className={tableStyles.TABLE_HEADER_LAST} />
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {sortedLogs.length === 0 ? (
                                !loading && (
                                    <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                        <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_EMPTY}>
                                            <EmptyState
                                                icon={isFilterActive ? Search : FileText}
                                                title={t('activityLogs.noLogsFound')}
                                                description={t('activityLogs.noLogsDescription')}
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
                                    {virtual.visibleItems.map(renderRow)}
                                    {virtual.bottomSpacerHeight > 0 && (
                                        <TableRow className={tableStyles.TABLE_ROW_SPACER} style={{ height: virtual.bottomSpacerHeight }}>
                                            <TableCell colSpan={colSpan} className={tableStyles.TABLE_CELL_SPACER} />
                                        </TableRow>
                                    )}
                                </>
                            ) : (
                                sortedLogs.map(renderRow)
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
