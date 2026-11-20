/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/* Axel, the official AX mascot (https://github.com/google/ax/blob/main/assets/axel.svg, art by Nan Hockin).
   Exact official vector paths stored once in <defs>, layered so Axel's eyes and expressions respond gently to task state. */
'use strict';

/* The tail's outline in viewBox units, traced along the official art's ink so the cut never shows at rest. */
const AXO_TAIL_D = 'M405 322 L410 311 L427 320 L444 340 L453 371 L454 396 L452 422 L446 455 L427 486 L409 504 L383 522 L353 542 L323 560 L298 575 L280 589 L267 588 L253 574 L241 558 L235 537 L234 514 L238 492 L246 474 L252 460 L254 450 L262 449 L278 449 L291 449 L297 456 L305 461 L317 464 L330 461 L343 454 L351 445 L361 440 L373 430 L383 418 L392 402 L398 393 L406 389 L406 360 L405 335 Z';
/* The six feathery gills (Axel's "ears"), three a side. Each region's inner edge runs down the middle of the black band
   where the gills meet the head, so the pieces recombine invisibly at rest and can flutter from their roots. */
const AXO_GILL_L_D = 'M146 -40 L146 82 L143 97 L141 112 L136 135 L131 152 L127 172 L124 198 L121 212 L104 233 L-60 246 L-60 -40 Z';
const AXO_GILL_R_D = 'M418 -40 L418 92 L421 106 L426 125 L433 150 L436.5 175 L437 200 L436 214 L441 232 L450 252 L620 252 L620 -40 Z';

