#!/usr/bin/env bash
# Run after both migration files and tests/sql/payment_concurrency.seed.sql
# Requires PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD from isolated CI only.
set -euo pipefail
A='10000000-0000-4000-8000-000000000401'
B='10000000-0000-4000-8000-000000000402'
RECEIPT='10000000-0000-4000-8000-000000000501'
STAFF='10000000-0000-4000-8000-000000000011'
a_log="$(mktemp)"
b_log="$(mktemp)"
trap 'rm -f "$a_log" "$b_log"' EXIT

worker() {
  local order="$1"
  local evidence="$2"
  # Hold transaction open briefly after the update to force overlapping writers.
  psql -X -v ON_ERROR_STOP=1 <<SQL
BEGIN;
SET LOCAL lock_timeout = '12s';
INSERT INTO ms.payment_allocations
 (receipt_id,order_id,allocated_cents,allocation_state,confirmed_by,confirmed_at,allocation_basis_ref)
VALUES
 ('$RECEIPT','$order',400000,'confirmed','$STAFF',now(),'$evidence');
SELECT pg_sleep(0.4);
COMMIT;
SQL
}
worker "$A" 'fictional-approval-a' > "$a_log" 2>&1 &
pid_a=$!
worker "$B" 'fictional-approval-b' > "$b_log" 2>&1 &
pid_b=$!
status_a=0
status_b=0
wait "$pid_a" || status_a=$?
wait "$pid_b" || status_b=$?

echo "Concurrency writer statuses: A=$status_a B=$status_b"
if [[ "$status_a" -eq 0 && "$status_b" -eq 0 ]] ||
   [[ "$status_a" -ne 0 && "$status_b" -ne 0 ]]; then
  echo 'FAIL: expected exactly one accepted allocation'
  cat "$a_log" "$b_log"
  exit 1
fi

result="$(psql -X -v ON_ERROR_STOP=1 -t -A -F '|' -c "
 SELECT r.allocated_cents,
        (SELECT COUNT(*) FROM ms.payment_allocations
         WHERE receipt_id=r.id AND allocation_state='confirmed'),
        (SELECT COALESCE(SUM(net_allocated_cents),0) FROM ms.sales_orders
         WHERE id IN ('$A','$B'))
 FROM ms.payment_receipt_projections r WHERE r.id='$RECEIPT';
")"
echo "Receipt allocated | confirmed allocations | summed order net: $result"
if [[ "$result" != '400000|1|400000' ]]; then
  echo 'FAIL: over-allocated receipt or inconsistent order balances'
  exit 1
fi
echo 'PASS: concurrent allocation accepted once and rejected once, amount conserved'
