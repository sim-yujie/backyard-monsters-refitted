/**
 * Building art in the Inferno yard: one row per type whose art or health
 * differs from the main table's. GENERATED — do not edit by hand.
 *
 * Source: `client/scripts/INFERNOYARDPROPS.as`, which the Flash client swaps
 * in for the whole props table on an Inferno yard. Regenerate with
 * `node tools/gen-building-art.mjs` from `web/`. Rows have the shape of
 * `BUILDING_ART_ROWS` (`buildingArtData.ts`); a type with no row here draws
 * from the main table.
 */

import type { ArtRow } from "./buildingArtData";

export const INFERNO_ART_ROWS: readonly ArtRow[] = [
  // 1 Bone Cruncher (resource) — INFERNOYARDPROPS.as:93
  [1, "Bone Cruncher", "buildings/iboneharvester/", [
    [1,["top.1.v2.png",-48,-33],["top.1.damaged.v2.png",-41,-26],["top.1.destroyed.v2.png",-45,0],["shadow.1.v4.jpg",-53,-1],["shadow.1.damaged.v2.jpg",-51,-2],["shadow.1.destroyed.v4.jpg",-46,-2],[["anim.1.v2.png",-32,-33,65,80,47]]],
    [3,["top.2.png",-44,25],null,null,["shadow.2.jpg",-39,7],null,null,[["anim.2.png",-44,-38,90,97,50]]],
  ], [500,950,1800,3400,6500,12000,24000,45000,85000,165000], 100],
  // 2 Coal Extractor (resource) — INFERNOYARDPROPS.as:216
  [2, "Coal Extractor", "buildings/icoalproducer/", [
    [1,["top.1.v2.png",-32,-40],["top.1.damaged.v2.png",-34,-42],["top.1.destroyed.v2.png",-44,-4],["shadow.1.jpg",-40,14],["shadow.1.damaged.v2.jpg",-64,4],["shadow.1.destroyed.v2.jpg",-50,-2],[["anim.1.v2.png",-21,-45,40,18,47],["anim.2.v2.png",-39,-9,39,63,47]]],
    [3,["top.2.png",-40,-50],["top.2.damaged.png",-39,-52],["top.2.destroyed.png",-43,-9],["shadow.2.jpg",-42,7],["shadow.2.damaged.jpg",-43,5],null,[["anim.1.2.png",-40,-52,74,105,45]]],
  ], [500,950,1800,3400,6500,12000,24000,45000,85000,165000], 100],
  // 3 Sulfur Swirler (resource) — INFERNOYARDPROPS.as:337
  [3, "Sulfur Swirler", "buildings/isulpherproducer/", [
    [1,["top.1.v2.png",-24,-41],["top.1.damaged.v2.png",-45,-48],["top.1.destroyed.v2.png",-34,4],["shadow.1.jpg",-33,13],["shadow.1.damaged.v2.jpg",-49,17],["shadow.1.destroyed.v2.jpg",-34,15],[["anim.1.v2.png",-35,-4,20,50,51],["anim.2.v2.png",-20,-58,34,36,51],["anim.3.v2.png",-11,-14,26,17,51]]],
    [3,["top.2.png",0,-15],["top.2.damaged.png",-38,-62],["top.2.destroyed.png",-45,-6],["shadow.2.jpg",-25,27],["shadow.2.damaged.jpg",-28,30],["shadow.2.destroyed.jpg",-42,12],[["anim1.2.png",-36,-60,60,118,45]]],
  ], [500,950,1800,3400,6500,12000,24000,45000,85000,165000], 100],
  // 4 Magma Pump (resource) — INFERNOYARDPROPS.as:458
  [4, "Magma Pump", "buildings/imagmaproducer/", [
    [1,["top.1.v2.png",-35,-15],["top.1.damaged.v2.png",-39,-36],["top.1.destroyed.v2.png",-37,-2],["shadow.1.v2.jpg",-36,4],["shadow.1.damaged.v2.jpg",-49,2],["shadow.1.destroyed.v2.jpg",-41,6],[["anim.2.v2.png",-32,9,36,26,49],["anim.3.v2.png",-18,-60,34,58,49]]],
    [3,["top.1.v2.png",-35,-15],["top.1.damaged.v2.png",-39,-36],["top.1.destroyed.v2.png",-37,-2],["shadow.1.v2.jpg",-36,4],["shadow.1.damaged.v2.jpg",-49,2],["shadow.1.destroyed.v2.jpg",-41,6],[["anim.2.v2.png",-32,9,36,26,49],["anim.3.v2.png",-18,-60,34,58,49]]],
  ], [500,950,1800,3400,6500,12000,24000,45000,85000,165000], 100],
  // 5 Flinger (special) — INFERNOYARDPROPS.as:547
  [5, "Flinger", "buildings/flinger/", [
    [1,["top.1.png",-46,-43],["top.1.damaged.png",-63,-36],["top.2.destroyed.png",-75,-3],["shadow.1.jpg",-50,20],["shadow.1.damaged.jpg",-63,23],["shadow.2.destroyed.jpg",-70,24]],
    [2,["top.2.png",-45,-40],["top.2.damaged.png",-63,-18],["top.2.destroyed.png",-75,-3],["shadow.2.jpg",-48,19],["shadow.2.damaged.jpg",-63,26],["shadow.2.destroyed.jpg",-70,24]],
    [3,["top.3.png",-47,-45],["top.3.damaged.png",-75,-37],["top.2.destroyed.png",-75,-3],["shadow.3.jpg",-44,20],["shadow.3.damaged.jpg",-73,23],["shadow.2.destroyed.jpg",-70,24]],
    [4,["top.4.png",-45,-66],["top.4.damaged.png",-76,-53],["top.2.destroyed.png",-75,-3],["shadow.4.jpg",-47,22],["shadow.4.damaged.jpg",-76,23],["shadow.2.destroyed.jpg",-70,24]],
  ], [4000,8000,16000,28000], 190],
  // 6 Resource Pod (special) — INFERNOYARDPROPS.as:712
  [6, "Resource Pod", "buildings/istoragesilo/", [
    [1,["top.1.v2.png",-45,-58],["top.1.damaged.v2.png",-47,-56],["top.1.destroyed.v2.png",-54,-14],["shadow.1.v2.jpg",-48,17],["shadow.1.damaged.v2.jpg",-47,17],["shadow.1.destroyed.v2.jpg",-54,12]],
  ], [750,1400,2550,4750,8800,16250,30000,55600,105000,190000], 120],
  // 8 Strongbox (special) — INFERNOYARDPROPS.as:797
  [8, "Strongbox", "buildings/imonsterlab/", [
    [1,["top.1.v2.png",-56,8],null,null,null,null,null,[["anim.1.v2.png",-42,-41,86,88,31]]],
  ], [4000,16000,32000,64000], 120],
  // 11 Map Room (special) — INFERNOYARDPROPS.as:943
  [11, "Map Room", "buildings/maproom/", [
    [1,["top.1.png",-58,-67],["top.1.damaged.png",-73,-44],["top.1.destroyed.png",-70,0],["shadow.1.jpg",-68,15],["shadow.1.damaged.jpg",-67,23],["shadow.1.destroyed.jpg",-67,27]],
  ], [5000,10000], 120],
  // 13 Incubator (special) — INFERNOYARDPROPS.as:1042
  [13, "Incubator", "buildings/ihatchery/", [
    [1,["top.1.v2.png",-55,-28],["top.1.damaged.v2.png",-50,-22],["top.1.destroyed.v2.png",-40,13],["shadow.1.v2.jpg",-77,15],["shadow.1.damaged.v2.jpg",-75,16],["shadow.1.destroyed.v2.jpg",-58,18],[["anim.1.v2.png",-48,-45,33,78,50]]],
  ], [4000,16000,32000], 120],
  // 14 Under Hall (special) — INFERNOYARDPROPS.as:1151
  [14, "Under Hall", "buildings/itownhall/", [
    [1,["top.1.v2.png",-52,-31],["top.1.damaged.v2.png",-56,-33],["top.1.destroyed.v2.png",-63,10],["shadow.1.v2.jpg",-65,49],["shadow.1.damaged.v2.jpg",-65,47],["shadow.1.destroyed.v2.jpg",-68,43]],
    [2,["top.2.v2.png",-50,-46],["top.2.damaged.v2.png",-49,-46],["top.2.destroyed.v2.png",-52,5],["shadow.2.v2.jpg",-70,35],["shadow.2.damaged.v2.jpg",-59,44],["shadow.2.destroyed.v2.jpg",-76,33]],
    [3,["top.3.v2.png",-51,-57],["top.3.damaged.v2.png",-56,-55],["top.3.destroyed.v2.png",-62,-12],["shadow.3.v2.jpg",-74,35],["shadow.3.damaged.v2.jpg",-73,33],["shadow.3.destroyed.v2.jpg",-75,29]],
  ], [4000,8800,20000,42000,94000,200000], 190],
  // 15 Compound (special) — INFERNOYARDPROPS.as:1266
  [15, "Compound", "buildings/monsterhousing/", [
    [1,["top.3.v2.png",-109,11],["top.3.damaged.v2.png",-107,12],["top.3.destroyed.v2.png",-108,21],["shadow.3.v2.jpg",-112,23],["shadow.3.damaged.v2.jpg",-110,25],["shadow.3.destroyed.v2.jpg",-109,25]],
  ], [4000,14000,25000,43000,75000,130000], 200],
  // 17 Block (wall) — INFERNOYARDPROPS.as:1365
  [17, "Block", "buildings/iwalls/", [
    [1,["top.1.v2.png",-24,-5],["top.1.damaged.v2.png",-24,-5],["top.1.destroyed.v2.png",-24,-5],null,null,null],
    [2,["top.2.v2.png",-20,-9],["top.2.damaged.v2.png",-20,-9],["top.2.destroyed.v2.png",-20,-9],null,null,null],
    [3,["top.3.v2.png",-20,-27],["top.3.damaged.v2.png",-20,-27],["top.3.destroyed.v2.png",-18,-8],["shadow.3.v2.jpg",-20,-1],["shadow.3.v2.jpg",-20,-1],["shadow.3.v2.jpg",-20,-1]],
  ], [1000,2300,5750,18000,27000], 50],
  // 20 Blast Tower (tower) — INFERNOYARDPROPS.as:1667
  [20, "Blast Tower", "buildings/icannontower/", [
    [1,["top.1.v2.png",-38,11],["top.1.damaged.v2.png",-38,11],["top.1.destroyed.v2.png",-57,-18],["shadow.1.v2.jpg",-48,11],["shadow.1.v2.jpg",-48,11],["shadow.1.v2.jpg",-55,8],[["anim.1.v2.png",-38,-53,74,64,30]],[["anim.1.damaged.v2.png",-38,-53,74,64,30]]],
  ], [6000,9000,12600,17640,26460,34400,45000,58000,75500,98200], 64],
  // 21 Sharpshooter (tower) — INFERNOYARDPROPS.as:1843
  [21, "Sharpshooter", "buildings/isnipertower/", [
    [1,["top.1.v2.png",-35,-5],["top.1.damaged.v2.png",-40,-9],["top.1.destroyed.v2.png",-43,-8],["shadow.1.v2.jpg",-50,12],["shadow.1.v2.jpg",-50,9],["shadow.1.v2.jpg",-54,2],[["anim.1.v2.png",-56,-86,85,81,30]],[["anim.1.damaged.v2.png",-52,-90,85,81,30]]],
  ], [6000,9000,12600,17640,26460,34400,45000], 64],
  // 22 Monster Bunker (tower) — INFERNOYARDPROPS.as:1929
  [22, "Monster Bunker", "buildings/bunker/", [
    [1,["anim.1.png",-46,-15,90,83],["top.1.damaged.png",-45,-8],["top.1.destroyed.png",-50,4],["shadow.1.jpg",-66,10],["shadow.1.damaged.jpg",-66,5],null,[["anim.1.png",-46,-15,90,83,15]]],
  ], [10000,24500,52000,75000], 120],
  // 23 Laser Tower (tower) — INFERNOYARDPROPS.as:2068
  [23, "Laser Tower", "buildings/lasertower/", [
    [1,["top.1.png",-33,-29],["top.1.damaged.png",-40,-28],["top.1.destroyed.png",-39,-3],["shadow.1.jpg",-36,15],["shadow.1.jpg",-37,-17],["shadow.1.jpg",-37,14],[["anim.1.png",-13,-50,29,32,54]],[["anim.1.damaged.png",-22,-46,52,44,54]]],
  ], [9000,12600,17640,26460,34400,42200], 120],
  // 25 Tesla Tower (tower) — INFERNOYARDPROPS.as:2277
  [25, "Tesla Tower", "buildings/lightningtower/", [
    [1,["top.3.png",-33,-57],["top.3.damaged.png",-46,-58],["top.3.destroyed.png",-46,6],["shadow.3.jpg",-38,18],["shadow.3.jpg",-44,21],["shadow.3.jpg",-44,17],[["anim.3.png",-25,-15,27,53,55]],[["anim.3.damaged.png",-26,-19,30,57,55]]],
  ], [15000,22000,30000,48000,60000,72000], 50],
  // 26 Academy (special) — INFERNOYARDPROPS.as:2360
  [26, "Academy", "buildings/iacademy/", [
    [1,["top.1.png",-50,-55],["top.1.damaged.png",-48,-21],["top.1.destroyed.png",-59,-21],["shadow.1.jpg",-50,-30],null,null],
    [2,["top.2.png",-56,-95],["top.2.damaged.png",-56,-91],["top.2.destroyed.png",-59,-76],["shadow.2.jpg",-61,-30],null,null],
  ], [6000,10000,14000,20000], 50],
  // 113 Radio Tower (special) — INFERNOYARDPROPS.as:5300
  [113, "Radio Tower", "buildings/radiotower/", [
    [1,["top.1.png",-40,-80],["top.1.damaged.png",-40,-83],null,["shadow.1.jpg",-44,7],["shadow.1.damaged.jpg",-44,7],null],
  ], [3400], 80],
  // 115 Aerial Defense Tower (tower) — INFERNOYARDPROPS.as:5468
  [115, "Aerial Defense Tower", "buildings/flaktower/", [
    [1,["top.3.png",-39,6],["top.3.damaged.png",-39,5],["top.3.destroyed.png",-36,13],["shadow.3.jpg",-43,14],["shadow.3.jpg",-40,24],["shadow.3.destroyed.jpg",-33,26],[["anim.3.png",-32,-23,62,52,32]],[["anim.3.damaged.png",-29,-17,62,53,32]]],
  ], [15000,22000,30000,48000,60000,72000], 200],
  // 118 Railgun (tower) — INFERNOYARDPROPS.as:5727
  [118, "Railgun", "buildings/railguntower/", [
    [1,["top.3.png",-39,7],["top.3.damaged.png",-39,7],["top.3.destroyed.png",-34,-5],["shadow.3.jpg",-40,20],["shadow.3.jpg",-40,20],["shadow.3.destroyed.jpg",-36,23],[["anim.3.loaded.png",-49,-9,96,56,32]],[["anim.3.damaged.png",-49,-9,97,56,32]]],
  ], [17640,34400,45000,58000,75500,90000], 64],
  // 119 Champion Chamber (special) — INFERNOYARDPROPS.as:5792
  [119, "Champion Chamber", "buildings/champchamber/", [
    [1,["top.3.png",-66,-62],["top.3.damaged.png",-66,-54],["top.3.png",-73,-32],["shadow.3.jpg",-66,10],["shadow.3.jpg",-66,4],["shadow.3.jpg",-67,14]],
  ], [16000], 64],
  // 127 Inferno Cavern (enemy) — INFERNOYARDPROPS.as:5967
  [127, "Inferno Cavern", "buildings/iportal/", [
    [1,["top.1.v2.png",-85,-5],null,null,["shadow.1.v2.jpg",-43,47],null,null],
    [2,["top.2.v2.png",-105,-29],null,null,["shadow.2.v2.jpg",-87,52],null,null],
    [3,["top.3.v2.png",-136,-64],null,null,["shadow.3.v2.jpg",-110,47],null,null],
    [4,["top.4.v2.png",-140,-114],null,null,null,null,null],
    [5,["top.5.v2.png",-160,-172],null,null,["shadow.5.v2.jpg",-169,0],null,null],
  ], [1,1,1,1,1], 100],
  // 128 Compound (tower) — INFERNOYARDPROPS.as:6050
  [128, "Compound", "buildings/ihousingbunker/", [
    [1,["top.1.v2.png",-110,-49],["top.1.damaged.v2.png",-106,-39],["top.1.destroyed.v2.png",-73,10],["shadow.1.jpg",-118,26],["shadow.1.damaged.jpg",-117,30],["shadow.1.destroyed.jpg",-96,8]],
  ], [4000,14000,25000,43000,75000,130000], 200],
  // 129 Quake Tower (tower) — INFERNOYARDPROPS.as:6180
  [129, "Quake Tower", "buildings/iquaketower/", [
    [1,["anim.1.png",-37,-75,75,132],["top.1.damaged.png",-40,-75],["top.1.destroyed.png",-42,-8],["shadow.1.v2.jpg",-37,17],["shadow.1.v2.jpg",-40,16],["shadow.1.v2.jpg",-44,10],[["anim.1.png",-37,-75,75,132,33]],[["anim.1.damaged.png",-40,-75,84,133,33]]],
  ], [10000,16000,22000,28000,34000,48000], 64],
  // 130 Blast Tower (tower) — INFERNOYARDPROPS.as:6356
  [130, "Blast Tower", "buildings/icannontower/", [
    [1,["top.1.v2.png",-38,11],["top.1.damaged.v2.png",-38,11],["top.1.destroyed.v2.png",-38,11],["shadow.1.v2.jpg",-48,11],["shadow.1.v2.jpg",-48,11],["shadow.1.v2.jpg",-48,11],[["anim.1.v2.png",-38,-53,74,64,30]],[["anim.1.damaged.v2.png",-38,-53,74,64,30]]],
  ], [6000,9000,12600,17640,26460,34400,45000], 64],
  // 132 Magma Tower (tower) — INFERNOYARDPROPS.as:6613
  [132, "Magma Tower", "buildings/imagmatower/", [
    [1,["top.1.v2.png",-34,-9],["top.1.damaged.v2.png",-38,-4],["top.1.destroyed.v2.png",-36,6],["shadow.1.v2.jpg",-31,10],["shadow.1.v2.jpg",-38,16],null,[["anim.1.v2.png",-26,-50,54,42,31],["anim.2.v2.png",-17,26,38,19,31]]],
  ], [15000,22000,30000,49000,59000,70000], 40],
];