const AXO_DEFS = `<svg width="0" height="0" style="position:absolute;width:0;height:0;overflow:hidden" aria-hidden="true" focusable="false"><defs>
  <g id="axel-body-art" transform="translate(-883.9422,152.08753)">
    <path fill="#f5dce2" d="m 1128.8661,-103.29035 -36.7082,13.354778 c -24.0488,7.495135 -35.2188,19.819812 -48.4921,31.355766 -12.6061,14.345678 -22.4526,29.496258 -26.6159,46.304445 -4.9485,14.8661205 -8.6033,30.055698 -6.5629,46.669047 l -10.2088,22.605319 0.3582,33.007815 20.4241,26.0577 28.0744,15.31328 -28.8036,17.13629 -3.2814,21.51151 18.5947,14.94868 18.5947,3.28142 0.3646,36.46019 8.7504,12.76107 c -7.6139,2.74318 -12.6282,10.36044 -17.4718,18.29783 l 2.1585,25.819 20.7823,14.94869 23.3346,-1.823 15.6779,-16.7717 39.377,12.03187 21.0638,0.25076 c -2.0743,24.54123 -5.3463,49.13038 1.0549,73.33259 l 5.6049,13.96166 41.4439,-10.5261 c 19.6653,-13.49325 39.7843,-26.63749 50.5436,-46.98157 l 17.3584,-42.61389 1.0893,-41.68659 -3.6207,-40.53337 -1.0938,-24.06373 -11.3027,-21.87612 -17.1363,-9.11504 29.8974,-17.1363 24.4283,-28.07434 13.8549,-28.803555 4.0106,-32.814175 -7.292,-39.377009 -24.793,-41.200019 -33.1787,-28.074347 -39.0448,-21.901991 -36.4601,-9.805574 z"/>
    <path fill="#eea0bb" d="m 1172.3606,-61.200601 c -11.7102,-11.647469 4.1126,-26.924281 15.3153,-21.322694 13.4935,6.747333 9.022,18.136831 5.6525,21.361983 -6.0011,5.744252 -14.8728,5.953375 -20.9678,-0.03929 z"/>
    <path fill="#eea0bb" d="m 1213.5444,-44.129701 c -11.0642,-14.537695 4.3608,-31.871443 17.7577,-28.1209 21.3749,5.984294 17.36,23.316472 16.1601,26.068056 -6.9434,15.060996 -25.0582,13.693678 -33.9178,2.052844 z"/>
    <path fill="#eea0bb" d="m 1063.1594,-33.442979 c -5.0299,-1.111829 -8.4707,-5.457285 -8.136,-10.275381 0.9115,-13.124917 20.3045,-20.176145 26.3548,-9.582526 5.2021,9.108627 -6.946,22.349675 -18.2188,19.857907 z"/>
    <path fill="#e4769d" d="m 975.98258,-97.132755 c -0.0192,0.02604 -0.82056,0.468394 -1.33429,0.744141 -3.70205,1.987064 -6.80579,5.12175 -9.36894,8.501806 -2.42689,3.200363 -4.49835,6.2259 -4.71857,10.443291 -0.50952,0.915135 -0.87297,1.193911 -0.84026,3.453019 v 0.0041 0.0041 c -0.005,-0.34449 -0.0124,2.406318 -0.0351,4.873088 0.0783,27.269707 15.50647,38.158707 15.92766,38.450916 0.10025,0.06955 0.20392,0.144153 0.29301,0.209806 -0.0891,-0.10163 -0.21927,-0.265399 -0.41187,-0.528133 0.19405,0.264524 0.33244,0.43402 0.43719,0.546736 0.0609,0.04511 0.11366,0.08505 0.15244,0.115239 0.0131,0.01018 0.0247,0.01984 0.0341,0.02739 -3e-4,-7.1e-5 -10e-4,-4.72e-4 -0.002,-5.16e-4 -0.004,-2.93e-4 -0.008,0.0019 -0.0139,0.0026 -0.0305,-0.02112 -0.061,-0.04241 -0.0915,-0.06356 0.0231,0.02219 0.0439,0.04142 0.0636,0.05788 -0.0197,-0.0093 -0.0496,-0.03193 -0.0992,-0.08268 -10.06073,-15.018021 -47.25972,-25.48838 -44.15699,-1.114661 0.4721,3.708617 -0.005,6.490594 0.4532,9.025289 -7.4222,12.9876899 26.14636,45.486945 49.4822,42.245967 1.84422,-0.256133 3.57115,0.113126 5.37073,-0.113171 v 0.643888 c -24.91898,1.851251 -32.00946,-4.796707 -43.84693,0.848527 -6.8874,3.284576 -10.23667,11.293116 -7.04298,18.318262 5.1171,11.256045 10.39417,17.41261 18.50584,20.757906 3.05552,1.260116 4.98943,1.8926 8.84959,2.902148 2.19216,0.57329 4.26778,-0.06863 6.48591,0.740007 29.93268,8.482599 45.09988,-38.69591 40.24268,-61.3590745 0.7342,-3.6317335 1.7744,-8.1675643 2.9548,-12.7795815 1.5533,-6.068721 5.402,-15.315668 10.7895,-25.484233 l 3.7988,-7.171655 -6.1681,-3.158464 c -3.3942,-1.737134 -23.34015,-39.486568 -23.14675,-38.859123 -0.41932,-1.360319 -1.37611,-1.613948 -1.11931,-2.36368 2.1778,-6.358071 -16.31618,-16.796879 -21.44456,-9.837574 z m -0.007,66.759243 c 0.0119,0.0083 0.0238,0.01656 0.0357,0.0248 -0.0242,-0.02325 -0.0507,-0.05003 -0.0796,-0.08113 -0.008,-0.0062 -0.0167,-0.01227 -0.0253,-0.0186 0.0265,0.03019 0.0495,0.05472 0.0692,0.07493 z"/>
    <path fill="#eea0bb" d="m 1040.9806,-14.332257 c -6.4494,-3.187043 -3.8217,-13.875893 4.3931,-17.87033 3.4724,-1.688469 7.369,-0.853703 9.4128,2.016526 4.9067,6.890856 -6.1801,19.622213 -13.8059,15.853804 z"/>
    <path fill="#e4769d" d="m 1365.8663,-101.56245 c -24.5468,9.205043 -32.3292,35.75736 -46.7183,55.641082 0.019,-0.0126 0.031,-0.01532 0.036,-0.01344 h 5e-4 l 6e-4,5.16e-4 5e-4,5.17e-4 c 10e-5,2.17e-4 4e-4,0.0013 5e-4,0.0016 v 5.16e-4 l 5e-4,5.17e-4 c 10e-5,5.03e-4 0,0.0012 0,0.0016 6e-4,0.01184 -0.015,0.03669 -0.031,0.04703 -0.026,0.01709 -0.074,0.04419 -0.124,0.07235 -0.1351,0.133112 -0.268,0.277068 -0.4031,0.435632 0.1726,-0.203599 0.2945,-0.336888 0.3793,-0.422196 -0.055,0.03018 -0.11,0.05928 -0.1452,0.07596 -1.9112,0.905373 -3.6625,1.941793 -5.3485,3.167765 0.015,-0.01085 0.024,-0.0189 0.027,-0.02274 l 5e-4,-5.17e-4 v -5.17e-4 l 5e-4,-5.17e-4 v -5.16e-4 l -5e-4,-5.17e-4 c 0.5205,0.744088 -3.6765,1.286611 -3.8944,1.674833 -1.0774,0.0066 -2.8475,0.242231 -4.2943,1.513086 -0.845,0.742128 -1.5671,2.013343 -1.7714,3.11919 -0.4087,2.211692 15.4954,39.84759 17.855,42.7245564 4.4416,5.4155866 2.2943,55.4953066 -0.098,55.5604346 -0.2539,0.0069 -0.1673,0.475184 -0.2316,0.606165 0.063,-0.111496 0.1796,-0.312097 0.3757,-0.629419 -1.2397,2.005962 -0.7899,4.108482 -0.3689,5.148523 0.421,1.040041 0.8872,1.628375 1.3534,2.189014 0.9324,1.121279 2.6105,1.54364 3.2013,2.990515 20.8028,20.497656 46.3459,10.950516 60.0666,-8.01341 15.3055,-26.361374 -8.5053,-34.157802 -28.8499,-29.493807 -4.4968,1.030899 -9.2116,-0.824545 -9.463,-0.906404 -1.0653,-0.346858 -1.871,-0.495326 -2.8515,-0.658358 -2.5281,-0.420425 -4.9834,-0.658327 -7.0484,-1.042729 0,0 3.1298,-3.316371 4.6372,-3.55699 0.6653,-0.106208 2.9166,-0.409832 4.6566,-0.621151 1.9914,-0.241834 3.6926,-0.452639 5.4627,-0.980302 3.1995,-0.953713 4.5186,-1.404235 6.9748,-2.390552 1.2816,-0.514679 3.5033,-1.354464 4.6953,-1.775602 2.9159,-1.030151 3.9337,-1.468617 7.8398,-3.40806 3.9072,-1.939999 6.0655,-3.272529 9.0175,-5.57227 1.1584,-0.902388 2.7447,-2.086391 3.1327,-2.357479 4.6826,-3.2719606 9.2535,-7.9040091 11.6561,-12.6560751 0.175,-0.3461131 0.554,-1.0255225 0.5648,-1.0433471 0.1766,-0.2923723 0.7542,-1.2491645 1.2852,-2.1285523 5.1138,-8.4681075 6,-18.0615125 1.4862,-25.7638025 -2.1573,-3.681117 -5.8058,-5.749709 -9.5937,-6.638871 -11.82,-2.602506 -20.3273,6.872227 -29.266,12.873063 -0.2667,0.147047 -0.2625,0.154057 -0.2852,0.177767 -0.3483,-0.109434 -0.6957,-0.202399 -1.0666,-0.310575 0.027,-0.09809 0.01,-0.17894 0.053,-0.24598 0.021,-0.03148 10.5973,-13.07926 12.2741,-16.078103 1.2396,-2.216987 4.1335,-7.158429 6.0353,-10.300664 8.1079,-13.396489 9.6474,-25.227936 4.5682,-37.838 -1.4412,-3.578165 -3.2367,-6.156198 -5.9041,-8.449097 -2.9536,-2.539053 -6.1101,-4.489662 -9.88,-4.701522 z m -46.8566,55.76559 c 0.01,-0.0044 0.016,-0.009 0.024,-0.01344 0.038,-0.03793 0.077,-0.0748 0.1162,-0.111104 -0.027,0.01832 -0.072,0.05592 -0.14,0.12454 z m -9.4222,4.902543 c 1.863,0.65107 -0.1726,0.01549 -0.1824,0.01344 h -5e-4 c 0,-0.0025 0.931,0.914239 0.1829,-0.01344 z"/>
    <path fill="#eea0bb" d="m 1031.1102,58.1679 c -0.1042,-14.517528 18.6025,-19.499493 31.2746,-8.329304 5.3566,4.721797 7.1177,12.501427 4.2543,18.793121 -6.8746,15.104913 -35.4059,6.70198 -35.5289,-10.463817 z"/>
    <path fill="#e4769d" d="m 1280.3516,165.41402 c 3.3568,-0.4196 6.4564,54.27171 1.518,55.83169 4.5607,21.76222 4.4273,38.76028 0.2884,60.62517 -7.578,47.80265 -56.2923,90.41596 -89.7157,91.52177 -2.7764,0.0919 -7.2415,1.42165 -11.3399,1.93528 -0.8223,0.10307 -1.6379,0.23755 -2.3843,0.38861 -0.7371,0.14918 -1.16,0.17039 -2.2578,0.62528 -0.1017,-0.009 -0.3867,-0.0572 -1.0315,-0.26562 -1.0944,-0.35376 -2.0556,-0.64543 -3.2654,-0.84594 0.9238,0.1531 1.2725,0.26474 1.3054,0.2558 2e-4,-1.1e-4 0,-9e-4 0,-0.001 v -5.2e-4 l 5e-4,-5.2e-4 v -5.1e-4 c 0,-2.3e-4 -4e-4,-0.001 -5e-4,-0.002 -0.02,-0.0396 -0.626,-0.3302 -1.0904,-1.0914 -2.9507,-4.8359 -4.2639,-10.46197 -6.2771,-32.875 -0.4313,-4.80345 -0.7233,-22.11617 -0.5276,-37.45301 l 0.1504,-11.83804 -5.3165,-0.45475 c -3.2302,-0.27671 -5.072,-0.48085 -7.2208,-0.18397 -0.5371,0.0742 -1.1268,0.16323 -1.9843,0.55294 -0.8576,0.38972 -2.2708,1.32318 -2.9177,3.12126 -0.6469,1.79807 -0.1235,3.51797 0.3282,4.37854 0.04,0.0761 0.07,0.0753 0.109,0.1447 0.011,0.0795 0.014,0.0838 0.025,0.1757 2.7437,19.04196 -8.6955,36.05853 -16.6269,52.45519 -0.9406,2.03245 -1.5622,4.41185 -2.4339,7.91011 -5.1073,12.75978 8.1462,51.97938 18.0802,59.76218 l 7.0624,5.69996 c 2.4386,1.19553 5.6811,1.33712 8.3612,0.44339 0.4787,-0.15963 0.9299,-0.4539 1.3948,-0.65578 l 3.4839,-0.9677 c 8.5731,-6.29701 69.9767,-37.20108 112.0265,-75.28994 21.0144,-19.03487 33.3414,-44.36852 39.5314,-60.31882 27.3776,-70.54627 -27.0335,-131.13199 -39.275,-123.58305 z m -0.01,0.0222 c -0.022,0.0785 -0.019,0.0641 -0.01,0.0233 0,-0.007 0.01,-0.0148 0.01,-0.0233 z m -166.6487,8.95088 c 0.3735,0.62241 0.7379,1.08209 1.0449,1.38906 -0.7369,-0.73681 -0.9571,-1.12356 -1.0449,-1.38906 z m 27.6942,76.45373 c 0,0 0.01,1.9e-4 0.01,5.2e-4 h 5e-4 v 5.1e-4 c 0,7.9e-4 -0.012,0.002 -0.031,5.2e-4 0.01,-10e-4 0.016,-0.002 0.021,-0.002 z"/>
    <path fill="#eea0bb" d="m 1269.7942,72.930509 c 2.8233,-14.24074 -14.6182,-22.640474 -29.1592,-14.043261 -6.1467,3.634178 -9.3347,10.945879 -7.7012,17.662746 3.9218,16.125704 33.5224,13.21907 36.8604,-3.619485 z"/>
    <path fill="#eea0bb" d="m 1264.0311,-14.752291 c -7.2049,-2.215936 -12.7665,-10.733095 -11.1339,-17.050999 3.4706,-13.431576 19.7885,-11.949024 24.9284,-1.096798 4.9745,10.503424 -3.2916,21.378061 -13.7945,18.147797 z"/>
    <path fill="#0a0b0e" d="m 1029.5524,-52.593345 c -2.805,3.427382 -10.162,-0.685713 -13.2254,-6.247499 -10.092,-18.322711 -11.2078,-45.379406 -33.95844,-46.374976 -4.68911,-0.0428 -10.03763,1.63741 -16.18177,5.580386 -17.31429,11.111369 -15.77813,30.943108 -11.52124,49.277612 0.77715,3.34721 0.82227,2.618097 -2.87839,0.729671 -3.16534,-1.615257 -6.91842,-3.299445 -11.8432,-2.249992 -17.06018,3.971357 -19.98971,25.863024 -15.11775,40.492132 3.28825,9.3219817 10.65669,16.8914855 17.19101,22.231171 2.29086,1.872039 2.29121,1.961673 -0.63045,2.897498 -8.24863,2.346411 -22.36144,10.30444 -9.40977,36.841162 11.01952,20.930643 33.81036,21.804314 54.44423,19.828243 4.58313,-0.47179 3.91856,-0.615989 4.25503,2.025716 3.05311,31.456651 23.52044,45.483621 48.59344,58.121001 1.4056,0.63301 1.4011,1.29564 -0.01,1.32034 -3.2708,0.0571 -21.9518,8.81907 -26.322,24.34993 -6.7316,23.92327 21.8524,34.68802 36.7751,34.79212 1.0888,0.008 1.1249,0.0957 0.711,1.72703 -4.9965,20.73274 3.9232,41.14769 5.8374,44.27585 -42.381,34.5499 16.2675,95.69157 52.9198,47.30468 10.5079,4.08223 22.9843,6.47376 33.1292,10.45879 1.6239,25.37512 -17.0566,41.89236 -19.5208,68.10799 -4.585,35.5496 25.4314,63.69142 34.8263,68.34208 2.7692,1.37081 4.2464,0.45114 5.9415,-0.33798 9.9844,-4.64815 14.7084,-7.96703 25.9912,-15.31214 38.7107,-25.20071 46.891,-27.48517 81.2898,-51.06726 64.5236,-44.23417 63.3436,-122.05933 61.7088,-135.26616 -1.2267,-22.8531 -22.1248,-58.45317 -50.4548,-67.74935 -3.5754,-8.08352 -8.9583,-14.94812 -16.7148,-19.33991 -1.3477,-0.70144 -1.5873,-0.92308 -1.3327,-1.2299 1.0089,-1.21563 19.1378,-10.89435 33.4031,-26.55341 12.942,-13.45948 22.9202,-34.848016 23.9531,-37.813203 0.7128,-2.0464 0.8039,-2.060658 2.9553,-0.461988 13.2537,10.174155 28.2229,14.369945 44.7611,9.883118 8.6914,-2.752077 14.1312,-8.189561 19.2567,-15.132927 5.8249,-7.890846 8.0868,-16.745912 8.4817,-21.783683 -0.1521,-4.663619 -2.3126,-13.766721 -9.7493,-18.525484 -3.4051,-2.013928 -6.7763,-2.827544 -10.6805,-2.979663 -2.4142,-0.07121 -2.452,-0.309129 -0.2408,-1.513603 5.7146,-3.196981 10.8117,-7.298334 15.9474,-11.331608 7.5149,-6.0058802 12.3942,-14.50086937 14.8637,-23.9726968 5.3328,-20.4540832 -4.2783,-35.1693412 -26.4121,-34.2656122 18.3622,-25.328372 11.8749,-53.221984 -5.2327,-61.83344 -28.368,-14.27962 -41.5636,20.643392 -53.1084,41.312729 -2.7913,4.942333 -9.2516,17.880696 -20.0494,19.63291 -0.6904,0.112037 -1.8751,-0.57269 -3.2493,-2.390313 -76.1059,-100.667656 -216.9166,-69.917036 -269.3919,-5.799361 z m 349.1243,-31.444728 c 3.2857,8.64387 1.2958,19.749463 -4.8791,29.84224 -1.1577,1.892237 -4.0118,6.708158 -5.5361,9.341549 -3.9529,6.828899 -3.9524,6.828008 -9.4356,13.229167 -11.6553,12.813843 -5.173,16.36621 4.6951,9.080599 8.6484,-6.385053 27.478,-15.654481 31.8515,-4.432501 4.6573,11.950402 -2.0805,20.3640976 -2.6619,21.4133599 -5.3291,9.6169326 -18.8516,18.8852491 -23.1639,20.9584111 -17.0638,8.203524 -24.2286,11.22029 -27.6408,12.434621 -18.9966,6.760393 10.0045,9.639173 21.5176,8.993498 34.5664,-1.938547 19.515,23.428222 16.0264,28.36264 -2.0907,3.246307 -14.4121,17.30997 -29.6147,13.297379 -7.8993,-2.085105 -17.3529,-5.68268 -23.0777,-11.683007 -1.4596,-1.52992 -1.2514,-1.652718 -1.1565,-2.699577 2.5502,-28.128138 8.7812,-40.857453 -16.676,-97.686544 -1.0069,-2.247765 -1.0558,-1.848046 1.0248,-2.620512 29.2885,-10.873911 34.5249,-61.373956 54.4097,-60.711073 7.9094,0.471762 11.8113,6.287408 14.3172,12.87975 z m -75.1188,65.433351 c 30.659,57.071048 6.8483,140.205552 -64.8751,158.412552 -5.0291,1.27662 -7.1449,3.4974 -5.8141,6.10247 0.9806,1.91968 1.9655,2.27732 5.8415,2.1208 9.0744,-0.15724 20.7648,-1.31034 27.5968,5.77278 8.0801,8.54906 15.0975,25.31335 13.5516,45.81683 -0.5599,7.42527 -3.5925,31.02632 -17.1318,54.76875 -6.0606,10.62794 -17.7488,20.96937 -30.9852,28.03912 -3.4535,1.84456 -4.3874,2.62659 -5.2079,4.36098 -0.9445,1.99632 -18.4508,18.28044 -34.2284,12.47469 -11.3634,-4.18153 -18.9067,-26.58274 -0.417,-52.5477 14.2478,-18.72612 32.52,-14.81179 33.862,-17.30385 1.3629,-2.53067 -1.7716,-4.28567 -7.5453,-4.22507 -18.1137,0.19009 -49.2904,22.99126 -45.652,58.07191 0.2682,2.58671 0.5919,2.45439 -5.8684,2.40089 -27.8441,-0.23059 -50.1324,-8.77319 -65.5577,-17.38706 -3.531,-1.97182 -70.9447,-40.69859 -31.7294,-101.99015 3.0389,-4.27997 3.4855,-5.62885 2.2991,-6.94531 -2.4759,-2.74738 -11.4127,7.68849 -16.2207,18.94147 -1.4852,3.476 -1.3207,3.34956 -2.1575,3.71502 -2.4011,-0.79537 -10.7689,0.16673 -19.3957,-3.80183 -11.2569,-5.17851 -15.7731,-14.62045 -12.0111,-22.68027 1.9968,-5.51144 14.1155,-17.64689 34.7653,-19.79052 6.1253,-0.63586 7.7646,-0.56015 16.9333,0.78031 4.1812,0.61128 9.0263,2.01232 11.5724,3.34657 1.2204,0.63958 2.9706,0.22331 3.5187,-0.83665 1.2402,-2.39835 -1.0068,-4.9153 -5.9087,-6.61871 -8.5358,-2.96613 -12.3316,-4.16553 -19.6334,-4.1951 -34.9138,-0.14141 -78.09304,-47.084728 -52.4309,-78.047428 1.4397,-1.737113 2.9523,-4.063118 2.9533,-4.537708 4e-4,-0.2293 0.314,-1.30086 0.6971,-2.38125 2.4642,-6.95001 -8.0738,-56.181727 27.866,-91.922554 31.5193,-35.402235 75.3471,-50.794285 121.9495,-52.35691 51.4205,-0.8377 106.0979,20.519264 139.3637,82.442928 z m -282.7982,-22.785172 c 0.8016,0.305091 0.7874,0.369548 -0.7214,3.196187 -8.0427,15.067031 -10.7093,21.77456 -15.1138,44.0071332 -2.1378,10.6011968 1.4689,21.8648998 -2.453,30.9029408 -3.88038,8.942638 -3.54893,6.331862 -7.25237,13.547059 -3.51974,6.857294 -3.56037,7.729499 -11.96413,8.78396 -23.43189,2.480005 -29.38869,-0.280763 -37.72431,-11.986863 -1.53503,-2.155711 -10.86296,-16.532508 -0.77256,-21.39766 8.01844,-5.103769 21.81565,1.482721 38.57538,-0.921857 11.88835,-1.705667 12.68292,-7.812912 0.25121,-8.65213 -24.54871,-1.657192 -39.79974,-14.5259368 -47.77203,-34.0978 -3.44769,-10.745954 -0.0927,-31.61252 19.43368,-20.672801 13.24435,7.420195 18.66921,14.457432 26.54257,15.733601 6.04649,0.980058 8.14388,-3.174611 1.07384,-8.389152 -10.1671,-7.49879 -22.87628,-21.954287 -18.1963,-45.663879 1.54703,-7.838053 9.84804,-17.921021 18.12459,-17.134223 21.56613,2.050152 9.58659,41.942597 37.96863,52.745484 z m 166.2245,198.467474 c -30.4465,10.37824 -32.2323,42.03402 -8.1484,54.57806 33.5044,17.45025 64.6,-26.4809 51.7568,-28.40084 -7.1611,-1.07051 -10.5148,19.83992 -33.615,22.64952 -10.1003,1.22846 -20.2764,-3.47013 -23.6208,-12.21127 -6.3367,-24.67151 24.6006,-30.52244 22.4412,-36.75916 -0.6501,-1.87763 -3.5109,-1.66393 -8.8138,0.14369 z m 99.8435,19.11097 c 39.4265,23.57735 37.5939,63.34789 30.373,96.6005 -12.9471,59.62232 -55.5401,90.51216 -107.2288,118.09855 -11.1045,5.92649 -44.1896,30.86155 -51.033,31.24202 -1.9988,-0.27615 -42.2865,-27.92501 -17.9044,-80.42765 7.3513,-15.82976 10.3876,-18.05232 12.0038,-44.84688 0,0 5.3822,-0.56046 8.0928,-0.34162 -0.9581,34.86606 0.226,61.44235 4.5082,74.30554 2.8298,8.50035 4.1676,8.84906 5.9599,9.10901 25.5792,3.70993 53.763,-13.3202 72.6973,-27.30531 33.491,-25.91325 47.9356,-59.02261 45.5802,-110.27182 -0.3183,-6.92639 -0.7568,-8.28799 -1.0092,-9.78959 -1.1401,-6.78312 -1.1538,-6.84699 -2.2692,-10.73836 -0.3604,-1.25762 -0.3623,-1.23437 0.5111,-6.98872 1.8438,-12.14795 1.8362,-25.7884 -0.022,-36.19572 -0.2044,-1.14718 -0.3984,-2.53497 -0.2597,-2.44995 z m -5.9195,63.90515 c 0.02,-0.0468 0.1344,-0.002 0.1431,0.0599 9.8253,88.51511 -63.2163,129.94961 -101.77,131.8948 l -3.0727,0.15503 -0.3995,-1.16169 c -5.9585,-24.18185 -8.5761,-49.02472 -6.4178,-74.18668 0.077,-0.89755 5.2486,-1.14454 6.1259,-1.4361 1.0169,-0.33796 0.9918,-0.0206 2.8396,2.728 6.6015,9.81972 19.1531,13.36378 25.5607,12.31863 13.0992,-2.13661 20.9534,-7.0655 28.3812,-15.33808 1.028,-1.26791 2.33,-3.29836 3.468,-3.8592 21.0895,-10.39348 34.7674,-27.0514 45.1415,-51.17461 z m -220.9995,5.49837 c 8.6006,15.06475 24.6035,24.83251 40.089,34.02945 -3.6046,7.56891 -9.2454,15.40601 -23.3659,14.04729 -28.966,-2.7872 -32.8832,-36.93241 -17.2068,-48.37957 0.072,-0.008 0.3633,-0.0207 0.4837,0.30283 z"/>
  </g>
  <path id="axel-mouth-w" transform="translate(-883.9422,152.08753)" fill="#0a0b0e" d="m 1162.9646,56.546389 c -4.4927,-1.033746 -9.3686,-3.045886 -11.9146,-7.013407 -0.6544,-1.019833 -0.9861,-1.541714 -1.4061,-1.624626 -0.441,-0.08707 -0.9795,0.309958 -2.0914,1.122776 -4.9884,3.64656 -13.4856,5.877687 -18.5869,4.252047 -6.9044,-2.20026 -9.8382,-5.44322 -11.5548,-12.77248 -2.2393,-9.560462 5.8986,-12.063917 8.3847,-1.54808 2.481,10.495195 17.7767,6.052423 19.086,-0.17235 0.8101,-3.851298 2.9994,-5.998377 5.1251,-6.10236 1.768,-0.08649 3.492,1.240487 4.3418,4.17593 0.8173,2.823402 2.7825,7.30484 3.5395,8.07165 5.0133,5.07809 12.8943,4.40584 18.8513,-1.60802 6.5017,-6.563875 9.7013,0.167162 7.8292,3.802452 -2.7934,5.424129 -13.7805,11.216559 -21.6038,9.416468 z"/>
  <g id="axel-eye-orb">
    <circle cx="0" cy="0" r="32.45" fill="#0a0b0e"/>
    <ellipse cx="11.81" cy="-6.35" rx="8.95" ry="8.49" fill="#ffffff"/>
    <ellipse cx="-8.77" cy="11.80" rx="3.93" ry="3.72" fill="#ffffff"/>
  </g>
  <!-- Tail wag: the official art is drawn twice — once clipped to the tail (rotates behind), once with the tail cut out (static on top).
       At rest the two halves recombine into the exact original drawing. Coordinates are in the 550×600 viewBox. -->
  <clipPath id="axel-tail-clip" clipPathUnits="userSpaceOnUse"><path d="${AXO_TAIL_D}"/></clipPath>
  <clipPath id="axel-body-clip" clipPathUnits="userSpaceOnUse"><path clip-rule="evenodd" d="M-80 -80 H640 V700 H-80 Z ${AXO_TAIL_D} ${AXO_GILL_L_D} ${AXO_GILL_R_D}"/></clipPath>
  <clipPath id="axel-gill-l-clip" clipPathUnits="userSpaceOnUse"><path d="${AXO_GILL_L_D}"/></clipPath>
  <clipPath id="axel-gill-r-clip" clipPathUnits="userSpaceOnUse"><path d="${AXO_GILL_R_D}"/></clipPath>
  <g id="axel-tail-under" fill="none" stroke-width="36" stroke-linecap="round" stroke-linejoin="round">
    <path d="M285 451 L291 451" stroke="#e4769d"/>
    <path d="M291 449 L297 456 L317 464 L330 461 L343 454 L361 440 L373 430 L383 418 L392 402 L398 393" stroke="#f5dce2"/>
    <path d="M398 393 L406 389 L405 342" stroke="#e4769d"/>
  </g>
  <!-- Ink filler along each gill root: hidden under the art at rest, it closes the hairline gap while a gill flutters. -->
  <path id="axel-gill-under-l" d="M143 99 L141 112 L136 135 L131 152 L127 172 L124 198 L120 213 L113 222" fill="none" stroke="#0a0b0e" stroke-width="10" stroke-linejoin="round"/>
  <path id="axel-gill-under-r" d="M421.5 108 L426 125 L433 150 L436.5 175 L437 200 L436 214 L439.5 226" fill="none" stroke="#0a0b0e" stroke-width="10" stroke-linejoin="round"/>
  <radialGradient id="axel-blush"><stop offset="0" stop-color="#f472b6" stop-opacity=".72"/><stop offset=".6" stop-color="#f472b6" stop-opacity=".34"/><stop offset="1" stop-color="#f472b6" stop-opacity="0"/></radialGradient>
  <radialGradient id="axel-bubble" cx=".38" cy=".34" r=".7"><stop offset="0" stop-color="#ffffff" stop-opacity=".95"/><stop offset=".55" stop-color="#e0f2fe" stop-opacity=".55"/><stop offset="1" stop-color="#bae6fd" stop-opacity=".35"/></radialGradient>
</defs></svg>`;

