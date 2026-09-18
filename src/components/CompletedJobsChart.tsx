/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Cell
} from 'recharts';
import { BarChart3, TrendingUp, DollarSign } from 'lucide-react';

interface Job {
  id: string;
  file: File | { name: string };
  status: string;
  finalTotal?: number;
  workflowState?: string;
  images?: string[];
}

interface CompletedJobsChartProps {
  jobs: Job[];
}

const BAR_COLORS = ['#06b6d4', '#3b82f6', '#10b981', '#8b5cf6', '#f59e0b', '#ec4899', '#14b8a6'];

interface CustomTooltipProps {
  active?: boolean;
  payload?: any[];
}

const CustomChartTooltip: React.FC<CustomTooltipProps> = ({ active, payload }) => {
  if (active && payload && payload.length) {
    const data = payload[0].payload;
    return (
      <div className="bg-slate-900/95 border border-slate-700/90 rounded-lg p-2.5 shadow-2xl backdrop-blur-sm text-xs font-mono">
        <p className="font-semibold text-slate-200 mb-1 max-w-[200px] truncate">{data.fullName}</p>
        <div className="flex items-center gap-1.5 text-cyan-400 font-bold">
          <span className="text-slate-400 font-normal">Final Total:</span>
          <span>{data.formattedTotal}</span>
        </div>
      </div>
    );
  }
  return null;
};

export const CompletedJobsChart: React.FC<CompletedJobsChartProps> = ({ jobs }) => {
  const completedJobs = jobs.filter(
    (j) => j.status === 'done' && typeof j.finalTotal === 'number' && j.finalTotal > 0
  );

  const chartData = completedJobs.map((job, idx) => {
    const rawName = job.file.name.replace(/\.[^/.]+$/, '');
    const displayName = rawName.length > 10 ? `${rawName.substring(0, 8)}..` : rawName;
    const total = job.finalTotal || 0;

    return {
      id: job.id,
      fullName: job.file.name,
      displayName,
      finalTotal: total,
      formattedTotal: `$${total.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`,
      color: BAR_COLORS[idx % BAR_COLORS.length],
    };
  });

  const totalValue = completedJobs.reduce((acc, curr) => acc + (curr.finalTotal || 0), 0);
  const avgValue = completedJobs.length > 0 ? totalValue / completedJobs.length : 0;

  return (
    <div id="workflow-final-total-chart-block" className="p-5 bg-slate-900/40 border-b border-slate-800 shrink-0">
      <div className="flex items-center justify-between mb-2.5">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-widest">
            Completed Bids: Final Total Comparison
          </h4>
        </div>
        {completedJobs.length > 0 && (
          <span className="text-[10px] font-mono text-cyan-400 bg-cyan-950/60 border border-cyan-800/40 px-2 py-0.5 rounded">
            {completedJobs.length} {completedJobs.length === 1 ? 'Job' : 'Jobs'}
          </span>
        )}
      </div>

      {completedJobs.length > 0 ? (
        <div className="flex flex-col gap-3">
          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 gap-2 bg-slate-950/70 border border-slate-800/80 rounded-lg p-2 text-xs">
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 flex items-center gap-1 font-sans">
                <DollarSign className="w-2.5 h-2.5 text-emerald-400 shrink-0" /> Total Bid Volume
              </span>
              <span className="font-mono font-bold text-emerald-400 text-xs">
                ${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] text-slate-400 flex items-center gap-1 font-sans">
                <TrendingUp className="w-2.5 h-2.5 text-cyan-400 shrink-0" /> Average / Plan
              </span>
              <span className="font-mono font-bold text-cyan-300 text-xs">
                ${avgValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>

          {/* Bar Chart */}
          <div className="w-full h-44 bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 8, right: 10, left: -18, bottom: 2 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" vertical={false} />
                <XAxis
                  dataKey="displayName"
                  stroke="#475569"
                  tick={{ fill: '#94a3b8', fontSize: 10 }}
                  tickLine={false}
                  axisLine={{ stroke: '#334155' }}
                />
                <YAxis
                  stroke="#475569"
                  tick={{ fill: '#64748b', fontSize: 9 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => `$${val >= 1000 ? `${Math.round(val / 1000)}k` : val}`}
                />
                <Tooltip content={<CustomChartTooltip />} cursor={{ fill: 'rgba(51, 65, 85, 0.25)' }} />
                <Bar dataKey="finalTotal" radius={[4, 4, 0, 0]}>
                  {chartData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      ) : (
        /* Empty State */
        <div className="p-4 bg-slate-950/60 border border-slate-800/80 border-dashed rounded-xl flex flex-col items-center justify-center text-center gap-1.5">
          <BarChart3 className="w-5 h-5 text-slate-600 mb-0.5" />
          <p className="text-xs font-medium text-slate-400">No completed jobs in session</p>
          <p className="text-[10px] text-slate-600 max-w-[240px]">
            Final totals will be compared here as jobs finish and bids are finalized.
          </p>
        </div>
      )}
    </div>
  );
};
