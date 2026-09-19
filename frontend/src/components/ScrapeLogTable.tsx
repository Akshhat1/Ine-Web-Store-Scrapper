import type { ScrapeLogRow } from '../lib/api';
import { statusBadgeClass } from '../lib/utils';

interface Props { logs: ScrapeLogRow[] }

export function ScrapeLogTable({ logs }: Props) {
  if (!logs.length) {
    return <div className="glass-card p-6 text-center text-gray-500 text-sm">No scrape logs yet.</div>;
  }

  return (
    <div className="glass-card overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-800/50">
        <h3 className="font-semibold text-gray-200">Scrape Log</h3>
        <p className="text-xs text-gray-600 mt-0.5">Every attempt, with honest failure details</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs text-left">
          <thead className="border-b border-gray-800/50 bg-gray-900/30">
            <tr>
              {['Timestamp', 'Attempt', 'Status', 'Latency', 'HTTP', 'Error Type', 'Message'].map(h => (
                <th key={h} className="px-3 py-3 text-gray-500 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/30">
            {logs.map(log => (
              <tr key={log.id} className={`transition-colors hover:bg-gray-800/20 ${log.status === 'FAILED' ? 'bg-red-500/3' : ''}`}>
                <td className="px-3 py-2.5 text-gray-400 tabular-nums whitespace-nowrap">
                  {new Date(log.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                </td>
                <td className="px-3 py-2.5 text-gray-500 tabular-nums text-center">
                  #{log.attempt}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  <span className={statusBadgeClass(log.status)}>
                    {log.status === 'SUCCESS' && '✓ '}
                    {log.status === 'RETRIED' && '↻ '}
                    {log.status === 'FAILED' && '✗ '}
                    {log.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 tabular-nums text-gray-400 whitespace-nowrap">
                  {log.latency_ms !== null ? `${log.latency_ms.toLocaleString()}ms` : '—'}
                </td>
                <td className="px-3 py-2.5 tabular-nums text-gray-500">
                  {log.http_status ?? '—'}
                </td>
                <td className="px-3 py-2.5 whitespace-nowrap">
                  {log.error_type ? (
                    <span className="font-mono text-amber-400/80">{log.error_type}</span>
                  ) : '—'}
                </td>
                <td className="px-3 py-2.5 text-gray-600 max-w-xs">
                  {log.error_message ? (
                    <span className="truncate block" title={log.error_message}>
                      {log.error_message.length > 80 ? log.error_message.slice(0, 80) + '…' : log.error_message}
                    </span>
                  ) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
