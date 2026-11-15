// Run every V3.2-82..99 security regression at the same HEAD.
// Offline Node only: no PostgreSQL, Chromium, external signing, or real contract acceptance.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
const path=fileURLToPath(new URL('../spec/v3-2-100-m02-integration-review-manifest.json',import.meta.url));
const manifest=JSON.parse(readFileSync(path,'utf8'));
if(manifest.stages.length!==18||
 manifest.stages[0].stage!=='V3.2-82'||
 manifest.stages.at(-1).stage!=='V3.2-99')
 throw new Error('Unexpected M02 coverage scope');
const testFiles=manifest.stages.map(x=>x.files.test);
if(new Set(testFiles).size!==18)throw new Error('Duplicate stage regression');
process.stdout.write('V3.2-100 aggregate CI-only Node regression: '+testFiles.length+' stage files\n');
const result=spawnSync(process.execPath,['--test',...testFiles],{
 cwd:root,stdio:'inherit',env:process.env
});
if(result.error)throw result.error;
if(result.signal)throw new Error('Stage suite exited on '+result.signal);
process.exitCode=result.status===0?0:1;
