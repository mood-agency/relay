import React, { useState } from "react"
import {
    ArrowRight,
    Clock,
    Zap,
    FileText,
    History
} from "lucide-react"

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
    Tooltip,
    TooltipContent,
    TooltipTrigger,
    LoadingOverlay
} from "@/components/queue/QueueTableBase"

import { MessageHistoryResponse } from "./types"
import { getActionBadge, getSeverityBadge } from "./helpers"

// ============================================================================
// Message History Table Component
// ============================================================================

export interface MessageHistoryTableProps {
    history: MessageHistoryResponse | null
    loading: boolean
    messageId: string
    setMessageId: (val: string) => void
    onSearch: (id: string) => void
    formatTime: (ts?: number) => string
}

export function MessageHistoryTable({
    history,
    loading,
    messageId,
    setMessageId,
    onSearch,
    formatTime
}: MessageHistoryTableProps) {
    const [inputValue, setInputValue] = useState(messageId)

    const handleSearch = () => {
        const trimmedValue = inputValue.trim()
        setMessageId(trimmedValue)
        onSearch(trimmedValue)
    }

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
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[50px]")}>#</TableHead>
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[90px]")}>Action</TableHead>
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[180px]")}>Timestamp</TableHead>
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[100px]")}>Queue</TableHead>
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[100px]")}>Consumer</TableHead>
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[120px]")}>Timing</TableHead>
                            <TableHead className={tableStyles.TABLE_HEADER_BASE}>Details</TableHead>
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[50px]")}></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!loading && !history ? (
                            <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                <TableCell colSpan={8} className={tableStyles.TABLE_CELL_EMPTY}>
                                    <EmptyState
                                        icon={History}
                                        title="Enter a message ID"
                                        description="View the complete journey of any message"
                                    />
                                </TableCell>
                            </TableRow>
                        ) : !loading && history && !history.history?.length ? (
                            <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                <TableCell colSpan={8} className={tableStyles.TABLE_CELL_EMPTY}>
                                    <EmptyState
                                        icon={FileText}
                                        title="No history found"
                                        description={history.message_id}
                                    />
                                </TableCell>
                            </TableRow>
                        ) : (
                            history?.history.map((event, idx) => (
                                <HighlightableTableRow
                                    key={event.log_id}
                                    isCritical={event.anomaly?.severity === 'critical'}
                                >
                                    <TableCell className={cn(tableStyles.TEXT_MONO, "text-muted-foreground")}>
                                        {idx + 1}
                                        {idx === 0 && <span className="ml-1 text-[10px] text-green-500">●</span>}
                                    </TableCell>
                                    <TableCell>{getActionBadge(event.action)}</TableCell>
                                    <TableCell className={cn(tableStyles.TEXT_MONO, "text-muted-foreground")}>
                                        {formatTime(event.timestamp)}
                                    </TableCell>
                                    <TableCell className={tableStyles.TEXT_PRIMARY}>
                                        {event.source_queue && event.dest_queue ? (
                                            <span className={tableStyles.FLEX_INLINE}>
                                                <span>{event.source_queue}</span>
                                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                                <span>{event.dest_queue}</span>
                                            </span>
                                        ) : (
                                            event.queue || '—'
                                        )}
                                    </TableCell>
                                    <TableCell className={cn(tableStyles.TEXT_MONO, "text-muted-foreground truncate max-w-[100px]")} title={event.consumer_id || ''}>
                                        {event.consumer_id?.substring(0, 12) || '—'}
                                    </TableCell>
                                    <TableCell className={tableStyles.TEXT_PRIMARY}>
                                        {event.time_in_queue_ms !== null && (
                                            <span className="text-muted-foreground" title="Time in queue">
                                                <Clock className="h-3 w-3 inline mr-1" />
                                                {event.time_in_queue_ms}ms
                                            </span>
                                        )}
                                        {event.processing_time_ms !== null && (
                                            <span className="text-muted-foreground ml-2" title="Processing time">
                                                <Zap className="h-3 w-3 inline mr-1" />
                                                {event.processing_time_ms}ms
                                            </span>
                                        )}
                                    </TableCell>
                                    <TableCell className={tableStyles.TEXT_PRIMARY}>
                                        <div className={tableStyles.FLEX_INLINE}>
                                            {event.attempt_count !== null && (
                                                <span className="text-muted-foreground">Attempt {event.attempt_count}</span>
                                            )}
                                            {event.error_reason && (
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <span className="text-destructive truncate max-w-[150px] cursor-help">{event.error_reason}</span>
                                                    </TooltipTrigger>
                                                    <TooltipContent className="max-w-sm">
                                                        <p>{event.error_reason}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                            {event.anomaly && (
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <div className={cn(tableStyles.FLEX_INLINE, "cursor-help")}>
                                                            {getSeverityBadge(event.anomaly.severity)}
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent className="max-w-sm">
                                                        <p className="font-medium">{event.anomaly.type}</p>
                                                        <p className={tableStyles.TEXT_MUTED}>{event.anomaly.description}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell />
                                </HighlightableTableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>
        </div>
    )
}
