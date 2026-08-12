import { firebaseConfig, recaptchaSiteKey } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import {
  getFirestore, doc, setDoc, onSnapshot,
  collection, addDoc, deleteDoc, query, orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);

initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(recaptchaSiteKey),
  isTokenAutoRefreshEnabled: true
});

const db = getFirestore(app);

const GUESS_OPTIONS = [1, 2, 3, 4, 5, 6, "X"];
const COLORS = { p1: "#6aaa64", p2: "#c9b458" };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SEEN_KEY = "wordle-duel-seen-milestones";

let players = { p1: "Player 1", p2: "Player 2" };
let entries = [];
let form = { g1: 4, g2: 4 };
let charts = {};

const $ = (id) => document.getElementById(id);

function todayStr() { return new Date().toISOString().slice(0, 10); }
function fmtDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function fmtDateLong(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
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
      renderAll();
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

// ---------- Names ----------
function renderNames() {
  $("label-p1").textContent = players.p1;
  $("label-p2").textContent = players.p2;
  $("guess-label-p1").textContent = `${players.p1}'s guesses`;
  $("guess-label-p2").textContent = `${players.p2}'s guesses`;
  $("margin-note-p1").textContent = players.p1;
  $("margin-note-p2").textContent = players.p2;
  $("legend-p1").textContent = players.p1;
  $("legend-p2").textContent = players.p2;
}

// ---------- Core stats ----------
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
  const marginData = [];

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
    marginData.push(p1Score - p2Score);
  });

  let streakPlayer = null, streakCount = 0;
  let longestP1 = 0, longestP2 = 0;
  let runP = null, runC = 0;
  entries.forEach((e) => {
    if (e.result === "tie") { runP = null; runC = 0; return; }
    if (runP === e.result) runC += 1; else { runP = e.result; runC = 1; }
    if (runP === "p1" && runC > longestP1) longestP1 = runC;
    if (runP === "p2" && runC > longestP2) longestP2 = runC;
  });
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
    p1Fails, p2Fails, p1SolvedCount, p2SolvedCount,
    dist, chartLabels, chartP1, chartP2, marginData,
    streakPlayer, streakCount, longestP1, longestP2
  };
}

