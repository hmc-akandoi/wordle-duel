import { firebaseConfig, recaptchaSiteKey } from "./firebase-config.js";
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { initializeAppCheck, ReCaptchaV3Provider } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app-check.js";
import {
  getFirestore, doc, getDoc, collection, getDocs, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const app = initializeApp(firebaseConfig);

initializeAppCheck(app, {
  provider: new ReCaptchaV3Provider(recaptchaSiteKey),
  isTokenAutoRefreshEnabled: true
});

const db = getFirestore(app);
const log = (msg) => { document.getElementById("log").textContent += msg + "\n"; };

function computeResult(g1, g2) {
  const v1 = g1 === "X" ? 99 : g1;
  const v2 = g2 === "X" ? 99 : g2;
  if (v1 === 99 && v2 === 99) return "tie";
  if (v1 < v2) return "p1";
  if (v2 < v1) return "p2";
  return "tie";
}

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const dateIdx = header.indexOf("date");
  const wordIdx = header.indexOf("word");
  const g1Idx = header.indexOf("player1_guesses");
  const g2Idx = header.indexOf("player2_guesses");

  if (dateIdx === -1 || g1Idx === -1 || g2Idx === -1) {
    throw new Error("CSV must have columns: date, player1_guesses, player2_guesses (word is optional)");
  }

  return lines.slice(1).filter((l) => l.trim()).map((line) => {
    const cols = line.split(",").map((c) => c.trim());
    const rawG1 = cols[g1Idx].toUpperCase();
    const rawG2 = cols[g2Idx].toUpperCase();
    const g1 = rawG1 === "X" ? "X" : parseInt(rawG1, 10);
    const g2 = rawG2 === "X" ? "X" : parseInt(rawG2, 10);
    return {
      date: cols[dateIdx],
      word: wordIdx !== -1 ? (cols[wordIdx] || "").toUpperCase() : "",
      g1, g2
    };
  });
}

// Show which name is currently "player 1" (green) so the CSV maps correctly.
(async () => {
  try {
    const snap = await getDoc(doc(db, "meta", "players"));
    const p1Name = snap.exists() ? snap.data().p1 : "Player 1";
    document.getElementById("p1-note").textContent =
      `In this database, "player1_guesses" = ${p1Name} (the green tile).`;
  } catch (e) {
    // non-fatal
  }
})();

document.getElementById("import-btn").onclick = async () => {
  const fileInput = document.getElementById("csv-file");
  const file = fileInput.files[0];
  document.getElementById("log").textContent = "";
  if (!file) { log("Choose a CSV file first."); return; }

  let rows;
  try {
    const text = await file.text();
    rows = parseCsv(text);
  } catch (e) {
    log("Error reading CSV: " + e.message);
    return;
  }

  log(`Found ${rows.length} rows. Checking for existing entries…`);

  const existingSnap = await getDocs(collection(db, "entries"));
  const existingDates = new Set(existingSnap.docs.map((d) => d.data().date));

  const toAdd = rows.filter((r) => {
    if (!r.date || isNaN(r.g1) && r.g1 !== "X" || isNaN(r.g2) && r.g2 !== "X") {
      log(`Skipping malformed row: ${JSON.stringify(r)}`);
      return false;
    }
    if (existingDates.has(r.date)) {
      log(`Skipping ${r.date} — already in the database.`);
      return false;
    }
    return true;
  });

  if (toAdd.length === 0) {
    log("Nothing new to import.");
    return;
  }

  log(`Writing ${toAdd.length} new entries…`);

  const BATCH_LIMIT = 400;
  for (let i = 0; i < toAdd.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    const chunk = toAdd.slice(i, i + BATCH_LIMIT);
    chunk.forEach((r) => {
      const ref = doc(collection(db, "entries"));
      batch.set(ref, {
        date: r.date,
        word: r.word,
        g1: r.g1,
        g2: r.g2,
        result: computeResult(r.g1, r.g2),
        createdAt: Date.now()
      });
    });
    await batch.commit();
    log(`Committed rows ${i + 1}–${Math.min(i + BATCH_LIMIT, toAdd.length)}.`);
  }

  log(`Done. Imported ${toAdd.length} games. Open index.html to see them.`);
};
