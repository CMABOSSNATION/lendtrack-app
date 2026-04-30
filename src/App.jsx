import { useState, useEffect, useCallback, useRef } from "react";
import {
  cacheData, getOfflineData, enqueue, getQueue, removeFromQueue,
  cacheAuthCredentials, tryOfflineLogin,
  computeCreditScore, saveCreditScore,
} from "./offlineStore";

// ─── Config ───────────────────────────────────────────────────────────────────
const API = (typeof import.meta !== "undefined" && import.meta.env?.VITE_API_URL) || "http://localhost:4000/api";

// ─── Utility ──────────────────────────────────────────────────────────────────
const fmt = (n) => "UGX " + new Intl.NumberFormat("en-UG", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
const today = () => new Date().toISOString().split("T")[0];
const addDays = (dateStr, days) => { const d = new Date(dateStr); d.setDate(d.getDate() + days); return d.toISOString().split("T")[0]; };
const statusColor = (s) => ({ Active: "#22d3a0", Paid: "#6366f1", Overdue: "#f43f5e", Pending: "#f59e0b" }[s] || "#888");

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

// ─── Image Compression ────────────────────────────────────────────────────────
async function compressImage(file, maxKB = 60, maxW = 800) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let { width, height } = img;
        if (width > maxW) { height = Math.round(height * maxW / width); width = maxW; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);

        // Try quality levels until under maxKB
        let quality = 0.8;
        const tryCompress = () => {
          const dataUrl = canvas.toDataURL("image/jpeg", quality);
          const sizeKB = Math.round((dataUrl.length * 3) / 4 / 1024);
          if (sizeKB <= maxKB || quality <= 0.1) {
            resolve({ dataUrl, sizeKB });
          } else {
            quality = Math.max(0.1, quality - 0.1);
            tryCompress();
          }
        };
        tryCompress();
      };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function downloadBase64(dataUri, filename) {
  const a = document.createElement("a"); a.href = dataUri; a.download = filename; a.click();
}

