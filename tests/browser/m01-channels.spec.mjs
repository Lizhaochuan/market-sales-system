import {test,expect} from '@playwright/test';
import pg from 'pg';
import {randomUUID} from 'node:crypto';

const org='20000000-0000-4000-8000-000000000001';
const passphrase='fictional-strong-ui-demo-passphrase-0001';
async function login(page,account='sales-a'){
 await page.goto('/');
 await page.locator('#login-form select[name="account_code"]').selectOption(account);
 await page.locator('#login-form input[name="passphrase"]').fill(passphrase);
 await page.getByRole('button',{name:'进入工作台'}).click();
 await expect(page.locator('#page-title')).toHaveText('工作概览');
}

test('M01 Chromium Chinese read-only channel hierarchy, XSS safety, failed refresh and mobile viewport',async({page},testInfo)=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:2});
 const ids={root:randomUUID(),child:randomUUID(),ownInactive:randomUUID(),html:randomUUID()};
 const injected='模拟渠道 <img src=x onerror=alert(1)>';
 try{
  for(const [id,parent,name,status,type] of [
   [ids.root,null,'虚构已停用上级渠道','inactive','referral'],
   [ids.child,ids.root,'上级停用的虚构子渠道','active','referral'],
   [ids.ownInactive,null,'单独停用的虚构渠道','inactive','online'],
   [ids.html,null,injected,'active','online']
  ]){
   await pool.query(
    'INSERT INTO ms.marketing_channels(id,organization_id,parent_id,name,channel_type,status) VALUES($1,$2,$3,$4,$5,$6)',
    [id,org,parent,name,type,status]);
  }
  await login(page);
  await page.getByRole('button',{name:'获客渠道'}).click();
  await expect(page.locator('#page-title')).toHaveText('获客渠道');
  await expect(page.locator('#channels-list')).toContainText('虚构已停用上级渠道');
  await expect(page.locator('#channels-list')).toContainText('上级停用的虚构子渠道');
  await expect(page.locator('#channels-list')).toContainText('单独停用的虚构渠道');
  await expect(page.locator('#channels-list')).toContainText('因上级渠道停用而不可用');
  await expect(page.locator('#channels-list')).toContainText('本渠道已停用');
  await expect(page.locator('#channels-list')).toContainText(injected);
  await expect(page.locator('#channels-list img')).toHaveCount(0);
  await expect(page.locator('#channels-status')).toContainText('仅供虚构数据演示');
  await expect(page.locator('[data-panel="channels"]')).not.toContainText('正式收款');
  await expect(page.locator('[data-panel="channels"] button')).toHaveCount(0);
  await testInfo.attach('m01-channel-hierarchy-browser',{
   body:await page.screenshot({fullPage:true}),contentType:'image/png'});
  // A failed refresh must CLEAR rather than preserve cached channel names.
  await page.route('**/api/v1/marketing-channels',route=>route.fulfill({
   status:500,contentType:'application/json',
   body:JSON.stringify({code:'INTERNAL_ERROR',message:'测试模拟渠道读取失败'})
  }));
  await page.getByRole('button',{name:'刷新数据'}).click();
  await expect(page.locator('#channels-status')).toContainText('渠道目录未能读取');
  await expect(page.locator('#toast')).toContainText('渠道目录读取失败，已清空旧数据');
  await expect(page.locator('#channels-list')).not.toContainText('上级停用的虚构子渠道');
  await page.unroute('**/api/v1/marketing-channels');
  await page.getByRole('button',{name:'刷新数据'}).click();
  await expect(page.locator('#channels-list')).toContainText('上级停用的虚构子渠道');
  await page.setViewportSize({width:390,height:844});
  await expect(page.getByRole('button',{name:'获客渠道'})).toBeVisible();
  await expect(page.locator('#channels-list')).toContainText('单独停用的虚构渠道');
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.getByRole('button',{name:'退出演示账号'}).click();
  await expect(page.locator('#workspace')).toBeHidden();
  await expect(page.locator('#channels-list')).not.toContainText('上级停用的虚构子渠道');
 }finally{
  for(const id of [ids.child,ids.root,ids.ownInactive,ids.html])
   await pool.query('DELETE FROM ms.marketing_channels WHERE id=$1',[id]);
  await pool.end();
 }
});
