document.addEventListener('DOMContentLoaded', () => {
    setupTabs();
    setupFileUpload();
    loadDefaultData();
    
    // Modal Close
    document.getElementById('modal-close').addEventListener('click', () => { document.getElementById('disc-modal').style.display = 'none'; });
    document.getElementById('punch-modal-close').addEventListener('click', () => { document.getElementById('punch-modal').style.display = 'none'; });
    document.getElementById('cert-modal-close').addEventListener('click', () => { document.getElementById('cert-modal').style.display = 'none'; });

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

    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(exportObj));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "data.json");
    document.body.appendChild(downloadAnchorNode); // required for firefox
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

function applyLoadedData(dataObj, updateDateStr) {
    if (!dataObj) return;
    window.GLOBAL_MC_DATA = dataObj;
    
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
        console.log("fetch('data.json') unavailable on file:// protocol. Checking local IndexedDB cache...");
    }

    // 2. If fetch fails (running as file:/// on drive E), automatically load from IndexedDB!
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
    const keys = Object.keys(row);
    for (let key of keys) {
        const normKey = normalizeStr(key);
        if (normKey === 'PLANFINISHDATE' || normKey === 'PLANSTARTDATE') continue;
        for (let pk of possibleKeys) {
            if (normKey.includes(normalizeStr(pk))) {
                return row[key];
            }
        }
    }
    return '';
}

const DISCIPLINES = ['MECHANICAL', 'HVAC', 'PIPING', 'ELECTRICAL', 'INSTRUMENT', 'TELECOM', 'ARCHITECTURE', 'STRUCTURE', 'SAFETY'];

function classifyDiscipline(discStr) {
    const s = String(discStr).toUpperCase().replace(/\s/g, '');
    if (s.includes('MECH')) return 'MECHANICAL';
    if (s.includes('PIPE') || s.includes('PIPING')) return 'PIPING';
    if (s.includes('ELEC')) return 'ELECTRICAL';
    if (s.includes('INST')) return 'INSTRUMENT';
    if (s.includes('TELE')) return 'TELECOM';
    if (s.includes('STRU')) return 'STRUCTURE';
    if (s.includes('ARCH')) return 'ARCHITECTURE';
    if (s.includes('HVAC')) return 'HVAC';
    if (s.includes('SAFE') || s.includes('F&G') || s.includes('FIRE')) return 'SAFETY';
    return 'OTHER';
}

