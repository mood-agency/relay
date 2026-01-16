import React, { useState, useEffect, useRef, useMemo, useCallback } from "react"
import { Loader2, Inbox } from "lucide-react"
import { cn } from "@/lib/utils"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Checkbox } from "@/components/ui/checkbox"
import {
    SortableHeader,
    StaticHeader,
    PaginationFooter,
    EmptyState,
    useElementHeight,
    useVirtualization,
    type ColumnDef
} from "@/components/ui/data-table"

// ============================================================================
// Types
// ============================================================================

export interface TabDefinition {
    /** Unique identifier for the tab */
    id: string
    /** Display label for the tab */
    label: string
    /** Optional icon component */
    icon?: React.ComponentType<{ className?: string }>
    /** Badge count to display */
    count?: number
    /** Badge variant for styling */
    badgeVariant?: 'default' | 'success' | 'destructive'
}

export interface TableColumnConfig<T = any> {
    /** Unique identifier for the column */
    id: string
    /** Header label or custom render */
    header: string | React.ReactNode
    /** Is this column sortable? */
    sortable?: boolean
    /** Field to sort by (defaults to id) */
    sortField?: string
    /** Header cell className */
    headerClassName?: string
    /** Cell renderer */
    render: (item: T, index: number) => React.ReactNode
    /** Cell className */
    cellClassName?: string
}

export interface TabbedTableProps<T extends Record<string, any>> {
    // Tab configuration
    tabs: TabDefinition[]
    activeTab: string
    onTabChange: (tabId: string) => void

    // Data
    data: T[]
    keyField: keyof T

    // Columns - can be static or dynamic per tab
    columns: TableColumnConfig<T>[]

    // Selection
    selectable?: boolean
    selectedIds?: Set<string>
    onToggleSelect?: (id: string, shiftKey?: boolean) => void
    onToggleSelectAll?: (ids: string[]) => void

    // Sorting
    sortBy?: string
    sortOrder?: 'asc' | 'desc'
    onSort?: (field: string) => void

    // Pagination
    pagination?: {
        currentPage: number
        totalPages: number
        totalItems: number
        pageSize: string
        setPageSize: (size: string) => void
        setCurrentPage: (page: number) => void
    }

    // Virtualization
    virtualizeThreshold?: number
    rowHeight?: number

    // Empty state
    emptyState?: {
        icon?: React.ComponentType<{ className?: string }>
        title?: string
        description?: string
        isFilterActive?: boolean
        activeFiltersDescription?: string
    }

    // Loading
    isLoading?: boolean

    // Scroll reset key - changes when we need to reset scroll position
    scrollResetKey?: number

    // Highlighted rows (e.g., newly created)
    highlightedIds?: Set<string>

    // Row className generator
    rowClassName?: (item: T, index: number) => string

    // Custom classes
    className?: string
}

// ============================================================================
// Tab Bar Component
// ============================================================================

