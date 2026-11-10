// Créations vivantes v5 — créatures ET véhicules en blocs, jusqu'à 64 × 64 × 64 blocs : construis, anime, chevauche, conduis, fais voler
import { world, system, ItemStack, BlockPermutation } from "@minecraft/server";
import { ModalFormData, ActionFormData } from "@minecraft/server-ui";
import { matOf } from "./materials.js";

const CORE = "cr:core", VOX = "cr:voxel", VEH = "cr:vehicle";
const SPARK = "cr:life_spark", STAFF = "cr:creator_staff", KEY = "cr:vehicle_key";
// Taille maximale : 64 blocs de long, de large ET de haut. Il n'y a plus de limite au nombre de blocs :
// tous les blocs de la construction sont gardés (et rendus à l'identique quand elle redevient des blocs).
// Pour que le jeu reste fluide, les blocs pareils sont regroupés en gros cubes animés et l'intérieur caché n'est pas affiché.
const MAX_SPAN = 64;
const MAX_VOX = 2000, MAX_VEH_VOX = 1500;      // nombre maximal de morceaux animés (entités) par création
const MARK_SHOW = 300;                         // marqueurs affichés au plus (les autres sont gardés mais pas dessinés)
const NATURES = ["§9Gardien", "§aCompagnon", "§eChasseur", "§cBerserker", "§5Sentinelle", "§6Sauvage"];
const NATURE_DESC = ["te suit et attaque les monstres", "te suit et te défend", "chasse monstres et animaux",
  "attaque tous les mobs (sauf joueurs et villageois)", "garde l'endroit où elle est née", "devient hostile... même envers toi !"];
const VTYPES = ["§aVoiture §8(roule au sol)", "§bBateau §8(flotte sur l'eau)", "§dAvion §8(roule puis décolle)"];
const VTYPE_SHORT = ["Voiture", "Bateau", "Avion"];
const HP = [10, 20, 30, 45, 60, 80, 100, 130, 170, 220, 280, 350, 400, 500, 650, 800, 1000];
const DMG = [2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 22];
const BANNED = new Set(["minecraft:bedrock", "minecraft:barrier", "minecraft:command_block", "minecraft:chain_command_block",
  "minecraft:repeating_command_block", "minecraft:structure_block", "minecraft:end_portal_frame", "minecraft:portal",
  "minecraft:end_portal", "minecraft:end_gateway", "minecraft:spawner", "minecraft:mob_spawner", "minecraft:light_block",
  "minecraft:jigsaw", "minecraft:structure_void", "minecraft:allow", "minecraft:deny", "minecraft:border_block", "minecraft:fire",
  "minecraft:soul_fire", "minecraft:moving_block", "minecraft:piston_arm_collision", "minecraft:sticky_piston_arm_collision"]);
// végétation / décor : jamais aspirés automatiquement (seulement si tu les marques toi-même)
const VEG = /(short_grass|tall_grass|tallgrass|^minecraft:fern|large_fern|double_plant|flower|tulip|dandelion|poppy|orchid|allium|azure_bluet|oxeye|cornflower|lily_of_the_valley|wither_rose|torchflower|pink_petals|wildflowers|leaf_litter|sapling|deadbush|dead_bush|bush$|seagrass|^minecraft:kelp|vine|snow_layer|lichen|sugar_cane|reeds|sweet_berry|^minecraft:\w+_mushroom$|hanging_roots|spore_blossom|firefly)/;
// blocs accrochés : retirés en premier (et reposés en dernier) pour ne pas les faire tomber en double
const ATTACHED = /(torch|lantern|button|lever|sign|banner|door|carpet|rail|pressure_plate|ladder|candle|bell|chain|redstone_wire|repeater|comparator|tripwire|skull|head|flower_pot|frame|amethyst_cluster|bud|pointed_dripstone)/;
const SPECIAL_NAMES = { regen: "régénération", swift: "rapidité", tough: "résistance", fireproof: "insensible au feu",
  heavy: "inébranlable", boom: "explose à sa mort", light: "éclaire son maître", bouncy: "bondissante", wise: "donne de l'XP", strong: "force" };
// parties
const BODY = 0, LEG = 1, ARM = 2, WING = 3, TAIL = 4, HEAD = 5, SEAT = 6, WHEEL = 7, PROP = 8;
const PART_INFO = {
  [BODY]: ["GOMME (démarquer)", "§7", "minecraft:basic_smoke_particle"],
  [LEG]: ["JAMBES", "§e", "minecraft:basic_flame_particle"],
  [ARM]: ["BRAS", "§b", "minecraft:blue_flame_particle"],
  [WING]: ["AILES", "§d", "minecraft:endrod"],
  [TAIL]: ["QUEUE", "§6", "minecraft:heart_particle"],
  [HEAD]: ["TÊTE", "§a", "minecraft:villager_happy"],
  [WHEEL]: ["ROUES / BAS", "§e", "minecraft:basic_flame_particle"],
  [PROP]: ["HÉLICES", "§d", "minecraft:endrod"],
};
const AX_HEAD = 3;   // « axe » spécial : la tête (un bloc ou un ensemble) pivote avec le regard autour du cou
const HEAD_TURN = 70;  // degrés max de rotation de la tête par rapport au corps
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
const wrapDeg = (d) => ((d % 360) + 540) % 360 - 180;

function safeSub(signal, fn) {
  try { if (signal?.subscribe) { signal.subscribe((ev) => { try { fn(ev); } catch (e) { console.warn("[Créations] " + e); } }); return true; } } catch { }
  return false;
}
function cmd(src, c) { try { if (src.runCommand) src.runCommand(c); else src.runCommandAsync(c); } catch { } }
function particle(dim, id, l) { try { dim.spawnParticle(id, l); } catch { } }
function tell(p, msg) { try { p.onScreenDisplay.setActionBar(msg); p.sendMessage(msg); } catch { } }
function bar(p, msg) { try { p.onScreenDisplay.setActionBar(msg); } catch { } }
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

// Travail long (analyse, fusion, apparition, retrait de milliers de blocs) étalé sur plusieurs ticks :
// sans ça, une construction de 64 × 64 × 64 ferait planter le script (« watchdog »).
function runGen(gen) {
  return new Promise((resolve, reject) => {
    function* wrap() { try { resolve(yield* gen); } catch (e) { reject(e); } }
    const it = wrap();
    try { if (typeof system.runJob === "function") { system.runJob(it); return; } } catch { }
    const step = () => {
      const t0 = Date.now();
      while (!it.next().done) if (Date.now() - t0 > 25) { system.run(step); return; }
    };
    step();
  });
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
// player.id -> { kind: "cr"|"veh", dim, head, mode, parts: Map(key -> {loc, part}), zone, corner, busy }
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
    s = { kind, dim: p.dimension.id, head: undefined, mode: kind === "veh" ? WHEEL : LEG, parts: new Map(), zone: false, corner: undefined, busy: false };
    sel.set(p.id, s);
  }
  if (s.busy) { bar(p, "§eUn instant, je travaille sur ta construction..."); return; }
  const headName = kind === "veh" ? "SIÈGE du conducteur" : "TÊTE";

  if (p.isSneaking) {
    if (!s.head) { tell(p, `§cClique d'abord (sans t'accroupir) sur le bloc ${headName}.`); return; }
    finalize(p, s); return;
  }
  if (!s.head) {
    s.head = loc;
    p.playSound("random.orb", { pitch: 1.4 });
    bar(p, kind === "veh"
      ? "§aSiège choisi ! §fClique les §eROUES§f (ou le fond de la coque). Reclique le siège pour le §bmenu§f."
      : "§aTête choisie ! §fClique les blocs des §eJAMBES§f. Reclique la tête pour le §bmenu§f (tête en plusieurs blocs, bras, ailes, queue, zones...)");
    return;
  }
  if (k === key(s.head)) { system.run(() => partMenu(p, s)); return; }
  if (s.zone) {
    if (!s.corner) {
      s.corner = loc;
      p.playSound("random.click", { pitch: 1.6 });
      bar(p, `§3Zone :§f premier coin posé. Clique le §ecoin opposé§f (jusqu'à ${MAX_SPAN} blocs de côté).`);
      return;
    }
    const a = s.corner; s.corner = undefined;
    markZone(p, s, a, loc);
    return;
  }
  const cur = s.parts.get(k);
  if (s.mode === BODY || (cur && cur.part === s.mode)) { if (cur) s.parts.delete(k); p.playSound("random.click", { pitch: 0.7 }); }
  else { s.parts.set(k, { loc, part: s.mode }); p.playSound("random.click", { pitch: 1.3 }); }
  bar(p, statusLine(s));
}

