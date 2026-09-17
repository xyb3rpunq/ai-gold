@echo off
rem AI GOLD mode broker realtime: TradingView hanya mengizinkan feed candle broker dari localhost.
cd /d "%~dp0"
set PORT=8787
where python >nul 2>nul && (start "AI GOLD server" /min python -m http.server %PORT% & goto open)
where py >nul 2>nul && (start "AI GOLD server" /min py -m http.server %PORT% & goto open)
where npx >nul 2>nul && (start "AI GOLD server" /min npx --yes http-server -p %PORT% -c-1 & goto open)
echo Python atau Node.js tidak ditemukan. Pasang salah satunya lalu jalankan lagi.
pause
goto :eof
:open
timeout /t 2 /nobreak >nul
start "" "http://localhost:%PORT%"
echo AI GOLD berjalan di http://localhost:%PORT%  (tutup jendela "AI GOLD server" untuk berhenti)
