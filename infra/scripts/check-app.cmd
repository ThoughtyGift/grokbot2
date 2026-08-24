@echo off
REM App dang noi voi backend nao? Do bang luot goi thuc, khong doan.
REM App poll WatchSandBoxMigration lien tuc, nen so nay tang = app dang noi voi backend NAY.
cd /d "%~dp0..\.."
node -e "const f='services/grokbot-backend/.data/coverage.json';const r=()=>{try{return JSON.parse(require('fs').readFileSync(f,'utf8')).calls['rpc:WatchSandBoxMigration']?.n??0}catch{return -1}};const a=r();setTimeout(()=>{const b=r();if(a<0)return console.log('Khong doc duoc coverage — backend chua chay?');console.log(b>a?`OK: app dang noi voi backend LOCAL (+${b-a} luot trong 6s)`:'CANH BAO: khong co luot nao trong 6s — app dang noi voi SERVER HANG, hoac app chua mo. Chay start-app.cmd.')},6000)"
pause
