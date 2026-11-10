# Créations vivantes v5 (addon Minecraft Bedrock)

Construis une créature ou un véhicule en blocs, puis donne-lui vie avec l'**Étincelle de vie** (ou la **Clé de véhicule**).

## Nouveautés de la v5

- **Jusqu'à 64 × 64 × 64 blocs** (longueur, largeur et hauteur) au lieu de 28, et **plus de limite au nombre de blocs** (avant : 150 pour une créature, 220 pour un véhicule).
- **Tous les blocs sont gardés** : même ceux de l'intérieur, qui ne se voient pas. Quand la création redevient des blocs (Bâton du créateur → « Redevenir des blocs »), ta construction revient à l'identique, bloc par bloc, avec les escaliers, bûches, etc. tournés dans le bon sens.
- **Tête en un bloc OU en plusieurs blocs** : le premier bloc cliqué est la tête (il porte les yeux et le nom). Dans le menu (reclique la tête) :
  - « Marquer la TÊTE (plusieurs blocs) » : ajoute d'autres blocs à la tête. Toute la tête tourne alors d'un bloc avec le regard, autour du cou ;
  - « Tête = un seul bloc » : efface les blocs ajoutés, la tête redevient un seul bloc.
- **Marquage par ZONE** : dans le menu, « Marquage : ZONE (2 coins) ». Clique un coin puis le coin opposé : tous les blocs entre les deux reçoivent la partie choisie (jambes, bras, tête...). En mode zone, tu peux viser un coin de loin (64 blocs). Indispensable pour les très grandes créations.
- **Gomme** : démarque des blocs (un par un ou par zone).
- Plus de points de vie pour les géants (jusqu'à 1000 PV), boîte de collision et selle adaptées aux grandes tailles (selle jusqu'à 64 blocs de haut).

## Comment ça reste fluide avec 260 000 blocs ?

- L'analyse, l'apparition et le retrait des blocs sont étalés sur plusieurs ticks (le jeu ne gèle pas, le script ne plante pas).
- Les blocs d'une même partie (corps, chaque jambe, la tête...) sont **fusionnés** en cubes animés de 2, 4, 8 ou 16 blocs de côté, et l'intérieur caché n'est pas affiché.
- Si la création a encore trop de morceaux (plus de 2000 pour une créature, 1500 pour un véhicule), les cubes acceptent un peu de mélange de textures. Seul l'affichage est simplifié : les vrais blocs sont tous sauvegardés.
- Les très grandes créations sont mises à jour moins souvent et, à l'arrêt, seules les parties qui bougent (ailes, queue, tête, hélices) sont replacées.

## Limites connues

- Comme avant, l'affichage d'un bloc utilise une table de 256 textures : un bloc inconnu prend la texture la plus proche (pierre par défaut). Le vrai bloc est gardé et rendu tel quel quand la création redevient des blocs.
- L'addon n'a pas encore été testé en jeu : les tests ont été faits dans un monde simulé (une créature de 91 136 blocs devient 1563 morceaux animés, puis se retransforme en ses 91 136 blocs d'origine).

## Construire le fichier .mcaddon

```bash
./build.sh   # crée dist/CreationsVivantes_v5.mcaddon
```
