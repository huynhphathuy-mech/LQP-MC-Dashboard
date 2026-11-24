document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupFileUpload();
    loadDefaultData();
    
    // Modal Close
    document.getElementById('modal-close').addEventListener('click', () => { document.getElementById('disc-modal').style.display = 'none'; });
    document.getElementById('punch-modal-close').addEventListener('click', () => { document.getElementById('punch-modal').style.display = 'none'; });
    document.getElementById('cert-modal-close').addEventListener('click', () => { document.getElementById('cert-modal').style.display = 'none'; });
    
    // Checksheet Modal Close & Outside Click
    const csModal = document.getElementById('checksheet-modal');
    const csClose = document.getElementById('checksheet-modal-close');
    if (csClose && csModal) {
        csClose.addEventListener('click', () => { csModal.style.display = 'none'; });
        csModal.addEventListener('click', (e) => {
            if (e.target === csModal) csModal.style.display = 'none';
        });
    }

    // Punch Modal Outside Click
    const pModal = document.getElementById('punch-modal');
    if (pModal) {
        pModal.addEventListener('click', (e) => {
            if (e.target === pModal) pModal.style.display = 'none';
        });
    }

    // Global ESC key to close any open modal
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            document.querySelectorAll('.modal-overlay').forEach(m => {
                if (m.style.display !== 'none') m.style.display = 'none';
            });
        }
    });

    // Save Data Button
    document.getElementById('btn-save-data').addEventListener('click', exportData);
    
    // Load data.json from computer
    const jsonInput = document.getElementById('json-upload');
    if (jsonInput) {
        jsonInput.addEventListener('change', handleJsonUpload);
    }

    // Filters & Export
    setupFilters();
    setupReports();
    setupFlashReport();
    setupChecksheetModalEvents();
    setupPunchModalEvents();
    setupTagPunchMapperEvents();
    setupEquipmentPunchesEvents();
    if (typeof setupPrecomEvents === 'function') setupPrecomEvents();
});

// ==========================================
// IndexedDB Persistence for Local & Offline Use
// ==========================================
const DB_NAME = 'LQP_MC_Dashboard_DB';
const DB_STORE = 'app_data';

function openAppDB() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB not supported"));
            return;
        }
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = (e) => {
            const db = e.target.result;
            if (!db.objectStoreNames.contains(DB_STORE)) {
                db.createObjectStore(DB_STORE);
            }
        };
        req.onsuccess = (e) => resolve(e.target.result);
        req.onerror = (e) => reject(e.target.error);
    });
}

async function saveToDB(key, data) {
    try {
        const db = await openAppDB();
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(data, key);
        return new Promise(resolve => {
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => resolve(false);
        });
    } catch (err) {
        console.warn("IndexedDB save error:", err);
        return false;
    }
}

async function loadFromDB(key) {
    try {
        const db = await openAppDB();
        const tx = db.transaction(DB_STORE, 'readonly');
        const req = tx.objectStore(DB_STORE).get(key);
        return new Promise(resolve => {
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => resolve(null);
        });
    } catch (err) {
        console.warn("IndexedDB load error:", err);
        return null;
    }
}

function autoPersistCurrentData() {
    if (window.GLOBAL_MC_DATA) {
        if (typeof siteWalkdownPunches !== 'undefined') {
            window.GLOBAL_MC_DATA.siteWalkdownPunches = siteWalkdownPunches;
        }
        const now = new Date();
        const dateStr = now.toISOString().split('T')[0];
        saveToDB('global_mc_data', {
            updateDate: dateStr,
            data: window.GLOBAL_MC_DATA
        });
    }
}

function exportData() {
    if (!window.GLOBAL_MC_DATA) return;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Auto-save to local browser database
    autoPersistCurrentData();

    // Clone and attach timestamp for file export
    const exportObj = {
        updateDate: dateStr,
        data: window.GLOBAL_MC_DATA
    };

    const jsonStr = JSON.stringify(exportObj);
    const blob = new Blob([jsonStr], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", url);
    downloadAnchorNode.setAttribute("download", "data.json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function applyLoadedData(dataObj, updateDateStr) {
    if (!dataObj) return;
    window.GLOBAL_MC_DATA = dataObj;
    if (dataObj.subsysSkylineDates) window.GLOBAL_MC_DATA.subsysSkylineDates = dataObj.subsysSkylineDates;
    if (!window.GLOBAL_MC_DATA.globalChecksheetMap) {
        window.GLOBAL_MC_DATA.globalChecksheetMap = {};
    }
    
    const { mcData, dashGroups, matrix, sumItr, sumPunch, sumDac, sumCssc, skyData } = window.GLOBAL_MC_DATA;
    
    if (skyData) {
        const allWeeksSet = new Set([...Object.keys(skyData.itrPlanByWeek || {}), ...Object.keys(skyData.itrActualByWeek || {})]);
        const allWeeks = Array.from(allWeeksSet).sort();

        let chartLabels = [];
        let planBar = [];
        let actBar = [];
        let planLine = [];
        let actLine = [];
        
        let planCumSum = 0;
        let actCumSum = 0;
        const totalItrA = (mcData && mcData.itrA) ? mcData.itrA.total : 0;

        for (const wk of allWeeks) {
            chartLabels.push(formatWeekKey(wk));
            const pVal = skyData.itrPlanByWeek[wk] || 0;
            const aVal = skyData.itrActualByWeek[wk] || 0;
            planBar.push(pVal);
            actBar.push(aVal);
            planCumSum += pVal;
            actCumSum += aVal;
            planLine.push(totalItrA > 0 ? (planCumSum / totalItrA * 100) : 0);
            actLine.push(totalItrA > 0 ? (actCumSum / totalItrA * 100) : 0);
        }

        renderSkylineBoxes(mcData, sumItr);
        renderSkylineChart(chartLabels, planBar, actBar, planLine, actLine);
    }

    if (typeof loadSiteWalkdownPunches === 'function') {
        loadSiteWalkdownPunches();
    }
    recalculateMasterCounts();
    if (matrix) {
        populateSysDropdown(matrix);
        renderMatrix(matrix);
    }
    if (mcData && dashGroups) {
        renderDashboardWidgets(mcData, dashGroups);
    }
    if (mcData && sumItr) {
        renderSummaryWidgets(mcData, sumItr, sumPunch, sumDac, sumCssc);
    }

    if (window.GLOBAL_MC_DATA.globalCompletedChecksheets) {
        initReportsUI();
    }
    if (window.GLOBAL_MC_DATA.globalFlashReports) {
        renderFlashReports();
    }
    if (typeof renderEquipmentSummaryTable === 'function') {
        renderEquipmentSummaryTable();
    }
    if (typeof initSiteWalkdownTab === 'function') {
        initSiteWalkdownTab();
    }
    if (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.precomMatrix) {
        if (typeof recalculatePrecomMasterCounts === 'function') recalculatePrecomMasterCounts();
        if (typeof populatePrecomSysDropdown === 'function') populatePrecomSysDropdown();
        if (typeof renderPrecomWidgets === 'function') renderPrecomWidgets();
        if (typeof renderPrecomMatrix === 'function') renderPrecomMatrix();
    }

    const syncStatus = document.getElementById('sync-status');
    const syncDot = document.getElementById('sync-dot');
    if (syncStatus) syncStatus.textContent = `Data loaded (Updated: ${updateDateStr || 'N/A'})`;
    if (syncDot) syncDot.classList.add('synced');
    const saveBtn = document.getElementById('btn-save-data');
    if (saveBtn) saveBtn.style.display = 'inline-flex';
}

async function loadDefaultData() {
    let loaded = false;

    // 1. Try to fetch data.json (works on GitHub Pages or local HTTP server)
    try {
        const response = await fetch('data.json');
        if (response.ok) {
            const jsonData = await response.json();
            if (jsonData && jsonData.data) {
                applyLoadedData(jsonData.data, jsonData.updateDate);
                saveToDB('global_mc_data', jsonData);
                loaded = true;
                return;
            }
        }
    } catch (e) {
        console.log("fetch('data.json') unavailable on file:// protocol. Checking local preloaded or IndexedDB cache...");
    }

    // 2. Check window.PRELOADED_MC_DATA and compare with IndexedDB cache
    if (!loaded) {
        try {
            const cached = await loadFromDB('global_mc_data');
            const preloaded = (window.PRELOADED_MC_DATA && window.PRELOADED_MC_DATA.data) ? window.PRELOADED_MC_DATA : null;

            const cachedDate = (cached && cached.updateDate) ? String(cached.updateDate) : '';
            const preloadedDate = (preloaded && preloaded.updateDate) ? String(preloaded.updateDate) : '';

            // If browser cache has newer or equal date as preloaded, use cache (e.g. user imported a newer data.json)
            if (cached && cached.data && (!preloaded || (cachedDate && cachedDate >= preloadedDate))) {
                // Ensure Precom structures are present in cached data if preloaded has them
                if (preloaded && preloaded.data) {
                    if (!cached.data.precomMatrix) cached.data.precomMatrix = preloaded.data.precomMatrix;
                    if (!cached.data.precomData) cached.data.precomData = preloaded.data.precomData;
                    if (!cached.data.sumItrB) cached.data.sumItrB = preloaded.data.sumItrB;
                    if (!cached.data.sumFtp) cached.data.sumFtp = preloaded.data.sumFtp;
                    if (!cached.data.globalPrecomChecksheetMap) cached.data.globalPrecomChecksheetMap = preloaded.data.globalPrecomChecksheetMap;
                    if (!cached.data.globalFtpList) cached.data.globalFtpList = preloaded.data.globalFtpList;
                    if (!cached.data.globalCompletedPrecomChecksheets) cached.data.globalCompletedPrecomChecksheets = preloaded.data.globalCompletedPrecomChecksheets || [];
                    if (!cached.data.csscMap) cached.data.csscMap = preloaded.data.csscMap || {};
                    if (!cached.data.rfcMap) cached.data.rfcMap = preloaded.data.rfcMap || {};
                }
                applyLoadedData(cached.data, `${cachedDate || 'Saved'} (Local Cache)`);
                loaded = true;
                return;
            } else if (preloaded) {
                // Preloaded data is newer, merge flash reports and manuals from cache
                if (cached && cached.data) {
                    if (cached.data.globalFlashReports && cached.data.globalFlashReports.length > 0) {
                        preloaded.data.globalFlashReports = cached.data.globalFlashReports;
                    }
                    if (cached.data.siteWalkdownPunches && cached.data.siteWalkdownPunches.length > 0) {
                        if (!preloaded.data.siteWalkdownPunches || preloaded.data.siteWalkdownPunches.length === 0) {
                            preloaded.data.siteWalkdownPunches = cached.data.siteWalkdownPunches;
                        }
                    }
                    if (cached.data.globalCompletedChecksheets) {
                        const cachedManuals = cached.data.globalCompletedChecksheets.filter(x => x.isManual);
                        if (cachedManuals.length > 0 && preloaded.data.globalCompletedChecksheets) {
                            cachedManuals.forEach(m => {
                                if (!preloaded.data.globalCompletedChecksheets.some(x => x.tag === m.tag && x.formNo === m.formNo)) {
                                    preloaded.data.globalCompletedChecksheets.push(m);
                                }
                            });
                        }
                    }
                    if (cached.data.globalCompletedPrecomChecksheets) {
                        const cachedPrecomManuals = cached.data.globalCompletedPrecomChecksheets.filter(x => x.isManual);
                        if (cachedPrecomManuals.length > 0) {
                            if (!preloaded.data.globalCompletedPrecomChecksheets) preloaded.data.globalCompletedPrecomChecksheets = [];
                            cachedPrecomManuals.forEach(m => {
                                if (!preloaded.data.globalCompletedPrecomChecksheets.some(x => x.tag === m.tag && x.formNo === m.formNo)) {
                                    preloaded.data.globalCompletedPrecomChecksheets.push(m);
                                }
                            });
                        }
                    }
                }
                applyLoadedData(preloaded.data, `${preloadedDate || 'Latest'}`);
                saveToDB('global_mc_data', preloaded);
                loaded = true;
                return;
            }
        } catch (dbErr) {
            console.warn("IndexedDB check error:", dbErr);
            if (window.PRELOADED_MC_DATA && window.PRELOADED_MC_DATA.data) {
                applyLoadedData(window.PRELOADED_MC_DATA.data, `${window.PRELOADED_MC_DATA.updateDate || 'Latest'}`);
                loaded = true;
                return;
            }
        }
    }

    // 3. Fallback to IndexedDB cache
    if (!loaded) {
        try {
            const cached = await loadFromDB('global_mc_data');
            if (cached && cached.data) {
                applyLoadedData(cached.data, `${cached.updateDate || 'Saved'} (Browser Cache)`);
                loaded = true;
                return;
            }
        } catch (dbErr) {
            console.warn("IndexedDB load error:", dbErr);
        }
    }

    if (!loaded) {
        const syncStatus = document.getElementById('sync-status');
        if (syncStatus) syncStatus.textContent = 'Upload CMS files or click "Load data.json"';
    }
}

function handleJsonUpload(e) {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
        try {
            const parsed = JSON.parse(event.target.result);
            if (!parsed || !parsed.data) {
                alert("Invalid data.json file structure!");
                return;
            }
            applyLoadedData(parsed.data, parsed.updateDate || 'Imported');
            await saveToDB('global_mc_data', parsed);
            alert(`Loaded data.json successfully! (Updated: ${parsed.updateDate || 'N/A'})\nData is now remembered locally in this browser.`);
        } catch (err) {
            console.error("Failed to parse JSON file:", err);
            alert("Error reading data.json: " + err.message);
        }
        e.target.value = '';
    };
    reader.readAsText(file);
}

function setupTabs() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const targetId = `tab-${btn.dataset.tab}`;
            tabContents.forEach(content => {
                content.classList.remove('active');
                if (content.id === targetId) {
                    content.classList.add('active');
                }
            });
            if (btn.dataset.tab === 'equip-punches' && typeof renderEquipmentSummaryTable === 'function') {
                renderEquipmentSummaryTable();
            }
            if (btn.dataset.tab === 'site-walkdown' && typeof renderSiteWalkdownTab === 'function') {
                renderSiteWalkdownTab();
            }
            if (btn.dataset.tab === 'precom' && typeof renderPrecomTab === 'function') {
                renderPrecomTab();
            }
        });
    });
}

function normalizeStr(str) {
    if (!str) return '';
    return String(str).replace(/\s/g, '').toUpperCase();
}

function findHeaderRow(rawJson) {
    for (let i = 0; i < Math.min(15, rawJson.length); i++) {
        if (!rawJson[i]) continue;
        const rowVals = Object.values(rawJson[i]).map(v => normalizeStr(v));
        if (rowVals.includes('CATEGORY') || rowVals.includes('CHECKSHEETTYPE') || rowVals.includes('CERTIFICATENAME')) {
            return i;
        }
    }
    return 0;
}

function getValueRobust(row, possibleKeys) {
    if (!row || typeof row !== 'object') return '';
    const keys = Object.keys(row);

    // 1. First priority: Exact normalized match, checking possibleKeys in caller priority order!
    for (let pk of possibleKeys) {
        const normPk = normalizeStr(pk);
        for (let key of keys) {
            const normKey = normalizeStr(key);
            if (normKey === 'PLANFINISHDATE' || normKey === 'PLANSTARTDATE') continue;
            if (normKey === normPk) {
                const val = row[key];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    return val;
                }
            }
        }
    }

    // 2. Second priority: Substring match in priority order of possibleKeys
    for (let pk of possibleKeys) {
        const normPk = normalizeStr(pk);
        for (let key of keys) {
            const normKey = normalizeStr(key);
            if (normKey === 'PLANFINISHDATE' || normKey === 'PLANSTARTDATE') continue;
            // Prevent generic 'DESCRIPTION' from accidentally matching 'SUBSYSTEMDESCRIPTION' or 'SYSTEMDESCRIPTION'
            if ((normPk === 'DESCRIPTION' || normPk === 'DESC') && (normKey.includes('SUBSYSTEM') || normKey.includes('SYSTEM'))) {
                continue;
            }
            if (normKey.includes(normPk)) {
                const val = row[key];
                if (val !== undefined && val !== null && String(val).trim() !== '') {
                    return val;
                }
            }
        }
    }
    return '';
}

const DISCIPLINES = ['MECHANICAL', 'PIPING', 'ELECTRICAL', 'INSTRUMENT', 'TELECOM', 'STRUCTURE', 'ARCHITECTURE', 'HVAC', 'SAFETY'];

function classifyDiscipline(discStr) {
    const s = String(discStr).toUpperCase().replace(/\s/g, '');
    if (s.includes('MECH')) return 'MECHANICAL';
    if (s.includes('PIP')) return 'PIPING';
    if (s.includes('TELE')) return 'TELECOM';
    if (s.includes('ELEC')) return 'ELECTRICAL';
    if (s.includes('INST')) return 'INSTRUMENT';
    if (s.includes('STRU')) return 'STRUCTURE';
    if (s.includes('ARCH')) return 'ARCHITECTURE';
    if (s.includes('HVAC')) return 'HVAC';
    if (s.includes('SAFE') || s.includes('F&G') || s.includes('FIRE')) return 'SAFETY';
    return 'OTHER';
}

function initDisciplineData() {
    let d = {};
    DISCIPLINES.forEach(disc => {
        d[disc] = { i_d:0, i_t:0, pa_d:0, pa_t:0, pb_d:0, pb_t:0, pc_d:0, pc_t:0 };
    });
    return d;
}

function extractSystem(subsys) {
    if (!subsys) return 'UNKNOWN';
    const parts = String(subsys).trim().split('-');
    if (parts.length >= 2) return `${parts[0]}-${parts[1]}`;
    return String(subsys).trim();
}

function fixSheetRange(worksheet) {
    let maxRow = 0;
    let maxCol = 0;
    for (let key in worksheet) {
        if (key.startsWith('!')) continue;
        const decoded = XLSX.utils.decode_cell(key);
        if (decoded.r > maxRow) maxRow = decoded.r;
        if (decoded.c > maxCol) maxCol = decoded.c;
    }
    worksheet['!ref'] = XLSX.utils.encode_range({s: {c:0, r:0}, e: {c:maxCol, r:maxRow}});
}

// ----------------- DATE UTILS FOR SKYLINE -----------------
function parseExcelDate(val) {
    if (val === null || val === undefined || val === '') return null;
    if (val instanceof Date && !isNaN(val.getTime())) {
        return val.getFullYear() > 1970 ? val : null;
    }
    // Check if number or numeric string (Excel serial date)
    const num = Number(val);
    if (!isNaN(num) && num >= 1000 && num <= 100000) {
        const ms = Math.round((num - 25569) * 86400 * 1000);
        const d = new Date(ms);
        return (!isNaN(d.getTime()) && d.getUTCFullYear() > 1970) ? d : null;
    }
    let d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1970) return d;
    return null;
}

function getWeekKey(val) {
    const d = parseExcelDate(val);
    if (!d) return null;
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.getFullYear(), d.getMonth(), diff);
    const yy = monday.getFullYear();
    const mm = String(monday.getMonth() + 1).padStart(2, '0');
    const dd = String(monday.getDate()).padStart(2, '0');
    return `${yy}-${mm}-${dd}`;
}

function formatWeekKey(key) {
    const d = new Date(key);
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = months[d.getMonth()];
    const yy = String(d.getFullYear()).slice(-2);
    return `${dd}-${mm}-${yy}`;
}

let skylineChartInstance = null;
let modalChartInstance = null;
window.GLOBAL_MC_DATA = null;
// ----------------------------------------------------------


// --- DASHBOARD WIDGET HELPERS ---
function initDashGroup() {
    return {
        itrA: { done: 0, total: 0 },
        punchA: { done: 0, total: 0 },
        punchB: { done: 0, total: 0 },
        dac: { done: 0, total: 0 },
        cssc: { done: 0, total: 0 }
    };
}

function getDashGroup(disc) {
    if (disc === 'MECHANICAL') return 'MECHANICAL';
    if (disc === 'PIPING') return 'PIPING';
    if (disc === 'HVAC') return 'HVAC';
    if (disc === 'SAFETY') return 'SAFETY';
    if (['ELECTRICAL', 'TELECOM', 'INSTRUMENT'].includes(disc)) return 'ETC';
    if (disc === 'ARCHITECTURE') return 'ARCH';
    if (disc === 'STRUCTURE') return 'STR';
    return null;
}

function jumpToMcTab() {
    const btn = document.querySelector('.tab-btn[data-tab="mc"]');
    if (btn) btn.click();
}
// --------------------------------

function setupFileUpload() {

    const fileInput = document.getElementById('excel-upload');
    const syncStatus = document.getElementById('sync-status');
    const syncDot = document.getElementById('sync-dot');

    fileInput.addEventListener('change', async (e) => {
        const files = e.target.files;
        if (files.length === 0) return;

        syncStatus.textContent = 'Parsing data...';
        syncDot.classList.remove('synced');
        

        let mcData = {
            itrA: { done: 0, total: 0 },
            punchA: { done: 0, total: 0 },
            punchB: { done: 0, total: 0 },
            dac: { done: 0, total: 0 },
            cssc: { done: 0, total: 0 }
        };

        let dashGroups = {
            MECHANICAL: initDashGroup(),
            PIPING: initDashGroup(),
            HVAC: initDashGroup(),
            ETC: initDashGroup(),
            SAFETY: initDashGroup(),
            ARCH: initDashGroup(),
            STR: initDashGroup()
        };


        let matrix = {}; 
        let sumItr = {}; 
        let sumPunch = {}; 
        let sumDac = {}; 
        let sumCssc = {}; 
        let sysDescMap = {};
        
        let globalPunchList = [];
        let globalCertList = [];
        let globalTagMap = {};
        let globalCompletedChecksheets = [];
        let globalChecksheetMap = {};
        let subsysSkylineDates = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.subsysSkylineDates) ? window.GLOBAL_MC_DATA.subsysSkylineDates : ((window.PRELOADED_MC_DATA && window.PRELOADED_MC_DATA.data && window.PRELOADED_MC_DATA.data.subsysSkylineDates) ? window.PRELOADED_MC_DATA.data.subsysSkylineDates : {});

        // Precom & Commissioning structures
        let precomData = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.precomData) ? JSON.parse(JSON.stringify(window.GLOBAL_MC_DATA.precomData)) : { itrB: {done:0, total:0}, ftp: {done:0, total:0}, punchPre: {done:0, total:0}, punchCom: {done:0, total:0}, rfc: {done:0, total:0} };
        let sumItrB = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.sumItrB) ? JSON.parse(JSON.stringify(window.GLOBAL_MC_DATA.sumItrB)) : {};
        let sumFtp = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.sumFtp) ? JSON.parse(JSON.stringify(window.GLOBAL_MC_DATA.sumFtp)) : { done:0, total:0, byDisc: {} };
        let precomMatrix = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.precomMatrix) ? JSON.parse(JSON.stringify(window.GLOBAL_MC_DATA.precomMatrix)) : {};
        let globalPrecomChecksheetMap = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.globalPrecomChecksheetMap) ? JSON.parse(JSON.stringify(window.GLOBAL_MC_DATA.globalPrecomChecksheetMap)) : {};
        let globalFtpList = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.globalFtpList) ? JSON.parse(JSON.stringify(window.GLOBAL_MC_DATA.globalFtpList)) : [];
        let globalCompletedPrecomChecksheets = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.globalCompletedPrecomChecksheets) ? JSON.parse(JSON.stringify(window.GLOBAL_MC_DATA.globalCompletedPrecomChecksheets)) : [];
        let csscMap = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.csscMap) ? JSON.parse(JSON.stringify(window.GLOBAL_MC_DATA.csscMap)) : {};
        let rfcMap = (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.rfcMap) ? JSON.parse(JSON.stringify(window.GLOBAL_MC_DATA.rfcMap)) : {};

        // Pre-fill sumItr with correctly ordered DISCIPLINES
        DISCIPLINES.forEach(d => sumItr[d] = {d:0, t:0});

        // Time-Series for Skyline
        let skyData = {
            itrPlanByWeek: {},
            itrActualByWeek: {},
            subsysItrTotal: {},
            subsysPlanWeek: {},
            
            // Discipline specific Time-series
            subsysDiscItrTotal: {},
            discActualByWeek: {},
            discPlanByWeek: {}
        };

        try {
            for (let i = 0; i < files.length; i++) {
                const file = files[i];
                const name = file.name.toLowerCase();
                
                const data = await file.arrayBuffer();
                const workbook = XLSX.read(data, { type: 'array' });
                const worksheet = workbook.Sheets[workbook.SheetNames[0]];
                
                fixSheetRange(worksheet);
                
                const rawJson = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                if (rawJson.length === 0) continue;

                const headerIdx = findHeaderRow(rawJson);
                const json = XLSX.utils.sheet_to_json(worksheet, { range: headerIdx, defval: "" });

                // CHECKSHEET OVERVIEW
                if (name.includes('checksheet')) {
                    // Reset Precom checksheets if uploading fresh checksheet report
                    globalPrecomChecksheetMap = {};
                    sumItrB = { 'MECHANICAL': {d:0, t:0}, 'PIPING': {d:0, t:0}, 'ELECTRICAL': {d:0, t:0}, 'INSTRUMENT': {d:0, t:0}, 'TELECOM': {d:0, t:0}, 'HVAC': {d:0, t:0} };
                    precomData.itrB = { done: 0, total: 0 };

                    json.forEach(row => {
                        const csTypeRaw = String(getValueRobust(row, ['Checksheet Type', 'ChecksheetType']) || '').trim();
                        const type = normalizeStr(csTypeRaw);
                        const phase = normalizeStr(getValueRobust(row, ['Phase']));
                        
                        const subsys = getValueRobust(row, ['SubSystemNo', 'SubSystem No']);
                        if (!subsys) return;
                        const subStr = String(subsys).trim();
                        
                        const desc = getValueRobust(row, ['SubSystemDescription', 'SubSystemDesc', 'Description', 'SystemDesc']);
                        if (desc && !sysDescMap[subStr]) sysDescMap[subStr] = String(desc).trim();

                        const sys = extractSystem(subsys);
                        const discRaw = getValueRobust(row, ['Discipline', 'DisciplineCode']);
                        const disc = classifyDiscipline(discRaw);

                        // ITR-B (PRECOMMISSIONING)
                        if (phase === 'PC' || csTypeRaw.endsWith('-B') || type.endsWith('B')) {
                            if (!ACTIVE_PRECOM_DISCS.includes(disc)) return;
                            precomData.itrB.total++;
                            if (!sumItrB[disc]) sumItrB[disc] = { d: 0, t: 0 };
                            sumItrB[disc].t++;

                            let isDone = false;
                            const compDate = getValueRobust(row, ['CompleteDate', 'Complete']);
                            if (compDate && String(compDate).toUpperCase() !== 'NAT' && String(compDate).trim() !== '') {
                                isDone = true;
                                precomData.itrB.done++;
                                sumItrB[disc].d++;
                            }

                            const tagNo = getValueRobust(row, ['TagNo', 'Tag No', 'EquipmentNo', 'Equipment No']);
                            const rowNo = getValueRobust(row, ['No', 'ID']) || '';
                            const tagDesc = getValueRobust(row, ['TagDescription', 'Tag Description', 'EquipmentDescription', 'Description']) || '-';

                            if (!globalPrecomChecksheetMap[subStr]) globalPrecomChecksheetMap[subStr] = {};
                            if (!globalPrecomChecksheetMap[subStr][disc]) globalPrecomChecksheetMap[subStr][disc] = [];

                            globalPrecomChecksheetMap[subStr][disc].push({
                                no: rowNo || (globalPrecomChecksheetMap[subStr][disc].length + 1),
                                subsys: subStr,
                                subsysDesc: sysDescMap[subStr] || String(desc || '-').trim(),
                                tag: tagNo ? String(tagNo).trim() : '',
                                tagDesc: String(tagDesc).trim(),
                                disc: disc,
                                type: csTypeRaw,
                                compDate: isDone ? formatDateDisplay(compDate) : '',
                                manualDate: '',
                                isManual: false,
                                isDone: isDone
                            });
                            return;
                        }

                        // ITR-A (MECHANICAL COMPLETION)
                        if (!type.includes('A')) return; 

                        const grp = getDashGroup(disc);

                        mcData.itrA.total++;
                        if (grp) dashGroups[grp].itrA.total++;

                        let isDone = false;
                        const compDate = getValueRobust(row, ['CompleteDate', 'Complete']);
                        let wk = null;
                        if (compDate && String(compDate).toUpperCase() !== 'NAT' && String(compDate).trim() !== '') {
                            mcData.itrA.done++;
                            if (grp) dashGroups[grp].itrA.done++;
                            isDone = true;
                            wk = getWeekKey(compDate);
                            if (wk) skyData.itrActualByWeek[wk] = (skyData.itrActualByWeek[wk] || 0) + 1;
                        }

                        const tagNo = getValueRobust(row, ['TagNo', 'Tag No', 'EquipmentNo', 'Equipment No']);
                        const rowNo = getValueRobust(row, ['No', 'ID']) || '';
                        const tagDesc = getValueRobust(row, ['TagDescription', 'Tag Description', 'EquipmentDescription', 'Description']) || '-';
                        const csFormType = String(getValueRobust(row, ['Checksheet Type', 'ChecksheetType']) || '').trim();

                        // Store in full checksheet map for detail drill-down
                        if (!globalChecksheetMap[subStr]) globalChecksheetMap[subStr] = {};
                        if (!globalChecksheetMap[subStr][disc]) globalChecksheetMap[subStr][disc] = [];
                        globalChecksheetMap[subStr][disc].push({
                            no: rowNo || (globalChecksheetMap[subStr][disc].length + 1),
                            subsys: subStr,
                            subsysDesc: sysDescMap[subStr] || String(desc || '-').trim(),
                            tag: tagNo ? String(tagNo).trim() : '',
                            tagDesc: String(tagDesc).trim(),
                            disc: disc,
                            type: csFormType,
                            compDate: isDone ? formatDateDisplay(compDate) : '',
                            isDone: isDone
                        });

                        if (isDone) {
                            globalCompletedChecksheets.push({
                                sys: sys,
                                subsys: subStr,
                                subsysDesc: sysDescMap[subStr] || String(desc || '-').trim(),
                                disc: disc,
                                formNo: csFormType,
                                tag: tagNo ? String(tagNo).trim() : '',
                                tagDesc: String(tagDesc).trim(),
                                compDate: compDate,
                                dateStr: formatDateStr(compDate),
                                week: wk
                            });
                        }
                        if (tagNo) {
                            const t = String(tagNo).trim();
                            if (!globalTagMap[t]) {
                                globalTagMap[t] = {
                                    tag: t,
                                    desc: String(getValueRobust(row, ['TagDescription', 'Tag Description', 'EquipmentDescription', 'Description']) || '-').trim(),
                                    subsys: subStr,
                                    sys: sys,
                                    disc: disc,
                                    itrTotal: 0,
                                    itrDone: 0
                                };
                            }
                            globalTagMap[t].itrTotal++;
                            if (isDone) globalTagMap[t].itrDone++;
                        }

                        skyData.subsysItrTotal[subStr] = (skyData.subsysItrTotal[subStr] || 0) + 1;

                        if (!matrix[sys]) matrix[sys] = {};
                        if (!matrix[sys][subsys]) matrix[sys][subsys] = initDisciplineData();
                        if (DISCIPLINES.includes(disc)) {
                            matrix[sys][subsys][disc].i_t++;
                            if (isDone) matrix[sys][subsys][disc].i_d++;
                            
                            // Discipline-level Skyline Trackers
                            if (!skyData.subsysDiscItrTotal[subStr]) skyData.subsysDiscItrTotal[subStr] = {};
                            skyData.subsysDiscItrTotal[subStr][disc] = (skyData.subsysDiscItrTotal[subStr][disc] || 0) + 1;
                            
                            if (isDone && wk) {
                                if (!skyData.discActualByWeek[disc]) skyData.discActualByWeek[disc] = {};
                                skyData.discActualByWeek[disc][wk] = (skyData.discActualByWeek[disc][wk] || 0) + 1;
                            }
                        }
                        
                        const shortDisc = disc === 'OTHER' ? 'MECHANICAL' : disc;
                        if (!sumItr[shortDisc]) sumItr[shortDisc] = {d:0, t:0};
                        sumItr[shortDisc].t++;
                        if (isDone) sumItr[shortDisc].d++;
                    });
                }
                
                // PUNCHLIST OVERVIEW
                if (name.includes('punchlist')) {
                    json.forEach(row => {
                        const catStr = getValueRobust(row, ['Category']);
                        if (!catStr) return;
                        const cat = normalizeStr(catStr);
                        
                        const status = normalizeStr(getValueRobust(row, ['Status']));
                        let isClosed = status.includes('CLOSE');

                        const subsys = getValueRobust(row, ['SubSystemNo', 'SubSystem No']);
                        const sys = extractSystem(subsys);
                        const disc = classifyDiscipline(getValueRobust(row, ['Discipline', 'DisciplineCode']));
                        const phase = getValueRobust(row, ['Phase']);
                        const grp = getDashGroup(disc);

                        if (cat.includes('A')) {
                            mcData.punchA.total++;
                            if (grp) dashGroups[grp].punchA.total++;
                            if (isClosed) {
                                mcData.punchA.done++;
                                if (grp) dashGroups[grp].punchA.done++;
                            }
                        } else if (cat.includes('B')) {
                            mcData.punchB.total++;
                            if (grp) dashGroups[grp].punchB.total++;
                            if (isClosed) {
                                mcData.punchB.done++;
                                if (grp) dashGroups[grp].punchB.done++;
                            }
                        } else if (cat.includes('C')) {
                            if (!mcData.punchC) mcData.punchC = { total: 0, done: 0 };
                            mcData.punchC.total++;
                            if (grp && dashGroups[grp]) {
                                if (!dashGroups[grp].punchC) dashGroups[grp].punchC = { total: 0, done: 0 };
                                dashGroups[grp].punchC.total++;
                                if (isClosed) dashGroups[grp].punchC.done++;
                            }
                            if (isClosed) mcData.punchC.done++;
                        } else {
                            return; 
                        }

                        if (subsys && DISCIPLINES.includes(disc)) {
                            if (!matrix[sys]) matrix[sys] = {};
                            if (!matrix[sys][subsys]) matrix[sys][subsys] = initDisciplineData();
                            if (cat.includes('A')) {
                                matrix[sys][subsys][disc].pa_t++;
                                if (isClosed) matrix[sys][subsys][disc].pa_d++;
                            } else if (cat.includes('B')) {
                                matrix[sys][subsys][disc].pb_t++;
                                if (isClosed) matrix[sys][subsys][disc].pb_d++;
                            } else if (cat.includes('C')) {
                                matrix[sys][subsys][disc].pc_t = (matrix[sys][subsys][disc].pc_t || 0) + 1;
                                if (isClosed) matrix[sys][subsys][disc].pc_d = (matrix[sys][subsys][disc].pc_d || 0) + 1;
                            }
                            
                            const phaseName = String(phase).trim() !== '' ? String(phase) : 'UNKNOWN';
                            if (!sumPunch[phaseName]) sumPunch[phaseName] = {a_d:0, a_t:0, b_d:0, b_t:0, c_d:0, c_t:0};
                            if (cat.includes('A')) {
                                sumPunch[phaseName].a_t++;
                                if (isClosed) sumPunch[phaseName].a_d++;
                            } else if (cat.includes('B')) {
                                sumPunch[phaseName].b_t++;
                                if (isClosed) sumPunch[phaseName].b_d++;
                            } else if (cat.includes('C')) {
                                sumPunch[phaseName].c_t = (sumPunch[phaseName].c_t || 0) + 1;
                                if (isClosed) sumPunch[phaseName].c_d = (sumPunch[phaseName].c_d || 0) + 1;
                            }
                        }
                        
                        // Store raw punch for modal
                        globalPunchList.push({
                            sys: sys,
                            subsys: subsys,
                            punchNo: getValueRobust(row, ['PunchListNo', 'PunchNo']),
                            raisedPunchNo: getValueRobust(row, ['PunchListRaisedNo', 'RaisedPunchNo', 'Raised Punch No']),
                            pkgName: getValueRobust(row, ['PackageName', 'Package Name', 'Package']),
                            disc: disc,
                            phase: String(phase).trim() !== '' ? String(phase) : 'UNKNOWN',
                            status: status,
                            tag: getValueRobust(row, ['TagNo']),
                            tagDesc: getValueRobust(row, ['TagDescription', 'Tag Description', 'EquipmentDescription', 'Description']),
                            desc: getValueRobust(row, ['DefectDescription', 'PunchDescription']),
                            actionBy: getValueRobust(row, ['ActionBy', 'Originator']),
                            openDate: getValueRobust(row, ['OpenDate', 'RaiseDate']),
                            closeDate: getValueRobust(row, ['ClosedDate', 'CompleteDate']),
                            expDate: getValueRobust(row, ['Expected Clearance Date', 'ExpectedDate']),
                            cat: cat
                        });
                    });
                }
                
                // FTP OVERVIEW (COMMISSIONING)
                if (name.includes('ftp')) {
                    globalFtpList = [];
                    sumFtp = { done: 0, total: 0, byDisc: {} };
                    json.forEach(row => {
                        const tagNo = String(getValueRobust(row, ['TagNo', 'Tag No', 'FTP No', 'Procedure No']) || '').trim();
                        if (!tagNo || !tagNo.includes('PQ-')) return;

                        const sub = String(getValueRobust(row, ['SubSystemNo', 'SubSystem No']) || '').trim();
                        const sysNo = String(getValueRobust(row, ['SystemNo', 'System No']) || '').trim() || extractSystem(sub);
                        const sysDesc = String(getValueRobust(row, ['SystemDescription', 'SystemDesc']) || '').trim();
                        const subDesc = String(getValueRobust(row, ['SubSystemDescription', 'SubSystemDesc']) || '').trim();
                        const tagDesc = String(getValueRobust(row, ['TagDescription', 'Tag Description', 'Title']) || '').trim();
                        const disc = classifyDiscipline(getValueRobust(row, ['DisciplineCode', 'Discipline']));
                        const step = parseFloat(getValueRobust(row, ['Step'])) || 0;
                        const totalStep = parseFloat(getValueRobust(row, ['TotalStep', 'Total Step'])) || 0;
                        const progress = parseFloat(getValueRobust(row, ['Progress'])) || 0;
                        const compDate = getValueRobust(row, ['CompleteDate', 'Complete']);
                        const isDone = (compDate && String(compDate).toUpperCase() !== 'NAT' && String(compDate).trim() !== '');

                        if (subDesc && !sysDescMap[sub]) sysDescMap[sub] = subDesc;

                        sumFtp.total++;
                        if (isDone) sumFtp.done++;
                        if (!sumFtp.byDisc[disc]) sumFtp.byDisc[disc] = { done: 0, total: 0 };
                        sumFtp.byDisc[disc].total++;
                        if (isDone) sumFtp.byDisc[disc].done++;

                        globalFtpList.push({
                            id: `FTP-${globalFtpList.length + 1}`,
                            sys: sysNo,
                            sysDesc: sysDesc,
                            subsys: sub,
                            subsysDesc: subDesc,
                            ftpNo: tagNo,
                            title: tagDesc,
                            disc: disc,
                            step: step,
                            totalStep: totalStep,
                            progress: progress || (isDone ? 100 : 0),
                            compDate: isDone ? formatDateDisplay(compDate) : '',
                            manualDate: '',
                            isManual: false,
                            isDone: isDone,
                            planStart: formatDateDisplay(getValueRobust(row, ['PlanStart', 'Plan Start'])),
                            planFinish: formatDateDisplay(getValueRobust(row, ['PlanFinish', 'Plan Finish'])),
                            location: String(getValueRobust(row, ['Location']) || '').trim()
                        });
                    });
                    precomData.ftp = { done: sumFtp.done, total: sumFtp.total };
                }

                // CERTIFICATE OVERVIEW
                if (name.includes('certificate')) {
                    json.forEach(row => {
                        const certName = normalizeStr(getValueRobust(row, ['CertificateName', 'Certificate']));
                        const actFinish = getValueRobust(row, ['ActualFinishDate']);
                        let isDone = (actFinish && String(actFinish).toUpperCase() !== 'NAT' && String(actFinish).trim() !== '');
                        const subsys = getValueRobust(row, ['PrecomSubSystem', 'SubSystemNo']);
                        const subStr = subsys ? String(subsys).trim() : '';

                        if (certName.includes('RFC') && subStr) {
                            rfcMap[subStr] = { done: isDone, date: isDone ? formatDateDisplay(actFinish) : '' };
                        }
                        if (certName.includes('CSSC') && subStr) {
                            csscMap[subStr] = { done: isDone, date: isDone ? formatDateDisplay(actFinish) : '' };
                        }

                        let planDate = null;
                        for (let k of Object.keys(row)) {
                            if (normalizeStr(k) === 'PLANFINISHDATE') {
                                planDate = row[k];
                                break;
                            }
                        }

                        if (certName.includes('DAC') || certName.includes('DISCIPLINE')) {
                            const discRaw = getValueRobust(row, ['DisciplineCode', 'Discipline']);
                            const fullDisc = classifyDiscipline(discRaw);
                            const grp = getDashGroup(fullDisc);

                            mcData.dac.total++;
                            if (grp) dashGroups[grp].dac.total++;
                            if (isDone) {
                                mcData.dac.done++;
                                if (grp) dashGroups[grp].dac.done++;
                            }
                            
                            const shortDisc = fullDisc.substring(0,4);
                            if (!sumDac[shortDisc]) sumDac[shortDisc] = {d:0, t:0};
                            sumDac[shortDisc].t++;
                            if (isDone) sumDac[shortDisc].d++;

                            globalCertList.push({
                                type: 'DAC',
                                cert: certName,
                                disc: shortDisc,
                                sys: getValueRobust(row, ['PrecomSystem', 'SystemNo']),
                                subsys: getValueRobust(row, ['PrecomSubSystem', 'SubSystemNo']),
                                status: isDone ? 'CLOSED' : 'OPEN',
                                plan: planDate,
                                act: actFinish
                            });
                        } else if (certName.includes('CSSC') || certName.includes('SUBSYSTEM')) {
                            mcData.cssc.total++;
                            if (isDone) mcData.cssc.done++;
                            
                            const subsys = getValueRobust(row, ['PrecomSubSystem', 'SubSystemNo']);
                            if (subsys) {
                                const subStr = String(subsys).trim();
                                if (!sumCssc[subStr]) sumCssc[subStr] = {d:0, t:0};
                                sumCssc[subStr].t++;
                                if (isDone) sumCssc[subStr].d++;

                                if (planDate && String(planDate).toUpperCase() !== 'NAT' && String(planDate).trim() !== '') {
                                    const wk = getWeekKey(planDate);
                                    if (wk) skyData.subsysPlanWeek[subStr] = wk;
                                }

                                globalCertList.push({
                                    type: 'CSSC',
                                    cert: certName,
                                    disc: '',
                                    sys: getValueRobust(row, ['PrecomSystem', 'SystemNo']),
                                    subsys: subStr,
                                    status: isDone ? 'CLOSED' : 'OPEN',
                                    plan: planDate,
                                    act: actFinish
                                });
                            }
                        }
                    });
                }

                                // SKYLINE NATIVE FILE
                if (name.includes('skyline')) {
                    const handoverSheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('handover'));
                    if (handoverSheetName) {
                        const wsH = workbook.Sheets[handoverSheetName];
                        fixSheetRange(wsH);
                        const rawH = XLSX.utils.sheet_to_json(wsH, { header: 1, defval: "" });
                        for (let r = 4; r < rawH.length; r++) {
                            const row = rawH[r];
                            const rawSub = row[1];
                            if (!rawSub) continue;
                            const m = String(rawSub).trim().match(/^(\d+)\.(\d+)\s+([A-Z]+)\s+([MU])$/);
                            if (m) {
                                const prefix = m[4] === 'M' ? 'CLQM' : 'CLQU';
                                const stdSub = `${prefix}-${m[1]}-${m[2]}`;
                                const discCode = m[3];
                                const c32 = row[32];
                                const c34 = row[34];
                                const eff = c34 || c32;
                                if (eff) {
                                    if (!subsysSkylineDates[stdSub]) {
                                        subsysSkylineDates[stdSub] = { targetDate: null, handoverDate: null, csscDate: null, discDates: {} };
                                    }
                                    const dStr = String(eff).split('T')[0].split(' ')[0];
                                    if (c34) subsysSkylineDates[stdSub].handoverDate = String(c34).split('T')[0].split(' ')[0];
                                    if (c32) subsysSkylineDates[stdSub].csscDate = String(c32).split('T')[0].split(' ')[0];
                                    if (!subsysSkylineDates[stdSub].targetDate) subsysSkylineDates[stdSub].targetDate = dStr;
                                    subsysSkylineDates[stdSub].discDates[discCode] = dStr;
                                }
                            }
                        }
                    }
                }

                // KPI S-CURVE
                if (name.includes('kpi') || workbook.SheetNames.some(s => s.includes('S-Curve'))) {
                    skyData.hasKpi = true;
                    if (!skyData.kpiPlan) skyData.kpiPlan = {};
                    if (!skyData.kpiAct) skyData.kpiAct = {};
                    if (!skyData.kpiDiscPlan) skyData.kpiDiscPlan = {};
                    if (!skyData.kpiDiscAct) skyData.kpiDiscAct = {};

                    workbook.SheetNames.forEach(sheetName => {
                        let disc = null;
                        if (sheetName.includes('TOTAL') || sheetName.includes('OVERALL')) disc = 'OVERALL';
                        else if (sheetName.includes('ELE')) disc = 'ELECTRICAL';
                        else if (sheetName.includes('INS')) disc = 'INSTRUMENT';
                        else if (sheetName.includes('TEL')) disc = 'TELECOM';
                        else if (sheetName.includes('HVAC')) disc = 'HVAC';
                        else if (sheetName.includes('PIP')) disc = 'PIPING';
                        else if (sheetName.includes('MEC')) disc = 'MECHANICAL';
                        else if (sheetName.includes('STR')) disc = 'STRUCTURE';
                        else if (sheetName.includes('ARC')) disc = 'ARCHITECTURE';
                        else if (sheetName.includes('SAF')) disc = 'SAFETY';
                        
                        if (!disc) return;

                        const ws = workbook.Sheets[sheetName];
                        const rJson = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
                        
                        let datesRow = null, planRow = null, actRow = null;
                        
                        for (let r=0; r<rJson.length; r++) {
                            const firstCell = String(rJson[r][0] || '').trim().toUpperCase();
                            if (firstCell === 'TYPE') datesRow = rJson[r];
                            else if (firstCell.includes('1. KPI PLAN')) planRow = rJson[r];
                            else if (firstCell.includes('3. ACTUAL') && !firstCell.includes('CUM')) actRow = rJson[r];
                        }
                        
                        if (datesRow && planRow) {
                            for (let c=1; c<datesRow.length; c++) {
                                const rawDate = datesRow[c];
                                if (!rawDate) continue;
                                const wk = getWeekKey(rawDate);
                                if (wk) {
                                    const pVal = parseFloat(planRow[c]) || 0;
                                    const aVal = actRow ? (parseFloat(actRow[c]) || 0) : 0;
                                    
                                    if (disc === 'OVERALL') {
                                        skyData.kpiPlan[wk] = (skyData.kpiPlan[wk] || 0) + pVal;
                                        skyData.kpiAct[wk] = (skyData.kpiAct[wk] || 0) + aVal;
                                    } else {
                                        if (!skyData.kpiDiscPlan[disc]) skyData.kpiDiscPlan[disc] = {};
                                        if (!skyData.kpiDiscAct[disc]) skyData.kpiDiscAct[disc] = {};
                                        skyData.kpiDiscPlan[disc][wk] = (skyData.kpiDiscPlan[disc][wk] || 0) + pVal;
                                        skyData.kpiDiscAct[disc][wk] = (skyData.kpiDiscAct[disc][wk] || 0) + aVal;
                                    }
                                }
                            }
                        }
                    });
                }
            }

            // Skyline Data Aggregation (Map ITR-A totals to CSSC Plan weeks)
            for (const [subStr, totalItr] of Object.entries(skyData.subsysItrTotal)) {
                const wk = skyData.subsysPlanWeek[subStr];
                if (wk) {
                    skyData.itrPlanByWeek[wk] = (skyData.itrPlanByWeek[wk] || 0) + totalItr;
                }
            }
            
            // Discipline Skyline Aggregation
            for (const [subStr, discs] of Object.entries(skyData.subsysDiscItrTotal)) {
                const wk = skyData.subsysPlanWeek[subStr];
                if (wk) {
                    for (const [disc, count] of Object.entries(discs)) {
                        if (!skyData.discPlanByWeek[disc]) skyData.discPlanByWeek[disc] = {};
                        skyData.discPlanByWeek[disc][wk] = (skyData.discPlanByWeek[disc][wk] || 0) + count;
                    }
                }
            }


            if (skyData.hasKpi) {
                skyData.itrPlanByWeek = skyData.kpiPlan || {};
                skyData.itrActualByWeek = skyData.kpiAct || {};
                skyData.discPlanByWeek = skyData.kpiDiscPlan || {};
                skyData.discActualByWeek = skyData.kpiDiscAct || {};
            }

            // Preserve globalFlashReports across file re-syncs
            let globalFlashReports = [];
            if (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.globalFlashReports) {
                globalFlashReports = window.GLOBAL_MC_DATA.globalFlashReports;
            }

            // Smart Merge: Retain manual items that are not yet in new Excel, but let new Excel take precedence if updated
            if (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.globalCompletedChecksheets) {
                const previousManuals = window.GLOBAL_MC_DATA.globalCompletedChecksheets.filter(x => x.isManual);
                previousManuals.forEach(manItem => {
                    const alreadyOfficial = globalCompletedChecksheets.some(
                        offItem => offItem.tag === manItem.tag && (!manItem.formNo || offItem.formNo === manItem.formNo)
                    );
                    if (!alreadyOfficial) {
                        globalCompletedChecksheets.push(manItem);
                    }
                });
            }

            // Preserve Site Walkdown Punches across file re-syncs
            let preservedSiteWalkdown = [];
            if (typeof siteWalkdownPunches !== 'undefined' && Array.isArray(siteWalkdownPunches) && siteWalkdownPunches.length > 0) {
                preservedSiteWalkdown = siteWalkdownPunches;
            } else if (window.GLOBAL_MC_DATA && Array.isArray(window.GLOBAL_MC_DATA.siteWalkdownPunches) && window.GLOBAL_MC_DATA.siteWalkdownPunches.length > 0) {
                preservedSiteWalkdown = window.GLOBAL_MC_DATA.siteWalkdownPunches;
            } else {
                try {
                    const storedSw = localStorage.getItem('LQP_SITE_WALKDOWN_PUNCHES');
                    if (storedSw) preservedSiteWalkdown = JSON.parse(storedSw);
                } catch(e) {}
            }
            if (Array.isArray(preservedSiteWalkdown)) {
                siteWalkdownPunches = preservedSiteWalkdown;
            }

            // Re-build Precom Matrix if checksheets or ftp were uploaded
            const allPrecomSubs = new Set([...Object.keys(globalPrecomChecksheetMap || {}), ...((globalFtpList || []).map(f => f.subsys))]);
            if (allPrecomSubs.size > 0) {
                precomMatrix = {};
                Array.from(allPrecomSubs).sort().forEach(sub => {
                    const sysNo = extractSystem(sub);
                    if (!precomMatrix[sysNo]) precomMatrix[sysNo] = {};
                    const subCs = (globalPrecomChecksheetMap && globalPrecomChecksheetMap[sub]) ? globalPrecomChecksheetMap[sub] : {};
                    const subFtps = (globalFtpList || []).filter(f => f.subsys === sub);

                    const discData = {};
                    ACTIVE_PRECOM_DISCS.forEach(dName => {
                        const items = subCs[dName] || [];
                        const i_t = items.length;
                        const i_d = items.filter(it => it.isDone).length;
                        discData[dName] = { i_t, i_d, pa_t: 0, pa_d: 0, pb_t: 0, pb_d: 0, pc_t: 0, pc_d: 0 };
                    });

                    const ftpTotal = subFtps.length;
                    const ftpDone = subFtps.filter(f => f.isDone).length;
                    const ftpAvgProg = ftpTotal > 0 ? (subFtps.reduce((acc, f) => acc + (f.progress || (f.isDone ? 100 : 0)), 0) / ftpTotal) : 0;
                    const csscInfo = csscMap[sub] || { done: false, date: '' };
                    const rfcInfo = rfcMap[sub] || { done: false, date: '' };
                    const skyDate = subsysSkylineDates[sub] ? (typeof subsysSkylineDates[sub] === 'string' ? subsysSkylineDates[sub] : (subsysSkylineDates[sub].targetDate || '')) : '';

                    precomMatrix[sysNo][sub] = {
                        subsysDesc: sysDescMap[sub] || '',
                        skylineDate: skyDate,
                        csscDone: csscInfo.done,
                        csscDate: csscInfo.date,
                        rfcDone: rfcInfo.done,
                        rfcDate: rfcInfo.date,
                        disciplines: discData,
                        ftp: {
                            total: ftpTotal,
                            done: ftpDone,
                            progress: Math.round(ftpAvgProg),
                            pca_t: 0, pca_d: 0, pcb_t: 0, pcb_d: 0, pcc_t: 0, pcc_d: 0
                        }
                    };
                });
                precomData.rfc = {
                    done: Object.values(rfcMap).filter(v => v.done).length,
                    total: Object.keys(rfcMap).length
                };
            }

            // Preserve manual ITR-B completions across file re-syncs
            if (window.GLOBAL_MC_DATA && window.GLOBAL_MC_DATA.globalCompletedPrecomChecksheets) {
                const prevPrecomManuals = window.GLOBAL_MC_DATA.globalCompletedPrecomChecksheets.filter(x => x.isManual);
                prevPrecomManuals.forEach(manItem => {
                    const alreadyOff = (globalPrecomChecksheetMap[manItem.subsys] && globalPrecomChecksheetMap[manItem.subsys][manItem.disc])
                        ? globalPrecomChecksheetMap[manItem.subsys][manItem.disc].some(off => off.tag === manItem.tag && off.cmsDate)
                        : false;
                    if (!alreadyOff && !globalCompletedPrecomChecksheets.some(x => x.tag === manItem.tag && x.formNo === manItem.formNo)) {
                        globalCompletedPrecomChecksheets.push(manItem);
                    }
                });
            }

            // Global save for Modals
            window.GLOBAL_MC_DATA = { 
                mcData, 
                dashGroups, 
                matrix, 
                sumItr, 
                sumPunch, 
                sumDac, 
                sumCssc, 
                skyData, 
                sysDescMap, 
                globalPunchList, 
                globalCertList, 
                globalTagMap, 
                globalCompletedChecksheets, 
                globalFlashReports, 
                globalChecksheetMap, 
                subsysSkylineDates,
                siteWalkdownPunches,
                precomData,
                sumItrB,
                sumFtp,
                precomMatrix,
                globalPrecomChecksheetMap,
                globalFtpList,
                globalCompletedPrecomChecksheets,
                csscMap,
                rfcMap
            };

            // Recalculate Master Counts & inject site walkdown punches
            recalculateMasterCounts();

            const allWeeksSet = new Set([...Object.keys(skyData.itrPlanByWeek), ...Object.keys(skyData.itrActualByWeek)]);
            const allWeeks = Array.from(allWeeksSet).sort();

            let chartLabels = [];
            let planBar = [];
            let actBar = [];
            let planLine = [];
            let actLine = [];
            
            let planCumSum = 0;
            let actCumSum = 0;
            const totalItrA = mcData.itrA.total;

            for (const wk of allWeeks) {
                chartLabels.push(formatWeekKey(wk));
                
                const pVal = skyData.itrPlanByWeek[wk] || 0;
                const aVal = skyData.itrActualByWeek[wk] || 0;
                
                planBar.push(pVal);
                actBar.push(aVal);
                
                planCumSum += pVal;
                actCumSum += aVal;
                
                planLine.push(totalItrA > 0 ? (planCumSum / totalItrA * 100) : 0);
                actLine.push(totalItrA > 0 ? (actCumSum / totalItrA * 100) : 0);
            }

            // Updates
            renderDashboardWidgets(mcData, dashGroups);
            renderSummaryWidgets(mcData, sumItr, sumPunch, sumDac, sumCssc);
            renderMatrix(matrix);
            
            // Skyline Renders
            renderSkylineBoxes(mcData, sumItr);
            renderSkylineChart(chartLabels, planBar, actBar, planLine, actLine);

            populateSysDropdown(matrix);

            if (window.GLOBAL_MC_DATA.globalCompletedChecksheets) {
                initReportsUI();
            }
            if (window.GLOBAL_MC_DATA.globalFlashReports) {
                renderFlashReports();
            }
            if (typeof renderEquipmentSummaryTable === 'function') {
                renderEquipmentSummaryTable();
            }
            if (typeof renderSiteWalkdownTab === 'function') {
                renderSiteWalkdownTab();
            }
            if (typeof recalculatePrecomMasterCounts === 'function') {
                recalculatePrecomMasterCounts();
            }
            if (typeof populatePrecomSysDropdown === 'function') {
                populatePrecomSysDropdown();
            }
            if (typeof renderPrecomWidgets === 'function') {
                renderPrecomWidgets();
            }
            if (typeof renderPrecomMatrix === 'function') {
                renderPrecomMatrix();
            }
            
            syncStatus.textContent = 'Data updated from CMS';
            syncDot.classList.add('synced');
            autoPersistCurrentData();
            document.getElementById('btn-save-data').style.display = 'inline-flex';

        } catch (error) {
            console.error(error);
            syncStatus.textContent = 'Error: ' + error.message + ' at line ' + (error.lineNumber || '');
        }
    });
}

function renderDashboardWidgets(mcData, dashGroups) {
    const container = document.getElementById('dash-widgets-container');
    if (!container) return;

    const createWidgetHtml = (title, dataObj, isOverall, dacGroupKey) => {
        const getPct = (d, t) => t > 0 ? ((d / t) * 100).toFixed(1) : 0;
        const scopeArg = (typeof window.getActiveExecScope === 'function') ? window.getActiveExecScope() : 'ALL';
        const sysArg = (typeof window.getActiveExecSys === 'function') ? window.getActiveExecSys() : 'ALL';
        const dacKey = dacGroupKey || 'ALL';
        
        return `
            <div class="card mc-widget">
                <div class="card-header">
                    <span class="badge">${isOverall ? 'ALL' : 'MC'}</span>
                    <h3 style="color: ${isOverall ? '#e2e8f0' : '#cbd5e1'};">${title}</h3>
                </div>
                
                <div class="mc-list">
                    <div class="mc-item mc-item-link" onclick="jumpToMcTab()">
                        <div class="mc-info">
                            <span class="mc-label">ITR-A Checksheets</span>
                            <span class="mc-value">${dataObj.itrA.done.toLocaleString()} / ${dataObj.itrA.total.toLocaleString()} <span class="pct pct-blue">${getPct(dataObj.itrA.done, dataObj.itrA.total)}%</span></span>
                        </div>
                        <div class="progress-bar"><div class="progress-fill fill-blue" style="width:${getPct(dataObj.itrA.done, dataObj.itrA.total)}%"></div></div>
                    </div>
                    
                    <div class="mc-item mc-item-link" onclick="openPunchModal('ALL', 'A', '${scopeArg}', '${sysArg}')" title="Click to inspect Punch Cat A Register">
                        <div class="mc-info">
                            <span class="mc-label">Punch A Closed</span>
                            <span class="mc-value">${dataObj.punchA.done.toLocaleString()} / ${dataObj.punchA.total.toLocaleString()} <span class="pct pct-red">${getPct(dataObj.punchA.done, dataObj.punchA.total)}%</span></span>
                        </div>
                        <div class="progress-bar"><div class="progress-fill fill-red" style="width:${getPct(dataObj.punchA.done, dataObj.punchA.total)}%"></div></div>
                    </div>
                    
                    <div class="mc-item mc-item-link" onclick="openPunchModal('ALL', 'B', '${scopeArg}', '${sysArg}')" title="Click to inspect Punch Cat B Register">
                        <div class="mc-info">
                            <span class="mc-label">Punch B Closed</span>
                            <span class="mc-value">${dataObj.punchB.done.toLocaleString()} / ${dataObj.punchB.total.toLocaleString()} <span class="pct pct-yellow">${getPct(dataObj.punchB.done, dataObj.punchB.total)}%</span></span>
                        </div>
                        <div class="progress-bar"><div class="progress-fill fill-yellow" style="width:${getPct(dataObj.punchB.done, dataObj.punchB.total)}%"></div></div>
                    </div>
                    
                    <div class="mc-item mc-item-link" onclick="openCertModal('DAC', '${dacKey}', '${scopeArg}', '${sysArg}')" title="Click to open DAC Certificate Register (${title})">
                        <div class="mc-info">
                            <span class="mc-label">DAC (Discipline)</span>
                            <span class="mc-value">${dataObj.dac.done.toLocaleString()} / ${dataObj.dac.total.toLocaleString()} <span class="pct pct-purple">${getPct(dataObj.dac.done, dataObj.dac.total)}%</span></span>
                        </div>
                        <div class="progress-bar"><div class="progress-fill fill-purple" style="width:${getPct(dataObj.dac.done, dataObj.dac.total)}%"></div></div>
                    </div>
                    
                    <div class="mc-item mc-item-link" onclick="openCertModal('CSSC', 'ALL', '${scopeArg}', '${sysArg}')" title="Click to open CSSC Certificate Register" ${isOverall ? '' : 'style="display:none;"'}>
                        <div class="mc-info">
                            <span class="mc-label">CSSC (Subsystem)</span>
                            <span class="mc-value">${dataObj.cssc.done.toLocaleString()} / ${dataObj.cssc.total.toLocaleString()} <span class="pct pct-green">${getPct(dataObj.cssc.done, dataObj.cssc.total)}%</span></span>
                        </div>
                        <div class="progress-bar"><div class="progress-fill fill-green" style="width:${getPct(dataObj.cssc.done, dataObj.cssc.total)}%"></div></div>
                    </div>
                </div>
            </div>
        `;
    };

    let html = '';
    html += createWidgetHtml('OVERALL (All Disciplines)', mcData, true, 'ALL');
    html += createWidgetHtml('MECHANICAL', dashGroups.MECHANICAL, false, 'MECH');
    html += createWidgetHtml('SAFETY', dashGroups.SAFETY, false, 'SAFE');
    html += createWidgetHtml('HVAC', dashGroups.HVAC, false, 'HVAC');
    html += createWidgetHtml('PIPING', dashGroups.PIPING, false, 'PIPI');
    html += createWidgetHtml('ELECTRICAL, TELECOM & INST', dashGroups.ETC, false, 'ETC');
    
    // Support backward compatibility if old data.json is loaded
    if (dashGroups.ARCH_STR) {
        html += createWidgetHtml('ARCHITECTURE & STRUCTURE', dashGroups.ARCH_STR, false, 'ALL');
    } else {
        html += createWidgetHtml('ARCHITECTURE', dashGroups.ARCH || initDashGroup(), false, 'ARCH');
        html += createWidgetHtml('STRUCTURE', dashGroups.STR || initDashGroup(), false, 'STRU');
    }
    
    container.innerHTML = html;
}

function formatSmPct(d, t, isZeroRed=false) {
    const pct = t > 0 ? ((d/t)*100).toFixed(1) : 0;
    let cls = '';
    if (isZeroRed && pct == 0.0) cls = 'val-red';
    else if (pct == 100.0) cls = 'pct-100';
    return `<span class="mc-sm-pct ${cls}">${pct}%</span>`;
}

function renderSummaryWidgets(mcData, sumItr, sumPunch, sumDac, sumCssc) {
    // 1. ITR-A
    const tr1 = document.getElementById('sum-itra-total');
    if (tr1) tr1.innerHTML = `${mcData.itrA.done.toLocaleString()} / ${mcData.itrA.total.toLocaleString()} <span style="font-size:0.75rem; color:#3b82f6;">${mcData.itrA.total > 0 ? ((mcData.itrA.done/mcData.itrA.total)*100).toFixed(1) : 0}%</span>`;
    const gr1 = document.getElementById('grid-itra');
    if (gr1) {
        gr1.innerHTML = '';
        DISCIPLINES.forEach(k => {
            const v = sumItr[k];
            if (v) {
                gr1.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openDisciplineModal('${k}')" title="Click to view details"><div class="mc-sm-lbl">${k}</div><div class="mc-sm-val">${v.d}/${v.t} ${formatSmPct(v.d,v.t)}</div></div>`;
            }
        });
    }

    // 2. Punch
    const tr2 = document.getElementById('sum-punch-total');
    const totPunchD = mcData.punchA.done + mcData.punchB.done + ((mcData.punchC && mcData.punchC.done) || 0);
    const totPunchT = mcData.punchA.total + mcData.punchB.total + ((mcData.punchC && mcData.punchC.total) || 0);
    if (tr2) {
        tr2.style.cursor = 'pointer';
        tr2.title = 'Click to view All Punches (Master Register)';
        tr2.onclick = () => openPunchModal('ALL', 'ALL');
        tr2.innerHTML = `${totPunchD.toLocaleString()} / ${totPunchT.toLocaleString()} <span style="font-size:0.75rem; color:#f59e0b;">${totPunchT > 0 ? ((totPunchD/totPunchT)*100).toFixed(1) : 0}%</span>`;
    }
    const gr2 = document.getElementById('grid-punch');
    if (gr2) {
        gr2.innerHTML = '';
        // All Punches Master Card (All phases, Cat A & Cat B)
        gr2.innerHTML += `
            <div class="mc-sm-item punch-all-item" style="cursor:pointer; background: rgba(14, 165, 233, 0.15); border: 1px solid #0ea5e9; grid-column: 1 / -1; margin-bottom: 0.35rem; display: flex; flex-direction: row; justify-content: space-between; align-items: center; padding: 0.45rem 0.75rem;" onclick="openPunchModal('ALL', 'ALL')" title="Click to view All Punches (Master Register)">
                <div class="mc-sm-lbl" style="color: #38bdf8; font-weight: 700; margin: 0; font-size: 0.72rem; letter-spacing: 0.3px;">ALL PUNCHES (MASTER)</div>
                <div class="mc-sm-val" style="color: #f8fafc; font-weight: 700; font-size: 0.75rem;">${totPunchD.toLocaleString()} / ${totPunchT.toLocaleString()} ${formatSmPct(totPunchD, totPunchT)}</div>
            </div>
        `;
        Object.keys(sumPunch).sort().forEach(k => {
            const v = sumPunch[k];
            if (v.a_t > 0) gr2.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('${k}', 'A')" title="Click to view details"><div class="mc-sm-lbl" style="color:#ef4444;">${k}_A</div><div class="mc-sm-val">${v.a_d}/${v.a_t} ${formatSmPct(v.a_d,v.a_t, true)}</div></div>`;
            if (v.b_t > 0) gr2.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('${k}', 'B')" title="Click to view details"><div class="mc-sm-lbl" style="color:#f59e0b;">${k}_B</div><div class="mc-sm-val">${v.b_d}/${v.b_t} ${formatSmPct(v.b_d,v.b_t)}</div></div>`;
            if (v.c_t > 0) gr2.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('${k}', 'C')" title="Click to view details"><div class="mc-sm-lbl" style="color:#38bdf8;">${k}_C</div><div class="mc-sm-val">${v.c_d}/${v.c_t} ${formatSmPct(v.c_d,v.c_t)}</div></div>`;
        });
    }

    // 3. DAC
    const tr3 = document.getElementById('sum-dac-total');
    if (tr3) {
        tr3.style.cursor = 'pointer';
        tr3.title = 'Click to view All DAC Certificates';
        tr3.onclick = () => openCertModal('DAC', 'ALL');
        tr3.innerHTML = `${mcData.dac.done.toLocaleString()} / ${mcData.dac.total.toLocaleString()} <span style="font-size:0.75rem; color:#a855f7;">${mcData.dac.total > 0 ? ((mcData.dac.done/mcData.dac.total)*100).toFixed(1) : 0}%</span>`;
    }
    const gr3 = document.getElementById('grid-dac');
    if (gr3) {
        gr3.innerHTML = '';
        Object.keys(sumDac).sort().forEach(k => {
            const v = sumDac[k];
            gr3.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openCertModal('DAC', '${k}')" title="Click to view details"><div class="mc-sm-lbl">${k}</div><div class="mc-sm-val">${v.d}/${v.t} ${formatSmPct(v.d,v.t)}</div></div>`;
        });
    }

    // 4. CSSC
    const tr4 = document.getElementById('sum-cssc-total');
    if (tr4) {
        tr4.style.cursor = 'pointer';
        tr4.title = 'Click to view All CSSC Certificates';
        tr4.onclick = () => openCertModal('CSSC', 'ALL');
        tr4.innerHTML = `${mcData.cssc.done.toLocaleString()} / ${mcData.cssc.total.toLocaleString()} <span style="font-size:0.75rem; color:#10b981;">${mcData.cssc.total > 0 ? ((mcData.cssc.done/mcData.cssc.total)*100).toFixed(1) : 0}%</span>`;
    }
    const gr4 = document.getElementById('grid-cssc');
    if (gr4) {
        gr4.innerHTML = '';
        Object.keys(sumCssc).sort().forEach(k => { 
            const v = sumCssc[k];
            gr4.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openCertModal('CSSC', '${k}')" title="Click to view details"><div class="mc-sm-lbl" title="${k}">${k}</div><div class="mc-sm-val">${v.d}/${v.t} ${formatSmPct(v.d,v.t)}</div></div>`;
        });
    }
}

function renderCell(d, t, isRedZero) {
    if (t === 0) return `<td class="dash">-</td>`;
    const pct = ((d / t) * 100).toFixed(1);
    let pctClass = '';
    if (isRedZero && pct === '0.0') pctClass = 'pct-0';
    else if (pct === '100.0') pctClass = 'pct-100';

    return `
        <td>
            <div class="cell-val">
                <span class="cell-nums">${d}/${t}</span>
                <span class="cell-pct ${pctClass}">${pct}%</span>
            </div>
        </td>
    `;
}

function renderPunchCell(d, t, isRedZero, sub, disc, cat) {
    if (t === 0) return `<td class="dash">-</td>`;
    const pct = ((d / t) * 100).toFixed(1);
    let pctClass = '';
    if (isRedZero && pct === '0.0') pctClass = 'pct-0';
    else if (pct === '100.0') pctClass = 'pct-100';

    return `
        <td class="cell-interactive" onclick="openSubsysPunchDetail('${sub}', '${disc}', '${cat}')" title="Click to view Punch ${cat} details for ${sub} (${disc})">
            <div class="cell-val">
                <span class="cell-nums">${d}/${t}</span>
                <span class="cell-pct ${pctClass}">${pct}%</span>
                <button class="cell-tool-btn" type="button" title="View Punch ${cat} list for ${sub} - ${disc}" onclick="event.stopPropagation(); openSubsysPunchDetail('${sub}', '${disc}', '${cat}')">
                    <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                </button>
            </div>
        </td>
    `;
}

window.openSubsysPunchDetail = function(subsys, disc, cat) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    openPunchModal('ALL', cat);
    currentPunchDiscFilter = disc;
    const searchInput = document.getElementById('punch-search-input');
    if (searchInput) {
        searchInput.value = subsys;
        currentPunchSearch = subsys;
    }
    renderPunchTopBoxes();
    renderPunchModalTable();
};

function renderItrCell(d, t, sub, disc) {
    if (t === 0) return `<td class="dash">-</td>`;
    const pct = ((d / t) * 100).toFixed(1);
    let pctClass = '';
    if (pct === '100.0') pctClass = 'pct-100';
    else if (pct === '0.0') pctClass = 'pct-0';

    return `
        <td class="cell-interactive" onclick="openChecksheetDetail('${sub}', '${disc}')" title="Click to view ITR-A details for ${sub} (${disc})">
            <div class="cell-val">
                <span class="cell-nums">${d}/${t}</span>
                <span class="cell-pct ${pctClass}">${pct}%</span>
                <button class="cell-tool-btn" type="button" title="View checksheet list for ${sub} - ${disc}" onclick="event.stopPropagation(); openChecksheetDetail('${sub}', '${disc}')">
                    <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                    </svg>
                </button>
            </div>
        </td>
    `;
}


// ----------------- SKYLINE DATE UTILS -----------------
function formatSkylineDate(dateVal) {
    if (!dateVal || dateVal === 'N/A' || dateVal === '-' || dateVal === 'None' || dateVal === 'NaT') return '-';
    const str = String(dateVal).trim().split('T')[0].split(' ')[0];
    const parts = str.split('-');
    if (parts.length === 3 && parts[0].length === 4) {
        const [y, m, d] = parts;
        return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
    }
    if (str.includes('/')) return str;
    const dt = new Date(dateVal);
    if (!isNaN(dt.getTime())) {
        const d = String(dt.getDate()).padStart(2, '0');
        const m = String(dt.getMonth() + 1).padStart(2, '0');
        const y = dt.getFullYear();
        return `${d}/${m}/${y}`;
    }
    return str;
}

function getSubsysSkylineDate(sub) {
    if (!sub) return null;
    const cleanSub = String(sub).trim();
    const gd = window.GLOBAL_MC_DATA || {};
    const sd = gd.subsysSkylineDates || (window.PRELOADED_MC_DATA && window.PRELOADED_MC_DATA.data ? window.PRELOADED_MC_DATA.data.subsysSkylineDates : {}) || {};
    if (sd[cleanSub]) {
        return sd[cleanSub].targetDate || sd[cleanSub].handoverDate || sd[cleanSub].csscDate || null;
    }
    if (gd.skyData && gd.skyData.subsysPlanWeek && gd.skyData.subsysPlanWeek[cleanSub]) {
        return gd.skyData.subsysPlanWeek[cleanSub];
    }
    return null;
}

function getDisciplineSkylineDate(sub, discNameOrCode) {
    if (!sub) return null;
    const cleanSub = String(sub).trim();
    const gd = window.GLOBAL_MC_DATA || {};
    const sd = gd.subsysSkylineDates || (window.PRELOADED_MC_DATA && window.PRELOADED_MC_DATA.data ? window.PRELOADED_MC_DATA.data.subsysSkylineDates : {}) || {};
    
    let discCode = discNameOrCode;
    const DISC_TO_CODE = {
        'MECHANICAL': 'MEC',
        'PIPING': 'PIP',
        'ELECTRICAL': 'ELE',
        'INSTRUMENT': 'INS',
        'TELECOM': 'TEL',
        'STRUCTURE': 'STR',
        'ARCHITECTURE': 'ARC',
        'HVAC': 'HVA',
        'SAFETY': 'SAF'
    };
    if (DISC_TO_CODE[discNameOrCode]) discCode = DISC_TO_CODE[discNameOrCode];

    if (sd[cleanSub]) {
        if (sd[cleanSub].discDates && sd[cleanSub].discDates[discCode]) {
            return sd[cleanSub].discDates[discCode];
        }
        return sd[cleanSub].targetDate || sd[cleanSub].handoverDate || sd[cleanSub].csscDate || null;
    }
    if (gd.skyData && gd.skyData.subsysPlanWeek && gd.skyData.subsysPlanWeek[cleanSub]) {
        return gd.skyData.subsysPlanWeek[cleanSub];
    }
    return null;
}

function renderMatrix(matrix) {
    const tbody = document.getElementById('tbody-matrix');
    if (!tbody) return;
    
    // Get filter values
    const sysFilter = document.getElementById('filter-sys') ? document.getElementById('filter-sys').value : 'ALL';
    const subFilter = document.getElementById('filter-subsys') ? document.getElementById('filter-subsys').value.toLowerCase().trim() : '';
    const incFilter = document.getElementById('filter-incomplete') ? document.getElementById('filter-incomplete').checked : false;
    const compFilter = document.getElementById('filter-completed') ? document.getElementById('filter-completed').checked : false;
    const sumCssc = window.GLOBAL_MC_DATA ? window.GLOBAL_MC_DATA.sumCssc : {};

    tbody.innerHTML = '';

    // Sort systems chronologically by earliest date, or by completed ITR-A count if compFilter is active
    const systems = Object.keys(matrix).sort((a, b) => {
        if (compFilter) {
            const getSysDone = (sysName) => {
                let d = 0;
                Object.keys(matrix[sysName] || {}).forEach(s => {
                    DISCIPLINES.forEach(disc => {
                        const cell = matrix[sysName][s][disc];
                        if (cell) d += (cell.i_d || 0);
                    });
                });
                return d;
            };
            const doneA = getSysDone(a);
            const doneB = getSysDone(b);
            if (doneB !== doneA) return doneB - doneA;
        }

        const getEarliest = (sys) => {
            let earliest = null;
            Object.keys(matrix[sys] || {}).forEach(s => {
                const d = getSubsysSkylineDate(s);
                if (d && (!earliest || d < earliest)) earliest = d;
            });
            return earliest;
        };
        const dateA = getEarliest(a);
        const dateB = getEarliest(b);
        if (dateA && dateB) {
            if (dateA !== dateB) return dateA.localeCompare(dateB);
            return a.localeCompare(b);
        }
        if (dateA && !dateB) return -1;
        if (!dateA && dateB) return 1;
        return a.localeCompare(b);
    });

    if (systems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="29" style="text-align:center; padding: 4rem;">No Data Found</td></tr>';
        return;
    }

    systems.forEach(sys => {
        if (sysFilter !== 'ALL' && sys !== sysFilter) return;

        let hasVisibleSubsys = false;
        const sysFragment = document.createDocumentFragment();

        // Sort subsystems chronologically by Skyline Date (or by completion percentage if compFilter is active)
        const subsysKeys = Object.keys(matrix[sys]).sort((a, b) => {
            if (compFilter) {
                const getCompStats = (subName) => {
                    let t = 0, d = 0;
                    DISCIPLINES.forEach(disc => {
                        const cell = matrix[sys][subName][disc];
                        if (cell) { t += (cell.i_t || 0); d += (cell.i_d || 0); }
                    });
                    const pct = t > 0 ? (d / t) : 0;
                    return { t, d, pct };
                };
                const statsA = getCompStats(a);
                const statsB = getCompStats(b);
                if (statsB.pct !== statsA.pct) return statsB.pct - statsA.pct;
                if (statsB.d !== statsA.d) return statsB.d - statsA.d;
            }
            const dateA = getSubsysSkylineDate(a);
            const dateB = getSubsysSkylineDate(b);
            if (dateA && dateB) {
                if (dateA !== dateB) return dateA.localeCompare(dateB);
                return a.localeCompare(b);
            }
            if (dateA && !dateB) return -1;
            if (!dateA && dateB) return 1;
            return a.localeCompare(b);
        });

        subsysKeys.forEach(sub => {
            if (subFilter && !sub.toLowerCase().includes(subFilter)) return;

            let isIncomplete = false;
            let subTotalItr = 0;
            let subDoneItr = 0;
            const subSkyDate = getSubsysSkylineDate(sub);
            const formattedDate = formatSkylineDate(subSkyDate);

            let html = `<td class="col-sys">${sub}</td><td class="col-skyline-date">${formattedDate}</td>`;
            
            DISCIPLINES.forEach(disc => {
                const data = matrix[sys][sub][disc];
                html += renderItrCell(data.i_d, data.i_t, sub, disc);
                html += renderPunchCell(data.pa_d, data.pa_t, true, sub, disc, 'A');
                html += renderPunchCell(data.pb_d, data.pb_t, false, sub, disc, 'B');
                html += renderPunchCell(data.pc_d, data.pc_t, false, sub, disc, 'C');

                subTotalItr += (data.i_t || 0);
                subDoneItr += (data.i_d || 0);

                if (data.i_t > 0 && data.i_d < data.i_t) isIncomplete = true;
                if (data.pa_t > 0 && data.pa_d < data.pa_t) isIncomplete = true;
                if (data.pb_t > 0 && data.pb_d < data.pb_t) isIncomplete = true;
                if (data.pc_t > 0 && data.pc_d < data.pc_t) isIncomplete = true;
            });
            
            if (sumCssc[sub] && sumCssc[sub].t > 0 && sumCssc[sub].d < sumCssc[sub].t) isIncomplete = true;
            if (incFilter && !isIncomplete) return;
            if (compFilter && subDoneItr === 0) return;

            const trSub = document.createElement('tr');
            trSub.className = 'subsys-row';
            trSub.innerHTML = html;
            sysFragment.appendChild(trSub);
            hasVisibleSubsys = true;
        });

        if (hasVisibleSubsys) {
            let sysMinDate = null;
            subsysKeys.forEach(s => {
                const d = getSubsysSkylineDate(s);
                if (d && (!sysMinDate || d < sysMinDate)) sysMinDate = d;
            });
            const trSys = document.createElement('tr');
            trSys.className = 'sys-row';
            trSys.innerHTML = `<td class="col-sys">SYSTEM ${sys}</td><td class="col-skyline-date" style="color: #60a5fa; font-weight:700;">${sysMinDate ? formatSkylineDate(sysMinDate) : '-'}</td><td colspan="36"></td>`;
            tbody.appendChild(trSys);
            tbody.appendChild(sysFragment);
        }
    });
    
    if (tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="38" style="text-align:center; padding: 4rem;">No matching data</td></tr>';
    }
}

// --- FILTERING & EXPORT LOGIC ---
function populateSysDropdown(matrix) {
    const sel = document.getElementById('filter-sys');
    if (!sel) return;
    sel.innerHTML = '<option value="ALL">All systems</option>';
    Object.keys(matrix).sort().forEach(sys => {
        sel.innerHTML += `<option value="${sys}">System ${sys}</option>`;
    });
}

function setupFilters() {
    const filterSys = document.getElementById('filter-sys');
    const filterSub = document.getElementById('filter-subsys');
    const filterInc = document.getElementById('filter-incomplete');
    const filterComp = document.getElementById('filter-completed');
    const filterTag = document.getElementById('filter-tag');

    if (filterInc && filterComp) {
        filterInc.addEventListener('change', () => {
            if (filterInc.checked) filterComp.checked = false;
        });
        filterComp.addEventListener('change', () => {
            if (filterComp.checked) filterInc.checked = false;
        });
    }

    const updateView = () => {
        if (!window.GLOBAL_MC_DATA) return;
        const tagQ = filterTag.value.trim().toLowerCase();
        
        if (tagQ.length > 0) {
            document.querySelector('.matrix-container').style.display = 'none';
            document.getElementById('tag-results-container').style.display = 'block';
            renderTagResults(tagQ);
        } else {
            document.querySelector('.matrix-container').style.display = 'block';
            document.getElementById('tag-results-container').style.display = 'none';
            renderMatrix(window.GLOBAL_MC_DATA.matrix);
        }
    };

    if (filterSys) filterSys.addEventListener('change', updateView);
    if (filterSub) filterSub.addEventListener('input', updateView);
    if (filterInc) filterInc.addEventListener('change', updateView);
    if (filterComp) filterComp.addEventListener('change', updateView);
    if (filterTag) filterTag.addEventListener('input', updateView);

    // Exports
    document.getElementById('btn-export-selected').addEventListener('click', () => exportMatrix(false));
    document.getElementById('btn-export-all').addEventListener('click', () => exportMatrix(true));
}

function renderTagResults(q) {
    const tbody = document.getElementById('tbody-tag-results');
    const info = document.getElementById('tag-search-info');
    if (!tbody || !window.GLOBAL_MC_DATA || !window.GLOBAL_MC_DATA.globalTagMap) return;
    
    tbody.innerHTML = '';
    const tags = Object.values(window.GLOBAL_MC_DATA.globalTagMap).filter(t => t.tag.toLowerCase().includes(q));
    
    info.textContent = `Search Results for Tag / Equipment No: ${tags.length} tags match "${q}"`;
    
    if (tags.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem;">No matching tags</td></tr>';
        return;
    }
    
    // Show top 200 to prevent lagging if query is short
    tags.slice(0, 200).forEach(t => {
        const pct = t.itrTotal > 0 ? ((t.itrDone/t.itrTotal)*100).toFixed(0) : 0;
        let statColor = '#ef4444';
        if (pct === '100') statColor = '#10b981';
        else if (pct > 0) statColor = '#f59e0b';
        
        tbody.innerHTML += `
            <tr class="tag-row">
                <td style="font-weight:600; color:#e2e8f0;">${t.tag}</td>
                <td style="color:#cbd5e1; max-width:250px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${t.desc}">${t.desc}</td>
                <td>${t.subsys}</td>
                <td>${t.disc}</td>
                <td style="text-align:center;">${t.itrDone}/${t.itrTotal}</td>
                <td style="text-align:center;"><span style="background:rgba(255,255,255,0.1); padding:2px 6px; border-radius:4px; font-size:0.75rem; color:${statColor}">${pct}%</span></td>
            </tr>
        `;
    });
}

function exportMatrix(isAll) {
    const matrixTable = document.getElementById('matrix-table');
    const tagTableContainer = document.getElementById('tag-results-container');
    
    if (tagTableContainer.style.display === 'block') {
        exportTableToExcel('tag-table', 'LQP_Tag_Search.xlsx');
        return;
    }

    if (isAll) {
        // Unfilter temporarily
        const oldSys = document.getElementById('filter-sys').value;
        const oldSub = document.getElementById('filter-subsys').value;
        const oldInc = document.getElementById('filter-incomplete').checked;
        const oldComp = document.getElementById('filter-completed') ? document.getElementById('filter-completed').checked : false;
        
        document.getElementById('filter-sys').value = 'ALL';
        document.getElementById('filter-subsys').value = '';
        document.getElementById('filter-incomplete').checked = false;
        if (document.getElementById('filter-completed')) document.getElementById('filter-completed').checked = false;
        
        renderMatrix(window.GLOBAL_MC_DATA.matrix);
        exportTableToExcel('matrix-table', 'LQP_Matrix_All.xlsx');
        
        // Restore
        document.getElementById('filter-sys').value = oldSys;
        document.getElementById('filter-subsys').value = oldSub;
        document.getElementById('filter-incomplete').checked = oldInc;
        if (document.getElementById('filter-completed')) document.getElementById('filter-completed').checked = oldComp;
        renderMatrix(window.GLOBAL_MC_DATA.matrix);
    } else {
        exportTableToExcel('matrix-table', 'LQP_Matrix_Filtered.xlsx');
    }
}

function exportTableToExcel(tableId, filename) {
    const table = document.getElementById(tableId);
    if (!table) return;
    
    const wb = XLSX.utils.table_to_book(table, { sheet: "Data" });
    XLSX.writeFile(wb, filename);
}


function renderSkylineBoxes(mcData, sumItr) {
    const total = mcData.itrA.total;
    const done = mcData.itrA.done;
    const remain = total - done;
    const prog = total > 0 ? ((done / total) * 100).toFixed(1) : 0;

    document.getElementById('sky-val-total').innerText = total.toLocaleString();
    document.getElementById('sky-val-comp').innerText = done.toLocaleString();
    document.getElementById('sky-val-rem').innerText = remain.toLocaleString();
    document.getElementById('sky-val-prog').innerText = `${prog}%`;

    const sideList = document.getElementById('sky-side-list');
    if (!sideList) return;

    let html = `
        <div class="sky-side-item active">
            <div class="sky-side-item-top">
                <span class="sky-side-item-title">Overall LQP Topside</span>
                <span class="sky-side-item-pct" style="color:#ef4444;">${prog}%</span>
            </div>
            <div class="sky-side-item-desc">${done.toLocaleString()} / ${total.toLocaleString()} ITR-A</div>
        </div>
    `;

    DISCIPLINES.forEach(k => {
        const v = sumItr[k];
        if (v && v.t > 0) {
            const p = ((v.d/v.t)*100).toFixed(1);
            html += `
                <div class="sky-side-item" onclick="openDisciplineModal('${k}')">
                    <div class="sky-side-item-top">
                        <span class="sky-side-item-title" style="text-transform: capitalize;">${String(k).toLowerCase()}</span>
                        <span class="sky-side-item-pct" style="color:#ef4444;">${p}%</span>
                    </div>
                    <div class="sky-side-item-desc">${v.d.toLocaleString()} / ${v.t.toLocaleString()} ITR-A</div>
                </div>
            `;
        }
    });
    sideList.innerHTML = html;
}

function renderSkylineChart(labels, planBar, actBar, planLine, actLine) {
    const ctx = document.getElementById('skylineChart');
    if (!ctx) return;
    
    if (skylineChartInstance) {
        skylineChartInstance.destroy();
    }

    skylineChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                { type: 'line', label: 'ACTUAL CUM %', data: actLine, borderColor: '#a855f7', backgroundColor: '#a855f7', borderWidth: 2, yAxisID: 'y1', tension: 0.1, pointRadius: 3 },
                { type: 'line', label: 'KPI PLAN CUM %', data: planLine, borderColor: '#ef4444', backgroundColor: '#ef4444', borderWidth: 2, yAxisID: 'y1', tension: 0.1, pointRadius: 3 },
                { type: 'bar', label: 'ACTUAL (ITR/week)', data: actBar, backgroundColor: '#10b981', yAxisID: 'y', barPercentage: 0.8 },
                { type: 'bar', label: 'KPI PLAN (ITR/week)', data: planBar, backgroundColor: '#3b82f6', yAxisID: 'y', barPercentage: 0.8 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { color: '#cbd5e1', usePointStyle: true, boxWidth: 8, font: { size: 10 } } } },
            scales: {
                x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8', font: { size: 9 }, maxRotation: 90, minRotation: 90 } },
                y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'ITR / week', color: '#94a3b8' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#94a3b8' } },
                y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Cumulative %', color: '#94a3b8' }, grid: { drawOnChartArea: false }, min: 0, max: 100, ticks: { color: '#94a3b8', callback: function(value) { return value + '%'; } } }
            }
        }
    });
}

// ----------------- MODAL LOGIC (Phase 6) -----------------
function openDisciplineModal(disc) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;

    // Show modal
    document.getElementById('disc-modal').style.display = 'flex';
    document.getElementById('modal-title').innerHTML = `Discipline: ${disc} <span style="font-size: 0.8rem; font-weight: 400; color: #94a3b8; margin-left: 10px;">Whole Project</span>`;
    document.getElementById('mdl-chart-title').innerText = `S-Curve ITR-A - Whole Project - Discipline ${disc}`;

    // Calculate Modal 4 Boxes
    let itrT = 0, itrD = 0, paT = 0, paD = 0, pbT = 0, pbD = 0, dacT = 0, dacD = 0;
    
    let subTbodyHtml = '';
    let idx = 1;
    let rowCount = 0;
    let modalItems = [];

    Object.keys(gd.matrix).forEach(sys => {
        Object.keys(gd.matrix[sys]).forEach(sub => {
            const data = gd.matrix[sys][sub][disc];
            if (!data) return;
            
            // Show subsystem if it has ANY data for this discipline (ITR or Punch)
            const hasData = data.i_t > 0 || data.pa_t > 0 || data.pb_t > 0;
            if (!hasData) return;
            
            rowCount++;

            itrT += data.i_t;
            itrD += data.i_d;
            paT += data.pa_t;
            paD += data.pa_d;
            pbT += data.pb_t;
            pbD += data.pb_d;
            
            // DAC subsystem check (Assume CSSC is Subsystem DAC)
            const csscObj = gd.sumCssc[sub];
            dacT += 1;
            let subDacDone = false;
            if (csscObj && csscObj.d > 0) {
                dacD += 1;
                subDacDone = true;
            }

            const subPct = data.i_t > 0 ? ((data.i_d / data.i_t) * 100).toFixed(1) : '0.0';
            const desc = gd.sysDescMap[sub] || '';
            const skyDate = getDisciplineSkylineDate(sub, disc);

            modalItems.push({
                sys,
                sub,
                desc,
                skyDate,
                data,
                subPct,
                subDacDone
            });
        });
    });

    // Sort modalItems chronologically by skyDate (earliest date first; empty at the end)
    modalItems.sort((a, b) => {
        if (a.skyDate && b.skyDate) {
            if (a.skyDate !== b.skyDate) return a.skyDate.localeCompare(b.skyDate);
            return a.sub.localeCompare(b.sub);
        }
        if (a.skyDate && !b.skyDate) return -1;
        if (!a.skyDate && b.skyDate) return 1;
        return a.sub.localeCompare(b.sub);
    });

    const fmtCell = (d, t) => t > 0 ? `${d}/${t}` : '-';

    modalItems.forEach(item => {
        subTbodyHtml += `
            <tr>
                <td>${idx++}</td>
                <td>${item.sys}</td>
                <td><b>${item.sub}</b></td>
                <td>${item.desc}</td>
                <td style="font-weight:600; font-family:monospace; color:#0284c7; text-align:center;">${formatSkylineDate(item.skyDate)}</td>
                <td>${fmtCell(item.data.i_d, item.data.i_t)}</td>
                <td><span style="color: ${item.subPct === '100.0' ? '#10b981' : (item.subPct === '0.0' ? '#ef4444' : '#0f172a')}">${item.subPct}%</span></td>
                <td>${fmtCell(item.data.pa_d, item.data.pa_t)}</td>
                <td>${fmtCell(item.data.pb_d, item.data.pb_t)}</td>
                <td>${item.subDacDone ? '<span style="color:#10b981;">&#10004;</span>' : '-'}</td>
            </tr>
        `;
    });

    document.getElementById('mdl-tbody').innerHTML = subTbodyHtml;
    document.getElementById('mdl-table-title').innerHTML = `Subsystem Summary (${rowCount}) <span style="font-size:0.75rem; color:#64748b; font-weight:400; margin-left:10px;">Click row to view details (Coming soon)</span>`;
    
    // Update Top Boxes HTML
    const fPct = (d, t) => t > 0 ? ((d/t)*100).toFixed(1) + '%' : '0.0%';
    document.getElementById('mdl-itra').innerHTML = `${itrD.toLocaleString()} / ${itrT.toLocaleString()} <span style="font-size:1rem; color:${itrD===itrT && itrT>0 ? '#10b981' : '#ef4444'}; font-weight:700;">${fPct(itrD, itrT)}</span>`;
    document.getElementById('mdl-puncha').innerHTML = `${paD.toLocaleString()} / ${paT.toLocaleString()} <span style="font-size:1rem; color:#ef4444; font-weight:700;">${fPct(paD, paT)}</span>`;
    document.getElementById('mdl-punchb').innerHTML = `${pbD.toLocaleString()} / ${pbT.toLocaleString()} <span style="font-size:1rem; color:#ef4444; font-weight:700;">${fPct(pbD, pbT)}</span>`;
    document.getElementById('mdl-dac').innerHTML = `${dacD.toLocaleString()} / ${dacT.toLocaleString()} <span style="font-size:1rem; color:#ef4444; font-weight:700;">${fPct(dacD, dacT)}</span>`;

    // Modal Chart
    const pMap = gd.skyData.discPlanByWeek[disc] || {};
    const aMap = gd.skyData.discActualByWeek[disc] || {};
    
    const allWeeksSet = new Set([...Object.keys(pMap), ...Object.keys(aMap)]);
    const allWeeks = Array.from(allWeeksSet).sort();

    let chartLabels = [];
    let planBar = [];
    let actBar = [];
    let planLine = [];
    let actLine = [];
    let planCumSum = 0;
    let actCumSum = 0;

    for (const wk of allWeeks) {
        chartLabels.push(formatWeekKey(wk));
        const pVal = pMap[wk] || 0;
        const aVal = aMap[wk] || 0;
        planBar.push(pVal);
        actBar.push(aVal);
        planCumSum += pVal;
        actCumSum += aVal;
        planLine.push(itrT > 0 ? (planCumSum / itrT * 100) : 0);
        actLine.push(itrT > 0 ? (actCumSum / itrT * 100) : 0);
    }

    const ctx = document.getElementById('modalChart');
    if (!ctx) return;
    if (modalChartInstance) modalChartInstance.destroy();

    modalChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: chartLabels,
            datasets: [
                { type: 'line', label: 'Cumulative Actual', data: actLine, borderColor: '#f59e0b', backgroundColor: '#f59e0b', borderWidth: 2, yAxisID: 'y1', tension: 0.1, pointRadius: 3 },
                { type: 'line', label: 'Cumulative Plan', data: planLine, borderColor: '#3b82f6', backgroundColor: '#3b82f6', borderWidth: 2, yAxisID: 'y1', tension: 0.1, pointRadius: 3 },
                { type: 'bar', label: 'ITR-A Closed / Week', data: actBar, backgroundColor: '#10b981', yAxisID: 'y', barPercentage: 0.8 },
                { type: 'bar', label: 'Plan ITR-A / Week', data: planBar, backgroundColor: '#ef4444', yAxisID: 'y', barPercentage: 0.8 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
            plugins: { legend: { position: 'top', labels: { boxWidth: 10, font: { size: 11 } } } },
            scales: {
                x: { ticks: { font: { size: 9 }, maxRotation: 90, minRotation: 90 } },
                y: { type: 'linear', display: true, position: 'left', title: { display: true, text: 'ITR-A' }, min: 0 },
                y1: { type: 'linear', display: true, position: 'right', title: { display: true, text: 'Cumulative %' }, grid: { drawOnChartArea: false }, min: 0, max: 100 }
            }
        }
    });
}

// ----------------- PUNCH & CERT MODAL LOGIC (Phase 7) -----------------

function formatDateStr(val) {
    const d = parseExcelDate(val);
    if (!d) return '';
    return d.toISOString().split('T')[0];
}

// ==========================================
// PUNCH MODAL STATE & FUNCTIONS
// ==========================================
let currentPunchPhase = 'ALL';
let currentPunchCat = 'ALL';
let currentPunchScope = 'ALL';
let currentPunchSys = 'ALL';
let currentPunchSubsys = 'ALL';
let currentPunchList = [];
let currentPunchDiscFilter = 'ALL';
let currentPunchStatusFilter = 'ALL'; // 'ALL' | 'OPEN' | 'CLOSED'
let currentPunchSearch = '';
let currentPunchPkgSearch = '';

function getPunchBaseForDropdowns() {
    const gd = window.GLOBAL_MC_DATA;
    let punches = (gd && gd.globalPunchList) ? gd.globalPunchList : [];
    if (currentPunchPhase !== 'ALL') {
        punches = punches.filter(p => p.phase === currentPunchPhase);
    }
    if (currentPunchCat !== 'ALL') {
        punches = punches.filter(p => p.cat && p.cat.includes(currentPunchCat));
    }
    if (currentPunchScope !== 'ALL') {
        punches = punches.filter(p => {
            const key = String(p.subsys || p.sys || '').trim().toUpperCase();
            return key.startsWith(currentPunchScope);
        });
    }
    return punches;
}

function populatePunchSysDropdowns() {
    const base = getPunchBaseForDropdowns();
    const sysSel = document.getElementById('punch-filter-sys');
    if (sysSel) {
        const systems = Array.from(new Set(base.map(p => String(p.sys || '').trim()).filter(Boolean))).sort();
        if (currentPunchSys !== 'ALL' && !systems.includes(currentPunchSys)) {
            currentPunchSys = 'ALL';
            currentPunchSubsys = 'ALL';
        }
        sysSel.innerHTML = `<option value="ALL">All Systems (${systems.length})</option>` +
            systems.map(s => `<option value="${s}" ${currentPunchSys === s ? 'selected' : ''}>${s}</option>`).join('');
    }
    populatePunchSubsysDropdown();
}

function populatePunchSubsysDropdown() {
    let base = getPunchBaseForDropdowns();
    if (currentPunchSys !== 'ALL') {
        base = base.filter(p => String(p.sys || '').trim() === currentPunchSys);
    }
    const subSel = document.getElementById('punch-filter-subsys');
    if (subSel) {
        const subs = Array.from(new Set(base.map(p => String(p.subsys || '').trim()).filter(Boolean))).sort();
        if (currentPunchSubsys !== 'ALL' && !subs.includes(currentPunchSubsys)) {
            currentPunchSubsys = 'ALL';
        }
        subSel.innerHTML = `<option value="ALL">All SubSystems (${subs.length})</option>` +
            subs.map(s => `<option value="${s}" ${currentPunchSubsys === s ? 'selected' : ''}>${s}</option>`).join('');
    }
}

function populatePunchPhaseDropdown() {
    const sel = document.getElementById('punch-filter-phase');
    if (!sel) return;
    const gd = window.GLOBAL_MC_DATA;
    const currentVal = currentPunchPhase || 'ALL';
    
    const phases = new Set();
    if (gd && gd.globalPunchList) {
        gd.globalPunchList.forEach(p => {
            if (p.phase && p.phase !== 'UNKNOWN') phases.add(p.phase);
        });
    }
    
    let html = '<option value="ALL">All Phases</option>';
    const sortedPhases = Array.from(phases).sort();
    sortedPhases.forEach(ph => {
        let label = ph;
        if (ph === 'LQ-FAT') label = 'FAT (LQ-FAT)';
        else if (ph === 'LQ-OSD') label = 'OSD (LQ-OSD)';
        html += `<option value="${ph}">${label}</option>`;
    });
    sel.innerHTML = html;
    if (Array.from(sel.options).some(o => o.value === currentVal)) {
        sel.value = currentVal;
    } else {
        sel.value = 'ALL';
    }
}

function openPunchModal(phase, catType, scope, sys) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    
    currentPunchPhase = phase || 'ALL';
    currentPunchCat = catType || 'ALL';
    currentPunchScope = scope || 'ALL';
    currentPunchSys = sys || 'ALL';
    currentPunchSubsys = 'ALL';
    currentPunchDiscFilter = 'ALL';
    currentPunchStatusFilter = 'ALL';
    currentPunchSearch = '';

    // Populate and sync phase, cat & scope dropdowns
    populatePunchPhaseDropdown();
    const phaseSelect = document.getElementById('punch-filter-phase');
    if (phaseSelect) phaseSelect.value = currentPunchPhase;
    const catSelect = document.getElementById('punch-filter-cat');
    if (catSelect) catSelect.value = currentPunchCat;
    const scopeSelect = document.getElementById('punch-filter-scope');
    if (scopeSelect) scopeSelect.value = currentPunchScope;

    currentPunchPkgSearch = '';

    // Reset Search input
    const searchInput = document.getElementById('punch-search-input');
    if (searchInput) searchInput.value = '';
    const pkgSearchInput = document.getElementById('punch-pkg-search-input');
    if (pkgSearchInput) pkgSearchInput.value = '';

    // Reset status filter buttons UI
    updatePunchStatusTabUI('ALL');

    document.getElementById('punch-modal').style.display = 'flex';

    populatePunchSysDropdowns();
    refreshPunchModalData();
}
window.openPunchModal = openPunchModal;

function refreshPunchModalData() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;

    let punches = getPunchBaseForDropdowns();
    if (currentPunchSys !== 'ALL') {
        punches = punches.filter(p => String(p.sys || '').trim() === currentPunchSys);
    }
    if (currentPunchSubsys !== 'ALL') {
        punches = punches.filter(p => String(p.subsys || '').trim() === currentPunchSubsys);
    }
    currentPunchList = punches;

    // Update modal main header title
    const modalTitleEl = document.getElementById('punch-modal-title');
    if (modalTitleEl) {
        let titleMain = '';
        let titleSub = 'Whole Project - All disciplines';
        if (currentPunchPhase === 'ALL' && currentPunchCat === 'ALL') {
            titleMain = 'All Punches (Master Register)';
            titleSub = 'Whole Project - All phases & categories';
        } else if (currentPunchPhase === 'ALL') {
            titleMain = `All Punches (Cat ${currentPunchCat})`;
            titleSub = 'Whole Project - All phases';
        } else if (currentPunchCat === 'ALL') {
            titleMain = `Punch ${currentPunchPhase} (All Categories)`;
            titleSub = 'Whole Project - All categories';
        } else {
            titleMain = `Punch ${currentPunchPhase}_${currentPunchCat}`;
        }
        modalTitleEl.innerHTML = `${titleMain} <span style="font-size: 0.8rem; font-weight: 400; color: #94a3b8; margin-left: 10px;">${titleSub}</span>`;
    }

    renderPunchTopBoxes();
    renderPunchModalTable();
}

function renderPunchTopBoxes() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd || !currentPunchList) return;

    let total = 0, closed = 0;
    let discCount = {};
    DISCIPLINES.forEach(d => discCount[d] = {t:0, d:0});

    currentPunchList.forEach(p => {
        total++;
        const isClosed = p.status && p.status.toUpperCase().includes('CLOSE');
        if (isClosed) closed++;
        
        if (discCount[p.disc]) {
            discCount[p.disc].t++;
            if (isClosed) discCount[p.disc].d++;
        }
    });

    const fPct = (d, t) => t > 0 ? ((d/t)*100).toFixed(1) + '%' : '0.0%';
    const isAllActive = currentPunchDiscFilter === 'ALL';
    
    let boxesHtml = `
        <div class="sky-top-box punch-filter-box" onclick="filterPunchTable('ALL')" style="cursor: pointer; background: #fff; color: #1e293b; border: 2px solid ${isAllActive ? '#0ea5e9' : '#cbd5e1'}; box-shadow: ${isAllActive ? '0 0 0 2px rgba(14,165,233,0.3)' : 'none'}; text-align: left; min-width: 150px; transition: all 0.2s;" onmouseover="if(!this.style.borderColor.includes('0ea5e9')) this.style.background='#f1f5f9'" onmouseout="this.style.background='#fff'">
            <div class="sky-box-title" style="color: ${isAllActive ? '#0ea5e9' : '#64748b'}; font-weight: 700;">ALL DISCIPLINES</div>
            <div class="sky-box-val" style="color: #0ea5e9;">${closed} / ${total} <span style="font-size:1rem; color:#ef4444; font-weight:700;">${fPct(closed, total)}</span></div>
        </div>
    `;
    
    DISCIPLINES.forEach(d => {
        const v = discCount[d];
        if (v && v.t > 0) {
            const isDiscActive = currentPunchDiscFilter === d;
            boxesHtml += `
                <div class="sky-top-box punch-filter-box" onclick="filterPunchTable('${d}')" style="cursor: pointer; background: #fff; color: #1e293b; border: 2px solid ${isDiscActive ? '#0ea5e9' : '#cbd5e1'}; box-shadow: ${isDiscActive ? '0 0 0 2px rgba(14,165,233,0.3)' : 'none'}; text-align: left; min-width: 120px; transition: all 0.2s;" onmouseover="if(!this.style.borderColor.includes('0ea5e9')) this.style.background='#f1f5f9'" onmouseout="this.style.background='#fff'">
                    <div class="sky-box-title" style="color: ${isDiscActive ? '#0ea5e9' : '#64748b'}; font-weight: 700;" title="${d}">${d.substring(0,4)}</div>
                    <div class="sky-box-val" style="color: #0f172a; font-size: 1.2rem;">${v.d} / ${v.t} <span style="font-size:0.8rem; color:#ef4444; font-weight:700;">${fPct(v.d, v.t)}</span></div>
                </div>
            `;
        }
    });
    
    const topBoxesContainer = document.getElementById('punch-top-boxes');
    if (topBoxesContainer) topBoxesContainer.innerHTML = boxesHtml;
}

window.filterPunchTable = function(disc) {
    currentPunchDiscFilter = disc;
    renderPunchTopBoxes();
    renderPunchModalTable();
};

function updatePunchStatusTabUI(status) {
    const btnAll = document.getElementById('punch-filter-all');
    const btnOpen = document.getElementById('punch-filter-open');
    const btnClosed = document.getElementById('punch-filter-closed');

    if (!btnAll || !btnOpen || !btnClosed) return;

    btnAll.style.background = '#fff';
    btnAll.style.color = '#64748b';
    btnOpen.style.background = '#fff';
    btnOpen.style.color = '#ef4444';
    btnClosed.style.background = '#fff';
    btnClosed.style.color = '#10b981';

    if (status === 'ALL') {
        btnAll.style.background = '#0ea5e9';
        btnAll.style.color = '#fff';
    } else if (status === 'OPEN') {
        btnOpen.style.background = '#ef4444';
        btnOpen.style.color = '#fff';
    } else if (status === 'CLOSED') {
        btnClosed.style.background = '#10b981';
        btnClosed.style.color = '#fff';
    }
}

function renderPunchModalTable() {
    const tbody = document.getElementById('punch-tbody');
    if (!tbody) return;

    let filtered = currentPunchList;

    // 1. Discipline filter
    if (currentPunchDiscFilter !== 'ALL') {
        filtered = filtered.filter(p => p.disc === currentPunchDiscFilter);
    }

    // Calculate status counts for current discipline filter
    const discTotal = filtered.length;
    let discClosed = 0;
    filtered.forEach(p => {
        if (p.status && p.status.toUpperCase().includes('CLOSE')) discClosed++;
    });
    const discOpen = discTotal - discClosed;

    // Update buttons count text
    const btnAll = document.getElementById('punch-filter-all');
    const btnOpen = document.getElementById('punch-filter-open');
    const btnClosed = document.getElementById('punch-filter-closed');
    if (btnAll) btnAll.textContent = `All (${discTotal})`;
    if (btnOpen) btnOpen.textContent = `Open (${discOpen})`;
    if (btnClosed) btnClosed.textContent = `Closed (${discClosed})`;

    // 2. Status filter
    if (currentPunchStatusFilter === 'OPEN') {
        filtered = filtered.filter(p => !p.status || !p.status.toUpperCase().includes('CLOSE'));
    } else if (currentPunchStatusFilter === 'CLOSED') {
        filtered = filtered.filter(p => p.status && p.status.toUpperCase().includes('CLOSE'));
    }

    // 3. Search query filter
    if (currentPunchSearch) {
        const q = currentPunchSearch.toLowerCase();
        filtered = filtered.filter(p =>
            (p.tag && p.tag.toLowerCase().includes(q)) ||
            (p.punchNo && p.punchNo.toLowerCase().includes(q)) ||
            (p.desc && p.desc.toLowerCase().includes(q)) ||
            (p.subsys && p.subsys.toLowerCase().includes(q)) ||
            (p.sys && p.sys.toLowerCase().includes(q)) ||
            (p.phase && p.phase.toLowerCase().includes(q)) ||
            (p.cat && p.cat.toLowerCase().includes(q)) ||
            (p.actionBy && p.actionBy.toLowerCase().includes(q)) ||
            (p.pkgName && p.pkgName.toLowerCase().includes(q))
        );
    }

    // 4. Package No filter
    if (currentPunchPkgSearch) {
        const pq = currentPunchPkgSearch.toLowerCase().trim();
        filtered = filtered.filter(p => p.pkgName && p.pkgName.toLowerCase().includes(pq));
    }

    // Update table title and header subtitle
    const tableTitle = document.getElementById('punch-table-title');
    if (tableTitle) {
        let label = (currentPunchPhase === 'ALL' && currentPunchCat === 'ALL')
            ? 'All Punches (Master Register)'
            : `Punch ${currentPunchPhase}_${currentPunchCat}`;
        let scopeText = currentPunchScope === 'ALL' ? '' : ` • Scope: ${currentPunchScope}`;
        let sysText = currentPunchSubsys !== 'ALL'
            ? ` • SubSystem: ${currentPunchSubsys}`
            : (currentPunchSys !== 'ALL' ? ` • System: ${currentPunchSys}` : '');
        let statusText = currentPunchStatusFilter === 'ALL' ? '' : ` • Status: ${currentPunchStatusFilter}`;
        let discText = currentPunchDiscFilter === 'ALL' ? '' : ` • Discipline: ${currentPunchDiscFilter}`;
        tableTitle.innerText = `${label} (${filtered.length} items shown${scopeText}${sysText}${statusText}${discText})`;
    }

    const subTitle = document.querySelector('#punch-modal-title span');
    if (subTitle) {
        if (currentPunchDiscFilter === 'ALL') {
            subTitle.innerText = (currentPunchPhase === 'ALL' && currentPunchCat === 'ALL')
                ? 'Whole Project - All phases & categories'
                : 'Whole Project - All disciplines';
        } else {
            subTitle.innerText = `Whole Project - Discipline: ${currentPunchDiscFilter} (${discTotal} items)`;
        }
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="15" style="text-align: center; padding: 3rem; color: #64748b; background: #fff;">No punch items found matching the filter criteria.</td></tr>';
        return;
    }

    let tbodyHtml = '';
    let idx = 1;
    filtered.forEach(p => {
        const isClosed = p.status && p.status.toUpperCase().includes('CLOSE');
        const trColor = isClosed ? '#dcfce7' : '#fee2e2';
        const isCatA = p.cat === 'A';
        const isCatC = p.cat === 'C';
        let catBadge = '';
        if (isCatA) {
            catBadge = `<span style="font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;">Cat A</span>`;
        } else if (isCatC) {
            catBadge = `<span style="font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;">Cat C</span>`;
        } else if (p.cat) {
            catBadge = `<span style="font-weight: 700; padding: 2px 6px; border-radius: 4px; font-size: 0.75rem; background: #fef3c7; color: #b45309; border: 1px solid #fcd34d;">Cat ${p.cat}</span>`;
        }
        const siteBadge = p.isSiteWalkdown 
            ? `<span style="display:inline-block; font-size: 0.65rem; font-weight: 800; background: #0284c7; color: #fff; padding: 1px 5px; border-radius: 3px; margin-left: 4px; vertical-align: middle;" title="Site Walkdown Finding (Pending CMS)">Site</span>`
            : '';
        tbodyHtml += `
            <tr style="background: ${trColor}; color: #0f172a;" class="punch-row" data-disc="${p.disc || ''}">
                <td>${idx++}</td>
                <td>${p.sys || ''}</td>
                <td><b>${p.subsys || ''}</b></td>
                <td style="text-align: left; color: #475569; font-size: 0.78rem; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.pkgName || ''}">${p.pkgName || '-'}</td>
                <td><b>${p.punchNo || ''}</b>${siteBadge}</td>
                <td>${p.disc || ''}</td>
                <td>${p.phase || ''}</td>
                <td>${catBadge}</td>
                <td><span style="font-weight: 700; color: ${isClosed ? '#15803d' : '#b91c1c'};">${p.status || ''}</span></td>
                <td>${p.tag || ''}</td>
                <td>${p.desc || ''}</td>
                <td>${p.actionBy || ''}</td>
                <td>${formatDateStr(p.openDate)}</td>
                <td>${formatDateStr(p.closeDate)}</td>
                <td>${formatDateStr(p.expDate)}</td>
            </tr>
        `;
    });

    tbody.innerHTML = tbodyHtml;
}

async function exportPunchToExcel() {
    if (!currentPunchList || currentPunchList.length === 0) {
        alert("No punch data to export!");
        return;
    }

    let exportList = currentPunchList;
    if (currentPunchDiscFilter !== 'ALL') {
        exportList = exportList.filter(p => p.disc === currentPunchDiscFilter);
    }
    if (currentPunchStatusFilter === 'OPEN') {
        exportList = exportList.filter(p => !p.status || !p.status.toUpperCase().includes('CLOSE'));
    } else if (currentPunchStatusFilter === 'CLOSED') {
        exportList = exportList.filter(p => p.status && p.status.toUpperCase().includes('CLOSE'));
    }

    if (currentPunchSearch) {
        const q = currentPunchSearch.toLowerCase();
        exportList = exportList.filter(p =>
            (p.tag && p.tag.toLowerCase().includes(q)) ||
            (p.punchNo && p.punchNo.toLowerCase().includes(q)) ||
            (p.desc && p.desc.toLowerCase().includes(q)) ||
            (p.subsys && p.subsys.toLowerCase().includes(q)) ||
            (p.sys && p.sys.toLowerCase().includes(q)) ||
            (p.phase && p.phase.toLowerCase().includes(q)) ||
            (p.cat && p.cat.toLowerCase().includes(q)) ||
            (p.actionBy && p.actionBy.toLowerCase().includes(q)) ||
            (p.pkgName && p.pkgName.toLowerCase().includes(q))
        );
    }
    if (currentPunchPkgSearch) {
        const pq = currentPunchPkgSearch.toLowerCase().trim();
        exportList = exportList.filter(p => p.pkgName && p.pkgName.toLowerCase().includes(pq));
    }

    if (exportList.length === 0) {
        alert("No punch items match the current filter to export!");
        return;
    }

    let baseName = 'Punch';
    if (currentPunchPhase === 'ALL' && currentPunchCat === 'ALL') {
        baseName = 'Punch_Master_Register';
    } else {
        baseName = `Punch_${currentPunchPhase}_${currentPunchCat}`;
    }
    const scopePart = currentPunchScope !== 'ALL' ? `_${currentPunchScope}` : '';
    const sysPart = currentPunchSubsys !== 'ALL' ? `_${currentPunchSubsys}` : (currentPunchSys !== 'ALL' ? `_${currentPunchSys}` : '');
    const discPart = currentPunchDiscFilter !== 'ALL' ? `_${currentPunchDiscFilter}` : '';
    const statusPart = currentPunchStatusFilter !== 'ALL' ? `_${currentPunchStatusFilter}` : '';
    const safeFileName = `${baseName}${scopePart}${sysPart}${discPart}${statusPart}.xlsx`.replace(/[^a-zA-Z0-9_.-]/g, '_');

    // If ExcelJS is not available, fallback to basic SheetJS
    if (typeof ExcelJS === 'undefined') {
        const rows = exportList.map((p, idx) => ({
            '#': idx + 1,
            'SYSTEM': p.sys || '',
            'SUBSYSTEM': p.subsys || '',
            'PACKAGE NAME': p.pkgName || '',
            'PUNCHNO': p.punchNo || '',
            'DISCIPLINE': p.disc || '',
            'PHASE': p.phase || '',
            'CAT': p.cat ? `Cat ${p.cat}` : '',
            'STATUS': p.status || '',
            'TAGNO': p.tag || '',
            'DEFECT DESCRIPTION': p.desc || '',
            'ACTION BY': p.actionBy || '',
            'OPEN': formatDateStr(p.openDate) || '',
            'CLOSED': formatDateStr(p.closeDate) || '',
            'EXPECTED': formatDateStr(p.expDate) || ''
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "PunchList");
        XLSX.writeFile(wb, safeFileName);
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Block B LQP Mechanical Completion";
        workbook.lastModifiedBy = "Block B LQP Mechanical Completion";
        workbook.created = new Date();
        workbook.modified = new Date();

        const worksheet = workbook.addWorksheet("PunchList", {
            views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
        });

        // 15 columns formatted exactly like App table
        worksheet.columns = [
            { header: '#', key: 'no', width: 6 },
            { header: 'SYSTEM', key: 'sys', width: 14 },
            { header: 'SUBSYSTEM', key: 'subsys', width: 16 },
            { header: 'PACKAGE NAME', key: 'pkgName', width: 32 },
            { header: 'PUNCHNO', key: 'punchNo', width: 15 },
            { header: 'DISCIPLINE', key: 'disc', width: 15 },
            { header: 'PHASE', key: 'phase', width: 12 },
            { header: 'CAT', key: 'cat', width: 10 },
            { header: 'STATUS', key: 'status', width: 12 },
            { header: 'TAGNO', key: 'tag', width: 18 },
            { header: 'DEFECT DESCRIPTION', key: 'desc', width: 48 },
            { header: 'ACTION BY', key: 'actionBy', width: 16 },
            { header: 'OPEN', key: 'openDate', width: 14 },
            { header: 'CLOSED', key: 'closeDate', width: 14 },
            { header: 'EXPECTED', key: 'expDate', width: 14 }
        ];

        // Format Header Row (Dark navy/slate background, bold white text, border)
        const headerRow = worksheet.getRow(1);
        headerRow.height = 28;

        const headerBorder = {
            top: { style: 'thin', color: { argb: 'FF0F172A' } },
            left: { style: 'thin', color: { argb: 'FF334155' } },
            bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
            right: { style: 'thin', color: { argb: 'FF334155' } }
        };

        const cellBorder = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        headerRow.eachCell({ includeEmpty: false }, (cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF0F172A' } // App dark slate header
            };
            cell.font = {
                name: 'Segoe UI',
                size: 10,
                bold: true,
                color: { argb: 'FFFFFFFF' }
            };
            cell.alignment = {
                vertical: 'middle',
                horizontal: 'center'
            };
            cell.border = headerBorder;
        });

        // Add Data Rows with App styling (green for CLOSED, soft red for OPEN)
        exportList.forEach((p, idx) => {
            const isClosed = p.status && p.status.toUpperCase().includes('CLOSE');
            const rowBg = isClosed ? 'FFDCFCE7' : 'FFFEE2E2'; // App green / red row colors
            const statusTextColor = isClosed ? 'FF15803D' : 'FFB91C1C';
            const catColor = p.cat === 'A' ? 'FFB91C1C' : 'FFB45309';

            const rowData = {
                no: idx + 1,
                sys: p.sys || '',
                subsys: p.subsys || '',
                pkgName: p.pkgName || '',
                punchNo: p.punchNo || '',
                disc: p.disc || '',
                phase: p.phase || '',
                cat: p.cat ? `Cat ${p.cat}` : '',
                status: p.status || '',
                tag: p.tag || '',
                desc: p.desc || '',
                actionBy: p.actionBy || '',
                openDate: formatDateStr(p.openDate) || '',
                closeDate: formatDateStr(p.closeDate) || '',
                expDate: formatDateStr(p.expDate) || ''
            };

            const row = worksheet.addRow(rowData);
            row.height = 24;

            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.border = cellBorder;
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: rowBg }
                };
                cell.font = {
                    name: 'Segoe UI',
                    size: 9.5,
                    color: { argb: 'FF0F172A' }
                };

                // Alignment
                if (colNumber === 4 || colNumber === 11) {
                    // PACKAGE NAME (col 4) and DEFECT DESCRIPTION (col 11) (Left-aligned)
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: colNumber === 11 };
                } else {
                    // Centered
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }

                // Subsystem (col 3) and PunchNo (col 5) bold
                if (colNumber === 3 || colNumber === 5) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                }

                // Cat bold with color (col 8)
                if (colNumber === 8) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: catColor } };
                }

                // Status bold with color (col 9)
                if (colNumber === 9) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: statusTextColor } };
                }
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Export Punch Excel error:", err);
        alert("Failed to export Excel file: " + err.message);
    }
}
window.exportPunchToExcel = exportPunchToExcel;

function setupPunchModalEvents() {
    const btnAll = document.getElementById('punch-filter-all');
    const btnOpen = document.getElementById('punch-filter-open');
    const btnClosed = document.getElementById('punch-filter-closed');
    const searchInput = document.getElementById('punch-search-input');
    const pkgSearchInput = document.getElementById('punch-pkg-search-input');
    const exportBtn = document.getElementById('btn-export-punch-excel');
    const scopeSelect = document.getElementById('punch-filter-scope');
    const sysSelect = document.getElementById('punch-filter-sys');
    const subsysSelect = document.getElementById('punch-filter-subsys');
    const phaseSelect = document.getElementById('punch-filter-phase');
    const catSelect = document.getElementById('punch-filter-cat');

    if (scopeSelect) {
        scopeSelect.addEventListener('change', (e) => {
            currentPunchScope = e.target.value;
            currentPunchSys = 'ALL';
            currentPunchSubsys = 'ALL';
            currentPunchDiscFilter = 'ALL';
            populatePunchSysDropdowns();
            refreshPunchModalData();
        });
    }

    if (sysSelect) {
        sysSelect.addEventListener('change', (e) => {
            currentPunchSys = e.target.value;
            currentPunchSubsys = 'ALL';
            currentPunchDiscFilter = 'ALL';
            populatePunchSubsysDropdown();
            refreshPunchModalData();
        });
    }

    if (subsysSelect) {
        subsysSelect.addEventListener('change', (e) => {
            currentPunchSubsys = e.target.value;
            currentPunchDiscFilter = 'ALL';
            refreshPunchModalData();
        });
    }

    if (phaseSelect) {
        phaseSelect.addEventListener('change', (e) => {
            currentPunchPhase = e.target.value;
            currentPunchDiscFilter = 'ALL';
            populatePunchSysDropdowns();
            refreshPunchModalData();
        });
    }

    if (catSelect) {
        catSelect.addEventListener('change', (e) => {
            currentPunchCat = e.target.value;
            currentPunchDiscFilter = 'ALL';
            populatePunchSysDropdowns();
            refreshPunchModalData();
        });
    }

    if (btnAll) {
        btnAll.addEventListener('click', () => {
            currentPunchStatusFilter = 'ALL';
            updatePunchStatusTabUI('ALL');
            renderPunchModalTable();
        });
    }

    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            currentPunchStatusFilter = 'OPEN';
            updatePunchStatusTabUI('OPEN');
            renderPunchModalTable();
        });
    }

    if (btnClosed) {
        btnClosed.addEventListener('click', () => {
            currentPunchStatusFilter = 'CLOSED';
            updatePunchStatusTabUI('CLOSED');
            renderPunchModalTable();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentPunchSearch = searchInput.value.trim();
            renderPunchModalTable();
        });
    }

    if (pkgSearchInput) {
        pkgSearchInput.addEventListener('input', () => {
            currentPunchPkgSearch = pkgSearchInput.value.trim();
            renderPunchModalTable();
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', exportPunchToExcel);
    }
}

// =========================================================================
// ----------------- CERTIFICATE REGISTER MODAL (DAC / CSSC / RFC) ---------
// =========================================================================
let certModalState = {
    type: 'DAC',         // 'DAC' | 'CSSC' | 'RFC'
    scope: 'ALL',        // 'ALL' | 'CLQM' | 'CLQU'
    disc: 'ALL',         // 'ALL' | 'MECH' | 'PIPI' | 'ETC' | ...
    subtype: 'ALL',      // 'ALL' | 'CC-DAC' | 'PC-DAC'
    sys: 'ALL',
    subsys: 'ALL',
    status: 'ALL',       // 'ALL' | 'OPEN' | 'CLOSED'
    search: '',
    baseList: [],
    filteredList: [],
    eventsBound: false
};

function bindCertModalEventsOnce() {
    if (certModalState.eventsBound) return;
    certModalState.eventsBound = true;

    const certModal = document.getElementById('cert-modal');
    if (certModal) {
        certModal.addEventListener('click', (e) => {
            if (e.target === certModal) certModal.style.display = 'none';
        });
    }

    const elScope = document.getElementById('cert-filter-scope');
    const elDisc = document.getElementById('cert-filter-disc');
    const elSubtype = document.getElementById('cert-filter-subtype');
    const elSys = document.getElementById('cert-filter-sys');
    const elSubsys = document.getElementById('cert-filter-subsys');
    const elSearch = document.getElementById('cert-search-input');
    const btnAll = document.getElementById('cert-status-all');
    const btnOpen = document.getElementById('cert-status-open');
    const btnClosed = document.getElementById('cert-status-closed');
    const btnExport = document.getElementById('btn-export-cert-excel');

    if (elScope) elScope.addEventListener('change', () => {
        certModalState.scope = elScope.value;
        certModalState.sys = 'ALL';
        certModalState.subsys = 'ALL';
        populateCertDropdowns();
        renderCertModalTable();
    });
    if (elDisc) elDisc.addEventListener('change', () => {
        certModalState.disc = elDisc.value;
        certModalState.sys = 'ALL';
        certModalState.subsys = 'ALL';
        populateCertDropdowns();
        renderCertModalTable();
    });
    if (elSubtype) elSubtype.addEventListener('change', () => {
        certModalState.subtype = elSubtype.value;
        renderCertModalTable();
    });
    if (elSys) elSys.addEventListener('change', () => {
        certModalState.sys = elSys.value;
        certModalState.subsys = 'ALL';
        populateCertSubsysDropdown();
        renderCertModalTable();
    });
    if (elSubsys) elSubsys.addEventListener('change', () => {
        certModalState.subsys = elSubsys.value;
        renderCertModalTable();
    });
    if (elSearch) elSearch.addEventListener('input', () => {
        certModalState.search = elSearch.value.trim().toLowerCase();
        renderCertModalTable();
    });
    if (btnAll) btnAll.addEventListener('click', () => { certModalState.status = 'ALL'; renderCertModalTable(); });
    if (btnOpen) btnOpen.addEventListener('click', () => { certModalState.status = 'OPEN'; renderCertModalTable(); });
    if (btnClosed) btnClosed.addEventListener('click', () => { certModalState.status = 'CLOSED'; renderCertModalTable(); });
    if (btnExport) btnExport.addEventListener('click', exportCertRegisterToExcel);
}

function getCertBaseByScopeAndDisc() {
    return certModalState.baseList.filter(c => {
        const sub = String(c.subsys || c.sys || '').trim().toUpperCase();
        if (certModalState.scope !== 'ALL' && !sub.startsWith(certModalState.scope)) return false;
        if (certModalState.type === 'DAC' && certModalState.disc !== 'ALL') {
            if (certModalState.disc === 'ETC') {
                if (!['ELEC', 'TELE', 'INST'].includes(c.disc)) return false;
            } else if (c.disc !== certModalState.disc) {
                return false;
            }
        }
        return true;
    });
}

function populateCertDropdowns() {
    const list = getCertBaseByScopeAndDisc();
    const elSys = document.getElementById('cert-filter-sys');
    if (elSys) {
        const systems = Array.from(new Set(list.map(c => String(c.sys || '').trim()).filter(Boolean))).sort();
        elSys.innerHTML = `<option value="ALL">All Systems (${systems.length})</option>` +
            systems.map(s => `<option value="${s}" ${certModalState.sys === s ? 'selected' : ''}>${s}</option>`).join('');
    }
    populateCertSubsysDropdown();
}

function populateCertSubsysDropdown() {
    let list = getCertBaseByScopeAndDisc();
    if (certModalState.sys !== 'ALL') {
        list = list.filter(c => String(c.sys || '').trim() === certModalState.sys);
    }
    const elSubsys = document.getElementById('cert-filter-subsys');
    if (elSubsys) {
        const subs = Array.from(new Set(list.map(c => String(c.subsys || '').trim()).filter(Boolean))).sort();
        elSubsys.innerHTML = `<option value="ALL">All SubSystems (${subs.length})</option>` +
            subs.map(s => `<option value="${s}" ${certModalState.subsys === s ? 'selected' : ''}>${s}</option>`).join('');
    }
}

function renderCertModalTable() {
    let list = getCertBaseByScopeAndDisc();

    if (certModalState.type === 'DAC' && certModalState.subtype !== 'ALL') {
        list = list.filter(c => String(c.cert || '').toUpperCase().includes(certModalState.subtype));
    }
    if (certModalState.sys !== 'ALL') {
        list = list.filter(c => String(c.sys || '').trim() === certModalState.sys);
    }
    if (certModalState.subsys !== 'ALL') {
        list = list.filter(c => String(c.subsys || '').trim() === certModalState.subsys);
    }
    if (certModalState.search) {
        const q = certModalState.search;
        list = list.filter(c =>
            String(c.cert || '').toLowerCase().includes(q) ||
            String(c.disc || '').toLowerCase().includes(q) ||
            String(c.sys || '').toLowerCase().includes(q) ||
            String(c.subsys || '').toLowerCase().includes(q) ||
            String(c.status || '').toLowerCase().includes(q)
        );
    }

    // Compute counts BEFORE status button filter so status pills show accurate Open/Closed counts
    const totalAll = list.length;
    const closedAll = list.filter(c => c.status === 'CLOSED').length;
    const openAll = totalAll - closedAll;
    const pctAll = totalAll > 0 ? ((closedAll / totalAll) * 100).toFixed(1) + '%' : '0.0%';

    const elTotal = document.getElementById('cert-stat-total');
    const elClosed = document.getElementById('cert-stat-closed');
    const elOpen = document.getElementById('cert-stat-open');
    const elPct = document.getElementById('cert-stat-pct');
    if (elTotal) elTotal.textContent = totalAll.toLocaleString();
    if (elClosed) elClosed.textContent = closedAll.toLocaleString();
    if (elOpen) elOpen.textContent = openAll.toLocaleString();
    if (elPct) elPct.textContent = pctAll;

    const btnAll = document.getElementById('cert-status-all');
    const btnOpen = document.getElementById('cert-status-open');
    const btnClosed = document.getElementById('cert-status-closed');
    if (btnAll) {
        btnAll.textContent = `All (${totalAll})`;
        btnAll.style.background = certModalState.status === 'ALL' ? '#0ea5e9' : '#fff';
        btnAll.style.color = certModalState.status === 'ALL' ? '#fff' : '#334155';
    }
    if (btnOpen) {
        btnOpen.textContent = `Open (${openAll})`;
        btnOpen.style.background = certModalState.status === 'OPEN' ? '#ef4444' : '#fff';
        btnOpen.style.color = certModalState.status === 'OPEN' ? '#fff' : '#ef4444';
    }
    if (btnClosed) {
        btnClosed.textContent = `Closed (${closedAll})`;
        btnClosed.style.background = certModalState.status === 'CLOSED' ? '#10b981' : '#fff';
        btnClosed.style.color = certModalState.status === 'CLOSED' ? '#fff' : '#10b981';
    }

    // Apply Status filter for display table
    let displayList = list;
    if (certModalState.status === 'OPEN') {
        displayList = list.filter(c => c.status !== 'CLOSED');
    } else if (certModalState.status === 'CLOSED') {
        displayList = list.filter(c => c.status === 'CLOSED');
    }
    certModalState.filteredList = displayList;

    const tbody = document.getElementById('cert-tbody');
    if (!tbody) return;
    if (displayList.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 2.5rem; color: #64748b; font-style: italic;">No certificates match the selected filters.</td></tr>';
        return;
    }

    let tbodyHtml = '';
    displayList.forEach((c, idx) => {
        const isClosed = c.status === 'CLOSED';
        const badgeStyle = isClosed
            ? 'background:#dcfce7; color:#15803d; border:1px solid #86efac;'
            : 'background:#fee2e2; color:#b91c1c; border:1px solid #fca5a5;';
        tbodyHtml += `
            <tr>
                <td>${idx + 1}</td>
                <td><b>${c.cert}</b></td>
                <td>${c.disc || '-'}</td>
                <td>${c.sys || '-'}</td>
                <td><b>${c.subsys || '-'}</b></td>
                <td><span style="${badgeStyle} padding: 2px 8px; border-radius: 999px; font-size: 0.72rem; font-weight: 800;">${c.status}</span></td>
                <td>${formatDateStr(c.plan)}</td>
                <td>${formatDateStr(c.act)}</td>
            </tr>
        `;
    });
    tbody.innerHTML = tbodyHtml;
}

function exportCertRegisterToExcel() {
    if (typeof XLSX === 'undefined') {
        alert("Excel library not loaded.");
        return;
    }
    const list = certModalState.filteredList || [];
    if (list.length === 0) {
        alert("No certificates to export.");
        return;
    }
    const rows = [['#', 'Certificate', 'Discipline', 'System', 'SubSystem', 'Status', 'Plan Finish', 'Actual Finish']];
    list.forEach((c, i) => {
        rows.push([i + 1, c.cert, c.disc || '', c.sys || '', c.subsys || '', c.status, formatDateStr(c.plan), formatDateStr(c.act)]);
    });
    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Certificate_Register");
    XLSX.writeFile(wb, `LQP_${certModalState.type}_${certModalState.disc}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function openCertModal(type, group, scope, sys) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    bindCertModalEventsOnce();

    certModalState.type = type || 'DAC';
    certModalState.scope = scope || 'ALL';
    certModalState.subtype = 'ALL';
    certModalState.sys = sys || 'ALL';
    certModalState.subsys = 'ALL';
    certModalState.status = 'ALL';
    certModalState.search = '';

    if (certModalState.type === 'DAC') {
        certModalState.baseList = (gd.globalCertList || []).filter(c => c.type === 'DAC');
        certModalState.disc = group || 'ALL';
    } else if (certModalState.type === 'CSSC') {
        certModalState.baseList = (gd.globalCertList || []).filter(c => c.type === 'CSSC');
        certModalState.disc = 'ALL';
        if (group && group !== 'ALL') {
            certModalState.subsys = group;
        }
    } else if (certModalState.type === 'RFC') {
        const rfcMap = gd.rfcMap || {};
        certModalState.baseList = Object.keys(rfcMap).sort().map(sub => ({
            type: 'RFC',
            cert: 'RFC',
            disc: '',
            sys: extractSystem(sub),
            subsys: sub,
            status: (rfcMap[sub] && rfcMap[sub].done) ? 'CLOSED' : 'OPEN',
            plan: '',
            act: (rfcMap[sub] && rfcMap[sub].date) || ''
        }));
        certModalState.disc = 'ALL';
        if (group && group !== 'ALL') certModalState.subsys = group;
    }

    // Sync filter controls with state
    const elScope = document.getElementById('cert-filter-scope');
    const elDisc = document.getElementById('cert-filter-disc');
    const elSubtype = document.getElementById('cert-filter-subtype');
    const elSearch = document.getElementById('cert-search-input');

    if (elScope) elScope.value = certModalState.scope;
    if (elDisc) {
        elDisc.style.display = certModalState.type === 'DAC' ? 'inline-block' : 'none';
        elDisc.value = certModalState.disc;
    }
    if (elSubtype) {
        elSubtype.style.display = certModalState.type === 'DAC' ? 'inline-block' : 'none';
        elSubtype.value = 'ALL';
    }
    if (elSearch) elSearch.value = '';

    const labelGrp = (group && group !== 'ALL') ? ` — ${group}` : ' (All)';
    document.getElementById('cert-modal-title').innerHTML = `${certModalState.type}${labelGrp} <span style="font-size: 0.8rem; font-weight: 400; color: #94a3b8; margin-left: 10px;">Certificate Register</span>`;
    document.getElementById('cert-modal').style.display = 'flex';

    populateCertDropdowns();
    renderCertModalTable();
}
window.openCertModal = openCertModal;

// =========================================================================
// ----------------- CHECKSHEET DETAIL MODAL LOGIC -------------------------
// =========================================================================

let currentCsSubsys = '';
let currentCsDisc = '';
let currentCsFilterStatus = 'ALL'; // 'ALL' | 'DONE' | 'PENDING'
let currentCsSearch = '';
let currentCsList = [];


// ----------------- MASTER RECALCULATION & MANUAL COMPLETIONS -----------------
function recalculateMasterCounts() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;

    // 1. Build lookup of manual completions: key = `${subsys}|${disc}|${tag}|${formNo || ''}` -> dateStr
    const manualDoneLookup = new Map();
    if (gd.globalCompletedChecksheets) {
        gd.globalCompletedChecksheets.forEach(man => {
            const mDateVal = man.dateStr || man.compDate || man.manualDate || '';
            if (man.isManual && mDateVal) {
                const key1 = `${man.subsys}|${man.disc}|${man.tag}|${man.formNo || ''}`;
                const key2 = `${man.subsys}|${man.disc}|${man.tag}|`;
                manualDoneLookup.set(key1, mDateVal);
                manualDoneLookup.set(key2, mDateVal);
            }
        });
    }

    // 2. Iterate over globalChecksheetMap and update each item's cmsDate, manualDate & isDone
    const subsysDoneCounts = {}; // `${subsys}|${disc}` -> count
    const tagDoneCounts = {};    // tag -> count

    if (gd.globalChecksheetMap) {
        Object.keys(gd.globalChecksheetMap).forEach(sub => {
            Object.keys(gd.globalChecksheetMap[sub]).forEach(disc => {
                const pairKey = `${sub}|${disc}`;
                subsysDoneCounts[pairKey] = 0;

                gd.globalChecksheetMap[sub][disc].forEach(item => {
                    // Cache original official CMS date
                    if (item.cmsDate === undefined) {
                        item.cmsDate = (item.isDone && !item.isManual) ? (item.compDate || '') : '';
                    }

                    const mKey1 = `${sub}|${disc}|${item.tag}|${item.type}`;
                    const mKey2 = `${sub}|${disc}|${item.tag}|`;
                    const mDate = manualDoneLookup.get(mKey1) || manualDoneLookup.get(mKey2) || item.manualDate || '';
                    item.manualDate = mDate;
                    item.isManual = !!mDate;
                    item.isDone = !!(item.cmsDate || mDate);

                    if (item.isDone) {
                        subsysDoneCounts[pairKey]++;
                        if (item.tag) {
                            tagDoneCounts[item.tag] = (tagDoneCounts[item.tag] || 0) + 1;
                        }
                    }
                });
            });
        });
    }

    // 3. Update matrix[sys][sub][disc].i_d
    if (gd.matrix) {
        Object.keys(gd.matrix).forEach(sys => {
            Object.keys(gd.matrix[sys]).forEach(sub => {
                DISCIPLINES.forEach(disc => {
                    if (gd.matrix[sys][sub][disc]) {
                        const pairKey = `${sub}|${disc}`;
                        if (subsysDoneCounts[pairKey] !== undefined) {
                            gd.matrix[sys][sub][disc].i_d = subsysDoneCounts[pairKey];
                        }
                    }
                });
            });
        });
    }

    // 4. Update sumItr[disc].d
    if (gd.sumItr) {
        DISCIPLINES.forEach(disc => {
            if (gd.sumItr[disc]) {
                let dCount = 0;
                Object.keys(gd.matrix || {}).forEach(sys => {
                    Object.keys(gd.matrix[sys] || {}).forEach(sub => {
                        if (gd.matrix[sys][sub][disc]) {
                            dCount += (gd.matrix[sys][sub][disc].i_d || 0);
                        }
                    });
                });
                gd.sumItr[disc].d = dCount;
            }
        });
    }

    // 5. Update mcData.itrA.done
    if (gd.mcData && gd.mcData.itrA) {
        let totalDone = 0;
        DISCIPLINES.forEach(disc => {
            if (gd.sumItr && gd.sumItr[disc]) {
                totalDone += (gd.sumItr[disc].d || 0);
            }
        });
        gd.mcData.itrA.done = totalDone;
    }

    // 6. Update dashGroups
    if (gd.dashGroups) {
        DISCIPLINES.forEach(disc => {
            const grp = getDashGroup(disc);
            if (grp && gd.dashGroups[grp] && gd.dashGroups[grp].itrA) {
                let grpDone = 0;
                Object.keys(gd.matrix || {}).forEach(sys => {
                    Object.keys(gd.matrix[sys] || {}).forEach(sub => {
                        if (gd.matrix[sys][sub][disc]) {
                            grpDone += (gd.matrix[sys][sub][disc].i_d || 0);
                        }
                    });
                });
                gd.dashGroups[grp].itrA.done = grpDone;
            }
        });
    }

    // 7. Update globalTagMap
    if (gd.globalTagMap) {
        Object.keys(gd.globalTagMap).forEach(tag => {
            if (tagDoneCounts[tag] !== undefined) {
                gd.globalTagMap[tag].itrDone = tagDoneCounts[tag];
            }
        });
    }

    // 8. Synchronize Site Walkdown Punches into globalPunchList
    if (typeof siteWalkdownPunches !== 'undefined' && Array.isArray(siteWalkdownPunches) && gd.globalPunchList) {
        // Strip out previously injected virtual site walkdown punches
        gd.globalPunchList = gd.globalPunchList.filter(p => !p.isSiteWalkdown);

        siteWalkdownPunches.forEach(sw => {
            // Only inject if not already linked to an official CMS punch
            if (!sw.officialCmsPunchNo || sw.cmsStatus === 'PENDING_CMS') {
                const subsys = sw.subsys || '';
                const sys = sw.sys || extractSystem(subsys);
                const disc = classifyDiscipline(sw.disc || 'MECHANICAL');
                gd.globalPunchList.push({
                    sys: sys,
                    subsys: subsys,
                    punchNo: sw.punchNo || sw.id,
                    raisedPunchNo: sw.punchNo || sw.id,
                    pkgName: sw.pkgName || '',
                    disc: disc,
                    phase: sw.phase || 'LQ-OSD',
                    status: sw.status || 'OPEN',
                    tag: sw.tagNo,
                    tagDesc: sw.tagDesc || sw.equipName || '',
                    desc: sw.desc || '',
                    actionBy: sw.actionBy || 'MDR/VENDOR',
                    openDate: sw.openDate || '',
                    closeDate: sw.closeDate || '',
                    expDate: sw.expDate || '',
                    cat: sw.cat || 'B',
                    isSiteWalkdown: true,
                    sitePunchId: sw.id
                });
            }
        });
    }

    // 9. Recalculate Punch Metrics across entire project (Matrix, Widgets, Dashboard)
    if (gd.globalPunchList) {
        if (!gd.mcData) gd.mcData = {};
        gd.mcData.punchA = { total: 0, done: 0 };
        gd.mcData.punchB = { total: 0, done: 0 };
        gd.mcData.punchC = { total: 0, done: 0 };

        if (gd.dashGroups) {
            Object.keys(gd.dashGroups).forEach(grp => {
                if (!gd.dashGroups[grp].punchA) gd.dashGroups[grp].punchA = { total: 0, done: 0 };
                if (!gd.dashGroups[grp].punchB) gd.dashGroups[grp].punchB = { total: 0, done: 0 };
                if (!gd.dashGroups[grp].punchC) gd.dashGroups[grp].punchC = { total: 0, done: 0 };
                gd.dashGroups[grp].punchA.total = 0;
                gd.dashGroups[grp].punchA.done = 0;
                gd.dashGroups[grp].punchB.total = 0;
                gd.dashGroups[grp].punchB.done = 0;
                gd.dashGroups[grp].punchC.total = 0;
                gd.dashGroups[grp].punchC.done = 0;
            });
        }

        if (!gd.sumPunch) gd.sumPunch = {};
        Object.keys(gd.sumPunch).forEach(ph => {
            gd.sumPunch[ph] = { a_d: 0, a_t: 0, b_d: 0, b_t: 0, c_d: 0, c_t: 0 };
        });

        if (gd.matrix) {
            Object.keys(gd.matrix).forEach(sys => {
                Object.keys(gd.matrix[sys] || {}).forEach(sub => {
                    Object.keys(gd.matrix[sys][sub] || {}).forEach(disc => {
                        const cell = gd.matrix[sys][sub][disc];
                        if (cell) {
                            cell.pa_t = 0;
                            cell.pa_d = 0;
                            cell.pb_t = 0;
                            cell.pb_d = 0;
                            cell.pc_t = 0;
                            cell.pc_d = 0;
                        }
                    });
                });
            });
        }

        gd.globalPunchList.forEach(p => {
            const cat = String(p.cat || '').toUpperCase();
            const phase = String(p.phase || 'UNKNOWN').trim();
            const isClosed = String(p.status || '').toUpperCase().includes('CLOSE');
            const disc = classifyDiscipline(p.disc);
            const subsys = p.subsys;
            const sys = p.sys || extractSystem(subsys);
            const grp = getDashGroup(disc);

            if (!gd.sumPunch[phase]) {
                gd.sumPunch[phase] = { a_d: 0, a_t: 0, b_d: 0, b_t: 0, c_d: 0, c_t: 0 };
            }

            if (cat.includes('A')) {
                gd.mcData.punchA.total++;
                if (isClosed) gd.mcData.punchA.done++;

                if (grp && gd.dashGroups && gd.dashGroups[grp]) {
                    gd.dashGroups[grp].punchA.total++;
                    if (isClosed) gd.dashGroups[grp].punchA.done++;
                }

                gd.sumPunch[phase].a_t++;
                if (isClosed) gd.sumPunch[phase].a_d++;

                if (subsys && disc && gd.matrix) {
                    if (!gd.matrix[sys]) gd.matrix[sys] = {};
                    if (!gd.matrix[sys][subsys]) gd.matrix[sys][subsys] = initDisciplineData();
                    if (!gd.matrix[sys][subsys][disc]) gd.matrix[sys][subsys][disc] = { i_d:0, i_t:0, pa_d:0, pa_t:0, pb_d:0, pb_t:0 };
                    gd.matrix[sys][subsys][disc].pa_t++;
                    if (isClosed) gd.matrix[sys][subsys][disc].pa_d++;
                }
            } else if (cat.includes('B')) {
                gd.mcData.punchB.total++;
                if (isClosed) gd.mcData.punchB.done++;

                if (grp && gd.dashGroups && gd.dashGroups[grp]) {
                    gd.dashGroups[grp].punchB.total++;
                    if (isClosed) gd.dashGroups[grp].punchB.done++;
                }

                gd.sumPunch[phase].b_t++;
                if (isClosed) gd.sumPunch[phase].b_d++;

                if (subsys && disc && gd.matrix) {
                    if (!gd.matrix[sys]) gd.matrix[sys] = {};
                    if (!gd.matrix[sys][subsys]) gd.matrix[sys][subsys] = initDisciplineData();
                    if (!gd.matrix[sys][subsys][disc]) gd.matrix[sys][subsys][disc] = { i_d:0, i_t:0, pa_d:0, pa_t:0, pb_d:0, pb_t:0, pc_d:0, pc_t:0 };
                    gd.matrix[sys][subsys][disc].pb_t++;
                    if (isClosed) gd.matrix[sys][subsys][disc].pb_d++;
                }
            } else if (cat.includes('C')) {
                gd.mcData.punchC.total++;
                if (isClosed) gd.mcData.punchC.done++;

                if (grp && gd.dashGroups && gd.dashGroups[grp]) {
                    gd.dashGroups[grp].punchC.total++;
                    if (isClosed) gd.dashGroups[grp].punchC.done++;
                }

                gd.sumPunch[phase].c_t = (gd.sumPunch[phase].c_t || 0) + 1;
                if (isClosed) gd.sumPunch[phase].c_d = (gd.sumPunch[phase].c_d || 0) + 1;

                if (subsys && disc && gd.matrix) {
                    if (!gd.matrix[sys]) gd.matrix[sys] = {};
                    if (!gd.matrix[sys][subsys]) gd.matrix[sys][subsys] = initDisciplineData();
                    if (!gd.matrix[sys][subsys][disc]) gd.matrix[sys][subsys][disc] = { i_d:0, i_t:0, pa_d:0, pa_t:0, pb_d:0, pb_t:0, pc_d:0, pc_t:0 };
                    gd.matrix[sys][subsys][disc].pc_t = (gd.matrix[sys][subsys][disc].pc_t || 0) + 1;
                    if (isClosed) gd.matrix[sys][subsys][disc].pc_d = (gd.matrix[sys][subsys][disc].pc_d || 0) + 1;
                }
            }
        });
    }

    if (typeof recalculatePrecomMasterCounts === 'function') {
        recalculatePrecomMasterCounts();
    }
}

window.handleManualDateChange = function(inputEl) {
    const subsys = inputEl.dataset.subsys;
    const disc = inputEl.dataset.disc;
    const tag = inputEl.dataset.tag;
    const type = inputEl.dataset.type;
    const newDate = inputEl.value.trim();

    updateChecksheetManualDate(subsys, disc, tag, type, newDate);
};

window.setManualDateToday = function(btn) {
    const inputEl = btn.parentElement.querySelector('.cs-manual-date-input');
    if (!inputEl) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    inputEl.value = today;
    window.handleManualDateChange(inputEl);
};

window.clearManualDate = function(btn) {
    const inputEl = btn.parentElement.querySelector('.cs-manual-date-input');
    if (!inputEl) return;
    inputEl.value = '';
    window.handleManualDateChange(inputEl);
};

function updateChecksheetManualDate(subsys, disc, tag, type, newDate) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    if (!gd.globalCompletedChecksheets) gd.globalCompletedChecksheets = [];

    // 1. Update in currentCsList (modal view list)
    if (currentCsList) {
        const item = currentCsList.find(x => x.tag === tag && (!type || x.type === type));
        if (item) {
            item.manualDate = newDate;
            item.isManual = !!newDate;
            item.isDone = !!(item.cmsDate || newDate);
        }
    }

    // 2. Update in globalChecksheetMap (master map)
    let masterItem = null;
    if (gd.globalChecksheetMap && gd.globalChecksheetMap[subsys] && gd.globalChecksheetMap[subsys][disc]) {
        masterItem = gd.globalChecksheetMap[subsys][disc].find(x => x.tag === tag && (!type || x.type === type));
        if (masterItem) {
            masterItem.manualDate = newDate;
            masterItem.isManual = !!newDate;
            masterItem.isDone = !!(masterItem.cmsDate || newDate);
        }
    }

    // 3. Update in globalCompletedChecksheets (for Weekly Report link)
    const existingIdx = gd.globalCompletedChecksheets.findIndex(
        x => x.subsys === subsys && x.disc === disc && x.tag === tag && (!type || x.formNo === type)
    );

    if (newDate) {
        if (existingIdx >= 0) {
            gd.globalCompletedChecksheets[existingIdx].dateStr = newDate;
            gd.globalCompletedChecksheets[existingIdx].compDate = newDate;
            gd.globalCompletedChecksheets[existingIdx].isManual = true;
        } else {
            const sys = subsys.includes('-') && subsys.split('-').length > 1 ? subsys.split('-')[1] : extractSystem(subsys);
            const tagDesc = (masterItem && masterItem.tagDesc) || (gd.globalTagMap && gd.globalTagMap[tag] ? gd.globalTagMap[tag].desc : '') || '-';
            const subsysDesc = (masterItem && masterItem.subsysDesc) || (gd.sysDescMap ? gd.sysDescMap[subsys] : '') || '-';
            gd.globalCompletedChecksheets.push({
                sys: sys,
                subsys: subsys,
                subsysDesc: subsysDesc,
                disc: disc,
                formNo: type || 'ITR-A',
                tag: tag,
                tagDesc: tagDesc,
                dateStr: newDate,
                compDate: newDate,
                isManual: true
            });
        }
    } else {
        if (existingIdx >= 0) {
            gd.globalCompletedChecksheets.splice(existingIdx, 1);
        }
    }

    // 4. Recalculate Master Counts & update dashboard
    recalculateMasterCounts();

    // 5. Re-render UI
    renderChecksheetModalTable();
    if (gd.matrix) renderMatrix(gd.matrix);
    if (gd.mcData && gd.dashGroups) renderDashboardWidgets(gd.mcData, gd.dashGroups);
    if (gd.mcData && gd.sumItr) renderSummaryWidgets(gd.mcData, gd.sumItr, gd.sumPunch, gd.sumDac, gd.sumCssc);
    if (typeof renderReport === 'function') renderReport();

    // 6. Persist to storage
    autoPersistCurrentData();
    const saveBtn = document.getElementById('btn-save-data');
    if (saveBtn) saveBtn.style.display = 'inline-flex';
}

function openChecksheetDetail(subsys, disc) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;

    currentCsSubsys = subsys;
    currentCsDisc = disc;
    currentCsFilterStatus = 'ALL';
    currentCsSearch = '';

    // Reset filters UI
    const searchInput = document.getElementById('cs-search-input');
    if (searchInput) searchInput.value = '';

    const btnAll = document.getElementById('cs-btn-filter-all');
    const btnDone = document.getElementById('cs-btn-filter-done');
    const btnPending = document.getElementById('cs-btn-filter-pending');
    if (btnAll) btnAll.className = 'cs-tab-btn active';
    if (btnDone) btnDone.className = 'cs-tab-btn';
    if (btnPending) btnPending.className = 'cs-tab-btn';

    // Retrieve checksheets from globalChecksheetMap
    let list = [];
    if (gd.globalChecksheetMap && gd.globalChecksheetMap[subsys] && gd.globalChecksheetMap[subsys][disc]) {
        list = gd.globalChecksheetMap[subsys][disc].map(item => ({ ...item }));
    }

    // Cache CMS date and merge manual completions
    list.forEach(item => {
        if (item.cmsDate === undefined) {
            item.cmsDate = (item.isDone && !item.isManual) ? (item.compDate || '') : '';
        }
    });

    if (gd.globalCompletedChecksheets) {
        gd.globalCompletedChecksheets.forEach(man => {
            if (man.subsys === subsys && man.disc === disc) {
                const existing = list.find(x => x.tag === man.tag && (!man.formNo || x.type === man.formNo));
                if (existing) {
                    if (man.isManual) {
                        existing.manualDate = man.dateStr || existing.manualDate || '';
                        existing.isManual = true;
                    }
                    existing.isDone = !!(existing.cmsDate || existing.manualDate);
                } else {
                    list.push({
                        no: list.length + 1,
                        subsys: man.subsys,
                        subsysDesc: man.subsysDesc || (gd.sysDescMap && gd.sysDescMap[subsys]) || '-',
                        tag: man.tag,
                        tagDesc: man.tagDesc || '-',
                        disc: man.disc,
                        type: man.formNo || 'ITR-A',
                        compDate: '',
                        cmsDate: '',
                        manualDate: man.dateStr || '',
                        isDone: true,
                        isManual: true
                    });
                }
            }
        });
    }

    currentCsList = list;

    // Header info
    const subsysDesc = (gd.sysDescMap && gd.sysDescMap[subsys]) || (list[0] && list[0].subsysDesc) || '';
    const subsysLabel = subsysDesc ? `${subsys} - ${subsysDesc}` : subsys;
    const modalSubsys = document.getElementById('cs-modal-subsys');
    const modalDisc = document.getElementById('cs-modal-disc');
    if (modalSubsys) modalSubsys.textContent = subsysLabel;
    if (modalDisc) modalDisc.textContent = disc;

    renderChecksheetModalTable();

    const csModal = document.getElementById('checksheet-modal');
    if (csModal) csModal.style.display = 'flex';
}
window.openChecksheetDetail = openChecksheetDetail;

function renderChecksheetModalTable() {
    const tbody = document.getElementById('cs-modal-tbody');
    if (!tbody) return;

    const total = currentCsList.length;
    const done = currentCsList.filter(x => x.isDone).length;
    const pending = total - done;
    const pct = total > 0 ? ((done / total) * 100).toFixed(1) + '%' : '0.0%';

    // Update chips
    const statTotal = document.getElementById('cs-stat-total');
    const statDone = document.getElementById('cs-stat-done');
    const statPending = document.getElementById('cs-stat-pending');
    const statPct = document.getElementById('cs-stat-pct');
    if (statTotal) statTotal.textContent = total.toLocaleString();
    if (statDone) statDone.textContent = done.toLocaleString();
    if (statPending) statPending.textContent = pending.toLocaleString();
    if (statPct) statPct.textContent = pct;

    const btnAll = document.getElementById('cs-btn-filter-all');
    const btnDone = document.getElementById('cs-btn-filter-done');
    const btnPending = document.getElementById('cs-btn-filter-pending');
    if (btnAll) btnAll.textContent = `All (${total})`;
    if (btnDone) btnDone.textContent = `Completed (${done})`;
    if (btnPending) btnPending.textContent = `Pending (${pending})`;

    // Filter list
    let filtered = currentCsList;
    if (currentCsFilterStatus === 'DONE') {
        filtered = filtered.filter(x => x.isDone);
    } else if (currentCsFilterStatus === 'PENDING') {
        filtered = filtered.filter(x => !x.isDone);
    }

    if (currentCsSearch) {
        const q = currentCsSearch.toLowerCase();
        filtered = filtered.filter(x =>
            (x.tag && x.tag.toLowerCase().includes(q)) ||
            (x.tagDesc && x.tagDesc.toLowerCase().includes(q)) ||
            (x.type && x.type.toLowerCase().includes(q)) ||
            (x.subsys && x.subsys.toLowerCase().includes(q)) ||
            (String(x.no || '').includes(q))
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" style="text-align: center; padding: 3rem; color: #64748b;">No checksheets found matching the filter criteria.</td></tr>';
        return;
    }

    let html = '';
    filtered.forEach((item, idx) => {
        const todayStr = new Date().toISOString().split('T')[0];
        const rowClass = item.isDone ? 'cs-table-row row-done' : 'cs-table-row';

        let statusHtml = '';
        if (item.cmsDate && item.manualDate) {
            statusHtml = `<span class="status-badge-synced" title="Site inspected on ${item.manualDate} | CMS recorded on ${item.cmsDate}"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"/></svg> CMS Synced</span>`;
        } else if (item.manualDate) {
            statusHtml = `<span class="status-badge-manual" title="Manual Site Inspection date: ${item.manualDate}"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"/></svg> Completed (M)</span>`;
        } else if (item.cmsDate) {
            statusHtml = `<span class="status-badge-done" title="CMS Complete Date: ${item.cmsDate}"><svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="3" fill="none"><polyline points="20 6 9 17 4 12"/></svg> Completed (CMS)</span>`;
        } else {
            statusHtml = `<span class="status-badge-pending">&#9679; Pending</span>`;
        }

        const cmsDateDisplay = item.cmsDate 
            ? `<span style="color: #34d399; font-weight: 600; font-family: monospace;">${item.cmsDate}</span>` 
            : `<span style="color: #64748b;">-</span>`;

        const manualInputHtml = `
            <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
                <input type="date" 
                       class="cs-manual-date-input" 
                       value="${item.manualDate || ''}" 
                       data-subsys="${item.subsys}" 
                       data-disc="${item.disc}" 
                       data-tag="${item.tag}" 
                       data-type="${item.type}"
                       onchange="handleManualDateChange(this)"
                       style="background: rgba(15,23,42,0.85); border: 1px solid ${item.manualDate ? '#0ea5e9' : 'rgba(255,255,255,0.2)'}; color: ${item.manualDate ? '#38bdf8' : '#94a3b8'}; padding: 3px 5px; border-radius: 4px; font-size: 0.75rem; font-family: monospace; outline: none;">
                <button type="button" 
                        title="Set Today (${todayStr})" 
                        onclick="setManualDateToday(this)" 
                        style="background: rgba(56,189,248,0.15); border: 1px solid rgba(56,189,248,0.35); color: #38bdf8; border-radius: 4px; padding: 2px 6px; font-size: 0.7rem; cursor: pointer; font-weight: 600; line-height: 1.4;">
                    Today
                </button>
                ${item.manualDate ? `
                <button type="button" 
                        title="Clear Manual Date" 
                        onclick="clearManualDate(this)" 
                        style="background: rgba(239,68,68,0.15); border: 1px solid rgba(239,68,68,0.35); color: #ef4444; border-radius: 4px; padding: 2px 6px; font-size: 0.7rem; cursor: pointer; line-height: 1.4;">
                    &times;
                </button>` : ''}
            </div>
        `;

        html += `
            <tr class="${rowClass}">
                <td style="text-align: center; color: #94a3b8; padding: 0.55rem 0.4rem;">${item.no || (idx + 1)}</td>
                <td style="font-weight: 600; color: #f8fafc; padding: 0.55rem 0.4rem;">${item.subsys}</td>
                <td style="color: #cbd5e1; padding: 0.55rem 0.4rem;">${item.subsysDesc || '-'}</td>
                <td style="font-weight: 600; color: #38bdf8; padding: 0.55rem 0.4rem;">${item.tag}</td>
                <td style="color: #cbd5e1; padding: 0.55rem 0.4rem;">${item.tagDesc || '-'}</td>
                <td style="padding: 0.55rem 0.4rem;"><span style="font-size: 0.75rem; background: rgba(255,255,255,0.06); padding: 2px 6px; border-radius: 4px; color: #cbd5e1;">${item.disc}</span></td>
                <td style="padding: 0.55rem 0.4rem;"><span style="font-family: monospace; font-weight: 600; color: #fbbf24;">${item.type}</span></td>
                <td style="text-align: center; padding: 0.55rem 0.4rem;">${cmsDateDisplay}</td>
                <td style="text-align: center; padding: 0.55rem 0.4rem;">${manualInputHtml}</td>
                <td style="text-align: center; padding: 0.55rem 0.4rem;">${statusHtml}</td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

async function exportChecksheetsToExcel() {
    if (!currentCsList || currentCsList.length === 0) {
        alert("No checksheet data to export!");
        return;
    }

    let exportList = currentCsList;
    if (currentCsFilterStatus === 'DONE') exportList = exportList.filter(x => x.isDone);
    else if (currentCsFilterStatus === 'PENDING') exportList = exportList.filter(x => !x.isDone);

    if (currentCsSearch) {
        const q = currentCsSearch.toLowerCase();
        exportList = exportList.filter(x =>
            (x.tag && x.tag.toLowerCase().includes(q)) ||
            (x.tagDesc && x.tagDesc.toLowerCase().includes(q)) ||
            (x.type && x.type.toLowerCase().includes(q)) ||
            (x.subsys && x.subsys.toLowerCase().includes(q)) ||
            (String(x.no || '').includes(q))
        );
    }

    const safeSub = currentCsSubsys.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeDisc = currentCsDisc.replace(/[^a-zA-Z0-9_-]/g, '_');
    const safeFileName = `Checksheets_ITRA_${safeSub}_${safeDisc}.xlsx`;

    if (typeof ExcelJS === 'undefined') {
        const rows = exportList.map((item, idx) => ({
            'No': item.no || (idx + 1),
            'SubSystemNo': item.subsys,
            'SubSystemDescription': item.subsysDesc || '',
            'TagNo': item.tag,
            'TagDescription': item.tagDesc || '',
            'Discipline': item.disc,
            'Checksheet Type': item.type,
            'CompleteDate (CMS)': item.cmsDate || '',
            'CompleteDate (M)': item.manualDate || '',
            'Status': (item.cmsDate && item.manualDate) ? 'CMS Synced' : (item.manualDate ? 'Completed (M)' : (item.cmsDate ? 'Completed (CMS)' : 'Pending'))
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, "Checksheets");
        XLSX.writeFile(wb, safeFileName);
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Block B LQP Mechanical Completion";
        workbook.lastModifiedBy = "Block B LQP Mechanical Completion";
        workbook.created = new Date();
        workbook.modified = new Date();

        const worksheet = workbook.addWorksheet("Checksheets", {
            views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
        });

        worksheet.columns = [
            { header: '#', key: 'no', width: 6 },
            { header: 'SUBSYSTEM', key: 'subsys', width: 16 },
            { header: 'SUBSYSTEM DESCRIPTION', key: 'subsysDesc', width: 30 },
            { header: 'TAGNO', key: 'tag', width: 22 },
            { header: 'TAG DESCRIPTION', key: 'tagDesc', width: 34 },
            { header: 'DISCIPLINE', key: 'disc', width: 15 },
            { header: 'CHECKSHEET TYPE', key: 'type', width: 18 },
            { header: 'COMPLETE DATE (CMS)', key: 'cmsDate', width: 18 },
            { header: 'COMPLETE DATE (M)', key: 'manualDate', width: 18 },
            { header: 'STATUS', key: 'status', width: 16 }
        ];

        const headerRow = worksheet.getRow(1);
        headerRow.height = 28;

        const headerBorder = {
            top: { style: 'thin', color: { argb: 'FF0F172A' } },
            left: { style: 'thin', color: { argb: 'FF334155' } },
            bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
            right: { style: 'thin', color: { argb: 'FF334155' } }
        };

        const cellBorder = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        headerRow.eachCell({ includeEmpty: false }, (cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF0F172A' }
            };
            cell.font = {
                name: 'Segoe UI',
                size: 10,
                bold: true,
                color: { argb: 'FFFFFFFF' }
            };
            cell.alignment = {
                vertical: 'middle',
                horizontal: 'center'
            };
            cell.border = headerBorder;
        });

        exportList.forEach((item, idx) => {
            const rowBg = item.isDone ? 'FFDCFCE7' : 'FFFFFFFF';
            const statusColor = item.isDone ? 'FF15803D' : 'FFB45309';

            const rowData = {
                no: item.no || (idx + 1),
                subsys: item.subsys || '',
                subsysDesc: item.subsysDesc || '',
                tag: item.tag || '',
                tagDesc: item.tagDesc || '',
                disc: item.disc || '',
                type: item.type || '',
                compDate: item.compDate || '',
                status: item.isDone ? 'Completed' : 'Pending'
            };

            const row = worksheet.addRow(rowData);
            row.height = 24;

            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                cell.border = cellBorder;
                cell.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: rowBg }
                };
                cell.font = {
                    name: 'Segoe UI',
                    size: 9.5,
                    color: { argb: 'FF0F172A' }
                };

                if (colNumber === 3 || colNumber === 5) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
                } else {
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                }

                if (colNumber === 2 || colNumber === 7) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF0F172A' } };
                }

                if (colNumber === 9) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: statusColor } };
                }
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = safeFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Export Checksheets Excel error:", err);
        alert("Failed to export Excel file: " + err.message);
    }
}
window.exportChecksheetsToExcel = exportChecksheetsToExcel;

function setupChecksheetModalEvents() {
    const btnAll = document.getElementById('cs-btn-filter-all');
    const btnDone = document.getElementById('cs-btn-filter-done');
    const btnPending = document.getElementById('cs-btn-filter-pending');
    const searchInput = document.getElementById('cs-search-input');
    const exportBtn = document.getElementById('btn-export-cs-excel');

    const updateActiveTab = (activeBtn) => {
        [btnAll, btnDone, btnPending].forEach(btn => {
            if (btn) btn.className = 'cs-tab-btn';
        });
        if (activeBtn) activeBtn.className = 'cs-tab-btn active';
    };

    if (btnAll) {
        btnAll.addEventListener('click', () => {
            currentCsFilterStatus = 'ALL';
            updateActiveTab(btnAll);
            renderChecksheetModalTable();
        });
    }

    if (btnDone) {
        btnDone.addEventListener('click', () => {
            currentCsFilterStatus = 'DONE';
            updateActiveTab(btnDone);
            renderChecksheetModalTable();
        });
    }

    if (btnPending) {
        btnPending.addEventListener('click', () => {
            currentCsFilterStatus = 'PENDING';
            updateActiveTab(btnPending);
            renderChecksheetModalTable();
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', () => {
            currentCsSearch = searchInput.value.trim();
            renderChecksheetModalTable();
        });
    }

    if (exportBtn) {
        exportBtn.addEventListener('click', exportChecksheetsToExcel);
    }
}

// =========================================================================
// ----------------- REPORTS TAB LOGIC (WEEKLY & MONTHLY) ------------------
// =========================================================================

let currentFilteredReports = [];


function formatDateDisplay(val) {
    if (val === null || val === undefined || val === '') return '-';
    const str = String(val).trim();
    if (str === '' || str === '0' || str === '-' || str.toLowerCase() === 'n/a' || str.toLowerCase() === 'null' || str.toLowerCase() === 'undefined') {
        return '-';
    }

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // 1. If Date instance
    if (val instanceof Date && !isNaN(val.getTime())) {
        if (val.getFullYear() <= 1970) return '-';
        const dd = String(val.getDate()).padStart(2, '0');
        const mmm = months[val.getMonth()];
        const yyyy = val.getFullYear();
        return `${dd}-${mmm}-${yyyy}`;
    }

    // 2. If Excel serial number (e.g. 46193.6314982986 or "46193")
    const num = Number(val);
    if (!isNaN(num) && num >= 1000 && num <= 100000) {
        // Excel epoch starts 1899-12-30 (25569 days to 1970-01-01)
        const ms = Math.round((num - 25569) * 86400 * 1000);
        const d = new Date(ms);
        if (!isNaN(d.getTime()) && d.getUTCFullYear() > 1970) {
            const dd = String(d.getUTCDate()).padStart(2, '0');
            const mmm = months[d.getUTCMonth()];
            const yyyy = d.getUTCFullYear();
            return `${dd}-${mmm}-${yyyy}`;
        }
    }

    // 3. If string has hyphen (YYYY-MM-DD or DD-MMM-YYYY or DD-MM-YYYY)
    if (str.includes('-')) {
        const parts = str.split('T')[0].split(' ')[0].split('-');
        if (parts.length === 3) {
            // YYYY-MM-DD
            if (parts[0].length === 4) {
                const yyyy = parts[0];
                const mIdx = parseInt(parts[1], 10) - 1;
                const dd = parts[2].substring(0, 2).padStart(2, '0');
                if (mIdx >= 0 && mIdx < 12 && parseInt(yyyy, 10) > 1970) {
                    return `${dd}-${months[mIdx]}-${yyyy}`;
                }
            } else if (parts[2].length === 4) {
                // DD-MM-YYYY or DD-MMM-YYYY
                const dd = parts[0].padStart(2, '0');
                const yyyy = parts[2];
                if (isNaN(parts[1])) {
                    return `${dd}-${parts[1]}-${yyyy}`;
                }
                const mIdx = parseInt(parts[1], 10) - 1;
                if (mIdx >= 0 && mIdx < 12 && parseInt(yyyy, 10) > 1970) {
                    return `${dd}-${months[mIdx]}-${yyyy}`;
                }
            }
        }
    }

    // 4. If string has slash (DD/MM/YYYY or YYYY/MM/DD)
    if (str.includes('/')) {
        const parts = str.split(' ')[0].split('/');
        if (parts.length === 3) {
            if (parts[2].length === 4) {
                const dd = parts[0].padStart(2, '0');
                const mIdx = parseInt(parts[1], 10) - 1;
                const yyyy = parts[2];
                if (mIdx >= 0 && mIdx < 12 && parseInt(yyyy, 10) > 1970) {
                    return `${dd}-${months[mIdx]}-${yyyy}`;
                }
            } else if (parts[0].length === 4) {
                const yyyy = parts[0];
                const mIdx = parseInt(parts[1], 10) - 1;
                const dd = parts[2].padStart(2, '0');
                if (mIdx >= 0 && mIdx < 12 && parseInt(yyyy, 10) > 1970) {
                    return `${dd}-${months[mIdx]}-${yyyy}`;
                }
            }
        }
    }

    // 5. Generic Date parse fallback
    const d = new Date(val);
    if (!isNaN(d.getTime()) && d.getFullYear() > 1970) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mmm = months[d.getMonth()];
        const yyyy = d.getFullYear();
        return `${dd}-${mmm}-${yyyy}`;
    }

    return '-';
}

function setupReports() {
    const presetSelect = document.getElementById('rpt-preset');
    const fromInput = document.getElementById('rpt-from');
    const toInput = document.getElementById('rpt-to');
    const discSelect = document.getElementById('rpt-disc');
    const searchInput = document.getElementById('rpt-search');
    const viewBtn = document.getElementById('btn-rpt-view');
    const exportBtn = document.getElementById('btn-rpt-export');

    if (!presetSelect) return;

    function updateDateInputsFromPreset() {
        const val = presetSelect.value;
        const gd = window.GLOBAL_MC_DATA;
        
        // Use current real calendar date so Weekly/Monthly align with real-world timeline
        const today = new Date();
        const day = today.getDay(); // 0: Sun, 1: Mon, ..., 5: Fri, 6: Sat
        
        // Reporting week cutoff is Friday (Week runs from Sat to Fri):
        // If today is Sat (6), next cutoff Friday is +6 days.
        // If today is Sun (0), next cutoff Friday is +5 days.
        // If today is Mon-Fri, this cutoff Friday is +(5 - day) days.
        const daysToFri = (day === 6) ? 6 : (5 - day);
        
        const thisFri = new Date(today);
        thisFri.setDate(today.getDate() + daysToFri);
        const thisSat = new Date(thisFri);
        thisSat.setDate(thisFri.getDate() - 6);

        if (val === 'weekly_current') {
            fromInput.value = thisSat.toISOString().split('T')[0];
            toInput.value = thisFri.toISOString().split('T')[0];
        } else if (val === 'weekly_prev') {
            const prevFri = new Date(thisFri);
            prevFri.setDate(thisFri.getDate() - 7);
            const prevSat = new Date(prevFri);
            prevSat.setDate(prevFri.getDate() - 6);

            fromInput.value = prevSat.toISOString().split('T')[0];
            toInput.value = prevFri.toISOString().split('T')[0];
        } else if (val === 'monthly_current') {
            const y = today.getFullYear();
            const m = today.getMonth();
            const firstDay = new Date(y, m, 1);
            const lastDay = new Date(y, m + 1, 0);
            fromInput.value = firstDay.toISOString().split('T')[0];
            toInput.value = lastDay.toISOString().split('T')[0];
        } else if (val === 'monthly_prev') {
            const y = today.getFullYear();
            const m = today.getMonth() - 1;
            const firstDay = new Date(y, m, 1);
            const lastDay = new Date(y, m + 1, 0);
            fromInput.value = firstDay.toISOString().split('T')[0];
            toInput.value = lastDay.toISOString().split('T')[0];
        }
    }

    presetSelect.addEventListener('change', () => {
        if (presetSelect.value !== 'custom') {
            updateDateInputsFromPreset();
            renderReport();
        }
    });

    discSelect.addEventListener('change', renderReport);
    viewBtn.addEventListener('click', renderReport);
    searchInput.addEventListener('input', renderReport);
    exportBtn.addEventListener('click', exportReportToExcel);

    // Manual ITR Add/Edit Handlers
    const addManualBtn = document.getElementById('btn-add-manual-itr');
    const manualModal = document.getElementById('manual-itr-modal');
    const manualClose = document.getElementById('manual-itr-modal-close');
    const manualCancel = document.getElementById('btn-man-cancel');
    const manualSave = document.getElementById('btn-man-save');
    const manTagInput = document.getElementById('man-tag');

    if (addManualBtn && manualModal) {
        addManualBtn.addEventListener('click', () => {
            document.getElementById('man-edit-idx').value = '-1';
            document.getElementById('manual-itr-modal-title').textContent = 'Add / Override Completed ITR-A';
            document.getElementById('man-tag').value = '';
            document.getElementById('man-tag-desc').value = '';
            document.getElementById('man-subsys').value = '';
            document.getElementById('man-subsys-desc').value = '';
            document.getElementById('man-disc').value = document.getElementById('rpt-disc').value !== 'ALL' ? document.getElementById('rpt-disc').value : 'MECHANICAL';
            document.getElementById('man-form').value = '';
            document.getElementById('man-date').value = new Date().toISOString().split('T')[0];
            populateTagSuggestions();
            manualModal.style.display = 'flex';
        });

        const closeModal = () => { manualModal.style.display = 'none'; };
        if (manualClose) manualClose.addEventListener('click', closeModal);
        if (manualCancel) manualCancel.addEventListener('click', closeModal);

        // Auto-fill tag details when selecting known tag
        if (manTagInput) {
            manTagInput.addEventListener('change', () => {
                const gd = window.GLOBAL_MC_DATA;
                if (!gd || !gd.globalTagMap) return;
                const tVal = manTagInput.value.trim();
                const found = gd.globalTagMap[tVal];
                if (found) {
                    if (found.desc && found.desc !== '-') document.getElementById('man-tag-desc').value = found.desc;
                    if (found.subsys) {
                        document.getElementById('man-subsys').value = found.subsys;
                        if (gd.sysDescMap && gd.sysDescMap[found.subsys]) {
                            document.getElementById('man-subsys-desc').value = gd.sysDescMap[found.subsys];
                        }
                    }
                    if (found.disc) document.getElementById('man-disc').value = found.disc;
                }
            });
        }

        if (manualSave) {
            manualSave.addEventListener('click', saveManualItr);
        }
    }

    updateDateInputsFromPreset();
}

function populateTagSuggestions() {
    const gd = window.GLOBAL_MC_DATA;
    const dl = document.getElementById('tag-suggestions');
    if (!gd || !gd.globalTagMap || !dl) return;
    dl.innerHTML = '';
    Object.keys(gd.globalTagMap).slice(0, 100).forEach(t => {
        dl.innerHTML += `<option value="${t}">`;
    });
}

function saveManualItr() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    if (!gd.globalCompletedChecksheets) gd.globalCompletedChecksheets = [];

    const tag = document.getElementById('man-tag').value.trim();
    const subsys = document.getElementById('man-subsys').value.trim();
    const formNo = document.getElementById('man-form').value.trim();
    const compDate = document.getElementById('man-date').value;
    const disc = document.getElementById('man-disc').value;
    const tagDesc = document.getElementById('man-tag-desc').value.trim() || '-';
    const subsysDesc = document.getElementById('man-subsys-desc').value.trim() || (gd.sysDescMap ? gd.sysDescMap[subsys] : '') || '-';
    const editIdx = parseInt(document.getElementById('man-edit-idx').value, 10);

    if (!tag || !subsys || !compDate) {
        alert('Please fill in Tag No, SubSystem No, and Complete Date!');
        return;
    }

    const sys = subsys.includes('-') && subsys.split('-').length > 1 ? subsys.split('-')[1] : 'OTHER';

    if (editIdx >= 0 && editIdx < currentFilteredReports.length) {
        // Edit existing item
        const targetItem = currentFilteredReports[editIdx];
        targetItem.tag = tag;
        targetItem.tagDesc = tagDesc;
        targetItem.subsys = subsys;
        targetItem.subsysDesc = subsysDesc;
        targetItem.sys = sys;
        targetItem.disc = disc;
        targetItem.formNo = formNo;
        targetItem.dateStr = compDate;
        targetItem.isManual = true;
    } else {
        // Add new item
        gd.globalCompletedChecksheets.push({
            sys: sys,
            subsys: subsys,
            subsysDesc: subsysDesc,
            disc: disc,
            formNo: formNo || 'ITR-A',
            tag: tag,
            tagDesc: tagDesc,
            dateStr: compDate,
            isManual: true
        });
    }

    document.getElementById('manual-itr-modal').style.display = 'none';
    recalculateMasterCounts();
    if (gd.matrix) renderMatrix(gd.matrix);
    if (gd.mcData && gd.dashGroups) renderDashboardWidgets(gd.mcData, gd.dashGroups);
    if (gd.mcData && gd.sumItr) renderSummaryWidgets(gd.mcData, gd.sumItr, gd.sumPunch, gd.sumDac, gd.sumCssc);
    renderReport();
    autoPersistCurrentData();
    document.getElementById('btn-save-data').style.display = 'inline-flex';
    alert('Completed ITR saved! Click "Save Data" on top to export data.json.');
}

window.openEditManualItr = function(idx) {
    if (!currentFilteredReports || !currentFilteredReports[idx]) return;
    const item = currentFilteredReports[idx];
    document.getElementById('man-edit-idx').value = idx;
    document.getElementById('manual-itr-modal-title').textContent = 'Edit Completion Date / Details';
    document.getElementById('man-tag').value = item.tag || '';
    document.getElementById('man-tag-desc').value = item.tagDesc || '';
    document.getElementById('man-subsys').value = item.subsys || '';
    document.getElementById('man-subsys-desc').value = item.subsysDesc || '';
    document.getElementById('man-disc').value = item.disc || 'MECHANICAL';
    document.getElementById('man-form').value = item.formNo || '';
    document.getElementById('man-date').value = item.dateStr || '';
    populateTagSuggestions();
    document.getElementById('manual-itr-modal').style.display = 'flex';
};

window.deleteManualItr = function(idx) {
    if (!currentFilteredReports || !currentFilteredReports[idx]) return;
    const item = currentFilteredReports[idx];
    if (confirm(`Remove Tag ${item.tag} (${item.formNo}) from completed report?`)) {
        const gd = window.GLOBAL_MC_DATA;
        if (gd && gd.globalCompletedChecksheets) {
            const pos = gd.globalCompletedChecksheets.indexOf(item);
            if (pos !== -1) {
                gd.globalCompletedChecksheets.splice(pos, 1);
            }
        }
        recalculateMasterCounts();
        if (gd.matrix) renderMatrix(gd.matrix);
        if (gd.mcData && gd.dashGroups) renderDashboardWidgets(gd.mcData, gd.dashGroups);
        if (gd.mcData && gd.sumItr) renderSummaryWidgets(gd.mcData, gd.sumItr, gd.sumPunch, gd.sumDac, gd.sumCssc);
        renderReport();
        autoPersistCurrentData();
        document.getElementById('btn-save-data').style.display = 'inline-flex';
    }
};

function initReportsUI() {
    const presetSelect = document.getElementById('rpt-preset');
    if (presetSelect) {
        presetSelect.dispatchEvent(new Event('change'));
    }
}

function renderReport() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;

    const fromDate = document.getElementById('rpt-from').value;
    const toDate = document.getElementById('rpt-to').value;
    const disc = document.getElementById('rpt-disc').value;
    const q = (document.getElementById('rpt-search').value || '').trim().toLowerCase();
    const list = gd.globalCompletedChecksheets || [];

    const filtered = list.filter(item => {
        if (fromDate && item.dateStr < fromDate) return false;
        if (toDate && item.dateStr > toDate) return false;
        if (disc !== 'ALL' && item.disc !== disc) return false;
        if (q) {
            const match = (item.tag && item.tag.toLowerCase().includes(q)) ||
                          (item.subsys && item.subsys.toLowerCase().includes(q)) ||
                          (item.formNo && item.formNo.toLowerCase().includes(q)) ||
                          (item.tagDesc && item.tagDesc.toLowerCase().includes(q));
            if (!match) return false;
        }
        return true;
    });

    filtered.sort((a, b) => {
        if (a.dateStr !== b.dateStr) return b.dateStr.localeCompare(a.dateStr);
        if (a.subsys !== b.subsys) return a.subsys.localeCompare(b.subsys);
        return a.tag.localeCompare(b.tag);
    });

    currentFilteredReports = filtered;

    const subsysSet = new Set(filtered.map(x => x.subsys));
    document.getElementById('rpt-kpi-total').textContent = `${filtered.length} ITRs`;
    document.getElementById('rpt-kpi-period').textContent = fromDate && toDate ? `${formatDateDisplay(fromDate)} → ${formatDateDisplay(toDate)}` : 'All Dates';
    document.getElementById('rpt-kpi-disc').textContent = disc;
    document.getElementById('rpt-kpi-subsys').textContent = `${subsysSet.size} Subsystems`;

    const tbody = document.getElementById('rpt-tbody');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 2rem; color: #64748b;">No completed ITR-A found for the selected period and criteria.</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach((item, idx) => {
        html += `
            <tr>
                <td style="color: #64748b; text-align: center;">${idx + 1}</td>
                <td style="text-align: left; padding-left: 8px;"><b>${item.subsys}</b></td>
                <td style="text-align: left; padding-left: 8px; color: #94a3b8; font-size: 0.8rem;">${item.subsysDesc || '-'}</td>
                <td style="text-align: left; padding-left: 8px;"><b>${item.tag}</b></td>
                <td style="text-align: left; padding-left: 8px;">${item.tagDesc}</td>
                <td style="text-align: left; padding-left: 8px;">${item.disc}</td>
                <td style="text-align: center;"><span class="badge" style="background: rgba(14,165,233,0.15); color: #0ea5e9;">${item.formNo}</span></td>
                <td style="text-align: center;"><b style="color: #38bdf8; cursor: pointer;" onclick="openEditManualItr(${idx})" title="Click to edit completion date">${formatDateDisplay(item.dateStr)}</b></td>
                <td style="text-align: center;"><span class="badge" style="background: rgba(16,185,129,0.15); color: #10b981;">${item.isManual ? 'VERIFIED' : 'DONE'}</span></td>
                <td style="text-align: center;">
                    <button onclick="openEditManualItr(${idx})" style="background:none; border:none; color:#38bdf8; cursor:pointer; padding:2px 4px;" title="Edit Date / Info">✏️</button>
                    <button onclick="deleteManualItr(${idx})" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:2px 4px;" title="Remove from report">🗑️</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

function exportReportToExcel() {
    if (!currentFilteredReports || currentFilteredReports.length === 0) {
        alert("No completed checksheets in this report to export!");
        return;
    }

    const fromDate = document.getElementById('rpt-from').value;
    const toDate = document.getElementById('rpt-to').value;
    const disc = document.getElementById('rpt-disc').value;
    const preset = document.getElementById('rpt-preset').value;

    const isMonthly = preset.includes('monthly');
    const reportTitle = isMonthly ? 'MONTHLY ITR-A COMPLETION REPORT' : 'WEEKLY ITR-A COMPLETION REPORT';
    
    // Header labels
    const cutOffLabel = isMonthly ? 'Report Month:' : 'Cut-off Date:';
    const cutOffVal = isMonthly ? formatDateDisplay(toDate).substring(3) : formatDateDisplay(toDate);
    const periodStr = `${formatDateDisplay(fromDate)} to ${formatDateDisplay(toDate)}`;

    const excelData = [
        [reportTitle, '', '', '', '', '', '', '', ''],
        ['Project: BLOCK B LQP - MECHANICAL COMPLETION', '', '', '', '', '', '', '', ''],
        [`${cutOffLabel} ${cutOffVal}`, '', '', `Period: ${periodStr}`, '', '', '', '', ''],
        [`Discipline: ${disc}`, '', '', `Total Completed: ${currentFilteredReports.length} ITRs`, '', '', '', '', ''],
        [`Exported Date: ${formatDateDisplay(new Date())}`, '', '', '', '', '', '', '', ''],
        [],
        ['No', 'SubSystemNo', 'SubSystemDescription', 'TagNo', 'TagDescription', 'Discipline', 'Checksheet Type', 'CompleteDate', 'Status']
    ];

    currentFilteredReports.forEach((item, idx) => {
        excelData.push([
            idx + 1,
            item.subsys,
            item.subsysDesc || '-',
            item.tag,
            item.tagDesc,
            item.disc,
            item.formNo,
            formatDateDisplay(item.dateStr),
            'COMPLETED'
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(excelData);

    // Merge cells for Top Metadata so NO text is ever clipped
    ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: 8 } }, // Title across A1:I1
        { s: { r: 1, c: 0 }, e: { r: 1, c: 8 } }, // Project across A2:I2
        { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } }, // Cut-off merged across A3:C3
        { s: { r: 2, c: 3 }, e: { r: 2, c: 8 } }, // Period merged across D3:I3
        { s: { r: 3, c: 0 }, e: { r: 3, c: 2 } }, // Discipline merged across A4:C4
        { s: { r: 3, c: 3 }, e: { r: 3, c: 8 } }, // Total merged across D4:I4
        { s: { r: 4, c: 0 }, e: { r: 4, c: 2 } }  // Exported Date merged across A5:C5
    ];

    // Auto-fit Column Widths based on actual content
    const colWidths = [];
    for (let C = 0; C < 9; C++) {
        let maxLen = 0;
        for (let R = 6; R < excelData.length; R++) {
            const val = excelData[R] && excelData[R][C] !== undefined ? String(excelData[R][C]) : '';
            if (val.length > maxLen) maxLen = val.length;
        }
        let minW = 12;
        if (C === 0) minW = 6;
        else if (C === 1) minW = 15;
        else if (C === 2) minW = 28;
        else if (C === 3) minW = 24;
        else if (C === 4) minW = 32;
        else if (C === 5) minW = 14;
        else if (C === 6) minW = 16;
        else if (C === 7) minW = 14;
        else if (C === 8) minW = 12;
        colWidths.push({ wch: Math.max(maxLen + 3, minW) });
    }
    ws['!cols'] = colWidths;

    // Styling definitions (Supported by xlsx-js-style)
    const thinBorder = {
        top: { style: 'thin', color: { rgb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { rgb: 'CBD5E1' } },
        left: { style: 'thin', color: { rgb: 'CBD5E1' } },
        right: { style: 'thin', color: { rgb: 'CBD5E1' } }
    };

    const headerBorder = {
        top: { style: 'medium', color: { rgb: '0F172A' } },
        bottom: { style: 'medium', color: { rgb: '0F172A' } },
        left: { style: 'thin', color: { rgb: '334155' } },
        right: { style: 'thin', color: { rgb: '334155' } }
    };

    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = range.s.r; R <= range.e.r; ++R) {
        for (let C = range.s.c; C <= range.e.c; ++C) {
            const cellAddress = XLSX.utils.encode_cell({ r: R, c: C });
            if (!ws[cellAddress]) continue;

            if (R === 0) {
                // Title
                ws[cellAddress].s = {
                    font: { name: 'Calibri', sz: 14, bold: true, color: { rgb: '1E3A8A' } },
                    alignment: { vertical: 'center' }
                };
            } else if (R === 1) {
                // Project
                ws[cellAddress].s = {
                    font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: '475569' } },
                    alignment: { vertical: 'center' }
                };
            } else if (R >= 2 && R <= 4) {
                // Metadata
                const isLabel = (C === 0 || C === 3);
                ws[cellAddress].s = {
                    font: { name: 'Calibri', sz: 10, bold: isLabel, color: isLabel ? { rgb: '0F172A' } : { rgb: '334155' } },
                    alignment: { vertical: 'center' }
                };
            } else if (R === 6) {
                // Table Header Row (Tag No, Subsystem...)
                ws[cellAddress].s = {
                    font: { name: 'Calibri', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
                    fill: { fgColor: { rgb: '1E3A8A' } }, // Professional navy blue
                    border: headerBorder,
                    alignment: { horizontal: 'center', vertical: 'center', wrapText: true }
                };
            } else if (R >= 7) {
                // Data Rows with Grid Borders
                const isCenter = (C === 0 || C === 6 || C === 7 || C === 8);
                ws[cellAddress].s = {
                    font: { name: 'Calibri', sz: 10 },
                    border: thinBorder,
                    alignment: { horizontal: isCenter ? 'center' : 'left', vertical: 'center' }
                };
                if (C === 8) {
                    ws[cellAddress].s.font = { name: 'Calibri', sz: 10, bold: true, color: { rgb: '059669' } };
                }
            }
        }
    }

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ITR Report");

    const fileName = `${isMonthly ? 'Monthly' : 'Weekly'}_Report_${disc}_${formatDateDisplay(toDate) || 'All'}.xlsx`;
    XLSX.writeFile(wb, fileName);
}


// =========================================================================
// ----------------- FLASH REPORT TAB LOGIC (INSPECTION FINDINGS) -----------
// =========================================================================

let currentFilteredFlash = [];
let tempFlashImgData = '';

function setupFlashReport() {
    const discSelect = document.getElementById('flash-filter-disc');
    const statusSelect = document.getElementById('flash-filter-status');
    const searchInput = document.getElementById('flash-search');
    const addBtn = document.getElementById('btn-flash-add');
    const exportBtn = document.getElementById('btn-flash-export');
    const printBtn = document.getElementById('btn-flash-print');

    if (!addBtn) return;

    discSelect.addEventListener('change', renderFlashReports);
    statusSelect.addEventListener('change', renderFlashReports);
    searchInput.addEventListener('input', renderFlashReports);

    // Modal controls
    const flashModal = document.getElementById('flash-modal');
    const flashClose = document.getElementById('flash-modal-close');
    const flashCancel = document.getElementById('btn-flash-cancel');
    const flashSave = document.getElementById('btn-flash-save');

    addBtn.addEventListener('click', () => {
        document.getElementById('flash-edit-id').value = '-1';
        document.getElementById('flash-modal-title').textContent = 'New Inspection Finding & Flash Report';
        document.getElementById('fl-tag').value = '';
        document.getElementById('fl-subsys').value = '';
        document.getElementById('fl-desc').value = '';
        document.getElementById('fl-disc').value = discSelect.value !== 'ALL' ? discSelect.value : 'MECHANICAL';
        document.getElementById('fl-date').value = new Date().toISOString().split('T')[0];
        document.getElementById('fl-status').value = 'Closed';
        document.getElementById('fl-insp-desc').value = '';
        document.getElementById('fl-note').value = '';
        document.getElementById('fl-response').value = '';
        document.getElementById('fl-resp-type').value = 'green';
        clearFlashImgPreview();
        populateTagSuggestions();
        flashModal.style.display = 'flex';
    });

    const closeFModal = () => { flashModal.style.display = 'none'; };
    if (flashClose) flashClose.addEventListener('click', closeFModal);
    if (flashCancel) flashCancel.addEventListener('click', closeFModal);

    // Auto-fill Tag details
    const tagInp = document.getElementById('fl-tag');
    if (tagInp) {
        tagInp.addEventListener('change', () => {
            const gd = window.GLOBAL_MC_DATA;
            if (!gd || !gd.globalTagMap) return;
            const tVal = tagInp.value.trim();
            const found = gd.globalTagMap[tVal];
            if (found) {
                if (found.desc && found.desc !== '-') document.getElementById('fl-desc').value = found.desc;
                if (found.subsys) document.getElementById('fl-subsys').value = found.subsys;
                if (found.disc) document.getElementById('fl-disc').value = found.disc;
            }
        });
    }

    // Image Upload & Paste
    const dropZone = document.getElementById('fl-drop-zone');
    const imgInput = document.getElementById('fl-img-input');
    const removeImgBtn = document.getElementById('btn-fl-remove-img');

    if (dropZone && imgInput) {
        dropZone.addEventListener('click', (e) => {
            if (e.target !== removeImgBtn) imgInput.click();
        });

        imgInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (re) => { setFlashImgPreview(re.target.result); };
                reader.readAsDataURL(file);
            }
        });

        // Paste support (Ctrl + V)
        window.addEventListener('paste', (e) => {
            if (flashModal.style.display === 'flex') {
                const items = (e.clipboardData || e.originalEvent.clipboardData).items;
                for (const item of items) {
                    if (item.type.indexOf('image') !== -1) {
                        const blob = item.getAsFile();
                        const reader = new FileReader();
                        reader.onload = (re) => { setFlashImgPreview(re.target.result); };
                        reader.readAsDataURL(blob);
                        break;
                    }
                }
            }
        });
    }

    if (removeImgBtn) {
        removeImgBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearFlashImgPreview();
        });
    }

    if (flashSave) flashSave.addEventListener('click', saveFlashFinding);
    if (exportBtn) exportBtn.addEventListener('click', exportFlashReportExcel);
    if (printBtn) printBtn.addEventListener('click', printFlashReport);

    renderFlashReports();
}

function setFlashImgPreview(dataUrl) {
    tempFlashImgData = dataUrl;
    const previewBox = document.getElementById('fl-img-preview-box');
    const promptBox = document.getElementById('fl-drop-prompt');
    const imgEl = document.getElementById('fl-img-preview');
    if (imgEl && previewBox) {
        imgEl.src = dataUrl;
        previewBox.style.display = 'flex';
        promptBox.style.display = 'none';
    }
}

function clearFlashImgPreview() {
    tempFlashImgData = '';
    const previewBox = document.getElementById('fl-img-preview-box');
    const promptBox = document.getElementById('fl-drop-prompt');
    const imgEl = document.getElementById('fl-img-preview');
    const imgInput = document.getElementById('fl-img-input');
    if (imgEl) imgEl.src = '';
    if (imgInput) imgInput.value = '';
    if (previewBox) previewBox.style.display = 'none';
    if (promptBox) promptBox.style.display = 'block';
}

function saveFlashFinding() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    if (!gd.globalFlashReports) gd.globalFlashReports = [];

    const tag = document.getElementById('fl-tag').value.trim();
    const subsys = document.getElementById('fl-subsys').value.trim();
    const desc = document.getElementById('fl-desc').value.trim();
    const disc = document.getElementById('fl-disc').value;
    const date = document.getElementById('fl-date').value;
    const status = document.getElementById('fl-status').value;
    const inspDesc = document.getElementById('fl-insp-desc').value.trim();
    const note = document.getElementById('fl-note').value.trim();
    const response = document.getElementById('fl-response').value.trim();
    const respType = document.getElementById('fl-resp-type').value;
    const editId = parseInt(document.getElementById('flash-edit-id').value, 10);

    if (!tag || !inspDesc) {
        alert('Please fill in Tag No and Inspection Description!');
        return;
    }

    if (editId > 0) {
        const found = gd.globalFlashReports.find(f => f.id === editId);
        if (found) {
            found.tag = tag;
            found.subsys = subsys;
            found.desc = desc;
            found.disc = disc;
            found.date = date;
            found.status = status;
            found.inspDesc = inspDesc;
            found.note = note;
            found.response = response;
            found.respType = respType;
            if (tempFlashImgData !== undefined) found.img = tempFlashImgData;
        }
    } else {
        const newId = Date.now();
        gd.globalFlashReports.push({
            id: newId,
            tag: tag,
            subsys: subsys,
            desc: desc,
            disc: disc,
            date: date,
            status: status,
            inspDesc: inspDesc,
            note: note,
            img: tempFlashImgData || '',
            response: response,
            respType: respType
        });
    }

    document.getElementById('flash-modal').style.display = 'none';
    renderFlashReports();
    autoPersistCurrentData();
    document.getElementById('btn-save-data').style.display = 'inline-flex';
    alert('Flash Finding saved! Data is saved locally in this browser. Click "Save Data" on top to export data.json.');
}

function renderFlashReports() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    const list = gd.globalFlashReports || [];

    const disc = document.getElementById('flash-filter-disc') ? document.getElementById('flash-filter-disc').value : 'ALL';
    const status = document.getElementById('flash-filter-status') ? document.getElementById('flash-filter-status').value : 'ALL';
    const q = document.getElementById('flash-search') ? (document.getElementById('flash-search').value || '').trim().toLowerCase() : '';

    const filtered = list.filter(item => {
        if (disc !== 'ALL' && item.disc !== disc) return false;
        if (status !== 'ALL' && item.status !== status) return false;
        if (q) {
            const m = (item.tag && item.tag.toLowerCase().includes(q)) ||
                      (item.desc && item.desc.toLowerCase().includes(q)) ||
                      (item.subsys && item.subsys.toLowerCase().includes(q)) ||
                      (item.inspDesc && item.inspDesc.toLowerCase().includes(q)) ||
                      (item.note && item.note.toLowerCase().includes(q)) ||
                      (item.response && item.response.toLowerCase().includes(q));
            if (!m) return false;
        }
        return true;
    });

    currentFilteredFlash = filtered;

    // Update KPI stats
    const openCount = filtered.filter(f => f.status === 'Open').length;
    const closedCount = filtered.filter(f => f.status === 'Closed').length;

    if (document.getElementById('flash-kpi-total')) document.getElementById('flash-kpi-total').textContent = filtered.length;
    if (document.getElementById('flash-kpi-open')) document.getElementById('flash-kpi-open').textContent = openCount;
    if (document.getElementById('flash-kpi-closed')) document.getElementById('flash-kpi-closed').textContent = closedCount;
    if (document.getElementById('flash-kpi-disc')) document.getElementById('flash-kpi-disc').textContent = disc;

    const tbody = document.getElementById('flash-tbody');
    if (!tbody) return;

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 2rem; color: #64748b;">No Flash Report findings found for the selected filter. Click "+ New Finding" to create one.</td></tr>`;
        return;
    }

    let html = '';
    filtered.forEach((item, idx) => {
        const isClosed = item.status === 'Closed';
        const stBg = isClosed ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';
        const stColor = isClosed ? '#10b981' : '#ef4444';

        // Response box styling matching screenshot
        let respBg = 'rgba(255,255,255,0.05)';
        let respColor = '#e2e8f0';
        if (item.respType === 'green') {
            respBg = 'rgba(16, 185, 129, 0.15)';
            respColor = '#34d399';
        } else if (item.respType === 'blue') {
            respBg = 'rgba(14, 165, 233, 0.15)';
            respColor = '#38bdf8';
        } else if (item.respType === 'red') {
            respBg = 'rgba(239, 68, 68, 0.15)';
            respColor = '#f87171';
        }

        // Illustration thumbnail
        let imgHtml = '<span style="color:#64748b; font-size:0.75rem;">No Image</span>';
        if (item.img) {
            imgHtml = `<img src="${item.img}" style="max-height: 48px; max-width: 80px; border-radius: 4px; border: 1px solid rgba(255,255,255,0.2); cursor: pointer;" onclick="openFlashLightbox('${item.id}')" title="Click to view full image">`;
        }

        html += `
            <tr>
                <td style="color: #64748b; text-align: center;">${idx + 1}</td>
                <td style="text-align: left; padding-left: 8px;">
                    <b style="color: #fff;">${item.tag}</b><br>
                    <span style="font-size: 0.8rem; color: #94a3b8;">${item.desc || ''}</span>
                    ${item.subsys ? `<br><span style="font-size: 0.75rem; color: #38bdf8;">(Subsystem: ${item.subsys})</span>` : ''}
                </td>
                <td style="text-align: left; padding-left: 8px; line-height: 1.4; font-size: 0.85rem;">${item.inspDesc}</td>
                <td style="text-align: left; padding-left: 8px; line-height: 1.4; font-size: 0.85rem; color: #cbd5e1;">${item.note || '-'}</td>
                <td style="text-align: center;">${imgHtml}</td>
                <td style="text-align: center;">
                    <span class="badge" style="background: ${stBg}; color: ${stColor}; font-weight: 700;">${item.status}</span>
                </td>
                <td style="text-align: left; padding: 8px; background: ${respBg}; color: ${respColor}; font-size: 0.85rem; line-height: 1.4;">
                    ${item.response || '-'}
                </td>
                <td style="text-align: center;">
                    <button onclick="openEditFlashFinding(${item.id})" style="background:none; border:none; color:#38bdf8; cursor:pointer; padding:2px 4px;" title="Edit Finding">✏️</button>
                    <button onclick="deleteFlashFinding(${item.id})" style="background:none; border:none; color:#ef4444; cursor:pointer; padding:2px 4px;" title="Delete Finding">🗑️</button>
                </td>
            </tr>
        `;
    });
    tbody.innerHTML = html;
}

window.openEditFlashFinding = function(id) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd || !gd.globalFlashReports) return;
    const item = gd.globalFlashReports.find(f => f.id === id);
    if (!item) return;

    document.getElementById('flash-edit-id').value = item.id;
    document.getElementById('flash-modal-title').textContent = 'Edit Inspection Finding';
    document.getElementById('fl-tag').value = item.tag || '';
    document.getElementById('fl-subsys').value = item.subsys || '';
    document.getElementById('fl-desc').value = item.desc || '';
    document.getElementById('fl-disc').value = item.disc || 'MECHANICAL';
    document.getElementById('fl-date').value = item.date || '';
    document.getElementById('fl-status').value = item.status || 'Closed';
    document.getElementById('fl-insp-desc').value = item.inspDesc || '';
    document.getElementById('fl-note').value = item.note || '';
    document.getElementById('fl-response').value = item.response || '';
    document.getElementById('fl-resp-type').value = item.respType || 'green';

    if (item.img) setFlashImgPreview(item.img);
    else clearFlashImgPreview();

    populateTagSuggestions();
    document.getElementById('flash-modal').style.display = 'flex';
};

window.deleteFlashFinding = function(id) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd || !gd.globalFlashReports) return;
    const item = gd.globalFlashReports.find(f => f.id === id);
    if (!item) return;

    if (confirm(`Delete Flash Finding for ${item.tag}?`)) {
        gd.globalFlashReports = gd.globalFlashReports.filter(f => f.id !== id);
        renderFlashReports();
        autoPersistCurrentData();
        document.getElementById('btn-save-data').style.display = 'inline-flex';
    }
};

window.openFlashLightbox = function(id) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd || !gd.globalFlashReports) return;
    const item = gd.globalFlashReports.find(f => f.id == id);
    if (!item || !item.img) return;

    const modal = document.getElementById('image-lightbox-modal');
    const imgEl = document.getElementById('lightbox-img');
    const capEl = document.getElementById('lightbox-caption');
    if (modal && imgEl) {
        imgEl.src = item.img;
        if (capEl) capEl.textContent = `${item.tag} - ${item.desc || ''}`;
        modal.style.display = 'flex';
    }
};

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

async function exportFlashReportExcel() {
    if (!currentFilteredFlash || currentFilteredFlash.length === 0) {
        alert("No findings to export!");
        return;
    }

    const disc = document.getElementById('flash-filter-disc').value;
    const todayStr = formatDateDisplay(new Date());

    // Check if ExcelJS is loaded
    if (typeof ExcelJS === 'undefined') {
        alert("ExcelJS library is loading, please try again in a moment.");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Block B LQP Mechanical Completion";
        workbook.lastModifiedBy = "Block B LQP Mechanical Completion";
        workbook.created = new Date();
        workbook.modified = new Date();

        const worksheet = workbook.addWorksheet("Flash Report", {
            views: [{ showGridLines: true }]
        });

        // Setup columns
        worksheet.columns = [
            { key: 'no', width: 6 },        // A: No
            { key: 'tag', width: 28 },      // B: Tag & Subsystem
            { key: 'desc', width: 38 },     // C: Inspection Description
            { key: 'note', width: 32 },     // D: Note
            { key: 'img', width: 26 },      // E: Illustration
            { key: 'status', width: 12 },   // F: Status
            { key: 'resp', width: 44 }      // G: Response
        ];

        const thinBorder = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        const headerBorder = {
            top: { style: 'thin', color: { argb: 'FF0F172A' } },
            left: { style: 'thin', color: { argb: 'FF0F172A' } },
            bottom: { style: 'thin', color: { argb: 'FF0F172A' } },
            right: { style: 'thin', color: { argb: 'FF0F172A' } }
        };

        // Row 1: Title
        worksheet.mergeCells('A1:G1');
        const r1 = worksheet.getCell('A1');
        r1.value = 'Report: ITR-A Inspection Finding';
        r1.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FF1E3A8A' } };
        r1.alignment = { vertical: 'middle', horizontal: 'left' };
        worksheet.getRow(1).height = 25;

        // Row 2: System / Tag & Location
        worksheet.mergeCells('A2:B2');
        const a2 = worksheet.getCell('A2');
        a2.value = 'System / Equipment Tag:';
        a2.font = { name: 'Calibri', size: 10, bold: true };
        a2.alignment = { vertical: 'middle', horizontal: 'left' };

        worksheet.mergeCells('C2:D2');
        const c2 = worksheet.getCell('C2');
        c2.value = 'ITR-A Inspection';
        c2.font = { name: 'Calibri', size: 10 };
        c2.alignment = { vertical: 'middle', horizontal: 'left' };

        const e2 = worksheet.getCell('E2');
        e2.value = 'Location:';
        e2.font = { name: 'Calibri', size: 10, bold: true };
        e2.alignment = { vertical: 'middle', horizontal: 'left' };

        worksheet.mergeCells('F2:G2');
        const f2 = worksheet.getCell('F2');
        f2.value = 'LQP Topside';
        f2.font = { name: 'Calibri', size: 10 };
        f2.alignment = { vertical: 'middle', horizontal: 'left' };
        worksheet.getRow(2).height = 20;

        // Row 3: Updated Report Date & Discipline
        worksheet.mergeCells('A3:B3');
        const a3 = worksheet.getCell('A3');
        a3.value = 'Updated Report Date:';
        a3.font = { name: 'Calibri', size: 10, bold: true };
        a3.alignment = { vertical: 'middle', horizontal: 'left' };

        worksheet.mergeCells('C3:D3');
        const c3 = worksheet.getCell('C3');
        c3.value = todayStr;
        c3.font = { name: 'Calibri', size: 10 };
        c3.alignment = { vertical: 'middle', horizontal: 'left' };

        const e3 = worksheet.getCell('E3');
        e3.value = 'Discipline:';
        e3.font = { name: 'Calibri', size: 10, bold: true };
        e3.alignment = { vertical: 'middle', horizontal: 'left' };

        worksheet.mergeCells('F3:G3');
        const f3 = worksheet.getCell('F3');
        f3.value = disc;
        f3.font = { name: 'Calibri', size: 10 };
        f3.alignment = { vertical: 'middle', horizontal: 'left' };
        worksheet.getRow(3).height = 20;

        // Row 4: Section Banner "Detail of Inspection"
        worksheet.mergeCells('A4:G4');
        const r4 = worksheet.getCell('A4');
        r4.value = 'Detail of Inspection';
        r4.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FF1E293B' } };
        r4.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE2E8F0' }
        };
        r4.alignment = { vertical: 'middle', horizontal: 'center' };
        worksheet.getRow(4).height = 22;

        // Row 5: Column Headers
        const headers = ['No', 'Tag', 'Inspection Description', 'Note', 'Illustration', 'Status', 'Response'];
        const r5 = worksheet.getRow(5);
        r5.height = 24;
        headers.forEach((h, idx) => {
            const cell = r5.getCell(idx + 1);
            cell.value = h;
            cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1E3A8A' }
            };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = headerBorder;
        });

        // Rows 6+: Data rows
        for (let i = 0; i < currentFilteredFlash.length; i++) {
            const item = currentFilteredFlash[i];
            const rowNumber = 6 + i;
            const row = worksheet.getRow(rowNumber);

            const hasImage = Boolean(item.img && item.img.startsWith('data:image'));
            row.height = hasImage ? 85 : 44;

            const tagFormatted = `${item.tag || ''}${item.desc ? `\n${item.desc}` : ''}${item.subsys ? `\n(Subsystem: ${item.subsys})` : ''}`.trim();

            // Col 1: No
            const c1 = row.getCell(1);
            c1.value = i + 1;
            c1.alignment = { vertical: 'middle', horizontal: 'center' };
            c1.border = thinBorder;
            c1.font = { name: 'Calibri', size: 10 };

            // Col 2: Tag
            const c2 = row.getCell(2);
            c2.value = tagFormatted;
            c2.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            c2.border = thinBorder;
            c2.font = { name: 'Calibri', size: 10 };

            // Col 3: Inspection Description
            const c3 = row.getCell(3);
            c3.value = item.inspDesc || '-';
            c3.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            c3.border = thinBorder;
            c3.font = { name: 'Calibri', size: 10 };

            // Col 4: Note
            const c4 = row.getCell(4);
            c4.value = item.note || '-';
            c4.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            c4.border = thinBorder;
            c4.font = { name: 'Calibri', size: 10 };

            // Col 5: Illustration
            const c5 = row.getCell(5);
            c5.alignment = { vertical: 'middle', horizontal: 'center' };
            c5.border = thinBorder;
            c5.font = { name: 'Calibri', size: 10 };

            if (hasImage) {
                c5.value = ''; // Clean background for image
                try {
                    let extension = 'png';
                    if (item.img.includes('data:image/jpeg') || item.img.includes('data:image/jpg')) {
                        extension = 'jpeg';
                    } else if (item.img.includes('data:image/gif')) {
                        extension = 'gif';
                    }
                    const parts = item.img.split(',');
                    const base64Data = parts[1] || parts[0];

                    const imageId = workbook.addImage({
                        base64: base64Data,
                        extension: extension
                    });

                    // Col 4 is 0-indexed column E
                    worksheet.addImage(imageId, {
                        tl: { col: 4.12, row: (rowNumber - 1) + 0.08 },
                        ext: { width: 155, height: 95 },
                        editAs: 'oneCell'
                    });
                } catch (imgErr) {
                    console.error("Failed to embed image:", imgErr);
                    c5.value = '[Image]';
                }
            } else {
                c5.value = '-';
            }

            // Col 6: Status
            const c6 = row.getCell(6);
            const statusVal = item.status || 'Closed';
            c6.value = statusVal;
            c6.alignment = { vertical: 'middle', horizontal: 'center' };
            c6.border = thinBorder;
            if (statusVal.toLowerCase() === 'closed') {
                c6.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFD1FAE5' }
                };
                c6.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF065F46' } };
            } else {
                c6.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFEE2E2' }
                };
                c6.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF991B1B' } };
            }

            // Col 7: Response
            const c7 = row.getCell(7);
            c7.value = item.response || '-';
            c7.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
            c7.border = thinBorder;
            c7.font = { name: 'Calibri', size: 10 };

            if (item.respType === 'green') {
                c7.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFD1FAE5' }
                };
                c7.font = { name: 'Calibri', size: 10, color: { argb: 'FF065F46' } };
            } else if (item.respType === 'blue') {
                c7.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFE0F2FE' }
                };
                c7.font = { name: 'Calibri', size: 10, color: { argb: 'FF0369A1' } };
            } else if (item.respType === 'red') {
                c7.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: 'FFFEE2E2' }
                };
                c7.font = { name: 'Calibri', size: 10, color: { argb: 'FFB91C1C' } };
            }
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `ITR_A_Inspection_Finding_${disc}_${todayStr.replace(/\s+/g, '_')}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Export Excel error:", err);
        alert("Failed to export Excel file: " + err.message);
    }
}

function printFlashReport() {
    if (!currentFilteredFlash || currentFilteredFlash.length === 0) {
        alert("No findings to print!");
        return;
    }

    const disc = document.getElementById('flash-filter-disc').value;
    const todayStr = formatDateDisplay(new Date());
    const nowTimeStr = new Date().toLocaleTimeString('en-GB');

    const printDoc = document.getElementById('flash-print-doc');
    if (!printDoc) {
        window.print();
        return;
    }

    let rowsHtml = '';
    currentFilteredFlash.forEach((item, idx) => {
        const isClosed = (item.status || 'Closed').toLowerCase() === 'closed';
        const statusBadgeClass = isClosed ? 'flash-print-status-closed' : 'flash-print-status-open';

        let respBoxClass = '';
        if (item.respType === 'green') respBoxClass = 'flash-print-resp-green';
        else if (item.respType === 'blue') respBoxClass = 'flash-print-resp-blue';
        else if (item.respType === 'red') respBoxClass = 'flash-print-resp-red';

        const imgHtml = item.img 
            ? `<img src="${item.img}" class="flash-print-img" alt="Illustration">`
            : '<span style="color:#94a3b8;">-</span>';

        rowsHtml += `
            <tr>
                <td style="text-align: center; font-weight: 700; width: 4%;">${idx + 1}</td>
                <td style="width: 20%; word-break: break-word;">
                    <div style="font-weight: 700; color: #0f172a;">${escapeHtml(item.tag || '')}</div>
                    ${item.desc ? `<div style="color: #475569; font-size: 8pt; margin-top: 2px;">${escapeHtml(item.desc)}</div>` : ''}
                    ${item.subsys ? `<div style="color: #0284c7; font-size: 7.5pt; font-weight: 600; margin-top: 2px;">Subsystem: ${escapeHtml(item.subsys)}</div>` : ''}
                </td>
                <td style="width: 25%; white-space: pre-wrap; word-break: break-word;">${escapeHtml(item.inspDesc || '-')}</td>
                <td style="width: 19%; color: #334155; white-space: pre-wrap; word-break: break-word;">${escapeHtml(item.note || '-')}</td>
                <td style="width: 15%; text-align: center;">${imgHtml}</td>
                <td style="width: 7%; text-align: center;">
                    <span class="flash-print-status ${statusBadgeClass}">${escapeHtml(item.status || 'Closed')}</span>
                </td>
                <td style="width: 20%; word-break: break-word;">
                    ${item.response ? `<div class="flash-print-resp-box ${respBoxClass}" style="white-space: pre-wrap;">${escapeHtml(item.response)}</div>` : '<span style="color:#94a3b8;">-</span>'}
                </td>
            </tr>
        `;
    });

    printDoc.innerHTML = `
        <div class="flash-print-header">
            <div style="display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 6px;">
                <div class="flash-print-title" style="margin: 0;">Report: ITR-A Inspection Finding</div>
                <div style="font-size: 8pt; color: #64748b; font-weight: 600;">BLOCK B LQP &bull; TOP-SECRET / INTERNAL USE</div>
            </div>
            
            <table class="flash-print-meta-table">
                <tr>
                    <td class="flash-print-meta-lbl">System / Equipment Tag:</td>
                    <td class="flash-print-meta-val">ITR-A Inspection</td>
                    <td class="flash-print-meta-lbl">Location:</td>
                    <td class="flash-print-meta-val">LQP Topside</td>
                </tr>
                <tr>
                    <td class="flash-print-meta-lbl">Updated Report Date:</td>
                    <td class="flash-print-meta-val">${todayStr}</td>
                    <td class="flash-print-meta-lbl">Discipline:</td>
                    <td class="flash-print-meta-val">${disc}</td>
                </tr>
            </table>

            <div class="flash-print-section-banner">Detail of Inspection</div>
        </div>

        <table class="flash-print-table">
            <thead>
                <tr>
                    <th style="width: 4%;">No</th>
                    <th style="width: 20%;">Tag</th>
                    <th style="width: 25%;">Inspection Description</th>
                    <th style="width: 19%;">Note</th>
                    <th style="width: 15%;">Illustration</th>
                    <th style="width: 7%;">Status</th>
                    <th style="width: 20%;">Response</th>
                </tr>
            </thead>
            <tbody>
                ${rowsHtml}
            </tbody>
        </table>

        <div class="flash-print-footer">
            <div>Block B LQP &bull; Mechanical Completion Management System</div>
            <div>Printed on: ${todayStr} ${nowTimeStr} &bull; Total Findings: ${currentFilteredFlash.length}</div>
        </div>
    `;

    // Trigger printing dialog
    window.print();
}


// =========================================================================
// ----------------- TAG PUNCH MATCHER (EXCEL AUTO-ENRICHMENT) -------------
// =========================================================================
let mapperFileBuffer = null;
let mapperFileName = '';
let mapperParsedWorkbook = null;
let mapperSheetDataMap = {};

function setupTagPunchMapperEvents() {
    const btnOpenNavbar = document.getElementById('btn-open-tag-mapper');
    const btnOpenPunchModal = document.getElementById('btn-punch-modal-mapper');
    const modal = document.getElementById('tag-punch-mapper-modal');
    const btnClose = document.getElementById('tag-mapper-close');
    const btnCancel = document.getElementById('btn-mapper-cancel');
    const dropzone = document.getElementById('mapper-dropzone');
    const fileInput = document.getElementById('mapper-file-input');
    const sheetSelect = document.getElementById('mapper-sheet-select');
    const tagColSelect = document.getElementById('mapper-tag-col-select');
    const btnProcess = document.getElementById('btn-mapper-process');

    if (btnOpenNavbar) btnOpenNavbar.addEventListener('click', openTagPunchMapperModal);
    if (btnOpenPunchModal) btnOpenPunchModal.addEventListener('click', openTagPunchMapperModal);
    if (btnClose) btnClose.addEventListener('click', closeTagPunchMapperModal);
    if (btnCancel) btnCancel.addEventListener('click', closeTagPunchMapperModal);

    if (modal) {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeTagPunchMapperModal();
        });
    }

    if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = '#0ea5e9';
            dropzone.style.background = 'rgba(14, 165, 233, 0.12)';
        });
        dropzone.addEventListener('dragleave', () => {
            dropzone.style.borderColor = 'rgba(56, 189, 248, 0.4)';
            dropzone.style.background = 'rgba(15, 23, 42, 0.6)';
        });
        dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'rgba(56, 189, 248, 0.4)';
            dropzone.style.background = 'rgba(15, 23, 42, 0.6)';
            if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                handleMapperFile(e.dataTransfer.files[0]);
            }
        });
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                handleMapperFile(e.target.files[0]);
            }
        });
    }

    if (sheetSelect) {
        sheetSelect.addEventListener('change', onMapperSheetChange);
    }

    if (tagColSelect) {
        tagColSelect.addEventListener('change', recalculateMapperStats);
    }

    if (btnProcess) {
        btnProcess.addEventListener('click', processAndDownloadMappedExcel);
    }
}

function openTagPunchMapperModal() {
    const modal = document.getElementById('tag-punch-mapper-modal');
    if (modal) modal.style.display = 'flex';
}
window.openTagPunchMapperModal = openTagPunchMapperModal;

function closeTagPunchMapperModal() {
    const modal = document.getElementById('tag-punch-mapper-modal');
    if (modal) modal.style.display = 'none';
}
window.closeTagPunchMapperModal = closeTagPunchMapperModal;

async function handleMapperFile(file) {
    if (!file) return;
    if (typeof ExcelJS === 'undefined') {
        alert("ExcelJS library is loading, please try again in a moment.");
        return;
    }

    mapperFileName = file.name;
    const dropName = document.getElementById('mapper-file-name');
    const dropInfo = document.getElementById('mapper-file-info');
    if (dropName) dropName.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
    if (dropInfo) dropInfo.textContent = "Analyzing worksheets and header structures...";

    try {
        const buffer = await file.arrayBuffer();
        mapperFileBuffer = buffer;

        const wb = new ExcelJS.Workbook();
        await wb.xlsx.load(buffer);
        mapperParsedWorkbook = wb;

        const sheetSelect = document.getElementById('mapper-sheet-select');
        const configCard = document.getElementById('mapper-config-card');
        const btnProcess = document.getElementById('btn-mapper-process');

        if (!sheetSelect || !configCard) return;

        sheetSelect.innerHTML = '';
        mapperSheetDataMap = {};

        const worksheets = wb.worksheets;
        if (!worksheets || worksheets.length === 0) {
            alert("No worksheets found in this Excel file.");
            return;
        }

        if (worksheets.length > 1) {
            sheetSelect.innerHTML += `<option value="__ALL__">All Sheets (Process all ${worksheets.length} Tabs)</option>`;
        }

        worksheets.forEach(ws => {
            sheetSelect.innerHTML += `<option value="${ws.name}">Tab: ${ws.name} (${ws.rowCount} rows)</option>`;
            analyzeSheetHeaders(ws);
        });

        configCard.style.display = 'flex';
        if (btnProcess) btnProcess.disabled = false;
        if (dropInfo) dropInfo.textContent = `Workbook loaded: ${worksheets.length} tab(s) detected. Original styling and formulas will be 100% preserved.`;

        onMapperSheetChange();
    } catch (err) {
        console.error("Error loading Excel tracker:", err);
        alert("Failed to load Excel file: " + err.message);
        if (dropInfo) dropInfo.textContent = "Error reading file. Please select a valid .xlsx or .xlsm file.";
    }
}

function analyzeSheetHeaders(ws) {
    let bestRowIdx = 1;
    let bestScore = -1;
    const tagKeywords = ['tag', 'tagno', 'tag no', 'tag number', 'equipment tag'];

    const maxScanRows = Math.min(ws.rowCount, 10);
    for (let r = 1; r <= maxScanRows; r++) {
        const row = ws.getRow(r);
        let nonNullCount = 0;
        let score = 0;
        let hasTag = false;

        row.eachCell({ includeEmpty: false }, (cell) => {
            const txt = cell.text ? cell.text.trim().toLowerCase() : (cell.value ? String(cell.value).trim().toLowerCase() : '');
            if (txt) {
                nonNullCount++;
                if (tagKeywords.some(tk => tk === txt || txt.includes(tk))) {
                    hasTag = true;
                    score += 60;
                }
                if (['subsystem', 'subsys', 'system', 'punch', 'status', 'discipline', 'description', 'type', 'checksheet'].some(k => txt.includes(k))) {
                    score += 15;
                }
            }
        });

        score += nonNullCount;
        if (hasTag) score += 100;

        if (score > bestScore) {
            bestScore = score;
            bestRowIdx = r;
        }
    }

    const headerRow = ws.getRow(bestRowIdx);
    const columns = [];
    let detectedTagCol = null;
    let detectedPunchCol = null;

    const colCount = Math.max(headerRow.cellCount, ws.columnCount, 15);
    for (let c = 1; c <= colCount; c++) {
        const cell = headerRow.getCell(c);
        const colLetter = getColumnLetter(c);
        let colName = cell.text ? cell.text.trim() : (cell.value ? String(cell.value).trim() : '');
        if (!colName) {
            let hasData = false;
            for (let r = bestRowIdx + 1; r <= Math.min(bestRowIdx + 5, ws.rowCount); r++) {
                const dc = ws.getRow(r).getCell(c);
                if (dc && (dc.value !== null && dc.value !== undefined && dc.value !== '')) {
                    hasData = true;
                    break;
                }
            }
            if (!hasData) continue;
            colName = `Column ${colLetter}`;
        }

        columns.push({
            idx: c,
            letter: colLetter,
            name: colName,
            label: `Col ${colLetter} (${c}): ${colName}`
        });

        const low = colName.toLowerCase();
        if (!detectedTagCol && tagKeywords.some(tk => low === tk || low.includes(tk))) {
            detectedTagCol = c;
        }
        if (!detectedPunchCol && ['punch', 'os&d', 'osd', 'fat punch'].some(pk => low.includes(pk))) {
            detectedPunchCol = c;
        }
    }

    mapperSheetDataMap[ws.name] = {
        headerRowIndex: bestRowIdx,
        columns: columns,
        tagColIdx: detectedTagCol || (columns.length >= 4 ? columns[3].idx : 1),
        punchColIdx: detectedPunchCol || 'NEW'
    };
}

function getColumnLetter(colIndex) {
    let temp = colIndex;
    let letter = '';
    while (temp > 0) {
        let mod = (temp - 1) % 26;
        letter = String.fromCharCode(65 + mod) + letter;
        temp = Math.floor((temp - mod) / 26);
    }
    return letter;
}

function onMapperSheetChange() {
    const sheetSelect = document.getElementById('mapper-sheet-select');
    const tagColSelect = document.getElementById('mapper-tag-col-select');
    const punchColSelect = document.getElementById('mapper-punch-col-select');
    if (!sheetSelect || !tagColSelect || !punchColSelect || !mapperParsedWorkbook) return;

    const selectedVal = sheetSelect.value;
    let refSheetName = selectedVal;
    if (selectedVal === '__ALL__') {
        refSheetName = mapperParsedWorkbook.worksheets[0].name;
    }

    const sheetInfo = mapperSheetDataMap[refSheetName];
    if (!sheetInfo) return;

    tagColSelect.innerHTML = '';
    sheetInfo.columns.forEach(col => {
        const isSelected = col.idx === sheetInfo.tagColIdx ? 'selected' : '';
        tagColSelect.innerHTML += `<option value="${col.idx}" ${isSelected}>${col.label}</option>`;
    });

    punchColSelect.innerHTML = '';
    sheetInfo.columns.forEach(col => {
        const isSelected = col.idx === sheetInfo.punchColIdx ? 'selected' : '';
        punchColSelect.innerHTML += `<option value="${col.idx}" ${isSelected}>${col.label}</option>`;
    });
    const isNewSelected = sheetInfo.punchColIdx === 'NEW' ? 'selected' : '';
    punchColSelect.innerHTML += `<option value="NEW" ${isNewSelected}>+ Append New Column: "OS&D, FAT Punch"</option>`;

    recalculateMapperStats();
}

function recalculateMapperStats() {
    const sheetSelect = document.getElementById('mapper-sheet-select');
    const tagColSelect = document.getElementById('mapper-tag-col-select');
    const statTagsEl = document.getElementById('mapper-stat-tags');
    const statMatchedEl = document.getElementById('mapper-stat-matched');
    if (!sheetSelect || !tagColSelect || !mapperParsedWorkbook) return;

    const gd = window.GLOBAL_MC_DATA;
    const punchList = gd ? (gd.globalPunchList || []) : [];

    const selectedVal = sheetSelect.value;
    const tagColIdx = parseInt(tagColSelect.value, 10);

    let targetSheets = [];
    if (selectedVal === '__ALL__') {
        targetSheets = mapperParsedWorkbook.worksheets;
    } else {
        const ws = mapperParsedWorkbook.getWorksheet(selectedVal);
        if (ws) targetSheets = [ws];
    }

    let totalTagsCount = 0;
    let matchedOpenCount = 0;

    targetSheets.forEach(ws => {
        const sheetInfo = mapperSheetDataMap[ws.name];
        const headerRowIdx = sheetInfo ? sheetInfo.headerRowIndex : 3;
        for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
            const cell = ws.getRow(r).getCell(tagColIdx);
            const tagVal = cell.text ? cell.text.trim() : (cell.value ? String(cell.value).trim() : '');
            if (tagVal && tagVal.length >= 2) {
                totalTagsCount++;
                const pInfo = lookupPunchForTag(tagVal, punchList);
                if (pInfo.open > 0) {
                    matchedOpenCount++;
                }
            }
        }
    });

    if (statTagsEl) statTagsEl.textContent = totalTagsCount.toLocaleString();
    if (statMatchedEl) statMatchedEl.textContent = matchedOpenCount.toLocaleString();
}

function lookupPunchForTag(tagVal, punchList) {
    if (!tagVal || !punchList || punchList.length === 0) {
        return { total: 0, open: 0, closed: 0, catA_open: 0, catB_open: 0 };
    }
    const tq = String(tagVal).trim().toLowerCase();
    if (!tq) {
        return { total: 0, open: 0, closed: 0, catA_open: 0, catB_open: 0 };
    }

    let matched = [];
    for (let i = 0; i < punchList.length; i++) {
        const p = punchList[i];
        if (!p.tag) continue;
        const ptag = String(p.tag).trim().toLowerCase();
        if (tq === ptag || tq.includes(ptag) || ptag.includes(tq)) {
            matched.push(p);
        }
    }

    let openCount = 0;
    let closedCount = 0;
    let catA_open = 0;
    let catB_open = 0;

    for (let i = 0; i < matched.length; i++) {
        const p = matched[i];
        const isClosed = p.status && p.status.toUpperCase().includes('CLOSE');
        if (isClosed) {
            closedCount++;
        } else {
            openCount++;
            if (p.cat === 'A') catA_open++;
            else if (p.cat === 'B') catB_open++;
        }
    }

    return {
        total: matched.length,
        open: openCount,
        closed: closedCount,
        catA_open: catA_open,
        catB_open: catB_open
    };
}

async function processAndDownloadMappedExcel() {
    if (!mapperFileBuffer) {
        alert("Please upload an Excel tracker file first.");
        return;
    }
    if (typeof ExcelJS === 'undefined') {
        alert("ExcelJS library is not ready.");
        return;
    }

    const gd = window.GLOBAL_MC_DATA;
    const punchList = gd ? (gd.globalPunchList || []) : [];
    if (punchList.length === 0) {
        alert("No punch list data loaded in dashboard.");
        return;
    }

    const sheetSelect = document.getElementById('mapper-sheet-select');
    const tagColSelect = document.getElementById('mapper-tag-col-select');
    const punchColSelect = document.getElementById('mapper-punch-col-select');
    const styleSelect = document.getElementById('mapper-style-select');
    const btnProcess = document.getElementById('btn-mapper-process');

    const selectedSheetVal = sheetSelect.value;
    const tagColIdx = parseInt(tagColSelect.value, 10);
    const punchColVal = punchColSelect.value;
    const outputStyle = styleSelect ? styleSelect.value : 'status_count';

    if (btnProcess) {
        btnProcess.disabled = true;
        btnProcess.textContent = "Processing & Preserving Formatting...";
    }

    try {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(mapperFileBuffer);

        let targetSheets = [];
        if (selectedSheetVal === '__ALL__') {
            targetSheets = workbook.worksheets;
        } else {
            const ws = workbook.getWorksheet(selectedSheetVal);
            if (ws) targetSheets = [ws];
        }

        let totalProcessed = 0;
        let totalTagsEnriched = 0;

        targetSheets.forEach(ws => {
            const sheetInfo = mapperSheetDataMap[ws.name] || {};
            const headerRowIdx = sheetInfo.headerRowIndex || 3;

            let targetPunchColIdx = 0;
            if (punchColVal === 'NEW') {
                targetPunchColIdx = ws.columnCount + 1;
                const headerCell = ws.getRow(headerRowIdx).getCell(targetPunchColIdx);
                headerCell.value = "OS&D, FAT Punch";
                headerCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FF0F172A' } };
                headerCell.alignment = { vertical: 'middle', horizontal: 'center' };
                headerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
                headerCell.border = {
                    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
                };
                ws.getColumn(targetPunchColIdx).width = 18;
            } else {
                targetPunchColIdx = parseInt(punchColVal, 10);
            }

            for (let r = headerRowIdx + 1; r <= ws.rowCount; r++) {
                const row = ws.getRow(r);
                const tagCell = row.getCell(tagColIdx);
                const tagVal = tagCell.text ? tagCell.text.trim() : (tagCell.value ? String(tagCell.value).trim() : '');

                if (tagVal && tagVal.length >= 2) {
                    totalProcessed++;
                    const pInfo = lookupPunchForTag(tagVal, punchList);

                    let resultStr = "";
                    let isOngoing = pInfo.open > 0;

                    if (outputStyle === 'status_count') {
                        resultStr = isOngoing ? `Ongoing (${pInfo.open} Open)` : "N/A";
                    } else if (outputStyle === 'detailed') {
                        resultStr = isOngoing ? `${pInfo.open} Open (A: ${pInfo.catA_open}, B: ${pInfo.catB_open})` : "N/A";
                    } else if (outputStyle === 'number_only') {
                        resultStr = pInfo.open;
                    } else if (outputStyle === 'status_only') {
                        resultStr = isOngoing ? "Ongoing" : "N/A";
                    }

                    if (isOngoing) totalTagsEnriched++;

                    const punchCell = row.getCell(targetPunchColIdx);
                    punchCell.value = resultStr;
                    punchCell.alignment = { vertical: 'middle', horizontal: 'center' };

                    if (!punchCell.border || !punchCell.border.top) {
                        punchCell.border = {
                            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
                        };
                    }
                }
            }
        });

        const outBuffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([outBuffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;

        const baseCleanName = mapperFileName.replace(/\.[^/.]+$/, "");
        a.download = `${baseCleanName}_Punch_Mapped.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert(`Processing complete!\n\nEnriched ${totalProcessed} rows across ${targetSheets.length} sheet(s).\nFound ${totalTagsEnriched} tags with Open Punches.\n\nFile saved as: ${baseCleanName}_Punch_Mapped.xlsx`);
        closeTagPunchMapperModal();
    } catch (err) {
        console.error("Error processing workbook:", err);
        alert("Failed to process Excel workbook: " + err.message);
    } finally {
        if (btnProcess) {
            btnProcess.disabled = false;
            btnProcess.textContent = "🚀 Process & Download Updated Excel";
        }
    }
}


// ==========================================
// Equipment Punches Monitoring Module
// ==========================================

const DEFAULT_MASTER_EQUIPMENTS = [
    {
        "no": 1,
        "masterTag": "CLQU-T-5801A",
        "equipName": "Potable Water Storage Tank",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 2,
        "masterTag": "CLQU-T-5801B",
        "equipName": "Potable Water Storage Tank",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 3,
        "masterTag": "CLQU-T-5802",
        "equipName": "Washdown Water Storage Tank",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 4,
        "masterTag": "CLQU-PK-5803",
        "equipName": "UV Package",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 5,
        "masterTag": "CLQU-T-4501",
        "equipName": "Utility Open Drain Tank",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 6,
        "masterTag": "CLQU-PK-5501",
        "equipName": "Sewage Treatment Unit 1",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 7,
        "masterTag": "CLQU-T-5501-05",
        "equipName": "DECLORINATION_TANK-1",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 8,
        "masterTag": "CLQU-PK-5502",
        "equipName": "Sewage Treatment Unit 2",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 9,
        "masterTag": "CLQU-T-5502-05",
        "equipName": "DECLORINATION TANK-2",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 10,
        "masterTag": "CLQU-T-5501-06",
        "equipName": "Sewage Collection Tank",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 11,
        "masterTag": "CLQU-P-5501A",
        "equipName": "Sewage Transfer Pump A",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 12,
        "masterTag": "CLQU-P-5501B",
        "equipName": "Sewage Transfer Pump B",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 13,
        "masterTag": "CLQU-P-4701",
        "equipName": "Hydrocarbon Sump Pump",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 14,
        "masterTag": "CLQU-P-5803A",
        "equipName": "Potable  Water  Pump 1",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 15,
        "masterTag": "CLQU-P-5803B",
        "equipName": "Potable  Water  Pump 2",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 16,
        "masterTag": "CLQU-P-4702",
        "equipName": "Portable Hydrocarbon Pump",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 17,
        "masterTag": "CLQU-P-5804",
        "equipName": "Washdown Water Booster Pump",
        "deckArea": "Sub-Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 18,
        "masterTag": "CLQU-PK-8001",
        "equipName": "Diesel Firewater Pump Package",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 19,
        "masterTag": "CLQU-PK-8002",
        "equipName": "Starting Air Receiver Package",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 20,
        "masterTag": "CLQU-PK-5101",
        "equipName": "Utility Air Compressor Package",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 21,
        "masterTag": "CLQU-V-5102",
        "equipName": "Utility Air Receiver",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 22,
        "masterTag": "CLQU-PK-5001",
        "equipName": "Instrument Air Dryer Package",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 23,
        "masterTag": "CLQU-V-5001",
        "equipName": "Instrument Air Receiver",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 24,
        "masterTag": "CLQU-PK-6101",
        "equipName": "Emergency Diesel Generator Package (Incl.Water Mist System)",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 25,
        "masterTag": "CLQU-PTR-6501",
        "equipName": "Transformer",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 26,
        "masterTag": "CLQU-PTR-6502",
        "equipName": "Transformer",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 27,
        "masterTag": "CLQU-P-5701A",
        "equipName": "Service Water Pump (Filter)",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 28,
        "masterTag": "CLQU-P-5701B",
        "equipName": "Service Water Pump (Filter)",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 29,
        "masterTag": "CLQU-F-5701A",
        "equipName": "Service  Water  Filter",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 30,
        "masterTag": "CLQU-F-5701B",
        "equipName": "Service  Water  Filter",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 31,
        "masterTag": "CLQU-HAH-9003A",
        "equipName": "Air Handling Unit-2",
        "deckArea": "Mezzanine Deck",
        "module": "CLQU"
    },
    {
        "no": 32,
        "masterTag": "CLQU-HAH-9003B",
        "equipName": "Air Handling Unit-1",
        "deckArea": "Mezzanine Deck",
        "module": "CLQU"
    },
    {
        "no": 33,
        "masterTag": "CLQU-PK-5902",
        "equipName": "Jet Fuel System",
        "deckArea": "Mezzanine Deck",
        "module": "CLQU"
    },
    {
        "no": 34,
        "masterTag": "CLQU-HCW-9001A",
        "equipName": "Chiller Unit-2",
        "deckArea": "Mezzanine Deck",
        "module": "CLQU"
    },
    {
        "no": 35,
        "masterTag": "CLQU-HCW-9001B",
        "equipName": "Chiller Unit-1",
        "deckArea": "Mezzanine Deck",
        "module": "CLQU"
    },
    {
        "no": 36,
        "masterTag": "CLQU-HCW-9001B",
        "equipName": "Chw Bufer Tank",
        "deckArea": "Mezzanine Deck",
        "module": "CLQU"
    },
    {
        "no": 37,
        "masterTag": "CLQU-CR-9101",
        "equipName": "Adaptor Pedestal",
        "deckArea": "Upper Deck",
        "module": "CLQU"
    },
    {
        "no": 38,
        "masterTag": "CLQU-CR-9101",
        "equipName": "Pedestal Crane",
        "deckArea": "Upper Deck",
        "module": "CLQU"
    },
    {
        "no": 39,
        "masterTag": "CLQU-RSC-8601",
        "equipName": "Survival Craft (90 Man) With Launch/Retrieval Davit",
        "deckArea": "Upper Deck",
        "module": "CLQU"
    },
    {
        "no": 40,
        "masterTag": "CLQU-RSD-8601",
        "equipName": "Retrieval Davit",
        "deckArea": "Upper Deck",
        "module": "CLQU"
    },
    {
        "no": 41,
        "masterTag": "CLQU-RSC-8602",
        "equipName": "Survival Craft (90 Man) With Launch/Retrieval Davit",
        "deckArea": "Upper Deck",
        "module": "CLQU"
    },
    {
        "no": 42,
        "masterTag": "CLQU-RSD-8602",
        "equipName": "Retrieval Davit",
        "deckArea": "Upper Deck",
        "module": "CLQU"
    },
    {
        "no": 43,
        "masterTag": "CLQU-PK-5802",
        "equipName": "Potable Water Maker Package No.2",
        "deckArea": "Upper Deck",
        "module": "CLQU"
    },
    {
        "no": 44,
        "masterTag": "CLQU-PK-5801",
        "equipName": "Potable Water Maker Package No.1",
        "deckArea": "Upper Deck",
        "module": "CLQU"
    },
    {
        "no": 47,
        "masterTag": "CLQU-CRB-9102",
        "equipName": "Bridge Crane",
        "deckArea": "Cellar Deck",
        "module": "CLQU"
    },
    {
        "no": 51,
        "masterTag": "CLQM-HAH-9002A",
        "equipName": "Air Handling Unit (Duty)",
        "deckArea": "ROOF",
        "module": "CLQM"
    },
    {
        "no": 52,
        "masterTag": "CLQM-HAH-9002B",
        "equipName": "Air Handling Unit  (Standby)",
        "deckArea": "ROOF",
        "module": "CLQM"
    },
    {
        "no": 53,
        "masterTag": "CLQM-PK-5901",
        "equipName": "Aviation Fuel Dispensation Package",
        "deckArea": "HELI DECK",
        "module": "CLQM"
    },
    {
        "no": 54,
        "masterTag": "CLQM-PK-4901",
        "equipName": "Hot Water Calorifier Skid Package",
        "deckArea": "ROOF",
        "module": "CLQM"
    },
    {
        "no": 55,
        "masterTag": "CLQM-PK-8101",
        "equipName": "Diffs Package (Deck Integrated Fire Fighthing System) Lqu-P66",
        "deckArea": "ROOF",
        "module": "CLQM"
    }
];

let currentMasterEquipments = [...DEFAULT_MASTER_EQUIPMENTS];
let currentEquipPunchFilterDeck = 'ALL';
let currentEquipPunchFilterModule = 'ALL';
let currentEquipPunchFilterStatus = 'ALL';
let currentEquipPunchSearch = '';
let currentEquipPunchPkgSearch = '';
let currentSelectedEquipData = null;
let currentModalPunchStatusFilter = 'ALL';
let currentModalPunchSearch = '';
let currentModalPunchPkgSearch = '';
let lastCalculatedEquipSummary = [];

function matchPunchesForEquipments(equips, punches) {
    if (!equips || equips.length === 0) return [];
    const punchList = punches || [];

    // Group punches by master equipment using the exact same attribution engine (Single Source of Truth)
    const punchMap = new Map();
    const packageMap = new Map();
    equips.forEach(me => {
        const key = String(me.masterTag || '').trim().toUpperCase();
        if (!punchMap.has(key)) {
            punchMap.set(key, []);
        }
    });

    punchList.forEach(p => {
        let rawTag = p.tag || 'NO_TAG';
        const cmsTag = String(rawTag).trim().replace(/\r?\n|\r/g, ' ');
        if (!cmsTag) return;

        const me = findMasterEquipmentForPunch(cmsTag, p.pkgName, p.tagDesc || p.desc);
        if (me) {
            const key = String(me.masterTag || '').trim().toUpperCase();
            if (punchMap.has(key)) {
                punchMap.get(key).push(p);
                if (!packageMap.has(key) && p.pkgName) {
                    packageMap.set(key, p.pkgName);
                }
            }
        }
    });

    return equips.map(me => {
        const key = String(me.masterTag || '').trim().toUpperCase();
        const matched = punchMap.get(key) || [];

        // Deduplicate punches by punchNo (or tag + desc)
        const uniqueMap = new Map();
        matched.forEach(p => {
            const punchKey = p.punchNo || `${p.tag}_${p.desc}`;
            if (!uniqueMap.has(punchKey)) {
                uniqueMap.set(punchKey, p);
            }
        });
        const uniquePunches = Array.from(uniqueMap.values());

        const total = uniquePunches.length;
        const open = uniquePunches.filter(p => !String(p.status || '').toUpperCase().includes('CLOSE')).length;
        const closed = total - open;
        const pct = total > 0 ? Math.round((closed / total) * 100) : null;
        const catA = uniquePunches.filter(p => !String(p.status || '').toUpperCase().includes('CLOSE') && String(p.cat || '').toUpperCase().includes('A')).length;
        const catB = uniquePunches.filter(p => !String(p.status || '').toUpperCase().includes('CLOSE') && String(p.cat || '').toUpperCase().includes('B')).length;
        const catC = uniquePunches.filter(p => !String(p.status || '').toUpperCase().includes('CLOSE') && String(p.cat || '').toUpperCase().includes('C')).length;

        let statusType = 'NA';
        if (total > 0) {
            statusType = open === 0 ? 'CLEARED' : 'IN_PROGRESS';
        }

        return {
            no: me.no,
            masterTag: me.masterTag,
            equipName: me.equipName,
            deckArea: me.deckArea || 'N/A',
            module: me.module || 'N/A',
            cmsPackage: packageMap.get(key) || '-',
            total: total,
            open: open,
            closed: closed,
            pct: pct,
            catA: catA,
            catB: catB,
            catC: catC,
            statusType: statusType,
            punches: uniquePunches
        };
    });
}

function populateEquipmentFilters(summaryData) {
    const deckSelect = document.getElementById('ep-filter-deck');
    const modSelect = document.getElementById('ep-filter-module');
    if (!deckSelect || !modSelect) return;

    if (deckSelect.options.length <= 1) {
        const decks = Array.from(new Set(summaryData.map(e => e.deckArea).filter(Boolean))).sort();
        decks.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d;
            opt.textContent = d;
            deckSelect.appendChild(opt);
        });
    }

    if (modSelect.options.length <= 1) {
        const mods = Array.from(new Set(summaryData.map(e => e.module).filter(Boolean))).sort();
        mods.forEach(m => {
            const opt = document.createElement('option');
            opt.value = m;
            opt.textContent = m;
            modSelect.appendChild(opt);
        });
    }
}

function renderEquipmentSummaryTable() {
    const gd = window.GLOBAL_MC_DATA;
    const punchList = gd ? (gd.globalPunchList || []) : [];

    lastCalculatedEquipSummary = matchPunchesForEquipments(currentMasterEquipments, punchList);

    // Update Top Metric Cards
    const statTotal = document.getElementById('ep-stat-total-equips');
    const statWithOpen = document.getElementById('ep-stat-with-open');
    const statCleared = document.getElementById('ep-stat-cleared');
    const statNa = document.getElementById('ep-stat-na');
    const statTotalPunches = document.getElementById('ep-stat-total-punches');

    const totalEquips = lastCalculatedEquipSummary.length;
    const withOpenCount = lastCalculatedEquipSummary.filter(e => e.open > 0).length;
    const clearedCount = lastCalculatedEquipSummary.filter(e => e.total > 0 && e.open === 0).length;
    const naCount = lastCalculatedEquipSummary.filter(e => e.total === 0).length;
    const allUniquePunchNos = new Set();
    lastCalculatedEquipSummary.forEach(e => {
        e.punches.forEach(p => {
            if (p.punchNo) allUniquePunchNos.add(p.punchNo);
        });
    });

    if (statTotal) statTotal.textContent = totalEquips;
    if (statWithOpen) statWithOpen.textContent = withOpenCount;
    if (statCleared) statCleared.textContent = clearedCount;
    if (statNa) statNa.textContent = naCount;
    if (statTotalPunches) statTotalPunches.textContent = allUniquePunchNos.size;

    populateEquipmentFilters(lastCalculatedEquipSummary);

    // Apply Filter State
    let filtered = lastCalculatedEquipSummary.filter(e => {
        if (currentEquipPunchFilterDeck !== 'ALL' && e.deckArea !== currentEquipPunchFilterDeck) {
            return false;
        }
        if (currentEquipPunchFilterModule !== 'ALL' && e.module !== currentEquipPunchFilterModule) {
            return false;
        }
        if (currentEquipPunchFilterStatus === 'WITH_OPEN' && e.open === 0) {
            return false;
        }
        if (currentEquipPunchFilterStatus === 'CLEARED' && (e.total === 0 || e.open > 0)) {
            return false;
        }
        if (currentEquipPunchFilterStatus === 'NA' && e.total > 0) {
            return false;
        }
        if (currentEquipPunchSearch) {
            const q = currentEquipPunchSearch.toLowerCase();
            const tagMatch = e.masterTag.toLowerCase().includes(q);
            const nameMatch = e.equipName.toLowerCase().includes(q);
            const pkgMatch = e.cmsPackage.toLowerCase().includes(q);
            if (!tagMatch && !nameMatch && !pkgMatch) return false;
        }
        if (currentEquipPunchPkgSearch) {
            const pq = currentEquipPunchPkgSearch.toLowerCase().trim();
            const pkgMatch = (e.cmsPackage && e.cmsPackage.toLowerCase().includes(pq)) ||
                             (e.punches && e.punches.some(p => p.pkgName && p.pkgName.toLowerCase().includes(pq)));
            if (!pkgMatch) return false;
        }
        return true;
    });

    const tbody = document.getElementById('ep-summary-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 2rem; color: #94a3b8;">No matching equipments found.</td></tr>`;
        return;
    }

    filtered.forEach(item => {
        const tr = document.createElement('tr');
        tr.style.cursor = 'pointer';
        tr.style.transition = 'background 0.15s ease';
        tr.addEventListener('mouseenter', () => tr.style.background = 'rgba(255, 255, 255, 0.04)');
        tr.addEventListener('mouseleave', () => tr.style.background = 'transparent');
        tr.addEventListener('click', (ev) => {
            openEquipmentDetailModal(item);
        });

        // Progress bar html
        let progressHtml = `<span style="color: #64748b; font-size: 0.75rem;">N/A</span>`;
        if (item.total > 0) {
            const barColor = item.pct === 100 ? '#10b981' : (item.pct > 50 ? '#38bdf8' : '#f59e0b');
            progressHtml = `
                <div style="display: flex; align-items: center; gap: 0.5rem; justify-content: center;">
                    <div style="width: 48px; height: 6px; background: rgba(255,255,255,0.1); border-radius: 3px; overflow: hidden;">
                        <div style="width: ${item.pct}%; height: 100%; background: ${barColor};"></div>
                    </div>
                    <span style="font-size: 0.75rem; font-weight: 700; color: ${barColor}; font-family: monospace;">${item.pct}%</span>
                </div>
            `;
        }

        const openHtml = item.open > 0 
            ? `<span style="display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 0.75rem; font-weight: 800; background: rgba(239, 68, 68, 0.2); color: #f87171; font-family: monospace;">${item.open}</span>`
            : `<span style="color: #64748b; font-family: monospace;">0</span>`;

        const closedHtml = item.closed > 0
            ? `<span style="display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 0.75rem; font-weight: 800; background: rgba(16, 185, 129, 0.2); color: #34d399; font-family: monospace;">${item.closed}</span>`
            : `<span style="color: #64748b; font-family: monospace;">0</span>`;

        const catHtml = (item.catA > 0 || item.catB > 0 || item.catC > 0)
            ? `<span style="font-size: 0.75rem; font-weight: 700; font-family: monospace;"><span style="color: #f87171;">A:${item.catA}</span> | <span style="color: #fbbf24;">B:${item.catB}</span> | <span style="color: #38bdf8;">C:${item.catC || 0}</span></span>`
            : `<span style="color: #64748b; font-size: 0.75rem; font-family: monospace;">-</span>`;

        tr.innerHTML = `
            <td style="text-align: center; color: #64748b; font-size: 0.75rem;">${item.no}</td>
            <td style="text-align: center; font-family: monospace; font-weight: 700; color: #38bdf8;">${item.masterTag}</td>
            <td style="text-align: left; font-weight: 600; color: #f8fafc;">${item.equipName}</td>
            <td style="text-align: center; color: #cbd5e1; font-size: 0.8rem;">${item.deckArea}</td>
            <td style="text-align: center; color: #cbd5e1; font-size: 0.8rem;">${item.module}</td>
            <td style="text-align: left; color: #94a3b8; font-size: 0.75rem; max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.cmsPackage}">${item.cmsPackage}</td>
            <td style="text-align: center; font-weight: 700; color: #f8fafc; font-family: monospace;">${item.total}</td>
            <td style="text-align: center;">${openHtml}</td>
            <td style="text-align: center;">${closedHtml}</td>
            <td style="text-align: center;">${progressHtml}</td>
            <td style="text-align: center;">${catHtml}</td>
            <td style="text-align: center;">
                <button type="button" class="btn-detail-view" style="padding: 0.25rem 0.6rem; font-size: 0.72rem; font-weight: 600; border: 1px solid rgba(56, 189, 248, 0.4); background: rgba(56, 189, 248, 0.1); color: #38bdf8; border-radius: 4px; cursor: pointer;">
                    View (${item.total})
                </button>
            </td>
        `;

        tbody.appendChild(tr);
    });
}

function openEquipmentDetailModal(item) {
    currentSelectedEquipData = item;
    currentModalPunchStatusFilter = 'ALL';
    currentModalPunchSearch = '';
    currentModalPunchPkgSearch = '';
    const modalPkgSearchInp = document.getElementById('ep-detail-pkg-search-input');
    if (modalPkgSearchInp) modalPkgSearchInp.value = '';

    const modal = document.getElementById('equip-punch-modal');
    if (!modal) return;

    const title = document.getElementById('ep-modal-title');
    const subtitle = document.getElementById('ep-modal-subtitle');
    if (title) {
        title.innerHTML = `
            <span style="color: #38bdf8; font-family: monospace;">${item.masterTag}</span>
            <span style="color: #cbd5e1; font-weight: 400; margin: 0 4px;">-</span>
            <span>${item.equipName}</span>
        `;
    }
    if (subtitle) {
        subtitle.innerHTML = `Deck Area: <b style="color: #f8fafc;">${item.deckArea}</b> &nbsp;|&nbsp; Module: <b style="color: #f8fafc;">${item.module}</b> &nbsp;|&nbsp; CMS Package: <b style="color: #f8fafc;">${item.cmsPackage}</b>`;
    }

    const btnAll = document.getElementById('ep-detail-filter-all');
    const btnOpen = document.getElementById('ep-detail-filter-open');
    const btnClosed = document.getElementById('ep-detail-filter-closed');

    if (btnAll) btnAll.textContent = `All (${item.total})`;
    if (btnOpen) btnOpen.textContent = `Open (${item.open})`;
    if (btnClosed) btnClosed.textContent = `Closed (${item.closed})`;

    const searchInput = document.getElementById('ep-detail-search-input');
    if (searchInput) searchInput.value = '';

    updateModalTabButtons();
    renderEquipmentDetailTable();

    modal.style.display = 'flex';
}

function closeEquipmentDetailModal() {
    const modal = document.getElementById('equip-punch-modal');
    if (modal) modal.style.display = 'none';
}

function updateModalTabButtons() {
    const btnAll = document.getElementById('ep-detail-filter-all');
    const btnOpen = document.getElementById('ep-detail-filter-open');
    const btnClosed = document.getElementById('ep-detail-filter-closed');

    if (btnAll) {
        btnAll.style.background = currentModalPunchStatusFilter === 'ALL' ? '#0ea5e9' : '#fff';
        btnAll.style.color = currentModalPunchStatusFilter === 'ALL' ? '#fff' : '#0f172a';
    }
    if (btnOpen) {
        btnOpen.style.background = currentModalPunchStatusFilter === 'OPEN' ? '#ef4444' : '#fff';
        btnOpen.style.color = currentModalPunchStatusFilter === 'OPEN' ? '#fff' : '#ef4444';
    }
    if (btnClosed) {
        btnClosed.style.background = currentModalPunchStatusFilter === 'CLOSED' ? '#10b981' : '#fff';
        btnClosed.style.color = currentModalPunchStatusFilter === 'CLOSED' ? '#fff' : '#10b981';
    }
}

function renderEquipmentDetailTable() {
    if (!currentSelectedEquipData) return;
    const tbody = document.getElementById('ep-detail-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    let list = currentSelectedEquipData.punches || [];

    if (currentModalPunchStatusFilter === 'OPEN') {
        list = list.filter(p => !String(p.status || '').toUpperCase().includes('CLOSE'));
    } else if (currentModalPunchStatusFilter === 'CLOSED') {
        list = list.filter(p => String(p.status || '').toUpperCase().includes('CLOSE'));
    }

    if (currentModalPunchSearch) {
        const q = currentModalPunchSearch.toLowerCase();
        list = list.filter(p => {
            return (p.punchNo && p.punchNo.toLowerCase().includes(q)) ||
                   (p.tag && p.tag.toLowerCase().includes(q)) ||
                   (p.desc && p.desc.toLowerCase().includes(q)) ||
                   (p.actionBy && p.actionBy.toLowerCase().includes(q)) ||
                   (p.subsys && p.subsys.toLowerCase().includes(q)) ||
                   (p.pkgName && p.pkgName.toLowerCase().includes(q));
        });
    }

    if (currentModalPunchPkgSearch) {
        const pq = currentModalPunchPkgSearch.toLowerCase().trim();
        list = list.filter(p => p.pkgName && p.pkgName.toLowerCase().includes(pq));
    }

    if (currentModalPunchSearch) {
        const q = currentModalPunchSearch.toLowerCase();
        list = list.filter(p => {
            return (p.punchNo && p.punchNo.toLowerCase().includes(q)) ||
                   (p.tag && p.tag.toLowerCase().includes(q)) ||
                   (p.desc && p.desc.toLowerCase().includes(q)) ||
                   (p.actionBy && p.actionBy.toLowerCase().includes(q)) ||
                   (p.subsys && p.subsys.toLowerCase().includes(q)) ||
                   (p.pkgName && p.pkgName.toLowerCase().includes(q));
        });
    }
    if (currentModalPunchPkgSearch) {
        const pq = currentModalPunchPkgSearch.toLowerCase().trim();
        list = list.filter(p => p.pkgName && p.pkgName.toLowerCase().includes(pq));
    }

    if (currentModalPunchSearch) {
        const q = currentModalPunchSearch.toLowerCase();
        list = list.filter(p => {
            return (p.punchNo && p.punchNo.toLowerCase().includes(q)) ||
                   (p.tag && p.tag.toLowerCase().includes(q)) ||
                   (p.desc && p.desc.toLowerCase().includes(q)) ||
                   (p.actionBy && p.actionBy.toLowerCase().includes(q)) ||
                   (p.subsys && p.subsys.toLowerCase().includes(q)) ||
                   (p.pkgName && p.pkgName.toLowerCase().includes(q));
        });
    }

    if (currentModalPunchPkgSearch) {
        const pq = currentModalPunchPkgSearch.toLowerCase().trim();
        list = list.filter(p => p.pkgName && p.pkgName.toLowerCase().includes(pq));
    }

    if (list.length === 0) {
        tbody.innerHTML = `<tr><td colspan="17" style="text-align: center; padding: 2.5rem; color: #94a3b8;">No punch items match current filter.</td></tr>`;
        return;
    }

    list.forEach((p, idx) => {
        const tr = document.createElement('tr');
        tr.style.background = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        tr.style.borderBottom = '1px solid #e2e8f0';

        const isClosed = String(p.status || '').toUpperCase().includes('CLOSE');
        const statusBadge = isClosed
            ? `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #dcfce7; color: #15803d; border: 1px solid #86efac;">CLOSED</span>`
            : `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;">OPEN</span>`;

        const isCatA = String(p.cat || '').includes('A');
        const isCatC = String(p.cat || '').includes('C');
        let catBadge = '';
        if (isCatA) {
            catBadge = `<span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;">Cat A</span>`;
        } else if (isCatC) {
            catBadge = `<span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #f1f5f9; color: #475569; border: 1px solid #cbd5e1;">Cat C</span>`;
        } else if (p.cat) {
            catBadge = `<span style="display: inline-block; padding: 2px 6px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #fef3c7; color: #b45309; border: 1px solid #fcd34d;">Cat ${p.cat}</span>`;
        } else {
            catBadge = '<span style="color: #64748b;">-</span>';
        }

        const siteBadge = p.isSiteWalkdown
            ? `<span style="display:inline-block; font-size: 0.65rem; font-weight: 800; background: #0284c7; color: #fff; padding: 1px 5px; border-radius: 3px; margin-left: 4px; vertical-align: middle;" title="Site Walkdown Finding (Pending CMS)">Site</span>`
            : '';

        tr.innerHTML = `
            <td style="text-align: center; color: #475569; font-size: 0.8rem; font-weight: 600;">${idx + 1}</td>
            <td style="text-align: center; font-family: Consolas, monospace; font-weight: 700; color: #0284c7; background: #f0f9ff; font-size: 0.82rem;">${currentSelectedEquipData.masterTag}</td>
            <td style="text-align: left; font-weight: 700; color: #0f172a; font-size: 0.82rem; background: #f0f9ff;">${currentSelectedEquipData.equipName}</td>
            <td style="text-align: center; font-family: Consolas, monospace; font-weight: 700; color: #0f172a; font-size: 0.82rem;">${p.tag || '-'}</td>
            <td style="text-align: center; font-family: Consolas, monospace; font-weight: 800; color: #0284c7; font-size: 0.82rem;">${p.punchNo || '-'}${siteBadge}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.8rem;">${p.sys || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.8rem;">${p.subsys || '-'}</td>
            <td style="text-align: left; color: #334155; font-size: 0.78rem; font-weight: 500; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${p.pkgName || ''}">${p.pkgName || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.78rem;">${p.disc || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.78rem;">${p.phase || '-'}</td>
            <td style="text-align: center;">${catBadge}</td>
            <td style="text-align: center;">${statusBadge}</td>
            <td style="text-align: left; color: #0f172a; font-weight: 600; font-size: 0.82rem; line-height: 1.45; min-width: 250px;">${p.desc || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.8rem;">${p.actionBy || '-'}</td>
            <td style="text-align: center; color: #334155; font-size: 0.78rem; font-family: Consolas, monospace; font-weight: 600;">${formatDateDisplay(p.openDate)}</td>
            <td style="text-align: center; color: #334155; font-size: 0.78rem; font-family: Consolas, monospace; font-weight: 600;">${formatDateDisplay(p.closeDate)}</td>
            <td style="text-align: center; color: #334155; font-size: 0.78rem; font-family: Consolas, monospace; font-weight: 600;">${formatDateDisplay(p.expDate)}</td>
        `;

        tbody.appendChild(tr);
    });
}

async function exportEquipmentSummaryToExcel() {
    // Generate Master Multi-Sheet Excel report (Sheet 1: Major Equipment Summary, Sheet 2: Component Breakdown)
    await exportMultiSheetMasterReport();
}

async function exportMultiSheetMasterReport() {
    if (!lastCalculatedEquipSummary || lastCalculatedEquipSummary.length === 0) {
        const gd = window.GLOBAL_MC_DATA;
        const punchList = gd ? (gd.globalPunchList || []) : [];
        if (currentMasterEquipments && currentMasterEquipments.length > 0 && punchList.length > 0) {
            lastCalculatedEquipSummary = matchPunchesForEquipments(currentMasterEquipments, punchList);
        }
    }

    if (!lastCalculatedEquipSummary || lastCalculatedEquipSummary.length === 0) {
        alert("No equipment punch summary data to export.");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Block B LQP Mechanical Completion";
        workbook.created = new Date();

        const headerBorder = {
            top: { style: 'thin', color: { argb: 'FF0F172A' } },
            left: { style: 'thin', color: { argb: 'FF0F172A' } },
            bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
            right: { style: 'thin', color: { argb: 'FF0F172A' } }
        };

        const cellBorder = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        // ==========================================
        // SHEET 1: Major Equipment Summary (1 Tag = 1 Row)
        // ==========================================
        const ws1 = workbook.addWorksheet("Equipment Summary", {
            views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
        });
        ws1.autoFilter = 'A1:M1';

        ws1.columns = [
            { header: '#', key: 'no', width: 6 },
            { header: 'TAG NO', key: 'masterTag', width: 22 },
            { header: 'EQUIPMENT NAME', key: 'equipName', width: 36 },
            { header: 'DECK AREA', key: 'deckArea', width: 20 },
            { header: 'MODULE', key: 'module', width: 12 },
            { header: 'PACKAGE NAME', key: 'cmsPackage', width: 34 },
            { header: 'TOTAL PUNCHES', key: 'total', width: 16 },
            { header: 'OPEN PUNCHES', key: 'open', width: 16 },
            { header: 'CLOSED PUNCHES', key: 'closed', width: 16 },
            { header: '% CLOSED', key: 'pct', width: 14 },
            { header: 'CAT A (OPEN)', key: 'catA', width: 15 },
            { header: 'CAT B (OPEN)', key: 'catB', width: 15 },
            { header: 'STATUS', key: 'status', width: 18 }
        ];

        const headerRow1 = ws1.getRow(1);
        headerRow1.height = 28;
        headerRow1.eachCell((cell) => {
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1E293B' } // Navy Dark Slate
            };
            cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = headerBorder;
        });

        let exportEquips = lastCalculatedEquipSummary;
        if (currentEquipPunchPkgSearch) {
            const pq = currentEquipPunchPkgSearch.toLowerCase().trim();
            exportEquips = exportEquips.filter(e => (e.cmsPackage && e.cmsPackage.toLowerCase().includes(pq)) || (e.punches && e.punches.some(p => p.pkgName && p.pkgName.toLowerCase().includes(pq))));
        }

        exportEquips.forEach((item) => {
            let statusText = 'N/A (0 PUNCH)';
            if (item.total > 0) {
                statusText = item.open === 0 ? '100% CLEAR' : 'IN PROGRESS';
            }

            const row = ws1.addRow({
                no: item.no,
                masterTag: item.masterTag,
                equipName: item.equipName,
                deckArea: item.deckArea,
                module: item.module,
                cmsPackage: item.cmsPackage,
                total: item.total,
                open: item.open,
                closed: item.closed,
                pct: item.pct !== null ? `${item.pct}%` : 'N/A',
                catA: item.catA,
                catB: item.catB,
                status: statusText
            });

            row.height = 22;

            row.eachCell((cell, colNum) => {
                cell.font = { name: 'Segoe UI', size: 9.5 };
                cell.border = cellBorder;
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                if (colNum === 2) {
                    cell.font = { name: 'Consolas', size: 10, bold: true, color: { argb: 'FF0369A1' } };
                } else if (colNum === 3 || colNum === 6) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left' };
                } else if (colNum === 8 && item.open > 0) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFDC2626' } };
                } else if (colNum === 9 && item.closed > 0) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF16A34A' } };
                } else if (colNum === 13) {
                    if (statusText === '100% CLEAR') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF15803D' } };
                    } else if (statusText === 'IN PROGRESS') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
                    } else {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF64748B' } };
                    }
                }
            });
        });

        // ==========================================
        // SHEET 2: Component Breakdown by Tag (Sub-Tags mapped to Major Equipments)
        // ==========================================
        let componentTags = getAllTagsSummaryData();
        const activePkgSearch = currentEquipPunchPkgSearch || currentAllTagsPkgSearch;
        if (activePkgSearch) {
            const pq = activePkgSearch.toLowerCase().trim();
            componentTags = componentTags.filter(item => (item.pkgName && item.pkgName.toLowerCase().includes(pq)));
        }
        const ws2 = workbook.addWorksheet("Component Breakdown", {
            views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
        });
        ws2.autoFilter = 'A1:P1';

        ws2.columns = [
            { header: '#', key: 'no', width: 6 },
            { header: 'TAG NO', key: 'mainTag', width: 22 },
            { header: 'EQUIPMENT NAME', key: 'equipName', width: 34 },
            { header: 'CMS PUNCH TAG NO', key: 'cmsPunchTag', width: 24 },
            { header: 'TAG DESCRIPTION', key: 'tagDesc', width: 36 },
            { header: 'SYSTEM', key: 'sys', width: 14 },
            { header: 'SUBSYSTEM', key: 'subsys', width: 16 },
            { header: 'PACKAGE NAME', key: 'pkgName', width: 32 },
            { header: 'DISCIPLINE', key: 'disc', width: 16 },
            { header: 'TOTAL PUNCHES', key: 'total', width: 16 },
            { header: 'OPEN PUNCHES', key: 'open', width: 16 },
            { header: 'CLOSED PUNCHES', key: 'closed', width: 16 },
            { header: '% CLOSED', key: 'pct', width: 14 },
            { header: 'CAT A (OPEN)', key: 'catA', width: 15 },
            { header: 'CAT B (OPEN)', key: 'catB', width: 15 },
            { header: 'STATUS', key: 'status', width: 18 }
        ];

        const headerRow2 = ws2.getRow(1);
        headerRow2.height = 28;
        headerRow2.eachCell((cell, colNumber) => {
            let bgArgb = 'FF1E293B';
            if (colNumber === 2 || colNumber === 3 || colNumber === 4) {
                bgArgb = 'FF0369A1'; // Highlight TAG NO, EQUIPMENT NAME, CMS PUNCH TAG NO
            }
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: bgArgb }
            };
            cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = headerBorder;
        });

        componentTags.forEach((item, rIdx) => {
            const statusText = item.open === 0 ? '100% CLEAR' : 'IN PROGRESS';

            const row = ws2.addRow({
                no: rIdx + 1,
                mainTag: item.mainTag,
                equipName: item.equipName,
                cmsPunchTag: item.cmsPunchTag,
                tagDesc: item.tagDesc,
                sys: item.sys,
                subsys: item.subsys,
                pkgName: item.pkgName,
                disc: item.disc,
                total: item.total,
                open: item.open,
                closed: item.closed,
                pct: `${item.pct}%`,
                catA: item.catA_open,
                catB: item.catB_open,
                status: statusText
            });

            row.height = 22;

            row.eachCell((cell, colNum) => {
                cell.font = { name: 'Segoe UI', size: 9.5 };
                cell.border = cellBorder;
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                if (colNum === 2) {
                    cell.font = { name: 'Consolas', size: 10, bold: true, color: { argb: 'FF0369A1' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else if (colNum === 3 || colNum === 5 || colNum === 8) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left' };
                } else if (colNum === 4) {
                    cell.font = { name: 'Consolas', size: 9.5, bold: true };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else if (colNum === 10) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true };
                } else if (colNum === 11 && item.open > 0) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFDC2626' } };
                } else if (colNum === 12 && item.closed > 0) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF16A34A' } };
                } else if (colNum === 16) {
                    if (statusText === '100% CLEAR') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF15803D' } };
                    } else {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
                    }
                }
            });
        });

        // Write and download complete Multi-Sheet Master Report
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.download = `Equipment_&_Tag_Punch_Summary_${nowStr}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Export Error:", err);
        alert("Failed to export Master Multi-Sheet Summary: " + err.message);
    }
}

async function exportEquipmentDetailToExcel() {
    if (!currentSelectedEquipData || !currentSelectedEquipData.punches) {
        alert("No punch detail data to export.");
        return;
    }

    const equip = currentSelectedEquipData;
    let list = equip.punches || [];

    if (currentModalPunchStatusFilter === 'OPEN') {
        list = list.filter(p => !String(p.status || '').toUpperCase().includes('CLOSE'));
    } else if (currentModalPunchStatusFilter === 'CLOSED') {
        list = list.filter(p => String(p.status || '').toUpperCase().includes('CLOSE'));
    }

    if (list.length === 0) {
        alert("No punch items match current filter to export.");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Block B LQP Mechanical Completion";
        workbook.created = new Date();

        const safeSheetName = equip.masterTag.replace(/[/\\?*\[\]:]/g, '_').slice(0, 31);
        const worksheet = workbook.addWorksheet(safeSheetName, {
            views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
        });

        // Columns with TAG NO, EQUIPMENT NAME, and CMS PUNCH TAG NO prominently at front (Cols 2, 3, 4)
        worksheet.columns = [
            { header: '#', key: 'no', width: 6 },
            { header: 'TAG NO', key: 'masterTag', width: 22 },
            { header: 'EQUIPMENT NAME', key: 'equipName', width: 34 },
            { header: 'CMS PUNCH TAG NO', key: 'childTag', width: 24 },
            { header: 'PUNCH NO', key: 'punchNo', width: 15 },
            { header: 'TAG DESCRIPTION', key: 'tagDesc', width: 30 },
            { header: 'SYSTEM', key: 'sys', width: 14 },
            { header: 'SUBSYSTEM', key: 'subsys', width: 16 },
            { header: 'PACKAGE NAME', key: 'pkgName', width: 34 },
            { header: 'DISCIPLINE', key: 'disc', width: 15 },
            { header: 'PHASE', key: 'phase', width: 12 },
            { header: 'CAT', key: 'cat', width: 10 },
            { header: 'STATUS', key: 'status', width: 12 },
            { header: 'DEFECT DESCRIPTION', key: 'desc', width: 48 },
            { header: 'ACTION BY', key: 'actionBy', width: 18 },
            { header: 'OPEN DATE', key: 'openDate', width: 14 },
            { header: 'CLOSED DATE', key: 'closeDate', width: 14 },
            { header: 'EXPECTED DATE', key: 'expDate', width: 14 }
        ];

        // Format Header Row
        const headerRow = worksheet.getRow(1);
        headerRow.height = 28;
        const headerBorder = {
            top: { style: 'thin', color: { argb: 'FF0F172A' } },
            left: { style: 'thin', color: { argb: 'FF0F172A' } },
            bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
            right: { style: 'thin', color: { argb: 'FF0F172A' } }
        };

        headerRow.eachCell((cell, colNumber) => {
            let bgArgb = 'FF1E293B';
            if (colNumber === 2 || colNumber === 3 || colNumber === 4) {
                bgArgb = 'FF0369A1'; // Highlight TAG NO, EQUIPMENT NAME, and CMS PUNCH TAG NO in distinct blue
            }
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: bgArgb }
            };
            cell.font = {
                name: 'Segoe UI',
                size: 10,
                bold: true,
                color: { argb: 'FFFFFFFF' }
            };
            cell.alignment = {
                vertical: 'middle',
                horizontal: 'center',
                wrapText: true
            };
            cell.border = headerBorder;
        });

        const cellBorder = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        // Add Data Rows
        list.forEach((p, idx) => {
            const isClosed = String(p.status || '').toUpperCase().includes('CLOSE');
            const statusDisplay = isClosed ? 'CLOSED' : 'OPEN';

            const row = worksheet.addRow({
                no: idx + 1,
                masterTag: equip.masterTag,
                equipName: equip.equipName,
                childTag: p.tag || '',
                punchNo: p.punchNo || '',
                tagDesc: p.tagDesc || '',
                sys: p.sys || '',
                subsys: p.subsys || '',
                pkgName: p.pkgName || '',
                disc: p.disc || '',
                phase: p.phase || '',
                cat: p.cat || '',
                status: statusDisplay,
                desc: p.desc || '',
                actionBy: p.actionBy || '',
                openDate: formatDateDisplay(p.openDate),
                closeDate: formatDateDisplay(p.closeDate),
                expDate: formatDateDisplay(p.expDate)
            });

            row.height = 22;

            row.eachCell((cell, colNum) => {
                cell.font = { name: 'Segoe UI', size: 9.5 };
                cell.border = cellBorder;
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                if (colNum === 2) {
                    cell.font = { name: 'Consolas', size: 10, bold: true, color: { argb: 'FF0369A1' } };
                } else if (colNum === 3 || colNum === 6 || colNum === 9 || colNum === 14) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: (colNum === 14) };
                } else if (colNum === 4 || colNum === 5) {
                    cell.font = { name: 'Consolas', size: 9.5, bold: true };
                } else if (colNum === 13) {
                    if (isClosed) {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF15803D' } };
                    } else {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
                    }
                }
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const cleanTag = equip.masterTag.replace(/[^A-Za-z0-9_-]/g, '_');
        const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.download = `${cleanTag}_Punches_${nowStr}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Export Error:", err);
        alert("Failed to export punch detail: " + err.message);
    }
}

function setupEquipmentPunchesEvents() {
    // Deck filter
    const deckFilter = document.getElementById('ep-filter-deck');
    if (deckFilter) {
        deckFilter.addEventListener('change', (e) => {
            currentEquipPunchFilterDeck = e.target.value;
            renderEquipmentSummaryTable();
        });
    }

    // Module filter
    const modFilter = document.getElementById('ep-filter-module');
    if (modFilter) {
        modFilter.addEventListener('change', (e) => {
            currentEquipPunchFilterModule = e.target.value;
            renderEquipmentSummaryTable();
        });
    }

    // Status filter
    const statusFilter = document.getElementById('ep-filter-status');
    if (statusFilter) {
        statusFilter.addEventListener('change', (e) => {
            currentEquipPunchFilterStatus = e.target.value;
            renderEquipmentSummaryTable();
        });
    }

    // Search query
    const searchInput = document.getElementById('ep-search-input') || document.getElementById('ep-search');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentEquipPunchSearch = e.target.value.trim();
            renderEquipmentSummaryTable();
        });
    }

    // Package No Search
    const epPkgInput = document.getElementById('ep-package-search-input');
    if (epPkgInput) {
        epPkgInput.addEventListener('input', (e) => {
            currentEquipPunchPkgSearch = e.target.value.trim();
            renderEquipmentSummaryTable();
        });
    }

    // Export Summary Excel
    const btnExpSummary = document.getElementById('btn-export-ep-summary');
    if (btnExpSummary) {
        btnExpSummary.addEventListener('click', exportEquipmentSummaryToExcel);
    }

    // File Upload (Dynamic Equipment Dictionary .xlsx)
    const fileUpload = document.getElementById('ep-file-upload');
    if (fileUpload) {
        fileUpload.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            try {
                const data = await file.arrayBuffer();
                const workbook = XLSX.read(data, { type: 'array' });
                
                let sheetName = workbook.SheetNames.find(s => s.toLowerCase().includes('install')) || workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                
                const rawJson = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
                if (rawJson.length === 0) {
                    alert("The selected Excel sheet is empty.");
                    return;
                }

                let headerIdx = -1;
                for (let r = 0; r < Math.min(10, rawJson.length); r++) {
                    const rowStr = rawJson[r].map(c => String(c).toLowerCase()).join(' ');
                    if (rowStr.includes('tag')) {
                        headerIdx = r;
                        break;
                    }
                }
                if (headerIdx === -1) headerIdx = 0;

                const json = XLSX.utils.sheet_to_json(worksheet, { range: headerIdx, defval: "" });
                const newEquips = [];

                json.forEach((row, idx) => {
                    const tag = getValueRobust(row, ['Tag No', 'TagNo', 'Tag', 'MASTER TAG NO', 'Master Tag']);
                    const name = getValueRobust(row, ['Equipment Name', 'EquipmentName', 'Description', 'Equip Name', 'EQUIPMENT NAME']);
                    const deck = getValueRobust(row, ['Deck Area', 'DeckArea', 'Deck', 'DECK AREA']);
                    const mod = getValueRobust(row, ['Module', 'MODULE']);
                    const no = getValueRobust(row, ['No.', 'No', '#']) || (idx + 1);

                    if (tag && String(tag).trim() !== '' && String(tag).toLowerCase() !== 'none') {
                        newEquips.push({
                            no: parseInt(no) || (idx + 1),
                            masterTag: String(tag).trim(),
                            equipName: String(name || '').trim(),
                            deckArea: String(deck || 'N/A').trim(),
                            module: String(mod || 'CLQU').trim()
                        });
                    }
                });

                if (newEquips.length === 0) {
                    alert("Could not find any equipment tags in the uploaded file. Please ensure sheet contains 'Tag No' and 'Equipment Name' columns.");
                    return;
                }

                currentMasterEquipments = newEquips;
                renderEquipmentSummaryTable();
                alert(`Equipment dictionary updated successfully!\nLoaded ${newEquips.length} master equipments from: ${file.name}`);
            } catch (err) {
                console.error("Error reading equipment file:", err);
                alert("Failed to read equipment Excel file: " + err.message);
            } finally {
                fileUpload.value = '';
            }
        });
    }

    // Modal Close
    const modalClose = document.getElementById('ep-modal-close');
    if (modalClose) {
        modalClose.addEventListener('click', closeEquipmentDetailModal);
    }
    const epModal = document.getElementById('equip-punch-modal');
    if (epModal) {
        epModal.addEventListener('click', (e) => {
            if (e.target === epModal) closeEquipmentDetailModal();
        });
    }

    // Modal Filter buttons
    const btnAll = document.getElementById('ep-detail-filter-all');
    const btnOpen = document.getElementById('ep-detail-filter-open');
    const btnClosed = document.getElementById('ep-detail-filter-closed');

    if (btnAll) {
        btnAll.addEventListener('click', () => {
            currentModalPunchStatusFilter = 'ALL';
            updateModalTabButtons();
            renderEquipmentDetailTable();
        });
    }
    if (btnOpen) {
        btnOpen.addEventListener('click', () => {
            currentModalPunchStatusFilter = 'OPEN';
            updateModalTabButtons();
            renderEquipmentDetailTable();
        });
    }
    if (btnClosed) {
        btnClosed.addEventListener('click', () => {
            currentModalPunchStatusFilter = 'CLOSED';
            updateModalTabButtons();
            renderEquipmentDetailTable();
        });
    }

    // Modal Search
    const modalSearch = document.getElementById('ep-detail-search-input');
    if (modalSearch) {
        modalSearch.addEventListener('input', (e) => {
            currentModalPunchSearch = e.target.value.trim();
            renderEquipmentDetailTable();
        });
    }

    // Modal Package No Search
    const modalPkgSearch = document.getElementById('ep-detail-pkg-search-input');
    if (modalPkgSearch) {
        modalPkgSearch.addEventListener('input', (e) => {
            currentModalPunchPkgSearch = e.target.value.trim();
            renderEquipmentDetailTable();
        });
    }

    // Export Detail Excel
    const btnExpDetail = document.getElementById('btn-export-ep-detail');
    if (btnExpDetail) {
        btnExpDetail.addEventListener('click', exportEquipmentDetailToExcel);
    }

    // --- All Tag Nos Summary Events ---
    const btnOpenAllTags = document.getElementById('btn-open-all-tags-modal');
    if (btnOpenAllTags) {
        btnOpenAllTags.addEventListener('click', openAllTagsSummaryModal);
    }

    const btnExportAllTags = document.getElementById('btn-export-all-tags-summary');
    if (btnExportAllTags) {
        btnExportAllTags.addEventListener('click', exportAllTagsSummaryToExcel);
    }

    const btnModalExportTags = document.getElementById('btn-modal-export-tags-summary');
    if (btnModalExportTags) {
        btnModalExportTags.addEventListener('click', exportAllTagsSummaryToExcel);
    }

    const modalTagsClose = document.getElementById('all-tags-modal-close');
    if (modalTagsClose) {
        modalTagsClose.addEventListener('click', closeAllTagsSummaryModal);
    }

    const tagsModal = document.getElementById('all-tag-summary-modal');
    if (tagsModal) {
        tagsModal.addEventListener('click', (e) => {
            if (e.target === tagsModal) closeAllTagsSummaryModal();
        });
    }

    const filterTagsAll = document.getElementById('tags-filter-all');
    const filterTagsOpen = document.getElementById('tags-filter-open');
    const filterTagsCleared = document.getElementById('tags-filter-cleared');

    if (filterTagsAll) {
        filterTagsAll.addEventListener('click', () => {
            currentAllTagsFilter = 'ALL';
            updateAllTagsFilterButtons();
            renderAllTagsSummaryTable();
        });
    }
    if (filterTagsOpen) {
        filterTagsOpen.addEventListener('click', () => {
            currentAllTagsFilter = 'OPEN';
            updateAllTagsFilterButtons();
            renderAllTagsSummaryTable();
        });
    }
    if (filterTagsCleared) {
        filterTagsCleared.addEventListener('click', () => {
            currentAllTagsFilter = 'CLEARED';
            updateAllTagsFilterButtons();
            renderAllTagsSummaryTable();
        });
    }

    const searchTagsInput = document.getElementById('tags-search-input');
    if (searchTagsInput) {
        searchTagsInput.addEventListener('input', (e) => {
            currentAllTagsSearch = e.target.value.trim();
            renderAllTagsSummaryTable();
        });
    }

    const searchTagsPkgInput = document.getElementById('tags-package-search-input');
    if (searchTagsPkgInput) {
        searchTagsPkgInput.addEventListener('input', (e) => {
            currentAllTagsPkgSearch = e.target.value.trim();
            renderAllTagsSummaryTable();
        });
    }
}


// ==========================================

// All Tag Nos Punch Summary & Export Module
// ==========================================

let currentAllTagsFilter = 'ALL'; // 'ALL', 'OPEN', 'CLEARED'
let currentAllTagsSearch = '';
let currentAllTagsPkgSearch = '';
let lastCalculatedTagsSummary = [];

function findMasterEquipmentForPunch(ptag, ppkg, pdesc) {
    if (!currentMasterEquipments || currentMasterEquipments.length === 0) return null;
    const ptagClean = String(ptag || '').trim().toUpperCase();
    const ppkgClean = String(ppkg || '').trim().toUpperCase();
    const pdescClean = String(pdesc || '').trim().toUpperCase();

    // 1. Exact Tag Match - ALWAYS highest priority!
    for (let me of currentMasterEquipments) {
        const mtag = String(me.masterTag || '').trim().toUpperCase();
        if (mtag && ptagClean === mtag) return me;
    }

    // 2. Package Tag 4-digit family match (e.g. 8001 in CLQU-PSL-8001, CLQU-UCP-8001)
    // ONLY for component tags that do NOT match any other master equipment!
    for (let me of currentMasterEquipments) {
        const mtag = String(me.masterTag || '').trim().toUpperCase();
        const mname = String(me.equipName || '').trim().toUpperCase();
        const numMatch = mtag.match(/\d{4}/);
        const tagNum = numMatch ? numMatch[0] : '';
        const isPackage = /PK-|PACKAGE|SKID|UNIT/i.test(mtag + ' ' + mname);

        if (tagNum && tagNum.length === 4 && ptagClean.includes(tagNum) && isPackage) {
            // Check if multiple master equipments share this tag number (e.g. PK-5803 vs P-5803A vs P-5803B, or PK-5501 vs T-5501-05)
            const sharingEquips = currentMasterEquipments.filter(m => {
                const mt = String(m.masterTag || '').toUpperCase();
                return mt.includes(tagNum);
            });

            if (sharingEquips.length > 1) {
                // If child tag has 'PK' and master has 'PK', match it
                if (ptagClean.includes('PK') && mtag.includes('PK')) return me;
                // If child tag has 'P-' and master has 'P-', match it
                if (ptagClean.includes('P-') && mtag.includes('P-')) return me;
                // If child tag has 'T-' and master has 'T-', match it
                if (ptagClean.includes('T-') && mtag.includes('T-')) return me;
                // Otherwise if master is package and child tag is an instrument/valve on skid (e.g. LIT-5501, PVC-5501, PSL-8001)
                if (mtag.includes('PK') && !/CLQ[UM]-(P|T)-/.test(ptagClean)) return me;
            } else {
                return me;
            }
        }
    }

    // 3. Package Name matching (must be specific, avoiding twin package overlap)
    for (let me of currentMasterEquipments) {
        const mtag = String(me.masterTag || '').trim().toUpperCase();
        const mname = String(me.equipName || '').trim().toUpperCase();
        const isPackage = /PK-|PACKAGE|SKID|UNIT/i.test(mtag + ' ' + mname);
        const cleanName = mname.replace(/PACKAGE|SKID|UNIT/gi, ' ').trim();
        const nameWords = cleanName.split(/[^A-Z0-9]+/).filter(w => w.length >= 4);

        if (isPackage && nameWords.length > 0 && ppkgClean) {
            if (nameWords.every(w => ppkgClean.includes(w))) {
                const numMe = (mtag.match(/\d{4}/) || [])[0];
                const numTag = (ptagClean.match(/\d{4}/) || [])[0];
                if (numMe && numTag) {
                    if (numMe === numTag) return me;
                } else {
                    return me;
                }
            }
        }
    }

    // 4. Prefix match
    for (let me of currentMasterEquipments) {
        const mtag = String(me.masterTag || '').trim().toUpperCase();
        if (mtag && ptagClean.startsWith(mtag)) {
            return me;
        }
    }

    return null;
}

function getAllTagsSummaryData() {
    const gd = window.GLOBAL_MC_DATA;
    const punchList = gd ? (gd.globalPunchList || []) : [];

    const tagMap = {};

    punchList.forEach(p => {
        let rawTag = p.tag || 'NO_TAG';
        // Clean line breaks and extra whitespace
        const cmsTag = String(rawTag).trim().replace(/\r?\n|\r/g, ' ');
        if (!cmsTag) return;

        if (!tagMap[cmsTag]) {
            const me = findMasterEquipmentForPunch(cmsTag, p.pkgName, p.tagDesc || p.desc);
            const mainTag = me ? me.masterTag : 'N/A';
            const equipName = me ? me.equipName : 'N/A';

            tagMap[cmsTag] = {
                mainTag: mainTag,
                equipName: equipName,
                cmsPunchTag: cmsTag,
                tagDesc: p.tagDesc || p.desc || '',
                sys: p.sys || '',
                subsys: p.subsys || '',
                pkgName: p.pkgName || '',
                disc: p.disc || '',
                phase: p.phase || '',
                total: 0,
                open: 0,
                closed: 0,
                catA_open: 0,
                catB_open: 0,
                punches: []
            };
        }

        const entry = tagMap[cmsTag];
        if (!entry.tagDesc && (p.tagDesc || p.desc)) {
            entry.tagDesc = p.tagDesc || p.desc;
        }
        if (!entry.pkgName && p.pkgName) {
            entry.pkgName = p.pkgName;
        }
        if (!entry.sys && p.sys) entry.sys = p.sys;
        if (!entry.subsys && p.subsys) entry.subsys = p.subsys;
        if (!entry.disc && p.disc) entry.disc = p.disc;
        if (!entry.phase && p.phase) entry.phase = p.phase;

        entry.total++;
        entry.punches.push(p);

        const isClosed = String(p.status || '').toUpperCase().includes('CLOSE');
        if (isClosed) {
            entry.closed++;
        } else {
            entry.open++;
            const cat = String(p.cat || '').toUpperCase();
            if (cat.includes('A')) entry.catA_open++;
            if (cat.includes('B')) entry.catB_open++;
        }
    });

    const tags = Object.values(tagMap).map(item => {
        const pct = item.total > 0 ? Math.round((item.closed / item.total) * 100) : 0;
        const statusType = item.open === 0 ? 'CLEARED' : 'IN_PROGRESS';
        return {
            ...item,
            pct: pct,
            statusType: statusType
        };
    });

    // Sort: Tags with Open punches first (descending open count, then total count, then mainTag)
    tags.sort((a, b) => {
        if (a.open > 0 && b.open === 0) return -1;
        if (a.open === 0 && b.open > 0) return 1;
        if (b.open !== a.open) return b.open - a.open;
        if (b.total !== a.total) return b.total - a.total;
        return a.mainTag.localeCompare(b.mainTag);
    });

    lastCalculatedTagsSummary = tags;
    return tags;
}

function openAllTagsSummaryModal() {
    currentAllTagsFilter = 'ALL';
    currentAllTagsSearch = '';
    currentAllTagsPkgSearch = '';

    const modal = document.getElementById('all-tag-summary-modal');
    if (!modal) return;

    const searchInput = document.getElementById('tags-search-input');
    if (searchInput) searchInput.value = '';
    const pkgSearchInput = document.getElementById('tags-package-search-input');
    if (pkgSearchInput) pkgSearchInput.value = '';

    updateAllTagsFilterButtons();
    renderAllTagsSummaryTable();

    modal.style.display = 'flex';
}

function closeAllTagsSummaryModal() {
    const modal = document.getElementById('all-tag-summary-modal');
    if (modal) modal.style.display = 'none';
}

function updateAllTagsFilterButtons() {
    const btnAll = document.getElementById('tags-filter-all');
    const btnOpen = document.getElementById('tags-filter-open');
    const btnCleared = document.getElementById('tags-filter-cleared');

    if (btnAll) {
        btnAll.style.background = currentAllTagsFilter === 'ALL' ? '#0ea5e9' : '#fff';
        btnAll.style.color = currentAllTagsFilter === 'ALL' ? '#fff' : '#0f172a';
    }
    if (btnOpen) {
        btnOpen.style.background = currentAllTagsFilter === 'OPEN' ? '#ef4444' : '#fff';
        btnOpen.style.color = currentAllTagsFilter === 'OPEN' ? '#fff' : '#ef4444';
    }
    if (btnCleared) {
        btnCleared.style.background = currentAllTagsFilter === 'CLEARED' ? '#10b981' : '#fff';
        btnCleared.style.color = currentAllTagsFilter === 'CLEARED' ? '#fff' : '#10b981';
    }
}

function renderAllTagsSummaryTable() {
    const tags = getAllTagsSummaryData();

    // Update Header stats
    const totalTags = tags.length;
    const withOpen = tags.filter(t => t.open > 0).length;
    const cleared = tags.filter(t => t.open === 0).length;
    const totalPunches = tags.reduce((sum, t) => sum + t.total, 0);

    const subtitle = document.getElementById('all-tags-modal-subtitle');
    if (subtitle) {
        subtitle.innerHTML = `Total: <b style="color: #f8fafc;">${totalTags}</b> Tags &nbsp;|&nbsp; <b style="color: #f87171;">${withOpen}</b> With Open Punches &nbsp;|&nbsp; <b style="color: #34d399;">${cleared}</b> 100% Clear &nbsp;|&nbsp; <b style="color: #38bdf8;">${totalPunches}</b> Total Punches`;
    }

    const btnAll = document.getElementById('tags-filter-all');
    const btnOpen = document.getElementById('tags-filter-open');
    const btnCleared = document.getElementById('tags-filter-cleared');
    if (btnAll) btnAll.textContent = `All Tags (${totalTags})`;
    if (btnOpen) btnOpen.textContent = `With Open (${withOpen})`;
    if (btnCleared) btnCleared.textContent = `100% Clear (${cleared})`;

    // Filter
    let filtered = tags.filter(t => {
        if (currentAllTagsFilter === 'OPEN' && t.open === 0) return false;
        if (currentAllTagsFilter === 'CLEARED' && t.open > 0) return false;
        if (currentAllTagsSearch) {
            const q = currentAllTagsSearch.toLowerCase();
            const mainTagMatch = t.mainTag.toLowerCase().includes(q);
            const equipMatch = t.equipName.toLowerCase().includes(q);
            const cmsTagMatch = t.cmsPunchTag.toLowerCase().includes(q);
            const descMatch = t.tagDesc.toLowerCase().includes(q);
            const sysMatch = t.sys.toLowerCase().includes(q);
            const subsysMatch = t.subsys.toLowerCase().includes(q);
            const pkgMatch = t.pkgName.toLowerCase().includes(q);
            if (!mainTagMatch && !equipMatch && !cmsTagMatch && !descMatch && !sysMatch && !subsysMatch && !pkgMatch) return false;
        }
        if (currentAllTagsPkgSearch) {
            const pq = currentAllTagsPkgSearch.toLowerCase().trim();
            if (!t.pkgName || !t.pkgName.toLowerCase().includes(pq)) return false;
        }
        return true;
    });

    const tbody = document.getElementById('all-tag-summary-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="16" style="text-align: center; padding: 2.5rem; color: #64748b; background: #fff;">No Tag Nos match current filter.</td></tr>`;
        return;
    }

    filtered.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.style.background = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        tr.style.borderBottom = '1px solid #e2e8f0';

        const isCleared = item.open === 0;
        const statusBadge = isCleared
            ? `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #dcfce7; color: #15803d; border: 1px solid #86efac;">100% CLEAR</span>`
            : `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;">IN PROGRESS</span>`;

        const barColor = item.pct === 100 ? '#10b981' : (item.pct > 50 ? '#0284c7' : '#f59e0b');
        const progressHtml = `
            <div style="display: flex; align-items: center; gap: 0.5rem; justify-content: center;">
                <div style="width: 48px; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden;">
                    <div style="width: ${item.pct}%; height: 100%; background: ${barColor};"></div>
                </div>
                <span style="font-size: 0.75rem; font-weight: 700; color: ${barColor}; font-family: monospace;">${item.pct}%</span>
            </div>
        `;

        const openHtml = item.open > 0
            ? `<span style="display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 0.75rem; font-weight: 800; background: #fee2e2; color: #b91c1c; font-family: monospace;">${item.open}</span>`
            : `<span style="color: #94a3b8; font-family: monospace;">0</span>`;

        const closedHtml = item.closed > 0
            ? `<span style="display: inline-block; padding: 1px 7px; border-radius: 10px; font-size: 0.75rem; font-weight: 800; background: #dcfce7; color: #15803d; font-family: monospace;">${item.closed}</span>`
            : `<span style="color: #94a3b8; font-family: monospace;">0</span>`;

        const catHtml = (item.catA_open > 0 || item.catB_open > 0)
            ? `<span style="font-size: 0.75rem; font-weight: 700; font-family: monospace;"><span style="color: #b91c1c;">A:${item.catA_open}</span> | <span style="color: #b45309;">B:${item.catB_open}</span></span>`
            : `<span style="color: #94a3b8; font-size: 0.75rem; font-family: monospace;">-</span>`;

        tr.innerHTML = `
            <td style="text-align: center; color: #64748b; font-size: 0.8rem; font-weight: 600;">${idx + 1}</td>
            <td style="text-align: center; font-family: Consolas, monospace; font-weight: 700; font-size: 0.82rem; ${item.mainTag === 'N/A' ? 'color: #94a3b8; font-style: italic; background: #f8fafc;' : 'color: #0284c7; background: #f0f9ff;'}">${item.mainTag}</td>
            <td style="text-align: left; font-weight: 700; font-size: 0.82rem; ${item.equipName === 'N/A' ? 'color: #94a3b8; font-style: italic; background: #f8fafc;' : 'color: #0f172a; background: #f0f9ff;'}">${item.equipName}</td>
            <td style="text-align: center; font-family: Consolas, monospace; font-weight: 700; color: #0f172a; font-size: 0.82rem;">${item.cmsPunchTag}</td>
            <td style="text-align: left; font-weight: 600; color: #0f172a; font-size: 0.8rem; max-width: 240px; line-height: 1.35;">${item.tagDesc || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.8rem;">${item.sys || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.8rem;">${item.subsys || '-'}</td>
            <td style="text-align: left; color: #475569; font-size: 0.78rem; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.pkgName || ''}">${item.pkgName || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.78rem;">${item.disc || '-'}</td>
            <td style="text-align: center; font-weight: 800; color: #0f172a; font-family: monospace;">${item.total}</td>
            <td style="text-align: center;">${openHtml}</td>
            <td style="text-align: center;">${closedHtml}</td>
            <td style="text-align: center;">${progressHtml}</td>
            <td style="text-align: center;">${catHtml}</td>
            <td style="text-align: center;">${statusBadge}</td>
            <td style="text-align: center;">
                <button type="button" class="btn-tag-drilldown" style="padding: 0.25rem 0.6rem; font-size: 0.72rem; font-weight: 700; border: 1px solid #0284c7; background: #f0f9ff; color: #0284c7; border-radius: 4px; cursor: pointer;">
                    View (${item.total})
                </button>
            </td>
        `;

        const drillBtn = tr.querySelector('.btn-tag-drilldown');
        if (drillBtn) {
            drillBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                openEquipmentDetailModal({
                    no: idx + 1,
                    masterTag: item.mainTag,
                    equipName: item.equipName,
                    deckArea: item.sys,
                    module: item.subsys,
                    cmsPackage: item.pkgName,
                    total: item.total,
                    open: item.open,
                    closed: item.closed,
                    punches: item.punches
                });
            });
        }

        tbody.appendChild(tr);
    });
}

async function exportAllTagsSummaryToExcel() {
    // Generate Master Multi-Sheet Excel report (Sheet 1: Major Equipment Summary, Sheet 2: Component Breakdown)
    await exportMultiSheetMasterReport();
    return;
    const tags = getAllTagsSummaryData();
    if (!tags || tags.length === 0) {
        alert("No Tag No punch summary data to export.");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Block B LQP Mechanical Completion";
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet("Tag Punch Summary", {
            views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
        });

        // 16 columns formatted exactly with TAG NO, EQUIPMENT NAME, and CMS PUNCH TAG NO at front
        worksheet.columns = [
            { header: '#', key: 'no', width: 6 },
            { header: 'TAG NO', key: 'mainTag', width: 22 },
            { header: 'EQUIPMENT NAME', key: 'equipName', width: 34 },
            { header: 'CMS PUNCH TAG NO', key: 'cmsPunchTag', width: 24 },
            { header: 'TAG DESCRIPTION', key: 'tagDesc', width: 36 },
            { header: 'SYSTEM', key: 'sys', width: 14 },
            { header: 'SUBSYSTEM', key: 'subsys', width: 16 },
            { header: 'PACKAGE NAME', key: 'pkgName', width: 32 },
            { header: 'DISCIPLINE', key: 'disc', width: 16 },
            { header: 'TOTAL PUNCHES', key: 'total', width: 16 },
            { header: 'OPEN PUNCHES', key: 'open', width: 16 },
            { header: 'CLOSED PUNCHES', key: 'closed', width: 16 },
            { header: '% CLOSED', key: 'pct', width: 14 },
            { header: 'CAT A (OPEN)', key: 'catA', width: 15 },
            { header: 'CAT B (OPEN)', key: 'catB', width: 15 },
            { header: 'STATUS', key: 'status', width: 18 }
        ];

        // Format Header Row (Dark Slate Navy, bold white text, border)
        const headerRow = worksheet.getRow(1);
        headerRow.height = 28;
        const headerBorder = {
            top: { style: 'thin', color: { argb: 'FF0F172A' } },
            left: { style: 'thin', color: { argb: 'FF0F172A' } },
            bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
            right: { style: 'thin', color: { argb: 'FF0F172A' } }
        };

        headerRow.eachCell((cell, colNumber) => {
            let bgArgb = 'FF1E293B';
            if (colNumber === 2 || colNumber === 3 || colNumber === 4) {
                bgArgb = 'FF0369A1'; // Distinct Blue highlight for Tag No, Equipment Name, and CMS Punch Tag No
            }
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: bgArgb }
            };
            cell.font = {
                name: 'Segoe UI',
                size: 10,
                bold: true,
                color: { argb: 'FFFFFFFF' }
            };
            cell.alignment = {
                vertical: 'middle',
                horizontal: 'center',
                wrapText: true
            };
            cell.border = headerBorder;
        });

        const cellBorder = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        // Add Data Rows
        tags.forEach((item, rIdx) => {
            const statusText = item.open === 0 ? '100% CLEAR' : 'IN PROGRESS';

            const row = worksheet.addRow({
                no: rIdx + 1,
                mainTag: item.mainTag,
                equipName: item.equipName,
                cmsPunchTag: item.cmsPunchTag,
                tagDesc: item.tagDesc,
                sys: item.sys,
                subsys: item.subsys,
                pkgName: item.pkgName,
                disc: item.disc,
                total: item.total,
                open: item.open,
                closed: item.closed,
                pct: `${item.pct}%`,
                catA: item.catA_open,
                catB: item.catB_open,
                status: statusText
            });

            row.height = 22;

            row.eachCell((cell, colNum) => {
                cell.font = { name: 'Segoe UI', size: 9.5 };
                cell.border = cellBorder;
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                if (colNum === 2) {
                    cell.font = { name: 'Consolas', size: 10, bold: true, color: { argb: 'FF0369A1' } };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else if (colNum === 3 || colNum === 5 || colNum === 8) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left' };
                } else if (colNum === 4) {
                    cell.font = { name: 'Consolas', size: 9.5, bold: true };
                    cell.alignment = { vertical: 'middle', horizontal: 'center' };
                } else if (colNum === 10) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true };
                } else if (colNum === 11 && item.open > 0) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FFDC2626' } };
                } else if (colNum === 12 && item.closed > 0) {
                    cell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'FF16A34A' } };
                } else if (colNum === 16) {
                    if (statusText === '100% CLEAR') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF15803D' } };
                    } else {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
                    }
                }
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.download = `All_Tags_Punch_Summary_${nowStr}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Export Error:", err);
        alert("Failed to export All Tags Punch Summary: " + err.message);
    }
}




// =============================================================================
// SITE WALKDOWN PUNCHES MODULE (Manual Walkdown Tracking & CMS Reconciliation)
// =============================================================================

let siteWalkdownPunches = [];
let currentSwCmsFilter = 'ALL';
let currentSwDiscFilter = 'ALL';
let currentSwSearch = '';
let currentSwPkgSearch = '';
let currentSwEditingId = null;
let currentSwMatchingId = null;
let isSiteWalkdownInitialized = false;

// 1. Storage & Persistence
function loadSiteWalkdownPunches() {
    try {
        const stored = localStorage.getItem('LQP_SITE_WALKDOWN_PUNCHES');
        if (stored) {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                // Filter out the initial demo/sample punches so user starts completely clean
                siteWalkdownPunches = parsed.filter(p => p.id !== 'SW-1730000001000' && p.id !== 'SW-1730000002000');
                saveSiteWalkdownPunchesToStorage();
                return;
            }
        }
    } catch (e) {
        console.error("Failed to load Site Walkdown Punches from storage:", e);
    }

    if (window.GLOBAL_MC_DATA && Array.isArray(window.GLOBAL_MC_DATA.siteWalkdownPunches) && window.GLOBAL_MC_DATA.siteWalkdownPunches.length > 0) {
        siteWalkdownPunches = window.GLOBAL_MC_DATA.siteWalkdownPunches;
        saveSiteWalkdownPunchesToStorage();
        return;
    }

    siteWalkdownPunches = [];
}

function saveSiteWalkdownPunchesToStorage() {
    try {
        localStorage.setItem('LQP_SITE_WALKDOWN_PUNCHES', JSON.stringify(siteWalkdownPunches));
    } catch (e) {
        console.error("Failed to save Site Walkdown Punches to storage:", e);
    }
}

// 2. Autocomplete & Tag Auto-Lookup
function lookupTagDetails(rawTag) {
    if (!rawTag) return null;
    const cleanTag = String(rawTag).trim().toUpperCase();
    if (!cleanTag) return null;

    const gd = window.GLOBAL_MC_DATA;
    const tagMap = gd ? (gd.globalTagMap || {}) : {};
    const punchList = gd ? (gd.globalPunchList || []) : [];

    // 1. Direct match in globalTagMap (19,734 tags across all disciplines - most accurate)
    const tagInfo = tagMap[cleanTag];

    // 2. Direct match in currentMasterEquipments
    let me = null;
    if (typeof currentMasterEquipments !== 'undefined' && currentMasterEquipments) {
        me = currentMasterEquipments.find(m => String(m.masterTag || '').trim().toUpperCase() === cleanTag);
        if (!me && typeof findMasterEquipmentForPunch === 'function') {
            me = findMasterEquipmentForPunch(cleanTag, '', '');
        }
    }

    // 3. Direct match in globalPunchList
    let samplePunch = punchList.find(p => String(p.tag || '').trim().toUpperCase() === cleanTag);

    // Only fallback to partial match if cleanTag is a package/skid
    if (!samplePunch && cleanTag.includes('PK-')) {
        samplePunch = punchList.find(p => String(p.tag || '').trim().toUpperCase().includes(cleanTag));
    }

    const sys = (tagInfo && tagInfo.sys) ? tagInfo.sys : (samplePunch ? (samplePunch.sys || '') : '');
    const subsys = (tagInfo && tagInfo.subsys) ? tagInfo.subsys : (samplePunch ? (samplePunch.subsys || '') : '');

    // Subsystem package lookup
    let pkgName = me ? (me.cmsPackage || '') : (samplePunch ? (samplePunch.pkgName || '') : '');
    if (!pkgName && subsys) {
        const pWithPkg = punchList.find(p => p.subsys === subsys && p.pkgName);
        if (pWithPkg) pkgName = pWithPkg.pkgName;
    }

    const equipName = me ? me.equipName : (tagInfo ? (tagInfo.desc || cleanTag) : (samplePunch ? (samplePunch.tagDesc || samplePunch.desc || cleanTag) : cleanTag));
    const cmsPunchTag = cleanTag;
    const tagDesc = tagInfo ? (tagInfo.desc || '') : (samplePunch ? (samplePunch.tagDesc || samplePunch.desc || '') : equipName);
    const disc = (tagInfo && tagInfo.disc) ? tagInfo.disc : (samplePunch ? (samplePunch.disc || 'MECHANICAL') : 'MECHANICAL');

    return {
        mainTag: cleanTag,
        equipName: equipName,
        cmsPunchTag: cmsPunchTag,
        tagDesc: tagDesc,
        sys: sys,
        subsys: subsys,
        pkgName: pkgName,
        disc: disc
    };
}

function populateSitePunchDatalist() {
    const datalist = document.getElementById('sw-tag-datalist');
    if (!datalist) return;

    const tagsMap = new Map();

    // 1. From currentMasterEquipments (High priority master equipment)
    if (typeof currentMasterEquipments !== 'undefined' && currentMasterEquipments) {
        currentMasterEquipments.forEach(m => {
            const t = String(m.masterTag || '').trim();
            if (t && !tagsMap.has(t)) {
                tagsMap.set(t, m.equipName || '');
            }
        });
    }

    // 2. From globalPunchList
    const gd = window.GLOBAL_MC_DATA;
    if (gd && gd.globalPunchList) {
        gd.globalPunchList.forEach(p => {
            const t = String(p.tag || '').trim();
            if (t && !tagsMap.has(t)) {
                tagsMap.set(t, p.tagDesc || p.desc || p.pkgName || '');
            }
        });
    }

    // 3. From globalTagMap: Include all mechanical equipment and key tagged items
    if (gd && gd.globalTagMap) {
        const tagMap = gd.globalTagMap;
        for (const t in tagMap) {
            if (!t.startsWith('TP-') && !tagsMap.has(t)) {
                const item = tagMap[t];
                const disc = item.disc || '';
                if (disc === 'MECHANICAL' || /-(PK|SWG|MCC|TR|UPS|EDG|UCP|LCP|V|P|E|K|C|T|PM|PU|HE)-/i.test(t)) {
                    tagsMap.set(t, item.desc || '');
                }
            }
        }
    }

    let optionsHtml = '';
    tagsMap.forEach((desc, tag) => {
        optionsHtml += `<option value="${tag}">${desc ? desc.slice(0, 50) : ''}</option>`;
    });

    datalist.innerHTML = optionsHtml;
}

// 3. Smart Matching: Find possible CMS punch candidates for a Site Finding
function findSmartCmsSuggestions(tagNo, defectDesc) {
    const gd = window.GLOBAL_MC_DATA;
    const punchList = gd ? (gd.globalPunchList || []) : [];
    if (!punchList || punchList.length === 0 || !tagNo) return [];

    const cleanTag = String(tagNo).trim().toUpperCase();
    const cleanDesc = String(defectDesc || '').toLowerCase();
    const descWords = cleanDesc.split(/[^a-z0-9]+/).filter(w => w.length >= 4 && !['with', 'from', 'this', 'that', 'have', 'been', 'will'].includes(w));

    // Candidates with exact tag or containing tag
    const candidates = [];
    punchList.forEach(p => {
        const ptag = String(p.tag || '').trim().toUpperCase();
        if (ptag === cleanTag || ptag.includes(cleanTag) || cleanTag.includes(ptag)) {
            let score = 50; // base score for tag match
            const pdesc = String(p.desc || '').toLowerCase();
            let matchedWords = 0;
            descWords.forEach(w => {
                if (pdesc.includes(w)) {
                    score += 15;
                    matchedWords++;
                }
            });
            candidates.push({
                punch: p,
                score: Math.min(score, 99),
                matchedWords: matchedWords
            });
        }
    });

    candidates.sort((a, b) => b.score - a.score);
    return candidates.slice(0, 5);
}

// 4. Render Table & Metrics
function renderSiteWalkdownTab() {
    const tbody = document.getElementById('sw-tbody');
    if (!tbody) return;

    // 1. Calculate KPI Metrics
    const total = siteWalkdownPunches.length;
    const pending = siteWalkdownPunches.filter(p => p.cmsStatus === 'PENDING_CMS').length;
    const inCms = siteWalkdownPunches.filter(p => p.cmsStatus === 'IN_CMS' && p.status !== 'CLOSED').length;
    const closed = siteWalkdownPunches.filter(p => p.status === 'CLOSED').length;
    const catA = siteWalkdownPunches.filter(p => p.cat === 'A').length;
    const catB = siteWalkdownPunches.filter(p => p.cat === 'B').length;
    const catC = siteWalkdownPunches.filter(p => p.cat === 'C').length;

    const elTotal = document.getElementById('sw-stat-total');
    const elPending = document.getElementById('sw-stat-pending');
    const elInCms = document.getElementById('sw-stat-in-cms');
    const elClosed = document.getElementById('sw-stat-closed');
    const elCat = document.getElementById('sw-stat-cat');

    if (elTotal) elTotal.textContent = total;
    if (elPending) elPending.textContent = pending;
    if (elInCms) elInCms.textContent = inCms;
    if (elClosed) elClosed.textContent = closed;
    if (elCat) {
        elCat.innerHTML = `<span style="color: #ef4444;">A: ${catA}</span> &nbsp;|&nbsp; <span style="color: #f59e0b;">B: ${catB}</span> &nbsp;|&nbsp; <span style="color: #10b981;">C: ${catC}</span>`;
    }

    // Update filter button text with counts
    const btnAll = document.getElementById('sw-filter-all');
    const btnPending = document.getElementById('sw-filter-pending');
    const btnInCms = document.getElementById('sw-filter-in-cms');
    const btnClosed = document.getElementById('sw-filter-closed');

    if (btnAll) btnAll.textContent = `All (${total})`;
    if (btnPending) btnPending.textContent = `Pending CMS (${pending})`;
    if (btnInCms) btnInCms.textContent = `In CMS (${inCms})`;
    if (btnClosed) btnClosed.textContent = `Closed (${closed})`;

    // Filter Items
    let filtered = siteWalkdownPunches.filter(p => {
        if (currentSwCmsFilter === 'PENDING_CMS' && p.cmsStatus !== 'PENDING_CMS') return false;
        if (currentSwCmsFilter === 'IN_CMS' && (p.cmsStatus !== 'IN_CMS' || p.status === 'CLOSED')) return false;
        if (currentSwCmsFilter === 'CLOSED' && p.status !== 'CLOSED') return false;

        if (currentSwDiscFilter !== 'ALL' && p.disc !== currentSwDiscFilter) return false;

        if (currentSwSearch) {
            const q = currentSwSearch.toLowerCase();
            const tagMatch = (p.tagNo || '').toLowerCase().includes(q);
            const equipMatch = (p.equipName || '').toLowerCase().includes(q);
            const punchMatch = (p.punchNo || '').toLowerCase().includes(q);
            const cmsPunchMatch = (p.officialCmsPunchNo || '').toLowerCase().includes(q);
            const descMatch = (p.desc || '').toLowerCase().includes(q);
            const subsysMatch = (p.subsys || '').toLowerCase().includes(q);
            const pkgMatch = (p.pkgName || '').toLowerCase().includes(q);
            if (!tagMatch && !equipMatch && !punchMatch && !cmsPunchMatch && !descMatch && !subsysMatch && !pkgMatch) {
                return false;
            }
        }
        if (currentSwPkgSearch) {
            const pq = currentSwPkgSearch.toLowerCase().trim();
            if (!p.pkgName || !p.pkgName.toLowerCase().includes(pq)) {
                return false;
            }
        }
        return true;
    });

    tbody.innerHTML = '';

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="21" style="text-align: center; padding: 2.5rem; color: #64748b; background: #fff;">No site walkdown findings match current filter. Click "+ Add Site Finding" to record a new one.</td></tr>`;
        return;
    }

    filtered.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.style.background = idx % 2 === 0 ? '#ffffff' : '#f8fafc';
        tr.style.borderBottom = '1px solid #e2e8f0';

        // Badges
        const isClosed = item.status === 'CLOSED';
        const statusBadge = isClosed
            ? `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #dcfce7; color: #15803d; border: 1px solid #86efac;">CLOSED</span>`
            : `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;">OPEN</span>`;

        let catBg = '#fef3c7';
        let catColor = '#b45309';
        let catBorder = '#fcd34d';
        if (item.cat === 'A') {
            catBg = '#fee2e2'; catColor = '#b91c1c'; catBorder = '#fca5a5';
        } else if (item.cat === 'C') {
            catBg = '#f1f5f9'; catColor = '#475569'; catBorder = '#cbd5e1';
        }
        const catBadge = `<span style="display: inline-block; padding: 2px 7px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: ${catBg}; color: ${catColor}; border: 1px solid ${catBorder};">Cat ${item.cat || 'B'}</span>`;

        // CMS Tracking Badge
        let cmsBadge = '';
        if (isClosed || item.cmsStatus === 'CLOSED') {
            cmsBadge = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #dcfce7; color: #15803d; border: 1px solid #86efac; white-space: nowrap;">✅ CLOSED</span>`;
        } else if (item.cmsStatus === 'IN_CMS' || item.officialCmsPunchNo) {
            cmsBadge = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; white-space: nowrap;">🔄 IN CMS (OPEN)</span>`;
        } else {
            cmsBadge = `<span style="display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 800; background: #fef3c7; color: #b45309; border: 1px solid #fde68a; white-space: nowrap;" title="Not yet raised in CMS by contractor">⚠️ PENDING CMS</span>`;
        }

        // Official CMS Punch No cell
        let cmsPunchNoCell = '';
        if (item.officialCmsPunchNo) {
            cmsPunchNoCell = `
                <div style="display: flex; align-items: center; justify-content: center; gap: 0.35rem;">
                    <span style="font-family: Consolas, monospace; font-weight: 700; color: #0284c7; background: #f0f9ff; padding: 2px 6px; border-radius: 4px; border: 1px solid #bae6fd; font-size: 0.8rem;">
                        ${item.officialCmsPunchNo}
                    </span>
                    <button type="button" class="btn-sw-unlink" data-id="${item.id}" style="background: none; border: none; color: #94a3b8; cursor: pointer; padding: 2px; font-size: 0.85rem;" title="Unlink CMS Punch">&times;</button>
                </div>
            `;
        } else {
            cmsPunchNoCell = `
                <button type="button" class="btn-sw-match-row" data-id="${item.id}" style="padding: 2px 8px; font-size: 0.72rem; font-weight: 600; border: 1px dashed #f59e0b; background: rgba(245, 158, 11, 0.1); color: #d97706; border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: 0.25rem;">
                    🔍 Match CMS
                </button>
            `;
        }

        // Format Dates
        const openStr = formatDateDisplay(item.openDate);
        const closeStr = formatDateDisplay(item.closeDate);
        const expStr = formatDateDisplay(item.expDate);

        tr.innerHTML = `
            <td style="text-align: center; color: #64748b; font-size: 0.8rem; font-weight: 600;">${idx + 1}</td>
            <td style="text-align: center; font-family: Consolas, monospace; font-weight: 700; color: #0284c7; background: #f0f9ff; font-size: 0.82rem;">${item.tagNo}</td>
            <td style="text-align: left; font-weight: 700; color: #0f172a; font-size: 0.82rem; background: #f0f9ff;">${item.equipName || '-'}</td>
            <td style="text-align: center; font-family: Consolas, monospace; font-weight: 600; color: #334155; font-size: 0.8rem;">${item.cmsPunchTag || item.tagNo}</td>
            <td style="text-align: center; font-family: Consolas, monospace; font-weight: 800; color: #d97706; font-size: 0.82rem;">${item.punchNo || '-'}</td>
            <td style="text-align: left; color: #334155; font-size: 0.8rem; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.tagDesc || ''}">${item.tagDesc || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.8rem;">${item.sys || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.8rem;">${item.subsys || '-'}</td>
            <td style="text-align: left; color: #475569; font-size: 0.78rem; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.pkgName || ''}">${item.pkgName || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.78rem;">${item.disc || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.78rem;">${item.phase || '-'}</td>
            <td style="text-align: center;">${catBadge}</td>
            <td style="text-align: center;">${statusBadge}</td>
            <td style="text-align: center;">${cmsBadge}</td>
            <td style="text-align: center;">${cmsPunchNoCell}</td>
            <td style="text-align: left; color: #0f172a; font-weight: 600; font-size: 0.82rem; line-height: 1.4; min-width: 250px;">${item.desc || '-'}</td>
            <td style="text-align: center; color: #1e293b; font-weight: 600; font-size: 0.8rem;">${item.actionBy || '-'}</td>
            <td style="text-align: center; color: #334155; font-size: 0.78rem; font-family: Consolas, monospace; font-weight: 600;">${openStr}</td>
            <td style="text-align: center; color: #334155; font-size: 0.78rem; font-family: Consolas, monospace; font-weight: 600;">${closeStr}</td>
            <td style="text-align: center; color: #334155; font-size: 0.78rem; font-family: Consolas, monospace; font-weight: 600;">${expStr}</td>
            <td style="text-align: center; white-space: nowrap;">
                <button type="button" class="btn-sw-edit" data-id="${item.id}" style="padding: 3px 6px; font-size: 0.75rem; border: 1px solid #cbd5e1; background: #fff; color: #0284c7; border-radius: 4px; cursor: pointer; margin-right: 3px;" title="Edit Finding">✏️</button>
                <button type="button" class="btn-sw-delete" data-id="${item.id}" style="padding: 3px 6px; font-size: 0.75rem; border: 1px solid #cbd5e1; background: #fff; color: #ef4444; border-radius: 4px; cursor: pointer;" title="Delete Finding">🗑️</button>
            </td>
        `;

        tbody.appendChild(tr);
    });

    // Wire up row buttons
    tbody.querySelectorAll('.btn-sw-edit').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const item = siteWalkdownPunches.find(x => x.id === id);
            if (item) openSitePunchModal(item);
        });
    });

    tbody.querySelectorAll('.btn-sw-delete').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            if (confirm("Are you sure you want to delete this site walkdown finding?")) {
                siteWalkdownPunches = siteWalkdownPunches.filter(x => x.id !== id);
                saveSiteWalkdownPunchesToStorage();
                recalculateMasterCounts();
                renderSiteWalkdownTab();
                const gd = window.GLOBAL_MC_DATA;
                if (gd) {
                    if (gd.matrix) renderMatrix(gd.matrix);
                    if (gd.mcData && gd.dashGroups) renderDashboardWidgets(gd.mcData, gd.dashGroups);
                    if (gd.mcData && gd.sumItr) renderSummaryWidgets(gd.mcData, gd.sumItr, gd.sumPunch, gd.sumDac, gd.sumCssc);
                    if (typeof renderEquipmentSummaryTable === 'function') renderEquipmentSummaryTable();
                }
                autoPersistCurrentData();
            }
        });
    });

    tbody.querySelectorAll('.btn-sw-unlink').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const item = siteWalkdownPunches.find(x => x.id === id);
            if (item) {
                item.officialCmsPunchNo = '';
                if (item.status !== 'CLOSED') {
                    item.cmsStatus = 'PENDING_CMS';
                }
                saveSiteWalkdownPunchesToStorage();
                recalculateMasterCounts();
                renderSiteWalkdownTab();
                const gd = window.GLOBAL_MC_DATA;
                if (gd) {
                    if (gd.matrix) renderMatrix(gd.matrix);
                    if (gd.mcData && gd.dashGroups) renderDashboardWidgets(gd.mcData, gd.dashGroups);
                    if (gd.mcData && gd.sumItr) renderSummaryWidgets(gd.mcData, gd.sumItr, gd.sumPunch, gd.sumDac, gd.sumCssc);
                    if (typeof renderEquipmentSummaryTable === 'function') renderEquipmentSummaryTable();
                }
                autoPersistCurrentData();
            }
        });
    });

    tbody.querySelectorAll('.btn-sw-match-row').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            openSitePunchMatcherModal(id);
        });
    });
}

// 5. Modal Operations (Add / Edit)
function openSitePunchModal(itemToEdit) {
    const modal = document.getElementById('site-punch-modal');
    if (!modal) return;

    populateSitePunchDatalist();

    const title = document.getElementById('sw-modal-title');
    const formId = document.getElementById('sw-form-id');
    const formTag = document.getElementById('sw-form-tag');
    const formEquip = document.getElementById('sw-form-equip-name');
    const formCmsTag = document.getElementById('sw-form-cms-tag');
    const formDesc = document.getElementById('sw-form-tag-desc');
    const formSys = document.getElementById('sw-form-sys');
    const formSubsys = document.getElementById('sw-form-subsys');
    const formPkg = document.getElementById('sw-form-pkg');
    const formPunchNo = document.getElementById('sw-form-punch-no');
    const formDisc = document.getElementById('sw-form-disc');
    const formPhase = document.getElementById('sw-form-phase');
    const formCat = document.getElementById('sw-form-cat');
    const formStatus = document.getElementById('sw-form-status');
    const formActionBy = document.getElementById('sw-form-action-by');
    const formDefect = document.getElementById('sw-form-desc');
    const formOpenDate = document.getElementById('sw-form-open-date');
    const formCloseDate = document.getElementById('sw-form-close-date');
    const formExpDate = document.getElementById('sw-form-exp-date');
    const formCmsStatus = document.getElementById('sw-form-cms-status');
    const formCmsPunchNo = document.getElementById('sw-form-cms-punch-no');
    const suggestionBox = document.getElementById('sw-cms-suggestion-box');

    if (itemToEdit) {
        currentSwEditingId = itemToEdit.id;
        if (title) title.innerHTML = `✏️ Edit Site Walkdown Finding &nbsp;<span style="color: #facc15; font-size: 0.9rem;">(${itemToEdit.punchNo})</span>`;
        if (formId) formId.value = itemToEdit.id;
        if (formTag) formTag.value = itemToEdit.tagNo || '';
        if (formEquip) formEquip.value = itemToEdit.equipName || '';
        if (formCmsTag) formCmsTag.value = itemToEdit.cmsPunchTag || '';
        if (formDesc) formDesc.value = itemToEdit.tagDesc || '';
        if (formSys) formSys.value = itemToEdit.sys || '';
        if (formSubsys) formSubsys.value = itemToEdit.subsys || '';
        if (formPkg) formPkg.value = itemToEdit.pkgName || '';
        if (formPunchNo) formPunchNo.value = itemToEdit.punchNo || '';
        if (formDisc) formDisc.value = itemToEdit.disc || 'MECHANICAL';
        if (formPhase) formPhase.value = itemToEdit.phase || 'LQ-OSD';
        if (formCat) formCat.value = itemToEdit.cat || 'B';
        if (formStatus) formStatus.value = itemToEdit.status || 'OPEN';
        if (formActionBy) formActionBy.value = itemToEdit.actionBy || 'MDR/VENDOR';
        if (formDefect) formDefect.value = itemToEdit.desc || '';
        if (formOpenDate) formOpenDate.value = itemToEdit.openDate ? itemToEdit.openDate.slice(0, 10) : '';
        if (formCloseDate) formCloseDate.value = itemToEdit.closeDate ? itemToEdit.closeDate.slice(0, 10) : '';
        if (formExpDate) formExpDate.value = itemToEdit.expDate ? itemToEdit.expDate.slice(0, 10) : '';
        if (formCmsStatus) formCmsStatus.value = itemToEdit.cmsStatus || 'PENDING_CMS';
        if (formCmsPunchNo) formCmsPunchNo.value = itemToEdit.officialCmsPunchNo || '';
    } else {
        currentSwEditingId = null;
        if (title) title.innerHTML = `📝 Add Site Walkdown Finding`;
        if (formId) formId.value = '';
        if (formTag) formTag.value = '';
        if (formEquip) formEquip.value = '';
        if (formCmsTag) formCmsTag.value = '';
        if (formDesc) formDesc.value = '';
        if (formSys) formSys.value = '';
        if (formSubsys) formSubsys.value = '';
        if (formPkg) formPkg.value = '';

        // Generate next Punch No sequence (e.g. SW-003)
        const nextNum = siteWalkdownPunches.length + 1;
        const nextSeq = `SW-${String(nextNum).padStart(3, '0')}`;
        if (formPunchNo) formPunchNo.value = nextSeq;

        if (formDisc) formDisc.value = 'MECHANICAL';
        if (formPhase) formPhase.value = 'LQ-OSD';
        if (formCat) formCat.value = 'B';
        if (formStatus) formStatus.value = 'OPEN';
        if (formActionBy) formActionBy.value = 'MDR/VENDOR';
        if (formDefect) formDefect.value = '';

        // Default openDate to today
        const todayStr = new Date().toISOString().slice(0, 10);
        if (formOpenDate) formOpenDate.value = todayStr;
        if (formCloseDate) formCloseDate.value = '';
        if (formExpDate) formExpDate.value = '';
        if (formCmsStatus) formCmsStatus.value = 'PENDING_CMS';
        if (formCmsPunchNo) formCmsPunchNo.value = '';
    }

    // Refresh suggestions box
    updateModalSuggestions();

    modal.style.display = 'flex';
}

function closeSitePunchModal() {
    const modal = document.getElementById('site-punch-modal');
    if (modal) modal.style.display = 'none';
    currentSwEditingId = null;
}

function updateModalSuggestions() {
    const formTag = document.getElementById('sw-form-tag');
    const formDefect = document.getElementById('sw-form-desc');
    const formCmsPunchNo = document.getElementById('sw-form-cms-punch-no');
    const suggestionBox = document.getElementById('sw-cms-suggestion-box');
    if (!suggestionBox) return;

    if (!formTag || !formTag.value) {
        suggestionBox.style.display = 'none';
        return;
    }

    const suggestions = findSmartCmsSuggestions(formTag.value, formDefect ? formDefect.value : '');
    if (suggestions.length === 0) {
        suggestionBox.style.display = 'none';
        return;
    }

    let html = `<b>💡 Available CMS Punches for this Tag:</b><div style="display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.35rem;">`;
    suggestions.forEach(s => {
        const p = s.punch;
        html += `
            <div style="display: flex; align-items: center; justify-content: space-between; background: rgba(0,0,0,0.3); padding: 4px 8px; border-radius: 4px;">
                <div>
                    <b style="color: #38bdf8; font-family: monospace;">${p.punchNo}</b>
                    <span style="color: #94a3b8; font-size: 0.72rem; margin-left: 6px;">[${p.status || 'OPEN'}] Cat ${p.cat || 'B'}</span>
                    <span style="color: #cbd5e1; margin-left: 8px;">${(p.desc || '').slice(0, 55)}...</span>
                </div>
                <button type="button" class="btn-sw-apply-sugg" data-no="${p.punchNo}" data-status="${p.status || 'OPEN'}" style="background: #0284c7; border: none; color: #fff; padding: 2px 8px; border-radius: 4px; font-size: 0.72rem; font-weight: 700; cursor: pointer;">
                    Link
                </button>
            </div>
        `;
    });
    html += `</div>`;

    suggestionBox.innerHTML = html;
    suggestionBox.style.display = 'block';

    suggestionBox.querySelectorAll('.btn-sw-apply-sugg').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const no = e.currentTarget.dataset.no;
            const status = e.currentTarget.dataset.status;
            if (formCmsPunchNo) formCmsPunchNo.value = no;
            const formCmsStatus = document.getElementById('sw-form-cms-status');
            const formStatus = document.getElementById('sw-form-status');
            if (status.toUpperCase().includes('CLOSE')) {
                if (formCmsStatus) formCmsStatus.value = 'CLOSED';
                if (formStatus) formStatus.value = 'CLOSED';
            } else {
                if (formCmsStatus) formCmsStatus.value = 'IN_CMS';
            }
        });
    });
}

function saveSitePunchFromModal() {
    const formId = document.getElementById('sw-form-id');
    const formTag = document.getElementById('sw-form-tag');
    const formEquip = document.getElementById('sw-form-equip-name');
    const formCmsTag = document.getElementById('sw-form-cms-tag');
    const formDesc = document.getElementById('sw-form-tag-desc');
    const formSys = document.getElementById('sw-form-sys');
    const formSubsys = document.getElementById('sw-form-subsys');
    const formPkg = document.getElementById('sw-form-pkg');
    const formPunchNo = document.getElementById('sw-form-punch-no');
    const formDisc = document.getElementById('sw-form-disc');
    const formPhase = document.getElementById('sw-form-phase');
    const formCat = document.getElementById('sw-form-cat');
    const formStatus = document.getElementById('sw-form-status');
    const formActionBy = document.getElementById('sw-form-action-by');
    const formDefect = document.getElementById('sw-form-desc');
    const formOpenDate = document.getElementById('sw-form-open-date');
    const formCloseDate = document.getElementById('sw-form-close-date');
    const formExpDate = document.getElementById('sw-form-exp-date');
    const formCmsStatus = document.getElementById('sw-form-cms-status');
    const formCmsPunchNo = document.getElementById('sw-form-cms-punch-no');

    const tagNo = formTag ? formTag.value.trim() : '';
    const defectText = formDefect ? formDefect.value.trim() : '';

    if (!tagNo) {
        alert("Please enter a valid Tag No.");
        if (formTag) formTag.focus();
        return;
    }

    if (!defectText) {
        alert("Please enter Defect Description.");
        if (formDefect) formDefect.focus();
        return;
    }

    // Auto-fill lookup if empty
    const lookup = lookupTagDetails(tagNo);
    const equipName = (formEquip && formEquip.value) ? formEquip.value : (lookup ? lookup.equipName : tagNo);
    const cmsPunchTag = (formCmsTag && formCmsTag.value) ? formCmsTag.value : (lookup ? lookup.cmsPunchTag : tagNo);
    const tagDesc = (formDesc && formDesc.value) ? formDesc.value : (lookup ? lookup.tagDesc : '');
    const sys = (formSys && formSys.value) ? formSys.value : (lookup ? lookup.sys : '');
    const subsys = (formSubsys && formSubsys.value) ? formSubsys.value : (lookup ? lookup.subsys : '');
    const pkgName = (formPkg && formPkg.value) ? formPkg.value : (lookup ? lookup.pkgName : '');

    const punchNo = formPunchNo && formPunchNo.value.trim() ? formPunchNo.value.trim() : `SW-${String(siteWalkdownPunches.length + 1).padStart(3, '0')}`;
    const disc = formDisc ? formDisc.value : 'MECHANICAL';
    const phase = formPhase ? formPhase.value : 'LQ-OSD';
    const cat = formCat ? formCat.value : 'B';
    const status = formStatus ? formStatus.value : 'OPEN';
    const actionBy = formActionBy ? formActionBy.value.trim() : 'MDR/VENDOR';
    const openDate = formOpenDate ? formOpenDate.value : '';
    const closeDate = formCloseDate ? formCloseDate.value : '';
    const expDate = formExpDate ? formExpDate.value : '';
    let cmsStatus = formCmsStatus ? formCmsStatus.value : 'PENDING_CMS';
    const officialCmsPunchNo = formCmsPunchNo ? formCmsPunchNo.value.trim().toUpperCase() : '';

    if (officialCmsPunchNo && cmsStatus === 'PENDING_CMS') {
        cmsStatus = status === 'CLOSED' ? 'CLOSED' : 'IN_CMS';
    }

    if (currentSwEditingId) {
        // Edit existing
        const idx = siteWalkdownPunches.findIndex(x => x.id === currentSwEditingId);
        if (idx !== -1) {
            siteWalkdownPunches[idx] = {
                ...siteWalkdownPunches[idx],
                tagNo: tagNo,
                equipName: equipName,
                cmsPunchTag: cmsPunchTag,
                punchNo: punchNo,
                tagDesc: tagDesc,
                sys: sys,
                subsys: subsys,
                pkgName: pkgName,
                disc: disc,
                phase: phase,
                cat: cat,
                status: status,
                cmsStatus: cmsStatus,
                officialCmsPunchNo: officialCmsPunchNo,
                desc: defectText,
                actionBy: actionBy,
                openDate: openDate,
                closeDate: closeDate,
                expDate: expDate,
                updatedAt: new Date().toISOString()
            };
        }
    } else {
        // Create new
        const newFinding = {
            id: `SW-${Date.now()}`,
            tagNo: tagNo,
            equipName: equipName,
            cmsPunchTag: cmsPunchTag,
            punchNo: punchNo,
            tagDesc: tagDesc,
            sys: sys,
            subsys: subsys,
            pkgName: pkgName,
            disc: disc,
            phase: phase,
            cat: cat,
            status: status,
            cmsStatus: cmsStatus,
            officialCmsPunchNo: officialCmsPunchNo,
            desc: defectText,
            actionBy: actionBy,
            openDate: openDate || new Date().toISOString().slice(0, 10),
            closeDate: closeDate,
            expDate: expDate,
            createdAt: new Date().toISOString()
        };
        siteWalkdownPunches.unshift(newFinding);
    }

    saveSiteWalkdownPunchesToStorage();
    closeSitePunchModal();
    recalculateMasterCounts();
    renderSiteWalkdownTab();
    const gd = window.GLOBAL_MC_DATA;
    if (gd) {
        if (gd.matrix) renderMatrix(gd.matrix);
        if (gd.mcData && gd.dashGroups) renderDashboardWidgets(gd.mcData, gd.dashGroups);
        if (gd.mcData && gd.sumItr) renderSummaryWidgets(gd.mcData, gd.sumItr, gd.sumPunch, gd.sumDac, gd.sumCssc);
        if (typeof renderEquipmentSummaryTable === 'function') renderEquipmentSummaryTable();
    }
    autoPersistCurrentData();
}

// 6. Matcher Modal Operations
function openSitePunchMatcherModal(sitePunchId) {
    const item = siteWalkdownPunches.find(x => x.id === sitePunchId);
    if (!item) return;

    currentSwMatchingId = sitePunchId;
    const modal = document.getElementById('site-punch-matcher-modal');
    const subtitle = document.getElementById('sw-matcher-subtitle');
    const listEl = document.getElementById('sw-matcher-list');
    if (!modal || !listEl) return;

    if (subtitle) {
        subtitle.innerHTML = `Linking Finding: <b style="color: #facc15;">${item.punchNo}</b> on Tag: <b style="color: #38bdf8;">${item.tagNo}</b> (${item.equipName})`;
    }

    const gd = window.GLOBAL_MC_DATA;
    const punchList = gd ? (gd.globalPunchList || []) : [];
    const cleanTag = String(item.tagNo || '').trim().toUpperCase();

    // Find all CMS punches matching tag or package
    const matches = punchList.filter(p => {
        const ptag = String(p.tag || '').trim().toUpperCase();
        return ptag === cleanTag || ptag.includes(cleanTag) || cleanTag.includes(ptag);
    });

    if (matches.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #94a3b8; background: rgba(15, 23, 42, 0.6); border-radius: 8px;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
                <div style="font-weight: 700; color: #f8fafc; font-size: 0.95rem;">No Official CMS Punches Found for Tag ${item.tagNo}</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">Contractor has not raised any punch with this Tag No in the current CMS file.</div>
            </div>
        `;
    } else {
        let html = '';
        matches.forEach(p => {
            const isClosed = String(p.status || '').toUpperCase().includes('CLOSE');
            const statusBadge = isClosed
                ? `<span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">CLOSED</span>`
                : `<span style="background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">OPEN</span>`;

            html += `
                <div style="background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <span style="font-family: Consolas, monospace; font-size: 0.95rem; font-weight: 800; color: #38bdf8;">${p.punchNo}</span>
                            <span style="font-family: Consolas, monospace; font-size: 0.8rem; color: #94a3b8;">${p.tag}</span>
                            ${statusBadge}
                            <span style="font-size: 0.75rem; color: #fbbf24; font-weight: 700;">Cat ${p.cat || 'B'}</span>
                            <span style="font-size: 0.75rem; color: #94a3b8;">• ${p.disc || ''}</span>
                        </div>
                        <div style="font-size: 0.82rem; color: #e2e8f0; line-height: 1.4;">${p.desc || '-'}</div>
                    </div>
                    <button type="button" class="btn-sw-link-cms" data-no="${p.punchNo}" data-status="${p.status || 'OPEN'}" style="background: #10b981; border: none; color: #fff; padding: 0.45rem 1rem; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; white-space: nowrap; display: inline-flex; align-items: center; gap: 0.35rem;">
                        🔗 Link this Punch
                    </button>
                </div>
            `;
        });
        listEl.innerHTML = html;

        listEl.querySelectorAll('.btn-sw-link-cms').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const punchNo = e.currentTarget.dataset.no;
                const pStatus = e.currentTarget.dataset.status;
                linkCmsPunchToFinding(currentSwMatchingId, punchNo, pStatus);
                modal.style.display = 'none';
            });
        });
    }

    modal.style.display = 'flex';
}

function linkCmsPunchToFinding(sitePunchId, officialNo, cmsStatusStr) {
    const item = siteWalkdownPunches.find(x => x.id === sitePunchId);
    if (!item) return;

    item.officialCmsPunchNo = officialNo;
    const isClosed = String(cmsStatusStr || '').toUpperCase().includes('CLOSE');
    if (isClosed) {
        item.cmsStatus = 'CLOSED';
        item.status = 'CLOSED';
    } else {
        item.cmsStatus = 'IN_CMS';
    }

    saveSiteWalkdownPunchesToStorage();
    recalculateMasterCounts();
    renderSiteWalkdownTab();
    const gd = window.GLOBAL_MC_DATA;
    if (gd) {
        if (gd.matrix) renderMatrix(gd.matrix);
        if (gd.mcData && gd.dashGroups) renderDashboardWidgets(gd.mcData, gd.dashGroups);
        if (gd.mcData && gd.sumItr) renderSummaryWidgets(gd.mcData, gd.sumItr, gd.sumPunch, gd.sumDac, gd.sumCssc);
        if (typeof renderEquipmentSummaryTable === 'function') renderEquipmentSummaryTable();
    }
    autoPersistCurrentData();
}

// 7. Export to Excel (Styled Multi-Column Report)
async function exportSiteWalkdownPunchesToExcel() {
    if (!siteWalkdownPunches || siteWalkdownPunches.length === 0) {
        alert("No site walkdown punches to export.");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "Block B LQP Mechanical Completion";
        workbook.created = new Date();

        const worksheet = workbook.addWorksheet("Site Walkdown Punches", {
            views: [{ state: 'frozen', ySplit: 1, showGridLines: true }]
        });
        worksheet.autoFilter = 'A1:U1';

        worksheet.columns = [
            { header: '#', key: 'no', width: 6 },
            { header: 'TAG NO', key: 'tagNo', width: 22 },
            { header: 'EQUIPMENT NAME', key: 'equipName', width: 34 },
            { header: 'CMS PUNCH TAG NO', key: 'cmsPunchTag', width: 24 },
            { header: 'SITE PUNCH NO', key: 'punchNo', width: 16 },
            { header: 'TAG DESCRIPTION', key: 'tagDesc', width: 32 },
            { header: 'SYSTEM', key: 'sys', width: 12 },
            { header: 'SUBSYSTEM', key: 'subsys', width: 14 },
            { header: 'PACKAGE NAME', key: 'pkgName', width: 34 },
            { header: 'DISCIPLINE', key: 'disc', width: 15 },
            { header: 'PHASE', key: 'phase', width: 12 },
            { header: 'CAT', key: 'cat', width: 10 },
            { header: 'STATUS', key: 'status', width: 12 },
            { header: 'CMS TRACKING', key: 'cmsStatus', width: 20 },
            { header: 'OFFICIAL CMS PUNCH NO', key: 'officialCmsPunchNo', width: 24 },
            { header: 'DEFECT DESCRIPTION', key: 'desc', width: 50 },
            { header: 'ACTION BY', key: 'actionBy', width: 16 },
            { header: 'OPEN DATE', key: 'openDate', width: 14 },
            { header: 'CLOSED DATE', key: 'closeDate', width: 14 },
            { header: 'EXPECTED DATE', key: 'expDate', width: 14 }
        ];

        // Format Header Row
        const headerRow = worksheet.getRow(1);
        headerRow.height = 28;
        const headerBorder = {
            top: { style: 'thin', color: { argb: 'FF0F172A' } },
            left: { style: 'thin', color: { argb: 'FF0F172A' } },
            bottom: { style: 'medium', color: { argb: 'FF0F172A' } },
            right: { style: 'thin', color: { argb: 'FF0F172A' } }
        };

        headerRow.eachCell((cell, colNumber) => {
            let bgArgb = 'FF1E293B';
            if (colNumber === 2 || colNumber === 3 || colNumber === 4) {
                bgArgb = 'FF0369A1'; // Tag & Equip highlight
            } else if (colNumber === 14 || colNumber === 15) {
                bgArgb = 'FFD97706'; // CMS Tracking highlight
            }
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgArgb } };
            cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
            cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
            cell.border = headerBorder;
        });

        const cellBorder = {
            top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            left: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
            right: { style: 'thin', color: { argb: 'FFCBD5E1' } }
        };

        let exportList = siteWalkdownPunches;
        if (currentSwCmsFilter === 'PENDING_CMS') {
            exportList = exportList.filter(p => p.cmsStatus === 'PENDING_CMS');
        } else if (currentSwCmsFilter === 'IN_CMS') {
            exportList = exportList.filter(p => p.cmsStatus === 'IN_CMS' && p.status !== 'CLOSED');
        } else if (currentSwCmsFilter === 'CLOSED') {
            exportList = exportList.filter(p => p.status === 'CLOSED');
        }
        if (currentSwDiscFilter !== 'ALL') {
            exportList = exportList.filter(p => p.disc === currentSwDiscFilter);
        }
        if (currentSwSearch) {
            const q = currentSwSearch.toLowerCase();
            exportList = exportList.filter(p => {
                const tagMatch = (p.tagNo || '').toLowerCase().includes(q);
                const equipMatch = (p.equipName || '').toLowerCase().includes(q);
                const punchMatch = (p.punchNo || '').toLowerCase().includes(q);
                const cmsPunchMatch = (p.officialCmsPunchNo || '').toLowerCase().includes(q);
                const descMatch = (p.desc || '').toLowerCase().includes(q);
                const subsysMatch = (p.subsys || '').toLowerCase().includes(q);
                const pkgMatch = (p.pkgName || '').toLowerCase().includes(q);
                return tagMatch || equipMatch || punchMatch || cmsPunchMatch || descMatch || subsysMatch || pkgMatch;
            });
        }
        if (currentSwPkgSearch) {
            const pq = currentSwPkgSearch.toLowerCase().trim();
            exportList = exportList.filter(p => (p.pkgName || '').toLowerCase().includes(pq));
        }

        exportList.forEach((p, idx) => {
            let cmsText = 'PENDING CMS';
            if (p.status === 'CLOSED' || p.cmsStatus === 'CLOSED') cmsText = 'CLOSED';
            else if (p.cmsStatus === 'IN_CMS' || p.officialCmsPunchNo) cmsText = 'IN CMS (OPEN)';

            const row = worksheet.addRow({
                no: idx + 1,
                tagNo: p.tagNo,
                equipName: p.equipName,
                cmsPunchTag: p.cmsPunchTag || p.tagNo,
                punchNo: p.punchNo,
                tagDesc: p.tagDesc,
                sys: p.sys,
                subsys: p.subsys,
                pkgName: p.pkgName,
                disc: p.disc,
                phase: p.phase,
                cat: p.cat,
                status: p.status,
                cmsStatus: cmsText,
                officialCmsPunchNo: p.officialCmsPunchNo || '-',
                desc: p.desc,
                actionBy: p.actionBy,
                openDate: formatDateDisplay(p.openDate),
                closeDate: formatDateDisplay(p.closeDate),
                expDate: formatDateDisplay(p.expDate)
            });

            row.height = 22;

            row.eachCell((cell, colNum) => {
                cell.font = { name: 'Segoe UI', size: 9.5 };
                cell.border = cellBorder;
                cell.alignment = { vertical: 'middle', horizontal: 'center' };

                if (colNum === 2) {
                    cell.font = { name: 'Consolas', size: 10, bold: true, color: { argb: 'FF0369A1' } };
                } else if (colNum === 3 || colNum === 6 || colNum === 9 || colNum === 16) {
                    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: (colNum === 16) };
                } else if (colNum === 5 || colNum === 15) {
                    cell.font = { name: 'Consolas', size: 9.5, bold: true };
                } else if (colNum === 13) {
                    if (p.status === 'CLOSED') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF15803D' } };
                    } else {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
                    }
                } else if (colNum === 14) {
                    if (cmsText === 'CLOSED') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDCFCE7' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FF15803D' } };
                    } else if (cmsText === 'IN CMS (OPEN)') {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEE2E2' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB91C1C' } };
                    } else {
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDF6B2' } };
                        cell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FFB45309' } };
                    }
                }
            });
        });

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
        a.download = `Site_Walkdown_Punches_${nowStr}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (err) {
        console.error("Export Error:", err);
        alert("Failed to export Site Walkdown Punches: " + err.message);
    }
}

// 8. Backup & Restore (JSON)
function backupSiteWalkdownPunchesJson() {
    if (!siteWalkdownPunches || siteWalkdownPunches.length === 0) {
        alert("No site walkdown data to backup.");
        return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(siteWalkdownPunches, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    const nowStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    a.download = `Site_Walkdown_Punches_Backup_${nowStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function restoreSiteWalkdownPunchesJson(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (Array.isArray(data)) {
                siteWalkdownPunches = data;
                saveSiteWalkdownPunchesToStorage();
                if (typeof recalculateMasterCounts === 'function') recalculateMasterCounts();
                renderSiteWalkdownTab();
                autoPersistCurrentData();
                alert(`Successfully restored ${data.length} site walkdown findings!`);
            } else {
                alert("Invalid backup file format. Expected a JSON array.");
            }
        } catch (err) {
            alert("Failed to parse backup file: " + err.message);
        }
    };
    reader.readAsText(file);
}

// 9. Setup Event Handlers
function initSiteWalkdownTab() {
    if (isSiteWalkdownInitialized) return;
    isSiteWalkdownInitialized = true;

    loadSiteWalkdownPunches();
    populateSitePunchDatalist();

    // Add button
    const btnAdd = document.getElementById('btn-add-site-punch');
    if (btnAdd) {
        btnAdd.addEventListener('click', () => openSitePunchModal(null));
    }

    // Filter CMS Status buttons
    const btnAll = document.getElementById('sw-filter-all');
    const btnPending = document.getElementById('sw-filter-pending');
    const btnInCms = document.getElementById('sw-filter-in-cms');
    const btnClosed = document.getElementById('sw-filter-closed');

    const updateFilterStyles = () => {
        if (btnAll) {
            btnAll.style.background = currentSwCmsFilter === 'ALL' ? '#0ea5e9' : '#fff';
            btnAll.style.color = currentSwCmsFilter === 'ALL' ? '#fff' : '#0f172a';
        }
        if (btnPending) {
            btnPending.style.background = currentSwCmsFilter === 'PENDING_CMS' ? '#f59e0b' : '#fff';
            btnPending.style.color = currentSwCmsFilter === 'PENDING_CMS' ? '#fff' : '#b45309';
        }
        if (btnInCms) {
            btnInCms.style.background = currentSwCmsFilter === 'IN_CMS' ? '#ef4444' : '#fff';
            btnInCms.style.color = currentSwCmsFilter === 'IN_CMS' ? '#fff' : '#dc2626';
        }
        if (btnClosed) {
            btnClosed.style.background = currentSwCmsFilter === 'CLOSED' ? '#10b981' : '#fff';
            btnClosed.style.color = currentSwCmsFilter === 'CLOSED' ? '#fff' : '#16a34a';
        }
    };

    if (btnAll) {
        btnAll.addEventListener('click', () => { currentSwCmsFilter = 'ALL'; updateFilterStyles(); renderSiteWalkdownTab(); });
    }
    if (btnPending) {
        btnPending.addEventListener('click', () => { currentSwCmsFilter = 'PENDING_CMS'; updateFilterStyles(); renderSiteWalkdownTab(); });
    }
    if (btnInCms) {
        btnInCms.addEventListener('click', () => { currentSwCmsFilter = 'IN_CMS'; updateFilterStyles(); renderSiteWalkdownTab(); });
    }
    if (btnClosed) {
        btnClosed.addEventListener('click', () => { currentSwCmsFilter = 'CLOSED'; updateFilterStyles(); renderSiteWalkdownTab(); });
    }

    // Discipline filter
    const discSelect = document.getElementById('sw-filter-disc');
    if (discSelect) {
        discSelect.addEventListener('change', (e) => {
            currentSwDiscFilter = e.target.value;
            renderSiteWalkdownTab();
        });
    }

    // Search input
    const searchInput = document.getElementById('sw-search-input');
    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSwSearch = e.target.value.trim();
            renderSiteWalkdownTab();
        });
    }

    // Package No Search input
    const swPkgInput = document.getElementById('sw-package-search-input');
    if (swPkgInput) {
        swPkgInput.addEventListener('input', (e) => {
            currentSwPkgSearch = e.target.value.trim();
            renderSiteWalkdownTab();
        });
    }

    // Export Excel button
    const btnExport = document.getElementById('btn-export-sw-excel');
    if (btnExport) {
        btnExport.addEventListener('click', exportSiteWalkdownPunchesToExcel);
    }

    // Backup & Restore
    const btnBackup = document.getElementById('btn-backup-sw-json');
    if (btnBackup) {
        btnBackup.addEventListener('click', backupSiteWalkdownPunchesJson);
    }
    const restoreInput = document.getElementById('sw-restore-input');
    if (restoreInput) {
        restoreInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                restoreSiteWalkdownPunchesJson(e.target.files[0]);
                e.target.value = '';
            }
        });
    }

    // Modal controls
    const modalClose = document.getElementById('sw-modal-close');
    const btnCancel = document.getElementById('btn-sw-cancel');
    const btnSave = document.getElementById('btn-sw-save');
    const formTagInput = document.getElementById('sw-form-tag');
    const formDefectInput = document.getElementById('sw-form-desc');
    const btnPickCms = document.getElementById('btn-sw-pick-cms');

    if (modalClose) modalClose.addEventListener('click', closeSitePunchModal);
    if (btnCancel) btnCancel.addEventListener('click', closeSitePunchModal);
    if (btnSave) btnSave.addEventListener('click', saveSitePunchFromModal);

    // Tag No auto-lookup on change/input
    if (formTagInput) {
        const handleTagChange = () => {
            const rawTag = formTagInput.value.trim();
            const formEquip = document.getElementById('sw-form-equip-name');
            const formCmsTag = document.getElementById('sw-form-cms-tag');
            const formDesc = document.getElementById('sw-form-tag-desc');
            const formSys = document.getElementById('sw-form-sys');
            const formSubsys = document.getElementById('sw-form-subsys');
            const formPkg = document.getElementById('sw-form-pkg');
            const formDisc = document.getElementById('sw-form-disc');

            if (!rawTag) {
                updateModalSuggestions();
                return;
            }

            const lookup = lookupTagDetails(rawTag);
            if (lookup) {
                if (formEquip) formEquip.value = lookup.equipName || '';
                if (formCmsTag) formCmsTag.value = lookup.cmsPunchTag || rawTag;
                if (formDesc) formDesc.value = lookup.tagDesc || '';
                if (formSys) formSys.value = lookup.sys || '';
                if (formSubsys) formSubsys.value = lookup.subsys || '';
                if (formPkg) formPkg.value = lookup.pkgName || '';
                if (formDisc && lookup.disc) formDisc.value = lookup.disc;
            } else {
                if (formCmsTag) formCmsTag.value = rawTag;
            }
            updateModalSuggestions();
        };

        formTagInput.addEventListener('input', handleTagChange);
        formTagInput.addEventListener('change', handleTagChange);
    }

    if (formDefectInput) {
        formDefectInput.addEventListener('input', updateModalSuggestions);
    }

    if (btnPickCms) {
        btnPickCms.addEventListener('click', () => {
            const rawTag = formTagInput ? formTagInput.value.trim() : '';
            if (!rawTag) {
                alert("Please enter Tag No first to view matching CMS punches.");
                return;
            }
            openSitePunchMatcherModalForTag(rawTag);
        });
    }

    // Matcher modal close
    const matcherClose = document.getElementById('sw-matcher-close');
    const matcherCancel = document.getElementById('sw-matcher-cancel');
    const matcherModal = document.getElementById('site-punch-matcher-modal');
    if (matcherClose) matcherClose.addEventListener('click', () => { if (matcherModal) matcherModal.style.display = 'none'; });
    if (matcherCancel) matcherCancel.addEventListener('click', () => { if (matcherModal) matcherModal.style.display = 'none'; });

    renderSiteWalkdownTab();
}

function openSitePunchMatcherModalForTag(tagNo) {
    const modal = document.getElementById('site-punch-matcher-modal');
    const subtitle = document.getElementById('sw-matcher-subtitle');
    const listEl = document.getElementById('sw-matcher-list');
    if (!modal || !listEl) return;

    if (subtitle) {
        subtitle.innerHTML = `Available CMS Punches for Tag: <b style="color: #38bdf8;">${tagNo}</b>`;
    }

    const gd = window.GLOBAL_MC_DATA;
    const punchList = gd ? (gd.globalPunchList || []) : [];
    const cleanTag = String(tagNo).trim().toUpperCase();

    const matches = punchList.filter(p => {
        const ptag = String(p.tag || '').trim().toUpperCase();
        return ptag === cleanTag || ptag.includes(cleanTag) || cleanTag.includes(ptag);
    });

    if (matches.length === 0) {
        listEl.innerHTML = `
            <div style="text-align: center; padding: 2rem; color: #94a3b8; background: rgba(15, 23, 42, 0.6); border-radius: 8px;">
                <div style="font-size: 2rem; margin-bottom: 0.5rem;">⚠️</div>
                <div style="font-weight: 700; color: #f8fafc; font-size: 0.95rem;">No Official CMS Punches Found for Tag ${tagNo}</div>
                <div style="font-size: 0.8rem; color: #64748b; margin-top: 4px;">Contractor has not raised any punch with this Tag No in the current CMS file.</div>
            </div>
        `;
    } else {
        let html = '';
        matches.forEach(p => {
            const isClosed = String(p.status || '').toUpperCase().includes('CLOSE');
            const statusBadge = isClosed
                ? `<span style="background: #dcfce7; color: #15803d; border: 1px solid #86efac; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">CLOSED</span>`
                : `<span style="background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5; padding: 2px 8px; border-radius: 4px; font-weight: 800; font-size: 0.72rem;">OPEN</span>`;

            html += `
                <div style="background: rgba(30, 41, 59, 0.7); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; padding: 0.85rem 1rem; display: flex; justify-content: space-between; align-items: center; gap: 1rem;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.35rem;">
                            <span style="font-family: Consolas, monospace; font-size: 0.95rem; font-weight: 800; color: #38bdf8;">${p.punchNo}</span>
                            <span style="font-family: Consolas, monospace; font-size: 0.8rem; color: #94a3b8;">${p.tag}</span>
                            ${statusBadge}
                            <span style="font-size: 0.75rem; color: #fbbf24; font-weight: 700;">Cat ${p.cat || 'B'}</span>
                            <span style="font-size: 0.75rem; color: #94a3b8;">• ${p.disc || ''}</span>
                        </div>
                        <div style="font-size: 0.82rem; color: #e2e8f0; line-height: 1.4;">${p.desc || '-'}</div>
                    </div>
                    <button type="button" class="btn-sw-pick-from-modal" data-no="${p.punchNo}" data-status="${p.status || 'OPEN'}" style="background: #10b981; border: none; color: #fff; padding: 0.45rem 1rem; border-radius: 6px; font-weight: 700; font-size: 0.8rem; cursor: pointer; white-space: nowrap;">
                        Select
                    </button>
                </div>
            `;
        });
        listEl.innerHTML = html;

        listEl.querySelectorAll('.btn-sw-pick-from-modal').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const punchNo = e.currentTarget.dataset.no;
                const pStatus = e.currentTarget.dataset.status;
                const formCmsPunchNo = document.getElementById('sw-form-cms-punch-no');
                const formCmsStatus = document.getElementById('sw-form-cms-status');
                const formStatus = document.getElementById('sw-form-status');

                if (formCmsPunchNo) formCmsPunchNo.value = punchNo;
                if (pStatus.toUpperCase().includes('CLOSE')) {
                    if (formCmsStatus) formCmsStatus.value = 'CLOSED';
                    if (formStatus) formStatus.value = 'CLOSED';
                } else {
                    if (formCmsStatus) formCmsStatus.value = 'IN_CMS';
                }
                modal.style.display = 'none';
            });
        });
    }

    modal.style.display = 'flex';
}

// Auto-run init on script execution
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSiteWalkdownTab);
} else {
    setTimeout(initSiteWalkdownTab, 200);
}



function renderPrecomTab() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    recalculatePrecomMasterCounts();
    populatePrecomSysDropdown();
    renderPrecomWidgets();
    renderPrecomMatrix();
}
window.renderPrecomTab = renderPrecomTab;

function recalculatePrecomMasterCounts() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    if (!gd.precomMatrix) return;

    // 1. Manual ITR-B lookup
    const manualDoneLookup = new Map();
    if (gd.globalCompletedPrecomChecksheets) {
        gd.globalCompletedPrecomChecksheets.forEach(man => {
            const mDateVal = man.dateStr || man.compDate || man.manualDate || '';
            if (man.isManual && mDateVal) {
                const key1 = `${man.subsys}|${man.disc}|${man.tag}|${man.formNo || ''}`;
                const key2 = `${man.subsys}|${man.disc}|${man.tag}|`;
                manualDoneLookup.set(key1, mDateVal);
                manualDoneLookup.set(key2, mDateVal);
            }
        });
    }

    // 2. Iterate globalPrecomChecksheetMap
    let totalItrBDone = 0;
    const discDoneCounts = {};
    ACTIVE_PRECOM_DISCS.forEach(d => discDoneCounts[d] = 0);

    if (gd.globalPrecomChecksheetMap) {
        Object.keys(gd.globalPrecomChecksheetMap).forEach(sub => {
            Object.keys(gd.globalPrecomChecksheetMap[sub]).forEach(disc => {
                let subDiscDone = 0;
                gd.globalPrecomChecksheetMap[sub][disc].forEach(item => {
                    if (item.cmsDate === undefined) {
                        item.cmsDate = (item.isDone && !item.isManual) ? (item.compDate || '') : '';
                    }
                    const mKey1 = `${sub}|${disc}|${item.tag}|${item.type}`;
                    const mKey2 = `${sub}|${disc}|${item.tag}|`;
                    const mDate = manualDoneLookup.get(mKey1) || manualDoneLookup.get(mKey2) || item.manualDate || '';
                    item.manualDate = mDate;
                    item.isManual = !!mDate;
                    item.isDone = !!(item.cmsDate || mDate);

                    if (item.isDone) {
                        subDiscDone++;
                        totalItrBDone++;
                        if (discDoneCounts[disc] !== undefined) discDoneCounts[disc]++;
                    }
                });

                const sys = extractSystem(sub);
                if (gd.precomMatrix[sys] && gd.precomMatrix[sys][sub] && gd.precomMatrix[sys][sub].disciplines[disc]) {
                    gd.precomMatrix[sys][sub].disciplines[disc].i_d = subDiscDone;
                }
            });
        });
    }

    if (gd.precomData && gd.precomData.itrB) {
        gd.precomData.itrB.done = totalItrBDone;
    }
    if (gd.sumItrB) {
        ACTIVE_PRECOM_DISCS.forEach(d => {
            if (gd.sumItrB[d]) gd.sumItrB[d].d = discDoneCounts[d] || 0;
        });
    }

    // 3. FTP recalculation
    let totalFtpDone = 0;
    const subFtpDone = {};
    if (gd.globalFtpList) {
        gd.globalFtpList.forEach(ftp => {
            if (ftp.cmsDate === undefined) {
                ftp.cmsDate = (ftp.isDone && !ftp.isManual) ? (ftp.compDate || '') : '';
            }
            ftp.isDone = !!(ftp.cmsDate || ftp.manualDate);
            if (ftp.isDone) {
                totalFtpDone++;
                subFtpDone[ftp.subsys] = (subFtpDone[ftp.subsys] || 0) + 1;
                if (!ftp.progress || ftp.progress < 100) ftp.progress = 100;
            }
        });
    }
    if (gd.precomData && gd.precomData.ftp) {
        gd.precomData.ftp.done = totalFtpDone;
    }

    // Update precomMatrix FTP counts
    Object.keys(gd.precomMatrix).forEach(sys => {
        Object.keys(gd.precomMatrix[sys]).forEach(sub => {
            const cell = gd.precomMatrix[sys][sub];
            if (cell && cell.ftp) {
                cell.ftp.done = subFtpDone[sub] || 0;
                if (cell.ftp.total > 0) {
                    const subFtps = (gd.globalFtpList || []).filter(f => f.subsys === sub);
                    const avgProg = subFtps.length > 0 ? (subFtps.reduce((acc, x) => acc + (x.progress || (x.isDone ? 100 : 0)), 0) / subFtps.length) : 0;
                    cell.ftp.progress = Math.round(avgProg);
                }
            }
        });
    });

    // 4. Punch PRE and COM recalculation (including site walkdown punches)
    let preDone = 0, preTotal = 0;
    let comDone = 0, comTotal = 0;
    const prePunchStats = { a_t:0, a_d:0, b_t:0, b_d:0, c_t:0, c_d:0 };
    const comPunchStats = { a_t:0, a_d:0, b_t:0, b_d:0, c_t:0, c_d:0 };

    // Reset punch counts in matrix
    Object.keys(gd.precomMatrix).forEach(sys => {
        Object.keys(gd.precomMatrix[sys]).forEach(sub => {
            const cell = gd.precomMatrix[sys][sub];
            ACTIVE_PRECOM_DISCS.forEach(d => {
                if (cell.disciplines[d]) {
                    cell.disciplines[d].pa_t = 0; cell.disciplines[d].pa_d = 0;
                    cell.disciplines[d].pb_t = 0; cell.disciplines[d].pb_d = 0;
                    cell.disciplines[d].pc_t = 0; cell.disciplines[d].pc_d = 0;
                }
            });
            if (cell.ftp) {
                cell.ftp.pca_t = 0; cell.ftp.pca_d = 0;
                cell.ftp.pcb_t = 0; cell.ftp.pcb_d = 0;
                cell.ftp.pcc_t = 0; cell.ftp.pcc_d = 0;
            }
        });
    });

    if (gd.globalPunchList) {
        gd.globalPunchList.forEach(p => {
            const phase = String(p.phase || '').toUpperCase();
            const cat = String(p.cat || '').toUpperCase();
            const isClosed = String(p.status || '').toUpperCase().includes('CLOSE');
            const sub = p.subsys;
            const sys = p.sys || extractSystem(sub);
            const disc = classifyDiscipline(p.disc);

            if (phase.includes('PRE')) {
                preTotal++;
                if (isClosed) preDone++;
                if (cat.includes('A')) {
                    prePunchStats.a_t++; if (isClosed) prePunchStats.a_d++;
                    if (gd.precomMatrix[sys] && gd.precomMatrix[sys][sub] && gd.precomMatrix[sys][sub].disciplines[disc]) {
                        gd.precomMatrix[sys][sub].disciplines[disc].pa_t++;
                        if (isClosed) gd.precomMatrix[sys][sub].disciplines[disc].pa_d++;
                    }
                } else if (cat.includes('B')) {
                    prePunchStats.b_t++; if (isClosed) prePunchStats.b_d++;
                    if (gd.precomMatrix[sys] && gd.precomMatrix[sys][sub] && gd.precomMatrix[sys][sub].disciplines[disc]) {
                        gd.precomMatrix[sys][sub].disciplines[disc].pb_t++;
                        if (isClosed) gd.precomMatrix[sys][sub].disciplines[disc].pb_d++;
                    }
                } else if (cat.includes('C')) {
                    prePunchStats.c_t++; if (isClosed) prePunchStats.c_d++;
                    if (gd.precomMatrix[sys] && gd.precomMatrix[sys][sub] && gd.precomMatrix[sys][sub].disciplines[disc]) {
                        gd.precomMatrix[sys][sub].disciplines[disc].pc_t++;
                        if (isClosed) gd.precomMatrix[sys][sub].disciplines[disc].pc_d++;
                    }
                }
            } else if (phase.includes('COM')) {
                comTotal++;
                if (isClosed) comDone++;
                if (cat.includes('A')) {
                    comPunchStats.a_t++; if (isClosed) comPunchStats.a_d++;
                    if (gd.precomMatrix[sys] && gd.precomMatrix[sys][sub] && gd.precomMatrix[sys][sub].ftp) {
                        gd.precomMatrix[sys][sub].ftp.pca_t++;
                        if (isClosed) gd.precomMatrix[sys][sub].ftp.pca_d++;
                    }
                } else if (cat.includes('B')) {
                    comPunchStats.b_t++; if (isClosed) comPunchStats.b_d++;
                    if (gd.precomMatrix[sys] && gd.precomMatrix[sys][sub] && gd.precomMatrix[sys][sub].ftp) {
                        gd.precomMatrix[sys][sub].ftp.pcb_t++;
                        if (isClosed) gd.precomMatrix[sys][sub].ftp.pcb_d++;
                    }
                } else if (cat.includes('C')) {
                    comPunchStats.c_t++; if (isClosed) comPunchStats.c_d++;
                    if (gd.precomMatrix[sys] && gd.precomMatrix[sys][sub] && gd.precomMatrix[sys][sub].ftp) {
                        gd.precomMatrix[sys][sub].ftp.pcc_t++;
                        if (isClosed) gd.precomMatrix[sys][sub].ftp.pcc_d++;
                    }
                }
            }
        });
    }

    if (gd.precomData) {
        gd.precomData.punchPre = { done: preDone, total: preTotal, ...prePunchStats };
        gd.precomData.punchCom = { done: comDone, total: comTotal, ...comPunchStats };
    }
}
window.recalculatePrecomMasterCounts = recalculatePrecomMasterCounts;

// ========================================================
// PRE-COMMISSIONING & COMMISSIONING MODULE (PHASE 2 & 3)
// ========================================================

const ACTIVE_PRECOM_DISCS = ['MECHANICAL', 'PIPING', 'ELECTRICAL', 'INSTRUMENT', 'TELECOM', 'HVAC'];

let currentPrecomSysFilter = 'ALL';
let currentPrecomSubFilter = '';
let currentPrecomSearch = '';
let currentPrecomIncFilter = false;
let currentPrecomCompFilter = false;

let currentPrecomCsSubsys = null;
let currentPrecomCsDisc = null;
let currentPrecomCsFilterStatus = 'ALL';
let currentPrecomCsSearch = '';
let currentPrecomCsList = [];

let currentFtpSubsys = null;
let currentFtpFilterStatus = 'ALL';
let currentFtpSearch = '';
let currentFtpList = [];

function setupPrecomEvents() {
    // 1. Close buttons & Outside clicks
    const csModal = document.getElementById('precom-checksheet-modal');
    const csClose = document.getElementById('precom-checksheet-modal-close');
    if (csClose && csModal) {
        csClose.addEventListener('click', () => { csModal.style.display = 'none'; });
        csModal.addEventListener('click', (e) => {
            if (e.target === csModal) csModal.style.display = 'none';
        });
    }

    const ftpModal = document.getElementById('ftp-modal');
    const ftpClose = document.getElementById('ftp-modal-close');
    if (ftpClose && ftpModal) {
        ftpClose.addEventListener('click', () => { ftpModal.style.display = 'none'; });
        ftpModal.addEventListener('click', (e) => {
            if (e.target === ftpModal) ftpModal.style.display = 'none';
        });
    }

    // 2. Precom Matrix Toolbar Filters
    const selSys = document.getElementById('filter-precom-sys');
    const inSub = document.getElementById('filter-precom-subsys');
    const inSearch = document.getElementById('filter-precom-search');
    const chkInc = document.getElementById('filter-precom-incomplete');
    const chkComp = document.getElementById('filter-precom-completed');

    if (selSys) selSys.addEventListener('change', () => {
        currentPrecomSysFilter = selSys.value;
        renderPrecomMatrix();
    });

    if (inSub) inSub.addEventListener('input', () => {
        currentPrecomSubFilter = inSub.value.trim().toLowerCase();
        renderPrecomMatrix();
    });

    if (inSearch) inSearch.addEventListener('input', () => {
        currentPrecomSearch = inSearch.value.trim().toLowerCase();
        renderPrecomMatrix();
    });

    if (chkInc && chkComp) {
        chkInc.addEventListener('change', () => {
            if (chkInc.checked) chkComp.checked = false;
            currentPrecomIncFilter = chkInc.checked;
            currentPrecomCompFilter = chkComp.checked;
            renderPrecomMatrix();
        });
        chkComp.addEventListener('change', () => {
            if (chkComp.checked) chkInc.checked = false;
            currentPrecomIncFilter = chkInc.checked;
            currentPrecomCompFilter = chkComp.checked;
            renderPrecomMatrix();
        });
    } else {
        if (chkInc) chkInc.addEventListener('change', () => {
            currentPrecomIncFilter = chkInc.checked;
            renderPrecomMatrix();
        });
        if (chkComp) chkComp.addEventListener('change', () => {
            currentPrecomCompFilter = chkComp.checked;
            renderPrecomMatrix();
        });
    }

    // 3. Export Buttons
    const btnExpSel = document.getElementById('btn-precom-export-selected');
    if (btnExpSel) btnExpSel.addEventListener('click', () => exportPrecomMatrixToExcel(true));

    const btnExpAll = document.getElementById('btn-precom-export-all');
    if (btnExpAll) btnExpAll.addEventListener('click', () => exportPrecomMatrixToExcel(false));

    const btnExpCs = document.getElementById('btn-export-precom-cs-excel');
    if (btnExpCs) btnExpCs.addEventListener('click', exportPrecomChecksheetsToExcel);

    const btnExpFtp = document.getElementById('btn-export-ftp-excel');
    if (btnExpFtp) btnExpFtp.addEventListener('click', exportFtpToExcel);

    // 4. Precom Checksheet Modal Filters
    const btnCsAll = document.getElementById('precom-cs-btn-filter-all');
    const btnCsDone = document.getElementById('precom-cs-btn-filter-done');
    const btnCsPending = document.getElementById('precom-cs-btn-filter-pending');
    const inCsSearch = document.getElementById('precom-cs-search-input');

    if (btnCsAll && btnCsDone && btnCsPending) {
        btnCsAll.addEventListener('click', () => {
            currentPrecomCsFilterStatus = 'ALL';
            updatePrecomCsFilterButtons();
            renderPrecomChecksheetModalTable();
        });
        btnCsDone.addEventListener('click', () => {
            currentPrecomCsFilterStatus = 'DONE';
            updatePrecomCsFilterButtons();
            renderPrecomChecksheetModalTable();
        });
        btnCsPending.addEventListener('click', () => {
            currentPrecomCsFilterStatus = 'PENDING';
            updatePrecomCsFilterButtons();
            renderPrecomChecksheetModalTable();
        });
    }

    if (inCsSearch) {
        inCsSearch.addEventListener('input', () => {
            currentPrecomCsSearch = inCsSearch.value.trim().toLowerCase();
            renderPrecomChecksheetModalTable();
        });
    }

    // 5. FTP Modal Filters
    const btnFtpAll = document.getElementById('ftp-btn-filter-all');
    const btnFtpDone = document.getElementById('ftp-btn-filter-done');
    const btnFtpProg = document.getElementById('ftp-btn-filter-prog');
    const inFtpSearch = document.getElementById('ftp-search-input');

    if (btnFtpAll && btnFtpDone && btnFtpProg) {
        btnFtpAll.addEventListener('click', () => {
            currentFtpFilterStatus = 'ALL';
            updateFtpFilterButtons();
            renderFtpModalTable();
        });
        btnFtpDone.addEventListener('click', () => {
            currentFtpFilterStatus = 'DONE';
            updateFtpFilterButtons();
            renderFtpModalTable();
        });
        btnFtpProg.addEventListener('click', () => {
            currentFtpFilterStatus = 'PROG';
            updateFtpFilterButtons();
            renderFtpModalTable();
        });
    }

    if (inFtpSearch) {
        inFtpSearch.addEventListener('input', () => {
            currentFtpSearch = inFtpSearch.value.trim().toLowerCase();
            renderFtpModalTable();
        });
    }
}

function updatePrecomCsFilterButtons() {
    const btnAll = document.getElementById('precom-cs-btn-filter-all');
    const btnDone = document.getElementById('precom-cs-btn-filter-done');
    const btnPending = document.getElementById('precom-cs-btn-filter-pending');
    if (!btnAll || !btnDone || !btnPending) return;

    btnAll.style.background = currentPrecomCsFilterStatus === 'ALL' ? '#0ea5e9' : '#1e293b';
    btnAll.style.color = currentPrecomCsFilterStatus === 'ALL' ? '#fff' : '#94a3b8';

    btnDone.style.background = currentPrecomCsFilterStatus === 'DONE' ? '#10b981' : '#1e293b';
    btnDone.style.color = currentPrecomCsFilterStatus === 'DONE' ? '#fff' : '#94a3b8';

    btnPending.style.background = currentPrecomCsFilterStatus === 'PENDING' ? '#ef4444' : '#1e293b';
    btnPending.style.color = currentPrecomCsFilterStatus === 'PENDING' ? '#fff' : '#94a3b8';
}

function updateFtpFilterButtons() {
    const btnAll = document.getElementById('ftp-btn-filter-all');
    const btnDone = document.getElementById('ftp-btn-filter-done');
    const btnProg = document.getElementById('ftp-btn-filter-prog');
    if (!btnAll || !btnDone || !btnProg) return;

    btnAll.style.background = currentFtpFilterStatus === 'ALL' ? '#10b981' : '#1e293b';
    btnAll.style.color = currentFtpFilterStatus === 'ALL' ? '#fff' : '#94a3b8';

    btnDone.style.background = currentFtpFilterStatus === 'DONE' ? '#0ea5e9' : '#1e293b';
    btnDone.style.color = currentFtpFilterStatus === 'DONE' ? '#fff' : '#94a3b8';

    btnProg.style.background = currentFtpFilterStatus === 'PROG' ? '#f59e0b' : '#1e293b';
    btnProg.style.color = currentFtpFilterStatus === 'PROG' ? '#fff' : '#94a3b8';
}

function populatePrecomSysDropdown() {
    const sel = document.getElementById('filter-precom-sys');
    if (!sel) return;
    const gd = window.GLOBAL_MC_DATA;
    const matrix = (gd && gd.precomMatrix) ? gd.precomMatrix : {};

    sel.innerHTML = '<option value="ALL">All systems</option>';
    Object.keys(matrix).sort().forEach(sys => {
        sel.innerHTML += `<option value="${sys}">System ${sys}</option>`;
    });
}

function renderPrecomWidgets() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;

    const precomData = gd.precomData || { itrB: {done:0, total:0}, ftp: {done:0, total:0}, punchPre: {done:0, total:0}, punchCom: {done:0, total:0}, rfc: {done:0, total:0} };
    const sumItrB = gd.sumItrB || {};
    const sumFtp = gd.sumFtp || { done:0, total:0, byDisc: {} };

    // 1. Box 1: Precom ITR-B
    const elItrBTotal = document.getElementById('sum-itrb-total');
    if (elItrBTotal) {
        const d = precomData.itrB.done || 0;
        const t = precomData.itrB.total || 0;
        elItrBTotal.innerHTML = `${d.toLocaleString()} / ${t.toLocaleString()} <span style="font-size:0.75rem; color:#38bdf8;">${formatSmPct(d, t)}</span>`;
    }

    const gridItrB = document.getElementById('grid-itrb');
    if (gridItrB) {
        gridItrB.innerHTML = '';
        ACTIVE_PRECOM_DISCS.forEach(disc => {
            const v = sumItrB[disc] || { d: 0, t: 0 };
            const label = disc.length > 4 ? disc.substring(0, 4) : disc;
            gridItrB.innerHTML += `
                <div class="mc-sm-item" style="cursor:default;" title="${disc}: ${v.d} / ${v.t}">
                    <div class="mc-sm-lbl" style="color: #38bdf8;">${label}</div>
                    <div class="mc-sm-val">${v.d}/${v.t} ${formatSmPct(v.d, v.t)}</div>
                </div>
            `;
        });
    }

    // 2. Box 2: Precom & Comm Punches
    const elPunchTotal = document.getElementById('sum-punch-precom-total');
    const totPunchD = (precomData.punchPre.done || 0) + (precomData.punchCom.done || 0);
    const totPunchT = (precomData.punchPre.total || 0) + (precomData.punchCom.total || 0);
    if (elPunchTotal) {
        elPunchTotal.innerHTML = `${totPunchD.toLocaleString()} / ${totPunchT.toLocaleString()} <span style="font-size:0.75rem; color:#f59e0b;">${formatSmPct(totPunchD, totPunchT)}</span>`;
    }

    const gridPunch = document.getElementById('grid-punch-precom');
    if (gridPunch) {
        gridPunch.innerHTML = '';
        const sumPunch = gd.sumPunch || {};

        // PRE Punches
        const preA = sumPunch['LQ-PRE'] ? sumPunch['LQ-PRE'].a_t : (precomData.punchPre.a_t || 0);
        const preADone = sumPunch['LQ-PRE'] ? sumPunch['LQ-PRE'].a_d : (precomData.punchPre.a_d || 0);
        const preB = sumPunch['LQ-PRE'] ? sumPunch['LQ-PRE'].b_t : (precomData.punchPre.b_t || 0);
        const preBDone = sumPunch['LQ-PRE'] ? sumPunch['LQ-PRE'].b_d : (precomData.punchPre.b_d || 0);
        const preC = sumPunch['LQ-PRE'] ? sumPunch['LQ-PRE'].c_t : (precomData.punchPre.c_t || 0);
        const preCDone = sumPunch['LQ-PRE'] ? sumPunch['LQ-PRE'].c_d : (precomData.punchPre.c_d || 0);

        gridPunch.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('LQ-PRE', 'A')" title="Click to view Precom Punch A"><div class="mc-sm-lbl" style="color:#ef4444;">PRE_A</div><div class="mc-sm-val">${preADone}/${preA} ${formatSmPct(preADone, preA, true)}</div></div>`;
        gridPunch.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('LQ-PRE', 'B')" title="Click to view Precom Punch B"><div class="mc-sm-lbl" style="color:#f59e0b;">PRE_B</div><div class="mc-sm-val">${preBDone}/${preB} ${formatSmPct(preBDone, preB)}</div></div>`;
        gridPunch.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('LQ-PRE', 'C')" title="Click to view Precom Punch C"><div class="mc-sm-lbl" style="color:#38bdf8;">PRE_C</div><div class="mc-sm-val">${preCDone}/${preC} ${formatSmPct(preCDone, preC)}</div></div>`;

        // COM Punches
        const comA = sumPunch['LQ-COM'] ? sumPunch['LQ-COM'].a_t : (precomData.punchCom.a_t || 0);
        const comADone = sumPunch['LQ-COM'] ? sumPunch['LQ-COM'].a_d : (precomData.punchCom.a_d || 0);
        const comB = sumPunch['LQ-COM'] ? sumPunch['LQ-COM'].b_t : (precomData.punchCom.b_t || 0);
        const comBDone = sumPunch['LQ-COM'] ? sumPunch['LQ-COM'].b_d : (precomData.punchCom.b_d || 0);
        const comC = sumPunch['LQ-COM'] ? sumPunch['LQ-COM'].c_t : (precomData.punchCom.c_t || 0);
        const comCDone = sumPunch['LQ-COM'] ? sumPunch['LQ-COM'].c_d : (precomData.punchCom.c_d || 0);

        gridPunch.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('LQ-COM', 'A')" title="Click to view Comm Punch A"><div class="mc-sm-lbl" style="color:#ef4444;">COM_A</div><div class="mc-sm-val">${comADone}/${comA} ${formatSmPct(comADone, comA, true)}</div></div>`;
        gridPunch.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('LQ-COM', 'B')" title="Click to view Comm Punch B"><div class="mc-sm-lbl" style="color:#f59e0b;">COM_B</div><div class="mc-sm-val">${comBDone}/${comB} ${formatSmPct(comBDone, comB)}</div></div>`;
        gridPunch.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('LQ-COM', 'C')" title="Click to view Comm Punch C"><div class="mc-sm-lbl" style="color:#38bdf8;">COM_C</div><div class="mc-sm-val">${comCDone}/${comC} ${formatSmPct(comCDone, comC)}</div></div>`;
    }

    // 3. Box 3: Commissioning FTP Status
    const elFtpTotal = document.getElementById('sum-ftp-total');
    if (elFtpTotal) {
        const d = precomData.ftp.done || 0;
        const t = precomData.ftp.total || 0;
        elFtpTotal.innerHTML = `${d.toLocaleString()} / ${t.toLocaleString()} <span style="font-size:0.75rem; color:#10b981;">${formatSmPct(d, t)}</span>`;
    }

    const gridFtp = document.getElementById('grid-ftp');
    if (gridFtp) {
        gridFtp.innerHTML = '';
        const byDisc = sumFtp.byDisc || {};
        Object.keys(byDisc).sort().forEach(disc => {
            const v = byDisc[disc];
            const label = disc.length > 4 ? disc.substring(0, 4) : disc;
            gridFtp.innerHTML += `
                <div class="mc-sm-item" style="cursor:default;" title="${disc}: ${v.done} / ${v.total}">
                    <div class="mc-sm-lbl" style="color: #34d399;">${label}</div>
                    <div class="mc-sm-val">${v.done}/${v.total} ${formatSmPct(v.done, v.total)}</div>
                </div>
            `;
        });
    }

    // 4. Box 4: RFC Certificates
    const elRfcTotal = document.getElementById('sum-rfc-total');
    if (elRfcTotal) {
        const d = precomData.rfc.done || 0;
        const t = precomData.rfc.total || 0;
        elRfcTotal.innerHTML = `${d.toLocaleString()} / ${t.toLocaleString()} <span style="font-size:0.75rem; color:#a855f7;">${formatSmPct(d, t)}</span>`;
    }

    const gridRfc = document.getElementById('grid-rfc');
    if (gridRfc) {
        gridRfc.innerHTML = '';
        const rfcMap = gd.rfcMap || {};
        const subs = Object.keys(rfcMap).slice(0, 10);
        subs.forEach(s => {
            const isDone = rfcMap[s].done;
            gridRfc.innerHTML += `
                <div class="mc-sm-item" style="cursor:default;" title="RFC Subsystem ${s}">
                    <div class="mc-sm-lbl" title="${s}">${s}</div>
                    <div class="mc-sm-val" style="color: ${isDone ? '#34d399' : '#f59e0b'};">${isDone ? 'RFC SIGNED' : 'PENDING'}</div>
                </div>
            `;
        });
    }
}

function renderPrecomItrCell(d, t, sub, disc) {
    if (t === 0) return `<td class="dash">-</td>`;
    const pct = ((d / t) * 100).toFixed(1);
    let pctClass = '';
    if (pct === '100.0') pctClass = 'pct-100';
    else if (pct === '0.0') pctClass = 'pct-0';

    return `
        <td class="cell-interactive" onclick="openPrecomChecksheetDetail('${sub}', '${disc}')" title="Click to view ITR-B details for ${sub} (${disc})">
            <div class="cell-val">
                <span class="cell-nums">${d}/${t}</span>
                <span class="cell-pct ${pctClass}">${pct}%</span>
                <button class="cell-tool-btn" type="button" title="View ITR-B list for ${sub} - ${disc}" onclick="event.stopPropagation(); openPrecomChecksheetDetail('${sub}', '${disc}')">
                    <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                </button>
            </div>
        </td>
    `;
}

function renderPrecomPunchCell(d, t, isRedZero, sub, disc, cat, phaseType) {
    if (t === 0) return `<td class="dash">-</td>`;
    const pct = ((d / t) * 100).toFixed(1);
    let pctClass = '';
    if (isRedZero && pct === '0.0') pctClass = 'pct-0';
    else if (pct === '100.0') pctClass = 'pct-100';

    const targetPhase = phaseType === 'COM' ? 'LQ-COM' : 'LQ-PRE';

    return `
        <td class="cell-interactive" onclick="openSubsysPunchDetail('${sub}', '${disc}', '${cat}', '${targetPhase}')" title="Click to view Punch ${cat} details for ${sub} (${disc})">
            <div class="cell-val">
                <span class="cell-nums">${d}/${t}</span>
                <span class="cell-pct ${pctClass}">${pct}%</span>
                <button class="cell-tool-btn" type="button" title="View Punch ${cat} list for ${sub} - ${disc}" onclick="event.stopPropagation(); openSubsysPunchDetail('${sub}', '${disc}', '${cat}', '${targetPhase}')">
                    <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                </button>
            </div>
        </td>
    `;
}

function renderFtpCountCell(d, t, sub) {
    if (t === 0) return `<td class="dash">-</td>`;
    const pct = ((d / t) * 100).toFixed(1);
    let pctClass = pct === '100.0' ? 'pct-100' : (pct === '0.0' ? 'pct-0' : '');

    return `
        <td class="cell-interactive cell-interactive-ftp" onclick="openFtpDetail('${sub}')" title="Click to view Commissioning FTP procedures for ${sub}">
            <div class="cell-val">
                <span class="cell-nums" style="color: #34d399; font-weight: 700;">${d}/${t}</span>
                <span class="cell-pct ${pctClass}">${pct}%</span>
                <button class="cell-tool-btn" type="button" title="View FTP list for ${sub}" onclick="event.stopPropagation(); openFtpDetail('${sub}')">
                    <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round">
                        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
                    </svg>
                </button>
            </div>
        </td>
    `;
}

function renderFtpProgressCell(progress, sub) {
    if (progress === undefined || progress === null) return `<td class="dash">-</td>`;
    const p = Math.round(progress);
    const color = p >= 100 ? '#10b981' : (p > 0 ? '#38bdf8' : '#64748b');

    return `
        <td class="cell-interactive cell-interactive-ftp" onclick="openFtpDetail('${sub}')" style="min-width: 90px;" title="FTP Average Progress: ${p}%">
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 2px;">
                <span style="font-weight: 700; font-size: 0.8rem; color: ${color};">${p}%</span>
                <div class="ftp-progress-bar">
                    <div class="ftp-progress-fill" style="width: ${p}%; background: ${color};"></div>
                </div>
            </div>
        </td>
    `;
}

function renderPrecomMatrix() {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    const matrix = gd.precomMatrix || {};
    const tbody = document.getElementById('precom-matrix-tbody');
    if (!tbody) return;

    tbody.innerHTML = '';

    const systems = Object.keys(matrix).sort((a, b) => {
        let minDateA = null, minDateB = null;
        Object.keys(matrix[a]).forEach(s => {
            const d = getSubsysSkylineDate(s);
            if (d && (!minDateA || d < minDateA)) minDateA = d;
        });
        Object.keys(matrix[b]).forEach(s => {
            const d = getSubsysSkylineDate(s);
            if (d && (!minDateB || d < minDateB)) minDateB = d;
        });
        if (minDateA && minDateB) {
            if (minDateA !== minDateB) return minDateA.localeCompare(minDateB);
            return a.localeCompare(b);
        }
        if (minDateA && !minDateB) return -1;
        if (!minDateA && minDateB) return 1;
        return a.localeCompare(b);
    });

    if (systems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="33" style="text-align:center; padding: 4rem;">No Precom/Comm Data Found</td></tr>';
        return;
    }

    systems.forEach(sys => {
        if (currentPrecomSysFilter !== 'ALL' && sys !== currentPrecomSysFilter) return;

        let hasVisibleSubsys = false;
        const sysFragment = document.createDocumentFragment();

        const subsysKeys = Object.keys(matrix[sys]).sort((a, b) => {
            const dateA = getSubsysSkylineDate(a);
            const dateB = getSubsysSkylineDate(b);
            if (dateA && dateB) {
                if (dateA !== dateB) return dateA.localeCompare(dateB);
                return a.localeCompare(b);
            }
            if (dateA && !dateB) return -1;
            if (!dateA && dateB) return 1;
            return a.localeCompare(b);
        });

        subsysKeys.forEach(sub => {
            if (currentPrecomSubFilter && !sub.toLowerCase().includes(currentPrecomSubFilter)) return;

            const cell = matrix[sys][sub];
            const subDesc = cell.subsysDesc || '';

            // Search filter by tag or procedure
            if (currentPrecomSearch) {
                const q = currentPrecomSearch;
                const matchSub = sub.toLowerCase().includes(q) || subDesc.toLowerCase().includes(q);
                let matchChecksheet = false;
                if (gd.globalPrecomChecksheetMap && gd.globalPrecomChecksheetMap[sub]) {
                    Object.keys(gd.globalPrecomChecksheetMap[sub]).forEach(disc => {
                        gd.globalPrecomChecksheetMap[sub][disc].forEach(item => {
                            if ((item.tag && item.tag.toLowerCase().includes(q)) || (item.tagDesc && item.tagDesc.toLowerCase().includes(q))) {
                                matchChecksheet = true;
                            }
                        });
                    });
                }
                let matchFtp = false;
                if (gd.globalFtpList) {
                    gd.globalFtpList.forEach(ftp => {
                        if (ftp.subsys === sub && ((ftp.ftpNo && ftp.ftpNo.toLowerCase().includes(q)) || (ftp.title && ftp.title.toLowerCase().includes(q)))) {
                            matchFtp = true;
                        }
                    });
                }
                if (!matchSub && !matchChecksheet && !matchFtp) return;
            }

            let isIncomplete = false;
            const subSkyDate = getSubsysSkylineDate(sub);
            const formattedDate = formatSkylineDate(subSkyDate);

            // MC Gate CSSC Badge
            let csscBadge = cell.csscDone
                ? `<span class="gate-badge gate-signed" title="CSSC Signed: ${cell.csscDate || 'N/A'}">SIGNED</span>`
                : `<span class="gate-badge gate-pending" title="CSSC Pending">PENDING</span>`;

            // RFC Precom Gate Badge
            let rfcBadge = cell.rfcDone
                ? `<span class="gate-badge gate-signed" title="RFC Signed: ${cell.rfcDate || 'N/A'}">SIGNED</span>`
                : `<span class="gate-badge gate-pending" title="RFC Pending">PENDING</span>`;

            let html = `
                <td class="col-sys" title="${subDesc ? sub + ' - ' + subDesc : sub}">${sub}</td>
                <td class="col-skyline-date">${formattedDate}</td>
                <td style="text-align: center;">${csscBadge}</td>
            `;

            ACTIVE_PRECOM_DISCS.forEach(disc => {
                const data = cell.disciplines[disc] || { i_d: 0, i_t: 0, pa_d: 0, pa_t: 0, pb_d: 0, pb_t: 0, pc_d: 0, pc_t: 0 };
                html += renderPrecomItrCell(data.i_d, data.i_t, sub, disc);
                html += renderPrecomPunchCell(data.pa_d, data.pa_t, true, sub, disc, 'A', 'PRE');
                html += renderPrecomPunchCell(data.pb_d, data.pb_t, false, sub, disc, 'B', 'PRE');
                html += renderPrecomPunchCell(data.pc_d, data.pc_t, false, sub, disc, 'C', 'PRE');

                if (data.i_t > 0 && data.i_d < data.i_t) isIncomplete = true;
                if (data.pa_t > 0 && data.pa_d < data.pa_t) isIncomplete = true;
                if (data.pb_t > 0 && data.pb_d < data.pb_t) isIncomplete = true;
                if (data.pc_t > 0 && data.pc_d < data.pc_t) isIncomplete = true;
            });

            html += `<td style="text-align: center;">${rfcBadge}</td>`;

            const ftpInfo = cell.ftp || { done: 0, total: 0, progress: 0, pca_d: 0, pca_t: 0, pcb_d: 0, pcb_t: 0, pcc_d: 0, pcc_t: 0 };
            html += renderFtpCountCell(ftpInfo.done, ftpInfo.total, sub);
            html += renderFtpProgressCell(ftpInfo.total > 0 ? ftpInfo.progress : null, sub);
            html += renderPrecomPunchCell(ftpInfo.pca_d, ftpInfo.pca_t, true, sub, 'COMM', 'A', 'COM');
            html += renderPrecomPunchCell(ftpInfo.pcb_d, ftpInfo.pcb_t, false, sub, 'COMM', 'B', 'COM');
            html += renderPrecomPunchCell(ftpInfo.pcc_d, ftpInfo.pcc_t, false, sub, 'COMM', 'C', 'COM');

            if (ftpInfo.total > 0 && ftpInfo.done < ftpInfo.total) isIncomplete = true;
            let subTotalItrB = 0;
            let subDoneItrB = 0;
            ACTIVE_PRECOM_DISCS.forEach(d => {
                const dData = cell.disciplines && cell.disciplines[d];
                if (dData) {
                    subTotalItrB += (dData.i_t || 0);
                    subDoneItrB += (dData.i_d || 0);
                }
            });
            const ftpDone = ftpInfo.done || 0;

            if (currentPrecomIncFilter && !isIncomplete) return;
            if (currentPrecomCompFilter && (subDoneItrB === 0 && ftpDone === 0)) return;

            const trSub = document.createElement('tr');
            trSub.className = 'subsys-row';
            trSub.innerHTML = html;
            sysFragment.appendChild(trSub);
            hasVisibleSubsys = true;
        });

        if (hasVisibleSubsys) {
            let sysMinDate = null;
            subsysKeys.forEach(s => {
                const d = getSubsysSkylineDate(s);
                if (d && (!sysMinDate || d < sysMinDate)) sysMinDate = d;
            });
            const trSys = document.createElement('tr');
            trSys.className = 'sys-row';
            trSys.innerHTML = `<td class="col-sys">SYSTEM ${sys}</td><td class="col-skyline-date" style="color: #60a5fa; font-weight:700;">${sysMinDate ? formatSkylineDate(sysMinDate) : '-'}</td><td colspan="31"></td>`;
            tbody.appendChild(trSys);
            tbody.appendChild(sysFragment);
        }
    });

    if (tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="33" style="text-align:center; padding: 4rem;">No matching Precom/Comm data</td></tr>';
    }
}

// ----------------- PRECOM CHECKSHEET MODAL (ITR-B) -----------------
function openPrecomChecksheetDetail(subsys, disc) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;

    currentPrecomCsSubsys = subsys;
    currentPrecomCsDisc = disc;
    currentPrecomCsFilterStatus = 'ALL';
    currentPrecomCsSearch = '';

    const inSearch = document.getElementById('precom-cs-search-input');
    if (inSearch) inSearch.value = '';
    updatePrecomCsFilterButtons();

    let list = [];
    if (gd.globalPrecomChecksheetMap && gd.globalPrecomChecksheetMap[subsys] && gd.globalPrecomChecksheetMap[subsys][disc]) {
        list = gd.globalPrecomChecksheetMap[subsys][disc].map(item => ({ ...item }));
    }
    currentPrecomCsList = list;

    const subsysDesc = (gd.sysDescMap && gd.sysDescMap[subsys]) || (list[0] && list[0].subsysDesc) || '';
    const subsysLabel = subsysDesc ? `${subsys} - ${subsysDesc}` : subsys;
    const modalSubsys = document.getElementById('precom-cs-modal-subsys');
    const modalDisc = document.getElementById('precom-cs-modal-disc');
    if (modalSubsys) modalSubsys.textContent = subsysLabel;
    if (modalDisc) modalDisc.textContent = disc;

    renderPrecomChecksheetModalTable();

    const csModal = document.getElementById('precom-checksheet-modal');
    if (csModal) csModal.style.display = 'flex';
}
window.openPrecomChecksheetDetail = openPrecomChecksheetDetail;

function renderPrecomChecksheetModalTable() {
    const tbody = document.getElementById('precom-cs-modal-tbody');
    if (!tbody) return;

    const total = currentPrecomCsList.length;
    const done = currentPrecomCsList.filter(x => x.isDone).length;
    const pending = total - done;
    const pct = total > 0 ? ((done / total) * 100).toFixed(1) + '%' : '0.0%';

    const statTotal = document.getElementById('precom-cs-stat-total');
    const statDone = document.getElementById('precom-cs-stat-done');
    const statPending = document.getElementById('precom-cs-stat-pending');
    const statPct = document.getElementById('precom-cs-stat-pct');
    if (statTotal) statTotal.textContent = total.toLocaleString();
    if (statDone) statDone.textContent = done.toLocaleString();
    if (statPending) statPending.textContent = pending.toLocaleString();
    if (statPct) statPct.textContent = pct;

    const btnAll = document.getElementById('precom-cs-btn-filter-all');
    const btnDone = document.getElementById('precom-cs-btn-filter-done');
    const btnPending = document.getElementById('precom-cs-btn-filter-pending');
    if (btnAll) btnAll.textContent = `All (${total})`;
    if (btnDone) btnDone.textContent = `Completed (${done})`;
    if (btnPending) btnPending.textContent = `Pending (${pending})`;

    let filtered = currentPrecomCsList;
    if (currentPrecomCsFilterStatus === 'DONE') {
        filtered = filtered.filter(x => x.isDone);
    } else if (currentPrecomCsFilterStatus === 'PENDING') {
        filtered = filtered.filter(x => !x.isDone);
    }

    if (currentPrecomCsSearch) {
        const q = currentPrecomCsSearch.toLowerCase();
        filtered = filtered.filter(x =>
            (x.tag && x.tag.toLowerCase().includes(q)) ||
            (x.tagDesc && x.tagDesc.toLowerCase().includes(q)) ||
            (x.type && x.type.toLowerCase().includes(q)) ||
            (x.subsys && x.subsys.toLowerCase().includes(q)) ||
            (String(x.no || '').includes(q))
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; padding: 3rem; color: #64748b; font-size: 0.9rem;">No matching ITR-B checksheets</td></tr>`;
        return;
    }

    let rowsHtml = '';
    filtered.forEach((item, idx) => {
        const isOfficial = !item.isManual && !!item.cmsDate;
        const statusBadge = item.isDone
            ? (item.isManual
                ? `<span class="badge" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);"><i class="fas fa-check"></i> Completed (M)</span>`
                : `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.5);"><i class="fas fa-check-double"></i> Verified (CMS)</span>`)
            : `<span class="badge" style="background: rgba(239, 68, 68, 0.15); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.3);">● Pending</span>`;

        const rowBg = idx % 2 === 0 ? 'background: rgba(15, 23, 42, 0.3);' : 'background: rgba(30, 41, 59, 0.2);';

        let manualInputVal = '';
        if (item.manualDate) {
            const raw = item.manualDate.trim();
            if (raw.includes('/')) {
                const parts = raw.split('/');
                if (parts.length === 3) manualInputVal = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            } else if (raw.includes('-') && raw.length === 10) {
                manualInputVal = raw;
            }
        }

        const manualInputHtml = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 4px;">
                <input type="date" 
                       class="cs-manual-date-input" 
                       value="${manualInputVal}" 
                       data-subsys="${item.subsys}" 
                       data-disc="${item.disc}" 
                       data-tag="${item.tag}" 
                       data-type="${item.type}"
                       onchange="window.handlePrecomManualDateChange(this)"
                       style="background: #0f172a; border: 1px solid ${item.isManual ? '#0ea5e9' : '#334155'}; color: #f8fafc; font-size: 0.78rem; padding: 2px 6px; border-radius: 4px; outline: none; width: 110px;">
                <button type="button" 
                        class="btn-today" 
                        onclick="window.setPrecomManualDateToday(this)" 
                        title="Set to today"
                        style="background: #1e293b; border: 1px solid #475569; color: #38bdf8; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; cursor: pointer;">Today</button>
                ${item.isManual ? `<button type="button" onclick="window.clearPrecomManualDate(this)" title="Clear manual date" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; font-size: 0.7rem; padding: 2px 5px; border-radius: 4px; cursor: pointer;">&times;</button>` : ''}
            </div>
        `;

        rowsHtml += `
            <tr style="${rowBg} border-bottom: 1px solid rgba(255,255,255,0.04);">
                <td style="text-align: center; color: #64748b;">${item.no || (idx + 1)}</td>
                <td style="font-weight: 600; color: #f1f5f9;">${item.subsys}</td>
                <td style="color: #cbd5e1;">${item.subsysDesc || '-'}</td>
                <td style="font-family: monospace; font-weight: 600; color: #38bdf8;">${item.tag}</td>
                <td style="color: #cbd5e1;">${item.tagDesc || '-'}</td>
                <td><span class="badge" style="background: rgba(14,165,233,0.1); color: #38bdf8; font-size: 0.75rem;">${item.disc}</span></td>
                <td><span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; font-size: 0.75rem;">${item.type}</span></td>
                <td style="text-align: center; font-family: monospace; color: ${isOfficial ? '#34d399' : '#64748b'};">${item.cmsDate || '-'}</td>
                <td style="text-align: center;">${manualInputHtml}</td>
                <td style="text-align: center;">${statusBadge}</td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
}

window.handlePrecomManualDateChange = function(inputEl) {
    const subsys = inputEl.dataset.subsys;
    const disc = inputEl.dataset.disc;
    const tag = inputEl.dataset.tag;
    const type = inputEl.dataset.type;
    const newDate = inputEl.value.trim();

    updatePrecomChecksheetManualDate(subsys, disc, tag, type, newDate);
};

window.setPrecomManualDateToday = function(btn) {
    const inputEl = btn.parentElement.querySelector('.cs-manual-date-input');
    if (!inputEl) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    inputEl.value = today;
    window.handlePrecomManualDateChange(inputEl);
};

window.clearPrecomManualDate = function(btn) {
    const inputEl = btn.parentElement.querySelector('.cs-manual-date-input');
    if (!inputEl) return;
    inputEl.value = '';
    window.handlePrecomManualDateChange(inputEl);
};

function updatePrecomChecksheetManualDate(subsys, disc, tag, type, newDate) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    if (!gd.globalCompletedPrecomChecksheets) gd.globalCompletedPrecomChecksheets = [];

    // 1. Update in currentPrecomCsList (modal view)
    if (currentPrecomCsList) {
        const item = currentPrecomCsList.find(x => x.tag === tag && (!type || x.type === type));
        if (item) {
            item.manualDate = newDate;
            item.isManual = !!newDate;
            item.isDone = !!(item.cmsDate || newDate);
        }
    }

    // 2. Update in globalPrecomChecksheetMap (master map)
    let masterItem = null;
    if (gd.globalPrecomChecksheetMap && gd.globalPrecomChecksheetMap[subsys] && gd.globalPrecomChecksheetMap[subsys][disc]) {
        masterItem = gd.globalPrecomChecksheetMap[subsys][disc].find(x => x.tag === tag && (!type || x.type === type));
        if (masterItem) {
            masterItem.manualDate = newDate;
            masterItem.isManual = !!newDate;
            masterItem.isDone = !!(masterItem.cmsDate || newDate);
        }
    }

    // 3. Update in globalCompletedPrecomChecksheets
    const existingIdx = gd.globalCompletedPrecomChecksheets.findIndex(
        x => x.subsys === subsys && x.disc === disc && x.tag === tag && (!type || x.formNo === type)
    );

    if (newDate) {
        if (existingIdx >= 0) {
            gd.globalCompletedPrecomChecksheets[existingIdx].dateStr = newDate;
            gd.globalCompletedPrecomChecksheets[existingIdx].compDate = newDate;
            gd.globalCompletedPrecomChecksheets[existingIdx].isManual = true;
        } else {
            const sys = extractSystem(subsys);
            const tagDesc = (masterItem && masterItem.tagDesc) || '-';
            const subsysDesc = (masterItem && masterItem.subsysDesc) || (gd.sysDescMap ? gd.sysDescMap[subsys] : '') || '-';
            gd.globalCompletedPrecomChecksheets.push({
                sys: sys,
                subsys: subsys,
                subsysDesc: subsysDesc,
                disc: disc,
                formNo: type || 'ITR-B',
                tag: tag,
                tagDesc: tagDesc,
                dateStr: newDate,
                compDate: newDate,
                isManual: true
            });
        }
    } else {
        if (existingIdx >= 0) {
            gd.globalCompletedPrecomChecksheets.splice(existingIdx, 1);
        }
    }

    // 4. Recalculate Master Counts & update dashboard
    recalculatePrecomMasterCounts();

    // 5. Re-render UI
    renderPrecomChecksheetModalTable();
    renderPrecomMatrix();
    renderPrecomWidgets();

    // 6. Persist to storage
    autoPersistCurrentData();
    const saveBtn = document.getElementById('btn-save-data');
    if (saveBtn) saveBtn.style.display = 'inline-flex';
}

// ----------------- COMMISSIONING FTP MODAL -----------------
function openFtpDetail(subsys) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;

    currentFtpSubsys = subsys;
    currentFtpFilterStatus = 'ALL';
    currentFtpSearch = '';

    const inSearch = document.getElementById('ftp-search-input');
    if (inSearch) inSearch.value = '';
    updateFtpFilterButtons();

    let list = (gd.globalFtpList || []).filter(f => f.subsys === subsys).map(x => ({ ...x }));
    currentFtpList = list;

    const subsysDesc = (gd.sysDescMap && gd.sysDescMap[subsys]) || (list[0] && list[0].subsysDesc) || '';
    const subsysLabel = subsysDesc ? `${subsys} - ${subsysDesc}` : subsys;
    const modalSubsys = document.getElementById('ftp-modal-subsys');
    if (modalSubsys) modalSubsys.textContent = subsysLabel;

    renderFtpModalTable();

    const ftpModal = document.getElementById('ftp-modal');
    if (ftpModal) ftpModal.style.display = 'flex';
}
window.openFtpDetail = openFtpDetail;

function renderFtpModalTable() {
    const tbody = document.getElementById('ftp-modal-tbody');
    if (!tbody) return;

    const total = currentFtpList.length;
    const done = currentFtpList.filter(x => x.isDone).length;
    const progCount = currentFtpList.filter(x => !x.isDone && x.progress > 0).length;
    const avgProg = total > 0 ? (currentFtpList.reduce((acc, x) => acc + (x.progress || (x.isDone ? 100 : 0)), 0) / total) : 0;

    const statTotal = document.getElementById('ftp-stat-total');
    const statDone = document.getElementById('ftp-stat-done');
    const statProg = document.getElementById('ftp-stat-prog');
    const statPct = document.getElementById('ftp-stat-pct');

    if (statTotal) statTotal.textContent = total.toLocaleString();
    if (statDone) statDone.textContent = done.toLocaleString();
    if (statProg) statProg.textContent = progCount.toLocaleString();
    if (statPct) statPct.textContent = Math.round(avgProg) + '%';

    const btnAll = document.getElementById('ftp-btn-filter-all');
    const btnDone = document.getElementById('ftp-btn-filter-done');
    const btnProg = document.getElementById('ftp-btn-filter-prog');

    if (btnAll) btnAll.textContent = `All (${total})`;
    if (btnDone) btnDone.textContent = `Completed (${done})`;
    if (btnProg) btnProg.textContent = `In Progress (${progCount})`;

    let filtered = currentFtpList;
    if (currentFtpFilterStatus === 'DONE') {
        filtered = filtered.filter(x => x.isDone);
    } else if (currentFtpFilterStatus === 'PROG') {
        filtered = filtered.filter(x => !x.isDone && x.progress > 0);
    }

    if (currentFtpSearch) {
        const q = currentFtpSearch.toLowerCase();
        filtered = filtered.filter(x =>
            (x.ftpNo && x.ftpNo.toLowerCase().includes(q)) ||
            (x.title && x.title.toLowerCase().includes(q)) ||
            (x.disc && x.disc.toLowerCase().includes(q)) ||
            (x.location && x.location.toLowerCase().includes(q))
        );
    }

    if (filtered.length === 0) {
        tbody.innerHTML = `<tr><td colspan="12" style="text-align: center; padding: 3rem; color: #64748b; font-size: 0.9rem;">No matching FTP procedures</td></tr>`;
        return;
    }

    let rowsHtml = '';
    filtered.forEach((item, idx) => {
        const isOfficial = !item.isManual && !!item.cmsDate;
        const statusBadge = item.isDone
            ? (item.isManual
                ? `<span class="badge" style="background: rgba(14, 165, 233, 0.2); color: #38bdf8; border: 1px solid rgba(14, 165, 233, 0.4);"><i class="fas fa-check"></i> Completed (M)</span>`
                : `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.5);"><i class="fas fa-check-double"></i> Verified (CMS)</span>`)
            : (item.progress > 0
                ? `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.3);">● In Progress</span>`
                : `<span class="badge" style="background: rgba(100, 116, 139, 0.15); color: #94a3b8; border: 1px solid rgba(100, 116, 139, 0.3);">○ Not Started</span>`);

        const rowBg = idx % 2 === 0 ? 'background: rgba(15, 23, 42, 0.3);' : 'background: rgba(30, 41, 59, 0.2);';

        let manualInputVal = '';
        if (item.manualDate) {
            const raw = item.manualDate.trim();
            if (raw.includes('/')) {
                const parts = raw.split('/');
                if (parts.length === 3) manualInputVal = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            } else if (raw.includes('-') && raw.length === 10) {
                manualInputVal = raw;
            }
        }

        const manualInputHtml = `
            <div style="display: flex; align-items: center; justify-content: center; gap: 4px;">
                <input type="date" 
                       class="cs-manual-date-input" 
                       value="${manualInputVal}" 
                       data-id="${item.id}"
                       data-subsys="${item.subsys}" 
                       data-ftp="${item.ftpNo}"
                       onchange="window.handleFtpManualDateChange(this)"
                       style="background: #0f172a; border: 1px solid ${item.isManual ? '#10b981' : '#334155'}; color: #f8fafc; font-size: 0.78rem; padding: 2px 6px; border-radius: 4px; outline: none; width: 110px;">
                <button type="button" 
                        class="btn-today" 
                        onclick="window.setFtpManualDateToday(this)" 
                        title="Set to today"
                        style="background: #1e293b; border: 1px solid #475569; color: #34d399; font-size: 0.7rem; padding: 2px 6px; border-radius: 4px; cursor: pointer;">Today</button>
                ${item.isManual ? `<button type="button" onclick="window.clearFtpManualDate(this)" title="Clear manual date" style="background: rgba(239, 68, 68, 0.2); border: 1px solid rgba(239, 68, 68, 0.4); color: #f87171; font-size: 0.7rem; padding: 2px 5px; border-radius: 4px; cursor: pointer;">&times;</button>` : ''}
            </div>
        `;

        rowsHtml += `
            <tr style="${rowBg} border-bottom: 1px solid rgba(255,255,255,0.04);">
                <td style="text-align: center; color: #64748b;">${idx + 1}</td>
                <td style="font-family: monospace; font-weight: 600; color: #34d399;">${item.ftpNo}</td>
                <td style="color: #cbd5e1; font-weight: 500;">${item.title || '-'}</td>
                <td><span class="badge" style="background: rgba(14,165,233,0.1); color: #38bdf8; font-size: 0.75rem;">${item.disc}</span></td>
                <td style="text-align: center; font-family: monospace; color: #cbd5e1;">${item.step || 0} / ${item.totalStep || 0}</td>
                <td style="text-align: center;">
                    <div style="display: flex; align-items: center; justify-content: center; gap: 6px;">
                        <input type="number" min="0" max="100" value="${Math.round(item.progress || (item.isDone ? 100 : 0))}"
                               data-id="${item.id}"
                               onchange="window.handleFtpProgressChange(this)"
                               style="width: 50px; background: #0f172a; border: 1px solid #334155; color: #34d399; font-weight: 700; text-align: center; font-size: 0.8rem; border-radius: 4px; padding: 2px;">
                        <span style="font-size: 0.75rem; color: #94a3b8;">%</span>
                    </div>
                </td>
                <td style="text-align: center; font-family: monospace; color: ${isOfficial ? '#34d399' : '#64748b'};">${item.cmsDate || '-'}</td>
                <td style="text-align: center;">${manualInputHtml}</td>
                <td style="text-align: center;">${statusBadge}</td>
                <td style="text-align: center; font-size: 0.75rem; color: #94a3b8;">${item.planStart || '-'}</td>
                <td style="text-align: center; font-size: 0.75rem; color: #94a3b8;">${item.planFinish || '-'}</td>
                <td style="text-align: center; font-size: 0.75rem; color: #94a3b8;">${item.location || '-'}</td>
            </tr>
        `;
    });

    tbody.innerHTML = rowsHtml;
}

window.handleFtpManualDateChange = function(inputEl) {
    const ftpId = inputEl.dataset.id;
    const newDate = inputEl.value.trim();
    updateFtpManualDate(ftpId, newDate);
};

window.setFtpManualDateToday = function(btn) {
    const inputEl = btn.parentElement.querySelector('.cs-manual-date-input');
    if (!inputEl) return;
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    const today = `${y}-${m}-${d}`;
    inputEl.value = today;
    window.handleFtpManualDateChange(inputEl);
};

window.clearFtpManualDate = function(btn) {
    const inputEl = btn.parentElement.querySelector('.cs-manual-date-input');
    if (!inputEl) return;
    inputEl.value = '';
    window.handleFtpManualDateChange(inputEl);
};

window.handleFtpProgressChange = function(inputEl) {
    const ftpId = inputEl.dataset.id;
    let prog = parseInt(inputEl.value, 10);
    if (isNaN(prog)) prog = 0;
    if (prog < 0) prog = 0;
    if (prog > 100) prog = 100;
    inputEl.value = prog;

    const gd = window.GLOBAL_MC_DATA;
    if (!gd || !gd.globalFtpList) return;

    const item = gd.globalFtpList.find(x => x.id === ftpId);
    if (item) {
        item.progress = prog;
        if (prog === 100 && !item.isDone) {
            item.isDone = true;
            if (!item.manualDate && !item.cmsDate) {
                const now = new Date();
                const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
                item.manualDate = today;
                item.isManual = true;
            }
        } else if (prog < 100 && item.isDone && item.isManual) {
            item.isDone = false;
            item.manualDate = '';
            item.isManual = false;
        }
    }

    if (currentFtpList) {
        const cItem = currentFtpList.find(x => x.id === ftpId);
        if (cItem && item) {
            cItem.progress = item.progress;
            cItem.isDone = item.isDone;
            cItem.manualDate = item.manualDate;
            cItem.isManual = item.isManual;
        }
    }

    recalculatePrecomMasterCounts();
    renderFtpModalTable();
    renderPrecomMatrix();
    renderPrecomWidgets();
    autoPersistCurrentData();
};

function updateFtpManualDate(ftpId, newDate) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd || !gd.globalFtpList) return;

    const item = gd.globalFtpList.find(x => x.id === ftpId);
    if (item) {
        item.manualDate = newDate;
        item.isManual = !!newDate;
        item.isDone = !!(item.cmsDate || newDate);
        if (item.isDone && (!item.progress || item.progress < 100)) {
            item.progress = 100;
        }
    }

    if (currentFtpList) {
        const cItem = currentFtpList.find(x => x.id === ftpId);
        if (cItem && item) {
            cItem.manualDate = item.manualDate;
            cItem.isManual = item.isManual;
            cItem.isDone = item.isDone;
            cItem.progress = item.progress;
        }
    }

    recalculatePrecomMasterCounts();
    renderFtpModalTable();
    renderPrecomMatrix();
    renderPrecomWidgets();
    autoPersistCurrentData();
}

// ----------------- EXPORT TO EXCEL -----------------
function exportPrecomMatrixToExcel(selectedOnly) {
    if (typeof XLSX === 'undefined') {
        alert("Excel export library not available.");
        return;
    }
    const gd = window.GLOBAL_MC_DATA;
    if (!gd || !gd.precomMatrix) {
        alert("No Precom data to export.");
        return;
    }

    const rows = [];
    const matrix = gd.precomMatrix;

    // Header row
    const hdr = ['SystemNo', 'SubSystemNo', 'SubSystemDescription', 'SkylineDate', 'MC_Gate_CSSC'];
    ACTIVE_PRECOM_DISCS.forEach(d => {
        hdr.push(`${d}_ITRB_Done`, `${d}_ITRB_Total`, `${d}_ITRB_Pct`, `${d}_PunchA`, `${d}_PunchB`, `${d}_PunchC`);
    });
    hdr.push('Precom_Gate_RFC', 'FTP_Done', 'FTP_Total', 'FTP_Progress_Pct', 'FTP_PunchA', 'FTP_PunchB', 'FTP_PunchC');
    rows.push(hdr);

    Object.keys(matrix).sort().forEach(sys => {
        if (selectedOnly && currentPrecomSysFilter !== 'ALL' && sys !== currentPrecomSysFilter) return;

        Object.keys(matrix[sys]).sort().forEach(sub => {
            if (selectedOnly && currentPrecomSubFilter && !sub.toLowerCase().includes(currentPrecomSubFilter)) return;

            const cell = matrix[sys][sub];
            const r = [
                sys,
                sub,
                cell.subsysDesc || '',
                formatSkylineDate(getSubsysSkylineDate(sub)),
                cell.csscDone ? 'SIGNED' : 'PENDING'
            ];

            ACTIVE_PRECOM_DISCS.forEach(d => {
                const discData = cell.disciplines[d] || { i_d: 0, i_t: 0, pa_d: 0, pa_t: 0, pb_d: 0, pb_t: 0, pc_d: 0, pc_t: 0 };
                const pct = discData.i_t > 0 ? ((discData.i_d / discData.i_t) * 100).toFixed(1) + '%' : '-';
                r.push(discData.i_d, discData.i_t, pct, `${discData.pa_d}/${discData.pa_t}`, `${discData.pb_d}/${discData.pb_t}`, `${discData.pc_d}/${discData.pc_t}`);
            });

            const ftpInfo = cell.ftp || { done: 0, total: 0, progress: 0, pca_d: 0, pca_t: 0, pcb_d: 0, pcb_t: 0, pcc_d: 0, pcc_t: 0 };
            r.push(
                cell.rfcDone ? 'SIGNED' : 'PENDING',
                ftpInfo.done,
                ftpInfo.total,
                (ftpInfo.total > 0 ? ftpInfo.progress + '%' : '-'),
                `${ftpInfo.pca_d}/${ftpInfo.pca_t}`,
                `${ftpInfo.pcb_d}/${ftpInfo.pcb_t}`,
                `${ftpInfo.pcc_d}/${ftpInfo.pcc_t}`
            );

            rows.push(r);
        });
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Precom_Comm_Matrix");
    XLSX.writeFile(wb, `Precom_Commissioning_Matrix_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportPrecomChecksheetsToExcel() {
    if (typeof XLSX === 'undefined') {
        alert("Excel export library not available.");
        return;
    }
    if (!currentPrecomCsList || currentPrecomCsList.length === 0) {
        alert("No ITR-B checksheets to export.");
        return;
    }

    const rows = [
        ['No', 'SubSystemNo', 'SubSystemDescription', 'TagNo', 'TagDescription', 'Discipline', 'ChecksheetType', 'CompleteDate_CMS', 'CompleteDate_Manual', 'Status']
    ];

    currentPrecomCsList.forEach((it, idx) => {
        const status = it.isDone ? (it.isManual ? 'Completed (Manual)' : 'Verified (CMS)') : 'Pending';
        rows.push([
            idx + 1,
            it.subsys,
            it.subsysDesc || '',
            it.tag,
            it.tagDesc || '',
            it.disc,
            it.type,
            it.cmsDate || '',
            it.manualDate || '',
            status
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "ITR_B_Checksheets");
    XLSX.writeFile(wb, `ITR_B_${currentPrecomCsSubsys || 'All'}_${currentPrecomCsDisc || ''}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

function exportFtpToExcel() {
    if (typeof XLSX === 'undefined') {
        alert("Excel export library not available.");
        return;
    }
    if (!currentFtpList || currentFtpList.length === 0) {
        alert("No FTP procedures to export.");
        return;
    }

    const rows = [
        ['No', 'SubSystemNo', 'SubSystemDescription', 'ProcedureNo', 'Title', 'Discipline', 'Step', 'TotalStep', 'Progress_Pct', 'CompleteDate_CMS', 'CompleteDate_Manual', 'Status', 'PlanStart', 'PlanFinish', 'Location']
    ];

    currentFtpList.forEach((it, idx) => {
        const status = it.isDone ? (it.isManual ? 'Completed (Manual)' : 'Verified (CMS)') : (it.progress > 0 ? 'In Progress' : 'Not Started');
        rows.push([
            idx + 1,
            it.subsys,
            it.subsysDesc || '',
            it.ftpNo,
            it.title || '',
            it.disc,
            it.step || 0,
            it.totalStep || 0,
            (it.progress || 0) + '%',
            it.cmsDate || '',
            it.manualDate || '',
            status,
            it.planStart || '',
            it.planFinish || '',
            it.location || ''
        ]);
    });

    const ws = XLSX.utils.aoa_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "FTP_Commissioning");
    XLSX.writeFile(wb, `FTP_Commissioning_${currentFtpSubsys || 'All'}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}