// marque d'un coup tous les blocs d'une boîte (2 coins) avec la partie choisie
function markZone(p, s, a, b) {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y), z0 = Math.min(a.z, b.z), z1 = Math.max(a.z, b.z);
  if (x1 - x0 >= MAX_SPAN || y1 - y0 >= MAX_SPAN || z1 - z0 >= MAX_SPAN) {
    tell(p, `§cCette zone dépasse ${MAX_SPAN} blocs de côté.`); return;
  }
  const dim = p.dimension, hk = key(s.head), mode = s.mode;
  s.busy = true;
  bar(p, "§3Marquage de la zone...");
  runGen((function* () {
    let n = 0, i = 0;
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      if ((++i & 255) === 0) yield;
      const l = { x, y, z }, k = key(l);
      if (k === hk) continue;
      let bl;
      try { bl = dim.getBlock(l); } catch { }
      if (!bl || bl.isAir || bl.isLiquid) continue;
      if (mode === BODY) { if (s.parts.delete(k)) n++; }
      else { s.parts.set(k, { loc: l, part: mode }); n++; }
    }
    return n;
  })()).then((n) => {
    s.busy = false;
    p.playSound("random.orb", { pitch: 1.1 });
    const [nm, col] = PART_INFO[mode];
    tell(p, `§3Zone :§f ${n} blocs ${mode === BODY ? "démarqués" : `marqués ${col}${nm}`}§f.  ${statusLine(s)}`);
  }).catch((e) => { s.busy = false; tell(p, "§cErreur pendant le marquage : " + e); });
}

function statusLine(s) {
  const c = {};
  for (const v of s.parts.values()) c[v.part] = (c[v.part] ?? 0) + 1;
  const [n, col] = PART_INFO[s.mode];
  const how = s.zone ? " §3[zone]" : "";
  if (s.kind === "veh") return `Mode : ${col}${n}${how}§f | Roues/bas ${c[WHEEL] ?? 0} · Hélices ${c[PROP] ?? 0} §7(accroupi + clic = fabriquer)`;
  return `Mode : ${col}${n}${how}§f | Tête ${1 + (c[HEAD] ?? 0)} · Jambes ${c[LEG] ?? 0} · Bras ${c[ARM] ?? 0} · Ailes ${c[WING] ?? 0} · Queue ${c[TAIL] ?? 0} §7(accroupi + clic = vie)`;
}

