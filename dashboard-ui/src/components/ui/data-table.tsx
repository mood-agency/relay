import React, { useState, useEffect, useRef, useMemo, useCallback } from "react"
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow
} from "@/components/ui/table"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Button } from "@/components/ui/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import {
    ChevronLeft,
    ChevronRight,
    ChevronsLeft,
    ChevronsRight,
    ArrowUpDown,
    ArrowUp,
    ArrowDown,
    Inbox
} from "lucide-react"
import { cn } from "@/lib/utils"

// ============================================================================
// Types
// ============================================================================

export interface ColumnDef<T> {
    id: string
    header: string | React.ReactNode
    sortable?: boolean
    sortField?: string
    className?: string
    headerClassName?: string
    width?: string
}

export interface DataTableProps<T> {
    // Data
    data: T[]
    keyField: keyof T

    // Columns
    columns: ColumnDef<T>[]
    renderRow: (item: T, index: number) => React.ReactNode

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
    }

    // Loading
    isLoading?: boolean

    // Scroll reset
    scrollResetKey?: number

    // Custom classes
    className?: string
    scrollAreaClassName?: string
}

// ============================================================================
// Helper Components
// ============================================================================

export function SortableHeader({
    label,
    field,
    currentSort,
    currentOrder,
    onSort,
    className
}: {
    label: string
    field: string
    currentSort: string
    currentOrder: string
    onSort: (f: string) => void
    className?: string
}) {
    return (
        <TableHead
            className={cn(
                "sticky top-0 z-20 bg-card font-semibold text-foreground cursor-pointer hover:bg-muted/50 transition-colors text-xs",
                className
            )}
            onClick={() => onSort(field)}
        >
            <div className="flex items-center gap-1">
                {label}
                {currentSort === field ? (
                    currentOrder === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                ) : (
                    <ArrowUpDown className="h-3 w-3 text-muted-foreground opacity-50" />
                )}
            </div>
        </TableHead>
    )
}

export function StaticHeader({
    label,
    className
}: {
    label: string | React.ReactNode
    className?: string
}) {
    return (
        <TableHead
            className={cn(
                "sticky top-0 z-20 bg-card font-semibold text-foreground text-xs",
                className
            )}
        >
            {label}
        </TableHead>
    )
}

