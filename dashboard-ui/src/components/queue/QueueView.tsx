import React from "react"
import {
    Loader2,
    Inbox,
    Pickaxe,
    XCircle,
    Check,
    Archive
} from "lucide-react"

import { cn } from "@/lib/utils"

import {
    type Message,
    type QueueTab,
    type QueueConfig,
    QUEUE_TAB_NAMES,
} from "./types"
import { MainQueueTable } from "./MainQueueTable"
import { ProcessingQueueTable } from "./ProcessingQueueTable"
import { AcknowledgedQueueTable } from "./AcknowledgedQueueTable"
import { ArchivedQueueTable } from "./ArchivedQueueTable"
import { DeadLetterTable } from "./DeadLetterTable"

// ============================================================================
// Queue View Props
// ============================================================================

export interface QueueViewProps {
    // Tab state
    activeTab: QueueTab
    onNavigateToTab: (tab: QueueTab) => void
    
    // Queue counts for badges
    queueCounts: {
        main: number
        processing: number
        dead: number
        acknowledged: number
        archived: number
    }
    
    // Messages data
    messages: Message[]
    config: QueueConfig | null
    
    // Loading state
    isLoading: boolean
    
    // Pagination
    pageSize: string
    setPageSize: (size: string) => void
    currentPage: number
    setCurrentPage: (page: number) => void
    totalPages: number
    totalItems: number
    
    // Sorting
    sortBy: string
    sortOrder: "asc" | "desc"
    onSort: (field: string) => void
    
    // Selection
    selectedIds: Set<string>
    onToggleSelect: (id: string, shiftKey?: boolean) => void
    onToggleSelectAll: (ids: string[]) => void
    
    // Actions
    onDelete: (id: string) => void
    onEdit?: (message: Message) => void
    onViewPayload: (payload: any) => void
    
    // Formatting
    formatTime: (ts?: number) => string
    
    // UI state
    scrollResetKey: number
    highlightedIds: Set<string>
    isFilterActive: boolean
    activeFiltersDescription: string
}

// ============================================================================
// Queue View Component
// ============================================================================

