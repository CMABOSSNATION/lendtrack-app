import { useState, useEffect, useCallback } from "react";

// ─── Utility helpers ──────────────────────────────────────────────────────────
const fmt = (n) =>
  new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(n || 0);
const today = () => new Date().toISOString().split("T")[0];
const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
};
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const statusColor = (s) =>
  ({ Active: "#22c55e", Paid: "#3b82f6", Overdue: "#ef4444", Pending: "#f59e0b" }[s] || "#888");

// ─── Storage (localStorage for offline use) ───────────────────────────────────
const KEYS = { borrowers: "lms_borrowers", loans: "lms_loans", payments: "lms_payments" };
const load = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
const save = (k, v) => localStorage.setItem(k, JSON.stringify(v));

// ─── Seed demo data if empty ──────────────────────────────────────────────────
function seedIfEmpty() {
  if (load(KEYS.borrowers).length) return;
  const borrowers = [
    { id: "b1", name: "Maria Santos", phone: "09171234567", address: "Quezon City", idType: "PhilSys", idNo: "1234-5678", createdAt: "2024-01-10" },
    { id: "b2", name: "Juan dela Cruz", phone: "09281234567", address: "Makati City", idType: "Driver's License", idNo: "N01-23-456789", createdAt: "2024-02-05" },
    { id: "b3", name: "Rosa Reyes", phone: "09391234567", address: "Pasig City", idType: "SSS", idNo: "34-5678901-2", createdAt: "2024-03-01" },
  ];
  const loans = [
    { id: "l1", borrowerId: "b1", principal: 10000, interestRate: 5, termDays: 30, startDate: "2025-03-01", dueDate: "2025-03-31", status: "Overdue", notes: "Personal use" },
    { id: "l2", borrowerId: "b2", principal: 25000, interestRate: 3, termDays: 60, startDate: "2025-04-01", dueDate: "2025-05-31", status: "Active", notes: "Business capital" },
    { id: "l3", borrowerId: "b3", principal: 5000, interestRate: 5, termDays: 15, startDate: "2025-04-10", dueDate: "2025-04-25", status: "Paid", notes: "" },
  ];
  const payments = [
    { id: "p1", loanId: "l3", amount: 5750, date: "2025-04-20", method: "Cash", note: "Full payment" },
    { id: "p2", loanId: "l2", amount: 5000, date: "2025-04-15", method: "GCash", note: "Partial" },
  ];
  save(KEYS.borrowers, borrowers);
  save(KEYS.loans, loans);
  save(KEYS.payments, payments);
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  seedIfEmpty();
  const [tab, setTab] = useState("dashboard");
  const [borrowers, setBorrowers] = useState(load(KEYS.borrowers));
  const [loans, setLoans] = useState(load(KEYS.loans));
  const [payments, setPayments] = useState(load(KEYS.payments));
  const [modal, setModal] = useState(null); // { type, data }
  const [toast, setToast] = useState(null);

  const persist = useCallback((bArr, lArr, pArr) => {
    if (bArr) { setBorrowers(bArr); save(KEYS.borrowers, bArr); }
    if (lArr) { setLoans(lArr); save(KEYS.loans, lArr); }
    if (pArr) { setPayments(pArr); save(KEYS.payments, pArr); }
  }, []);

  const showToast = (msg, type = "success") => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  // Auto-update overdue loans
  useEffect(() => {
    const updated = loans.map(l => {
      if (l.status === "Active" && l.dueDate < today()) return { ...l, status: "Overdue" };
      return l;
    });
    if (JSON.stringify(updated) !== JSON.stringify(loans)) persist(null, updated, null);
  }, []);

  // Computed stats
  const totalLoaned = loans.filter(l => l.status !== "Paid").reduce((s, l) => s + l.principal, 0);
  const totalInterest = loans.filter(l => l.status !== "Paid").reduce((s, l) => s + (l.principal * l.interestRate / 100), 0);
  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);
  const overdueCount = loans.filter(l => l.status === "Overdue").length;

  const loanBalance = (loan) => {
    const interest = loan.principal * loan.interestRate / 100;
    const total = loan.principal + interest;
    const paid = payments.filter(p => p.loanId === loan.id).reduce((s, p) => s + p.amount, 0);
    return Math.max(0, total - paid);
  };

  // ─── Handlers ──────────────────────────────────────────────────────────────
  const saveBorrower = (data) => {
    const isEdit = borrowers.find(b => b.id === data.id);
    const updated = isEdit
      ? borrowers.map(b => b.id === data.id ? data : b)
      : [...borrowers, { ...data, id: uid(), createdAt: today() }];
    persist(updated, null, null);
    showToast(isEdit ? "Borrower updated!" : "Borrower added!");
    setModal(null);
  };

  const deleteBorrower = (id) => {
    if (!confirm("Delete borrower and all their loans?")) return;
    const lIds = loans.filter(l => l.borrowerId === id).map(l => l.id);
    persist(
      borrowers.filter(b => b.id !== id),
      loans.filter(l => l.borrowerId !== id),
      payments.filter(p => !lIds.includes(p.loanId))
    );
    showToast("Borrower deleted", "error");
  };

  const saveLoan = (data) => {
    const interest = data.principal * data.interestRate / 100;
    const due = addDays(data.startDate, parseInt(data.termDays));
    const loanObj = { ...data, dueDate: due, status: "Active", id: data.id || uid() };
    const isEdit = loans.find(l => l.id === loanObj.id);
    const updated = isEdit ? loans.map(l => l.id === loanObj.id ? loanObj : l) : [...loans, loanObj];
    persist(null, updated, null);
    showToast(isEdit ? "Loan updated!" : `Loan of ${fmt(data.principal)} created! Total due: ${fmt(data.principal + interest)}`);
    setModal(null);
  };

  const markPaid = (loan) => {
    const bal = loanBalance(loan);
    const pmt = { id: uid(), loanId: loan.id, amount: bal, date: today(), method: "Cash", note: "Full settlement" };
    const updatedLoans = loans.map(l => l.id === loan.id ? { ...l, status: "Paid" } : l);
    persist(null, updatedLoans, [...payments, pmt]);
    showToast("Loan marked as fully paid!");
  };

  const savePayment = (data) => {
    const pmt = { ...data, id: uid(), date: data.date || today() };
    const newPayments = [...payments, pmt];
    // Check if fully paid
    const loan = loans.find(l => l.id === data.loanId);
    const bal = loanBalance(loan) - data.amount;
    let updatedLoans = loans;
    if (bal <= 0) updatedLoans = loans.map(l => l.id === data.loanId ? { ...l, status: "Paid" } : l);
    persist(null, updatedLoans, newPayments);
    showToast(`Payment of ${fmt(data.amount)} recorded!`);
    setModal(null);
  };

  const deleteLoan = (id) => {
    if (!confirm("Delete this loan and all its payments?")) return;
    persist(null, loans.filter(l => l.id !== id), payments.filter(p => p.loanId !== id));
    showToast("Loan deleted", "error");
  };

  const exportCSV = () => {
    const rows = [["Borrower", "Principal", "Interest Rate", "Term", "Due Date", "Status", "Balance"]];
    loans.forEach(l => {
      const b = borrowers.find(x => x.id === l.borrowerId);
      rows.push([b?.name, l.principal, l.interestRate + "%", l.termDays + "d", l.dueDate, l.status, loanBalance(l)]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = "data:text/csv," + encodeURIComponent(csv);
    a.download = "loans_export.csv"; a.click();
    showToast("CSV exported!");
  };

  const nav = [
    { id: "dashboard", label: "Dashboard", icon: "⬡" },
    { id: "loans", label: "Loans", icon: "◈" },
    { id: "borrowers", label: "Borrowers", icon: "◉" },
    { id: "payments", label: "Payments", icon: "◎" },
  ];

  return (
    <div style={styles.root}>
      <style>{css}</style>

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
          {nav.map(n => (
            <button key={n.id} style={{ ...styles.navBtn, ...(tab === n.id ? styles.navActive : {}) }}
              onClick={() => setTab(n.id)}>
              <span style={styles.navIcon}>{n.icon}</span> {n.label}
              {n.id === "loans" && overdueCount > 0 && <span style={styles.badge}>{overdueCount}</span>}
            </button>
          ))}
        </nav>
        <div style={styles.sideFooter}>
          <button style={styles.exportBtn} onClick={exportCSV}>⬇ Export CSV</button>
          <div style={styles.version}>v1.0 · Offline Ready</div>
        </div>
      </aside>

      {/* Main content */}
      <main style={styles.main}>
        <header style={styles.header}>
          <h1 style={styles.pageTitle}>
            {tab === "dashboard" ? "Dashboard Overview" : tab === "loans" ? "Loan Records" : tab === "borrowers" ? "Borrowers" : "Payment History"}
          </h1>
          <div style={styles.headerRight}>
            <span style={styles.dateChip}>{new Date().toLocaleDateString("en-PH", { weekday: "short", year: "numeric", month: "long", day: "numeric" })}</span>
            {tab === "borrowers" && <button style={styles.primaryBtn} onClick={() => setModal({ type: "borrower", data: null })}>+ Add Borrower</button>}
            {tab === "loans" && <button style={styles.primaryBtn} onClick={() => setModal({ type: "loan", data: null })}>+ New Loan</button>}
            {tab === "payments" && <button style={styles.primaryBtn} onClick={() => setModal({ type: "payment", data: null })}>+ Record Payment</button>}
          </div>
        </header>

        <div style={styles.content}>
          {tab === "dashboard" && <Dashboard loans={loans} borrowers={borrowers} payments={payments} totalLoaned={totalLoaned} totalInterest={totalInterest} totalCollected={totalCollected} overdueCount={overdueCount} loanBalance={loanBalance} setTab={setTab} />}
          {tab === "loans" && <LoansTab loans={loans} borrowers={borrowers} payments={payments} loanBalance={loanBalance} onNew={() => setModal({ type: "loan", data: null })} onEdit={l => setModal({ type: "loan", data: l })} onDelete={deleteLoan} onPay={l => setModal({ type: "payment", data: { loanId: l.id } })} onMarkPaid={markPaid} />}
          {tab === "borrowers" && <BorrowersTab borrowers={borrowers} loans={loans} onEdit={b => setModal({ type: "borrower", data: b })} onDelete={deleteBorrower} onNewLoan={b => setModal({ type: "loan", data: { borrowerId: b.id } })} />}
          {tab === "payments" && <PaymentsTab payments={payments} loans={loans} borrowers={borrowers} />}
        </div>
      </main>

      {/* Modals */}
      {modal?.type === "borrower" && <BorrowerModal data={modal.data} onSave={saveBorrower} onClose={() => setModal(null)} />}
      {modal?.type === "loan" && <LoanModal data={modal.data} borrowers={borrowers} onSave={saveLoan} onClose={() => setModal(null)} />}
      {modal?.type === "payment" && <PaymentModal data={modal.data} loans={loans} borrowers={borrowers} loanBalance={loanBalance} onSave={savePayment} onClose={() => setModal(null)} />}

      {/* Toast */}
      {toast && <div style={{ ...styles.toast, background: toast.type === "error" ? "#ef4444" : "#22c55e" }}>{toast.msg}</div>}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────
function Dashboard({ loans, borrowers, payments, totalLoaned, totalInterest, totalCollected, overdueCount, loanBalance, setTab }) {
  const activeLoans = loans.filter(l => l.status === "Active");
  const overdueLoans = loans.filter(l => l.status === "Overdue");
  const recentPayments = [...payments].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5);

  const cards = [
    { label: "Total Outstanding", value: fmt(totalLoaned + totalInterest), sub: `${loans.filter(l => l.status !== "Paid").length} active loans`, color: "#6366f1", icon: "◈" },
    { label: "Interest Receivable", value: fmt(totalInterest), sub: `Across all active loans`, color: "#f59e0b", icon: "%" },
    { label: "Total Collected", value: fmt(totalCollected), sub: `${payments.length} payments received`, color: "#22c55e", icon: "✓" },
    { label: "Overdue Loans", value: overdueCount, sub: `Needs immediate attention`, color: "#ef4444", icon: "!" },
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
          {overdueLoans.length === 0
            ? <p style={styles.empty}>No overdue loans 🎉</p>
            : overdueLoans.map(l => {
              const b = borrowers.find(x => x.id === l.borrowerId);
              return (
                <div key={l.id} style={styles.listRow}>
                  <div>
                    <div style={styles.rowName}>{b?.name}</div>
                    <div style={styles.rowSub}>Due: {l.dueDate} · {Math.floor((new Date() - new Date(l.dueDate)) / 86400000)}d overdue</div>
                  </div>
                  <div style={{ ...styles.amount, color: "#ef4444" }}>{fmt(loanBalance(l))}</div>
                </div>
              );
            })}
        </div>

        <div style={styles.dashCard}>
          <h3 style={styles.cardTitle}>💸 Recent Payments</h3>
          {recentPayments.length === 0
            ? <p style={styles.empty}>No payments yet</p>
            : recentPayments.map(p => {
              const loan = loans.find(l => l.id === p.loanId);
              const b = borrowers.find(x => x.id === loan?.borrowerId);
              return (
                <div key={p.id} style={styles.listRow}>
                  <div>
                    <div style={styles.rowName}>{b?.name || "—"}</div>
                    <div style={styles.rowSub}>{p.date} · {p.method}</div>
                  </div>
                  <div style={{ ...styles.amount, color: "#22c55e" }}>{fmt(p.amount)}</div>
                </div>
              );
            })}
        </div>

        <div style={styles.dashCard}>
          <h3 style={styles.cardTitle}>📋 Loans Due Soon</h3>
          {activeLoans.filter(l => {
            const diff = (new Date(l.dueDate) - new Date()) / 86400000;
            return diff >= 0 && diff <= 7;
          }).length === 0
            ? <p style={styles.empty}>No loans due in 7 days</p>
            : activeLoans.filter(l => {
              const diff = (new Date(l.dueDate) - new Date()) / 86400000;
              return diff >= 0 && diff <= 7;
            }).map(l => {
              const b = borrowers.find(x => x.id === l.borrowerId);
              const diff = Math.ceil((new Date(l.dueDate) - new Date()) / 86400000);
              return (
                <div key={l.id} style={styles.listRow}>
                  <div>
                    <div style={styles.rowName}>{b?.name}</div>
                    <div style={styles.rowSub}>Due in {diff} day{diff !== 1 ? "s" : ""} · {l.dueDate}</div>
                  </div>
                  <div style={{ ...styles.amount, color: "#f59e0b" }}>{fmt(loanBalance(l))}</div>
                </div>
              );
            })}
        </div>

        <div style={styles.dashCard}>
          <h3 style={styles.cardTitle}>👥 Borrower Summary</h3>
          {borrowers.slice(0, 5).map(b => {
            const bLoans = loans.filter(l => l.borrowerId === b.id && l.status !== "Paid");
            const total = bLoans.reduce((s, l) => s + loanBalance(l), 0);
            return (
              <div key={b.id} style={styles.listRow}>
                <div>
                  <div style={styles.rowName}>{b.name}</div>
                  <div style={styles.rowSub}>{bLoans.length} active loan{bLoans.length !== 1 ? "s" : ""}</div>
                </div>
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

  const filtered = loans.filter(l => {
    const b = borrowers.find(x => x.id === l.borrowerId);
    const matchStatus = filter === "All" || l.status === filter;
    const matchSearch = !search || b?.name.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div>
      <div style={styles.toolbar}>
        <input style={styles.searchInput} placeholder="🔍  Search borrower..." value={search} onChange={e => setSearch(e.target.value)} />
        <div style={styles.filterBtns}>
          {statuses.map(s => (
            <button key={s} style={{ ...styles.filterBtn, ...(filter === s ? styles.filterActive : {}) }} onClick={() => setFilter(s)}>{s}</button>
          ))}
        </div>
      </div>

      <div style={styles.tableWrap}>
        <table style={styles.table}>
          <thead>
            <tr>
              {["Borrower", "Principal", "Interest", "Total Due", "Balance", "Start", "Due Date", "Status", "Actions"].map(h => (
                <th key={h} style={styles.th}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={9} style={styles.empty}>No loans found</td></tr>
            ) : filtered.map(l => {
              const b = borrowers.find(x => x.id === l.borrowerId);
              const interest = l.principal * l.interestRate / 100;
              const bal = loanBalance(l);
              const isOverdue = l.status === "Overdue";
              return (
                <tr key={l.id} style={{ background: isOverdue ? "rgba(239,68,68,0.04)" : "transparent" }}>
                  <td style={styles.td}><div style={styles.rowName}>{b?.name || "—"}</div><div style={styles.rowSub}>{b?.phone}</div></td>
                  <td style={styles.td}>{fmt(l.principal)}</td>
                  <td style={styles.td}><span style={styles.rateBadge}>{l.interestRate}%</span> {fmt(interest)}</td>
                  <td style={styles.td}>{fmt(l.principal + interest)}</td>
                  <td style={{ ...styles.td, fontWeight: 700, color: bal > 0 ? (isOverdue ? "#ef4444" : "#f59e0b") : "#22c55e" }}>{fmt(bal)}</td>
                  <td style={styles.td}>{l.startDate}</td>
                  <td style={{ ...styles.td, color: isOverdue ? "#ef4444" : "inherit" }}>{l.dueDate}</td>
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
  const filtered = borrowers.filter(b => b.name.toLowerCase().includes(search.toLowerCase()) || b.phone.includes(search));

  return (
    <div>
      <div style={styles.toolbar}>
        <input style={styles.searchInput} placeholder="🔍  Search borrower..." value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div style={styles.borrowerGrid}>
        {filtered.map(b => {
          const bLoans = loans.filter(l => l.borrowerId === b.id);
          const active = bLoans.filter(l => l.status !== "Paid").length;
          const overdue = bLoans.filter(l => l.status === "Overdue").length;
          return (
            <div key={b.id} style={styles.borrowerCard}>
              <div style={styles.avatar}>{b.name[0]}</div>
              <div style={styles.borrowerInfo}>
                <div style={styles.borrowerName}>{b.name}</div>
                <div style={styles.rowSub}>📞 {b.phone}</div>
                <div style={styles.rowSub}>📍 {b.address}</div>
                <div style={styles.rowSub}>🪪 {b.idType}: {b.idNo}</div>
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
  const sorted = [...payments].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <div style={styles.tableWrap}>
      <table style={styles.table}>
        <thead>
          <tr>{["Date", "Borrower", "Loan Amount", "Payment", "Method", "Note"].map(h => <th key={h} style={styles.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {sorted.length === 0 ? <tr><td colSpan={6} style={styles.empty}>No payments yet</td></tr>
            : sorted.map(p => {
              const loan = loans.find(l => l.id === p.loanId);
              const b = borrowers.find(x => x.id === loan?.borrowerId);
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
    <div style={styles.overlay} onClick={e => e.target === e.currentTarget && onClose()}>
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

function Field({ label, children }) {
  return <div style={styles.field}><label style={styles.label}>{label}</label>{children}</div>;
}

function BorrowerModal({ data, onSave, onClose }) {
  const [form, setForm] = useState(data || { name: "", phone: "", address: "", idType: "PhilSys", idNo: "" });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const submit = () => { if (!form.name || !form.phone) return alert("Name and phone required"); onSave(form); };
  return (
    <Modal title={data ? "Edit Borrower" : "Add Borrower"} onClose={onClose}>
      <div style={styles.modalBody}>
        <Field label="Full Name *"><input style={styles.input} value={form.name} onChange={set("name")} placeholder="e.g. Maria Santos" /></Field>
        <Field label="Phone *"><input style={styles.input} value={form.phone} onChange={set("phone")} placeholder="09XXXXXXXXX" /></Field>
        <Field label="Address"><input style={styles.input} value={form.address} onChange={set("address")} placeholder="City, Province" /></Field>
        <Field label="ID Type">
          <select style={styles.input} value={form.idType} onChange={set("idType")}>
            {["PhilSys", "Driver's License", "SSS", "GSIS", "Passport", "PRC", "Voter's ID", "Other"].map(t => <option key={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="ID Number"><input style={styles.input} value={form.idNo} onChange={set("idNo")} placeholder="ID number" /></Field>
      </div>
      <div style={styles.modalFooter}>
        <button style={styles.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={styles.primaryBtn} onClick={submit}>{data ? "Update" : "Add Borrower"}</button>
      </div>
    </Modal>
  );
}

function LoanModal({ data, borrowers, onSave, onClose }) {
  const [form, setForm] = useState(data || { borrowerId: "", principal: "", interestRate: 5, termDays: 30, startDate: today(), notes: "" });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
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
            {borrowers.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Principal Amount (₱) *"><input style={styles.input} type="number" value={form.principal} onChange={set("principal")} placeholder="0.00" /></Field>
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
  const activeLoans = loans.filter(l => l.status !== "Paid");
  const [form, setForm] = useState({ loanId: data?.loanId || "", amount: "", date: today(), method: "Cash", note: "" });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const selectedLoan = loans.find(l => l.id === form.loanId);
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
            {activeLoans.map(l => {
              const b = borrowers.find(x => x.id === l.borrowerId);
              return <option key={l.id} value={l.id}>{b?.name} · {fmt(l.principal)} · bal: {fmt(loanBalance(l))}</option>;
            })}
          </select>
        </Field>
        {selectedLoan && <div style={styles.balanceChip}>Outstanding Balance: <strong style={{ color: "#f59e0b" }}>{fmt(bal)}</strong> <button style={{ ...styles.pill, cursor: "pointer", background: "#6366f122", color: "#6366f1", border: "none" }} onClick={() => setForm(f => ({ ...f, amount: bal.toFixed(2) }))}>Pay Full</button></div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Field label="Amount (₱) *"><input style={styles.input} type="number" value={form.amount} onChange={set("amount")} placeholder="0.00" /></Field>
          <Field label="Date"><input style={styles.input} type="date" value={form.date} onChange={set("date")} /></Field>
        </div>
        <Field label="Method">
          <select style={styles.input} value={form.method} onChange={set("method")}>
            {["Cash", "GCash", "Bank Transfer", "Maya", "Check", "Other"].map(m => <option key={m}>{m}</option>)}
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
  root: { display: "flex", height: "100vh", background: "#0d0e14", color: "#e2e8f0", fontFamily: "'IBM Plex Mono', 'Courier New', monospace", overflow: "hidden" },
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
  statCard: { background: "#111218", borderRadius: 12, padding: "20px", border: "1px solid #1e2030", position: "relative" },
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
  @keyframes slideUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
  select option { background: #111218; color: #e2e8f0; }
  input[type=date]::-webkit-calendar-picker-indicator { filter: invert(0.5); }
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #2d3148; border-radius: 99px; }
  button:hover { opacity: 0.85; }
  tr:hover { background: rgba(99,102,241,0.04) !important; }
`;
