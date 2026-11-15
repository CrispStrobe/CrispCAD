// SPDX-License-Identifier: BSD-3-Clause
export type CadColorMode='light'|'dark';
export const cadColorPalettes={
 light:{scheme:'light',bg:'#f3f7fc',panel:'#ffffff',header:'#e9f1fc',surface:'#edf3fb',input:'#ffffff',hover:'#dce9f8',text:'#26374d',muted:'#52657d',border:'#758ba7',accent:'#075eb7',accentFill:'#075eb7',onAccent:'#ffffff',selected:'#dcecff',overlay:'#fffffff2',preview:'#e7eef7',disabled:'#dce4ef',disabledText:'#52657d',link:'#075eb7',danger:'#9d1e26',dangerBg:'#fff0f0',success:'#15613c',successBg:'#e2f5eb',warning:'#805300',warningBg:'#fff0cc',badge:'#d8eafa',badgeText:'#144b77',violetBg:'#eee7ff',violetText:'#5d2587',wash:'#075eb728'},
 dark:{scheme:'dark',bg:'#101a24',panel:'#17232e',header:'#14212b',surface:'#233543',input:'#0e1922',hover:'#344c60',text:'#edf3fa',muted:'#bacbdc',border:'#64809c',accent:'#9ac8ff',accentFill:'#245fa6',onAccent:'#ffffff',selected:'#263f59',overlay:'#17232ef2',preview:'#10232d',disabled:'#2b3c4d',disabledText:'#b5c2d1',link:'#a9d1ff',danger:'#ffb9b9',dangerBg:'#622e31',success:'#a0dfb2',successBg:'#254c3e',warning:'#f9dfa6',warningBg:'#51442a',badge:'#29485b',badgeText:'#bfe7ff',violetBg:'#493751',violetText:'#edc7fa',wash:'#9ac8ff28'}
} as const;
const groups:Record<string,string[]>={
 bg:['#101a24','#111e29'],panel:['#17232e','#14232e'],header:['#14212b'],
 surface:['#233543','#223340','#1c303e','#334854','#1a2b37','#182632','#172b38','#182b36','#132330','#252e30'],
 input:['#101c26','#0e1922','#0e1a23','#0c1820','#0e1b25','#10212c','#0c1b25'],hover:['#344c60','#2e4353','#253e4e'],
 text:['#e7edf5','#e8e7dc','#e2e9ed','#e8edf0','#d9e4eb','#dce6ed','#e4edf2','#e1ebf1','#d3e1e9','#d9e8ef','#edf4f9','#daedf6','#eef5f9'],
 muted:['#bdcdd8','#9bb0c0','#a1aca8','#93a8b6','#bac8cf','#a9bbc8','#a9bbc9','#b6c8d6','#99afbd','#c4d2da','#bac9d2','#d0c49f','#bacbd6','#b7cbd7','#adbfcc','#97b2c4','#aabfce','#b5c7d3','#bbcbd8','#a1b8c6','#9fb5c2','#a8bdc9','#a9bfcd','#a4bdcc','#b9d4e4','#89a4b5','#b5d0e0','#a8becb','#9db4c3','#b9cdd9','#7393a3','#758f9d','#6c91a6'],
 border:['#405565','#304252','#67757b','#81949e','#596877','#536979','#41515c','#52616a','#3d505c','#425564','#526778','#425b6c','#3d5768','#354c5b','#526c7c','#688696','#526a7a','#526b7c','#3c5768'],
 selected:['#3a352b','#695438','#3a4c59','#3a3b32','#3a3529','#35413e','#163c4b','#594426'],
 accent:['#fac15a','#b58e48','#957947','#bd944e','#ba934d','#ffc35b','#ffc45c','#5de2ff','#c7f6ff','#67d9ff','#d0a554','#ffe2a4'],
 overlay:['#14212be8','#17232ef2','#17232ed9','#13212bdd','#132330ce','#101c26ed'],preview:['#10232d','#293b46','#244458'],
 link:['#83baff','#9bc7ff','#9ecbff','#93bbf3'],danger:['#ef7e73','#ef8b80','#f4a39a','#f58b80','#ff918b','#ef9a8e','#f4b4a4','#ffe6e3'],dangerBg:['#622e31'],
 success:['#62c899','#85cf9a','#a0dfb2','#95d4a6','#b8edd0'],successBg:['#254c3e'],warning:['#e0c48b','#f9dfa6','#f9cd93'],warningBg:['#51442a'],
 badge:['#29485b'],badgeText:['#bfe7ff'],violetBg:['#393e60','#493751'],violetText:['#d5d4ff','#edc7fa'],wash:['#ffc35b28','#67d9ff25']
};
const tokens=new Map(Object.entries(groups).flatMap(([token,colors])=>colors.map(color=>[color,`var(--cad-${token})`] as const)));
const variables=(mode:CadColorMode)=>Object.entries(cadColorPalettes[mode]).map(([name,value])=>`--cad-${name}:${value}`).join(';');
/** Map the editor's existing semantic UI colours; model/thumbnail pixels stay intact. */
export function themedEditorStyle(source:string){return `:host{${variables('dark')}}:host([data-cad-color-mode=light]){${variables('light')}}\n`+source.replace(/#[0-9a-fA-F]{3,8}\b/g,color=>tokens.get(color)??color)+`\n
:host{color:var(--cad-text);color-scheme:var(--cad-scheme);--panel:var(--cad-panel);--line:var(--cad-border);--accent:var(--cad-accent)}
button.primary,.group-tools>button.primary{background:var(--cad-accentFill);color:var(--cad-onAccent);border-color:var(--cad-accentFill)}
button:disabled,input:disabled,select:disabled,textarea:disabled{opacity:1;color:var(--cad-disabledText);background:var(--cad-disabled);border-color:var(--cad-border);cursor:default}
.simulation-panel{background:var(--cad-panel);color:var(--cad-text)}.simulation-panel p,.simulation-panel small{color:var(--cad-muted)}
.simulation-panel button,.simulation-panel input,.simulation-panel select{color:var(--cad-text)}
.simulation-panel button:disabled,.simulation-panel input:disabled,.simulation-panel select:disabled{color:var(--cad-disabledText)}
.simulation-panel[hidden]{display:none!important}
`;}