function initDisciplineData() {
    let d = {};
    DISCIPLINES.forEach(disc => {
        d[disc] = { i_d:0, i_t:0, pa_d:0, pa_t:0, pb_d:0, pb_t:0 };
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
    if (!val) return null;
    if (typeof val === 'number') {
        const parsed = XLSX.SSF.parse_date_code(val);
        return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
    let d = new Date(val);
    if (!isNaN(d.getTime())) return d;
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
                    json.forEach(row => {
                        const type = normalizeStr(getValueRobust(row, ['Checksheet Type', 'ChecksheetType']));
                        if (!type.includes('A')) return; 
                        
                        const subsys = getValueRobust(row, ['SubSystemNo', 'SubSystem No']);
                        if (!subsys) return;
                        const subStr = String(subsys).trim();
                        
                        const desc = getValueRobust(row, ['SubSystemDesc', 'Description', 'SystemDesc']);
                        if (desc && !sysDescMap[subStr]) sysDescMap[subStr] = String(desc).trim();

                        const sys = extractSystem(subsys);
                        const discRaw = getValueRobust(row, ['Discipline', 'DisciplineCode']);
                        const disc = classifyDiscipline(discRaw);
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

                        if (isDone) {
                            globalCompletedChecksheets.push({
                                sys: sys,
                                subsys: subStr,
                                subsysDesc: sysDescMap[subStr] || String(desc || '-').trim(),
                                disc: disc,
                                formNo: String(getValueRobust(row, ['Checksheet Type', 'ChecksheetType']) || '').trim(),
                                tag: tagNo ? String(tagNo).trim() : '',
                                tagDesc: String(getValueRobust(row, ['TagDescription', 'Description', 'EquipmentDescription', 'Tag Description']) || '-').trim(),
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
                                    desc: String(getValueRobust(row, ['TagDescription', 'Description', 'EquipmentDescription', 'Tag Description']) || '-').trim(),
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
                        } else {
                            return; 
                        }

                        if (subsys && DISCIPLINES.includes(disc)) {
                            if (!matrix[sys]) matrix[sys] = {};
                            if (!matrix[sys][subsys]) matrix[sys][subsys] = initDisciplineData();
                            if (cat.includes('A')) {
                                matrix[sys][subsys][disc].pa_t++;
                                if (isClosed) matrix[sys][subsys][disc].pa_d++;
                            } else {
                                matrix[sys][subsys][disc].pb_t++;
                                if (isClosed) matrix[sys][subsys][disc].pb_d++;
                            }
                            
                            const phaseName = String(phase).trim() !== '' ? String(phase) : 'UNKNOWN';
                            if (!sumPunch[phaseName]) sumPunch[phaseName] = {a_d:0, a_t:0, b_d:0, b_t:0};
                            if (cat.includes('A')) {
                                sumPunch[phaseName].a_t++;
                                if (isClosed) sumPunch[phaseName].a_d++;
                            } else {
                                sumPunch[phaseName].b_t++;
                                if (isClosed) sumPunch[phaseName].b_d++;
                            }
                        }
                        
                        // Store raw punch for modal
                        globalPunchList.push({
                            sys: sys,
                            subsys: subsys,
                            punchNo: getValueRobust(row, ['PunchListNo', 'PunchNo']),
                            disc: disc,
                            phase: String(phase).trim() !== '' ? String(phase) : 'UNKNOWN',
                            status: status,
                            tag: getValueRobust(row, ['TagNo']),
                            desc: getValueRobust(row, ['DefectDescription', 'PunchDescription']),
                            actionBy: getValueRobust(row, ['ActionBy', 'Originator']),
                            openDate: getValueRobust(row, ['OpenDate', 'RaiseDate']),
                            closeDate: getValueRobust(row, ['ClosedDate', 'CompleteDate']),
                            expDate: getValueRobust(row, ['Expected Clearance Date', 'ExpectedDate']),
                            cat: cat
                        });
                    });
                }
                
                // CERTIFICATE OVERVIEW
                if (name.includes('certificate')) {
                    json.forEach(row => {
                        const certName = normalizeStr(getValueRobust(row, ['CertificateName', 'Certificate']));
                        const actFinish = getValueRobust(row, ['ActualFinishDate']);
                        let isDone = (actFinish && String(actFinish).toUpperCase() !== 'NAT' && String(actFinish).trim() !== '');

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

            // Global save for Modals
            window.GLOBAL_MC_DATA = { mcData, dashGroups, matrix, sumItr, sumPunch, sumDac, sumCssc, skyData, sysDescMap, globalPunchList, globalCertList, globalTagMap, globalCompletedChecksheets, globalFlashReports };

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

    const createWidgetHtml = (title, dataObj, isOverall) => {
        const getPct = (d, t) => t > 0 ? ((d / t) * 100).toFixed(1) : 0;
        
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
                    
                    <div class="mc-item mc-item-link" onclick="jumpToMcTab()">
                        <div class="mc-info">
                            <span class="mc-label">Punch A Closed</span>
                            <span class="mc-value">${dataObj.punchA.done.toLocaleString()} / ${dataObj.punchA.total.toLocaleString()} <span class="pct pct-red">${getPct(dataObj.punchA.done, dataObj.punchA.total)}%</span></span>
                        </div>
                        <div class="progress-bar"><div class="progress-fill fill-red" style="width:${getPct(dataObj.punchA.done, dataObj.punchA.total)}%"></div></div>
                    </div>
                    
                    <div class="mc-item mc-item-link" onclick="jumpToMcTab()">
                        <div class="mc-info">
                            <span class="mc-label">Punch B Closed</span>
                            <span class="mc-value">${dataObj.punchB.done.toLocaleString()} / ${dataObj.punchB.total.toLocaleString()} <span class="pct pct-yellow">${getPct(dataObj.punchB.done, dataObj.punchB.total)}%</span></span>
                        </div>
                        <div class="progress-bar"><div class="progress-fill fill-yellow" style="width:${getPct(dataObj.punchB.done, dataObj.punchB.total)}%"></div></div>
                    </div>
                    
                    <div class="mc-item mc-item-link" onclick="jumpToMcTab()">
                        <div class="mc-info">
                            <span class="mc-label">DAC (Discipline)</span>
                            <span class="mc-value">${dataObj.dac.done.toLocaleString()} / ${dataObj.dac.total.toLocaleString()} <span class="pct pct-purple">${getPct(dataObj.dac.done, dataObj.dac.total)}%</span></span>
                        </div>
                        <div class="progress-bar"><div class="progress-fill fill-purple" style="width:${getPct(dataObj.dac.done, dataObj.dac.total)}%"></div></div>
                    </div>
                    
                    <div class="mc-item mc-item-link" onclick="jumpToMcTab()" ${isOverall ? '' : 'style="display:none;"'}>
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
    html += createWidgetHtml('OVERALL (All Disciplines)', mcData, true);
    html += createWidgetHtml('MECHANICAL', dashGroups.MECHANICAL, false);
    html += createWidgetHtml('SAFETY', dashGroups.SAFETY, false);
    html += createWidgetHtml('HVAC', dashGroups.HVAC, false);
    html += createWidgetHtml('PIPING', dashGroups.PIPING, false);
    html += createWidgetHtml('ELECTRICAL, TELECOM & INST', dashGroups.ETC, false);
    
    // Support backward compatibility if old data.json is loaded
    if (dashGroups.ARCH_STR) {
        html += createWidgetHtml('ARCHITECTURE & STRUCTURE', dashGroups.ARCH_STR, false);
    } else {
        html += createWidgetHtml('ARCHITECTURE', dashGroups.ARCH || initDashGroup(), false);
        html += createWidgetHtml('STRUCTURE', dashGroups.STR || initDashGroup(), false);
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
    const totPunchD = mcData.punchA.done + mcData.punchB.done;
    const totPunchT = mcData.punchA.total + mcData.punchB.total;
    if (tr2) tr2.innerHTML = `${totPunchD.toLocaleString()} / ${totPunchT.toLocaleString()} <span style="font-size:0.75rem; color:#f59e0b;">${totPunchT > 0 ? ((totPunchD/totPunchT)*100).toFixed(1) : 0}%</span>`;
    const gr2 = document.getElementById('grid-punch');
    if (gr2) {
        gr2.innerHTML = '';
        Object.keys(sumPunch).sort().forEach(k => {
            const v = sumPunch[k];
            if (v.a_t > 0) gr2.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('${k}', 'A')" title="Click to view details"><div class="mc-sm-lbl" style="color:#ef4444;">${k}_A</div><div class="mc-sm-val">${v.a_d}/${v.a_t} ${formatSmPct(v.a_d,v.a_t, true)}</div></div>`;
            if (v.b_t > 0) gr2.innerHTML += `<div class="mc-sm-item" style="cursor:pointer;" onclick="openPunchModal('${k}', 'B')" title="Click to view details"><div class="mc-sm-lbl" style="color:#f59e0b;">${k}_B</div><div class="mc-sm-val">${v.b_d}/${v.b_t} ${formatSmPct(v.b_d,v.b_t)}</div></div>`;
        });
    }

    // 3. DAC
    const tr3 = document.getElementById('sum-dac-total');
    if (tr3) tr3.innerHTML = `${mcData.dac.done.toLocaleString()} / ${mcData.dac.total.toLocaleString()} <span style="font-size:0.75rem; color:#a855f7;">${mcData.dac.total > 0 ? ((mcData.dac.done/mcData.dac.total)*100).toFixed(1) : 0}%</span>`;
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
    if (tr4) tr4.innerHTML = `${mcData.cssc.done.toLocaleString()} / ${mcData.cssc.total.toLocaleString()} <span style="font-size:0.75rem; color:#10b981;">${mcData.cssc.total > 0 ? ((mcData.cssc.done/mcData.cssc.total)*100).toFixed(1) : 0}%</span>`;
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

function renderMatrix(matrix) {
    const tbody = document.getElementById('tbody-matrix');
    if (!tbody) return;
    
    // Get filter values
    const sysFilter = document.getElementById('filter-sys') ? document.getElementById('filter-sys').value : 'ALL';
    const subFilter = document.getElementById('filter-subsys') ? document.getElementById('filter-subsys').value.toLowerCase().trim() : '';
    const incFilter = document.getElementById('filter-incomplete') ? document.getElementById('filter-incomplete').checked : false;
    const sumCssc = window.GLOBAL_MC_DATA ? window.GLOBAL_MC_DATA.sumCssc : {};

    tbody.innerHTML = '';
    const systems = Object.keys(matrix).sort();

    if (systems.length === 0) {
        tbody.innerHTML = '<tr><td colspan="28" style="text-align:center; padding: 4rem;">No Data Found</td></tr>';
        return;
    }

    systems.forEach(sys => {
        if (sysFilter !== 'ALL' && sys !== sysFilter) return;

        let hasVisibleSubsys = false;
        const sysFragment = document.createDocumentFragment();

        const subsysKeys = Object.keys(matrix[sys]).sort();
        subsysKeys.forEach(sub => {
            if (subFilter && !sub.toLowerCase().includes(subFilter)) return;

            let isIncomplete = false;
            let html = `<td class="col-sys">${sub}</td>`;
            
            DISCIPLINES.forEach(disc => {
                const data = matrix[sys][sub][disc];
                html += renderCell(data.i_d, data.i_t, false);
                html += renderCell(data.pa_d, data.pa_t, true);
                html += renderCell(data.pb_d, data.pb_t, false);

                if (data.i_t > 0 && data.i_d < data.i_t) isIncomplete = true;
                if (data.pa_t > 0 && data.pa_d < data.pa_t) isIncomplete = true;
                if (data.pb_t > 0 && data.pb_d < data.pb_t) isIncomplete = true;
            });
            
            if (sumCssc[sub] && sumCssc[sub].t > 0 && sumCssc[sub].d < sumCssc[sub].t) isIncomplete = true;
            if (incFilter && !isIncomplete) return;

            const trSub = document.createElement('tr');
            trSub.className = 'subsys-row';
            trSub.innerHTML = html;
            sysFragment.appendChild(trSub);
            hasVisibleSubsys = true;
        });

        if (hasVisibleSubsys) {
            const trSys = document.createElement('tr');
            trSys.className = 'sys-row';
            trSys.innerHTML = `<td class="col-sys">SYSTEM ${sys}</td><td colspan="27"></td>`;
            tbody.appendChild(trSys);
            tbody.appendChild(sysFragment);
        }
    });
    
    if (tbody.children.length === 0) {
        tbody.innerHTML = '<tr><td colspan="28" style="text-align:center; padding: 4rem;">No matching data</td></tr>';
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
    const filterTag = document.getElementById('filter-tag');

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
        
        document.getElementById('filter-sys').value = 'ALL';
        document.getElementById('filter-subsys').value = '';
        document.getElementById('filter-incomplete').checked = false;
        
        renderMatrix(window.GLOBAL_MC_DATA.matrix);
        exportTableToExcel('matrix-table', 'LQP_Matrix_All.xlsx');
        
        // Restore
        document.getElementById('filter-sys').value = oldSys;
        document.getElementById('filter-subsys').value = oldSub;
        document.getElementById('filter-incomplete').checked = oldInc;
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
    document.getElementById('mdl-chart-title').innerText = `S-Curve ITR-A — Whole Project — Discipline ${disc}`;

    // Calculate Modal 4 Boxes
    let itrT = 0, itrD = 0, paT = 0, paD = 0, pbT = 0, pbD = 0, dacT = 0, dacD = 0;
    
    let subTbodyHtml = '';
    let idx = 1;
    let rowCount = 0;

    Object.keys(gd.matrix).sort().forEach(sys => {
        Object.keys(gd.matrix[sys]).sort().forEach(sub => {
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
            
            const fmtCell = (d, t) => t > 0 ? `${d}/${t}` : '-';

            subTbodyHtml += `
                <tr>
                    <td>${idx++}</td>
                    <td>${sys}</td>
                    <td><b>${sub}</b></td>
                    <td>${desc}</td>
                    <td>${fmtCell(data.i_d, data.i_t)}</td>
                    <td><span style="color: ${subPct === '100.0' ? '#10b981' : (subPct === '0.0' ? '#ef4444' : '#0f172a')}">${subPct}%</span></td>
                    <td>${fmtCell(data.pa_d, data.pa_t)}</td>
                    <td>${fmtCell(data.pb_d, data.pb_t)}</td>
                    <td>${subDacDone ? '<span style="color:#10b981;">&#10004;</span>' : '-'}</td>
                </tr>
            `;
        });
    });

    document.getElementById('mdl-tbody').innerHTML = subTbodyHtml;
    document.getElementById('mdl-table-title').innerHTML = `Tổng hợp theo Subsystem (${rowCount}) <span style="font-size:0.75rem; color:#64748b; font-weight:400; margin-left:10px;">Click 1 dòng để xem chi tiết (Coming soon)</span>`;
    
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
                { type: 'line', label: 'Lũy kế Actual', data: actLine, borderColor: '#f59e0b', backgroundColor: '#f59e0b', borderWidth: 2, yAxisID: 'y1', tension: 0.1, pointRadius: 3 },
                { type: 'line', label: 'Lũy kế Plan', data: planLine, borderColor: '#3b82f6', backgroundColor: '#3b82f6', borderWidth: 2, yAxisID: 'y1', tension: 0.1, pointRadius: 3 },
                { type: 'bar', label: 'ITR-A closed / ngày', data: actBar, backgroundColor: '#10b981', yAxisID: 'y', barPercentage: 0.8 },
                { type: 'bar', label: 'Plan ITR-A / ngày', data: planBar, backgroundColor: '#ef4444', yAxisID: 'y', barPercentage: 0.8 }
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

function openPunchModal(phase, catType) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    
    document.getElementById('punch-modal').style.display = 'flex';
    document.getElementById('punch-modal-title').innerHTML = `Punch ${phase}_${catType} <span style="font-size: 0.8rem; font-weight: 400; color: #94a3b8; margin-left: 10px;">Whole Project - All disciplines</span>`;
    document.getElementById('punch-table-title').innerText = `Punch ${phase}_${catType} (Red = Open • Green = Closed)`;

    const punches = gd.globalPunchList.filter(p => p.phase === phase && p.cat.includes(catType));
    
    let total = 0, closed = 0;
    let discCount = {};
    DISCIPLINES.forEach(d => discCount[d] = {t:0, d:0});
    
    let tbodyHtml = '';
    let idx = 1;
    
    punches.forEach(p => {
        total++;
        const isClosed = p.status.toUpperCase().includes('CLOSE');
        if (isClosed) closed++;
        
        if (discCount[p.disc]) {
            discCount[p.disc].t++;
            if (isClosed) discCount[p.disc].d++;
        }
        
        const trColor = isClosed ? '#dcfce7' : '#fee2e2'; 
        tbodyHtml += `
            <tr style="background: ${trColor}; color: #0f172a;" class="punch-row" data-disc="${p.disc}">
                <td>${idx++}</td>
                <td>${p.sys}</td>
                <td><b>${p.subsys}</b></td>
                <td><b>${p.punchNo}</b></td>
                <td>${p.disc}</td>
                <td>${p.phase}</td>
                <td>${p.status}</td>
                <td>${p.tag}</td>
                <td>${p.desc}</td>
                <td>${p.actionBy}</td>
                <td>${formatDateStr(p.openDate)}</td>
                <td>${formatDateStr(p.closeDate)}</td>
                <td>${formatDateStr(p.expDate)}</td>
            </tr>
        `;
    });
    
    document.getElementById('punch-tbody').innerHTML = tbodyHtml;
    
    // Top Boxes
    const fPct = (d, t) => t > 0 ? ((d/t)*100).toFixed(1) + '%' : '0.0%';
    let boxesHtml = `
        <div class="sky-top-box punch-filter-box" onclick="filterPunchTable('ALL')" style="cursor: pointer; background: #fff; color: #1e293b; border-color: #cbd5e1; text-align: left; min-width: 150px; transition: background 0.2s;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='#fff'">
            <div class="sky-box-title" style="color: #64748b;">ALL</div>
            <div class="sky-box-val" style="color: #0ea5e9;">${closed} / ${total} <span style="font-size:1rem; color:#ef4444; font-weight:700;">${fPct(closed, total)}</span></div>
        </div>
    `;
    
    DISCIPLINES.forEach(d => {
        const v = discCount[d];
        if (v && v.t > 0) {
            boxesHtml += `
                <div class="sky-top-box punch-filter-box" onclick="filterPunchTable('${d}')" style="cursor: pointer; background: #fff; color: #1e293b; border-color: #cbd5e1; text-align: left; min-width: 120px; transition: background 0.2s;" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='#fff'">
                    <div class="sky-box-title" style="color: #64748b;" title="${d}">${d.substring(0,4)}</div>
                    <div class="sky-box-val" style="color: #0f172a; font-size: 1.2rem;">${v.d} / ${v.t} <span style="font-size:0.8rem; color:#ef4444; font-weight:700;">${fPct(v.d, v.t)}</span></div>
                </div>
            `;
        }
    });
    document.getElementById('punch-top-boxes').innerHTML = boxesHtml;
}

window.filterPunchTable = function(disc) {
    const rows = document.querySelectorAll('#punch-tbody .punch-row');
    let count = 0;
    rows.forEach(r => {
        if (disc === 'ALL' || r.getAttribute('data-disc') === disc) {
            r.style.display = '';
            count++;
        } else {
            r.style.display = 'none';
        }
    });
    
    const subTitle = document.querySelector('#punch-modal-title span');
    if (subTitle) {
        subTitle.innerText = disc === 'ALL' ? 'Whole Project - All disciplines' : `Whole Project - Discipline: ${disc} (${count} items)`;
    }
};

function openCertModal(type, group) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    
    document.getElementById('cert-modal').style.display = 'flex';
    document.getElementById('cert-modal-title').innerHTML = `${type} ${group} <span style="font-size: 0.8rem; font-weight: 400; color: #94a3b8; margin-left: 10px;">Details</span>`;
    
    let certs = [];
    if (type === 'DAC') {
        certs = gd.globalCertList.filter(c => c.type === 'DAC' && c.disc === group);
    } else {
        certs = gd.globalCertList.filter(c => c.type === 'CSSC' && c.subsys === group);
    }
    
    let tbodyHtml = '';
    let idx = 1;
    certs.forEach(c => {
        const isClosed = c.status === 'CLOSED';
        const stColor = isClosed ? '#10b981' : '#ef4444';
        tbodyHtml += `
            <tr>
                <td>${idx++}</td>
                <td><b>${c.cert}</b></td>
                <td>${c.disc}</td>
                <td>${c.sys}</td>
                <td>${c.subsys}</td>
                <td style="color: ${stColor}; font-weight: 700;">${c.status}</td>
                <td>${formatDateStr(c.plan)}</td>
                <td>${formatDateStr(c.act)}</td>
            </tr>
        `;
    });
    
    document.getElementById('cert-tbody').innerHTML = tbodyHtml;
}


// =========================================================================
// ----------------- REPORTS TAB LOGIC (WEEKLY & MONTHLY) ------------------
// =========================================================================

let currentFilteredReports = [];


function formatDateDisplay(val) {
    if (!val) return '';
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    if (val instanceof Date && !isNaN(val.getTime())) {
        const dd = String(val.getDate()).padStart(2, '0');
        const mmm = months[val.getMonth()];
        const yyyy = val.getFullYear();
        return `${dd}-${mmm}-${yyyy}`;
    }
    const str = String(val).trim();
    if (str.includes('-')) {
        const parts = str.split('T')[0].split(' ')[0].split('-');
        if (parts.length === 3) {
            const yyyy = parts[0];
            const mIdx = parseInt(parts[1], 10) - 1;
            const dd = parts[2].substring(0, 2).padStart(2, '0');
            if (mIdx >= 0 && mIdx < 12) {
                return `${dd}-${months[mIdx]}-${yyyy}`;
            }
        }
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
        const dd = String(d.getDate()).padStart(2, '0');
        const mmm = months[d.getMonth()];
        const yyyy = d.getFullYear();
        return `${dd}-${mmm}-${yyyy}`;
    }
    return str;
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
        ['Project: BLOCK B LQP — MECHANICAL COMPLETION', '', '', '', '', '', '', '', ''],
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
        if (capEl) capEl.textContent = `${item.tag} — ${item.desc || ''}`;
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