function partMenu(p, s) {
  if (s.busy) return;
  const veh = s.kind === "veh";
  const opts = [];
  const setMode = (m) => () => { s.mode = m; s.corner = undefined; bar(p, statusLine(s)); };
  if (veh) {
    opts.push(["§eMarquer les ROUES / le BAS\n§8les blocs qui touchent le sol ou l'eau", setMode(WHEEL)]);
    opts.push(["§dMarquer les HÉLICES\n§8elles tournent quand tu conduis", setMode(PROP)]);
  } else {
    opts.push(["§aMarquer la TÊTE (plusieurs blocs)\n§8ces blocs tournent avec le regard", setMode(HEAD)]);
    opts.push(["§eMarquer les JAMBES\n§8elles marchent", setMode(LEG)]);
    opts.push(["§bMarquer les BRAS\n§8ils frappent et balancent", setMode(ARM)]);
    opts.push(["§dMarquer les AILES\n§8elles battent... et volent !", setMode(WING)]);
    opts.push(["§6Marquer la QUEUE\n§8elle remue", setMode(TAIL)]);
  }
  opts.push(["§7Gomme : démarquer\n§8les blocs redeviennent du corps", setMode(BODY)]);
  opts.push([s.zone ? "§3Marquage : ZONE (2 coins)\n§8touche pour revenir bloc par bloc" : "§3Marquage : BLOC PAR BLOC\n§8touche pour marquer une ZONE (2 coins)",
    () => { s.zone = !s.zone; s.corner = undefined; bar(p, s.zone ? "§3Zone :§f clique un coin puis le coin opposé : tous les blocs entre les deux sont marqués." : statusLine(s)); }]);
  if (!veh) opts.push(["§6Tête = un seul bloc\n§8efface les blocs de tête ajoutés", () => {
    for (const [k, v] of s.parts) if (v.part === HEAD) s.parts.delete(k);
    bar(p, "§aLa tête est de nouveau un seul bloc. " + statusLine(s));
  }]);
  opts.push([veh ? "§a§lFABRIQUER LE VÉHICULE" : "§a§lDONNER VIE", () => finalize(p, s)]);
  opts.push(["§cAnnuler", () => { sel.delete(p.id); bar(p, "§7Annulé."); }]);
  const f = new ActionFormData().title(veh ? "Ton véhicule" : "Ta création")
    .body(`Choisis quelle partie marquer, puis clique sur les blocs correspondants (ou sur 2 coins en mode zone).\nTaille max : ${MAX_SPAN} × ${MAX_SPAN} × ${MAX_SPAN} blocs.${veh ? "" : "\nLa TÊTE peut être un seul bloc (celui cliqué en premier) ou un ensemble de blocs."}\n\n` + statusLine(s));
  for (const [label] of opts) f.button(label);
  showForm(p, f).then((r) => {
    if (!r || r.canceled || r.selection === undefined) return;
    opts[r.selection]?.[1]();
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
  // en mode zone on peut viser loin (les coins d'une grande construction)
  const hit = p.getBlockFromViewDirection({ maxDistance: sel.get(p.id)?.zone ? 64 : 7, includeLiquidBlocks: false });
  if (hit?.block) handleClick(p, hit.block, ev.itemStack);
});

// marqueurs visuels + aide
system.runInterval(() => {
  for (const p of players()) {
    const s = sel.get(p.id);
    if (!s || !s.head) {
      const h = heldId(p);
      if (h === SPARK) bar(p, "§eÉtincelle de vie :§f clic droit sur le bloc de §aTÊTE§f de ta construction");
      else if (h === KEY) bar(p, "§eClé de véhicule :§f clic droit sur le §aSIÈGE§f de ton véhicule (ou vise un véhicule pour son menu)");
      continue;
    }
    if (p.dimension.id !== s.dim) continue;
    const dim = p.dimension;
    const mark = (l, id) => {
      for (const [dx, dy, dz] of [[0.5, 1.05, 0.5], [0.5, 0.5, -0.05], [0.5, 0.5, 1.05], [-0.05, 0.5, 0.5], [1.05, 0.5, 0.5]])
        particle(dim, id, { x: l.x + dx, y: l.y + dy, z: l.z + dz });
    };
    mark(s.head, "minecraft:villager_happy");
    if (s.corner) mark(s.corner, "minecraft:villager_angry");
    // grandes constructions : on n'affiche qu'une partie des marqueurs (les plus proches de toi d'abord)
    const n = s.parts.size;
    if (n <= MARK_SHOW) { for (const v of s.parts.values()) mark(v.loc, PART_INFO[v.part][2]); continue; }
    const pl = p.location, near = [];
    for (const v of s.parts.values()) {
      const d = Math.abs(v.loc.x - pl.x) + Math.abs(v.loc.y - pl.y) + Math.abs(v.loc.z - pl.z);
      if (d < 12) near.push(v);
      if (near.length >= MARK_SHOW / 2) break;
    }
    const step = Math.ceil(n / (MARK_SHOW / 2)), off = system.currentTick % step;
    let i = 0;
    for (const v of s.parts.values()) if ((i++ % step) === off) near.push(v);
    for (const v of near) mark(v.loc, PART_INFO[v.part][2]);
  }
}, 10);

// =============================================================== LECTURE DE LA FORME
// Remplissage depuis la tête/le siège ET depuis chaque bloc marqué : un bloc que tu as marqué fait toujours partie
// de la construction. Les blocs en diagonale (arêtes) sont aussi reliés. Jusqu'à 64 × 64 × 64 blocs, sans limite de nombre.
function* scanGen(dim, s) {
  const veh = s.kind === "veh";
  const bottomPart = veh ? WHEEL : LEG;
  let minY = Infinity;
  for (const v of s.parts.values()) if (v.part === bottomPart && v.loc.y < minY) minY = v.loc.y;
  if (minY === Infinity) return { error: veh
    ? "Marque au moins un bloc du BAS (roues, ou fond de la coque) : c'est ce qui touche le sol ou l'eau."
    : "Choisis au moins un bloc de JAMBE : les jambes définissent où ta création touche le sol." };
  const hk = key(s.head);
  const seen = new Set();
  const queue = [];
  const push = (l) => { const k = key(l); if (!seen.has(k)) { seen.add(k); queue.push(l); } };
  push(s.head);
  for (const v of s.parts.values()) push(v.loc);
  const blocks = [];
  const box = { x0: 1e9, x1: -1e9, y0: 1e9, y1: -1e9, z0: 1e9, z1: -1e9 };
  for (let qi = 0; qi < queue.length; qi++) {
    if ((qi & 127) === 0) yield;
    const l = queue[qi];
    const k = key(l);
    const mk = s.parts.get(k);
    const isMarked = !!mk || k === hk;
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
      return { error: `Ta construction dépasse ${MAX_SPAN} blocs (long, large ou haut) ou touche le décor (sol, arbre, mur...) ici. Isole-la !`, at: l };
    let states = {};
    try { states = b.permutation.getAllStates(); } catch { }
    const part = k === hk ? (veh ? SEAT : HEAD) : (mk?.part ?? BODY);
    blocks.push({ loc: l, id, part, states });
    for (const [dx, dy, dz] of N18) push({ x: l.x + dx, y: l.y + dy, z: l.z + dz });
  }
  if (!blocks.length) return { error: veh ? "Le siège n'est plus là !" : "La tête n'est plus là !", at: s.head };
  return { blocks, minY, box };
}

// vérifie (sans tout réanalyser) que la construction n'a pas changé
function* verifyGen(dim, blocks) {
  for (let i = 0; i < blocks.length; i++) {
    if ((i & 255) === 0) yield;
    const b = blocks[i];
    let t;
    try { t = dim.getBlock(b.loc)?.typeId; } catch { }
    if (t !== b.id) return { ok: false, at: b.loc };
  }
  return { ok: true };
}

function failScan(p, r) {
  tell(p, "§c" + r.error);
  if (r.at) flash(p.dimension, r.at);
  try { p.playSound("note.bass", { pitch: 0.5 }); } catch { }
}

async function finalize(p, s) {
  if (s.busy) return;
  s.busy = true;
  try {
    const dim = p.dimension;
    bar(p, "§eJ'analyse ta construction...");
    const r = await runGen(scanGen(dim, s));
    if (r.error) { failScan(p, r); return; }
    const veh = s.kind === "veh";
    const c = {};
    for (const b of r.blocks) c[b.part] = (c[b.part] ?? 0) + 1;
    const dims = `${r.box.x1 - r.box.x0 + 1}×${r.box.y1 - r.box.y0 + 1}×${r.box.z1 - r.box.z0 + 1}`;
    let form;
    if (veh) {
      form = new ModalFormData()
        .title("Fabriquer ton véhicule")
        .textField(`§7${r.blocks.length} blocs (${dims}) — roues/bas ${c[WHEEL] ?? 0}, hélices ${c[PROP] ?? 0}\n§eL'AVANT du véhicule = la direction où tu regardes maintenant.\n\n§fNom du véhicule`, "ex : Bolide", `Véhicule de ${p.name}`)
        .dropdown("Type", VTYPES, (c[PROP] ?? 0) > 0 ? 2 : 0)
        .toggle("Verrouillé (toi seul peux conduire)", false);
    } else {
      form = new ModalFormData()
        .title("Donner vie à ta création")
        .textField(`§7${r.blocks.length} blocs (${dims}) — tête ${c[HEAD] ?? 0}, jambes ${c[LEG] ?? 0}, bras ${c[ARM] ?? 0}, ailes ${c[WING] ?? 0}, queue ${c[TAIL] ?? 0}\n\n§fNom de ta créature`, "ex : Titan", `Création de ${p.name}`)
        .dropdown("Nature", NATURES.map((n, i) => `${n}§r - ${NATURE_DESC[i]}`), 0);
    }
    const yawAtOpen = p.getRotation().y;
    await sleep(1);
    const res = await showForm(p, form);
    if (!res || res.canceled || !res.formValues) return;
    const ok = await runGen(verifyGen(dim, r.blocks));
    if (!ok.ok) { tell(p, "§cLa construction a changé pendant le menu, recommence !"); flash(dim, ok.at); return; }
    sel.delete(p.id);
    if (veh) await buildVehicle(p, dim, s, r, String(res.formValues[0] || `Véhicule de ${p.name}`), Number(res.formValues[1]), !!res.formValues[2], yawAtOpen);
    else await birth(p, dim, s, r, String(res.formValues[0] || `Création de ${p.name}`), Number(res.formValues[1]));
  } catch (e) {
    tell(p, "§cErreur : " + e);
  } finally { s.busy = false; }
}

// =============================================================== BLOCS : retrait / sauvegarde / restauration
function* removeBlocksGen(dim, blocks) {
  const order = [...blocks].sort((a, b) => (ATTACHED.test(b.id) ? 1 : 0) - (ATTACHED.test(a.id) ? 1 : 0) || b.loc.y - a.loc.y);
  for (let i = 0; i < order.length; i++) {
    if ((i & 63) === 0) yield;
    const b = order[i];
    try {
      const bl = dim.getBlock(b.loc);
      if (!bl) continue;
      // coffres, tonneaux, fours... : on vide le contenu par terre au lieu de le perdre
      try {
        const inv = bl.getComponent("minecraft:inventory")?.container;
        if (inv) {
          for (let j = 0; j < inv.size; j++) { const it = inv.getItem(j); if (it) dim.spawnItem(it, { x: b.loc.x + 0.5, y: b.loc.y + 0.5, z: b.loc.z + 0.5 }); }
          inv.clearAll();
        }
      } catch { }
      bl.setType("minecraft:air");
    } catch { }
  }
}

// Tous les blocs (même ceux cachés à l'intérieur, qui ne sont pas affichés) sont sauvegardés sur le corps de la création,
// pour qu'elle redevienne EXACTEMENT ta construction. Format compact : palette + suites de blocs identiques.
const CHUNK = 30000;
function writeChunks(e, prefix, str) {
  const n = Math.max(1, Math.ceil(str.length / CHUNK));
  for (let i = 0; i < n; i++) e.setDynamicProperty(`${prefix}${i}`, str.slice(i * CHUNK, (i + 1) * CHUNK));
  e.setDynamicProperty(`${prefix}n`, n);
}
function readChunks(e, prefix) {
  const n = e.getDynamicProperty(`${prefix}n`);
  if (!n) return undefined;
  let s = "";
  for (let i = 0; i < n; i++) s += e.getDynamicProperty(`${prefix}${i}`) ?? "";
  return s;
}
function saveBlocks(core, blocks, cx, cy, cz) {
  let x0 = 1e9, y0 = 1e9, z0 = 1e9;
  for (const b of blocks) { x0 = Math.min(x0, b.loc.x); y0 = Math.min(y0, b.loc.y); z0 = Math.min(z0, b.loc.z); }
  const pal = [], palIdx = new Map();
  const rows = blocks.map((b) => {
    const st = b.states && Object.keys(b.states).length ? b.states : undefined;
    const pk = b.id + (st ? JSON.stringify(st) : "");
    let pi = palIdx.get(pk);
    if (pi === undefined) { pi = pal.length; palIdx.set(pk, pi); pal.push(st ? [b.id, st] : [b.id]); }
    return [b.loc.x - x0, b.loc.y - y0, b.loc.z - z0, pi];
  }).sort((a, b) => a[1] - b[1] || a[2] - b[2] || a[0] - b[0]);
  const runs = [];
  for (let i = 0; i < rows.length;) {
    const [x, y, z, pi] = rows[i];
    let len = 1;
    while (i + len < rows.length && rows[i + len][1] === y && rows[i + len][2] === z && rows[i + len][3] === pi && rows[i + len][0] === x + len) len++;
    runs.push(len > 1 ? `${x},${y},${z},${pi},${len}` : `${x},${y},${z},${pi}`);
    i += len;
  }
  try {
    core.setDynamicProperty("cr:org", JSON.stringify([x0 + 0.5 - cx, y0 + 0.5 - cy, z0 + 0.5 - cz]));
    writeChunks(core, "cr:pal_", JSON.stringify(pal));
    writeChunks(core, "cr:blk_", runs.join(";"));
    return true;
  } catch (e) { console.warn("[Créations] sauvegarde des blocs impossible : " + e); return false; }
}
function loadBlocks(core) {
  try {
    const org = JSON.parse(core.getDynamicProperty("cr:org") ?? "null");
    const pal = JSON.parse(readChunks(core, "cr:pal_") ?? "null");
    const raw = readChunks(core, "cr:blk_");
    if (!org || !pal || raw === undefined) return undefined;
    const out = [];
    for (const r of raw.split(";")) {
      if (!r) continue;
      const [x, y, z, pi, len = 1] = r.split(",").map(Number);
      for (let i = 0; i < len; i++) out.push({ o: { x: org[0] + x + i, y: org[1] + y, z: org[2] + z }, id: pal[pi][0], st: pal[pi][1] ?? {} });
    }
    return out;
  } catch { return undefined; }
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

// =============================================================== SQUELETTE + FUSION DES BLOCS
// Chaque bloc appartient à un « groupe » qui bouge d'un seul tenant : le corps, la tête (un bloc ou un ensemble),
// chaque jambe, chaque bras, chaque aile, la queue, chaque roue, chaque hélice.
// Ensuite les blocs d'un même groupe sont fusionnés en cubes de 2, 4, 8 ou 16 blocs de côté, et l'intérieur caché
// n'est pas affiché : une création de 64 × 64 × 64 blocs reste jouable.
function* buildRigGen(blocks, cx, cy, cz, yaw0, veh, headLoc, maxVox) {
  const { F, R } = frame(yaw0);
  const n = blocks.length;
  let x0 = 1e9, y0 = 1e9, z0 = 1e9, x1 = -1e9, y1 = -1e9, z1 = -1e9;
  for (const b of blocks) {
    x0 = Math.min(x0, b.loc.x); x1 = Math.max(x1, b.loc.x); y0 = Math.min(y0, b.loc.y); y1 = Math.max(y1, b.loc.y); z0 = Math.min(z0, b.loc.z); z1 = Math.max(z1, b.loc.z);
  }
  const W = x1 - x0 + 1, H = y1 - y0 + 1, D = z1 - z0 + 1;
  const grid = new Int32Array(W * H * D).fill(-1);
  const gi = (x, y, z) => (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) ? -1 : grid[(y * D + z) * W + x];
  const cells = new Array(n);
  for (let i = 0; i < n; i++) {
    const b = blocks[i];
    const lx = b.loc.x - x0, ly = b.loc.y - y0, lz = b.loc.z - z0;
    grid[(ly * D + lz) * W + lx] = i;
    const main = !veh && headLoc && b.loc.x === headLoc.x && b.loc.y === headLoc.y && b.loc.z === headLoc.z;
    cells[i] = { b, lx, ly, lz, o: { x: b.loc.x + 0.5 - cx, y: b.loc.y + 0.5 - cy, z: b.loc.z + 0.5 - cz },
      part: b.part === SEAT ? BODY : b.part, g: 0, mat: matOf(b.id)[0], main };
  }
  yield;
  // --- groupes
  const params = [{ part: BODY, h: { x: 0, y: 0, z: 0 }, axis: 0, ph: 0, sign: 1 }];   // 0 = corps
  const addGroup = (list, prm) => { const g = params.length; params.push(prm); for (const c of list) c.g = g; return g; };
  const comps = (part) => {
    const out = [], done = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (cells[i].part !== part || done[i]) continue;
      const comp = [], q = [i]; done[i] = 1;
      while (q.length) {
        const c = cells[q.pop()]; comp.push(c);
        for (const [dx, dy, dz] of N6) {
          const j = gi(c.lx + dx, c.ly + dy, c.lz + dz);
          if (j >= 0 && !done[j] && cells[j].part === part) { done[j] = 1; q.push(j); }
        }
      }
      out.push(comp);
    }
    return out;
  };
  const cen = (l) => ({ x: l.reduce((a, c) => a + c.o.x, 0) / l.length, y: l.reduce((a, c) => a + c.o.y, 0) / l.length, z: l.reduce((a, c) => a + c.o.z, 0) / l.length });
  const side = (o) => (dot(o, R) >= 0 ? 1 : -1);
  const of = (part) => cells.filter((c) => c.part === part);
  if (!veh) {
    // chaque jambe (morceau relié) pivote d'un bloc depuis son sommet ; gauche/droite et avant/arrière en opposition
    for (const comp of comps(LEG)) {
      const c = cen(comp), top = Math.max(...comp.map((v) => v.o.y)) + 0.5;
      addGroup(comp, { part: LEG, h: { x: c.x, y: top, z: c.z }, axis: 0, ph: (side(c) > 0 ? 0 : Math.PI) + (dot(c, F) > 0.6 ? Math.PI : 0), sign: 1 });
    }
    for (const sd of [1, -1]) {
      const arms = of(ARM).filter((c) => side(c.o) === sd);
      if (!arms.length) continue;
      const c = cen(arms), top = Math.max(...arms.map((v) => v.o.y)) + 0.5;
      addGroup(arms, { part: ARM, h: { x: c.x, y: top, z: c.z }, axis: 0, ph: sd > 0 ? Math.PI : 0, sign: 1 });
    }
    for (const sd of [1, -1]) {
      const wings = of(WING).filter((c) => side(c.o) === sd);
      if (!wings.length) continue;
      const inner = wings.reduce((a, v) => (Math.abs(dot(v.o, R)) < Math.abs(dot(a.o, R)) ? v : a));
      addGroup(wings, { part: WING, h: { x: inner.o.x - R.x * 0.5 * sd, y: inner.o.y, z: inner.o.z - R.z * 0.5 * sd }, axis: 1, ph: 0, sign: sd });
    }
    const tails = of(TAIL);
    if (tails.length) {
      const base = tails.reduce((a, v) => (Math.hypot(v.o.x, v.o.z) < Math.hypot(a.o.x, a.o.z) ? v : a));
      addGroup(tails, { part: TAIL, h: { ...base.o }, axis: 2, ph: 0, sign: 1 });
    }
    // la tête : un seul bloc ou un ensemble de blocs ; elle pivote autour du « cou » (bas de la tête, au centre)
    const heads = of(HEAD);
    if (heads.length) {
      const c = cen(heads), bottom = Math.min(...heads.map((v) => v.o.y)) - 0.5;
      addGroup(heads, { part: HEAD, h: { x: c.x, y: bottom, z: c.z }, axis: AX_HEAD, ph: 0, sign: 1 });
    }
  } else {
    let bodyTop = -1e9;
    for (const c of cells) if (c.part !== PROP) bodyTop = Math.max(bodyTop, c.o.y);
    for (const comp of comps(WHEEL)) addGroup(comp, { part: WHEEL, h: cen(comp), axis: 0, ph: 0, sign: 1 });
    for (const comp of comps(PROP)) {
      const h = cen(comp);
      addGroup(comp, { part: PROP, h, axis: h.y >= bodyTop - 0.01 ? 2 : 1, ph: 0, sign: 1 });   // au-dessus du corps = rotor
    }
  }
  yield;
  // --- blocs cachés : entourés sur les 6 faces par des blocs du même groupe
  const hidden = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if ((i & 1023) === 0) yield;
    const c = cells[i];
    if (c.main) continue;
    let h = 1;
    for (const [dx, dy, dz] of N6) { const j = gi(c.lx + dx, c.ly + dy, c.lz + dz); if (j < 0 || cells[j].g !== c.g) { h = 0; break; } }
    hidden[i] = h;
  }
  // --- fusion en cubes. On essaie d'abord sans perdre aucun détail (cubes d'une seule texture) ; si la création a trop
  // de morceaux, on accepte peu à peu des cubes « presque » d'une seule texture, puis des cubes à moitié pleins.
  const LEVELS = [[1, false], [0.85, false], [0.7, false], [0, false], [0, true]];
  let out;
  for (const [purity, partial] of LEVELS) {
    out = [];
    const used = new Uint8Array(n);
    let ops = 0;
    for (const sz of [16, 8, 4, 2]) {
      if (sz > W && sz > H && sz > D) continue;
      for (let by = 0; by < H; by += sz) for (let bz = 0; bz < D; bz += sz) for (let bx = 0; bx < W; bx += sz) {
        if ((++ops & 63) === 0) yield;
        let present = 0, g = -1, ok = true, firstVis = -1;
        const tally = new Map();
        for (let y = by; y < by + sz && ok; y++) for (let z = bz; z < bz + sz && ok; z++) for (let x = bx; x < bx + sz; x++) {
          const j = gi(x, y, z);
          if (j < 0) { if (!partial) { ok = false; break; } continue; }
          const c = cells[j];
          if (used[j] || c.main || (g >= 0 && c.g !== g)) { ok = false; break; }
          g = c.g; present++;
          if (!hidden[j]) { tally.set(c.mat, (tally.get(c.mat) ?? 0) + 1); if (firstVis < 0) firstVis = j; }
        }
        if (!ok || present === 0 || present * 2 < sz * sz * sz) continue;
        if (tally.size > 1) {
          let best = 0, tot = 0;
          for (const cnt of tally.values()) { tot += cnt; if (cnt > best) best = cnt; }
          if (purity >= 1 || best < tot * purity) continue;
        }
        // marquer comme utilisés
        for (let y = by; y < by + sz; y++) for (let z = bz; z < bz + sz; z++) for (let x = bx; x < bx + sz; x++) { const j = gi(x, y, z); if (j >= 0) used[j] = 1; }
        if (firstVis < 0) continue;               // cube entièrement caché : rien à afficher
        let mat = cells[firstVis].mat, best = -1;
        for (const [m, cnt] of tally) if (cnt > best) { best = cnt; mat = m; }
        const o = { x: x0 + bx + sz / 2 - cx, y: y0 + by + sz / 2 - cy, z: z0 + bz + sz / 2 - cz };   // centre du cube
        out.push({ o, size: sz, g, mat, id: cells[firstVis].b.id, main: false });
      }
    }
    for (let i = 0; i < n; i++) {
      if (used[i] || hidden[i]) continue;
      const c = cells[i];
      out.push({ o: c.o, size: 1, g: c.g, mat: c.mat, id: c.b.id, main: c.main });
    }
    if (out.length <= maxVox) break;
  }
  if (out.length > maxVox) return { error: `Ta construction est trop détaillée : ${out.length} morceaux à animer (max ${maxVox}). Utilise moins de blocs différents, ou de plus gros pans d'un même bloc.` };
  // --- squelette final (même format qu'avant + taille + tête principale)
  const vox = out.map((v) => {
    const prm = params[v.g];
    return { o: v.o, id: v.id, mat: v.mat, size: v.size, main: v.main,
      a: [v.o.x, v.o.y, v.o.z, prm.part, prm.h.x, prm.h.y, prm.h.z, prm.axis, prm.ph, prm.sign, v.size, v.main ? 1 : 0] };
  });
  return { vox };
}

