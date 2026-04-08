@echo off
setlocal enabledelayedexpansion

:: Bump version, commit, tag, push, and create GitHub release.
:: Usage: upversion [patch|minor|major]
:: Defaults to patch if no argument given.

set BUMP=%~1
if "%BUMP%"=="" set BUMP=patch

:: Check for clean working tree
for /f %%i in ('git status --porcelain') do (
    echo ERROR: Working tree is not clean. Commit or stash changes first.
    exit /b 1
)

:: Step 3: Bump version
echo Bumping version...
call dk upversion
if errorlevel 1 (
    echo ERROR: dk upversion failed
    exit /b 1
)

:: Read new version from package.json
for /f "delims=" %%v in ('node -p "require('./package.json').version"') do set VERSION=%%v
echo New version: %VERSION%

:: Step 4: Commit and tag
echo Committing and tagging v%VERSION%...
git add package.json dkbuild.yml
if errorlevel 1 exit /b 1
git commit -m "v%VERSION%"
if errorlevel 1 exit /b 1
git tag v%VERSION%
if errorlevel 1 exit /b 1

:: Step 5: Push to GitHub
echo Pushing to GitHub...
git push origin master
if errorlevel 1 exit /b 1
git push origin v%VERSION%
if errorlevel 1 exit /b 1

:: Step 6: Create GitHub release
echo Creating GitHub release...
gh release create v%VERSION% --title "v%VERSION%" --generate-notes
if errorlevel 1 exit /b 1

echo.
echo Done! v%VERSION% released.
echo   - GitHub release: https://github.com/thebjorn/jseeqret/releases/tag/v%VERSION%
echo   - npm publish will be triggered automatically
echo.
echo Next: build and upload the signed installer:
echo   pnpm dist:nsis
echo   gh release upload v%VERSION% "dist\jseeqret-setup-%VERSION%.exe" dist\latest.yml --clobber
