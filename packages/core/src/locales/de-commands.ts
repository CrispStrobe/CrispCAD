// SPDX-License-Identifier: BSD-3-Clause
/** Shared command registry, headless runner, journal export, MCP tools and CLI. */
export const messages:Record<string,string>={
 'Summarize or export the command journal':'Befehlsprotokoll zusammenfassen oder exportieren',
 'Usage: journal [export [cadscript|replay]].':'Verwendung: journal [export [cadscript|replay]].',
 'Enter a command.':'Geben Sie einen Befehl ein.',
 '{0} needs the interactive editor.':'{0} erfordert den interaktiven Editor.',
 'No command journal is attached.':'Kein Befehlsprotokoll verbunden.',
 'Missing arguments. Usage: {0}':'Fehlende Argumente. Verwendung: {0}',
 'A command script accepts at most {0} commands.':'Ein Befehlsskript darf höchstens {0} Befehle enthalten.',
 'Line {0}: {1}':'Zeile {0}: {1}',
 'Run commands':'Befehle ausführen',
 // Palette labels that had no German entry yet.
 'Select all':'Alles auswählen',
 'Deselect':'Auswahl aufheben',
 'List the shared CAD command vocabulary (terminal, palette, CLI): names, aliases, usage, typed arguments, whether a command edits the model and whether it runs headlessly in cad_run_commands.':'Den gemeinsamen CAD-Befehlswortschatz (Terminal, Befehlspalette, CLI) auflisten: Namen, Aliasse, Syntax, typisierte Argumente, ob ein Befehl das Modell ändert und ob er ohne Editor in cad_run_commands läuft.',
 'Run CAD terminal commands headlessly, one per line (at most 64; // comments allowed), against a copy of the current model. The script starts with an empty selection; select bodies before move/rotate/scale. All edits are validated and saved as one history step; preview saves nothing. Returns command outputs and a journal export. View and panel commands are refused.':'CAD-Terminalbefehle ohne Editor ausführen, einen pro Zeile (höchstens 64; //-Kommentare erlaubt), auf einer Kopie des aktuellen Modells. Das Skript beginnt ohne Auswahl; wählen Sie Körper vor move/rotate/scale aus. Alle Änderungen werden geprüft und als ein Verlaufsschritt gespeichert; preview speichert nichts. Liefert die Befehlsausgaben und einen Protokollexport. Ansichts- und Bedienfeldbefehle werden abgelehnt.',
};
