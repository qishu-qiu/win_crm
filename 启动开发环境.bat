@echo off
setlocal
set "ROOT=%~dp0"

echo ============================================
echo   Sales CRM Dev Environment - One Click Start
echo   Backend :3000    Frontend :5173
echo ============================================
echo.

REM Auto-discover backend/frontend folders by package.json name marker
set "BACKEND="
set "FRONTEND="
for /d %%d in ("%ROOT%*") do (
  if exist "%%d\package.json" (
    findstr /m "win-crm-server" "%%d\package.json" >nul && set "BACKEND=%%d"
    findstr /m "win-crm-web" "%%d\package.json" >nul && set "FRONTEND=%%d"
  )
)

if not defined BACKEND (
  echo ERROR: backend folder win-crm-server not found under %ROOT%
  goto :end
)
if not defined FRONTEND (
  echo ERROR: frontend folder win-crm-web not found under %ROOT%
  goto :end
)

REM Free ports 3000 / 5173 from any leftover dev process (so re-runs don't hit EADDRINUSE)
echo Cleaning ports 3000 / 5173 (kill leftover dev processes)...
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr /c:":3000 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
for /f "tokens=5" %%p in ('netstat -ano 2^>nul ^| findstr /c:":5173 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
echo.

if not exist "%BACKEND%\node_modules" (
  echo [1/2] Installing backend deps, first run is slow...
  pushd "%BACKEND%"
  call npm install
  popd
)
if not exist "%FRONTEND%\node_modules" (
  echo [2/2] Installing frontend deps, first run is slow...
  pushd "%FRONTEND%"
  call npm install
  popd
)

echo.
echo NOTE: Backend needs MySQL(:3306) and Redis(:6379) running.
echo       If they are down (e.g. after a reboot), start them in phpStudy first.
echo.
echo Starting two services (each opens its own window, kept open on error)...
echo.

start "Backend :3000" cmd /k "cd /d %BACKEND% && npm run start:web & pause"
start "Frontend :5173" cmd /k "cd /d %FRONTEND% && npm run dev & pause"

echo Done. Wait about 10s for services to come up:
echo   Backend API : http://localhost:3000    Swagger: http://localhost:3000/docs
echo   Frontend    : http://localhost:5173    (/api proxied to backend :3000)
echo.
echo Open http://localhost:5173 in your browser to verify the page.
echo Close the two opened console windows to stop the services.
echo.

:end
pause
