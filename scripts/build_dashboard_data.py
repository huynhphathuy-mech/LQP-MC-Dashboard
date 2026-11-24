"""
BLOCK B LQP - MC DASHBOARD AUTOMATED DATA BUILDER
Parses the 4 PTSC PMS Excel exports (Checksheet, Punchlist, Certificate, FTP),
merges preserved manual data (Site Walkdown, Flash Reports, Manual ITR/FTP dates,
Skyline dates, KPI S-Curve) from manual_data.json, and generates:
  - data.json          (full dashboard dataset for GitHub Pages)
  - data.js            (window.PRELOADED_MC_DATA for zero-CORS offline file:// use)
  - manual_data.json   (separated manual data updated by Admin Mode on web)
  - manual_data.js     (window.PRELOADED_MANUAL_DATA for offline use)
  - sync_meta.json     (lightweight metadata for fast Sync Data checks)
"""

import os
import sys
import re
import json
import argparse
from datetime import datetime, date, timedelta, timezone
import openpyxl

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

VN_TZ = timezone(timedelta(hours=7))

DISCIPLINES = [
    'MECHANICAL', 'PIPING', 'ELECTRICAL', 'INSTRUMENT', 'TELECOM',
    'STRUCTURE', 'ARCHITECTURE', 'HVAC', 'SAFETY'
]
ACTIVE_PRECOM_DISCS = ['MECHANICAL', 'PIPING', 'ELECTRICAL', 'INSTRUMENT', 'TELECOM', 'HVAC']
LQ_PREFIXES = ('CLQM', 'CLQU')


def normalize_str(val):
    if val is None:
        return ''
    return re.sub(r'\s+', '', str(val)).upper()


def classify_discipline(disc_str):
    s = normalize_str(disc_str)
    if 'MECH' in s:
        return 'MECHANICAL'
    if 'PIP' in s:
        return 'PIPING'
    if 'TELE' in s:
        return 'TELECOM'
    if 'ELEC' in s:
        return 'ELECTRICAL'
    if 'INST' in s:
        return 'INSTRUMENT'
    if 'STRU' in s:
        return 'STRUCTURE'
    if 'ARCH' in s:
        return 'ARCHITECTURE'
    if 'HVAC' in s:
        return 'HVAC'
    if 'SAFE' in s or 'F&G' in s or 'FIRE' in s:
        return 'SAFETY'
    return 'OTHER'


def get_dash_group(disc):
    if disc == 'MECHANICAL':
        return 'MECHANICAL'
    if disc == 'PIPING':
        return 'PIPING'
    if disc == 'HVAC':
        return 'HVAC'
    if disc == 'SAFETY':
        return 'SAFETY'
    if disc in ('ELECTRICAL', 'TELECOM', 'INSTRUMENT'):
        return 'ETC'
    if disc == 'ARCHITECTURE':
        return 'ARCH'
    if disc == 'STRUCTURE':
        return 'STR'
    return None


def init_dash_group():
    return {
        'itrA': {'done': 0, 'total': 0},
        'punchA': {'done': 0, 'total': 0},
        'punchB': {'done': 0, 'total': 0},
        'punchC': {'done': 0, 'total': 0},
        'dac': {'done': 0, 'total': 0},
        'cssc': {'done': 0, 'total': 0},
    }


def init_discipline_data():
    return {
        d: {'i_d': 0, 'i_t': 0, 'pa_d': 0, 'pa_t': 0, 'pb_d': 0, 'pb_t': 0, 'pc_d': 0, 'pc_t': 0}
        for d in DISCIPLINES
    }


def extract_system(subsys):
    if not subsys:
        return 'UNKNOWN'
    parts = str(subsys).strip().split('-')
    if len(parts) >= 2:
        return f"{parts[0]}-{parts[1]}"
    return str(subsys).strip()


def is_lq_scope(val):
    if not val:
        return False
    s = str(val).strip().upper()
    return s.startswith(LQ_PREFIXES)


def parse_excel_date(val):
    if val is None or val == '':
        return None
    if isinstance(val, datetime):
        return val if val.year > 1970 else None
    if isinstance(val, date):
        return datetime(val.year, val.month, val.day) if val.year > 1970 else None
    s = str(val).strip()
    if not s or s.upper() in ('NAT', 'NONE', 'NULL', '-'):
        return None
    # Numeric Excel serial date
    try:
        num = float(s)
        if 1000 <= num <= 100000:
            dt = datetime(1899, 12, 30) + timedelta(days=num)
            return dt if dt.year > 1970 else None
    except ValueError:
        pass
    # Common string formats
    for fmt in (
        '%Y-%m-%d', '%Y-%m-%d %H:%M:%S', '%Y-%m-%dT%H:%M:%S',
        '%d/%m/%Y', '%d-%m-%Y', '%m/%d/%Y', '%d/%m/%Y %H:%M:%S',
        '%d-%b-%Y', '%d-%b-%y', '%Y/%m/%d'
    ):
        try:
            dt = datetime.strptime(s[:19], fmt)
            return dt if dt.year > 1970 else None
        except ValueError:
            continue
    return None


def format_date_str(val):
    dt = parse_excel_date(val)
    if not dt:
        return ''
    return dt.strftime('%Y-%m-%d')


def format_date_display(val):
    dt = parse_excel_date(val)
    if not dt:
        return ''
    return dt.strftime('%d/%m/%Y')


def get_week_key(val):
    dt = parse_excel_date(val)
    if not dt:
        return None
    monday = dt - timedelta(days=dt.weekday())
    return monday.strftime('%Y-%m-%d')


