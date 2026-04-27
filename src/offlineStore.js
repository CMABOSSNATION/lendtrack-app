// src/offlineStore.js
// IndexedDB wrapper for offline-first data storage and sync queue

const DB_NAME = "lendtrack_offline";
const DB_VERSION = 1;

let db = null;

function openDB() {
  if (db) return Promise.resolve(db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      // Data stores
      if (!d.objectStoreNames.contains("borrowers"))
        d.createObjectStore("borrowers", { keyPath: "id" });
      if (!d.objectStoreNames.contains("loans"))
        d.createObjectStore("loans", { keyPath: "id" });
      if (!d.objectStoreNames.contains("payments"))
        d.createObjectStore("payments", { keyPath: "id" });
      // Offline mutation queue
      if (!d.objectStoreNames.contains("queue"))
        d.createObjectStore("queue", { keyPath: "qid", autoIncrement: true });
    };
    req.onsuccess = (e) => { db = e.target.result; resolve(db); };
    req.onerror = () => reject(req.error);
  });
}

// ── Generic helpers ───────────────────────────────────────────────────────────
async function getAll(storeName) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, "readonly");
    const req = tx.objectStore(storeName).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function putAll(storeName, items) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, "readwrite");
    const store = tx.objectStore(storeName);
    items.forEach((item) => store.put(item));
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteOne(storeName, id) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, "readwrite");
    tx.objectStore(storeName).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

async function clearStore(storeName) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(storeName, "readwrite");
    tx.objectStore(storeName).clear();
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

// ── Cache sync: save fresh API data to IDB ────────────────────────────────────
export async function cacheData({ borrowers, loans, payments }) {
  if (borrowers) await putAll("borrowers", borrowers);
  if (loans) await putAll("loans", loans);
  if (payments) await putAll("payments", payments);
}

// ── Read offline data ─────────────────────────────────────────────────────────
export async function getOfflineData() {
  const [borrowers, loans, payments] = await Promise.all([
    getAll("borrowers"),
    getAll("loans"),
    getAll("payments"),
  ]);
  return { borrowers, loans, payments };
}

// ── Offline queue: mutations that couldn't reach the server ───────────────────
export async function enqueue(operation) {
  // operation: { method, path, body, tempId, store }
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("queue", "readwrite");
    const req = tx.objectStore("queue").add({ ...operation, createdAt: Date.now() });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getQueue() {
  return getAll("queue");
}

export async function removeFromQueue(qid) {
  const d = await openDB();
  return new Promise((resolve, reject) => {
    const tx = d.transaction("queue", "readwrite");
    tx.objectStore("queue").delete(qid);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearQueue() {
  return clearStore("queue");
}

// ── Optimistic local mutations ────────────────────────────────────────────────
const uid = () =>
  "tmp_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
const todayStr = () => new Date().toISOString().split("T")[0];

export async function localAddBorrower(data) {
  const item = { ...data, id: uid(), created_at: todayStr() };
  await putAll("borrowers", [item]);
  return item;
}

export async function localUpdateBorrower(id, data) {
  const all = await getAll("borrowers");
  const updated = all.map((b) => (b.id === id ? { ...b, ...data } : b));
  await putAll("borrowers", updated);
  return updated.find((b) => b.id === id);
}

export async function localDeleteBorrower(id) {
  await deleteOne("borrowers", id);
  // Also delete their loans + payments locally
  const loans = await getAll("loans");
  const loanIds = loans.filter((l) => l.borrower_id === id).map((l) => l.id);
  for (const lid of loanIds) await deleteOne("loans", lid);
  const payments = await getAll("payments");
  for (const p of payments.filter((p) => loanIds.includes(p.loan_id)))
    await deleteOne("payments", p.id);
}

export async function localAddLoan(data) {
  const item = { ...data, id: uid(), status: "Active", created_at: todayStr() };
  await putAll("loans", [item]);
  return item;
}

export async function localUpdateLoan(id, data) {
  const all = await getAll("loans");
  const updated = all.map((l) => (l.id === id ? { ...l, ...data } : l));
  await putAll("loans", updated);
  return updated.find((l) => l.id === id);
}

export async function localDeleteLoan(id) {
  await deleteOne("loans", id);
  const payments = await getAll("payments");
  for (const p of payments.filter((p) => p.loan_id === id))
    await deleteOne("payments", p.id);
}

export async function localAddPayment(data) {
  const item = { ...data, id: uid(), created_at: todayStr() };
  await putAll("payments", [item]);
  return item;
}
