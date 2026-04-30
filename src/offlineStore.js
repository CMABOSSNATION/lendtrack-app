// src/offlineStore.js – IndexedDB offline-first store with credit scores & offline auth

const DB_NAME = "lendtrack_offline";
const DB_VERSION = 2;
let db = null;

function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains("borrowers")) d.createObjectStore("borrowers", { keyPath: "id" });
      if (!d.objectStoreNames.contains("loans")) d.createObjectStore("loans", { keyPath: "id" });
      if (!d.objectStoreNames.contains("payments")) d.createObjectStore("payments", { keyPath: "id" });
      if (!d.objectStoreNames.contains("queue")) d.createObjectStore("queue", { keyPath: "qid", autoIncrement: true });
      if (!d.objectStoreNames.contains("auth")) d.createObjectStore("auth", { keyPath: "email" });
      if (!d.objectStoreNames.contains("credit_scores")) d.createObjectStore("credit_scores", { keyPath: "borrower_id" });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

async function getAll(store) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const req = d.transaction(store, "readonly").objectStore(store).getAll();
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function getOne(store, key) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const req = d.transaction(store, "readonly").objectStore(store).get(key);
    req.onsuccess = () => res(req.result || null);
    req.onerror = () => rej(req.error);
  });
}

async function putAll(store, items) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, "readwrite");
    const s = tx.objectStore(store);
    items.forEach(i => s.put(i));
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function putOne(store, item) { return putAll(store, [item]); }

async function deleteOne(store, id) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).delete(id);
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