function blockStats(blocks) {
  let hpSum = 0, tierSum = 0;
  const specials = new Set();
  for (const b of blocks) { const m = matOf(b.id); hpSum += 3 + m[1] * 3; tierSum += m[1]; if (m[2]) specials.add(m[2]); }
  return { hpI: nearest(HP, Math.min(HP[HP.length - 1], hpSum)), tierAvg: tierSum / blocks.length, specials };
}

// crée les morceaux animés (voxels)
function* spawnVoxelsGen(dim, core, rig, nameOnHead, cx, cy, cz) {
  const voxels = [];
  for (let i = 0; i < rig.length; i++) {
    if ((i & 15) === 0) yield;
    const v = rig[i];
    let e;
    try { e = dim.spawnEntity(VOX, { x: cx + v.o.x, y: cy + v.o.y - v.size / 2, z: cz + v.o.z }); } catch { continue; }
    try { e.setProperty("cr:tex", v.mat); } catch { }
    if (v.size > 1) { try { e.setProperty("cr:size", v.size); } catch { } try { e.triggerEvent(`cr:sz_${v.size}`); } catch { } }
    e.setDynamicProperty("cr:core", core.id);
    e.setDynamicProperty("cr:rig", JSON.stringify(v.a));
    e.setDynamicProperty("cr:block", v.id);
    if (nameOnHead && v.main) e.nameTag = nameOnHead;
    voxels.push(mkVox(e, v.a));
  }
  return voxels;
}

