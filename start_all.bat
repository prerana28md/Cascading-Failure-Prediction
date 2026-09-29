@echo off
title Cascading Failure Prediction - Platform Launcher
color 0A

echo ===============================================================================
echo     CASCADING FAILURE PREDICTION IN MICROSERVICE ARCHITECTURES
echo              OmniStore (E-Commerce) + MovieStream (Streaming)
echo ===============================================================================
echo.

cd /d "%~dp0"

echo [*] Step 1/5: Checking Docker containers for OmniStore...
docker ps >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [WARN] Docker is not running or accessible. Please ensure Docker Desktop is started.
) else (
    echo [OK] Docker daemon is accessible.
)

echo [*] Step 2/5: Launching ML Prediction Engine (Port 5001)...
start "ML Prediction API (:5001)" python ml/predict_api.py --port 5001

echo [*] Step 3/5: Launching MovieStream 5 Microservices (Ports 8087-8093)...
start "MovieStream Microservices" python moviestream/services/start_services.py

echo [*] Step 4/5: Launching Frontends...
start "MovieStream Frontend (:3002)" cmd /k "cd moviestream/frontend && npm run dev"
start "Developer Dashboard (:4000)" cmd /k "cd developer-dashboard && npm run dev"
start "Fault Injection Lab (:4001)" cmd /k "cd fault-dashboard && npm run dev"

echo.
echo ===============================================================================
echo   ALL SERVICES LAUNCHED SUCCESSFULLY!
echo ===============================================================================
echo.
echo   CUSTOMER APPLICATIONS:
echo     - OmniStore E-Commerce Storefront:    http://localhost:3000
echo     - MovieStream Streaming Media App:   http://localhost:3002
echo.
echo   ENGINEERING & RESEARCH CONTROL DASHBOARDS:
echo     - Developer Control Center:           http://localhost:4000
echo     - Fault Injection Lab:                http://localhost:4001
echo.
echo   OBSERVABILITY & ANALYTICS:
echo     - ML Cascade Prediction API:          http://localhost:5001
echo     - Prometheus Metrics:                 http://localhost:9090
echo     - Grafana Dashboards:                 http://localhost:3001
echo     - Jaeger Distributed Traces:          http://localhost:16686
echo.
echo ===============================================================================
echo   Press any key to open all applications in your browser...
pause >nul
start http://localhost:4000
start http://localhost:4001
start http://localhost:3002

echo.
echo ===============================================================================
echo   SERVICES ARE RUNNING IN THE BACKGROUND
echo   DO NOT CLOSE THIS OR THE BACKGROUND COMMAND PROMPT WINDOWS!
echo   To stop all services when done, close the terminal windows or press Ctrl+C.
echo ===============================================================================
pause >nul
