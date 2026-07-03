"use client";

import React, { useState, useEffect } from 'react';
import { 
  Activity, PhoneCall, PhoneMissed, CheckCircle2, 
  Cpu, Zap, Clock, Send, CheckSquare, ListTodo, AlertTriangle 
} from 'lucide-react';
import { MetricCard } from '@/components/dashboard/MetricCard';
import { TenantTable } from '@/components/dashboard/TenantTable';

export default function DashboardPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        const response = await fetch('/api/metrics');
        if (!response.ok) {
          throw new Error('Network response was not ok');
        }
        const jsonData = await response.json();
        setData(jsonData);
        setError(null);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    fetchMetrics();
    // Poll every 5 seconds
    const interval = setInterval(fetchMetrics, 5000);
    return () => clearInterval(interval);
  }, []);

  if (loading && !data) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Activity className="w-12 h-12 text-purple-500 animate-spin" />
          <p className="text-neutral-400 animate-pulse font-medium tracking-widest uppercase">Initializing Observability</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center">
        <div className="flex flex-col items-center gap-4 bg-red-950/30 p-8 rounded-2xl border border-red-500/30">
          <AlertTriangle className="w-16 h-16 text-red-500" />
          <h2 className="text-2xl font-bold text-red-400">System Error</h2>
          <p className="text-red-300">{error}</p>
        </div>
      </div>
    );
  }

  const { status, system_metrics, llm_metrics, task_dispatch_metrics, tenant_breakdown } = data;
  const isHealthy = status === 'healthy';

  return (
    <div className="min-h-screen bg-black text-white selection:bg-purple-500/30">
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-purple-900/20 via-black to-black -z-10 pointer-events-none" />
      
      <div className="max-w-7xl mx-auto p-8 space-y-12">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 pb-6 border-b border-white/10">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className={`w-3 h-3 rounded-full ${isHealthy ? 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.8)]' : 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.8)]'} animate-pulse`} />
              <span className={`text-sm font-semibold uppercase tracking-wider ${isHealthy ? 'text-emerald-400' : 'text-red-400'}`}>
                {status}
              </span>
            </div>
            <h1 className="text-4xl md:text-5xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-neutral-500">
              Observability
            </h1>
          </div>
          <div className="flex items-center gap-2 px-4 py-2 bg-white/5 rounded-full border border-white/10 backdrop-blur-sm">
            <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping" />
            <span className="text-xs font-medium text-neutral-400 tracking-widest uppercase">Live Updates</span>
          </div>
        </header>

        {/* System Metrics */}
        <section className="space-y-6">
          <div className="flex items-center gap-2 text-neutral-400">
            <Activity size={20} />
            <h2 className="text-lg font-semibold tracking-wide uppercase">System Load</h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            <MetricCard 
              title="Active Calls" 
              value={system_metrics?.active_calls || 0} 
              icon={PhoneCall} 
              colorClass="text-blue-400"
            />
            <MetricCard 
              title="Total Calls (Today)" 
              value={system_metrics?.total_calls_today || 0} 
              icon={Activity} 
              colorClass="text-purple-400"
            />
            <MetricCard 
              title="Failed Calls" 
              value={system_metrics?.failed_calls_today || 0} 
              icon={PhoneMissed} 
              colorClass="text-red-400"
            />
            <MetricCard 
              title="Success Rate" 
              value={`${system_metrics?.success_rate || 0}%`} 
              icon={CheckCircle2} 
              colorClass="text-emerald-400"
            />
          </div>
        </section>

        {/* LLM & Tasks Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          
          {/* LLM Metrics */}
          <section className="space-y-6">
            <div className="flex items-center gap-2 text-neutral-400">
              <Cpu size={20} />
              <h2 className="text-lg font-semibold tracking-wide uppercase">Intelligence Core</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <MetricCard 
                title="Model In Use" 
                value={llm_metrics?.model_in_use || 'Unknown'} 
                subValue={`Provider: ${llm_metrics?.current_provider || 'N/A'}`}
                icon={Zap} 
                colorClass="text-yellow-400"
              />
              <MetricCard 
                title="Avg Latency" 
                value={`${llm_metrics?.average_latency_ms || 0} ms`} 
                icon={Clock} 
                colorClass="text-orange-400"
              />
            </div>
          </section>

          {/* Task Dispatch Metrics */}
          <section className="space-y-6">
            <div className="flex items-center gap-2 text-neutral-400">
              <Send size={20} />
              <h2 className="text-lg font-semibold tracking-wide uppercase">Task Dispatcher</h2>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              <MetricCard 
                title="Successful Tasks" 
                value={task_dispatch_metrics?.successful_dispatches || 0} 
                subValue={`Out of ${task_dispatch_metrics?.total_tasks_today || 0} today`}
                icon={CheckSquare} 
                colorClass="text-emerald-400"
              />
              <MetricCard 
                title="Pending Tasks" 
                value={task_dispatch_metrics?.pending_dispatches || 0} 
                icon={ListTodo} 
                colorClass="text-blue-400"
              />
            </div>
          </section>
        </div>

        {/* Tenant Breakdown */}
        <section className="space-y-6">
          <TenantTable tenants={tenant_breakdown || []} />
        </section>

      </div>
    </div>
  );
}
