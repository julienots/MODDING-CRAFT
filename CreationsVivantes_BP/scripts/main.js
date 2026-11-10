// Créations vivantes v4 — créatures ET véhicules en blocs : construis, anime, chevauche, conduis, fais voler
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { ModalFormData, ActionFormData } from "@minecraft/server-ui";
import { matOf } from "./materials.js";

const CORE = "cr:core", VOX = "cr:voxel", VEH = "cr:vehicle";
const SPARK = "cr:life_spark", STAFF = "cr:creator_staff", KEY = "cr:vehicle_key";
const MAX_BLOCKS = 150, MAX_VEH_BLOCKS = 220, MAX_SPAN = 28;
const NATURES = ["§9Gardien", "§aCompagnon", "§eChasseur", "§cBerserker", "§5Sentinelle", "§6Sauvage"];
const NATURE_DESC = ["te suit et attaque les monstres", "te suit et te défend", "chasse monstres et animaux",
  "attaque tous les mobs (sauf joueurs et villageois)", "garde l'endroit où elle est née", "devient hostile... même envers toi !"];
const VTYPES = ["§aVoiture §8(roule au sol)", "§bBateau §8(flotte sur l'eau)", "§dAvion §8(roule puis décolle)"];
const VTYPE_SHORT = ["Voiture", "Bateau", "Avion"];
const HP = [10, 20, 30, 45, 60, 80, 100, 130, 170, 220, 280, 350, 400];
const DMG = [2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22];
const BANNED = new Set(["minecraft:bedrock", "minecraft:barrier", "minecraft:command_block", "minecraft:chain_command_block",
  "minecraft:repeating_command_block", "minecraft:structure_block", "minecraft:end_portal_frame", "minecraft:portal",
  "minecraft:end_portal", "minecraft:end_gateway", "minecraft:spawner", "minecraft:mob_spawner", "minecraft:light_block",
  "minecraft:jigsaw", "minecraft:structure_void", "minecraft:allow", "minecraft:deny", "minecraft:border_block", "minecraft:fire",
  "minecraft:soul_fire", "minecraft:moving_block", "minecraft:piston_arm_collision", "minecraft:sticky_piston_arm_collision"]);
// végétation / décor : jamais aspirés automatiquement (seulement si tu les marques toi-même)
const VEG = /(short_grass|tall_grass|tallgrass|^minecraft:fern|large_fern|double_plant|flower|tulip|dandelion|poppy|orchid|allium|azure_bluet|oxeye|cornflower|lily_of_the_valley|wither_rose|torchflower|pink_petals|wildflowers|leaf_litter|sapling|deadbush|dead_bush|bush$|seagrass|^minecraft:kelp|vine|snow_layer|lichen|sugar_cane|reeds|sweet_berry|^minecraft:\w+_mushroom$|hanging_roots|spore_blossom|firefly)/;
// blocs accrochés : retirés en premier pour ne pas les faire tomber en double
const ATTACHED = /(torch|lantern|button|lever|sign|banner|door|carpet|rail|pressure_plate|ladder|candle|bell|chain|redstone_wire|repeater|comparator|tripwire|skull|head|flower_pot|frame|amethyst_cluster|bud|pointed_dripstone)/;
const SPECIAL_NAMES = { regen: "régénération", swift: "rapidité", tough: "résistance", fireproof: "insensible au feu",
  heavy: "inébranlable", boom: "explose à sa mort", light: "éclaire son maître", bouncy: "bondissante", wise: "donne de l'XP", strong: "force" };
// parties
const BODY = 0, LEG = 1, ARM = 2, WING = 3, TAIL = 4, HEAD = 5, SEAT = 6, WHEEL = 7, PROP = 8;
const PART_INFO = {
  [LEG]: ["JAMBES", "§e", "minecraft:basic_flame_particle"],
  [ARM]: ["BRAS", "§b", "minecraft:blue_flame_particle"],
  [WING]: ["AILES", "§d", "minecraft:endrod"],
  [TAIL]: ["QUEUE", "§6", "minecraft:heart_particle"],
  [WHEEL]: ["ROUES / BAS", "§e", "minecraft:basic_flame_particle"],
  [PROP]: ["HÉLICES", "§d", "minecraft:endrod"],
};
const N6 = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const N18 = [];
for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
  const m = Math.abs(dx) + Math.abs(dy) + Math.abs(dz);
  if (m === 1 || m === 2) N18.push([dx, dy, dz]);   // faces + arêtes (les blocs posés en diagonale comptent)
}

const nearest = (arr, v) => arr.reduce((bi, x, i) => (Math.abs(x - v) < Math.abs(arr[bi] - v) ? i : bi), 0);
const key = (l) => `${l.x},${l.y},${l.z}`;
const rad = (d) => d * Math.PI / 180;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const players = () => world.getAllPlayers();
const isBody = (e) => e && (e.typeId === CORE || e.typeId === VEH);
const sleep = (t) => new Promise((r) => system.runTimeout(r, t));

function safeSub(signal, fn) {
  try { if (signal?.subscribe) { signal.subscribe((ev) => { try { fn(ev); } catch (e) { console.warn("[Créations] " + e); } }); return true; } } catch { }
  return false;
}
function cmd(src, c) { try { if (src.runCommand) src.runCommand(c); else src.runCommandAsync(c); } catch { } }
function particle(dim, id, l) { try { dim.spawnParticle(id, l); } catch { } }
function tell(p, msg) { try { p.onScreenDisplay.setActionBar(msg); p.sendMessage(msg); } catch { } }
function heldId(p) {
  try { return p.getComponent("minecraft:inventory")?.container?.getItem(p.selectedSlotIndex)?.typeId; } catch { return undefined; }
}
function consumeSpark(p) {
  try {
    if (p.getGameMode() === "creative") return;
    const inv = p.getComponent("minecraft:inventory").container;
    for (const slot of [p.selectedSlotIndex, ...Array.from({ length: inv.size }, (_, i) => i)]) {
      const it = inv.getItem(slot);
      if (it?.typeId !== SPARK) continue;
      if (it.amount > 1) { it.amount--; inv.setItem(slot, it); } else inv.setItem(slot, undefined);
      return;
    }
  } catch { }
}
// Les menus échouent souvent juste après un clic ("UserBusy") : on réessaie pendant ~10 s au lieu d'abandonner.
async function showForm(p, form) {
  for (let i = 0; i < 40; i++) {
    let r;
    try { r = await form.show(p); } catch { return undefined; }
    if (!(r.canceled && r.cancelationReason === "UserBusy")) return r;
    await sleep(5);
    if (!p.isValid()) return undefined;
  }
  tell(p, "§cLe menu n'a pas pu s'ouvrir : ferme le chat ou l'inventaire puis réessaie.");
  return undefined;
}
// montre où se trouve le problème
function flash(dim, l) {
  let t = 0;
  const run = system.runInterval(() => {
    for (const [dx, dy, dz] of [[0.5, 1.1, 0.5], [0.5, 0.5, -0.1], [0.5, 0.5, 1.1], [-0.1, 0.5, 0.5], [1.1, 0.5, 0.5]])
      particle(dim, "minecraft:villager_angry", { x: l.x + dx, y: l.y + dy, z: l.z + dz });
    if (++t > 12) system.clearRun(run);
  }, 5);
}

// rotation de v autour de l'axe unitaire k (Rodrigues)
function rot(v, k, t) {
  const c = Math.cos(t), s = Math.sin(t), d = k.x * v.x + k.y * v.y + k.z * v.z;
  return {
    x: v.x * c + (k.y * v.z - k.z * v.y) * s + k.x * d * (1 - c),
    y: v.y * c + (k.z * v.x - k.x * v.z) * s + k.y * d * (1 - c),
    z: v.z * c + (k.x * v.y - k.y * v.x) * s + k.z * d * (1 - c),
  };
}
const frame = (yawDeg) => {
  const y = rad(yawDeg);
  return { F: { x: -Math.sin(y), y: 0, z: Math.cos(y) }, R: { x: Math.cos(y), y: 0, z: Math.sin(y) }, U: { x: 0, y: 1, z: 0 } };
};
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;

// =============================================================== SÉLECTION
// player.id -> { kind: "cr"|"veh", dim, head, mode, parts: Map(key -> {loc, part}), busy }
const sel = new Map();
const lastClick = new Map();   // player.id -> { k, t } (anti double-clic, par bloc)

