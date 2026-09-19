import { useState } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts';
import type { PriceHistoryRow } from '../lib/api';
import { formatPrice, stockLabel } from '../lib/utils';

interface Props {
  history: PriceHistoryRow[];
}

interface ChartPoint {
  date: string;
  price: number;
  stock: string;
  stockNum: number; // 1=in_stock, 0.5=low_stock, 0=out_of_stock
  fullDate: string;
}

const STOCK_COLOR: Record<string, string> = {
  in_stock: '#10b981',
  low_stock: '#f59e0b',
  out_of_stock: '#ef4444',
  unknown: '#6b7280',
};

// Custom tooltip
function CustomTooltip({ active, payload }: { active?: boolean; payload?: { payload: ChartPoint }[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="glass-card p-3 text-xs shadow-xl">
      <p className="text-gray-400 mb-1">{d.fullDate}</p>
      <p className="text-white font-semibold text-sm">{formatPrice(d.price)}</p>
      <p style={{ color: STOCK_COLOR[d.stock] ?? '#6b7280' }} className="mt-0.5">
        ● {stockLabel(d.stock)}
      </p>
    </div>
  );
}

export function PriceChart({ history }: Props) {
  const [showTable, setShowTable] = useState(false);

  if (!history.length) {
    return (
      <div className="glass-card p-8 text-center text-gray-500 text-sm">
        No price history yet — run a scrape to see data.
      </div>
    );
  }

  const data: ChartPoint[] = [...history]
    .sort((a, b) => new Date(a.scraped_at).getTime() - new Date(b.scraped_at).getTime())
    .map(h => ({
      date: new Date(h.scraped_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      fullDate: new Date(h.scraped_at).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true,
      }),
      price: h.price,
      stock: h.stock,
      stockNum: h.stock === 'in_stock' ? 1 : h.stock === 'low_stock' ? 0.5 : 0,
    }));

  const prices = data.map(d => d.price);
  const minP = Math.min(...prices);
  const maxP = Math.max(...prices);

  return (
    <div className="glass-card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-gray-200">Price History</h3>
        <button
          onClick={() => setShowTable(t => !t)}
          className="btn-ghost text-xs"
        >
          {showTable ? '📈 Chart' : '📋 Table'}
        </button>
      </div>

      {!showTable ? (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={data} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis
              tickFormatter={v => `₹${(v/1000).toFixed(0)}k`}
              domain={[minP * 0.97, maxP * 1.03]}
              tick={{ fontSize: 11 }}
            />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={minP} stroke="#10b981" strokeDasharray="4 4" label={{ value: 'min', position: 'right', fontSize: 10, fill: '#10b981' }} />
            <ReferenceLine y={maxP} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'max', position: 'right', fontSize: 10, fill: '#ef4444' }} />
            <Line
              type="monotone"
              dataKey="price"
              stroke="#5c6af7"
              strokeWidth={2.5}
              dot={(props) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: ChartPoint };
                return <circle key={`dot-${cx}-${cy}`} cx={cx} cy={cy} r={4} fill={STOCK_COLOR[payload.stock] ?? '#6b7280'} stroke="#1f2937" strokeWidth={2} />;
              }}
              activeDot={{ r: 6, fill: '#5c6af7' }}
              name="Price (₹)"
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="overflow-x-auto rounded-xl">
          <table className="w-full text-xs text-left">
            <thead className="border-b border-gray-800">
              <tr>
                {['Date', 'Price', 'Stock'].map(h => (
                  <th key={h} className="px-3 py-2 text-gray-500 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800/50">
              {[...history].reverse().map(row => (
                <tr key={row.id} className="hover:bg-gray-800/30 transition-colors">
                  <td className="px-3 py-2 text-gray-400 tabular-nums">
                    {new Date(row.scraped_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </td>
                  <td className="px-3 py-2 font-semibold text-white">{formatPrice(row.price)}</td>
                  <td className="px-3 py-2">
                    <span style={{ color: STOCK_COLOR[row.stock] ?? '#6b7280' }}>● </span>
                    {stockLabel(row.stock)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Stock legend */}
      <div className="flex items-center gap-4 flex-wrap pt-1">
        {Object.entries(STOCK_COLOR).map(([k, c]) => (
          <span key={k} className="flex items-center gap-1.5 text-xs text-gray-500">
            <span className="w-2 h-2 rounded-full inline-block" style={{ background: c }} />
            {stockLabel(k)}
          </span>
        ))}
        <span className="ml-auto text-xs text-gray-700">{data.length} data points</span>
      </div>
    </div>
  );
}
