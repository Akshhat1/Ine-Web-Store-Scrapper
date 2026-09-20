# 🛒 INE Web Store Price & Stock Tracker

A full-stack automated price monitoring system built to track product prices and stock availability on the **INE Demo Store** (`demo.inelabteamdev.com`). 

The application overcomes complex client-side anti-scraping protections—including mouse telemetry tracking, WASM proof-of-work challenges, zero-width font/digit obfuscation, dynamic CSS class rotation, and rate limits—while maintaining time-series history and logs.

---

## 🌟 Key Features

- **Automated Anti-Bot Playwright Scraper**:
  - Simulates natural human mouse movement telemetry (`minMoves=8`, `minDwellMs=600ms`) and triggers the SPA's interactive price reveal workflow.
  - Normalizes zero-width space/joiner obfuscated numbers into standard integers.
  - Dynamically queries `/api/layout` to adapt to rotating CSS class names without breaking.
  - Fast-fails and backs off cleanly on HTTP `429` rate limit responses.
- **Robust Scrape Engine & Logging**:
  - Sequential batch scraper with configurable exponential backoff and jitter.
  - Strict logging semantics recording every attempt status (`SUCCESS`, `RETRIED`, `FAILED`), latency, and error types.
  - Time-series price and stock history recorded in Supabase PostgreSQL (`price_history`).
- **Modern React Dashboard**:
  - Interactive search to discover and track products from the store catalog.
  - Product detail views featuring time-series price trend charts powered by **Recharts**.
  - Real-time stock status badges (`in_stock`, `low_stock`, `out_of_stock`).
  - **"⚡ Run Scraper Now"** header button to trigger manual batch scrape runs on demand.
  - Scrape attempt log history table per product.
- **Production Architecture**:
  - Backend: Node.js + Express + TypeScript + Playwright + Supabase JS Client.
  - Frontend: React + Vite + TypeScript + Tailwind CSS + Lucide Icons.
  - Deployment-ready with Render (`render.yaml`) and Vercel configuration.

---

## 🏗 System Architecture

```
                       ┌─────────────────────────┐
                       │   INE Demo Store SPA    │
                       │ (demo.inelabteamdev.com)│
                       └────────────▲────────────┘
                                    │
                               Playwright
                            (Hover Telemetry)
                                    │
┌─────────────────────────┐  HTTP / API   ┌─────────────────────────┐
│     React Frontend      ├──────────────►│   Express API Backend   │
│   (Vite + Tailwind CSS) │               │   (Node.js + TypeScript)│
└─────────────────────────┘               └────────────┬────────────┘
                                                       │
                                                    Supabase
                                                  (PostgreSQL)
                                                       │
                                          ┌────────────┴────────────┐
                                          │  • tracked_products     │
                                          │  • price_history        │
                                          │  • scrape_logs          │
                                          │  • scrape_runs          │
                                          │  • alerts               │
                                          └─────────────────────────┘
```

---

## 🚀 Quick Start (Local Setup)

### Prerequisites
- **Node.js**: v18 or later
- **npm**: v9 or later
- **Supabase Project**: Account and database instance

### 1. Repository Setup

```bash
git clone https://github.com/Akshhat1/Ine-Web-Store-Scrapper.git
cd Ine-Web-Store-Scrapper
```

### 2. Backend Setup

```bash
cd backend
npm install

# Playwright Chromium Installation
npx playwright install chromium
```

Create a `.env` file inside `backend/`:

```env
PORT=3001
STORE_BASE_URL=https://demo.inelabteamdev.com
SUPABASE_URL=https://<YOUR-SUPABASE-REF>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<YOUR-SUPABASE-SERVICE-ROLE-KEY>
ENABLE_BROWSER=true
MAX_RETRIES=3
PRICE_JUMP_THRESHOLD=0.5
CRON_SECRET=supersecret_cron_key
```

Run the backend in development mode:

```bash
npm run dev
```

### 3. Frontend Setup

In a new terminal window:

```bash
cd frontend
npm install
```

Create a `.env` file inside `frontend/`:

```env
VITE_API_URL=http://localhost:3001
```

Run the frontend dev server:

```bash
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 📊 Database Schema (Supabase)

The database schema is defined in `supabase/schema.sql` and consists of five core tables:

- `tracked_products`: Stores product metadata (`store_product_id`, `name`, `last_price`, `last_stock`, `last_scraped_at`).
- `price_history`: Time-series ledger written **only** on successful or retried scrapes.
- `scrape_logs`: Audit trail recording every scrape attempt with latency, status (`SUCCESS`, `RETRIED`, `FAILED`), and error reasons.
- `scrape_runs`: Tracks batch execution metadata (`trigger`, `products_total`, `products_ok`, `products_failed`).
- `alerts`: Price drops and stock state change notification events.

---

## 🌐 API Reference

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/products` | `GET` | List all tracked products with latest price & stock |
| `/api/products` | `POST` | Track a new product by `store_product_id` |
| `/api/products/:id` | `GET` | Get single product detail + summary statistics |
| `/api/products/:id/history` | `GET` | Time-series price and stock history for a product |
| `/api/products/:id/logs` | `GET` | Detailed scrape attempt logs for a product |
| `/api/cron/scrape-all` | `POST` | Trigger an immediate batch scrape run for all products |
| `/api/store/search?q=` | `GET` | Search product catalog on the store |

---

## 🛠 Tech Stack

- **Frontend**: React, Vite, TypeScript, Tailwind CSS, Recharts, Lucide React
- **Backend**: Node.js, Express, TypeScript, Playwright, Zod, Vitest
- **Database**: Supabase (PostgreSQL)
- **Deployment**: Render (Backend & Cron), Vercel (Frontend)

---

## 📜 License

Distributed under the MIT License. See `LICENSE` for more details.
