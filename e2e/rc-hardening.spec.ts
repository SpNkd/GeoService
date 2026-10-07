import { expect, test } from '@playwright/test';
import { readAutosaveDocument, readAutosaveRecord } from './helpers/autosave';
import { readFile } from 'node:fs/promises';
import { releaseTorture } from '../src/tests/fixtures/releaseTorture';
import { editorCommand,openRightTab } from './helpers/editorCommands';

for (const quota of [false, true]) test(`pagehide flush reports the actual ${quota ? 'failed' : 'saved'} revision`, async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  // Wait for the persisted revision, not only the initial status label.
  await expect.poll(async () => (await readAutosaveRecord(page))?.entityCount).toBeGreaterThan(0);
  const before = await readAutosaveDocument(page);
  if (quota) await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); };
  });
  await page.getByRole('button', { name: 'Создать слой', exact: true }).click();
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранение…');
  await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.getByTestId('persistence-status')).toHaveText(quota ? 'Автосохранение не выполнено' : 'Сохранено локально');
  if (quota) {
    expect((await readAutosaveRecord(page))?.document).toEqual(before);
    await expect(page.getByRole('button', { name: 'Выбрать слой Новый слой', exact: true })).toBeVisible();
    await expect(page.locator('.document-notice')).toContainText('квота');
  } else {
    expect((await readAutosaveDocument(page)).layers.length).toBe(before.layers.length + 1);
    await page.reload();
    expect((await readAutosaveDocument(page)).layers.length).toBe(before.layers.length + 1);
  }
  expect(errors).toEqual([]);
});

test('failed ordinary autosave preserves previous record; a later edit recovers', async ({ page }) => {
  await page.goto('/');
  await expect.poll(async () => (await readAutosaveRecord(page))?.entityCount).toBeGreaterThan(0);
  const before = await readAutosaveDocument(page);
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    let fail = true;
    IDBObjectStore.prototype.put = function (...args: Parameters<IDBObjectStore['put']>) {
      if (fail) { fail = false; throw new DOMException('Synthetic quota failure', 'QuotaExceededError'); }
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Создать слой', exact: true }).click();
  await expect(page.getByTestId('persistence-status')).toHaveText('Автосохранение не выполнено');
  expect((await readAutosaveRecord(page))?.document).toEqual(before);
  await page.getByRole('button', { name: 'Создать слой', exact: true }).click();
  await expect.poll(async () => (await readAutosaveRecord(page))?.document.layers.length).toBe(before.layers.length + 2);
  await expect(page.getByTestId('persistence-status')).toHaveText('Сохранено локально');
});

test('composite JSON/autosave/reload and missing raster relink preserve all canonical content',async({page})=>{
 const errors:string[]=[],external:string[]=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/^https?:/.test(r.url())&&new URL(r.url()).hostname!=='127.0.0.1')external.push(r.url());});
 await page.goto('/');const fixture=releaseTorture().document;
 await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles({name:'release-torture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});
 expect(await readAutosaveDocument(page)).toEqual(fixture);
 await openRightTab(page,'search');await page.getByLabel('Поиск в документе',{exact:true}).fill('Synthetic underlay');
 await page.locator('.search-results').getByRole('button',{name:'Synthetic underlay',exact:true}).click();await openRightTab(page,'properties');
 await expect(page.getByTestId('underlay-properties')).toContainText('Подложка недоступна');
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=640;c.height=480;const ctx=c.getContext('2d')!;ctx.fillStyle='white';ctx.fillRect(0,0,640,480);ctx.strokeRect(40,40,300,200);return c.toDataURL().split(',')[1]!;});
 await page.getByLabel('Перепривязать изображение',{exact:true}).setInputFiles({name:'safe-underlay.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect(page.getByTestId('underlay-properties')).not.toContainText('Подложка недоступна');
 const expected=await readAutosaveDocument(page);expect(expected.semantics).toEqual(fixture.semantics);expect(expected.entities.filter(e=>e.type!=='raster_underlay')).toEqual(fixture.entities.filter(e=>e.type!=='raster_underlay'));
 const download=page.waitForEvent('download');await editorCommand(page,'Сохранить JSON');const file=(await(await download).path())!;
 expect(JSON.parse(await readFile(file,'utf8'))).toEqual(expected);
 await page.reload();expect(await readAutosaveDocument(page)).toEqual(expected);
 await editorCommand(page,'Новый документ');await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles(file);expect(await readAutosaveDocument(page)).toEqual(expected);
 expect(errors).toEqual([]);expect(external).toEqual([]);
});

