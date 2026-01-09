import React, { useState } from "react"
import {
    Loader2,
    Search,
    ArrowRight,
    Clock,
    Zap,
    FileText,
    History
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

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
        <div className="flex flex-col flex-1 min-h-0">
            <ScrollArea className="relative flex-1 min-h-0" scrollBarClassName="mt-12 h-[calc(100%-3rem)]">
                {loading && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                )}
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[50px]">#</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[90px]">Action</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[180px]">Timestamp</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[100px]">Queue</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[100px]">Consumer</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[120px]">Timing</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Details</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card w-[50px]"></TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!loading && !history ? (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={8} className="h-[400px] p-0">
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                        <History className="h-12 w-12 mb-3 opacity-30" />
                                        <p className="font-medium">Enter a message ID</p>
                                        <p className="text-sm">View the complete journey of any message</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : !loading && history && !history.history?.length ? (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={8} className="h-[400px] p-0">
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                        <FileText className="h-12 w-12 mb-3 opacity-30" />
                                        <p className="font-medium">No history found</p>
                                        <p className="text-sm font-mono">{history.message_id}</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            history?.history.map((event, idx) => (
                                <TableRow key={event.log_id} className={cn(
                                    "hover:bg-muted/50",
                                    event.anomaly && event.anomaly.severity === 'critical' && "bg-destructive/5"
                                )}>
                                    <TableCell className="text-xs text-muted-foreground font-mono">
                                        {idx + 1}
                                        {idx === 0 && <span className="ml-1 text-[10px] text-green-500">●</span>}
                                    </TableCell>
                                    <TableCell>{getActionBadge(event.action)}</TableCell>
                                    <TableCell className="text-xs font-mono text-muted-foreground">
                                        {formatTime(event.timestamp)}
                                    </TableCell>
                                    <TableCell className="text-xs">
                                        {event.source_queue && event.dest_queue ? (
                                            <span className="flex items-center gap-1">
                                                <span>{event.source_queue}</span>
                                                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                                                <span>{event.dest_queue}</span>
                                            </span>
                                        ) : (
                                            event.queue || '—'
                                        )}
                                    </TableCell>
                                    <TableCell className="text-xs font-mono text-muted-foreground truncate max-w-[100px]" title={event.consumer_id || ''}>
                                        {event.consumer_id?.substring(0, 12) || '—'}
                                    </TableCell>
                                    <TableCell className="text-xs">
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
                                    <TableCell className="text-xs">
                                        <div className="flex items-center gap-2">
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
                                                        <div className="flex items-center gap-1 cursor-help">
                                                            {getSeverityBadge(event.anomaly.severity)}
                                                        </div>
                                                    </TooltipTrigger>
                                                    <TooltipContent className="max-w-sm">
                                                        <p className="font-medium">{event.anomaly.type}</p>
                                                        <p className="text-xs text-muted-foreground">{event.anomaly.description}</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            )}
                                        </div>
                                    </TableCell>
                                    <TableCell />
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>


        </div>
    )
}
