import {expect,type Page} from '@playwright/test';
/** Follow the visible semantic hierarchy and await the completed menu interaction. */
export async function editorCommand(page:Page,name:string){
  if(name==='Вписать')name='Вписать схему в вид';
  const button=page.getByRole('button',{name,exact:true,includeHidden:true});
  if(!await button.isVisible()){
    const summaries=await button.evaluate(e=>{const result:string[]=[];for(let p=e.parentElement;p;p=p.parentElement)if(p instanceof HTMLDetailsElement&&!p.open)result.unshift(p.querySelector(':scope>summary')?.textContent??'');return result;});
    for(const text of summaries)await page.getByText(text,{exact:true}).first().click();
  }
  const popup=button.locator('xpath=ancestor::details[contains(@class,"toolbar-menu")][1]');
  const inPopup=await popup.count()>0;
  await button.click();
  if(inPopup)await expect(popup).not.toHaveAttribute('open','');
}
