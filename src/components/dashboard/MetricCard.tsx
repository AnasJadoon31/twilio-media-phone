import React from 'react';
import { LucideIcon } from 'lucide-react';

interface MetricCardProps {
  title: string;
  value: string | number;
  icon: LucideIcon;
  subValue?: string;
  trend?: 'up' | 'down' | 'neutral';
  colorClass?: string;
}

export function MetricCard({ title, value, icon: Icon, subValue, trend, colorClass = "text-emerald-400" }: MetricCardProps) {
  return (
    <div className="relative overflow-hidden rounded-xl bg-neutral-900/50 p-6 border border-white/10 backdrop-blur-md transition-all duration-300 hover:border-white/20 hover:shadow-[0_0_20px_rgba(255,255,255,0.05)] group">
      <div className="absolute top-0 right-0 p-4 opacity-10 transition-opacity group-hover:opacity-20">
        <Icon size={80} className={colorClass} />
      </div>
      <div className="relative z-10 flex flex-col h-full justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg bg-neutral-800 ${colorClass}`}>
            <Icon size={20} />
          </div>
          <span className="text-neutral-400 font-medium tracking-wide text-sm uppercase">{title}</span>
        </div>
        <div>
          <h3 className="text-4xl font-bold text-white tracking-tight">{value}</h3>
          {subValue && (
            <p className="text-neutral-500 mt-2 text-sm font-medium">
              {subValue}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
