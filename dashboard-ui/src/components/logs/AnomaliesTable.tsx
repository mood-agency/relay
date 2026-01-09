import React, { useState } from "react"
import {
    Loader2,
    Filter,
    CheckCircle2
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
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"

import { AnomaliesResponse } from "./types"
import { getActionBadge, getSeverityBadge } from "./helpers"

// ============================================================================
// Anomalies Table Component
// ============================================================================

export interface AnomaliesTableProps {
    anomalies: AnomaliesResponse | null
    loading: boolean
    severityFilter: string
    setSeverityFilter: (val: string) => void
    onRefresh: () => void
    formatTime: (ts?: number) => string
}

export function AnomaliesTable({
    anomalies,
    loading,
    severityFilter,
    setSeverityFilter,
    onRefresh,
    formatTime
}: AnomaliesTableProps) {
    const [filterOpen, setFilterOpen] = useState(false)
    const isFilterActive = severityFilter !== ''

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
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[90px]">Severity</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Anomaly Type</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Description</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[90px]">Action</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[120px]">Message ID</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[180px]">Timestamp</TableHead>
                            <TableHead className="sticky top-0 z-20 bg-card text-right pr-2">
                                <Popover open={filterOpen} onOpenChange={setFilterOpen}>
                                    <PopoverTrigger asChild>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className={cn("h-7 w-7 relative", isFilterActive && "bg-primary/10 text-primary")}
                                        >
                                            <Filter className="h-3.5 w-3.5" />
                                            {isFilterActive && (
                                                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 bg-primary rounded-full" />
                                            )}
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-56 p-4" align="end">
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h4 className="font-medium text-sm">Filters</h4>
                                                {isFilterActive && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={() => setSeverityFilter('')}
                                                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                                    >
                                                        Clear
                                                    </Button>
                                                )}
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Severity</label>
                                                <Select value={severityFilter || 'all'} onValueChange={(val) => setSeverityFilter(val === 'all' ? '' : val)}>
                                                    <SelectTrigger className="w-full h-9">
                                                        <SelectValue placeholder="All Severities" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">All Severities</SelectItem>
                                                        <SelectItem value="critical">Critical</SelectItem>
                                                        <SelectItem value="warning">Warning</SelectItem>
                                                        <SelectItem value="info">Info</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!loading && (!anomalies?.anomalies?.length) ? (
                            <TableRow className="hover:bg-transparent">
                                <TableCell colSpan={7} className="h-[400px] p-0">
                                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
                                        <CheckCircle2 className="h-12 w-12 mb-3 text-green-500 opacity-30" />
                                        <p className="font-medium">No anomalies detected</p>
                                        <p className="text-sm">Your queue is operating normally</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            anomalies?.anomalies.map((log) => (
                                <TableRow key={log.log_id} className={cn(
                                    "hover:bg-muted/50",
                                    log.anomaly?.severity === 'critical' && "bg-destructive/5"
                                )}>
                                    <TableCell>{getSeverityBadge(log.anomaly?.severity || 'info')}</TableCell>
                                    <TableCell className="font-medium text-xs">{log.anomaly?.type}</TableCell>
                                    <TableCell className="text-xs text-muted-foreground max-w-[300px]">
                                        <span className="line-clamp-2">{log.anomaly?.description}</span>
                                    </TableCell>
                                    <TableCell>{getActionBadge(log.action)}</TableCell>
                                    <TableCell className="font-mono text-xs">
                                        {log.message_id ? (
                                            <span className="truncate block" title={log.message_id}>
                                                {log.message_id.substring(0, 10)}
                                            </span>
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-xs font-mono text-muted-foreground">
                                        {formatTime(log.timestamp)}
                                    </TableCell>
                                    <TableCell />
                                </TableRow>
                            ))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>

            {/* Summary Footer */}
            {anomalies && (
                <div className="shrink-0 flex items-center justify-between px-4 py-4 border-t bg-muted/5">
                    <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-muted-foreground">Total:</span>
                            <span className="text-sm font-bold">{anomalies.summary.total}</span>
                        </div>
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-destructive" />
                                <span className="text-xs text-muted-foreground">Critical: {anomalies.summary.by_severity.critical}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-amber-500" />
                                <span className="text-xs text-muted-foreground">Warning: {anomalies.summary.by_severity.warning}</span>
                            </div>
                            <div className="flex items-center gap-1.5">
                                <span className="h-2 w-2 rounded-full bg-blue-500" />
                                <span className="text-xs text-muted-foreground">Info: {anomalies.summary.by_severity.info}</span>
                            </div>
                        </div>
                    </div>
                    <div className="text-sm text-muted-foreground">
                        {anomalies.anomalies.length} anomalies shown
                    </div>
                </div>
            )}
        </div>
    )
}
