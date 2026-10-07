import {chromium,expect} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage(),errors=[];
page.on('pageerror',e=>errors.push(e.message));
try{
 await page.goto('http://127.0.0.1:5173/');await page.getByTestId('drawing-canvas').waitFor();await page.getByRole('button',{name:'Настройки',exact:true}).click();const d=page.getByRole('dialog',{name:'Настройки',exact:true});await d.getByRole('tab',{name:'AI',exact:true}).click();await expect(d).toContainText('Настроено локальным сервером');await expect(d.getByLabel('AI provider',{exact:true})).toHaveValue('openrouter');await expect(d.getByLabel('AI API key',{exact:true})).toHaveValue('');
 const response=page.waitForResponse(r=>r.url().endsWith('/api/ai/intent'));const start=Date.now();await d.getByRole('button',{name:'Проверить подключение',exact:true}).click();const r=await response,data=await r.json();await expect(d.getByRole('status')).toContainText('Соединение проверено',{timeout:50000});const body=r.request().postDataJSON();if(JSON.stringify(Object.keys(body))!==JSON.stringify(['text']))throw new Error('Unexpected AI payload');
 const report={date:new Date().toISOString(),provider:'openrouter',primaryModel:await d.getByLabel('Основная AI модель',{exact:true}).inputValue(),serverCredentialStatus:true,browserKeyEmpty:true,status:r.status(),milliseconds:Date.now()-start,request:body,result:data.result??data.intent??null,errors};await writeFile('docs/audit-results/settings-real-smoke.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));if(!r.ok()||errors.length)throw new Error('REAL smoke failed');
}finally{await browser.close();}
