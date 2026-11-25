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
 'Run CAD terminal commands headlessly, one per line (at most 64; // comments allowed), against a copy of the current model. The script starts with an empty selection; select bodies before move/rotate/scale. All edits are validated and saved as one history step; preview saves nothing. Returns command outputs and a journal export. fillet, chamfer, shell and recompute exact run on the optional exact B-rep kernel. View and panel commands are refused.':'CAD-Terminalbefehle ohne Editor ausführen, einen pro Zeile (höchstens 64; //-Kommentare erlaubt), auf einer Kopie des aktuellen Modells. Das Skript beginnt ohne Auswahl; wählen Sie Körper vor move/rotate/scale aus. Alle Änderungen werden geprüft und als ein Verlaufsschritt gespeichert; preview speichert nichts. Liefert die Befehlsausgaben und einen Protokollexport. fillet, chamfer, shell und recompute exact laufen auf dem optionalen exakten B-Rep-Kern. Ansichts- und Bedienfeldbefehle werden abgelehnt.',
 // Atomic terminal scripts and repeat.
 'Repeat the last command or script':'Den letzten Befehl oder das letzte Skript wiederholen',
 'Run command script':'Befehlsskript ausführen',
 'The model changed while the script was running. Nothing was changed; run it again.':'Das Modell wurde geändert, während das Skript lief. Es wurde nichts geändert; führen Sie es erneut aus.',
 'Script: {0} commands, committed as one Undo step.':'Skript: {0} Befehle, als ein Rückgängig-Schritt übernommen.',
 'Script: {0} commands; the model did not change.':'Skript: {0} Befehle; das Modell wurde nicht geändert.',
 'The script changed nothing.':'Das Skript hat nichts geändert.',
 'Nothing to repeat.':'Nichts zu wiederholen.',
 'Finish or cancel the current command before running a script.':'Schließen Sie den aktuellen Befehl ab oder brechen Sie ihn ab, bevor Sie ein Skript ausführen.',
 'Tab completes · ↑↓ history · Esc cancels · paste several lines to run a script':'Tab ergänzt · ↑↓ Befehlsverlauf · Esc bricht ab · mehrere Zeilen einfügen führt ein Skript aus',
};
