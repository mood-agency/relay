import React from "react"
import { useTranslation } from "react-i18next"
import { CheckCircle2 } from "lucide-react"

import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
    ScrollArea,
    cn,
    tableStyles,
    HighlightableTableRow,
    EmptyState,
    Badge,
    SortableHeader,
    PayloadCell,
    CopyableIdCell,
    LoadingOverlay,
    FilterBar,
    SummaryFooter
} from "@/components/queue/QueueTableBase"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"

import { AnomaliesResponse } from "./types"
import { getSeverityBadge } from "./helpers"

// ============================================================================
// Anomalies Table Component
// ============================================================================

export interface AnomaliesTableProps {
    anomalies: AnomaliesResponse | null
    loading: boolean
    severityFilter: string
    setSeverityFilter: (val: string) => void
    typeFilter: string
    setTypeFilter: (val: string) => void
    sortBy: string
    setSortBy: (val: string) => void
    sortOrder: string
    setSortOrder: (val: string) => void
    onRefresh: () => void
    formatTime: (ts?: number) => string
}

export function AnomaliesTable({
    anomalies,
    loading,
    severityFilter,
    setSeverityFilter,
    typeFilter,
    setTypeFilter,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    onRefresh: _onRefresh,
    formatTime
}: AnomaliesTableProps) {
    const { t } = useTranslation()
    const isFilterActive = severityFilter !== '' || typeFilter !== ''

    // onRefresh is available via props if needed in the future
    void _onRefresh

    const handleClearFilters = () => {
        setSeverityFilter('')
        setTypeFilter('')
    }

    const handleSort = (field: string) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')
        } else {
            setSortBy(field)
            setSortOrder('desc')
        }
    }

    // Build summary footer items
    const summaryItems = anomalies ? [
        { label: t('anomalies.total'), value: anomalies.summary.total },
        { label: t('anomalies.critical'), value: anomalies.summary.by_severity.critical, color: "bg-destructive" },
        { label: t('anomalies.warning'), value: anomalies.summary.by_severity.warning, color: "bg-amber-500" },
        { label: t('anomalies.info'), value: anomalies.summary.by_severity.info, color: "bg-blue-500" }
    ] : []

    return (
        <div className={tableStyles.TABLE_CONTAINER}>
            <FilterBar
                isFilterActive={isFilterActive}
                onClearFilters={handleClearFilters}
            >
                {/* Severity */}
                <div className={tableStyles.FILTER_BAR_ITEM}>
                    <span className={tableStyles.FILTER_LABEL}>{t('anomalies.severity')}:</span>
                    <Select value={severityFilter || 'all'} onValueChange={(val) => setSeverityFilter(val === 'all' ? '' : val)}>
                        <SelectTrigger className={tableStyles.FILTER_BAR_SELECT}>
                            <SelectValue placeholder={t('common.all')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t('common.all')}</SelectItem>
                            <SelectItem value="critical">{t('anomalies.critical')}</SelectItem>
                            <SelectItem value="warning">{t('anomalies.warning')}</SelectItem>
                            <SelectItem value="info">{t('anomalies.info')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Anomaly Type */}
                <div className={tableStyles.FILTER_BAR_ITEM}>
                    <span className={tableStyles.FILTER_LABEL}>{t('common.type')}:</span>
                    <Select value={typeFilter || 'all'} onValueChange={(val) => setTypeFilter(val === 'all' ? '' : val)}>
                        <SelectTrigger className={tableStyles.FILTER_BAR_SELECT}>
                            <SelectValue placeholder={t('common.all')} />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">{t('anomalies.allTypes')}</SelectItem>
                            <SelectItem value="flash_message">{t('anomalies.flashMessage')}</SelectItem>
                            <SelectItem value="zombie_message">{t('anomalies.zombieMessage')}</SelectItem>
                            <SelectItem value="near_dlq">{t('anomalies.nearDlq')}</SelectItem>
                            <SelectItem value="dlq_movement">{t('anomalies.dlqMovement')}</SelectItem>
                            <SelectItem value="long_processing">{t('anomalies.longProcessing')}</SelectItem>
                            <SelectItem value="lock_stolen">{t('anomalies.lockStolen')}</SelectItem>
                            <SelectItem value="burst_dequeue">{t('anomalies.burstDequeue')}</SelectItem>
                            <SelectItem value="bulk_delete">{t('anomalies.bulkDelete')}</SelectItem>
                            <SelectItem value="bulk_move">{t('anomalies.bulkMove')}</SelectItem>
                            <SelectItem value="queue_cleared">{t('anomalies.queueCleared')}</SelectItem>
                            <SelectItem value="large_payload">{t('anomalies.largePayload')}</SelectItem>
                        </SelectContent>
                    </Select>
                </div>
            </FilterBar>
            <ScrollArea
                className={tableStyles.SCROLL_AREA}
                scrollBarClassName={tableStyles.SCROLL_BAR}
            >
                {loading && <LoadingOverlay />}
                <Table>
                    <TableHeader>
                        <TableRow className={tableStyles.TABLE_ROW_HEADER}>
                            <SortableHeader label={t('anomalies.severity')} field="severity" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className={cn("w-[90px]", tableStyles.TABLE_HEADER_FIRST)} />
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[120px]")}>{t('activityLogs.columns.messageId')}</TableHead>
                            <SortableHeader label={t('anomalies.anomalyType')} field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[140px]" />
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[220px]")}>{t('fields.description')}</TableHead>
                            <SortableHeader label={t('activityLogs.columns.timestamp')} field="timestamp" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[180px]" />
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, tableStyles.TABLE_HEADER_LAST)}>{t('activityLogs.columns.payload')}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!loading && (!anomalies?.anomalies?.length) ? (
                            <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                <TableCell colSpan={6} className={tableStyles.TABLE_CELL_EMPTY}>
                                    <EmptyState
                                        icon={CheckCircle2}
                                        title={t('anomalies.noAnomalies')}
                                        description={t('anomalies.queueOperatingNormally')}
                                        isFilterActive={isFilterActive}
                                    />
                                </TableCell>
                            </TableRow>
                        ) : (
                            anomalies?.anomalies.map((log) => (
                                <HighlightableTableRow
                                    key={log.log_id}
                                    isCritical={log.anomaly?.severity === 'critical'}
                                >
                                    <TableCell className={tableStyles.TABLE_CELL_FIRST}>{getSeverityBadge(log.anomaly?.severity || 'info')}</TableCell>
                                    {log.message_id ? (
                                        <CopyableIdCell id={log.message_id} truncateLength={10} />
                                    ) : (
                                        <TableCell className={cn(tableStyles.TEXT_MONO, tableStyles.TABLE_CELL_ID)}>
                                            <span className={tableStyles.TEXT_MUTED}>—</span>
                                        </TableCell>
                                    )}
                                    <TableCell className="text-left">
                                        <Badge variant="outline" className={tableStyles.BADGE_TYPE}>{log.anomaly?.type}</Badge>
                                    </TableCell>
                                    <TableCell className={cn(tableStyles.TEXT_PRIMARY, "max-w-[300px]")}>
                                        <span className="line-clamp-2">{log.anomaly?.description}</span>
                                    </TableCell>
                                    <TableCell className={tableStyles.TABLE_CELL_TIME}>
                                        {formatTime(log.timestamp)}
                                    </TableCell>
                                    {log.payload ? (
                                        <PayloadCell payload={log.payload} toastMessage={t('common.payloadCopied')} className={tableStyles.TABLE_CELL_LAST} />
                                    ) : (
                                        <TableCell className={cn(tableStyles.TABLE_CELL_PAYLOAD, tableStyles.TABLE_CELL_LAST)}>
                                            <span className={tableStyles.TEXT_MUTED}>—</span>
                                        </TableCell>
                                    )}
                                </HighlightableTableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>

            {/* Summary Footer */}
            {anomalies && (
                <SummaryFooter
                    items={summaryItems}
                    rightContent={
                        <div className={tableStyles.TEXT_MUTED}>
                            {t('anomalies.anomaliesShown', { count: anomalies.anomalies.length })}
                        </div>
                    }
                />
            )}
        </div>
    )
}