def get_value_robust(row, possible_keys):
    if not row:
        return ''
    keys = list(row.keys())
    # Priority 1: Exact normalized match
    for pk in possible_keys:
        norm_pk = normalize_str(pk)
        for key in keys:
            norm_key = normalize_str(key)
            if norm_key in ('PLANFINISHDATE', 'PLANSTARTDATE'):
                continue
            if norm_key == norm_pk:
                val = row[key]
                if val is not None and str(val).strip() != '':
                    return val
    # Priority 2: Substring match
    for pk in possible_keys:
        norm_pk = normalize_str(pk)
        for key in keys:
            norm_key = normalize_str(key)
            if norm_key in ('PLANFINISHDATE', 'PLANSTARTDATE'):
                continue
            if norm_pk in ('DESCRIPTION', 'DESC') and ('SUBSYSTEM' in norm_key or 'SYSTEM' in norm_key):
                continue
            if norm_pk in norm_key:
                val = row[key]
                if val is not None and str(val).strip() != '':
                    return val
    return ''


def read_excel_rows_dict(xlsx_path):
    """
    Reads an Excel file exported from PTSC PMS cleanly even when
    the worksheet XML contains an incorrect <dimension> tag.
    """
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    raw_rows = list(ws.iter_rows(values_only=True))
    wb.close()
    if not raw_rows:
        return []

    # Find header row
    header_idx = 0
    for i in range(min(15, len(raw_rows))):
        norm_vals = [normalize_str(v) for v in raw_rows[i] if v is not None]
        if any(k in norm_vals for k in ('CATEGORY', 'CHECKSHEETTYPE', 'CERTIFICATENAME', 'TAGNO')):
            header_idx = i
            break

    headers = []
    for idx, h in enumerate(raw_rows[header_idx]):
        name = str(h).strip() if h is not None and str(h).strip() != '' else f'__COL_{idx}'
        headers.append(name)

    records = []
    for row in raw_rows[header_idx + 1:]:
        if not any(v is not None and str(v).strip() != '' for v in row):
            continue
        rec = {}
        for idx, h in enumerate(headers):
            val = row[idx] if idx < len(row) else ''
            rec[h] = '' if val is None else val
        records.append(rec)
    return records


def extract_manual_data_from_legacy(data_json_path):
    """Extracts existing manual entries from legacy data.json on first migration."""
    manual = {
        'updatedAt': datetime.now(VN_TZ).strftime('%Y-%m-%d %H:%M:%S'),
        'siteWalkdownPunches': [],
        'globalFlashReports': [],
        'manualItrA': [],
        'manualItrB': [],
        'manualFtp': {},
        'subsysSkylineDates': {},
        'skyKpi': {
            'hasKpi': False,
            'kpiPlan': {},
            'kpiAct': {},
            'kpiDiscPlan': {},
            'kpiDiscAct': {}
        }
    }
    if not os.path.exists(data_json_path):
        return manual

    try:
        with open(data_json_path, 'r', encoding='utf-8') as f:
            legacy = json.load(f)
        inner = legacy.get('data', {})
        manual['siteWalkdownPunches'] = inner.get('siteWalkdownPunches', []) or []
        manual['globalFlashReports'] = inner.get('globalFlashReports', []) or []
        manual['manualItrA'] = [
            x for x in (inner.get('globalCompletedChecksheets') or []) if x.get('isManual')
        ]
        manual['manualItrB'] = [
            x for x in (inner.get('globalCompletedPrecomChecksheets') or []) if x.get('isManual')
        ]
        # Manual FTP entries keyed by ftpNo
        for f_item in (inner.get('globalFtpList') or []):
            if f_item.get('isManual') or f_item.get('manualDate'):
                ftp_no = f_item.get('ftpNo')
                if ftp_no:
                    manual['manualFtp'][ftp_no] = {
                        'manualDate': f_item.get('manualDate', ''),
                        'progress': f_item.get('progress', 0),
                        'isManual': bool(f_item.get('isManual'))
                    }
        manual['subsysSkylineDates'] = inner.get('subsysSkylineDates', {}) or {}
        sky = inner.get('skyData', {}) or {}
        if sky.get('hasKpi'):
            manual['skyKpi'] = {
                'hasKpi': True,
                'kpiPlan': sky.get('kpiPlan') or sky.get('itrPlanByWeek') or {},
                'kpiAct': sky.get('kpiAct') or sky.get('itrActualByWeek') or {},
                'kpiDiscPlan': sky.get('kpiDiscPlan') or sky.get('discPlanByWeek') or {},
                'kpiDiscAct': sky.get('kpiDiscAct') or sky.get('discActualByWeek') or {},
            }
    except Exception as exc:
        print(f"[WARN] Could not extract legacy manual data: {exc}")
    return manual


