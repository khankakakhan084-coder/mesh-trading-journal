# 📈 Mesh Trading Journal

A professional, aesthetic Trading Journal tool designed specifically for traders to log trades with Pair, Direction, R:R, Result, PnL, Screenshots, and Video recordings — all saved into a persistent local file (`data/trades.json`).

---

## 🚀 Kaise Start Karein (How to Start)

### Tarika 1: 1-Click Launch (Sab se aasan)
Sirf **`start_journal.bat`** file par double click karein!
- Ye background mai local server start karega.
- Aapka default web browser automatically `http://localhost:3000` par open ho jayega.

### Tarika 2: Terminal / Command Prompt se
```bash
cd "c:\Users\khank\OneDrive\Documents\Adil Journal"
npm start
```
Uske baad browser mai open karein: **`http://localhost:3000`**

---

## 🎯 Features & Capabilities

1. **Trade Entry Details**:
   - **Pair**: e.g., `EURUSD`, `GBPUSD`, `XAUUSD (Gold)`, `BTCUSDT`, `NAS100` (Quick chip buttons included).
   - **Direction**: `🟢 BUY / LONG` ya `🔴 SELL / SHORT`.
   - **R:R (Risk to Reward)**: e.g., `1:2`, `1:3`, `1:4.5` (Auto calculates PnL multiples).
   - **Result**: `🏆 WIN`, `❌ LOSS`, `⚖️ BREAK-EVEN`, `⏳ OPEN`.
   - **PnL (R multiples)**: e.g., `+3.2R` or `-1.0R`.
   - **Date, Time & Session**: London, New York, Asian, Frankfurt.
   - **Confluence / Strategy**: e.g. Fair Value Gap (FVG), Liquidity Sweep, Order Block, Breakout.
   - **Trade Notes & Mistakes**: Apni psychology aur analysis likhein.

2. **📸 Screenshot Attachment**:
   - Drag & drop ya click karke upload karein.
   - **Direct Clipboard Paste (`Ctrl + V`)**: TradingView par `Alt + S` -> `Copy Image` karke seedha journal modal mai `Ctrl + V` dabayein, screenshot foran attach ho jayega!
   - Fullscreen Zoom / Lightbox feature.

3. **🎥 Video Recording Attachment**:
   - Trade ki screen recording, execution clip ya replay video (MP4, WEBM, MOV) upload karein (up to 1GB).
   - In-app built-in video player with play/pause, scrub, volume and fullscreen.

4. **💾 Single File Storage ("ye sb ek file mai save hota rhai")**:
   - Har trade, screenshot reference, video reference, notes, R:R aur result automatically **`data/trades.json`** file mai save hota rehta hai.
   - **Export JSON**: Top bar se 1-click mai backup file download kar sakte hain.
   - **Import JSON**: Agar kabhi backup restore karna ho ya dusri file load karni ho.

5. **📊 Live Analytics & Equity Curve**:
   - Live Win Rate %, Total Trades, Net R gained, Profit Factor.
   - Interactive Cumulative Equity Curve (Chart.js) jo aapki trading progress visual chart mai dikhata hai.
   - Grid View & Table View toggles.
   - Filter by Pair, Direction (Long/Short), Result (Win/Loss), ya Media (Screenshot/Video).

---

## 📁 Folder Structure

```
Adil Journal/
├── data/
│   └── trades.json          <-- AAPKI SAARI TRADES ISS SINGLE FILE MAI SAVE HOTI HAIN
├── uploads/
│   ├── images/              <-- Uploaded trade screenshots
│   └── videos/              <-- Uploaded trade videos
├── public/
│   ├── index.html           <-- Dark modern trading dashboard UI
│   ├── style.css            <-- Styles & animations
│   └── app.js               <-- Dashboard logic & chart
├── server.js                <-- Express server & API endpoints
├── start_journal.bat        <-- Double click to run
├── package.json
└── README.md
```
