import { useState, useEffect, useCallback, useRef } from "react";

// ─── Config ────────────────────────────────────────────────────────────────────
const API = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_API_URL) || "http://localhost:4000/api";

// ─── Utility ───────────────────────────────────────────────────────────────────
const fmt = (n) =>
  "UGX " + new Intl.NumberFormat("en-UG", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);

const today = () => new Date().toISOString().split("T")[0];
const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};
const statusColor = (s) =>
  ({ Active: "#22d3a0", Paid: "#6366f1", Overdue: "#f43f5e", Pending: "#f59e0b" }[s] || "#888");

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

// ─── Auth Screen ───────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({
    name: "", email: "", password: "",
    company_name: "", branch: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    setError("");
    if (!form.email || !form.password) return setError("Email and password required");
    if (mode === "register") {
      if (!form.name) return setError("Worker name is required");
      if (!form.company_name) return setError("Company / branch name is required");
    }
    setLoading(true);
    try {
      const body = mode === "register"
        ? { name: form.name, email: form.email, password: form.password, company_name: form.company_name, branch: form.branch }
        : { email: form.email, password: form.password };
      const data = await apiFetch(`/auth/${mode}`, { method: "POST", body });
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
    <div style={S.authWrap}>
      <style>{globalCss}</style>
      <div style={S.authBg} />
      <div style={S.authCard}>
        <div style={S.authLogo}>
          <div style={S.logoCircle}>
            <span style={{ fontSize: 22, fontWeight: 900 }}>UG</span>
          </div>
          <div>
            <div style={S.authTitle}>LendTrack</div>
            <div style={S.authSub}>Uganda Money Lender Pro</div>
          </div>
        </div>

        <div style={S.tabRow}>
          {["login", "register"].map(m => (
            <button key={m} style={{ ...S.tabBtn, ...(mode === m ? S.tabActive : {}) }}
              onClick={() => { setMode(m); setError(""); }}>
              {m === "login" ? "Sign In" : "Register"}
            </button>
          ))}
        </div>

        {error && <div style={S.errorBox}>⚠ {error}</div>}

        {mode === "register" && (
          <>
            <div style={S.fieldRow}>
              <AuthField label="Company / Branch Name *">
                <input style={S.inp} value={form.company_name} onChange={set("company_name")} placeholder="e.g. Kampala Finance Ltd" />
              </AuthField>
              <AuthField label="Branch (optional)">
                <input style={S.inp} value={form.branch} onChange={set("branch")} placeholder="e.g. Nakasero Branch" />
              </AuthField>
            </div>
            <AuthField label="Your Full Name (Worker) *">
              <input style={S.inp} value={form.name} onChange={set("name")} placeholder="e.g. Aisha Nakato" />
            </AuthField>
          </>
        )}
        <AuthField label="Email Address">
          <input style={S.inp} type="email" value={form.email} onChange={set("email")} placeholder="you@company.com" />
        </AuthField>
        <AuthField label="Password">
          <input style={S.inp} type="password" value={form.password} onChange={set("password")} placeholder="••••••••"
            onKeyDown={e => e.key === "Enter" && submit()} />
        </AuthField>
        <button style={S.primaryBtn} onClick={submit} disabled={loading}>
          {loading ? "Please wait…" : mode === "login" ? "Sign In →" : "Create Account →"}
        </button>
      </div>
    </div>
  );
}
function AuthField({ label, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <label style={S.lbl}>{label}</label>{children}
  </div>;
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem("lt_user")); } catch { return null; }
  });
  const [tab, setTab] = useState("dashboard");
  const [sideOpen, setSideOpen] = useState(true); // desktop default open
  const [borrowers, setBorrowers] = useState([]);
  const [loans, setLoans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [dashStats, setDashStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);

  useEffect(() => {
    const fn = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      if (mobile) setSideOpen(false);
      else setSideOpen(true);
    };
    window.addEventListener("resize", fn);
    fn();
    return () => window.removeEventListener("resize", fn);
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const [b, l, p, d] = await Promise.all([
        apiFetch("/borrowers"), apiFetch("/loans"),
        apiFetch("/payments"), apiFetch("/dashboard"),
      ]);
      setBorrowers(b); setLoans(l); setPayments(p); setDashStats(d);
    } catch (err) {
      if (err.message.includes("Invalid") || err.message.includes("token")) handleLogout();
    } finally { setLoading(false); }
  }, [user]);

  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  const handleLogout = () => {
    localStorage.removeItem("lt_token");
    localStorage.removeItem("lt_user");
    setUser(null);
  };

  const loanBalance = (loan) => {
    const interest = loan.principal * (loan.interest_rate ?? loan.interestRate ?? 0) / 100;
    const total = loan.principal + interest;
    const paid = payments.filter(p => p.loan_id === loan.id).reduce((s, p) => s + p.amount, 0);
    return Math.max(0, total - paid);
  };

  // ── Handlers ────────────────────────────────────────────────────────────────
  const saveBorrower = async (data) => {
    try {
      if (data.id) await apiFetch(`/borrowers/${data.id}`, { method: "PUT", body: data });
      else await apiFetch("/borrowers", { method: "POST", body: data });
      showToast(data.id ? "Borrower updated!" : "Borrower added!");
      await loadData(); setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const deleteBorrower = async (id) => {
    if (!confirm("Delete this borrower and all their records?")) return;
    try {
      await apiFetch(`/borrowers/${id}`, { method: "DELETE" });
      showToast("Borrower deleted", "error"); await loadData();
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
      if (data.id) await apiFetch(`/loans/${data.id}`, { method: "PUT", body });
      else await apiFetch("/loans", { method: "POST", body });
      showToast(data.id ? "Loan updated!" : `Loan of ${fmt(body.principal)} created!`);
      await loadData(); setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const savePayment = async (data) => {
    // data includes loan_id, borrower_id (for display), amount, date, method, note
    const body = {
      loan_id: data.loanId || data.loan_id,
      amount: parseFloat(data.amount),
      date: data.date || today(),
      method: data.method || "Cash",
      note: data.note || "",
    };
    try {
      await apiFetch("/payments", { method: "POST", body });
      showToast(`Payment of ${fmt(body.amount)} recorded for ${data.borrowerName || "borrower"}!`);
      await loadData(); setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const deleteLoan = async (id) => {
    if (!confirm("Delete this loan and all payments?")) return;
    try {
      await apiFetch(`/loans/${id}`, { method: "DELETE" });
      showToast("Loan deleted", "error"); await loadData();
    } catch (err) { showToast(err.message, "error"); }
  };

  const markPaid = async (loan) => {
    try {
      await apiFetch(`/loans/${loan.id}/mark-paid`, { method: "POST" });
      showToast("Loan marked as fully paid!"); await loadData();
    } catch (err) { showToast(err.message, "error"); }
  };

  const exportCSV = () => {
    const rows = [["Borrower", "ID No", "Principal (UGX)", "Interest Rate", "Total Due (UGX)", "Balance (UGX)", "Start Date", "Due Date", "Status"]];
    loans.forEach(l => {
      const b = borrowers.find(x => x.id === l.borrower_id);
      const interest = l.principal * (l.interest_rate || 0) / 100;
      rows.push([b?.name, b?.id_no, l.principal, (l.interest_rate || 0) + "%",
        l.principal + interest, loanBalance(l), l.start_date, l.due_date, l.status]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a");
    a.href = "data:text/csv," + encodeURIComponent(csv);
    a.download = "lendtrack_export.csv"; a.click();
    showToast("CSV exported!");
  };

  if (!user) return <AuthScreen onAuth={u => setUser(u)} />;

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "◈" },
    { id: "loans", label: "Loans", icon: "₿" },
    { id: "borrowers", label: "Borrowers", icon: "◉" },
    { id: "payments", label: "Payments", icon: "◎" },
  ];
  const overdueCount = loans.filter(l => l.status === "Overdue").length;
  const companyName = user.company_name || user.name || "LendTrack";

  const navTo = (id) => {
    setTab(id);
    if (isMobile) setSideOpen(false);
  };

  return (
    <div style={S.root}>
      <style>{globalCss}</style>

      {/* Mobile overlay */}
      {isMobile && sideOpen && (
        <div style={S.mobileOverlay} onClick={() => setSideOpen(false)} />
      )}

      {/* Sidebar */}
      <aside style={{
        ...S.sidebar,
        ...(isMobile ? S.sidebarMobile : {}),
        ...(isMobile && !sideOpen ? S.sidebarHidden : {}),
        ...(isMobile && sideOpen ? S.sidebarShown : {}),
      }}>
        <div style={S.sideTop}>
          <div style={S.sideLogoWrap}>
            <div style={S.logoCircle}><span style={{ fontSize: 16, fontWeight: 900 }}>UG</span></div>
            <div>
              <div style={S.logoTitle}>{companyName}</div>
              <div style={S.logoSub}>Money Lender Pro</div>
            </div>
            {isMobile && (
              <button style={S.closeSideBtn} onClick={() => setSideOpen(false)}>✕</button>
            )}
          </div>

          <nav style={S.nav}>
            {navItems.map(n => (
              <button key={n.id}
                style={{ ...S.navBtn, ...(tab === n.id ? S.navActive : {}) }}
                onClick={() => navTo(n.id)}>
                <span style={S.navIcon}>{n.icon}</span>
                <span>{n.label}</span>
                {n.id === "loans" && overdueCount > 0 && (
                  <span style={S.badge}>{overdueCount}</span>
                )}
                {tab === n.id && <span style={S.navIndicator} />}
              </button>
            ))}
          </nav>
        </div>

        <div style={S.sideFooter}>
          <div style={S.workerBadge}>
            <div style={S.workerAvatar}>{(user.name || "U")[0].toUpperCase()}</div>
            <div>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#e2e8f0" }}>{user.name}</div>
              <div style={{ fontSize: 10, color: "#64748b" }}>{user.email}</div>
            </div>
          </div>
          <button style={S.sideBtn} onClick={exportCSV}>⬇ Export CSV</button>
          <button style={{ ...S.sideBtn, color: "#f43f5e88", borderColor: "#f43f5e33" }} onClick={handleLogout}>⏻ Sign Out</button>
        </div>
      </aside>

      {/* Main area */}
      <div style={{ ...S.mainArea, ...(sideOpen && !isMobile ? { marginLeft: 0 } : {}) }}>
        {/* Header */}
        <header style={S.header}>
          <div style={S.headerLeft}>
            <button style={S.menuBtn} onClick={() => setSideOpen(o => !o)}>
              {sideOpen && !isMobile ? "◀" : "☰"}
            </button>
            <h1 style={S.pageTitle}>
              {tab === "dashboard" ? "Dashboard" : tab === "loans" ? "Loans" : tab === "borrowers" ? "Borrowers" : "Payment History"}
            </h1>
          </div>
          <div style={S.headerRight}>
            {loading && <span style={{ fontSize: 11, color: "#64748b", fontStyle: "italic" }}>Loading…</span>}
            <span style={S.dateBadge}>
              {new Date().toLocaleDateString("en-UG", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}
            </span>
            {tab === "borrowers" && <button style={S.primaryBtn} onClick={() => setModal({ type: "borrower", data: null })}>+ Add Borrower</button>}
            {tab === "loans" && <button style={S.primaryBtn} onClick={() => setModal({ type: "loan", data: null })}>+ New Loan</button>}
            {tab === "payments" && <button style={S.primaryBtn} onClick={() => setModal({ type: "payment", data: null })}>+ Record Payment</button>}
          </div>
        </header>

        {/* Content */}
        <main style={S.content}>
          {tab === "dashboard" && <Dashboard loans={loans} borrowers={borrowers} payments={payments} stats={dashStats} loanBalance={loanBalance} setTab={setTab} setModal={setModal} />}
          {tab === "loans" && <LoansTab loans={loans} borrowers={borrowers} payments={payments} loanBalance={loanBalance} onEdit={l => setModal({ type: "loan", data: l })} onDelete={deleteLoan} onPay={l => setModal({ type: "payment", data: { loanId: l.id, borrowerName: borrowers.find(b => b.id === l.borrower_id)?.name } })} onMarkPaid={markPaid} />}
          {tab === "borrowers" && <BorrowersTab borrowers={borrowers} loans={loans} payments={payments} loanBalance={loanBalance} onEdit={b => setModal({ type: "borrower", data: b })} onDelete={deleteBorrower} onNewLoan={b => setModal({ type: "loan", data: { borrowerId: b.id } })} onPay={(b, l) => setModal({ type: "payment", data: { loanId: l.id, borrowerName: b.name } })} />}
          {tab === "payments" && <PaymentsTab payments={payments} loans={loans} borrowers={borrowers} />}
        </main>
      </div>

      {/* Modals */}
      {modal?.type === "borrower" && <BorrowerModal data={modal.data} onSave={saveBorrower} onClose={() => setModal(null)} />}
      {modal?.type === "loan" && <LoanModal data={modal.data} borrowers={borrowers} onSave={saveLoan} onClose={() => setModal(null)} />}
      {modal?.type === "payment" && <PaymentModal data={modal.data} loans={loans} borrowers={borrowers} loanBalance={loanBalance} onSave={savePayment} onClose={() => setModal(null)} />}

      {toast && (
        <div style={{ ...S.toast, background: toast.type === "error" ? "#f43f5e" : "#22d3a0" }}>
          {toast.type === "error" ? "✕ " : "✓ "}{toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ loans, borrowers, payments, stats, loanBalance, setTab, setModal }) {
  const s = stats || {};
  const overdueLoans = loans.filter(l => l.status === "Overdue");
  const activeLoans = loans.filter(l => l.status === "Active");
  const recentPayments = [...payments].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 6);

  const totalOutstanding = loans.filter(l => l.status !== "Paid").reduce((acc, l) => acc + loanBalance(l), 0);
  const totalInterest = loans.filter(l => l.status !== "Paid").reduce((acc, l) => acc + l.principal * (l.interest_rate || 0) / 100, 0);
  const totalCollected = payments.reduce((acc, p) => acc + p.amount, 0);
  const activeBorrowers = new Set(loans.filter(l => l.status !== "Paid").map(l => l.borrower_id)).size;

  const cards = [
    { label: "My Loan Balance", value: fmt(totalOutstanding), sub: `Active Balance: ${fmt(totalOutstanding - totalInterest)}`, color: "#6366f1", grad: "linear-gradient(135deg,#6366f1,#8b5cf6)", icon: "◈" },
    { label: "Total Amount Disbursed", value: fmt(s.totalLoaned ?? loans.reduce((a, l) => a + l.principal, 0)), sub: `${loans.length} total loans`, color: "#22d3a0", grad: "linear-gradient(135deg,#22d3a0,#06b6d4)", icon: "₿" },
    { label: "Active Borrowers", value: activeBorrowers, sub: `${borrowers.length} registered total`, color: "#f59e0b", grad: "linear-gradient(135deg,#f59e0b,#f97316)", icon: "◉" },
    { label: "Payment Borrowers", value: new Set(payments.map(p => loans.find(l => l.id === p.loan_id)?.borrower_id)).size, sub: `Total collected: ${fmt(totalCollected)}`, color: "#f43f5e", grad: "linear-gradient(135deg,#f43f5e,#e11d48)", icon: "◎" },
  ];

  const dueSoon = activeLoans.filter(l => {
    const d = (new Date(l.due_date) - new Date()) / 86400000;
    return d >= 0 && d <= 7;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {/* Stat cards */}
      <div style={S.statsGrid}>
        {cards.map((c, i) => (
          <div key={i} style={{ ...S.statCard, background: c.grad }}>
            <div style={S.statTop}>
              <span style={S.statLabel}>{c.label}</span>
              <span style={S.statIcon}>{c.icon}</span>
            </div>
            <div style={S.statValue}>{c.value}</div>
            <div style={S.statSub}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Charts row */}
      <div style={S.dashRow}>
        {/* Payment status mini chart */}
        <div style={S.glassCard}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>Payment Status</span>
            <span style={S.cardBadge}>Current vs Overdue</span>
          </div>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            {[
              { label: "Active", count: activeLoans.length, color: "#22d3a0" },
              { label: "Overdue", count: overdueLoans.length, color: "#f43f5e" },
              { label: "Paid", count: loans.filter(l => l.status === "Paid").length, color: "#6366f1" },
            ].map(item => (
              <div key={item.label} style={{ flex: 1, background: item.color + "18", borderRadius: 10, padding: "12px 14px", border: `1px solid ${item.color}30` }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.count}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
          {/* Bar viz */}
          <div style={{ display: "flex", gap: 3, alignItems: "flex-end", height: 60, marginTop: 8 }}>
            {[activeLoans.length, overdueLoans.length, loans.filter(l => l.status === "Paid").length, payments.length].map((v, i) => {
              const max = Math.max(activeLoans.length, overdueLoans.length, loans.filter(l => l.status === "Paid").length, payments.length, 1);
              const colors = ["#22d3a0", "#f43f5e", "#6366f1", "#f59e0b"];
              return (
                <div key={i} style={{ flex: 1, background: colors[i], borderRadius: "4px 4px 0 0", height: `${(v / max) * 100}%`, opacity: 0.8, minHeight: 4 }} />
              );
            })}
          </div>
          <div style={{ display: "flex", gap: 3, marginTop: 4 }}>
            {["Active", "Overdue", "Paid", "Payments"].map(l => (
              <div key={l} style={{ flex: 1, fontSize: 9, color: "#64748b", textAlign: "center" }}>{l}</div>
            ))}
          </div>
        </div>

        {/* Overdue */}
        <div style={S.glassCard}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>⚠ Overdue Loans</span>
            <button style={S.miniBtn} onClick={() => setTab("loans")}>View All</button>
          </div>
          {overdueLoans.length === 0
            ? <div style={S.emptyState}>🎉 No overdue loans</div>
            : overdueLoans.slice(0, 4).map(l => {
              const b = borrowers.find(x => x.id === l.borrower_id);
              const days = Math.floor((new Date() - new Date(l.due_date)) / 86400000);
              return (
                <div key={l.id} style={S.listRow}>
                  <div style={S.rowAvatar}>{(b?.name || "?")[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={S.rowName}>{b?.name || "—"}</div>
                    <div style={S.rowSub}>{days}d overdue · {l.due_date}</div>
                  </div>
                  <div style={{ ...S.rowAmount, color: "#f43f5e" }}>{fmt(loanBalance(l))}</div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Recent payments + due soon */}
      <div style={S.dashRow}>
        <div style={S.glassCard}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>💸 Recent Payments</span>
            <button style={S.miniBtn} onClick={() => setTab("payments")}>View All</button>
          </div>
          {recentPayments.length === 0
            ? <div style={S.emptyState}>No payments yet</div>
            : recentPayments.map(p => {
              const loan = loans.find(l => l.id === p.loan_id);
              const b = borrowers.find(x => x.id === loan?.borrower_id);
              return (
                <div key={p.id} style={S.listRow}>
                  <div style={{ ...S.rowAvatar, background: "linear-gradient(135deg,#22d3a0,#06b6d4)" }}>{(b?.name || "?")[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={S.rowName}>{b?.name || "—"}</div>
                    <div style={S.rowSub}>{p.date} · {p.method}</div>
                  </div>
                  <div style={{ ...S.rowAmount, color: "#22d3a0" }}>{fmt(p.amount)}</div>
                </div>
              );
            })}
        </div>

        <div style={S.glassCard}>
          <div style={S.cardHeader}>
            <span style={S.cardTitle}>📅 Due Within 7 Days</span>
            <span style={S.cardBadge}>{dueSoon.length} loan{dueSoon.length !== 1 ? "s" : ""}</span>
          </div>
          {dueSoon.length === 0
            ? <div style={S.emptyState}>No loans due in 7 days</div>
            : dueSoon.map(l => {
              const b = borrowers.find(x => x.id === l.borrower_id);
              const diff = Math.ceil((new Date(l.due_date) - new Date()) / 86400000);
              return (
                <div key={l.id} style={S.listRow}>
                  <div style={{ ...S.rowAvatar, background: "linear-gradient(135deg,#f59e0b,#f97316)" }}>{(b?.name || "?")[0]}</div>
                  <div style={{ flex: 1 }}>
                    <div style={S.rowName}>{b?.name || "—"}</div>
                    <div style={S.rowSub}>Due in {diff} day{diff !== 1 ? "s" : ""} · {l.due_date}</div>
                  </div>
                  <div style={{ ...S.rowAmount, color: "#f59e0b" }}>{fmt(loanBalance(l))}</div>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}

// ─── Loans Tab ────────────────────────────────────────────────────────────────
function LoansTab({ loans, borrowers, payments, loanBalance, onEdit, onDelete, onPay, onMarkPaid }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const statuses = ["All", "Active", "Overdue", "Paid", "Pending"];

  const filtered = loans.filter(l => {
    const b = borrowers.find(x => x.id === l.borrower_id);
    return (filter === "All" || l.status === filter) &&
      (!search || b?.name?.toLowerCase().includes(search.toLowerCase()) || b?.id_no?.toLowerCase().includes(search.toLowerCase()));
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={S.toolbar}>
        <input style={S.searchInput} placeholder="🔍 Search borrower or ID..." value={search} onChange={e => setSearch(e.target.value)} />
        <div style={S.filterRow}>
          {statuses.map(st => (
            <button key={st} style={{ ...S.filterBtn, ...(filter === st ? S.filterActive : {}) }} onClick={() => setFilter(st)}>{st}</button>
          ))}
        </div>
      </div>

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>{["Borrower", "Principal", "Interest", "Total Due", "Balance", "Start", "Due Date", "Status", "Actions"].map(h => (
              <th key={h} style={S.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={9} style={S.emptyTd}>No loans found</td></tr>
              : filtered.map(l => {
                const b = borrowers.find(x => x.id === l.borrower_id);
                const rate = l.interest_rate ?? l.interestRate ?? 0;
                const interest = l.principal * rate / 100;
                const bal = loanBalance(l);
                const isOver = l.status === "Overdue";
                return (
                  <tr key={l.id} className="trow">
                    <td style={S.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ ...S.rowAvatar, width: 30, height: 30, fontSize: 12, flexShrink: 0 }}>{(b?.name || "?")[0]}</div>
                        <div>
                          <div style={S.rowName}>{b?.name || "—"}</div>
                          <div style={S.rowSub}>ID: {b?.id_no || "N/A"}</div>
                        </div>
                      </div>
                    </td>
                    <td style={S.td}>{fmt(l.principal)}</td>
                    <td style={S.td}><span style={S.ratePill}>{rate}%</span></td>
                    <td style={S.td}>{fmt(l.principal + interest)}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: bal === 0 ? "#22d3a0" : isOver ? "#f43f5e" : "#f59e0b" }}>{fmt(bal)}</td>
                    <td style={S.td}>{l.start_date}</td>
                    <td style={{ ...S.td, color: isOver ? "#f43f5e" : "inherit" }}>{l.due_date}</td>
                    <td style={S.td}>
                      <span style={{ ...S.statusPill, background: statusColor(l.status) + "22", color: statusColor(l.status), border: `1px solid ${statusColor(l.status)}44` }}>
                        {l.status}
                      </span>
                    </td>
                    <td style={S.td}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {l.status !== "Paid" && <button style={S.actBtn} onClick={() => onPay(l)} title="Record payment">💰</button>}
                        {l.status !== "Paid" && <button style={{ ...S.actBtn, color: "#22d3a0" }} onClick={() => onMarkPaid(l)} title="Mark fully paid">✓</button>}
                        <button style={S.actBtn} onClick={() => onEdit(l)} title="Edit">✏️</button>
                        <button style={{ ...S.actBtn, color: "#f43f5e" }} onClick={() => onDelete(l.id)} title="Delete">🗑</button>
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
function BorrowersTab({ borrowers, loans, payments, loanBalance, onEdit, onDelete, onNewLoan, onPay }) {
  const [search, setSearch] = useState("");
  const filtered = borrowers.filter(b =>
    b.name?.toLowerCase().includes(search.toLowerCase()) ||
    b.phone?.includes(search) ||
    b.id_no?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input style={{ ...S.searchInput, maxWidth: "none" }} placeholder="🔍 Search by name, phone, or ID number..." value={search} onChange={e => setSearch(e.target.value)} />
      <div style={S.borrowerGrid}>
        {filtered.map(b => {
          const bLoans = loans.filter(l => l.borrower_id === b.id);
          const activeLoans = bLoans.filter(l => l.status !== "Paid");
          const overdueLoans = bLoans.filter(l => l.status === "Overdue");
          const totalBalance = activeLoans.reduce((s, l) => s + loanBalance(l), 0);
          const bPayments = payments.filter(p => bLoans.some(l => l.id === p.loan_id));
          const totalPaid = bPayments.reduce((s, p) => s + p.amount, 0);

          return (
            <div key={b.id} style={S.borrowerCard}>
              <div style={S.bCardTop}>
                <div style={S.bAvatar}>{b.name[0].toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={S.bName}>{b.name}</div>
                  <div style={S.rowSub}>{b.phone}</div>
                </div>
                {overdueLoans.length > 0 && (
                  <span style={{ ...S.statusPill, background: "#f43f5e22", color: "#f43f5e", border: "1px solid #f43f5e44", fontSize: 10 }}>
                    {overdueLoans.length} Overdue
                  </span>
                )}
              </div>

              <div style={S.bInfoGrid}>
                <div style={S.bInfoItem}>
                  <span style={S.bInfoLabel}>ID Type</span>
                  <span style={S.bInfoVal}>{b.id_type || "—"}</span>
                </div>
                <div style={S.bInfoItem}>
                  <span style={S.bInfoLabel}>ID Number</span>
                  <span style={S.bInfoVal}>{b.id_no || "—"}</span>
                </div>
                <div style={S.bInfoItem}>
                  <span style={S.bInfoLabel}>Address</span>
                  <span style={S.bInfoVal}>{b.address || "—"}</span>
                </div>
                <div style={S.bInfoItem}>
                  <span style={S.bInfoLabel}>Total Paid</span>
                  <span style={{ ...S.bInfoVal, color: "#22d3a0", fontWeight: 700 }}>{fmt(totalPaid)}</span>
                </div>
              </div>

              <div style={S.bBalance}>
                <div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>Outstanding Balance</div>
                  <div style={{ fontSize: 18, fontWeight: 800, color: totalBalance > 0 ? "#f43f5e" : "#22d3a0" }}>{fmt(totalBalance)}</div>
                </div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ ...S.pill, background: "#6366f122", color: "#a5b4fc" }}>{bLoans.length} loans</span>
                  {activeLoans.length > 0 && <span style={{ ...S.pill, background: "#f59e0b22", color: "#f59e0b" }}>{activeLoans.length} active</span>}
                </div>
              </div>

              {/* Per-loan payment buttons */}
              {activeLoans.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {activeLoans.slice(0, 2).map(l => (
                    <div key={l.id} style={S.loanMiniRow}>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        <span style={{ ...S.statusPill, background: statusColor(l.status) + "22", color: statusColor(l.status), border: `1px solid ${statusColor(l.status)}33`, fontSize: 10, padding: "1px 6px" }}>{l.status}</span>
                        {" "}{fmt(l.principal)} · Bal: <strong style={{ color: "#f59e0b" }}>{fmt(loanBalance(l))}</strong>
                      </div>
                      {l.status !== "Paid" && (
                        <button style={{ ...S.miniBtn, background: "#6366f120", borderColor: "#6366f140", color: "#a5b4fc" }}
                          onClick={() => onPay(b, l)}>Pay</button>
                      )}
                    </div>
                  ))}
                </div>
              )}

              <div style={S.bActions}>
                <button style={S.primaryBtn} onClick={() => onNewLoan(b)}>+ New Loan</button>
                <button style={S.ghostBtn} onClick={() => onEdit(b)}>Edit</button>
                <button style={{ ...S.ghostBtn, color: "#f43f5e88", borderColor: "#f43f5e33" }} onClick={() => onDelete(b.id)}>Delete</button>
              </div>
            </div>
          );
        })}
        {filtered.length === 0 && <div style={S.emptyState}>No borrowers found</div>}
      </div>
    </div>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────
function PaymentsTab({ payments, loans, borrowers }) {
  const [search, setSearch] = useState("");
  const sorted = [...payments].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const filtered = sorted.filter(p => {
    const loan = loans.find(l => l.id === p.loan_id);
    const b = borrowers.find(x => x.id === loan?.borrower_id);
    return !search || b?.name?.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
        <input style={{ ...S.searchInput, maxWidth: 300 }} placeholder="🔍 Search by borrower..." value={search} onChange={e => setSearch(e.target.value)} />
        <div style={{ ...S.glassChip, fontWeight: 700 }}>
          Total: <span style={{ color: "#22d3a0" }}>{fmt(filtered.reduce((s, p) => s + p.amount, 0))}</span>
        </div>
      </div>

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>{["Date", "Borrower", "ID Number", "Loan Purpose", "Loan Amount", "Payment", "Method", "Status"].map(h => (
              <th key={h} style={S.th}>{h}</th>
            ))}</tr>
          </thead>
          <tbody>
            {filtered.length === 0
              ? <tr><td colSpan={8} style={S.emptyTd}>No payments recorded</td></tr>
              : filtered.map(p => {
                const loan = loans.find(l => l.id === p.loan_id);
                const b = borrowers.find(x => x.id === loan?.borrower_id);
                const isOnTime = loan && new Date(p.date) <= new Date(loan.due_date);
                return (
                  <tr key={p.id} className="trow">
                    <td style={S.td}>{p.date}</td>
                    <td style={S.td}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ ...S.rowAvatar, width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>{(b?.name || "?")[0]}</div>
                        <span style={S.rowName}>{b?.name || "—"}</span>
                      </div>
                    </td>
                    <td style={S.td}><span style={S.glassChip}>{b?.id_no || "—"}</span></td>
                    <td style={S.td}>{loan?.notes || "General"}</td>
                    <td style={S.td}>{fmt(loan?.principal)}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: "#22d3a0" }}>{fmt(p.amount)}</td>
                    <td style={S.td}><span style={{ ...S.pill, background: "#6366f122", color: "#a5b4fc" }}>{p.method}</span></td>
                    <td style={S.td}>
                      <span style={{ ...S.statusPill, background: isOnTime ? "#22d3a022" : "#f43f5e22", color: isOnTime ? "#22d3a0" : "#f43f5e", border: `1px solid ${isOnTime ? "#22d3a033" : "#f43f5e33"}` }}>
                        {isOnTime ? "On-Time" : "Late"}
                      </span>
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

// ─── Modals ───────────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  return (
    <div style={S.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={S.modal}>
        <div style={S.modalHead}>
          <h2 style={S.modalTitle}>{title}</h2>
          <button style={S.closeBtn} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}
function Fld({ label, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <label style={S.lbl}>{label}</label>{children}
  </div>;
}

function BorrowerModal({ data, onSave, onClose }) {
  const ugIdTypes = ["National ID (NIN)", "Passport", "Driver's License", "Voter's Card", "NSSF Card", "LC Letter", "Other"];
  const [form, setForm] = useState(data
    ? { ...data, id_type: data.id_type || "National ID (NIN)" }
    : { name: "", phone: "", address: "", id_type: "National ID (NIN)", id_no: "" });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    if (!form.name || !form.phone) return alert("Name and phone are required");
    if (!form.id_no) return alert("ID number is required");
    onSave(form);
  };

  return (
    <Modal title={data ? "Edit Borrower" : "Add New Borrower"} onClose={onClose}>
      <div style={S.modalBody}>
        <Fld label="Full Name *"><input style={S.inp} value={form.name} onChange={set("name")} placeholder="e.g. Amara Nakato" /></Fld>
        <Fld label="Phone Number *"><input style={S.inp} value={form.phone} onChange={set("phone")} placeholder="e.g. 0700 123456" /></Fld>
        <Fld label="Address"><input style={S.inp} value={form.address || ""} onChange={set("address")} placeholder="e.g. Kampala, Nakasero" /></Fld>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Fld label="ID Type *">
            <select style={S.inp} value={form.id_type} onChange={set("id_type")}>
              {ugIdTypes.map(t => <option key={t}>{t}</option>)}
            </select>
          </Fld>
          <Fld label="ID Number * (Enter Manually)">
            <input style={{ ...S.inp, fontFamily: "monospace", letterSpacing: 1 }} value={form.id_no || ""} onChange={set("id_no")} placeholder="e.g. CM90100012345X" />
          </Fld>
        </div>
      </div>
      <div style={S.modalFoot}>
        <button style={S.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={S.primaryBtn} onClick={submit}>{data ? "Update Borrower" : "Add Borrower"}</button>
      </div>
    </Modal>
  );
}

function LoanModal({ data, borrowers, onSave, onClose }) {
  const init = data
    ? { borrowerId: data.borrower_id || data.borrowerId || "", principal: data.principal || "", interestRate: data.interest_rate ?? data.interestRate ?? 10, termDays: data.term_days ?? data.termDays ?? 30, startDate: data.start_date || data.startDate || today(), notes: data.notes || "", id: data.id }
    : { borrowerId: data?.borrowerId || "", principal: "", interestRate: 10, termDays: 30, startDate: today(), notes: "" };
  const [form, setForm] = useState(init);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const interest = (parseFloat(form.principal) * parseFloat(form.interestRate) / 100) || 0;
  const total = (parseFloat(form.principal) || 0) + interest;

  const submit = () => {
    if (!form.borrowerId || !form.principal) return alert("Borrower and principal are required");
    onSave({ ...form, principal: parseFloat(form.principal), interestRate: parseFloat(form.interestRate), termDays: parseInt(form.termDays) });
  };

  return (
    <Modal title={data?.id ? "Edit Loan" : "Create New Loan"} onClose={onClose}>
      <div style={S.modalBody}>
        <Fld label="Borrower *">
          <select style={S.inp} value={form.borrowerId} onChange={set("borrowerId")}>
            <option value="">— Select Borrower —</option>
            {borrowers.map(b => <option key={b.id} value={b.id}>{b.name} (ID: {b.id_no || "N/A"})</option>)}
          </select>
        </Fld>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Fld label="Principal Amount (UGX) *"><input style={S.inp} type="number" value={form.principal} onChange={set("principal")} placeholder="0" /></Fld>
          <Fld label="Interest Rate (%)"><input style={S.inp} type="number" value={form.interestRate} onChange={set("interestRate")} min="0" max="100" /></Fld>
          <Fld label="Term (Days)"><input style={S.inp} type="number" value={form.termDays} onChange={set("termDays")} min="1" /></Fld>
          <Fld label="Start Date"><input style={S.inp} type="date" value={form.startDate} onChange={set("startDate")} /></Fld>
        </div>
        <Fld label="Loan Purpose / Notes"><textarea style={{ ...S.inp, height: 60, resize: "vertical" }} value={form.notes} onChange={set("notes")} placeholder="e.g. Home Repair, Education, Business..." /></Fld>

        <div style={S.loanSummary}>
          {[
            { label: "Principal", val: fmt(form.principal || 0), color: "#e2e8f0" },
            { label: `Interest (${form.interestRate}%)`, val: fmt(interest), color: "#f59e0b" },
            { label: "Total Due", val: fmt(total), color: "#6366f1", big: true },
            { label: "Due Date", val: addDays(form.startDate, parseInt(form.termDays) || 0), color: "#22d3a0" },
          ].map(row => (
            <div key={row.label} style={S.sumRow}>
              <span style={{ color: "#64748b" }}>{row.label}</span>
              <strong style={{ color: row.color, fontSize: row.big ? 18 : 14 }}>{row.val}</strong>
            </div>
          ))}
        </div>
      </div>
      <div style={S.modalFoot}>
        <button style={S.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={S.primaryBtn} onClick={submit}>{data?.id ? "Update Loan" : "Create Loan"}</button>
      </div>
    </Modal>
  );
}

function PaymentModal({ data, loans, borrowers, loanBalance, onSave, onClose }) {
  const activeLoans = loans.filter(l => l.status !== "Paid");
  const [form, setForm] = useState({ loanId: data?.loanId || "", amount: "", date: today(), method: "Cash", note: "" });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const selectedLoan = loans.find(l => l.id === form.loanId);
  const selectedBorrower = borrowers.find(b => b.id === selectedLoan?.borrower_id);
  const bal = selectedLoan ? loanBalance(selectedLoan) : 0;

  const submit = () => {
    if (!form.loanId || !form.amount) return alert("Loan selection and amount are required");
    if (parseFloat(form.amount) <= 0) return alert("Amount must be greater than 0");
    if (parseFloat(form.amount) > bal) return alert(`Amount (${fmt(form.amount)}) exceeds balance of ${fmt(bal)}`);
    onSave({ ...form, amount: parseFloat(form.amount), borrowerName: selectedBorrower?.name });
  };

  return (
    <Modal title="Record Payment" onClose={onClose}>
      <div style={S.modalBody}>
        <Fld label="Select Loan / Borrower *">
          <select style={S.inp} value={form.loanId} onChange={set("loanId")}>
            <option value="">— Select Borrower's Loan —</option>
            {activeLoans.map(l => {
              const b = borrowers.find(x => x.id === l.borrower_id);
              return <option key={l.id} value={l.id}>{b?.name} (ID: {b?.id_no || "N/A"}) · Principal: {fmt(l.principal)} · Balance: {fmt(loanBalance(l))}</option>;
            })}
          </select>
        </Fld>

        {selectedLoan && selectedBorrower && (
          <div style={S.payBorrowerCard}>
            <div style={S.bAvatar}>{selectedBorrower.name[0]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{selectedBorrower.name}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>ID: {selectedBorrower.id_no || "N/A"} · Phone: {selectedBorrower.phone}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
                Total Loan: <strong>{fmt(selectedLoan.principal)}</strong> · Outstanding Balance: <strong style={{ color: "#f43f5e" }}>{fmt(bal)}</strong>
              </div>
            </div>
          </div>
        )}

        {selectedLoan && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>Outstanding:</span>
            <strong style={{ color: "#f43f5e" }}>{fmt(bal)}</strong>
            <button style={{ ...S.pill, cursor: "pointer", background: "#6366f122", color: "#a5b4fc", border: "1px solid #6366f133" }}
              onClick={() => setForm(f => ({ ...f, amount: bal.toFixed(0) }))}>Pay Full Balance</button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Fld label="Payment Amount (UGX) *">
            <input style={S.inp} type="number" value={form.amount} onChange={set("amount")} placeholder="0" />
          </Fld>
          <Fld label="Payment Date">
            <input style={S.inp} type="date" value={form.date} onChange={set("date")} />
          </Fld>
        </div>

        <Fld label="Payment Method">
          <select style={S.inp} value={form.method} onChange={set("method")}>
            {["Cash", "Mobile Money (MTN)", "Mobile Money (Airtel)", "Bank Transfer", "Cheque", "Other"].map(m => <option key={m}>{m}</option>)}
          </select>
        </Fld>
        <Fld label="Note (optional)"><input style={S.inp} value={form.note} onChange={set("note")} placeholder="e.g. Partial payment for October" /></Fld>

        {form.amount && selectedLoan && (
          <div style={S.loanSummary}>
            <div style={S.sumRow}><span style={{ color: "#64748b" }}>Payment Amount</span><strong style={{ color: "#22d3a0" }}>{fmt(form.amount)}</strong></div>
            <div style={S.sumRow}><span style={{ color: "#64748b" }}>Remaining After Payment</span><strong style={{ color: "#f59e0b" }}>{fmt(Math.max(0, bal - parseFloat(form.amount || 0)))}</strong></div>
            {parseFloat(form.amount) >= bal && <div style={{ fontSize: 12, color: "#22d3a0", textAlign: "center", padding: "6px 0" }}>🎉 This will fully clear the loan!</div>}
          </div>
        )}
      </div>
      <div style={S.modalFoot}>
        <button style={S.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={S.primaryBtn} onClick={submit}>Record Payment</button>
      </div>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  root: { display: "flex", height: "100vh", background: "#0a0b12", color: "#e2e8f0", fontFamily: "'Sora', 'DM Sans', sans-serif", overflow: "hidden", position: "relative" },

  // Auth
  authWrap: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0a0b12", fontFamily: "'Sora','DM Sans',sans-serif", padding: 16, position: "relative" },
  authBg: { position: "fixed", inset: 0, background: "radial-gradient(ellipse 80% 60% at 50% -20%, #6366f130, transparent), radial-gradient(ellipse 60% 50% at 80% 80%, #22d3a015, transparent)", pointerEvents: "none" },
  authCard: { background: "rgba(17,18,28,0.95)", border: "1px solid #2d3148", borderRadius: 20, padding: 36, width: "100%", maxWidth: 440, display: "flex", flexDirection: "column", gap: 16, backdropFilter: "blur(20px)", boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(99,102,241,0.1)", position: "relative", zIndex: 1 },
  authLogo: { display: "flex", alignItems: "center", gap: 14, marginBottom: 8 },
  authTitle: { fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: -0.5 },
  authSub: { fontSize: 11, color: "#64748b" },
  tabRow: { display: "flex", background: "#111218", borderRadius: 10, padding: 4, gap: 4 },
  tabBtn: { flex: 1, padding: "8px 0", border: "none", borderRadius: 8, background: "transparent", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600 },
  tabActive: { background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff" },
  inp: { padding: "10px 13px", background: "#0d0e18", border: "1px solid #2d3148", borderRadius: 9, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box", transition: "border-color 0.2s" },
  lbl: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 },
  errorBox: { background: "#f43f5e18", border: "1px solid #f43f5e44", borderRadius: 9, padding: "10px 14px", color: "#f43f5e", fontSize: 13 },
  fieldRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },

  // Layout
  sidebar: { width: 230, background: "rgba(13,14,22,0.98)", borderRight: "1px solid #1e2030", display: "flex", flexDirection: "column", flexShrink: 0, transition: "transform 0.3s ease, width 0.3s ease", overflow: "hidden", zIndex: 50 },
  sidebarMobile: { position: "fixed", top: 0, left: 0, height: "100vh", width: 260, zIndex: 200 },
  sidebarHidden: { transform: "translateX(-100%)" },
  sidebarShown: { transform: "translateX(0)" },
  mobileOverlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 150, backdropFilter: "blur(3px)" },

  sideTop: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  sideLogoWrap: { display: "flex", alignItems: "center", gap: 11, padding: "22px 18px", borderBottom: "1px solid #1e2030" },
  logoCircle: { width: 38, height: 38, borderRadius: 10, background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", flexShrink: 0 },
  logoTitle: { fontSize: 13, fontWeight: 800, color: "#fff", letterSpacing: -0.3, lineHeight: 1.2 },
  logoSub: { fontSize: 9, color: "#64748b", letterSpacing: 0.5 },
  closeSideBtn: { marginLeft: "auto", background: "transparent", border: "none", color: "#64748b", fontSize: 16, cursor: "pointer", padding: 4 },

  nav: { flex: 1, padding: "14px 10px", display: "flex", flexDirection: "column", gap: 3, overflowY: "auto" },
  navBtn: { display: "flex", alignItems: "center", gap: 10, padding: "10px 13px", borderRadius: 9, border: "none", background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 13, fontFamily: "inherit", fontWeight: 500, textAlign: "left", position: "relative", transition: "all 0.15s" },
  navActive: { background: "rgba(99,102,241,0.12)", color: "#a5b4fc" },
  navIcon: { fontSize: 16, width: 20, textAlign: "center" },
  navIndicator: { position: "absolute", right: 0, top: "50%", transform: "translateY(-50%)", width: 3, height: 20, background: "linear-gradient(#6366f1,#8b5cf6)", borderRadius: "3px 0 0 3px" },
  badge: { marginLeft: "auto", background: "#f43f5e", color: "#fff", fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 99 },

  sideFooter: { padding: "14px 10px", borderTop: "1px solid #1e2030", display: "flex", flexDirection: "column", gap: 8 },
  workerBadge: { display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", background: "#111218", borderRadius: 10, border: "1px solid #1e2030" },
  workerAvatar: { width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 },
  sideBtn: { padding: "8px 12px", border: "1px solid #2d3148", borderRadius: 8, background: "transparent", color: "#94a3b8", cursor: "pointer", fontSize: 12, fontFamily: "inherit", textAlign: "left" },

  mainArea: { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 24px", borderBottom: "1px solid #1e2030", background: "rgba(10,11,18,0.95)", flexShrink: 0, gap: 12, flexWrap: "wrap" },
  headerLeft: { display: "flex", alignItems: "center", gap: 14 },
  menuBtn: { background: "rgba(99,102,241,0.1)", border: "1px solid #2d3148", borderRadius: 8, color: "#a5b4fc", cursor: "pointer", padding: "6px 10px", fontSize: 16, fontFamily: "inherit" },
  pageTitle: { margin: 0, fontSize: 18, fontWeight: 800, color: "#fff", letterSpacing: -0.5 },
  headerRight: { display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" },
  dateBadge: { fontSize: 11, color: "#64748b", background: "#111218", padding: "5px 12px", borderRadius: 99, border: "1px solid #1e2030" },
  content: { flex: 1, overflow: "auto", padding: "22px 24px", scrollbarWidth: "thin", scrollbarColor: "#2d3148 transparent" },

  // Dashboard
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 0 },
  statCard: { borderRadius: 14, padding: "20px 22px", position: "relative", overflow: "hidden" },
  statTop: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 },
  statLabel: { fontSize: 11, color: "rgba(255,255,255,0.7)", fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.8 },
  statIcon: { fontSize: 20, opacity: 0.5 },
  statValue: { fontSize: 26, fontWeight: 900, color: "#fff", letterSpacing: -1, marginBottom: 4 },
  statSub: { fontSize: 11, color: "rgba(255,255,255,0.6)" },

  dashRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 },
  glassCard: { background: "rgba(17,18,28,0.8)", border: "1px solid #1e2030", borderRadius: 14, padding: 20, backdropFilter: "blur(10px)" },
  cardHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
  cardTitle: { fontSize: 13, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8 },
  cardBadge: { fontSize: 10, color: "#6366f1", background: "#6366f120", padding: "3px 8px", borderRadius: 99, border: "1px solid #6366f133" },
  miniBtn: { fontSize: 11, color: "#a5b4fc", background: "#6366f115", border: "1px solid #6366f130", borderRadius: 6, padding: "3px 10px", cursor: "pointer", fontFamily: "inherit" },

  listRow: { display: "flex", alignItems: "center", gap: 10, padding: "9px 0", borderBottom: "1px solid #1e2030" },
  rowAvatar: { width: 34, height: 34, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "#fff", flexShrink: 0 },
  rowName: { fontSize: 13, fontWeight: 600, color: "#e2e8f0" },
  rowSub: { fontSize: 11, color: "#64748b", marginTop: 1 },
  rowAmount: { fontSize: 13, fontWeight: 700, whiteSpace: "nowrap" },
  emptyState: { color: "#4a5568", textAlign: "center", padding: "20px 0", fontSize: 13 },

  // Table
  toolbar: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" },
  searchInput: { flex: 1, maxWidth: 300, padding: "9px 14px", background: "#111218", border: "1px solid #2d3148", borderRadius: 9, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none" },
  filterRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  filterBtn: { padding: "6px 14px", border: "1px solid #2d3148", borderRadius: 99, background: "transparent", color: "#64748b", cursor: "pointer", fontSize: 12, fontFamily: "inherit" },
  filterActive: { background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff", borderColor: "transparent" },

  tableWrap: { overflowX: "auto", background: "rgba(17,18,28,0.8)", borderRadius: 14, border: "1px solid #1e2030", backdropFilter: "blur(10px)" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 13 },
  th: { padding: "13px 14px", textAlign: "left", color: "#64748b", fontWeight: 600, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", borderBottom: "1px solid #1e2030", whiteSpace: "nowrap" },
  td: { padding: "12px 14px", borderBottom: "1px solid #0d0e18", verticalAlign: "middle" },
  emptyTd: { padding: "30px 14px", textAlign: "center", color: "#4a5568", fontSize: 13 },

  statusPill: { padding: "3px 10px", borderRadius: 99, fontSize: 11, fontWeight: 600, display: "inline-block" },
  ratePill: { background: "#6366f122", color: "#a5b4fc", borderRadius: 6, padding: "2px 7px", fontSize: 11, border: "1px solid #6366f133" },
  pill: { padding: "3px 9px", borderRadius: 99, fontSize: 11, fontWeight: 600, display: "inline-block" },
  glassChip: { fontSize: 11, color: "#94a3b8", background: "#1e2030", padding: "3px 9px", borderRadius: 6, display: "inline-block" },
  actBtn: { background: "transparent", border: "1px solid #2d3148", borderRadius: 7, padding: "5px 8px", cursor: "pointer", fontSize: 13, color: "#94a3b8", fontFamily: "inherit" },

  // Borrowers
  borrowerGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 16 },
  borrowerCard: { background: "rgba(17,18,28,0.9)", border: "1px solid #1e2030", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 14, backdropFilter: "blur(10px)" },
  bCardTop: { display: "flex", alignItems: "flex-start", gap: 12 },
  bAvatar: { width: 44, height: 44, borderRadius: "50%", background: "linear-gradient(135deg,#6366f1,#a855f7)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18, fontWeight: 700, color: "#fff", flexShrink: 0 },
  bName: { fontSize: 15, fontWeight: 800, color: "#fff", marginBottom: 2 },
  bInfoGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, background: "#0d0e18", borderRadius: 10, padding: 12, border: "1px solid #1e2030" },
  bInfoItem: { display: "flex", flexDirection: "column", gap: 2 },
  bInfoLabel: { fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 },
  bInfoVal: { fontSize: 12, color: "#e2e8f0", fontWeight: 500 },
  bBalance: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 8 },
  loanMiniRow: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "7px 10px", background: "#0d0e18", borderRadius: 8, border: "1px solid #1e2030" },
  bActions: { display: "flex", gap: 8, flexWrap: "wrap" },

  // Modals
  overlay: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.75)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, backdropFilter: "blur(6px)", padding: 16 },
  modal: { background: "#0d0e18", border: "1px solid #2d3148", borderRadius: 18, width: "100%", maxWidth: 540, maxHeight: "92vh", display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 40px 100px rgba(0,0,0,0.7)" },
  modalHead: { display: "flex", alignItems: "center", justifyContent: "space-between", padding: "20px 24px", borderBottom: "1px solid #1e2030" },
  modalTitle: { margin: 0, fontSize: 17, fontWeight: 800, color: "#fff" },
  closeBtn: { background: "#1e2030", border: "none", borderRadius: 7, color: "#94a3b8", fontSize: 14, cursor: "pointer", padding: "5px 9px" },
  modalBody: { padding: "20px 24px", overflow: "auto", display: "flex", flexDirection: "column", gap: 14 },
  modalFoot: { display: "flex", justifyContent: "flex-end", gap: 10, padding: "16px 24px", borderTop: "1px solid #1e2030" },

  loanSummary: { background: "#111218", borderRadius: 10, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 8, border: "1px solid #1e2030" },
  sumRow: { display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 13 },

  payBorrowerCard: { display: "flex", alignItems: "center", gap: 12, background: "#111218", borderRadius: 10, padding: "12px 14px", border: "1px solid #6366f133" },

  // Buttons
  primaryBtn: { padding: "10px 20px", background: "linear-gradient(135deg,#6366f1,#8b5cf6)", border: "none", borderRadius: 9, color: "#fff", fontWeight: 700, cursor: "pointer", fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap", letterSpacing: -0.2 },
  ghostBtn: { padding: "10px 20px", background: "transparent", border: "1px solid #2d3148", borderRadius: 9, color: "#94a3b8", cursor: "pointer", fontSize: 13, fontFamily: "inherit", whiteSpace: "nowrap" },

  toast: { position: "fixed", bottom: 24, right: 24, padding: "13px 20px", borderRadius: 11, color: "#fff", fontWeight: 700, fontSize: 13, boxShadow: "0 8px 32px rgba(0,0,0,0.5)", zIndex: 9999, animation: "slideUp 0.3s ease", maxWidth: 380 },
};

const globalCss = `
  @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600;700;800;900&family=DM+Sans:wght@400;500;600&display=swap');
  * { box-sizing: border-box; }
  body { margin: 0; background: #0a0b12; }
  @keyframes slideUp { from { opacity: 0; transform: translateY(16px); } to { opacity: 1; transform: translateY(0); } }
  select option { background: #0d0e18; color: #e2e8f0; }
  input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2d3148; border-radius: 99px; }
  button { transition: opacity 0.15s, transform 0.1s; }
  button:hover { opacity: 0.88; }
  button:active { transform: scale(0.97); }
  .trow:hover td { background: rgba(99,102,241,0.04) !important; }
  input:focus, select:focus, textarea:focus { border-color: #6366f1 !important; box-shadow: 0 0 0 3px rgba(99,102,241,0.12); }
  @media (max-width: 768px) {
    .dash-row { grid-template-columns: 1fr !important; }
    .stats-grid { grid-template-columns: 1fr 1fr !important; }
  }
`;