def load_or_init_manual_data(mc_dir):
    manual_path = os.path.join(mc_dir, 'manual_data.json')
    if os.path.exists(manual_path):
        with open(manual_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    legacy_path = os.path.join(mc_dir, 'data.json')
    print("-> First-time migration: extracting manual data from existing data.json...")
    manual = extract_manual_data_from_legacy(legacy_path)
    save_manual_files(mc_dir, manual)
    return manual


def save_manual_files(mc_dir, manual):
    manual_json_path = os.path.join(mc_dir, 'manual_data.json')
    manual_js_path = os.path.join(mc_dir, 'manual_data.js')
    with open(manual_json_path, 'w', encoding='utf-8') as f:
        json.dump(manual, f, ensure_ascii=False, indent=2)
    with open(manual_js_path, 'w', encoding='utf-8') as f:
        f.write("window.PRELOADED_MANUAL_DATA = " + json.dumps(manual, ensure_ascii=False) + ";\n")


def parse_skyline_file(xlsx_path, subsys_skyline_dates):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    handover_sheet = next((s for s in wb.sheetnames if 'handover' in s.lower()), None)
    if not handover_sheet:
        wb.close()
        return subsys_skyline_dates
    ws = wb[handover_sheet]
    raw_rows = list(ws.iter_rows(values_only=True))
    wb.close()
    for r in range(4, len(raw_rows)):
        row = raw_rows[r]
        if len(row) <= 34:
            continue
        raw_sub = row[1]
        if not raw_sub:
            continue
        m = re.match(r'^(\d+)\.(\d+)\s+([A-Z]+)\s+([MU])$', str(raw_sub).strip())
        if m:
            prefix = 'CLQM' if m.group(4) == 'M' else 'CLQU'
            std_sub = f"{prefix}-{m.group(1)}-{m.group(2)}"
            disc_code = m.group(3)
            c32 = row[32]
            c34 = row[34]
            eff = c34 or c32
            if eff:
                if std_sub not in subsys_skyline_dates:
                    subsys_skyline_dates[std_sub] = {
                        'targetDate': None, 'handoverDate': None, 'csscDate': None, 'discDates': {}
                    }
                d_str = format_date_str(eff) or str(eff).split('T')[0].split(' ')[0]
                if c34:
                    subsys_skyline_dates[std_sub]['handoverDate'] = format_date_str(c34) or str(c34).split('T')[0].split(' ')[0]
                if c32:
                    subsys_skyline_dates[std_sub]['csscDate'] = format_date_str(c32) or str(c32).split('T')[0].split(' ')[0]
                if not subsys_skyline_dates[std_sub]['targetDate']:
                    subsys_skyline_dates[std_sub]['targetDate'] = d_str
                subsys_skyline_dates[std_sub]['discDates'][disc_code] = d_str
    return subsys_skyline_dates


def parse_kpi_file(xlsx_path):
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    kpi = {
        'hasKpi': True,
        'kpiPlan': {},
        'kpiAct': {},
        'kpiDiscPlan': {},
        'kpiDiscAct': {}
    }
    for sheet_name in wb.sheetnames:
        sn = sheet_name.upper()
        disc = None
        if 'TOTAL' in sn or 'OVERALL' in sn:
            disc = 'OVERALL'
        elif 'ELE' in sn:
            disc = 'ELECTRICAL'
        elif 'INS' in sn:
            disc = 'INSTRUMENT'
        elif 'TEL' in sn:
            disc = 'TELECOM'
        elif 'HVAC' in sn:
            disc = 'HVAC'
        elif 'PIP' in sn:
            disc = 'PIPING'
        elif 'MEC' in sn:
            disc = 'MECHANICAL'
        elif 'STR' in sn:
            disc = 'STRUCTURE'
        elif 'ARC' in sn:
            disc = 'ARCHITECTURE'
        elif 'SAF' in sn:
            disc = 'SAFETY'
        if not disc:
            continue

        ws = wb[sheet_name]
        rows = list(ws.iter_rows(values_only=True))
        dates_row = plan_row = act_row = None
        for row in rows:
            first_cell = str(row[0] or '').strip().upper() if row else ''
            if first_cell == 'TYPE':
                dates_row = row
            elif '1. KPI PLAN' in first_cell:
                plan_row = row
            elif '3. ACTUAL' in first_cell and 'CUM' not in first_cell:
                act_row = row

        if dates_row and plan_row:
            for c in range(1, len(dates_row)):
                wk = get_week_key(dates_row[c])
                if not wk:
                    continue
                try:
                    p_val = float(plan_row[c]) if c < len(plan_row) and plan_row[c] not in (None, '') else 0.0
                except (ValueError, TypeError):
                    p_val = 0.0
                try:
                    a_val = float(act_row[c]) if act_row and c < len(act_row) and act_row[c] not in (None, '') else 0.0
                except (ValueError, TypeError):
                    a_val = 0.0

                if disc == 'OVERALL':
                    kpi['kpiPlan'][wk] = kpi['kpiPlan'].get(wk, 0.0) + p_val
                    kpi['kpiAct'][wk] = kpi['kpiAct'].get(wk, 0.0) + a_val
                else:
                    kpi['kpiDiscPlan'].setdefault(disc, {})
                    kpi['kpiDiscAct'].setdefault(disc, {})
                    kpi['kpiDiscPlan'][disc][wk] = kpi['kpiDiscPlan'][disc].get(wk, 0.0) + p_val
                    kpi['kpiDiscAct'][disc][wk] = kpi['kpiDiscAct'][disc].get(wk, 0.0) + a_val
    wb.close()
    return kpi


def find_file_matching(directory, keyword, extensions=('.xlsx', '.xlsm')):
    if not os.path.isdir(directory):
        return None
    matches = []
    for fn in os.listdir(directory):
        if fn.startswith('~$'):
            continue
        low = fn.lower()
        if keyword.lower() in low and low.endswith(extensions):
            full = os.path.join(directory, fn)
            matches.append((os.path.getmtime(full), full))
    if not matches:
        return None
    matches.sort(reverse=True)
    return matches[0][1]


def build_dashboard(mc_dir, excel_dir, sync_source='Local Build', parse_manual_excels=False):
    manual = load_or_init_manual_data(mc_dir)

    # Optionally refresh Skyline/KPI from local Excel files
    if parse_manual_excels:
        sky_file = find_file_matching(excel_dir, 'skyline')
        if sky_file:
            print(f"-> Parsing Skyline file: {os.path.basename(sky_file)}")
            manual['subsysSkylineDates'] = parse_skyline_file(sky_file, manual.get('subsysSkylineDates') or {})
        kpi_file = find_file_matching(excel_dir, 'kpi')
        if kpi_file:
            print(f"-> Parsing KPI S-Curve file: {os.path.basename(kpi_file)}")
            manual['skyKpi'] = parse_kpi_file(kpi_file)
        save_manual_files(mc_dir, manual)

    cs_file = find_file_matching(excel_dir, 'checksheet', ('.xlsx',))
    pl_file = find_file_matching(excel_dir, 'punchlist', ('.xlsx',))
    cert_file = find_file_matching(excel_dir, 'certificate', ('.xlsx',))
    ftp_file = find_file_matching(excel_dir, 'ftp', ('.xlsx',))

    missing = [lbl for lbl, p in [('Checksheet', cs_file), ('Punchlist', pl_file), ('Certificate', cert_file), ('FTP', ftp_file)] if not p]
    if missing:
        print(f"[WARN] Missing PMS Excel file(s) in {excel_dir}: {missing}")

    mc_data = {
        'itrA': {'done': 0, 'total': 0},
        'punchA': {'done': 0, 'total': 0},
        'punchB': {'done': 0, 'total': 0},
        'punchC': {'done': 0, 'total': 0},
        'dac': {'done': 0, 'total': 0},
        'cssc': {'done': 0, 'total': 0},
    }
    dash_groups = {
        g: init_dash_group()
        for g in ('MECHANICAL', 'PIPING', 'HVAC', 'ETC', 'SAFETY', 'ARCH', 'STR')
    }
    matrix = {}
    sum_itr = {d: {'d': 0, 't': 0} for d in DISCIPLINES}
    sum_punch = {}
    sum_dac = {}
    sum_cssc = {}
    sys_desc_map = {}

    global_punch_list = []
    global_cert_list = []
    global_tag_map = {}
    global_completed_checksheets = []
    global_checksheet_map = {}
    subsys_skyline_dates = manual.get('subsysSkylineDates') or {}

    precom_data = {
        'itrB': {'done': 0, 'total': 0},
        'ftp': {'done': 0, 'total': 0},
        'punchPre': {'done': 0, 'total': 0, 'a_d': 0, 'a_t': 0, 'b_d': 0, 'b_t': 0, 'c_d': 0, 'c_t': 0},
        'punchCom': {'done': 0, 'total': 0, 'a_d': 0, 'a_t': 0, 'b_d': 0, 'b_t': 0, 'c_d': 0, 'c_t': 0},
        'rfc': {'done': 0, 'total': 0},
    }
    sum_itr_b = {d: {'d': 0, 't': 0} for d in ACTIVE_PRECOM_DISCS}
    sum_ftp = {'done': 0, 'total': 0, 'byDisc': {}}
    precom_matrix = {}
    global_precom_checksheet_map = {}
    global_ftp_list = []
    global_completed_precom_checksheets = []
    cssc_map = {}
    rfc_map = {}

    sky_data = {
        'itrPlanByWeek': {},
        'itrActualByWeek': {},
        'subsysItrTotal': {},
        'subsysPlanWeek': {},
        'subsysDiscItrTotal': {},
        'discActualByWeek': {},
        'discPlanByWeek': {},
    }

    # 1. CHECKSHEET OVERVIEW (ITR-A + ITR-B)
    if cs_file:
        print(f"-> Parsing Checksheets: {os.path.basename(cs_file)}")
        rows = read_excel_rows_dict(cs_file)
        for row in rows:
            cs_type_raw = str(get_value_robust(row, ['Checksheet Type', 'ChecksheetType']) or '').strip()
            cs_type_norm = normalize_str(cs_type_raw)
            phase = normalize_str(get_value_robust(row, ['Phase']))
            subsys = get_value_robust(row, ['SubSystemNo', 'SubSystem No'])
            if not subsys:
                continue
            sub_str = str(subsys).strip()
            if not is_lq_scope(sub_str):
                continue

            desc = get_value_robust(row, ['SubSystemDescription', 'SubSystemDesc', 'Description', 'SystemDesc'])
            if desc and sub_str not in sys_desc_map:
                sys_desc_map[sub_str] = str(desc).strip()

            sys_no = extract_system(sub_str)
            disc_raw = get_value_robust(row, ['Discipline', 'DisciplineCode'])
            disc = classify_discipline(disc_raw)
            tag_no = str(get_value_robust(row, ['TagNo', 'Tag No', 'EquipmentNo', 'Equipment No']) or '').strip()
            row_no = get_value_robust(row, ['No', 'ID']) or ''
            tag_desc = str(get_value_robust(row, ['TagDescription', 'Tag Description', 'EquipmentDescription', 'Description']) or '-').strip()
            comp_date = get_value_robust(row, ['CompleteDate', 'Complete'])
            is_done = bool(parse_excel_date(comp_date))

            # Skip group summary rows without Checksheet Type / TagNo
            if not cs_type_raw and not tag_no:
                continue

            # ITR-B (PRECOMMISSIONING)
            if phase == 'PC' or cs_type_raw.upper().endswith('-B') or cs_type_norm.endswith('B'):
                if disc not in ACTIVE_PRECOM_DISCS:
                    continue
                precom_data['itrB']['total'] += 1
                sum_itr_b.setdefault(disc, {'d': 0, 't': 0})
                sum_itr_b[disc]['t'] += 1
                if is_done:
                    precom_data['itrB']['done'] += 1
                    sum_itr_b[disc]['d'] += 1

                global_precom_checksheet_map.setdefault(sub_str, {}).setdefault(disc, [])
                disp_date = format_date_display(comp_date) if is_done else ''
                global_precom_checksheet_map[sub_str][disc].append({
                    'no': row_no or (len(global_precom_checksheet_map[sub_str][disc]) + 1),
                    'subsys': sub_str,
                    'subsysDesc': sys_desc_map.get(sub_str) or str(desc or '-').strip(),
                    'tag': tag_no,
                    'tagDesc': tag_desc,
                    'disc': disc,
                    'type': cs_type_raw,
                    'compDate': disp_date,
                    'cmsDate': disp_date,
                    'manualDate': '',
                    'isManual': False,
                    'isDone': is_done,
                })
                if is_done:
                    global_completed_precom_checksheets.append({
                        'sys': sys_no,
                        'subsys': sub_str,
                        'subsysDesc': sys_desc_map.get(sub_str) or str(desc or '-').strip(),
                        'disc': disc,
                        'formNo': cs_type_raw,
                        'tag': tag_no,
                        'tagDesc': tag_desc,
                        'compDate': format_date_str(comp_date),
                        'dateStr': format_date_str(comp_date),
                        'isManual': False,
                    })
                continue

            # ITR-A (MECHANICAL COMPLETION)
            if 'A' not in cs_type_norm:
                continue

            grp = get_dash_group(disc)
            mc_data['itrA']['total'] += 1
            if grp:
                dash_groups[grp]['itrA']['total'] += 1

            wk = None
            if is_done:
                mc_data['itrA']['done'] += 1
                if grp:
                    dash_groups[grp]['itrA']['done'] += 1
                wk = get_week_key(comp_date)
                if wk:
                    sky_data['itrActualByWeek'][wk] = sky_data['itrActualByWeek'].get(wk, 0) + 1

            global_checksheet_map.setdefault(sub_str, {}).setdefault(disc, [])
            disp_date = format_date_display(comp_date) if is_done else ''
            global_checksheet_map[sub_str][disc].append({
                'no': row_no or (len(global_checksheet_map[sub_str][disc]) + 1),
                'subsys': sub_str,
                'subsysDesc': sys_desc_map.get(sub_str) or str(desc or '-').strip(),
                'tag': tag_no,
                'tagDesc': tag_desc,
                'disc': disc,
                'type': cs_type_raw,
                'compDate': disp_date,
                'cmsDate': disp_date,
                'manualDate': '',
                'isManual': False,
                'isDone': is_done,
            })

            if is_done:
                global_completed_checksheets.append({
                    'sys': sys_no,
                    'subsys': sub_str,
                    'subsysDesc': sys_desc_map.get(sub_str) or str(desc or '-').strip(),
                    'disc': disc,
                    'formNo': cs_type_raw,
                    'tag': tag_no,
                    'tagDesc': tag_desc,
                    'compDate': format_date_str(comp_date),
                    'dateStr': format_date_str(comp_date),
                    'week': wk,
                    'isManual': False,
                })

            if tag_no:
                if tag_no not in global_tag_map:
                    global_tag_map[tag_no] = {
                        'tag': tag_no,
                        'desc': tag_desc,
                        'subsys': sub_str,
                        'sys': sys_no,
                        'disc': disc,
                        'itrTotal': 0,
                        'itrDone': 0,
                    }
                global_tag_map[tag_no]['itrTotal'] += 1
                if is_done:
                    global_tag_map[tag_no]['itrDone'] += 1

            sky_data['subsysItrTotal'][sub_str] = sky_data['subsysItrTotal'].get(sub_str, 0) + 1

            matrix.setdefault(sys_no, {})
            matrix[sys_no].setdefault(sub_str, init_discipline_data())
            if disc in DISCIPLINES:
                matrix[sys_no][sub_str][disc]['i_t'] += 1
                if is_done:
                    matrix[sys_no][sub_str][disc]['i_d'] += 1
                sky_data['subsysDiscItrTotal'].setdefault(sub_str, {})
                sky_data['subsysDiscItrTotal'][sub_str][disc] = sky_data['subsysDiscItrTotal'][sub_str].get(disc, 0) + 1
                if is_done and wk:
                    sky_data['discActualByWeek'].setdefault(disc, {})
                    sky_data['discActualByWeek'][disc][wk] = sky_data['discActualByWeek'][disc].get(wk, 0) + 1

            short_disc = 'MECHANICAL' if disc == 'OTHER' else disc
            sum_itr.setdefault(short_disc, {'d': 0, 't': 0})
            sum_itr[short_disc]['t'] += 1
            if is_done:
                sum_itr[short_disc]['d'] += 1

    # 2. PUNCHLIST OVERVIEW
    if pl_file:
        print(f"-> Parsing Punchlist: {os.path.basename(pl_file)}")
        rows = read_excel_rows_dict(pl_file)
        for row in rows:
            cat_str = get_value_robust(row, ['Category'])
            if not cat_str:
                continue
            cat = normalize_str(cat_str)
            if not any(c in cat for c in ('A', 'B', 'C')):
                continue

            subsys = str(get_value_robust(row, ['SubSystemNo', 'SubSystem No']) or '').strip()
            sys_raw = str(get_value_robust(row, ['SystemNo', 'System No']) or '').strip()
            sys_no = extract_system(subsys) if subsys else sys_raw
            if not is_lq_scope(subsys or sys_no):
                continue

            status = normalize_str(get_value_robust(row, ['Status']))
            is_closed = 'CLOSE' in status
            disc = classify_discipline(get_value_robust(row, ['Discipline', 'DisciplineCode']))
            phase_raw = get_value_robust(row, ['Phase'])
            phase_name = str(phase_raw).strip() if str(phase_raw).strip() else 'UNKNOWN'
            grp = get_dash_group(disc)

            if 'A' in cat:
                mc_data['punchA']['total'] += 1
                if grp:
                    dash_groups[grp]['punchA']['total'] += 1
                if is_closed:
                    mc_data['punchA']['done'] += 1
                    if grp:
                        dash_groups[grp]['punchA']['done'] += 1
            elif 'B' in cat:
                mc_data['punchB']['total'] += 1
                if grp:
                    dash_groups[grp]['punchB']['total'] += 1
                if is_closed:
                    mc_data['punchB']['done'] += 1
                    if grp:
                        dash_groups[grp]['punchB']['done'] += 1
            elif 'C' in cat:
                mc_data['punchC']['total'] += 1
                if grp:
                    dash_groups[grp]['punchC']['total'] += 1
                if is_closed:
                    mc_data['punchC']['done'] += 1
                    if grp:
                        dash_groups[grp]['punchC']['done'] += 1

            if subsys and disc in DISCIPLINES:
                matrix.setdefault(sys_no, {})
                matrix[sys_no].setdefault(subsys, init_discipline_data())
                if 'A' in cat:
                    matrix[sys_no][subsys][disc]['pa_t'] += 1
                    if is_closed:
                        matrix[sys_no][subsys][disc]['pa_d'] += 1
                elif 'B' in cat:
                    matrix[sys_no][subsys][disc]['pb_t'] += 1
                    if is_closed:
                        matrix[sys_no][subsys][disc]['pb_d'] += 1
                elif 'C' in cat:
                    matrix[sys_no][subsys][disc]['pc_t'] += 1
                    if is_closed:
                        matrix[sys_no][subsys][disc]['pc_d'] += 1

                sum_punch.setdefault(phase_name, {'a_d': 0, 'a_t': 0, 'b_d': 0, 'b_t': 0, 'c_d': 0, 'c_t': 0})
                if 'A' in cat:
                    sum_punch[phase_name]['a_t'] += 1
                    if is_closed:
                        sum_punch[phase_name]['a_d'] += 1
                elif 'B' in cat:
                    sum_punch[phase_name]['b_t'] += 1
                    if is_closed:
                        sum_punch[phase_name]['b_d'] += 1
                elif 'C' in cat:
                    sum_punch[phase_name]['c_t'] += 1
                    if is_closed:
                        sum_punch[phase_name]['c_d'] += 1

            open_d = get_value_robust(row, ['OpenDate', 'RaiseDate'])
            close_d = get_value_robust(row, ['ClosedDate', 'CompleteDate'])
            exp_d = get_value_robust(row, ['Expected Clearance Date', 'ExpectedDate'])

            global_punch_list.append({
                'sys': sys_no,
                'subsys': subsys,
                'punchNo': str(get_value_robust(row, ['PunchListNo', 'PunchNo']) or '').strip(),
                'raisedPunchNo': str(get_value_robust(row, ['PunchListRaisedNo', 'RaisedPunchNo', 'Raised Punch No']) or '').strip(),
                'pkgName': str(get_value_robust(row, ['PackageName', 'Package Name', 'Package']) or '').strip(),
                'disc': disc,
                'phase': phase_name,
                'status': status,
                'tag': str(get_value_robust(row, ['TagNo']) or '').strip(),
                'tagDesc': str(get_value_robust(row, ['TagDescription', 'Tag Description', 'EquipmentDescription', 'Description']) or '').strip(),
                'desc': str(get_value_robust(row, ['DefectDescription', 'PunchDescription']) or '').strip(),
                'actionBy': str(get_value_robust(row, ['ActionBy', 'Originator']) or '').strip(),
                'openDate': format_date_str(open_d) or str(open_d or '').strip(),
                'closeDate': format_date_str(close_d) or str(close_d or '').strip(),
                'expDate': format_date_str(exp_d) or str(exp_d or '').strip(),
                'cat': cat,
            })

    # 3. FTP OVERVIEW
    if ftp_file:
        print(f"-> Parsing FTP: {os.path.basename(ftp_file)}")
        rows = read_excel_rows_dict(ftp_file)
        manual_ftp_map = manual.get('manualFtp') or {}
        for row in rows:
            tag_no = str(get_value_robust(row, ['TagNo', 'Tag No', 'FTP No', 'Procedure No']) or '').strip()
            if not tag_no or 'PQ-' not in tag_no:
                continue
            sub = str(get_value_robust(row, ['SubSystemNo', 'SubSystem No']) or '').strip()
            sys_no = str(get_value_robust(row, ['SystemNo', 'System No']) or '').strip() or extract_system(sub)
            if not is_lq_scope(sub or sys_no):
                continue

            sys_desc = str(get_value_robust(row, ['SystemDescription', 'SystemDesc']) or '').strip()
            sub_desc = str(get_value_robust(row, ['SubSystemDescription', 'SubSystemDesc']) or '').strip()
            tag_desc = str(get_value_robust(row, ['TagDescription', 'Tag Description', 'Title']) or '').strip()
            disc = classify_discipline(get_value_robust(row, ['DisciplineCode', 'Discipline']))

            try:
                step = float(get_value_robust(row, ['Step']) or 0)
            except (ValueError, TypeError):
                step = 0.0
            try:
                total_step = float(get_value_robust(row, ['TotalStep', 'Total Step']) or 0)
            except (ValueError, TypeError):
                total_step = 0.0
            try:
                progress = float(get_value_robust(row, ['Progress']) or 0)
            except (ValueError, TypeError):
                progress = 0.0

            comp_date = get_value_robust(row, ['CompleteDate', 'Complete'])
            cms_done = bool(parse_excel_date(comp_date))
            cms_disp = format_date_display(comp_date) if cms_done else ''

            man_ftp = manual_ftp_map.get(tag_no, {})
            man_date = man_ftp.get('manualDate', '') if not cms_done else ''
            is_manual = bool(man_date) and not cms_done
            is_done = cms_done or is_manual
            eff_progress = progress if progress > 0 else (100 if is_done else man_ftp.get('progress', 0))

            if sub_desc and sub not in sys_desc_map:
                sys_desc_map[sub] = sub_desc

            sum_ftp['total'] += 1
            if is_done:
                sum_ftp['done'] += 1
            sum_ftp['byDisc'].setdefault(disc, {'done': 0, 'total': 0})
            sum_ftp['byDisc'][disc]['total'] += 1
            if is_done:
                sum_ftp['byDisc'][disc]['done'] += 1

            global_ftp_list.append({
                'id': f'FTP-{len(global_ftp_list) + 1}',
                'sys': sys_no,
                'sysDesc': sys_desc,
                'subsys': sub,
                'subsysDesc': sub_desc,
                'ftpNo': tag_no,
                'title': tag_desc,
                'disc': disc,
                'step': step,
                'totalStep': total_step,
                'progress': eff_progress,
                'compDate': cms_disp,
                'cmsDate': cms_disp,
                'manualDate': man_date,
                'isManual': is_manual,
                'isDone': is_done,
                'planStart': format_date_display(get_value_robust(row, ['PlanStart', 'Plan Start'])),
                'planFinish': format_date_display(get_value_robust(row, ['PlanFinish', 'Plan Finish'])),
                'location': str(get_value_robust(row, ['Location']) or '').strip(),
            })
        precom_data['ftp'] = {'done': sum_ftp['done'], 'total': sum_ftp['total']}

    # 4. CERTIFICATE OVERVIEW
    if cert_file:
        print(f"-> Parsing Certificates: {os.path.basename(cert_file)}")
        rows = read_excel_rows_dict(cert_file)
        for row in rows:
            cert_name = normalize_str(get_value_robust(row, ['CertificateName', 'Certificate']))
            if not cert_name:
                continue
            subsys = str(get_value_robust(row, ['PrecomSubSystem', 'SubSystemNo']) or '').strip()
            sys_no = str(get_value_robust(row, ['PrecomSystem', 'SystemNo']) or '').strip() or extract_system(subsys)
            if not is_lq_scope(subsys or sys_no):
                continue

            act_finish = get_value_robust(row, ['ActualFinishDate'])
            is_done = bool(parse_excel_date(act_finish))
            act_disp = format_date_display(act_finish) if is_done else ''
            act_iso = format_date_str(act_finish) if is_done else ''

            plan_date = None
            for k, v in row.items():
                if normalize_str(k) == 'PLANFINISHDATE':
                    plan_date = v
                    break
            plan_iso = format_date_str(plan_date)

            if 'RFC' in cert_name and subsys:
                rfc_map[subsys] = {'done': is_done, 'date': act_disp}
            if 'CSSC' in cert_name and subsys:
                cssc_map[subsys] = {'done': is_done, 'date': act_disp}

            if 'DAC' in cert_name or 'DISCIPLINE' in cert_name:
                disc_raw = get_value_robust(row, ['DisciplineCode', 'Discipline'])
                full_disc = classify_discipline(disc_raw)
                grp = get_dash_group(full_disc)
                mc_data['dac']['total'] += 1
                if grp:
                    dash_groups[grp]['dac']['total'] += 1
                if is_done:
                    mc_data['dac']['done'] += 1
                    if grp:
                        dash_groups[grp]['dac']['done'] += 1
                short_disc = full_disc[:4]
                sum_dac.setdefault(short_disc, {'d': 0, 't': 0})
                sum_dac[short_disc]['t'] += 1
                if is_done:
                    sum_dac[short_disc]['d'] += 1

                global_cert_list.append({
                    'type': 'DAC',
                    'cert': cert_name,
                    'disc': short_disc,
                    'sys': sys_no,
                    'subsys': subsys,
                    'status': 'CLOSED' if is_done else 'OPEN',
                    'plan': plan_iso,
                    'act': act_iso,
                })
            elif 'CSSC' in cert_name or 'SUBSYSTEM' in cert_name:
                mc_data['cssc']['total'] += 1
                if is_done:
                    mc_data['cssc']['done'] += 1
                if subsys:
                    sum_cssc.setdefault(subsys, {'d': 0, 't': 0})
                    sum_cssc[subsys]['t'] += 1
                    if is_done:
                        sum_cssc[subsys]['d'] += 1
                    if plan_date:
                        wk = get_week_key(plan_date)
                        if wk:
                            sky_data['subsysPlanWeek'][subsys] = wk
                    global_cert_list.append({
                        'type': 'CSSC',
                        'cert': cert_name,
                        'disc': '',
                        'sys': sys_no,
                        'subsys': subsys,
                        'status': 'CLOSED' if is_done else 'OPEN',
                        'plan': plan_iso,
                        'act': act_iso,
                    })

    # 5. SKYLINE AGGREGATION + PRESERVED KPI
    for sub_str, total_itr in sky_data['subsysItrTotal'].items():
        wk = sky_data['subsysPlanWeek'].get(sub_str)
        if wk:
            sky_data['itrPlanByWeek'][wk] = sky_data['itrPlanByWeek'].get(wk, 0) + total_itr
    for sub_str, discs in sky_data['subsysDiscItrTotal'].items():
        wk = sky_data['subsysPlanWeek'].get(sub_str)
        if wk:
            for d_name, cnt in discs.items():
                sky_data['discPlanByWeek'].setdefault(d_name, {})
                sky_data['discPlanByWeek'][d_name][wk] = sky_data['discPlanByWeek'][d_name].get(wk, 0) + cnt

    sky_kpi = manual.get('skyKpi') or {}
    if sky_kpi.get('hasKpi'):
        sky_data['hasKpi'] = True
        sky_data['kpiPlan'] = sky_kpi.get('kpiPlan') or {}
        sky_data['kpiAct'] = sky_kpi.get('kpiAct') or {}
        sky_data['kpiDiscPlan'] = sky_kpi.get('kpiDiscPlan') or {}
        sky_data['kpiDiscAct'] = sky_kpi.get('kpiDiscAct') or {}
        sky_data['itrPlanByWeek'] = sky_data['kpiPlan']
        sky_data['itrActualByWeek'] = sky_data['kpiAct']
        sky_data['discPlanByWeek'] = sky_data['kpiDiscPlan']
        sky_data['discActualByWeek'] = sky_data['kpiDiscAct']

    # 6. MERGE MANUAL COMPLETIONS (ITR-A & ITR-B) — CMS wins if officially closed!
    official_itra_keys = {
        (x.get('subsys'), x.get('disc'), x.get('tag'), x.get('formNo'))
        for x in global_completed_checksheets
    }
    for man_item in (manual.get('manualItrA') or []):
        k = (man_item.get('subsys'), man_item.get('disc'), man_item.get('tag'), man_item.get('formNo'))
        if k not in official_itra_keys:
            global_completed_checksheets.append(man_item)

    official_itrb_keys = {
        (x.get('subsys'), x.get('disc'), x.get('tag'), x.get('formNo'))
        for x in global_completed_precom_checksheets
    }
    for man_item in (manual.get('manualItrB') or []):
        k = (man_item.get('subsys'), man_item.get('disc'), man_item.get('tag'), man_item.get('formNo'))
        if k not in official_itrb_keys:
            global_completed_precom_checksheets.append(man_item)

    # 7. BUILD PRECOM MATRIX
    all_precom_subs = sorted(set(global_precom_checksheet_map.keys()) | {f['subsys'] for f in global_ftp_list if f.get('subsys')})
    for sub in all_precom_subs:
        sys_no = extract_system(sub)
        precom_matrix.setdefault(sys_no, {})
        sub_cs = global_precom_checksheet_map.get(sub, {})
        sub_ftps = [f for f in global_ftp_list if f.get('subsys') == sub]
        disc_data = {}
        for d_name in ACTIVE_PRECOM_DISCS:
            items = sub_cs.get(d_name, [])
            disc_data[d_name] = {
                'i_t': len(items),
                'i_d': sum(1 for it in items if it.get('isDone')),
                'pa_t': 0, 'pa_d': 0, 'pb_t': 0, 'pb_d': 0, 'pc_t': 0, 'pc_d': 0
            }
        ftp_total = len(sub_ftps)
        ftp_done = sum(1 for f in sub_ftps if f.get('isDone'))
        ftp_avg = round(sum(f.get('progress', 100 if f.get('isDone') else 0) for f in sub_ftps) / ftp_total) if ftp_total > 0 else 0
        cssc_info = cssc_map.get(sub, {'done': False, 'date': ''})
        rfc_info = rfc_map.get(sub, {'done': False, 'date': ''})
        sky_entry = subsys_skyline_dates.get(sub)
        sky_date = sky_entry if isinstance(sky_entry, str) else (sky_entry.get('targetDate', '') if isinstance(sky_entry, dict) else '')

        precom_matrix[sys_no][sub] = {
            'subsysDesc': sys_desc_map.get(sub, ''),
            'skylineDate': sky_date or '',
            'csscDone': cssc_info.get('done', False),
            'csscDate': cssc_info.get('date', ''),
            'rfcDone': rfc_info.get('done', False),
            'rfcDate': rfc_info.get('date', ''),
            'disciplines': disc_data,
            'ftp': {
                'total': ftp_total,
                'done': ftp_done,
                'progress': ftp_avg,
                'pca_t': 0, 'pca_d': 0, 'pcb_t': 0, 'pcb_d': 0, 'pcc_t': 0, 'pcc_d': 0
            }
        }
    precom_data['rfc'] = {
        'done': sum(1 for v in rfc_map.values() if v.get('done')),
        'total': len(rfc_map)
    }

    now_vn = datetime.now(VN_TZ)
    update_date = now_vn.strftime('%Y-%m-%d')
    updated_at = now_vn.strftime('%Y-%m-%d %H:%M:%S (VN)')

    payload = {
        'updateDate': update_date,
        'updatedAt': updated_at,
        'syncSource': sync_source,
        'data': {
            'mcData': mc_data,
            'dashGroups': dash_groups,
            'matrix': matrix,
            'sumItr': sum_itr,
            'sumPunch': sum_punch,
            'sumDac': sum_dac,
            'sumCssc': sum_cssc,
            'skyData': sky_data,
            'sysDescMap': sys_desc_map,
            'globalPunchList': global_punch_list,
            'globalCertList': global_cert_list,
            'globalTagMap': global_tag_map,
            'globalCompletedChecksheets': global_completed_checksheets,
            'globalFlashReports': manual.get('globalFlashReports') or [],
            'globalChecksheetMap': global_checksheet_map,
            'subsysSkylineDates': subsys_skyline_dates,
            'siteWalkdownPunches': manual.get('siteWalkdownPunches') or [],
            'precomData': precom_data,
            'sumItrB': sum_itr_b,
            'sumFtp': sum_ftp,
            'precomMatrix': precom_matrix,
            'globalPrecomChecksheetMap': global_precom_checksheet_map,
            'globalFtpList': global_ftp_list,
            'globalCompletedPrecomChecksheets': global_completed_precom_checksheets,
            'csscMap': cssc_map,
            'rfcMap': rfc_map,
        }
    }

    # Write data.json, data.js, sync_meta.json
    data_json_path = os.path.join(mc_dir, 'data.json')
    data_js_path = os.path.join(mc_dir, 'data.js')
    meta_path = os.path.join(mc_dir, 'sync_meta.json')

    with open(data_json_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, separators=(',', ':'))

    with open(data_js_path, 'w', encoding='utf-8') as f:
        f.write("window.PRELOADED_MC_DATA = " + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ";\n")

    meta = {
        'updateDate': update_date,
        'updatedAt': updated_at,
        'syncSource': sync_source,
        'summary': {
            'itrA': mc_data['itrA'],
            'itrB': precom_data['itrB'],
            'punchA': mc_data['punchA'],
            'punchB': mc_data['punchB'],
            'punchC': mc_data['punchC'],
            'dac': mc_data['dac'],
            'cssc': mc_data['cssc'],
            'rfc': precom_data['rfc'],
            'ftp': precom_data['ftp'],
        }
    }
    with open(meta_path, 'w', encoding='utf-8') as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    print("\n[SUCCESS] Built MC-Dashboard data successfully!")
    print(f"  Updated At : {updated_at} ({sync_source})")
    print(f"  ITR-A      : {mc_data['itrA']['done']:,} / {mc_data['itrA']['total']:,}")
    print(f"  ITR-B      : {precom_data['itrB']['done']:,} / {precom_data['itrB']['total']:,}")
    print(f"  Punch A/B/C: A={mc_data['punchA']['done']}/{mc_data['punchA']['total']} | B={mc_data['punchB']['done']}/{mc_data['punchB']['total']} | C={mc_data['punchC']['done']}/{mc_data['punchC']['total']}")
    print(f"  DAC/CSSC   : DAC={mc_data['dac']['done']}/{mc_data['dac']['total']} | CSSC={mc_data['cssc']['done']}/{mc_data['cssc']['total']} | RFC={precom_data['rfc']['done']}/{precom_data['rfc']['total']}")
    print(f"  FTP        : {precom_data['ftp']['done']}/{precom_data['ftp']['total']}")
    print(f"  Manual Kept: SiteWalkdown={len(manual.get('siteWalkdownPunches') or [])}, Flash={len(manual.get('globalFlashReports') or [])}, ManualITR-A={len(manual.get('manualItrA') or [])}")
    return True


def main():
    parser = argparse.ArgumentParser(description='Build LQP MC-Dashboard data files from PTSC PMS Excel exports')
    parser.add_argument('--excel-dir', default=None, help='Folder containing BB_PREC_*_Report.xlsx (default: parent Data_MC folder)')
    parser.add_argument('--source', default='Local Build', help='Sync source label')
    parser.add_argument('--include-manual-excel', action='store_true', help='Also parse Skyline .xlsm and KPI .xlsx from excel-dir')
    args = parser.parse_args()

    mc_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
    excel_dir = os.path.abspath(args.excel_dir) if args.excel_dir else os.path.abspath(os.path.join(mc_dir, '..'))
    build_dashboard(mc_dir, excel_dir, sync_source=args.source, parse_manual_excels=args.include_manual_excel)


if __name__ == '__main__':
    main()
