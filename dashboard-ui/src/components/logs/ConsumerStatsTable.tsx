import React, { useState, useMemo } from "react"
import { useTranslation } from "react-i18next"
import {
    User,
    RefreshCw
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHeader,
    TableRow,
    ScrollArea,
    cn,
    tableStyles,
    EmptyState,
    LoadingOverlay,
    SummaryFooter,
    SortableHeader
} from "@/components/queue/QueueTableBase"

import { ConsumerStatsResponse } from "./types"

// ============================================================================
// Consumer Stats Table Component
// ============================================================================

type SortField = 'consumer_id' | 'dequeue_count' | 'last_dequeue' | 'share'
type SortOrder = 'asc' | 'desc'

export interface ConsumerStatsTableProps {
    stats: ConsumerStatsResponse | null
    loading: boolean
    onRefresh: () => void
    formatTime: (ts?: number) => string
}

export function ConsumerStatsTable({
    stats,
    loading,
    onRefresh,
    formatTime
}: ConsumerStatsTableProps) {
    const { t } = useTranslation()
    const [sortBy, setSortBy] = useState<SortField>('dequeue_count')
    const [sortOrder, setSortOrder] = useState<SortOrder>('desc')

    const consumerEntries = stats?.stats ? Object.entries(stats.stats) : []
    const totalDequeues = consumerEntries.reduce((sum, [, data]) => sum + data.dequeue_count, 0)

    const handleSort = (field: string) => {
        const typedField = field as SortField
        if (sortBy === typedField) {
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')
        } else {
            setSortBy(typedField)
            setSortOrder('desc')
        }
    }

    const sortedEntries = useMemo(() => {
        return [...consumerEntries].sort((a, b) => {
            const [idA, dataA] = a
            const [idB, dataB] = b
            const dir = sortOrder === 'asc' ? 1 : -1

            switch (sortBy) {
                case 'consumer_id':
                    return idA.localeCompare(idB) * dir
                case 'dequeue_count':
                    return (dataA.dequeue_count - dataB.dequeue_count) * dir
                case 'last_dequeue':
                    return ((dataA.last_dequeue || 0) - (dataB.last_dequeue || 0)) * dir
                case 'share':
                    return (dataA.dequeue_count - dataB.dequeue_count) * dir
                default:
                    return 0
            }
        })
    }, [consumerEntries, sortBy, sortOrder])

    // Build summary footer items
    const summaryItems = [
        { label: t('consumers.consumers'), value: consumerEntries.length },
        { label: t('consumers.totalDequeues'), value: totalDequeues }
    ]

    return (
        <div className={tableStyles.TABLE_CONTAINER}>
            <ScrollArea
                className={tableStyles.SCROLL_AREA}
                scrollBarClassName={tableStyles.SCROLL_BAR}
            >
                {loading && <LoadingOverlay />}
                <Table>
                    <TableHeader>
                        <TableRow className={tableStyles.TABLE_ROW_HEADER}>
                            <SortableHeader label={t('consumers.consumerId')} field="consumer_id" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className={cn("w-[200px]", tableStyles.TABLE_HEADER_FIRST)} />
                            <SortableHeader label={t('consumers.dequeueCount')} field="dequeue_count" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[140px]" />
                            <SortableHeader label={t('consumers.lastActivity')} field="last_dequeue" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[180px]" />
                            <SortableHeader label={t('consumers.share')} field="share" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className={tableStyles.TABLE_HEADER_LAST} />
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!loading && sortedEntries.length === 0 ? (
                            <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                <TableCell colSpan={4} className={tableStyles.TABLE_CELL_EMPTY}>
                                    <EmptyState
                                        icon={User}
                                        title={t('consumers.noConsumerData')}
                                        description={t('consumers.consumerStatsWillAppear')}
                                    />
                                </TableCell>
                            </TableRow>
                        ) : (
                            sortedEntries.map(([consumerId, data]) => {
                                const sharePercent = totalDequeues > 0 ? ((data.dequeue_count / totalDequeues) * 100).toFixed(1) : '0'
                                const maxDequeues = Math.max(...consumerEntries.map(([, d]) => d.dequeue_count))
                                return (
                                    <TableRow key={consumerId} className={tableStyles.TABLE_ROW_BASE}>
                                        <TableCell className={cn(tableStyles.TEXT_MONO, tableStyles.TABLE_CELL_FIRST)} title={consumerId}>
                                            {consumerId}
                                        </TableCell>
                                        <TableCell>
                                            <div className={tableStyles.FLEX_INLINE}>
                                                <span className="font-bold">{data.dequeue_count.toLocaleString()}</span>
                                                <div className="flex-1 h-1.5 bg-muted rounded-full max-w-[80px]">
                                                    <div
                                                        className="h-full bg-primary rounded-full"
                                                        style={{ width: `${Math.min(100, (data.dequeue_count / maxDequeues) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className={cn(tableStyles.TEXT_MONO, "text-muted-foreground")}>
                                            {formatTime(data.last_dequeue)}
                                        </TableCell>
                                        <TableCell className={cn(tableStyles.TEXT_MUTED, tableStyles.TABLE_CELL_LAST)}>
                                            {sharePercent}%
                                        </TableCell>
                                    </TableRow>
                                )
                            })
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>

            {/* Footer */}
            {consumerEntries.length > 0 && (
                <SummaryFooter
                    items={summaryItems}
                    rightContent={
                        <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                            <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
                            {t('common.refresh')}
                        </Button>
                    }
                />
            )}
        </div>
    )
}
