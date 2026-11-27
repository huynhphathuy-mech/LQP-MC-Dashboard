/* ============================================================================
   LQP MC DASHBOARD - ENHANCEMENTS ENGINE (v2.0)
   1. Executive 5-Gate Summary (All LQ / CLQM / CLQU) + Interactive Drill-Down
   2. Dark / Light Mode & Laptop / Phone Mode
   3. Live Sync Data + Timestamp Badge + Separate manual_data.json Auto-Merge
   4. Admin Mode (Simple PIN + AES-GCM Encrypted Local GitHub PAT + Auto-Save)
      & Strict Read-Only Viewer Protection
   5. Share Link / QR Code Modal & Export PDF (jsPDF + AutoTable)
   6. Table Column Resizing
   ============================================================================ */

(function () {
    "use strict";

    const GH_OWNER_DEFAULT = "huynhphathuy-mech";
    const GH_REPO_DEFAULT = "LQP-MC-Dashboard";
    const GH_BRANCH_DEFAULT = "main";
    const LIVE_URL = "https://huynhphathuy-mech.github.io/LQP-MC-Dashboard/";

    const LS_THEME = "lqp_theme_mode";
    const LS_PHONE = "lqp_phone_mode";
    const LS_ADMIN_VAULT = "lqp_admin_vault_v1";

    let currentScope = "ALL"; // 'ALL' | 'CLQM' | 'CLQU'
    let currentExecSys = "ALL";
    let currentExecSearch = "";

    let isAdminUnlocked = false;
    let activeGithubToken = null;
    let activeGhConfig = { owner: GH_OWNER_DEFAULT, repo: GH_REPO_DEFAULT, branch: GH_BRANCH_DEFAULT };
    let ghSaveTimer = null;
    let latestUpdatedAt = "";
    let latestSyncSource = "";

    // =========================================================================
    // TOAST NOTIFICATIONS
    // =========================================================================
    function showToast(msg, type = "info", duration = 3500) {
        let container = document.getElementById("enh-toast-container");
        if (!container) {
            container = document.createElement("div");
            container.id = "enh-toast-container";
            document.body.appendChild(container);
        }
        const el = document.createElement("div");
        el.className = `enh-toast ${type}`;
        el.textContent = msg;
        container.appendChild(el);
        setTimeout(() => {
            el.style.opacity = "0";
            el.style.transition = "opacity 0.25s";
            setTimeout(() => el.remove(), 260);
        }, duration);
    }
    window.showDashboardToast = showToast;

    // =========================================================================
    // WEB CRYPTO HELPERS (PBKDF2 + AES-GCM FOR LOCAL PIN-PROTECTED TOKEN VAULT)
    // =========================================================================
    function bufToB64(buf) {
        const bytes = new Uint8Array(buf);
        let bin = "";
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        return btoa(bin);
    }
    function b64ToBuf(b64) {
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return bytes;
    }

    async function deriveKeyFromPin(pin, saltBytes) {
        const enc = new TextEncoder();
        const keyMat = await crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]);
        return crypto.subtle.deriveKey(
            { name: "PBKDF2", salt: saltBytes, iterations: 120000, hash: "SHA-256" },
            keyMat,
            { name: "AES-GCM", length: 256 },
            false,
            ["encrypt", "decrypt"]
        );
    }

    async function saveAdminVault(pin, token, owner, repo, branch) {
        const payload = JSON.stringify({
            token: token || "",
            owner: owner || GH_OWNER_DEFAULT,
            repo: repo || GH_REPO_DEFAULT,
            branch: branch || GH_BRANCH_DEFAULT,
            offlineOnly: !token
        });

        if (window.crypto && window.crypto.subtle) {
            const salt = crypto.getRandomValues(new Uint8Array(16));
            const iv = crypto.getRandomValues(new Uint8Array(12));
            const key = await deriveKeyFromPin(pin, salt);
            const encBytes = await crypto.subtle.encrypt(
                { name: "AES-GCM", iv },
                key,
                new TextEncoder().encode(payload)
            );
            localStorage.setItem(LS_ADMIN_VAULT, JSON.stringify({
                mode: "aes",
                salt: bufToB64(salt),
                iv: bufToB64(iv),
                cipher: bufToB64(encBytes)
            }));
        } else {
            // Fallback for file:// non-secure contexts where SubtleCrypto may be unavailable
            const hash = Array.from(pin).reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
            localStorage.setItem(LS_ADMIN_VAULT, JSON.stringify({
                mode: "plain_local",
                pinCheck: String(hash),
                payload: btoa(unescape(encodeURIComponent(payload)))
            }));
        }
    }

    async function unlockAdminVault(pin) {
        const raw = localStorage.getItem(LS_ADMIN_VAULT);
        if (!raw) throw new Error("NO_VAULT");
        const vault = JSON.parse(raw);

        if (vault.mode === "aes" && window.crypto && window.crypto.subtle) {
            const salt = b64ToBuf(vault.salt);
            const iv = b64ToBuf(vault.iv);
            const cipher = b64ToBuf(vault.cipher);
            const key = await deriveKeyFromPin(pin, salt);
            const decBuf = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
            return JSON.parse(new TextDecoder().decode(decBuf));
        }
        if (vault.mode === "plain_local") {
            const hash = Array.from(pin).reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0);
            if (String(hash) !== vault.pinCheck) throw new Error("WRONG_PIN");
            return JSON.parse(decodeURIComponent(escape(atob(vault.payload))));
        }
        throw new Error("UNSUPPORTED_VAULT");
    }

    // =========================================================================
    // VIEWER READ-ONLY vs ADMIN MODE CONTROLLER
    // =========================================================================
    function applyPermissionMode() {
        if (isAdminUnlocked) {
            document.body.classList.remove("viewer-mode");
            document.body.classList.add("admin-mode");
        } else {
            document.body.classList.add("viewer-mode");
            document.body.classList.remove("admin-mode");
        }
        const adminBtn = document.getElementById("btn-admin-toggle");
        if (adminBtn) {
            if (isAdminUnlocked) {
                adminBtn.classList.add("btn-pill-admin-on");
                adminBtn.innerHTML = activeGithubToken ? "🔓 Admin ON (Auto-Save)" : "🔓 Admin ON (Local)";
            } else {
                adminBtn.classList.remove("btn-pill-admin-on");
                adminBtn.innerHTML = "🔒 Admin";
            }
        }
        const modeTag = document.getElementById("mode-role-badge");
        if (modeTag) {
            modeTag.textContent = isAdminUnlocked ? "Admin (Edit Enabled)" : "Read-Only Viewer";
        }
    }

    window.isDashboardAdmin = () => isAdminUnlocked;

    function openAdminModal() {
        const modal = document.getElementById("enh-admin-modal");
        if (!modal) return;

        const hasVault = !!localStorage.getItem(LS_ADMIN_VAULT);
        const setupBox = document.getElementById("admin-setup-section");
        const loginBox = document.getElementById("admin-login-section");
        const activeBox = document.getElementById("admin-active-section");
        const errBox = document.getElementById("admin-modal-error");
        if (errBox) errBox.style.display = "none";

        if (isAdminUnlocked) {
            setupBox.style.display = "none";
            loginBox.style.display = "none";
            activeBox.style.display = "flex";
            const statusText = document.getElementById("admin-active-status");
            if (statusText) {
                statusText.textContent = activeGithubToken
                    ? `Connected to GitHub (${activeGhConfig.owner}/${activeGhConfig.repo}). All manual edits auto-save straight to GitHub!`
                    : "Local Admin Mode active (no GitHub Token set — edits save locally in browser).";
            }
        } else if (hasVault) {
            setupBox.style.display = "none";
            loginBox.style.display = "flex";
            activeBox.style.display = "none";
            const pinIn = document.getElementById("admin-login-pin");
            if (pinIn) { pinIn.value = ""; setTimeout(() => pinIn.focus(), 60); }
        } else {
            setupBox.style.display = "flex";
            loginBox.style.display = "none";
            activeBox.style.display = "none";
        }
        modal.style.display = "flex";
    }
    window.openAdminModal = openAdminModal;

    function closeAdminModal() {
        const modal = document.getElementById("enh-admin-modal");
        if (modal) modal.style.display = "none";
    }

    function showAdminError(msg) {
        const errBox = document.getElementById("admin-modal-error");
        if (errBox) {
            errBox.textContent = msg;
            errBox.style.display = "block";
        }
    }

    async function handleAdminSetupSubmit() {
        const pin = (document.getElementById("admin-setup-pin")?.value || "").trim();
        const token = (document.getElementById("admin-setup-token")?.value || "").trim();
        if (pin.length < 4) {
            showAdminError("Please enter a PIN / password with at least 4 characters.");
            return;
        }
        try {
            await saveAdminVault(pin, token, GH_OWNER_DEFAULT, GH_REPO_DEFAULT, GH_BRANCH_DEFAULT);
            activeGithubToken = token || null;
            activeGhConfig = { owner: GH_OWNER_DEFAULT, repo: GH_REPO_DEFAULT, branch: GH_BRANCH_DEFAULT };
            isAdminUnlocked = true;
            applyPermissionMode();
            closeAdminModal();
            showToast(token ? "Admin unlocked! Auto-Save to GitHub is ACTIVE." : "Local Admin unlocked!", "success");
        } catch (err) {
            showAdminError("Failed to save Admin configuration: " + err.message);
        }
    }

    async function handleAdminLoginSubmit() {
        const pin = (document.getElementById("admin-login-pin")?.value || "").trim();
        if (!pin) {
            showAdminError("Please enter your Admin PIN.");
            return;
        }
        try {
            const cfg = await unlockAdminVault(pin);
            activeGithubToken = cfg.token || null;
            activeGhConfig = {
                owner: cfg.owner || GH_OWNER_DEFAULT,
                repo: cfg.repo || GH_REPO_DEFAULT,
                branch: cfg.branch || GH_BRANCH_DEFAULT
            };
            isAdminUnlocked = true;
            applyPermissionMode();
            closeAdminModal();
            showToast(activeGithubToken ? "🔓 Admin Mode ON (GitHub Auto-Save active)" : "🔓 Local Admin Mode ON", "success");
        } catch (err) {
            showAdminError("❌ Incorrect PIN! Please try again.");
        }
    }

    function handleAdminLock() {
        isAdminUnlocked = false;
        activeGithubToken = null;
        applyPermissionMode();
        closeAdminModal();
        showToast("🔒 Locked back to Read-Only Viewer Mode.", "info");
    }

    function handleAdminResetVault() {
        if (!confirm("Reset Admin PIN & GitHub Token on this browser?")) return;
        localStorage.removeItem(LS_ADMIN_VAULT);
        isAdminUnlocked = false;
        activeGithubToken = null;
        applyPermissionMode();
        openAdminModal();
        showToast("Admin configuration cleared on this device.", "warn");
    }

    // =========================================================================
    // MANUAL DATA SEPARATION & AUTO-SAVE TO GITHUB (manual_data.json / .js)
    // =========================================================================
    function extractCleanManualPayload() {
        const gd = window.GLOBAL_MC_DATA || {};
        const manualItrA = (gd.globalCompletedChecksheets || []).filter(x => x && x.isManual);
        const manualItrB = (gd.globalCompletedPrecomChecksheets || []).filter(x => x && x.isManual);
        const manualFtp = {};
        (gd.globalFtpList || []).forEach(f => {
            if (f && (f.isManual || f.manualDate || (f.progress > 0 && !f.cmsDate))) {
                if (f.ftpNo) {
                    manualFtp[f.ftpNo] = {
                        manualDate: f.manualDate || "",
                        progress: f.progress || 0,
                        isManual: !!f.isManual
                    };
                }
            }
        });
        const sky = gd.skyData || {};
        const skyKpi = sky.hasKpi ? {
            hasKpi: true,
            kpiPlan: sky.kpiPlan || sky.itrPlanByWeek || {},
            kpiAct: sky.kpiAct || sky.itrActualByWeek || {},
            kpiDiscPlan: sky.kpiDiscPlan || sky.discPlanByWeek || {},
            kpiDiscAct: sky.kpiDiscAct || sky.discActualByWeek || {}
        } : { hasKpi: false, kpiPlan: {}, kpiAct: {}, kpiDiscPlan: {}, kpiDiscAct: {} };

        const now = new Date();
        const vnTime = new Date(now.getTime() + (7 * 60 + now.getTimezoneOffset()) * 60000);
        const pad = n => String(n).padStart(2, "0");
        const ts = `${vnTime.getFullYear()}-${pad(vnTime.getMonth() + 1)}-${pad(vnTime.getDate())} ${pad(vnTime.getHours())}:${pad(vnTime.getMinutes())}:${pad(vnTime.getSeconds())} (VN)`;

        return {
            updatedAt: ts,
            siteWalkdownPunches: (typeof siteWalkdownPunches !== "undefined" ? siteWalkdownPunches : gd.siteWalkdownPunches) || [],
            globalFlashReports: gd.globalFlashReports || [],
            manualItrA,
            manualItrB,
            manualFtp,
            subsysSkylineDates: gd.subsysSkylineDates || {},
            skyKpi
        };
    }

    function mergeManualIntoGlobalData(manual) {
        const gd = window.GLOBAL_MC_DATA;
        if (!gd || !manual) return;

        if (Array.isArray(manual.siteWalkdownPunches)) {
            gd.siteWalkdownPunches = manual.siteWalkdownPunches;
            // Sync cloud manual_data.json into localStorage so app.js loadSiteWalkdownPunches() stays 100% consistent
            try {
                const prev = localStorage.getItem("LQP_SITE_WALKDOWN_PUNCHES");
                if (prev && !localStorage.getItem("LQP_SITE_WALKDOWN_BACKUP_PRE_CLOUD")) {
                    localStorage.setItem("LQP_SITE_WALKDOWN_BACKUP_PRE_CLOUD", prev);
                }
                localStorage.setItem("LQP_SITE_WALKDOWN_PUNCHES", JSON.stringify(manual.siteWalkdownPunches));
            } catch (e) {}
            if (typeof siteWalkdownPunches !== "undefined") {
                try { siteWalkdownPunches = manual.siteWalkdownPunches; } catch (e) {}
            }
        }
        if (Array.isArray(manual.globalFlashReports)) {
            gd.globalFlashReports = manual.globalFlashReports;
        }
        if (manual.subsysSkylineDates && Object.keys(manual.subsysSkylineDates).length > 0) {
            gd.subsysSkylineDates = Object.assign({}, gd.subsysSkylineDates || {}, manual.subsysSkylineDates);
        }
        if (manual.skyKpi && manual.skyKpi.hasKpi) {
            if (!gd.skyData) gd.skyData = {};
            gd.skyData.hasKpi = true;
            gd.skyData.kpiPlan = manual.skyKpi.kpiPlan || {};
            gd.skyData.kpiAct = manual.skyKpi.kpiAct || {};
            gd.skyData.kpiDiscPlan = manual.skyKpi.kpiDiscPlan || {};
            gd.skyData.kpiDiscAct = manual.skyKpi.kpiDiscAct || {};
            gd.skyData.itrPlanByWeek = gd.skyData.kpiPlan;
            gd.skyData.itrActualByWeek = gd.skyData.kpiAct;
            gd.skyData.discPlanByWeek = gd.skyData.kpiDiscPlan;
            gd.skyData.discActualByWeek = gd.skyData.kpiDiscAct;
        }

        // Merge Manual ITR-A (CMS official wins if already present)
        if (Array.isArray(manual.manualItrA)) {
            if (!gd.globalCompletedChecksheets) gd.globalCompletedChecksheets = [];
            // Remove stale manual items and inject latest from manual_data.json
            const officialOnly = gd.globalCompletedChecksheets.filter(x => !x.isManual);
            manual.manualItrA.forEach(m => {
                const existsOfficial = officialOnly.some(o => o.subsys === m.subsys && o.disc === m.disc && o.tag === m.tag && o.formNo === m.formNo);
                if (!existsOfficial) officialOnly.push(m);
            });
            gd.globalCompletedChecksheets = officialOnly;
        }

        // Merge Manual ITR-B
        if (Array.isArray(manual.manualItrB)) {
            if (!gd.globalCompletedPrecomChecksheets) gd.globalCompletedPrecomChecksheets = [];
            const officialOnly = gd.globalCompletedPrecomChecksheets.filter(x => !x.isManual);
            manual.manualItrB.forEach(m => {
                const existsOfficial = officialOnly.some(o => o.subsys === m.subsys && o.disc === m.disc && o.tag === m.tag && o.formNo === m.formNo);
                if (!existsOfficial) officialOnly.push(m);
            });
            gd.globalCompletedPrecomChecksheets = officialOnly;
        }

        // Merge Manual FTP
        if (manual.manualFtp && gd.globalFtpList) {
            gd.globalFtpList.forEach(item => {
                const mf = manual.manualFtp[item.ftpNo];
                if (mf && !item.cmsDate) {
                    item.manualDate = mf.manualDate || "";
                    item.isManual = !!mf.isManual;
                    item.isDone = !!(item.cmsDate || item.manualDate);
                    if (mf.progress !== undefined) item.progress = mf.progress;
                }
            });
        }
    }

    async function putGithubFile(relPath, utf8Content, message) {
        const { owner, repo, branch } = activeGhConfig;
        const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${relPath}`;
        const headers = {
            "Accept": "application/vnd.github+json",
            "Authorization": `Bearer ${activeGithubToken}`,
            "Content-Type": "application/json"
        };

        let sha = null;
        const getResp = await fetch(`${apiUrl}?ref=${encodeURIComponent(branch)}&_=${Date.now()}`, { headers });
        if (getResp.ok) {
            const info = await getResp.json();
            sha = info.sha;
        } else if (getResp.status !== 404) {
            throw new Error(`GitHub read failed (${getResp.status})`);
        }

        const b64 = btoa(unescape(encodeURIComponent(utf8Content)));
        const body = { message, content: b64, branch };
        if (sha) body.sha = sha;

        const putResp = await fetch(apiUrl, { method: "PUT", headers, body: JSON.stringify(body) });
        if (!putResp.ok) {
            const errTxt = await putResp.text();
            throw new Error(`GitHub save failed (${putResp.status}): ${errTxt.slice(0, 120)}`);
        }
        return true;
    }

    async function publishManualToGitHubNow(showProgress = true) {
        if (!isAdminUnlocked || !activeGithubToken) {
            if (showProgress) showToast("Admin GitHub Token not configured on this device.", "warn");
            return false;
        }
        try {
            if (showProgress) showToast("☁️ Saving manual changes to GitHub...", "info", 2000);
            const manual = extractCleanManualPayload();
            const jsonText = JSON.stringify(manual, null, 2);
            const jsText = "window.PRELOADED_MANUAL_DATA = " + JSON.stringify(manual) + ";\n";
            const msg = `Admin Manual Update (${manual.updatedAt})`;
            await putGithubFile("manual_data.json", jsonText, msg);
            await putGithubFile("manual_data.js", jsText, msg);
            showToast("✅ Saved to GitHub! All viewers will see your update shortly.", "success", 3500);
            return true;
        } catch (err) {
            console.error("GitHub Auto-Save Error:", err);
            showToast("❌ GitHub Save Failed: " + err.message, "error", 5000);
            return false;
        }
    }
    window.publishManualToGitHubNow = publishManualToGitHubNow;

    function scheduleAutoSaveToGitHub() {
        if (!isAdminUnlocked || !activeGithubToken) return;
        if (ghSaveTimer) clearTimeout(ghSaveTimer);
        ghSaveTimer = setTimeout(() => {
            publishManualToGitHubNow(true);
        }, 1600);
    }

    // =========================================================================
    // LIVE SYNC DATA BUTTON (WORKS IDENTICALLY ON BOTH GITHUB PAGES & LOCAL index.html!)
    // =========================================================================
    async function syncLatestFromCloud(silent = false) {
        const btn = document.getElementById("btn-sync-cloud");
        if (btn) { btn.disabled = true; btn.innerHTML = "⏳ Syncing..."; }
        try {
            const bust = `t=${Date.now()}`;
            const isLocalFile = !window.location.protocol.startsWith("http");
            const mainBase = isLocalFile ? LIVE_URL : "";
            const rawBase = `https://raw.githubusercontent.com/${activeGhConfig.owner}/${activeGhConfig.repo}/${activeGhConfig.branch}/`;

            // Prefer raw.githubusercontent.com FIRST so data updates IMMEDIATELY after push
            // (zero wait for GitHub Pages rebuild/CDN cache), with fallback to GitHub Pages.
            const [resMainRaw, resManRaw] = await Promise.all([
                fetch(`${rawBase}data.json?${bust}`, { cache: "no-store" }).catch(() => null),
                fetch(`${rawBase}manual_data.json?${bust}`, { cache: "no-store" }).catch(() => null)
            ]);

            let resMain = (resMainRaw && resMainRaw.ok) ? resMainRaw : null;
            if (!resMain) {
                resMain = await fetch(`${mainBase}data.json?${bust}`, { cache: "no-store" });
            }
            if (!resMain.ok) throw new Error(`HTTP ${resMain.status}`);
            const mainJson = await resMain.json();
            if (!mainJson || !mainJson.data) throw new Error("Invalid data.json format");

            let manJson = null;
            if (resManRaw && resManRaw.ok) {
                manJson = await resManRaw.json();
            } else {
                const resManFallback = await fetch(`${mainBase}manual_data.json?${bust}`, { cache: "no-store" }).catch(() => null);
                if (resManFallback && resManFallback.ok) manJson = await resManFallback.json();
            }

            latestUpdatedAt = mainJson.updatedAt || mainJson.updateDate || "";
            latestSyncSource = mainJson.syncSource || "GitHub Cloud";

            window.GLOBAL_MC_DATA = mainJson.data;
            if (manJson) {
                mergeManualIntoGlobalData(manJson);
            }
            if (typeof applyLoadedData === "function") {
                applyLoadedData(window.GLOBAL_MC_DATA, latestUpdatedAt);
            }
            if (typeof renderSiteWalkdownTab === "function") {
                renderSiteWalkdownTab();
            }
            if (typeof saveToDB === "function") {
                saveToDB("global_mc_data", { updateDate: mainJson.updateDate, updatedAt: latestUpdatedAt, data: window.GLOBAL_MC_DATA });
            }
            updateTimestampBadge();
            if (!silent) showToast(`✅ Synced latest data from GitHub (${latestUpdatedAt})`, "success");
            return true;
        } catch (err) {
            // Fallback to preloaded local JS files when truly offline
            if (window.PRELOADED_MANUAL_DATA && window.GLOBAL_MC_DATA) {
                mergeManualIntoGlobalData(window.PRELOADED_MANUAL_DATA);
                if (typeof recalculateMasterCounts === "function") recalculateMasterCounts();
                if (typeof recalculatePrecomMasterCounts === "function") recalculatePrecomMasterCounts();
                renderExecutiveSummary();
                updateTimestampBadge();
            }
            if (!silent) {
                showToast("Offline mode — using local preloaded data on PC.", "warn");
            }
            return false;
        } finally {
            if (btn) { btn.disabled = false; btn.innerHTML = "🔄 Sync Data"; }
        }
    }
    window.syncLatestFromCloud = syncLatestFromCloud;

    function updateTimestampBadge() {
        const el = document.getElementById("header-updated-text");
        if (!el) return;
        const ts = latestUpdatedAt
            || (window.PRELOADED_MC_DATA && (window.PRELOADED_MC_DATA.updatedAt || window.PRELOADED_MC_DATA.updateDate))
            || "Loaded";
        el.textContent = `Data: ${ts}`;
    }

    // =========================================================================
    // EXECUTIVE SUMMARY & 5-GATE CLOSURE ENGINE (All LQ / CLQM / CLQU)
    // =========================================================================
    function computeScopeMetrics(prefix, sysFilter, searchQuery) {
        const gd = window.GLOBAL_MC_DATA || {};
        const matrix = gd.matrix || {};
        const precomMatrix = gd.precomMatrix || {};
        const punches = gd.globalPunchList || [];
        const certs = gd.globalCertList || [];
        const ftps = gd.globalFtpList || [];
        const rfcMap = gd.rfcMap || {};

        const q = (searchQuery || "").trim().toLowerCase();
        const matchScope = (sysOrSub) => {
            const s = String(sysOrSub || "").trim().toUpperCase();
            if (prefix && prefix !== "ALL" && !s.startsWith(prefix)) return false;
            const sysPart = s.split("-").slice(0, 2).join("-");
            if (sysFilter && sysFilter !== "ALL" && sysPart !== sysFilter) return false;
            if (q && !s.toLowerCase().includes(q)) return false;
            return true;
        };

        const sysSet = new Set();
        const subSet = new Set();
        const itrA = { done: 0, total: 0 };
        const itrB = { done: 0, total: 0 };
        const punchA = { done: 0, total: 0 };
        const punchB = { done: 0, total: 0 };
        const punchC = { done: 0, total: 0 };
        const dac = { done: 0, total: 0 };
        const cssc = { done: 0, total: 0 };
        const rfc = { done: 0, total: 0 };
        const ftp = { done: 0, total: 0 };

        // Discipline breakdown for filtered dashboard widgets
        const discGroups = {
            MECHANICAL: { itrA: {done:0,total:0}, punchA:{done:0,total:0}, punchB:{done:0,total:0}, punchC:{done:0,total:0}, dac:{done:0,total:0}, cssc:{done:0,total:0} },
            PIPING:     { itrA: {done:0,total:0}, punchA:{done:0,total:0}, punchB:{done:0,total:0}, punchC:{done:0,total:0}, dac:{done:0,total:0}, cssc:{done:0,total:0} },
            HVAC:       { itrA: {done:0,total:0}, punchA:{done:0,total:0}, punchB:{done:0,total:0}, punchC:{done:0,total:0}, dac:{done:0,total:0}, cssc:{done:0,total:0} },
            ETC:        { itrA: {done:0,total:0}, punchA:{done:0,total:0}, punchB:{done:0,total:0}, punchC:{done:0,total:0}, dac:{done:0,total:0}, cssc:{done:0,total:0} },
            SAFETY:     { itrA: {done:0,total:0}, punchA:{done:0,total:0}, punchB:{done:0,total:0}, punchC:{done:0,total:0}, dac:{done:0,total:0}, cssc:{done:0,total:0} },
            ARCH:       { itrA: {done:0,total:0}, punchA:{done:0,total:0}, punchB:{done:0,total:0}, punchC:{done:0,total:0}, dac:{done:0,total:0}, cssc:{done:0,total:0} },
            STR:        { itrA: {done:0,total:0}, punchA:{done:0,total:0}, punchB:{done:0,total:0}, punchC:{done:0,total:0}, dac:{done:0,total:0}, cssc:{done:0,total:0} },
        };
        const mapDiscGrp = (d) => {
            if (d === "MECHANICAL") return "MECHANICAL";
            if (d === "PIPING") return "PIPING";
            if (d === "HVAC") return "HVAC";
            if (d === "SAFETY") return "SAFETY";
            if (d === "ELECTRICAL" || d === "TELECOM" || d === "INSTRUMENT") return "ETC";
            if (d === "ARCHITECTURE") return "ARCH";
            if (d === "STRUCTURE") return "STR";
            return null;
        };

        // 1. Matrix (ITR-A + Systems/Subsystems)
        Object.keys(matrix).forEach(sys => {
            Object.keys(matrix[sys] || {}).forEach(sub => {
                if (!matchScope(sub)) return;
                sysSet.add(sys);
                subSet.add(sub);
                Object.keys(matrix[sys][sub] || {}).forEach(disc => {
                    const c = matrix[sys][sub][disc];
                    if (!c) return;
                    itrA.done += (c.i_d || 0);
                    itrA.total += (c.i_t || 0);
                    const g = mapDiscGrp(disc);
                    if (g && discGroups[g]) {
                        discGroups[g].itrA.done += (c.i_d || 0);
                        discGroups[g].itrA.total += (c.i_t || 0);
                    }
                });
            });
        });

        // 2. Precom Matrix (ITR-B)
        Object.keys(precomMatrix).forEach(sys => {
            Object.keys(precomMatrix[sys] || {}).forEach(sub => {
                if (!matchScope(sub)) return;
                sysSet.add(sys);
                subSet.add(sub);
                const cell = precomMatrix[sys][sub];
                if (cell && cell.disciplines) {
                    Object.values(cell.disciplines).forEach(d => {
                        itrB.done += (d.i_d || 0);
                        itrB.total += (d.i_t || 0);
                    });
                }
            });
        });

        // 3. Punches
        punches.forEach(p => {
            const key = p.subsys || p.sys || "";
            if (!matchScope(key)) return;
            const cat = String(p.cat || "").toUpperCase();
            const closed = String(p.status || "").toUpperCase().includes("CLOSE");
            const g = mapDiscGrp(p.disc);
            if (cat.includes("A")) {
                punchA.total++;
                if (closed) punchA.done++;
                if (g && discGroups[g]) { discGroups[g].punchA.total++; if (closed) discGroups[g].punchA.done++; }
            } else if (cat.includes("B")) {
                punchB.total++;
                if (closed) punchB.done++;
                if (g && discGroups[g]) { discGroups[g].punchB.total++; if (closed) discGroups[g].punchB.done++; }
            } else if (cat.includes("C")) {
                punchC.total++;
                if (closed) punchC.done++;
                if (g && discGroups[g]) { discGroups[g].punchC.total++; if (closed) discGroups[g].punchC.done++; }
            }
        });

        // 4. Certificates (DAC, CSSC, RFC)
        certs.forEach(c => {
            const key = c.subsys || c.sys || "";
            if (!matchScope(key)) return;
            const closed = c.status === "CLOSED";
            if (c.type === "DAC") {
                dac.total++;
                if (closed) dac.done++;
                const fullDisc = Object.keys({
                    MECH: "MECHANICAL", PIPI: "PIPING", HVAC: "HVAC", SAFE: "SAFETY",
                    ELEC: "ELECTRICAL", TELE: "TELECOM", INST: "INSTRUMENT", ARCH: "ARCHITECTURE", STRU: "STRUCTURE"
                }).find(k => String(c.disc || "").toUpperCase().startsWith(k));
                const mapShort = { MECH: "MECHANICAL", PIPI: "PIPING", HVAC: "HVAC", SAFE: "SAFETY", ELEC: "ETC", TELE: "ETC", INST: "ETC", ARCH: "ARCH", STRU: "STR" };
                const g = fullDisc ? mapShort[fullDisc] : null;
                if (g && discGroups[g]) { discGroups[g].dac.total++; if (closed) discGroups[g].dac.done++; }
            } else if (c.type === "CSSC") {
                cssc.total++;
                if (closed) cssc.done++;
            }
        });

        Object.keys(rfcMap).forEach(sub => {
            if (!matchScope(sub)) return;
            rfc.total++;
            if (rfcMap[sub] && rfcMap[sub].done) rfc.done++;
        });

        // 5. FTP
        ftps.forEach(f => {
            const key = f.subsys || f.sys || "";
            if (!matchScope(key)) return;
            ftp.total++;
            if (f.isDone) ftp.done++;
        });

        const fiveGateDone = itrA.done + punchA.done + punchB.done + punchC.done + itrB.done;
        const fiveGateTotal = itrA.total + punchA.total + punchB.total + punchC.total + itrB.total;
        const totalPunches = punchA.total + punchB.total + punchC.total;
        const totalChecksheets = itrA.total + itrB.total;

        return {
            sysCount: sysSet.size,
            subCount: subSet.size,
            itrA, itrB, punchA, punchB, punchC, dac, cssc, rfc, ftp,
            fiveGateDone, fiveGateTotal,
            fiveGateOpen: Math.max(0, fiveGateTotal - fiveGateDone),
            totalPunches, totalChecksheets,
            discGroups
        };
    }

    function pctStr(d, t) {
        return t > 0 ? ((d / t) * 100).toFixed(1) : "0.0";
    }

    function drillToPunch(prefix, cat) {
        if (typeof openPunchModal === "function") {
            const sysArg = (currentExecSys && currentExecSys !== "ALL" && (!prefix || prefix === "ALL" || currentExecSys.toUpperCase().startsWith(prefix)))
                ? currentExecSys
                : "ALL";
            openPunchModal("ALL", cat || "ALL", prefix || "ALL", sysArg);
        }
    }

    function drillToMatrix(prefix, tabName) {
        const tabBtn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
        if (tabBtn) tabBtn.click();
        const subInput = document.getElementById(tabName === "precom" ? "filter-precom-subsys" : "filter-subsys");
        if (subInput) {
            subInput.value = (prefix && prefix !== "ALL") ? prefix : "";
            subInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
    }

    window.getActiveExecScope = () => currentScope;
    window.getActiveExecSys = () => currentExecSys;
    window.execSetScope = function (scope) {
        currentScope = scope;
        currentExecSys = "ALL";
        renderExecutiveSummary();
    };
    window.execDrillPunch = drillToPunch;
    window.execDrillMatrix = drillToMatrix;

    function renderExecutiveSummary() {
        const container = document.getElementById("exec-summary-root");
        const gd = window.GLOBAL_MC_DATA;
        if (!container || !gd) return;

        const allM = computeScopeMetrics("ALL", "ALL", "");
        const lqmM = computeScopeMetrics("CLQM", currentScope === "CLQM" ? currentExecSys : "ALL", currentScope === "CLQM" ? currentExecSearch : "");
        const lquM = computeScopeMetrics("CLQU", currentScope === "CLQU" ? currentExecSys : "ALL", currentScope === "CLQU" ? currentExecSearch : "");
        const activeM = computeScopeMetrics(currentScope, currentExecSys, currentExecSearch);

        // Build system dropdown options for active scope
        const sysList = Object.keys(gd.matrix || {})
            .filter(s => currentScope === "ALL" || s.toUpperCase().startsWith(currentScope))
            .sort();

        const buildMiniBox = (label, d, t, color, onClickJs) => {
            const p = pctStr(d, t);
            const open = Math.max(0, t - d);
            return `
                <div class="mini-gate-box" onclick="${onClickJs}" title="Click to inspect ${label}">
                    <div class="mini-gate-top">
                        <span style="color:${color};">${label}</span>
                        <span>${p}%</span>
                    </div>
                    <div class="mini-gate-num">${d.toLocaleString()} <small>/ ${t.toLocaleString()}</small></div>
                    <div class="mini-gate-bar"><div style="width:${p}%; background:${color};"></div></div>
                    <div class="mini-gate-open"><span>Open: ${open.toLocaleString()}</span><span>→</span></div>
                </div>
            `;
        };

        const buildModuleCard = (code, title, subtitle, cls, m) => {
            const p = pctStr(m.fiveGateDone, m.fiveGateTotal);
            const dimmed = (currentScope !== "ALL" && currentScope !== code) ? "dimmed" : "";
            return `
                <div class="module-card ${dimmed}">
                    <div class="module-card-head ${cls}">
                        <div class="module-head-top">
                            <div>
                                <div class="module-name-group">
                                    <span class="module-code-tag">${code}</span>
                                    <span class="module-title">${title}</span>
                                    <span class="module-sub-meta">${m.subCount} SubSystems • ${m.sysCount} Systems</span>
                                </div>
                                <div class="module-sub-meta">${subtitle}</div>
                            </div>
                            <div class="module-head-btns">
                                <button class="mod-btn mod-btn-ghost" onclick="execSetScope('${code}')">Filter Overview</button>
                                <button class="mod-btn mod-btn-red" onclick="execDrillPunch('${code}','ALL')">Punch List (${m.totalPunches.toLocaleString()})</button>
                                <button class="mod-btn ${cls === 'lqm' ? 'mod-btn-blue' : 'mod-btn-teal'}" onclick="execDrillMatrix('${code}','mc')">Checksheet (${m.totalChecksheets.toLocaleString()})</button>
                            </div>
                        </div>
                        <div class="module-overall-row">
                            <span>OVERALL 5-GATE CLOSURE: <span class="module-overall-val">${m.fiveGateDone.toLocaleString()}</span> / ${m.fiveGateTotal.toLocaleString()} (${p}%)</span>
                            <span class="module-open-pill">Open: ${m.fiveGateOpen.toLocaleString()}</span>
                        </div>
                        <div class="module-bar-track"><div class="module-bar-fill" style="width:${p}%;"></div></div>
                    </div>
                    <div class="module-mini-grid">
                        ${buildMiniBox("ITR-A", m.itrA.done, m.itrA.total, "#3b82f6", `execDrillMatrix('${code}','mc')`)}
                        ${buildMiniBox("PUNCH CAT A", m.punchA.done, m.punchA.total, "#ef4444", `execDrillPunch('${code}','A')`)}
                        ${buildMiniBox("PUNCH CAT B", m.punchB.done, m.punchB.total, "#f59e0b", `execDrillPunch('${code}','B')`)}
                        ${buildMiniBox("PUNCH CAT C", m.punchC.done, m.punchC.total, "#0ea5e9", `execDrillPunch('${code}','C')`)}
                        ${buildMiniBox("ITR-B", m.itrB.done, m.itrB.total, "#8b5cf6", `execDrillMatrix('${code}','precom')`)}
                    </div>
                </div>
            `;
        };

        const buildGateCard = (cls, title, sub, d, t, color, onClickJs) => {
            const p = pctStr(d, t);
            const open = Math.max(0, t - d);
            return `
                <div class="gate-kpi-card ${cls}" onclick="${onClickJs}">
                    <div class="gate-kpi-head">
                        <div>
                            <div class="gate-kpi-title" style="color:${color};">${title}</div>
                            <div class="gate-kpi-sub">${sub}</div>
                        </div>
                    </div>
                    <div class="gate-kpi-main">
                        <div class="gate-kpi-big" style="color:${color};">${d.toLocaleString()} <small>/ ${t.toLocaleString()}</small></div>
                        <span class="gate-kpi-pct" style="background:${color}22; color:${color};">${p}%</span>
                    </div>
                    <div class="progress-bar"><div class="progress-fill" style="width:${p}%; background:${color};"></div></div>
                    <div class="gate-kpi-foot">
                        <span style="color:#f87171;">Open: ${open.toLocaleString()}</span>
                        <span style="color:${color};">Details →</span>
                    </div>
                </div>
            `;
        };

        const scopeLabel = currentScope === "ALL" ? "LQ MODULE & LQ UTILITY" : (currentScope === "CLQM" ? "LQ MODULE (CLQM)" : "LQ UTILITY (CLQU)");

        container.innerHTML = `
            <div class="exec-summary-wrap">
                <div class="exec-header-card">
                    <div class="exec-header-top">
                        <div>
                            <div class="exec-title-row">
                                <span class="exec-chip exec-chip-green">EXECUTIVE SUMMARY</span>
                                <span class="exec-chip exec-chip-dark">SCOPE: ${scopeLabel}</span>
                                <span class="exec-title-text">LQ MODULE &amp; LQ UTILITY — 5-Gate Closure &amp; Completion Overview</span>
                            </div>
                            <div class="exec-subtitle">Classified by SystemNo prefix: <b>CLQM = LQ MODULE</b> &amp; <b>CLQU = LQ UTILITY</b>. Click any card or gate to inspect details.</div>
                        </div>
                    </div>
                    <div class="exec-controls-row">
                        <div class="scope-pills">
                            <button type="button" class="scope-pill ${currentScope === 'ALL' ? 'active' : ''}" onclick="execSetScope('ALL')">
                                All LQ Combined <span class="pill-cnt">${allM.subCount} Subs</span>
                            </button>
                            <button type="button" class="scope-pill ${currentScope === 'CLQM' ? 'active' : ''}" onclick="execSetScope('CLQM')">
                                LQ MODULE (CLQM) <span class="pill-cnt">${computeScopeMetrics('CLQM','ALL','').subCount} Subs</span>
                            </button>
                            <button type="button" class="scope-pill ${currentScope === 'CLQU' ? 'active' : ''}" onclick="execSetScope('CLQU')">
                                LQ UTILITY (CLQU) <span class="pill-cnt">${computeScopeMetrics('CLQU','ALL','').subCount} Subs</span>
                            </button>
                        </div>
                        <div class="exec-sys-filter">
                            <input type="text" id="exec-search-sys" placeholder="Search System (e.g. CLQM-55)" value="${currentExecSearch}">
                            <select id="exec-select-sys">
                                <option value="ALL">-- All Systems (${sysList.length}) --</option>
                                ${sysList.map(s => `<option value="${s}" ${currentExecSys === s ? 'selected' : ''}>${s}</option>`).join("")}
                            </select>
                        </div>
                    </div>
                </div>

                <div class="dual-module-grid">
                    ${buildModuleCard("CLQM", "LQ MODULE", "Living Quarters Module (SystemNo prefix: CLQM)", "lqm", lqmM)}
                    ${buildModuleCard("CLQU", "LQ UTILITY", "Living Quarters Utility (SystemNo prefix: CLQU)", "lqu", lquM)}
                </div>

                <div class="five-gate-grid">
                    ${buildGateCard("g-itra", "ITR-A", "Pre-Comm Checksheets", activeM.itrA.done, activeM.itrA.total, "#3b82f6", `execDrillMatrix('${currentScope}','mc')`)}
                    ${buildGateCard("g-pa", "PUNCH CAT A", "Critical Punch (Pre-MC)", activeM.punchA.done, activeM.punchA.total, "#ef4444", `execDrillPunch('${currentScope}','A')`)}
                    ${buildGateCard("g-pb", "PUNCH CAT B", "Pre-Handover Punch", activeM.punchB.done, activeM.punchB.total, "#f59e0b", `execDrillPunch('${currentScope}','B')`)}
                    ${buildGateCard("g-pc", "PUNCH CAT C", "Agreed Carryover", activeM.punchC.done, activeM.punchC.total, "#0ea5e9", `execDrillPunch('${currentScope}','C')`)}
                    ${buildGateCard("g-itrb", "ITR-B", "Commissioning Checksheets", activeM.itrB.done, activeM.itrB.total, "#8b5cf6", `execDrillMatrix('${currentScope}','precom')`)}
                </div>

                <div class="cert-strip">
                    <div class="cert-pill-card" onclick="openCertModal('DAC','ALL','${currentScope}','${currentExecSys}')" title="Click to open DAC Certificate Register">
                        <div><div class="cert-pill-lbl">CC-DAC / PC-DAC CERTIFICATES</div><div class="cert-pill-sub">Discipline Acceptance (Click for Register)</div></div>
                        <div class="cert-pill-val" style="color:#a855f7;">${activeM.dac.done} / ${activeM.dac.total} <small>(${pctStr(activeM.dac.done, activeM.dac.total)}%)</small></div>
                    </div>
                    <div class="cert-pill-card" onclick="openCertModal('CSSC','ALL','${currentScope}','${currentExecSys}')" title="Click to open CSSC Certificate Register">
                        <div><div class="cert-pill-lbl">CSSC CERTIFICATES</div><div class="cert-pill-sub">Subsystem Mechanical Completion</div></div>
                        <div class="cert-pill-val" style="color:#10b981;">${activeM.cssc.done} / ${activeM.cssc.total} <small>(${pctStr(activeM.cssc.done, activeM.cssc.total)}%)</small></div>
                    </div>
                    <div class="cert-pill-card" onclick="openCertModal('RFC','ALL','${currentScope}','${currentExecSys}')" title="Click to open RFC Certificate Register">
                        <div><div class="cert-pill-lbl">RFC CERTIFICATES</div><div class="cert-pill-sub">Ready for Commissioning</div></div>
                        <div class="cert-pill-val" style="color:#38bdf8;">${activeM.rfc.done} / ${activeM.rfc.total} <small>(${pctStr(activeM.rfc.done, activeM.rfc.total)}%)</small></div>
                    </div>
                    <div class="cert-pill-card" onclick="execDrillMatrix('${currentScope}','precom')">
                        <div><div class="cert-pill-lbl">COMMISSIONING FTP</div><div class="cert-pill-sub">Functional Test Procedures</div></div>
                        <div class="cert-pill-val" style="color:#34d399;">${activeM.ftp.done} / ${activeM.ftp.total} <small>(${pctStr(activeM.ftp.done, activeM.ftp.total)}%)</small></div>
                    </div>
                </div>

                <div class="exec-section-divider">
                    <span>Discipline Breakdown — Scope: ${scopeLabel}${currentExecSys !== 'ALL' ? ' • ' + currentExecSys : ''}</span>
                    <span>Click any row to inspect ITR-A / Punch / DAC / CSSC details</span>
                </div>
            </div>
        `;

        // Bind search & select listeners
        const selSys = document.getElementById("exec-select-sys");
        if (selSys) {
            selSys.onchange = () => {
                currentExecSys = selSys.value;
                renderExecutiveSummary();
            };
        }
        const inpSearch = document.getElementById("exec-search-sys");
        if (inpSearch) {
            inpSearch.oninput = () => {
                currentExecSearch = inpSearch.value;
                renderExecutiveSummary();
                // Restore focus & cursor
                const fresh = document.getElementById("exec-search-sys");
                if (fresh) { fresh.focus(); fresh.setSelectionRange(fresh.value.length, fresh.value.length); }
            };
        }

        // Also re-render existing discipline cards filtered to active Scope!
        if (typeof renderDashboardWidgets === "function") {
            const scopedMcData = {
                itrA: activeM.itrA,
                punchA: activeM.punchA,
                punchB: activeM.punchB,
                punchC: activeM.punchC,
                dac: activeM.dac,
                cssc: activeM.cssc
            };
            renderDashboardWidgets(scopedMcData, activeM.discGroups);
        }
    }
    window.renderExecutiveSummary = renderExecutiveSummary;

    // =========================================================================
    // DARK / LIGHT MODE & LAPTOP / PHONE MODE
    // =========================================================================
    function applyThemeMode(mode) {
        if (mode === "light") {
            document.body.classList.add("light-mode");
        } else {
            document.body.classList.remove("light-mode");
        }
        localStorage.setItem(LS_THEME, mode);
        const btn = document.getElementById("btn-theme-toggle");
        if (btn) btn.innerHTML = mode === "light" ? "🌙 Dark" : "☀️ Light";
    }

    function applyPhoneMode(isPhone) {
        if (isPhone) {
            document.body.classList.add("phone-mode-active");
        } else {
            document.body.classList.remove("phone-mode-active");
        }
        localStorage.setItem(LS_PHONE, isPhone ? "1" : "0");
        const btn = document.getElementById("btn-device-toggle");
        if (btn) btn.innerHTML = isPhone ? "💻 Laptop" : "📱 Phone";
    }

    // =========================================================================
    // SHARE / QR CODE MODAL
    // =========================================================================
    function openShareModal() {
        const modal = document.getElementById("enh-share-modal");
        if (!modal) return;
        const urlInput = document.getElementById("enh-share-url");
        const qrImg = document.getElementById("enh-share-qr");
        const shareUrl = window.location.protocol.startsWith("http") ? window.location.href.split("#")[0] : LIVE_URL;
        if (urlInput) urlInput.value = shareUrl;
        if (qrImg) {
            qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(shareUrl)}`;
        }
        modal.style.display = "flex";
    }
    window.openShareModal = openShareModal;

    // =========================================================================
    // EXPORT ACTIVE TAB TO PDF (jsPDF + AutoTable)
    // =========================================================================
    function exportActiveViewToPDF() {
        if (!window.jspdf || !window.jspdf.jsPDF) {
            showToast("PDF library is loading or offline. Use browser Print (Ctrl+P) -> Save as PDF.", "warn", 4000);
            return;
        }
        const gd = window.GLOBAL_MC_DATA;
        if (!gd) {
            showToast("No dashboard data loaded to export.", "warn");
            return;
        }

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
        const activeTab = document.querySelector(".tab-btn.active")?.dataset?.tab || "dashboard";
        const ts = latestUpdatedAt || (window.PRELOADED_MC_DATA?.updatedAt) || new Date().toISOString().slice(0, 10);

        doc.setFontSize(14);
        doc.setTextColor(15, 23, 42);
        doc.text("BLOCK B LQP — LQ MODULE & LQ UTILITY DASHBOARD REPORT", 14, 14);
        doc.setFontSize(9);
        doc.setTextColor(100, 116, 139);
        doc.text(`View: ${activeTab.toUpperCase()}  |  Scope: ${currentScope}  |  Data Timestamp: ${ts}`, 14, 20);

        if (activeTab === "dashboard" || activeTab === "skyline") {
            const allM = computeScopeMetrics("ALL", "ALL", "");
            const lqmM = computeScopeMetrics("CLQM", "ALL", "");
            const lquM = computeScopeMetrics("CLQU", "ALL", "");
            const fmt = (o) => `${o.done.toLocaleString()} / ${o.total.toLocaleString()} (${pctStr(o.done, o.total)}%)`;

            doc.autoTable({
                startY: 25,
                head: [["Scope", "SubSystems", "ITR-A", "Punch Cat A", "Punch Cat B", "Punch Cat C", "ITR-B", "DAC", "CSSC", "RFC", "FTP"]],
                body: [
                    ["ALL LQ COMBINED", allM.subCount, fmt(allM.itrA), fmt(allM.punchA), fmt(allM.punchB), fmt(allM.punchC), fmt(allM.itrB), fmt(allM.dac), fmt(allM.cssc), fmt(allM.rfc), fmt(allM.ftp)],
                    ["LQ MODULE (CLQM)", lqmM.subCount, fmt(lqmM.itrA), fmt(lqmM.punchA), fmt(lqmM.punchB), fmt(lqmM.punchC), fmt(lqmM.itrB), fmt(lqmM.dac), fmt(lqmM.cssc), fmt(lqmM.rfc), fmt(lqmM.ftp)],
                    ["LQ UTILITY (CLQU)", lquM.subCount, fmt(lquM.itrA), fmt(lquM.punchA), fmt(lquM.punchB), fmt(lquM.punchC), fmt(lquM.itrB), fmt(lquM.dac), fmt(lquM.cssc), fmt(lquM.rfc), fmt(lquM.ftp)],
                ],
                theme: "grid",
                headStyles: { fillColor: [15, 23, 42], textColor: 255, fontSize: 8 },
                styles: { fontSize: 7.5 }
            });

            const activeM = computeScopeMetrics(currentScope, currentExecSys, currentExecSearch);
            const discRows = Object.entries(activeM.discGroups).map(([k, v]) => [
                k, fmt(v.itrA), fmt(v.punchA), fmt(v.punchB), fmt(v.punchC), fmt(v.dac)
            ]);
            doc.autoTable({
                startY: doc.lastAutoTable.finalY + 8,
                head: [["Discipline Group", "ITR-A", "Punch Cat A", "Punch Cat B", "Punch Cat C", "DAC"]],
                body: discRows,
                theme: "striped",
                headStyles: { fillColor: [30, 58, 138], textColor: 255, fontSize: 8 },
                styles: { fontSize: 8 }
            });
        } else if (activeTab === "site-walkdown") {
            const list = gd.siteWalkdownPunches || [];
            const rows = list.map((sw, i) => [
                i + 1, sw.punchNo || sw.id, sw.tagNo || "", sw.subsys || "", sw.disc || "",
                sw.cat || "", sw.status || "", sw.cmsStatus || "", sw.officialCmsPunchNo || "-", (sw.desc || "").slice(0, 70)
            ]);
            doc.autoTable({
                startY: 25,
                head: [["#", "Site Punch", "Tag No", "SubSystem", "Disc", "Cat", "Status", "CMS Track", "CMS No", "Defect Description"]],
                body: rows.length ? rows : [["-", "No Site Walkdown records", "", "", "", "", "", "", "", ""]],
                theme: "grid",
                headStyles: { fillColor: [15, 23, 42], fontSize: 8 },
                styles: { fontSize: 7.5 }
            });
        } else {
            // Generic Subsystem Summary PDF for MC / Precom / Reports / Equipment
            const rows = [];
            const matrix = gd.matrix || {};
            Object.keys(matrix).sort().forEach(sys => {
                Object.keys(matrix[sys]).sort().forEach(sub => {
                    let iD = 0, iT = 0, paD = 0, paT = 0, pbD = 0, pbT = 0, pcD = 0, pcT = 0;
                    Object.values(matrix[sys][sub]).forEach(c => {
                        iD += c.i_d || 0; iT += c.i_t || 0;
                        paD += c.pa_d || 0; paT += c.pa_t || 0;
                        pbD += c.pb_d || 0; pbT += c.pb_t || 0;
                        pcD += c.pc_d || 0; pcT += c.pc_t || 0;
                    });
                    const cssc = (gd.csscMap && gd.csscMap[sub] && gd.csscMap[sub].done) ? "SIGNED" : "PENDING";
                    const rfc = (gd.rfcMap && gd.rfcMap[sub] && gd.rfcMap[sub].done) ? "SIGNED" : "PENDING";
                    rows.push([
                        sub,
                        (gd.sysDescMap && gd.sysDescMap[sub] || "").slice(0, 38),
                        `${iD}/${iT} (${pctStr(iD, iT)}%)`,
                        `${paD}/${paT}`, `${pbD}/${pbT}`, `${pcD}/${pcT}`,
                        cssc, rfc
                    ]);
                });
            });
            doc.autoTable({
                startY: 25,
                head: [["SubSystem", "Description", "ITR-A", "Punch A", "Punch B", "Punch C", "CSSC", "RFC"]],
                body: rows,
                theme: "grid",
                headStyles: { fillColor: [15, 23, 42], fontSize: 8 },
                styles: { fontSize: 7 }
            });
        }

        const fname = `LQP_MC_Dashboard_${activeTab}_${new Date().toISOString().slice(0, 10)}.pdf`;
        doc.save(fname);
        showToast(`📄 Exported PDF: ${fname}`, "success");
    }
    window.exportActiveViewToPDF = exportActiveViewToPDF;

    // =========================================================================
    // COLUMN RESIZING FOR DATA TABLES
    // =========================================================================
    function attachColumnResizers() {
        document.querySelectorAll("#matrix-table thead th, #precom-matrix-table thead th, #rpt-table thead th").forEach(th => {
            if (th.querySelector(".enh-col-resizer")) return;
            th.style.position = "relative";
            const handle = document.createElement("div");
            handle.className = "enh-col-resizer";
            let startX = 0, startW = 0;
            handle.addEventListener("mousedown", (e) => {
                e.stopPropagation();
                startX = e.pageX;
                startW = th.offsetWidth;
                const onMove = (ev) => {
                    const w = Math.max(45, startW + (ev.pageX - startX));
                    th.style.width = w + "px";
                    th.style.minWidth = w + "px";
                };
                const onUp = () => {
                    document.removeEventListener("mousemove", onMove);
                    document.removeEventListener("mouseup", onUp);
                };
                document.addEventListener("mousemove", onMove);
                document.addEventListener("mouseup", onUp);
            });
            th.appendChild(handle);
        });
    }

    // =========================================================================
    // HOOK INTO EXISTING app.js LIFECYCLE SAFELY (ZERO BREAKING CHANGES)
    // =========================================================================
    function wrapAppLifecycle() {
        // 1. Wrap applyLoadedData to merge manual_data + render Executive Summary + update timestamp
        if (typeof window.applyLoadedData === "function" && !window.__enhWrappedApply) {
            window.__enhWrappedApply = true;
            const origApply = window.applyLoadedData;
            window.applyLoadedData = function (dataObj, updateDateStr) {
                if (updateDateStr && String(updateDateStr).includes("(VN)")) {
                    latestUpdatedAt = updateDateStr;
                } else if (window.PRELOADED_MC_DATA && window.PRELOADED_MC_DATA.updatedAt && !latestUpdatedAt) {
                    latestUpdatedAt = window.PRELOADED_MC_DATA.updatedAt;
                } else if (updateDateStr && !latestUpdatedAt) {
                    latestUpdatedAt = updateDateStr;
                }
                origApply.call(this, dataObj, updateDateStr);
                renderExecutiveSummary();
                updateTimestampBadge();
                applyPermissionMode();
            };
        }

        // 2. Wrap autoPersistCurrentData to trigger GitHub Auto-Save when Admin is unlocked
        if (typeof window.autoPersistCurrentData === "function" && !window.__enhWrappedPersist) {
            window.__enhWrappedPersist = true;
            const origPersist = window.autoPersistCurrentData;
            window.autoPersistCurrentData = function () {
                origPersist.call(this);
                renderExecutiveSummary();
                if (isAdminUnlocked && activeGithubToken) {
                    scheduleAutoSaveToGitHub();
                }
            };
        }

        // 3. Guard manual date/progress functions in Viewer Mode
        ["handleManualDateChange", "setManualDateToday", "clearManualDate",
         "handlePrecomManualDateChange", "setPrecomManualDateToday", "clearPrecomManualDate",
         "handleFtpManualDateChange", "setFtpManualDateToday", "clearFtpManualDate", "handleFtpProgressChange"
        ].forEach(fnName => {
            if (typeof window[fnName] === "function" && !window[`__enhGuard_${fnName}`]) {
                window[`__enhGuard_${fnName}`] = true;
                const origFn = window[fnName];
                window[fnName] = function () {
                    if (!isAdminUnlocked) {
                        showToast("🔒 Read-Only Mode. Click 'Admin' to unlock editing.", "warn");
                        return;
                    }
                    return origFn.apply(this, arguments);
                };
            }
        });
    }

    // =========================================================================
    // INITIALIZE UI & LOAD manual_data.json ON STARTUP
    // =========================================================================
    function initEnhancements() {
        // Apply default Read-Only Viewer Mode immediately
        applyPermissionMode();

        // Restore saved Theme & Device preferences
        applyThemeMode(localStorage.getItem(LS_THEME) || "dark");
        applyPhoneMode(localStorage.getItem(LS_PHONE) === "1");

        // Bind new navbar controls
        document.getElementById("btn-theme-toggle")?.addEventListener("click", () => {
            const next = document.body.classList.contains("light-mode") ? "dark" : "light";
            applyThemeMode(next);
        });
        document.getElementById("btn-device-toggle")?.addEventListener("click", () => {
            const next = !document.body.classList.contains("phone-mode-active");
            applyPhoneMode(next);
        });
        document.getElementById("btn-sync-cloud")?.addEventListener("click", () => syncLatestFromCloud(false));
        document.getElementById("btn-share-qr")?.addEventListener("click", openShareModal);
        document.getElementById("btn-export-pdf")?.addEventListener("click", exportActiveViewToPDF);
        document.getElementById("btn-admin-toggle")?.addEventListener("click", openAdminModal);

        // Admin modal buttons
        document.getElementById("enh-admin-close")?.addEventListener("click", closeAdminModal);
        document.getElementById("btn-admin-setup-save")?.addEventListener("click", handleAdminSetupSubmit);
        document.getElementById("btn-admin-login-submit")?.addEventListener("click", handleAdminLoginSubmit);
        document.getElementById("btn-admin-lock")?.addEventListener("click", handleAdminLock);
        document.getElementById("btn-admin-publish-now")?.addEventListener("click", () => publishManualToGitHubNow(true));
        document.getElementById("btn-admin-reset-vault")?.addEventListener("click", handleAdminResetVault);
        document.getElementById("btn-admin-reset-from-login")?.addEventListener("click", handleAdminResetVault);
        document.getElementById("admin-login-pin")?.addEventListener("keydown", (e) => {
            if (e.key === "Enter") handleAdminLoginSubmit();
        });

        // Share modal buttons
        document.getElementById("enh-share-close")?.addEventListener("click", () => {
            document.getElementById("enh-share-modal").style.display = "none";
        });
        document.getElementById("btn-share-copy")?.addEventListener("click", () => {
            const inp = document.getElementById("enh-share-url");
            if (inp) {
                navigator.clipboard?.writeText(inp.value);
                showToast("📋 Copied Dashboard URL!", "success");
            }
        });

        wrapAppLifecycle();
        attachColumnResizers();

        // Always sync latest data.json + manual_data.json from GitHub on BOTH GitHub Pages & local index.html
        // (automatically falls back to local data.js + manual_data.js if offline)
        setTimeout(async () => {
            const ok = await syncLatestFromCloud(true);
            if (!ok && window.GLOBAL_MC_DATA) {
                renderExecutiveSummary();
                updateTimestampBadge();
            }
        }, 300);
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", initEnhancements);
    } else {
        initEnhancements();
    }
})();