// =============================================================== NAISSANCE (créature)
async function birth(p, dim, s, r, name, nature) {
  try { p.playSound("beacon.activate"); } catch { }
  for (let t = 1; t <= 15; t++) {
    for (let i = 0; i < 8 + Math.min(40, r.blocks.length / 50); i++) {
      const b = r.blocks[Math.floor(Math.random() * r.blocks.length)].loc;
      particle(dim, "minecraft:totem_particle", { x: b.x + Math.random(), y: b.y + Math.random(), z: b.z + Math.random() });
    }
    if (t % 5 === 0) try { p.playSound("note.chime", { pitch: 0.5 + t / 20 }); } catch { }
    await sleep(2);
  }
  // on revérifie : un joueur a pu casser un bloc pendant l'animation
  const ok = await runGen(verifyGen(dim, r.blocks));
  if (!ok.ok) { tell(p, "§cUn bloc de ta construction a changé, recommence !"); flash(dim, ok.at); return; }
  try { await bringToLife(p, dim, s, r, name, nature); } catch (e) { tell(p, "§cErreur : " + e); }
}

async function bringToLife(p, dim, s, r, name, nature) {
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, maxY = -1e9;
  for (const b of r.blocks) { minX = Math.min(minX, b.loc.x); maxX = Math.max(maxX, b.loc.x); minZ = Math.min(minZ, b.loc.z); maxZ = Math.max(maxZ, b.loc.z); maxY = Math.max(maxY, b.loc.y); }
  const cx = (minX + maxX + 1) / 2, cz = (minZ + maxZ + 1) / 2, cy = r.minY;
  // l'avant = le côté du bloc de tête cliqué en premier (sinon du centre de la tête, sinon de toi)
  let fx = s.head.x + 0.5 - cx, fz = s.head.z + 0.5 - cz;
  if (Math.hypot(fx, fz) < 0.6) {
    const hb = r.blocks.filter((b) => b.part === HEAD);
    fx = hb.reduce((a, b) => a + b.loc.x + 0.5, 0) / hb.length - cx; fz = hb.reduce((a, b) => a + b.loc.z + 0.5, 0) / hb.length - cz;
  }
  if (Math.hypot(fx, fz) < 0.6) { fx = p.location.x - cx; fz = p.location.z - cz; }
  const yaw0 = Math.atan2(-fx, fz) * 180 / Math.PI;

  bar(p, "§eJe prépare le squelette de ta création...");
  const rig = await runGen(buildRigGen(r.blocks, cx, cy, cz, yaw0, false, s.head, MAX_VOX));
  if (rig.error) { tell(p, "§c" + rig.error + " §7Ta construction est intacte."); return; }

  const { hpI, tierAvg, specials } = blockStats(r.blocks);
  const n = r.blocks.length;
  let legs = 0, wings = 0, arms = 0;
  for (const b of r.blocks) { if (b.part === LEG) legs++; else if (b.part === WING) wings++; else if (b.part === ARM) arms++; }
  const dmgI = nearest(DMG, 2 + tierAvg * 2 + n / 12 + arms * 0.5);
  const spd = clamp(3 - Math.floor(n / 30) + (legs >= 2 ? 1 : 0) - (legs === 1 ? 1 : 0) + (specials.has("swift") ? 1 : 0), 0, 4);
  const height = maxY - cy + 1;
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const b of r.blocks) if (b.part !== WING && b.part !== TAIL) { bx0 = Math.min(bx0, b.loc.x); bx1 = Math.max(bx1, b.loc.x); bz0 = Math.min(bz0, b.loc.z); bz1 = Math.max(bz1, b.loc.z); }
  const size = Math.max(bx1 - bx0 + 1, bz1 - bz0 + 1, height / 1.5);
  const box = size <= 1 ? 0 : size <= 2 ? 1 : size <= 3 ? 2 : size <= 4 ? 3 : size <= 6 ? 4 : size <= 10 ? 5 : 6;
  const seat = clamp(height, 1, 64);

  // 1) on crée d'abord le corps : si ça échoue, ta construction reste intacte et l'étincelle n'est pas perdue
  let core;
  try { core = dim.spawnEntity(CORE, { x: cx, y: cy, z: cz }); }
  catch (e) { tell(p, "§cImpossible de faire apparaître la créature ici (" + e + "). Ta construction est intacte."); return; }
  try { core.setRotation({ x: 0, y: yaw0 }); } catch { }
  try { core.triggerEvent("cr:freeze"); } catch { }       // immobile pendant qu'elle se forme
  core.setDynamicProperty("cr:busy", true);
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
  saveBlocks(core, r.blocks, cx, cy, cz);
  // 2) le corps animé
  bar(p, `§eTa création prend forme... (${rig.vox.length} morceaux)`);
  const voxels = await runGen(spawnVoxelsGen(dim, core, rig.vox, name, cx, cy, cz));
  // 3) puis seulement on retire les blocs
  await runGen(removeBlocksGen(dim, r.blocks));
  consumeSpark(p);
  if (!core.isValid()) return;
  core.setDynamicProperty("cr:busy", undefined);
  try { core.triggerEvent("cr:unfreeze"); core.triggerEvent(`cr:set_spd_${spd}`); } catch { }
  groups.set(core.id, newGroup(core, voxels, { wake: 30 }));

  particle(dim, "minecraft:huge_explosion_emitter", { x: cx, y: cy + 1, z: cz });
  try { p.playSound("mob.irongolem.repair"); } catch { }
  const sp = [...specials].map((x) => SPECIAL_NAMES[x]).filter(Boolean).join(", ");
  p.sendMessage(`§a[Création]§r §e${name}§r — ${NATURES[nature]}§r — ${HP[hpI]} PV, ${DMG[dmgI]} dégâts, ${n} blocs${wings >= 2 ? " — §dpeut voler" : ""}${sp ? " — §b" + sp : ""}`);
  p.sendMessage("§7Astuce : clic droit sur ta créature pour la chevaucher. Le §eBâton du créateur§7 donne des ordres ou la retransforme en blocs.");
}

