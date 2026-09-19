# 🚀 Deployment Guide: Product Price Tracker

This guide covers step-by-step instructions to push your repository to **GitHub**, set up **Supabase**, deploy the backend to **Render**, and deploy the frontend to **Vercel**.

---

## 1️⃣ Push Code to GitHub

Your local git repository has already been initialized and committed on the `main` branch.

Run the following commands in your terminal to link and push to your GitHub account:

```bash
# 1. Create a new repository on GitHub: https://github.com/new
# Name it: ine-product-price-tracker (leave it empty without README)

# 2. Add remote URL (replace <YOUR_USERNAME> with your GitHub username)
git remote add origin https://github.com/<YOUR_USERNAME>/ine-product-price-tracker.git

# 3. Push to GitHub
git push -u origin main
```

---

## 2️⃣ Supabase Database Setup

1. Open your Supabase Dashboard: [https://txequsffxnfriypejtav.supabase.co](https://txequsffxnfriypejtav.supabase.co)
2. Navigate to **SQL Editor** from the sidebar.
3. Copy all SQL statements from `supabase/schema.sql` in this project.
4. Paste into the SQL editor and click **Run**.
5. Verify tables are created: `tracked_products`, `price_history`, `scrape_logs`, `alerts`.

---

## 3️⃣ Deploy Backend to Render

1. Go to [Render Dashboard](https://dashboard.render.com/).
2. Click **New +** → Select **Blueprint**.
3. Connect your GitHub account and select your `ine-product-price-tracker` repository.
4. Render automatically detects the `render.yaml` configuration in the project root.
5. Set Environment Variables in Render:
   - `SUPABASE_URL`: `https://txequsffxnfriypejtav.supabase.co`
   - `SUPABASE_SERVICE_KEY`: `<YOUR_SUPABASE_SERVICE_ROLE_KEY>`
   - `CRON_SECRET`: `supersecret_cron_key_1234`
   - `FRONTEND_ORIGIN`: `https://<YOUR-APP>.vercel.app`
6. Click **Apply**. Your backend will build and start at `https://<YOUR-RENDER-APP>.onrender.com`.

---

## 4️⃣ Deploy Frontend to Vercel

1. Go to [Vercel Dashboard](https://vercel.com/new).
2. Click **Import Repository** and select `ine-product-price-tracker`.
3. Configure the deployment settings:
   - **Framework Preset**: `Vite`
   - **Root Directory**: `frontend`
4. Expand **Environment Variables**:
   - `VITE_API_URL`: `https://<YOUR-RENDER-APP>.onrender.com` *(replace with your Render backend URL)*
5. Click **Deploy**.

---

## ✅ Deployment Verification Checklist

- [ ] GitHub repository created and code pushed.
- [ ] Supabase schema initialized in SQL editor.
- [ ] Render backend passing health check at `https://<YOUR-RENDER-APP>.onrender.com/api/health`.
- [ ] Vercel frontend loading live product search and displaying price charts.