function handleClick(p, block, itemStack, ev) {
  if (!p || p.typeId !== "minecraft:player" || !block) return;
  const item = itemStack?.typeId;
  if (item !== SPARK && item !== KEY) return;
  if (ev && ev.isFirstEvent === false) return;    // clic maintenu (versions récentes)
  const loc = { x: block.location.x, y: block.location.y, z: block.location.z };
  const k = key(loc);
  const now = system.currentTick;
  const lc = lastClick.get(p.id);
  // même bloc cliqué en boucle (clic maintenu sur mobile) : on ignore tant que le clic continue
  if (lc && lc.k === k && now - lc.t < 12) { lc.t = now; return; }
  lastClick.set(p.id, { k, t: now });

  const kind = item === KEY ? "veh" : "cr";
  let s = sel.get(p.id);
  if (!s || s.dim !== p.dimension.id || s.kind !== kind) {
    s = { kind, dim: p.dimension.id, head: undefined, mode: kind === "veh" ? WHEEL : LEG, parts: new Map(), busy: false };
    sel.set(p.id, s);
  }
  const headName = kind === "veh" ? "SIÈGE du conducteur" : "TÊTE";

  if (p.isSneaking) {
    if (!s.head) { tell(p, `§cClique d'abord (sans t'accroupir) sur le bloc ${headName}.`); return; }
    finalize(p, s); return;
  }
  if (!s.head) {
    s.head = loc;
    p.playSound("random.orb", { pitch: 1.4 });
    p.onScreenDisplay.setActionBar(kind === "veh"
      ? "§aSiège choisi ! §fClique les §eROUES§f (ou le fond de la coque). Reclique le siège pour le §bmenu§f."
      : "§aTête choisie ! §fClique les blocs des §eJAMBES§f. Reclique la tête pour le §bmenu§f (bras, ailes, queue...)");
    return;
  }
  if (k === key(s.head)) { system.run(() => partMenu(p, s)); return; }
  const cur = s.parts.get(k);
  if (cur && cur.part === s.mode) { s.parts.delete(k); p.playSound("random.click", { pitch: 0.7 }); }
  else { s.parts.set(k, { loc, part: s.mode }); p.playSound("random.click", { pitch: 1.3 }); }
  p.onScreenDisplay.setActionBar(statusLine(s));
}

function statusLine(s) {
  const c = {};
  for (const v of s.parts.values()) c[v.part] = (c[v.part] ?? 0) + 1;
  const [n, col] = PART_INFO[s.mode];
  if (s.kind === "veh") return `Mode : ${col}${n}§f | Roues/bas ${c[WHEEL] ?? 0} · Hélices ${c[PROP] ?? 0} §7(accroupi + clic = fabriquer)`;
  return `Mode : ${col}${n}§f | Jambes ${c[LEG] ?? 0} · Bras ${c[ARM] ?? 0} · Ailes ${c[WING] ?? 0} · Queue ${c[TAIL] ?? 0} §7(accroupi + clic = vie)`;
}

function partMenu(p, s) {
  const veh = s.kind === "veh";
  const modes = veh ? [WHEEL, PROP] : [LEG, ARM, WING, TAIL];
  const f = new ActionFormData().title(veh ? "Ton véhicule" : "Ta création")
    .body("Choisis quelle partie marquer, puis clique sur les blocs correspondants.\n\n" + statusLine(s));
  if (veh) {
    f.button("§eMarquer les ROUES / le BAS\n§8les blocs qui touchent le sol ou l'eau")
      .button("§dMarquer les HÉLICES\n§8elles tournent quand tu conduis")
      .button("§a§lFABRIQUER LE VÉHICULE");
  } else {
    f.button("§eMarquer les JAMBES\n§8elles marchent")
      .button("§bMarquer les BRAS\n§8ils frappent et balancent")
      .button("§dMarquer les AILES\n§8elles battent... et volent !")
      .button("§6Marquer la QUEUE\n§8elle remue")
      .button("§a§lDONNER VIE");
  }
  f.button("§cAnnuler");
  showForm(p, f).then((r) => {
    if (!r || r.canceled || r.selection === undefined) return;
    if (r.selection < modes.length) { s.mode = modes[r.selection]; p.onScreenDisplay.setActionBar(statusLine(s)); }
    else if (r.selection === modes.length) finalize(p, s);
    else { sel.delete(p.id); p.onScreenDisplay.setActionBar("§7Annulé."); }
  });
}

safeSub(world.afterEvents.playerInteractWithBlock, (ev) => handleClick(ev.player, ev.block, ev.itemStack, ev));
safeSub(world.afterEvents.itemUseOn, (ev) => handleClick(ev.source, ev.block, ev.itemStack, ev));
safeSub(world.afterEvents.itemUse, (ev) => {
  const p = ev.source, id = ev.itemStack?.typeId;
  if (id === STAFF) { staffUse(p); return; }
  if (id !== SPARK && id !== KEY) return;
  // clé : si on vise un véhicule/une création, on ouvre son menu
  if (id === KEY && !sel.get(p.id)?.head) { const c = lookedCreation(p, 8); if (c) { system.run(() => bodyMenu(p, c)); return; } }
  const hit = p.getBlockFromViewDirection({ maxDistance: 7, includeLiquidBlocks: false });
  if (hit?.block) handleClick(p, hit.block, ev.itemStack);
});

// marqueurs visuels + aide
system.runInterval(() => {
  for (const p of players()) {
    const s = sel.get(p.id);
    if (!s || !s.head) {
      const h = heldId(p);
      if (h === SPARK) p.onScreenDisplay.setActionBar("§eÉtincelle de vie :§f clic droit sur le bloc de §aTÊTE§f de ta construction");
      else if (h === KEY) p.onScreenDisplay.setActionBar("§eClé de véhicule :§f clic droit sur le §aSIÈGE§f de ton véhicule (ou vise un véhicule pour son menu)");
      continue;
    }
    if (p.dimension.id !== s.dim) continue;
    const dim = p.dimension;
    const mark = (l, id) => {
      for (const [dx, dy, dz] of [[0.5, 1.05, 0.5], [0.5, 0.5, -0.05], [0.5, 0.5, 1.05], [-0.05, 0.5, 0.5], [1.05, 0.5, 0.5]])
        particle(dim, id, { x: l.x + dx, y: l.y + dy, z: l.z + dz });
    };
    mark(s.head, "minecraft:villager_happy");
    for (const v of s.parts.values()) mark(v.loc, PART_INFO[v.part][2]);
  }
}, 10);

// =============================================================== LECTURE DE LA FORME
// Remplissage depuis la tête/le siège ET depuis chaque bloc marqué : un bloc que tu as marqué fait toujours partie
// de la construction (fini le "pas relié" à tort). Les blocs en diagonale (arêtes) sont aussi reliés.
function scan(dim, s) {
  const veh = s.kind === "veh";
  const bottomPart = veh ? WHEEL : LEG;
  const marked = [...s.parts.values()];
  const bottoms = marked.filter((v) => v.part === bottomPart).map((v) => v.loc);
  if (!bottoms.length) return { error: veh
    ? "Marque au moins un bloc du BAS (roues, ou fond de la coque) : c'est ce qui touche le sol ou l'eau."
    : "Choisis au moins un bloc de JAMBE : les jambes définissent où ta création touche le sol." };
  const minY = Math.min(...bottoms.map((l) => l.y));
  const markedKeys = new Set(marked.map((v) => key(v.loc)));
  markedKeys.add(key(s.head));
  const max = veh ? MAX_VEH_BLOCKS : MAX_BLOCKS;
  const seen = new Set();
  const queue = [];
  for (const l of [s.head, ...marked.map((v) => v.loc)]) { const k = key(l); if (!seen.has(k)) { seen.add(k); queue.push(l); } }
  const blocks = [];
  const box = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 };
  for (let qi = 0; qi < queue.length; qi++) {
    const l = queue[qi];
    const k = key(l);
    const isMarked = markedKeys.has(k);
    let b;
    try { b = dim.getBlock(l); } catch { }
    if (!b) { if (isMarked) return { error: "Un bloc marqué est trop loin (zone non chargée). Rapproche-toi !", at: l }; continue; }
    const id = b.typeId;
    if (b.isAir || b.isLiquid || BANNED.has(id)) {
      if (isMarked) return { error: `Ce bloc marqué ne peut pas être utilisé (${id.replace("minecraft:", "")}). Démarque-le.`, at: l };
      continue;
    }
    if (!isMarked) {
      if (l.y < minY) continue;                         // le sol sous les pieds/roues
      if (!veh && l.y === minY) continue;               // créature : au niveau des pieds, seulement les blocs marqués
      if (VEG.test(id)) continue;                       // herbe, fleurs, neige...
    }
    box.x0 = Math.min(box.x0, l.x); box.x1 = Math.max(box.x1, l.x);
    box.y0 = Math.min(box.y0, l.y); box.y1 = Math.max(box.y1, l.y);
    box.z0 = Math.min(box.z0, l.z); box.z1 = Math.max(box.z1, l.z);
    if (box.x1 - box.x0 >= MAX_SPAN || box.z1 - box.z0 >= MAX_SPAN || box.y1 - box.y0 >= MAX_SPAN)
      return { error: `Ta construction dépasse ${MAX_SPAN} blocs de large ou touche le décor (sol, arbre, mur...) ici. Isole-la !`, at: l };
    let states = {};
    try { states = b.permutation.getAllStates(); } catch { }
    const part = k === key(s.head) ? (veh ? SEAT : HEAD) : (s.parts.get(k)?.part ?? BODY);
    blocks.push({ loc: l, id, part, states });
    if (blocks.length > max) return { error: `Ta construction dépasse ${max} blocs ou touche le décor (sol, arbre, mur...) ici. Isole-la !`, at: l };
    for (const [dx, dy, dz] of N18) {
      const n = { x: l.x + dx, y: l.y + dy, z: l.z + dz };
      const nk = key(n);
      if (!seen.has(nk)) { seen.add(nk); queue.push(n); }
    }
  }
  if (!blocks.length) return { error: veh ? "Le siège n'est plus là !" : "La tête n'est plus là !", at: s.head };
  return { blocks, minY };
}

