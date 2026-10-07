// Numeric provenance only: this does not infer actions, anchors or coordinates.
// Cardinal words are bounded to integers 0–99; explicit XY still uses its stricter syntax.
const cardinal: Record<string, number> = {};
for (const [value, forms] of [
  [0,'ноль нуля нулю нулем'], [1,'один одна одно одну одного одной'],
  [2,'два две двух двум двумя'], [3,'три трех трем тремя'],
  [4,'четыре четырех четырем четырьмя'], [5,'пять пяти пятью'],
  [6,'шесть шести шестью'], [7,'семь семи семью'], [8,'восемь восьми восемью'],
  [9,'девять девяти девятью'], [10,'десять десяти десятью'],
  [11,'одиннадцать одиннадцати'], [12,'двенадцать двенадцати'],
  [13,'тринадцать тринадцати'], [14,'четырнадцать четырнадцати'],
  [15,'пятнадцать пятнадцати'], [16,'шестнадцать шестнадцати'],
  [17,'семнадцать семнадцати'], [18,'восемнадцать восемнадцати'],
  [19,'девятнадцать девятнадцати'], [20,'двадцать двадцати'],
  [30,'тридцать тридцати'], [40,'сорок сорока'], [50,'пятьдесят пятидесяти'],
  [60,'шестьдесят шестидесяти'], [70,'семьдесят семидесяти'],
  [80,'восемьдесят восьмидесяти'], [90,'девяносто девяноста'],
] as const) for (const word of forms.split(' ')) cardinal[word] = value;

export function explicitNumericLiterals(text: string): Set<number> {
  const values = new Set([...text.matchAll(/[+-]?(?:\d+(?:[.,]\d+)?)/g)].map(m => Number(m[0].replace(',','.'))));
  const words = [...text.toLocaleLowerCase('ru').replaceAll('ё','е').matchAll(/[а-я]+/g)];
  for (let i=0; i<words.length; i++) {
    const word=words[i]!, value=cardinal[word[0]];
    if(value===undefined)continue;
    const next=words[i+1], unit=next?cardinal[next[0]]:undefined;
    if(value>=20&&unit!==undefined&&unit>0&&unit<10&&/^\s+$/.test(text.slice(word.index!+word[0].length,next!.index))) {
      values.add(value+unit); i++;
    } else values.add(value);
  }
  return values;
}
