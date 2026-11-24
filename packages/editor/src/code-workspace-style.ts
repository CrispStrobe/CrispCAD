// SPDX-License-Identifier: BSD-3-Clause
export const codeWorkspaceStyle=`
.editor:has(>.code-workspace[open]){grid-template-columns:minmax(0,1fr) minmax(320px,42%)}
.editor:has(>.code-workspace[open])>.design-bar,.editor:has(>.code-workspace[open])>.status,.editor:has(>.code-workspace[open])>.model-source-pane{grid-column:1/-1}
.editor:has(>.code-workspace[open])>.main{grid-row:2;grid-column:1}
.code-dialog.code-workspace[open]{position:static;grid-row:2;grid-column:2;width:auto;max-width:none;max-height:none;min-height:0;margin:0;border:0;border-left:1px solid var(--cad-border);border-radius:0;padding:12px;overflow:hidden;background:var(--cad-panel);color:var(--cad-text)}
.code-workspace header{flex-wrap:wrap;gap:6px}.code-workspace header h2{flex:1;margin:0;font-size:13px;letter-spacing:0;text-transform:none;color:var(--cad-text)}
.code-workspace button{font-size:11px;min-height:30px;padding:5px 8px}.code-workspace .code-layout{display:flex;flex-direction:column;flex:1;overflow:auto}
.code-workspace .code-source-pane textarea{min-height:180px;height:32vh;resize:vertical}
.code-workspace .code-preview-pane{display:grid;grid-template-columns:minmax(100px,1fr) minmax(120px,1fr);gap:8px}.code-workspace .code-preview-pane>img{height:135px}.code-workspace .code-preview-pane>.code-parameters{grid-column:2;grid-row:1/4}.code-workspace .code-preview-pane>button{justify-self:start;align-self:start}
.code-workspace footer{flex-wrap:wrap;gap:6px}.code-workspace footer>p{flex-basis:100%}
.code-workspace-note{font-size:11px;color:var(--cad-muted);margin:0}.code-workspace-note[data-warning=true]{color:var(--cad-warning)}
.code-completions{display:flex;flex-wrap:wrap;gap:4px}.code-completions:empty{display:none}.code-completions button{font:12px ui-monospace,monospace}
.code-dialog textarea[aria-invalid=true]{border-color:var(--cad-danger)}
@container(max-width:900px){.editor:has(>.code-workspace[open]){grid-template-columns:minmax(0,1fr)}.editor:has(>.code-workspace[open])>.main{visibility:hidden}.code-dialog.code-workspace[open]{grid-column:1;border-left:0}.code-workspace .code-source-pane textarea{height:30vh}}
`;
