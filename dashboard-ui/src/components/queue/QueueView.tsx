import React from "react"
import {
    Inbox,
    Pickaxe,
    XCircle,
    Check,
    Archive
} from "lucide-react"

import {
    TabbedTableContainer,
    type TabTableConfig
} from "@/components/ui/tabbed-table"

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
    // Common table props shared across all tables
    const commonTableProps = {
        messages,
        config,
        onDelete,
        onViewPayload,
        formatTime,
        pageSize,
        setPageSize,
        selectedIds,
        onToggleSelect,
        onToggleSelectAll,
        currentPage,
        setCurrentPage,
        totalPages,
        totalItems,
        sortBy,
        sortOrder,
        onSort,
        scrollResetKey,
        highlightedIds,
        isFilterActive,
        activeFiltersDescription,
        isLoading
    }

    // Define tabs with their configurations
    const tabs: TabTableConfig[] = [
        {
            id: 'main',
            label: QUEUE_TAB_NAMES.main,
            icon: Inbox,
            count: queueCounts.main,
            render: () => (
                <MainQueueTable
                    {...commonTableProps}
                    onEdit={onEdit}
                />
            )
        },
        {
            id: 'processing',
            label: QUEUE_TAB_NAMES.processing,
            icon: Pickaxe,
            count: queueCounts.processing,
            render: () => (
                <ProcessingQueueTable
                    {...commonTableProps}
                    onEdit={onEdit}
                />
            )
        },
        {
            id: 'dead',
            label: QUEUE_TAB_NAMES.dead,
            icon: XCircle,
            count: queueCounts.dead,
            badgeVariant: 'destructive',
            render: () => (
                <DeadLetterTable
                    {...commonTableProps}
                    onEdit={onEdit}
                />
            )
        },
        {
            id: 'acknowledged',
            label: QUEUE_TAB_NAMES.acknowledged,
            icon: Check,
            count: queueCounts.acknowledged,
            badgeVariant: 'success',
            render: () => (
                <AcknowledgedQueueTable
                    {...commonTableProps}
                />
            )
        },
        {
            id: 'archived',
            label: QUEUE_TAB_NAMES.archived,
            icon: Archive,
            count: queueCounts.archived,
            render: () => (
                <ArchivedQueueTable
                    {...commonTableProps}
                />
            )
        }
    ]

    return (
        <TabbedTableContainer
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(tabId) => onNavigateToTab(tabId as QueueTab)}
            isLoading={isLoading}
        />
    )
}