function computeExtendedStats() {
  let bestGame = null; // lowest guesses, {player, guesses, date, word}
  let worstFailStreak = { p1: 0, p2: 0 };
  let p1WinGuessTotal = 0, p1WinGuessCount = 0, p1LossGuessTotal = 0, p1LossGuessCount = 0;
  let p2WinGuessTotal = 0, p2WinGuessCount = 0, p2LossGuessTotal = 0, p2LossGuessCount = 0;
  let clutch = { p1Wins: 0, p1Chances: 0, p2Wins: 0, p2Chances: 0 };
  const letterCounts = {};
  const weekdayTotals = { p1: Array(7).fill(0), p2: Array(7).fill(0) };
  const weekdayCounts = { p1: Array(7).fill(0), p2: Array(7).fill(0) };
  const rollingLabels = [], rollingP1 = [], rollingP2 = [];
  const p1Window = [], p2Window = [];

  entries.forEach((e) => {
    [["p1", e.g1], ["p2", e.g2]].forEach(([who, g]) => {
      if (g !== "X" && (!bestGame || g < bestGame.guesses)) {
        bestGame = { player: who, guesses: g, date: e.date, word: e.word };
      }
    });

    if (e.g1 !== "X") {
      if (e.result === "p1") { p1WinGuessTotal += e.g1; p1WinGuessCount++; }
      else { p1LossGuessTotal += e.g1; p1LossGuessCount++; }
    }
    if (e.g2 !== "X") {
      if (e.result === "p2") { p2WinGuessTotal += e.g2; p2WinGuessCount++; }
      else { p2LossGuessTotal += e.g2; p2LossGuessCount++; }
    }

    if (e.g2 !== "X" && e.g2 <= 3) {
      clutch.p1Chances++;
      if (e.result === "p1") clutch.p1Wins++;
    }
    if (e.g1 !== "X" && e.g1 <= 3) {
      clutch.p2Chances++;
      if (e.result === "p2") clutch.p2Wins++;
    }

    if (e.word) {
      const letter = e.word.trim().charAt(0).toUpperCase();
      if (letter) letterCounts[letter] = (letterCounts[letter] || 0) + 1;
    }

    const wd = new Date(e.date + "T00:00:00").getDay();
    if (e.g1 !== "X") { weekdayTotals.p1[wd] += e.g1; weekdayCounts.p1[wd] += 1; }
    if (e.g2 !== "X") { weekdayTotals.p2[wd] += e.g2; weekdayCounts.p2[wd] += 1; }

    p1Window.push(e.g1 === "X" ? 7 : e.g1);
    p2Window.push(e.g2 === "X" ? 7 : e.g2);
    if (p1Window.length > 7) p1Window.shift();
    if (p2Window.length > 7) p2Window.shift();
    rollingLabels.push(fmtDate(e.date));
    rollingP1.push(+(p1Window.reduce((a, b) => a + b, 0) / p1Window.length).toFixed(2));
    rollingP2.push(+(p2Window.reduce((a, b) => a + b, 0) / p2Window.length).toFixed(2));
  });

  const last10 = entries.slice(-10);
  const record = { p1: 0, p2: 0, ties: 0 };
  entries.forEach((e) => {
    if (e.result === "p1") record.p1++;
    else if (e.result === "p2") record.p2++;
    else record.ties++;
  });

  return {
    bestGame,
    p1WinAvg: p1WinGuessCount ? (p1WinGuessTotal / p1WinGuessCount).toFixed(2) : "-",
    p1LossAvg: p1LossGuessCount ? (p1LossGuessTotal / p1LossGuessCount).toFixed(2) : "-",
    p2WinAvg: p2WinGuessCount ? (p2WinGuessTotal / p2WinGuessCount).toFixed(2) : "-",
    p2LossAvg: p2LossGuessCount ? (p2LossGuessTotal / p2LossGuessCount).toFixed(2) : "-",
    clutch,
    letterCounts,
    weekdayAvg: {
      p1: weekdayTotals.p1.map((t, i) => weekdayCounts.p1[i] ? +(t / weekdayCounts.p1[i]).toFixed(2) : null),
      p2: weekdayTotals.p2.map((t, i) => weekdayCounts.p2[i] ? +(t / weekdayCounts.p2[i]).toFixed(2) : null)
    },
    rollingLabels, rollingP1, rollingP2,
    last10, record
  };
}

