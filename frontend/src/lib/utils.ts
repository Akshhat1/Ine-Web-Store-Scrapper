// frontend/src/lib/utils.ts
// Shared formatting utilities.

export function formatPrice(price: number | null | undefined): string {
  if (price === null || price === undefined) return '—';
  return new Intl.NumberFormat('en-IN', {
    style: 'currency', currency: 'INR', maximumFractionDigits: 0,
  }).format(price);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }).format(new Date(iso));
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export function priceChange(current: number | null, prev: number | null): number | null {
  if (current === null || prev === null || prev === 0) return null;
  return ((current - prev) / prev) * 100;
}

export function stockLabel(stock: string | null): string {
  switch (stock) {
    case 'in_stock': return 'In Stock';
    case 'out_of_stock': return 'Out of Stock';
    case 'low_stock': return 'Low Stock';
    default: return 'Unknown';
  }
}

export function stockBadgeClass(stock: string | null): string {
  switch (stock) {
    case 'in_stock': return 'stock-in';
    case 'out_of_stock': return 'stock-out';
    case 'low_stock': return 'stock-low';
    default: return 'stock-unknown';
  }
}

export function statusBadgeClass(status: string): string {
  switch (status) {
    case 'SUCCESS': return 'badge-success';
    case 'RETRIED': return 'badge-warning';
    case 'FAILED': return 'badge-error';
    default: return 'badge-neutral';
  }
}

export function nextScrapeTime(lastScrapedAt: string | null): string {
  if (!lastScrapedAt) return 'Not yet scraped';
  const next = new Date(lastScrapedAt).getTime() + 2 * 60 * 60 * 1000;
  const diffMs = next - Date.now();
  if (diffMs <= 0) return 'Due now';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `in ${mins}m`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return `in ${hrs}h ${rem > 0 ? rem + 'm' : ''}`.trim();
}