const AXO_LABEL = {
  idle: 'Axel is relaxing',
  wave: 'Axel is waving hello',
  working: 'Axel is watching your agents work',
  thinking: 'Axel is thinking',
  waiting: 'Axel is waiting for you',
  blocked: 'Axel paused at a guardrail',
  done: 'Axel is celebrating',
  failed: 'Axel needs a hand',
  sleeping: 'Axel is resting',
  building: 'Axel is setting up your sandbox',
};

function axelEyes(state) {
  if (state === 'done') {
    return `<path d="M158 193 Q190 154 221 195" class="axo-ink-arc"/><path d="M316 201 Q348 162 379 203" class="axo-ink-arc"/>`;
  }
  if (state === 'sleeping') {
    return `<path d="M158 183 Q190 212 221 185" class="axo-ink-arc"/><path d="M316 191 Q348 220 379 193" class="axo-ink-arc"/>`;
  }
  return `<g class="axo-eye" style="transform-origin:189.6px 185px"><use href="#axel-eye-orb" x="189.62" y="185.02"/></g>` +
         `<g class="axo-eye" style="transform-origin:347.9px 193.4px"><use href="#axel-eye-orb" x="347.90" y="193.35"/></g>`;
}

function axelBrows(state) {
  if (state === 'waiting') {
    return `<path d="M162 138 Q190 122 216 138" class="axo-ink-thin"/><path d="M322 146 Q350 130 376 146" class="axo-ink-thin"/>`;
  }
  if (state === 'failed') {
    return `<path d="M160 144 Q190 136 216 126" class="axo-ink-thin"/><path d="M322 134 Q348 144 378 152" class="axo-ink-thin"/>`;
  }
  return '';
}

