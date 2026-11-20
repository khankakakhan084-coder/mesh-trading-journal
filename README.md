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
npm install
npm start
```
Uske baad browser mai open karein: **`http://localhost:3000`**

---

## 🎯 Features & Capabilities

1. **Trade Entry Details**: Pair, Direction (Long/Short), R:R, Result, PnL, Notes
2. **📸 Screenshot Attachment**: Drag & drop, click upload, or Ctrl+V clipboard paste
3. **🎥 Video Recording**: Upload trade replays (MP4, WEBM, MOV) up to 1GB
4. **💾 Single File Storage**: All trades saved in `data/trades.json`
5. **📊 Live Analytics**: Win rate, equity curve, profit factor
6. **☁️ Supabase Cloud Sync**: Row-level security, cross-device sync

---

## 📁 Folder Structure

```
mesh-trading-journal/
├── data/
│   └── trades.json          <-- All trades saved here
├── uploads/
│   ├── images/              <-- Trade screenshots
│   └── videos/              <-- Trade videos
├── public/
│   ├── index.html           <-- Landing page
│   ├── app.html             <-- Main dashboard
│   ├── app.js               <-- Dashboard logic
│   ├── style.css            <-- Styles & animations
│   └── config.example.js    <-- Config template (copy to config.js)
├── server.js                <-- Express server & API
├── vercel.json              <-- Vercel deployment config
├── start_journal.bat        <-- Double click to run locally
├── package.json
└── README.md
```

## Setup

1. Clone the repo
2. Copy `public/config.example.js` to `public/config.js` and add your Supabase keys
3. Run `npm install`
4. Run `npm start`