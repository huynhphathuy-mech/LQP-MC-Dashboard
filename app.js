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
    
    // Filters & Export
    setupFilters();
});

function exportData() {
    if (!window.GLOBAL_MC_DATA) return;
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0]; // YYYY-MM-DD
    
    // Clone and attach timestamp
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

async function loadDefaultData() {
    try {
        const response = await fetch('data.json');
        if (!response.ok) return; // Silent fail if no data.json exists
        
        const jsonData = await response.json();
        if (!jsonData || !jsonData.data) return;
        
        window.GLOBAL_MC_DATA = jsonData.data;
        
        const { mcData, dashGroups, matrix, sumItr, sumPunch, sumDac, sumCssc, skyData } = window.GLOBAL_MC_DATA;
        
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

        // Populate Filters
        populateSysDropdown(matrix);
        renderMatrix(matrix);
        renderSkylineBoxes(mcData, sumItr);
        renderSkylineChart(chartLabels, planBar, actBar, planLine, actLine);

        document.getElementById('sync-status').textContent = `Default data loaded (Updated: ${jsonData.updateDate || 'N/A'})`;
        document.getElementById('sync-dot').classList.add('synced');
        document.getElementById('btn-save-data').style.display = 'inline-flex';
    } catch (e) {
        console.log("No default data.json found, waiting for upload.");
    }
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
    if (['ARCHITECTURE', 'STRUCTURE'].includes(disc)) return 'ARCH_STR';
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
            ARCH_STR: initDashGroup()
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

            // Global save for Modals
            window.GLOBAL_MC_DATA = { mcData, dashGroups, matrix, sumItr, sumPunch, sumDac, sumCssc, skyData, sysDescMap, globalPunchList, globalCertList, globalTagMap };

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
            
            syncStatus.textContent = 'Data updated from CMS';
            syncDot.classList.add('synced');
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
    html += createWidgetHtml('PIPING', dashGroups.PIPING, false);
    html += createWidgetHtml('HVAC', dashGroups.HVAC, false);
    html += createWidgetHtml('ELECTRICAL, TELECOM & INST', dashGroups.ETC, false);
    html += createWidgetHtml('SAFETY', dashGroups.SAFETY, false);
    html += createWidgetHtml('ARCHITECTURE & STRUCTURE', dashGroups.ARCH_STR, false);
    
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
    sel.innerHTML = '<option value="ALL">Tất cả systems</option>';
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
    
    info.textContent = `Kết quả tìm Tag / Equipment No: ${tags.length} tag khớp "${q}"`;
    
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
    document.getElementById('modal-title').innerHTML = `Discipline: ${disc} <span style="font-size: 0.8rem; font-weight: 400; color: #94a3b8; margin-left: 10px;">Toàn dự án</span>`;
    document.getElementById('mdl-chart-title').innerText = `S-Curve ITR-A — Toàn dự án — Discipline ${disc}`;

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
    document.getElementById('punch-modal-title').innerHTML = `Punch ${phase}_${catType} <span style="font-size: 0.8rem; font-weight: 400; color: #94a3b8; margin-left: 10px;">Toàn dự án - Tất cả discipline</span>`;
    document.getElementById('punch-table-title').innerText = `Punch ${phase}_${catType} (đỏ = Open • xanh = Closed)`;

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
            <tr style="background: ${trColor}; color: #0f172a;">
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
        <div class="sky-top-box" style="background: #fff; color: #1e293b; border-color: #cbd5e1; text-align: left; min-width: 150px;">
            <div class="sky-box-title" style="color: #64748b;">TẤT CẢ</div>
            <div class="sky-box-val" style="color: #0ea5e9;">${closed} / ${total} <span style="font-size:1rem; color:#ef4444; font-weight:700;">${fPct(closed, total)}</span></div>
        </div>
    `;
    
    DISCIPLINES.forEach(d => {
        const v = discCount[d];
        if (v && v.t > 0) {
            boxesHtml += `
                <div class="sky-top-box" style="background: #fff; color: #1e293b; border-color: #cbd5e1; text-align: left; min-width: 120px;">
                    <div class="sky-box-title" style="color: #64748b;">${d.substring(0,4)}</div>
                    <div class="sky-box-val" style="color: #0f172a; font-size: 1.2rem;">${v.d} / ${v.t} <span style="font-size:0.8rem; color:#ef4444; font-weight:700;">${fPct(v.d, v.t)}</span></div>
                </div>
            `;
        }
    });
    document.getElementById('punch-top-boxes').innerHTML = boxesHtml;
}

function openCertModal(type, group) {
    const gd = window.GLOBAL_MC_DATA;
    if (!gd) return;
    
    document.getElementById('cert-modal').style.display = 'flex';
    document.getElementById('cert-modal-title').innerHTML = `${type} ${group} <span style="font-size: 0.8rem; font-weight: 400; color: #94a3b8; margin-left: 10px;">Chi tiết</span>`;
    
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
