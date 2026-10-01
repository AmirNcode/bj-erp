#!/usr/bin/env bash
# Exercise real reverse proxies: forged identity must be replaced, not deleted.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/../.." && pwd)
CASE_DIR=$(mktemp -d)
PREFIX="bj-ip-test-$$"
cleanup() {
  docker rm -fv "$PREFIX-gateway" "$PREFIX-backend" >/dev/null 2>&1 || true
  docker network rm "$PREFIX" >/dev/null 2>&1 || true
  rm -rf "$CASE_DIR"
}
trap cleanup EXIT
cat > "$CASE_DIR/backend.js" <<'JS'
const http=require('node:http');
const handler=(req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({ip:req.headers['x-bj-client-ip']}))};
http.createServer(handler).listen(9999,'0.0.0.0');
http.createServer(handler).listen(3000,'0.0.0.0');
JS
cat > "$CASE_DIR/client.js" <<'JS'
const https=require('node:https'),http=require('node:http'),assert=require('node:assert/strict'),os=require('node:os');
const own=Object.values(os.networkInterfaces()).flat().find(x=>x.family==='IPv4'&&!x.internal).address;
function get(path,internal=false){return new Promise((resolve,reject)=>{
 const req=(internal?http:https).get({hostname:'gateway.test',port:internal?8080:443,path,rejectUnauthorized:false,
 headers:{'X-BJ-Client-IP':['198.51.100.10','203.0.113.10'],'X-Forwarded-For':'198.51.100.20'}},res=>{
 let body='';res.on('data',x=>body+=x);res.on('end',()=>{try{resolve(JSON.parse(body))}catch(e){reject(e)}})
 });req.setTimeout(3000,()=>req.destroy(new Error('request timeout')));req.on('error',reject);
})}
(async()=>{
 let ready=false; for(let i=0;i<30;i++){try{await get('/');ready=true;break}catch{await new Promise(r=>setTimeout(r,500))}}
 assert.ok(ready,'gateway starts');
 for(const path of ['/auth/v1/token','/home']) assert.equal((await get(path)).ip,own,'public stamp must replace forged and duplicate headers');
 assert.equal((await get('/auth/v1/token',true)).ip,'198.51.100.10, 203.0.113.10','private hop must preserve the forwarded identity');
 console.log('ok - actual proxy replaces spoofed public identity and preserves private forwarding');
})().catch(e=>{console.error(e.message);process.exitCode=1});
JS
docker network create "$PREFIX" >/dev/null
docker run -d --name "$PREFIX-backend" --network "$PREFIX" --network-alias auth --network-alias app --network-alias rest \
 -v "$CASE_DIR/backend.js:/backend.js:ro" node:22-alpine node /backend.js >/dev/null
for target in client liara; do
  if [ "$target" = client ]; then
    cp "$ROOT/deploy/caddy/Caddyfile" "$CASE_DIR/Caddyfile"
    CADDY_IMAGE=caddy:2.8.4-alpine
  else
    # Only certificate issuance differs in this isolated test; routing is unchanged.
    node - "$ROOT/deploy/liara/Caddyfile" "$CASE_DIR/Caddyfile" <<'JS'
const fs=require('node:fs');
const config=fs.readFileSync(process.argv[2],'utf8');
fs.writeFileSync(process.argv[3],config.replace(/\ttls \{\n\t\tissuer acme \{[\s\S]*?\n\t\t\}\n\t\}/,'\ttls internal'));
JS
    CADDY_IMAGE=caddy:2.11.4-alpine
  fi
  docker run -d --name "$PREFIX-gateway" --network "$PREFIX" --network-alias gateway.test \
    -e APP_HOST=gateway.test -v "$CASE_DIR/Caddyfile:/etc/caddy/Caddyfile:ro" "$CADDY_IMAGE" >/dev/null
  docker run --rm --network "$PREFIX" -v "$CASE_DIR/client.js:/client.js:ro" node:22-alpine node /client.js
  docker rm -fv "$PREFIX-gateway" >/dev/null
  echo "ok - $target ($CADDY_IMAGE)"
done