function scanOrFail(p, s) {
  const r = scan(p.dimension, s);
  if (r.error) {
    tell(p, "§c" + r.error);
    if (r.at) flash(p.dimension, r.at);
    p.playSound("note.bass", { pitch: 0.5 });
  }
  return r;
}

function finalize(p, s) {
  if (s.busy) return;
  const dim = p.dimension;
  const r = scanOrFail(p, s);
  if (r.error) return;
  s.busy = true;
  const veh = s.kind === "veh";
  const c = {};
  for (const b of r.blocks) c[b.part] = (c[b.part] ?? 0) + 1;
  let form;
  if (veh) {
    form = new ModalFormData()
      .title("Fabriquer ton véhicule")
      .textField(`§7${r.blocks.length} blocs — roues/bas ${c[WHEEL] ?? 0}, hélices ${c[PROP] ?? 0}\n§eL'AVANT du véhicule = la direction où tu regardes maintenant.\n\n§fNom du véhicule`, "ex : Bolide", `Véhicule de ${p.name}`)
      .dropdown("Type", VTYPES, (c[PROP] ?? 0) > 0 ? 2 : 0)
      .toggle("Verrouillé (toi seul peux conduire)", false);
  } else {
    form = new ModalFormData()
      .title("Donner vie à ta création")
      .textField(`§7${r.blocks.length} blocs — jambes ${c[LEG] ?? 0}, bras ${c[ARM] ?? 0}, ailes ${c[WING] ?? 0}, queue ${c[TAIL] ?? 0}\n\n§fNom de ta créature`, "ex : Titan", `Création de ${p.name}`)
      .dropdown("Nature", NATURES.map((n, i) => `${n}§r - ${NATURE_DESC[i]}`), 0);
  }
  const yawAtOpen = p.getRotation().y;
  system.run(() => {
    showForm(p, form).then((res) => {
      s.busy = false;
      if (!res || res.canceled || !res.formValues) return;
      const again = scan(dim, s);
      if (again.error || again.blocks.length !== r.blocks.length) { tell(p, "§cLa construction a changé pendant le menu, recommence !"); return; }
      sel.delete(p.id);
      if (veh) buildVehicle(p, dim, s, again, String(res.formValues[0] || `Véhicule de ${p.name}`), Number(res.formValues[1]), !!res.formValues[2], yawAtOpen);
      else birth(p, dim, s, again, String(res.formValues[0] || `Création de ${p.name}`), Number(res.formValues[1]));
    }).catch(() => { s.busy = false; });
  });
}

// =============================================================== BLOCS : retrait / restauration
function removeBlocks(dim, blocks) {
  const order = [...blocks].sort((a, b) => (ATTACHED.test(b.id) ? 1 : 0) - (ATTACHED.test(a.id) ? 1 : 0) || b.loc.y - a.loc.y);
  for (const b of order) {
    try {
      const bl = dim.getBlock(b.loc);
      if (!bl) continue;
      // coffres, tonneaux, fours... : on vide le contenu par terre au lieu de le perdre
      try {
        const inv = bl.getComponent("minecraft:inventory")?.container;
        if (inv) {
          for (let i = 0; i < inv.size; i++) { const it = inv.getItem(i); if (it) dim.spawnItem(it, { x: b.loc.x + 0.5, y: b.loc.y + 0.5, z: b.loc.z + 0.5 }); }
          inv.clearAll();
        }
      } catch { }
      bl.setType("minecraft:air");
    } catch { }
  }
}

// tourne les états d'orientation (escaliers, bûches, portes...) quand le corps a pivoté de q quarts de tour
const CARD = ["south", "west", "north", "east"];
function rotateStates(st, q) {
  if (!q) return st;
  const o = { ...st };
  const turn = (i) => (i + q) % 4;
  if (typeof o["minecraft:cardinal_direction"] === "string") {
    const i = CARD.indexOf(o["minecraft:cardinal_direction"]); if (i >= 0) o["minecraft:cardinal_direction"] = CARD[turn(i)];
  }
  if (typeof o["minecraft:facing_direction"] === "string") {
    const i = CARD.indexOf(o["minecraft:facing_direction"]); if (i >= 0) o["minecraft:facing_direction"] = CARD[turn(i)];
  }
  if (typeof o.weirdo_direction === "number") {   // 0 est, 1 ouest, 2 sud, 3 nord
    const toC = [3, 1, 0, 2], fromC = [2, 1, 3, 0];
    o.weirdo_direction = fromC[turn(toC[o.weirdo_direction])];
  }
  if (typeof o.direction === "number" && o.direction >= 0 && o.direction <= 3) o.direction = turn(o.direction);
  if (typeof o.facing_direction === "number" && o.facing_direction >= 2) {   // 2 nord, 3 sud, 4 ouest, 5 est
    const toC = { 2: 2, 3: 0, 4: 1, 5: 3 }, fromC = [3, 4, 2, 5];
    o.facing_direction = fromC[turn(toC[o.facing_direction])];
  }
  if (q % 2 && typeof o.pillar_axis === "string" && o.pillar_axis !== "y") o.pillar_axis = o.pillar_axis === "x" ? "z" : "x";
  return o;
}
function placeBlock(b, id, st) {
  try { if (st && Object.keys(st).length) { b.setPermutation(BlockPermutation.resolve(id, st)); return; } } catch { }
  b.setType(id);
}

// =============================================================== NAISSANCE (créature)
function birth(p, dim, s, r, name, nature) {
  p.playSound("beacon.activate");
  let t = 0;
  const run = system.runInterval(() => {
    t++;
    for (let i = 0; i < 8; i++) {
      const b = r.blocks[Math.floor(Math.random() * r.blocks.length)].loc;
      particle(dim, "minecraft:totem_particle", { x: b.x + Math.random(), y: b.y + Math.random(), z: b.z + Math.random() });
    }
    if (t % 5 === 0) try { p.playSound("note.chime", { pitch: 0.5 + t / 20 }); } catch { }
    if (t < 15) return;
    system.clearRun(run);
    // on revérifie : un joueur a pu casser un bloc pendant l'animation
    const again = scan(dim, s);
    if (again.error) { tell(p, "§c" + again.error); if (again.at) flash(dim, again.at); return; }
    try { bringToLife(p, dim, s, again, name, nature); } catch (e) { tell(p, "§cErreur : " + e); }
  }, 2);
}

function computeRig(blocks, cx, cy, cz, yaw0) {
  const { F, R } = frame(yaw0);
  const vox = blocks.map((b) => {
    const o = { x: b.loc.x + 0.5 - cx, y: b.loc.y + 0.5 - cy, z: b.loc.z + 0.5 - cz };
    return { b, o, part: b.part, hinge: { x: 0, y: 0, z: 0 }, axis: 0, ph: 0, sign: 1 };
  });
  const side = (o) => (dot(o, R) >= 0 ? 1 : -1);
  const cols = new Map();
  for (const v of vox.filter((v) => v.part === LEG)) {
    const k = `${v.b.loc.x},${v.b.loc.z}`;
    cols.set(k, Math.max(cols.get(k) ?? -99, v.o.y + 0.5));
  }
  for (const v of vox.filter((v) => v.part === LEG)) {
    v.hinge = { x: v.o.x, y: cols.get(`${v.b.loc.x},${v.b.loc.z}`), z: v.o.z };
    v.axis = 0;
    const fb = dot(v.o, F);
    v.ph = (side(v.o) > 0 ? 0 : Math.PI) + (Math.abs(fb) > 0.6 && fb > 0 ? Math.PI : 0);
  }
  for (const sd of [1, -1]) {
    const arms = vox.filter((v) => v.part === ARM && side(v.o) === sd);
    if (!arms.length) continue;
    const top = Math.max(...arms.map((v) => v.o.y)) + 0.5;
    const ax = arms.reduce((a, v) => a + v.o.x, 0) / arms.length, az = arms.reduce((a, v) => a + v.o.z, 0) / arms.length;
    for (const v of arms) { v.hinge = { x: ax, y: top, z: az }; v.axis = 0; v.ph = sd > 0 ? Math.PI : 0; }
  }
  for (const sd of [1, -1]) {
    const wings = vox.filter((v) => v.part === WING && side(v.o) === sd);
    if (!wings.length) continue;
    const inner = wings.reduce((a, v) => (Math.abs(dot(v.o, R)) < Math.abs(dot(a.o, R)) ? v : a));
    const h = { x: inner.o.x - R.x * 0.5 * sd, y: inner.o.y, z: inner.o.z - R.z * 0.5 * sd };
    for (const v of wings) { v.hinge = h; v.axis = 1; v.sign = sd; }
  }
  const tails = vox.filter((v) => v.part === TAIL);
  if (tails.length) {
    const base = tails.reduce((a, v) => (Math.hypot(v.o.x, v.o.z) < Math.hypot(a.o.x, a.o.z) ? v : a));
    for (const v of tails) { v.hinge = { ...base.o }; v.axis = 2; }
  }
  return vox;
}