function axelMouth(state) {
  if (state === 'failed') {
    return `<path d="M242 214 Q269 192 296 216" class="axo-ink-thin"/>`;
  }
  return `<use href="#axel-mouth-w"/>`;
}

function axelFx(state) {
  switch (state) {
    case 'wave':
      return `<g class="axo-wave-lines"><path d="M98 262 Q78 286 90 314" class="axo-accent-arc"/><path d="M74 252 Q48 286 64 324" class="axo-accent-arc s2"/></g>`;
    case 'waiting':
      return `<g class="axo-bubble"><circle cx="418" cy="36" r="38" class="axo-pill"/><path d="M392 62 L376 86 L408 72 Z" class="axo-pill-tail"/><circle cx="418" cy="36" r="34" class="axo-pill-stroke"/><text x="418" y="53" text-anchor="middle" class="axo-q">?</text></g>`;
    case 'thinking':
      return `<g class="axo-dots"><circle cx="386" cy="78" r="10" class="axo-pill"/><circle cx="408" cy="44" r="15" class="axo-pill"/><circle cx="436" cy="6" r="21" class="axo-pill"/></g>`;
    case 'sleeping':
      return `<g class="axo-z"><text x="382" y="78" class="z1">z</text><text x="408" y="42" class="z2">z</text><text x="438" y="4" class="z3">Z</text></g>`;
    case 'blocked':
      return `<g class="axo-shield"><path d="M56 364 h84 v44 c0 40 -42 62 -42 62 c0 0 -42 -22 -42 -62 z" fill="#f5dce2" stroke="#0a0b0e" stroke-width="10" stroke-linejoin="round"/><path d="M81 404 l13 13 l25 -27" fill="none" stroke="#e4769d" stroke-width="11" stroke-linecap="round" stroke-linejoin="round"/></g>`;
    case 'building': {
      const teeth = [0, 45, 90, 135].map((a) => `<rect x="86" y="364" width="24" height="100" rx="7" fill="#eea0bb" stroke="#0a0b0e" stroke-width="8" transform="rotate(${a} 98 414)"/>`).join('');
      return `<g class="axo-gear">${teeth}<circle cx="98" cy="414" r="34" fill="#f5dce2" stroke="#0a0b0e" stroke-width="9"/><circle cx="98" cy="414" r="13" fill="#e4769d" stroke="#0a0b0e" stroke-width="7"/></g>`;
    }
    case 'failed':
      return `<path class="axo-sweat" d="M406 116 C390 140 390 158 406 158 C422 158 422 140 406 116 Z" fill="#93c5fd" stroke="#0a0b0e" stroke-width="7" stroke-linejoin="round"/>`;
    case 'working':
      return `<g class="axo-sparks"><path class="s1" d="M88 378 l8 20 l20 8 l-20 8 l-8 20 l-8 -20 l-20 -8 l20 -8 z" fill="#e4769d"/><path class="s2" d="M494 270 l6 15 l15 6 l-15 6 l-6 15 l-6 -15 l-15 -6 l15 -6 z" fill="#eea0bb"/><path class="s3" d="M418 18 l6 14 l14 6 l-14 6 l-6 14 l-6 -14 l-14 -6 l14 -6 z" fill="#38bdf8"/></g>`;
    case 'done': {
      const bits = [[64, 96, '#e4769d', 'c'], [138, 28, '#34d399', 'r'], [274, 14, '#fbbf24', 'r'], [416, 20, '#38bdf8', 'c'], [498, 250, '#e4769d', 'r'], [78, 384, '#fbbf24', 'c'], [498, 344, '#34d399', 'c']];
      return `<g class="axo-confetti">${bits.map(([x, y, c, k], i) => k === 'c'
        ? `<circle class="cf cf${i}" cx="${x}" cy="${y}" r="11" fill="${c}"/>`
        : `<rect class="cf cf${i}" x="${x - 11}" y="${y - 7}" width="22" height="14" rx="5" fill="${c}"/>`).join('')}</g>`;
    }
    default:
      return '';
  }
}

