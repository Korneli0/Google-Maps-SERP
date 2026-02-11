@echo off
setlocal enabledelayedexpansion

REM #############################################
REM   GeoRanker - One-Click Windows Updater     
REM #############################################

title GeoRanker Updater

echo.
echo ================================================================
echo.
echo     [32m  GeoRanker - One-Click Updater[0m
echo.
echo ================================================================
echo.

REM Check if running from correct directory
if not exist "package.json" (
    echo [31mError: Please run this script from the GeoRanker project directory.[0m
    pause
    exit /b 1
)

REM Step 1: Pull latest code
echo [33m[1/4][0m Pulling latest updates from Git...
if exist ".git" (
    call git pull origin main
) else (
    echo [33mNot a git repository. Skipping pull.[0m
)

REM Step 2: Install dependencies
echo.
echo [33m[2/4][0m Updating dependencies...
call npm install --silent
echo       [32mDependencies updated[0m

REM Step 3: Update database
echo.
echo [33m[3/4][0m Updating database schema...
call npx prisma generate
call npx prisma db push
echo       [32mDatabase initialized[0m

REM Step 4: Rebuild application
echo.
echo [33m[4/4][0m Rebuilding application...
call npm run build
if %ERRORLEVEL% neq 0 (
    echo [31mFailed to build the application.[0m
    pause
    exit /b 1
)
echo       [32mApplication rebuilt[0m

echo.
echo [32mUpdate Complete! Please restart the application.[0m
echo.
pause
