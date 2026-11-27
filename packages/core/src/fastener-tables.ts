// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Andrii Shylenko and kernelCAD contributors
// Copyright (c) 2026 CrispCAD contributors
//
// ISO metric fastener tables as data (hole-driven fastening, convergence Phase 6.2). Values are
// nominal table values from the standards named on each table, not certified geometry. The
// clearance, tap drill, head, nut, washer and stocked-length rows were ported from the kernel lab's
// src/modeling/parts/fastenerStockTables.ts, fastenerIsoDims.ts and holeInsert.ts (MIT, see
// THIRD-PARTY-NOTICES.md); keys changed from `M2_5` to `M2.5`, tables regrouped by thread. The
// counterbore and heat-set insert rows are new here.

export const METRIC_THREADS=['M2','M2.5','M3','M4','M5','M6','M8','M10','M12','M16','M20'] as const;
export type MetricThread=typeof METRIC_THREADS[number];
export type ClearanceFit='close'|'normal'|'loose';
export const CLEARANCE_FITS:readonly ClearanceFit[]=['close','normal','loose'];

export interface ThreadRow {
 /** Nominal (major) diameter d, mm. */
 readonly nominal:number;
 /** ISO 261 coarse pitch P, mm. */
 readonly pitch:number;
 /** ISO 273 clearance holes: fine (close), medium (normal), coarse (loose) series, mm. */
 readonly clearance:Readonly<Record<ClearanceFit,number>>;
 /** Tap drill for the coarse thread (ISO 2306 / DIN 336), mm. */
 readonly tapDrill:number;
}
export const THREADS:Readonly<Record<MetricThread,ThreadRow>>={
 M2:{nominal:2,pitch:.4,clearance:{close:2.2,normal:2.4,loose:2.6},tapDrill:1.6},
 'M2.5':{nominal:2.5,pitch:.45,clearance:{close:2.7,normal:2.9,loose:3.1},tapDrill:2.05},
 M3:{nominal:3,pitch:.5,clearance:{close:3.2,normal:3.4,loose:3.6},tapDrill:2.5},
 M4:{nominal:4,pitch:.7,clearance:{close:4.3,normal:4.5,loose:4.8},tapDrill:3.3},
 M5:{nominal:5,pitch:.8,clearance:{close:5.3,normal:5.5,loose:5.8},tapDrill:4.2},
 M6:{nominal:6,pitch:1,clearance:{close:6.4,normal:6.6,loose:7},tapDrill:5},
 M8:{nominal:8,pitch:1.25,clearance:{close:8.4,normal:9,loose:10},tapDrill:6.8},
 M10:{nominal:10,pitch:1.5,clearance:{close:10.5,normal:11,loose:12},tapDrill:8.5},
 M12:{nominal:12,pitch:1.75,clearance:{close:13,normal:13.5,loose:14.5},tapDrill:10.2},
 M16:{nominal:16,pitch:2,clearance:{close:17,normal:17.5,loose:18.5},tapDrill:14},
 M20:{nominal:20,pitch:2.5,clearance:{close:21,normal:22,loose:24},tapDrill:17.5},
};
/** ISO 68-1 external thread depth h3 = 0.61343 P (basic profile, root to crest). */
export const EXTERNAL_THREAD_DEPTH=.61343;