/** Render Axel (official AX mascot). state: idle|wave|working|thinking|waiting|blocked|done|failed|sleeping|building */
function axo(state, opts) {
  state = AXO_LABEL[state] ? state : 'idle';
  opts = opts || {};
  const label = opts.label || AXO_LABEL[state];
  return `<svg class="axo axo--${state} ${opts.cls || ''}" viewBox="0 0 550 600" ${opts.decorative ? 'aria-hidden="true"' : `role="img" aria-label="${label}"`} data-axo="${state}" ${opts.id ? `id="${opts.id}"` : ''}>
    <g class="axo-root"><g class="axo-act">
      <use href="#axel-tail-under" clip-path="url(#axel-tail-clip)"/>
      <use href="#axel-gill-under-l" clip-path="url(#axel-gill-l-clip)"/>
      <use href="#axel-gill-under-r" clip-path="url(#axel-gill-r-clip)"/>
      <g class="axo-tail-wag"><g class="axo-tail"><use href="#axel-body-art" clip-path="url(#axel-tail-clip)"/></g></g>
      <g class="axo-gill axo-gill-l"><use href="#axel-body-art" clip-path="url(#axel-gill-l-clip)"/></g>
      <g class="axo-gill axo-gill-r"><use href="#axel-body-art" clip-path="url(#axel-gill-r-clip)"/></g>
      <use href="#axel-body-art" class="axo-art" clip-path="url(#axel-body-clip)"/>
      <g class="axo-tfx-under"></g>
      <g class="axo-face">
        <g class="axo-look">${axelEyes(state)}</g>
        ${axelBrows(state)}
        ${axelMouth(state)}
      </g>
      <g class="axo-tfx"></g>
    </g></g>
    <g class="axo-fx">${axelFx(state)}</g>
  </svg>`;
}

