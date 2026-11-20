const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { exec } = require('child_process');

const app = express();
const DEFAULT_PORT = 3000;

// Directories
const DATA_DIR = path.join(__dirname, 'data');
const TRADES_FILE = path.join(DATA_DIR, 'trades.json');
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const IMAGES_DIR = path.join(UPLOADS_DIR, 'images');
const VIDEOS_DIR = path.join(UPLOADS_DIR, 'videos');

// Ensure all required folders exist
[DATA_DIR, UPLOADS_DIR, IMAGES_DIR, VIDEOS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Ensure trades.json exists
if (!fs.existsSync(TRADES_FILE)) {
  fs.writeFileSync(TRADES_FILE, JSON.stringify([], null, 2), 'utf8');
}

// Helpers for Reading & Writing JSON File safely
function getTrades() {
  try {
    if (!fs.existsSync(TRADES_FILE)) return [];
    const raw = fs.readFileSync(TRADES_FILE, 'utf8');
    return JSON.parse(raw || '[]');
  } catch (err) {
    console.error('Error reading trades.json:', err);
    return [];
  }
}

function saveTrades(trades) {
  try {
    const tempFile = TRADES_FILE + '.tmp';
    fs.writeFileSync(tempFile, JSON.stringify(trades, null, 2), 'utf8');
    fs.renameSync(tempFile, TRADES_FILE);
    return true;
  } catch (err) {
    console.error('Error writing trades.json:', err);
    return false;
  }
}

// Helper to calculate PnL in R automatically from R:R and Result
function calculatePnL(rr, result) {
  const res = (result || '').trim().toUpperCase();
  if (res === 'LOSS') {
    return -1.0;
  }
  if (res === 'BREAKEVEN') {
    return 0.0;
  }
  if (res === 'WIN') {
    if (!rr) return 1.0;
    const cleanRR = rr.toString().replace(/\s+/g, '');
    const parts = cleanRR.split(':');
    let target = parseFloat(parts.length > 1 ? parts[1] : parts[0]);
    if (isNaN(target) || target <= 0) target = 1.0;
    return target;
  }
  return 0.0;
}

// ----------------- COMPRESSION UTILITIES (FFmpeg) -----------------

// Compress video using FFmpeg (H.264 CRF 28 + AAC + faststart)
function compressVideoFile(inputPath) {
  return new Promise((resolve) => {
    try {
      const ext = path.extname(inputPath);
      const dir = path.dirname(inputPath);
      const baseName = path.basename(inputPath, ext);
      const outputPath = path.join(dir, `${baseName}_optimized.mp4`);

      // Scale to max 1920 width, preserve aspect ratio (even dimensions), crf 28 for high compression
      const cmd = `ffmpeg -y -i "${inputPath}" -vf "scale='min(1920,iw)':-2" -c:v libx264 -crf 28 -preset veryfast -c:a aac -b:a 128k -movflags +faststart "${outputPath}"`;

      exec(cmd, (err) => {
        if (err || !fs.existsSync(outputPath)) {
          console.warn('Video compression fallback (using original):', err ? err.message : 'Output missing');
          return resolve({
            filename: path.basename(inputPath),
            path: inputPath
          });
        }

        const origSize = fs.statSync(inputPath).size;
        const compSize = fs.statSync(outputPath).size;
        console.log(`Video compressed: ${(origSize / 1024 / 1024).toFixed(2)} MB -> ${(compSize / 1024 / 1024).toFixed(2)} MB`);

        // Remove the original heavy file
        try { fs.unlinkSync(inputPath); } catch (e) {}

        resolve({
          filename: path.basename(outputPath),
          path: outputPath,
          originalSize: origSize,
          compressedSize: compSize
        });
      });
    } catch (e) {
      console.error('Error in video compression handler:', e);
      resolve({ filename: path.basename(inputPath), path: inputPath });
    }
  });
}

// Convert image to WebP if not already WebP
function compressImageFile(inputPath) {
  return new Promise((resolve) => {
    try {
      const ext = path.extname(inputPath).toLowerCase();
      if (ext === '.webp') {
        return resolve({ filename: path.basename(inputPath), path: inputPath });
      }

      const dir = path.dirname(inputPath);
      const baseName = path.basename(inputPath, ext);
      const outputPath = path.join(dir, `${baseName}_optimized.webp`);

      const cmd = `ffmpeg -y -i "${inputPath}" -c:v libwebp -quality 82 "${outputPath}"`;

      exec(cmd, (err) => {
        if (err || !fs.existsSync(outputPath)) {
          return resolve({ filename: path.basename(inputPath), path: inputPath });
        }

        // Remove original heavier file
        try { fs.unlinkSync(inputPath); } catch (e) {}

        resolve({
          filename: path.basename(outputPath),
          path: outputPath
        });
      });
    } catch (e) {
      resolve({ filename: path.basename(inputPath), path: inputPath });
    }
  });
}

// Multer Disk Storage Configuration
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    if (file.fieldname === 'video') {
      cb(null, VIDEOS_DIR);
    } else {
      cb(null, IMAGES_DIR);
    }
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '';
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const unique = Date.now() + '_' + Math.round(Math.random() * 1e5);
    cb(null, `${cleanName}_${unique}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 1024 * 1024 * 1024 // 1GB limit for videos
  }
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ extended: true, limit: '100mb' }));

// Static asset folders
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads/images', express.static(IMAGES_DIR));
app.use('/uploads/videos', express.static(VIDEOS_DIR));

// Page routes
app.get(['/app', '/journal'], (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/landing', (req, res) => res.sendFile(path.join(__dirname, 'public', 'landing.html')));

// ----------------- API ROUTES -----------------

// 1. Get all trades
app.get('/api/trades', (req, res) => {
  const trades = getTrades();
  trades.sort((a, b) => new Date(b.createdAt || b.date) - new Date(a.createdAt || a.date));
  res.json({ success: true, count: trades.length, trades });
});

// 2. Add new trade (with automatic compression)
app.post(
  '/api/trades',
  upload.fields([
    { name: 'screenshot', maxCount: 1 },
    { name: 'video', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const { pair, direction, rr, result, notes } = req.body;

      if (!pair || !direction || !result) {
        return res.status(400).json({ success: false, message: 'Pair, Direction, and Result are required!' });
      }

      let screenshotPath = null;
      let screenshotFilename = null;
      let videoPath = null;
      let videoFilename = null;

      // Process and compress screenshot
      if (req.files && req.files['screenshot'] && req.files['screenshot'][0]) {
        const file = req.files['screenshot'][0];
        const compressedImg = await compressImageFile(file.path);
        screenshotPath = `/uploads/images/${compressedImg.filename}`;
        screenshotFilename = compressedImg.filename;
      }

      // Process and compress video
      if (req.files && req.files['video'] && req.files['video'][0]) {
        const file = req.files['video'][0];
        const compressedVid = await compressVideoFile(file.path);
        videoPath = `/uploads/videos/${compressedVid.filename}`;
        videoFilename = compressedVid.filename;
      }

      // Automatically compute PnL in R
      const numericPnl = calculatePnL(rr, result);
      const now = new Date();
      const dateStr = now.toISOString().split('T')[0];
      const timeStr = now.toTimeString().split(' ')[0].substring(0, 5);

      const newTrade = {
        id: 'trade_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
        pair: pair.trim().toUpperCase(),
        direction: direction.trim().toUpperCase(), // LONG or SHORT
        rr: (rr || '').trim(),
        result: result.trim().toUpperCase(), // WIN, LOSS, BREAKEVEN
        pnl: numericPnl,
        notes: (notes || '').trim(),
        date: dateStr,
        time: timeStr,
        screenshot: screenshotPath,
        screenshotName: screenshotFilename,
        video: videoPath,
        videoName: videoFilename,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      };

      const trades = getTrades();
      trades.unshift(newTrade);
      saveTrades(trades);

      res.status(201).json({ success: true, message: 'Trade & media saved to file!', trade: newTrade });
    } catch (err) {
      console.error('Error creating trade:', err);
      res.status(500).json({ success: false, message: 'Server error saving trade: ' + err.message });
    }
  }
);

// 3. Update existing trade (with compression)
app.put(
  '/api/trades/:id',
  upload.fields([
    { name: 'screenshot', maxCount: 1 },
    { name: 'video', maxCount: 1 }
  ]),
  async (req, res) => {
    try {
      const tradeId = req.params.id;
      const trades = getTrades();
      const index = trades.findIndex((t) => t.id === tradeId);

      if (index === -1) {
        return res.status(404).json({ success: false, message: 'Trade not found' });
      }

      const existing = trades[index];
      const screenshotFile = req.files && req.files['screenshot'] ? req.files['screenshot'][0] : null;
      const videoFile = req.files && req.files['video'] ? req.files['video'][0] : null;

      // Handle Screenshot replacement / removal
      let screenshot = existing.screenshot;
      let screenshotName = existing.screenshotName;
      if (screenshotFile) {
        if (existing.screenshot) {
          const oldPath = path.join(__dirname, existing.screenshot);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) {}
          }
        }
        const compressedImg = await compressImageFile(screenshotFile.path);
        screenshot = `/uploads/images/${compressedImg.filename}`;
        screenshotName = compressedImg.filename;
      } else if (req.body.removeScreenshot === 'true') {
        if (existing.screenshot) {
          const oldPath = path.join(__dirname, existing.screenshot);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) {}
          }
        }
        screenshot = null;
        screenshotName = null;
      }

      // Handle Video replacement / removal
      let video = existing.video;
      let videoName = existing.videoName;
      if (videoFile) {
        if (existing.video) {
          const oldPath = path.join(__dirname, existing.video);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) {}
          }
        }
        const compressedVid = await compressVideoFile(videoFile.path);
        video = `/uploads/videos/${compressedVid.filename}`;
        videoName = compressedVid.filename;
      } else if (req.body.removeVideo === 'true') {
        if (existing.video) {
          const oldPath = path.join(__dirname, existing.video);
          if (fs.existsSync(oldPath)) {
            try { fs.unlinkSync(oldPath); } catch (e) {}
          }
        }
        video = null;
        videoName = null;
      }

      const pair = req.body.pair ? req.body.pair.trim().toUpperCase() : existing.pair;
      const direction = req.body.direction ? req.body.direction.trim().toUpperCase() : existing.direction;
      const rr = req.body.rr !== undefined ? req.body.rr.trim() : existing.rr;
      const result = req.body.result ? req.body.result.trim().toUpperCase() : existing.result;
      const notes = req.body.notes !== undefined ? req.body.notes.trim() : existing.notes;

      // Recalculate PnL
      const numericPnl = calculatePnL(rr, result);

      const updatedTrade = {
        ...existing,
        pair,
        direction,
        rr,
        result,
        pnl: numericPnl,
        notes,
        screenshot,
        screenshotName,
        video,
        videoName,
        updatedAt: new Date().toISOString()
      };

      trades[index] = updatedTrade;
      saveTrades(trades);

      res.json({ success: true, message: 'Trade updated successfully!', trade: updatedTrade });
    } catch (err) {
      console.error('Error updating trade:', err);
      res.status(500).json({ success: false, message: 'Server error updating trade: ' + err.message });
    }
  }
);

// 4. Delete trade
app.delete('/api/trades/:id', (req, res) => {
  try {
    const tradeId = req.params.id;
    const trades = getTrades();
    const trade = trades.find((t) => t.id === tradeId);

    if (!trade) {
      return res.status(404).json({ success: false, message: 'Trade not found' });
    }

    if (trade.screenshot) {
      const imgPath = path.join(__dirname, trade.screenshot);
      if (fs.existsSync(imgPath)) {
        try { fs.unlinkSync(imgPath); } catch (e) {}
      }
    }

    if (trade.video) {
      const vidPath = path.join(__dirname, trade.video);
      if (fs.existsSync(vidPath)) {
        try { fs.unlinkSync(vidPath); } catch (e) {}
      }
    }

    const filtered = trades.filter((t) => t.id !== tradeId);
    saveTrades(filtered);

    res.json({ success: true, message: 'Trade removed from journal file' });
  } catch (err) {
    console.error('Error deleting trade:', err);
    res.status(500).json({ success: false, message: 'Failed to delete trade' });
  }
});

// 5. Direct file export
app.get('/api/export', (req, res) => {
  const filePath = TRADES_FILE;
  res.download(filePath, `mesh_trades_${new Date().toISOString().split('T')[0]}.json`);
});

// 6. Direct file import
const jsonUpload = multer({ dest: path.join(__dirname, 'uploads') });
app.post('/api/import', jsonUpload.single('file'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No JSON file uploaded' });
    }
    const content = fs.readFileSync(req.file.path, 'utf8');
    const parsed = JSON.parse(content);

    if (!Array.isArray(parsed)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({ success: false, message: 'Invalid format: Must be an array of trades' });
    }

    const mode = req.body.mode || 'merge';
    let currentTrades = getTrades();

    if (mode === 'replace') {
      currentTrades = parsed;
    } else {
      const existingIds = new Set(currentTrades.map((t) => t.id));
      parsed.forEach((t) => {
        if (!existingIds.has(t.id)) {
          currentTrades.push(t);
        }
      });
    }

    saveTrades(currentTrades);
    fs.unlinkSync(req.file.path);

    res.json({
      success: true,
      message: `Imported successfully! Total trades in file: ${currentTrades.length}`,
      count: currentTrades.length
    });
  } catch (err) {
    if (req.file && fs.existsSync(req.file.path)) {
      try { fs.unlinkSync(req.file.path); } catch (e) {}
    }
    res.status(500).json({ success: false, message: 'Failed to import JSON: ' + err.message });
  }
});

// 7. Stats and Analytics
app.get('/api/stats', (req, res) => {
  try {
    const trades = getTrades();
    let wins = 0;
    let losses = 0;
    let breakevens = 0;
    let totalR = 0;
    let grossWinsR = 0;
    let grossLossR = 0;

    trades.forEach((t) => {
      const res = (t.result || '').toUpperCase();
      const rVal = parseFloat(t.pnl) || 0;

      if (res === 'WIN') {
        wins++;
        grossWinsR += Math.max(0, rVal);
      } else if (res === 'LOSS') {
        losses++;
        grossLossR += Math.abs(Math.min(0, rVal));
      } else if (res === 'BREAKEVEN') {
        breakevens++;
      }

      totalR += rVal;
    });

    const totalTrades = wins + losses + breakevens;
    const winRate = totalTrades > 0 ? ((wins / totalTrades) * 100).toFixed(1) : '0.0';
    const profitFactor = grossLossR > 0 ? (grossWinsR / grossLossR).toFixed(2) : grossWinsR > 0 ? 'MAX' : '0.00';

    // Equity Curve
    const chronological = [...trades].sort((a, b) => new Date(a.createdAt || a.date) - new Date(b.createdAt || b.date));
    let runningR = 0;
    const equityCurve = chronological.map((t, idx) => {
      runningR += parseFloat(t.pnl) || 0;
      return {
        index: idx + 1,
        date: t.date,
        pair: t.pair,
        result: t.result,
        pnl: parseFloat(t.pnl) || 0,
        cumulativeR: Number(runningR.toFixed(2))
      };
    });

    res.json({
      success: true,
      stats: {
        totalTrades: trades.length,
        wins,
        losses,
        breakevens,
        winRate: parseFloat(winRate),
        totalR: Number(totalR.toFixed(2)),
        profitFactor,
        equityCurve
      }
    });
  } catch (err) {
    console.error('Error getting stats:', err);
    res.status(500).json({ success: false, message: 'Stats error' });
  }
});

// Dynamic Port Startup
function startServer(port) {
  const server = app.listen(port, () => {
    console.log(`\n=============================================================`);
    console.log(`   MESH TRADING JOURNAL IS RUNNING!`);
    console.log(`   Open in Browser: http://localhost:${port}`);
    console.log(`   Trades file:     ${TRADES_FILE}`);
    console.log(`   Screenshots dir: ${IMAGES_DIR} (Auto WebP Compression)`);
    console.log(`   Videos dir:      ${VIDEOS_DIR} (Auto H.264 MP4 Compression)`);
    console.log(`=============================================================\n`);
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.log(`Port ${port} is in use, trying port ${port + 1}...`);
      startServer(port + 1);
    } else {
      console.error('Server error:', err);
    }
  });
}

startServer(DEFAULT_PORT);