function blockStats(blocks) {
  let hpSum = 0, tierSum = 0;
  const specials = new Set();
  for (const b of blocks) { const m = matOf(b.id); hpSum += 3 + m[1] * 3; tierSum += m[1]; if (m[2]) specials.add(m[2]); }
  return { hpI: nearest(HP, Math.min(400, hpSum)), tierAvg: tierSum / blocks.length, specials };
}

// crée les voxels (blocs animés) ; renvoie la liste pour le groupe
function spawnVoxels(dim, core, rig, nameOnHead) {
  const voxels = [];
  for (const v of rig) {
    let e;
    try { e = dim.spawnEntity(VOX, { x: v.b.loc.x + 0.5, y: v.b.loc.y, z: v.b.loc.z + 0.5 }); } catch { continue; }
    const a = [v.o.x, v.o.y, v.o.z, v.part, v.hinge.x, v.hinge.y, v.hinge.z, v.axis, v.ph, v.sign];
    try { e.setProperty("cr:tex", matOf(v.b.id)[0]); } catch { }
    e.setDynamicProperty("cr:core", core.id);
    e.setDynamicProperty("cr:rig", JSON.stringify(a));
    e.setDynamicProperty("cr:block", v.b.id);
    try { if (Object.keys(v.b.states).length) e.setDynamicProperty("cr:st", JSON.stringify(v.b.states)); } catch { }
    if (nameOnHead && v.part === HEAD) e.nameTag = nameOnHead;
    voxels.push(mkVox(e, a));
  }
  return voxels;
}

function bringToLife(p, dim, s, r, name, nature) {
  const xs = r.blocks.map((b) => b.loc.x), zs = r.blocks.map((b) => b.loc.z), ys = r.blocks.map((b) => b.loc.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs), maxY = Math.max(...ys);
  const cx = (minX + maxX + 1) / 2, cz = (minZ + maxZ + 1) / 2, cy = r.minY;
  let fx = s.head.x + 0.5 - cx, fz = s.head.z + 0.5 - cz;
  if (Math.hypot(fx, fz) < 0.6) { fx = p.location.x - cx; fz = p.location.z - cz; }
  const yaw0 = Math.atan2(-fx, fz) * 180 / Math.PI;

  const { hpI, tierAvg, specials } = blockStats(r.blocks);
  const n = r.blocks.length;
  const legs = r.blocks.filter((b) => b.part === LEG).length, wings = r.blocks.filter((b) => b.part === WING).length;
  const dmgI = nearest(DMG, 2 + tierAvg * 2 + n / 12 + r.blocks.filter((b) => b.part === ARM).length * 0.5);
  const spd = clamp(3 - Math.floor(n / 30) + (legs >= 2 ? 1 : 0) - (legs === 1 ? 1 : 0) + (specials.has("swift") ? 1 : 0), 0, 4);
  const height = maxY - cy + 1;
  const core3 = r.blocks.filter((b) => b.part !== WING && b.part !== TAIL);
  const bx = core3.map((b) => b.loc.x), bz = core3.map((b) => b.loc.z);
  const size = Math.max(Math.max(...bx) - Math.min(...bx) + 1, Math.max(...bz) - Math.min(...bz) + 1, height / 1.5);
  const box = size <= 1 ? 0 : size <= 2 ? 1 : size <= 3 ? 2 : size <= 4 ? 3 : 4;
  const seat = clamp(height, 1, 12);

  // 1) on crée d'abord le corps : si ça échoue, ta construction reste intacte et l'étincelle n'est pas perdue
  let core;
  try { core = dim.spawnEntity(CORE, { x: cx, y: cy, z: cz }); }
  catch (e) { tell(p, "§cImpossible de faire apparaître la créature ici (" + e + "). Ta construction est intacte."); return; }
  try { core.setRotation({ x: 0, y: yaw0 }); } catch { }
  for (const ev of [`cr:set_hp_${hpI}`, `cr:set_dmg_${dmgI}`, `cr:set_spd_${spd}`, `cr:set_box_${box}`, `cr:seat_${seat}`, `cr:nature_${nature}`]) {
    try { core.triggerEvent(ev); } catch { }
  }
  if (specials.has("fireproof")) try { core.triggerEvent("cr:fireproof"); } catch { }
  if (specials.has("heavy")) try { core.triggerEvent("cr:heavy"); } catch { }
  const meta = { yaw0, nature, name, spd, wings, n, specials: [...specials].join(","), stats: `${HP[hpI]} PV, ${DMG[dmgI]} dégâts, ${n} blocs` };
  for (const [k, v] of Object.entries(meta)) core.setDynamicProperty("cr:" + k, v);
  core.setDynamicProperty("cr:kills", 0);
  if (nature !== 5) {
    core.setDynamicProperty("cr:owner", p.id);
    system.runTimeout(() => { try { core.getComponent("minecraft:tameable")?.tame(p); } catch { } }, 2);
  }
  // 2) le corps animé
  const voxels = spawnVoxels(dim, core, computeRig(r.blocks, cx, cy, cz, yaw0), name);
  // 3) puis seulement on retire les blocs
  removeBlocks(dim, r.blocks);
  consumeSpark(p);
  groups.set(core.id, newGroup(core, voxels, { wake: 30 }));

  particle(dim, "minecraft:huge_explosion_emitter", { x: cx, y: cy + 1, z: cz });
  p.playSound("mob.irongolem.repair");
  const sp = [...specials].map((x) => SPECIAL_NAMES[x]).filter(Boolean).join(", ");
  p.sendMessage(`§a[Création]§r §e${name}§r — ${NATURES[nature]}§r — ${HP[hpI]} PV, ${DMG[dmgI]} dégâts, ${n} blocs${wings >= 2 ? " — §dpeut voler" : ""}${sp ? " — §b" + sp : ""}`);
  p.sendMessage("§7Astuce : clic droit sur ta créature pour la chevaucher. Le §eBâton du créateur§7 donne des ordres ou la retransforme en blocs.");
}

// =============================================================== VÉHICULES
function computeVehicleRig(blocks, cx, cy, cz, yaw0) {
  const vox = blocks.map((b) => ({ b, o: { x: b.loc.x + 0.5 - cx, y: b.loc.y + 0.5 - cy, z: b.loc.z + 0.5 - cz }, part: b.part,
    hinge: { x: 0, y: 0, z: 0 }, axis: 0, ph: 0, sign: 1 }));
  // regroupe roues / hélices en morceaux reliés : chaque morceau tourne autour de son centre
  const groupsOf = (part) => {
    const list = vox.filter((v) => v.part === part), byKey = new Map(list.map((v) => [key(v.b.loc), v])), done = new Set(), out = [];
    for (const v of list) {
      if (done.has(v)) continue;
      const comp = [], q = [v]; done.add(v);
      while (q.length) {
        const c = q.pop(); comp.push(c);
        for (const [dx, dy, dz] of N6) {
          const nb = byKey.get(key({ x: c.b.loc.x + dx, y: c.b.loc.y + dy, z: c.b.loc.z + dz }));
          if (nb && !done.has(nb)) { done.add(nb); q.push(nb); }
        }
      }
      out.push(comp);
    }
    return out;
  };
  const centroid = (c) => ({ x: c.reduce((a, v) => a + v.o.x, 0) / c.length, y: c.reduce((a, v) => a + v.o.y, 0) / c.length, z: c.reduce((a, v) => a + v.o.z, 0) / c.length });
  const bodyTop = Math.max(...vox.filter((v) => v.part !== PROP).map((v) => v.o.y));
  for (const comp of groupsOf(WHEEL)) { const h = centroid(comp); for (const v of comp) { v.hinge = h; v.axis = 0; } }
  for (const comp of groupsOf(PROP)) {
    const h = centroid(comp);
    const axis = h.y >= bodyTop - 0.01 ? 2 : 1;   // au-dessus du corps = rotor d'hélico, sinon hélice avant
    for (const v of comp) { v.hinge = h; v.axis = axis; }
  }
  return vox;
}

