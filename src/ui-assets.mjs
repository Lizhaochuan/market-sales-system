import { readFile } from 'node:fs/promises';

const files=new Map([
  ['/',['../web/index.html','text/html; charset=utf-8']],
  ['/app.js',['../web/app.js','text/javascript; charset=utf-8']],
  ['/business-workspace.js',['../web/business-workspace.js','text/javascript; charset=utf-8']],
  ['/lead-desk.js',['../web/lead-desk.js','text/javascript; charset=utf-8']],
  ['/sales-workflow.js',['../web/sales-workflow.js','text/javascript; charset=utf-8']],
  ['/identity.js',['../web/identity.js','text/javascript; charset=utf-8']],
  ['/styles.css',['../web/styles.css','text/css; charset=utf-8']]
]);
const csp="default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; object-src 'none'";
export async function serveUi(urlPath,res) {
  const f=files.get(urlPath);
  if(!f)return false;
  const body=await readFile(new URL(f[0],import.meta.url));
  res.writeHead(200,{
    'Content-Type':f[1],
    'Content-Security-Policy':csp,
    'X-Content-Type-Options':'nosniff',
    'X-Frame-Options':'DENY',
    'Referrer-Policy':'no-referrer',
    'Cache-Control':'no-store',
    'Cross-Origin-Resource-Policy':'same-origin'
  });
  res.end(body);
  return true;
}

