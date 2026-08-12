import { firebaseConfig, recaptchaSiteKey } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import {
  getFirestore, doc, setDoc, onSnapshot,
  collection, addDoc, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);

// App Check: proves requests are coming from this real site running in a real
// browser, not a script hitting Firestore directly with copied config keys.
// Runs invisibly in the background — no puzzles, no UI.
initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(recaptchaSiteKey),
  isTokenAutoRefreshEnabled: true
});

const db = getFirestore(app);

const GUESS_OPTIONS = [1, 2, 3, 4, 5, 6, "X"];
const COLORS = { p1: "#6aaa64", p2: "#c9b458" };

let players = { p1: "Player 1", p2: "Player 2" };
let entries = [];
let form = { g1: 4, g2: 4 };
let progressChart = null;
let distChart = null;

const $ = (id) => document.getElementById(id);

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function computeResult(g1, g2) {
  const v1 = g1 === "X" ? 99 : g1;
  const v2 = g2 === "X" ? 99 : g2;
  if (v1 === 99 && v2 === 99) return "tie";
  if (v1 < v2) return "p1";
  if (v2 < v1) return "p2";
  return "tie";
}

// ---------- Firestore listeners ----------
const conn = $("conn-status");

onSnapshot(doc(db, "meta", "players"),
  (snap) => {
    conn.textContent = "Connected";
    conn.className = "conn-status ok";
    if (snap.exists()) {
      players = { ...players, ...snap.data() };
      renderNames();
    }
  },
  (err) => {
    conn.textContent = "Connection error — check your Firebase setup";
    conn.className = "conn-status err";
    console.error(err);
  }
);

onSnapshot(query(collection(db, "entries"), orderBy("date", "asc")),
  (snap) => {
    entries = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderAll();
  },
  (err) => {
    conn.textContent = "Connection error — check your Firebase setup";
    conn.className = "conn-status err";
    console.error(err);
  }
);

// ---------- Rendering ----------
function renderNames() {
  $("label-p1").textContent = players.p1;
  $("label-p2").textContent = players.p2;
  $("guess-label-p1").textContent = `${players.p1}'s guesses`;
  $("guess-label-p2").textContent = `${players.p2}'s guesses`;
}

function computeStats() {
  let p1Score = 0, p2Score = 0, ties = 0;
  let p1SolvedTotal = 0, p1SolvedCount = 0, p2SolvedTotal = 0, p2SolvedCount = 0;
  let p1Fails = 0, p2Fails = 0;
  const dist = {
    p1: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, X: 0 },
    p2: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, X: 0 }
  };
  const chartLabels = [];
  const chartP1 = [];
  const chartP2 = [];

  entries.forEach((e) => {
    if (e.result === "p1") p1Score += 1;
    else if (e.result === "p2") p2Score += 1;
    else ties += 1;

    if (e.g1 === "X") p1Fails += 1; else { p1SolvedTotal += e.g1; p1SolvedCount += 1; }
    if (e.g2 === "X") p2Fails += 1; else { p2SolvedTotal += e.g2; p2SolvedCount += 1; }

    dist.p1[e.g1] = (dist.p1[e.g1] || 0) + 1;
    dist.p2[e.g2] = (dist.p2[e.g2] || 0) + 1;

    chartLabels.push(fmtDate(e.date));
    chartP1.push(p1Score);
    chartP2.push(p2Score);
  });

  let streakPlayer = null, streakCount = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const r = entries[i].result;
    if (r === "tie") break;
    if (streakPlayer === null) { streakPlayer = r; streakCount = 1; }
    else if (r === streakPlayer) streakCount += 1;
    else break;
  }

  return {
    p1Score, p2Score, ties, games: entries.length,
    p1Avg: p1SolvedCount ? (p1SolvedTotal / p1SolvedCount).toFixed(2) : "-",
    p2Avg: p2SolvedCount ? (p2SolvedTotal / p2SolvedCount).toFixed(2) : "-",
    p1Fails, p2Fails, dist, chartLabels, chartP1, chartP2,
    streakPlayer, streakCount
  };
}

