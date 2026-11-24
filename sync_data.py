"""
BLOCK B LQP - MC DASHBOARD DATA SYNCHRONIZATION SCRIPT
Delegates to scripts/build_dashboard_data.py to parse the 4 PTSC PMS Excel
exports (plus optional Skyline/KPI files) while preserving manual_data.json,
and refreshes data.json, data.js, and sync_meta.json.
"""

import os
import sys

SCRIPT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'scripts')
if SCRIPT_DIR not in sys.path:
    sys.path.insert(0, SCRIPT_DIR)

from build_dashboard_data import build_dashboard

if __name__ == '__main__':
    mc_dir = os.path.dirname(os.path.abspath(__file__))
    data_mc_dir = os.path.abspath(os.path.join(mc_dir, '..'))
    include_manual = '--include-manual-excel' in sys.argv
    build_dashboard(mc_dir, data_mc_dir, sync_source='Local PC Build', parse_manual_excels=include_manual)
