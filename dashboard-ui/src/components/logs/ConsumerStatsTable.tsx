import React from "react"
import {
    Loader2,
    User,
    RefreshCw,
    Users
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

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

    return (
        <div className="flex flex-col flex-1 min-h-0">
            {/* Tab Header */}
            <div className="shrink-0 px-4 pt-3 pb-2 border-b border-border/50">
                <Tabs defaultValue="stats" className="w-full">
                    <TabsList className="h-9">
                        <TabsTrigger value="stats" className="gap-2 text-xs">
                            <Users className="h-3.5 w-3.5" />
                            Consumer Stats
                            {consumerEntries.length > 0 && (
                                <span className="ml-1 px-1.5 py-0.5 text-[10px] font-medium rounded-full bg-primary/10 text-primary">
                                    {consumerEntries.length}
                                </span>
                            )}
                        </TabsTrigger>
                    </TabsList>
                </Tabs>
            </div>

            <ScrollArea className="relative flex-1 min-h-0" scrollBarClassName="mt-12 h-[calc(100%-3rem)]">
                {loading && (
                    <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    </div>
                )}
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Consumer ID</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[150px]">Dequeue Count</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[200px]">Last Activity</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[100px] text-right pr-6">Share</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!loading && consumerEntries.length === 0 ? (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={4} className="h-[400px] p-0">
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                        <User className="h-12 w-12 mb-3 opacity-30" />
                                        <p className="font-medium">No consumer data</p>
                                        <p className="text-sm">Consumer stats will appear as messages are dequeued</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            consumerEntries.map(([consumerId, data]) => {
                                const sharePercent = totalDequeues > 0 ? ((data.dequeue_count / totalDequeues) * 100).toFixed(1) : '0'
                                return (
                                    <TableRow key={consumerId} className="hover:bg-muted/50">
                                        <TableCell className="font-mono text-xs" title={consumerId}>
                                            {consumerId}
                                        </TableCell>
                                        <TableCell>
                                            <div className="flex items-center gap-2">
                                                <span className="font-bold">{data.dequeue_count.toLocaleString()}</span>
                                                <div className="flex-1 h-1.5 bg-muted rounded-full max-w-[80px]">
                                                    <div 
                                                        className="h-full bg-primary rounded-full" 
                                                        style={{ width: `${Math.min(100, (data.dequeue_count / Math.max(...consumerEntries.map(([,d]) => d.dequeue_count))) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </TableCell>
                                        <TableCell className="text-xs font-mono text-muted-foreground">
                                            {formatTime(data.last_dequeue)}
                                        </TableCell>
                                        <TableCell className="text-right pr-6 text-xs text-muted-foreground">
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
                <div className="shrink-0 flex items-center justify-between px-4 py-4 border-t bg-muted/5">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-muted-foreground">Consumers:</span>
                            <span className="text-sm font-bold">{consumerEntries.length}</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-muted-foreground">Total Dequeues:</span>
                            <span className="text-sm font-bold">{totalDequeues.toLocaleString()}</span>
                        </div>
                    </div>
                    <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
                        <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
                        Refresh
                    </Button>
                </div>
            )}
        </div>
    )
}
