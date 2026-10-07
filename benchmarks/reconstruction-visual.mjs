// Safe contact sheet: actual current Worker candidates over their generated raster sources.
import {chromium} from '@playwright/test';
import {mkdir} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome'}),page=await browser.newPage({viewport:{width:1400,height:1600}});
try{await page.goto('http://127.0.0.1:5173/');await page.evaluate(async()=>{
 const {reconstructionFixture}=await import('/src/tests/fixtures/reconstruction.ts'),{processImage}=await import('/src/image/client.ts'),{DEFAULT_EXTRACTION}=await import('/src/image/types.ts'),{fullQuad}=await import('/src/image/transform.ts');
 document.body.innerHTML='<main id="sheet"><h1>Reconstruction · generated safe sources / accepted primitive overlay</h1><p>Black raster; green fitted geometry. Pixel coordinates; no private document.</p></main>';
 Object.assign(document.body.style,{margin:'24px',background:'#fff',fontFamily:'Arial'});const sheet=document.getElementById('sheet');sheet.style.display='grid';sheet.style.gridTemplateColumns='1fr 1fr';sheet.style.gap='12px';
 for(const kind of ['straight','corner','T','X','arc','circle','gap','noisy']){
  const source=reconstructionFixture(kind==='noisy'?'straight':kind,640,480);
  if(kind==='noisy'){let seed=917;for(let i=0;i<source.data.length;i+=4){seed=(seed*1664525+1013904223)>>>0;const v=Math.max(0,Math.min(255,source.data[i]+seed%41-20));source.data[i]=source.data[i+1]=source.data[i+2]=v;}}
  const output=await processImage(source,{width:640,height:480},{quad:fullQuad(640,480),rectifiedWidth:640,rectifiedHeight:480},DEFAULT_EXTRACTION,new AbortController().signal);
  const section=document.createElement('section'),title=document.createElement('strong'),canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;canvas.style.width='100%';canvas.style.border='1px solid #ddd';title.textContent=kind+' → '+output.result.candidates.map(c=>c.type).join(', ');section.append(title,canvas);sheet.append(section);
  const ctx=canvas.getContext('2d');ctx.putImageData(new ImageData(source.data,640,480),0,0);ctx.strokeStyle='#00a050';ctx.lineWidth=1.5;
  for(const c of output.result.candidates){ctx.beginPath();if(c.type==='circle')ctx.arc(c.center.x,c.center.y,c.radius,0,Math.PI*2);else if(c.type==='arc')ctx.arc(c.center.x,c.center.y,c.radius,c.startAngle,c.endAngle);else if('points'in c){c.points.forEach((p,i)=>i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y));if(c.type==='contour')ctx.closePath();}ctx.stroke();}
 }
});await mkdir('docs/screenshots',{recursive:true});await page.screenshot({path:'docs/screenshots/reconstruction-acceptance.png',fullPage:true});}finally{await browser.close();}
