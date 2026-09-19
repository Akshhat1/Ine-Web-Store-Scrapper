import { BrowserRouter, Routes, Route, Link, useLocation } from 'react-router-dom';
import { Dashboard } from './pages/Dashboard';
import { ProductDetail } from './pages/ProductDetail';
import { AlertBanner } from './components/AlertBanner';

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
          <div className="flex items-center gap-5">
            <NavLink to="/">Dashboard</NavLink>
          </div>
        </div>
      </nav>

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
