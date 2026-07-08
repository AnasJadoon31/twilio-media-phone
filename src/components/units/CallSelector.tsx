import React, { useState, useEffect, useRef } from 'react';
import { Check, ChevronsUpDown, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface CallSelectorProps {
    value: string;
    onChange: (callSid: string) => void;
    aiCoreUrl: string;
    apiKey: string;
    tenantSlug?: string;
}

interface Call {
    session_id: string;
    call_id: string;
    state: string;
    created_at: string;
    updated_at: string;
    tenant_slug: string;
}

export function CallSelector({ value, onChange, aiCoreUrl, apiKey, tenantSlug }: CallSelectorProps) {
    const [open, setOpen] = useState(false);
    const [calls, setCalls] = useState<Call[]>([]);
    const [loading, setLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const wrapperRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fetchCalls = async () => {
            if (!aiCoreUrl || !apiKey) return;
            setLoading(true);
            try {
                const response = await fetch(`${aiCoreUrl}/api/v1/calls?limit=100&offset=0`, {
                    headers: {
                        'accept': 'application/json',
                        'x-internal-api-key': apiKey
                    }
                });
                if (response.ok) {
                    const data = await response.json();
                    const fetchedCalls = Array.isArray(data) ? data : [];
                    setCalls(tenantSlug ? fetchedCalls.filter(call => call.tenant_slug === tenantSlug) : fetchedCalls);
                }
            } catch (error) {
                console.error("Failed to fetch calls for selector", error);
            } finally {
                setLoading(false);
            }
        };

        if (open && calls.length === 0) {
            fetchCalls();
        }
    }, [open, aiCoreUrl, apiKey, calls.length, tenantSlug]);

    useEffect(() => {
        function handleClickOutside(event: MouseEvent) {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setOpen(false);
            }
        }
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, [wrapperRef]);

    const filteredCalls = calls.filter(c => 
        (c.call_id && c.call_id.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (c.session_id && c.session_id.toLowerCase().includes(searchQuery.toLowerCase()))
    );

    return (
        <div className="relative w-full max-w-sm" ref={wrapperRef}>
            <div 
                className="flex items-center justify-between w-full p-2 text-sm bg-neutral-950 border border-neutral-800 rounded-md cursor-pointer hover:border-neutral-700 text-neutral-300"
                onClick={() => setOpen(!open)}
            >
                <span className="truncate">{value || "Search & Select a Call ID..."}</span>
                <ChevronsUpDown className="w-4 h-4 opacity-50 ml-2" />
            </div>

            {open && (
                <div className="absolute z-[110] top-full left-0 right-0 mt-1 bg-neutral-900 border border-neutral-800 rounded-md shadow-xl overflow-hidden flex flex-col">
                    <div className="flex items-center border-b border-neutral-800 p-2 gap-2 bg-neutral-950/50">
                        <Search className="w-4 h-4 text-neutral-500" />
                        <input 
                            type="text"
                            autoFocus
                            placeholder="Search calls..."
                            className="flex-1 bg-transparent border-none outline-none text-sm text-neutral-200 placeholder:text-neutral-600"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                        />
                    </div>
                    
                    <div className="max-h-[300px] overflow-y-auto">
                        {loading && (
                            <div className="p-4 flex items-center justify-center text-neutral-500">
                                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...
                            </div>
                        )}
                        {!loading && filteredCalls.length === 0 && (
                            <div className="p-4 text-center text-sm text-neutral-500">
                                No calls found.
                            </div>
                        )}
                        {!loading && filteredCalls.map(call => (
                            <div 
                                key={call.session_id}
                                className="p-2 border-b border-neutral-800/50 hover:bg-neutral-800 cursor-pointer flex items-center justify-between transition-colors"
                                onClick={() => {
                                    onChange(call.call_id);
                                    setOpen(false);
                                }}
                            >
                                <div className="flex flex-col truncate pr-2">
                                    <span className="text-sm font-medium text-neutral-200 truncate">{call.call_id}</span>
                                    <span className="text-xs text-neutral-500 truncate">{new Date(call.created_at).toLocaleString()}</span>
                                </div>
                                {value === call.call_id && <Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