function computeMilestones() {
  const events = [];
  let p1Score = 0, p2Score = 0, games = 0;
  let streakPlayer = null, streakCount = 0;
  let nemesisP1 = 0, nemesisP2 = 0;
  let firstBloodDone = false;
  let worstDiffP1 = 0, worstDiffP2 = 0;
  const pointThresholds = [25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 350, 400, 500];
  const streakThresholds = [3, 5, 10, 15, 20, 25];
  const gameThresholds = [10, 25, 50, 100, 150, 200, 250, 300];
  const nemesisThresholds = [5, 10, 15, 20];

  entries.forEach((e, idx) => {
    games++;

    if (e.result === "p1") p1Score++;
    else if (e.result === "p2") p2Score++;
    const diff = p1Score - p2Score;

    if (!firstBloodDone && (e.g1 === 1 || e.g2 === 1)) {
      firstBloodDone = true;
      const who = e.g1 === 1 ? "p1" : "p2";
      events.push({
        id: `firstblood`, date: e.date, icon: "🎯", color: COLORS[who],
        text: `${players[who]} drew first blood — the first ever 1-guess solve!`
      });
    }

    if (e.result === "p1" || e.result === "p2") {
      if (streakPlayer === e.result) streakCount++; else { streakPlayer = e.result; streakCount = 1; }
    } else { streakPlayer = null; streakCount = 0; }
    if (streakPlayer && streakThresholds.includes(streakCount)) {
      events.push({
        id: `streak-${streakPlayer}-${streakCount}-${e.date}`, date: e.date, icon: "🔥", color: COLORS[streakPlayer],
        text: `${players[streakPlayer]} is on a ${streakCount}-game win streak!`
      });
      if (streakCount === 7) {
        const last7 = entries.slice(idx - 6, idx + 1);
        if (last7.length === 7 && daysBetween(last7[0].date, last7[6].date) === 6) {
          events.push({
            id: `perfectweek-${streakPlayer}-${e.date}`, date: e.date, icon: "🏆", color: COLORS[streakPlayer],
            text: `Perfect week! ${players[streakPlayer]} won every game for 7 straight days.`
          });
        }
      }
    }

    nemesisP1 = e.result === "p2" ? 0 : nemesisP1 + 1;
    nemesisP2 = e.result === "p1" ? 0 : nemesisP2 + 1;
    if (nemesisThresholds.includes(nemesisP1)) {
      events.push({
        id: `nemesis-p1-${nemesisP1}-${e.date}`, date: e.date, icon: "😤", color: COLORS.p1,
        text: `${players.p2} hasn't beaten ${players.p1} in ${nemesisP1} games.`
      });
    }
    if (nemesisThresholds.includes(nemesisP2)) {
      events.push({
        id: `nemesis-p2-${nemesisP2}-${e.date}`, date: e.date, icon: "😤", color: COLORS.p2,
        text: `${players.p1} hasn't beaten ${players.p2} in ${nemesisP2} games.`
      });
    }

    [["p1", p1Score], ["p2", p2Score]].forEach(([who, score]) => {
      if (pointThresholds.includes(score)) {
        events.push({
          id: `points-${who}-${score}`, date: e.date, icon: "⭐", color: COLORS[who],
          text: `${players[who]} reached ${score} points!`
        });
      }
    });

    if (gameThresholds.includes(games)) {
      events.push({
        id: `games-${games}`, date: e.date, icon: "🎉", color: "#87888c",
        text: `You've played ${games} games together!`
      });
    }

    if (diff < worstDiffP1) worstDiffP1 = diff;
    if (diff > worstDiffP2) worstDiffP2 = diff;
    if (diff >= 0 && worstDiffP1 <= -5) {
      events.push({
        id: `comeback-p1-${e.date}`, date: e.date, icon: "📈", color: COLORS.p1,
        text: `Comeback! ${players.p1} erased a ${Math.abs(worstDiffP1)}-point deficit.`
      });
      worstDiffP1 = Math.min(0, diff);
    }
    if (diff <= 0 && worstDiffP2 >= 5) {
      events.push({
        id: `comeback-p2-${e.date}`, date: e.date, icon: "📈", color: COLORS.p2,
        text: `Comeback! ${players.p2} erased a ${worstDiffP2}-point deficit.`
      });
      worstDiffP2 = Math.max(0, diff);
    }
  });

  events.sort((a, b) => b.date.localeCompare(a.date));
  return events;
}

// ---------- Toast / confetti ----------
function showToast(text) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = text;
  $("toast-container").appendChild(t);
  setTimeout(() => t.remove(), 3600);
}
function fireConfetti() {
  const colors = [COLORS.p1, COLORS.p2, "#ffffff"];
  for (let i = 0; i < 40; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = Math.random() * 100 + "vw";
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDuration = (2 + Math.random() * 1.5) + "s";
    piece.style.opacity = String(0.7 + Math.random() * 0.3);
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 4000);
  }
}
function checkNewMilestones(milestones) {
  let seen;
  try { seen = new Set(JSON.parse(localStorage.getItem(SEEN_KEY) || "[]")); }
  catch (e) { seen = new Set(); }

  const isFirstRun = seen.size === 0 && entries.length > 0 && !localStorage.getItem(SEEN_KEY + "-init");
  const fresh = milestones.filter((m) => !seen.has(m.id));

  milestones.forEach((m) => seen.add(m.id));
  localStorage.setItem(SEEN_KEY, JSON.stringify([...seen]));
  localStorage.setItem(SEEN_KEY + "-init", "1");

  if (!isFirstRun && fresh.length > 0) {
    fresh.forEach((m) => showToast(`${m.icon} ${m.text}`));
    fireConfetti();
  }
}

