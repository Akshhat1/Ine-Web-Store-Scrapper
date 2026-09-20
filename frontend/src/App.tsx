import { useState } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { ProductDetail } from './pages/ProductDetail';
import { AlertBanner } from './components/AlertBanner';
import { api } from './lib/api';

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const { pathname } = useLocation();
  const active = pathname === to;
  return (
    <Link to={to}
      className={`text-sm font-medium transition-colors duration-200 ${active ? 'text-brand-400' : 'text-gray-500 hover:text-gray-300'}`}>
      {children}
    </Link>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const [scraping, setScraping] = useState(false);
  const [message, setMessage] = useState('');

  const handleTriggerScrape = async () => {
    setScraping(true);
    setMessage('');
    try {
      const res = await api.triggerScrapeAll();
      setMessage(res.message || 'Scrape run started in background!');
      setTimeout(() => setMessage(''), 4000);
    } catch (err: unknown) {
      setMessage(err instanceof Error ? err.message : 'Failed to trigger scrape');
      setTimeout(() => setMessage(''), 4000);
    } finally {
      setScraping(false);
    }
  };

  return (
    <div className="min-h-screen">
      {/* Top navigation */}
      <nav className="sticky top-0 z-40 border-b border-gray-800/50 bg-gray-950/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-6">
          <Link to="/" className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-brand-500 to-purple-600 flex items-center justify-center text-white text-xs font-bold shadow-lg">
              ₹
            </div>
            <span className="font-bold text-gray-100 text-sm hidden sm:block">INE Price Tracker</span>
          </Link>
          <div className="flex items-center gap-4">
            <NavLink to="/">Dashboard</NavLink>
            <button
              onClick={handleTriggerScrape}
              disabled={scraping}
              className="btn-primary text-xs py-1.5 px-3 flex items-center gap-1.5 shadow-md hover:scale-105 transition-transform"
            >
              {scraping ? (
                <>
                  <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  <span>Starting...</span>
                </>
              ) : (
                <>
                  <span>⚡</span>
                  <span>Run Scraper Now</span>
                </>
              )}
            </button>
          </div>
        </div>
      </nav>

      {message && (
        <div className="bg-brand-500/20 border-b border-brand-500/30 text-brand-300 text-xs py-2 text-center font-medium animate-fade-in">
          {message}
        </div>
      )}

      {/* Main content */}
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        {children}
      </main>

      {/* Alert banner */}
      <AlertBanner />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/product/:id" element={<ProductDetail />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
