@echo off
rem Daily database backup - run by Windows Task Scheduler (task name: "InventoryDB Backup")
rem Output: backend\backups\inventory_db_YYYY-MM-DD_HHMM.sql  (keeps latest 30), log: backend\backups\backup.log
cd /d "%~dp0.."
"C:\Program Files\nodejs\node.exe" scripts\backup-db.js >> backups\backup.log 2>&1