/** Head diameter dk max, head height k max; socket across flats s and depth t (min). */
export interface SocketHead {readonly dk:number;readonly k:number;readonly s:number;readonly t:number}
/** ISO 4762 Table 1 socket head cap screws. */
export const ISO_4762:Readonly<Partial<Record<MetricThread,SocketHead>>>={
 M2:{dk:3.8,k:2,s:1.5,t:1},'M2.5':{dk:4.5,k:2.5,s:2,t:1.1},M3:{dk:5.5,k:3,s:2.5,t:1.3},M4:{dk:7,k:4,s:3,t:2},
 M5:{dk:8.5,k:5,s:4,t:2.5},M6:{dk:10,k:6,s:5,t:3},M8:{dk:13,k:8,s:6,t:4},M10:{dk:16,k:10,s:8,t:5},
 M12:{dk:18,k:12,s:10,t:6},M16:{dk:24,k:16,s:14,t:8},M20:{dk:30,k:20,s:17,t:10},
};
/** ISO 7380-1 button head (dk max, k max, socket s, t). */
export const ISO_7380:Readonly<Partial<Record<MetricThread,SocketHead>>>={
 M3:{dk:5.7,k:1.65,s:2,t:1.04},M4:{dk:7.6,k:2.2,s:2.5,t:1.3},M5:{dk:9.5,k:2.75,s:3,t:1.56},
 M6:{dk:10.5,k:3.3,s:4,t:2.08},M8:{dk:14,k:4.4,s:5,t:2.6},M10:{dk:17.5,k:5.5,s:6,t:3.12},
};
/** ISO 10642:2004 Table 1, 90° countersunk head: theoretical dk max, k max, socket s, t min. */
export const ISO_10642:Readonly<Partial<Record<MetricThread,SocketHead>>>={
 M3:{dk:6.72,k:1.86,s:2,t:1.1},M4:{dk:8.96,k:2.48,s:2.5,t:1.5},M5:{dk:11.2,k:3.1,s:3,t:1.9},
 M6:{dk:13.44,k:3.72,s:4,t:2.2},M8:{dk:17.92,k:4.96,s:5,t:3},M10:{dk:22.4,k:6.2,s:6,t:3.6},M12:{dk:26.88,k:7.44,s:8,t:4.3},
};
/** ISO 4017 hex head screws: width across flats s, head height k (nominal). */
export const ISO_4017:Readonly<Partial<Record<MetricThread,{readonly s:number;readonly k:number}>>>={
 M3:{s:5.5,k:2},M4:{s:7,k:2.8},M5:{s:8,k:3.5},M6:{s:10,k:4},M8:{s:13,k:5.3},M10:{s:16,k:6.4},M12:{s:18,k:7.5},M16:{s:24,k:10},M20:{s:30,k:12.5},
};
/** ISO 4026 flat-point set screws: socket s and t. */
export const ISO_4026:Readonly<Partial<Record<MetricThread,{readonly s:number;readonly t:number}>>>={
 M3:{s:1.5,t:1.2},M4:{s:2,t:1.5},M5:{s:2.5,t:2},M6:{s:3,t:2},M8:{s:4,t:3},M10:{s:5,t:4},M12:{s:6,t:4.8},
};
/** ISO 4032 style 1 hex nuts: width across flats s and height m max. */
export const ISO_4032:Readonly<Record<MetricThread,{readonly s:number;readonly m:number}>>={
 M2:{s:4,m:1.6},'M2.5':{s:5,m:2},M3:{s:5.5,m:2.4},M4:{s:7,m:3.2},M5:{s:8,m:4.7},M6:{s:10,m:5.2},
 M8:{s:13,m:6.8},M10:{s:16,m:8.4},M12:{s:18,m:10.8},M16:{s:24,m:14.8},M20:{s:30,m:18},
};
/** ISO 7089 plain washers, product grade A: inner d1, outer d2, thickness h. */
export const ISO_7089:Readonly<Record<MetricThread,{readonly d1:number;readonly d2:number;readonly h:number}>>={
 M2:{d1:2.2,d2:5,h:.3},'M2.5':{d1:2.7,d2:6,h:.5},M3:{d1:3.2,d2:7,h:.5},M4:{d1:4.3,d2:9,h:.8},M5:{d1:5.3,d2:10,h:1},
 M6:{d1:6.4,d2:12,h:1.6},M8:{d1:8.4,d2:16,h:1.6},M10:{d1:10.5,d2:20,h:2},M12:{d1:13,d2:24,h:2.5},M16:{d1:17,d2:30,h:3},M20:{d1:21,d2:37,h:3},
};
/** Counterbores for ISO 4762 heads (DIN 974-1, the series for cap screws without washers):
 * diameter and depth, so the head sits just below the face. Nominal values. */
export const COUNTERBORE_4762:Readonly<Record<MetricThread,{readonly diameter:number;readonly depth:number}>>={
 M2:{diameter:4.4,depth:2.4},'M2.5':{diameter:5.5,depth:2.9},M3:{diameter:6.5,depth:3.4},M4:{diameter:8,depth:4.4},
 M5:{diameter:10,depth:5.4},M6:{diameter:11,depth:6.4},M8:{diameter:15,depth:8.6},M10:{diameter:18,depth:10.6},
 M12:{diameter:20,depth:12.6},M16:{diameter:26,depth:16.6},M20:{diameter:33,depth:20.6},
};
/** Brass heat-set inserts for thermoplastics. There is no ISO standard: these are typical
 * catalogue values (pocket diameter as manufacturers recommend for printed parts, outer knurl
 * diameter, length). Check the supplier's datasheet. */