export function TabBar({
    tabs,
    activeTab,
    onTabChange,
    className
}: {
    tabs: TabDefinition[]
    activeTab: string
    onTabChange: (tabId: string) => void
    className?: string
}) {
    return (
        <div className={cn("flex items-center border-b bg-muted/30", className)}>
            {tabs.map((tab) => {
                const Icon = tab.icon
                const isActive = activeTab === tab.id
                return (
                    <button
                        key={tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-colors relative",
                            "hover:text-foreground hover:bg-muted/50",
                            isActive
                                ? "text-foreground bg-background"
                                : "text-muted-foreground"
                        )}
                    >
                        {Icon && (
                            <Icon className={cn(
                                "h-4 w-4",
                                tab.badgeVariant === 'success' && tab.count && tab.count > 0 && "text-green-500",
                                tab.badgeVariant === 'destructive' && tab.count && tab.count > 0 && "text-destructive"
                            )} />
                        )}
                        {tab.label}
                        {typeof tab.count === 'number' && (
                            <span className={cn(
                                "text-xs px-1.5 py-0.5 rounded-full min-w-[1.25rem] text-center",
                                tab.badgeVariant === 'success' && tab.count > 0
                                    ? "bg-green-500/10 text-green-500"
                                    : tab.badgeVariant === 'destructive' && tab.count > 0
                                        ? "bg-destructive/10 text-destructive"
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
    )
}

// ============================================================================
// Generic Table Component
// ============================================================================

export function GenericTable<T extends Record<string, any>>({
    data,
    keyField,
    columns,
    selectable = false,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,
    sortBy = '',
    sortOrder = 'desc',
    onSort,
    pagination,
    virtualizeThreshold = 100,
    rowHeight = 24,
    emptyState,
    isLoading = false,
    scrollResetKey = 0,
    highlightedIds,
    rowClassName,
    className
}: Omit<TabbedTableProps<T>, 'tabs' | 'activeTab' | 'onTabChange'>) {
    const scrollContainerRef = useRef<HTMLDivElement | null>(null)
    const viewportHeight = useElementHeight(scrollContainerRef)
    const [scrollTop, setScrollTop] = useState(0)

    const shouldVirtualize = data.length >= virtualizeThreshold
    const colSpan = columns.length + (selectable ? 1 : 0)

    // Reset scroll on key change
    useEffect(() => {
        setScrollTop(0)
        if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
    }, [scrollResetKey])

    // Virtualization
    const virtual = useVirtualization({
        items: data,
        scrollTop,
        viewportHeight,
        rowHeight,
        enabled: shouldVirtualize
    })

    // Selection state
    const allSelected = selectable && data.length > 0 && data.every(item => selectedIds?.has(String(item[keyField])))

    // Render header cell
    const renderHeaderCell = useCallback((column: TableColumnConfig<T>) => {
        if (column.sortable && onSort) {
            return (
                <SortableHeader
                    key={column.id}
                    label={typeof column.header === 'string' ? column.header : ''}
                    field={column.sortField || column.id}
                    currentSort={sortBy}
                    currentOrder={sortOrder}
                    onSort={onSort}
                    className={column.headerClassName}
                />
            )
        }
        return (
            <StaticHeader
                key={column.id}
                label={column.header}
                className={column.headerClassName}
            />
        )
    }, [sortBy, sortOrder, onSort])

    // Render row
    const renderRow = useCallback((item: T, index: number) => {
        const id = String(item[keyField])
        const isHighlighted = highlightedIds?.has(id)
        const isSelected = selectedIds?.has(id)
        const customClassName = rowClassName?.(item, index)

        return (
            <TableRow
                key={id}
                className={cn(
                    "group transition-colors duration-150 border-muted/30",
                    isHighlighted && "animate-highlight",
                    customClassName
                )}
            >
                {selectable && (
                    <TableCell>
                        <Checkbox
                            checked={isSelected}
                            onCheckedChange={(_, shiftKey) => onToggleSelect?.(id, shiftKey)}
                        />
                    </TableCell>
                )}
                {columns.map((column) => (
                    <TableCell key={column.id} className={column.cellClassName}>
                        {column.render(item, index)}
                    </TableCell>
                ))}
            </TableRow>
        )
    }, [keyField, highlightedIds, selectedIds, selectable, onToggleSelect, columns, rowClassName])

    return (
        <div className={cn("flex flex-col flex-1 min-h-0", className)}>
            <ScrollArea
                viewportRef={scrollContainerRef}
                className="relative flex-1 min-h-0"
                scrollBarClassName="mt-12 h-[calc(100%-3rem)]"
                onScroll={shouldVirtualize ? (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop) : undefined}
            >
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            {selectable && (
                                <TableHead className="sticky top-0 z-20 bg-card w-[40px] text-xs">
                                    <Checkbox
                                        checked={allSelected}
                                        onCheckedChange={() => onToggleSelectAll?.(data.map(item => String(item[keyField])))}
                                    />
                                </TableHead>
                            )}
                            {columns.map(renderHeaderCell)}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {data.length === 0 ? (
                            !isLoading && (
                                <TableRow className="hover:bg-transparent">
                                    <TableCell colSpan={colSpan} className="h-[400px] p-0">
                                        <EmptyState
                                            icon={emptyState?.icon}
                                            title={emptyState?.title}
                                            description={emptyState?.description}
                                            isFilterActive={emptyState?.isFilterActive}
                                            activeFiltersDescription={emptyState?.activeFiltersDescription}
                                        />
                                    </TableCell>
                                </TableRow>
                            )
                        ) : shouldVirtualize && virtual ? (
                            <>
                                {virtual.topSpacerHeight > 0 && (
                                    <TableRow className="hover:bg-transparent" style={{ height: virtual.topSpacerHeight }}>
                                        <TableCell colSpan={colSpan} className="p-0 h-auto" />
                                    </TableRow>
                                )}
                                {virtual.visibleItems.map((item, i) => renderRow(item, virtual.startIndex + i))}
                                {virtual.bottomSpacerHeight > 0 && (
                                    <TableRow className="hover:bg-transparent" style={{ height: virtual.bottomSpacerHeight }}>
                                        <TableCell colSpan={colSpan} className="p-0 h-auto" />
                                    </TableRow>
                                )}
                            </>
                        ) : (
                            data.map((item, index) => renderRow(item, index))
                        )}
                    </TableBody>
                </Table>
            </ScrollArea>
            {pagination && pagination.totalPages > 0 && (
                <PaginationFooter
                    pageSize={pagination.pageSize}
                    setPageSize={pagination.setPageSize}
                    currentPage={pagination.currentPage}
                    totalPages={pagination.totalPages}
                    setCurrentPage={pagination.setCurrentPage}
                    totalItems={pagination.totalItems}
                />
            )}
        </div>
    )
}

// ============================================================================
// TabbedTable Component - Combines TabBar with GenericTable
// ============================================================================

export function TabbedTable<T extends Record<string, any>>({
    tabs,
    activeTab,
    onTabChange,
    isLoading,
    className,
    ...tableProps
}: TabbedTableProps<T>) {
    return (
        <div className={cn(
            "relative flex flex-col flex-1 min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden",
            className
        )}>
            {/* Tab Bar */}
            <TabBar
                tabs={tabs}
                activeTab={activeTab}
                onTabChange={onTabChange}
            />

            {/* Loading Overlay */}
            {isLoading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            )}

            {/* Table Content */}
            <GenericTable<T>
                {...tableProps}
                isLoading={isLoading}
            />
        </div>
    )
}

// ============================================================================
// TabbedTableContainer - For when each tab has completely different table configs
// ============================================================================

export interface TabTableConfig {
    id: string
    label: string
    icon?: React.ComponentType<{ className?: string }>
    count?: number
    badgeVariant?: 'default' | 'success' | 'destructive'
    /** Render function for the table content */
    render: () => React.ReactNode
}

export interface TabbedTableContainerProps {
    tabs: TabTableConfig[]
    activeTab: string
    onTabChange: (tabId: string) => void
    isLoading?: boolean
    className?: string
}

export function TabbedTableContainer({
    tabs,
    activeTab,
    onTabChange,
    isLoading,
    className
}: TabbedTableContainerProps) {
    const activeTabConfig = tabs.find(t => t.id === activeTab)

    return (
        <div className={cn(
            "relative flex flex-col flex-1 min-h-0 rounded-xl border bg-card text-card-foreground shadow-sm overflow-hidden",
            className
        )}>
            {/* Tab Bar */}
            <TabBar
                tabs={tabs.map(t => ({
                    id: t.id,
                    label: t.label,
                    icon: t.icon,
                    count: t.count,
                    badgeVariant: t.badgeVariant
                }))}
                activeTab={activeTab}
                onTabChange={onTabChange}
            />

            {/* Loading Overlay */}
            {isLoading && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/50 backdrop-blur-sm">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                </div>
            )}

            {/* Active Tab Content */}
            {activeTabConfig?.render()}
        </div>
    )
}

// ============================================================================
// Re-exports for convenience
// ============================================================================

export type { ColumnDef } from "@/components/ui/data-table"
export {
    SortableHeader,
    StaticHeader,
    PaginationFooter,
    EmptyState,
    useElementHeight,
    useVirtualization
} from "@/components/ui/data-table"