async function clearStore(store) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const tx = d.transaction(store, "readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}

// ── Data cache ────────────────────────────────────────────────────────────────
export async function cacheData({ borrowers, loans, payments }) {
  if (borrowers) await putAll("borrowers", borrowers);
  if (loans) await putAll("loans", loans);
  if (payments) await putAll("payments", payments);
}

export async function getOfflineData() {
  const [borrowers, loans, payments] = await Promise.all([getAll("borrowers"), getAll("loans"), getAll("payments")]);
  return { borrowers, loans, payments };
}

// ── Offline Auth ──────────────────────────────────────────────────────────────
async function sha256(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function cacheAuthCredentials(user, token, password) {
  const passwordHash = await sha256(password);
  await putOne("auth", { email: user.email, passwordHash, user, token, cachedAt: Date.now() });
}

export async function tryOfflineLogin(email, password) {
  const record = await getOne("auth", email);
  if (!record) return null;
  const hash = await sha256(password);
  if (hash !== record.passwordHash) return null;
  return { user: record.user, token: record.token, offline: true };
}

// ── Queue ─────────────────────────────────────────────────────────────────────
export async function enqueue(operation) {
  const d = await openDB();
  return new Promise((res, rej) => {
    const req = d.transaction("queue", "readwrite").objectStore("queue").add({ ...operation, createdAt: Date.now() });
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}
export async function getQueue() { return getAll("queue"); }
export async function removeFromQueue(qid) { await deleteOne("queue", qid); }
export async function clearQueue() { return clearStore("queue"); }

// ── Credit Score Engine ───────────────────────────────────────────────────────
export function computeCreditScore(borrowerId, loans, payments) {
  const bLoans = loans.filter(l => l.borrower_id === borrowerId);
  if (bLoans.length === 0) return { score: 0, grade: "N/A", label: "No History", factors: [], totalPaid: 0 };

  let score = 500;
  const factors = [];

  const paidLoans = bLoans.filter(l => l.status === "Paid");
  const overdueLoans = bLoans.filter(l => l.status === "Overdue");
  const loanIds = bLoans.map(l => l.id);
  const bPayments = payments.filter(p => loanIds.includes(p.loan_id));

  // Payment timing (35%)
  let onTimeCount = 0, lateCount = 0;
  bPayments.forEach(p => {
    const loan = bLoans.find(l => l.id === p.loan_id);
    if (!loan) return;
    if (new Date(p.date) <= new Date(loan.due_date)) onTimeCount++;
    else lateCount++;
  });
  const totalPay = onTimeCount + lateCount;
  if (totalPay > 0) {
    const ratio = onTimeCount / totalPay;
    score += Math.round(ratio * 150 - 50);
    if (ratio >= 0.9) factors.push({ text: "Excellent payment timing (90%+ on-time)", positive: true });
    else if (ratio >= 0.7) factors.push({ text: "Good payment timing", positive: true });
    else factors.push({ text: "Frequent late payments", positive: false });
  }

  // Completion (30%)
  if (bLoans.length > 0) score += Math.round((paidLoans.length / bLoans.length) * 120 - 20);
  if (paidLoans.length >= 3) factors.push({ text: `${paidLoans.length} loans fully repaid`, positive: true });
  else if (paidLoans.length >= 1) factors.push({ text: `${paidLoans.length} loan repaid`, positive: true });

  // Overdue penalty
  if (overdueLoans.length > 0) {
    score -= overdueLoans.length * 15;
    factors.push({ text: `${overdueLoans.length} overdue loan(s)`, positive: false });
  }

  // Volume bonus
  const totalPaid = bPayments.reduce((s, p) => s + p.amount, 0);
  if (totalPaid >= 5000000) { score += 40; factors.push({ text: "High repayment volume (5M+ UGX)", positive: true }); }
  else if (totalPaid >= 1000000) { score += 20; factors.push({ text: "Good repayment volume (1M+ UGX)", positive: true }); }

  // Account age
  const oldest = bLoans.reduce((min, l) => l.created_at < min ? l.created_at : min, bLoans[0].created_at);
  const ageDays = (Date.now() - new Date(oldest).getTime()) / 86400000;
  if (ageDays > 365) { score += 30; factors.push({ text: "Long credit history (1+ year)", positive: true }); }
  else if (ageDays > 90) { score += 15; factors.push({ text: "Established credit history", positive: true }); }

  // No penalties
  const penaltyTotal = bLoans.reduce((s, l) => s + parseFloat(l.penalty_amount || 0), 0);
  if (penaltyTotal === 0 && bLoans.length >= 2) {
    score += 25; factors.push({ text: "Zero penalty charges", positive: true });
  } else if (penaltyTotal > 0) {
    score -= 20; factors.push({ text: "Has penalty charges", positive: false });
  }

  score = Math.max(300, Math.min(850, score));

  let grade, label, color;
  if (score >= 750) { grade = "A+"; label = "Excellent"; color = "#22d3a0"; }
  else if (score >= 700) { grade = "A"; label = "Very Good"; color = "#06b6d4"; }
  else if (score >= 650) { grade = "B"; label = "Good"; color = "#6366f1"; }
  else if (score >= 580) { grade = "C"; label = "Fair"; color = "#f59e0b"; }
  else if (score >= 500) { grade = "D"; label = "Poor"; color = "#f97316"; }
  else { grade = "F"; label = "Very Poor"; color = "#f43f5e"; }

  return { score, grade, label, color, factors, onTimeCount, lateCount, paidLoans: paidLoans.length, totalPaid };
}

export async function saveCreditScore(borrowerId, scoreData) {
  await putOne("credit_scores", { borrower_id: borrowerId, ...scoreData, updatedAt: Date.now() });
}
export async function getCreditScore(borrowerId) { return getOne("credit_scores", borrowerId); }
export async function getAllCreditScores() { return getAll("credit_scores"); }

// ── Local mutations ───────────────────────────────────────────────────────────
const uid = () => "tmp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const todayStr = () => new Date().toISOString().split("T")[0];

export async function localAddBorrower(data) {
  const item = { ...data, id: uid(), created_at: todayStr() };
  await putAll("borrowers", [item]);
  return item;
}
export async function localUpdateBorrower(id, data) {
  const all = await getAll("borrowers");
  const updated = all.map(b => b.id === id ? { ...b, ...data } : b);
  await putAll("borrowers", updated);
  return updated.find(b => b.id === id);
}
export async function localDeleteBorrower(id) {
  await deleteOne("borrowers", id);
  const loans = await getAll("loans");
  const loanIds = loans.filter(l => l.borrower_id === id).map(l => l.id);
  for (const lid of loanIds) await deleteOne("loans", lid);
  const payments = await getAll("payments");
  for (const p of payments.filter(p => loanIds.includes(p.loan_id))) await deleteOne("payments", p.id);
}
export async function localAddLoan(data) {
  const item = { ...data, id: uid(), status: "Active", created_at: todayStr() };
  await putAll("loans", [item]);
  return item;
}
export async function localUpdateLoan(id, data) {
  const all = await getAll("loans");
  const updated = all.map(l => l.id === id ? { ...l, ...data } : l);
  await putAll("loans", updated);
  return updated.find(l => l.id === id);
}
export async function localDeleteLoan(id) {
  await deleteOne("loans", id);
  const payments = await getAll("payments");
  for (const p of payments.filter(p => p.loan_id === id)) await deleteOne("payments", p.id);
}
export async function localAddPayment(data) {
  const item = { ...data, id: uid(), created_at: todayStr() };
  await putAll("payments", [item]);
  return item;
}
