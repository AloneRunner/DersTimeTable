const fs = require('fs');
const path = require('path');
const files = ['App.tsx','hooks/useTimetableData.ts','services/localSolver.ts'];
const map = new Map(Object.entries({
  'Ã–':'Ö','Ãœ':'Ü','Ã‡':'Ç','Ã¶':'ö','Ã¼':'ü','Ã§':'ç',
  'ÄŸ':'ğ','Äž':'Ğ','ÅŸ':'ş','Åž':'Ş','Ä±':'ı','Ä°':'İ',
  'â€™':'’','â€œ':'“','â€':'”','â€“':'–','â€”':'—','Â':''
}));
for(const f of files){
  if(!fs.existsSync(f)) continue;
  let t = fs.readFileSync(f,'utf8');
  for(const [k,v] of map){ t = t.split(k).join(v); }
  fs.writeFileSync(f, t, 'utf8');
  console.log('fixed', f);
}
