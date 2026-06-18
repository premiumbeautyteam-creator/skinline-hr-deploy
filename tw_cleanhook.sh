#!/usr/bin/env bash
: "${TW_TOKEN:?}"
DOMAIN="skinline-hr.ru"
RID=$(cat /tmp/acme_rid.txt 2>/dev/null)
[ -n "$RID" ] && curl -s -X DELETE "https://api.timeweb.cloud/api/v1/domains/${DOMAIN}/dns-records/${RID}" -H "Authorization: Bearer ${TW_TOKEN}" >/dev/null 2>&1 && echo "[clean] deleted $RID" || echo "[clean] nothing to delete"
exit 0