// ---------- Master render ----------
function renderAll() {
  const stats = computeStats();
  const ext = computeExtendedStats();
  const milestones = computeMilestones();

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
  if (entries.length > 0) {
    const activeTab = document.querySelector(".tab-btn.active").dataset.tab;
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    $(`tab-${activeTab}`).classList.remove("hidden");
  } else {
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
  }

  renderCoreCharts(stats);
  renderCalendarHeatmap();
  renderRollingChart(ext);
  renderWeekdayChart(ext);
  renderLettersChart(ext);
  renderHistory();
  renderLeaderboard(stats, ext, leader);
  renderMilestonesTab(milestones);
  renderWrapped();

  checkNewMilestones(milestones);
}

// ---------- Core charts ----------
function makeLineDataset(label, data, color) {
  const dense = data.length > 40;
  return {
    label, data, borderColor: color, backgroundColor: color, tension: 0.25,
    pointRadius: dense ? 0 : 3, pointHoverRadius: 5, borderWidth: dense ? 2 : 2.5
  };
}
const axisOpts = {
  x: { ticks: { color: "#87888c", font: { size: 11 }, autoSkip: true, maxTicksLimit: 8, maxRotation: 0 }, grid: { color: "#3a3a3c" } },
  y: { ticks: { color: "#87888c", font: { size: 11 } }, grid: { color: "#3a3a3c" } }
};
function destroyChart(key) { if (charts[key]) { charts[key].destroy(); delete charts[key]; } }

function renderCoreCharts(stats) {
  if (typeof Chart === "undefined") return;

  destroyChart("progress");
  charts.progress = new Chart($("chart-progress"), {
    type: "line",
    data: { labels: stats.chartLabels, datasets: [makeLineDataset(players.p1, stats.chartP1, COLORS.p1), makeLineDataset(players.p2, stats.chartP2, COLORS.p2)] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      scales: { x: axisOpts.x, y: { ...axisOpts.y, beginAtZero: true, ticks: { ...axisOpts.y.ticks, precision: 0 } } },
      plugins: { legend: { labels: { color: "#87888c", font: { size: 12 } } } }
    }
  });

  destroyChart("margin");
  charts.margin = new Chart($("chart-margin"), {
    type: "line",
    data: {
      labels: stats.chartLabels,
      datasets: [{
        label: "Margin", data: stats.marginData, borderColor: "#8a8f98", backgroundColor: "rgba(138,143,152,0.15)",
        borderWidth: 2, pointRadius: 0, fill: true, tension: 0.25
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: axisOpts.x, y: { ...axisOpts.y, ticks: { ...axisOpts.y.ticks, precision: 0 } } },
      plugins: { legend: { display: false } }
    }
  });

  destroyChart("distribution");
  const labels = GUESS_OPTIONS.map((g) => (g === "X" ? "Fail" : `${g}`));
  charts.distribution = new Chart($("chart-distribution"), {
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
      scales: { x: { ...axisOpts.x, grid: { display: false } }, y: { ...axisOpts.y, beginAtZero: true, ticks: { ...axisOpts.y.ticks, precision: 0 } } },
      plugins: { legend: { labels: { color: "#87888c", font: { size: 12 } } } }
    }
  });
}

function renderRollingChart(ext) {
  if (typeof Chart === "undefined") return;
  destroyChart("rolling");
  charts.rolling = new Chart($("chart-rolling"), {
    type: "line",
    data: { labels: ext.rollingLabels, datasets: [makeLineDataset(players.p1, ext.rollingP1, COLORS.p1), makeLineDataset(players.p2, ext.rollingP2, COLORS.p2)] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: axisOpts.x, y: axisOpts.y },
      plugins: { legend: { labels: { color: "#87888c", font: { size: 12 } } } }
    }
  });
}