export function QueueView({
    activeTab,
    onNavigateToTab,
    queueCounts,
    messages,
    config,
    isLoading,
    pageSize,
    setPageSize,
    currentPage,
    setCurrentPage,
    totalPages,
    totalItems,
    sortBy,
    sortOrder,
    onSort,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,
    onDelete,
    onEdit,
    onViewPayload,
    formatTime,
    scrollResetKey,
    highlightedIds,
    isFilterActive,
    activeFiltersDescription
}: QueueViewProps) {
    const tabs = [
        { id: 'main' as const, icon: Inbox, count: queueCounts.main },
        { id: 'processing' as const, icon: Pickaxe, count: queueCounts.processing },
        { id: 'dead' as const, icon: XCircle, count: queueCounts.dead, variant: 'destructive' as const },
        { id: 'acknowledged' as const, icon: Check, count: queueCounts.acknowledged, variant: 'success' as const },
        { id: 'archived' as const, icon: Archive, count: queueCounts.archived },
    ]

    return (
        <div className="relative flex flex-col flex-1 min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden">
            {/* Queue Tabs */}
            <div className="flex items-center border-b bg-muted/30">
                {tabs.map((tab) => {
                    const Icon = tab.icon
                    const isActive = activeTab === tab.id
                    return (
                        <button
                            key={tab.id}
                            onClick={() => onNavigateToTab(tab.id)}
                            className={cn(
                                "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative",
                                "hover:text-foreground hover:bg-muted/50",
                                isActive 
                                    ? "text-foreground bg-background" 
                                    : "text-muted-foreground"
                            )}
                        >
                            <Icon className={cn(
                                "h-4 w-4",
                                tab.variant === 'success' && tab.count && tab.count > 0 && "text-green-500"
                            )} />
                            {QUEUE_TAB_NAMES[tab.id]}
                            {typeof tab.count === 'number' && (
                                <span className={cn(
                                    "text-xs px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                                    tab.variant === 'success' && tab.count > 0
                                        ? "bg-green-500/10 text-green-500"
                                        : "bg-muted text-muted-foreground"
                                )}>
                                    {tab.count.toLocaleString()}
                                </span>
                            )}
                            {isActive && (
                                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
                            )}
                        </button>
                    )
                })}
            </div>

            {/* Loading Overlay */}
            {isLoading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            )}

            {/* Table Content */}
            {activeTab === 'main' && (
                <MainQueueTable
                    messages={messages}
                    config={config}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onViewPayload={onViewPayload}
                    formatTime={formatTime}
                    pageSize={pageSize}
                    setPageSize={setPageSize}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onToggleSelectAll={onToggleSelectAll}
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                    totalPages={totalPages}
                    totalItems={totalItems}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={onSort}
                    scrollResetKey={scrollResetKey}
                    highlightedIds={highlightedIds}
                    isFilterActive={isFilterActive}
                    activeFiltersDescription={activeFiltersDescription}
                    isLoading={isLoading}
                />
            )}
            {activeTab === 'processing' && (
                <ProcessingQueueTable
                    messages={messages}
                    config={config}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onViewPayload={onViewPayload}
                    formatTime={formatTime}
                    pageSize={pageSize}
                    setPageSize={setPageSize}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onToggleSelectAll={onToggleSelectAll}
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                    totalPages={totalPages}
                    totalItems={totalItems}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={onSort}
                    scrollResetKey={scrollResetKey}
                    highlightedIds={highlightedIds}
                    isFilterActive={isFilterActive}
                    activeFiltersDescription={activeFiltersDescription}
                    isLoading={isLoading}
                />
            )}
            {activeTab === 'acknowledged' && (
                <AcknowledgedQueueTable
                    messages={messages}
                    config={config}
                    onDelete={onDelete}
                    onViewPayload={onViewPayload}
                    formatTime={formatTime}
                    pageSize={pageSize}
                    setPageSize={setPageSize}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onToggleSelectAll={onToggleSelectAll}
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                    totalPages={totalPages}
                    totalItems={totalItems}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={onSort}
                    scrollResetKey={scrollResetKey}
                    highlightedIds={highlightedIds}
                    isFilterActive={isFilterActive}
                    activeFiltersDescription={activeFiltersDescription}
                    isLoading={isLoading}
                />
            )}
            {activeTab === 'archived' && (
                <ArchivedQueueTable
                    messages={messages}
                    config={config}
                    onDelete={onDelete}
                    onViewPayload={onViewPayload}
                    formatTime={formatTime}
                    pageSize={pageSize}
                    setPageSize={setPageSize}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onToggleSelectAll={onToggleSelectAll}
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                    totalPages={totalPages}
                    totalItems={totalItems}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={onSort}
                    scrollResetKey={scrollResetKey}
                    highlightedIds={highlightedIds}
                    isFilterActive={isFilterActive}
                    activeFiltersDescription={activeFiltersDescription}
                    isLoading={isLoading}
                />
            )}
            {activeTab === 'dead' && (
                <DeadLetterTable
                    messages={messages}
                    config={config}
                    onDelete={onDelete}
                    onEdit={onEdit}
                    onViewPayload={onViewPayload}
                    formatTime={formatTime}
                    pageSize={pageSize}
                    setPageSize={setPageSize}
                    selectedIds={selectedIds}
                    onToggleSelect={onToggleSelect}
                    onToggleSelectAll={onToggleSelectAll}
                    currentPage={currentPage}
                    setCurrentPage={setCurrentPage}
                    totalPages={totalPages}
                    totalItems={totalItems}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onSort={onSort}
                    scrollResetKey={scrollResetKey}
                    highlightedIds={highlightedIds}
                    isFilterActive={isFilterActive}
                    activeFiltersDescription={activeFiltersDescription}
                    isLoading={isLoading}
                />
            )}
        </div>
    )
}