function renderAll() {
  const stats = computeStats();

  $("value-p1").textContent = stats.p1Score;
  $("value-p2").textContent = stats.p2Score;
  $("value-ties").textContent = stats.ties;
  $("value-games").textContent = `${stats.games} game${stats.games === 1 ? "" : "s"}`;

  const leader = stats.p1Score > stats.p2Score ? "p1" : stats.p2Score > stats.p1Score ? "p2" : null;
  $("tile-p1").classList.toggle("leading", leader === "p1");
  $("tile-p2").classList.toggle("leading", leader === "p2");

  const streakNote = $("streak-note");
  if (stats.streakCount >= 2) {
    streakNote.textContent = `${players[stats.streakPlayer]} is on a ${stats.streakCount}-game streak`;
    streakNote.classList.remove("hidden");
  } else {
    streakNote.classList.add("hidden");
  }

  $("empty-state").classList.toggle("hidden", entries.length > 0);
  document.querySelectorAll(".tab-panel").forEach((p) => {
    if (entries.length === 0) p.classList.add("hidden");
  });

  if (entries.length > 0) {
    const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    $(`tab-${activeTab}`).classList.remove("hidden");
  }

  renderCharts(stats);
  renderHistory();
  renderLeaderboard(stats, leader);
}

function renderCharts(stats) {
  if (typeof Chart === "undefined") return;

  const progressCtx = $("chart-progress");
  if (progressChart) progressChart.destroy();
  progressChart = new Chart(progressCtx, {
    type: "line",
    data: {
      labels: stats.chartLabels,
      datasets: [
        { label: players.p1, data: stats.chartP1, borderColor: COLORS.p1, backgroundColor: COLORS.p1, tension: 0.3, pointRadius: 3, borderWidth: 2.5 },
        { label: players.p2, data: stats.chartP2, borderColor: COLORS.p2, backgroundColor: COLORS.p2, tension: 0.3, pointRadius: 3, borderWidth: 2.5 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#87888c", font: { size: 11 } }, grid: { color: "#3a3a3c" } },
        y: { beginAtZero: true, ticks: { color: "#87888c", font: { size: 11 }, precision: 0 }, grid: { color: "#3a3a3c" } }
      },
      plugins: { legend: { labels: { color: "#87888c", font: { size: 12 } } } }
    }
  });

  const distCtx = $("chart-distribution");
  if (distChart) distChart.destroy();
  const labels = GUESS_OPTIONS.map((g) => (g === "X" ? "Fail" : `${g}`));
  distChart = new Chart(distCtx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        { label: players.p1, data: GUESS_OPTIONS.map((g) => stats.dist.p1[g] || 0), backgroundColor: COLORS.p1, borderRadius: 3 },
        { label: players.p2, data: GUESS_OPTIONS.map((g) => stats.dist.p2[g] || 0), backgroundColor: COLORS.p2, borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        x: { ticks: { color: "#87888c", font: { size: 11 } }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: "#87888c", font: { size: 11 }, precision: 0 }, grid: { color: "#3a3a3c" } }
      },
      plugins: { legend: { labels: { color: "#87888c", font: { size: 12 } } } }
    }
  });
}

function renderHistory() {
  const list = $("history-list");
  list.innerHTML = "";
  [...entries].reverse().forEach((e) => {
    const row = document.createElement("div");
    row.className = "history-row";

    const left = document.createElement("div");
    left.className = "history-left";
    left.innerHTML = `
      <div class="history-date">${fmtDate(e.date)}</div>
      ${e.word ? `<div class="history-word">${e.word}</div>` : ""}
      <div class="guess-badge ${e.result === "p1" ? "won-green" : ""}">${e.g1}</div>
      <div class="guess-badge ${e.result === "p2" ? "won-yellow" : ""}">${e.g2}</div>
    `;

    const right = document.createElement("div");
    right.className = "history-right";
    const tag = document.createElement("span");
    if (e.result === "tie") {
      tag.className = "result-tag tie";
      tag.textContent = "TIE";
    } else {
      tag.className = `result-tag ${e.result}`;
      tag.textContent = `${players[e.result]} +1`;
    }
    const delBtn = document.createElement("button");
    delBtn.className = "delete-btn";
    delBtn.setAttribute("aria-label", "Delete entry");
    delBtn.textContent = "✕";
    delBtn.onclick = () => deleteEntry(e.id);
    right.appendChild(tag);
    right.appendChild(delBtn);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  });
}