function buildVehicle(p, dim, s, r, name, vtype, locked, yawLook) {
  const yaw0 = Math.round(yawLook / 90) * 90;
  const xs = r.blocks.map((b) => b.loc.x), zs = r.blocks.map((b) => b.loc.z), ys = r.blocks.map((b) => b.loc.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs), maxY = Math.max(...ys);
  // le centre du véhicule est décalé d'un nombre entier de blocs par rapport au siège (max 3)
  const sx = s.head.x + 0.5, sz = s.head.z + 0.5;
  const ix = clamp(Math.round((minX + maxX + 1) / 2 - sx), -3, 3), iz = clamp(Math.round((minZ + maxZ + 1) / 2 - sz), -3, 3);
  const cx = sx + ix, cz = sz + iz, cy = r.minY;
  const { F, R } = frame(yaw0);
  const lx = Math.round(dot({ x: -ix, y: 0, z: -iz }, R)), lz = Math.round(dot({ x: -ix, y: 0, z: -iz }, F));
  const sh = clamp(s.head.y - cy, 0, 8);

  const { hpI, specials } = blockStats(r.blocks);
  const n = r.blocks.length;
  const wheels = r.blocks.filter((b) => b.part === WHEEL).length;
  const spd = clamp(3 - Math.floor(n / 70) + (specials.has("swift") ? 1 : 0) + (specials.has("strong") ? 1 : 0) + (wheels >= 4 ? 1 : 0) - (vtype === 1 ? 1 : 0), 0, 5);
  const cruise = vtype === 2 ? 0.55 + spd * 0.07 : 0.25 + spd * 0.05;
  const body = r.blocks.filter((b) => b.part !== PROP);
  const bx = body.map((b) => b.loc.x), bz = body.map((b) => b.loc.z);
  const foot = Math.min(Math.max(...bx) - Math.min(...bx) + 1, Math.max(...bz) - Math.min(...bz) + 1);
  const box = foot <= 1 ? 0 : foot <= 2 ? 1 : foot <= 3 ? 2 : foot <= 4 ? 3 : 4;

  let core;
  try { core = dim.spawnEntity(VEH, { x: cx, y: cy, z: cz }); }
  catch (e) { tell(p, "§cImpossible de créer le véhicule ici (" + e + "). Ta construction est intacte."); return; }
  try { core.setRotation({ x: 0, y: yaw0 }); } catch { }
  for (const ev of [`cr:set_hp_${hpI}`, `cr:set_spd_${spd}`, `cr:set_box_${box}`, `cr:vseat_${lx + 3}_${sh}_${lz + 3}`, `cr:vtype_${vtype}`]) {
    try { core.triggerEvent(ev); } catch { }
  }
  if (specials.has("fireproof")) try { core.triggerEvent("cr:fireproof"); } catch { }
  const meta = { yaw0, name, spd, vtype, cruise, n, locked, owner: p.id, stats: `${HP[hpI]} PV, vitesse ${spd + 1}/6, ${n} blocs` };
  for (const [k, v] of Object.entries(meta)) core.setDynamicProperty("cr:" + k, v);

  const voxels = spawnVoxels(dim, core, computeVehicleRig(r.blocks, cx, cy, cz, yaw0));
  removeBlocks(dim, r.blocks);
  groups.set(core.id, newGroup(core, voxels, { wake: 0 }));

  particle(dim, "minecraft:huge_explosion_emitter", { x: cx, y: cy + 1, z: cz });
  p.playSound("random.anvil_use", { pitch: 1.2 });
  const how = vtype === 2 ? "Roule vite et §eregarde vers le haut§f pour décoller ; en vol, il suit ton regard."
    : vtype === 1 ? "Mets-le sur l'eau : il avance là où tu regardes ; §eregarde tes pieds§f pour freiner."
    : "Avance avec les touches de déplacement, il tourne là où tu regardes.";
  p.sendMessage(`§a[Véhicule]§r §e${name}§r — ${VTYPE_SHORT[vtype]} — ${HP[hpI]} PV, vitesse ${spd + 1}/6, ${n} blocs${locked ? " — §6verrouillé" : ""}`);
  p.sendMessage(`§7Clic droit dessus pour monter. §f${how}§7 Accroupis-toi pour descendre. Clé de véhicule en main + clic droit dessus = menu.`);
}

// =============================================================== ANIMATION
const groups = new Map();
const mkVox = (e, a) => ({ e, ox: a[0], oy: a[1], oz: a[2], part: a[3], hx: a[4], hy: a[5], hz: a[6], axis: a[7], ph: a[8], sign: a[9] });
function newGroup(core, voxels, extra = {}) {
  const veh = core.typeId === VEH;
  return { core, voxels, veh, yaw0: core.getDynamicProperty("cr:yaw0") ?? 0, phase: 0, t: 0, last: { ...core.location },
    attack: 0, hurt: 0, wake: 0, wings: core.getDynamicProperty("cr:wings") ?? 0, n: core.getDynamicProperty("cr:n") ?? voxels.length,
    vtype: core.getDynamicProperty("cr:vtype") ?? 0, cruise: core.getDynamicProperty("cr:cruise") ?? 0.4,
    roll: 0, prop: 0, spin: 0, air: 0, stepSign: 1, ...extra };
}

// la zone autour est-elle chargée ? (sinon le corps est peut-être juste dans un chunk pas encore chargé)
function areaLoaded(dim, l, r) {
  try {
    for (const [dx, dz] of [[r, r], [-r, r], [r, -r], [-r, -r]]) if (!dim.getBlock({ x: l.x + dx, y: l.y, z: l.z + dz })) return false;
    return true;
  } catch { return false; }
}

function rebuild() {
  const found = new Map();
  for (const d of ["overworld", "nether", "the_end"]) {
    let vs = [];
    const dim = world.getDimension(d);
    try { vs = dim.getEntities({ type: VOX }); } catch { continue; }
    for (const v of vs) {
      try {
        if (v.getDynamicProperty("cr:debris")) continue;
        const cid = v.getDynamicProperty("cr:core");
        const core = cid ? world.getEntity(cid) : undefined;
        if (!core || !core.isValid()) {
          // avant : supprimé au bout de 10 s même si le corps était juste hors de portée -> créatures "cassées"
          if (!areaLoaded(dim, v.location, 32)) continue;
          const orphan = (v.getDynamicProperty("cr:orphan") ?? 0) + 1;
          v.setDynamicProperty("cr:orphan", orphan);
          if (orphan > 15) v.remove();
          continue;
        }
        if (v.getDynamicProperty("cr:orphan")) v.setDynamicProperty("cr:orphan", 0);
        let g = found.get(cid);
        if (!g) {
          const old = groups.get(cid);
          const keep = old ? { phase: old.phase, t: old.t, attack: old.attack, hurt: old.hurt, wake: old.wake, last: old.last,
            roll: old.roll, prop: old.prop, spin: old.spin, air: old.air, stepSign: old.stepSign } : {};
          g = newGroup(core, [], keep);
          found.set(cid, g);
        }
        let a = JSON.parse(v.getDynamicProperty("cr:rig") ?? "null");
        if (!a) { // ancienne version (v2) : uniquement jambes
          const [ox, oy, oz, leg] = JSON.parse(v.getDynamicProperty("cr:off") ?? "[0,0,0,0]");
          a = [ox, oy + 0.5, oz, leg ? LEG : BODY, ox, oy + 1, oz, 0, leg === 2 ? Math.PI : 0, 1];
        }
        g.voxels.push(mkVox(v, a));
      } catch { }
    }
  }
  groups.clear();
  for (const [k, g] of found) groups.set(k, g);
}
system.runInterval(rebuild, 40);
system.runTimeout(rebuild, 5);

function isOnGround(e) { try { return e.isOnGround ?? true; } catch { return true; } }
function riderOf(c) { try { return c.getComponent("minecraft:rideable")?.getRiders()?.[0]; } catch { return undefined; } }

system.runInterval(() => {
  for (const [cid, g] of groups) {
    const c = g.core;
    if (!c.isValid()) { groups.delete(cid); continue; }
    try { tickGroup(g); } catch { }
  }
}, 1);

