@echo off
setlocal
set "ROOT=%~dp0"

echo ============================================
echo   Sales CRM Dev Environment - One Click Start
echo   Backend :3000    Frontend :5173
echo ============================================
echo.

REM Auto-discover backend/frontend folders by package.json marker (avoids hardcoding Chinese names)
set "BACKEND="
set "FRONTEND="
for /d %%d in ("%ROOT%*") do (
  if exist "%%d\package.json" (
    findstr /m "win-crm-server" "%%d\package.json" >nul && set "BACKEND=%%d"
    findstr /m "win-crm-web" "%%d\package.json" >nul && set "FRONTEND=%%d"
  )
)

if not defined BACKEND (
  echo ERROR: backend folder (win-crm-server) not found under %ROOT%
  goto :end
)
if not defined FRONTEND (
  echo ERROR: frontend folder (win-crm-web) not found under %ROOT%
  goto :end
)

if not exist "%BACKEND%\node_modules" (
  echo [1/2] Installing backend deps (first run is slow)...
  pushd "%BACKEND%"
  call npm install
  popd
)
if not exist "%FRONTEND%\node_modules" (
  echo [2/2] Installing frontend deps (first run is slow)...
  pushd "%FRONTEND%"
  call npm install
  popd
)

echo.
echo Starting two services (each opens its own window)...
echo.

start "Backend :3000" cmd /k "cd /d %BACKEND% && npm run start:web"
start "Frontend :5173" cmd /k "cd /d %FRONTEND% && npm run dev"

echo Done. Wait about 10s for services to come up:
echo   Backend API : http://localhost:3000    Swagger: http://localhost:3000/docs
echo   Frontend    : http://localhost:5173    (/api proxied to backend :3000)
echo.
echo Open http://localhost:5173 in your browser to verify the page.
echo Close the two opened console windows to stop the services.
echo.

:end
pause
