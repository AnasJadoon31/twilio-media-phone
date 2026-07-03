import React from 'react';
import { Users } from 'lucide-react';

interface Tenant {
  tenant_slug: string;
  calls_today: number;
}

interface TenantTableProps {
  tenants: Tenant[];
}

export function TenantTable({ tenants }: TenantTableProps) {
  return (
    <div className="rounded-xl bg-neutral-900/50 border border-white/10 backdrop-blur-md overflow-hidden">
      <div className="p-6 border-b border-white/10 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-neutral-800 text-purple-400">
          <Users size={20} />
        </div>
        <h3 className="text-xl font-semibold text-white">Tenant Breakdown</h3>
      </div>
      <div className="p-0">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-neutral-900/80 text-neutral-400 text-sm uppercase tracking-wider">
              <th className="p-4 font-medium border-b border-white/5">Tenant Slug</th>
              <th className="p-4 font-medium border-b border-white/5 text-right">Calls Today</th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((tenant, index) => (
              <tr 
                key={tenant.tenant_slug} 
                className="transition-colors hover:bg-white/5 group border-b border-white/5 last:border-b-0"
              >
                <td className="p-4 font-medium text-white group-hover:text-purple-300 transition-colors">
                  {tenant.tenant_slug}
                </td>
                <td className="p-4 text-right text-neutral-300">
                  <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-full bg-neutral-800 border border-neutral-700 text-sm font-semibold">
                    {tenant.calls_today}
                  </span>
                </td>
              </tr>
            ))}
            {tenants.length === 0 && (
              <tr>
                <td colSpan={2} className="p-8 text-center text-neutral-500">
                  No tenant data available
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