export const HEAT_SET_INSERTS:Readonly<Partial<Record<MetricThread,{readonly pocket:number;readonly outer:number;readonly length:number}>>>={
 M2:{pocket:3.2,outer:3.6,length:3},M3:{pocket:4,outer:4.6,length:5.7},M4:{pocket:5.6,outer:6.3,length:8.1},M5:{pocket:6.4,outer:7.1,length:9.5},
};
/** A heat-set pocket is this much deeper than the insert, for displaced plastic. */
export const HEAT_SET_POCKET_EXTRA=1;

/** Stocked nominal lengths l per thread (a preferred-series subset). */
export const STOCK_LENGTHS:Readonly<Record<'socket-head'|'button-head'|'countersunk'|'hex-bolt'|'set-screw',Readonly<Partial<Record<MetricThread,readonly number[]>>>>>={
 'socket-head':{
  M2:[4,5,6,8,10,12,16,20],'M2.5':[4,5,6,8,10,12,16,20,25],M3:[4,5,6,8,10,12,14,16,18,20,25,30],
  M4:[4,5,6,8,10,12,14,16,18,20,25,30,35,40],M5:[5,6,8,10,12,14,16,18,20,25,30,35,40,45,50],
  M6:[6,8,10,12,14,16,18,20,25,30,35,40,45,50,55,60],M8:[8,10,12,14,16,18,20,25,30,35,40,45,50,55,60,70,80],
  M10:[10,12,16,20,25,30,35,40,45,50,55,60,70,80,90,100],M12:[12,16,20,25,30,35,40,45,50,55,60,70,80,90,100,110,120],
  M16:[16,20,25,30,35,40,45,50,55,60,70,80,90,100,110,120,130,140,150,160],
  M20:[20,25,30,35,40,45,50,55,60,70,80,90,100,110,120,130,140,150,160,180,200],
 },
 'button-head':{
  M3:[5,6,8,10,12,14,16,18,20],M4:[5,6,8,10,12,14,16,18,20,25],M5:[6,8,10,12,14,16,18,20,25,30],
  M6:[6,8,10,12,14,16,18,20,25,30,35,40],M8:[8,10,12,14,16,18,20,25,30,35,40,45,50],M10:[10,12,16,20,25,30,35,40,45,50,55,60],
 },
 countersunk:{
  M3:[6,8,10,12,14,16,18,20,25],M4:[6,8,10,12,14,16,18,20,25,30],M5:[6,8,10,12,14,16,18,20,25,30,35,40],
  M6:[6,8,10,12,14,16,18,20,25,30,35,40,45,50],M8:[8,10,12,14,16,18,20,25,30,35,40,45,50,60],
  M10:[10,12,16,20,25,30,35,40,45,50,60,70,80],M12:[12,16,20,25,30,35,40,45,50,60,70,80,90,100],
 },
 'hex-bolt':{
  M3:[8,10,12,16,20,25,30],M4:[8,10,12,16,20,25,30,35,40],M5:[10,12,16,20,25,30,35,40,45,50],
  M6:[12,16,20,25,30,35,40,45,50,55,60],M8:[16,20,25,30,35,40,45,50,55,60,70,80],
  M10:[20,25,30,35,40,45,50,55,60,70,80,90,100],M12:[25,30,35,40,45,50,55,60,70,80,90,100,110,120],
  M16:[30,35,40,45,50,55,60,70,80,90,100,110,120,130,140,150,160],M20:[40,45,50,55,60,70,80,90,100,110,120,130,140,150,160,180,200],
 },
 'set-screw':{
  M3:[4,5,6,8,10,12,16,20],M4:[5,6,8,10,12,16,20,25],M5:[5,6,8,10,12,16,20,25,30],M6:[6,8,10,12,16,20,25,30,35,40],
  M8:[8,10,12,16,20,25,30,35,40,45,50],M10:[10,12,16,20,25,30,35,40,45,50,55,60],M12:[12,16,20,25,30,35,40,45,50,55,60,70,80],
 },
};