// =============================================================== VÉHICULES
async function buildVehicle(p, dim, s, r, name, vtype, locked, yawLook) {
  const yaw0 = Math.round(yawLook / 90) * 90;
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (const b of r.blocks) { minX = Math.min(minX, b.loc.x); maxX = Math.max(maxX, b.loc.x); minZ = Math.min(minZ, b.loc.z); maxZ = Math.max(maxZ, b.loc.z); }
  // le centre du véhicule est décalé d'un nombre entier de blocs par rapport au siège (max 3)
  const sx = s.head.x + 0.5, sz = s.head.z + 0.5;
  const ix = clamp(Math.round((minX + maxX + 1) / 2 - sx), -3, 3), iz = clamp(Math.round((minZ + maxZ + 1) / 2 - sz), -3, 3);
  const cx = sx + ix, cz = sz + iz, cy = r.minY;
  const { F, R } = frame(yaw0);
  const lx = Math.round(dot({ x: -ix, y: 0, z: -iz }, R)), lz = Math.round(dot({ x: -ix, y: 0, z: -iz }, F));
  const sh = clamp(s.head.y - cy, 0, 8);

  bar(p, "§eJe prépare ton véhicule...");
  const rig = await runGen(buildRigGen(r.blocks, cx, cy, cz, yaw0, true, undefined, MAX_VEH_VOX));
  if (rig.error) { tell(p, "§c" + rig.error + " §7Ta construction est intacte."); return; }

  const { hpI, specials } = blockStats(r.blocks);
  const n = r.blocks.length;
  const wheels = r.blocks.filter((b) => b.part === WHEEL).length;
  const spd = clamp(3 - Math.floor(n / 70) + (specials.has("swift") ? 1 : 0) + (specials.has("strong") ? 1 : 0) + (wheels >= 4 ? 1 : 0) - (vtype === 1 ? 1 : 0), 0, 5);
  const cruise = vtype === 2 ? 0.55 + spd * 0.07 : 0.25 + spd * 0.05;
  let bx0 = 1e9, bx1 = -1e9, bz0 = 1e9, bz1 = -1e9;
  for (const b of r.blocks) if (b.part !== PROP) { bx0 = Math.min(bx0, b.loc.x); bx1 = Math.max(bx1, b.loc.x); bz0 = Math.min(bz0, b.loc.z); bz1 = Math.max(bz1, b.loc.z); }
  const foot = Math.min(bx1 - bx0 + 1, bz1 - bz0 + 1);
  const box = foot <= 1 ? 0 : foot <= 2 ? 1 : foot <= 3 ? 2 : foot <= 4 ? 3 : 4;

  let core;
  try { core = dim.spawnEntity(VEH, { x: cx, y: cy, z: cz }); }
  catch (e) { tell(p, "§cImpossible de créer le véhicule ici (" + e + "). Ta construction est intacte."); return; }
  try { core.setRotation({ x: 0, y: yaw0 }); } catch { }
  core.setDynamicProperty("cr:busy", true);
  for (const ev of [`cr:set_hp_${hpI}`, `cr:set_spd_${spd}`, `cr:set_box_${box}`, `cr:vseat_${lx + 3}_${sh}_${lz + 3}`, `cr:vtype_${vtype}`]) {
    try { core.triggerEvent(ev); } catch { }
  }
  if (specials.has("fireproof")) try { core.triggerEvent("cr:fireproof"); } catch { }
  const meta = { yaw0, name, spd, vtype, cruise, n, locked, owner: p.id, stats: `${HP[hpI]} PV, vitesse ${spd + 1}/6, ${n} blocs` };
  for (const [k, v] of Object.entries(meta)) core.setDynamicProperty("cr:" + k, v);
  saveBlocks(core, r.blocks, cx, cy, cz);

  const voxels = await runGen(spawnVoxelsGen(dim, core, rig.vox, undefined, cx, cy, cz));
  await runGen(removeBlocksGen(dim, r.blocks));
  if (!core.isValid()) return;
  core.setDynamicProperty("cr:busy", undefined);
  groups.set(core.id, newGroup(core, voxels, { wake: 0 }));

  particle(dim, "minecraft:huge_explosion_emitter", { x: cx, y: cy + 1, z: cz });
  try { p.playSound("random.anvil_use", { pitch: 1.2 }); } catch { }
  const how = vtype === 2 ? "Roule vite et §eregarde vers le haut§f pour décoller ; en vol, il suit ton regard."
    : vtype === 1 ? "Mets-le sur l'eau : il avance là où tu regardes ; §eregarde tes pieds§f pour freiner."
    : "Avance avec les touches de déplacement, il tourne là où tu regardes.";
  p.sendMessage(`§a[Véhicule]§r §e${name}§r — ${VTYPE_SHORT[vtype]} — ${HP[hpI]} PV, vitesse ${spd + 1}/6, ${n} blocs${locked ? " — §6verrouillé" : ""}`);
  p.sendMessage(`§7Clic droit dessus pour monter. §f${how}§7 Accroupis-toi pour descendre. Clé de véhicule en main + clic droit dessus = menu.`);
}