function renderLeaderboard(stats, leader) {
  const grid = $("stat-grid");
  grid.innerHTML = "";
  const items = [
    [`${players.p1} points`, stats.p1Score, COLORS.p1],
    [`${players.p2} points`, stats.p2Score, COLORS.p2],
    [`${players.p1} avg guesses`, stats.p1Avg, COLORS.p1],
    [`${players.p2} avg guesses`, stats.p2Avg, COLORS.p2],
    [`${players.p1} fails`, stats.p1Fails, COLORS.p1],
    [`${players.p2} fails`, stats.p2Fails, COLORS.p2]
  ];
  items.forEach(([label, value, color]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<div class="stat-label">${label}</div><div class="stat-value" style="color:${color}">${value}</div>`;
    grid.appendChild(card);
  });

  const note = $("lead-note");
  if (leader) {
    const diff = Math.abs(stats.p1Score - stats.p2Score);
    note.innerHTML = `<span style="color:${COLORS[leader]};font-weight:700;">${players[leader]}</span> is ahead by ${diff} point${diff === 1 ? "" : "s"}.`;
  } else {
    note.innerHTML = `It's all tied up.`;
  }
}

// ---------- Form interactions ----------
function buildPicker(containerId, playerKey, colorClass) {
  const container = $(containerId);
  container.innerHTML = "";
  GUESS_OPTIONS.forEach((g) => {
    const btn = document.createElement("button");
    btn.className = "guess-btn";
    btn.textContent = g;
    btn.type = "button";
    if (form[playerKey] === g) btn.classList.add(colorClass);
    btn.onclick = () => {
      form[playerKey] = g;
      buildPicker(containerId, playerKey, colorClass);
    };
    container.appendChild(btn);
  });
}

$("input-date").value = todayStr();
buildPicker("picker-p1", "g1", "active-green");
buildPicker("picker-p2", "g2", "active-yellow");

$("add-entry-btn").onclick = async () => {
  const date = $("input-date").value || todayStr();
  const word = $("input-word").value.trim().toUpperCase();
  const result = computeResult(form.g1, form.g2);
  try {
    await addDoc(collection(db, "entries"), {
      date, word, g1: form.g1, g2: form.g2, result, createdAt: Date.now()
    });
    $("save-error").classList.add("hidden");
    $("input-word").value = "";
    $("input-date").value = todayStr();
  } catch (e) {
    console.error(e);
    $("save-error").classList.remove("hidden");
  }
};

async function deleteEntry(id) {
  try {
    await deleteDoc(doc(db, "entries", id));
  } catch (e) {
    console.error(e);
  }
}

// ---------- Name editing ----------
$("edit-names-btn").onclick = () => {
  $("name-p1-input").value = players.p1;
  $("name-p2-input").value = players.p2;
  $("names-form").classList.remove("hidden");
};
$("save-names-btn").onclick = async () => {
  const p1 = $("name-p1-input").value.trim() || "Player 1";
  const p2 = $("name-p2-input").value.trim() || "Player 2";
  try {
    await setDoc(doc(db, "meta", "players"), { p1, p2 });
    $("names-form").classList.add("hidden");
  } catch (e) {
    console.error(e);
  }
};

// ---------- Tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.onclick = () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    if (entries.length > 0) {
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
      $(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    }
  };
});
