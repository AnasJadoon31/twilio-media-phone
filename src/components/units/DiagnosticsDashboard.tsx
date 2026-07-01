import { Activity, Clock, Server, ArrowRight, CheckCircle2, AlertTriangle, Users, Bot, Code, Languages, FileText, ChevronRight, MessageSquare, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CallSelector } from "./CallSelector";

interface DiagnosticsDashboardProps {
    data: any;
    onClose: () => void;
    aiCoreUrl: string;
    apiKey: string;
    onFetchCall: (callSid: string) => Promise<void>;
}

export const DiagnosticsDashboard = ({ data, onClose, aiCoreUrl, apiKey, onFetchCall }: DiagnosticsDashboardProps) => {
    
    // Always render the dashboard framework so the user can use the search bar
    const {
        session_summary = {},
        routing_metrics = {},
        latest_turn_diagnostic = {},
        call_id,
        session_id,
        confirmed_language,
        state
    } = data || {};

    const avgLatency = session_summary.average_latency_ms || 0;
    const latencyColor = avgLatency < 1000 ? "text-emerald-400" : avgLatency < 3000 ? "text-amber-400" : "text-red-400";

    return (
        <div className="absolute inset-0 z-[100] bg-neutral-950 text-neutral-50 flex flex-col overflow-y-auto">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between p-6 bg-neutral-900/80 backdrop-blur-md border-b border-neutral-800">
                <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center border border-blue-500/30">
                        <Activity className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                        <h1 className="text-2xl font-semibold tracking-tight">Diagnostics Dashboard</h1>
                        {data && <p className="text-neutral-400 text-sm">Call SID: <span className="font-mono text-neutral-300">{call_id || "N/A"}</span></p>}
                    </div>
                </div>
                
                <div className="flex items-center gap-4">
                    <div className="w-64">
                        <CallSelector 
                            value={call_id || ""} 
                            onChange={(sid) => onFetchCall(sid)} 
                            aiCoreUrl={aiCoreUrl} 
                            apiKey={apiKey} 
                        />
                    </div>
                    <Button variant="outline" onClick={onClose} className="border-neutral-700 hover:bg-neutral-800 text-neutral-300">
                        Close Dashboard
                    </Button>
                </div>
            </div>

            <div className="p-8 max-w-7xl mx-auto w-full space-y-8">
                
                {!data ? (
                    <div className="flex flex-col items-center justify-center h-64 text-neutral-500 gap-4">
                        <Search className="w-12 h-12 opacity-20" />
                        <p>Select a call from the dropdown above to view its diagnostics.</p>
                    </div>
                ) : (
                    <>
                        {/* Top Row: Overview & Performance */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {/* Session Overview Card */}
                            <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-6 flex flex-col">
                                <div className="flex items-center gap-2 mb-4 text-neutral-400">
                                    <Server className="w-4 h-4" />
                                    <h2 className="font-semibold text-sm uppercase tracking-wider">Session Overview</h2>
                                </div>
                                <div className="grid grid-cols-2 gap-4 flex-1">
                                    <div className="space-y-1">
                                        <p className="text-xs text-neutral-500 uppercase">State</p>
                                        <Badge variant="outline" className="bg-neutral-950 border-neutral-700 text-neutral-300">
                                            {state || "unknown"}
                                        </Badge>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-xs text-neutral-500 uppercase">Language</p>
                                        <p className="font-semibold text-lg text-neutral-200">{confirmed_language?.toUpperCase() || "N/A"}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-xs text-neutral-500 uppercase">Started At</p>
                                        <p className="text-sm font-mono text-neutral-400">{session_summary.started_at ? new Date(session_summary.started_at).toLocaleTimeString() : "N/A"}</p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-xs text-neutral-500 uppercase">Ended At</p>
                                        <p className="text-sm font-mono text-neutral-400">{session_summary.ended_at ? new Date(session_summary.ended_at).toLocaleTimeString() : "Active"}</p>
                                    </div>
                                </div>
                            </div>

                            {/* Performance & Metrics Card */}
                            <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-6 flex flex-col">
                                <div className="flex items-center gap-2 mb-4 text-neutral-400">
                                    <Clock className="w-4 h-4" />
                                    <h2 className="font-semibold text-sm uppercase tracking-wider">Performance Metrics</h2>
                                </div>
                                <div className="grid grid-cols-2 gap-6 flex-1">
                                    <div className="space-y-1">
                                        <p className="text-xs text-neutral-500 uppercase">Avg Response Latency</p>
                                        <p className={`text-3xl font-bold font-mono ${latencyColor}`}>
                                            {avgLatency ? `${avgLatency.toFixed(0)} ms` : "---"}
                                        </p>
                                    </div>
                                    <div className="space-y-1">
                                        <p className="text-xs text-neutral-500 uppercase">Total Conversational Turns</p>
                                        <p className="text-3xl font-bold font-mono text-neutral-200">
                                            {session_summary.total_turns || 0}
                                        </p>
                                    </div>
                                    
                                    <div className="col-span-2 grid grid-cols-3 gap-2 mt-2 pt-4 border-t border-neutral-800">
                                        <div className="flex flex-col gap-1">
                                            <div className="flex items-center gap-1 text-emerald-400 text-xs"><CheckCircle2 className="w-3 h-3"/> Success</div>
                                            <span className="font-mono text-sm">{session_summary.successful_routes || 0} Routes</span>
                                        </div>
                                        <div className="flex flex-col gap-1 border-l border-neutral-800 pl-4">
                                            <div className="flex items-center gap-1 text-blue-400 text-xs"><Users className="w-3 h-3"/> Humans</div>
                                            <span className="font-mono text-sm">{session_summary.human_transfer_count || 0} Transfers</span>
                                        </div>
                                        <div className="flex flex-col gap-1 border-l border-neutral-800 pl-4">
                                            <div className="flex items-center gap-1 text-amber-400 text-xs"><AlertTriangle className="w-3 h-3"/> Fallbacks</div>
                                            <span className="font-mono text-sm">{session_summary.fallback_count || 0} Triggers</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Latest Turn Insights */}
                        <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-6">
                            <div className="flex items-center gap-2 mb-6 text-neutral-400">
                                <MessageSquare className="w-4 h-4" />
                                <h2 className="font-semibold text-sm uppercase tracking-wider">Latest Turn Insights</h2>
                            </div>
                            
                            {!latest_turn_diagnostic || Object.keys(latest_turn_diagnostic).length === 0 ? (
                                <div className="text-center p-8 text-neutral-500 bg-neutral-950 rounded-lg border border-neutral-800/50">
                                    No turn data available yet.
                                </div>
                            ) : (
                                <div className="space-y-6">
                                    {/* Input Analysis */}
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <div className="bg-neutral-950 p-4 rounded-lg border border-neutral-800 space-y-3">
                                            <h3 className="text-xs text-neutral-500 uppercase flex items-center gap-2"><Bot className="w-3 h-3"/> User Utterance</h3>
                                            <div className="text-lg text-emerald-300 font-medium italic">
                                                "{latest_turn_diagnostic.caller_text_original || '---'}"
                                            </div>
                                            {latest_turn_diagnostic.caller_text_english && latest_turn_diagnostic.caller_text_english !== latest_turn_diagnostic.caller_text_original && (
                                                <div className="text-sm text-neutral-400 pt-2 border-t border-neutral-800/50">
                                                    <span className="text-neutral-500 text-xs mr-2">EN:</span>
                                                    {latest_turn_diagnostic.caller_text_english}
                                                </div>
                                            )}
                                        </div>
                                        
                                        <div className="bg-neutral-950 p-4 rounded-lg border border-neutral-800 space-y-4">
                                            <h3 className="text-xs text-neutral-500 uppercase flex items-center gap-2"><Code className="w-3 h-3"/> NLP Extraction</h3>
                                            
                                            <div className="flex gap-6">
                                                <div className="space-y-1 flex-1">
                                                    <span className="text-[10px] text-neutral-500 uppercase block">Detected Lang</span>
                                                    <Badge variant="outline" className="bg-neutral-900 text-neutral-300 border-neutral-700">
                                                        {latest_turn_diagnostic.detected_language || 'N/A'}
                                                    </Badge>
                                                </div>
                                                <div className="space-y-1 flex-1">
                                                    <span className="text-[10px] text-neutral-500 uppercase block">STT Confidence</span>
                                                    <div className="text-sm font-mono text-emerald-400">
                                                        {latest_turn_diagnostic.stt_confidence !== undefined ? `${(latest_turn_diagnostic.stt_confidence * 100).toFixed(1)}%` : 'N/A'}
                                                    </div>
                                                </div>
                                                <div className="space-y-1 flex-1">
                                                    <span className="text-[10px] text-neutral-500 uppercase block">Source Engine</span>
                                                    <div className="text-sm text-neutral-300">
                                                        {latest_turn_diagnostic.source || 'N/A'}
                                                    </div>
                                                </div>
                                            </div>
                                            
                                        </div>
                                    </div>

                                    {/* Tasks / Intents */}
                                    {latest_turn_diagnostic.tasks && latest_turn_diagnostic.tasks.length > 0 && (
                                        <div className="space-y-2">
                                            <h3 className="text-xs text-neutral-500 uppercase flex items-center gap-2"><FileText className="w-3 h-3"/> Resolved Intents & Tasks</h3>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
                                                {latest_turn_diagnostic.tasks.map((task: any, idx: number) => (
                                                    <div key={idx} className="bg-blue-950/20 border border-blue-900/40 p-3 rounded-lg flex flex-col gap-1">
                                                        <div className="text-blue-400 font-medium text-sm flex items-center justify-between">
                                                            {task.intent || 'Unknown Intent'}
                                                            <ChevronRight className="w-3 h-3 opacity-50" />
                                                        </div>
                                                        <div className="text-xs text-neutral-400 font-mono flex items-center justify-between">
                                                            <span>Route: {task.route || 'N/A'}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                        
                        {/* Advanced Routing Metrics */}
                        {routing_metrics && Object.keys(routing_metrics).length > 0 && (
                            <div className="bg-neutral-900 rounded-xl border border-neutral-800 p-6 opacity-70 hover:opacity-100 transition-opacity">
                                <div className="flex items-center gap-2 mb-4 text-neutral-400">
                                    <Activity className="w-4 h-4" />
                                    <h2 className="font-semibold text-sm uppercase tracking-wider">Advanced LLM Routing Stats</h2>
                                </div>
                                <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-4">
                                    {Object.entries(routing_metrics)
                                        .filter(([key]) => key.includes('rate') || key.includes('count') || key.includes('latency'))
                                        .map(([key, value]) => (
                                        <div key={key} className="bg-neutral-950 rounded p-3 border border-neutral-800/50">
                                            <p className="text-[9px] text-neutral-500 uppercase truncate mb-1" title={key.replace(/_/g, ' ')}>{key.replace(/_/g, ' ')}</p>
                                            <p className="text-sm font-mono text-neutral-300">
                                                {typeof value === 'number' && key.includes('latency') ? `${value.toFixed(1)} ms` : 
                                                 typeof value === 'number' && key.includes('percent') ? `${value.toFixed(1)}%` : 
                                                 String(value)}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}
