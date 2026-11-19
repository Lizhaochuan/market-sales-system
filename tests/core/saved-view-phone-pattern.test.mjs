import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';

// Exercise the actual browser closure without exposing customer/session state globally.
const source=readFileSync(new URL('../../web/sales-workflow.js',import.meta.url),'utf8');
const start=source.indexOf('   const isSensitivePhonePattern=');
const end=source.indexOf('   savedBar.append(svName)',start);
assert.ok(start>=0&&end>start);
const isSensitivePhonePattern=runInNewContext(`(()=>{${source.slice(start,end)}return isSensitivePhonePattern;})()`);

for(const value of [
 '电话139 1234 5678视图','客户+86-139-1234-5678','家长(139)1234-5678',
 '家长（139）1234—5678','客户＋0086 139 1234 5678','电话13912345678视图',
 '联系010-12345678','电话123 4567','139_1234_5678','139/1234/5678',
 '13912345678 13812345678','电话139 1234 5678 138 1234 5678视图',
 '1234567890123456','2026-11-20 电话139 1234 5678',
])test(`reject phone-shaped saved-view input: ${value}`,()=>assert.equal(isSensitivePhonePattern(value),true));

for(const value of [
 '',null,undefined,123,'学生1','04A','2026课程计划','班级04A学生1',
 '客户123456','2026-11-20','计划2026/11/20','2026年11月20日 09:30',
 '2026课程1班2组','第1期 第2组 第3班',
])test(`allow ordinary identifier/date: ${value}`,()=>assert.equal(isSensitivePhonePattern(value),false));
