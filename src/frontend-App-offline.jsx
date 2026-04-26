import { useState, useEffect, useCallback, useRef } from "react";
import {
  cacheData,
  getOfflineData,
  enqueue,
  getQueue,
  removeFromQueue,
  localAddBorrower,
  localUpdateBorrower,
  localDeleteBorrower,
  localAddLoan,
  localUpdateLoan,
  localDeleteLoan,
  localAddPayment,
} from "./offlineStore";

// ─── Config ───────────────────────────────────────────────────────────────────
const API = import.meta.env.VITE_API_URL || "http://localhost:4000/api";

// ─── Utility helpers ──────────────────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n || 0);
const today = () => new Date().toISOString().split("T")[0];
const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};
const statusColor = (s) =>
  ({ Active: "#22c55e", Paid: "#3b82f6", Overdue: "#ef4444", Pending: "#f59e0b" }[s] || "#888");

// ─── API client ───────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem("lt_token"); }

async function apiFetch(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

// ─── Register service worker ──────────────────────────────────────────────────
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "" });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setError("");
    if (!form.email || !form.password) return setError("Email and password required");
    if (mode === "register" && !form.name) return setError("Name required");
    setLoading(true);
    try {
      const data = await apiFetch(`/auth/${mode}`, { method: "POST", body: form });
      localStorage.setItem("lt_token", data.token);
      localStorage.setItem("lt_user", JSON.stringify(data.user));
      onAuth(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.authWrap}>
      <style>{css}</style>
      <div style={styles.authCard}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>₱</span>
          <div>
            <div style={styles.logoTitle}>LendTrack</div>
            <div style={styles.logoSub}>Money Lender Pro</div>
          </div>
        </div>
        <h2 style={{ color: "#fff", margin: "0 0 20px", fontSize: 18 }}>
          {mode === "login" ? "Sign In" : "Create Account"}
        </h2>
        {error && <div style={styles.errorBox}>{error}</div>}
        {mode === "register" && (
          <div style={styles.field}>
            <label style={styles.label}>Full Name</label>
            <input style={styles.input} value={form.name} onChange={set("name")} placeholder="Your name" />
          </div>
        )}
        <div style={styles.field}>
          <label style={styles.label}>Email</label>
          <input style={styles.input} type="email" value={form.email} onChange={set("email")} placeholder="you@email.com" />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Password</label>
          <input style={styles.input} type="password" value={form.password} onChange={set("password")} placeholder="••••••••" />
        </div>
        <button style={{ ...styles.primaryBtn, width: "100%", marginTop: 8 }} onClick={submit} disabled={loading}>
          {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
        </button>
        <p style={{ color: "#64748b", fontSize: 13, textAlign: "center", marginTop: 16 }}>
          {mode === "login" ? "No account? " : "Have an account? "}
          <span style={{ color: "#a5b4fc", cursor: "pointer" }}
            onClick={() => { setMode(mode === "login" ? "register" : "login"); setError(""); }}>
            {mode === "login" ? "Register" : "Sign In"}
          </span>
        </p>
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lt_user")); } catch { return null; }
  });

  const [tab, setTab] = useState("dashboard");
  const [borrowers, setBorrowers] = useState([]);
  const [loans, setLoans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [dashStats, setDashStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const syncInProgress = useRef(false);

  // ── Online/offline detection ────────────────────────────────────────────────
  useEffect(() => {
    const on = () => { setIsOnline(true); };
    const off = () => setIsOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);

  // ── Service worker message (SW_SYNC trigger) ────────────────────────────────
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event) => {
      if (event.data?.type === "SW_SYNC") syncQueue();
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  // ── Auto-sync when coming back online ──────────────────────────────────────
  useEffect(() => {
    if (isOnline && user) {
      syncQueue().then(() => loadFromAPI());
    }
  }, [isOnline]);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Load data: API when online, IDB when offline ───────────────────────────
  const loadFromAPI = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [b, l, p, d] = await Promise.all([
        apiFetch("/borrowers"),
        apiFetch("/loans"),
        apiFetch("/payments"),
        apiFetch("/dashboard"),
      ]);
      setBorrowers(b);
      setLoans(l);
      setPayments(p);
      setDashStats(d);
      // Cache to IndexedDB for offline use
      await cacheData({ borrowers: b, loans: l, payments: p });
    } catch (err) {
      if (err.message.includes("Invalid") || err.message.includes("token")) {
        handleLogout();
      } else {
        // Fall back to IDB
        await loadFromCache();
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  const loadFromCache = async () => {
    const { borrowers: b, loans: l, payments: p } = await getOfflineData();
    setBorrowers(b);
    setLoans(l);
    setPayments(p);
    const q = await getQueue();
    setPendingCount(q.length);
  };

  useEffect(() => {
    if (!user) return;
    if (isOnline) {
      loadFromAPI();
    } else {
      loadFromCache();
    }
  }, [user, loadFromAPI]);

  // ── Sync queue: replay offline mutations ───────────────────────────────────
  const syncQueue = async () => {
    if (syncInProgress.current || !getToken()) return;
    const queue = await getQueue();
    if (queue.length === 0) return;

    syncInProgress.current = true;
    setSyncing(true);
    let failed = 0;

    for (const op of queue) {
      try {
        await apiFetch(op.path, { method: op.method, body: op.body });
        await removeFromQueue(op.qid);
      } catch {
        failed++;
      }
    }

    setPendingCount(failed);
    syncInProgress.current = false;
    setSyncing(false);

    if (failed === 0) showToast("All offline changes synced ✓");
    else showToast(`${failed} item(s) failed to sync`, "error");
  };

  const handleLogout = () => {
    localStorage.removeItem("lt_token");
    localStorage.removeItem("lt_user");
    setUser(null);
  };

  const loanBalance = (loan) => {
    const interest = loan.principal * (loan.interest_rate ?? loan.interestRate) / 100;
    const total = loan.principal + interest;
    const paid = payments.filter((p) => p.loan_id === loan.id).reduce((s, p) => s + p.amount, 0);
    return Math.max(0, total - paid);
  };

  const overdueCount = loans.filter((l) => l.status === "Overdue").length;

  // ── Handlers: online → API, offline → IDB + queue ─────────────────────────

  const saveBorrower = async (data) => {
    try {
      if (isOnline) {
        if (data.id && !data.id.startsWith("tmp_")) {
          await apiFetch(`/borrowers/${data.id}`, { method: "PUT", body: data });
        } else {
          await apiFetch("/borrowers", { method: "POST", body: data });
        }
        showToast(data.id ? "Borrower updated!" : "Borrower added!");
        await loadFromAPI();
      } else {
        if (data.id && !data.id.startsWith("tmp_")) {
          const updated = await localUpdateBorrower(data.id, data);
          setBorrowers((prev) => prev.map((b) => b.id === data.id ? updated : b));
          await enqueue({ method: "PUT", path: `/borrowers/${data.id}`, body: data });
        } else {
          const item = await localAddBorrower(data);
          setBorrowers((prev) => [item, ...prev]);
          await enqueue({ method: "POST", path: "/borrowers", body: data, tempId: item.id });
        }
        setPendingCount((c) => c + 1);
        showToast("Saved offline — will sync when online");
      }
      setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const deleteBorrower = async (id) => {
    if (!confirm("Delete borrower and all their loans?")) return;
    try {
      if (isOnline && !id.startsWith("tmp_")) {
        await apiFetch(`/borrowers/${id}`, { method: "DELETE" });
        await loadFromAPI();
      } else {
        await localDeleteBorrower(id);
        setBorrowers((prev) => prev.filter((b) => b.id !== id));
        setLoans((prev) => prev.filter((l) => l.borrower_id !== id));
        if (!id.startsWith("tmp_")) await enqueue({ method: "DELETE", path: `/borrowers/${id}` });
        else setPendingCount((c) => Math.max(0, c - 1));
      }
      showToast("Borrower deleted", "error");
    } catch (err) { showToast(err.message, "error"); }
  };

  const saveLoan = async (data) => {
    const body = {
      borrower_id: data.borrowerId || data.borrower_id,
      principal: parseFloat(data.principal),
      interest_rate: parseFloat(data.interestRate || data.interest_rate),
      term_days: parseInt(data.termDays || data.term_days),
      start_date: data.startDate || data.start_date || today(),
      notes: data.notes || "",
    };
    try {
      if (isOnline) {
        if (data.id && !data.id.startsWith("tmp_")) {
          await apiFetch(`/loans/${data.id}`, { method: "PUT", body });
        } else {
          await apiFetch("/loans", { method: "POST", body });
        }
        showToast(data.id ? "Loan updated!" : `Loan of ${fmt(body.principal)} created!`);
        await loadFromAPI();
      } else {
        const loanData = {
          ...body,
          due_date: addDays(body.start_date, body.term_days),
          borrower_id: body.borrower_id,
        };
        if (data.id && !data.id.startsWith("tmp_")) {
          const updated = await localUpdateLoan(data.id, loanData);
          setLoans((prev) => prev.map((l) => l.id === data.id ? updated : l));
          await enqueue({ method: "PUT", path: `/loans/${data.id}`, body });
        } else {
          const item = await localAddLoan(loanData);
          setLoans((prev) => [item, ...prev]);
          await enqueue({ method: "POST", path: "/loans", body, tempId: item.id });
        }
        setPendingCount((c) => c + 1);
        showToast("Loan saved offline — will sync when online");
      }
      setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const markPaid = async (loan) => {
    try {
      if (isOnline) {
        await apiFetch(`/loans/${loan.id}/mark-paid`, { method: "POST" });
        showToast("Loan marked as fully paid!");
        await loadFromAPI();
      } else {
        await localUpdateLoan(loan.id, { status: "Paid" });
        setLoans((prev) => prev.map((l) => l.id === loan.id ? { ...l, status: "Paid" } : l));
        await enqueue({ method: "POST", path: `/loans/${loan.id}/mark-paid` });
        setPendingCount((c) => c + 1);
        showToast("Marked paid offline — will sync when online");
      }
    } catch (err) { showToast(err.message, "error"); }
  };

  const savePayment = async (data) => {
    const body = {
      loan_id: data.loanId || data.loan_id,
      amount: parseFloat(data.amount),
      date: data.date || today(),
      method: data.method || "Cash",
      note: data.note || "",
    };
    try {
      if (isOnline) {
        await apiFetch("/payments", { method: "POST", body });
        showToast(`Payment of ${fmt(body.amount)} recorded!`);
        await loadFromAPI();
      } else {
        const item = await localAddPayment({ ...body });
        setPayments((prev) => [item, ...prev]);
        // Auto-update loan status locally
        const loan = loans.find((l) => l.id === body.loan_id);
        if (loan) {
          const newBal = loanBalance(loan) - body.amount;
          if (newBal <= 0) {
            await localUpdateLoan(loan.id, { status: "Paid" });
            setLoans((prev) => prev.map((l) => l.id === loan.id ? { ...l, status: "Paid" } : l));
          }
        }
        await enqueue({ method: "POST", path: "/payments", body, tempId: item.id });
        setPendingCount((c) => c + 1);
        showToast("Payment saved offline — will sync when online");
      }
      setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const deleteLoan = async (id) => {
    if (!confirm("Delete this loan and all its payments?")) return;
    try {
      if (isOnline && !id.startsWith("tmp_")) {
        await apiFetch(`/loans/${id}`, { method: "DELETE" });
        await loadFromAPI();
      } else {
        await localDeleteLoan(id);
        setLoans((prev) => prev.filter((l) => l.id !== id));
        setPayments((prev) => prev.filter((p) => p.loan_id !== id));
        if (!id.startsWith("tmp_")) await enqueue({ method: "DELETE", path: `/loans/${id}` });
      }
      showToast("Loan deleted", "error");
    } catch (err) { showToast(err.message, "error"); }
  };

  const exportCSV = () => {
    const rows = [["Borrower", "Principal", "Interest Rate", "Term", "Due Date", "Status", "Balance"]];
    loans.forEach((l) => {
      const b = borrowers.find((x) => x.id === l.borrower_id);
      rows.push([b?.name, l.principal, (l.interest_rate || l.interestRate) + "%", l.term_days + "d", l.due_date, l.status, loanBalance(l)]);
    });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv," + encodeURIComponent(csv);
    a.download = "loans_export.csv";
    a.click();
    showToast("CSV exported!");
  };

  if (!user) return <AuthScreen onAuth={(u) => setUser(u)} />;

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: "⬡" },
    { id: "loans", label: "Loans", icon: "◈" },
    { id: "borrowers", label: "Borrowers", icon: "◉" },
    { id: "payments", label: "Payments", icon: "◎" },
  ];

  return (
    <div style={styles.root}>
      <style>{css}</style>

      {/* Offline / Sync banner */}
      {(!isOnline || pendingCount > 0 || syncing) && (
        <div style={{
          ...styles.banner,
          background: syncing ? "#6366f1" : !isOnline ? "#f59e0b" : "#22c55e",
        }}>
          {syncing
            ? "⟳ Syncing offline changes…"
            : !isOnline
            ? `📵 Offline mode — ${pendingCount > 0 ? `${pendingCount} change${pendingCount !== 1 ? "s" : ""} pending sync` : "changes saved locally"}`
            : `✓ Back online — ${pendingCount} change${pendingCount !== 1 ? "s" : ""} synced`}
          {!isOnline && pendingCount > 0 && (
            <span style={{ marginLeft: 8, fontSize: 11, opacity: 0.8 }}>Will sync automatically when connected</span>
          )}
        </div>
      )}

      {/* Body: sidebar + main side by side */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>

      {/* Sidebar */}
      <aside style={styles.sidebar}>
        <div style={styles.logo}>
          <span style={styles.logoIcon}>₱</span>
          <div>
            <div style={styles.logoTitle}>LendTrack</div>
            <div style={styles.logoSub}>Money Lender Pro</div>
          </div>
        </div>
        <nav style={styles.nav}>
          {nav.map((n) => (
            <button key={n.id}
              style={{ ...styles.navBtn, ...(tab === n.id ? styles.navActive : {}) }}
              onClick={() => setTab(n.id)}>
              <span style={styles.navIcon}>{n.icon}</span> {n.label}
              {n.id === "loans" && overdueCount > 0 && <span style={styles.badge}>{overdueCount}</span>}
            </button>
          ))}
        </nav>
        <div style={styles.sideFooter}>
          <div style={{ ...styles.onlineDot, background: isOnline ? "#22c55e" : "#f59e0b" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "currentColor", display: "inline-block" }} />
            {isOnline ? "Online" : "Offline"}
            {pendingCount > 0 && ` · ${pendingCount} pending`}
          </div>
          {isOnline && pendingCount > 0 && (
            <button style={{ ...styles.exportBtn, color: "#a5b4fc", borderColor: "#6366f144" }} onClick={syncQueue}>
              ⟳ Sync now
            </button>
          )}
          <button style={styles.exportBtn} onClick={exportCSV}>⬇ Export CSV</button>
          <button style={{ ...styles.exportBtn, color: "#ef444488", borderColor: "#ef444433" }} onClick={handleLogout}>Sign Out</button>
          <div style={styles.version}>v2.0 · {user.name}</div>
        </div>
      </aside>

      {/* Main */}
      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>
            {tab === "dashboard" ? "Dashboard Overview"
              : tab === "loans" ? "Loan Records"
              : tab === "borrowers" ? "Borrowers"
              : "Payment History"}
          </h1>
          <div style={styles.headerRight}>
            {loading && <span style={{ fontSize: 12, color: "#64748b" }}>Loading…</span>}
            <span style={styles.dateChip}>
              {new Date().toLocaleDateString("en-PH", { weekday: "short", year: "numeric", month: "long", day: "numeric" })}
            </span>
            {tab === "borrowers" && <button style={styles.primaryBtn} onClick={() => setModal({ type: "borrower", data: null })}>+ Add Borrower</button>}
            {tab === "loans" && <button style={styles.primaryBtn} onClick={() => setModal({ type: "loan", data: null })}>+ New Loan</button>}
            {tab === "payments" && <button style={styles.primaryBtn} onClick={() => setModal({ type: "payment", data: null })}>+ Record Payment</button>}
          </div>
        </header>

        <div style={styles.content}>
          {tab === "dashboard" && <Dashboard loans={loans} borrowers={borrowers} payments={payments} stats={dashStats} loanBalance={loanBalance} setTab={setTab} />}
          {tab === "loans" && <LoansTab loans={loans} borrowers={borrowers} payments={payments} loanBalance={loanBalance} onNew={() => setModal({ type: "loan", data: null })} onEdit={(l) => setModal({ type: "loan", data: l })} onDelete={deleteLoan} onPay={(l) => setModal({ type: "payment", data: { loanId: l.id } })} onMarkPaid={markPaid} />}
          {tab === "borrowers" && <BorrowersTab borrowers={borrowers} loans={loans} onEdit={(b) => setModal({ type: "borrower", data: b })} onDelete={deleteBorrower} onNewLoan={(b) => setModal({ type: "loan", data: { borrowerId: b.id } })} />}
          {tab === "payments" && <PaymentsTab payments={payments} loans={loans} borrowers={borrowers} />}
        </div>
      </main>

      </div> {/* end body flex */}

      {modal?.type === "borrower" && <BorrowerModal data={modal.data} onSave={saveBorrower} onClose={() => setModal(null)} />}
      {modal?.type === "loan" && <LoanModal data={modal.data} borrowers={borrowers} onSave={saveLoan} onClose={() => setModal(null)} />}
      {modal?.type === "payment" && <PaymentModal data={modal.data} loans={loans} borrowers={borrowers} loanBalance={loanBalance} onSave={savePayment} onClose={() => setModal(null)} />}

      {toast && <div style={{ ...styles.toast, background: toast.type === "error" ? "#ef4444" : "#22c55e" }}>{toast.msg}</div>}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ loans, borrowers, payments, stats, loanBalance, setTab }) {
  const s = stats || {};
  const overdueLoans = loans.filter((l) => l.status === "Overdue");
  const activeLoans = loans.filter((l) => l.status === "Active");
  const recentPayments = [...payments].sort((a, b) => b.date?.localeCompare(a.date)).slice(0, 5);
  const totalLoaned = s.totalLoaned ?? loans.filter((l) => l.status !== "Paid").reduce((acc, l) => acc + l.principal, 0);
  const totalInterest = s.totalInterest ?? loans.filter((l) => l.status !== "Paid").reduce((acc, l) => acc + l.principal * (l.interest_rate || 0) / 100, 0);
  const totalCollected = s.totalCollected ?? payments.reduce((acc, p) => acc + p.amount, 0);
  const overdueCount = s.overdueCount ?? overdueLoans.length;

  const cards = [
    { label: "Total Outstanding", value: fmt(totalLoaned + totalInterest), sub: `${loans.filter(l => l.status !== "Paid").length} active loans`, color: "#6366f1", icon: "◈" },
    { label: "Interest Receivable", value: fmt(totalInterest), sub: "Across all active loans", color: "#f59e0b", icon: "%" },
    { label: "Total Collected", value: fmt(totalCollected), sub: `${payments.length} payments received`, color: "#22c55e", icon: "✓" },
    { label: "Overdue Loans", value: overdueCount, sub: "Needs immediate attention", color: "#ef4444", icon: "!" },
  ];

  return (
    <div>
      <div style={styles.statsGrid}>
        {cards.map((c, i) => (
          <div key={i} style={{ ...styles.statCard, borderTop: `3px solid ${c.color}` }}>
            <div style={{ ...styles.statIcon, color: c.color }}>{c.icon}</div>
            <div style={styles.statValue}>{c.value}</div>
            <div style={styles.statLabel}>{c.label}</div>
            <div style={styles.statSub}>{c.sub}</div>
          </div>
        ))}
      </div>
      <div style={styles.dashGrid}>
        <div style={styles.dashCard}>
          <h3 style={styles.cardTitle}>⚠ Overdue Loans</h3>
          {overdueLoans.length === 0 ? <p style={styles.empty}>No overdue loans 🎉</p> : overdueLoans.map((l) => {
            const b = borrowers.find((x) => x.id === l.borrower_id);
            return (
              <div key={l.id} style={styles.listRow}>
                <div><div style={styles.rowName}>{b?.name}</div><div style={styles.rowSub}>Due: {l.due_date} · {Math.floor((new Date() - new Date(l.due_date)) / 86400000)}d overdue</div></div>
                <div style={{ ...styles.amount, color: "#ef4444" }}>{fmt(loanBalance(l))}</div>
              </div>
            );
          })}
        </div>
        <div style={styles.dashCard}>
          <h3 style={styles.cardTitle}>💸 Recent Payments</h3>
          {recentPayments.length === 0 ? <p style={styles.empty}>No payments yet</p> : recentPayments.map((p) => {
            const loan = loans.find((l) => l.id === p.loan_id);
            const b = borrowers.find((x) => x.id === loan?.borrower_id);
            return (
              <div key={p.id} style={styles.listRow}>
                <div><div style={styles.rowName}>{b?.name || "—"}</div><div style={styles.rowSub}>{p.date} · {p.method}</div></div>
                <div style={{ ...styles.amount, color: "#22c55e" }}>{fmt(p.amount)}</div>
              </div>
            );
          })}
        </div>
        <div style={styles.dashCard}>
          <h3 style={styles.cardTitle}>📋 Loans Due Soon</h3>
          {activeLoans.filter((l) => { const d = (new Date(l.due_date) - new Date()) / 86400000; return d >= 0 && d <= 7; }).length === 0
            ? <p style={styles.empty}>No loans due in 7 days</p>
            : activeLoans.filter((l) => { const d = (new Date(l.due_date) - new Date()) / 86400000; return d >= 0 && d <= 7; }).map((l) => {
              const b = borrowers.find((x) => x.id === l.borrower_id);
              const diff = Math.ceil((new Date(l.due_date) - new Date()) / 86400000);
              return (
                <div key={l.id} style={styles.listRow}>
                  <div><div style={styles.rowName}>{b?.name}</div><div style={styles.rowSub}>Due in {diff} day{diff !== 1 ? "s" : ""} · {l.due_date}</div></div>
                  <div style={{ ...styles.amount, color: "#f59e0b" }}>{fmt(loanBalance(l))}</div>
                </div>
              );
            })}
        </div>
        <div style={styles.dashCard}>
          <h3 style={styles.cardTitle}>👥 Borrower Summary</h3>
          {borrowers.slice(0, 5).map((b) => {
            const bLoans = loans.filter((l) => l.borrower_id === b.id && l.status !== "Paid");
            const total = bLoans.reduce((s, l) => s + loanBalance(l), 0);
            return (
              <div key={b.id} style={styles.listRow}>
                <div><div style={styles.rowName}>{b.name}</div><div style={styles.rowSub}>{bLoans.length} active loan{bLoans.length !== 1 ? "s" : ""}</div></div>
                <div style={styles.amount}>{fmt(total)}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Loans Tab ────────────────────────────────────────────────────────────────
function LoansTab({ loans, borrowers, payments, loanBalance, onNew, onEdit, onDelete, onPay, onMarkPaid }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const statuses = ["All", "Active", "Overdue", "Paid", "Pending"];
  const filtered = loans.filter((l) => {
    const b = borrowers.find((x) => x.id === l.borrower_id);
    return (filter === "All" || l.status === filter) && (!search || b?.name.toLowerCase().includes(search.toLowerCase()));
  });
  return (
    <div>
      <div style={styles.toolbar}>
        <input style={styles.searchInput} placeholder="🔍  Search borrower..." value={search} onChange={(e) => setSearch(e.target.value)} />
        <div style={styles.filterBtns}>
          {statuses.map((s) => <button key={s} style={{ ...styles.filterBtn, ...(filter === s ? styles.filterActive : {}) }} onClick={() => setFilter(s)}>{s}</button>)}
        </div>
      </div>
      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead><tr>{["Borrower", "Principal", "Interest", "Total Due", "Balance", "Start", "Due Date", "Status", "Actions"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td colSpan={9} style={styles.empty}>No loans found</td></tr> : filtered.map((l) => {
              const b = borrowers.find((x) => x.id === l.borrower_id);
              const rate = l.interest_rate ?? l.interestRate ?? 0;
              const interest = l.principal * rate / 100;
              const bal = loanBalance(l);
              const isOverdue = l.status === "Overdue";
              return (
                <tr key={l.id} style={{ background: isOverdue ? "rgba(239,68,68,0.04)" : "transparent" }}>
                  <td style={styles.td}><div style={styles.rowName}>{b?.name || "—"}</div><div style={styles.rowSub}>{b?.phone}</div></td>
                  <td style={styles.td}>{fmt(l.principal)}</td>
                  <td style={styles.td}><span style={styles.rateBadge}>{rate}%</span> {fmt(interest)}</td>
                  <td style={styles.td}>{fmt(l.principal + interest)}</td>
                  <td style={{ ...styles.td, fontWeight: 700, color: bal > 0 ? (isOverdue ? "#ef4444" : "#f59e0b") : "#22c55e" }}>{fmt(bal)}</td>
                  <td style={styles.td}>{l.start_date}</td>
                  <td style={{ ...styles.td, color: isOverdue ? "#ef4444" : "inherit" }}>{l.due_date}</td>
                  <td style={styles.td}><span style={{ ...styles.statusBadge, background: statusColor(l.status) + "22", color: statusColor(l.status), border: `1px solid ${statusColor(l.status)}44` }}>{l.status}</span></td>
                  <td style={styles.td}>
                    <div style={styles.actions}>
                      {l.status !== "Paid" && <button style={styles.actionBtn} onClick={() => onPay(l)} title="Record payment">💰</button>}
                      {l.status !== "Paid" && <button style={{ ...styles.actionBtn, color: "#22c55e" }} onClick={() => onMarkPaid(l)} title="Mark fully paid">✓</button>}
                      <button style={styles.actionBtn} onClick={() => onEdit(l)} title="Edit">✏️</button>
                      <button style={{ ...styles.actionBtn, color: "#ef4444" }} onClick={() => onDelete(l.id)} title="Delete">🗑</button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Borrowers Tab ────────────────────────────────────────────────────────────
function BorrowersTab({ borrowers, loans, onEdit, onDelete, onNewLoan }) {
  const [search, setSearch] = useState("");
  const filtered = borrowers.filter((b) => b.name.toLowerCase().includes(search.toLowerCase()) || b.phone?.includes(search));
  return (
    <div>
      <div style={styles.toolbar}>
        <input style={styles.searchInput} placeholder="🔍  Search borrower..." value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>
      <div style={styles.borrowerGrid}>
        {filtered.map((b) => {
          const bLoans = loans.filter((l) => l.borrower_id === b.id);
          const active = bLoans.filter((l) => l.status !== "Paid").length;
          const overdue = bLoans.filter((l) => l.status === "Overdue").length;
          return (
            <div key={b.id} style={styles.borrowerCard}>
              <div style={styles.avatar}>{b.name[0]}</div>
              <div style={styles.borrowerInfo}>
                <div style={styles.borrowerName}>{b.name}</div>
                <div style={styles.rowSub}>📞 {b.phone}</div>
                <div style={styles.rowSub}>📍 {b.address}</div>
                <div style={styles.rowSub}>🪪 {b.id_type}: {b.id_no}</div>
                <div style={styles.loanPills}>
                  <span style={{ ...styles.pill, background: "#6366f122", color: "#6366f1" }}>{bLoans.length} total loans</span>
                  {active > 0 && <span style={{ ...styles.pill, background: "#f59e0b22", color: "#f59e0b" }}>{active} active</span>}
                  {overdue > 0 && <span style={{ ...styles.pill, background: "#ef444422", color: "#ef4444" }}>{overdue} overdue</span>}
                </div>
              </div>
              <div style={styles.borrowerActions}>
                <button style={styles.primaryBtn} onClick={() => onNewLoan(b)}>+ Loan</button>
                <button style={styles.ghostBtn} onClick={() => onEdit(b)}>Edit</button>
                <button style={{ ...styles.ghostBtn, color: "#ef4444", borderColor: "#ef444444" }} onClick={() => onDelete(b.id)}>Delete</button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <p style={styles.empty}>No borrowers found</p>}
      </div>
    </div>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────
function PaymentsTab({ payments, loans, borrowers }) {
  const sorted = [...payments].sort((a, b) => b.date?.localeCompare(a.date));
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead><tr>{["Date", "Borrower", "Loan Amount", "Payment", "Method", "Note"].map((h) => <th key={h} style={styles.th}>{h}</th>)}</tr></thead>
        <tbody>
          {sorted.length === 0 ? <tr><td colSpan={6} style={styles.empty}>No payments yet</td></tr>
            : sorted.map((p) => {
              const loan = loans.find((l) => l.id === p.loan_id);
              const b = borrowers.find((x) => x.id === loan?.borrower_id);
              return (
                <tr key={p.id}>
                  <td style={styles.td}>{p.date}</td>
                  <td style={styles.td}><div style={styles.rowName}>{b?.name || "—"}</div></td>
                  <td style={styles.td}>{fmt(loan?.principal)}</td>
                  <td style={{ ...styles.td, fontWeight: 700, color: "#22c55e" }}>{fmt(p.amount)}</td>
                  <td style={styles.td}><span style={{ ...styles.pill, background: "#6366f122", color: "#6366f1" }}>{p.method}</span></td>
                  <td style={styles.td}>{p.note || "—"}</td>
                </tr>
              );
            })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Modals ───────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={styles.overlay} onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div style={styles.modal}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>{title}</h2>
          <button style={styles.closeBtn} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Field({ label, children }) { return <div style={styles.field}><label style={styles.label}>{label}</label>{children}</div>; }

function BorrowerModal({ data, onSave, onClose }) {
  const [form, setForm] = useState(data ? { ...data, id_type: data.id_type || "PhilSys", id_no: data.id_no || "" } : { name: "", phone: "", address: "", id_type: "PhilSys", id_no: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = () => { if (!form.name || !form.phone) return alert("Name and phone required"); onSave(form); };
  return (
    <Modal title={data ? "Edit Borrower" : "Add Borrower"} onClose={onClose}>
      <div style={styles.modalBody}>
        <Field label="Full Name *"><input style={styles.input} value={form.name} onChange={set("name")} placeholder="e.g. Maria Santos" /></Field>
        <Field label="Phone *"><input style={styles.input} value={form.phone} onChange={set("phone")} placeholder="09XXXXXXXXX" /></Field>
        <Field label="Address"><input style={styles.input} value={form.address || ""} onChange={set("address")} placeholder="City, Province" /></Field>
        <Field label="ID Type">
          <select style={styles.input} value={form.id_type} onChange={set("id_type")}>
            {["PhilSys", "Driver's License", "SSS", "GSIS", "Passport", "PRC", "Voter's ID", "Other"].map((t) => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="ID Number"><input style={styles.input} value={form.id_no || ""} onChange={set("id_no")} placeholder="ID number" /></Field>
      </div>
      <div style={styles.modalFooter}>
        <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={styles.primaryBtn} onClick={submit}>{data ? "Update" : "Add Borrower"}</button>
      </div>
    </Modal>
  );
}

function LoanModal({ data, borrowers, onSave, onClose }) {
  const init = data
    ? { borrowerId: data.borrower_id || data.borrowerId || "", principal: data.principal || "", interestRate: data.interest_rate ?? data.interestRate ?? 5, termDays: data.term_days ?? data.termDays ?? 30, startDate: data.start_date || data.startDate || today(), notes: data.notes || "", id: data.id }
    : { borrowerId: "", principal: "", interestRate: 5, termDays: 30, startDate: today(), notes: "" };
  const [form, setForm] = useState(init);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const interest = (form.principal * form.interestRate / 100) || 0;
  const submit = () => {
    if (!form.borrowerId || !form.principal) return alert("Borrower and principal required");
    onSave({ ...form, principal: parseFloat(form.principal), interestRate: parseFloat(form.interestRate), termDays: parseInt(form.termDays) });
  };
  return (
    <Modal title={data?.id ? "Edit Loan" : "Create New Loan"} onClose={onClose}>
      <div style={styles.modalBody}>
        <Field label="Borrower *">
          <select style={styles.input} value={form.borrowerId} onChange={set("borrowerId")}>
            <option value="">— Select Borrower —</option>
            {borrowers.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Principal (₱) *"><input style={styles.input} type="number" value={form.principal} onChange={set("principal")} placeholder="0.00" /></Field>
          <Field label="Interest Rate (%)"><input style={styles.input} type="number" value={form.interestRate} onChange={set("interestRate")} min="0" max="100" /></Field>
          <Field label="Term (Days)"><input style={styles.input} type="number" value={form.termDays} onChange={set("termDays")} min="1" /></Field>
          <Field label="Start Date"><input style={styles.input} type="date" value={form.startDate} onChange={set("startDate")} /></Field>
        </div>
        <Field label="Notes"><textarea style={{ ...styles.input, height: 64 }} value={form.notes} onChange={set("notes")} placeholder="Optional remarks..." /></Field>
        <div style={styles.loanSummary}>
          <div style={styles.sumRow}><span>Principal</span><strong>{fmt(form.principal)}</strong></div>
          <div style={styles.sumRow}><span>Interest ({form.interestRate}%)</span><strong>{fmt(interest)}</strong></div>
          <div style={{ ...styles.sumRow, borderTop: "1px solid #333", paddingTop: 8, marginTop: 4 }}><span>Total Due</span><strong style={{ color: "#6366f1", fontSize: 18 }}>{fmt(parseFloat(form.principal || 0) + interest)}</strong></div>
          <div style={styles.sumRow}><span>Due Date</span><strong>{addDays(form.startDate, parseInt(form.termDays) || 0)}</strong></div>
        </div>
      </div>
      <div style={styles.modalFooter}>
        <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={styles.primaryBtn} onClick={submit}>{data?.id ? "Update Loan" : "Create Loan"}</button>
      </div>
    </Modal>
  );
}

function PaymentModal({ data, loans, borrowers, loanBalance, onSave, onClose }) {
  const activeLoans = loans.filter((l) => l.status !== "Paid");
  const [form, setForm] = useState({ loanId: data?.loanId || "", amount: "", date: today(), method: "Cash", note: "" });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const selectedLoan = loans.find((l) => l.id === form.loanId);
  const bal = selectedLoan ? loanBalance(selectedLoan) : 0;
  const submit = () => {
    if (!form.loanId || !form.amount) return alert("Loan and amount required");
    if (parseFloat(form.amount) > bal) return alert(`Amount exceeds balance of ${fmt(bal)}`);
    onSave({ ...form, amount: parseFloat(form.amount) });
  };
  return (
    <Modal title="Record Payment" onClose={onClose}>
      <div style={styles.modalBody}>
        <Field label="Loan *">
          <select style={styles.input} value={form.loanId} onChange={set("loanId")}>
            <option value="">— Select Loan —</option>
            {activeLoans.map((l) => {
              const b = borrowers.find((x) => x.id === l.borrower_id);
              return <option key={l.id} value={l.id}>{b?.name} · {fmt(l.principal)} · bal: {fmt(loanBalance(l))}</option>;
            })}
          </select>
        </Field>
        {selectedLoan && (
          <div style={styles.balanceChip}>
            Balance: <strong style={{ color: "#f59e0b" }}>{fmt(bal)}</strong>
            <button style={{ ...styles.pill, cursor: "pointer", background: "#6366f122", color: "#6366f1", border: "none" }}
              onClick={() => setForm((f) => ({ ...f, amount: bal.toFixed(2) }))}>Pay Full</button>
          </div>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Amount (₱) *"><input style={styles.input} type="number" value={form.amount} onChange={set("amount")} placeholder="0.00" /></Field>
          <Field label="Date"><input style={styles.input} type="date" value={form.date} onChange={set("date")} /></Field>
        </div>
        <Field label="Method">
          <select style={styles.input} value={form.method} onChange={set("method")}>
            {["Cash", "GCash", "Bank Transfer", "Maya", "Check", "Other"].map((m) => <option key={m}>{m}</option>)}
          </select>
        </Field>
        <Field label="Note"><input style={styles.input} value={form.note} onChange={set("note")} placeholder="Optional note..." /></Field>
      </div>
      <div style={styles.modalFooter}>
        <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={styles.primaryBtn} onClick={submit}>Record Payment</button>
      </div>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = {
  root: { display: "flex", flexDirection: "column", height: "100vh", background: "#0d0e14", color: "#e2e8f0", fontFamily: "'IBM Plex Mono', 'Courier New', monospace", overflow: "hidden" },
  banner: { padding: "8px 20px", fontSize: 12, fontWeight: 600, color: "#fff", display: "flex", alignItems: "center", gap: 8, flexShrink: 0, zIndex: 100 },
  authWrap: { display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "#0d0e14", fontFamily: "'IBM Plex Mono', 'Courier New', monospace" },
  authCard: { background: "#111218", border: "1px solid #2d3148", borderRadius: 16, padding: 32, width: "100%", maxWidth: 400, display: "flex", flexDirection: "column", gap: 14 },
  errorBox: { background: "#ef444420", border: "1px solid #ef444444", borderRadius: 8, padding: "10px 14px", color: "#ef4444", fontSize: 13 },
  appBody: { display: "flex", flex: 1, overflow: "hidden" },
  sidebar: { width: 220, background: "#111218", borderRight: "1px solid #1e2030", display: "flex", flexDirection: "column", flexShrink: 0 },
  logo: { display: "flex", alignItems: "center", gap: 12, padding: "24px 20px", borderBottom: "1px solid #1e2030" },
  logoIcon: { width: 40, height: 40, background: "linear-gradient(135deg,#6366f1,#a855f7)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, fontWeight: 900, color: "#fff", flexShrink: 0 },
  logoTitle: { fontSize: 16, fontWeight: 700, color: "#fff", letterSpacing: 1 },
  logoSub: { fontSize: 10, color: "#64748b", letterSpacing: 0.5 },
  nav: { flex: 1, padding: "16px 12px", display: "flex", flexDirection: "column", gap: 4 },
  navBtn: { display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 8, border: "none", background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 500, textAlign: "left", position: "relative" },
  navActive: { background: "#6366f115", color: "#a5b4fc", borderLeft: "2px solid #6366f1" },
  navIcon: { fontSize: 16 },
  badge: { marginLeft: "auto", background: "#ef4444", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 99 },
  onlineDot: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, fontWeight: 600, padding: "6px 10px", borderRadius: 6, color: "#fff" },
  sideFooter: { padding: "16px 12px", borderTop: "1px solid #1e2030", display: "flex", flexDirection: "column", gap: 8 },
  exportBtn: { padding: "8px 12px", border: "1px solid #2d3148", borderRadius: 6, background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
  version: { fontSize: 10, color: "#4a5568", textAlign: "center" },
  main: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 28px", borderBottom: "1px solid #1e2030", background: "#111218", flexShrink: 0 },
  pageTitle: { margin: 0, fontSize: 20, fontWeight: 700, color: "#fff", letterSpacing: 0.5 },
  headerRight: { display: "flex", alignItems: "center", gap: 12 },
  dateChip: { fontSize: 11, color: "#64748b", background: "#1e2030", padding: "4px 10px", borderRadius: 99 },
  content: { flex: 1, overflow: "auto", padding: "24px 28px" },
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 16, marginBottom: 24 },
  statCard: { background: "#111218", borderRadius: 12, padding: "20px", border: "1px solid #1e2030" },
  statIcon: { fontSize: 24, marginBottom: 8 },
  statValue: { fontSize: 24, fontWeight: 800, color: "#fff", marginBottom: 4 },
  statLabel: { fontSize: 12, color: "#94a3b8", fontWeight: 600, marginBottom: 2 },
  statSub: { fontSize: 11, color: "#4a5568" },
  dashGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  dashCard: { background: "#111218", borderRadius: 12, padding: 20, border: "1px solid #1e2030" },
  cardTitle: { margin: "0 0 16px", fontSize: 13, fontWeight: 700, color: "#94a3b8", letterSpacing: 1, textTransform: "uppercase" },
  listRow: { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid #1e2030" },
  rowName: { fontSize: 13, fontWeight: 600, color: "#e2e8f0" },
  rowSub: { fontSize: 11, color: "#64748b", marginTop: 2 },
  amount: { fontSize: 14, fontWeight: 700, color: "#e2e8f0" },
  toolbar: { display: "flex", gap: 12, marginBottom: 16, alignItems: "center" },
  searchInput: { flex: 1, maxWidth: 280, padding: "8px 14px", background: "#111218", border: "1px solid #2d3148", borderRadius: 8, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none" },
  filterBtns: { display: "flex", gap: 6 },
  filterBtn: { padding: "6px 14px", border: "1px solid #2d3148", borderRadius: 99, background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
  filterActive: { background: "#6366f1", color: "#fff", borderColor: "#6366f1" },
  tableWrap: { overflowX: "auto", background: "#111218", borderRadius: 12, border: "1px solid #1e2030" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "12px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", borderBottom: "1px solid #1e2030", whiteSpace: "nowrap" },
  td: { padding: "12px 14px", borderBottom: "1px solid #0d0e14", verticalAlign: "middle" },
  statusBadge: { padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600 },
  rateBadge: { background: "#6366f122", color: "#a5b4fc", borderRadius: 4, padding: "1px 5px", fontSize: 11 },
  actions: { display: "flex", gap: 4 },
  actionBtn: { background: "transparent", border: "1px solid #2d3148", borderRadius: 6, padding: "4px 8px", cursor: "pointer", fontSize: 14, color: "#94a3b8" },
  borrowerGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(340px,1fr))", gap: 16 },
  borrowerCard: { background: "#111218", borderRadius: 12, padding: 20, border: "1px solid #1e2030", display: "flex", gap: 14, alignItems: "flex-start" },
  avatar: { width: 44, height: 44, borderRadius: 99, background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff", flexShrink: 0 },
  borrowerInfo: { flex: 1 },
  borrowerName: { fontSize: 15, fontWeight: 700, color: "#fff", marginBottom: 4 },
  loanPills: { display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 },
  pill: { padding: "2px 8px", borderRadius: 99, fontSize: 11, fontWeight: 600 },
  borrowerActions: { display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 },
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.7)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(4px)" },
  modal: { background: "#111218", border: "1px solid #2d3148", borderRadius: 16, width: "100%", maxWidth: 520, maxHeight: "90vh", display: "flex", flexDirection: "column", overflow: "hidden" },
  modalHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid #1e2030" },
  modalTitle: { margin: 0, fontSize: 17, fontWeight: 700, color: "#fff" },
  closeBtn: { background: "transparent", border: "none", color: "#64748b", fontSize: 18, cursor: "pointer", padding: 4 },
  modalBody: { padding: "20px 24px", overflow: "auto", display: "flex", flexDirection: "column", gap: 14 },
  modalFooter: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 24px", borderTop: "1px solid #1e2030" },
  field: { display: "flex", flexDirection: "column", gap: 6 },
  label: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 },
  input: { padding: "9px 12px", background: "#0d0e14", border: "1px solid #2d3148", borderRadius: 8, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box", resize: "vertical" },
  loanSummary: { background: "#0d0e14", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, border: "1px solid #1e2030" },
  sumRow: { display: "flex", justifyContent: "space-between", fontSize: 13, color: "#94a3b8" },
  balanceChip: { background: "#0d0e14", borderRadius: 8, padding: "10px 14px", fontSize: 13, color: "#94a3b8", display: "flex", alignItems: "center", gap: 8 },
  primaryBtn: { padding: "9px 18px", background: "linear-gradient(135deg,#6366f1,#a855f7)", border: "none", borderRadius: 8, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap" },
  ghostBtn: { padding: "9px 18px", background: "transparent", border: "1px solid #2d3148", borderRadius: 8, color: "#94a3b8", cursor: "pointer", fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap" },
  empty: { color: "#4a5568", textAlign: "center", padding: 24, fontSize: 13 },
  toast: { position: "fixed", bottom: 28, right: 28, padding: "12px 20px", borderRadius: 10, color: "#fff", fontWeight: 600, fontSize: 13, boxShadow: "0 8px 32px rgba(0,0,0,0.4)", zIndex: 9999, animation: "slideUp 0.3s ease", fontFamily: "'IBM Plex Mono', monospace" },
};

const css = `
  * { box-sizing: border-box; }
  body { margin: 0; }
  .app-body { display: flex; flex: 1; overflow: hidden; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  select option { background: #111218; color: #e2e8f0; }
  input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2d3148; border-radius: 99px; }
  button:hover { opacity: 0.85; }
  tr:hover { background: rgba(99,102,241,0.04) !important; }
  .root-inner { display: flex; flex: 1; overflow: hidden; }
`;