function tickGroup(g) {
  const c = g.core;
  const loc = c.location;
  const yaw = c.getRotation().y;
  const d = rad(yaw - g.yaw0), cs = Math.cos(d), sn = Math.sin(d);
  const { F, R, U } = frame(g.yaw0);
  const axes = [R, F, U];
  const dx = loc.x - g.last.x, dz = loc.z - g.last.z;
  const moved = Math.hypot(dx, dz);
  const airborne = Math.abs(loc.y - g.last.y) > 0.02;
  g.last = { ...loc };
  g.t++;
  if (g.hurt > 0) g.hurt--;
  if (g.wake > 0) g.wake--;
  const walk = Math.min(1, moved * 6);
  let bob = 0, flying = false, atk = 0, headYaw = yaw;

  if (g.veh) {
    const fNow = frame(yaw).F;
    g.roll += (dx * fNow.x + dz * fNow.z) * 2;                     // roues
    const rider = riderOf(c);
    g.spin = rider || moved > 0.05 ? Math.min(g.spin + 0.02, 0.7) : Math.max(g.spin - 0.01, 0);
    g.prop += g.spin;                                                // hélices
    bob = Math.sin(g.t * 0.9) * 0.025 * walk + (g.spin > 0 ? Math.sin(g.t * 1.7) * 0.008 : 0);   // moteur
    if (walk > 0.4 && g.t % 4 === 0 && g.vtype !== 1) particle(c.dimension, "minecraft:basic_smoke_particle", { x: loc.x - fNow.x * 1.2, y: loc.y + 0.3, z: loc.z - fNow.z * 1.2 });
    vehicleControl(g, rider, moved);
  } else {
    g.phase += Math.min(moved, 0.6) * 2.2;
    flying = g.wings >= 2 && (airborne || !isOnGround(c));
    bob = Math.abs(Math.sin(g.phase)) * 0.08 * walk + Math.sin(g.t * 0.08) * 0.02;
    if (g.attack > 0) g.attack--;
    atk = g.attack > 0 ? Math.sin((1 - g.attack / 10) * Math.PI) : 0;
    const stepNow = Math.sign(Math.sin(g.phase));
    if (stepNow !== g.stepSign && walk > 0.3 && !flying) {
      g.stepSign = stepNow;
      if (g.n >= 25) {
        particle(c.dimension, "minecraft:basic_smoke_particle", { x: loc.x, y: loc.y + 0.1, z: loc.z });
        for (const pl of players()) {
          if (pl.dimension.id === c.dimension.id && Math.hypot(pl.location.x - loc.x, pl.location.z - loc.z) < 14)
            cmd(pl, `camerashake add @s ${Math.min(0.6, g.n / 250).toFixed(2)} 0.25 positional`);
        }
      }
    }
    try { const v = c.getViewDirection(); headYaw = Math.atan2(-v.x, v.z) * 180 / Math.PI; } catch { }
  }
  const lunge = atk * 0.35;
  for (const v of g.voxels) {
    if (!v.e.isValid()) continue;
    let p = { x: v.ox, y: v.oy, z: v.oz };
    let ang = 0;
    switch (v.part) {
      case LEG: ang = flying ? 0.5 : Math.sin(g.phase + v.ph) * 0.55 * walk; break;
      case ARM: ang = Math.sin(g.phase + v.ph) * 0.45 * walk - atk * 1.4; break;
      case WING: {
        const speed = flying ? 0.45 : 0.12, amp = flying ? 0.75 : 0.18;
        ang = v.sign * (0.1 + Math.sin(g.t * speed) * amp); break;
      }
      case TAIL: ang = Math.sin(g.t * (0.1 + walk * 0.2)) * (0.3 + walk * 0.2); break;
      case WHEEL: ang = g.roll; break;
      case PROP: ang = g.prop; break;
    }
    if (ang) {
      const h = { x: v.hx, y: v.hy, z: v.hz };
      const q = rot({ x: p.x - h.x, y: p.y - h.y, z: p.z - h.z }, axes[v.axis] ?? R, ang);
      p = { x: h.x + q.x, y: h.y + q.y, z: h.z + q.z };
    }
    if (v.part !== LEG && v.part !== WHEEL) p.y += bob;
    p.x += F.x * lunge; p.z += F.z * lunge;
    if (g.hurt > 0 || g.wake > 0) {
      const j = g.wake > 0 ? 0.06 : 0.1;
      p.x += (Math.random() - 0.5) * j; p.y += (Math.random() - 0.5) * j; p.z += (Math.random() - 0.5) * j;
    }
    const wx = p.x * cs - p.z * sn, wz = p.x * sn + p.z * cs;
    const ry = v.part === HEAD ? headYaw : yaw;
    try { v.e.teleport({ x: loc.x + wx, y: loc.y + p.y - 0.5, z: loc.z + wz }, { rotation: { x: 0, y: ry } }); } catch { }
  }
  if (g.veh) return;
  if (g.wake === 1) {
    const nat = c.getDynamicProperty("cr:nature") ?? 0;
    for (const v of g.voxels) if (v.part === HEAD) try { v.e.setProperty("cr:eye", nat + 1); } catch { }
    try { c.dimension.playSound(g.n >= 40 ? "mob.enderdragon.growl" : "mob.irongolem.repair", loc, { volume: 0.8, pitch: g.n >= 40 ? 0.7 : 1.2 }); } catch { }
  }
  flightControl(g, flying);
}

// vol : quand on chevauche une création ailée, regarder vers le haut = monter
function flightControl(g, flying) {
  if (g.wings < 2) return;
  const rider = riderOf(g.core);
  if (!rider || rider.typeId !== "minecraft:player") return;
  const pitch = rider.getRotation().x;
  const v = rider.getViewDirection();
  try {
    g.core.addEffect("slow_falling", 10, { amplifier: 0, showParticles: false });
    if (pitch < -12) g.core.applyImpulse({ x: v.x * 0.06, y: 0.11, z: v.z * 0.06 });
    else if (flying) g.core.applyImpulse({ x: v.x * 0.07, y: pitch > 30 ? -0.04 : 0, z: v.z * 0.07 });
  } catch { }
  if (g.t % 40 === 0) rider.onScreenDisplay.setActionBar("§dVol :§f regarde vers le §ehaut§f pour monter, vers le §ebas§f pour descendre");
}

function turnToward(c, yaw, maxStep) {
  const cur = c.getRotation().y;
  let dlt = ((yaw - cur + 540) % 360) - 180;
  dlt = clamp(dlt, -maxStep, maxStep);
  try { c.setRotation({ x: 0, y: cur + dlt }); } catch { }
}

// conduite : voiture = contrôle natif (comme un cheval) ; bateau et avion = poussée vers le regard
function vehicleControl(g, rider, moved) {
  if (!rider || rider.typeId !== "minecraft:player") { g.air = 0; return; }
  const c = g.core;
  const pitch = rider.getRotation().x, ryaw = rider.getRotation().y;
  const v = rider.getViewDirection();
  const hl = Math.hypot(v.x, v.z) || 1;
  let vel = { x: 0, y: 0, z: 0 };
  try { vel = c.getVelocity(); } catch { }
  try {
    if (g.vtype === 1) {        // BATEAU
      let wet = false;
      try { wet = c.isInWater || !!c.dimension.getBlock({ x: c.location.x, y: c.location.y - 0.2, z: c.location.z })?.typeId.includes("water"); } catch { }
      if (wet) {
        const t = pitch > 50 ? 0 : g.cruise;
        c.applyImpulse({ x: (v.x / hl * t - vel.x) * 0.15, y: 0, z: (v.z / hl * t - vel.z) * 0.15 });
        turnToward(c, ryaw, 5);
      }
    } else if (g.vtype === 2) { // AVION
      if (isOnGround(c)) {
        g.air = 0;
        if (pitch < -15 && moved > 0.12) c.applyImpulse({ x: v.x * 0.1, y: 0.45, z: v.z * 0.1 });   // décollage
      } else {
        g.air++;
        c.addEffect("slow_falling", 10, { amplifier: 0, showParticles: false });
        if (g.air > 3) {
          const t = g.cruise;
          c.applyImpulse({ x: (v.x * t - vel.x) * 0.12, y: (v.y * t * 0.8 - vel.y) * 0.12, z: (v.z * t - vel.z) * 0.12 });
          turnToward(c, ryaw, 4);
        }
      }
    }
  } catch { }
  if (g.t % 10 === 0) {
    const kmh = Math.round(moved * 20 * 3.6);
    const tip = g.vtype === 2 ? (isOnGround(c) ? "prends de la vitesse puis §eregarde en haut§f pour décoller" : "§eregarde en bas§f pour descendre/atterrir")
      : g.vtype === 1 ? "§eregarde tes pieds§f pour freiner" : "accroupis-toi pour descendre";
    try { rider.onScreenDisplay.setActionBar(`§b${c.getDynamicProperty("cr:name") ?? "Véhicule"}§f — ${kmh} km/h — ${tip}`); } catch { }
  }
}

