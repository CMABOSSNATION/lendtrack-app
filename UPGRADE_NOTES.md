# LendTrack v2 — Upgrade Notes

## ✅ New Features Added

### 1. 📊 Credit Score System (300–850)
- **Automatic calculation** based on real loan + payment data
- **Scoring factors:**
  - Payment timing (on-time vs late) — 35% weight
  - Loan completion history — 30% weight
  - Current overdue loans — penalty deduction
  - Total repayment volume — loyalty bonus
  - Account age — history bonus
  - Zero penalty record — bonus
- **Grades:** A+ (750+), A (700+), B (650+), C (580+), D (500+), F (<500)
- **New "Credit Scores" tab** — full leaderboard with score bar, factors, stats
- **Score shown on Borrower cards** and Loans table column
- **Dashboard widget** — Top 3 credit scorers

### 2. 🔐 Offline Login / Sign In
- After first successful online login, credentials are **cached securely** in IndexedDB using SHA-256 hashing
- Users can **sign in without internet** using cached credentials
- Offline indicator shown on login screen: `📵 Offline mode`
- Registration still requires internet (invite key validation)

### 3. 📵 Full Offline Operation
- All data (borrowers, loans, payments) cached in IndexedDB on every sync
- **Offline indicator** in sidebar: green `● Online` / amber `○ Offline`
- **Pending sync badge** shows count of queued actions
- All CRUD actions (add/edit/delete borrowers, loans, payments) **queued offline**
- **Auto-syncs** when connection is restored
- Manual **"↑ Sync N pending"** button in sidebar

### 4. 📄 Offline Report Generator (Free, No Dependencies)
- **"📄 Save Report" button** in sidebar — works 100% offline
- Generates a self-contained **HTML file** saved to device
- Report includes:
  - Executive summary (totals, overdue count, collected)
  - All loans table with credit scores
  - Credit score summary for all borrowers
  - Payment history (last 50 payments)
  - Company name, date, agent name printed in header
- Opens in any browser, **printable as PDF** via browser print
- **Zero cost** — no server, no storage, no API

### 5. 🖼️ Aggressive Photo Compression
- Photos compressed **client-side** using Canvas API before storage
- Target: **≤ 50KB per photo** at max 800px wide
- Quality auto-adjusted until target size is met
- **Size shown after upload:** `✓ 42KB compressed`
- Saves Supabase storage — each borrower uses ~100KB instead of 2–5MB
- Works for both passport photo and ID card photo

---

## 📁 Files Changed

### Frontend (`lendtrack-app-main/src/`)
- **`App.jsx`** — Complete rewrite with all new features
- **`offlineStore.js`** — Added: offline auth cache, credit score engine, DB v2 schema

### Backend (`lendtrack-backend-main/`)
- **`supabase_schema_v2.sql`** — Added `credit_score_history` table (optional)

---

## 🚀 Deployment

No changes needed to the backend API for the core new features.
Credit scores are **computed entirely in the browser** from existing data.
Offline functionality uses **IndexedDB** — no backend changes required.

### Optional: Log credit scores server-side
Add a `POST /api/credit-scores` endpoint if you want to persist scores in Supabase.
The frontend already computes them — just POST the result after each sync.

---

## 📱 PWA / Mobile (Capacitor)
The app already has Capacitor configured. The offline features work natively:
- IndexedDB available in Capacitor WebView
- `navigator.onLine` works correctly
- Service Worker (`public/sw.js`) handles asset caching
