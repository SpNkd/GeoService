// Reproducible test artifact, from the same canonical library definitions as the raster fixture.
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import ts from 'typescript';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';
import console from 'node:console';
const source=readFileSync(new URL('../../src/symbols/gasProcessDemo.ts',import.meta.url),'utf8').replace("import { PROCESS_CONCEPTS } from '../process/semantics';",'const PROCESS_CONCEPTS = {};');
const javascript=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText;
const {gasProcessDemo}=await import(`data:text/javascript;base64,${Buffer.from(javascript).toString('base64')}`);
const python=String.raw`
import sys,json
from reportlab.pdfgen import canvas
data=json.load(sys.stdin)
c=canvas.Canvas(sys.argv[1],pagesize=(1000,300),invariant=1)
c.setTitle('GeoService topology fixture — Input Valve Filter Regulator Output')
c.setLineWidth(2)
definitions=['equipment-block','valve','filter','pressure-regulator','equipment-block']
names=['Input','Valve','Filter','Regulator','Output']
symbols={s['id']:s for s in data['symbols']}
for i,(definition,name) in enumerate(zip(definitions,names)):
    x=100+i*200
    c.setFont('Helvetica',18);c.drawString(x-30,220,name)
    c.saveState();c.translate(x,130);c.scale(80,80);c.setLineWidth(2/80)
    for g in symbols[definition]['geometry']:
        kind=g['type']
        if kind=='circle': c.circle(g['center']['x'],g['center']['y'],g['radius'],stroke=1,fill=0)
        elif kind=='rect': c.rect(g['position']['x'],g['position']['y'],g['width'],g['height'],stroke=1,fill=0)
        else:
            points=[g['start'],g['end']] if kind=='line' else g['points']
            p=c.beginPath();p.moveTo(points[0]['x'],points[0]['y'])
            for q in points[1:]: p.lineTo(q['x'],q['y'])
            if kind=='polygon': p.close()
            c.drawPath(p,stroke=1,fill=0)
    c.restoreState()
    # Native vectors are precise: a 0.2 pt separation preserves symbol grouping.
    if i<4: c.line(x+40.2,130,x+159.8,130)
c.showPage();c.save()
`;
const output=new URL('./pdf/topology-process.pdf',import.meta.url).pathname;
const result=spawnSync(process.env.PDF_PYTHON??'python3',['-c',python,output],{input:JSON.stringify(gasProcessDemo),encoding:'utf8'});
if(result.status!==0)throw new Error(result.stderr||'PDF generator failed');
console.log(output);