function renderWeekdayChart(ext) {
  if (typeof Chart === "undefined") return;
  destroyChart("weekday");
  charts.weekday = new Chart($("chart-weekday"), {
    type: "bar",
    data: {
      labels: WEEKDAYS,
      datasets: [
        { label: players.p1, data: ext.weekdayAvg.p1, backgroundColor: COLORS.p1, borderRadius: 3 },
        { label: players.p2, data: ext.weekdayAvg.p2, backgroundColor: COLORS.p2, borderRadius: 3 }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { ...axisOpts.x, grid: { display: false } }, y: axisOpts.y },
      plugins: { legend: { labels: { color: "#87888c", font: { size: 12 } } } }
    }
  });
}

function renderLettersChart(ext) {
  if (typeof Chart === "undefined") return;
  const section = $("letters-section");
  const entries2 = Object.entries(ext.letterCounts).sort((a, b) => b[1] - a[1]).slice(0, 8);
  if (entries2.length === 0) { section.classList.add("hidden"); return; }
  section.classList.remove("hidden");
  destroyChart("letters");
  charts.letters = new Chart($("chart-letters"), {
    type: "bar",
    data: { labels: entries2.map((e) => e[0]), datasets: [{ label: "Games", data: entries2.map((e) => e[1]), backgroundColor: "#6aaa64aa", borderRadius: 3 }] },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { x: { ...axisOpts.x, grid: { display: false } }, y: { ...axisOpts.y, beginAtZero: true, ticks: { ...axisOpts.y.ticks, precision: 0 } } },
      plugins: { legend: { display: false } }
    }
  });
}

// ---------- Calendar heatmap ----------
function renderCalendarHeatmap() {
  const container = $("calendar-heatmap");
  container.innerHTML = "";
  if (entries.length === 0) return;

  const byDate = {};
  entries.forEach((e) => { byDate[e.date] = e.result; });

  const firstDate = entries[0].date;
  const lastDate = todayStr();
  const start = new Date(firstDate + "T00:00:00");
  start.setDate(start.getDate() - start.getDay());

  let cursor = new Date(start);
  const end = new Date(lastDate + "T00:00:00");

  while (cursor <= end) {
    const iso = cursor.toISOString().slice(0, 10);
    const cell = document.createElement("div");
    const result = byDate[iso];
    cell.className = "cal-cell" + (result === "p1" ? " cal-p1" : result === "p2" ? " cal-p2" : result === "tie" ? " cal-tie" : "");
    cell.title = result ? `${fmtDateLong(iso)}: ${result === "tie" ? "Tie" : players[result] + " won"}` : iso;
    container.appendChild(cell);
    cursor.setDate(cursor.getDate() + 1);
  }
  container.scrollLeft = container.scrollWidth;
}

// ---------- History ----------
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
    if (e.result === "tie") { tag.className = "result-tag tie"; tag.textContent = "TIE"; }
    else { tag.className = `result-tag ${e.result}`; tag.textContent = `${players[e.result]} +1`; }
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

