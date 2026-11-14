// SPDX-License-Identifier: BSD-3-Clause
export const messages:Record<string,string>={
"Expected a finite number":"Eine endliche Zahl wird erwartet",
"Text construction budget exceeded":"Budget für die Texterstellung überschritten",
"Source assertion failed: {0}":"Zusicherung im Quelltext fehlgeschlagen: {0}",

"Expanded shape budget exceeds {0} nodes":"Erweitertes Formbudget überschreitet {0} Knoten",

"Union solids and subtract holes":"Körper vereinigen und Bohrungen abziehen",
"Assertion conditions are retained; custom messages are omitted.":"Zusicherungsbedingungen bleiben erhalten; eigene Meldungen werden ausgelassen.",

"Unrecognized arguments to {0} are ignored: {1}.":"Unbekannte Argumente für {0} werden ignoriert: {1}.",
"Cylinder radius overrides the per-end radii.":"Der Zylinderradius überschreibt die Radien an den Enden.",

"JSCAD revolution export needs a provable radial side":"Für den JSCAD-Rotationsexport muss die radiale Seite nachweisbar sein",

"Revolved profiles must stay on one side of the radial axis":"Rotationsprofile müssen auf einer Seite der radialen Achse bleiben",
"Signed revolutions cannot yet be exported to JSCAD":"Rotationsextrusionen mit negativem Winkel können noch nicht nach JSCAD exportiert werden",

"Source assertion failed":"Zusicherung im Quelltext fehlgeschlagen",
"Automatic resize requires exactly one nonzero target dimension":"Automatische Größenänderung erfordert genau eine Zielabmessung ungleich null",
"Constant expression dependency cycle or depth exceeded":"Zyklische Abhängigkeit oder Tiefengrenze bei konstanten Ausdrücken überschritten",

"Numeric text uses native number formatting; exact upstream formatting can differ.":"Numerischer Text verwendet die native Zahlenformatierung; die genaue Originalformatierung kann abweichen.",
"expression evaluation budget exceeded":"Auswertungsbudget für Ausdrücke überschritten",
"Invalid range reduction":"Ungültige Bereichsreduktion",
"Range reduction exceeds 256 values":"Bereichsreduktion überschreitet 256 Werte",
"Loop exceeds 256 values":"Schleife überschreitet 256 Werte",

"Invalid generated polygon sequence":"Ungültige Folge generierter Polygonpunkte",
"Invalid solid/hole role":"Ungültige Körper-/Bohrungsrolle",
"Invalid solid/hole combination":"Ungültige Körper-/Bohrungskombination",
"Model source uses project version 6 or 7":"Modellquelltext verwendet Projektversion 6 oder 7",
"pick requires an index and values":"pick erfordert einen Index und Werte",
"List index is outside the available values":"Listenindex liegt außerhalb der verfügbaren Werte",
"Reference helpers cannot be hole cutters":"Referenzhilfen können nicht als Bohrungen dienen",
"Detach the selected bodies’ joints before changing them to holes":"Lösen Sie die Gelenke der ausgewählten Körper, bevor Sie sie in Bohrungen ändern",
"Hole":"Bohrung",
"Solid":"Körper",
"Solid or hole":"Körper oder Bohrung",
"Union subtracts hole shapes from solid shapes":"Vereinigen zieht Bohrungen von Körpern ab",
"Printable solid":"Druckbarer Körper",
"Random values use the repeatable Brickwright generator; seeded sequences differ from OpenSCAD. Unseeded calls use seed 1.":"Zufallswerte verwenden den wiederholbaren Brickwright-Generator; Folgen mit Startwert unterscheiden sich von OpenSCAD. Aufrufe ohne Startwert verwenden 1.",
"at most 256 code values are supported":"Höchstens 256 Codewerte werden unterstützt"
};