/** Morph an existing <svg class="axo"> in place to a new mood without destroying the DOM node or resetting its float/tail animations. */
function updateAxoInPlace(svg, state) {
  if (!svg) return;
  state = AXO_LABEL[state] ? state : 'idle';
  if (svg.dataset && svg.dataset.axo === state) return;
  if (svg.dataset) svg.dataset.axo = state;
  if (svg.classList) {
    [...svg.classList].forEach((c) => { if (c.indexOf('axo--') === 0) svg.classList.remove(c); });
    svg.classList.add('axo--' + state);
  }
  if (svg.getAttribute && svg.getAttribute('aria-hidden') !== 'true' && svg.setAttribute) {
    svg.setAttribute('aria-label', AXO_LABEL[state]);
  }
  const face = svg.querySelector ? svg.querySelector('.axo-face') : null;
  if (face) {
    face.innerHTML = `<g class="axo-look">${axelEyes(state)}</g>${axelBrows(state)}${axelMouth(state)}`;
  }
  const fx = svg.querySelector ? svg.querySelector('.axo-fx') : null;
  if (fx) {
    fx.innerHTML = axelFx(state);
  }
}

/** Axel's eyes gently track the pointer (any svg.axo[data-follow] on the page). */
let axoRaf = 0;
document.addEventListener('pointermove', (e) => {
  if (axoRaf || reducedMotion()) return;
  axoRaf = requestAnimationFrame(() => {
    axoRaf = 0;
    document.querySelectorAll('svg.axo[data-follow]').forEach((s) => {
      const r = s.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width * 0.48), dy = e.clientY - (r.top + r.height * 0.34);
      const d = Math.max(1, Math.hypot(dx, dy));
      const k = Math.min(1, d / 260);
      s.style.setProperty('--lx', ((dx / d) * 9.5 * k).toFixed(1) + 'px');
      s.style.setProperty('--ly', ((dy / d) * 7.5 * k).toFixed(1) + 'px');
    });
  });
});