// ---------- Leaderboard ----------
function renderLeaderboard(stats, ext, leader) {
  const grid = $("stat-grid");
  grid.innerHTML = "";
  const items = [
    [`${players.p1} points`, stats.p1Score, COLORS.p1],
    [`${players.p2} points`, stats.p2Score, COLORS.p2],
    [`${players.p1} avg guesses`, stats.p1Avg, COLORS.p1],
    [`${players.p2} avg guesses`, stats.p2Avg, COLORS.p2],
    [`${players.p1} fails / solve rate`, `${stats.p1Fails} / ${stats.games ? Math.round(100 * stats.p1SolvedCount / stats.games) : 0}%`, COLORS.p1],
    [`${players.p2} fails / solve rate`, `${stats.p2Fails} / ${stats.games ? Math.round(100 * stats.p2SolvedCount / stats.games) : 0}%`, COLORS.p2],
    [`${players.p1} longest streak`, stats.longestP1, COLORS.p1],
    [`${players.p2} longest streak`, stats.longestP2, COLORS.p2],
    [`${players.p1} avg when winning / losing`, `${ext.p1WinAvg} / ${ext.p1LossAvg}`, COLORS.p1],
    [`${players.p2} avg when winning / losing`, `${ext.p2WinAvg} / ${ext.p2LossAvg}`, COLORS.p2]
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

  $("record-note").innerHTML = `<span style="font-size:20px;font-weight:700;font-family:var(--mono);">${ext.record.p1}–${ext.record.p2}–${ext.record.ties}</span>
    <div style="font-size:12px;color:var(--text-dim);margin-top:4px;">${players.p1} wins – ${players.p2} wins – Ties</div>`;

  const notable = $("notable-games");
  notable.innerHTML = "";
  if (ext.bestGame) {
    const row = document.createElement("div");
    row.className = "notable-row";
    row.innerHTML = `<div><div class="notable-label">Best game ever</div><div>${players[ext.bestGame.player]} solved in ${ext.bestGame.guesses} — ${fmtDate(ext.bestGame.date)}${ext.bestGame.word ? " (" + ext.bestGame.word + ")" : ""}</div></div><div class="notable-value" style="color:${COLORS[ext.bestGame.player]}">${ext.bestGame.guesses}</div>`;
    notable.appendChild(row);
  } else {
    notable.innerHTML = `<div class="milestone-empty">No games yet.</div>`;
  }

  const formNote = $("form-note");
  formNote.innerHTML = "";
  ["p1", "p2"].forEach((who) => {
    const pills = document.createElement("div");
    pills.className = "form-pill-row";
    let w = 0, l = 0, t = 0;
    ext.last10.forEach((e) => {
      const pill = document.createElement("div");
      if (e.result === who) { pill.className = "form-pill win"; pill.textContent = "W"; w++; }
      else if (e.result === "tie") { pill.className = "form-pill tie"; pill.textContent = "T"; t++; }
      else { pill.className = "form-pill loss"; pill.textContent = "L"; l++; }
      pills.appendChild(pill);
    });
    const label = document.createElement("div");
    label.className = "form-record";
    label.style.marginBottom = "4px";
    label.innerHTML = `<strong style="color:${COLORS[who]}">${players[who]}</strong>: ${w}-${l}-${t}`;
    formNote.appendChild(label);
    formNote.appendChild(pills);
  });

  const clutchGrid = $("clutch-grid");
  clutchGrid.innerHTML = "";
  const p1ClutchPct = ext.clutch.p1Chances ? Math.round(100 * ext.clutch.p1Wins / ext.clutch.p1Chances) : null;
  const p2ClutchPct = ext.clutch.p2Chances ? Math.round(100 * ext.clutch.p2Wins / ext.clutch.p2Chances) : null;
  [[players.p1, p1ClutchPct, ext.clutch.p1Chances, COLORS.p1], [players.p2, p2ClutchPct, ext.clutch.p2Chances, COLORS.p2]].forEach(([name, pct, chances, color]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `<div class="stat-label">${name} (${chances} chances)</div><div class="stat-value" style="color:${color}">${pct === null ? "-" : pct + "%"}</div>`;
    clutchGrid.appendChild(card);
  });
}

// ---------- Milestones tab ----------
function renderMilestonesTab(milestones) {
  const anniv = $("anniversary-card");
  if (entries.length > 0) {
    const first = entries[0].date;
    const days = daysBetween(first, todayStr());
    let nextAnniv = new Date(first + "T00:00:00");
    nextAnniv.setFullYear(new Date().getFullYear());
    if (nextAnniv < new Date()) nextAnniv.setFullYear(nextAnniv.getFullYear() + 1);
    const daysToAnniv = Math.round((nextAnniv - new Date()) / 86400000);
    anniv.innerHTML = `
      <div class="anniversary-title">Duel anniversary</div>
      <div class="anniversary-value">
        Started on <strong>${fmtDateLong(first)}</strong> — that's <strong>${days} days</strong> of Wordle rivalry.<br/>
        ${daysToAnniv === 0 ? "🎉 Happy anniversary — today's the day!" : `Next anniversary in ${daysToAnniv} day${daysToAnniv === 1 ? "" : "s"}.`}
      </div>
    `;
  } else {
    anniv.innerHTML = `<div class="anniversary-title">Duel anniversary</div><div class="milestone-empty">Add your first game to get started.</div>`;
  }

  const feed = $("milestones-feed");
  feed.innerHTML = "";
  if (milestones.length === 0) {
    feed.innerHTML = `<div class="milestone-empty">No achievements yet — keep playing!</div>`;
    return;
  }
  milestones.forEach((m) => {
    const item = document.createElement("div");
    item.className = "milestone-item";
    item.innerHTML = `
      <div class="milestone-icon" style="background:${m.color}22;">${m.icon}</div>
      <div>
        <div class="milestone-text">${m.text}</div>
        <div class="milestone-date">${fmtDateLong(m.date)}</div>
      </div>
    `;
    feed.appendChild(item);
  });
}

// ---------- Wrapped ----------
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function wrappedPeriods() {
  const periods = [{ key: "lifetime", label: "Lifetime" }];
  const seen = new Set();
  [...entries].reverse().forEach((e) => {
    const [y, m] = e.date.split("-");
    const key = `${y}-${m}`;
    if (!seen.has(key)) {
      seen.add(key);
      periods.push({ key, label: `${MONTH_NAMES[parseInt(m, 10) - 1]} ${y}` });
    }
  });
  const years = new Set(entries.map((e) => e.date.split("-")[0]));
  years.forEach((y) => periods.push({ key: `year-${y}`, label: `${y} (full year)` }));
  return periods;
}

function entriesForPeriod(key) {
  if (key === "lifetime") return entries;
  if (key.startsWith("year-")) {
    const y = key.split("-")[1];
    return entries.filter((e) => e.date.startsWith(y + "-"));
  }
  return entries.filter((e) => e.date.startsWith(key));
}

let wrappedInitialized = false;
function initWrappedPicker() {
  const select = $("wrapped-period");
  const periods = wrappedPeriods();
  const prevValue = select.value;
  select.innerHTML = "";
  periods.forEach((p) => {
    const opt = document.createElement("option");
    opt.value = p.key; opt.textContent = p.label;
    select.appendChild(opt);
  });
  if (periods.some((p) => p.key === prevValue)) select.value = prevValue;
  if (!wrappedInitialized) {
    select.onchange = renderWrapped;
    wrappedInitialized = true;
  }
}

function renderWrapped() {
  initWrappedPicker();
  const card = $("wrapped-card");
  const key = $("wrapped-period").value || "lifetime";
  const subset = entriesForPeriod(key);

  if (subset.length === 0) {
    card.innerHTML = `<div class="wrapped-empty">No games in this period yet.</div>`;
    return;
  }

  let p1Score = 0, p2Score = 0, ties = 0;
  let p1Total = 0, p1Count = 0, p2Total = 0, p2Count = 0;
  let p1Fails = 0, p2Fails = 0;
  let bestGame = null;
  let streakPlayer = null, streakCount = 0, longestP1 = 0, longestP2 = 0;

  subset.forEach((e) => {
    if (e.result === "p1") p1Score++; else if (e.result === "p2") p2Score++; else ties++;
    if (e.g1 !== "X") { p1Total += e.g1; p1Count++; } else p1Fails++;
    if (e.g2 !== "X") { p2Total += e.g2; p2Count++; } else p2Fails++;

    [["p1", e.g1], ["p2", e.g2]].forEach(([who, g]) => {
      if (g !== "X" && (!bestGame || g < bestGame.guesses)) bestGame = { player: who, guesses: g, date: e.date, word: e.word };
    });

    if (e.result === "tie") { streakPlayer = null; streakCount = 0; }
    else {
      if (streakPlayer === e.result) streakCount++; else { streakPlayer = e.result; streakCount = 1; }
      if (streakPlayer === "p1" && streakCount > longestP1) longestP1 = streakCount;
      if (streakPlayer === "p2" && streakCount > longestP2) longestP2 = streakCount;
    }
  });

  const leader = p1Score > p2Score ? "p1" : p2Score > p1Score ? "p2" : null;
  const periodLabel = wrappedPeriods().find((p) => p.key === key)?.label || "Lifetime";

  let highlight;
  if (bestGame) {
    highlight = { emoji: "🏅", text: `Best game: ${players[bestGame.player]} solved in ${bestGame.guesses}${bestGame.word ? ` (${bestGame.word})` : ""} on ${fmtDate(bestGame.date)}` };
  }
  if (longestP1 >= 3 || longestP2 >= 3) {
    const who = longestP1 >= longestP2 ? "p1" : "p2";
    const count = Math.max(longestP1, longestP2);
    highlight = { emoji: "🔥", text: `${players[who]}'s longest streak this period: ${count} wins in a row` };
  }

  card.innerHTML = `
    <div class="wrapped-title">Wordle Duel Wrapped</div>
    <div class="wrapped-heading">${periodLabel}</div>
    <div class="wrapped-sub">${subset.length} game${subset.length === 1 ? "" : "s"} played
      ${leader ? ` · <span style="color:${COLORS[leader]};font-weight:700;">${players[leader]}</span> came out on top` : " · dead even"}
    </div>
    <div class="wrapped-grid">
      <div class="wrapped-stat"><div class="wrapped-stat-label">${players.p1} points</div><div class="wrapped-stat-value" style="color:${COLORS.p1}">${p1Score}</div></div>
      <div class="wrapped-stat"><div class="wrapped-stat-label">${players.p2} points</div><div class="wrapped-stat-value" style="color:${COLORS.p2}">${p2Score}</div></div>
      <div class="wrapped-stat"><div class="wrapped-stat-label">${players.p1} avg guesses</div><div class="wrapped-stat-value">${p1Count ? (p1Total / p1Count).toFixed(2) : "-"}</div><div class="wrapped-stat-sub">${p1Fails} fail${p1Fails === 1 ? "" : "s"}</div></div>
      <div class="wrapped-stat"><div class="wrapped-stat-label">${players.p2} avg guesses</div><div class="wrapped-stat-value">${p2Count ? (p2Total / p2Count).toFixed(2) : "-"}</div><div class="wrapped-stat-sub">${p2Fails} fail${p2Fails === 1 ? "" : "s"}</div></div>
      <div class="wrapped-stat"><div class="wrapped-stat-label">Ties</div><div class="wrapped-stat-value" style="color:#87888c">${ties}</div></div>
      <div class="wrapped-stat"><div class="wrapped-stat-label">Record (P1–P2–T)</div><div class="wrapped-stat-value">${p1Score}–${p2Score}–${ties}</div></div>
      ${highlight ? `<div class="wrapped-highlight"><div class="wrapped-highlight-emoji">${highlight.emoji}</div><div class="wrapped-highlight-text">${highlight.text}</div></div>` : ""}
    </div>
  `;
}


function buildPicker(containerId, playerKey, colorClass) {
  const container = $(containerId);
  container.innerHTML = "";
  GUESS_OPTIONS.forEach((g) => {
    const btn = document.createElement("button");
    btn.className = "guess-btn";
    btn.textContent = g;
    btn.type = "button";
    if (form[playerKey] === g) btn.classList.add(colorClass);
    btn.onclick = () => { form[playerKey] = g; buildPicker(containerId, playerKey, colorClass); };
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
    await addDoc(collection(db, "entries"), { date, word, g1: form.g1, g2: form.g2, result, createdAt: Date.now() });
    $("save-error").classList.add("hidden");
    $("input-word").value = "";
    $("input-date").value = todayStr();
  } catch (e) {
    console.error(e);
    $("save-error").classList.remove("hidden");
  }
};

async function deleteEntry(id) {
  try { await deleteDoc(doc(db, "entries", id)); } catch (e) { console.error(e); }
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
  } catch (e) { console.error(e); }
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
