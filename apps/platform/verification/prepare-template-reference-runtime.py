"""Prepare an isolated, pinned upstream component render. Never import into the app."""
import json,pathlib,re,urllib.request
ROOT=pathlib.Path(__file__).resolve().parents[3]
SRC=ROOT/'docs/evidence/resume-studio-quality-2026-09-10/upstream'
OUT=ROOT/'.data/resume-quality-20260910/upstream-runtime'
for f in (SRC/'reference-runtime-source').iterdir():
 if '__' not in f.name or f.suffix not in ['.ts','.tsx']:continue
 parts=f.name.split('__');target=OUT.joinpath(*parts);target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(f.read_bytes())
imports=[];jp=[];magic=[]
sources={x['id']:x['source'].split(x['commit']+'/')[1] for x in json.loads((SRC/'template-source-files.json').read_text('utf8'))}
for i,f in enumerate(sorted(SRC.glob('jp_*-source.txt'))):
 name=f.name.removesuffix('-source.txt');relative='jp/'+sources[name];target=OUT/relative;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(f.read_bytes())
 exported=re.search(r'export function (\w+)',f.read_text('utf8')).group(1)
 imports.append(f'import {{ {exported} as J{i} }} from "./{relative}";');jp.append(f'"{name}":J{i}')
for i,f in enumerate(sorted(SRC.glob('magic_*-source.txt'))):
 name=f.name.removesuffix('-source.txt');target=OUT/f'magic/packages/resume-templates/src/config/{name}.ts';target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes(f.read_bytes())
 exported=re.search(r'export const (\w+)',f.read_text('utf8')).group(1)
 imports.append(f'import {{ {exported} as M{i} }} from "./magic/packages/resume-templates/src/config/{name}";');magic.append(f'"{name}":M{i}')
entry='''import React from 'react';
import {createRoot} from 'react-dom/client';
import i18n from 'i18next';import {initReactI18next} from 'react-i18next';
import {MagicResumeRenderer} from './magic/packages/resume-templates/src/renderer/MagicResumeRenderer';
'''+ '\n'.join(imports)+ '\nconst jobpilot={'+','.join(jp)+'};const magic={'+','.join(magic)+'''};
i18n.use(initReactI18next).init({lng:'zh',fallbackLng:'zh',resources:{zh:{translation:{}}},interpolation:{escapeValue:false}});
const root=createRoot(document.getElementById('root'));
window.renderReference=(id,data)=>{const Component=jobpilot[id];root.render(Component?<div style={{width:'210mm',minHeight:'297mm',padding:'20px',background:'white'}}><Component resume={data}/></div>:<MagicResumeRenderer template={magic[id]} data={data} locale="zh"/>);};
'''
(OUT/'entry.tsx').write_text(entry,encoding='utf8')
(OUT/'reference.css').write_text('@import "tailwindcss";\n@source "./jp";\n@source "./magic";\n.wysiwyg p{margin:0 0 .25em}.wysiwyg ul{list-style:disc;padding-left:1.4em}\n',encoding='utf8')
(OUT/'build.mjs').write_text('''import {build} from 'esbuild';import {resolve} from 'node:path';
await build({entryPoints:['entry.tsx'],outfile:'bundle.js',bundle:true,format:'iife',platform:'browser',jsx:'automatic',alias:{'@':resolve('jp/src')}});
''',encoding='utf8')
(OUT/'tsconfig.json').write_text('{"compilerOptions":{"jsx":"react-jsx"}}',encoding='utf8')
print(json.dumps({'jobpilot':len(jp),'magic':len(magic),'directory':str(OUT)}))