test('corrupt/future JSON and corrupt preferences are recoverable without replacing the document',async({page})=>{
 await page.addInitScript(()=>localStorage.setItem('geoservice.preferences.v1','{broken'));
 await page.goto('/');await expect.poll(async()=>(await readAutosaveRecord(page))?.entityCount).toBeGreaterThan(0);
 const before=await readAutosaveDocument(page);
 for(const data of ['{truncated',JSON.stringify({...before,schemaVersion:999})]){
  await page.getByLabel('Файл GeoDocument',{exact:true}).setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from(data)});
  await expect(page.locator('.document-notice.error')).toBeVisible();expect(await readAutosaveDocument(page)).toEqual(before);
 }
 await page.getByRole('button',{name:'Создать слой',exact:true}).click();expect((await readAutosaveDocument(page)).layers.length).toBe(before.layers.length+1);
});

test('Search/AI text survives tab changes and keyboard Space stays text',async({page})=>{
 await page.goto('/');await openRightTab(page,'search');const search=page.getByLabel('Поиск в документе',{exact:true});
 await search.fill('query');await search.press('Space');await expect(search).toHaveValue('query ');
 await openRightTab(page,'ai');const prompt=page.getByLabel('Запрос',{exact:true});await prompt.fill('draft');await prompt.press('Space');await expect(prompt).toHaveValue('draft ');
 await openRightTab(page,'properties');await openRightTab(page,'search');await expect(search).toHaveValue('query ');
 await openRightTab(page,'ai');await expect(prompt).toHaveValue('draft ');
 expect(await page.locator('[data-dock=right] [role=tabpanel]:visible').count()).toBe(1);
});


test('failed asset write leaves current document usable and unchanged',async({page})=>{
 await page.goto('/');const before=await readAutosaveDocument(page),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.evaluate(()=>{const put=IDBObjectStore.prototype.put;IDBObjectStore.prototype.put=function(...args:Parameters<IDBObjectStore['put']>){if(this.name==='rasters')throw new DOMException('Synthetic asset quota','QuotaExceededError');return put.apply(this,args);};});
 const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;return c.toDataURL().split(',')[1]!;});
 await page.getByLabel('Импорт подложки',{exact:true}).setInputFiles({name:'safe.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
 await expect(page.locator('.document-notice')).toContainText(/квот|quota|хранилищ/i);expect(await readAutosaveDocument(page)).toEqual(before);
 await page.getByRole('button',{name:'Создать слой',exact:true}).click();expect((await readAutosaveDocument(page)).layers.length).toBe(before.layers.length+1);expect(errors).toEqual([]);
});

for(const action of ['Настройки','Горячие клавиши','Восстановить связи','Привязать координаты','Импорт координат'])test(`remaining shared dialogs fit small desktop and Cancel preserves document: ${action}`,async({page})=>{
 await page.setViewportSize({width:1000,height:700});await page.goto('/');if(action==='Привязать координаты')await editorCommand(page,'Новый документ');const before=await readAutosaveDocument(page);await editorCommand(page,action);
 const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible();expect(await dialog.evaluate(e=>{const b=e.getBoundingClientRect(),body=e.querySelector('.dialog-body')!;return b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight&&body.scrollWidth<=body.clientWidth+1;})).toBe(true);
 const controls=dialog.locator('button:visible:not(:disabled),input:visible:not(:disabled),select:visible:not(:disabled),textarea:visible:not(:disabled),summary:visible');
 await controls.last().focus();await page.keyboard.press('Tab');await expect(controls.first()).toBeFocused();await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);expect(await readAutosaveDocument(page)).toEqual(before);
});