// =============================================================== MENUS (bâton / clé)
function coreOf(e) {
  if (!e) return undefined;
  if (isBody(e)) return e;
  if (e.typeId !== VOX) return undefined;
  const cid = e.getDynamicProperty("cr:core");
  return cid ? world.getEntity(cid) : undefined;
}
function lookedCreation(p, dist = 24) {
  try {
    for (const h of p.getEntitiesFromViewDirection({ maxDistance: dist })) { const c = coreOf(h.entity); if (c?.isValid()) return c; }
  } catch { }
  return undefined;
}

function staffUse(p) {
  const c = lookedCreation(p);
  if (!c) { p.onScreenDisplay.setActionBar("§7Vise une de tes créations (ou un véhicule) avec le bâton."); return; }
  system.run(() => bodyMenu(p, c));
}
function bodyMenu(p, c) { if (c.typeId === VEH) vehicleMenu(p, c); else creatureMenu(p, c); }

function canUse(p, c) {
  const owner = c.getDynamicProperty("cr:owner");
  if (c.typeId === VEH) return !c.getDynamicProperty("cr:locked") || !owner || owner === p.id;
  return !owner || owner === p.id;
}

function creatureMenu(p, c) {
  const owner = c.getDynamicProperty("cr:owner");
  if (owner && owner !== p.id) { p.onScreenDisplay.setActionBar("§cCette création ne t'appartient pas."); return; }
  const name = c.getDynamicProperty("cr:name"), nat = c.getDynamicProperty("cr:nature") ?? 0;
  const frozen = c.getDynamicProperty("cr:frozen") === true;
  const hp = c.getComponent("minecraft:health");
  const f = new ActionFormData().title(String(name))
    .body(`${NATURES[nat]}§r\n${c.getDynamicProperty("cr:stats")}\nPV : ${Math.ceil(hp?.currentValue ?? 0)}/${hp?.effectiveMax ?? "?"}\nVictimes : ${c.getDynamicProperty("cr:kills") ?? 0}`)
    .button("§2Monter dessus" + ((c.getDynamicProperty("cr:wings") ?? 0) >= 2 ? " §d(vol !)" : ""))
    .button(frozen ? "§aReprendre (suivre)" : "§6Rester ici")
    .button("§9Changer de nature")
    .button("§eRenommer")
    .button("§cRedevenir des blocs");
  showForm(p, f).then((r) => {
    if (!r || r.canceled || r.selection === undefined || !c.isValid()) return;
    switch (r.selection) {
      case 0: mount(p, c); break;
      case 1: {
        c.setDynamicProperty("cr:frozen", !frozen);
        if (!frozen) c.triggerEvent("cr:freeze");
        else { c.triggerEvent("cr:unfreeze"); c.triggerEvent(`cr:set_spd_${c.getDynamicProperty("cr:spd") ?? 2}`); }
        p.onScreenDisplay.setActionBar(frozen ? "§aTa création se remet en route." : "§6Ta création reste ici.");
        break;
      }
      case 2: {
        const nf = new ActionFormData().title("Nouvelle nature");
        NATURES.forEach((n, i) => nf.button(`${n}\n§8${NATURE_DESC[i]}`));
        showForm(p, nf).then((rr) => {
          if (!rr || rr.canceled || rr.selection === undefined || !c.isValid()) return;
          const k = rr.selection;
          c.triggerEvent(`cr:nature_${k}`);
          c.setDynamicProperty("cr:nature", k);
          if (k !== 5) { c.setDynamicProperty("cr:owner", p.id); system.runTimeout(() => { try { c.getComponent("minecraft:tameable")?.tame(p); } catch { } }, 2); }
          else c.setDynamicProperty("cr:owner", undefined);
          for (const v of groups.get(c.id)?.voxels ?? []) if (v.part === HEAD) try { v.e.setProperty("cr:eye", k + 1); } catch { }
          p.sendMessage(`§a${name}§r est maintenant ${NATURES[k]}§r.`);
        });
        break;
      }
      case 3: rename(p, c, name, true); break;
      case 4: dismantle(p, c); break;
    }
  });
}

function vehicleMenu(p, c) {
  const owner = c.getDynamicProperty("cr:owner");
  const mine = !owner || owner === p.id;
  const name = c.getDynamicProperty("cr:name") ?? "Véhicule", vt = c.getDynamicProperty("cr:vtype") ?? 0;
  const locked = c.getDynamicProperty("cr:locked") === true;
  const hp = c.getComponent("minecraft:health");
  const f = new ActionFormData().title(String(name))
    .body(`${VTYPES[vt]}§r\n${c.getDynamicProperty("cr:stats")}\nPV : ${Math.ceil(hp?.currentValue ?? 0)}/${hp?.effectiveMax ?? "?"}\n${locked ? "§6Verrouillé" : "§aOuvert à tous"}`)
    .button("§2Conduire");
  if (mine) f.button(locked ? "§aDéverrouiller" : "§6Verrouiller").button("§9Changer de type").button("§eRenommer").button("§cRedevenir des blocs");
  showForm(p, f).then((r) => {
    if (!r || r.canceled || r.selection === undefined || !c.isValid()) return;
    switch (r.selection) {
      case 0: mount(p, c); break;
      case 1: c.setDynamicProperty("cr:locked", !locked); p.onScreenDisplay.setActionBar(locked ? "§aTout le monde peut conduire." : "§6Toi seul peux conduire."); break;
      case 2: {
        const tf = new ActionFormData().title("Type de véhicule");
        VTYPES.forEach((t) => tf.button(t));
        showForm(p, tf).then((rr) => {
          if (!rr || rr.canceled || rr.selection === undefined || !c.isValid()) return;
          c.triggerEvent(`cr:vtype_${rr.selection}`);
          c.setDynamicProperty("cr:vtype", rr.selection);
          const spd = c.getDynamicProperty("cr:spd") ?? 2;
          c.setDynamicProperty("cr:cruise", rr.selection === 2 ? 0.55 + spd * 0.07 : 0.25 + spd * 0.05);
          const g = groups.get(c.id);
          if (g) { g.vtype = rr.selection; g.cruise = c.getDynamicProperty("cr:cruise"); }
          p.sendMessage(`§a${name}§r est maintenant : ${VTYPES[rr.selection]}`);
        });
        break;
      }
      case 3: rename(p, c, name, false); break;
      case 4: dismantle(p, c); break;
    }
  });
}

function rename(p, c, name, onHead) {
  showForm(p, new ModalFormData().title("Renommer").textField("Nouveau nom", "ex : Titan", String(name))).then((rr) => {
    if (!rr || rr.canceled || !rr.formValues || !c.isValid()) return;
    const nn = String(rr.formValues[0] || name);
    c.setDynamicProperty("cr:name", nn);
    if (onHead) for (const v of groups.get(c.id)?.voxels ?? []) if (v.part === HEAD) v.e.nameTag = nn;
  });
}

function mount(p, c) {
  if (!canUse(p, c)) { p.onScreenDisplay.setActionBar(c.typeId === VEH ? "§cCe véhicule est verrouillé par son propriétaire." : "§cCette création ne t'appartient pas."); return; }
  if (riderOf(c)) { p.onScreenDisplay.setActionBar("§cQuelqu'un est déjà aux commandes."); return; }
  let ok = false;
  try { ok = c.getComponent("minecraft:rideable")?.addRider(p) ?? false; } catch { }
  if (!ok) { p.onScreenDisplay.setActionBar("§cImpossible de monter (place libre au-dessus ?)."); return; }
  p.onScreenDisplay.setActionBar(c.typeId === VEH ? "§aAux commandes ! §fAccroupis-toi pour descendre." : "§aEn selle ! §fAvance avec les touches de déplacement, accroupis-toi pour descendre.");
}

// clic droit sur un bloc de la créature / du véhicule = monter ; avec bâton ou clé = menu
safeSub(world.beforeEvents.playerInteractWithEntity, (ev) => {
  const p = ev.player, t = ev.target;
  if (!t || (t.typeId !== VOX && !isBody(t))) return;
  const c = coreOf(t);
  if (!c?.isValid()) return;
  const held = ev.itemStack?.typeId;
  if (held === STAFF || held === KEY) { ev.cancel = true; system.run(() => bodyMenu(p, c)); return; }
  if (held === SPARK) { ev.cancel = true; return; }
  if (t.typeId === VOX) { ev.cancel = true; system.run(() => mount(p, c)); return; }
  if (!canUse(p, c)) { ev.cancel = true; system.run(() => mount(p, c)); }   // affiche la raison du refus
});

