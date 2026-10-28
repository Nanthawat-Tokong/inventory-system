-- Migration: fix requisition workflow — track shipped_qty separately from
-- approved_qty, and rename status 'issue_reported' -> 'disputed'
--
-- Why: ship() used to hard-fail the whole shipment if warehouse stock was
-- insufficient for any single item, and receive() compared what the branch
-- got against approved_qty instead of what was actually shipped. Stock
-- naturally drifts between approval and shipping (other transactions can
-- happen in between) — shipping less than approved because of that is
-- normal, not an error, so it now needs its own tracked quantity.
--
-- Run once:
--   mysql -u root -p inventory_db < migration_fix_requisition_workflow.sql
--
-- IMPORTANT: back up first, e.g.
--   mysqldump -u root -p inventory_db > backup_pre_requisition_fix.sql

-- Step 1: add shipped_qty (what was actually shipped, may be less than approved_qty)
ALTER TABLE requisition_items
  ADD COLUMN shipped_qty INT DEFAULT NULL AFTER approved_qty;

-- Step 2: backfill — for requisitions already past shipping, approximate
-- shipped_qty = approved_qty (true partial-shipment amounts weren't tracked
-- before this migration, so this is the best available approximation)
UPDATE requisition_items ri
  JOIN requisitions r ON r.id = ri.requisition_id
SET ri.shipped_qty = ri.approved_qty
WHERE r.status IN ('shipped','issue_reported','completed');

-- Step 3: widen the status ENUM to include both old and new values so
-- existing rows stay valid while we remap them
ALTER TABLE requisitions
  MODIFY COLUMN status ENUM('pending','rejected','approved','shipped','issue_reported','disputed','completed')
  NOT NULL DEFAULT 'pending';

-- Step 4: remap issue_reported -> disputed
UPDATE requisitions SET status = 'disputed' WHERE status = 'issue_reported';

-- Step 5: narrow the ENUM to the final set
ALTER TABLE requisitions
  MODIFY COLUMN status ENUM('pending','rejected','approved','shipped','disputed','completed')
  NOT NULL DEFAULT 'pending';

-- Verification (run manually):
--   SHOW COLUMNS FROM requisition_items LIKE 'shipped_qty';
--   SELECT status, COUNT(*) FROM requisitions GROUP BY status;
