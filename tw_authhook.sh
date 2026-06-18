#!/usr/bin/env bash
# certbot --manual-auth-hook : creates _acme-challenge TXT via Timeweb API, waits for convergence
set -e
: "${TW_TOKEN:?TW_TOKEN env required}"
DOMAIN="skinline-hr.ru"
SUB="_acme-challenge.team"
FQDN="_acme-challenge.${CERTBOT_DOMAIN}"
VAL="${CERTBOT_VALIDATION:?no validation}"
API="https://api.timeweb.cloud/api/v1/domains/${DOMAIN}/dns-records"
# create record
RID=$(curl -s -X POST "$API" -H "Authorization: Bearer ${TW_TOKEN}" -H "Content-Type: application/json" \
  -d "{\"type\":\"TXT\",\"subdomain\":\"${SUB}\",\"value\":\"${VAL}\",\"ttl\":120}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('dns_record',{}).get('id',''))")
echo "$RID" > /tmp/acme_rid.txt
echo "[hook] created record id=$RID for $FQDN val=$VAL"
# wait for all 4 authoritative NS to converge
for i in $(seq 1 40); do
  c=0
  for ns in ns1.timeweb.ru ns2.timeweb.ru ns3.timeweb.org ns4.timeweb.org; do
    got=$(dig +short TXT "$FQDN" @"$ns" 2>/dev/null | tr -d '"')
    [ "$got" = "$VAL" ] && c=$((c+1))
  done
  echo "[hook] try $i: $c/4 NS have value"
  [ "$c" -eq 4 ] && { echo "[hook] converged"; sleep 10; exit 0; }
  sleep 10
done
echo "[hook] WARN: not fully converged after wait, proceeding anyway"
exit 0