function dismantle(p, c) {
  const g = groups.get(c.id);
  if (!g) return;
  for (const r of c.getComponent("minecraft:rideable")?.getRiders() ?? []) try { c.getComponent("minecraft:rideable").ejectRider(r); } catch { }
  const dim = c.dimension, loc = c.location;
  const snap = Math.round((c.getRotation().y - g.yaw0) / 90) * 90;
  const q = ((Math.round(snap / 90) % 4) + 4) % 4;
  const cs = Math.round(Math.cos(rad(snap))), sn = Math.round(Math.sin(rad(snap)));
  const base = { x: Math.floor(loc.x) + 0.5, y: Math.round(loc.y), z: Math.floor(loc.z) + 0.5 };
  for (const v of g.voxels) {
    if (!v.e.isValid()) continue;
    const id = v.e.getDynamicProperty("cr:block") ?? "minecraft:cobblestone";
    let st;
    try { st = rotateStates(JSON.parse(v.e.getDynamicProperty("cr:st") ?? "{}"), q); } catch { st = {}; }
    const x = v.ox * cs - v.oz * sn, z = v.ox * sn + v.oz * cs;
    const bl = { x: Math.floor(base.x + x), y: Math.floor(base.y + v.oy), z: Math.floor(base.z + z) };
    try {
      const b = dim.getBlock(bl);
      if (b && (b.isAir || b.isLiquid || VEG.test(b.typeId))) placeBlock(b, id, st); else dim.spawnItem(new ItemStack(id, 1), v.e.location);
    } catch { try { dim.spawnItem(new ItemStack(id, 1), v.e.location); } catch { } }
    particle(dim, "minecraft:villager_happy", v.e.location);
    v.e.remove();
  }
  groups.delete(c.id);
  c.remove();
  p.playSound("random.anvil_land", { pitch: 1.5 });
  p.onScreenDisplay.setActionBar(g.veh ? "§eTon véhicule est redevenu une construction. Reprends ta clé pour le refabriquer !"
    : "§eTa création est redevenue une construction. Reprends ton étincelle pour la réveiller !");
}

// =============================================================== COMBAT, DÉGÂTS, MORT
safeSub(world.afterEvents.entityHitEntity, ({ damagingEntity: a }) => {
  if (a?.typeId === CORE) { const g = groups.get(a.id); if (g) g.attack = 10; }
});

safeSub(world.afterEvents.entityHurt, ({ hurtEntity: e, damageSource, damage }) => {
  if (e.typeId !== VOX && !isBody(e)) return;
  const core = coreOf(e);
  const src = damageSource.damagingEntity;
  if (e.typeId === VOX) { try { const h = e.getComponent("minecraft:health"); h.setCurrentValue(h.effectiveMax); } catch { } }
  if (!core?.isValid()) return;
  // le conducteur/cavalier ne s'abîme pas lui-même ; le propriétaire voit les infos au lieu de taper
  const isOwner = src?.typeId === "minecraft:player" && core.getDynamicProperty("cr:owner") === src.id;
  const isRider = src && riderOf(core)?.id === src.id;
  if (isOwner || isRider) {
    const h = core.getComponent("minecraft:health");
    if (isBody(e)) try { h.setCurrentValue(Math.min(h.effectiveMax, h.currentValue + damage)); } catch { }
    if (src.typeId === "minecraft:player") {
      const label = core.typeId === VEH ? VTYPE_SHORT[core.getDynamicProperty("cr:vtype") ?? 0] : NATURES[core.getDynamicProperty("cr:nature") ?? 0];
      src.onScreenDisplay.setActionBar(`§e${core.getDynamicProperty("cr:name")}§r — ${label}§r — PV ${Math.ceil(h.currentValue)}/${h.effectiveMax} — ${core.getDynamicProperty("cr:stats")}`);
    }
    return;
  }
  const g = groups.get(core.id);
  if (g) g.hurt = 6;
  if (e.typeId === VOX && src?.id !== core.id) {
    try { core.applyDamage(damage, { cause: damageSource.cause, damagingEntity: src }); } catch { try { core.applyDamage(damage); } catch { } }
  }
});

safeSub(world.afterEvents.entityDie, ({ deadEntity: e, damageSource }) => {
  const k = damageSource?.damagingEntity;
  if (k?.typeId === CORE && e.typeId !== VOX) { try { k.setDynamicProperty("cr:kills", (k.getDynamicProperty("cr:kills") ?? 0) + 1); } catch { } }
  if (!isBody(e)) return;
  let id, loc, dim, sp, owner, name, veh;
  try {
    id = e.id; loc = e.location; dim = e.dimension; veh = e.typeId === VEH;
    sp = (e.getDynamicProperty("cr:specials") ?? "").split(",");
    owner = e.getDynamicProperty("cr:owner"); name = e.getDynamicProperty("cr:name");
  } catch { return; }
  const g = groups.get(id);
  let vs = g?.voxels.map((v) => v.e) ?? [];
  if (!vs.length) { try { vs = dim.getEntities({ type: VOX, location: loc, maxDistance: 32 }).filter((v) => v.getDynamicProperty("cr:core") === id); } catch { } }
  groups.delete(id);
  explodeDebris(dim, loc, vs, sp.includes("boom"));
  if (owner) players().find((x) => x.id === owner)?.sendMessage(veh ? `§c${name} a été détruit...` : `§c${name} est retombée en morceaux...`);
});

function explodeDebris(dim, center, vs, boom) {
  const parts = vs.filter((v) => v.isValid()).map((v) => {
    const l = v.location;
    const dx = l.x - center.x, dz = l.z - center.z, d = Math.max(0.3, Math.hypot(dx, dz));
    try { v.setDynamicProperty("cr:debris", true); } catch { }
    return { v, p: { ...l }, vel: { x: dx / d * (0.15 + Math.random() * 0.25), y: 0.35 + Math.random() * 0.35, z: dz / d * (0.15 + Math.random() * 0.25) },
      yaw: Math.random() * 360, spin: (Math.random() - 0.5) * 40 };
  });
  if (boom) { try { dim.createExplosion(center, 4, { breaksBlocks: true }); } catch { } }
  else { try { dim.playSound("random.explode", center, { volume: 0.6, pitch: 1.4 }); } catch { } }
  let t = 0;
  const run = system.runInterval(() => {
    t++;
    for (const d of parts) {
      if (!d.v.isValid()) continue;
      d.vel.y -= 0.06;
      d.p = { x: d.p.x + d.vel.x, y: Math.max(center.y - 2, d.p.y + d.vel.y), z: d.p.z + d.vel.z };
      d.yaw += d.spin;
      try { d.v.teleport(d.p, { rotation: { x: 0, y: d.yaw } }); } catch { }
    }
    if (t < 30) return;
    system.clearRun(run);
    for (const d of parts) {
      if (!d.v.isValid()) continue;
      particle(dim, "minecraft:large_explosion", d.p);
      if (!boom && Math.random() < 0.5) { try { dim.spawnItem(new ItemStack(d.v.getDynamicProperty("cr:block") ?? "minecraft:cobblestone", 1), d.p); } catch { } }
      try { d.v.remove(); } catch { }
    }
  }, 1);
}

// =============================================================== POUVOIRS SPÉCIAUX
system.runInterval(() => {
  for (const g of groups.values()) {
    const c = g.core;
    if (g.veh || !c.isValid()) continue;
    const sp = (c.getDynamicProperty("cr:specials") ?? "").split(",");
    const opt = { amplifier: 0, showParticles: false };
    try {
      if (sp.includes("regen")) c.addEffect("regeneration", 60, opt);
      if (sp.includes("tough")) c.addEffect("resistance", 60, opt);
      if (sp.includes("strong")) c.addEffect("strength", 60, opt);
      if (sp.includes("bouncy")) c.addEffect("jump_boost", 60, { amplifier: 2, showParticles: false });
      const owner = c.getDynamicProperty("cr:owner");
      if (owner && (sp.includes("light") || sp.includes("wise"))) {
        const pl = players().find((x) => x.id === owner && x.dimension.id === c.dimension.id);
        if (pl && Math.hypot(pl.location.x - c.location.x, pl.location.z - c.location.z) < 10) {
          if (sp.includes("light")) pl.addEffect("night_vision", 300, opt);
          if (sp.includes("wise") && Math.random() < 0.1) pl.addExperience(1);
        }
      }
    } catch { }
  }
}, 40);

safeSub(world.afterEvents.playerSpawn, ({ player, initialSpawn }) => {
  if (!initialSpawn) return;
  player.sendMessage("§a[Créations vivantes v4]§r §eÉtincelle de vie§r : clic TÊTE → clic JAMBES → reclique la tête (bras/ailes/queue) → accroupi + clic = VIE !");
  player.sendMessage("§a[Véhicules]§r §eClé de véhicule§r : clic SIÈGE → clic ROUES/BAS → reclique le siège (hélices) → accroupi + clic = FABRIQUER !");
});
