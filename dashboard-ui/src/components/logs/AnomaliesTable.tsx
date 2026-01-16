import React, { useState } from "react"
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
    FilterPopover,
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
    const [filterOpen, setFilterOpen] = useState(false)
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
        { label: "Total", value: anomalies.summary.total },
        { label: "Critical", value: anomalies.summary.by_severity.critical, color: "bg-destructive" },
        { label: "Warning", value: anomalies.summary.by_severity.warning, color: "bg-amber-500" },
        { label: "Info", value: anomalies.summary.by_severity.info, color: "bg-blue-500" }
    ] : []

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
                            <SortableHeader label="Severity" field="severity" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[90px]" />
                            <TableHead className={cn(tableStyles.TABLE_HEADER_BASE, "w-[120px]")}>Message ID</TableHead>
                            <SortableHeader label="Anomaly Type" field="type" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} />
                            <TableHead className={tableStyles.TABLE_HEADER_BASE}>Description</TableHead>
                            <SortableHeader label="Timestamp" field="timestamp" currentSort={sortBy} currentOrder={sortOrder} onSort={handleSort} className="w-[180px]" />
                            <TableHead className={tableStyles.TABLE_HEADER_BASE}>Payload</TableHead>
                            <TableHead className={tableStyles.TABLE_HEADER_FILTER}>
                                <FilterPopover
                                    isOpen={filterOpen}
                                    onOpenChange={setFilterOpen}
                                    isFilterActive={isFilterActive}
                                    onClearFilters={handleClearFilters}
                                >
                                    <div className="space-y-2">
                                        <label className={tableStyles.FILTER_LABEL}>Severity</label>
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
                                        <label className={tableStyles.FILTER_LABEL}>Anomaly Type</label>
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
                                </FilterPopover>
                            </TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {!loading && (!anomalies?.anomalies?.length) ? (
                            <TableRow className={tableStyles.TABLE_ROW_EMPTY}>
                                <TableCell colSpan={7} className={tableStyles.TABLE_CELL_EMPTY}>
                                    <EmptyState
                                        icon={CheckCircle2}
                                        title="No anomalies detected"
                                        description="Your queue is operating normally"
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
                                    <TableCell>{getSeverityBadge(log.anomaly?.severity || 'info')}</TableCell>
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
                                        <PayloadCell payload={log.payload} toastMessage="Payload copied to clipboard" />
                                    ) : (
                                        <TableCell className={tableStyles.TABLE_CELL_PAYLOAD}>
                                            <span className={tableStyles.TEXT_MUTED}>—</span>
                                        </TableCell>
                                    )}
                                    <TableCell />
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
                            {anomalies.anomalies.length} anomalies shown
                        </div>
                    }
                />
            )}
        </div>
    )
}
