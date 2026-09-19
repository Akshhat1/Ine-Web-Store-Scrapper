import { useState, useEffect } from 'react';
import { api, type Alert } from '../lib/api';

export function AlertBanner() {
  const [alerts, setAlerts] = useState<Alert[]>([]);

  useEffect(() => {
    api.getAlerts().then(r => setAlerts(r.alerts as Alert[])).catch(() => {});
    const iv = setInterval(() => {
      api.getAlerts().then(r => setAlerts(r.alerts as Alert[])).catch(() => {});
    }, 30000);
    return () => clearInterval(iv);
  }, []);

  if (!alerts.length) return null;

  const dismiss = async () => {
    const ids = alerts.map(a => a.id);
    setAlerts([]);
    await api.markAlertsSeen(ids).catch(() => {});
  };

  return (
    <div className="fixed bottom-6 right-6 z-50 space-y-2 max-w-sm animate-slide-up">
      {alerts.slice(0, 5).map(alert => (
        <div key={alert.id} className={`glass-card p-4 border-l-4 shadow-xl ${
          alert.type === 'price_drop' ? 'border-emerald-500' :
          alert.type === 'back_in_stock' ? 'border-brand-500' :
          'border-amber-500'
        }`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold text-gray-300">
                {alert.type === 'price_drop' && '🔻 Price Drop'}
                {alert.type === 'back_in_stock' && '✅ Back in Stock'}
                {alert.type === 'structure_changed' && '⚠️ Structure Changed'}
              </p>
              {alert.tracked_products && (
                <p className="text-xs text-gray-500 mt-0.5">{alert.tracked_products.name}</p>
              )}
              {alert.old_value && alert.new_value && (
                <p className="text-xs text-gray-400 mt-1">
                  {alert.old_value} → {alert.new_value}
                </p>
              )}
            </div>
            <button onClick={dismiss} className="text-gray-600 hover:text-gray-400 text-lg leading-none">×</button>
          </div>
        </div>
      ))}
      {alerts.length > 1 && (
        <button onClick={dismiss} className="w-full text-xs text-gray-500 hover:text-gray-300 py-1">
          Dismiss all ({alerts.length})
        </button>
      )}
    </div>
  );
}
