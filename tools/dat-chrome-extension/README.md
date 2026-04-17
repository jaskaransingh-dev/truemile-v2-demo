# TrueMile DAT Ranker — Chrome Extension

Ranks visible DAT load search results using the TrueMile dispatch engine, directly inside the DAT One interface.

---

## What It Does

1. Injects a sidebar into `one.dat.com/search-loads`.
2. When you click **Rank Loads**, it scrapes the visible load rows from the DAT search results.
3. Sends the loads to your local (or Railway-deployed) TrueMile backend at `/api/dev/dispatch/rank-loads-v2`.
4. Renders ranked results in the sidebar with scores, RPM, net profit, and MCI market data.
5. Highlights the **#1 load** (blue outline) and **#2 load** (green outline) directly in the DAT table.

---

## Installation (Developer Mode)

1. Open Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** (toggle top-right).
3. Click **Load unpacked**.
4. Select this folder: `tools/dat-chrome-extension/`.
5. The extension icon will appear in the Chrome toolbar.

---

## Configuration

Click the extension icon in the toolbar to open the settings popup.

| Field | Description | Default |
|---|---|---|
| Backend URL | URL of your TrueMile backend | `http://localhost:3000` |
| Home City / State | Driver's home base | Dallas, TX |
| Trailer Type | `DRY_VAN`, `REEFER`, or `FLATBED` | `DRY_VAN` |
| Avoid States | Comma-separated state codes to reject | (empty) |
| Min RPM | Hard floor — loads below this are rejected | `1.80` |
| Target RPM | Used in daily revenue score ceiling | `2.10` |
| Variable CPM | Fuel + variable cost per mile | `1.50` |
| Factoring Rate | Broker factoring fee (e.g. `0.018` = 1.8%) | `0.018` |
| Avg Daily Miles | Driver's average miles per day | `550` |
| Cycle Days | Total days-out per cycle | `17` |
| Home Days | Days home between cycles | `3` |
| Completed Cycles | Cycles completed since `cycleStartDate` | `0` |
| Cycle Start Date | Anchor date for cycle math | Today |

Click **Save Settings** after making changes.

---

## Notes

- **No fake datetimes**: The extension does not send `deliveryDate` or `deliveryDeadline` to the engine. When DAT doesn't show delivery info, the engine handles the missing fields gracefully — the delivery score component is excluded and its weight redistributed.
- **Local backend**: The extension calls `http://localhost:3000` by default. Make sure your backend is running (`npm run dev` in `backend/`).
- **Railway backend**: Change the Backend URL to your Railway deployment URL if testing against production.
- **CORS**: The backend's CORS config must allow `chrome-extension://` origins, or you can use the Railway URL from the popup and test against the deployed backend.
- **DAT DOM changes**: If DAT updates their UI, the row scraper selectors in `content.js` may need updating. Look for the `scrapeRows()` function.
- The extension runs only on `https://one.dat.com/search-loads*` — it does not affect any other pages.
