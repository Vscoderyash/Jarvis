#!/usr/bin/env bash
set -e
PY=""
for v in python3.12 python3.11 python3.10 python3; do
  if command -v $v >/dev/null 2>&1 && $v -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3,10) else 1)"; then PY=$v; break; fi
done
if [ -z "$PY" ]; then echo "JARVIS needs Python 3.10 or newer. Install python3.11, then run this again."; exit 1; fi
rm -rf venv
$PY -m venv venv
source venv/bin/activate
pip install --upgrade pip
export FROZENLIST_NO_EXTENSIONS=1 MULTIDICT_NO_EXTENSIONS=1 YARL_NO_EXTENSIONS=1 AIOHTTP_NO_EXTENSIONS=1
pip install -r requirements.txt
pip install -r requirements-voice.txt || echo "Natural voice package not installed; the system voice will be used."
pip install -r requirements-vr.txt || echo "Virtual Reality packages not installed; check README.txt for your Python/platform support."
echo "Installed. Run:  source venv/bin/activate && python jarvis_desktop/main.py"
