import React, { useState } from "react"
import {
    Loader2,
    Filter,
    CheckCircle2,
    Copy,
    ArrowUp,
    ArrowDown,
    ArrowUpDown
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
import {
    Tooltip,
    TooltipContent,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import { toast } from "@/components/ui/sonner"
import { Badge } from "@/components/ui/badge"

import { AnomaliesResponse } from "./types"
import { getActionBadge, getSeverityBadge } from "./helpers"
import { syntaxHighlightJson } from "@/components/queue/types"

// ============================================================================
// Sort Types
// ============================================================================

type SortColumn = 'severity' | 'type' | 'action' | 'timestamp'

// ============================================================================
// Sortable Header Component
// ============================================================================

const SortableHeader = ({
    column,
    label,
    currentSortBy,
    currentSortOrder,
    onSort,
    className
}: {
    column: SortColumn
    label: string
    currentSortBy: string
    currentSortOrder: string
    onSort: (column: SortColumn) => void
    className?: string
}) => {
    const isActive = currentSortBy === column
    return (
        <TableHead
            className={cn(
                "sticky top-0 z-20 bg-card font-semibold text-foreground text-xs cursor-pointer select-none hover:bg-muted/50 transition-colors",
                className
            )}
            onClick={() => onSort(column)}
        >
            <div className="flex items-center gap-1">
                <span>{label}</span>
                {isActive ? (
                    currentSortOrder === 'asc' ? (
                        <ArrowUp className="h-3 w-3" />
                    ) : (
                        <ArrowDown className="h-3 w-3" />
                    )
                ) : (
                    <ArrowUpDown className="h-3 w-3 text-muted-foreground/50" />
                )}
            </div>
        </TableHead>
    )
}

// ============================================================================
// Anomalies Table Component
// ============================================================================

export interface AnomaliesTableProps {
    anomalies: AnomaliesResponse | null
    loading: boolean
    severityFilter: string
    setSeverityFilter: (val: string) => void
    actionFilter: string
    setActionFilter: (val: string) => void
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
    actionFilter,
    setActionFilter,
    typeFilter,
    setTypeFilter,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    onRefresh,
    formatTime
}: AnomaliesTableProps) {
    const [filterOpen, setFilterOpen] = useState(false)
    const isFilterActive = severityFilter !== '' || actionFilter !== '' || typeFilter !== ''

    // Derive available anomaly types from the data
    const availableAnomalyTypes = anomalies?.summary?.by_type
        ? Object.keys(anomalies.summary.by_type)
        : []

    const handleClearFilters = () => {
        setSeverityFilter('')
        setActionFilter('')
        setTypeFilter('')
    }

    const handleSort = (column: SortColumn) => {
        if (sortBy === column) {
            setSortOrder(sortOrder === 'desc' ? 'asc' : 'desc')
        } else {
            setSortBy(column)
            setSortOrder('desc')
        }
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
                            <SortableHeader column="severity" label="Severity" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} className="w-[90px]" />
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs w-[120px]">Message ID</TableHead>
                            <SortableHeader column="type" label="Anomaly Type" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} />
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Description</TableHead>
                            <SortableHeader column="action" label="Action" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} className="w-[90px]" />
                            <SortableHeader column="timestamp" label="Timestamp" currentSortBy={sortBy} currentSortOrder={sortOrder} onSort={handleSort} className="w-[180px]" />
                            <TableHead className="sticky top-0 z-20 bg-card font-semibold text-foreground text-xs">Payload</TableHead>
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
                                    <PopoverContent className="w-64 p-4" align="end">
                                        <div className="space-y-4">
                                            <div className="flex items-center justify-between">
                                                <h4 className="font-medium text-sm">Filters</h4>
                                                {isFilterActive && (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        onClick={handleClearFilters}
                                                        className="h-7 text-xs text-muted-foreground hover:text-foreground"
                                                    >
                                                        Clear all
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
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Action</label>
                                                <Select value={actionFilter || 'all'} onValueChange={(val) => setActionFilter(val === 'all' ? '' : val)}>
                                                    <SelectTrigger className="w-full h-9">
                                                        <SelectValue placeholder="All Actions" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">All Actions</SelectItem>
                                                        <SelectItem value="enqueue">Enqueue</SelectItem>
                                                        <SelectItem value="dequeue">Dequeue</SelectItem>
                                                        <SelectItem value="ack">Acknowledge</SelectItem>
                                                        <SelectItem value="nack">Nack</SelectItem>
                                                        <SelectItem value="requeue">Requeue</SelectItem>
                                                        <SelectItem value="timeout">Timeout</SelectItem>
                                                        <SelectItem value="touch">Touch</SelectItem>
                                                        <SelectItem value="move">Move</SelectItem>
                                                        <SelectItem value="dlq">Dead Letter</SelectItem>
                                                        <SelectItem value="delete">Delete</SelectItem>
                                                        <SelectItem value="clear">Clear</SelectItem>
                                                    </SelectContent>
                                                </Select>
                                            </div>
                                            <div className="space-y-2">
                                                <label className="text-xs font-medium text-foreground/80">Anomaly Type</label>
                                                <Select value={typeFilter || 'all'} onValueChange={(val) => setTypeFilter(val === 'all' ? '' : val)}>
                                                    <SelectTrigger className="w-full h-9">
                                                        <SelectValue placeholder="All Types" />
                                                    </SelectTrigger>
                                                    <SelectContent>
                                                        <SelectItem value="all">All Types</SelectItem>
                                                        <SelectItem value="flash_message">Flash Message</SelectItem>
                                                        <SelectItem value="zombie_message">Zombie Message</SelectItem>
                                                        <SelectItem value="near_dlq">Near DLQ</SelectItem>
                                                        <SelectItem value="dlq_movement">DLQ Movement</SelectItem>
                                                        <SelectItem value="long_processing">Long Processing</SelectItem>
                                                        <SelectItem value="lock_stolen">Lock Stolen</SelectItem>
                                                        <SelectItem value="burst_dequeue">Burst Dequeue</SelectItem>
                                                        <SelectItem value="bulk_delete">Bulk Delete</SelectItem>
                                                        <SelectItem value="bulk_move">Bulk Move</SelectItem>
                                                        <SelectItem value="queue_cleared">Queue Cleared</SelectItem>
                                                        <SelectItem value="large_payload">Large Payload</SelectItem>
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
                                <TableCell colSpan={8} className="h-[400px] p-0">
                                    <div className="flex flex-col items-center justify-center h-full text-center animate-in fade-in zoom-in duration-300">
                                        <div className="bg-green-500/10 p-6 rounded-full mb-6 ring-8 ring-green-500/5">
                                            <CheckCircle2 className="h-10 w-10 text-green-500" />
                                        </div>
                                        <h3 className="text-xl font-bold text-foreground mb-2">No anomalies detected</h3>
                                        <p className="text-sm text-muted-foreground max-w-[400px] leading-relaxed">Your queue is operating normally</p>
                                    </div>
                                </TableCell>
                            </TableRow>
                        ) : (
                            anomalies?.anomalies.map((log) => (
                                <TableRow key={log.log_id} className={cn(
                                    "group transition-colors duration-150 border-muted/30",
                                    log.anomaly?.severity === 'critical' && "bg-destructive/5"
                                )}>
                                    <TableCell>{getSeverityBadge(log.anomaly?.severity || 'info')}</TableCell>
                                    <TableCell className="font-mono text-xs group/id">
                                        {log.message_id ? (
                                            <div className="flex items-center gap-1">
                                                <span className="truncate" title={log.message_id}>
                                                    {log.message_id.substring(0, 10)}
                                                </span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation()
                                                        e.preventDefault()
                                                        navigator.clipboard.writeText(log.message_id!)
                                                        toast.success("ID copied to clipboard")
                                                    }}
                                                    className="opacity-0 group-hover/id:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded flex-shrink-0"
                                                    tabIndex={-1}
                                                    title="Copy ID"
                                                >
                                                    <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                                </button>
                                            </div>
                                        ) : (
                                            <span className="text-muted-foreground">—</span>
                                        )}
                                    </TableCell>
                                    <TableCell className="text-left">
                                        <Badge variant="outline" className="font-medium whitespace-nowrap">{log.anomaly?.type}</Badge>
                                    </TableCell>
                                    <TableCell className="text-xs text-foreground max-w-[300px]">
                                        <span className="line-clamp-2">{log.anomaly?.description}</span>
                                    </TableCell>
                                    <TableCell>{getActionBadge(log.action)}</TableCell>
                                    <TableCell className="text-xs font-mono text-foreground whitespace-nowrap">
                                        {formatTime(log.timestamp)}
                                    </TableCell>
                                    <TableCell className="max-w-[200px] cursor-default group/payload">
                                        {log.payload ? (
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-xs font-mono truncate text-muted-foreground group-hover/payload:text-foreground transition-colors">
                                                            {JSON.stringify(log.payload)}
                                                        </span>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation()
                                                                e.preventDefault()
                                                                navigator.clipboard.writeText(JSON.stringify(log.payload, null, 2))
                                                                toast.success("Payload copied to clipboard")
                                                            }}
                                                            className="opacity-0 group-hover/payload:opacity-100 transition-opacity p-0.5 hover:bg-muted rounded flex-shrink-0"
                                                            tabIndex={-1}
                                                            title="Copy payload"
                                                        >
                                                            <Copy className="h-3 w-3 text-muted-foreground hover:text-foreground" />
                                                        </button>
                                                    </div>
                                                </TooltipTrigger>
                                                <TooltipContent side="top" className="max-w-[400px] max-h-[300px] overflow-auto p-0">
                                                    <pre className="text-xs p-3 rounded-md bg-slate-950 text-slate-50 overflow-auto">
                                                        <code dangerouslySetInnerHTML={{ __html: syntaxHighlightJson(JSON.stringify(log.payload, null, 2)) }} />
                                                    </pre>
                                                </TooltipContent>
                                            </Tooltip>
                                        ) : (
                                            <span className="text-muted-foreground text-xs">—</span>
                                        )}
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
