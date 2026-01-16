import React from "react"
import {
    User,
    RefreshCw
} from "lucide-react"

import { Button } from "@/components/ui/button"
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
    EmptyState,
    LoadingOverlay,
    SummaryFooter
} from "@/components/queue/QueueTableBase"

import { ConsumerStatsResponse } from "./types"

// ============================================================================
// Consumer Stats Table Component
// ============================================================================

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
    const consumerEntries = stats?.stats ? Object.entries(stats.stats) : []
    const totalDequeues = consumerEntries.reduce((sum, [, data]) => sum + data.dequeue_count, 0)

    // Build summary footer items
    const summaryItems = [
        { label: "Consumers", value: consumerEntries.length },
        { label: "Total Dequeues", value: totalDequeues }
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
                            <TableHead className={tableStyles.TABLE_HEADER_BASE}>Consumer ID</TableHead>
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[150px]")}>Dequeue Count</TableHead>
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[200px]")}>Last Activity</TableHead>
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[100px] text-right pr-6")}>Share</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!loading && consumerEntries.length === 0 ? (
                            <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                <TableCell colSpan={4} className={tableStyles.TABLE_CELL_EMPTY}>
                                    <EmptyState
                                        icon={User}
                                        title="No consumer data"
                                        description="Consumer stats will appear as messages are dequeued"
                                    />
                                </TableCell>
                            </TableRow>
                        ) : (
                            consumerEntries.map(([consumerId, data]) => {
                                const sharePercent = totalDequeues > 0 ? ((data.dequeue_count / totalDequeues) * 100).toFixed(1) : '0'
                                return (
                                    <TableRow key={consumerId} className={tableStyles.TABLE_ROW_BASE}>
                                        <TableCell className={tableStyles.TEXT_MONO} title={consumerId}>
                                            {consumerId}
                                        </TableCell>
                                        <TableCell>
                                            <div className={tableStyles.FLEX_INLINE}>
                                                <span className="font-bold">{data.dequeue_count.toLocaleString()}</span>
                                                <div className="flex-1 h-1.5 bg-muted rounded-full max-w-[80px]">
                                                    <div
                                                        className="h-full bg-primary rounded-full"
                                                        style={{ width: `${Math.min(100, (data.dequeue_count / Math.max(...consumerEntries.map(([,d]) => d.dequeue_count))) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className={cn(tableStyles.TEXT_MONO, "text-muted-foreground")}>
                                            {formatTime(data.last_dequeue)}
                                        </TableCell>
                                        <TableCell className={cn(tableStyles.TEXT_MUTED, "text-right pr-6")}>
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
                            Refresh
                        </Button>
                    }
                />
            )}
        </div>
    )
}
