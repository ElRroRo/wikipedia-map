@echo off
echo ─────────────────────────────────
echo   Wikipedia Map + AI Agent
echo ─────────────────────────────────

:: Install dependencies if needed
if not exist "node_modules" (
  echo Installing dependencies...
  npm install
)

echo Starting server...
echo Opening browser at http://localhost:8000...
start http://localhost:8000
npm start
pause
