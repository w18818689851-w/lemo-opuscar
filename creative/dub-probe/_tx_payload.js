// TX 排版常量引用原件的 PMX / px（只读）
import { PMX, px } from '/styles/swiss-motion/demo/film.js';

export const PAYLOAD = [
  { A: ['Neue Form', 'Fraktur', 400, 118, 200], B: ['neue form', 800, 112], C: [104, 800, 790], E: [PMX, 861, 150, 800], split: [PMX, 973] },
  { A: ['Grosses Konzert', 'DMSerif', 400, 62, 300], B: ['grosses konzert', 300, 62], cut: 14.0 },
  { A: ['!! nicht verpassen !!', 'Archivo', 800, 40, 370], B: ['!! nicht verpassen !!', 900, 40], cut: 12.5 },
  { A: ['Konzert 1961', 'DMSerif', 400, 58, 452], B: ['konzert 1961', 600, 58], C: [32, 600, 842], E: [px(3), 64, 32, 700] },
  { A: ['Freitag 17. März 1961 · 20.15 Uhr', 'Archivo', 400, 28, 520], B: ['freitag 17. märz 1961 · 20.15 uhr', 400, 28], C: [20, 400, 888], E: [px(3), 104, 20, 500] },
  { A: ['im Kleinen Saal', 'Fraktur', 400, 54, 600], B: ['kleiner saal', 700, 54], C: [20, 400, 914], E: [px(3), 130, 20, 500] },
  { A: ['mit Pauken und Trompeten', 'DMSerif', 400, 42, 680], B: ['mit pauken und trompeten', 500, 42], cut: 13.0 },
  { A: ['Werke von Marti, Brunner, Weiss', 'Archivo', 400, 24, 748], B: ['werke von marti, brunner, weiss', 400, 24], C: [20, 400, 940], E: [px(3), 156, 20, 400] },
  { A: ['Eintritt Fr. 3.–', 'DMSerif', 400, 36, 820], B: ['eintritt fr. 3.–', 600, 36], C: [20, 400, 966], E: [px(3), 182, 20, 400] },
  { A: ['— Nur ein Abend —', 'Fraktur', 400, 44, 900], B: ['nur ein abend', 800, 44], cut: 13.5 },
];;