// =============================================================== ANIMATION
const groups = new Map();
// rig : [ox, oy, oz, partie, pivot x/y/z, axe, phase, sens, taille du cube, tête principale]
const mkVox = (e, a) => ({ e, ox: a[0], oy: a[1], oz: a[2], part: a[3], hx: a[4], hy: a[5], hz: a[6], axis: a[7], ph: a[8], sign: a[9],
  size: a[10] ?? 1, main: a[11] ?? (a[3] === HEAD ? 1 : 0) });
function newGroup(core, voxels, extra = {}) {
  const veh = core.typeId === VEH;
  return { core, voxels, veh, yaw0: core.getDynamicProperty("cr:yaw0") ?? 0, phase: 0, t: 0, last: { ...core.location },
    attack: 0, hurt: 0, wake: 0, wings: core.getDynamicProperty("cr:wings") ?? 0, n: core.getDynamicProperty("cr:n") ?? voxels.length,
    vtype: core.getDynamicProperty("cr:vtype") ?? 0, cruise: core.getDynamicProperty("cr:cruise") ?? 0.4,
    roll: 0, prop: 0, spin: 0, air: 0, stepSign: 1, lastYaw: 1e9, lastHead: 1e9, moving: true, ...extra };
}

// la zone autour est-elle chargée ? (sinon le corps est peut-être juste dans un chunk pas encore chargé)
function areaLoaded(dim, l, r) {
  try {
    for (const [dx, dz] of [[r, r], [-r, r], [r, -r], [-r, -r]]) if (!dim.getBlock({ x: l.x + dx, y: l.y, z: l.z + dz })) return false;
    return true;
  } catch { return false; }
}