/** Playful hop when Axel is clicked — with a happy tail wag. */
function axoPoke(svg) {
  if (!svg || reducedMotion()) return;
  svg.classList.remove('axo-poke');
  void svg.getBoundingClientRect();
  svg.classList.add('axo-poke');
  setTimeout(() => svg.classList.remove('axo-poke'), 780);
  axoWag(svg);
}

/** Tail wag (a damped swish). Idle wags ride along with an occasional blink in CSS; this one answers a click. */
function axoWag(svg) {
  if (!svg || reducedMotion()) return;
  svg.classList.remove('axo-wag');
  void svg.getBoundingClientRect();
  svg.classList.add('axo-wag');
  clearTimeout(svg._wagT);
  svg._wagT = setTimeout(() => svg.classList.remove('axo-wag'), 980);
}
/* Clicking any Axel counts toward his trick streak (the Home hero's poke button handles its own clicks). */
document.addEventListener('click', (e) => {
  const s = e.target && e.target.closest ? e.target.closest('svg.axo') : null;
  if (s && !e.target.closest('[data-action="poke"]')) axoTap(s);
});

/* ---------- Easter egg: Axel's tricks ----------
   The first two clicks wag his tail (the Home hero also hops). Keep clicking and Axel answers each click with a
   different trick, then takes a short nap and starts over. Calm on purpose:
   · one trick at a time: a click during a trick is remembered (one, never more) and plays as soon as the trick ends,
     so no click is lost and fast clicking can't make him flail; each trick lasts about a second; no sound, no toasts;
   · a click during his nap wakes him up and starts over;
   · a 4 s pause resets the streak, so a single click is only ever a wag;
   · with reduced motion each trick is a still pose (perked gills, a wink, a blush, closed eyes) instead of movement.
   While he's busy, background refreshes of the page wait for him (see axoBusy and render in app.js). */