// ─── Offline PDF Report Generator ─────────────────────────────────────────────
function generateOfflineReport(borrowers, loans, payments, loanBalanceFn, user, reportType = "full") {
  const now = new Date().toLocaleString("en-UG", { timeZone: "Africa/Kampala" });
  const company = user?.company_name || "LendTrack";

  const loanRows = loans.map(l => {
    const b = borrowers.find(x => x.id === l.borrower_id);
    const interest = l.principal * (l.interest_rate || 0) / 100;
    const penalty = parseFloat(l.penalty_amount || 0);
    const bal = loanBalanceFn(l);
    const score = computeCreditScore(l.borrower_id, loans, payments);
    return { loan: l, borrower: b, interest, penalty, bal, score };
  });

  const totalOutstanding = loans.filter(l => l.status !== "Paid").reduce((s, l) => s + loanBalanceFn(l), 0);
  const totalCollected = payments.reduce((s, p) => s + p.amount, 0);
  const overdueCount = loans.filter(l => l.status === "Overdue").length;
  const paidCount = loans.filter(l => l.status === "Paid").length;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${company} – LendTrack Report</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #f8fafc; color: #1e293b; font-size: 12px; }
  .page { max-width: 1100px; margin: 0 auto; padding: 24px; }
  .header { background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; border-radius: 12px; padding: 20px 24px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 22px; font-weight: 800; }
  .header p { font-size: 11px; opacity: 0.85; margin-top: 3px; }
  .summary { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 20px; }
  .stat { background: #fff; border-radius: 10px; padding: 14px 16px; border: 1px solid #e2e8f0; }
  .stat-label { font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.8px; }
  .stat-value { font-size: 20px; font-weight: 800; color: #1e293b; margin-top: 4px; }
  .stat-sub { font-size: 10px; color: #94a3b8; margin-top: 2px; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden; border: 1px solid #e2e8f0; margin-bottom: 20px; }
  th { background: #f1f5f9; padding: 10px 12px; text-align: left; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.8px; color: #475569; border-bottom: 1px solid #e2e8f0; }
  td { padding: 10px 12px; border-bottom: 1px solid #f1f5f9; vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:nth-child(even) td { background: #fafafa; }
  .pill { padding: 2px 8px; border-radius: 99px; font-size: 10px; font-weight: 700; display: inline-block; }
  .pill-active { background: #dcfce7; color: #16a34a; }
  .pill-paid { background: #ede9fe; color: #7c3aed; }
  .pill-overdue { background: #fee2e2; color: #dc2626; }
  .pill-pending { background: #fef9c3; color: #ca8a04; }
  .score-A { color: #16a34a; font-weight: 800; }
  .score-B { color: #2563eb; font-weight: 800; }
  .score-C { color: #d97706; font-weight: 800; }
  .score-D, .score-F { color: #dc2626; font-weight: 800; }
  .section-title { font-size: 14px; font-weight: 800; color: #1e293b; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 2px solid #6366f1; }
  .footer { text-align: center; color: #94a3b8; font-size: 10px; margin-top: 24px; padding-top: 12px; border-top: 1px solid #e2e8f0; }
  @media print { body { background: #fff; } .page { padding: 12px; } }
</style>
</head>
<body>
<div class="page">
  <div class="header">
    <div>
      <h1>📊 ${company}</h1>
      <p>LendTrack Offline Report &nbsp;·&nbsp; Generated: ${now}</p>
      <p>Prepared by: ${user?.name || "—"} &nbsp;·&nbsp; Branch: ${user?.branch || "—"}</p>
    </div>
    <div style="text-align:right; font-size:11px; opacity:0.9;">
      <div style="font-size:28px; font-weight:900;">${loans.length}</div>
      <div>Total Loans</div>
    </div>
  </div>

  <div class="summary">
    <div class="stat">
      <div class="stat-label">Outstanding Balance</div>
      <div class="stat-value" style="color:#6366f1">${fmt(totalOutstanding)}</div>
      <div class="stat-sub">${loans.filter(l => l.status !== "Paid").length} active loans</div>
    </div>
    <div class="stat">
      <div class="stat-label">Total Collected</div>
      <div class="stat-value" style="color:#16a34a">${fmt(totalCollected)}</div>
      <div class="stat-sub">${payments.length} payments recorded</div>
    </div>
    <div class="stat">
      <div class="stat-label">Overdue Loans</div>
      <div class="stat-value" style="color:#dc2626">${overdueCount}</div>
      <div class="stat-sub">Require follow-up</div>
    </div>
    <div class="stat">
      <div class="stat-label">Loans Fully Paid</div>
      <div class="stat-value" style="color:#7c3aed">${paidCount}</div>
      <div class="stat-sub">${borrowers.length} total borrowers</div>
    </div>
  </div>

  <div class="section-title">📋 All Loans with Credit Score</div>
  <table>
    <thead>
      <tr>
        <th>#</th><th>Borrower</th><th>ID Number</th><th>Principal</th>
        <th>Interest</th><th>Penalty</th><th>Total Due</th><th>Balance</th>
        <th>Start</th><th>Due Date</th><th>Status</th><th>Credit Score</th>
      </tr>
    </thead>
    <tbody>
      ${loanRows.map((r, i) => `
        <tr>
          <td>${i + 1}</td>
          <td><strong>${r.borrower?.name || "—"}</strong><br><span style="color:#94a3b8;font-size:10px;">${r.borrower?.phone || ""}</span></td>
          <td><code style="font-size:10px">${r.borrower?.id_no || "—"}</code></td>
          <td>${fmt(r.loan.principal)}</td>
          <td>${fmt(r.interest)}<br><span style="color:#94a3b8;font-size:10px;">${r.loan.interest_rate}%</span></td>
          <td>${r.penalty > 0 ? `<span style="color:#dc2626">${fmt(r.penalty)}</span>` : "—"}</td>
          <td><strong>${fmt(r.loan.principal + r.interest + r.penalty)}</strong></td>
          <td><strong style="color:${r.bal === 0 ? "#16a34a" : r.loan.status === "Overdue" ? "#dc2626" : "#d97706"}">${fmt(r.bal)}</strong></td>
          <td>${r.loan.start_date}</td>
          <td style="color:${r.loan.status === "Overdue" ? "#dc2626" : "inherit"}">${r.loan.due_date}</td>
          <td><span class="pill pill-${r.loan.status.toLowerCase()}">${r.loan.status}</span></td>
          <td>${r.score.score > 0 ? `<span class="score-${r.score.grade[0]}">${r.score.score} ${r.score.grade}</span><br><span style="font-size:10px;color:#64748b">${r.score.label}</span>` : '<span style="color:#94a3b8">N/A</span>'}</td>
        </tr>`).join("")}
    </tbody>
  </table>

  <div class="section-title">💳 Credit Score Summary</div>
  <table>
    <thead>
      <tr><th>#</th><th>Borrower</th><th>Score</th><th>Grade</th><th>Status</th><th>On-Time Payments</th><th>Loans Repaid</th><th>Total Paid</th><th>Key Factors</th></tr>
    </thead>
    <tbody>
      ${borrowers.map((b, i) => {
        const sc = computeCreditScore(b.id, loans, payments);
        if (sc.score === 0) return `<tr><td>${i+1}</td><td>${b.name}</td><td colspan="7" style="color:#94a3b8">No loan history</td></tr>`;
        return `<tr>
          <td>${i+1}</td>
          <td><strong>${b.name}</strong></td>
          <td><strong style="font-size:16px; class='score-${sc.grade[0]}'">${sc.score}</strong></td>
          <td><span class="score-${sc.grade[0]}">${sc.grade}</span></td>
          <td>${sc.label}</td>
          <td>${sc.onTimeCount}/${sc.onTimeCount + sc.lateCount} on-time</td>
          <td>${sc.paidLoans} fully paid</td>
          <td>${fmt(sc.totalPaid)}</td>
          <td style="font-size:10px">${sc.factors.slice(0, 3).map(f => `${f.positive ? "✓" : "✗"} ${f.text}`).join("<br>")}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>

  <div class="section-title">💸 Payment History (Last 50)</div>
  <table>
    <thead>
      <tr><th>#</th><th>Date</th><th>Borrower</th><th>Amount</th><th>Method</th><th>Timing</th><th>Note</th></tr>
    </thead>
    <tbody>
      ${[...payments].sort((a,b) => b.date.localeCompare(a.date)).slice(0, 50).map((p, i) => {
        const loan = loans.find(l => l.id === p.loan_id);
        const b = borrowers.find(x => x.id === loan?.borrower_id);
        const onTime = loan && new Date(p.date) <= new Date(loan.due_date);
        return `<tr>
          <td>${i+1}</td>
          <td>${p.date}</td>
          <td>${b?.name || "—"}</td>
          <td><strong style="color:#16a34a">${fmt(p.amount)}</strong></td>
          <td>${p.method}</td>
          <td><span class="pill ${onTime ? "pill-paid" : "pill-overdue"}">${onTime ? "On-Time" : "Late"}</span></td>
          <td style="color:#64748b">${p.note || ""}</td>
        </tr>`;
      }).join("")}
    </tbody>
  </table>

  <div class="footer">
    LendTrack Uganda &nbsp;·&nbsp; Offline Report &nbsp;·&nbsp; ${now} &nbsp;·&nbsp; All data is stored locally on this device
  </div>
</div>
</body>
</html>`;

  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `LendTrack_Report_${today()}.html`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// ─── Auth Screen ──────────────────────────────────────────────────────────────
function AuthScreen({ onAuth }) {
  const [mode, setMode] = useState("login");
  const [form, setForm] = useState({ name: "", email: "", password: "", company_name: "", branch: "", invite_key: "", reset_token: "", new_password: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);
  const [resetToken, setResetToken] = useState("");
  const [isOffline, setIsOffline] = useState(!navigator.onLine);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const onl = () => setIsOffline(false);
    const offl = () => setIsOffline(true);
    window.addEventListener("online", onl);
    window.addEventListener("offline", offl);
    return () => { window.removeEventListener("online", onl); window.removeEventListener("offline", offl); };
  }, []);

  const submit = async () => {
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (mode === "login") {
        if (!form.email || !form.password) { setError("Email and password required"); return; }

        // Try offline login first if no connection
        if (isOffline) {
          const offlineResult = await tryOfflineLogin(form.email, form.password);
          if (offlineResult) {
            localStorage.setItem("lt_token", offlineResult.token);
            localStorage.setItem("lt_user", JSON.stringify(offlineResult.user));
            onAuth(offlineResult.user);
            return;
          } else {
            setError("No internet connection. Please connect once to enable offline login.");
            return;
          }
        }

        const data = await apiFetch("/auth/login", { method: "POST", body: { email: form.email, password: form.password } });
        localStorage.setItem("lt_token", data.token);
        localStorage.setItem("lt_user", JSON.stringify(data.user));
        // Cache credentials for offline login
        await cacheAuthCredentials(data.user, data.token, form.password);
        onAuth(data.user);

      } else if (mode === "register") {
        if (!form.name) { setError("Full name is required"); return; }
        if (!form.email || !form.password) { setError("Email and password required"); return; }
        if (!form.company_name) { setError("Company / branch name is required"); return; }
        if (!form.invite_key) { setError("An invite key is required. Contact the administrator."); return; }
        if (isOffline) { setError("Internet connection required to register."); return; }
        const data = await apiFetch("/auth/register", { method: "POST", body: { name: form.name, email: form.email, password: form.password, company_name: form.company_name, branch: form.branch, invite_key: form.invite_key } });
        localStorage.setItem("lt_token", data.token);
        localStorage.setItem("lt_user", JSON.stringify(data.user));
        await cacheAuthCredentials(data.user, data.token, form.password);
        onAuth(data.user);

      } else if (mode === "forgot") {
        if (!form.email) { setError("Email is required"); return; }
        if (isOffline) { setError("Internet connection required to reset password."); return; }
        const data = await apiFetch("/auth/forgot-password", { method: "POST", body: { email: form.email } });
        if (data.reset_token) { setResetToken(data.reset_token); setSuccess("Token generated! Copy it below."); }
        else setSuccess(data.message || "Check your email for a reset token.");

      } else if (mode === "reset") {
        if (!form.reset_token || !form.new_password) { setError("Token and new password required"); return; }
        const data = await apiFetch("/auth/reset-password", { method: "POST", body: { token: form.reset_token, new_password: form.new_password } });
        setSuccess(data.message || "Password reset! You can now sign in.");
        setTimeout(() => { setMode("login"); setSuccess(""); }, 2500);
      }
    } catch (err) {
      setError(err.message);
    } finally { setLoading(false); }
  };

  return (
    <div style={S.authWrap}>
      <style>{globalCss}</style>
      <div style={S.authBg} />
      <div style={S.authCard}>
        <div style={S.authLogo}>
          <div style={S.logoCircle}><span style={{ fontSize: 22, fontWeight: 900 }}>UG</span></div>
          <div>
            <div style={S.authTitle}>LendTrack</div>
            <div style={S.authSub}>Uganda Money Lender Pro</div>
          </div>
        </div>

        {isOffline && (
          <div style={{ background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 8, padding: "8px 12px", fontSize: 12, color: "#f59e0b" }}>
            📵 Offline mode — sign in with your cached credentials
          </div>
        )}

        {(mode === "login" || mode === "register") && (
          <div style={S.tabRow}>
            {["login", "register"].map(m => (
              <button key={m} style={{ ...S.tabBtn, ...(mode === m ? S.tabActive : {}) }} onClick={() => { setMode(m); setError(""); setSuccess(""); }}>
                {m === "login" ? "Sign In" : "Register"}
              </button>
            ))}
          </div>
        )}
        {(mode === "forgot" || mode === "reset") && <div style={{ fontSize: 13, color: "#94a3b8", textAlign: "center" }}>{mode === "forgot" ? "Forgot Password" : "Reset Password"}</div>}

        {error && <div style={S.errorBox}>⚠ {error}</div>}
        {success && <div style={S.successBox}>✓ {success}</div>}

        {mode === "register" && (
          <>
            <div style={S.fieldRow}>
              <AuthField label="Company / Branch Name *"><input style={S.inp} value={form.company_name} onChange={set("company_name")} placeholder="e.g. Kampala Finance Ltd" /></AuthField>
              <AuthField label="Branch (optional)"><input style={S.inp} value={form.branch} onChange={set("branch")} placeholder="e.g. Nakasero" /></AuthField>
            </div>
            <AuthField label="Your Full Name *"><input style={S.inp} value={form.name} onChange={set("name")} placeholder="e.g. Aisha Nakato" /></AuthField>
          </>
        )}

        {(mode === "login" || mode === "register") && (
          <>
            <AuthField label="Email Address"><input style={S.inp} type="email" value={form.email} onChange={set("email")} placeholder="you@company.com" /></AuthField>
            <AuthField label="Password"><input style={S.inp} type="password" value={form.password} onChange={set("password")} placeholder="••••••••" onKeyDown={e => e.key === "Enter" && submit()} /></AuthField>
          </>
        )}

        {mode === "register" && (
          <AuthField label="Invite Key * (provided by administrator)">
            <input style={{ ...S.inp, fontFamily: "monospace", letterSpacing: 1.5, textTransform: "uppercase" }} value={form.invite_key} onChange={e => setForm(f => ({ ...f, invite_key: e.target.value.toUpperCase() }))} placeholder="LENDTRACK-XXXX-XXXX" />
          </AuthField>
        )}

        {mode === "forgot" && (
          <AuthField label="Registered Email Address"><input style={S.inp} type="email" value={form.email} onChange={set("email")} placeholder="you@company.com" onKeyDown={e => e.key === "Enter" && submit()} /></AuthField>
        )}
        {mode === "forgot" && resetToken && (
          <div>
            <label style={S.lbl}>Reset Token (copy this)</label>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
              <input style={{ ...S.inp, fontFamily: "monospace", fontSize: 11, flex: 1 }} value={resetToken} readOnly onClick={e => e.target.select()} />
              <button style={S.ghostBtn} onClick={() => navigator.clipboard?.writeText(resetToken)}>Copy</button>
            </div>
            <button style={{ ...S.ghostBtn, width: "100%", marginTop: 10 }} onClick={() => { setMode("reset"); setForm(f => ({ ...f, reset_token: resetToken })); }}>Enter Token → Reset Password</button>
          </div>
        )}
        {mode === "reset" && (
          <>
            <AuthField label="Reset Token"><input style={{ ...S.inp, fontFamily: "monospace", fontSize: 11 }} value={form.reset_token} onChange={set("reset_token")} placeholder="Paste your reset token" /></AuthField>
            <AuthField label="New Password"><input style={S.inp} type="password" value={form.new_password} onChange={set("new_password")} placeholder="Choose a strong password" onKeyDown={e => e.key === "Enter" && submit()} /></AuthField>
          </>
        )}

        <button style={S.primaryBtn} onClick={submit} disabled={loading}>
          {loading ? "Please wait…" : mode === "login" ? "Sign In →" : mode === "register" ? "Create Account →" : mode === "forgot" ? "Generate Reset Token" : "Reset Password →"}
        </button>

        <div style={{ display: "flex", justifyContent: "center", gap: 16, flexWrap: "wrap" }}>
          {mode === "login" && <button style={S.linkBtn} onClick={() => { setMode("forgot"); setError(""); setSuccess(""); setResetToken(""); }}>Forgot password?</button>}
          {(mode === "forgot" || mode === "reset") && <button style={S.linkBtn} onClick={() => { setMode("login"); setError(""); setSuccess(""); setResetToken(""); }}>← Back to Sign In</button>}
        </div>
      </div>
    </div>
  );
}

function AuthField({ label, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><label style={S.lbl}>{label}</label>{children}</div>;
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(() => { try { return JSON.parse(localStorage.getItem("lt_user")); } catch { return null; } });
  const [tab, setTab] = useState("dashboard");
  const [sideOpen, setSideOpen] = useState(true);
  const [borrowers, setBorrowers] = useState([]);
  const [loans, setLoans] = useState([]);
  const [payments, setPayments] = useState([]);
  const [dashStats, setDashStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingSync, setPendingSync] = useState(0);

  useEffect(() => {
    const onl = () => setIsOnline(true);
    const offl = () => setIsOnline(false);
    window.addEventListener("online", onl);
    window.addEventListener("offline", offl);
    return () => { window.removeEventListener("online", onl); window.removeEventListener("offline", offl); };
  }, []);

  // Auto-sync when coming back online
  useEffect(() => {
    if (isOnline && user) {
      syncQueue();
      loadData();
    }
  }, [isOnline]);

  useEffect(() => {
    const fn = () => { const mobile = window.innerWidth < 768; setIsMobile(mobile); if (mobile) setSideOpen(false); else setSideOpen(true); };
    window.addEventListener("resize", fn); fn();
    return () => window.removeEventListener("resize", fn);
  }, []);

  const showToast = (msg, type = "success") => { setToast({ msg, type }); setTimeout(() => setToast(null), 3500); };

  const syncQueue = async () => {
    const queue = await getQueue();
    if (queue.length === 0) { setPendingSync(0); return; }
    setPendingSync(queue.length);
    for (const op of queue) {
      try {
        await apiFetch(op.path, { method: op.method, body: op.body });
        await removeFromQueue(op.qid);
      } catch (e) { /* keep in queue */ }
    }
    const remaining = (await getQueue()).length;
    setPendingSync(remaining);
    if (remaining < queue.length) showToast(`Synced ${queue.length - remaining} offline actions!`);
  };

  const loadData = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (isOnline) {
        const [b, l, p, d] = await Promise.all([apiFetch("/borrowers"), apiFetch("/loans"), apiFetch("/payments"), apiFetch("/dashboard")]);
        setBorrowers(b); setLoans(l); setPayments(p); setDashStats(d);
        await cacheData({ borrowers: b, loans: l, payments: p });
        // Recompute credit scores
        for (const borrower of b) {
          const sc = computeCreditScore(borrower.id, l, p);
          await saveCreditScore(borrower.id, sc);
        }
      } else {
        const { borrowers: b, loans: l, payments: p } = await getOfflineData();
        setBorrowers(b); setLoans(l); setPayments(p);
      }
    } catch (err) {
      // Fall back to offline
      try {
        const { borrowers: b, loans: l, payments: p } = await getOfflineData();
        setBorrowers(b); setLoans(l); setPayments(p);
        showToast("Loaded from offline cache", "info");
      } catch {}
    } finally { setLoading(false); }
  }, [user, isOnline]);

  useEffect(() => { if (user) loadData(); }, [user, loadData]);

  const handleLogout = () => { localStorage.removeItem("lt_token"); localStorage.removeItem("lt_user"); setUser(null); };

  const loanBalance = (loan) => {
    const interest = loan.principal * (loan.interest_rate ?? loan.interestRate ?? 0) / 100;
    const penalty = parseFloat(loan.penalty_amount || 0);
    const total = loan.principal + interest + penalty;
    const paid = payments.filter(p => p.loan_id === loan.id).reduce((s, p) => s + p.amount, 0);
    return Math.max(0, total - paid);
  };

  // ── CRUD ────────────────────────────────────────────────────────────────────
  const saveBorrower = async (data) => {
    try {
      if (isOnline) {
        if (data.id) await apiFetch(`/borrowers/${data.id}`, { method: "PUT", body: data });
        else await apiFetch("/borrowers", { method: "POST", body: data });
      } else {
        await enqueue({ method: data.id ? "PUT" : "POST", path: data.id ? `/borrowers/${data.id}` : "/borrowers", body: data });
        setPendingSync(q => q + 1);
      }
      showToast(data.id ? "Borrower updated!" : "Borrower added! (will sync when online)");
      await loadData(); setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const deleteBorrower = async (id) => {
    if (!confirm("Delete this borrower and all their records?")) return;
    try {
      if (isOnline) await apiFetch(`/borrowers/${id}`, { method: "DELETE" });
      else { await enqueue({ method: "DELETE", path: `/borrowers/${id}` }); setPendingSync(q => q + 1); }
      showToast("Borrower deleted", "error"); await loadData();
    } catch (err) { showToast(err.message, "error"); }
  };

  const saveLoan = async (data) => {
    const body = { borrower_id: data.borrowerId || data.borrower_id, principal: parseFloat(data.principal), interest_rate: parseFloat(data.interestRate || data.interest_rate), term_days: parseInt(data.termDays || data.term_days), start_date: data.startDate || data.start_date || today(), notes: data.notes || "" };
    try {
      if (isOnline) {
        if (data.id) await apiFetch(`/loans/${data.id}`, { method: "PUT", body });
        else await apiFetch("/loans", { method: "POST", body });
      } else {
        await enqueue({ method: data.id ? "PUT" : "POST", path: data.id ? `/loans/${data.id}` : "/loans", body });
        setPendingSync(q => q + 1);
      }
      showToast(data.id ? "Loan updated!" : `Loan of ${fmt(body.principal)} created!`);
      await loadData(); setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const savePayment = async (data) => {
    const body = { loan_id: data.loanId || data.loan_id, amount: parseFloat(data.amount), date: data.date || today(), method: data.method || "Cash", note: data.note || "" };
    try {
      if (isOnline) await apiFetch("/payments", { method: "POST", body });
      else { await enqueue({ method: "POST", path: "/payments", body }); setPendingSync(q => q + 1); }
      showToast(`Payment of ${fmt(body.amount)} recorded!`);
      await loadData(); setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const deleteLoan = async (id) => {
    if (!confirm("Delete this loan and all payments?")) return;
    try {
      if (isOnline) await apiFetch(`/loans/${id}`, { method: "DELETE" });
      else { await enqueue({ method: "DELETE", path: `/loans/${id}` }); setPendingSync(q => q + 1); }
      showToast("Loan deleted", "error"); await loadData();
    } catch (err) { showToast(err.message, "error"); }
  };

  const markPaid = async (loan) => {
    try {
      if (isOnline) await apiFetch(`/loans/${loan.id}/mark-paid`, { method: "POST" });
      else { await enqueue({ method: "POST", path: `/loans/${loan.id}/mark-paid` }); setPendingSync(q => q + 1); }
      showToast("Loan marked as fully paid!"); await loadData();
    } catch (err) { showToast(err.message, "error"); }
  };

  const addPenalty = async (loanId, amount, note) => {
    try {
      if (isOnline) await apiFetch(`/loans/${loanId}/add-penalty`, { method: "POST", body: { amount, note } });
      else { await enqueue({ method: "POST", path: `/loans/${loanId}/add-penalty`, body: { amount, note } }); setPendingSync(q => q + 1); }
      showToast(`Penalty of ${fmt(amount)} added!`); await loadData(); setModal(null);
    } catch (err) { showToast(err.message, "error"); }
  };

  const exportCSV = () => {
    const rows = [["Borrower", "ID No", "Principal (UGX)", "Interest Rate", "Penalty", "Total Due (UGX)", "Balance (UGX)", "Start Date", "Due Date", "Status", "Credit Score", "Credit Grade"]];
    loans.forEach(l => {
      const b = borrowers.find(x => x.id === l.borrower_id);
      const interest = l.principal * (l.interest_rate || 0) / 100;
      const penalty = parseFloat(l.penalty_amount || 0);
      const sc = computeCreditScore(l.borrower_id, loans, payments);
      rows.push([b?.name, b?.id_no, l.principal, (l.interest_rate || 0) + "%", penalty, l.principal + interest + penalty, loanBalance(l), l.start_date, l.due_date, l.status, sc.score || "N/A", sc.grade]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = "data:text/csv," + encodeURIComponent(csv); a.download = "lendtrack_export.csv"; a.click();
    showToast("CSV exported!");
  };

  if (!user) return <AuthScreen onAuth={u => setUser(u)} />;

  const navItems = [
    { id: "dashboard", label: "Dashboard", icon: "◈" },
    { id: "loans", label: "Loans", icon: "₿" },
    { id: "borrowers", label: "Borrowers", icon: "◉" },
    { id: "payments", label: "Payments", icon: "◎" },
    { id: "credit", label: "Credit Scores", icon: "★" },
  ];
  const overdueCount = loans.filter(l => l.status === "Overdue").length;
  const companyName = user.company_name || user.name || "LendTrack";
  const navTo = (id) => { setTab(id); if (isMobile) setSideOpen(false); };

  return (
    <div style={S.root}>
      <style>{globalCss}</style>

      {isMobile && sideOpen && <div style={S.mobileOverlay} onClick={() => setSideOpen(false)} />}

      <aside style={{ ...S.sidebar, ...(isMobile ? S.sidebarMobile : {}), ...(isMobile && !sideOpen ? S.sidebarHidden : {}), ...(isMobile && sideOpen ? S.sidebarShown : {}) }}>
        <div style={S.sideTop}>
          <div style={S.sideLogoWrap}>
            <div style={S.logoCircle}><span style={{ fontSize: 16, fontWeight: 900 }}>UG</span></div>
            <div>
              <div style={S.logoTitle}>{companyName}</div>
              <div style={S.logoSub}>Money Lender Pro</div>
            </div>
            {isMobile && <button style={S.closeSideBtn} onClick={() => setSideOpen(false)}>✕</button>}
          </div>

          {/* Online/Offline Status */}
          <div style={{ margin: "0 10px 8px", padding: "6px 10px", borderRadius: 8, background: isOnline ? "#22d3a018" : "#f59e0b18", border: `1px solid ${isOnline ? "#22d3a033" : "#f59e0b33"}`, fontSize: 11, color: isOnline ? "#22d3a0" : "#f59e0b", display: "flex", alignItems: "center", gap: 6 }}>
            <span>{isOnline ? "●" : "○"}</span>
            <span>{isOnline ? "Online" : "Offline"}</span>
            {pendingSync > 0 && <span style={{ marginLeft: "auto", background: "#f59e0b", color: "#000", borderRadius: 99, padding: "1px 6px", fontWeight: 700 }}>{pendingSync}</span>}
          </div>

          <nav style={S.nav}>
            {navItems.map(n => (
              <button key={n.id} style={{ ...S.navBtn, ...(tab === n.id ? S.navActive : {}) }} onClick={() => navTo(n.id)}>
                <span style={S.navIcon}>{n.icon}</span>
                <span>{n.label}</span>
                {n.id === "loans" && overdueCount > 0 && <span style={S.badge}>{overdueCount}</span>}
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
          <button style={{ ...S.sideBtn, color: "#22d3a0", borderColor: "#22d3a033" }} onClick={() => generateOfflineReport(borrowers, loans, payments, loanBalance, user)}>📄 Save Report</button>
          {isOnline && pendingSync > 0 && (
            <button style={{ ...S.sideBtn, color: "#f59e0b", borderColor: "#f59e0b33" }} onClick={syncQueue}>↑ Sync {pendingSync} pending</button>
          )}
          <button style={{ ...S.sideBtn, color: "#f43f5e88", borderColor: "#f43f5e33" }} onClick={handleLogout}>⏻ Sign Out</button>
        </div>
      </aside>

      <div style={S.mainArea}>
        <header style={S.header}>
          <div style={S.headerLeft}>
            <button style={S.menuBtn} onClick={() => setSideOpen(o => !o)}>{sideOpen && !isMobile ? "◀" : "☰"}</button>
            <h1 style={S.pageTitle}>
              {tab === "dashboard" ? "Dashboard" : tab === "loans" ? "Loans" : tab === "borrowers" ? "Borrowers" : tab === "payments" ? "Payment History" : "Credit Scores"}
            </h1>
          </div>
          <div style={S.headerRight}>
            {loading && <span style={{ fontSize: 11, color: "#64748b", fontStyle: "italic" }}>Loading…</span>}
            {!isOnline && <span style={{ fontSize: 11, color: "#f59e0b", background: "#f59e0b18", padding: "4px 10px", borderRadius: 99, border: "1px solid #f59e0b33" }}>📵 Offline</span>}
            <span style={S.dateBadge}>{new Date().toLocaleDateString("en-UG", { weekday: "short", day: "numeric", month: "short", year: "numeric" })}</span>
            {tab === "borrowers" && <button style={S.primaryBtn} onClick={() => setModal({ type: "borrower", data: null })}>+ Add Borrower</button>}
            {tab === "loans" && <button style={S.primaryBtn} onClick={() => setModal({ type: "loan", data: null })}>+ New Loan</button>}
            {tab === "payments" && <button style={S.primaryBtn} onClick={() => setModal({ type: "payment", data: null })}>+ Record Payment</button>}
          </div>
        </header>

        <main style={S.content}>
          {tab === "dashboard" && <Dashboard loans={loans} borrowers={borrowers} payments={payments} stats={dashStats} loanBalance={loanBalance} setTab={setTab} setModal={setModal} />}
          {tab === "loans" && <LoansTab loans={loans} borrowers={borrowers} payments={payments} loanBalance={loanBalance} onEdit={l => setModal({ type: "loan", data: l })} onDelete={deleteLoan} onPay={l => setModal({ type: "payment", data: { loanId: l.id, borrowerName: borrowers.find(b => b.id === l.borrower_id)?.name } })} onMarkPaid={markPaid} onPenalty={l => setModal({ type: "penalty", data: l })} />}
          {tab === "borrowers" && <BorrowersTab borrowers={borrowers} loans={loans} payments={payments} loanBalance={loanBalance} onEdit={b => setModal({ type: "borrower", data: b })} onDelete={deleteBorrower} onNewLoan={b => setModal({ type: "loan", data: { borrowerId: b.id } })} onPay={(b, l) => setModal({ type: "payment", data: { loanId: l.id, borrowerName: b.name } })} onViewPhotos={b => setModal({ type: "photos", data: b })} />}
          {tab === "payments" && <PaymentsTab payments={payments} loans={loans} borrowers={borrowers} />}
          {tab === "credit" && <CreditScoresTab borrowers={borrowers} loans={loans} payments={payments} />}
        </main>
      </div>

      {modal?.type === "borrower" && <BorrowerModal data={modal.data} onSave={saveBorrower} onClose={() => setModal(null)} />}
      {modal?.type === "loan" && <LoanModal data={modal.data} borrowers={borrowers} onSave={saveLoan} onClose={() => setModal(null)} />}
      {modal?.type === "payment" && <PaymentModal data={modal.data} loans={loans} borrowers={borrowers} loanBalance={loanBalance} onSave={savePayment} onClose={() => setModal(null)} />}
      {modal?.type === "penalty" && <PenaltyModal loan={modal.data} borrowers={borrowers} onAdd={addPenalty} onClose={() => setModal(null)} />}
      {modal?.type === "photos" && <PhotosModal borrower={modal.data} onClose={() => setModal(null)} />}
      {modal?.type === "credit_detail" && <CreditDetailModal borrower={modal.data} loans={loans} payments={payments} onClose={() => setModal(null)} />}

      {toast && <div style={{ ...S.toast, background: toast.type === "error" ? "#f43f5e" : toast.type === "info" ? "#6366f1" : "#22d3a0" }}>{toast.type === "error" ? "✕ " : "✓ "}{toast.msg}</div>}
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

  // Top credit scores
  const topScorers = borrowers
    .map(b => ({ b, sc: computeCreditScore(b.id, loans, payments) }))
    .filter(x => x.sc.score > 0)
    .sort((a, b) => b.sc.score - a.sc.score)
    .slice(0, 3);

  const cards = [
    { label: "Outstanding Balance", value: fmt(totalOutstanding), sub: `Active Balance: ${fmt(totalOutstanding - totalInterest)}`, grad: "linear-gradient(135deg,#6366f1,#8b5cf6)", icon: "◈" },
    { label: "Total Disbursed", value: fmt(s.totalLoaned ?? loans.reduce((a, l) => a + l.principal, 0)), sub: `${loans.length} total loans`, grad: "linear-gradient(135deg,#22d3a0,#06b6d4)", icon: "₿" },
    { label: "Active Borrowers", value: activeBorrowers, sub: `${borrowers.length} registered`, grad: "linear-gradient(135deg,#f59e0b,#f97316)", icon: "◉" },
    { label: "Total Collected", value: fmt(totalCollected), sub: `${payments.length} payments`, grad: "linear-gradient(135deg,#f43f5e,#e11d48)", icon: "◎" },
  ];
  const dueSoon = activeLoans.filter(l => { const d = (new Date(l.due_date) - new Date()) / 86400000; return d >= 0 && d <= 7; });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={S.statsGrid}>
        {cards.map((c, i) => (
          <div key={i} style={{ ...S.statCard, background: c.grad }}>
            <div style={S.statTop}><span style={S.statLabel}>{c.label}</span><span style={S.statIcon}>{c.icon}</span></div>
            <div style={S.statValue}>{c.value}</div>
            <div style={S.statSub}>{c.sub}</div>
          </div>
        ))}
      </div>

      <div style={S.dashRow}>
        <div style={S.glassCard}>
          <div style={S.cardHeader}><span style={S.cardTitle}>Payment Status</span><span style={S.cardBadge}>Overview</span></div>
          <div style={{ display: "flex", gap: 12, marginBottom: 12 }}>
            {[{ label: "Active", count: activeLoans.length, color: "#22d3a0" }, { label: "Overdue", count: overdueLoans.length, color: "#f43f5e" }, { label: "Paid", count: loans.filter(l => l.status === "Paid").length, color: "#6366f1" }].map(item => (
              <div key={item.label} style={{ flex: 1, background: item.color + "18", borderRadius: 10, padding: "12px 14px", border: `1px solid ${item.color}30` }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: item.color }}>{item.count}</div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{item.label}</div>
              </div>
            ))}
          </div>
        </div>

        <div style={S.glassCard}>
          <div style={S.cardHeader}><span style={S.cardTitle}>★ Top Credit Scores</span><button style={S.miniBtn} onClick={() => {}}>View All</button></div>
          {topScorers.length === 0
            ? <div style={S.emptyState}>No credit history yet</div>
            : topScorers.map(({ b, sc }) => (
              <div key={b.id} style={S.listRow}>
                <div style={{ ...S.rowAvatar, background: `linear-gradient(135deg,${sc.color},${sc.color}88)` }}>{b.name[0]}</div>
                <div style={{ flex: 1 }}>
                  <div style={S.rowName}>{b.name}</div>
                  <div style={S.rowSub}>{sc.label} · {sc.paidLoans} loans repaid</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 18, fontWeight: 900, color: sc.color }}>{sc.score}</div>
                  <div style={{ fontSize: 10, color: "#64748b" }}>{sc.grade}</div>
                </div>
              </div>
            ))}
        </div>
      </div>

      <div style={S.dashRow}>
        <div style={S.glassCard}>
          <div style={S.cardHeader}><span style={S.cardTitle}>⚠ Overdue Loans</span><button style={S.miniBtn} onClick={() => {}}>View All</button></div>
          {overdueLoans.length === 0
            ? <div style={S.emptyState}>🎉 No overdue loans</div>
            : overdueLoans.slice(0, 4).map(l => {
              const b = borrowers.find(x => x.id === l.borrower_id);
              const days = Math.floor((new Date() - new Date(l.due_date)) / 86400000);
              return (<div key={l.id} style={S.listRow}><div style={S.rowAvatar}>{(b?.name || "?")[0]}</div><div style={{ flex: 1 }}><div style={S.rowName}>{b?.name || "—"}</div><div style={S.rowSub}>{days}d overdue · {l.due_date}</div></div><div style={{ ...S.rowAmount, color: "#f43f5e" }}>{fmt(loanBalance(l))}</div></div>);
            })}
        </div>
        <div style={S.glassCard}>
          <div style={S.cardHeader}><span style={S.cardTitle}>💸 Recent Payments</span><button style={S.miniBtn} onClick={() => {}}>View All</button></div>
          {recentPayments.length === 0 ? <div style={S.emptyState}>No payments yet</div>
            : recentPayments.map(p => {
              const loan = loans.find(l => l.id === p.loan_id);
              const b = borrowers.find(x => x.id === loan?.borrower_id);
              return (<div key={p.id} style={S.listRow}><div style={{ ...S.rowAvatar, background: "linear-gradient(135deg,#22d3a0,#06b6d4)" }}>{(b?.name || "?")[0]}</div><div style={{ flex: 1 }}><div style={S.rowName}>{b?.name || "—"}</div><div style={S.rowSub}>{p.date} · {p.method}</div></div><div style={{ ...S.rowAmount, color: "#22d3a0" }}>{fmt(p.amount)}</div></div>);
            })}
        </div>
      </div>
    </div>
  );
}

// ─── Credit Scores Tab ────────────────────────────────────────────────────────
function CreditScoresTab({ borrowers, loans, payments }) {
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("score");

  const scored = borrowers
    .map(b => ({ b, sc: computeCreditScore(b.id, loans, payments) }))
    .filter(x => !search || x.b.name.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortBy === "score" ? b.sc.score - a.sc.score : a.b.name.localeCompare(b.b.name));

  const gradeColors = { "A+": "#22d3a0", A: "#06b6d4", B: "#6366f1", C: "#f59e0b", D: "#f97316", F: "#f43f5e", "N/A": "#475569" };

  const avgScore = scored.filter(x => x.sc.score > 0).reduce((s, x, _, a) => s + x.sc.score / a.length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Summary bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 12 }}>
        {[
          { label: "Average Score", value: avgScore > 0 ? Math.round(avgScore) : "N/A", color: "#6366f1" },
          { label: "Excellent (750+)", value: scored.filter(x => x.sc.score >= 750).length, color: "#22d3a0" },
          { label: "Good (650-749)", value: scored.filter(x => x.sc.score >= 650 && x.sc.score < 750).length, color: "#6366f1" },
          { label: "Poor (<500)", value: scored.filter(x => x.sc.score > 0 && x.sc.score < 500).length, color: "#f43f5e" },
        ].map(c => (
          <div key={c.label} style={{ background: "rgba(17,18,28,0.8)", border: "1px solid #1e2030", borderRadius: 12, padding: "14px 16px" }}>
            <div style={{ fontSize: 10, color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.8 }}>{c.label}</div>
            <div style={{ fontSize: 24, fontWeight: 900, color: c.color, marginTop: 4 }}>{c.value}</div>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <input style={{ ...S.searchInput, maxWidth: "none", flex: 1 }} placeholder="🔍 Search borrower..." value={search} onChange={e => setSearch(e.target.value)} />
        <select style={{ ...S.inp, width: "auto" }} value={sortBy} onChange={e => setSortBy(e.target.value)}>
          <option value="score">Sort by Score</option>
          <option value="name">Sort by Name</option>
        </select>
      </div>

      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead>
            <tr>{["Borrower", "Score", "Grade", "Status", "On-Time Payments", "Loans Repaid", "Total Paid", "Key Factors"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {scored.map(({ b, sc }) => (
              <tr key={b.id} className="trow">
                <td style={S.td}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ ...S.rowAvatar, width: 32, height: 32, fontSize: 13, flexShrink: 0, background: `linear-gradient(135deg,${gradeColors[sc.grade] || "#475569"},${gradeColors[sc.grade] || "#475569"}88)` }}>{b.name[0]}</div>
                    <div><div style={S.rowName}>{b.name}</div><div style={S.rowSub}>{b.phone}</div></div>
                  </div>
                </td>
                <td style={S.td}>
                  {sc.score > 0 ? (
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 80, height: 6, background: "#1e2030", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ width: `${((sc.score - 300) / 550) * 100}%`, height: "100%", background: sc.color, borderRadius: 99 }} />
                      </div>
                      <span style={{ fontSize: 16, fontWeight: 900, color: sc.color }}>{sc.score}</span>
                    </div>
                  ) : <span style={{ color: "#475569" }}>No history</span>}
                </td>
                <td style={S.td}><span style={{ ...S.statusPill, background: (gradeColors[sc.grade] || "#475569") + "22", color: gradeColors[sc.grade] || "#475569", border: `1px solid ${(gradeColors[sc.grade] || "#475569")}44`, fontSize: 14, fontWeight: 900 }}>{sc.grade}</span></td>
                <td style={S.td}><span style={{ fontSize: 12, color: sc.color || "#475569" }}>{sc.label}</span></td>
                <td style={S.td}>
                  {sc.score > 0 ? (
                    <div>
                      <span style={{ color: "#22d3a0", fontWeight: 700 }}>{sc.onTimeCount}</span>
                      <span style={{ color: "#475569" }}> / {sc.onTimeCount + sc.lateCount}</span>
                      {sc.onTimeCount + sc.lateCount > 0 && <span style={{ fontSize: 10, color: "#64748b", marginLeft: 4 }}>({Math.round(sc.onTimeCount / (sc.onTimeCount + sc.lateCount) * 100)}%)</span>}
                    </div>
                  ) : "—"}
                </td>
                <td style={S.td}><span style={{ fontWeight: 700, color: "#6366f1" }}>{sc.paidLoans}</span></td>
                <td style={S.td}><span style={{ fontWeight: 700, color: "#22d3a0" }}>{sc.score > 0 ? fmt(sc.totalPaid) : "—"}</span></td>
                <td style={S.td}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    {sc.factors.slice(0, 2).map((f, i) => (
                      <div key={i} style={{ fontSize: 10, color: f.positive ? "#22d3a0" : "#f43f5e", display: "flex", alignItems: "center", gap: 4 }}>
                        <span>{f.positive ? "✓" : "✗"}</span><span>{f.text}</span>
                      </div>
                    ))}
                  </div>
                </td>
              </tr>
            ))}
            {scored.length === 0 && <tr><td colSpan={8} style={S.emptyTd}>No borrowers found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Loans Tab ────────────────────────────────────────────────────────────────
function LoansTab({ loans, borrowers, payments, loanBalance, onEdit, onDelete, onPay, onMarkPaid, onPenalty }) {
  const [filter, setFilter] = useState("All");
  const [search, setSearch] = useState("");
  const statuses = ["All", "Active", "Overdue", "Paid", "Pending"];
  const filtered = loans.filter(l => {
    const b = borrowers.find(x => x.id === l.borrower_id);
    return (filter === "All" || l.status === filter) && (!search || b?.name?.toLowerCase().includes(search.toLowerCase()) || b?.id_no?.toLowerCase().includes(search.toLowerCase()));
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={S.toolbar}>
        <input style={S.searchInput} placeholder="🔍 Search borrower or ID..." value={search} onChange={e => setSearch(e.target.value)} />
        <div style={S.filterRow}>
          {statuses.map(st => <button key={st} style={{ ...S.filterBtn, ...(filter === st ? S.filterActive : {}) }} onClick={() => setFilter(st)}>{st}</button>)}
        </div>
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead><tr>{["Borrower", "Principal", "Interest", "Penalty", "Total Due", "Balance", "Start", "Due Date", "Status", "Credit", "Actions"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td colSpan={11} style={S.emptyTd}>No loans found</td></tr>
              : filtered.map(l => {
                const b = borrowers.find(x => x.id === l.borrower_id);
                const rate = l.interest_rate ?? l.interestRate ?? 0;
                const interest = l.principal * rate / 100;
                const penalty = parseFloat(l.penalty_amount || 0);
                const bal = loanBalance(l);
                const isOver = l.status === "Overdue";
                const daysOverdue = isOver ? Math.floor((new Date() - new Date(l.due_date)) / 86400000) : 0;
                const canPenalty = isOver && daysOverdue >= 30;
                const sc = computeCreditScore(l.borrower_id, loans, payments);
                return (
                  <tr key={l.id} className="trow">
                    <td style={S.td}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ ...S.rowAvatar, width: 30, height: 30, fontSize: 12, flexShrink: 0 }}>{(b?.name || "?")[0]}</div><div><div style={S.rowName}>{b?.name || "—"}</div><div style={S.rowSub}>ID: {b?.id_no || "N/A"}</div></div></div></td>
                    <td style={S.td}>{fmt(l.principal)}</td>
                    <td style={S.td}><span style={S.ratePill}>{rate}%</span></td>
                    <td style={S.td}>{penalty > 0 ? <span style={{ color: "#f43f5e", fontWeight: 700 }}>{fmt(penalty)}</span> : <span style={{ color: "#475569" }}>—</span>}</td>
                    <td style={S.td}>{fmt(l.principal + interest + penalty)}</td>
                    <td style={{ ...S.td, fontWeight: 700, color: bal === 0 ? "#22d3a0" : isOver ? "#f43f5e" : "#f59e0b" }}>{fmt(bal)}</td>
                    <td style={S.td}>{l.start_date}</td>
                    <td style={{ ...S.td, color: isOver ? "#f43f5e" : "inherit" }}>{l.due_date}{isOver && <div style={{ fontSize: 10, color: "#f43f5e" }}>{daysOverdue}d overdue</div>}</td>
                    <td style={S.td}><span style={{ ...S.statusPill, background: statusColor(l.status) + "22", color: statusColor(l.status), border: `1px solid ${statusColor(l.status)}44` }}>{l.status}</span></td>
                    <td style={S.td}>
                      {sc.score > 0 ? <span style={{ fontWeight: 800, color: sc.color, fontSize: 12 }}>{sc.score}<span style={{ fontSize: 9, marginLeft: 2, opacity: 0.8 }}>{sc.grade}</span></span> : <span style={{ color: "#475569", fontSize: 11 }}>N/A</span>}
                    </td>
                    <td style={S.td}>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        {l.status !== "Paid" && <button style={S.actBtn} onClick={() => onPay(l)} title="Record payment">💰</button>}
                        {l.status !== "Paid" && <button style={{ ...S.actBtn, color: "#22d3a0" }} onClick={() => onMarkPaid(l)} title="Mark fully paid">✓</button>}
                        {canPenalty && <button style={{ ...S.actBtn, color: "#f43f5e", borderColor: "#f43f5e44" }} onClick={() => onPenalty(l)} title="Add penalty">⚡</button>}
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
      <div style={{ fontSize: 11, color: "#475569", textAlign: "right" }}>⚡ = Add penalty (30+ days overdue)</div>
    </div>
  );
}

// ─── Borrowers Tab ────────────────────────────────────────────────────────────
function BorrowersTab({ borrowers, loans, payments, loanBalance, onEdit, onDelete, onNewLoan, onPay, onViewPhotos }) {
  const [search, setSearch] = useState("");
  const filtered = borrowers.filter(b => b.name?.toLowerCase().includes(search.toLowerCase()) || b.phone?.includes(search) || b.id_no?.toLowerCase().includes(search.toLowerCase()));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <input style={{ ...S.searchInput, maxWidth: "none" }} placeholder="🔍 Search by name, phone, or ID..." value={search} onChange={e => setSearch(e.target.value)} />
      <div style={S.borrowerGrid}>
        {filtered.map(b => {
          const bLoans = loans.filter(l => l.borrower_id === b.id);
          const activeLoans = bLoans.filter(l => l.status !== "Paid");
          const overdueLoans = bLoans.filter(l => l.status === "Overdue");
          const totalBalance = activeLoans.reduce((s, l) => s + loanBalance(l), 0);
          const bPayments = payments.filter(p => bLoans.some(l => l.id === p.loan_id));
          const totalPaid = bPayments.reduce((s, p) => s + p.amount, 0);
          const hasPhotos = b.passport_photo || b.id_photo;
          const sc = computeCreditScore(b.id, loans, payments);

          return (
            <div key={b.id} style={S.borrowerCard}>
              <div style={S.bCardTop}>
                <div style={{ ...S.bAvatar, background: sc.score > 0 ? `linear-gradient(135deg,${sc.color},${sc.color}88)` : "linear-gradient(135deg,#6366f1,#a855f7)" }}>{b.name[0].toUpperCase()}</div>
                <div style={{ flex: 1 }}>
                  <div style={S.bName}>{b.name}</div>
                  <div style={S.rowSub}>{b.phone}</div>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-end" }}>
                  {sc.score > 0 && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 15, fontWeight: 900, color: sc.color }}>{sc.score}</div>
                      <div style={{ fontSize: 9, color: "#64748b" }}>{sc.label}</div>
                    </div>
                  )}
                  {overdueLoans.length > 0 && <span style={{ ...S.statusPill, background: "#f43f5e22", color: "#f43f5e", border: "1px solid #f43f5e44", fontSize: 10 }}>{overdueLoans.length} Overdue</span>}
                  {hasPhotos && <span style={{ ...S.pill, background: "#22d3a022", color: "#22d3a0", fontSize: 10, cursor: "pointer" }} onClick={() => onViewPhotos(b)}>📷</span>}
                </div>
              </div>

              <div style={S.bInfoGrid}>
                <div style={S.bInfoItem}><span style={S.bInfoLabel}>ID Type</span><span style={S.bInfoVal}>{b.id_type || "—"}</span></div>
                <div style={S.bInfoItem}><span style={S.bInfoLabel}>ID Number</span><span style={S.bInfoVal}>{b.id_no || "—"}</span></div>
                <div style={S.bInfoItem}><span style={S.bInfoLabel}>Address</span><span style={S.bInfoVal}>{b.address || "—"}</span></div>
                <div style={S.bInfoItem}><span style={S.bInfoLabel}>Total Paid</span><span style={{ ...S.bInfoVal, color: "#22d3a0", fontWeight: 700 }}>{fmt(totalPaid)}</span></div>
              </div>

              <div style={S.bBalance}>
                <div><div style={{ fontSize: 10, color: "#64748b" }}>Outstanding Balance</div><div style={{ fontSize: 18, fontWeight: 800, color: totalBalance > 0 ? "#f43f5e" : "#22d3a0" }}>{fmt(totalBalance)}</div></div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ ...S.pill, background: "#6366f122", color: "#a5b4fc" }}>{bLoans.length} loans</span>
                  {activeLoans.length > 0 && <span style={{ ...S.pill, background: "#f59e0b22", color: "#f59e0b" }}>{activeLoans.length} active</span>}
                </div>
              </div>

              {activeLoans.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {activeLoans.slice(0, 2).map(l => (
                    <div key={l.id} style={S.loanMiniRow}>
                      <div style={{ fontSize: 11, color: "#94a3b8" }}>
                        <span style={{ ...S.statusPill, background: statusColor(l.status) + "22", color: statusColor(l.status), border: `1px solid ${statusColor(l.status)}33`, fontSize: 10, padding: "1px 6px" }}>{l.status}</span>
                        {" "}{fmt(l.principal)} · Bal: <strong style={{ color: "#f59e0b" }}>{fmt(loanBalance(l))}</strong>
                      </div>
                      {l.status !== "Paid" && <button style={{ ...S.miniBtn, background: "#6366f120", borderColor: "#6366f140", color: "#a5b4fc" }} onClick={() => onPay(b, l)}>Pay</button>}
                    </div>
                  ))}
                </div>
              )}

              <div style={S.bActions}>
                <button style={S.primaryBtn} onClick={() => onNewLoan(b)}>+ New Loan</button>
                <button style={S.ghostBtn} onClick={() => onEdit(b)}>Edit</button>
                {hasPhotos && <button style={{ ...S.ghostBtn, color: "#22d3a0", borderColor: "#22d3a033" }} onClick={() => onViewPhotos(b)}>📷</button>}
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
        <div style={{ ...S.glassChip, fontWeight: 700 }}>Total: <span style={{ color: "#22d3a0" }}>{fmt(filtered.reduce((s, p) => s + p.amount, 0))}</span></div>
      </div>
      <div style={S.tableWrap}>
        <table style={S.table}>
          <thead><tr>{["Date", "Borrower", "ID Number", "Loan Purpose", "Loan Amount", "Payment", "Method", "Timing"].map(h => <th key={h} style={S.th}>{h}</th>)}</tr></thead>
          <tbody>
            {filtered.length === 0 ? <tr><td colSpan={8} style={S.emptyTd}>No payments recorded</td></tr>
              : filtered.map(p => {
                const loan = loans.find(l => l.id === p.loan_id);
                const b = borrowers.find(x => x.id === loan?.borrower_id);
                const isOnTime = loan && new Date(p.date) <= new Date(loan.due_date);
                return (<tr key={p.id} className="trow">
                  <td style={S.td}>{p.date}</td>
                  <td style={S.td}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><div style={{ ...S.rowAvatar, width: 28, height: 28, fontSize: 11, flexShrink: 0 }}>{(b?.name || "?")[0]}</div><span style={S.rowName}>{b?.name || "—"}</span></div></td>
                  <td style={S.td}><span style={S.glassChip}>{b?.id_no || "—"}</span></td>
                  <td style={S.td}>{loan?.notes || "General"}</td>
                  <td style={S.td}>{fmt(loan?.principal)}</td>
                  <td style={{ ...S.td, fontWeight: 700, color: "#22d3a0" }}>{fmt(p.amount)}</td>
                  <td style={S.td}><span style={{ ...S.pill, background: "#6366f122", color: "#a5b4fc" }}>{p.method}</span></td>
                  <td style={S.td}><span style={{ ...S.statusPill, background: isOnTime ? "#22d3a022" : "#f43f5e22", color: isOnTime ? "#22d3a0" : "#f43f5e", border: `1px solid ${isOnTime ? "#22d3a033" : "#f43f5e33"}` }}>{isOnTime ? "On-Time" : "Late"}</span></td>
                </tr>);
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
        <div style={S.modalHead}><h2 style={S.modalTitle}>{title}</h2><button style={S.closeBtn} onClick={onClose}>✕</button></div>
        {children}
      </div>
    </div>
  );
}

function Fld({ label, children }) {
  return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}><label style={S.lbl}>{label}</label>{children}</div>;
}

// ─── Borrower Modal with Aggressive Photo Compression ─────────────────────────
function BorrowerModal({ data, onSave, onClose }) {
  const ugIdTypes = ["National ID (NIN)", "Passport", "Driver's License", "Voter's Card", "NSSF Card", "LC Letter", "Other"];
  const [form, setForm] = useState(data ? { ...data, id_type: data.id_type || "National ID (NIN)" } : { name: "", phone: "", address: "", id_type: "National ID (NIN)", id_no: "", passport_photo: null, id_photo: null });
  const [uploading, setUploading] = useState(false);
  const [photoSizes, setPhotoSizes] = useState({});
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  const handlePhoto = async (key, e) => {
    const file = e.target.files[0];
    if (!file) return;
    setUploading(true);
    try {
      // Compress: target 50KB max, 800px wide
      const { dataUrl, sizeKB } = await compressImage(file, 50, 800);
      setForm(f => ({ ...f, [key]: dataUrl }));
      setPhotoSizes(ps => ({ ...ps, [key]: sizeKB }));
    } catch { alert("Failed to process photo"); }
    finally { setUploading(false); }
  };

  const removePhoto = (key) => { setForm(f => ({ ...f, [key]: null })); setPhotoSizes(ps => ({ ...ps, [key]: 0 })); };

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
          <Fld label="ID Type *"><select style={S.inp} value={form.id_type} onChange={set("id_type")}>{ugIdTypes.map(t => <option key={t}>{t}</option>)}</select></Fld>
          <Fld label="ID Number *"><input style={{ ...S.inp, fontFamily: "monospace", letterSpacing: 1 }} value={form.id_no || ""} onChange={set("id_no")} placeholder="e.g. CM90100012345X" /></Fld>
        </div>

        <div style={{ background: "#0d0e18", border: "1px solid #2d3148", borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8 }}>📷 Borrower Photos</div>
            <div style={{ fontSize: 10, color: "#64748b" }}>Auto-compressed to save storage</div>
          </div>

          {["passport_photo", "id_photo"].map(key => (
            <div key={key} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <label style={S.lbl}>{key === "passport_photo" ? "Passport Photo" : "ID Card / Document Photo"}</label>
              {form[key] ? (
                <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                  <img src={form[key]} alt={key} style={{ width: key === "passport_photo" ? 64 : 80, height: key === "passport_photo" ? 64 : 52, objectFit: "cover", borderRadius: 8, border: "2px solid #22d3a044" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {photoSizes[key] > 0 && <div style={{ fontSize: 10, color: "#22d3a0" }}>✓ {photoSizes[key]}KB compressed</div>}
                    <button style={S.miniBtn} onClick={() => downloadBase64(form[key], `${form.name || "borrower"}_${key}.jpg`)}>⬇ Download</button>
                    <button style={{ ...S.miniBtn, color: "#f43f5e", borderColor: "#f43f5e44" }} onClick={() => removePhoto(key)}>Remove</button>
                  </div>
                </div>
              ) : (
                <label style={{ ...S.ghostBtn, textAlign: "center", cursor: "pointer", display: "block" }}>
                  {key === "passport_photo" ? "📷 Upload Passport Photo (auto-compressed)" : "🪪 Upload ID Photo (auto-compressed)"}
                  <input type="file" accept="image/*" style={{ display: "none" }} onChange={e => handlePhoto(key, e)} />
                </label>
              )}
            </div>
          ))}
          {uploading && <div style={{ fontSize: 12, color: "#f59e0b" }}>⏳ Compressing photo to save storage…</div>}
        </div>
      </div>
      <div style={S.modalFoot}>
        <button style={S.ghostBtn} onClick={onClose}>Cancel</button>
        <button style={S.primaryBtn} onClick={submit} disabled={uploading}>{uploading ? "Compressing…" : data ? "Update Borrower" : "Add Borrower"}</button>
      </div>
    </Modal>
  );
}

// ─── Photos Viewer Modal ──────────────────────────────────────────────────────
function PhotosModal({ borrower, onClose }) {
  return (
    <Modal title={`${borrower.name} — Photos`} onClose={onClose}>
      <div style={{ ...S.modalBody, gap: 20 }}>
        {!borrower.passport_photo && !borrower.id_photo && <div style={S.emptyState}>No photos uploaded.</div>}
        {borrower.passport_photo && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={S.lbl}>Passport Photo</div>
            <img src={borrower.passport_photo} alt="Passport" style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 10, border: "1px solid #2d3148", background: "#0d0e18" }} />
            <button style={S.ghostBtn} onClick={() => downloadBase64(borrower.passport_photo, `${borrower.name}_passport.jpg`)}>⬇ Download</button>
          </div>
        )}
        {borrower.id_photo && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={S.lbl}>ID / Document Photo</div>
            <img src={borrower.id_photo} alt="ID" style={{ width: "100%", maxHeight: 260, objectFit: "contain", borderRadius: 10, border: "1px solid #2d3148", background: "#0d0e18" }} />
            <button style={S.ghostBtn} onClick={() => downloadBase64(borrower.id_photo, `${borrower.name}_id.jpg`)}>⬇ Download</button>
          </div>
        )}
        {borrower.passport_photo && borrower.id_photo && (
          <button style={S.primaryBtn} onClick={() => { downloadBase64(borrower.passport_photo, `${borrower.name}_passport.jpg`); setTimeout(() => downloadBase64(borrower.id_photo, `${borrower.name}_id.jpg`), 300); }}>⬇ Download Both</button>
        )}
      </div>
      <div style={S.modalFoot}><button style={S.ghostBtn} onClick={onClose}>Close</button></div>
    </Modal>
  );
}

// ─── Credit Detail Modal ──────────────────────────────────────────────────────
function CreditDetailModal({ borrower, loans, payments, onClose }) {
  const sc = computeCreditScore(borrower.id, loans, payments);
  const gradeColor = sc.color || "#475569";
  const scorePercent = sc.score > 0 ? ((sc.score - 300) / 550) * 100 : 0;

  return (
    <Modal title={`Credit Score — ${borrower.name}`} onClose={onClose}>
      <div style={S.modalBody}>
        <div style={{ textAlign: "center", padding: "20px 0" }}>
          <div style={{ fontSize: 60, fontWeight: 900, color: gradeColor, lineHeight: 1 }}>{sc.score > 0 ? sc.score : "N/A"}</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: gradeColor, marginTop: 4 }}>{sc.grade} — {sc.label}</div>
          <div style={{ margin: "16px auto", maxWidth: 280 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "#64748b", marginBottom: 4 }}>
              <span>300</span><span>580</span><span>650</span><span>750</span><span>850</span>
            </div>
            <div style={{ height: 12, background: "#1e2030", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ width: `${scorePercent}%`, height: "100%", background: `linear-gradient(90deg,#f43f5e,#f59e0b,#22d3a0)`, borderRadius: 99, transition: "width 1s ease" }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: "#475569", marginTop: 3 }}>
              <span>Poor</span><span>Fair</span><span>Good</span><span>Excellent</span>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
          {[{ label: "On-Time Payments", value: `${sc.onTimeCount}/${sc.onTimeCount + sc.lateCount}` }, { label: "Loans Repaid", value: sc.paidLoans }, { label: "Total Paid", value: fmt(sc.totalPaid) }].map(s => (
            <div key={s.label} style={{ background: "#111218", borderRadius: 10, padding: "12px 14px", textAlign: "center", border: "1px solid #1e2030" }}>
              <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 }}>{s.label}</div>
              <div style={{ fontSize: 16, fontWeight: 800, color: "#e2e8f0", marginTop: 4 }}>{s.value}</div>
            </div>
          ))}
        </div>

        <div style={{ background: "#111218", borderRadius: 10, padding: 14, border: "1px solid #1e2030" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#94a3b8", marginBottom: 10, textTransform: "uppercase", letterSpacing: 0.8 }}>Score Factors</div>
          {sc.factors.length === 0 ? <div style={{ color: "#475569", fontSize: 12 }}>No factors available yet</div>
            : sc.factors.map((f, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: i < sc.factors.length - 1 ? "1px solid #1e2030" : "none" }}>
                <span style={{ fontSize: 14, color: f.positive ? "#22d3a0" : "#f43f5e" }}>{f.positive ? "✓" : "✗"}</span>
                <span style={{ fontSize: 12, color: f.positive ? "#94a3b8" : "#f43f5e88" }}>{f.text}</span>
                {f.positive && <span style={{ marginLeft: "auto", fontSize: 10, color: "#22d3a044", background: "#22d3a018", padding: "2px 6px", borderRadius: 99 }}>+</span>}
              </div>
            ))}
        </div>
      </div>
      <div style={S.modalFoot}><button style={S.ghostBtn} onClick={onClose}>Close</button></div>
    </Modal>
  );
}

// ─── Loan Modal ───────────────────────────────────────────────────────────────
function LoanModal({ data, borrowers, onSave, onClose }) {
  const init = data ? { borrowerId: data.borrower_id || data.borrowerId || "", principal: data.principal || "", interestRate: data.interest_rate ?? data.interestRate ?? 10, termDays: data.term_days ?? data.termDays ?? 30, startDate: data.start_date || data.startDate || today(), notes: data.notes || "", id: data.id } : { borrowerId: data?.borrowerId || "", principal: "", interestRate: 10, termDays: 30, startDate: today(), notes: "" };
  const [form, setForm] = useState(init);
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const interest = (parseFloat(form.principal) * parseFloat(form.interestRate) / 100) || 0;
  const total = (parseFloat(form.principal) || 0) + interest;
  const submit = () => { if (!form.borrowerId || !form.principal) return alert("Borrower and principal required"); onSave({ ...form, principal: parseFloat(form.principal), interestRate: parseFloat(form.interestRate), termDays: parseInt(form.termDays) }); };

  return (
    <Modal title={data?.id ? "Edit Loan" : "Create New Loan"} onClose={onClose}>
      <div style={S.modalBody}>
        <Fld label="Borrower *"><select style={S.inp} value={form.borrowerId} onChange={set("borrowerId")}><option value="">— Select Borrower —</option>{borrowers.map(b => <option key={b.id} value={b.id}>{b.name} (ID: {b.id_no || "N/A"})</option>)}</select></Fld>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Fld label="Principal Amount (UGX) *"><input style={S.inp} type="number" value={form.principal} onChange={set("principal")} placeholder="0" /></Fld>
          <Fld label="Interest Rate (%)"><input style={S.inp} type="number" value={form.interestRate} onChange={set("interestRate")} min="0" max="100" /></Fld>
          <Fld label="Term (Days)"><input style={S.inp} type="number" value={form.termDays} onChange={set("termDays")} min="1" /></Fld>
          <Fld label="Start Date"><input style={S.inp} type="date" value={form.startDate} onChange={set("startDate")} /></Fld>
        </div>
        <Fld label="Purpose / Notes"><textarea style={{ ...S.inp, height: 60, resize: "vertical" }} value={form.notes} onChange={set("notes")} placeholder="e.g. Home Repair, Education, Business..." /></Fld>
        <div style={S.loanSummary}>
          {[{ label: "Principal", val: fmt(form.principal || 0), color: "#e2e8f0" }, { label: `Interest (${form.interestRate}%)`, val: fmt(interest), color: "#f59e0b" }, { label: "Total Due", val: fmt(total), color: "#6366f1", big: true }, { label: "Due Date", val: addDays(form.startDate, parseInt(form.termDays) || 0), color: "#22d3a0" }].map(row => (
            <div key={row.label} style={S.sumRow}><span style={{ color: "#64748b" }}>{row.label}</span><strong style={{ color: row.color, fontSize: row.big ? 18 : 14 }}>{row.val}</strong></div>
          ))}
        </div>
      </div>
      <div style={S.modalFoot}><button style={S.ghostBtn} onClick={onClose}>Cancel</button><button style={S.primaryBtn} onClick={submit}>{data?.id ? "Update Loan" : "Create Loan"}</button></div>
    </Modal>
  );
}

// ─── Penalty Modal ────────────────────────────────────────────────────────────
function PenaltyModal({ loan, borrowers, onAdd, onClose }) {
  const b = borrowers.find(x => x.id === loan.borrower_id);
  const daysOverdue = Math.floor((new Date() - new Date(loan.due_date)) / 86400000);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState(`Late charge — ${daysOverdue} days overdue`);
  const submit = () => { if (!amount || parseFloat(amount) <= 0) return alert("Enter a positive penalty amount"); onAdd(loan.id, parseFloat(amount), note); };

  return (
    <Modal title="⚡ Add Penalty Charge" onClose={onClose}>
      <div style={S.modalBody}>
        <div style={{ background: "#f43f5e11", border: "1px solid #f43f5e33", borderRadius: 10, padding: "12px 16px" }}>
          <div style={{ fontWeight: 700, color: "#f43f5e", marginBottom: 4 }}>⚠ Overdue Loan</div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>Borrower: <strong style={{ color: "#e2e8f0" }}>{b?.name}</strong><br />Due date: {loan.due_date} · <strong style={{ color: "#f43f5e" }}>{daysOverdue} days overdue</strong></div>
        </div>
        <Fld label="Penalty Amount (UGX) *"><input style={S.inp} type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="e.g. 50000" min="0" /></Fld>
        <Fld label="Reason"><input style={S.inp} value={note} onChange={e => setNote(e.target.value)} /></Fld>
      </div>
      <div style={S.modalFoot}><button style={S.ghostBtn} onClick={onClose}>Cancel</button><button style={{ ...S.primaryBtn, background: "linear-gradient(135deg,#f43f5e,#e11d48)" }} onClick={submit}>Add Penalty</button></div>
    </Modal>
  );
}

// ─── Payment Modal ────────────────────────────────────────────────────────────
function PaymentModal({ data, loans, borrowers, loanBalance, onSave, onClose }) {
  const activeLoans = loans.filter(l => l.status !== "Paid");
  const [form, setForm] = useState({ loanId: data?.loanId || "", amount: "", date: today(), method: "Cash", note: "" });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));
  const selectedLoan = loans.find(l => l.id === form.loanId);
  const selectedBorrower = borrowers.find(b => b.id === selectedLoan?.borrower_id);
  const bal = selectedLoan ? loanBalance(selectedLoan) : 0;
  const penalty = selectedLoan ? parseFloat(selectedLoan.penalty_amount || 0) : 0;
  const submit = () => { if (!form.loanId || !form.amount) return alert("Loan and amount required"); if (parseFloat(form.amount) <= 0) return alert("Amount must be > 0"); if (parseFloat(form.amount) > bal) return alert(`Amount exceeds balance of ${fmt(bal)}`); onSave({ ...form, amount: parseFloat(form.amount), borrowerName: selectedBorrower?.name }); };

  return (
    <Modal title="Record Payment" onClose={onClose}>
      <div style={S.modalBody}>
        <Fld label="Select Loan *">
          <select style={S.inp} value={form.loanId} onChange={set("loanId")}>
            <option value="">— Select Borrower's Loan —</option>
            {activeLoans.map(l => { const b = borrowers.find(x => x.id === l.borrower_id); return <option key={l.id} value={l.id}>{b?.name} (ID: {b?.id_no || "N/A"}) · Principal: {fmt(l.principal)} · Balance: {fmt(loanBalance(l))}</option>; })}
          </select>
        </Fld>
        {selectedLoan && selectedBorrower && (
          <div style={S.payBorrowerCard}>
            <div style={S.bAvatar}>{selectedBorrower.name[0]}</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: "#e2e8f0" }}>{selectedBorrower.name}</div>
              <div style={{ fontSize: 11, color: "#64748b" }}>ID: {selectedBorrower.id_no || "N/A"} · {selectedBorrower.phone}</div>
              <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>Loan: <strong>{fmt(selectedLoan.principal)}</strong>{penalty > 0 && <> · Penalty: <strong style={{ color: "#f43f5e" }}>{fmt(penalty)}</strong></>} · Outstanding: <strong style={{ color: "#f43f5e" }}>{fmt(bal)}</strong></div>
            </div>
          </div>
        )}
        {selectedLoan && <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={{ fontSize: 12, color: "#94a3b8" }}>Outstanding:</span><strong style={{ color: "#f43f5e" }}>{fmt(bal)}</strong><button style={{ ...S.pill, cursor: "pointer", background: "#6366f122", color: "#a5b4fc", border: "1px solid #6366f133" }} onClick={() => setForm(f => ({ ...f, amount: bal.toFixed(0) }))}>Pay Full Balance</button></div>}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <Fld label="Payment Amount (UGX) *"><input style={S.inp} type="number" value={form.amount} onChange={set("amount")} placeholder="0" /></Fld>
          <Fld label="Payment Date"><input style={S.inp} type="date" value={form.date} onChange={set("date")} /></Fld>
        </div>
        <Fld label="Payment Method"><select style={S.inp} value={form.method} onChange={set("method")}>{["Cash", "Mobile Money (MTN)", "Mobile Money (Airtel)", "Bank Transfer", "Cheque", "Other"].map(m => <option key={m}>{m}</option>)}</select></Fld>
        <Fld label="Note (optional)"><input style={S.inp} value={form.note} onChange={set("note")} placeholder="e.g. Partial payment for October" /></Fld>
        {form.amount && selectedLoan && (
          <div style={S.loanSummary}>
            <div style={S.sumRow}><span style={{ color: "#64748b" }}>Payment Amount</span><strong style={{ color: "#22d3a0" }}>{fmt(form.amount)}</strong></div>
            <div style={S.sumRow}><span style={{ color: "#64748b" }}>Remaining After Payment</span><strong style={{ color: "#f59e0b" }}>{fmt(Math.max(0, bal - parseFloat(form.amount || 0)))}</strong></div>
            {parseFloat(form.amount) >= bal && <div style={{ fontSize: 12, color: "#22d3a0", textAlign: "center" }}>🎉 This will fully clear the loan!</div>}
          </div>
        )}
      </div>
      <div style={S.modalFoot}><button style={S.ghostBtn} onClick={onClose}>Cancel</button><button style={S.primaryBtn} onClick={submit}>Record Payment</button></div>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const S = {
  root: { display: "flex", height: "100vh", background: "#0a0b12", color: "#e2e8f0", fontFamily: "'Sora', 'DM Sans', sans-serif", overflow: "hidden", position: "relative" },
  authWrap: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#0a0b12", fontFamily: "'Sora','DM Sans',sans-serif", padding: 16, position: "relative" },
  authBg: { position: "fixed", inset: 0, background: "radial-gradient(ellipse 80% 60% at 50% -20%, #6366f130, transparent), radial-gradient(ellipse 60% 50% at 80% 80%, #22d3a015, transparent)", pointerEvents: "none" },
  authCard: { background: "rgba(17,18,28,0.95)", border: "1px solid #2d3148", borderRadius: 20, padding: 36, width: "100%", maxWidth: 460, display: "flex", flexDirection: "column", gap: 16, backdropFilter: "blur(20px)", boxShadow: "0 32px 80px rgba(0,0,0,0.6)", position: "relative", zIndex: 1 },
  authLogo: { display: "flex", alignItems: "center", gap: 14, marginBottom: 4 },
  authTitle: { fontSize: 20, fontWeight: 800, color: "#fff", letterSpacing: -0.5 },
  authSub: { fontSize: 11, color: "#64748b" },
  tabRow: { display: "flex", background: "#111218", borderRadius: 10, padding: 4, gap: 4 },
  tabBtn: { flex: 1, padding: "8px 0", border: "none", borderRadius: 8, background: "transparent", color: "#64748b", cursor: "pointer", fontFamily: "inherit", fontSize: 13, fontWeight: 600 },
  tabActive: { background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff" },
  inp: { padding: "10px 13px", background: "#0d0e18", border: "1px solid #2d3148", borderRadius: 9, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit", outline: "none", width: "100%", boxSizing: "border-box", transition: "border-color 0.2s" },
  lbl: { fontSize: 11, fontWeight: 600, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 },
  errorBox: { background: "#f43f5e18", border: "1px solid #f43f5e44", borderRadius: 9, padding: "10px 14px", color: "#f43f5e", fontSize: 13 },
  successBox: { background: "#22d3a018", border: "1px solid #22d3a044", borderRadius: 9, padding: "10px 14px", color: "#22d3a0", fontSize: 13 },
  fieldRow: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 },
  linkBtn: { background: "transparent", border: "none", color: "#6366f1", cursor: "pointer", fontSize: 12, fontFamily: "inherit", textDecoration: "underline", padding: 0 },
  sidebar: { width: 230, background: "rgba(13,14,22,0.98)", borderRight: "1px solid #1e2030", display: "flex", flexDirection: "column", flexShrink: 0, transition: "transform 0.3s ease", overflow: "hidden", zIndex: 50 },
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
  statsGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 },
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
