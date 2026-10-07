import {expect,type Page} from '@playwright/test';
/** Follow the visible semantic hierarchy and await the completed menu interaction. */
export async function editorCommand(page:Page,name:string){
  if(name==='Вписать')name='Вписать схему в вид';
  const button=page.getByRole('button',{name,exact:true,includeHidden:true});
  if(!await button.isVisible()){
    const panel=await button.evaluate(e=>e.closest('.ai-panel')?'ai':e.closest('.document-search')?'search':e.closest('.right-panel')?'properties':null);if(panel)await openRightTab(page,panel as 'properties'|'search'|'ai');
    const summaries=await button.evaluate(e=>{const result:string[]=[];for(let p=e.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement&&!p.open)result.unshift(p.querySelector(':scope>summary')?.textContent??'');return result;});
    for(const text of summaries)await page.getByText(text,{exact:true}).first().click();
  }
  const popup=button.locator('xpath=ancestor::details[contains(@class,"toolbar-menu")][1]');
  const inPopup=await popup.count()>0;
  await button.click();
  if(inPopup)await expect(popup).not.toHaveAttribute('open','');
}
/** Explicit navigation keeps editor drafts mounted while exactly one sidebar surface is visible. */
export async function openRightTab(page:Page,tab:'properties'|'search'|'ai'){
 const heading=page.locator('[data-dock="right"] .dock-heading'),names={properties:'Свойства',search:'Поиск',ai:'AI'};
 if(await heading.getByRole('button',{name:'Развернуть панели',exact:true}).isVisible())await heading.getByRole('button',{name:'Развернуть панели',exact:true}).click();
 const button=heading.getByRole('tab',{name:names[tab],exact:true});
 if(await button.getAttribute('aria-selected')!=='true')await button.click();
}

export async function rendererSetting(page:Page,mode:'svg'|'canvas'){
 await editorCommand(page,'Настройки');const dialog=page.getByRole('dialog',{name:'Настройки',exact:true});await dialog.getByRole('tab',{name:'Диагностика',exact:true}).click();await dialog.getByLabel('DXF renderer',{exact:true}).selectOption(mode);await dialog.getByRole('button',{name:'Готово',exact:true}).click();
}
export async function aiDiagnosticsSettings(page:Page){
 await editorCommand(page,'Настройки');const dialog=page.getByRole('dialog',{name:'Настройки',exact:true});await dialog.getByRole('tab',{name:'Диагностика',exact:true}).click();await dialog.getByLabel('Диагностика редактора',{exact:true}).check();return dialog;
}
