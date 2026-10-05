/** Shared numeric path encoder for semantic Symbols and document-local imported vectors. */
export const vectorPath=(points:readonly {x:number;y:number}[],closed=false)=>`M${points.map(p=>`${p.x},${p.y}`).join('L')}${closed?'Z':''}`;