export function PaginationFooter({
    pageSize,
    setPageSize,
    currentPage,
    totalPages,
    setCurrentPage,
    totalItems,
    pageSizeOptions = [100, 250, 500, 1000]
}: {
    pageSize: string
    setPageSize: (size: string) => void
    currentPage: number
    totalPages: number
    setCurrentPage: (page: number) => void
    totalItems: number
    pageSizeOptions?: number[]
}) {
    return (
        <div className="shrink-0 flex items-center justify-between px-4 py-4 border-t bg-muted/5">
            <div className="flex items-center space-x-2">
                <p className="text-sm font-medium text-muted-foreground">Rows per page</p>
                <Select value={pageSize} onValueChange={setPageSize}>
                    <SelectTrigger className="h-8 w-[85px]">
                        <SelectValue placeholder={pageSize} />
                    </SelectTrigger>
                    <SelectContent side="top">
                        {pageSizeOptions.map((size: number) => (
                            <SelectItem key={size} value={`${size}`}>
                                {size}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            </div>

            <div className="flex items-center space-x-6 lg:space-x-8">
                <div className="flex w-[200px] items-center justify-center text-sm font-medium">
                    Page {currentPage.toLocaleString()} of {totalPages.toLocaleString()} ({totalItems.toLocaleString()} items)
                </div>
                <div className="flex items-center space-x-2">
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0 lg:flex"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                    >
                        <span className="sr-only">Go to first page</span>
                        <ChevronsLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage(currentPage - 1)}
                        disabled={currentPage === 1}
                    >
                        <span className="sr-only">Go to previous page</span>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0"
                        onClick={() => setCurrentPage(currentPage + 1)}
                        disabled={currentPage === totalPages}
                    >
                        <span className="sr-only">Go to next page</span>
                        <ChevronRight className="h-4 w-4" />
                    </Button>
                    <Button
                        variant="outline"
                        className="h-8 w-8 p-0 lg:flex"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                    >
                        <span className="sr-only">Go to last page</span>
                        <ChevronsRight className="h-4 w-4" />
                    </Button>
                </div>
            </div>
        </div>
    )
}

export interface EmptyStateProps {
    icon?: React.ComponentType<{ className?: string }>
    title?: string
    description?: string
    isFilterActive?: boolean
    activeFiltersDescription?: string
}

export function EmptyState({
    icon: Icon = Inbox,
    title = "No items found",
    description,
    isFilterActive,
    activeFiltersDescription
}: EmptyStateProps) {
    return (
        <div className="flex flex-col items-center justify-center py-20 px-4 text-center animate-in fade-in zoom-in duration-300">
            <div className="bg-muted/30 p-6 rounded-full mb-6 ring-8 ring-muted/10">
                <Icon className="h-10 w-10" />
            </div>
            <h3 className="text-xl font-bold text-foreground mb-2">{title}</h3>
            <p className="text-sm text-muted-foreground max-w-[400px] mb-8 leading-relaxed">
                {isFilterActive
                    ? "We couldn't find any items matching your current filters. Try adjusting your search or filters to see more results."
                    : description || "There are no items to display at the moment."}
            </p>
            {isFilterActive && activeFiltersDescription && (
                <div className="flex flex-col items-center gap-2">
                    <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">Active Filters</span>
                    <span className="font-mono text-[11px] px-3 py-1 rounded-md border bg-muted/20 border-border/50 text-muted-foreground">
                        {activeFiltersDescription}
                    </span>
                </div>
            )}
        </div>
    )
}

// ============================================================================
// Hooks
// ============================================================================

export function useElementHeight(elementRef: { current: HTMLElement | null }) {
    const [height, setHeight] = useState(0)

    useEffect(() => {
        let rafId = 0
        let cleanup = () => { }

        const attach = () => {
            const element = elementRef.current
            if (!element) {
                rafId = window.requestAnimationFrame(attach)
                return
            }

            const update = () => setHeight(element.getBoundingClientRect().height)
            update()

            if (typeof ResizeObserver === "undefined") {
                window.addEventListener("resize", update)
                cleanup = () => window.removeEventListener("resize", update)
                return
            }

            const observer = new ResizeObserver(update)
            observer.observe(element)
            cleanup = () => observer.disconnect()
        }

        attach()

        return () => {
            if (rafId) window.cancelAnimationFrame(rafId)
            cleanup()
        }
    }, [])

    return height
}

export function useVirtualization<T>({
    items,
    scrollTop,
    viewportHeight,
    rowHeight = 44,
    overscan = 8,
    enabled = true
}: {
    items: T[]
    scrollTop: number
    viewportHeight: number
    rowHeight?: number
    overscan?: number
    enabled?: boolean
}) {
    return useMemo(() => {
        if (!enabled) return null

        const viewportPx = Math.max(viewportHeight, 320)
        const total = items.length
        const totalHeight = total * rowHeight

        const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
        const endIndex = Math.min(total, Math.ceil((scrollTop + viewportPx) / rowHeight) + overscan)

        const topSpacerHeight = startIndex * rowHeight
        const bottomSpacerHeight = Math.max(0, (total - endIndex) * rowHeight)

        return {
            rowHeight,
            totalHeight,
            startIndex,
            endIndex,
            topSpacerHeight,
            bottomSpacerHeight,
            visibleItems: items.slice(startIndex, endIndex),
        }
    }, [items, scrollTop, enabled, viewportHeight, rowHeight, overscan])
}

// ============================================================================
// Main DataTable Component
// ============================================================================

export function DataTable<T extends Record<string, any>>({
    data,
    keyField,
    columns,
    renderRow,
    selectable = false,
    selectedIds,
    onToggleSelect,
    onToggleSelectAll,
    sortBy = '',
    sortOrder = 'desc',
    onSort,
    pagination,
    virtualizeThreshold = 100,
    rowHeight = 44,
    emptyState,
    isLoading = false,
    scrollResetKey = 0,
    className,
    scrollAreaClassName
}: DataTableProps<T>) {
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
    const renderHeaderCell = useCallback((column: ColumnDef<T>) => {
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

    return (
        <div className={cn("flex flex-col flex-1 min-h-0", className)}>
            <ScrollArea
                viewportRef={scrollContainerRef}
                className={cn("relative flex-1 min-h-0", scrollAreaClassName)}
                scrollBarClassName="mt-12 h-[calc(100%-3rem)]"
                onScroll={shouldVirtualize ? (e: React.UIEvent<HTMLDivElement>) => setScrollTop(e.currentTarget.scrollTop) : undefined}
            >
                <Table>
                    <TableHeader>
                        <TableRow className="hover:bg-transparent border-b border-border/50">
                            {selectable && (
                                <TableHead className="sticky top-0 z-20 bg-card w-[40px] text-xs">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary cursor-pointer align-middle accent-primary"
                                        checked={allSelected}
                                        onChange={() => onToggleSelectAll?.(data.map(item => String(item[keyField])))}
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
                                        />
                                    </TableCell>
                                </TableRow>
                            )
                        ) : shouldVirtualize && virtual ? (
                            <>
                                <TableRow className="hover:bg-transparent" style={{ height: virtual.topSpacerHeight }}>
                                    <TableCell colSpan={colSpan} className="p-0" />
                                </TableRow>
                                {virtual.visibleItems.map((item, index) => renderRow(item, virtual.startIndex + index))}
                                <TableRow className="hover:bg-transparent" style={{ height: virtual.bottomSpacerHeight }}>
                                    <TableCell colSpan={colSpan} className="p-0" />
                                </TableRow>
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
// Re-export table primitives for custom row rendering
// ============================================================================

export { TableRow, TableCell } from "@/components/ui/table"