// cache : on ne relit pas le squelette de chaque morceau toutes les 2 secondes (des milliers pour une grande création)
let voxCache = new Map();   // entity.id -> { cid, vox }
function rebuild() {
  const found = new Map();
  const nextCache = new Map();
  const cores = new Map();
  for (const d of ["overworld", "nether", "the_end"]) {
    let vs = [];
    const dim = world.getDimension(d);
    try { vs = dim.getEntities({ type: VOX }); } catch { continue; }
    for (const v of vs) {
      try {
        let ce = voxCache.get(v.id);
        if (!ce) {
          if (v.getDynamicProperty("cr:debris")) continue;
          const cid = v.getDynamicProperty("cr:core");
          let a = JSON.parse(v.getDynamicProperty("cr:rig") ?? "null");
          if (!a) { // ancienne version (v2) : uniquement jambes
            const [ox, oy, oz, leg] = JSON.parse(v.getDynamicProperty("cr:off") ?? "[0,0,0,0]");
            a = [ox, oy + 0.5, oz, leg ? LEG : BODY, ox, oy + 1, oz, 0, leg === 2 ? Math.PI : 0, 1];
          }
          ce = { cid, vox: mkVox(v, a) };
        }
        if (ce.vox.debris) continue;
        const cid = ce.cid;
        let core = cores.get(cid);
        if (core === undefined) { core = cid ? world.getEntity(cid) ?? null : null; cores.set(cid, core); }
        if (!core || !core.isValid()) {
          // avant : supprimé au bout de 10 s même si le corps était juste hors de portée -> créatures "cassées"
          if (!areaLoaded(dim, v.location, 32)) continue;
          const orphan = (v.getDynamicProperty("cr:orphan") ?? 0) + 1;
          v.setDynamicProperty("cr:orphan", orphan);
          if (orphan > 15) v.remove();
          continue;
        }
        if (core.getDynamicProperty("cr:busy")) { nextCache.set(v.id, ce); continue; }
        if (v.getDynamicProperty("cr:orphan")) v.setDynamicProperty("cr:orphan", 0);
        nextCache.set(v.id, ce);
        let g = found.get(cid);
        if (!g) {
          const old = groups.get(cid);
          const keep = old ? { phase: old.phase, t: old.t, attack: old.attack, hurt: old.hurt, wake: old.wake, last: old.last,
            roll: old.roll, prop: old.prop, spin: old.spin, air: old.air, stepSign: old.stepSign,
            lastYaw: old.lastYaw, lastHead: old.lastHead, moving: old.moving } : {};
          g = newGroup(core, [], keep);
          found.set(cid, g);
        }
        g.voxels.push(ce.vox);
      } catch { }
    }
  }
  voxCache = nextCache;
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
  const big = g.voxels.length > 150;

  if (g.veh) {
    const fNow = frame(yaw).F;
    g.roll += (dx * fNow.x + dz * fNow.z) * 2;                     // roues
    const rider = riderOf(c);
    g.spin = rider || moved > 0.05 ? Math.min(g.spin + 0.02, 0.7) : Math.max(g.spin - 0.01, 0);
    g.prop += g.spin;                                                // hélices
    bob = Math.sin(g.t * 0.9) * 0.025 * walk + (g.spin > 0 && !big ? Math.sin(g.t * 1.7) * 0.008 : 0);   // moteur
    if (walk > 0.4 && g.t % 4 === 0 && g.vtype !== 1) particle(c.dimension, "minecraft:basic_smoke_particle", { x: loc.x - fNow.x * 1.2, y: loc.y + 0.3, z: loc.z - fNow.z * 1.2 });
    vehicleControl(g, rider, moved);
  } else {
    g.phase += Math.min(moved, 0.6) * 2.2 / Math.max(1, Math.sqrt(g.n / 150));   // les géants font de grands pas lents
    flying = g.wings >= 2 && (airborne || !isOnGround(c));
    bob = Math.abs(Math.sin(g.phase)) * 0.08 * walk + (big ? 0 : Math.sin(g.t * 0.08) * 0.02);
    if (g.attack > 0) g.attack--;
    atk = g.attack > 0 ? Math.sin((1 - g.attack / 10) * Math.PI) : 0;
    const stepNow = Math.sign(Math.sin(g.phase));
    if (stepNow !== g.stepSign && walk > 0.3 && !flying) {
      g.stepSign = stepNow;
      if (g.n >= 25) {
        particle(c.dimension, "minecraft:basic_smoke_particle", { x: loc.x, y: loc.y + 0.1, z: loc.z });
        for (const pl of players()) {
          if (pl.dimension.id === c.dimension.id && Math.hypot(pl.location.x - loc.x, pl.location.z - loc.z) < 14 + Math.sqrt(g.n))
            cmd(pl, `camerashake add @s ${Math.min(0.6, g.n / 250).toFixed(2)} 0.25 positional`);
        }
      }
    }
    try { const v = c.getViewDirection(); headYaw = Math.atan2(-v.x, v.z) * 180 / Math.PI; } catch { }
  }
  const control = () => { if (!g.veh) { if (g.wake === 1) wakeUp(g); flightControl(g, flying); } };
  // grandes créations : on répartit la mise à jour (jusqu'à 1 fois tous les 4 ticks) et, à l'arrêt,
  // seules les parties qui bougent encore (ailes, queue, tête, hélices) sont replacées
  const every = clamp(Math.ceil(g.voxels.length / 500), 1, 4);
  if (g.t % every !== 0 && g.hurt === 0) { control(); return; }
  const turned = Math.abs(wrapDeg(yaw - g.lastYaw)) > 0.05;
  const headRel = clamp(wrapDeg(headYaw - yaw), -HEAD_TURN, HEAD_TURN);
  const headMoved = Math.abs(headRel - g.lastHead) > 0.3;
  const active = moved > 0.002 || turned || airborne || flying || g.hurt > 0 || g.wake > 0 || atk > 0 || (g.veh && moved > 0.002);
  const full = !big || active || g.moving;          // un dernier passage complet juste après l'arrêt
  g.moving = active;
  g.lastYaw = yaw; g.lastHead = headRel;
  const hd = rad(headRel), hc = Math.cos(hd), hs = Math.sin(hd);
  const lunge = atk * 0.35;
  for (const v of g.voxels) {
    if (!full) {
      const anim = v.part === WING || v.part === TAIL || (v.part === HEAD && headMoved) || (v.part === PROP && g.spin > 0);
      if (!anim) continue;
    }
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
    if (v.axis === AX_HEAD) {
      // tête (un bloc ou un ensemble) : tourne autour du cou, comme le reste du corps tourne autour du centre
      const qx = p.x - v.hx, qz = p.z - v.hz;
      p = { x: v.hx + qx * hc - qz * hs, y: p.y, z: v.hz + qx * hs + qz * hc };
    } else if (ang) {
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
    const ry = v.part === HEAD ? yaw + headRel : yaw;
    try { v.e.teleport({ x: loc.x + wx, y: loc.y + p.y - v.size / 2, z: loc.z + wz }, { rotation: { x: 0, y: ry } }); } catch { }
  }
  control();
}

function wakeUp(g) {
  const c = g.core, loc = c.location;
  const nat = c.getDynamicProperty("cr:nature") ?? 0;
  for (const v of g.voxels) if (v.main) try { v.e.setProperty("cr:eye", nat + 1); } catch { }
  try { c.dimension.playSound(g.n >= 40 ? "mob.enderdragon.growl" : "mob.irongolem.repair", loc, { volume: 0.8 + Math.min(2, g.n / 2000), pitch: g.n >= 40 ? 0.7 : 1.2 }); } catch { }
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
          for (const v of groups.get(c.id)?.voxels ?? []) if (v.main) try { v.e.setProperty("cr:eye", k + 1); } catch { }
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
    if (onHead) for (const v of groups.get(c.id)?.voxels ?? []) if (v.main) v.e.nameTag = nn;
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

// Redevenir des blocs : tous les blocs sauvegardés (même ceux de l'intérieur) sont reposés, tournés comme le corps.
async function dismantle(p, c) {
  const g = groups.get(c.id);
  if (!g || c.getDynamicProperty("cr:busy")) return;
  for (const r of c.getComponent("minecraft:rideable")?.getRiders() ?? []) try { c.getComponent("minecraft:rideable").ejectRider(r); } catch { }
  const dim = c.dimension, loc = c.location;
  const snap = Math.round((c.getRotation().y - g.yaw0) / 90) * 90;
  const q = ((Math.round(snap / 90) % 4) + 4) % 4;
  const cs = Math.round(Math.cos(rad(snap))), sn = Math.round(Math.sin(rad(snap)));
  const base = { x: Math.floor(loc.x) + 0.5, y: Math.round(loc.y), z: Math.floor(loc.z) + 0.5 };
  const where = (o) => {
    const x = o.x * cs - o.z * sn, z = o.x * sn + o.z * cs;
    return { x: Math.floor(base.x + x), y: Math.floor(base.y + o.y), z: Math.floor(base.z + z) };
  };
  const saved = loadBlocks(c);
  const vs = g.voxels.filter((v) => v.e.isValid());
  groups.delete(c.id);
  c.setDynamicProperty("cr:busy", true);
  const drops = new Map();
  const put = (bl, id, st, at) => {
    try {
      const b = dim.getBlock(bl);
      if (b && (b.isAir || b.isLiquid || VEG.test(b.typeId))) { placeBlock(b, id, st); return; }
    } catch { }
    drops.set(id, (drops.get(id) ?? 0) + 1);
    drops.at = drops.at ?? at;
  };
  if (!saved) {
    // créations des versions précédentes : un bloc par morceau
    for (const v of vs) {
      const id = v.e.getDynamicProperty("cr:block") ?? "minecraft:cobblestone";
      let st;
      try { st = rotateStates(JSON.parse(v.e.getDynamicProperty("cr:st") ?? "{}"), q); } catch { st = {}; }
      put(where({ x: v.ox, y: v.oy, z: v.oz }), id, st, v.e.location);
      particle(dim, "minecraft:villager_happy", v.e.location);
      try { v.e.remove(); } catch { }
    }
  } else {
    bar(p, `§eTa création redevient ${saved.length} blocs...`);
    await runGen((function* () {
      for (let i = 0; i < vs.length; i++) {
        if ((i & 31) === 0) yield;
        if (i % Math.max(1, Math.floor(vs.length / 80)) === 0) particle(dim, "minecraft:villager_happy", vs[i].e.location);
        try { vs[i].e.remove(); } catch { }
      }
      try { c.remove(); } catch { }
      // d'abord les blocs « porteurs », puis les blocs accrochés (torches, portes...), de bas en haut
      const rotCache = new Map();
      const order = [...saved].sort((a, b) => (ATTACHED.test(a.id) ? 1 : 0) - (ATTACHED.test(b.id) ? 1 : 0) || a.o.y - b.o.y);
      for (let i = 0; i < order.length; i++) {
        if ((i & 63) === 0) yield;
        const b = order[i];
        const ck = b.id + JSON.stringify(b.st);
        let st = rotCache.get(ck);
        if (!st) { try { st = rotateStates(b.st, q); } catch { st = {}; } rotCache.set(ck, st); }
        const bl = where(b.o);
        put(bl, b.id, st, { x: bl.x + 0.5, y: bl.y + 0.5, z: bl.z + 0.5 });
      }
    })());
  }
  // les blocs qui n'ont pas trouvé de place libre tombent en objets (par piles)
  let stacks = 0;
  for (const [id, cnt] of drops) {
    let left = cnt;
    while (left > 0 && stacks < 200) {
      const k = Math.min(64, left);
      try { dim.spawnItem(new ItemStack(id, k), drops.at ?? loc); } catch { }
      left -= k; stacks++;
    }
  }
  try { if (c.isValid()) c.remove(); } catch { }
  try { p.playSound("random.anvil_land", { pitch: 1.5 }); } catch { }
  bar(p, g.veh ? "§eTon véhicule est redevenu une construction. Reprends ta clé pour le refabriquer !"
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
  if (!vs.length) { try { vs = dim.getEntities({ type: VOX, location: loc, maxDistance: 80 }).filter((v) => v.getDynamicProperty("cr:core") === id); } catch { } }
  groups.delete(id);
  explodeDebris(dim, loc, vs, sp.includes("boom"));
  if (owner) players().find((x) => x.id === owner)?.sendMessage(veh ? `§c${name} a été détruit...` : `§c${name} est retombée en morceaux...`);
});

function explodeDebris(dim, center, vs, boom) {
  // grandes créations : seuls 400 morceaux volent, les autres disparaissent tout de suite
  let alive = vs.filter((v) => v.isValid());
  if (alive.length > 400) {
    alive.sort(() => Math.random() - 0.5);
    for (const v of alive.slice(400)) { try { v.setDynamicProperty("cr:debris", true); particle(dim, "minecraft:large_explosion", v.location); v.remove(); } catch { } }
    alive = alive.slice(0, 400);
  }
  const parts = alive.map((v) => {
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
  player.sendMessage("§a[Créations vivantes v5]§r §eÉtincelle de vie§r : clic TÊTE → clic JAMBES → reclique la tête (tête en plusieurs blocs, bras, ailes, queue, ZONES) → accroupi + clic = VIE ! Jusqu'à 64 × 64 × 64 blocs.");
  player.sendMessage("§a[Véhicules]§r §eClé de véhicule§r : clic SIÈGE → clic ROUES/BAS → reclique le siège (hélices) → accroupi + clic = FABRIQUER !");
});