const AXO_TRICKS = [
  { k: 'gills', ms: 1000, say: 'Gill wiggle! Six feathery gills, freshly fluffed.' },
  { k: 'wink', ms: 950, say: 'Psst. I can see every step your agents take.' },
  { k: 'bubble', ms: 1500, say: 'Blub. That one’s for your clean diffs.' },
  { k: 'look', ms: 1250, say: 'Just checking on your agents… all accounted for.' },
  { k: 'blush', ms: 1500, say: 'Okay, you found my secret. Let’s keep it between us.' },
  { k: 'flip', ms: 1100, say: 'Ta-da! Regrowing a limb is harder than that.' },
  { k: 'nap', ms: 3800, say: 'Phew. Quick nap — I’ll wave when an agent needs you.' },
];
const AXO_WAKE_SAY = 'I’m up, I’m up!';
const AXO_STREAK_GAP = 4000;
const axoStreak = { n: 0, last: 0, endsAt: 0, napping: false, queued: null, animUntil: 0, timer: 0, svg: null };
/* Extra bits a trick draws for a moment: `under` sits beneath the face (cheeks), `over` on top (sparkle, bubbles, z's). */
const AXO_TRICK_FX = {
  wink: { over: '<path class="tf-spark" d="M400 104 l8 21 l21 8 l-21 8 l-8 21 l-8 -21 l-21 -8 l21 -8 z"/>' },
  bubble: { over: '<ellipse class="tf-o" cx="268" cy="196" rx="12" ry="14"/><g class="tf-bub b1"><circle cx="292" cy="176" r="17"/><path d="M283 168 q4 -6 11 -6"/></g><g class="tf-bub b2"><circle cx="312" cy="160" r="10"/><path d="M307 155 q2 -4 7 -4"/></g>' },
  blush: { under: '<ellipse class="tf-blush" cx="164" cy="218" rx="34" ry="19"/><ellipse class="tf-blush" cx="369" cy="228" rx="34" ry="19"/>' },
  flip: { over: '<g class="tf-happy"><path d="M158 193 Q190 154 221 195" class="axo-ink-arc"/><path d="M316 201 Q348 162 379 203" class="axo-ink-arc"/></g>' },
  nap: { over: '<g class="tf-sleep"><path d="M158 183 Q190 212 221 185" class="axo-ink-arc"/><path d="M316 191 Q348 220 379 193" class="axo-ink-arc"/></g><g class="tf-z"><text x="392" y="84">z</text><text x="418" y="50" class="z2">z</text><text x="448" y="14" class="z3">Z</text></g>' },
};
/** The person did something else: stop holding back re-renders for Axel. */
function axoYield() { axoStreak.animUntil = 0; }
/**
 * One click on Axel. Returns { wag } for the first two clicks (with { woke } if it woke him from his nap), { trick } when a
 * trick starts, or { queued } when a trick is playing; a queued click plays when it ends and is reported to opts.onPlay.
 */
function axoTap(svg, opts) {
  if (!svg) return null;
  opts = opts || {};
  const S = axoStreak;
  const now = Date.now();
  let woke = false;
  if (now < S.endsAt) {
    if (S.napping) { axoEndTrick(true); woke = true; }   // poke a napping axolotl and he wakes up
    else {
      S.last = now;
      if (!S.queued) S.queued = opts;                    // remember one click; extra clicks during the trick are dropped
      S.animUntil = Math.max(S.animUntil, S.endsAt + 1600);
      return { queued: true };
    }
  }
  if (woke || now - S.last > AXO_STREAK_GAP) S.n = 0;
  S.last = now;
  S.n += 1;
  S.svg = svg;
  if (S.n <= 2) {
    if (opts.hop) axoPoke(svg); else axoWag(svg);
    S.animUntil = Math.max(S.animUntil, now + 1000);
    return { wag: true, woke };
  }
  const trick = AXO_TRICKS[Math.min(S.n - 3, AXO_TRICKS.length - 1)];
  S.napping = trick.k === 'nap';
  if (S.napping) S.n = 0;                                // the nap ends the streak; the next click starts over with a wag
  S.endsAt = now + trick.ms;
  S.animUntil = Math.max(S.animUntil, S.endsAt + 150);
  axoPlay(svg, trick);
  clearTimeout(S.timer);
  S.timer = setTimeout(() => axoEndTrick(false), trick.ms);
  return { trick };
}
/** A trick finished (or the nap was interrupted). Plays the remembered click, if any, on whichever Axel is on screen now. */
function axoEndTrick(interrupted) {
  const S = axoStreak;
  clearTimeout(S.timer);
  if (S.svg) axoClearTrick(S.svg);
  S.endsAt = 0;
  S.napping = false;
  const q = S.queued;
  S.queued = null;
  if (interrupted) return;
  /* Between two tricks is the one safe moment for an overdue page refresh (render in app.js). */
  if (typeof axoOnTrickEnd === 'function') axoOnTrickEnd();
  if (!q) return;
  const svg = S.svg && document.contains(S.svg) ? S.svg : (q.find ? q.find() : document.querySelector('svg.axo'));
  const r = axoTap(svg, q);
  if (r && q.onPlay) q.onPlay(r);
}
function axoPlay(svg, trick) {
  axoClearTrick(svg);
  const fx = AXO_TRICK_FX[trick.k] || {};
  const over = svg.querySelector('.axo-tfx'), under = svg.querySelector('.axo-tfx-under');
  if (over && fx.over) over.innerHTML = fx.over;
  if (under && fx.under) under.innerHTML = fx.under;
  svg.classList.add('axo-trick', 'axo-trick--' + trick.k);
  if (trick.k === 'flip') axoWag(svg);              // the tail joins the landing
}
function axoClearTrick(svg) {
  [...svg.classList].forEach((c) => { if (c.indexOf('axo-trick') === 0) svg.classList.remove(c); });
  svg.querySelectorAll('.axo-tfx, .axo-tfx-under').forEach((g) => { g.innerHTML = ''; });
}

