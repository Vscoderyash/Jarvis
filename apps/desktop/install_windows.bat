@echo off
cd /d "%~dp0"
echo ===== JARVIS Desktop installer =====
set "PY="
set "VOICE_FALLBACK="
for %%V in (3.12 3.11 3.13 3.10) do if not defined PY py -%%V --version >nul 2>nul && set "PY=py -%%V"
if defined PY goto havepy
py -3 -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] < (3,14) else 1)" >nul 2>nul && set "PY=py -3"
if defined PY goto havepy
python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] < (3,14) else 1)" >nul 2>nul && set "PY=python"
if defined PY goto havepy
py -3 -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3,14) else 1)" >nul 2>nul
if not errorlevel 1 goto newerpy
python -c "import sys; sys.exit(0 if sys.version_info[:2] >= (3,14) else 1)" >nul 2>nul
if not errorlevel 1 goto newerpy
goto badpython

:newerpy
echo Python 3.14 or newer is installed, but this JARVIS build cannot use its Whisper speech engine on that version.
where winget >nul 2>nul
if errorlevel 1 goto latestpy
choice /c YN /m "Install Python 3.11 for more accurate Whisper speech recognition"
if errorlevel 2 goto latestpy
winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements
if errorlevel 1 goto latestpy
py -3.11 --version >nul 2>nul && set "PY=py -3.11"
if defined PY goto havepy

:latestpy
set "VOICE_FALLBACK=1"
py -3 --version >nul 2>nul && set "PY=py -3"
if defined PY goto havepy
python --version >nul 2>nul && set "PY=python"
if defined PY goto havepy
goto badpython

:badpython
echo.
echo JARVIS needs Python 3.10 or newer, and none was found.
where winget >nul 2>nul
if errorlevel 1 goto manual
echo.
choice /c YN /m "Install Python 3.11 automatically now"
if errorlevel 2 goto manual
winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements
py -3.11 --version >nul 2>nul && set "PY=py -3.11"
if defined PY goto havepy
echo.
echo Python 3.11 was installed, but this window cannot see it yet.
echo Close this window, then double-click start_jarvis.bat again.
pause
exit /b 1

:manual
echo.
echo Install Python from: https://www.python.org/downloads/release/python-3119/
echo (scroll down to "Windows installer (64-bit)", and TICK "Add python.exe to PATH").
echo Then double-click start_jarvis.bat again.
pause
exit /b 1

:havepy
echo Using:
%PY% -c "import sys; print('  Python', sys.version.split()[0])"
%PY% -c "import sys; sys.exit(0 if sys.version_info[:2] <= (3,13) else 1)" >nul 2>nul
if errorlevel 1 echo   (A very new Python: JARVIS will use the lighter Vosk speech engine. Python 3.11 gives the best accuracy.)
if exist "venv" rmdir /s /q "venv"
echo Creating private environment...
%PY% -m venv venv
if errorlevel 1 goto fail
call "venv\Scripts\activate.bat"
python -m pip install --upgrade pip
set FROZENLIST_NO_EXTENSIONS=1
set MULTIDICT_NO_EXTENSIONS=1
set YARL_NO_EXTENSIONS=1
set AIOHTTP_NO_EXTENSIONS=1
echo Installing packages (a few minutes, needs internet)...
pip install -r requirements.txt
if errorlevel 1 goto fail
pip install -r requirements-voice.txt
if errorlevel 1 echo NOTE: the natural-voice package could not be installed, JARVIS will use the Windows voice instead.
echo Installing optional Virtual Reality camera hand-control packages...
pip install -r requirements-vr.txt
if errorlevel 1 echo NOTE: camera gestures could not be installed for this Python/platform. See README.txt for supported setup.
echo ok> "venv\.jarvis_installed"
if defined VOICE_FALLBACK echo Vosk selected for this Python version> "venv\.jarvis_vosk_fallback"
echo.
echo ===== Installed OK =====
if /i "%~1"=="auto" exit /b 0
echo Now double-click start_jarvis.bat
pause
exit /b 0

:fail
echo.
echo Something failed above. Send me a screenshot of the red/error lines.
pause
exit /b 1
