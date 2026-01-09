import React, { useState, useEffect, useMemo } from "react"
import {
    Loader2,
    Check,
    Copy
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"

import { Message, QUEUE_TABS, QUEUE_TAB_NAMES } from "./types"

// ============================================================================
// Move Message Dialog
// ============================================================================

export interface MoveMessageDialogProps {
    isOpen: boolean
    onClose: () => void
    onConfirm: () => Promise<boolean>
    targetQueue: string
    setTargetQueue: (q: string) => void
    dlqReason: string
    setDlqReason: (value: string) => void
    count: number
    currentQueue: string
}

export function MoveMessageDialog({
    isOpen,
    onClose,
    onConfirm,
    targetQueue,
    setTargetQueue,
    dlqReason,
    setDlqReason,
    count,
    currentQueue
}: MoveMessageDialogProps) {
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (isOpen) setIsSubmitting(false);
    }, [isOpen]);

    const allQueues = QUEUE_TABS.map(tab => ({ value: tab, label: QUEUE_TAB_NAMES[tab] }));

    // Filter out the current queue from available options
    const availableQueues = allQueues.filter(q => q.value !== currentQueue);

    const handleConfirm = async () => {
        if (isSubmitting) return;
        setIsSubmitting(true);
        try {
            const success = await onConfirm();
            if (!success) {
                setIsSubmitting(false);
            }
        } catch (e) {
            setIsSubmitting(false);
        }
    };

    const currentQueueLabel = QUEUE_TAB_NAMES[currentQueue as keyof typeof QUEUE_TAB_NAMES] || currentQueue;

    return (
        <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && !isSubmitting && onClose()}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle>Move {count.toLocaleString()} {count === 1 ? 'message' : 'messages'}</DialogTitle>
                </DialogHeader>
                <div className="space-y-4 py-4">
                    <div className="flex items-center gap-3 text-sm">
                        <span className="text-muted-foreground">From</span>
                        <span className="font-medium px-3 py-1.5 bg-muted rounded-md">{currentQueueLabel}</span>
                        <span className="text-muted-foreground">to</span>
                        <Select value={targetQueue} onValueChange={setTargetQueue}>
                            <SelectTrigger className="w-[140px]">
                                <SelectValue placeholder="Select queue" />
                            </SelectTrigger>
                            <SelectContent>
                                {availableQueues.map(q => (
                                    <SelectItem key={q.value} value={q.value}>{q.label}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    {targetQueue === "dead" && (
                        <div className="space-y-2">
                            <label htmlFor="dlqReason" className="text-sm font-medium">
                                Error Reason
                            </label>
                            <textarea
                                id="dlqReason"
                                value={dlqReason}
                                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDlqReason(e.target.value)}
                                placeholder="Why are you moving these messages to Failed?"
                                className="flex min-h-[80px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            />
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={onClose} disabled={isSubmitting}>Cancel</Button>
                    <Button onClick={handleConfirm} disabled={isSubmitting}>
                        {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                        Move
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

// ============================================================================
// View Payload Dialog
// ============================================================================

export interface ViewPayloadDialogProps {
    isOpen: boolean
    onClose: () => void
    payload: any
}

export function ViewPayloadDialog({
    isOpen,
    onClose,
    payload
}: ViewPayloadDialogProps) {
    const [copied, setCopied] = useState(false);
    const jsonString = useMemo(() => JSON.stringify(payload, null, 2), [payload]);

    const copyToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(jsonString);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    const highlightJson = (json: string) => {
        return json.split('\n').map((line, i) => {
            const parts = line.split(/(".*?"|[:{}\[\]]|true|false|null|\d+)/g);
            return (
                <div key={i} className="min-h-[1.2em]">
                    {parts.map((part, j) => {
                        if (part.startsWith('"') && part.endsWith('"')) {
                            const isKey = line.indexOf(part) < line.indexOf(':');
                            return <span key={j} className={isKey ? "text-blue-600" : "text-green-600"}>{part}</span>;
                        }
                        if (/^[:{}\[\]]$/.test(part)) return <span key={j} className="text-gray-500">{part}</span>;
                        if (/^(true|false|null)$/.test(part)) return <span key={j} className="text-purple-600">{part}</span>;
                        if (/^\d+$/.test(part)) return <span key={j} className="text-orange-600">{part}</span>;
                        return <span key={j}>{part}</span>;
                    })}
                </div>
            );
        });
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
            <DialogContent className="sm:max-w-[1000px] w-[90vw] max-h-[90vh] flex flex-col">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <span>Message Payload</span>
                    </DialogTitle>
                </DialogHeader>
                <div className="group relative flex-1 overflow-hidden mt-4 rounded-md border bg-slate-50 text-slate-900 p-6">
                    <Button
                        variant="outline"
                        size="icon"
                        onClick={copyToClipboard}
                        className="absolute right-4 top-4 z-10 h-8 w-8 bg-white/80 backdrop-blur-sm border-slate-200 opacity-0 group-hover:opacity-100 transition-opacity duration-200 hover:bg-slate-100 hover:text-slate-900 shadow-sm"
                        title={copied ? "Copied!" : "Copy JSON"}
                    >
                        {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                    </Button>
                    <ScrollArea className="h-[60vh]">
                        <pre className="text-sm font-mono whitespace-pre leading-relaxed">
                            {highlightJson(jsonString)}
                        </pre>
                    </ScrollArea>
                </div>
                <DialogFooter className="mt-4">
                    <Button variant="secondary" onClick={onClose}>
                        Close
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ============================================================================
// Edit Message Dialog
// ============================================================================

export interface EditMessageDialogProps {
    isOpen: boolean
    onClose: () => void
    onSave: (id: string, queueType: string, updates: any) => Promise<void>
    message: Message | null
    queueType: string
    defaultAckTimeout?: number
}

export function EditMessageDialog({
    isOpen,
    onClose,
    onSave,
    message,
    queueType,
    defaultAckTimeout = 60
}: EditMessageDialogProps) {
    const [payload, setPayload] = useState("");
    const [priority, setPriority] = useState(0);
    const [type, setType] = useState("");
    const [customAckTimeout, setCustomAckTimeout] = useState<number | "">("");
    const [error, setError] = useState<string | null>(null);
    const [copiedId, setCopiedId] = useState(false);
    const [copiedPayload, setCopiedPayload] = useState(false);

    useEffect(() => {
        if (message) {
            setPayload(JSON.stringify(message.payload, null, 2));
            setPriority(message.priority || 0);
            setType(message.type || "default");
            setCustomAckTimeout(message.custom_ack_timeout ?? defaultAckTimeout);
            setError(null);
        }
    }, [message, defaultAckTimeout]);

    const copyToClipboard = async (text: string, setter: (v: boolean) => void) => {
        try {
            await navigator.clipboard.writeText(text);
            setter(true);
            setTimeout(() => setter(false), 2000);
        } catch (err) {
            console.error("Failed to copy:", err);
        }
    };

    const handleSave = async () => {
        if (!message) return;

        try {
            const updates: any = {};

            if (queueType === 'processing') {
                if (customAckTimeout === "" || Number(customAckTimeout) <= 0) {
                    setError("Ack Timeout must be a positive number");
                    return;
                }
                updates.custom_ack_timeout = Number(customAckTimeout);
            } else {
                let parsedPayload;
                try {
                    parsedPayload = JSON.parse(payload);
                } catch (e) {
                    setError("Invalid JSON payload");
                    return;
                }
                updates.payload = parsedPayload;
                updates.priority = priority;
                updates.type = type;
                if (customAckTimeout !== "" && Number(customAckTimeout) > 0) {
                    updates.custom_ack_timeout = Number(customAckTimeout);
                }
            }

            await onSave(message.id, queueType, updates);
        } catch (e) {
            setError("Failed to save message");
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Edit Message</DialogTitle>
                    <DialogDescription>
                        {queueType === 'processing'
                            ? "Edit the timeout for this processing message."
                            : "Make changes to the message here. Click save when you're done."}
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="edit-id" className="text-right text-sm font-medium">
                            ID
                        </label>
                        <div className="col-span-3 relative group">
                            <input
                                id="edit-id"
                                value={message?.id || ""}
                                readOnly
                                className="w-full flex h-9 rounded-md border border-input bg-muted px-3 pr-10 py-1 text-sm shadow-sm font-mono focus-visible:outline-none cursor-text"
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                onClick={() => copyToClipboard(message?.id || "", setCopiedId)}
                                title="Copy ID"
                            >
                                {copiedId ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                            </Button>
                        </div>
                    </div>
                    {queueType === 'processing' ? (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <label htmlFor="ackTimeout" className="text-right text-sm font-medium">
                                    Ack Timeout (s)
                                </label>
                                <input
                                    id="ackTimeout"
                                    type="number"
                                    value={customAckTimeout}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomAckTimeout(e.target.value === "" ? "" : Number(e.target.value))}
                                    className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <label htmlFor="payload-readonly" className="text-right text-sm font-medium pt-2">
                                    Payload
                                </label>
                                <div className="col-span-3 relative group">
                                    <textarea
                                        id="payload-readonly"
                                        value={payload}
                                        readOnly
                                        className="flex min-h-[150px] w-full rounded-md border border-input bg-muted px-3 py-2 pr-10 text-sm shadow-sm font-mono focus-visible:outline-none cursor-text"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => copyToClipboard(payload, setCopiedPayload)}
                                        title="Copy Payload"
                                    >
                                        {copiedPayload ? (
                                            <Check className="h-4 w-4 text-green-500" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <label htmlFor="type" className="text-right text-sm font-medium">
                                    Type
                                </label>
                                <input
                                    id="type"
                                    value={type}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setType(e.target.value)}
                                    className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <label htmlFor="priority" className="text-right text-sm font-medium">
                                    Priority
                                </label>
                                <input
                                    id="priority"
                                    type="number"
                                    value={priority}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPriority(Number(e.target.value))}
                                    className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-center gap-4">
                                <label htmlFor="ackTimeout-main" className="text-right text-sm font-medium">
                                    Ack Timeout (s)
                                </label>
                                <input
                                    id="ackTimeout-main"
                                    type="number"
                                    value={customAckTimeout}
                                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setCustomAckTimeout(e.target.value === "" ? "" : Number(e.target.value))}
                                    placeholder={`Default: ${defaultAckTimeout}s`}
                                    className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                                />
                            </div>
                            <div className="grid grid-cols-4 items-start gap-4">
                                <label htmlFor="payload" className="text-right text-sm font-medium pt-2">
                                    Payload
                                </label>
                                <div className="col-span-3 relative group">
                                    <textarea
                                        id="payload"
                                        value={payload}
                                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPayload(e.target.value)}
                                        className="flex min-h-[150px] w-full rounded-md border border-input bg-transparent px-3 py-2 pr-10 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                                    />
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="absolute right-2 top-2 h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                        onClick={() => copyToClipboard(payload, setCopiedPayload)}
                                        title="Copy Payload"
                                    >
                                        {copiedPayload ? (
                                            <Check className="h-4 w-4 text-green-500" />
                                        ) : (
                                            <Copy className="h-4 w-4" />
                                        )}
                                    </Button>
                                </div>
                            </div>
                        </>
                    )}
                    {error && (
                        <div className="text-sm text-destructive font-medium text-center">
                            {error}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleSave}>
                        Save changes
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

// ============================================================================
// Create Message Dialog
// ============================================================================

export interface CreateMessageDialogProps {
    isOpen: boolean
    onClose: () => void
    onCreate: (data: any) => Promise<void>
}

export function CreateMessageDialog({
    isOpen,
    onClose,
    onCreate
}: CreateMessageDialogProps) {
    const [payload, setPayload] = useState("{\n  \n}");
    const [priority, setPriority] = useState(0);
    const [type, setType] = useState("default");
    const [queue, setQueue] = useState("");
    const [ackTimeout, setAckTimeout] = useState<number | "">("");
    const [maxAttempts, setMaxAttempts] = useState<number | "">("");
    const [error, setError] = useState<string | null>(null);

    // Reset state when dialog opens
    useEffect(() => {
        if (isOpen) {
            setPayload("{\n  \n}");
            setPriority(0);
            setType("default");
            setQueue("");
            setAckTimeout("");
            setMaxAttempts("");
            setError(null);
        }
    }, [isOpen]);

    const handleCreate = async () => {
        try {
            let parsedPayload;
            try {
                parsedPayload = JSON.parse(payload);
            } catch (e) {
                setError("Invalid JSON payload");
                return;
            }

            const data: any = {
                type,
                payload: parsedPayload,
                priority,
            };

            if (queue.trim()) {
                data.queue = queue.trim();
            }

            if (ackTimeout !== "" && Number(ackTimeout) > 0) {
                data.ackTimeout = Number(ackTimeout);
            }

            if (maxAttempts !== "" && Number(maxAttempts) > 0) {
                data.maxAttempts = Number(maxAttempts);
            }

            await onCreate(data);
        } catch (e) {
            setError("Failed to create message");
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={(open: boolean) => !open && onClose()}>
            <DialogContent className="sm:max-w-[500px]">
                <DialogHeader>
                    <DialogTitle>Create New Message</DialogTitle>
                    <DialogDescription>
                        Create a new message to be enqueued.
                    </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-type" className="text-right text-sm font-medium">
                            Type
                        </label>
                        <input
                            id="create-type"
                            value={type}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setType(e.target.value)}
                            className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="default"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-queue" className="text-right text-sm font-medium">
                            Queue
                        </label>
                        <Select value={queue || "main"} onValueChange={(val: string) => setQueue(val === "main" ? "" : val)}>
                            <SelectTrigger className="col-span-3" id="create-queue">
                                <SelectValue placeholder="Select queue" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="main">{QUEUE_TAB_NAMES.main}</SelectItem>
                                <SelectItem value="dead">{QUEUE_TAB_NAMES.dead}</SelectItem>
                                <SelectItem value="acknowledged">{QUEUE_TAB_NAMES.acknowledged}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-priority" className="text-right text-sm font-medium">
                            Priority
                        </label>
                        <Select value={String(priority)} onValueChange={(val: string) => setPriority(Number(val))}>
                            <SelectTrigger className="col-span-3" id="create-priority">
                                <SelectValue placeholder="Select priority" />
                            </SelectTrigger>
                            <SelectContent>
                                {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((p) => (
                                    <SelectItem key={p} value={String(p)}>{p}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-ackTimeout" className="text-right text-sm font-medium">
                            Ack Timeout (s)
                        </label>
                        <input
                            id="create-ackTimeout"
                            type="number"
                            value={ackTimeout}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setAckTimeout(e.target.value === "" ? "" : Number(e.target.value))}
                            className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Optional"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-center gap-4">
                        <label htmlFor="create-maxAttempts" className="text-right text-sm font-medium">
                            Max Attempts
                        </label>
                        <input
                            id="create-maxAttempts"
                            type="number"
                            min={1}
                            step={1}
                            value={maxAttempts}
                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setMaxAttempts(e.target.value === "" ? "" : Number(e.target.value))}
                            className="col-span-3 flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                            placeholder="Optional"
                        />
                    </div>
                    <div className="grid grid-cols-4 items-start gap-4">
                        <label htmlFor="create-payload" className="text-right text-sm font-medium pt-2">
                            Payload
                        </label>
                        <textarea
                            id="create-payload"
                            value={payload}
                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setPayload(e.target.value)}
                            className="col-span-3 flex min-h-[150px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 font-mono"
                        />
                    </div>
                    {error && (
                        <div className="text-sm text-destructive font-medium text-center">
                            {error}
                        </div>
                    )}
                </div>
                <DialogFooter>
                    <Button type="button" variant="secondary" onClick={onClose}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleCreate}>
                        Create Message
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
